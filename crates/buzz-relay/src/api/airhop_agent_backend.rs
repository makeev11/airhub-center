//! Server-authorized product backend for internal AirHop agents and Hermes.

use std::collections::BTreeSet;
use std::sync::Arc;

use airhop_core::{BookingStatus, PublicBookingPurpose};
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Json;
use base64::Engine as _;
use buzz_db::airhop::agent_runtime::{
    FinishHermesTurn, LeaseParentAgentTurnInput, ParentAgentDeployment,
    PutParentAgentDeploymentInput, ValidateParentAgentTurnLeaseInput,
};
use buzz_db::airhop::external_conversation::{
    is_hermes_handoff_event, CommitHermesReplyInput, ExternalConversation,
    RegisterExternalConversationInput,
};
use buzz_db::airhop::family_detail::StaffFamilyDetail;
use buzz_db::airhop::knowledge::ParentKnowledgeScope;
use buzz_db::airhop::public_management::{AgentFamilyManagementCommand, PublicManagementAction};
use buzz_db::airhop::public_read::{PublicBookingAgeFilter, PublicBookingOccurrenceFilters};
use chrono::{DateTime, Duration, Utc};
use nostr::{Event, EventBuilder, Kind, PublicKey, Tag};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::state::AppState;

use super::airhop_auth::{authenticate_airhop, authenticate_airhop_agent, AirhopPrincipal};
use super::{api_error, internal_error};

const CONTEXT_GRANT_PATH: &str = "/api/airhop/agents/v1/context-grants";
const BACKEND_PATH: &str = "/api/airhop/agents/v1/backend";
const DEPLOYMENT_PATH_PREFIX: &str = "/api/airhop/agents/v1/deployments";
const TURN_PATH_PREFIX: &str = "/api/airhop/agents/v1/turns";
const CONVERSATION_PATH_PREFIX: &str = "/api/airhop/agents/v1/conversations";
const SUPERVISOR_EVENT_PATH_PREFIX: &str = "/api/airhop/agents/v1/supervisor/events";
const CONTEXT_HEADER: &str = "x-airhop-agent-context";
const CONTEXT_SCHEMA: &str = "airhop.agent.context.v1";
const READ_SCHEMA: &str = "airhop.agent.read.v1";
const ACTION_SCHEMA: &str = "airhop.agent.action-receipt.v1";
const MAX_GRANT_TTL_SECONDS: i64 = 15 * 60;
const DEFAULT_GRANT_TTL_SECONDS: u32 = 5 * 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum AgentBackendRole {
    Fizz,
    Administrator,
    Analyst,
    ContentMarketer,
    ParentAdministrator,
}

