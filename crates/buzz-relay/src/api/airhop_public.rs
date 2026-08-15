//! Unauthenticated, abuse-controlled HTTP boundary for public AirHub booking.

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use airhop_core::{BookingStatus, StableLessonReference};
use axum::body::{to_bytes, Bytes};
use axum::extract::{ConnectInfo, Request, State};
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
const CONSENT_POLICY_VERSION: &str = "public-booking-v1";

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
    let config = state.config.airhop_public_booking.as_ref().ok_or_else(|| {
        ApiFailure::new(
            StatusCode::NOT_FOUND,
            "not_found",
            "The requested resource was not found.",
            false,
        )
    })?;
    let raw_host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let tenant = crate::tenant::bind_community(&state.db, raw_host)
        .await
        .map_err(|_| {
            ApiFailure::new(
                StatusCode::NOT_FOUND,
                "not_found",
                "The requested resource was not found.",
                false,
            )
        })?;
    let community_id = *tenant.community().as_uuid();
    let client_ip = resolve_client_ip(config.client_ip_header(), &headers, peer_ip)?;
    let ip_digest = tenant_keyed_digest(
        config.index_key(),
        &community_id,
        b"airhop.public-booking.ip.v1",
        &[client_ip.to_string().as_bytes()],
    );
    enforce_rate_limit(
        &state,
        &tenant,
        IP_RATE_NAMESPACE,
        &ip_digest,
        60,
        config.ip_requests_per_minute(),
    )
    .await?;

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
            phone_normalized,
            phone_display: request.applicant.phone,
            child_name: request.applicant.child_name,
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
}
