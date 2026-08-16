//! Authenticated AirHub staff decisions and private connector delivery API.

use std::sync::Arc;

use airhop_core::BookingStatus;
use axum::body::Bytes;
use axum::extract::rejection::QueryRejection;
use axum::extract::{Path, Query, RawQuery, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::Json;
use buzz_db::airhop::booking_decision::{
    BindMessengerAccountInput, BookingDecision, DecideBookingInput, DeliveryAckState,
    DeliveryCompletion, ParentNotificationRoute,
};
use buzz_db::airhop::family_commands::{
    UpdateFamilyChildInput, UpdateFamilyInput, UpdateFamilyRepresentativeInput,
};
use buzz_db::airhop::family_detail::StaffFamilyDetail;
use buzz_db::airhop::family_directory::{
    StaffFamilyDirectoryCursor, StaffFamilyDirectoryFilter, StaffFamilyDirectoryPage,
    StaffFamilyDirectoryStatus,
};
use buzz_db::airhop::family_lifecycle::{
    CreateFamilyInput, FamilyLifecycleStatus, SetFamilyStatusInput,
};
use buzz_db::airhop::family_member_lifecycle::{
    FamilyMemberStatus, SetFamilyChildStatusInput, SetFamilyRepresentativeStatusInput,
};
use buzz_db::airhop::family_members::{AddFamilyChildInput, AddFamilyRepresentativeInput};
use buzz_db::airhop::family_primary_representative::SetFamilyPrimaryRepresentativeInput;
use buzz_db::airhop::staff_queue::{
    StaffBookingQueueCursor, StaffBookingQueueFilter, StaffBookingQueueRow,
};
use buzz_db::airhop::{ActorKind, AirhopActor};
use chrono::{DateTime, Utc};
use hmac::digest::KeyInit;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::state::AppState;

use super::{api_error, bridge, internal_error};

type HmacSha256 = Hmac<Sha256>;
const IDEMPOTENCY_HEADER: &str = "idempotency-key";

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DecideBookingBody {
    decision: BookingDecision,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BindMessengerAccountBody {
    booking_id: Uuid,
    channel: String,
    external_user_id: String,
    #[serde(default)]
    display_handle: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpdateFamilyRepresentativeBody {
    expected_version: i64,
    display_name: String,
    phone: String,
    preferred_contact_channel: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpdateFamilyBody {
    expected_version: i64,
    display_name: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpdateFamilyChildBody {
    expected_version: i64,
    display_name: String,
    birth_date: chrono::NaiveDate,
    #[serde(default)]
    note: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateFamilyBody {
    display_name: String,
    representative_name: String,
    phone: String,
    #[serde(default = "default_phone_channel")]
    preferred_contact_channel: String,
    child_name: String,
    child_birth_date: chrono::NaiveDate,
    #[serde(default)]
    child_note: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SetFamilyStatusBody {
    expected_version: i64,
    status: FamilyLifecycleStatus,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AddFamilyRepresentativeBody {
    display_name: String,
    phone: String,
    #[serde(default = "default_phone_channel")]
    preferred_contact_channel: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AddFamilyChildBody {
    display_name: String,
    birth_date: chrono::NaiveDate,
    #[serde(default)]
    note: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SetFamilyMemberStatusBody {
    expected_version: i64,
    status: FamilyMemberStatus,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SetFamilyPrimaryRepresentativeBody {
    expected_version: i64,
    representative_id: Uuid,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ClaimNotificationsBody {
    #[serde(default = "default_claim_limit")]
    limit: u16,
    #[serde(default = "default_lease_seconds")]
    lease_seconds: i64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CompleteNotificationBody {
    Delivered {
        lease_token: Uuid,
        #[serde(default)]
        provider_message_id: Option<String>,
    },
    Failed {
        lease_token: Uuid,
        error_code: String,
        #[serde(default = "default_retry_seconds")]
        retry_after_seconds: i64,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BookingRequestsQuery {
    #[serde(default)]
    status: Option<BookingStatus>,
    #[serde(default)]
    attention_only: bool,
    #[serde(default = "default_queue_limit")]
    limit: u16,
    #[serde(default)]
    cursor_priority: Option<i16>,
    #[serde(default)]
    cursor_updated_at: Option<DateTime<Utc>>,
    #[serde(default)]
    cursor_booking_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct FamiliesQuery {
    #[serde(default = "default_family_status")]
    status: StaffFamilyDirectoryStatus,
    #[serde(default)]
    search: Option<String>,
    #[serde(default = "default_queue_limit")]
    limit: u16,
    #[serde(default)]
    cursor_sort_name: Option<String>,
    #[serde(default)]
    cursor_family_id: Option<Uuid>,
}

/// Authoritative, tenant-scoped request-workflow queue for AirHub staff.
pub(crate) async fn list_booking_requests(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    RawQuery(raw_query): RawQuery,
    query: Result<Query<BookingRequestsQuery>, QueryRejection>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = match raw_query.as_deref() {
        Some(query) if !query.is_empty() => {
            format!("/api/airhop/staff/v1/booking-requests?{query}")
        }
        _ => "/api/airhop/staff/v1/booking-requests".to_owned(),
    };
    let (tenant, _) = authenticate(&state, &headers, "GET", &path, None, Access::Staff).await?;
    let Query(query) = query
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid AirHub staff queue query"))?;
    let filter = booking_queue_filter(query)?;
    let page = state
        .db
        .list_airhop_staff_booking_queue(&tenant, filter)
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "items": page.items.iter().map(booking_queue_row_json).collect::<Vec<_>>(),
        "nextCursor": page.next_cursor.map(|cursor| json!({
            "priority": cursor.priority,
            "updatedAt": cursor.updated_at,
            "bookingId": cursor.booking_id
        }))
    })))
}

/// Authoritative, tenant-scoped family directory for AirHub staff.
pub(crate) async fn list_families(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    RawQuery(raw_query): RawQuery,
    query: Result<Query<FamiliesQuery>, QueryRejection>,
) -> Result<Json<StaffFamilyDirectoryPage>, (StatusCode, Json<Value>)> {
    let path = match raw_query.as_deref() {
        Some(query) if !query.is_empty() => format!("/api/airhop/staff/v1/families?{query}"),
        _ => "/api/airhop/staff/v1/families".to_owned(),
    };
    let (tenant, _) = authenticate(&state, &headers, "GET", &path, None, Access::Staff).await?;
    let Query(query) = query.map_err(|_| {
        api_error(
            StatusCode::BAD_REQUEST,
            "invalid AirHub family directory query",
        )
    })?;
    let filter = family_directory_filter(query)?;
    state
        .db
        .list_airhop_staff_families(&tenant, filter)
        .await
        .map(Json)
        .map_err(map_db_error)
}

/// Atomically creates a family, primary representative, and first child.
pub(crate) async fn create_family(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = "/api/airhop/staff/v1/families";
    let (tenant, pubkey) =
        authenticate(&state, &headers, "POST", path, Some(&body), Access::Staff).await?;
    let request: CreateFamilyBody = parse_body(&body)?;
    let phone_display = request.phone.trim().to_owned();
    let phone_normalized = super::airhop_public::normalize_airhop_phone(&phone_display)
        .ok_or_else(|| api_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid phone number"))?;
    let config = state.config.airhop_public_booking.as_ref().ok_or_else(|| {
        api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "AirHub phone identity is not configured",
        )
    })?;
    let phone_match_digest = super::airhop_public::airhop_phone_match_digest(
        config.index_key(),
        tenant.community().as_uuid(),
        &phone_normalized,
    );
    let idempotency_key = require_idempotency_key(&headers)?;
    let key = command_key(&state);
    let outcome = state
        .db
        .create_airhop_family(
            &tenant,
            &CreateFamilyInput {
                display_name: request.display_name,
                representative_name: request.representative_name,
                phone_normalized,
                phone_display,
                phone_match_digest,
                preferred_contact_channel: request.preferred_contact_channel,
                child_name: request.child_name,
                child_birth_date: request.child_birth_date,
                child_note: request.child_note,
                idempotency_digest: scoped_digest(
                    &key,
                    b"airhop.staff.family-create.idempotency.v1",
                    tenant.community().as_uuid(),
                    &pubkey.to_bytes(),
                    idempotency_key.as_bytes(),
                )?,
                request_hash: Sha256::digest(&body).into(),
                actor: staff_actor(pubkey),
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "familyId": outcome.family_id,
        "representativeId": outcome.representative_id,
        "childId": outcome.child_id,
        "hasPendingDuplicate": outcome.has_pending_duplicate,
        "replayed": outcome.replayed
    })))
}

/// Adds a representative to an existing active family.
pub(crate) async fn add_family_representative(
    State(state): State<Arc<AppState>>,
    Path(family_id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("/api/airhop/staff/v1/families/{family_id}/representatives");
    let (tenant, pubkey) =
        authenticate(&state, &headers, "POST", &path, Some(&body), Access::Staff).await?;
    let request: AddFamilyRepresentativeBody = parse_body(&body)?;
    let phone_display = request.phone.trim().to_owned();
    let phone_normalized = super::airhop_public::normalize_airhop_phone(&phone_display)
        .ok_or_else(|| api_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid phone number"))?;
    let config = state.config.airhop_public_booking.as_ref().ok_or_else(|| {
        api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "AirHub phone identity is not configured",
        )
    })?;
    let phone_match_digest = super::airhop_public::airhop_phone_match_digest(
        config.index_key(),
        tenant.community().as_uuid(),
        &phone_normalized,
    );
    let idempotency_key = require_idempotency_key(&headers)?;
    let key = command_key(&state);
    let outcome = state
        .db
        .add_airhop_family_representative(
            &tenant,
            &AddFamilyRepresentativeInput {
                family_id,
                display_name: request.display_name,
                phone_normalized,
                phone_display,
                phone_match_digest,
                preferred_contact_channel: request.preferred_contact_channel,
                idempotency_digest: scoped_digest(
                    &key,
                    b"airhop.staff.representative-create.idempotency.v1",
                    tenant.community().as_uuid(),
                    &pubkey.to_bytes(),
                    idempotency_key.as_bytes(),
                )?,
                request_hash: Sha256::digest(&body).into(),
                actor: staff_actor(pubkey),
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "representativeId": outcome.representative_id,
        "hasPendingDuplicate": outcome.has_pending_duplicate,
        "replayed": outcome.replayed
    })))
}

/// Adds a child to an existing active family.
pub(crate) async fn add_family_child(
    State(state): State<Arc<AppState>>,
    Path(family_id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("/api/airhop/staff/v1/families/{family_id}/children");
    let (tenant, pubkey) =
        authenticate(&state, &headers, "POST", &path, Some(&body), Access::Staff).await?;
    let request: AddFamilyChildBody = parse_body(&body)?;
    let idempotency_key = require_idempotency_key(&headers)?;
    let key = command_key(&state);
    let outcome = state
        .db
        .add_airhop_family_child(
            &tenant,
            &AddFamilyChildInput {
                family_id,
                display_name: request.display_name,
                birth_date: request.birth_date,
                note: request.note,
                idempotency_digest: scoped_digest(
                    &key,
                    b"airhop.staff.child-create.idempotency.v1",
                    tenant.community().as_uuid(),
                    &pubkey.to_bytes(),
                    idempotency_key.as_bytes(),
                )?,
                request_hash: Sha256::digest(&body).into(),
                actor: staff_actor(pubkey),
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "childId": outcome.child_id,
        "hasPendingDuplicate": outcome.has_pending_duplicate,
        "replayed": outcome.replayed
    })))
}

/// Staff-only authoritative family card with bounded operational history.
pub(crate) async fn get_family_detail(
    State(state): State<Arc<AppState>>,
    Path(family_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<StaffFamilyDetail>, (StatusCode, Json<Value>)> {
    let path = format!("/api/airhop/staff/v1/families/{family_id}");
    let (tenant, _) = authenticate(&state, &headers, "GET", &path, None, Access::Staff).await?;
    state
        .db
        .get_airhop_staff_family_detail(&tenant, family_id)
        .await
        .map(Json)
        .map_err(map_db_error)
}

/// Staff-only family-label replacement with optimistic concurrency and audit.
pub(crate) async fn update_family(
    State(state): State<Arc<AppState>>,
    Path(family_id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("/api/airhop/staff/v1/families/{family_id}");
    let (tenant, pubkey) =
        authenticate(&state, &headers, "PUT", &path, Some(&body), Access::Staff).await?;
    let request: UpdateFamilyBody = parse_body(&body)?;
    let idempotency_key = require_idempotency_key(&headers)?;
    let command_key = command_key(&state);
    let outcome = state
        .db
        .update_airhop_family(
            &tenant,
            &UpdateFamilyInput {
                family_id,
                expected_version: request.expected_version,
                display_name: request.display_name.trim().to_owned(),
                idempotency_digest: scoped_digest(
                    &command_key,
                    b"airhop.staff.family-update.idempotency.v1",
                    tenant.community().as_uuid(),
                    &pubkey.to_bytes(),
                    idempotency_key.as_bytes(),
                )?,
                request_hash: Sha256::digest(&body).into(),
                actor: staff_actor(pubkey),
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "familyId": outcome.family_id,
        "version": outcome.version,
        "replayed": outcome.replayed
    })))
}

/// Reassigns the family primary edge to an active representative in that family.
pub(crate) async fn set_family_primary_representative(
    State(state): State<Arc<AppState>>,
    Path(family_id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("/api/airhop/staff/v1/families/{family_id}/primary-representative");
    let (tenant, pubkey) =
        authenticate(&state, &headers, "PUT", &path, Some(&body), Access::Staff).await?;
    let request: SetFamilyPrimaryRepresentativeBody = parse_body(&body)?;
    let idempotency_key = require_idempotency_key(&headers)?;
    let key = command_key(&state);
    let outcome = state
        .db
        .set_airhop_family_primary_representative(
            &tenant,
            &SetFamilyPrimaryRepresentativeInput {
                family_id,
                representative_id: request.representative_id,
                expected_version: request.expected_version,
                idempotency_digest: scoped_digest(
                    &key,
                    b"airhop.staff.primary-representative.idempotency.v1",
                    tenant.community().as_uuid(),
                    &pubkey.to_bytes(),
                    idempotency_key.as_bytes(),
                )?,
                request_hash: Sha256::digest(&body).into(),
                actor: staff_actor(pubkey),
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "familyId": outcome.family_id,
        "representativeId": outcome.representative_id,
        "previousRepresentativeId": outcome.previous_representative_id,
        "version": outcome.version,
        "replayed": outcome.replayed
    })))
}

/// Staff-only child replacement with optimistic concurrency and audit.
pub(crate) async fn update_family_child(
    State(state): State<Arc<AppState>>,
    Path((family_id, child_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("/api/airhop/staff/v1/families/{family_id}/children/{child_id}");
    let (tenant, pubkey) =
        authenticate(&state, &headers, "PUT", &path, Some(&body), Access::Staff).await?;
    let request: UpdateFamilyChildBody = parse_body(&body)?;
    let idempotency_key = require_idempotency_key(&headers)?;
    let command_key = command_key(&state);
    let outcome = state
        .db
        .update_airhop_family_child(
            &tenant,
            &UpdateFamilyChildInput {
                family_id,
                child_id,
                expected_version: request.expected_version,
                display_name: request.display_name.trim().to_owned(),
                birth_date: request.birth_date,
                note: request.note,
                idempotency_digest: scoped_digest(
                    &command_key,
                    b"airhop.staff.child-update.idempotency.v1",
                    tenant.community().as_uuid(),
                    &pubkey.to_bytes(),
                    idempotency_key.as_bytes(),
                )?,
                request_hash: Sha256::digest(&body).into(),
                actor: staff_actor(pubkey),
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "childId": outcome.child_id,
        "version": outcome.version,
        "replayed": outcome.replayed
    })))
}

/// Explicitly archives or restores a family without deleting relationships.
pub(crate) async fn set_family_status(
    State(state): State<Arc<AppState>>,
    Path(family_id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("/api/airhop/staff/v1/families/{family_id}/status");
    let (tenant, pubkey) =
        authenticate(&state, &headers, "PUT", &path, Some(&body), Access::Staff).await?;
    let request: SetFamilyStatusBody = parse_body(&body)?;
    let idempotency_key = require_idempotency_key(&headers)?;
    let key = command_key(&state);
    let outcome = state
        .db
        .set_airhop_family_status(
            &tenant,
            &SetFamilyStatusInput {
                family_id,
                expected_version: request.expected_version,
                status: request.status,
                idempotency_digest: scoped_digest(
                    &key,
                    b"airhop.staff.family-status.idempotency.v1",
                    tenant.community().as_uuid(),
                    &pubkey.to_bytes(),
                    idempotency_key.as_bytes(),
                )?,
                request_hash: Sha256::digest(&body).into(),
                actor: staff_actor(pubkey),
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "familyId": outcome.family_id,
        "status": outcome.status,
        "version": outcome.version,
        "replayed": outcome.replayed
    })))
}

/// Archives or restores a non-primary family representative.
pub(crate) async fn set_family_representative_status(
    State(state): State<Arc<AppState>>,
    Path((family_id, representative_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!(
        "/api/airhop/staff/v1/families/{family_id}/representatives/{representative_id}/status"
    );
    let (tenant, pubkey) =
        authenticate(&state, &headers, "PUT", &path, Some(&body), Access::Staff).await?;
    let request: SetFamilyMemberStatusBody = parse_body(&body)?;
    let idempotency_key = require_idempotency_key(&headers)?;
    let key = command_key(&state);
    let outcome = state
        .db
        .set_airhop_family_representative_status(
            &tenant,
            &SetFamilyRepresentativeStatusInput {
                family_id,
                representative_id,
                expected_version: request.expected_version,
                status: request.status,
                idempotency_digest: scoped_digest(
                    &key,
                    b"airhop.staff.representative-status.idempotency.v1",
                    tenant.community().as_uuid(),
                    &pubkey.to_bytes(),
                    idempotency_key.as_bytes(),
                )?,
                request_hash: Sha256::digest(&body).into(),
                actor: staff_actor(pubkey),
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "representativeId": outcome.representative_id,
        "status": outcome.status,
        "version": outcome.version,
        "hasPendingDuplicate": outcome.has_pending_duplicate,
        "replayed": outcome.replayed
    })))
}

/// Archives or restores a child when no active commitments remain.
pub(crate) async fn set_family_child_status(
    State(state): State<Arc<AppState>>,
    Path((family_id, child_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("/api/airhop/staff/v1/families/{family_id}/children/{child_id}/status");
    let (tenant, pubkey) =
        authenticate(&state, &headers, "PUT", &path, Some(&body), Access::Staff).await?;
    let request: SetFamilyMemberStatusBody = parse_body(&body)?;
    let idempotency_key = require_idempotency_key(&headers)?;
    let key = command_key(&state);
    let outcome = state
        .db
        .set_airhop_family_child_status(
            &tenant,
            &SetFamilyChildStatusInput {
                family_id,
                child_id,
                expected_version: request.expected_version,
                status: request.status,
                idempotency_digest: scoped_digest(
                    &key,
                    b"airhop.staff.child-status.idempotency.v1",
                    tenant.community().as_uuid(),
                    &pubkey.to_bytes(),
                    idempotency_key.as_bytes(),
                )?,
                request_hash: Sha256::digest(&body).into(),
                actor: staff_actor(pubkey),
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "childId": outcome.child_id,
        "status": outcome.status,
        "version": outcome.version,
        "hasPendingDuplicate": outcome.has_pending_duplicate,
        "replayed": outcome.replayed
    })))
}

/// Staff-only representative replacement with optimistic concurrency and audit.
pub(crate) async fn update_family_representative(
    State(state): State<Arc<AppState>>,
    Path((family_id, representative_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path =
        format!("/api/airhop/staff/v1/families/{family_id}/representatives/{representative_id}");
    let (tenant, pubkey) =
        authenticate(&state, &headers, "PUT", &path, Some(&body), Access::Staff).await?;
    let request: UpdateFamilyRepresentativeBody = parse_body(&body)?;
    let display_name = request.display_name.trim().to_owned();
    let phone_display = request.phone.trim().to_owned();
    let phone_normalized = super::airhop_public::normalize_airhop_phone(&phone_display)
        .ok_or_else(|| api_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid phone number"))?;
    let public_booking_config = state.config.airhop_public_booking.as_ref().ok_or_else(|| {
        api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "AirHub phone identity is not configured",
        )
    })?;
    let phone_match_digest = super::airhop_public::airhop_phone_match_digest(
        public_booking_config.index_key(),
        tenant.community().as_uuid(),
        &phone_normalized,
    );
    let idempotency_key = require_idempotency_key(&headers)?;
    let command_key = command_key(&state);
    let outcome = state
        .db
        .update_airhop_family_representative(
            &tenant,
            &UpdateFamilyRepresentativeInput {
                family_id,
                representative_id,
                expected_version: request.expected_version,
                display_name,
                phone_normalized,
                phone_display,
                phone_match_digest,
                preferred_contact_channel: request.preferred_contact_channel,
                idempotency_digest: scoped_digest(
                    &command_key,
                    b"airhop.staff.representative-update.idempotency.v1",
                    tenant.community().as_uuid(),
                    &pubkey.to_bytes(),
                    idempotency_key.as_bytes(),
                )?,
                request_hash: Sha256::digest(&body).into(),
                actor: AirhopActor {
                    kind: ActorKind::Staff,
                    pubkey: Some(pubkey.to_bytes()),
                    on_behalf_of_pubkey: None,
                    agent_pubkey: None,
                },
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "representativeId": outcome.representative_id,
        "version": outcome.version,
        "hasPendingDuplicate": outcome.has_pending_duplicate,
        "replayed": outcome.replayed
    })))
}

/// Staff-only transition from `pending_confirmation` to confirmed/rejected.
pub(crate) async fn decide_booking(
    State(state): State<Arc<AppState>>,
    Path(booking_id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("/api/airhop/staff/v1/bookings/{booking_id}/decision");
    let (tenant, pubkey) =
        authenticate(&state, &headers, "POST", &path, Some(&body), Access::Staff).await?;
    let request: DecideBookingBody = parse_body(&body)?;
    let idempotency_key = require_idempotency_key(&headers)?;
    let command_key = command_key(&state);
    let outcome = state
        .db
        .decide_airhop_booking(
            &tenant,
            &DecideBookingInput {
                booking_id,
                decision: request.decision,
                idempotency_digest: scoped_digest(
                    &command_key,
                    b"airhop.staff.booking-decision.idempotency.v1",
                    tenant.community().as_uuid(),
                    &pubkey.to_bytes(),
                    idempotency_key.as_bytes(),
                )?,
                request_hash: Sha256::digest(&body).into(),
                actor: AirhopActor {
                    kind: ActorKind::Staff,
                    pubkey: Some(pubkey.to_bytes()),
                    on_behalf_of_pubkey: None,
                    agent_pubkey: None,
                },
            },
        )
        .await
        .map_err(map_db_error)?;
    let notification = match outcome.notification_route {
        ParentNotificationRoute::Messenger { channel } => json!({
            "kind": "messenger",
            "channel": channel,
            "state": "queued"
        }),
        ParentNotificationRoute::StaffCall => json!({
            "kind": "staff_call",
            "state": "queued"
        }),
    };
    Ok(Json(json!({
        "bookingId": outcome.booking_id,
        "status": outcome.status,
        "notification": notification,
        "replayed": outcome.replayed
    })))
}

/// Trusted HQ connector callback after a parent completes a messenger handoff.
pub(crate) async fn bind_messenger_account(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = "/api/airhop/integrations/v1/messenger-bindings";
    let (tenant, pubkey) = authenticate(
        &state,
        &headers,
        "POST",
        path,
        Some(&body),
        Access::Integration,
    )
    .await?;
    let request: BindMessengerAccountBody = parse_body(&body)?;
    let idempotency_key = require_idempotency_key(&headers)?;
    let key = command_key(&state);
    let external_user_digest = scoped_digest(
        &key,
        b"airhop.messenger.external-user.v1",
        tenant.community().as_uuid(),
        request.channel.as_bytes(),
        request.external_user_id.as_bytes(),
    )?;
    let outcome = state
        .db
        .bind_airhop_booking_messenger_account(
            &tenant,
            &BindMessengerAccountInput {
                booking_id: request.booking_id,
                channel: request.channel,
                external_user_id: request.external_user_id,
                external_user_digest,
                display_handle: request.display_handle,
                idempotency_digest: scoped_digest(
                    &key,
                    b"airhop.messenger.binding.idempotency.v1",
                    tenant.community().as_uuid(),
                    &pubkey.to_bytes(),
                    idempotency_key.as_bytes(),
                )?,
                request_hash: Sha256::digest(&body).into(),
                actor: AirhopActor {
                    kind: ActorKind::Bot,
                    pubkey: Some(pubkey.to_bytes()),
                    on_behalf_of_pubkey: None,
                    agent_pubkey: Some(pubkey.to_bytes()),
                },
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "representativeId": outcome.representative_id,
        "messengerAccountId": outcome.messenger_account_id,
        "channel": outcome.channel,
        "verified": true,
        "replayed": outcome.replayed
    })))
}

/// Leases delivery jobs to an owner/admin connector.
pub(crate) async fn claim_parent_notifications(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = "/api/airhop/integrations/v1/parent-notifications/claim";
    let (tenant, pubkey) = authenticate(
        &state,
        &headers,
        "POST",
        path,
        Some(&body),
        Access::Integration,
    )
    .await?;
    let request: ClaimNotificationsBody = parse_body(&body)?;
    let jobs = state
        .db
        .claim_airhop_parent_notifications(
            &tenant,
            pubkey.to_bytes(),
            request.limit,
            request.lease_seconds,
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "jobs": jobs.into_iter().map(|job| json!({
            "outboxId": job.outbox_id,
            "leaseToken": job.lease_token,
            "channel": job.channel,
            "externalUserId": job.external_user_id,
            "templateKey": job.template_key,
            "bookingId": job.booking_id,
            "status": job.status,
            "locale": job.locale,
            "timeZone": job.time_zone,
            "variables": {
                "childName": job.child_name,
                "groupName": job.group_name,
                "branchName": job.branch_name,
                "branchAddress": job.branch_address,
                "lessonDate": job.lesson_date,
                "startTime": job.start_time.format("%H:%M").to_string()
            }
        })).collect::<Vec<_>>()
    })))
}

/// Idempotently completes a delivery lease.
pub(crate) async fn complete_parent_notification(
    State(state): State<Arc<AppState>>,
    Path(outbox_id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("/api/airhop/integrations/v1/parent-notifications/{outbox_id}/complete");
    let (tenant, pubkey) = authenticate(
        &state,
        &headers,
        "POST",
        &path,
        Some(&body),
        Access::Integration,
    )
    .await?;
    let request: CompleteNotificationBody = parse_body(&body)?;
    let (lease_token, completion) = match request {
        CompleteNotificationBody::Delivered {
            lease_token,
            provider_message_id,
        } => (
            lease_token,
            DeliveryCompletion::Delivered {
                provider_message_id,
            },
        ),
        CompleteNotificationBody::Failed {
            lease_token,
            error_code,
            retry_after_seconds,
        } => (
            lease_token,
            DeliveryCompletion::Failed {
                error_code,
                retry_after_seconds,
            },
        ),
    };
    let state_result = state
        .db
        .complete_airhop_parent_notification(
            &tenant,
            pubkey.to_bytes(),
            outbox_id,
            lease_token,
            &completion,
        )
        .await
        .map_err(map_db_error)?;
    let state_name = match state_result {
        DeliveryAckState::Delivered => "delivered",
        DeliveryAckState::RetryScheduled => "retry_scheduled",
        DeliveryAckState::FailedOverToStaff => "failed_over_to_staff",
    };
    Ok(Json(json!({"outboxId": outbox_id, "state": state_name})))
}

#[derive(Debug, Clone, Copy)]
enum Access {
    Staff,
    Integration,
}

async fn authenticate(
    state: &Arc<AppState>,
    headers: &HeaderMap,
    method: &str,
    path: &str,
    body: Option<&[u8]>,
    access: Access,
) -> Result<(buzz_core::TenantContext, nostr::PublicKey), (StatusCode, Json<Value>)> {
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
        .map_err(|error| internal_error(&format!("AirHub member lookup failed: {error}")))?
        .ok_or_else(|| {
            api_error(
                StatusCode::FORBIDDEN,
                "AirHub workspace membership required",
            )
        })?;
    if matches!(access, Access::Integration) && member.role != "owner" && member.role != "admin" {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "AirHub integration access requires owner or admin role",
        ));
    }
    Ok((tenant, pubkey))
}

fn booking_queue_filter(
    query: BookingRequestsQuery,
) -> Result<StaffBookingQueueFilter, (StatusCode, Json<Value>)> {
    if !(1..=100).contains(&query.limit) {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "AirHub staff queue limit must be between 1 and 100",
        ));
    }
    let cursor = match (
        query.cursor_priority,
        query.cursor_updated_at,
        query.cursor_booking_id,
    ) {
        (None, None, None) => None,
        (Some(priority), Some(updated_at), Some(booking_id)) if (0..=3).contains(&priority) => {
            Some(StaffBookingQueueCursor {
                priority,
                updated_at,
                booking_id,
            })
        }
        _ => {
            return Err(api_error(
                StatusCode::BAD_REQUEST,
                "AirHub staff queue cursor must contain priority, updatedAt and bookingId",
            ))
        }
    };
    Ok(StaffBookingQueueFilter {
        status: query.status,
        attention_only: query.attention_only,
        limit: query.limit,
        cursor,
    })
}