impl AgentBackendRole {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Fizz => "fizz",
            Self::Administrator => "administrator",
            Self::Analyst => "analyst",
            Self::ContentMarketer => "content_marketer",
            Self::ParentAdministrator => "parent_administrator",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum AgentCapability {
    ReadOrganizationPublic,
    ReadFamily,
    ListBookingOptions,
    SearchKnowledge,
    ManageBooking,
}

impl AgentCapability {
    const fn as_str(self) -> &'static str {
        match self {
            Self::ReadOrganizationPublic => "read_organization_public",
            Self::ReadFamily => "read_family",
            Self::ListBookingOptions => "list_booking_options",
            Self::SearchKnowledge => "search_knowledge",
            Self::ManageBooking => "manage_booking",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IssueContextGrantBody {
    deployment_id: Uuid,
    channel_id: Uuid,
    conversation_id: Uuid,
    family_id: Option<Uuid>,
    representative_id: Option<Uuid>,
    cycle_id: Uuid,
    input_batch_id: Uuid,
    source_message_id: String,
    #[serde(default = "default_turn_lease_seconds")]
    lease_seconds: u32,
    #[serde(default = "default_grant_ttl_seconds")]
    ttl_seconds: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ClaimParentEventBody {
    input_batch_id: Uuid,
    #[serde(default)]
    source_event_ids: Vec<String>,
    #[serde(default = "default_turn_lease_seconds")]
    lease_seconds: u32,
    #[serde(default = "default_grant_ttl_seconds")]
    ttl_seconds: u32,
}

const fn default_grant_ttl_seconds() -> u32 {
    DEFAULT_GRANT_TTL_SECONDS
}

const fn default_turn_lease_seconds() -> u32 {
    10 * 60
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PutDeploymentBody {
    agent_pubkey: String,
    #[serde(default = "default_blueprint_version")]
    blueprint_version: i64,
    profile_ref: String,
    runtime_revision: String,
    persona_revision: String,
    skills_revision: String,
    model_revision: String,
    #[serde(default = "default_true")]
    enabled: bool,
    #[serde(default)]
    paused: bool,
    #[serde(default = "default_true")]
    manage_bookings: bool,
    expected_version: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RegisterConversationBody {
    channel_id: Uuid,
    family_id: Option<Uuid>,
    representative_id: Option<Uuid>,
    parent_pubkey: String,
    cycle_id: Uuid,
    expected_version: i64,
}

const fn default_blueprint_version() -> i64 {
    1
}

const fn default_true() -> bool {
    true
}

/// Binds one private Buzz channel to the parent identity that Hermes may serve.
pub(crate) async fn register_conversation(
    State(state): State<Arc<AppState>>,
    Path(conversation_id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("{CONVERSATION_PATH_PREFIX}/{conversation_id}");
    let principal = authenticate_airhop(&state, &headers, "PUT", &path, Some(&body)).await?;
    if principal.member_role != "owner" && principal.member_role != "admin" {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "AirHop external conversation registration requires owner or admin access",
        ));
    }
    let request: RegisterConversationBody = serde_json::from_slice(&body).map_err(|_| {
        api_error(
            StatusCode::BAD_REQUEST,
            "invalid external conversation JSON",
        )
    })?;
    let parent_pubkey = PublicKey::from_hex(request.parent_pubkey.trim())
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid parent public key"))?;
    let conversation = state
        .db
        .register_airhop_external_conversation(
            &principal.tenant,
            &RegisterExternalConversationInput {
                conversation_id,
                channel_id: request.channel_id,
                family_id: request.family_id,
                representative_id: request.representative_id,
                parent_pubkey: parent_pubkey.to_bytes(),
                cycle_id: request.cycle_id,
                expected_version: request.expected_version,
                opened_by_pubkey: principal.pubkey.to_bytes(),
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(external_conversation_json(&conversation)))
}

#[derive(Debug, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum FinishTurnBody {
    Completed {
        #[serde(rename = "leaseToken")]
        lease_token: Uuid,
        outcome: String,
    },
    Failed {
        #[serde(rename = "leaseToken")]
        lease_token: Uuid,
        #[serde(rename = "errorCode")]
        error_code: String,
    },
    Cancelled {
        #[serde(rename = "leaseToken")]
        lease_token: Uuid,
        #[serde(rename = "errorCode")]
        error_code: String,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CommitReplyBody {
    lease_token: Uuid,
    events: Vec<Event>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentContextClaims {
    schema_version: String,
    tenant_id: Uuid,
    organization_id: Uuid,
    deployment_id: Uuid,
    deployment_version: i64,
    role: AgentBackendRole,
    agent_pubkey: String,
    channel_id: Uuid,
    conversation_id: Uuid,
    family_id: Option<Uuid>,
    representative_id: Option<Uuid>,
    cycle_id: Uuid,
    input_batch_id: Uuid,
    source_message_id: String,
    turn_id: Uuid,
    turn_lease_token: Uuid,
    capabilities: BTreeSet<AgentCapability>,
    issued_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
}

#[derive(Debug)]
struct ResolvedAgentContext {
    principal: AirhopPrincipal,
    claims: AgentContextClaims,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum AgentBackendRequest {
    GetTurnContext,
    GetFamily,
    ListBookingOptions {
        branch_id: Option<Uuid>,
        group_id: Option<Uuid>,
        purpose: Option<BookingPurpose>,
        age_years: Option<u8>,
    },
    SearchKnowledge {
        query: String,
        locale: Option<String>,
        #[serde(default = "default_knowledge_limit")]
        limit: u8,
    },
    ManageBooking {
        booking_id: Uuid,
        action: ParentBookingAction,
    },
}

impl AgentBackendRequest {
    const fn read_operation(&self) -> Option<&'static str> {
        match self {
            Self::GetTurnContext => Some("get_turn_context"),
            Self::GetFamily => Some("get_family"),
            Self::ListBookingOptions { .. } => Some("list_booking_options"),
            Self::SearchKnowledge { .. } => Some("search_knowledge"),
            Self::ManageBooking { .. } => None,
        }
    }
}

const fn default_knowledge_limit() -> u8 {
    8
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum BookingPurpose {
    Trial,
    Lesson,
}

impl From<BookingPurpose> for PublicBookingPurpose {
    fn from(value: BookingPurpose) -> Self {
        match value {
            BookingPurpose::Trial => Self::Trial,
            BookingPurpose::Lesson => Self::Lesson,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum ParentBookingAction {
    Cancel,
    RequestTransfer { comment: Option<String> },
}

/// Creates or updates organization-scoped desired state for external Hermes.
pub(crate) async fn put_deployment(
    State(state): State<Arc<AppState>>,
    Path(deployment_id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("{DEPLOYMENT_PATH_PREFIX}/{deployment_id}");
    let principal = authenticate_airhop(&state, &headers, "PUT", &path, Some(&body)).await?;
    if principal.member_role != "owner" && principal.member_role != "admin" {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "AirHop Hermes deployment requires owner or admin access",
        ));
    }
    let request: PutDeploymentBody = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid Hermes deployment JSON"))?;
    let agent_pubkey = PublicKey::from_hex(request.agent_pubkey.trim())
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid Hermes agent public key"))?;
    let deployment = state
        .db
        .put_airhop_parent_agent_deployment(
            &principal.tenant,
            &PutParentAgentDeploymentInput {
                deployment_id,
                agent_pubkey: agent_pubkey.to_bytes(),
                blueprint_version: request.blueprint_version,
                profile_ref: request.profile_ref,
                runtime_revision: request.runtime_revision,
                persona_revision: request.persona_revision,
                skills_revision: request.skills_revision,
                model_revision: request.model_revision,
                enabled: request.enabled,
                paused: request.paused,
                manage_bookings: request.manage_bookings,
                expected_version: request.expected_version,
                registered_by_pubkey: principal.pubkey.to_bytes(),
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(deployment_json(&deployment)))
}

/// Reads one safe deployment view for the control-plane settings page.
pub(crate) async fn get_deployment(
    State(state): State<Arc<AppState>>,
    Path(deployment_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("{DEPLOYMENT_PATH_PREFIX}/{deployment_id}");
    let principal = authenticate_airhop(&state, &headers, "GET", &path, None).await?;
    let deployment = state
        .db
        .get_airhop_parent_agent_deployment(&principal.tenant, deployment_id)
        .await
        .map_err(map_db_error)?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "Hermes deployment not found"))?;
    Ok(Json(deployment_json(&deployment)))
}

/// Discovers the organization's sole parent-administrator deployment.
pub(crate) async fn get_current_deployment(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let principal =
        authenticate_airhop(&state, &headers, "GET", DEPLOYMENT_PATH_PREFIX, None).await?;
    let deployment = state
        .db
        .get_current_airhop_parent_agent_deployment(&principal.tenant)
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "schemaVersion": "airhop.agent.deployments.v1",
        "deployment": deployment.as_ref().map(deployment_json),
    })))
}

/// Records the terminal outcome for the exact runtime-owned lease.
pub(crate) async fn finish_turn(
    State(state): State<Arc<AppState>>,
    Path(turn_id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("{TURN_PATH_PREFIX}/{turn_id}/finish");
    let principal = authenticate_airhop_agent(&state, &headers, "POST", &path, Some(&body)).await?;
    let request: FinishTurnBody = serde_json::from_slice(&body).map_err(|_| {
        api_error(
            StatusCode::BAD_REQUEST,
            "invalid Hermes turn completion JSON",
        )
    })?;
    let (lease_token, completion) = match request {
        FinishTurnBody::Completed {
            lease_token,
            outcome,
        } => (lease_token, FinishHermesTurn::Completed { outcome }),
        FinishTurnBody::Failed {
            lease_token,
            error_code,
        } => (lease_token, FinishHermesTurn::Failed { error_code }),
        FinishTurnBody::Cancelled {
            lease_token,
            error_code,
        } => (lease_token, FinishHermesTurn::Cancelled { error_code }),
    };
    let receipt = state
        .db
        .finish_airhop_parent_agent_turn(
            &principal.tenant,
            turn_id,
            lease_token,
            principal.pubkey.to_bytes(),
            &completion,
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "schemaVersion": "airhop.hermes.turn-receipt.v1",
        "turnId": receipt.id,
        "status": receipt.status,
        "attempt": receipt.attempt,
        "replayed": receipt.replayed,
    })))
}

/// Commits the final-send fence, then publishes the signed events through the
/// ordinary Buzz ingestion path. A retry is safe after any partial network loss.
pub(crate) async fn commit_reply(
    State(state): State<Arc<AppState>>,
    Path(turn_id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("{TURN_PATH_PREFIX}/{turn_id}/reply");
    let principal = authenticate_airhop_agent(&state, &headers, "POST", &path, Some(&body)).await?;
    let request: CommitReplyBody = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid Hermes reply JSON"))?;
    let intents = state
        .db
        .commit_airhop_hermes_reply(
            &principal.tenant,
            &CommitHermesReplyInput {
                turn_id,
                lease_token: request.lease_token,
                agent_pubkey: principal.pubkey.to_bytes(),
                outcome: if request.events.last().is_some_and(is_hermes_handoff_event) {
                    "human_handoff"
                } else {
                    "waiting_parent"
                }
                .to_owned(),
                events: request.events.clone(),
            },
        )
        .await
        .map_err(map_db_error)?;

    let mut published = Vec::with_capacity(request.events.len());
    for event in request.events {
        let result = crate::handlers::ingest::ingest_event(
            &state,
            &principal.tenant,
            event,
            crate::handlers::ingest::IngestAuth::Http {
                pubkey: principal.pubkey,
                scopes: vec![buzz_auth::Scope::MessagesWrite],
                auth_method: crate::handlers::ingest::HttpAuthMethod::Nip98,
            },
        )
        .await
        .map_err(map_ingest_error)?;
        published.push(json!({
            "eventId": result.event_id,
            "accepted": result.accepted,
            "message": result.message,
        }));
    }
    Ok(Json(json!({
        "schemaVersion": "airhop.hermes.reply.v1",
        "turnId": turn_id,
        "status": "completed",
        "intents": intents,
        "published": published,
    })))
}

/// Issues a short-lived, relay-signed Family/conversation context to one agent.
pub(crate) async fn issue_context_grant(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let issuer =
        authenticate_airhop(&state, &headers, "POST", CONTEXT_GRANT_PATH, Some(&body)).await?;
    if issuer.member_role != "owner" && issuer.member_role != "admin" {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "AirHop agent contexts require owner or admin access",
        ));
    }
    let request: IssueContextGrantBody = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid AirHop agent context JSON"))?;
    validate_issue_request(&request)?;
    let source_id = parse_event_id(&request.source_message_id)?;
    let leased = state
        .db
        .lease_airhop_parent_agent_turn(
            &issuer.tenant,
            &LeaseParentAgentTurnInput {
                deployment_id: request.deployment_id,
                channel_id: request.channel_id,
                conversation_id: request.conversation_id,
                cycle_id: request.cycle_id,
                input_batch_id: request.input_batch_id,
                source_message_id: source_id,
                family_id: request.family_id,
                representative_id: request.representative_id,
                lease_seconds: i64::from(request.lease_seconds),
            },
        )
        .await
        .map_err(map_db_error)?;
    let agent_pubkey = PublicKey::from_slice(&leased.deployment.agent_pubkey).map_err(|error| {
        internal_error(&format!("persisted Hermes principal is invalid: {error}"))
    })?;
    let capabilities = parent_capabilities(
        request.family_id.is_some(),
        leased.deployment.manage_bookings,
    );
    let issued_at = Utc::now();
    let requested_expiry = issued_at + Duration::seconds(i64::from(request.ttl_seconds));
    let expires_at = requested_expiry.min(leased.turn.lease_expires_at);
    let claims = AgentContextClaims {
        schema_version: CONTEXT_SCHEMA.to_owned(),
        tenant_id: *issuer.tenant.community().as_uuid(),
        organization_id: leased.deployment.organization_id,
        deployment_id: leased.deployment.id,
        deployment_version: leased.deployment.version,
        role: AgentBackendRole::ParentAdministrator,
        agent_pubkey: agent_pubkey.to_hex(),
        channel_id: leased.turn.channel_id,
        conversation_id: leased.turn.conversation_id,
        family_id: leased.turn.family_id,
        representative_id: leased.turn.representative_id,
        cycle_id: leased.turn.cycle_id,
        input_batch_id: leased.turn.input_batch_id,
        source_message_id: request.source_message_id.to_ascii_lowercase(),
        turn_id: leased.turn.id,
        turn_lease_token: leased.turn.lease_token,
        capabilities,
        issued_at,
        expires_at,
    };
    let token = encode_context_grant(&state, &claims, agent_pubkey)?;
    Ok(Json(json!({
        "schemaVersion": CONTEXT_SCHEMA,
        "token": token,
        "expiresAt": expires_at,
        "turn": {
            "id": leased.turn.id,
            "leaseToken": leased.turn.lease_token,
            "leaseExpiresAt": leased.turn.lease_expires_at,
            "attempt": leased.turn.attempt,
            "replayed": leased.turn.replayed,
        },
        "context": context_summary(&claims),
    })))
}

/// Claims one atomically projected parent event for the exact hosted Hermes
/// deployment. All conversation and Family identifiers are server-derived.
pub(crate) async fn claim_parent_event(
    State(state): State<Arc<AppState>>,
    Path(event_id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("{SUPERVISOR_EVENT_PATH_PREFIX}/{event_id}/claim");
    let principal = authenticate_airhop_agent(&state, &headers, "POST", &path, Some(&body)).await?;
    let request: ClaimParentEventBody = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid Hermes event claim JSON"))?;
    if request.input_batch_id.is_nil()
        || !(60..=15 * 60).contains(&request.lease_seconds)
        || request.ttl_seconds == 0
        || i64::from(request.ttl_seconds) > MAX_GRANT_TTL_SECONDS
        || request.source_event_ids.len() > 500
    {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid Hermes event claim bounds",
        ));
    }
    let source_message_id = parse_event_id(&event_id)?;
    let source_event_ids = if request.source_event_ids.is_empty() {
        vec![source_message_id]
    } else {
        let ids = request
            .source_event_ids
            .iter()
            .map(|value| parse_event_id(value))
            .collect::<Result<Vec<_>, _>>()?;
        if ids.first() != Some(&source_message_id) {
            return Err(api_error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Hermes batch anchor mismatch",
            ));
        }
        ids
    };
    let route = state
        .db
        .get_airhop_hermes_parent_batch_route(
            &principal.tenant,
            &source_event_ids,
            principal.pubkey.to_bytes(),
        )
        .await
        .map_err(map_db_error)?
        .ok_or_else(|| {
            api_error(
                StatusCode::CONFLICT,
                "parent event is no longer owned by Hermes",
            )
        })?;
    let leased = state
        .db
        .lease_airhop_parent_agent_turn(
            &principal.tenant,
            &LeaseParentAgentTurnInput {
                deployment_id: route.deployment_id,
                channel_id: route.channel_id,
                conversation_id: route.conversation_id,
                cycle_id: route.cycle_id,
                input_batch_id: request.input_batch_id,
                source_message_id: route.source_message_id,
                family_id: route.family_id,
                representative_id: route.representative_id,
                lease_seconds: i64::from(request.lease_seconds),
            },
        )
        .await
        .map_err(map_db_error)?;
    let agent_pubkey = PublicKey::from_slice(&leased.deployment.agent_pubkey).map_err(|error| {
        internal_error(&format!("persisted Hermes principal is invalid: {error}"))
    })?;
    let issued_at = Utc::now();
    let expires_at = (issued_at + Duration::seconds(i64::from(request.ttl_seconds)))
        .min(leased.turn.lease_expires_at);
    let claims = AgentContextClaims {
        schema_version: CONTEXT_SCHEMA.to_owned(),
        tenant_id: *principal.tenant.community().as_uuid(),
        organization_id: leased.deployment.organization_id,
        deployment_id: leased.deployment.id,
        deployment_version: leased.deployment.version,
        role: AgentBackendRole::ParentAdministrator,
        agent_pubkey: agent_pubkey.to_hex(),
        channel_id: leased.turn.channel_id,
        conversation_id: leased.turn.conversation_id,
        family_id: leased.turn.family_id,
        representative_id: leased.turn.representative_id,
        cycle_id: leased.turn.cycle_id,
        input_batch_id: leased.turn.input_batch_id,
        source_message_id: hex::encode(route.source_message_id),
        turn_id: leased.turn.id,
        turn_lease_token: leased.turn.lease_token,
        capabilities: parent_capabilities(
            leased.turn.family_id.is_some(),
            leased.deployment.manage_bookings,
        ),
        issued_at,
        expires_at,
    };
    let token = encode_context_grant(&state, &claims, agent_pubkey)?;
    Ok(Json(json!({
        "schemaVersion": CONTEXT_SCHEMA,
        "token": token,
        "expiresAt": expires_at,
        "turn": {
            "id": leased.turn.id,
            "leaseToken": leased.turn.lease_token,
            "leaseExpiresAt": leased.turn.lease_expires_at,
            "attempt": leased.turn.attempt,
            "replayed": leased.turn.replayed,
        },
        "context": context_summary(&claims),
    })))
}

/// Executes one typed, server-scoped Agent Backend operation.
pub(crate) async fn call_backend(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let context = resolve_agent_context(&state, &headers, &body).await?;
    let request = parse_backend_request(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid AirHop Agent Backend JSON"))?;
    let read_operation = request.read_operation();
    let data = match request {
        AgentBackendRequest::GetTurnContext => get_turn_context(&state, &context).await?,
        AgentBackendRequest::GetFamily => get_family(&state, &context).await?,
        AgentBackendRequest::ListBookingOptions {
            branch_id,
            group_id,
            purpose,
            age_years,
        } => {
            list_booking_options(&state, &context, branch_id, group_id, purpose, age_years).await?
        }
        AgentBackendRequest::SearchKnowledge {
            query,
            locale,
            limit,
        } => search_knowledge(&state, &context, &query, locale, limit).await?,
        AgentBackendRequest::ManageBooking { booking_id, action } => {
            manage_booking(&state, &context, booking_id, action, &body).await?
        }
    };
    if let Some(operation) = read_operation {
        state
            .db
            .record_airhop_parent_agent_turn_read(
                &context.principal.tenant,
                context.claims.turn_id,
                context.claims.turn_lease_token,
                context.principal.pubkey.to_bytes(),
                operation,
                data.get("sourceRevision").and_then(Value::as_str),
            )
            .await
            .map_err(map_db_error)?;
    }
    Ok(Json(data))
}

async fn get_turn_context(
    state: &Arc<AppState>,
    context: &ResolvedAgentContext,
) -> Result<Value, (StatusCode, Json<Value>)> {
    require_capability(context, AgentCapability::ReadOrganizationPublic)?;
    let handoff_targets = state
        .db
        .get_airhop_conversation_handoff_targets(
            &context.principal.tenant,
            context.claims.channel_id,
        )
        .await
        .map_err(map_db_error)?;
    let organization = state
        .db
        .get_airhop_organization(&context.principal.tenant)
        .await
        .map_err(map_db_error)?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "AirHop organization not found"))?;
    let family = match context.claims.family_id {
        Some(family_id) => {
            let detail = load_scoped_family(state, context, family_id).await?;
            Some(json!({
                "id": detail.family.id,
                "displayName": detail.family.display_name,
                "version": detail.family.version,
                "children": detail.children.iter().filter(|child| child.status == "active").map(|child| json!({
                    "id": child.id,
                    "displayName": child.display_name,
                })).collect::<Vec<_>>(),
            }))
        }
        None => None,
    };
    Ok(read_envelope(
        &context.claims,
        organization.version.to_string(),
        json!({
            "role": context.claims.role.as_str(),
            "conversation": {
                "id": context.claims.conversation_id,
                "channelId": context.claims.channel_id,
                "cycleId": context.claims.cycle_id,
                "inputBatchId": context.claims.input_batch_id,
                "sourceMessageId": context.claims.source_message_id,
                "turnId": context.claims.turn_id,
            },
            "organization": {
                "id": organization.id,
                "name": organization.name,
                "locale": organization.locale,
                "timeZone": organization.time_zone,
            },
            "family": family,
            "handoffTargets": handoff_targets,
            "capabilities": capability_names(&context.claims.capabilities),
        }),
    ))
}

async fn get_family(
    state: &Arc<AppState>,
    context: &ResolvedAgentContext,
) -> Result<Value, (StatusCode, Json<Value>)> {
    require_capability(context, AgentCapability::ReadFamily)?;
    let family_id = context.claims.family_id.ok_or_else(|| {
        api_error(
            StatusCode::FORBIDDEN,
            "AirHop context is not bound to a verified Family",
        )
    })?;
    let detail = load_scoped_family(state, context, family_id).await?;
    Ok(read_envelope(
        &context.claims,
        detail.family.version.to_string(),
        parent_safe_family_json(&detail),
    ))
}

async fn list_booking_options(
    state: &Arc<AppState>,
    context: &ResolvedAgentContext,
    branch_id: Option<Uuid>,
    group_id: Option<Uuid>,
    purpose: Option<BookingPurpose>,
    age_years: Option<u8>,
) -> Result<Value, (StatusCode, Json<Value>)> {
    require_capability(context, AgentCapability::ListBookingOptions)?;
    let catalog = state
        .db
        .get_public_booking_catalog(&context.principal.tenant)
        .await
        .map_err(map_db_error)?;
    let filters = PublicBookingOccurrenceFilters {
        branch_id,
        group_id,
        purpose: purpose.map(Into::into).unwrap_or(catalog.purpose),
        age: age_years.map(PublicBookingAgeFilter::CompletedYears),
    };
    let occurrences = state
        .db
        .find_public_booking_occurrences(&context.principal.tenant, filters)
        .await
        .map_err(map_db_error)?;
    Ok(read_envelope(
        &context.claims,
        catalog.current_date.to_string(),
        json!({
            "organization": {
                "id": catalog.organization_id,
                "name": catalog.organization_name,
                "locale": catalog.locale,
                "timeZone": catalog.time_zone,
                "currentDate": catalog.current_date,
            },
            "branches": catalog.branches.iter().map(|branch| json!({
                "id": branch.id,
                "name": branch.name,
                "address": branch.address,
            })).collect::<Vec<_>>(),
            "occurrences": occurrences.iter().map(|occurrence| json!({
                "lessonRef": occurrence.lesson_ref,
                "groupId": occurrence.group_id,
                "groupName": occurrence.group_name,
                "groupDescription": occurrence.group_description,
                "branchId": occurrence.branch_id,
                "branchName": occurrence.branch_name,
                "branchAddress": occurrence.branch_address,
                "roomName": occurrence.room_name,
                "teacherNames": occurrence.teacher_names,
                "date": occurrence.date,
                "startTime": occurrence.start_time.format("%H:%M").to_string(),
                "endTime": occurrence.end_time.format("%H:%M").to_string(),
                "trialPolicy": occurrence.trial_policy,
                "remaining": occurrence.remaining,
                "available": occurrence.available,
            })).collect::<Vec<_>>(),
        }),
    ))
}

async fn search_knowledge(
    state: &Arc<AppState>,
    context: &ResolvedAgentContext,
    query: &str,
    locale: Option<String>,
    limit: u8,
) -> Result<Value, (StatusCode, Json<Value>)> {
    require_capability(context, AgentCapability::SearchKnowledge)?;
    let organization = state
        .db
        .get_airhop_organization(&context.principal.tenant)
        .await
        .map_err(map_db_error)?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "AirHop organization not found"))?;
    let mut branch_ids = BTreeSet::new();
    let mut group_ids = BTreeSet::new();
    if let Some(family_id) = context.claims.family_id {
        let family = load_scoped_family(state, context, family_id).await?;
        for booking in &family.bookings {
            branch_ids.insert(booking.branch_id);
            group_ids.insert(booking.group_id);
        }
        for enrollment in &family.enrollments {
            group_ids.insert(enrollment.group_id);
        }
    }
    let locale = locale.unwrap_or_else(|| organization.locale.clone());
    let documents = state
        .db
        .search_airhop_parent_knowledge(
            &context.principal.tenant,
            &ParentKnowledgeScope {
                locale,
                branch_ids: branch_ids.into_iter().collect(),
                group_ids: group_ids.into_iter().collect(),
            },
            query,
            limit,
        )
        .await
        .map_err(map_db_error)?;
    Ok(read_envelope(
        &context.claims,
        organization.version.to_string(),
        json!({ "documents": documents }),
    ))
}

