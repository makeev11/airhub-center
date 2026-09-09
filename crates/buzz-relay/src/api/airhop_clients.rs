//! Client Inbox reads and Nostr command application; no second messaging API.
use super::{
    airhop_auth::{authenticate_airhop, ApiResult},
    api_error, internal_error,
};
use crate::{handlers::ingest::IngestError, state::AppState};
use airhop_core::client_conversations::ClientWorkspaceCommand;
use axum::{
    extract::{RawQuery, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use buzz_core::TenantContext;
use buzz_db::{airhop::client_threads::ClientInboxFilter, DbError};
use serde_json::Value;
use std::sync::Arc;

const PATH: &str = "/api/airhop/staff/v1/client-conversations";

pub(crate) async fn inbox(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    RawQuery(raw): RawQuery,
) -> ApiResult<Json<Value>> {
    let path = raw
        .as_ref()
        .map(|q| format!("{PATH}?{q}"))
        .unwrap_or_else(|| PATH.into());
    let principal = authenticate_airhop(&state, &headers, "GET", &path, None).await?;
    let query = axum::extract::Query::<ClientInboxFilter>::try_from_uri(
        &path
            .parse()
            .map_err(|_| api_error(StatusCode::BAD_REQUEST, "Invalid URL"))?,
    )
    .map_err(|_| api_error(StatusCode::BAD_REQUEST, "Invalid Inbox filters"))?
    .0;
    let mut result = state
        .db
        .client_inbox(&principal.tenant, &principal.pubkey.to_bytes(), &query)
        .await
        .map_err(map_db)?;
    result["systemPubkey"] = serde_json::json!(state.relay_keypair.public_key().to_hex());
    Ok(Json(result))
}

pub(crate) async fn migration_preview(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<uuid::Uuid>,
) -> ApiResult<Json<Value>> {
    let path = format!("{PATH}/{id}/migration-preview");
    let principal = authenticate_airhop(&state, &headers, "GET", &path, None).await?;
    Ok(Json(
        state
            .db
            .preview_client_migration(&principal.tenant, &principal.pubkey.to_bytes(), id)
            .await
            .map_err(map_db)?,
    ))
}

pub(crate) async fn apply_command(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    event: &nostr::Event,
) -> Result<Value, IngestError> {
    let tags: Vec<_> = event
        .tags
        .iter()
        .map(|t| t.as_slice())
        .filter(|t| t.first().is_some_and(|s| s == "airhop-community"))
        .collect();
    if tags.len() != 1
        || tags[0].get(1).map(String::as_str)
            != Some(tenant.community().as_uuid().to_string().as_str())
    {
        return Err(IngestError::Rejected(
            "invalid: client command requires exact tenant binding".into(),
        ));
    }
    let command: ClientWorkspaceCommand = serde_json::from_str(&event.content)
        .map_err(|_| IngestError::Rejected("invalid: client command shape".into()))?;
    let result = match command {
        ClientWorkspaceCommand::Conversation(command) => {
            state
                .db
                .apply_client_command(
                    tenant,
                    &event.pubkey.to_bytes(),
                    &command,
                    &state.relay_keypair,
                )
                .await
        }
        ClientWorkspaceCommand::BranchResponsibles(command) => {
            state
                .db
                .set_branch_client_responsibles(tenant, &event.pubkey.to_bytes(), &command)
                .await
        }
    };
    result.map_err(|e| match e {
        DbError::AirhopVersionConflict => IngestError::Rejected(
            "conflict: client conversation changed; refresh before retrying".into(),
        ),
        DbError::AccessDenied(message) => IngestError::Rejected(format!("restricted: {message}")),
        DbError::InvalidData(message) => IngestError::Rejected(format!("invalid: {message}")),
        DbError::NotFound(message) => {
            IngestError::Rejected(format!("invalid: {message} not found"))
        }
        e => {
            tracing::error!(error=%e,"client command failed");
            IngestError::Internal("error: client command failed".into())
        }
    })
}

fn map_db(error: DbError) -> (StatusCode, Json<Value>) {
    match error {
        DbError::AccessDenied(message) => api_error(StatusCode::FORBIDDEN, &message),
        DbError::InvalidData(message) => api_error(StatusCode::BAD_REQUEST, &message),
        DbError::NotFound(_) => api_error(StatusCode::NOT_FOUND, "Conversation not found"),
        _ => internal_error("Could not load client Inbox"),
    }
}