fn family_directory_filter(
    query: FamiliesQuery,
) -> Result<StaffFamilyDirectoryFilter, (StatusCode, Json<Value>)> {
    if !(1..=100).contains(&query.limit) {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "AirHub family directory limit must be between 1 and 100",
        ));
    }
    let search = query
        .search
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    if search
        .as_ref()
        .is_some_and(|value| value.chars().count() > 100)
    {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "AirHub family directory search is too long",
        ));
    }
    let cursor = match (query.cursor_sort_name, query.cursor_family_id) {
        (None, None) => None,
        (Some(sort_name), Some(family_id))
            if !sort_name.is_empty() && sort_name.chars().count() <= 200 && !family_id.is_nil() =>
        {
            Some(StaffFamilyDirectoryCursor {
                sort_name,
                family_id,
            })
        }
        _ => {
            return Err(api_error(
                StatusCode::BAD_REQUEST,
                "AirHub family directory cursor must contain sortName and familyId",
            ))
        }
    };
    Ok(StaffFamilyDirectoryFilter {
        status: query.status,
        search,
        limit: query.limit,
        cursor,
    })
}

fn booking_queue_row_json(row: &StaffBookingQueueRow) -> Value {
    json!({
        "booking": {
            "id": row.booking_id,
            "status": row.status,
            "visitKind": row.visit_kind,
            "transferRequest": row.transfer_request,
            "lessonRef": {
                "recurrenceRuleId": row.recurrence_rule_id,
                "originalDate": row.original_date
            },
            "version": row.version,
            "createdAt": row.created_at,
            "updatedAt": row.updated_at
        },
        "family": {
            "id": row.family_id,
            "displayName": row.family_name
        },
        "representative": {
            "id": row.representative_id,
            "displayName": row.representative_name,
            "phoneNormalized": row.phone_normalized,
            "phoneDisplay": row.phone_display,
            "preferredContactChannel": row.preferred_contact_channel
        },
        "child": {
            "id": row.child_id,
            "displayName": row.child_name,
            "birthDate": row.child_birth_date
        },
        "occurrence": {
            "id": row.occurrence_id,
            "date": row.lesson_date,
            "startTime": row.start_time.format("%H:%M").to_string(),
            "endTime": row.end_time.format("%H:%M").to_string(),
            "status": row.occurrence_status
        },
        "group": {
            "id": row.group_id,
            "name": row.group_name
        },
        "branch": {
            "id": row.branch_id,
            "name": row.branch_name
        },
        "attentionReasons": row.attention_reasons,
        "requiresAttention": !row.attention_reasons.is_empty()
    })
}

