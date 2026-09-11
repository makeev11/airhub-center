//! Host-side guest greeting: no LLM session, history query or domain tools.

use buzz_core::welcome_guest::GuestInvitation;
use nostr::EventId;

use crate::relay::{RelayError, RestClient};

/// Poll a minimal invitation and publish the exact signed introduction.
pub(crate) async fn publish_if_invited(
    client: &RestClient,
    published: Option<EventId>,
) -> Result<Option<EventId>, RelayError> {
    let value = client
        .get_json("/api/airhop/agents/v1/welcome-team")
        .await?;
    let Some(raw) = value.get("guestInvitation").filter(|raw| !raw.is_null()) else {
        return Ok(published);
    };
    let invitation: GuestInvitation =
        serde_json::from_value(raw.clone()).map_err(RelayError::Json)?;
    if invitation.guest_pubkey != client.keys.public_key() {
        return Err(RelayError::Http(
            "guest invitation principal mismatch".into(),
        ));
    }
    let event = invitation
        .reply_builder()
        .map_err(|error| RelayError::Http(error.to_string()))?
        .sign_with_keys(&client.keys)
        .map_err(|error| RelayError::Http(error.to_string()))?;
    if published == Some(event.id) {
        return Ok(published);
    }
    let response = client.submit_event(&event).await?;
    if response
        .get("accepted")
        .and_then(serde_json::Value::as_bool)
        != Some(true)
    {
        return Err(RelayError::Http("guest introduction not accepted".into()));
    }
    Ok(Some(event.id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::welcome_guest::GuestLanguage;
    use nostr::{Event, Keys};
    use serde_json::{json, Value};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn server(
        keys: Keys,
        responses: Vec<Value>,
    ) -> (RestClient, tokio::task::JoinHandle<Vec<(String, Vec<u8>)>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            let mut requests = Vec::new();
            for response in responses {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut bytes = Vec::new();
                loop {
                    let mut chunk = [0; 4096];
                    let count = stream.read(&mut chunk).await.unwrap();
                    assert!(count > 0);
                    bytes.extend_from_slice(&chunk[..count]);
                    if let Some(end) = bytes.windows(4).position(|s| s == b"\r\n\r\n") {
                        let header = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                        let length = header
                            .lines()
                            .find_map(|line| line.strip_prefix("content-length:"))
                            .map(|length| length.trim().parse::<usize>().unwrap())
                            .unwrap_or(0);
                        if bytes.len() >= end + 4 + length {
                            assert!(header.contains("authorization: nostr "));
                            requests.push((
                                header.lines().next().unwrap().to_owned(),
                                bytes[end + 4..end + 4 + length].to_vec(),
                            ));
                            break;
                        }
                    }
                }
                let body = response.to_string();
                stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
            }
            requests
        });
        (
            RestClient {
                http: reqwest::Client::new(),
                base_url: format!("http://{address}"),
                keys,
                auth_tag_json: None,
            },
            task,
        )
    }

    fn invitation(keys: &Keys) -> GuestInvitation {
        GuestInvitation {
            channel_id: uuid::Uuid::new_v4(),
            invitation_id: EventId::from_slice(&[7; 32]).unwrap(),
            guest_pubkey: keys.public_key(),
            language: GuestLanguage::Ru,
            created_at: 1_780_000_000,
        }
    }

    #[tokio::test]
    async fn publishes_only_closed_intro_and_deduplicates_after_acceptance() {
        let keys = Keys::generate();
        let invitation = invitation(&keys);
        let response = json!({"guestInvitation": invitation});
        let (client, task) = server(
            keys,
            vec![response.clone(), json!({"accepted":true}), response],
        )
        .await;
        let published = publish_if_invited(&client, None).await.unwrap();
        assert!(published.is_some());
        assert_eq!(
            publish_if_invited(&client, published).await.unwrap(),
            published
        );
        let requests = task.await.unwrap();
        assert_eq!(requests.len(), 3);
        assert_eq!(
            requests[0].0,
            "get /api/airhop/agents/v1/welcome-team http/1.1"
        );
        assert_eq!(requests[1].0, "post /events http/1.1");
        let event: Event = serde_json::from_slice(&requests[1].1).unwrap();
        assert!(invitation.matches_reply(&event));
        assert_eq!(published, Some(event.id));
    }

    #[tokio::test]
    async fn rejection_is_retryable_and_restart_reuses_same_event_id() {
        let keys = Keys::generate();
        let response = json!({"guestInvitation": invitation(&keys)});
        let (client, task) = server(
            keys,
            vec![
                response.clone(),
                json!({"accepted":false}),
                response.clone(),
                json!({"accepted":true}),
                response,
                json!({"accepted":true}),
            ],
        )
        .await;
        assert!(publish_if_invited(&client, None).await.is_err());
        let accepted = publish_if_invited(&client, None).await.unwrap();
        assert_eq!(publish_if_invited(&client, None).await.unwrap(), accepted);
        let requests = task.await.unwrap();
        let ids: Vec<EventId> = requests
            .iter()
            .filter(|(line, _)| line.starts_with("post "))
            .map(|(_, body)| serde_json::from_slice::<Event>(body).unwrap().id)
            .collect();
        assert_eq!(ids, vec![accepted.unwrap(); 3]);
    }

    #[tokio::test]
    async fn missing_foreign_or_expanded_invitation_never_publishes() {
        let keys = Keys::generate();
        let mut expanded = serde_json::to_value(invitation(&keys)).unwrap();
        expanded["history"] = json!(["must not be received"]);
        let (client, task) = server(
            keys,
            vec![
                json!({"guestInvitation":null}),
                json!({"guestInvitation":invitation(&Keys::generate())}),
                json!({"guestInvitation":expanded}),
            ],
        )
        .await;
        assert_eq!(publish_if_invited(&client, None).await.unwrap(), None);
        assert!(publish_if_invited(&client, None).await.is_err());
        assert!(publish_if_invited(&client, None).await.is_err());
        assert!(task
            .await
            .unwrap()
            .iter()
            .all(|(line, _)| line.starts_with("get ")));
    }
}
