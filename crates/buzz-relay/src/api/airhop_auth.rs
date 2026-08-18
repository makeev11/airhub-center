//! Shared NIP-98 and tenant membership authentication for Airhop HTTP APIs.

use std::sync::Arc;

use axum::http::{header, HeaderMap, StatusCode};
use axum::response::Json;
use buzz_core::TenantContext;
use serde_json::Value;

use crate::state::AppState;

use super::{api_error, bridge, internal_error};

/// Transport-neutral authenticated Airhop caller.
#[derive(Debug, Clone)]
pub(crate) struct AirhopPrincipal {
    /// Host-resolved tenant context.
    pub tenant: TenantContext,
    /// Verified NIP-98 signing key.
    pub pubkey: nostr::PublicKey,
    /// Current relay membership role.
    pub member_role: String,
}

/// Common Airhop API result envelope.
pub(crate) type ApiResult<T> = Result<T, (StatusCode, Json<Value>)>;

/// Verifies tenant binding, NIP-98 request integrity, replay, admission, and
/// current relay membership. Endpoint-specific role checks happen afterwards.
pub(crate) async fn authenticate_airhop(
    state: &Arc<AppState>,
    headers: &HeaderMap,
    method: &str,
    path: &str,
    body: Option<&[u8]>,
) -> ApiResult<AirhopPrincipal> {
    let raw_host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let tenant = crate::tenant::bind_community(&state.db, raw_host)
        .await
        .map_err(|_| {
            api_error(
                StatusCode::NOT_FOUND,
                "relay: no community is configured for this host",
            )
        })?;
    let url = bridge::nip98_expected_url(&state.config.relay_url, &tenant, path);
    let (pubkey, event_id) =
        bridge::verify_bridge_auth_with_options(headers, method, &url, body, true, body.is_some())?;
    bridge::check_nip98_replay(state, &tenant, event_id).await?;
    bridge::enforce_http_admission(state, &tenant, &pubkey).await?;
    let member = state
        .db
        .get_relay_member(tenant.community(), &pubkey.to_hex())
        .await
        .map_err(|error| internal_error(&format!("Airhop member lookup failed: {error}")))?
        .ok_or_else(|| {
            api_error(
                StatusCode::FORBIDDEN,
                "Airhop workspace membership required",
            )
        })?;
    Ok(AirhopPrincipal {
        tenant,
        pubkey,
        member_role: member.role,
    })
}
