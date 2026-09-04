//! Unauthenticated, abuse-controlled HTTP boundary for public AirHub booking.

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use airhop_core::{
    BookingStatus, PublicBookingAppearance, PublicBookingPurpose, StableLessonReference,
    TrialPolicy,
};
use axum::body::{to_bytes, Bytes};
use axum::extract::rejection::QueryRejection;
use axum::extract::{ConnectInfo, Query, Request, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use buzz_db::airhop::public_booking::{
    CreatePublicBookingInput, PreferredContactChannel, PublicBookingApplicant,
    PublicBookingDisposition, PublicBookingSurface,
};
use chrono::NaiveDate;
use hmac::digest::KeyInit;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::Sha256;
use uuid::Uuid;

use crate::state::AppState;

type HmacSha256 = Hmac<Sha256>;

const IDEMPOTENCY_HEADER: &str = "idempotency-key";
const IP_RATE_NAMESPACE: &str = "airhop_booking_ip";
const PHONE_RATE_NAMESPACE: &str = "airhop_booking_phone";
const READ_RATE_NAMESPACE: &str = "airhop_public_read_ip";
const CONSENT_POLICY_VERSION: &str = "public-booking-v1";

#[derive(Debug, Clone, Copy)]
enum PublicQuota {
    Read,
    Booking,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PublicBookingRequest {
    lesson_ref: StableLessonReference,
    applicant: PublicApplicantRequest,
    #[serde(default)]
    preferred_contact_channel: ContactChannelRequest,
    source: PublicBookingSourceRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PublicApplicantRequest {
    parent_name: String,
    phone: String,
    child_name: String,
    child_birth_date: NaiveDate,
    consent_accepted: bool,
    consent_policy_version: String,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum ContactChannelRequest {
    Telegram,
    Max,
    Whatsapp,
    Phone,
    #[default]
    None,
}

impl From<ContactChannelRequest> for PreferredContactChannel {
    fn from(value: ContactChannelRequest) -> Self {
        match value {
            ContactChannelRequest::Telegram => Self::Telegram,
            ContactChannelRequest::Max => Self::Max,
            ContactChannelRequest::Whatsapp => Self::Whatsapp,
            ContactChannelRequest::Phone => Self::Phone,
            ContactChannelRequest::None => Self::None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PublicBookingSourceRequest {
    surface: SurfaceRequest,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    attribution_branch_id: Option<Uuid>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum SurfaceRequest {
    Standalone,
    Embedded,
}

impl From<SurfaceRequest> for PublicBookingSurface {
    fn from(value: SurfaceRequest) -> Self {
        match value {
            SurfaceRequest::Standalone => Self::Standalone,
            SurfaceRequest::Embedded => Self::Embedded,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicBookingResponse {
    booking_id: Uuid,
    status: &'static str,
    lesson_ref: StableLessonReference,
    management_token: String,
    replayed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicCatalogResponse {
    organization: PublicCatalogOrganization,
    branches: Vec<PublicCatalogBranch>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicCatalogOrganization {
    id: Uuid,
    name: String,
    locale: String,
    time_zone: String,
    current_date: NaiveDate,
    public_booking: PublicCatalogSettings,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicCatalogSettings {
    purpose: PublicBookingPurpose,
    appearance: PublicBookingAppearance,
    consent_policy_version: &'static str,
}

#[derive(Debug, Serialize)]
struct PublicCatalogBranch {
    id: Uuid,
    name: String,
    address: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PublicOccurrenceQuery {
    #[serde(default)]
    branch_id: Option<Uuid>,
    #[serde(default)]
    group_id: Option<Uuid>,
    #[serde(default)]
    age_years: Option<u8>,
    #[serde(default)]
    birth_year: Option<i32>,
    #[serde(default)]
    birth_month: Option<u32>,
    #[serde(default = "default_public_purpose")]
    purpose: PublicBookingPurpose,
}

#[derive(Debug, Serialize)]
struct PublicOccurrencesResponse {
    occurrences: Vec<PublicOccurrenceResponse>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicOccurrenceResponse {
    lesson_ref: StableLessonReference,
    group_id: Uuid,
    group_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    group_description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    min_age_months: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_age_months: Option<u32>,
    branch_id: Uuid,
    branch_name: String,
    branch_address: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    room_name: Option<String>,
    teacher_names: Vec<String>,
    date: NaiveDate,
    start_time: String,
    end_time: String,
    trial_policy: TrialPolicy,
    capacity: Option<u32>,
    occupied: u32,
    remaining: Option<u32>,
    available: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PublicTransferRequestBody {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    comment: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct EmptyManagementBody {}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PublicContactChannelBody {
    channel: ContactChannelRequest,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicManagementCardResponse {
    status: &'static str,
    child_name: String,
    masked_phone: String,
    preferred_contact_channel: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    transfer_request: Option<buzz_db::airhop::public_management::PublicTransferRequest>,
    organization_name: String,
    branch_name: String,
    branch_address: String,
    group_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    room_name: Option<String>,
    teacher_names: Vec<String>,
    date: NaiveDate,
    start_time: String,
    end_time: String,
    trial_policy: TrialPolicy,
    purpose: PublicBookingPurpose,
    can_cancel: bool,
    can_request_transfer: bool,
}

#[derive(Debug, Serialize)]
struct ErrorEnvelope {
    error: ErrorDetail,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorDetail {
    code: &'static str,
    message: &'static str,
    retryable: bool,
}

#[derive(Debug)]
pub(crate) struct ApiFailure {
    status: StatusCode,
    code: &'static str,
    message: &'static str,
    retryable: bool,
    retry_after: Option<u64>,
}

impl ApiFailure {
    const fn new(
        status: StatusCode,
        code: &'static str,
        message: &'static str,
        retryable: bool,
    ) -> Self {
        Self {
            status,
            code,
            message,
            retryable,
            retry_after: None,
        }
    }

    const fn rate_limited(retry_after: u64) -> Self {
        Self {
            status: StatusCode::TOO_MANY_REQUESTS,
            code: "rate_limit_exceeded",
            message: "Too many booking attempts. Please try again later.",
            retryable: true,
            retry_after: Some(retry_after),
        }
    }
}

impl IntoResponse for ApiFailure {
    fn into_response(self) -> Response {
        let mut response = (
            self.status,
            Json(ErrorEnvelope {
                error: ErrorDetail {
                    code: self.code,
                    message: self.message,
                    retryable: self.retryable,
                },
            }),
        )
            .into_response();
        if let Some(retry_after) = self.retry_after {
            if let Ok(value) = HeaderValue::from_str(&retry_after.to_string()) {
                response.headers_mut().insert(header::RETRY_AFTER, value);
            }
        }
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        response
    }
}

/// Returns public center settings and active branches for the bound tenant.
pub(crate) async fn get_public_catalog(
    State(state): State<Arc<AppState>>,
    request: Request,
) -> Result<Response, ApiFailure> {
    let headers = request.headers();
    let peer_ip = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|value| value.0.ip());
    let tenant = bind_and_rate_limit(
        &state,
        headers,
        peer_ip,
        READ_RATE_NAMESPACE,
        PublicQuota::Read,
    )
    .await?;
    let catalog = state
        .db
        .get_public_booking_catalog(&tenant)
        .await
        .map_err(map_public_read_error)?;
    no_store_json(PublicCatalogResponse {
        organization: PublicCatalogOrganization {
            id: catalog.organization_id,
            name: catalog.organization_name,
            locale: catalog.locale,
            time_zone: catalog.time_zone,
            current_date: catalog.current_date,
            public_booking: PublicCatalogSettings {
                purpose: catalog.purpose,
                appearance: catalog.appearance,
                consent_policy_version: CONSENT_POLICY_VERSION,
            },
        },
        branches: catalog
            .branches
            .into_iter()
            .map(|branch| PublicCatalogBranch {
                id: branch.id,
                name: branch.name,
                address: branch.address,
            })
            .collect(),
    })
}

/// Returns future server-materialized occurrences with authoritative occupancy.
pub(crate) async fn get_public_occurrences(
    State(state): State<Arc<AppState>>,
    query: Result<Query<PublicOccurrenceQuery>, QueryRejection>,
    request: Request,
) -> Result<Response, ApiFailure> {
    let query = query.map_err(|_| invalid_query())?.0;
    let filters = public_occurrence_filters(query)?;
    let headers = request.headers();
    let peer_ip = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|value| value.0.ip());
    let tenant = bind_and_rate_limit(
        &state,
        headers,
        peer_ip,
        READ_RATE_NAMESPACE,
        PublicQuota::Read,
    )
    .await?;
    let occurrences = state
        .db
        .find_public_booking_occurrences(&tenant, filters)
        .await
        .map_err(map_public_read_error)?;
    no_store_json(PublicOccurrencesResponse {
        occurrences: occurrences
            .into_iter()
            .map(|occurrence| PublicOccurrenceResponse {
                lesson_ref: occurrence.lesson_ref,
                group_id: occurrence.group_id,
                group_name: occurrence.group_name,
                group_description: occurrence.group_description,
                min_age_months: occurrence.min_age_months,
                max_age_months: occurrence.max_age_months,
                branch_id: occurrence.branch_id,
                branch_name: occurrence.branch_name,
                branch_address: occurrence.branch_address,
                room_name: occurrence.room_name,
                teacher_names: occurrence.teacher_names,
                date: occurrence.date,
                start_time: occurrence.start_time.format("%H:%M").to_string(),
                end_time: occurrence.end_time.format("%H:%M").to_string(),
                trial_policy: occurrence.trial_policy,
                capacity: occurrence.capacity,
                occupied: occurrence.occupied,
                remaining: occurrence.remaining,
                available: occurrence.available,
            })
            .collect(),
    })
}

/// Returns a parent-visible management card for a valid bearer token.
pub(crate) async fn get_public_management_card(
    State(state): State<Arc<AppState>>,
    request: Request,
) -> Result<Response, ApiFailure> {
    let headers = request.headers();
    let peer_ip = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|value| value.0.ip());
    let tenant = bind_and_rate_limit(
        &state,
        headers,
        peer_ip,
        READ_RATE_NAMESPACE,
        PublicQuota::Read,
    )
    .await?;
    let credential = parse_management_credential(&state, headers)?;
    let card = state
        .db
        .get_public_management_card(&tenant, credential)
        .await
        .map_err(map_public_management_error)?
        .ok_or_else(invalid_management_token)?;
    no_store_json(public_management_card_response(card))
}

/// Cancels a future active booking using a bearer token and idempotent command.
pub(crate) async fn cancel_public_booking_by_parent(
    State(state): State<Arc<AppState>>,
    request: Request,
) -> Result<Response, ApiFailure> {
    let (request, body) = read_management_body(request).await?;
    let parsed: EmptyManagementBody = serde_json::from_slice(&body).map_err(|_| {
        ApiFailure::new(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "The management request is not valid JSON.",
            false,
        )
    })?;
    let canonical = serde_json::to_vec(&parsed).map_err(|_| internal_failure())?;
    apply_public_management_http_action(
        state,
        request,
        "cancel",
        &canonical,
        buzz_db::airhop::public_management::PublicManagementAction::CancelByParent,
    )
    .await
}

/// Creates one pending transfer request for a future active booking.
pub(crate) async fn request_public_booking_transfer(
    State(state): State<Arc<AppState>>,
    request: Request,
) -> Result<Response, ApiFailure> {
    let (request, body) = read_management_body(request).await?;
    let parsed: PublicTransferRequestBody = serde_json::from_slice(&body).map_err(|_| {
        ApiFailure::new(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "The management request is not valid JSON.",
            false,
        )
    })?;
    let canonical = serde_json::to_vec(&parsed).map_err(|_| internal_failure())?;
    let comment = parsed
        .comment
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    apply_public_management_http_action(
        state,
        request,
        "transfer_request",
        &canonical,
        buzz_db::airhop::public_management::PublicManagementAction::RequestTransfer { comment },
    )
    .await
}

/// Updates the preferred contact channel for a managed public booking.
pub(crate) async fn set_public_booking_contact_channel(
    State(state): State<Arc<AppState>>,
    request: Request,
) -> Result<Response, ApiFailure> {
    let (request, body) = read_management_body(request).await?;
    let parsed: PublicContactChannelBody = serde_json::from_slice(&body).map_err(|_| {
        ApiFailure::new(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "The management request is not valid JSON.",
            false,
        )
    })?;
    if matches!(parsed.channel, ContactChannelRequest::None) {
        return Err(ApiFailure::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "contact_channel_invalid",
            "A contact channel must be selected.",
            false,
        ));
    }
    let canonical = serde_json::to_vec(&parsed).map_err(|_| internal_failure())?;
    apply_public_management_http_action(
        state,
        request,
        "contact_channel",
        &canonical,
        buzz_db::airhop::public_management::PublicManagementAction::SetPreferredContactChannel {
            channel: parsed.channel.into(),
        },
    )
    .await
}

/// Creates one public booking under the host-resolved AirHub tenant.
pub(crate) async fn create_public_booking(
    State(state): State<Arc<AppState>>,
    request: Request,
) -> Result<Response, ApiFailure> {
    let headers = request.headers().clone();
    let peer_ip = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|value| value.0.ip());
    let tenant = bind_and_rate_limit(
        &state,
        &headers,
        peer_ip,
        IP_RATE_NAMESPACE,
        PublicQuota::Booking,
    )
    .await?;
    let config = state
        .config
        .airhop_public_booking
        .as_ref()
        .ok_or_else(not_found)?;
    let community_id = *tenant.community().as_uuid();
    let client_ip = resolve_client_ip(config.client_ip_header(), &headers, peer_ip)?;
    let ip_digest = tenant_keyed_digest(
        config.index_key(),
        &community_id,
        b"airhop.public-booking.ip.v1",
        &[client_ip.to_string().as_bytes()],
    );
    let body: Bytes = to_bytes(request.into_body(), 16 * 1024)
        .await
        .map_err(|_| {
            ApiFailure::new(
                StatusCode::PAYLOAD_TOO_LARGE,
                "request_too_large",
                "The booking request is too large.",
                false,
            )
        })?;

    let request: PublicBookingRequest = serde_json::from_slice(&body).map_err(|_| {
        ApiFailure::new(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "The booking request is not valid JSON.",
            false,
        )
    })?;
    validate_consent(
        request.applicant.consent_accepted,
        &request.applicant.consent_policy_version,
    )?;
    let idempotency_key = parse_idempotency_key(&headers)?;
    let phone_normalized = normalize_public_phone(&request.applicant.phone)?;
    let phone_match_digest = tenant_keyed_digest(
        config.index_key(),
        &community_id,
        b"airhop.public-booking.phone.v1",
        &[phone_normalized.as_bytes()],
    );
    enforce_rate_limit(
        &state,
        &tenant,
        PHONE_RATE_NAMESPACE,
        &phone_match_digest,
        3_600,
        config.phone_requests_per_hour(),
    )
    .await?;

    let idempotency_digest = tenant_keyed_digest(
        config.index_key(),
        &community_id,
        b"airhop.public-booking.idempotency.v1",
        &[idempotency_key.as_bytes()],
    );
    let canonical_request = serde_json::to_vec(&request).map_err(|_| internal_failure())?;
    let request_hash = tenant_keyed_digest(
        config.index_key(),
        &community_id,
        b"airhop.public-booking.request.v1",
        &[&canonical_request],
    );
    let current_key_version = config.current_management_key_version();
    let current_management_key = config
        .management_key(current_key_version)
        .ok_or_else(internal_failure)?;
    let (_, management_token_digest) = derive_management_token(
        current_management_key,
        current_key_version,
        tenant.community().as_uuid(),
        &idempotency_digest,
    );
    let user_agent_digest = headers.get(header::USER_AGENT).map(|value| {
        hex::encode(tenant_keyed_digest(
            config.index_key(),
            &community_id,
            b"airhop.public-booking.user-agent.v1",
            &[value.as_bytes()],
        ))
    });
    let input = CreatePublicBookingInput {
        lesson_ref: request.lesson_ref,
        applicant: PublicBookingApplicant {
            parent_name: request.applicant.parent_name,
            parent_first_name: None,
            parent_last_name: None,
            phone_normalized,
            phone_display: request.applicant.phone,
            child_name: request.applicant.child_name,
            child_first_name: None,
            child_last_name: None,
            child_birth_date: request.applicant.child_birth_date,
            preferred_contact_channel: request.preferred_contact_channel.into(),
            consent_policy_version: request.applicant.consent_policy_version,
        },
        surface: request.source.surface.into(),
        attribution_branch_id: request.source.attribution_branch_id,
        idempotency_digest,
        phone_match_digest,
        request_hash,
        management_token_digest,
        management_key_version: current_key_version,
        consent_evidence: json!({
            "schemaVersion": 1,
            "ipDigest": hex::encode(ip_digest),
            "userAgentDigest": user_agent_digest,
        }),
    };
    let outcome = state
        .db
        .create_public_booking(&tenant, &input)
        .await
        .map_err(map_booking_error)?;
    let response_key = config
        .management_key(outcome.management_key_version)
        .ok_or_else(|| {
            tracing::error!(
                key_version = outcome.management_key_version,
                "AirHub booking replay needs an unavailable management key"
            );
            ApiFailure::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "management_key_unavailable",
                "The booking was saved, but its management link is temporarily unavailable.",
                true,
            )
        })?;
    let (management_token, _) = derive_management_token(
        response_key,
        outcome.management_key_version,
        &community_id,
        &idempotency_digest,
    );
    let replayed = matches!(outcome.disposition, PublicBookingDisposition::Replayed);
    tracing::info!(
        community = %tenant.community(),
        booking_id = %outcome.booking.id,
        replayed,
        "public AirHub booking accepted"
    );
    let status = if replayed {
        StatusCode::OK
    } else {
        StatusCode::CREATED
    };
    let mut response = (
        status,
        Json(PublicBookingResponse {
            booking_id: outcome.booking.id,
            status: booking_status_str(outcome.booking.status),
            lesson_ref: outcome.booking.lesson_ref,
            management_token,
            replayed,
        }),
    )
        .into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

async fn bind_and_rate_limit(
    state: &AppState,
    headers: &HeaderMap,
    peer_ip: Option<IpAddr>,
    namespace: &str,
    quota: PublicQuota,
) -> Result<buzz_core::TenantContext, ApiFailure> {
    let config = state
        .config
        .airhop_public_booking
        .as_ref()
        .ok_or_else(not_found)?;
    let raw_host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let tenant = crate::tenant::bind_community(&state.db, raw_host)
        .await
        .map_err(|_| not_found())?;
    let client_ip = resolve_client_ip(config.client_ip_header(), headers, peer_ip)?;
    let ip_text = client_ip.to_string();
    let digest = tenant_keyed_digest(
        config.index_key(),
        tenant.community().as_uuid(),
        b"airhop.public-booking.ip.v1",
        &[ip_text.as_bytes()],
    );
    let limit = match quota {
        PublicQuota::Read => config.read_requests_per_minute(),
        PublicQuota::Booking => config.ip_requests_per_minute(),
    };
    enforce_rate_limit(state, &tenant, namespace, &digest, 60, limit).await?;
    Ok(tenant)
}

async fn read_management_body(request: Request) -> Result<(Request, Bytes), ApiFailure> {
    let (parts, body) = request.into_parts();
    let body = to_bytes(body, 16 * 1024).await.map_err(|_| {
        ApiFailure::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            "request_too_large",
            "The management request is too large.",
            false,
        )
    })?;
    Ok((Request::from_parts(parts, axum::body::Body::empty()), body))
}

async fn apply_public_management_http_action(
    state: Arc<AppState>,
    request: Request,
    action_name: &'static str,
    canonical_body: &[u8],
    action: buzz_db::airhop::public_management::PublicManagementAction,
) -> Result<Response, ApiFailure> {
    use buzz_db::airhop::public_management::PublicManagementCommand;

    let headers = request.headers();
    let peer_ip = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|value| value.0.ip());
    let tenant = bind_and_rate_limit(
        &state,
        headers,
        peer_ip,
        IP_RATE_NAMESPACE,
        PublicQuota::Booking,
    )
    .await?;
    let credential = parse_management_credential(&state, headers)?;
    let idempotency_key = parse_idempotency_key(headers)?;
    let config = state
        .config
        .airhop_public_booking
        .as_ref()
        .ok_or_else(not_found)?;
    let community_id = *tenant.community().as_uuid();
    let idempotency_digest = tenant_keyed_digest(
        config.index_key(),
        &community_id,
        b"airhop.public-booking.management-idempotency.v1",
        &[action_name.as_bytes(), idempotency_key.as_bytes()],
    );
    let request_hash = tenant_keyed_digest(
        config.index_key(),
        &community_id,
        b"airhop.public-booking.management-request.v1",
        &[
            action_name.as_bytes(),
            &credential.token_digest,
            canonical_body,
        ],
    );
    let card = state
        .db
        .apply_public_management_action(
            &tenant,
            credential,
            PublicManagementCommand {
                idempotency_digest,
                request_hash,
            },
            action,
        )
        .await
        .map_err(map_public_management_error)?;
    no_store_json(public_management_card_response(card))
}

fn parse_management_credential(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<buzz_db::airhop::public_management::PublicManagementCredential, ApiFailure> {
    use buzz_db::airhop::public_management::PublicManagementCredential;

    let mut values = headers.get_all(header::AUTHORIZATION).iter();
    let authorization = values
        .next()
        .and_then(|value| value.to_str().ok())
        .filter(|_| values.next().is_none())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or_else(invalid_management_token)?;
    let version =
        parse_management_token_version(authorization).ok_or_else(invalid_management_token)?;
    let key = state
        .config
        .airhop_public_booking
        .as_ref()
        .and_then(|config| config.management_key(version))
        .ok_or_else(invalid_management_token)?;
    Ok(PublicManagementCredential {
        key_version: version,
        token_digest: keyed_digest(
            key,
            b"airhop.public-booking.management-token-digest.v1",
            &[authorization.as_bytes()],
        ),
    })
}

fn parse_management_token_version(authorization: &str) -> Option<i16> {
    let mut token_parts = authorization.splitn(3, '_');
    let prefix = token_parts.next();
    let version = token_parts
        .next()
        .and_then(|value| value.parse::<i16>().ok())
        .filter(|value| *value > 0);
    let material = token_parts.next();
    if prefix != Some("ahb")
        || material.is_none_or(|value| {
            value.len() != 43
                || !value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        })
    {
        return None;
    }
    version
}

fn public_management_card_response(
    card: buzz_db::airhop::public_management::PublicManagementCard,
) -> PublicManagementCardResponse {
    PublicManagementCardResponse {
        status: booking_status_str(card.status),
        child_name: card.child_name,
        masked_phone: mask_normalized_phone(&card.phone_normalized),
        preferred_contact_channel: contact_channel_str(card.preferred_contact_channel),
        transfer_request: card.transfer_request,
        organization_name: card.organization_name,
        branch_name: card.branch_name,
        branch_address: card.branch_address,
        group_name: card.group_name,
        room_name: card.room_name,
        teacher_names: card.teacher_names,
        date: card.date,
        start_time: card.start_time.format("%H:%M").to_string(),
        end_time: card.end_time.format("%H:%M").to_string(),
        trial_policy: card.trial_policy,
        purpose: card.purpose,
        can_cancel: card.can_cancel,
        can_request_transfer: card.can_request_transfer,
    }
}

fn mask_normalized_phone(value: &str) -> String {
    let digits = value.strip_prefix('+').unwrap_or(value);
    if digits.len() < 5 {
        return "••••".to_owned();
    }
    let prefix_length = 2.min(digits.len().saturating_sub(4));
    let prefix = &digits[..prefix_length];
    let tail = &digits[digits.len() - 4..];
    format!("+{prefix} ••• ••• {} {}", &tail[..2], &tail[2..])
}

const fn contact_channel_str(value: PreferredContactChannel) -> &'static str {
    match value {
        PreferredContactChannel::Telegram => "telegram",
        PreferredContactChannel::Max => "max",
        PreferredContactChannel::Whatsapp => "whatsapp",
        PreferredContactChannel::Phone => "phone",
        PreferredContactChannel::None => "none",
    }
}

fn public_occurrence_filters(
    query: PublicOccurrenceQuery,
) -> Result<buzz_db::airhop::public_read::PublicBookingOccurrenceFilters, ApiFailure> {
    use buzz_db::airhop::public_read::{PublicBookingAgeFilter, PublicBookingOccurrenceFilters};

    if query.age_years.is_some() && (query.birth_year.is_some() || query.birth_month.is_some()) {
        return Err(invalid_query());
    }
    let age = match (query.age_years, query.birth_year, query.birth_month) {
        (Some(years), None, None) if years <= 120 => {
            Some(PublicBookingAgeFilter::CompletedYears(years))
        }
        (None, Some(year), Some(month))
            if (1900..=9999).contains(&year) && (1..=12).contains(&month) =>
        {
            Some(PublicBookingAgeFilter::BirthMonth { year, month })
        }
        (None, None, None) => None,
        _ => return Err(invalid_query()),
    };
    Ok(PublicBookingOccurrenceFilters {
        branch_id: query.branch_id,
        group_id: query.group_id,
        purpose: query.purpose,
        age,
    })
}

fn no_store_json<T: Serialize>(value: T) -> Result<Response, ApiFailure> {
    let mut response = Json(value).into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

const fn default_public_purpose() -> PublicBookingPurpose {
    PublicBookingPurpose::Trial
}

const fn invalid_query() -> ApiFailure {
    ApiFailure::new(
        StatusCode::BAD_REQUEST,
        "invalid_query",
        "The occurrence query is invalid.",
        false,
    )
}

const fn not_found() -> ApiFailure {
    ApiFailure::new(
        StatusCode::NOT_FOUND,
        "not_found",
        "The requested resource was not found.",
        false,
    )
}

fn map_public_read_error(error: buzz_db::DbError) -> ApiFailure {
    match error {
        buzz_db::DbError::NotFound(_) => not_found(),
        buzz_db::DbError::InvalidData(_) => invalid_query(),
        internal => {
            tracing::error!(error = %internal, "AirHub public read failed");
            internal_failure()
        }
    }
}

fn map_public_management_error(error: buzz_db::DbError) -> ApiFailure {
    match error {
        buzz_db::DbError::NotFound(_) => invalid_management_token(),
        buzz_db::DbError::AirhopBookingTransition => ApiFailure::new(
            StatusCode::CONFLICT,
            "booking_transition_invalid",
            "The booking can no longer be changed.",
            false,
        ),
        other => map_booking_error(other),
    }
}

const fn invalid_management_token() -> ApiFailure {
    ApiFailure::new(
        StatusCode::UNAUTHORIZED,
        "management_token_invalid",
        "The booking management link is invalid or unavailable.",
        false,
    )
}

async fn enforce_rate_limit(
    state: &AppState,
    tenant: &buzz_core::TenantContext,
    namespace: &str,
    digest: &[u8; 32],
    window_secs: u64,
    limit: u64,
) -> Result<(), ApiFailure> {
    let outcome = state
        .admission_rate_limiter
        .check_scoped_anonymous(tenant, namespace, digest, window_secs, limit)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, "AirHub public booking rate limiter unavailable");
            ApiFailure::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "rate_limiter_unavailable",
                "Booking is temporarily unavailable. Please try again later.",
                true,
            )
        })?;
    if outcome.allowed {
        Ok(())
    } else {
        Err(ApiFailure::rate_limited(outcome.reset_in_secs.max(1)))
    }
}

fn parse_idempotency_key(headers: &HeaderMap) -> Result<String, ApiFailure> {
    let mut values = headers.get_all(IDEMPOTENCY_HEADER).iter();
    let key = values
        .next()
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| {
            values.next().is_none()
                && (16..=200).contains(&value.len())
                && value.bytes().all(|byte| byte.is_ascii_graphic())
        })
        .ok_or_else(|| {
            ApiFailure::new(
                StatusCode::BAD_REQUEST,
                "idempotency_key_required",
                "A valid Idempotency-Key header is required.",
                false,
            )
        })?;
    Ok(key.to_owned())
}

fn resolve_client_ip(
    trusted_header: Option<&HeaderName>,
    headers: &HeaderMap,
    peer_ip: Option<IpAddr>,
) -> Result<IpAddr, ApiFailure> {
    if let Some(header_name) = trusted_header {
        let mut values = headers.get_all(header_name).iter();
        return values
            .next()
            .and_then(|value| value.to_str().ok())
            .filter(|value| values.next().is_none() && !value.contains(','))
            .and_then(|value| value.trim().parse().ok())
            .ok_or_else(|| {
                ApiFailure::new(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "client_address_unavailable",
                    "Booking is temporarily unavailable. Please try again later.",
                    true,
                )
            });
    }
    peer_ip.ok_or_else(|| {
        ApiFailure::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "client_address_unavailable",
            "Booking is temporarily unavailable. Please try again later.",
            true,
        )
    })
}

fn validate_consent(accepted: bool, policy_version: &str) -> Result<(), ApiFailure> {
    if !accepted {
        return Err(ApiFailure::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "consent_required",
            "Consent is required to submit a booking request.",
            false,
        ));
    }
    if policy_version != CONSENT_POLICY_VERSION {
        return Err(ApiFailure::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "consent_policy_outdated",
            "The consent policy has changed. Please review it and try again.",
            false,
        ));
    }
    Ok(())
}

fn normalize_public_phone(value: &str) -> Result<String, ApiFailure> {
    if value.chars().any(|character| character.is_alphabetic()) {
        return Err(invalid_phone());
    }
    let digits = value.bytes().filter(u8::is_ascii_digit).collect::<Vec<_>>();
    let normalized = if digits.len() == 10 {
        let mut russian = Vec::with_capacity(11);
        russian.push(b'7');
        russian.extend_from_slice(&digits);
        russian
    } else if digits.len() == 11 && digits.first() == Some(&b'8') {
        let mut russian = digits;
        russian[0] = b'7';
        russian
    } else {
        digits
    };
    if !(10..=15).contains(&normalized.len()) || normalized.first() == Some(&b'0') {
        return Err(invalid_phone());
    }
    let digits = String::from_utf8(normalized).map_err(|_| invalid_phone())?;
    Ok(format!("+{digits}"))
}

/// Shares public-booking phone semantics with authenticated staff commands.
pub(crate) fn normalize_airhop_phone(value: &str) -> Option<String> {
    normalize_public_phone(value).ok()
}

/// Produces the same tenant-scoped phone match key used by public booking.
pub(crate) fn airhop_phone_match_digest(
    index_key: &[u8; 32],
    community_id: &Uuid,
    phone_normalized: &str,
) -> [u8; 32] {
    tenant_keyed_digest(
        index_key,
        community_id,
        b"airhop.public-booking.phone.v1",
        &[phone_normalized.as_bytes()],
    )
}

const fn invalid_phone() -> ApiFailure {
    ApiFailure::new(
        StatusCode::UNPROCESSABLE_ENTITY,
        "phone_invalid",
        "The phone number is invalid.",
        false,
    )
}

fn keyed_digest(key: &[u8; 32], domain: &[u8], components: &[&[u8]]) -> [u8; 32] {
    let mut mac = <HmacSha256 as KeyInit>::new_from_slice(key)
        .expect("HMAC accepts keys of every length, including 32 bytes");
    mac.update(&(domain.len() as u64).to_be_bytes());
    mac.update(domain);
    for component in components {
        mac.update(&(component.len() as u64).to_be_bytes());
        mac.update(component);
    }
    mac.finalize().into_bytes().into()
}

fn tenant_keyed_digest(
    key: &[u8; 32],
    community_id: &Uuid,
    domain: &[u8],
    components: &[&[u8]],
) -> [u8; 32] {
    let mut scoped_components = Vec::with_capacity(components.len() + 1);
    scoped_components.push(community_id.as_bytes().as_slice());
    scoped_components.extend_from_slice(components);
    keyed_digest(key, domain, &scoped_components)
}

fn derive_management_token(
    key: &[u8; 32],
    key_version: i16,
    community_id: &Uuid,
    idempotency_digest: &[u8; 32],
) -> (String, [u8; 32]) {
    let token_material = keyed_digest(
        key,
        b"airhop.public-booking.management-token.v1",
        &[community_id.as_bytes(), idempotency_digest],
    );
    let token = format!(
        "ahb_{key_version}_{}",
        URL_SAFE_NO_PAD.encode(token_material)
    );
    let token_digest = keyed_digest(
        key,
        b"airhop.public-booking.management-token-digest.v1",
        &[token.as_bytes()],
    );
    (token, token_digest)
}

fn map_booking_error(error: buzz_db::DbError) -> ApiFailure {
    use buzz_db::DbError;

    match error {
        DbError::AirhopIdempotencyConflict => ApiFailure::new(
            StatusCode::CONFLICT,
            "idempotency_conflict",
            "The Idempotency-Key was already used for another request.",
            false,
        ),
        DbError::AirhopCommandInProgress => ApiFailure::new(
            StatusCode::CONFLICT,
            "booking_in_progress",
            "An identical booking request is still being processed.",
            true,
        ),
        DbError::AirhopCommandPreviouslyFailed => ApiFailure::new(
            StatusCode::CONFLICT,
            "booking_previously_failed",
            "This booking request previously failed.",
            false,
        ),
        DbError::AirhopOccurrenceUnavailable | DbError::NotFound(_) => ApiFailure::new(
            StatusCode::CONFLICT,
            "occurrence_unavailable",
            "The selected lesson is no longer available.",
            false,
        ),
        DbError::AirhopAgeMismatch => ApiFailure::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "age_mismatch",
            "The child does not match the lesson age limits.",
            false,
        ),
        DbError::AirhopCapacityFull => ApiFailure::new(
            StatusCode::CONFLICT,
            "capacity_full",
            "The selected lesson has no available places.",
            false,
        ),
        DbError::AirhopVisitDisabled => ApiFailure::new(
            StatusCode::CONFLICT,
            "visit_disabled",
            "Public booking is disabled for the selected lesson.",
            false,
        ),
        DbError::AirhopBookingConflict => ApiFailure::new(
            StatusCode::CONFLICT,
            "booking_conflict",
            "The booking conflicts with an existing reservation.",
            false,
        ),
        DbError::InvalidData(_) => ApiFailure::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_booking",
            "The booking request is invalid.",
            false,
        ),
        internal => {
            tracing::error!(error = %internal, "AirHub public booking failed");
            internal_failure()
        }
    }
}

const fn internal_failure() -> ApiFailure {
    ApiFailure::new(
        StatusCode::INTERNAL_SERVER_ERROR,
        "internal_error",
        "The booking could not be completed.",
        true,
    )
}

const fn booking_status_str(status: BookingStatus) -> &'static str {
    match status {
        BookingStatus::PendingConfirmation => "pending_confirmation",
        BookingStatus::Confirmed => "confirmed",
        BookingStatus::Rejected => "rejected",
        BookingStatus::CancelledByParent => "cancelled_by_parent",
        BookingStatus::CancelledByCenter => "cancelled_by_center",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::CommunityId;

    #[test]
    fn phone_normalization_matches_the_russian_public_form_contract() {
        assert_eq!(
            normalize_public_phone("8 (999) 123-45-67").expect("Russian phone"),
            "+79991234567"
        );
        assert_eq!(
            normalize_public_phone("+44 20 7946 0958").expect("international phone"),
            "+442079460958"
        );
        assert!(normalize_public_phone("call +7 999 123 45 67").is_err());
    }

    #[test]
    fn hmac_domains_and_tenants_separate_private_indexes() {
        let key = [7; 32];
        let value = b"same-input";
        let first_tenant = Uuid::from_u128(1);
        let second_tenant = Uuid::from_u128(2);
        let phone = tenant_keyed_digest(&key, &first_tenant, b"phone", &[value]);
        let ip = tenant_keyed_digest(&key, &first_tenant, b"ip", &[value]);
        let other_tenant = tenant_keyed_digest(&key, &second_tenant, b"phone", &[value]);
        assert_ne!(phone, ip);
        assert_ne!(phone, other_tenant);
        assert_eq!(
            phone,
            tenant_keyed_digest(&key, &first_tenant, b"phone", &[value])
        );
    }

    #[test]
    fn management_tokens_are_deterministic_scoped_and_versioned() {
        let key = [9; 32];
        let idempotency = [3; 32];
        let community = Uuid::from_u128(1);
        let first = derive_management_token(&key, 2, &community, &idempotency);
        let replay = derive_management_token(&key, 2, &community, &idempotency);
        let other_tenant = derive_management_token(
            &key,
            2,
            CommunityId::from_uuid(Uuid::from_u128(2)).as_uuid(),
            &idempotency,
        );
        assert_eq!(first, replay);
        assert_ne!(first, other_tenant);
        assert!(first.0.starts_with("ahb_2_"));
        assert!(!first.0.contains('='));
    }

    #[test]
    fn management_token_parser_accepts_url_safe_underscores_in_material() {
        let token = format!("ahb_2_{}", "a_b".repeat(14) + "a");
        assert_eq!(token.len(), 49);
        assert_eq!(parse_management_token_version(&token), Some(2));
        assert_eq!(
            parse_management_token_version("ahb_0_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
            None
        );
        assert_eq!(parse_management_token_version("ahb_2_short"), None);
    }

    #[test]
    fn idempotency_header_is_bounded_and_required() {
        let mut headers = HeaderMap::new();
        assert_eq!(
            parse_idempotency_key(&headers)
                .expect_err("missing key")
                .code,
            "idempotency_key_required"
        );
        headers.insert(
            IDEMPOTENCY_HEADER,
            HeaderValue::from_static("request-1234567890"),
        );
        assert_eq!(
            parse_idempotency_key(&headers).expect("valid key"),
            "request-1234567890"
        );
        headers.append(
            IDEMPOTENCY_HEADER,
            HeaderValue::from_static("request-0987654321"),
        );
        assert!(parse_idempotency_key(&headers).is_err());
    }

    #[test]
    fn trusted_client_header_must_contain_one_exact_ip() {
        let name = HeaderName::from_static("x-envoy-external-address");
        let mut headers = HeaderMap::new();
        headers.insert(&name, HeaderValue::from_static("203.0.113.9"));
        assert_eq!(
            resolve_client_ip(Some(&name), &headers, Some(IpAddr::from([127, 0, 0, 1])))
                .expect("configured header"),
            IpAddr::from([203, 0, 113, 9])
        );
        headers.insert(&name, HeaderValue::from_static("203.0.113.9, 10.0.0.1"));
        assert!(resolve_client_ip(Some(&name), &headers, None).is_err());
        headers.insert(&name, HeaderValue::from_static("203.0.113.9"));
        headers.append(&name, HeaderValue::from_static("203.0.113.10"));
        assert!(resolve_client_ip(Some(&name), &headers, None).is_err());
    }

    #[test]
    fn consent_requires_acceptance_of_the_server_supported_policy() {
        assert!(validate_consent(true, CONSENT_POLICY_VERSION).is_ok());
        assert_eq!(
            validate_consent(false, CONSENT_POLICY_VERSION)
                .expect_err("acceptance required")
                .code,
            "consent_required"
        );
        assert_eq!(
            validate_consent(true, "attacker-selected-policy")
                .expect_err("policy must match")
                .code,
            "consent_policy_outdated"
        );
    }

    #[test]
    fn public_responses_are_not_cacheable() {
        let response = ApiFailure::rate_limited(60).into_response();
        assert_eq!(
            response.headers().get(header::CACHE_CONTROL),
            Some(&HeaderValue::from_static("no-store"))
        );
    }

    #[test]
    fn management_projection_masks_phone_and_cancel_body_rejects_fields() {
        assert_eq!(mask_normalized_phone("+79991234567"), "+79 ••• ••• 45 67");
        assert_eq!(mask_normalized_phone("1234"), "••••");
        assert!(serde_json::from_slice::<EmptyManagementBody>(b"{}").is_ok());
        assert!(serde_json::from_slice::<EmptyManagementBody>(b"{\"token\":\"leak\"}").is_err());
    }

    #[test]
    fn database_failures_map_to_stable_public_codes() {
        assert_eq!(
            map_booking_error(buzz_db::DbError::AirhopCapacityFull).code,
            "capacity_full"
        );
        assert_eq!(
            map_booking_error(buzz_db::DbError::AirhopIdempotencyConflict).code,
            "idempotency_conflict"
        );
        assert_eq!(
            map_booking_error(buzz_db::DbError::AirhopIdentityMismatch).code,
            "internal_error"
        );
    }

    #[test]
    fn occurrence_query_rejects_ambiguous_or_incomplete_age_inputs() {
        let valid = public_occurrence_filters(PublicOccurrenceQuery {
            branch_id: Some(Uuid::from_u128(1)),
            group_id: None,
            age_years: Some(6),
            birth_year: None,
            birth_month: None,
            purpose: PublicBookingPurpose::Trial,
        })
        .expect("completed age filter");
        assert!(matches!(
            valid.age,
            Some(buzz_db::airhop::public_read::PublicBookingAgeFilter::CompletedYears(6))
        ));

        for invalid in [
            PublicOccurrenceQuery {
                branch_id: None,
                group_id: None,
                age_years: Some(6),
                birth_year: Some(2020),
                birth_month: Some(8),
                purpose: PublicBookingPurpose::Trial,
            },
            PublicOccurrenceQuery {
                branch_id: None,
                group_id: None,
                age_years: None,
                birth_year: Some(2020),
                birth_month: None,
                purpose: PublicBookingPurpose::Trial,
            },
            PublicOccurrenceQuery {
                branch_id: None,
                group_id: None,
                age_years: Some(121),
                birth_year: None,
                birth_month: None,
                purpose: PublicBookingPurpose::Trial,
            },
        ] {
            assert!(public_occurrence_filters(invalid).is_err());
        }
    }
}
