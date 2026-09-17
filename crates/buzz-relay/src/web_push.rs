//! Browser transport for the existing encrypted NIP-PL lease and durable outbox.
//! Only fixed push-provider origins are reachable; payloads contain no message text.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use web_push::{
    ContentEncoding, PartialVapidSignatureBuilder, SubscriptionInfo, VapidSignatureBuilder,
    WebPushMessageBuilder,
};

/// Advertised browser profile. Native APNs profiles remain unchanged.
pub const PROFILE: &str = "airhop-web-v1";
pub(crate) const CAPABILITY_PREFIX: &str = "airhop-webpush-v1:";

/// Long-lived VAPID configuration. Debug output never contains the private key.
#[derive(Clone)]
pub struct WebPushConfig {
    signer: PartialVapidSignatureBuilder,
    /// Browser subscription application-server key, URL-safe base64.
    pub public_key: String,
}

impl std::fmt::Debug for WebPushConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WebPushConfig")
            .field("public_key", &self.public_key)
            .finish_non_exhaustive()
    }
}

impl WebPushConfig {
    /// Read a PEM secret file (preferred) or raw base64url P-256 key, never both.
    /// Invalid explicit configuration fails startup without disclosing key material.
    pub fn from_env() -> Result<Option<Self>, String> {
        fn optional(name: &str) -> Result<Option<String>, String> {
            match std::env::var(name) {
                Ok(value) if !value.is_empty() => Ok(Some(value)),
                Ok(_) | Err(std::env::VarError::NotPresent) => Ok(None),
                Err(_) => Err(format!("Invalid {name}")),
            }
        }
        let raw = optional("AIRHOP_WEB_PUSH_PRIVATE_KEY")?;
        let path = optional("AIRHOP_WEB_PUSH_PRIVATE_KEY_FILE")?;
        let signer = match (raw, path) {
            (None, None) => return Ok(None),
            (Some(_), Some(_)) => return Err("Configure only one Web Push key source".into()),
            (Some(raw), None) => VapidSignatureBuilder::from_base64_no_sub(&raw)
                .map_err(|_| "Invalid AIRHOP_WEB_PUSH_PRIVATE_KEY".to_string())?,
            (None, Some(path)) => {
                let file = std::fs::File::open(path)
                    .map_err(|_| "Cannot read AIRHOP_WEB_PUSH_PRIVATE_KEY_FILE".to_string())?;
                VapidSignatureBuilder::from_pem_no_sub(file)
                    .map_err(|_| "Invalid AIRHOP_WEB_PUSH_PRIVATE_KEY_FILE".to_string())?
            }
        };
        Ok(Some(Self {
            public_key: URL_SAFE_NO_PAD.encode(signer.get_public_key()),
            signer,
        }))
    }
}

/// Private browser capability inside NIP-44, never public event tags.
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BrowserEndpoint {
    /// Push-service capability URL and encryption keys.
    pub subscription: SubscriptionInfo,
    /// Unix seconds; pause is enforced server-side even when the browser is closed.
    pub paused_until: i64,
    /// Bound to the server-resolved Center origin at lease acceptance.
    pub origin: String,
}

/// Validate before storing and before sending. No arbitrary HTTPS/localhost redirects.
pub fn validate_endpoint(raw: &str, now: i64) -> Result<BrowserEndpoint, String> {
    if raw.len() > 4096 {
        return Err("browser endpoint too large".into());
    }
    let value: BrowserEndpoint =
        serde_json::from_str(raw).map_err(|_| "invalid browser endpoint")?;
    let url = url::Url::parse(&value.subscription.endpoint).map_err(|_| "invalid push URL")?;
    let permitted = match url.host_str() {
        Some("web.push.apple.com") => url.path().starts_with("/"),
        Some("fcm.googleapis.com") => url.path().starts_with("/fcm/send/"),
        Some("updates.push.services.mozilla.com") => url.path().starts_with("/wpush/v"),
        _ => false,
    };
    if !permitted
        || url.scheme() != "https"
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.query().is_some()
        || url.path().len() < 2
        || value.paused_until < 0
        || value.paused_until > now + 31 * 86400
    {
        return Err("push provider or pause not permitted".into());
    }
    let key = URL_SAFE_NO_PAD
        .decode(&value.subscription.keys.p256dh)
        .map_err(|_| "invalid push key")?;
    let auth = URL_SAFE_NO_PAD
        .decode(&value.subscription.keys.auth)
        .map_err(|_| "invalid push auth")?;
    if key.len() != 65 || key[0] != 4 || auth.len() != 16 {
        return Err("invalid push key length".into());
    }
    // Encryption also checks the point, not just the byte length.
    let mut probe = WebPushMessageBuilder::new(&value.subscription);
    probe.set_payload(ContentEncoding::Aes128Gcm, b"validate");
    probe.build().map_err(|_| "invalid push encryption key")?;
    Ok(value)
}