async fn manage_booking(
    state: &Arc<AppState>,
    context: &ResolvedAgentContext,
    booking_id: Uuid,
    action: ParentBookingAction,
    body: &[u8],
) -> Result<Value, (StatusCode, Json<Value>)> {
    require_capability(context, AgentCapability::ManageBooking)?;
    let family_id = context.claims.family_id.ok_or_else(|| {
        api_error(
            StatusCode::FORBIDDEN,
            "AirHop booking actions require a verified Family",
        )
    })?;
    let action_value = serde_json::to_value(&action)
        .map_err(|error| internal_error(&format!("AirHop action serialization failed: {error}")))?;
    let command_key = agent_command_key(state);
    let idempotency_digest = scoped_digest(
        &command_key,
        b"airhop.agent-backend.action-idempotency.v1",
        &[
            context.principal.tenant.community().as_uuid().as_bytes(),
            context.claims.deployment_id.as_bytes(),
            context.claims.turn_id.as_bytes(),
            booking_id.as_bytes(),
            action_value.to_string().as_bytes(),
        ],
    );
    let request_hash: [u8; 32] = Sha256::digest(body).into();
    let domain_action = match action {
        ParentBookingAction::Cancel => PublicManagementAction::CancelByParent,
        ParentBookingAction::RequestTransfer { comment } => {
            PublicManagementAction::RequestTransfer { comment }
        }
    };
    let result = state
        .db
        .apply_airhop_agent_family_management_action(
            &context.principal.tenant,
            AgentFamilyManagementCommand {
                family_id,
                booking_id,
                deployment_id: context.claims.deployment_id,
                deployment_version: context.claims.deployment_version,
                turn_id: context.claims.turn_id,
                turn_lease_token: context.claims.turn_lease_token,
                idempotency_digest,
                request_hash,
                actor: buzz_db::airhop::AirhopActor {
                    kind: buzz_db::airhop::ActorKind::Bot,
                    pubkey: Some(context.principal.pubkey.to_bytes()),
                    on_behalf_of_pubkey: None,
                    agent_pubkey: Some(context.principal.pubkey.to_bytes()),
                },
            },
            domain_action,
        )
        .await
        .map_err(map_db_error)?;
    Ok(json!({
        "schemaVersion": ACTION_SCHEMA,
        "status": "committed",
        "actionId": hex::encode(idempotency_digest),
        "resultType": "booking_updated",
        "authoritativeResult": {
            "bookingId": result.booking_id,
            "status": booking_status_name(result.status),
            "version": result.version,
            "replayed": result.replayed,
        },
        "scope": scope_json(&context.claims),
    }))
}