fn parse_body<T: for<'de> Deserialize<'de>>(body: &[u8]) -> Result<T, (StatusCode, Json<Value>)> {
    serde_json::from_slice(body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid AirHub JSON body"))
}

fn require_idempotency_key(headers: &HeaderMap) -> Result<&str, (StatusCode, Json<Value>)> {
    headers
        .get(IDEMPOTENCY_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| (16..=200).contains(&value.len()))
        .ok_or_else(|| {
            api_error(
                StatusCode::BAD_REQUEST,
                "a 16-200 byte Idempotency-Key header is required",
            )
        })
}

fn command_key(state: &AppState) -> [u8; 32] {
    let root = crate::invite_token::derive_invite_key(&state.relay_keypair);
    let mut hasher = Sha256::new();
    hasher.update(root);
    hasher.update(b"airhop-command-key-v1");
    hasher.finalize().into()
}

fn staff_actor(pubkey: nostr::PublicKey) -> AirhopActor {
    AirhopActor {
        kind: ActorKind::Staff,
        pubkey: Some(pubkey.to_bytes()),
        on_behalf_of_pubkey: None,
        agent_pubkey: None,
    }
}

fn scoped_digest(
    key: &[u8; 32],
    domain: &[u8],
    community_id: &Uuid,
    principal: &[u8],
    value: &[u8],
) -> Result<[u8; 32], (StatusCode, Json<Value>)> {
    let mut mac = <HmacSha256 as KeyInit>::new_from_slice(key)
        .map_err(|_| internal_error("AirHub command key has an invalid length"))?;
    for component in [domain, community_id.as_bytes(), principal, value] {
        mac.update(&(component.len() as u64).to_be_bytes());
        mac.update(component);
    }
    Ok(mac.finalize().into_bytes().into())
}

fn map_db_error(error: buzz_db::DbError) -> (StatusCode, Json<Value>) {
    use buzz_db::DbError;
    match error {
        DbError::NotFound(_) => api_error(StatusCode::NOT_FOUND, "AirHub resource not found"),
        DbError::AirhopBookingTransition => api_error(
            StatusCode::CONFLICT,
            "AirHub booking is no longer pending confirmation",
        ),
        DbError::AirhopVersionConflict => api_error(
            StatusCode::CONFLICT,
            "AirHub entity changed; reload before saving",
        ),
        DbError::AirhopPrimaryRepresentativeRequired => api_error(
            StatusCode::CONFLICT,
            "Primary representative must be reassigned before archiving",
        ),
        DbError::AirhopMemberHasActiveCommitments => api_error(
            StatusCode::CONFLICT,
            "Family member has active enrollment or future bookings",
        ),
        DbError::AirhopRepresentativeUnavailable => api_error(
            StatusCode::CONFLICT,
            "Representative must be active and belong to this family",
        ),
        DbError::AirhopIdempotencyConflict => api_error(
            StatusCode::CONFLICT,
            "Idempotency-Key was already used for another AirHub request",
        ),
        DbError::AirhopCommandInProgress => {
            api_error(StatusCode::CONFLICT, "AirHub command is still in progress")
        }
        DbError::AirhopCommandPreviouslyFailed => {
            api_error(StatusCode::CONFLICT, "AirHub command previously failed")
        }
        DbError::AirhopIdentityMismatch => api_error(
            StatusCode::CONFLICT,
            "messenger identity is already bound to another representative",
        ),
        DbError::AccessDenied(_) => api_error(StatusCode::FORBIDDEN, "AirHub access denied"),
        DbError::InvalidData(_) => {
            api_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid AirHub request")
        }
        other => internal_error(&format!("AirHub command failed: {other}")),
    }
}

const fn default_claim_limit() -> u16 {
    10
}

const fn default_queue_limit() -> u16 {
    50
}

fn default_phone_channel() -> String {
    "phone".to_owned()
}

const fn default_family_status() -> StaffFamilyDirectoryStatus {
    StaffFamilyDirectoryStatus::Active
}

const fn default_lease_seconds() -> i64 {
    60
}

const fn default_retry_seconds() -> i64 {
    60
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scoped_digests_are_tenant_and_principal_bound() {
        let key = [7_u8; 32];
        let community_a = Uuid::new_v4();
        let community_b = Uuid::new_v4();
        let first = scoped_digest(&key, b"test", &community_a, &[1; 32], b"same").unwrap();
        assert_ne!(
            first,
            scoped_digest(&key, b"test", &community_b, &[1; 32], b"same").unwrap()
        );
        assert_ne!(
            first,
            scoped_digest(&key, b"test", &community_a, &[2; 32], b"same").unwrap()
        );
    }

    #[test]
    fn completion_body_requires_an_explicit_outcome() {
        assert!(serde_json::from_value::<CompleteNotificationBody>(json!({
            "outcome": "delivered",
            "leaseToken": Uuid::new_v4()
        }))
        .is_ok());
        assert!(serde_json::from_value::<CompleteNotificationBody>(json!({})).is_err());
    }

    #[test]
    fn queue_cursor_is_all_or_nothing_and_bounded() {
        let valid = BookingRequestsQuery {
            status: Some(BookingStatus::PendingConfirmation),
            attention_only: true,
            limit: 25,
            cursor_priority: Some(0),
            cursor_updated_at: Some(Utc::now()),
            cursor_booking_id: Some(Uuid::new_v4()),
        };
        assert!(booking_queue_filter(valid).is_ok());
        let half = BookingRequestsQuery {
            status: None,
            attention_only: false,
            limit: 50,
            cursor_priority: Some(0),
            cursor_updated_at: None,
            cursor_booking_id: None,
        };
        assert!(booking_queue_filter(half).is_err());
        let too_large = BookingRequestsQuery {
            status: None,
            attention_only: false,
            limit: 101,
            cursor_priority: None,
            cursor_updated_at: None,
            cursor_booking_id: None,
        };
        assert!(booking_queue_filter(too_large).is_err());
    }

    #[test]
    fn family_directory_query_is_trimmed_bounded_and_cursor_safe() {
        let valid = FamiliesQuery {
            status: StaffFamilyDirectoryStatus::Active,
            search: Some("  Мария  ".to_owned()),
            limit: 25,
            cursor_sort_name: Some("семья марии".to_owned()),
            cursor_family_id: Some(Uuid::new_v4()),
        };
        let filter = family_directory_filter(valid).unwrap();
        assert_eq!(filter.search.as_deref(), Some("Мария"));
        assert!(filter.cursor.is_some());

        let half = FamiliesQuery {
            status: StaffFamilyDirectoryStatus::Archived,
            search: None,
            limit: 50,
            cursor_sort_name: Some("семья".to_owned()),
            cursor_family_id: None,
        };
        assert!(family_directory_filter(half).is_err());
    }
}
