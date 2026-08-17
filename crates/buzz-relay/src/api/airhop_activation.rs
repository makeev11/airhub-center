//! AirHub Center bootstrap activation boundary.
//!
//! Grant issue/revoke lives on the deployment operator plane. This module owns
//! the unauthenticated one-time claim and the activated installation's signed,
//! customer-data-free status projection, plus shared code/digest primitives.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{ConnectInfo, Query, RawQuery, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use buzz_db::airhop::center_activation::{CenterEnvironment, ClaimCenterActivationGrantInput};
use hmac::digest::KeyInit;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::state::AppState;

use super::{api_error, bridge, internal_error};

type HmacSha256 = Hmac<Sha256>;

pub(crate) const IDEMPOTENCY_HEADER: &str = "idempotency-key";
const ACTIVATION_CODE_PREFIX: &str = "ahc_1_";
const ACTIVATION_CODE_BYTES: usize = 32;
const CLAIM_RATE_NAMESPACE: &str = "airhop_center_activation_claim_ip";
const CLAIM_RATE_LIMIT_PER_MINUTE: u64 = 20;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClaimActivationRequest {
    installation_id: Uuid,
    activation_code: String,
    installation_pubkey: String,
    environment: String,
    release_profile: String,
    release_version: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClaimActivationResponse {
    installation_id: Uuid,
    organization_id: Uuid,
    activation_version: i64,
    status: &'static str,
    replayed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
/// Query selecting one activated Center installation.
pub struct InstallationStatusQuery {
    installation_id: Uuid,
}

/// Consume a one-time activation grant and bind the installation's Nostr key.
pub async fn claim_activation_grant(
    State(state): State<Arc<AppState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let tenant = bind_activation_tenant(&state, &headers).await?;
    enforce_claim_rate_limit(&state, &tenant, peer, &headers).await?;
    let idempotency_key = require_idempotency_key(&headers)?;
    let request: ClaimActivationRequest = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid activation claim JSON"))?;
    if request.installation_id.is_nil() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "installationId must be a non-zero UUID",
        ));
    }
    let environment = CenterEnvironment::parse(request.environment.trim()).ok_or_else(|| {
        api_error(
            StatusCode::BAD_REQUEST,
            "environment must be production, staging, or development",
        )
    })?;
    let installation_pubkey = nostr::PublicKey::from_hex(request.installation_pubkey.trim())
        .map_err(|_| {
            api_error(
                StatusCode::BAD_REQUEST,
                "installationPubkey must be a 64-character hex Nostr public key",
            )
        })?;
    let key = activation_key(&state);
    let code_digest =
        activation_code_digest(&key, tenant.community().as_uuid(), &request.activation_code)?;
    let claim_idempotency_digest = scoped_digest(
        &key,
        b"airhop.center.activation-claim-idempotency.v1",
        tenant.community().as_uuid(),
        &[
            request.installation_id.as_bytes(),
            installation_pubkey.as_bytes(),
            idempotency_key.as_bytes(),
        ],
    )?;
    let request_hash: [u8; 32] = Sha256::digest(&body).into();
    let outcome = state
        .db
        .claim_airhop_center_activation_grant(
            &tenant,
            &ClaimCenterActivationGrantInput {
                installation_id: request.installation_id,
                code_digest,
                installation_pubkey: installation_pubkey.to_bytes(),
                environment,
                release_profile: request.release_profile,
                release_version: request.release_version,
                claim_idempotency_digest,
                claim_request_hash: request_hash,
            },
        )
        .await
        .map_err(map_claim_error)?;
    let mut response = (
        if outcome.replayed {
            StatusCode::OK
        } else {
            StatusCode::CREATED
        },
        Json(ClaimActivationResponse {
            installation_id: outcome.installation_id,
            organization_id: outcome.organization_id,
            activation_version: outcome.activation_version,
            status: outcome.status.as_str(),
            replayed: outcome.replayed,
        }),
    )
        .into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