async fn resolve_agent_context(
    state: &Arc<AppState>,
    headers: &HeaderMap,
    body: &[u8],
) -> Result<ResolvedAgentContext, (StatusCode, Json<Value>)> {
    let principal =
        authenticate_airhop_agent(state, headers, "POST", BACKEND_PATH, Some(body)).await?;
    let token = single_header(headers, CONTEXT_HEADER)?.ok_or_else(|| {
        api_error(
            StatusCode::FORBIDDEN,
            "AirHop parent Agent Backend requires a context grant",
        )
    })?;
    let claims = decode_context_grant(state, token, &principal)?;
    validate_live_context(state, &principal, &claims).await?;
    Ok(ResolvedAgentContext { principal, claims })
}

async fn validate_live_context(
    state: &Arc<AppState>,
    principal: &AirhopPrincipal,
    claims: &AgentContextClaims,
) -> Result<(), (StatusCode, Json<Value>)> {
    let turn = state
        .db
        .validate_airhop_parent_agent_turn_lease(
            &principal.tenant,
            &ValidateParentAgentTurnLeaseInput {
                organization_id: claims.organization_id,
                deployment_id: claims.deployment_id,
                deployment_version: claims.deployment_version,
                turn_id: claims.turn_id,
                lease_token: claims.turn_lease_token,
                agent_pubkey: principal.pubkey.to_bytes(),
            },
        )
        .await
        .map_err(map_db_error)?;
    let source_id = parse_event_id(&claims.source_message_id)?;
    if turn.channel_id != claims.channel_id
        || turn.conversation_id != claims.conversation_id
        || turn.cycle_id != claims.cycle_id
        || turn.input_batch_id != claims.input_batch_id
        || turn.source_message_id != source_id
        || turn.family_id != claims.family_id
        || turn.representative_id != claims.representative_id
    {
        return Err(invalid_context());
    }
    let organization = state
        .db
        .get_airhop_organization(&principal.tenant)
        .await
        .map_err(map_db_error)?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "AirHop organization not found"))?;
    if organization.id != claims.organization_id {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "AirHop context organization is no longer valid",
        ));
    }
    let source = state
        .db
        .get_event_by_id(principal.tenant.community(), &source_id)
        .await
        .map_err(map_db_error)?
        .ok_or_else(|| {
            api_error(
                StatusCode::FORBIDDEN,
                "AirHop source message is unavailable",
            )
        })?;
    if source.channel_id != Some(claims.channel_id) {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "AirHop context channel is no longer valid",
        ));
    }
    validate_family_binding(state, principal, claims.family_id, claims.representative_id).await
}

