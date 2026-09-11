use crate::{client::BuzzClient, error::CliError, AirhopCmd};

/// Uses the authenticated Airhop surface appropriate to the requested role.
pub async fn dispatch(cmd: AirhopCmd, client: &BuzzClient) -> Result<(), CliError> {
    let path = match cmd {
        AirhopCmd::Clients {
            branch_id,
            unassigned,
            status,
            search,
        } => {
            let mut query = url::form_urlencoded::Serializer::new(String::new());
            if let Some(id) = branch_id {
                query.append_pair("branchId", &id.to_string());
            }
            if unassigned {
                query.append_pair("unassignedBranch", "true");
            }
            if let Some(value) = status {
                query.append_pair("status", &value);
            }
            if let Some(value) = search {
                query.append_pair("search", &value);
            }
            format!(
                "/api/airhop/staff/v1/client-conversations?{}",
                query.finish()
            )
        }
        AirhopCmd::ClientMigrationPreview { conversation_id } => {
            format!("/api/airhop/staff/v1/client-conversations/{conversation_id}/migration-preview")
        }
        AirhopCmd::ClientCommand {
            community_id,
            request,
        } => {
            let tags = [
                nostr::Tag::parse(["airhop-community", &community_id.to_string()]),
                nostr::Tag::parse(["-"]),
                nostr::Tag::parse(["nonce", &uuid::Uuid::new_v4().to_string()]),
            ]
            .into_iter()
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| CliError::Other(e.to_string()))?;
            let event = client.sign_event(
                nostr::EventBuilder::new(
                    nostr::Kind::Custom(buzz_core::kind::KIND_AIRHOP_CLIENT_COMMAND as u16),
                    request,
                )
                .tags(tags),
            )?;
            println!("{}", client.submit_event(event).await?);
            return Ok(());
        }
        AirhopCmd::Knowledge {
            query,
            document_id,
            after,
        } => {
            let mut params = url::form_urlencoded::Serializer::new(String::new());
            params.append_pair("view", "published");
            if let Some(query) = query {
                params.append_pair("query", &query);
            }
            if let Some(id) = document_id {
                params.append_pair("id", &id.to_string());
            }
            if let Some(after) = after {
                params.append_pair("after", &after.to_string());
            }
            format!("/api/airhop/knowledge/v1/artifacts?{}", params.finish())
        }
        AirhopCmd::Parent { request } => {
            let body: serde_json::Value = serde_json::from_str(&request)
                .map_err(|error| CliError::Other(format!("invalid parent request: {error}")))?;
            let grant = match std::env::var("BUZZ_AIRHOP_CONTEXT_GRANT_FILE") {
                Ok(path) => std::fs::read_to_string(path)
                    .map_err(|_| CliError::Other("cannot read parent context grant file".into()))?,
                Err(_) => std::env::var("BUZZ_AIRHOP_CONTEXT_GRANT").map_err(|_| {
                    CliError::Other("a supervisor-issued parent context grant is required".into())
                })?,
            };
            println!(
                "{}",
                client
                    .call_airhop_parent_backend(&body, grant.trim())
                    .await?
            );
            return Ok(());
        }
        AirhopCmd::CenterAnalytics { days, yesterday } => format!(
            "/api/airhop/staff/v1/booking-funnel-analytics?view=center&days={days}&until={}",
            if yesterday { "yesterday" } else { "today" }
        ),
        AirhopCmd::SiteAnalytics { days, yesterday } => {
            format!(
                "/api/airhop/staff/v1/site-analytics?days={days}{}",
                if yesterday { "&until=yesterday" } else { "" }
            )
        }
        AirhopCmd::TrackingLinks => "/api/airhop/staff/v1/tracking-links".to_owned(),
    };
    let report = client.get_authed(&path).await?;
    let value: serde_json::Value = serde_json::from_str(&report)
        .map_err(|error| CliError::Other(format!("invalid Airhop report: {error}")))?;
    println!("{value}");
    Ok(())
}
