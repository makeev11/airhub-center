//! Private original-file and Markdown artifact exports. Edits use Nostr commands.
use super::{
    airhop_auth::{authenticate_airhop, authenticate_airhop_agent, ApiResult},
    api_error, internal_error,
};
use crate::{handlers::ingest::IngestError, state::AppState};
use airhop_core::knowledge::KnowledgeCommand;
use axum::{
    body::Bytes,
    extract::{Path, RawQuery, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use buzz_core::TenantContext;
use buzz_db::{
    airhop::{knowledge::ParentKnowledgeScope, welcome_agents::AirhopWelcomeRole},
    DbError,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use uuid::Uuid;

const ARTIFACTS: &str = "/api/airhop/knowledge/v1/artifacts";
const SOURCES: &str = "/api/airhop/knowledge/v1/sources";

pub(crate) async fn private_response(mut response: Response) -> Response {
    response.headers_mut().insert(
        axum::http::header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("private, no-store"),
    );
    response.headers_mut().insert(
        axum::http::header::ACCESS_CONTROL_EXPOSE_HEADERS,
        axum::http::HeaderValue::from_static("Content-Disposition"),
    );
    response
}

fn owner(role: &str) -> ApiResult<()> {
    if matches!(role, "owner" | "admin") {
        Ok(())
    } else {
        Err(api_error(
            StatusCode::FORBIDDEN,
            "Knowledge editing requires owner or admin",
        ))
    }
}

pub(crate) async fn apply_command(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    event: &nostr::Event,
) -> Result<Value, IngestError> {
    let bindings: Vec<_> = event
        .tags
        .iter()
        .filter(|t| {
            t.as_slice()
                .first()
                .is_some_and(|v| v == "airhop-community")
        })
        .collect();
    if bindings.len() != 1
        || bindings[0].as_slice().get(1).map(String::as_str)
            != Some(tenant.community().as_uuid().to_string().as_str())
    {
        return Err(IngestError::Rejected(
            "invalid: knowledge command tenant binding required".into(),
        ));
    }
    let command: KnowledgeCommand = serde_json::from_str(&event.content)
        .map_err(|_| IngestError::Rejected("invalid: knowledge command shape".into()))?;
    if let KnowledgeCommand::Save { draft, .. } = &command {
        draft
            .validate()
            .map_err(|e| IngestError::Rejected(format!("invalid: {e}")))?;
    }
    state
        .db
        .apply_knowledge_command(
            tenant,
            &event.pubkey.to_bytes(),
            &event.id.to_bytes(),
            &command,
        )
        .await
        .map_err(|e| match e {
            DbError::AccessDenied(_) => {
                IngestError::AuthFailed("restricted: knowledge requires owner/admin".into())
            }
            DbError::AirhopVersionConflict => {
                IngestError::Rejected("conflict: knowledge changed; reload before saving".into())
            }
            DbError::InvalidData(e) => IngestError::Rejected(format!("invalid: {e}")),
            DbError::NotFound(_) => {
                IngestError::Rejected("invalid: knowledge material or reference not found".into())
            }
            e => {
                tracing::error!(error=%e,"Knowledge command failed");
                IngestError::Internal("error: knowledge command failed".into())
            }
        })
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ArtifactQuery {
    view: Option<String>,
    id: Option<Uuid>,
    after: Option<Uuid>,
    query: Option<String>,
    branch_id: Option<Uuid>,
    group_id: Option<Uuid>,
}

pub(crate) async fn artifacts(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    RawQuery(raw): RawQuery,
) -> ApiResult<Json<Value>> {
    let path = raw
        .as_ref()
        .map_or_else(|| ARTIFACTS.to_owned(), |q| format!("{ARTIFACTS}?{q}"));
    // Use the same query parser as Axum, while preserving exact signed URL bytes.
    let query = axum::extract::Query::<ArtifactQuery>::try_from_uri(
        &path
            .parse()
            .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid URL"))?,
    )
    .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid artifact query"))?
    .0;
    let principal = authenticate_airhop_agent(&state, &headers, "GET", &path, None).await?;
    let tenant = &principal.tenant;
    let organization = state
        .db
        .get_airhop_organization(tenant)
        .await
        .map_err(db_error)?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "organization missing"))?;
    let can_edit = matches!(principal.member_role.as_str(), "owner" | "admin");
    if query.view.as_deref() == Some("published") {
        let website_only = if can_edit {
            false
        } else {
            let team = state
                .db
                .get_airhop_welcome_team(tenant)
                .await
                .map_err(db_error)?
                .ok_or_else(|| api_error(StatusCode::FORBIDDEN, "registered agent required"))?;
            let role = team
                .members
                .iter()
                .find_map(|(r, k)| (k.as_slice() == principal.pubkey.as_bytes()).then_some(*r))
                .ok_or_else(|| api_error(StatusCode::FORBIDDEN, "registered agent required"))?;
            role == AirhopWelcomeRole::ContentMarketer
        };
        let page = state
            .db
            .knowledge_artifact_page(
                tenant,
                website_only,
                query.query.as_deref(),
                query.after,
                query.id,
            )
            .await
            .map_err(db_error)?;
        return Ok(Json(page));
    }
    owner(&principal.member_role)?;
    if query.view.as_deref() == Some("parent_preview") {
        let (branch_ids, group_ids) = state
            .db
            .resolve_parent_knowledge_selection(tenant, query.branch_id, query.group_id)
            .await
            .map_err(db_error)?;
        let documents = state
            .db
            .search_airhop_parent_knowledge(
                tenant,
                &ParentKnowledgeScope {
                    locale: organization.locale,
                    branch_ids,
                    group_ids,
                },
                query.query.as_deref().unwrap_or(""),
                5,
            )
            .await
            .map_err(db_error)?;
        return Ok(Json(json!({"documents":documents,"isModelAnswer":false})));
    }
    if query.view.is_some() {
        return Err(api_error(StatusCode::BAD_REQUEST, "unknown artifact view"));
    }
    if let Some(id) = query.id {
        return Ok(Json(
            state
                .db
                .knowledge_material(tenant, id)
                .await
                .map_err(db_error)?,
        ));
    }
    let mut manifest = state
        .db
        .knowledge_manifest(tenant, query.after)
        .await
        .map_err(db_error)?;
    manifest["communityId"] = json!(tenant.community().as_uuid());
    manifest["organizationId"] = json!(organization.id);
    manifest["locale"] = json!(organization.locale);
    Ok(Json(manifest))
}

pub(crate) async fn upload_source(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Json<Value>> {
    let principal = authenticate_airhop(&state, &headers, "POST", SOURCES, Some(&body)).await?;
    owner(&principal.member_role)?;
    let name = headers
        .get("x-knowledge-name")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| {
            url::form_urlencoded::parse(format!("v={v}").as_bytes())
                .next()
                .map(|(_, v)| v.into_owned())
        })
        .ok_or_else(|| api_error(StatusCode::BAD_REQUEST, "file name required"))?;
    if name.trim().is_empty()
        || name.chars().count() > 200
        || name.contains(['\r', '\n', '/', '\\'])
    {
        return Err(api_error(StatusCode::BAD_REQUEST, "invalid file name"));
    }
    let extension = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    let media = match extension.as_str() {
        "pdf" if body.starts_with(b"%PDF-") => "application/pdf",
        "docx" if body.starts_with(b"PK\x03\x04") => {
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        }
        "txt" | "md" if std::str::from_utf8(&body).is_ok_and(|t| !t.contains('\0')) => "text/plain",
        _ => {
            return Err(api_error(
                StatusCode::BAD_REQUEST,
                "supported files: PDF, DOCX, UTF-8 TXT and Markdown",
            ))
        }
    };
    let digest = Sha256::digest(&body);
    let id = state
        .db
        .store_knowledge_source(
            &principal.tenant,
            &principal.pubkey.to_bytes(),
            &name,
            media,
            &digest,
            &body,
        )
        .await
        .map_err(db_error)?;
    Ok(Json(
        json!({"id":id,"name":name,"sha256":hex::encode(digest)}),
    ))
}

pub(crate) async fn download_source(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> ApiResult<Response> {
    let path = format!("{SOURCES}/{id}");
    let principal = authenticate_airhop(&state, &headers, "GET", &path, None).await?;
    owner(&principal.member_role)?;
    let (name, bytes) = state
        .db
        .knowledge_source(&principal.tenant, id)
        .await
        .map_err(db_error)?;
    let disposition = format!(
        "attachment; filename*=UTF-8''{}",
        url::form_urlencoded::byte_serialize(name.as_bytes())
            .collect::<String>()
            .replace('+', "%20")
    );
    Ok((
        [
            ("content-type", "application/octet-stream".to_owned()),
            ("content-disposition", disposition),
            ("cache-control", "private, no-store".to_owned()),
            ("x-content-type-options", "nosniff".to_owned()),
        ],
        bytes,
    )
        .into_response())
}

fn db_error(e: DbError) -> (StatusCode, Json<Value>) {
    match e {
        DbError::InvalidData(e) => api_error(StatusCode::BAD_REQUEST, &e),
        DbError::NotFound(_) => api_error(StatusCode::NOT_FOUND, "knowledge artifact not found"),
        DbError::AccessDenied(_) => api_error(StatusCode::FORBIDDEN, "access denied"),
        _ => internal_error(&format!("knowledge export: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn artifacts_and_errors_are_never_cached() {
        let response = private_response(StatusCode::FORBIDDEN.into_response()).await;
        assert_eq!(response.headers()["cache-control"], "private, no-store");
        assert_eq!(
            response.headers()["access-control-expose-headers"],
            "Content-Disposition"
        );
    }
}
