//! Owner-authenticated registration and safe reads for the Airhop agent team.

use std::collections::BTreeMap;
use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Json;
use buzz_db::airhop::welcome_agents::{
    AirhopWelcomeRole, AirhopWelcomeTeam, PutWelcomeTeamInput, WelcomeRouteDecision,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::state::AppState;

use super::airhop_auth::authenticate_airhop;
use super::{api_error, internal_error};

const WELCOME_TEAM_PATH: &str = "/api/airhop/agents/v1/welcome-team";
const WELCOME_ROUTE_PREFIX: &str = "/api/airhop/agents/v1/routes";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PutWelcomeTeamBody {
    organization_id: Uuid,
    channel_id: Uuid,
    locale: String,
    members: BTreeMap<AirhopWelcomeRole, String>,
}

/// Registers the exact four-agent manifest. Only the claimed community owner
/// may call this endpoint; DB validation additionally fences organization,
/// private stream, and active bot membership.
pub(crate) async fn put_welcome_team(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let principal =
        authenticate_airhop(&state, &headers, "PUT", WELCOME_TEAM_PATH, Some(&body)).await?;
    require_owner(&principal.member_role)?;
    let request: PutWelcomeTeamBody = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid Airhop Welcome JSON body"))?;
    let members = request
        .members
        .into_iter()
        .map(|(role, pubkey)| parse_pubkey(&pubkey).map(|value| (role, value)))
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    let manifest = state
        .db
        .put_airhop_welcome_team(
            &principal.tenant,
            &PutWelcomeTeamInput {
                organization_id: request.organization_id,
                channel_id: request.channel_id,
                locale: request.locale,
                members,
                registered_by_pubkey: principal.pubkey.to_bytes(),
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(manifest_json(&manifest)))
}

/// Atomically resolves one human Welcome message to one registered product
/// agent. NIP-98 is signed by the calling agent; claimant registration and all
/// tenant/channel/event fences are enforced by the database transaction.
pub(crate) async fn claim_welcome_route(
    State(state): State<Arc<AppState>>,
    Path(event_id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = welcome_route_claim_path(&event_id);
    let principal = authenticate_airhop(&state, &headers, "POST", &path, None).await?;
    let event_id = parse_pubkey(&event_id).map_err(|_| {
        api_error(
            StatusCode::BAD_REQUEST,
            "invalid Airhop Welcome source event id",
        )
    })?;
    let decision = state
        .db
        .claim_airhop_welcome_route(&principal.tenant, event_id, principal.pubkey.to_bytes())
        .await
        .map_err(map_route_db_error)?;
    Ok(Json(route_decision_json(&decision)))
}

fn welcome_route_claim_path(event_id: &str) -> String {
    format!("{WELCOME_ROUTE_PREFIX}/{event_id}/claim")
}

/// Reads the safe manifest for the caller's host-resolved community.
pub(crate) async fn get_welcome_team(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let principal = authenticate_airhop(&state, &headers, "GET", WELCOME_TEAM_PATH, None).await?;
    let manifest = state
        .db
        .get_airhop_welcome_team(&principal.tenant)
        .await
        .map_err(map_db_error)?
        .ok_or_else(|| {
            api_error(
                StatusCode::NOT_FOUND,
                "Airhop Welcome team is not registered",
            )
        })?;
    Ok(Json(manifest_json(&manifest)))
}

fn require_owner(role: &str) -> Result<(), (StatusCode, Json<Value>)> {
    if role == "owner" {
        Ok(())
    } else {
        Err(api_error(
            StatusCode::FORBIDDEN,
            "only the claimed community owner may register Airhop agents",
        ))
    }
}

fn parse_pubkey(value: &str) -> Result<[u8; 32], (StatusCode, Json<Value>)> {
    let bytes = hex::decode(value.trim())
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid Airhop agent pubkey"))?;
    bytes
        .try_into()
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid Airhop agent pubkey"))
}

fn manifest_json(manifest: &AirhopWelcomeTeam) -> Value {
    let members = manifest
        .members
        .iter()
        .map(|(role, pubkey)| (role.as_str().to_owned(), Value::String(hex::encode(pubkey))))
        .collect::<serde_json::Map<_, _>>();
    json!({
        "organizationId": manifest.organization_id,
        "channelId": manifest.channel_id,
        "locale": manifest.locale,
        "members": members,
        "version": manifest.version,
        "updatedAt": manifest.updated_at,
    })
}

fn route_decision_json(decision: &WelcomeRouteDecision) -> Value {
    json!({
        "eventId": hex::encode(decision.event_id),
        "channelId": decision.channel_id,
        "targetRole": decision.target_role.as_str(),
        "targetPubkey": hex::encode(decision.target_pubkey),
        "reason": decision.reason.as_str(),
        "replayed": decision.replayed,
    })
}

fn map_route_db_error(error: buzz_db::DbError) -> (StatusCode, Json<Value>) {
    match error {
        buzz_db::DbError::NotFound(_) => api_error(
            StatusCode::NOT_FOUND,
            "Airhop Welcome source event not found",
        ),
        buzz_db::DbError::AccessDenied(_) => {
            api_error(StatusCode::FORBIDDEN, "Airhop Welcome route claim denied")
        }
        buzz_db::DbError::InvalidData(message) => {
            api_error(StatusCode::UNPROCESSABLE_ENTITY, &message)
        }
        other => internal_error(&format!("Airhop Welcome route claim failed: {other}")),
    }
}

fn map_db_error(error: buzz_db::DbError) -> (StatusCode, Json<Value>) {
    match error {
        buzz_db::DbError::NotFound(_) => {
            api_error(StatusCode::NOT_FOUND, "Airhop Welcome resource not found")
        }
        buzz_db::DbError::AccessDenied(_) => {
            api_error(StatusCode::FORBIDDEN, "Airhop Welcome registration denied")
        }
        buzz_db::DbError::InvalidData(message) => {
            api_error(StatusCode::UNPROCESSABLE_ENTITY, &message)
        }
        other => internal_error(&format!("Airhop Welcome manifest failed: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registration_is_owner_only() {
        assert!(require_owner("owner").is_ok());
        assert!(require_owner("admin").is_err());
        assert!(require_owner("member").is_err());
    }

    #[test]
    fn pubkeys_are_exactly_32_bytes() {
        assert_eq!(parse_pubkey(&"ab".repeat(32)).unwrap(), [0xab; 32]);
        assert!(parse_pubkey(&"ab".repeat(31)).is_err());
        assert!(parse_pubkey("not-hex").is_err());
    }

    #[test]
    fn body_uses_closed_stable_role_keys() {
        let value = json!({
            "organizationId": Uuid::new_v4(),
            "channelId": Uuid::new_v4(),
            "locale": "ru-RU",
            "members": {
                "fizz": "01".repeat(32),
                "administrator": "02".repeat(32),
                "analyst": "03".repeat(32),
                "content_marketer": "04".repeat(32)
            }
        });
        let parsed: PutWelcomeTeamBody = serde_json::from_value(value).unwrap();
        assert_eq!(parsed.members.len(), 4);
    }

    #[test]
    fn welcome_route_claim_path_and_wire_shape_are_stable() {
        let event_id = "ab".repeat(32);
        assert_eq!(
            welcome_route_claim_path(&event_id),
            format!("/api/airhop/agents/v1/routes/{event_id}/claim")
        );
        let decision = WelcomeRouteDecision {
            event_id: [0xab; 32],
            channel_id: Uuid::nil(),
            target_role: AirhopWelcomeRole::Administrator,
            target_pubkey: [0xcd; 32],
            reason: buzz_db::airhop::welcome_agents::WelcomeRouteReason::NaturalRole,
            replayed: true,
        };
        let body = route_decision_json(&decision);
        assert_eq!(body["eventId"], "ab".repeat(32));
        assert_eq!(body["targetRole"], "administrator");
        assert_eq!(body["targetPubkey"], "cd".repeat(32));
        assert_eq!(body["reason"], "natural_role");
        assert_eq!(body["replayed"], true);
    }
}