async fn validate_family_binding(
    state: &Arc<AppState>,
    principal: &AirhopPrincipal,
    family_id: Option<Uuid>,
    representative_id: Option<Uuid>,
) -> Result<(), (StatusCode, Json<Value>)> {
    match (family_id, representative_id) {
        (None, None) => Ok(()),
        (Some(family_id), Some(representative_id)) => {
            let detail = state
                .db
                .get_airhop_staff_family_detail(&principal.tenant, family_id)
                .await
                .map_err(map_db_error)?;
            if detail.family.status != "active"
                || !detail.representatives.iter().any(|representative| {
                    representative.id == representative_id && representative.status == "active"
                })
            {
                return Err(api_error(
                    StatusCode::FORBIDDEN,
                    "AirHop Family binding is not active",
                ));
            }
            Ok(())
        }
        _ => Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "AirHop Family and representative must be bound together",
        )),
    }
}

async fn load_scoped_family(
    state: &Arc<AppState>,
    context: &ResolvedAgentContext,
    family_id: Uuid,
) -> Result<StaffFamilyDetail, (StatusCode, Json<Value>)> {
    if context.claims.family_id != Some(family_id) {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "AirHop Family is outside the current context",
        ));
    }
    state
        .db
        .get_airhop_staff_family_detail(&context.principal.tenant, family_id)
        .await
        .map_err(map_db_error)
}

