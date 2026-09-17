//! Center-authenticated issuance of short-lived tickets for the separate ASR service.
//!
//! The relay authorizes a small JSON request and signs only the exact audio
//! fingerprint. Audio bytes never pass through this endpoint or Center storage.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    body::Bytes,
    extract::State,
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use jsonwebtoken::{encode, Algorithm, Header};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::state::AppState;

use super::{
    airhop_auth::{authenticate_airhop, ApiResult},
    api_error, internal_error,
};

const PATH: &str = "/api/airhop/v1/transcription-tickets";
const MAX_AUDIO_BYTES: u64 = 10 * 1024 * 1024;
const MAX_DURATION_MS: u64 = 60_000;
const TICKET_TTL_SECONDS: u64 = 60;
const SERVICE_API_VERSION: &str = "1";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TicketRequest {
    request_id: String,
    audio_sha256: String,
    audio_bytes: u64,
    content_type: String,
    language: String,
}

#[derive(Debug, Serialize)]
struct TicketClaims {
    iss: String,
    aud: String,
    environment: String,
    sub: String,
    scope: &'static str,
    iat: u64,
    exp: u64,
    jti: String,
    request_id: String,
    audio_sha256: String,
    audio_bytes: u64,
    content_type: &'static str,
    language: &'static str,
    max_duration_ms: u64,
}

#[derive(Debug, Serialize)]
struct TicketLimits {
    max_audio_bytes: u64,
    max_duration_ms: u64,
    accepted_content_types: [&'static str; 4],
}

#[derive(Debug, Serialize)]
struct TicketResponse {
    upload_url: String,
    token: String,
    expires_at: u64,
    limits: TicketLimits,
    service_api_version: &'static str,
}

/// Prevent browsers and intermediaries from retaining upload credentials.
pub(crate) async fn private_response(mut response: Response) -> Response {
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    response
        .headers_mut()
        .insert(header::PRAGMA, HeaderValue::from_static("no-cache"));
    response.headers_mut().insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    response
}

/// Authorize one current Center member and bind one upload ticket to exact bytes.
pub async fn issue_ticket(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    let principal = authenticate_airhop(&state, &headers, "POST", PATH, Some(&body)).await?;
    let Some(config) = state.config.airhop_transcription.as_ref() else {
        return Err(api_error(StatusCode::NOT_FOUND, "not found"));
    };
    if !matches!(principal.member_role.as_str(), "owner" | "admin" | "member") {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "supported Airhop workspace membership role required",
        ));
    }
    if buzz_core::tenant::relay_url_authority(config.issuer()) != principal.tenant.host() {
        tracing::error!(
            tenant_host = %principal.tenant.host(),
            "transcription ticket issuer does not match the request tenant"
        );
        return Err(api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "transcription ticket issuer is unavailable",
        ));
    }
    let request: TicketRequest = serde_json::from_slice(&body).map_err(|_| {
        api_error(
            StatusCode::BAD_REQUEST,
            "invalid transcription ticket request",
        )
    })?;
    let validated = validate_request(request)?;

    let mut quota_fingerprint = Sha256::new();
    quota_fingerprint.update(b"airhop-transcription-ticket-v1\0");
    quota_fingerprint.update(principal.pubkey.as_bytes());
    let quota_fingerprint: [u8; 32] = quota_fingerprint.finalize().into();
    let quota = state
        .admission_rate_limiter
        .check_scoped_anonymous(
            &principal.tenant,
            "transcription_ticket",
            &quota_fingerprint,
            60,
            config.tickets_per_minute(),
        )
        .await
        .map_err(|error| {
            tracing::warn!(error = %error, "transcription ticket rate limiter unavailable");
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "transcription ticket admission is temporarily unavailable",
            )
        })?;
    if !quota.allowed {
        metrics::counter!("buzz_transcription_ticket_rejections_total", "reason" => "quota")
            .increment(1);
        let retry_after = quota.reset_in_secs.max(1);
        let mut response = (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({
                "error": "transcription ticket quota exceeded",
                "retry_after_seconds": retry_after,
            })),
        )
            .into_response();
        if let Ok(value) = HeaderValue::from_str(&retry_after.to_string()) {
            response.headers_mut().insert(header::RETRY_AFTER, value);
        }
        return Ok(response);
    }

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| internal_error(&format!("system clock before Unix epoch: {error}")))?
        .as_secs();
    let expires_at = now + TICKET_TTL_SECONDS;
    let subject = ticket_subject(&principal);
    let claims = TicketClaims {
        iss: config.issuer().to_owned(),
        aud: config.audience().to_owned(),
        environment: config.environment().to_owned(),
        sub: subject,
        scope: "transcribe",
        iat: now,
        exp: expires_at,
        jti: Uuid::new_v4().to_string(),
        request_id: validated.request_id.to_string(),
        audio_sha256: validated.audio_sha256,
        audio_bytes: validated.audio_bytes,
        content_type: validated.content_type,
        language: "auto",
        max_duration_ms: MAX_DURATION_MS,
    };
    let token = sign_ticket(config.signing_key(), config.key_id(), &claims).map_err(|error| {
        internal_error(&format!("transcription ticket signing failed: {error}"))
    })?;

    metrics::counter!("buzz_transcription_tickets_issued_total").increment(1);
    Ok(Json(TicketResponse {
        upload_url: config.upload_url().to_owned(),
        token,
        expires_at,
        limits: TicketLimits {
            max_audio_bytes: MAX_AUDIO_BYTES,
            max_duration_ms: MAX_DURATION_MS,
            accepted_content_types: ["audio/webm", "audio/ogg", "audio/mp4", "audio/wav"],
        },
        service_api_version: SERVICE_API_VERSION,
    })
    .into_response())
}

