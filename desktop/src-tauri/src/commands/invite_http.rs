use futures_util::StreamExt;
use reqwest::header::{HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use serde::Serialize;
use serde_json::Value;
use std::time::Duration;
use url::Url;

const INVITE_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_INVITE_REQUEST_BYTES: usize = 16 * 1024;
const MAX_INVITE_RESPONSE_BYTES: usize = 64 * 1024;
const INVITE_PATH_SUFFIXES: [&str; 3] = [
    "/api/invites",
    "/api/invites/claim",
    "/api/invites/accept-policy",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteHttpResponse {
    status: u16,
    body: Value,
}

fn validate_invite_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value.trim()).map_err(|_| "invalid invite URL".to_string())?;
    let is_loopback_http =
        url.scheme() == "http" && matches!(url.host_str(), Some("localhost" | "127.0.0.1"));
    if url.scheme() != "https" && !is_loopback_http {
        return Err("invite URL must use HTTPS".to_string());
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("invite URL must not contain credentials, query, or fragment".to_string());
    }
    if !INVITE_PATH_SUFFIXES
        .iter()
        .any(|suffix| url.path().ends_with(suffix))
    {
        return Err("invite URL path is not allowed".to_string());
    }
    Ok(url)
}

/// Send an allowlisted invite request through native networking.
///
/// Packaged WebViews are subject to relay CORS policy. Keeping the request in
/// the trusted Tauri backend avoids widening a relay's browser origins while
/// preserving the exact URL/body used by the frontend's NIP-98 signature.
#[tauri::command]
pub async fn post_invite_http(
    url: String,
    authorization: Option<String>,
    body: String,
) -> Result<InviteHttpResponse, String> {
    let url = validate_invite_url(&url)?;
    if body.len() > MAX_INVITE_REQUEST_BYTES {
        return Err("invite request is too large".to_string());
    }

    let requires_authorization =
        url.path().ends_with("/api/invites") || url.path().ends_with("/api/invites/claim");
    if requires_authorization && authorization.is_none() {
        return Err("invite request authorization is required".to_string());
    }

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(INVITE_REQUEST_TIMEOUT)
        .build()
        .map_err(|error| format!("failed to build invite client: {error}"))?;
    let mut request = client
        .post(url)
        .header(ACCEPT, "application/json")
        .header(CONTENT_TYPE, "application/json")
        .body(body);
    if let Some(value) = authorization {
        let header = HeaderValue::from_str(&value)
            .map_err(|_| "invalid invite authorization header".to_string())?;
        request = request.header(AUTHORIZATION, header);
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("invite request failed: {error}"))?;
    let status = response.status().as_u16();
    let body = read_bounded_json(response).await?;
    Ok(InviteHttpResponse { status, body })
}

async fn read_bounded_json(response: reqwest::Response) -> Result<Value, String> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_INVITE_RESPONSE_BYTES as u64)
    {
        return Err("relay returned an oversized invite response".to_string());
    }

    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("reading invite response failed: {error}"))?;
        if bytes.len().saturating_add(chunk.len()) > MAX_INVITE_RESPONSE_BYTES {
            return Err("relay returned an oversized invite response".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.is_empty() {
        return Ok(Value::Object(Default::default()));
    }
    serde_json::from_slice(&bytes).map_err(|_| "relay returned malformed invite JSON".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_https_and_loopback_invite_routes() {
        assert!(validate_invite_url("https://center.example/api/invites/claim").is_ok());
        assert!(validate_invite_url("http://127.0.0.1:3000/api/invites").is_ok());
        assert!(
            validate_invite_url("http://localhost:3000/base/api/invites/accept-policy").is_ok()
        );
    }

    #[test]
    fn rejects_unsafe_or_unrelated_routes() {
        assert!(validate_invite_url("http://center.example/api/invites/claim").is_err());
        assert!(validate_invite_url("https://user:secret@center.example/api/invites").is_err());
        assert!(validate_invite_url("https://center.example/api/admin").is_err());
        assert!(validate_invite_url("https://center.example/api/invites?code=secret").is_err());
    }
}