fn encode_context_grant(
    state: &AppState,
    claims: &AgentContextClaims,
    agent_pubkey: PublicKey,
) -> Result<String, (StatusCode, Json<Value>)> {
    let content = serde_json::to_string(claims).map_err(|error| {
        internal_error(&format!("AirHop context serialization failed: {error}"))
    })?;
    let tenant = claims.tenant_id.to_string();
    let agent = agent_pubkey.to_hex();
    let tags = vec![
        Tag::parse(["p", agent.as_str()])
            .map_err(|error| internal_error(&format!("AirHop context tag failed: {error}")))?,
        Tag::parse(["airhop-tenant", tenant.as_str()])
            .map_err(|error| internal_error(&format!("AirHop context tag failed: {error}")))?,
    ];
    let event = EventBuilder::new(
        Kind::Custom(buzz_core::kind::KIND_AIRHOP_AGENT_CONTEXT_GRANT as u16),
        content,
    )
    .tags(tags)
    .sign_with_keys(&state.relay_keypair)
    .map_err(|error| internal_error(&format!("AirHop context signing failed: {error}")))?;
    let bytes = serde_json::to_vec(&event)
        .map_err(|error| internal_error(&format!("AirHop context encoding failed: {error}")))?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

fn decode_context_grant(
    state: &AppState,
    token: &str,
    principal: &AirhopPrincipal,
) -> Result<AgentContextClaims, (StatusCode, Json<Value>)> {
    if token.len() > 24_000 {
        return Err(invalid_context());
    }
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(token)
        .map_err(|_| invalid_context())?;
    let event: Event = serde_json::from_slice(&bytes).map_err(|_| invalid_context())?;
    if event.kind.as_u16() as u32 != buzz_core::kind::KIND_AIRHOP_AGENT_CONTEXT_GRANT
        || event.pubkey != state.relay_keypair.public_key()
        || !event.verify_signature()
    {
        return Err(invalid_context());
    }
    let claims: AgentContextClaims =
        serde_json::from_str(&event.content).map_err(|_| invalid_context())?;
    let now = Utc::now();
    if claims.schema_version != CONTEXT_SCHEMA
        || claims.tenant_id != *principal.tenant.community().as_uuid()
        || !claims
            .agent_pubkey
            .eq_ignore_ascii_case(&principal.pubkey.to_hex())
        || claims.role != AgentBackendRole::ParentAdministrator
        || claims.issued_at > now + Duration::seconds(30)
        || claims.expires_at <= now
        || claims.expires_at - claims.issued_at > Duration::seconds(MAX_GRANT_TTL_SECONDS)
    {
        return Err(invalid_context());
    }
    Ok(claims)
}

fn validate_issue_request(
    request: &IssueContextGrantBody,
) -> Result<(), (StatusCode, Json<Value>)> {
    if request.deployment_id.is_nil()
        || request.channel_id.is_nil()
        || request.conversation_id.is_nil()
        || request.cycle_id.is_nil()
        || request.input_batch_id.is_nil()
        || request.family_id.is_some_and(|value| value.is_nil())
        || request
            .representative_id
            .is_some_and(|value| value.is_nil())
        || matches!(
            (request.family_id, request.representative_id),
            (Some(_), None) | (None, Some(_))
        )
        || !(60..=MAX_GRANT_TTL_SECONDS as u32).contains(&request.lease_seconds)
        || !(60..=MAX_GRANT_TTL_SECONDS as u32).contains(&request.ttl_seconds)
    {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "AirHop agent context fields are invalid",
        ));
    }
    parse_event_id(&request.source_message_id)?;
    Ok(())
}

fn parent_capabilities(verified_family: bool, manage_bookings: bool) -> BTreeSet<AgentCapability> {
    let mut capabilities = BTreeSet::from([
        AgentCapability::ReadOrganizationPublic,
        AgentCapability::ListBookingOptions,
        AgentCapability::SearchKnowledge,
    ]);
    if verified_family {
        capabilities.insert(AgentCapability::ReadFamily);
    }
    if verified_family && manage_bookings {
        capabilities.insert(AgentCapability::ManageBooking);
    }
    capabilities
}

fn parse_backend_request(body: &[u8]) -> Result<AgentBackendRequest, ()> {
    let value: Value = serde_json::from_slice(body).map_err(|_| ())?;
    parse_backend_request_value(value)
}

fn parse_backend_request_value(value: Value) -> Result<AgentBackendRequest, ()> {
    let object = value.as_object().ok_or(())?;
    let operation = object.get("operation").and_then(Value::as_str).ok_or(())?;
    let allowed = match operation {
        "get_turn_context" | "get_family" => &["operation"][..],
        "list_booking_options" => &["operation", "branchId", "groupId", "purpose", "ageYears"][..],
        "search_knowledge" => &["operation", "query", "locale", "limit"][..],
        "manage_booking" => &["operation", "bookingId", "action"][..],
        _ => return Err(()),
    };
    if object.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err(());
    }
    if operation == "manage_booking" {
        validate_parent_action(object.get("action").ok_or(())?)?;
    }
    serde_json::from_value(value).map_err(|_| ())
}