/// Return a safe status projection to the activated installation identity.
pub async fn get_installation_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    RawQuery(raw_query): RawQuery,
    Query(query): Query<InstallationStatusQuery>,
) -> Result<Response, (StatusCode, Json<Value>)> {
    if query.installation_id.is_nil() {
        return Err(api_error(StatusCode::BAD_REQUEST, "invalid installationId"));
    }
    let tenant = bind_activation_tenant(&state, &headers).await?;
    let path = match raw_query.as_deref() {
        Some(raw) if !raw.is_empty() => {
            format!("/api/airhop/activation/v1/status?{raw}")
        }
        _ => "/api/airhop/activation/v1/status".to_owned(),
    };
    let expected_url = bridge::nip98_expected_url(&state.config.relay_url, &tenant, &path);
    let (pubkey, event_id) =
        bridge::verify_bridge_auth_with_options(&headers, "GET", &expected_url, None, true, false)?;
    bridge::check_nip98_replay(&state, &tenant, event_id).await?;
    bridge::enforce_http_admission(&state, &tenant, &pubkey).await?;
    let installation = state
        .db
        .get_airhop_center_installation_for_identity(
            &tenant,
            query.installation_id,
            &pubkey.to_bytes(),
        )
        .await
        .map_err(|error| {
            tracing::error!(error = %error, "AirHub Center installation status read failed");
            internal_error("installation status read failed")
        })?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "installation not found"))?;
    let mut response = Json(json!({
        "installationId": installation.id,
        "organizationId": installation.organization_id,
        "environment": installation.environment,
        "releaseProfile": installation.release_profile,
        "releaseVersion": installation.release_version,
        "status": installation.status.as_str(),
        "activationVersion": installation.activation_version,
        "activatedAt": installation.activated_at,
        "lastVerifiedAt": installation.last_verified_at,
        "errorCode": installation.sanitized_error_code,
    }))
    .into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

pub(crate) fn generate_activation_code() -> String {
    let material: [u8; ACTIVATION_CODE_BYTES] = rand::random();
    format!(
        "{ACTIVATION_CODE_PREFIX}{}",
        URL_SAFE_NO_PAD.encode(material)
    )
}

pub(crate) fn activation_key(state: &AppState) -> [u8; 32] {
    let root = crate::invite_token::derive_invite_key(&state.relay_keypair);
    let mut hasher = Sha256::new();
    hasher.update(root);
    hasher.update(b"airhop-center-activation-key-v1");
    hasher.finalize().into()
}

pub(crate) fn activation_code_digest(
    key: &[u8; 32],
    community_id: &Uuid,
    code: &str,
) -> Result<[u8; 32], (StatusCode, Json<Value>)> {
    validate_activation_code(code)?;
    scoped_digest(
        key,
        b"airhop.center.activation-code-digest.v1",
        community_id,
        &[code.as_bytes()],
    )
}

pub(crate) fn scoped_digest(
    key: &[u8; 32],
    domain: &[u8],
    community_id: &Uuid,
    components: &[&[u8]],
) -> Result<[u8; 32], (StatusCode, Json<Value>)> {
    let mut mac = <HmacSha256 as KeyInit>::new_from_slice(key)
        .map_err(|_| internal_error("activation digest key is invalid"))?;
    for component in [domain, community_id.as_bytes().as_slice()]
        .into_iter()
        .chain(components.iter().copied())
    {
        mac.update(&(component.len() as u64).to_be_bytes());
        mac.update(component);
    }
    Ok(mac.finalize().into_bytes().into())
}

pub(crate) fn require_idempotency_key(
    headers: &HeaderMap,
) -> Result<&str, (StatusCode, Json<Value>)> {
    let mut values = headers.get_all(IDEMPOTENCY_HEADER).iter();
    values
        .next()
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| {
            values.next().is_none()
                && (16..=200).contains(&value.len())
                && value.bytes().all(|byte| byte.is_ascii_graphic())
        })
        .ok_or_else(|| {
            api_error(
                StatusCode::BAD_REQUEST,
                "a valid 16-200 byte Idempotency-Key header is required",
            )
        })
}

