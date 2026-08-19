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
    let (tenant, pubkey) = authenticate_airhop_identity(state, headers, method, path, body).await?;
    let member_role = direct_member_role(state, &tenant, &pubkey)
        .await?
        .ok_or_else(workspace_membership_required)?;
    Ok(AirhopPrincipal {
        tenant,
        pubkey,
        member_role,
    })
}

/// Agent-only Airhop endpoints also accept an owner's cryptographic NIP-OA
/// delegation. This stays separate from `authenticate_airhop`: generic staff
/// APIs must not become reachable to a delegated agent and bypass preview/✅.
pub(crate) async fn authenticate_airhop_agent(
    state: &Arc<AppState>,
    headers: &HeaderMap,
    method: &str,
    path: &str,
    body: Option<&[u8]>,
) -> ApiResult<AirhopPrincipal> {
    let (tenant, pubkey) = authenticate_airhop_identity(state, headers, method, path, body).await?;
    let member_role = match direct_member_role(state, &tenant, &pubkey).await? {
        Some(role) => role,
        None => {
            let auth_tag = headers
                .get("x-auth-tag")
                .and_then(|value| value.to_str().ok());
            let owner = state
                .config
                .allow_nip_oa_auth
                .then(|| super::relay_members::extract_nip_oa_owner(pubkey.as_bytes(), auth_tag))
                .flatten()
                .ok_or_else(workspace_membership_required)?;
            if direct_member_role(state, &tenant, &owner).await?.is_none() {
                return Err(workspace_membership_required());
            }
            super::relay_members::materialize_nip_oa_owner(state, &tenant, &pubkey, &owner).await;
            "agent".to_owned()
        }
    };
    Ok(AirhopPrincipal {
        tenant,
        pubkey,
        member_role,
    })
}

async fn authenticate_airhop_identity(
    state: &Arc<AppState>,
    headers: &HeaderMap,
    method: &str,
    path: &str,
    body: Option<&[u8]>,
) -> ApiResult<(TenantContext, nostr::PublicKey)> {
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
    Ok((tenant, pubkey))
}

async fn direct_member_role(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    pubkey: &nostr::PublicKey,
) -> ApiResult<Option<String>> {
    state
        .db
        .get_relay_member(tenant.community(), &pubkey.to_hex())
        .await
        .map(|member| member.map(|value| value.role))
        .map_err(|error| internal_error(&format!("Airhop member lookup failed: {error}")))
}

fn workspace_membership_required() -> (StatusCode, Json<Value>) {
    api_error(
        StatusCode::FORBIDDEN,
        "Airhop workspace membership required",
    )
}