fn validate_parent_action(value: &Value) -> Result<(), ()> {
    let object = value.as_object().ok_or(())?;
    let action_type = object.get("type").and_then(Value::as_str).ok_or(())?;
    let allowed = match action_type {
        "cancel" => &["type"][..],
        "request_transfer" => &["type", "comment"][..],
        _ => return Err(()),
    };
    if object.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err(());
    }
    Ok(())
}

fn require_capability(
    context: &ResolvedAgentContext,
    capability: AgentCapability,
) -> Result<(), (StatusCode, Json<Value>)> {
    if context.claims.capabilities.contains(&capability) {
        Ok(())
    } else {
        Err(api_error(
            StatusCode::FORBIDDEN,
            "AirHop capability is not granted for this context",
        ))
    }
}

fn read_envelope(claims: &AgentContextClaims, source_revision: String, data: Value) -> Value {
    json!({
        "schemaVersion": READ_SCHEMA,
        "observedAt": Utc::now(),
        "sourceRevision": source_revision,
        "scope": scope_json(claims),
        "data": data,
        "nextCursor": null,
    })
}

fn scope_json(claims: &AgentContextClaims) -> Value {
    json!({
        "organizationId": claims.organization_id,
        "familyId": claims.family_id,
        "representativeId": claims.representative_id,
        "conversationId": claims.conversation_id,
    })
}

fn context_summary(claims: &AgentContextClaims) -> Value {
    json!({
        "deploymentId": claims.deployment_id,
        "deploymentVersion": claims.deployment_version,
        "role": claims.role.as_str(),
        "turnId": claims.turn_id,
        "inputBatchId": claims.input_batch_id,
        "scope": scope_json(claims),
        "capabilities": capability_names(&claims.capabilities),
    })
}

fn deployment_json(deployment: &ParentAgentDeployment) -> Value {
    json!({
        "schemaVersion": "airhop.agent.deployment.v1",
        "id": deployment.id,
        "organizationId": deployment.organization_id,
        "blueprintKey": deployment.blueprint_key,
        "blueprintVersion": deployment.blueprint_version,
        "role": deployment.role,
        "agentPubkey": hex::encode(deployment.agent_pubkey),
        "profileRef": deployment.profile_ref,
        "runtimeRevision": deployment.runtime_revision,
        "personaRevision": deployment.persona_revision,
        "skillsRevision": deployment.skills_revision,
        "modelRevision": deployment.model_revision,
        "enabled": deployment.enabled,
        "paused": deployment.paused,
        "manageBookings": deployment.manage_bookings,
        "version": deployment.version,
        "createdAt": deployment.created_at,
        "updatedAt": deployment.updated_at,
    })
}

fn external_conversation_json(conversation: &ExternalConversation) -> Value {
    json!({
        "schemaVersion": "airhop.external-conversation.v1",
        "conversation": {
            "organizationId": conversation.organization_id,
            "id": conversation.id,
            "channelId": conversation.channel_id,
            "familyId": conversation.family_id,
            "representativeId": conversation.representative_id,
            "parentPubkey": hex::encode(conversation.parent_pubkey),
            "currentCycleId": conversation.current_cycle_id,
            "owner": conversation.owner,
            "hermesPaused": conversation.hermes_paused,
            "controlVersion": conversation.control_version,
            "createdAt": conversation.created_at,
            "updatedAt": conversation.updated_at,
        }
    })
}

fn capability_names(capabilities: &BTreeSet<AgentCapability>) -> Vec<&'static str> {
    capabilities.iter().map(|value| value.as_str()).collect()
}

fn parent_safe_family_json(detail: &StaffFamilyDetail) -> Value {
    json!({
        "organization": {
            "id": detail.organization.id,
            "name": detail.organization.name,
            "locale": detail.organization.locale,
            "timeZone": detail.organization.time_zone,
            "currentDate": detail.organization.current_date,
        },
        "family": detail.family,
        "representatives": detail.representatives.iter().filter(|value| value.status == "active").map(|value| json!({
            "id": value.id,
            "displayName": value.display_name,
            "preferredContactChannel": value.preferred_contact_channel,
            "verifiedMessengerChannels": value.verified_messenger_channels,
            "status": value.status,
            "version": value.version,
        })).collect::<Vec<_>>(),
        "children": detail.children.iter().filter(|value| value.status == "active").map(|value| json!({
            "id": value.id,
            "displayName": value.display_name,
            "status": value.status,
            "version": value.version,
        })).collect::<Vec<_>>(),
        "enrollments": detail.enrollments,
        "bookings": detail.bookings,
        "bookingHistoryTruncated": detail.booking_history_truncated,
    })
}

fn parse_event_id(value: &str) -> Result<[u8; 32], (StatusCode, Json<Value>)> {
    let value = value.trim();
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "AirHop source message id must be 64-character hex",
        ));
    }
    let bytes = hex::decode(value).map_err(|_| invalid_context())?;
    bytes.try_into().map_err(|_| invalid_context())
}

fn single_header<'a>(
    headers: &'a HeaderMap,
    name: &str,
) -> Result<Option<&'a str>, (StatusCode, Json<Value>)> {
    let mut values = headers.get_all(name).iter();
    let value = values.next();
    if values.next().is_some() {
        return Err(invalid_context());
    }
    value
        .map(|value| value.to_str().map_err(|_| invalid_context()))
        .transpose()
}

fn agent_command_key(state: &AppState) -> [u8; 32] {
    let root = crate::invite_token::derive_invite_key(&state.relay_keypair);
    let mut hasher = Sha256::new();
    hasher.update(root);
    hasher.update(b"airhop-agent-backend-command-key-v1");
    hasher.finalize().into()
}

fn scoped_digest(key: &[u8; 32], domain: &[u8], parts: &[&[u8]]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(key);
    hasher.update((domain.len() as u64).to_be_bytes());
    hasher.update(domain);
    for part in parts {
        hasher.update((part.len() as u64).to_be_bytes());
        hasher.update(part);
    }
    hasher.finalize().into()
}

const fn booking_status_name(status: BookingStatus) -> &'static str {
    match status {
        BookingStatus::PendingConfirmation => "pending_confirmation",
        BookingStatus::Confirmed => "confirmed",
        BookingStatus::Rejected => "rejected",
        BookingStatus::CancelledByParent => "cancelled_by_parent",
        BookingStatus::CancelledByCenter => "cancelled_by_center",
    }
}

fn invalid_context() -> (StatusCode, Json<Value>) {
    api_error(
        StatusCode::FORBIDDEN,
        "AirHop agent context is invalid or expired",
    )
}