async fn bind_activation_tenant(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<buzz_core::TenantContext, (StatusCode, Json<Value>)> {
    let raw_host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    crate::tenant::bind_community(&state.db, raw_host)
        .await
        .map_err(|_| api_error(StatusCode::NOT_FOUND, "activation surface not found"))
}

async fn enforce_claim_rate_limit(
    state: &AppState,
    tenant: &buzz_core::TenantContext,
    peer: SocketAddr,
    _headers: &HeaderMap,
) -> Result<(), (StatusCode, Json<Value>)> {
    let key = activation_key(state);
    let peer_ip = peer.ip().to_string();
    let digest = scoped_digest(
        &key,
        b"airhop.center.activation-claim-ip.v1",
        tenant.community().as_uuid(),
        &[peer_ip.as_bytes()],
    )?;
    let outcome = state
        .admission_rate_limiter
        .check_scoped_anonymous(
            tenant,
            CLAIM_RATE_NAMESPACE,
            &digest,
            60,
            CLAIM_RATE_LIMIT_PER_MINUTE,
        )
        .await
        .map_err(|error| {
            tracing::warn!(error = %error, "activation claim rate limiter unavailable");
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "activation temporarily unavailable",
            )
        })?;
    if outcome.allowed {
        Ok(())
    } else {
        Err(api_error(
            StatusCode::TOO_MANY_REQUESTS,
            "activation claim rate limit exceeded",
        ))
    }
}

fn validate_activation_code(code: &str) -> Result<(), (StatusCode, Json<Value>)> {
    let encoded = code
        .strip_prefix(ACTIVATION_CODE_PREFIX)
        .ok_or_else(invalid_activation_code)?;
    let material = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| invalid_activation_code())?;
    if material.len() != ACTIVATION_CODE_BYTES
        || URL_SAFE_NO_PAD.encode(&material) != encoded
        || code.trim() != code
    {
        return Err(invalid_activation_code());
    }
    Ok(())
}

fn invalid_activation_code() -> (StatusCode, Json<Value>) {
    api_error(
        StatusCode::UNAUTHORIZED,
        "activation grant is invalid or unavailable",
    )
}

fn map_claim_error(error: buzz_db::DbError) -> (StatusCode, Json<Value>) {
    match error {
        buzz_db::DbError::AirhopActivationInvalid => invalid_activation_code(),
        buzz_db::DbError::AirhopActivationConflict => api_error(
            StatusCode::CONFLICT,
            "installation activation state conflicts with this claim",
        ),
        buzz_db::DbError::AirhopIdempotencyConflict => api_error(
            StatusCode::CONFLICT,
            "Idempotency-Key was already used for a different activation claim",
        ),
        buzz_db::DbError::InvalidData(_) => {
            api_error(StatusCode::BAD_REQUEST, "invalid activation claim")
        }
        internal => {
            tracing::error!(error = %internal, "AirHub Center activation claim failed");
            internal_error("activation claim failed")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_activation_codes_are_canonical_and_high_entropy_width() {
        let code = generate_activation_code();
        assert!(validate_activation_code(&code).is_ok());
        assert_eq!(code.len(), ACTIVATION_CODE_PREFIX.len() + 43);
    }

    #[test]
    fn activation_code_parser_rejects_wrong_prefix_padding_and_whitespace() {
        let code = generate_activation_code();
        assert!(validate_activation_code(&format!(" {code}")).is_err());
        assert!(validate_activation_code(&code.replace(ACTIVATION_CODE_PREFIX, "hq_1_")).is_err());
        assert!(validate_activation_code(&format!("{code}=")).is_err());
    }

    #[test]
    fn activation_digest_is_tenant_scoped() {
        let key = [7; 32];
        let code = generate_activation_code();
        let first = activation_code_digest(&key, &Uuid::from_u128(1), &code);
        let second = activation_code_digest(&key, &Uuid::from_u128(2), &code);
        assert!(first.is_ok());
        assert!(second.is_ok());
        assert_ne!(first.ok(), second.ok());
    }

    #[test]
    fn claim_contract_requires_the_complete_deployment_binding() {
        let body = json!({
            "installationId": Uuid::new_v4(),
            "activationCode": generate_activation_code(),
            "installationPubkey": "11".repeat(32),
            "environment": "production",
            "releaseProfile": "site_telegram_center",
            "releaseVersion": "2026.08.17"
        });
        assert!(serde_json::from_value::<ClaimActivationRequest>(body.clone()).is_ok());

        let mut missing_profile = body;
        missing_profile
            .as_object_mut()
            .expect("claim fixture is an object")
            .remove("releaseProfile");
        assert!(serde_json::from_value::<ClaimActivationRequest>(missing_profile).is_err());
    }
}