fn sign_ticket(
    key: &jsonwebtoken::EncodingKey,
    key_id: &str,
    claims: &TicketClaims,
) -> Result<String, jsonwebtoken::errors::Error> {
    let mut header = Header::new(Algorithm::ES256);
    header.kid = Some(key_id.to_owned());
    encode(&header, claims, key)
}

struct ValidatedRequest {
    request_id: Uuid,
    audio_sha256: String,
    audio_bytes: u64,
    content_type: &'static str,
}

fn validate_request(request: TicketRequest) -> ApiResult<ValidatedRequest> {
    let request_id = Uuid::parse_str(&request.request_id)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "request_id must be a UUID"))?;
    if request.audio_sha256.len() != 64
        || !request
            .audio_sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "audio_sha256 must be 64 lowercase hexadecimal characters",
        ));
    }
    if request.audio_bytes == 0 || request.audio_bytes > MAX_AUDIO_BYTES {
        return Err(api_error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "audio_bytes must be between 1 and 10485760",
        ));
    }
    if request.language != "auto" {
        return Err(api_error(StatusCode::BAD_REQUEST, "language must be auto"));
    }
    let content_type = normalize_content_type(&request.content_type)?;
    Ok(ValidatedRequest {
        request_id,
        audio_sha256: request.audio_sha256,
        audio_bytes: request.audio_bytes,
        content_type,
    })
}

fn normalize_content_type(value: &str) -> ApiResult<&'static str> {
    let mut parts = value.split(';');
    let media_type = parts.next().unwrap_or_default().trim().to_ascii_lowercase();
    let parameter = parts.next().map(str::trim);
    if parts.next().is_some() || parameter.is_some_and(str::is_empty) {
        return Err(unsupported_content_type());
    }
    let canonical = match media_type.as_str() {
        "audio/webm" => "audio/webm",
        "audio/ogg" => "audio/ogg",
        "audio/mp4" => "audio/mp4",
        "audio/wav" | "audio/x-wav" | "audio/wave" | "audio/x-pn-wav" => "audio/wav",
        _ => return Err(unsupported_content_type()),
    };
    if let Some(parameter) = parameter {
        let Some((name, raw_codec)) = parameter.split_once('=') else {
            return Err(unsupported_content_type());
        };
        if !name.trim().eq_ignore_ascii_case("codecs") {
            return Err(unsupported_content_type());
        }
        let codec = raw_codec
            .trim()
            .trim_matches('"')
            .trim()
            .to_ascii_lowercase();
        let accepted = match canonical {
            "audio/webm" | "audio/ogg" => codec == "opus",
            "audio/mp4" => matches!(codec.as_str(), "mp4a.40.2" | "mp4a.40.5" | "mp4a.40.29"),
            "audio/wav" => matches!(codec.as_str(), "1" | "pcm_s16le"),
            _ => false,
        };
        if !accepted || raw_codec.contains(',') {
            return Err(unsupported_content_type());
        }
    }
    Ok(canonical)
}

fn unsupported_content_type() -> (StatusCode, Json<serde_json::Value>) {
    api_error(
        StatusCode::UNSUPPORTED_MEDIA_TYPE,
        "content_type is not a supported audio format",
    )
}