#[derive(Debug, PartialEq)]
pub(crate) enum Delivery {
    Accepted,
    Paused,
    Gone,
    Retry,
    Failed,
}

pub(crate) async fn send(
    config: &WebPushConfig,
    http: &reqwest::Client,
    raw: &str,
    wake: &buzz_db::push::ClaimedWake,
) -> Delivery {
    let now = chrono::Utc::now().timestamp();
    let message = match prepare(config, raw, wake, now) {
        Ok(message) => message,
        Err(outcome) => return outcome,
    };
    let Some(payload) = message.payload else {
        return Delivery::Failed;
    };
    let mut request = http
        .post(message.endpoint.to_string())
        .header("TTL", message.ttl.to_string())
        .header("Topic", wake.id.simple().to_string())
        .header("Content-Encoding", "aes128gcm")
        .header("Content-Type", "application/octet-stream");
    for (key, value) in payload.crypto_headers {
        request = request.header(key, value);
    }
    match request.body(payload.content).send().await {
        Ok(response) => response_outcome(response.status()),
        Err(_) => Delivery::Retry,
    }
}

fn response_outcome(status: reqwest::StatusCode) -> Delivery {
    if status.is_success() {
        Delivery::Accepted
    } else if [404, 410].contains(&status.as_u16()) {
        Delivery::Gone
    } else if status.is_server_error() || status.as_u16() == 429 {
        Delivery::Retry
    } else {
        Delivery::Failed
    }
}

fn prepare(
    config: &WebPushConfig,
    raw: &str,
    wake: &buzz_db::push::ClaimedWake,
    now: i64,
) -> Result<web_push::WebPushMessage, Delivery> {
    let endpoint = validate_endpoint(raw, now).map_err(|_| Delivery::Failed)?;
    if endpoint.paused_until > now {
        return Err(Delivery::Paused);
    }
    if wake.expires_at <= now {
        return Err(Delivery::Failed);
    }
    let payload = serde_json::json!({
        "v": 1,
        "id": wake.id.to_string(),
        "event": hex::encode(&wake.event_id),
        "channel": wake.channel_id.map(|id| id.to_string()),
        "account": hex::encode(&wake.author),
        "origin": endpoint.origin,
        "title": "AirHop",
        "body": "Новое сообщение в вашем Центре",
    })
    .to_string();
    let mut signature = config.signer.clone().add_sub_info(&endpoint.subscription);
    signature.add_claim("sub", "https://app.airhop.ru");
    let signature = signature.build().map_err(|_| Delivery::Failed)?;
    let mut builder = WebPushMessageBuilder::new(&endpoint.subscription);
    builder.set_payload(ContentEncoding::Aes128Gcm, payload.as_bytes());
    builder.set_vapid_signature(signature);
    builder.set_ttl((wake.expires_at - now).clamp(0, 3600) as u32);
    builder.set_topic(wake.id.simple().to_string());
    builder.build().map_err(|_| Delivery::Failed)
}

#[cfg(test)]
mod tests {
    use super::*;
    /// Opt-in real provider probe; use only synthetic loopback subscription data.
    #[tokio::test]
    #[ignore = "requires an explicitly permitted real browser subscription"]
    async fn real_browser_transport_probe() {
        let directory = std::env::var("AIRHOP_PUSH_PROBE_DIR").unwrap();
        let root = std::path::Path::new(&directory);
        let signer = VapidSignatureBuilder::from_pem_no_sub(
            std::fs::File::open(root.join("vapid.pem")).unwrap(),
        )
        .unwrap();
        let config = WebPushConfig {
            public_key: URL_SAFE_NO_PAD.encode(signer.get_public_key()),
            signer,
        };
        let raw = std::fs::read_to_string(root.join("endpoint.json")).unwrap();
        let wake = buzz_db::push::ClaimedWake {
            community: buzz_core::CommunityId::from_uuid(uuid::Uuid::nil()),
            id: uuid::Uuid::new_v4(),
            claim_id: uuid::Uuid::new_v4(),
            event_id: vec![1; 32],
            channel_id: Some(uuid::Uuid::nil()),
            author: vec![2; 32],
            installation_id: "loopback-transport-probe".into(),
            lease_generation: 1,
            endpoint_grant: String::new(),
            class: "default".into(),
            expires_at: chrono::Utc::now().timestamp() + 300,
            attempt: 1,
        };
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .unwrap();
        assert_eq!(send(&config, &http, &raw, &wake).await, Delivery::Accepted);
    }
    fn endpoint(url: &str) -> String {
        serde_json::json!({"subscription":{"endpoint":url,"keys":{"p256dh":"BGa4N1PI79lboMR_YrwCiCsgp35DRvedt7opHcf0yM3iOBTSoQYqQLwWxAfRKE6tsDnReWmhsImkhDF_DBdkNSU","auth":"EvcWjEgzr4rbvhfi3yds0A"}},"paused_until":0,"origin":"wss://center.example"}).to_string()
    }
    #[test]
    fn capability_allows_only_fixed_public_push_providers() {
        for url in [
            "https://web.push.apple.com/Qtoken",
            "https://fcm.googleapis.com/fcm/send/token",
            "https://updates.push.services.mozilla.com/wpush/v2/token",
        ] {
            assert!(validate_endpoint(&endpoint(url), 1000).is_ok(), "{url}");
        }
        for url in [
            "http://web.push.apple.com/token",
            "https://127.0.0.1/secret",
            "https://web.push.apple.com.attacker.test/token",
            "https://user@web.push.apple.com/token",
            "https://fcm.googleapis.com/other",
            "https://web.push.apple.com:8443/token",
            "https://web.push.apple.com/token?redirect=localhost",
        ] {
            assert!(validate_endpoint(&endpoint(url), 1000).is_err(), "{url}");
        }
    }
    #[test]
    fn rejects_unbounded_pause_and_invalid_encryption_keys() {
        let raw = endpoint("https://web.push.apple.com/token");
        assert!(validate_endpoint(
            &raw.replace("\"paused_until\":0", "\"paused_until\":9999999999"),
            1000
        )
        .is_err());
        assert!(validate_endpoint(&raw.replace("EvcWjEgzr4rbvhfi3yds0A", "bad"), 1000).is_err());
    }