fn map_db_error(error: buzz_db::DbError) -> (StatusCode, Json<Value>) {
    match error {
        buzz_db::DbError::NotFound(_) | buzz_db::DbError::ChannelNotFound(_) => {
            api_error(StatusCode::NOT_FOUND, "AirHop scoped resource not found")
        }
        buzz_db::DbError::AccessDenied(_) => {
            api_error(StatusCode::FORBIDDEN, "AirHop scoped access denied")
        }
        buzz_db::DbError::InvalidData(message) => {
            api_error(StatusCode::UNPROCESSABLE_ENTITY, &message)
        }
        buzz_db::DbError::AirhopBookingTransition => api_error(
            StatusCode::CONFLICT,
            "AirHop booking can no longer be changed",
        ),
        buzz_db::DbError::AirhopCommandInProgress => {
            api_error(StatusCode::CONFLICT, "AirHop action is already in progress")
        }
        buzz_db::DbError::AirhopCommandPreviouslyFailed => {
            api_error(StatusCode::CONFLICT, "AirHop action previously failed")
        }
        buzz_db::DbError::AirhopIdempotencyConflict => {
            api_error(StatusCode::CONFLICT, "AirHop action idempotency conflict")
        }
        buzz_db::DbError::AirhopVersionConflict => api_error(
            StatusCode::CONFLICT,
            "AirHop state changed; reload and retry",
        ),
        other => internal_error(&format!("AirHop Agent Backend failed: {other}")),
    }
}

fn map_ingest_error(error: crate::handlers::ingest::IngestError) -> (StatusCode, Json<Value>) {
    match error {
        crate::handlers::ingest::IngestError::Rejected(message) => {
            api_error(StatusCode::BAD_REQUEST, &message)
        }
        crate::handlers::ingest::IngestError::AuthFailed(message) => {
            api_error(StatusCode::FORBIDDEN, &message)
        }
        crate::handlers::ingest::IngestError::Internal(message) => {
            internal_error(&format!("Hermes committed reply publish failed: {message}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unverified_parent_has_no_family_capabilities() {
        let capabilities = parent_capabilities(false, true);
        assert!(capabilities.contains(&AgentCapability::ReadOrganizationPublic));
        assert!(capabilities.contains(&AgentCapability::ListBookingOptions));
        assert!(!capabilities.contains(&AgentCapability::ReadFamily));
        assert!(!capabilities.contains(&AgentCapability::ManageBooking));
    }

    #[test]
    fn verified_parent_gets_family_capabilities() {
        let capabilities = parent_capabilities(true, true);
        assert!(capabilities.contains(&AgentCapability::ReadFamily));
        assert!(capabilities.contains(&AgentCapability::ManageBooking));
    }

    #[test]
    fn booking_mutations_require_the_master_capability() {
        let capabilities = parent_capabilities(true, false);
        assert!(capabilities.contains(&AgentCapability::ReadFamily));
        assert!(!capabilities.contains(&AgentCapability::ManageBooking));
    }

    #[test]
    fn context_issue_request_rejects_partial_family_binding() {
        let request = IssueContextGrantBody {
            deployment_id: Uuid::new_v4(),
            channel_id: Uuid::new_v4(),
            conversation_id: Uuid::new_v4(),
            family_id: Some(Uuid::new_v4()),
            representative_id: None,
            cycle_id: Uuid::new_v4(),
            input_batch_id: Uuid::new_v4(),
            source_message_id: "cd".repeat(32),
            lease_seconds: default_turn_lease_seconds(),
            ttl_seconds: DEFAULT_GRANT_TTL_SECONDS,
        };
        assert!(validate_issue_request(&request).is_err());
    }

    #[test]
    fn context_issue_request_does_not_accept_caller_agent_or_capabilities() {
        let body = json!({
            "deploymentId": Uuid::new_v4(),
            "agentPubkey": "ab".repeat(32),
            "channelId": Uuid::new_v4(),
            "conversationId": Uuid::new_v4(),
            "familyId": null,
            "representativeId": null,
            "manageBookings": true,
            "cycleId": Uuid::new_v4(),
            "inputBatchId": Uuid::new_v4(),
            "sourceMessageId": "cd".repeat(32),
            "leaseSeconds": 600,
            "ttlSeconds": 300
        });
        assert!(serde_json::from_value::<IssueContextGrantBody>(body).is_err());
    }

    #[test]
    fn deployment_and_finish_contracts_are_closed() {
        let deployment = json!({
            "agentPubkey": "ab".repeat(32),
            "profileRef": "org/profile/hermes",
            "runtimeRevision": "hermes-agent@0.20.4",
            "personaRevision": "hermes-parent@1",
            "skillsRevision": "airhop-parent@1",
            "modelRevision": "deepseek-chat:flash",
            "expectedVersion": 0,
            "organizationId": Uuid::new_v4()
        });
        assert!(serde_json::from_value::<PutDeploymentBody>(deployment).is_err());

        let finish = json!({
            "status": "completed",
            "leaseToken": Uuid::new_v4(),
            "outcome": "waiting_parent",
            "turnId": Uuid::new_v4()
        });
        assert!(serde_json::from_value::<FinishTurnBody>(finish).is_err());

        let reply = json!({
            "leaseToken": Uuid::new_v4(),
            "events": [],
            "turnId": Uuid::new_v4()
        });
        assert!(serde_json::from_value::<CommitReplyBody>(reply).is_err());

        let claim = json!({
            "inputBatchId": Uuid::new_v4(),
            "conversationId": Uuid::new_v4()
        });
        assert!(serde_json::from_value::<ClaimParentEventBody>(claim).is_err());
    }

    #[test]
    fn action_idempotency_changes_with_turn_and_action() {
        let key = [7_u8; 32];
        let first = scoped_digest(&key, b"domain", &[b"turn-a", b"cancel"]);
        let replay = scoped_digest(&key, b"domain", &[b"turn-a", b"cancel"]);
        let other = scoped_digest(&key, b"domain", &[b"turn-b", b"cancel"]);
        assert_eq!(first, replay);
        assert_ne!(first, other);
    }

    #[test]
    fn backend_request_is_typed_and_rejects_caller_scope_fields() {
        let booking_id = Uuid::new_v4();
        let request = parse_backend_request_value(json!({
            "operation": "manage_booking",
            "bookingId": booking_id,
            "action": {"type": "cancel"}
        }))
        .expect("typed booking action");
        assert!(matches!(
            request,
            AgentBackendRequest::ManageBooking {
                booking_id: parsed,
                action: ParentBookingAction::Cancel,
            } if parsed == booking_id
        ));
        assert!(parse_backend_request_value(json!({
            "operation": "get_family",
            "familyId": Uuid::new_v4()
        }))
        .is_err());
        assert!(parse_backend_request_value(json!({
            "operation": "manage_booking",
            "bookingId": booking_id,
            "organizationId": Uuid::new_v4(),
            "action": {"type": "cancel"}
        }))
        .is_err());
        assert!(parse_backend_request_value(json!({
            "operation": "manage_booking",
            "bookingId": booking_id,
            "action": {"type": "cancel", "familyId": Uuid::new_v4()}
        }))
        .is_err());
    }
}