fn ticket_subject(principal: &super::airhop_auth::AirhopPrincipal) -> String {
    let mut digest = Sha256::new();
    digest.update(b"airhop-transcription-subject-v1\0");
    digest.update(principal.tenant.community().to_string().as_bytes());
    digest.update(b"\0");
    digest.update(principal.pubkey.as_bytes());
    hex::encode(digest.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{decode, decode_header, DecodingKey, Validation};

    const PRIVATE_KEY: &[u8] = br#"-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgEULG2DvGCcYnGJnF
kpgS/8qGXAc6vgrpqzGvG6TVJHyhRANCAATv5MOuYOj1fn+wld0ZHtG88njR+8i4
ryjMSf94sKH0iv6LCbz6Mk5j/RHKtAOfjEMYdtNO8G1//4mPlgnTNsqB
-----END PRIVATE KEY-----
"#;
    const PUBLIC_KEY: &[u8] = br#"-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE7+TDrmDo9X5/sJXdGR7RvPJ40fvI
uK8ozEn/eLCh9Ir+iwm8+jJOY/0RyrQDn4xDGHbTTvBtf/+Jj5YJ0zbKgQ==
-----END PUBLIC KEY-----
"#;

    fn request(content_type: &str) -> TicketRequest {
        TicketRequest {
            request_id: "900e953d-9b80-40f4-a5f0-1d480f2d3d10".to_owned(),
            audio_sha256: "ab".repeat(32),
            audio_bytes: 12_345,
            content_type: content_type.to_owned(),
            language: "auto".to_owned(),
        }
    }

    #[test]
    fn request_validation_normalizes_the_signed_mime() {
        assert_eq!(
            validate_request(request("audio/webm; codecs=opus"))
                .expect("valid WebM")
                .content_type,
            "audio/webm"
        );
        assert_eq!(
            validate_request(request("audio/x-wav"))
                .expect("valid WAV alias")
                .content_type,
            "audio/wav"
        );
    }

    #[test]
    fn request_validation_rejects_unbound_or_oversized_inputs() {
        assert!(validate_request(request("audio/webm; codecs=vorbis")).is_err());
        let mut oversized = request("audio/webm");
        oversized.audio_bytes = MAX_AUDIO_BYTES + 1;
        assert!(validate_request(oversized).is_err());
        let mut uppercase_hash = request("audio/webm");
        uppercase_hash.audio_sha256 = "AB".repeat(32);
        assert!(validate_request(uppercase_hash).is_err());
    }

    #[test]
    fn signed_ticket_is_a_standard_es256_jwt_with_a_pinned_kid() {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("valid clock")
            .as_secs();
        let claims = TicketClaims {
            iss: "https://center.example".to_owned(),
            aud: "https://transcribe.example".to_owned(),
            environment: "test".to_owned(),
            sub: "ab".repeat(32),
            scope: "transcribe",
            iat: now,
            exp: now + 60,
            jti: "74e99ef6-2508-48e7-95e4-905e34d79b6c".to_owned(),
            request_id: "900e953d-9b80-40f4-a5f0-1d480f2d3d10".to_owned(),
            audio_sha256: "cd".repeat(32),
            audio_bytes: 12_345,
            content_type: "audio/webm",
            language: "auto",
            max_duration_ms: MAX_DURATION_MS,
        };
        let encoding =
            jsonwebtoken::EncodingKey::from_ec_pem(PRIVATE_KEY).expect("valid test private key");
        let token = sign_ticket(&encoding, "test-key-1", &claims).expect("signed ticket");
        let header = decode_header(&token).expect("valid protected header");
        assert_eq!(header.alg, Algorithm::ES256);
        assert_eq!(header.kid.as_deref(), Some("test-key-1"));
        assert!(header.jku.is_none());
        assert!(header.jwk.is_none());

        let decoding = DecodingKey::from_ec_pem(PUBLIC_KEY).expect("valid test public key");
        let mut validation = Validation::new(Algorithm::ES256);
        validation.set_issuer(&["https://center.example"]);
        validation.set_audience(&["https://transcribe.example"]);
        let decoded = decode::<serde_json::Value>(&token, &decoding, &validation)
            .expect("cross-provider ES256 verification");
        assert_eq!(decoded.claims["request_id"], claims.request_id);
        assert_eq!(decoded.claims["audio_sha256"], claims.audio_sha256);
        assert_eq!(decoded.claims["content_type"], "audio/webm");
    }
}