    #[test]
    fn encrypted_payload_round_trip_and_delivery_fences() {
        let (key, auth) = ece::generate_keypair_and_auth_secret().unwrap();
        let raw = serde_json::json!({
            "subscription": {"endpoint": "https://web.push.apple.com/test-only", "keys": {
                "p256dh": URL_SAFE_NO_PAD.encode(key.pub_as_raw().unwrap()),
                "auth": URL_SAFE_NO_PAD.encode(auth),
            }}, "paused_until": 0, "origin": "wss://center.example",
        })
        .to_string();
        let private_key = URL_SAFE_NO_PAD.encode(key.raw_components().unwrap().private_key());
        let config = WebPushConfig {
            signer: VapidSignatureBuilder::from_base64_no_sub(&private_key).unwrap(),
            public_key: String::new(),
        };
        let wake = buzz_db::push::ClaimedWake {
            community: buzz_core::CommunityId::from_uuid(uuid::Uuid::new_v4()),
            id: uuid::Uuid::new_v4(),
            claim_id: uuid::Uuid::new_v4(),
            event_id: vec![1; 32],
            channel_id: Some(uuid::Uuid::new_v4()),
            author: vec![2; 32],
            installation_id: "test-only".into(),
            lease_generation: 1,
            endpoint_grant: String::new(),
            class: "default".into(),
            expires_at: 1100,
            attempt: 1,
        };
        let message = prepare(&config, &raw, &wake, 1000).unwrap();
        assert_eq!(message.ttl, 100);
        assert_eq!(message.topic, Some(wake.id.simple().to_string()));
        let payload = message.payload.unwrap();
        assert!(payload
            .crypto_headers
            .iter()
            .any(|(name, value)| *name == "Authorization" && value.starts_with("vapid ")));
        let decoded =
            ece::decrypt(&key.raw_components().unwrap(), &auth, &payload.content).unwrap();
        let value: serde_json::Value = serde_json::from_slice(&decoded).unwrap();
        assert_eq!(value["account"], hex::encode(&wake.author));
        assert_eq!(value["event"], hex::encode(&wake.event_id));
        assert_eq!(value["channel"], wake.channel_id.unwrap().to_string());
        assert_eq!(value["body"], "Новое сообщение в вашем Центре");
        assert!(matches!(
            prepare(
                &config,
                &raw.replace("\"paused_until\":0", "\"paused_until\":1050"),
                &wake,
                1000
            ),
            Err(Delivery::Paused)
        ));
        assert!(matches!(
            prepare(&config, &raw, &wake, 1100),
            Err(Delivery::Failed)
        ));
        assert!(!format!("{config:?}").contains(&private_key));
    }

    #[test]
    fn provider_errors_do_not_retry_invalid_endpoints_or_redirect() {
        use reqwest::StatusCode;
        assert_eq!(response_outcome(StatusCode::CREATED), Delivery::Accepted);
        assert_eq!(response_outcome(StatusCode::GONE), Delivery::Gone);
        assert_eq!(response_outcome(StatusCode::NOT_FOUND), Delivery::Gone);
        assert_eq!(
            response_outcome(StatusCode::TOO_MANY_REQUESTS),
            Delivery::Retry
        );
        assert_eq!(
            response_outcome(StatusCode::SERVICE_UNAVAILABLE),
            Delivery::Retry
        );
        assert_eq!(
            response_outcome(StatusCode::TEMPORARY_REDIRECT),
            Delivery::Failed
        );
        assert_eq!(response_outcome(StatusCode::UNAUTHORIZED), Delivery::Failed);
    }
}
