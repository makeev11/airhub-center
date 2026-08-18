//! Authenticated AirHub staff decisions and private connector delivery API.

use std::collections::BTreeMap;
use std::sync::Arc;

use airhop_core::{
    BookingStatus, ExistingStudentsOnboardingStatus, NullableOverride, OccurrenceOverride,
    OrganizationSettings, PublicBookingAppearance, PublicBookingPurpose, StableLessonReference,
    TrialPolicy, Weekday,
};
use axum::body::Bytes;
use axum::extract::rejection::QueryRejection;
use axum::extract::{Path, Query, RawQuery, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::Json;
use buzz_db::airhop::booking::BookingVisitKind;
use buzz_db::airhop::booking_decision::{
    BindMessengerAccountInput, BookingDecision, DecideBookingInput, DeliveryAckState,
    DeliveryCompletion, ParentNotificationRoute,
};
use buzz_db::airhop::branch_directory::{
    AirhopBranch, BranchStatus, BranchWorkingPeriod, CreateBranchInput, PutBranchInput,
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
use buzz_db::airhop::group_directory::{
    AirhopGroup, AirhopRecurrenceRule, CreateGroupInput, GroupDefinition, GroupStatus,
    PutGroupInput, RecurrenceRuleInput,
};
use buzz_db::airhop::lesson_exception::{
    AirhopLessonException, LessonExceptionChange, PutLessonExceptionInput,
};
use buzz_db::airhop::lesson_participants::{
    AddStaffLessonParticipantInput, EnrollStaffTrialParticipantInput, EnrollmentScheduleSelection,
    LessonAttendanceStatus, SetStaffLessonAttendanceInput, StaffLessonParticipantClient,
    StaffLessonRoster,
};
use buzz_db::airhop::organization_settings::PutOrganizationSettingsInput;
use buzz_db::airhop::payment_queue::{MutatePaymentInput, PaymentChange, StaffPaymentQueueItem};
use buzz_db::airhop::public_booking::{PreferredContactChannel, PublicBookingApplicant};
use buzz_db::airhop::room_directory::{AirhopRoom, CreateRoomInput, PutRoomInput, RoomStatus};
use buzz_db::airhop::staff_queue::{
    StaffBookingQueueCursor, StaffBookingQueueFilter, StaffBookingQueueRow,
};
use buzz_db::airhop::tariff_directory::{
    AirhopTariff, CreateTariffInput, PutTariffInput, TariffStatus,
};
use buzz_db::airhop::{ActorKind, AirhopActor};
use chrono::{DateTime, NaiveTime, Utc};
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
pub(crate) struct PutOrganizationSettingsBody {
    expected_version: i64,
    name: String,
    locale: String,
    time_zone: String,
    #[serde(default)]
    payments_buzz_channel_id: Option<Uuid>,
    default_trial_policy: TrialPolicy,
    track_attendance_by_default: bool,
    allow_single_visits_by_default: bool,
    existing_students_onboarding_status: ExistingStudentsOnboardingStatus,
    public_booking_purpose: PublicBookingPurpose,
    public_booking_appearance: PublicBookingAppearance,
    payment_day_of_month: u8,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BranchWorkingPeriodBody {
    start_time: String,
    end_time: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateBranchBody {
    name: String,
    address: String,
    working_hours: BTreeMap<Weekday, Vec<BranchWorkingPeriodBody>>,
    #[serde(default)]
    default_buzz_channel_id: Option<Uuid>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PutBranchBody {
    expected_version: i64,
    name: String,
    address: String,
    working_hours: BTreeMap<Weekday, Vec<BranchWorkingPeriodBody>>,
    #[serde(default)]
    default_buzz_channel_id: Option<Uuid>,
    status: BranchStatus,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateRoomBody {
    name: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PutRoomBody {
    expected_version: i64,
    name: String,
    status: RoomStatus,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct GroupDefinitionBody {
    branch_id: Uuid,
    #[serde(default)]
    room_id: Option<Uuid>,
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    teacher_ids: Vec<Uuid>,
    #[serde(default)]
    min_age_months: Option<i32>,
    #[serde(default)]
    max_age_months: Option<i32>,
    #[serde(default)]
    capacity: Option<i32>,
    #[serde(default)]
    trial_policy_override: Option<TrialPolicy>,
    #[serde(default)]
    track_attendance_override: Option<bool>,
    #[serde(default)]
    allow_single_visits_override: Option<bool>,
    status: GroupStatus,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RecurrenceRuleBody {
    #[serde(default)]
    id: Option<Uuid>,
    starts_on: chrono::NaiveDate,
    ends_on: chrono::NaiveDate,
    weekdays: Vec<Weekday>,
    start_time: String,
    end_time: String,
    #[serde(default)]
    branch_id_override: Option<Uuid>,
    #[serde(default)]
    room_override_set: bool,
    #[serde(default)]
    room_id_override: Option<Uuid>,
    #[serde(default)]
    teacher_ids_override: Option<Vec<Uuid>>,
    #[serde(default)]
    capacity_override_set: bool,
    #[serde(default)]
    capacity_override: Option<i32>,
    #[serde(default)]
    trial_policy_override: Option<TrialPolicy>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateGroupBody {
    group: GroupDefinitionBody,
    active_rules: Vec<RecurrenceRuleBody>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PutGroupBody {
    expected_version: i64,
    group: GroupDefinitionBody,
    active_rules: Vec<RecurrenceRuleBody>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LessonOverrideBody {
    #[serde(default)]
    date: Option<chrono::NaiveDate>,
    #[serde(default)]
    start_time: Option<String>,
    #[serde(default)]
    end_time: Option<String>,
    #[serde(default)]
    branch_id: Option<Uuid>,
    #[serde(default)]
    room_override_set: bool,
    #[serde(default)]
    room_id: Option<Uuid>,
    #[serde(default)]
    teacher_ids: Option<Vec<Uuid>>,
    #[serde(default)]
    capacity_override_set: bool,
    #[serde(default)]
    capacity: Option<u32>,
    #[serde(default)]
    trial_policy: Option<TrialPolicy>,
    #[serde(default)]
    allow_single_visits: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(
    tag = "action",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum PutLessonExceptionBody {
    Cancel {
        expected_version: i64,
        #[serde(default)]
        reason: Option<String>,
    },
    Override {
        expected_version: i64,
        r#override: LessonOverrideBody,
        #[serde(default)]
        reason: Option<String>,
    },
    Restore {
        expected_version: i64,
    },
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum StaffLessonVisitKindBody {
    Trial,
    Single,
}

impl From<StaffLessonVisitKindBody> for BookingVisitKind {
    fn from(value: StaffLessonVisitKindBody) -> Self {
        match value {
            StaffLessonVisitKindBody::Trial => Self::Trial,
            StaffLessonVisitKindBody::Single => Self::Single,
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(
    tag = "mode",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum StaffLessonParticipantClientBody {
    Existing {
        family_id: Uuid,
        representative_id: Uuid,
        child_id: Uuid,
    },
    New {
        parent_name: String,
        phone: String,
        child_name: String,
        child_birth_date: chrono::NaiveDate,
    },
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AddLessonParticipantBody {
    client: StaffLessonParticipantClientBody,
    visit_kind: StaffLessonVisitKindBody,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PutLessonAttendanceBody {
    expected_version: i64,
    status: Option<LessonAttendanceStatus>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct EnrollmentScheduleSelectionBody {
    recurrence_rule_id: Uuid,
    weekday: Weekday,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct EnrollTrialParticipantBody {
    tariff_id: Uuid,
    start_date: chrono::NaiveDate,
    schedule: Vec<EnrollmentScheduleSelectionBody>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateTariffBody {
    name: String,
    #[serde(default)]
    description: Option<String>,
    price_minor: i64,
    currency: String,
    weekly_schedule_limit: i16,
    #[serde(default)]
    payment_day_of_month: Option<i16>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PutTariffBody {
    expected_version: i64,
    name: String,
    #[serde(default)]
    description: Option<String>,
    price_minor: i64,
    currency: String,
    weekly_schedule_limit: i16,
    #[serde(default)]
    payment_day_of_month: Option<i16>,
    status: TariffStatus,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(
    tag = "action",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum MutatePaymentBody {
    MarkPaid {
        expected_version: i64,
    },
    Cancel {
        expected_version: i64,
        reason: String,
    },
    Restore {
        expected_version: i64,
        reason: String,
    },
    ChangeAmount {
        expected_version: i64,
        amount_minor: i64,
    },
    MoveDueDate {
        expected_version: i64,
        due_date: chrono::NaiveDate,
        reason: String,
    },
}

impl MutatePaymentBody {
    const fn expected_version(&self) -> i64 {
        match self {
            Self::MarkPaid { expected_version }
            | Self::Cancel {
                expected_version, ..
            }
            | Self::Restore {
                expected_version, ..
            }
            | Self::ChangeAmount {
                expected_version, ..
            }
            | Self::MoveDueDate {
                expected_version, ..
            } => *expected_version,
        }
    }

    fn into_change(self) -> PaymentChange {
        match self {
            Self::MarkPaid { .. } => PaymentChange::MarkPaid,
            Self::Cancel { reason, .. } => PaymentChange::Cancel { reason },
            Self::Restore { reason, .. } => PaymentChange::Restore { reason },
            Self::ChangeAmount { amount_minor, .. } => PaymentChange::ChangeAmount { amount_minor },
            Self::MoveDueDate {
                due_date, reason, ..
            } => PaymentChange::MoveDueDate { due_date, reason },
        }
    }
}

struct ParsedLessonExceptionBody {
    expected_version: i64,
    change: LessonExceptionChange,
    reason: Option<String>,
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
#[serde(
    tag = "outcome",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
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

/// Staff-only authoritative organization settings.
pub(crate) async fn get_organization_settings(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = "/api/airhop/staff/v1/settings";
    let (tenant, _) = authenticate(&state, &headers, "GET", path, None, Access::Staff).await?;
    let organization = state
        .db
        .get_airhop_organization(&tenant)
        .await
        .map_err(map_db_error)?
        .ok_or_else(|| {
            api_error(
                StatusCode::NOT_FOUND,
                "AirHub organization is not configured",
            )
        })?;
    Ok(Json(organization_settings_payload(
        organization_json(
            organization.id,
            &organization.name,
            &organization.locale,
            &organization.time_zone,
            organization.payments_buzz_channel_id,
            &organization.settings,
        ),
        organization.version,
        false,
    )))
}

/// Idempotently bootstraps or replaces authoritative organization settings.
pub(crate) async fn put_organization_settings(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = "/api/airhop/staff/v1/settings";
    let (tenant, pubkey) =
        authenticate(&state, &headers, "PUT", path, Some(&body), Access::Staff).await?;
    let request: PutOrganizationSettingsBody = parse_body(&body)?;
    let idempotency_key = require_idempotency_key(&headers)?;
    let key = command_key(&state);
    let input = PutOrganizationSettingsInput {
        expected_version: request.expected_version,
        name: request.name.trim().to_owned(),
        locale: request.locale.trim().to_owned(),
        time_zone: request.time_zone.trim().to_owned(),
        payments_buzz_channel_id: request.payments_buzz_channel_id,
        settings: OrganizationSettings {
            default_trial_policy: request.default_trial_policy,
            track_attendance_by_default: request.track_attendance_by_default,
            allow_single_visits_by_default: request.allow_single_visits_by_default,
            existing_students_onboarding_status: request.existing_students_onboarding_status,
            public_booking_purpose: request.public_booking_purpose,
            public_booking_appearance: request.public_booking_appearance,
            payment_day_of_month: request.payment_day_of_month,
        },
        idempotency_digest: scoped_digest(
            &key,
            b"airhop.staff.organization-settings.idempotency.v1",
            tenant.community().as_uuid(),
            &pubkey.to_bytes(),
            idempotency_key.as_bytes(),
        )?,
        request_hash: Sha256::digest(&body).into(),
        actor: staff_actor(pubkey),
    };
    let outcome = state
        .db
        .put_airhop_organization_settings(&tenant, &input)
        .await
        .map_err(map_db_error)?;
    Ok(Json(organization_settings_payload(
        organization_json(
            outcome.organization_id,
            &input.name,
            &input.locale,
            &input.time_zone,
            input.payments_buzz_channel_id,
            &input.settings,
        ),
        outcome.version,
        outcome.replayed,
    )))
}

/// Authoritative active and archived reusable tariff directory.
pub(crate) async fn list_tariffs(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = "/api/airhop/staff/v1/tariffs";
    let (tenant, _) = authenticate(&state, &headers, "GET", path, None, Access::Staff).await?;
    let organization = state
        .db
        .get_airhop_organization(&tenant)
        .await
        .map_err(map_db_error)?
        .ok_or_else(|| {
            api_error(
                StatusCode::NOT_FOUND,
                "AirHub organization is not configured",
            )
        })?;
    let tariffs = state
        .db
        .list_airhop_tariffs(&tenant)
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "organization": organization_json(
            organization.id,
            &organization.name,
            &organization.locale,
            &organization.time_zone,
            organization.payments_buzz_channel_id,
            &organization.settings,
        ),
        "organizationVersion": organization.version,
        "items": tariffs.iter().map(tariff_json).collect::<Vec<_>>(),
    })))
}

/// Idempotently creates one tenant-scoped reusable tariff.
pub(crate) async fn create_tariff(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = "/api/airhop/staff/v1/tariffs";
    let (tenant, pubkey) =
        authenticate(&state, &headers, "POST", path, Some(&body), Access::Staff).await?;
    let request: CreateTariffBody = parse_body(&body)?;
    let idempotency_key = require_idempotency_key(&headers)?;
    let key = command_key(&state);
    let outcome = state
        .db
        .create_airhop_tariff(
            &tenant,
            &CreateTariffInput {
                name: request.name.trim().to_owned(),
                description: trimmed_optional(request.description),
                price_minor: request.price_minor,
                currency: request.currency.trim().to_ascii_uppercase(),
                weekly_schedule_limit: request.weekly_schedule_limit,
                payment_day_of_month: request.payment_day_of_month,
                idempotency_digest: scoped_digest(
                    &key,
                    b"airhop.staff.tariff.idempotency.v1",
                    tenant.community().as_uuid(),
                    &pubkey.to_bytes(),
                    idempotency_key.as_bytes(),
                )?,
                request_hash: command_request_hash("POST", path, &body),
                actor: staff_actor(pubkey),
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "tariffId": outcome.tariff_id,
        "version": outcome.version,
        "replayed": outcome.replayed,
    })))
}

/// Optimistically updates, archives, or restores one reusable tariff.
pub(crate) async fn put_tariff(
    State(state): State<Arc<AppState>>,
    Path(tariff_id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("/api/airhop/staff/v1/tariffs/{tariff_id}");
    let (tenant, pubkey) =
        authenticate(&state, &headers, "PUT", &path, Some(&body), Access::Staff).await?;
    let request: PutTariffBody = parse_body(&body)?;
    let idempotency_key = require_idempotency_key(&headers)?;
    let key = command_key(&state);
    let outcome = state
        .db
        .put_airhop_tariff(
            &tenant,
            &PutTariffInput {
                tariff_id,
                expected_version: request.expected_version,
                name: request.name.trim().to_owned(),
                description: trimmed_optional(request.description),
                price_minor: request.price_minor,
                currency: request.currency.trim().to_ascii_uppercase(),
                weekly_schedule_limit: request.weekly_schedule_limit,
                payment_day_of_month: request.payment_day_of_month,
                status: request.status,
                idempotency_digest: scoped_digest(
                    &key,
                    b"airhop.staff.tariff.idempotency.v1",
                    tenant.community().as_uuid(),
                    &pubkey.to_bytes(),
                    idempotency_key.as_bytes(),
                )?,
                request_hash: command_request_hash("PUT", &path, &body),
                actor: staff_actor(pubkey),
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "tariffId": outcome.tariff_id,
        "version": outcome.version,
        "replayed": outcome.replayed,
    })))
}

/// Authoritative payment work queue and retained decision history.
pub(crate) async fn list_payments(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = "/api/airhop/staff/v1/payments";
    let (tenant, _) = authenticate(&state, &headers, "GET", path, None, Access::Staff).await?;
    let organization = state
        .db
        .get_airhop_organization(&tenant)
        .await
        .map_err(map_db_error)?
        .ok_or_else(|| {
            api_error(
                StatusCode::NOT_FOUND,
                "AirHub organization is not configured",
            )
        })?;
    let items: Vec<StaffPaymentQueueItem> = state
        .db
        .list_airhop_staff_payments(&tenant)
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "organization": organization_json(
            organization.id,
            &organization.name,
            &organization.locale,
            &organization.time_zone,
            organization.payments_buzz_channel_id,
            &organization.settings,
        ),
        "items": items,
    })))
}

/// Currency-safe payment analytics calculated from authoritative expectations.
pub(crate) async fn get_payment_analytics(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = "/api/airhop/staff/v1/payment-analytics";
    let (tenant, _) = authenticate(&state, &headers, "GET", path, None, Access::Staff).await?;
    let organization = state
        .db
        .get_airhop_organization(&tenant)
        .await
        .map_err(map_db_error)?
        .ok_or_else(|| {
            api_error(
                StatusCode::NOT_FOUND,
                "AirHub organization is not configured",
            )
        })?;
    let analytics = state
        .db
        .get_airhop_staff_payment_analytics(&tenant)
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "organization": organization_json(
            organization.id,
            &organization.name,
            &organization.locale,
            &organization.time_zone,
            organization.payments_buzz_channel_id,
            &organization.settings,
        ),
        "analytics": analytics,
    })))
}

/// Idempotently changes one expected payment or its lifecycle.
pub(crate) async fn mutate_payment(
    State(state): State<Arc<AppState>>,
    Path(payment_id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("/api/airhop/staff/v1/payments/{payment_id}");
    let (tenant, pubkey) =
        authenticate(&state, &headers, "PUT", &path, Some(&body), Access::Staff).await?;
    let request: MutatePaymentBody = parse_body(&body)?;
    let expected_version = request.expected_version();
    let idempotency_key = require_idempotency_key(&headers)?;
    let key = command_key(&state);
    let outcome = state
        .db
        .mutate_airhop_payment(
            &tenant,
            &MutatePaymentInput {
                payment_id,
                expected_version,
                change: request.into_change(),
                idempotency_digest: scoped_digest(
                    &key,
                    b"airhop.staff.payment.idempotency.v1",
                    tenant.community().as_uuid(),
                    &pubkey.to_bytes(),
                    idempotency_key.as_bytes(),
                )?,
                request_hash: command_request_hash("PUT", &path, &body),
                actor: staff_actor(pubkey),
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "paymentId": outcome.payment_id,
        "version": outcome.version,
        "replayed": outcome.replayed,
    })))
}

/// Authoritative active and archived branch directory for AirHub staff.
pub(crate) async fn list_branches(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = "/api/airhop/staff/v1/branches";
    let (tenant, _) = authenticate(&state, &headers, "GET", path, None, Access::Staff).await?;
    let organization = state
        .db
        .get_airhop_organization(&tenant)
        .await
        .map_err(map_db_error)?
        .ok_or_else(|| {
            api_error(
                StatusCode::NOT_FOUND,
                "AirHub organization is not configured",
            )
        })?;
    let branches = state
        .db
        .list_airhop_branches(&tenant)
        .await
        .map_err(map_db_error)?;
    let rooms = state
        .db
        .list_airhop_rooms(&tenant)
        .await
        .map_err(map_db_error)?;
    let groups = state
        .db
        .list_airhop_groups(&tenant)
        .await
        .map_err(map_db_error)?;
    let recurrence_rules = state
        .db
        .list_airhop_recurrence_rules(&tenant)
        .await
        .map_err(map_db_error)?;
    let lesson_exceptions = state
        .db
        .list_airhop_lesson_exceptions(&tenant)
        .await
        .map_err(map_db_error)?;
    let tariffs = state
        .db
        .list_airhop_tariffs(&tenant)
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "organization": organization_json(
            organization.id,
            &organization.name,
            &organization.locale,
            &organization.time_zone,
            organization.payments_buzz_channel_id,
            &organization.settings,
        ),
        "organizationVersion": organization.version,
        "items": branches.iter().map(branch_json).collect::<Vec<_>>(),
        "rooms": rooms.iter().map(room_json).collect::<Vec<_>>(),
        "groups": groups.iter().map(group_json).collect::<Vec<_>>(),
        "recurrenceRules": recurrence_rules.iter().map(recurrence_rule_json).collect::<Vec<_>>(),
        "lessonExceptions": lesson_exceptions.iter().map(lesson_exception_json).collect::<Vec<_>>(),
        "tariffs": tariffs.iter().map(tariff_json).collect::<Vec<_>>(),
    })))
}

/// Idempotently creates one tenant-scoped branch and its working hours.
pub(crate) async fn create_branch(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = "/api/airhop/staff/v1/branches";
    let (tenant, pubkey) =
        authenticate(&state, &headers, "POST", path, Some(&body), Access::Staff).await?;
    let request: CreateBranchBody = parse_body(&body)?;
    let idempotency_key = require_idempotency_key(&headers)?;
    let periods = branch_working_periods(request.working_hours)?;
    let key = command_key(&state);
    let outcome = state
        .db
        .create_airhop_branch(
            &tenant,
            &CreateBranchInput {
                name: request.name.trim().to_owned(),
                address: request.address.trim().to_owned(),
                working_periods: periods,
                default_buzz_channel_id: request.default_buzz_channel_id,
                idempotency_digest: scoped_digest(
                    &key,
                    b"airhop.staff.branch-create.idempotency.v1",
                    tenant.community().as_uuid(),
                    &pubkey.to_bytes(),
                    idempotency_key.as_bytes(),
                )?,
                request_hash: command_request_hash("POST", path, &body),
                actor: staff_actor(pubkey),
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "branchId": outcome.branch_id,
        "version": outcome.version,
        "replayed": outcome.replayed,
    })))
}

/// Replaces, archives, or restores one branch with optimistic concurrency.
pub(crate) async fn put_branch(
    State(state): State<Arc<AppState>>,
    Path(branch_id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("/api/airhop/staff/v1/branches/{branch_id}");
    let (tenant, pubkey) =
        authenticate(&state, &headers, "PUT", &path, Some(&body), Access::Staff).await?;
    let request: PutBranchBody = parse_body(&body)?;
    let idempotency_key = require_idempotency_key(&headers)?;
    let periods = branch_working_periods(request.working_hours)?;
    let key = command_key(&state);
    let outcome = state
        .db
        .put_airhop_branch(
            &tenant,
            &PutBranchInput {
                branch_id,
                expected_version: request.expected_version,
                name: request.name.trim().to_owned(),
                address: request.address.trim().to_owned(),
                working_periods: periods,
                default_buzz_channel_id: request.default_buzz_channel_id,
                status: request.status,
                idempotency_digest: scoped_digest(
                    &key,
                    b"airhop.staff.branch-put.idempotency.v1",
                    tenant.community().as_uuid(),
                    &pubkey.to_bytes(),
                    idempotency_key.as_bytes(),
                )?,
                request_hash: command_request_hash("PUT", &path, &body),
                actor: staff_actor(pubkey),
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "branchId": outcome.branch_id,
        "version": outcome.version,
        "replayed": outcome.replayed,
    })))
}

/// Idempotently creates one room inside an active branch.
pub(crate) async fn create_room(
    State(state): State<Arc<AppState>>,
    Path(branch_id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("/api/airhop/staff/v1/branches/{branch_id}/rooms");
    let (tenant, pubkey) =
        authenticate(&state, &headers, "POST", &path, Some(&body), Access::Staff).await?;
    let request: CreateRoomBody = parse_body(&body)?;
    let idempotency_key = require_idempotency_key(&headers)?;
    let key = command_key(&state);
    let outcome = state
        .db
        .create_airhop_room(
            &tenant,
            &CreateRoomInput {
                branch_id,
                name: request.name.trim().to_owned(),
                idempotency_digest: scoped_digest(
                    &key,
                    b"airhop.staff.room-create.idempotency.v1",
                    tenant.community().as_uuid(),
                    &pubkey.to_bytes(),
                    idempotency_key.as_bytes(),
                )?,
                request_hash: command_request_hash("POST", &path, &body),
                actor: staff_actor(pubkey),
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "roomId": outcome.room_id,
        "version": outcome.version,
        "replayed": outcome.replayed,
    })))
}

/// Replaces, archives, or restores one room without moving it between branches.
pub(crate) async fn put_room(
    State(state): State<Arc<AppState>>,
    Path((branch_id, room_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("/api/airhop/staff/v1/branches/{branch_id}/rooms/{room_id}");
    let (tenant, pubkey) =
        authenticate(&state, &headers, "PUT", &path, Some(&body), Access::Staff).await?;
    let request: PutRoomBody = parse_body(&body)?;
    let idempotency_key = require_idempotency_key(&headers)?;
    let key = command_key(&state);
    let outcome = state
        .db
        .put_airhop_room(
            &tenant,
            &PutRoomInput {
                branch_id,
                room_id,
                expected_version: request.expected_version,
                name: request.name.trim().to_owned(),
                status: request.status,
                idempotency_digest: scoped_digest(
                    &key,
                    b"airhop.staff.room-put.idempotency.v1",
                    tenant.community().as_uuid(),
                    &pubkey.to_bytes(),
                    idempotency_key.as_bytes(),
                )?,
                request_hash: command_request_hash("PUT", &path, &body),
                actor: staff_actor(pubkey),
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "roomId": outcome.room_id,
        "version": outcome.version,
        "replayed": outcome.replayed,
    })))
}

/// Idempotently creates a group and all of its initial recurrence rules.
pub(crate) async fn create_group(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = "/api/airhop/staff/v1/groups";
    let (tenant, pubkey) =
        authenticate(&state, &headers, "POST", path, Some(&body), Access::Staff).await?;
    let request: CreateGroupBody = parse_body(&body)?;
    let idempotency_key = require_idempotency_key(&headers)?;
    let group = group_definition(request.group);
    let active_rules = recurrence_rule_inputs(request.active_rules)?;
    let key = command_key(&state);
    let outcome = state
        .db
        .create_airhop_group(
            &tenant,
            &CreateGroupInput {
                group,
                active_rules,
                idempotency_digest: scoped_digest(
                    &key,
                    b"airhop.staff.group-create.idempotency.v1",
                    tenant.community().as_uuid(),
                    &pubkey.to_bytes(),
                    idempotency_key.as_bytes(),
                )?,
                request_hash: command_request_hash("POST", path, &body),
                actor: staff_actor(pubkey),
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "groupId": outcome.group_id,
        "version": outcome.version,
        "replayed": outcome.replayed,
    })))
}

/// Replaces, archives, or restores a group and atomically replaces its active rules.
pub(crate) async fn put_group(
    State(state): State<Arc<AppState>>,
    Path(group_id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("/api/airhop/staff/v1/groups/{group_id}");
    let (tenant, pubkey) =
        authenticate(&state, &headers, "PUT", &path, Some(&body), Access::Staff).await?;
    let request: PutGroupBody = parse_body(&body)?;
    let idempotency_key = require_idempotency_key(&headers)?;
    let group = group_definition(request.group);
    let active_rules = recurrence_rule_inputs(request.active_rules)?;
    let key = command_key(&state);
    let outcome = state
        .db
        .put_airhop_group(
            &tenant,
            &PutGroupInput {
                group_id,
                expected_version: request.expected_version,
                group,
                active_rules,
                idempotency_digest: scoped_digest(
                    &key,
                    b"airhop.staff.group-put.idempotency.v1",
                    tenant.community().as_uuid(),
                    &pubkey.to_bytes(),
                    idempotency_key.as_bytes(),
                )?,
                request_hash: command_request_hash("PUT", &path, &body),
                actor: staff_actor(pubkey),
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "groupId": outcome.group_id,
        "version": outcome.version,
        "replayed": outcome.replayed,
    })))
}

/// Cancels, overrides, or restores one lesson addressed by its stable series reference.
pub(crate) async fn put_lesson_exception(
    State(state): State<Arc<AppState>>,
    Path((recurrence_rule_id, original_date)): Path<(Uuid, chrono::NaiveDate)>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path =
        format!("/api/airhop/staff/v1/lesson-exceptions/{recurrence_rule_id}/{original_date}");
    let (tenant, pubkey) =
        authenticate(&state, &headers, "PUT", &path, Some(&body), Access::Staff).await?;
    let request: PutLessonExceptionBody = parse_body(&body)?;
    let idempotency_key = require_idempotency_key(&headers)?;
    let parsed = lesson_exception_change(request)?;
    let key = command_key(&state);
    let outcome = state
        .db
        .put_airhop_lesson_exception(
            &tenant,
            &PutLessonExceptionInput {
                recurrence_rule_id,
                original_date,
                expected_version: parsed.expected_version,
                change: parsed.change,
                reason: parsed.reason,
                idempotency_digest: scoped_digest(
                    &key,
                    b"airhop.staff.lesson-exception-put.idempotency.v1",
                    tenant.community().as_uuid(),
                    &pubkey.to_bytes(),
                    idempotency_key.as_bytes(),
                )?,
                request_hash: command_request_hash("PUT", &path, &body),
                actor: staff_actor(pubkey),
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "recurrenceRuleId": outcome.recurrence_rule_id,
        "originalDate": outcome.original_date,
        "exceptionId": outcome.exception_id,
        "version": outcome.version,
        "action": outcome.action,
        "cancelledBookingCount": outcome.cancelled_bookings,
        "replayed": outcome.replayed,
    })))
}

/// Authoritative expected children and attendance for one stable lesson.
pub(crate) async fn get_lesson_roster(
    State(state): State<Arc<AppState>>,
    Path((recurrence_rule_id, original_date)): Path<(Uuid, chrono::NaiveDate)>,
    headers: HeaderMap,
) -> Result<Json<StaffLessonRoster>, (StatusCode, Json<Value>)> {
    let path =
        format!("/api/airhop/staff/v1/lessons/{recurrence_rule_id}/{original_date}/participants");
    let (tenant, _) = authenticate(&state, &headers, "GET", &path, None, Access::Staff).await?;
    let roster = state
        .db
        .get_airhop_staff_lesson_roster(
            &tenant,
            StableLessonReference {
                recurrence_rule_id,
                original_date,
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(roster))
}

/// Atomically adds or confirms one direct participant for a future lesson.
pub(crate) async fn add_lesson_participant(
    State(state): State<Arc<AppState>>,
    Path((recurrence_rule_id, original_date)): Path<(Uuid, chrono::NaiveDate)>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path =
        format!("/api/airhop/staff/v1/lessons/{recurrence_rule_id}/{original_date}/participants");
    let (tenant, pubkey) =
        authenticate(&state, &headers, "POST", &path, Some(&body), Access::Staff).await?;
    let request: AddLessonParticipantBody = parse_body(&body)?;
    let idempotency_key = require_idempotency_key(&headers)?;
    let command_key = command_key(&state);
    let client = match request.client {
        StaffLessonParticipantClientBody::Existing {
            family_id,
            representative_id,
            child_id,
        } => StaffLessonParticipantClient::Existing {
            family_id,
            representative_id,
            child_id,
        },
        StaffLessonParticipantClientBody::New {
            parent_name,
            phone,
            child_name,
            child_birth_date,
        } => {
            let phone_normalized = super::airhop_public::normalize_airhop_phone(&phone)
                .ok_or_else(|| {
                    api_error(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "invalid AirHub phone number",
                    )
                })?;
            let index_key = state
                .config
                .airhop_public_booking
                .as_ref()
                .map(|config| config.index_key())
                .ok_or_else(|| {
                    api_error(
                        StatusCode::SERVICE_UNAVAILABLE,
                        "AirHub customer identity matching is not configured",
                    )
                })?;
            StaffLessonParticipantClient::New {
                phone_match_digest: super::airhop_public::airhop_phone_match_digest(
                    index_key,
                    tenant.community().as_uuid(),
                    &phone_normalized,
                ),
                applicant: PublicBookingApplicant {
                    parent_name,
                    phone_normalized,
                    phone_display: phone,
                    child_name,
                    child_birth_date,
                    preferred_contact_channel: PreferredContactChannel::Phone,
                    consent_policy_version: "staff-entry-v1".to_owned(),
                },
            }
        }
    };
    let outcome = state
        .db
        .add_airhop_staff_lesson_participant(
            &tenant,
            &AddStaffLessonParticipantInput {
                lesson_ref: StableLessonReference {
                    recurrence_rule_id,
                    original_date,
                },
                client,
                visit_kind: request.visit_kind.into(),
                management_token_digest: scoped_digest(
                    &command_key,
                    b"airhop.staff.direct-booking.management.v1",
                    tenant.community().as_uuid(),
                    &pubkey.to_bytes(),
                    idempotency_key.as_bytes(),
                )?,
                management_key_version: 1,
                idempotency_digest: scoped_digest(
                    &command_key,
                    b"airhop.staff.lesson-participant.idempotency.v1",
                    tenant.community().as_uuid(),
                    &pubkey.to_bytes(),
                    idempotency_key.as_bytes(),
                )?,
                request_hash: command_request_hash("POST", &path, &body),
                actor: staff_actor(pubkey),
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "familyId": outcome.family_id,
        "representativeId": outcome.representative_id,
        "childId": outcome.child_id,
        "bookingId": outcome.booking_id,
        "participantStatus": outcome.participant_status,
        "visitKind": outcome.visit_kind,
        "replayed": outcome.replayed,
    })))
}

/// Optimistically sets or clears one attendance mark in a lesson roster.
pub(crate) async fn put_lesson_attendance(
    State(state): State<Arc<AppState>>,
    Path((recurrence_rule_id, original_date, child_id)): Path<(Uuid, chrono::NaiveDate, Uuid)>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!(
        "/api/airhop/staff/v1/lessons/{recurrence_rule_id}/{original_date}/participants/{child_id}/attendance"
    );
    let (tenant, pubkey) =
        authenticate(&state, &headers, "PUT", &path, Some(&body), Access::Staff).await?;
    let request: PutLessonAttendanceBody = parse_body(&body)?;
    let idempotency_key = require_idempotency_key(&headers)?;
    let command_key = command_key(&state);
    let outcome = state
        .db
        .set_airhop_staff_lesson_attendance(
            &tenant,
            &SetStaffLessonAttendanceInput {
                lesson_ref: StableLessonReference {
                    recurrence_rule_id,
                    original_date,
                },
                child_id,
                expected_version: request.expected_version,
                status: request.status,
                idempotency_digest: scoped_digest(
                    &command_key,
                    b"airhop.staff.lesson-attendance.idempotency.v1",
                    tenant.community().as_uuid(),
                    &pubkey.to_bytes(),
                    idempotency_key.as_bytes(),
                )?,
                request_hash: command_request_hash("PUT", &path, &body),
                actor: staff_actor(pubkey),
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "childId": outcome.child_id,
        "attendanceId": outcome.attendance_id,
        "status": outcome.status,
        "version": outcome.version,
        "replayed": outcome.replayed,
    })))
}

/// Converts one confirmed trial booking to a permanent configured enrollment.
pub(crate) async fn enroll_trial_participant(
    State(state): State<Arc<AppState>>,
    Path((recurrence_rule_id, original_date, child_id)): Path<(Uuid, chrono::NaiveDate, Uuid)>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!(
        "/api/airhop/staff/v1/lessons/{recurrence_rule_id}/{original_date}/participants/{child_id}/enrollment"
    );
    let (tenant, pubkey) =
        authenticate(&state, &headers, "POST", &path, Some(&body), Access::Staff).await?;
    let request: EnrollTrialParticipantBody = parse_body(&body)?;
    let idempotency_key = require_idempotency_key(&headers)?;
    let key = command_key(&state);
    let outcome = state
        .db
        .enroll_airhop_staff_trial_participant(
            &tenant,
            &EnrollStaffTrialParticipantInput {
                lesson_ref: StableLessonReference {
                    recurrence_rule_id,
                    original_date,
                },
                child_id,
                tariff_id: request.tariff_id,
                start_date: request.start_date,
                schedule: request
                    .schedule
                    .into_iter()
                    .map(|selection| EnrollmentScheduleSelection {
                        recurrence_rule_id: selection.recurrence_rule_id,
                        weekday: selection.weekday,
                    })
                    .collect(),
                idempotency_digest: scoped_digest(
                    &key,
                    b"airhop.staff.trial-enrollment.idempotency.v1",
                    tenant.community().as_uuid(),
                    &pubkey.to_bytes(),
                    idempotency_key.as_bytes(),
                )?,
                request_hash: command_request_hash("POST", &path, &body),
                actor: staff_actor(pubkey),
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "childId": outcome.child_id,
        "enrollmentId": outcome.enrollment_id,
        "paymentExpectationId": outcome.payment_expectation_id,
        "enrollmentVersion": outcome.enrollment_version,
        "paymentVersion": outcome.payment_version,
        "replayed": outcome.replayed,
    })))
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

fn branch_working_periods(
    working_hours: BTreeMap<Weekday, Vec<BranchWorkingPeriodBody>>,
) -> Result<Vec<BranchWorkingPeriod>, (StatusCode, Json<Value>)> {
    working_hours
        .into_iter()
        .flat_map(|(weekday, periods)| {
            periods.into_iter().map(move |period| {
                let start_time =
                    NaiveTime::parse_from_str(&period.start_time, "%H:%M").map_err(|_| {
                        api_error(
                            StatusCode::UNPROCESSABLE_ENTITY,
                            "invalid AirHub branch working time",
                        )
                    })?;
                let end_time =
                    NaiveTime::parse_from_str(&period.end_time, "%H:%M").map_err(|_| {
                        api_error(
                            StatusCode::UNPROCESSABLE_ENTITY,
                            "invalid AirHub branch working time",
                        )
                    })?;
                Ok(BranchWorkingPeriod {
                    weekday,
                    start_time,
                    end_time,
                })
            })
        })
        .collect()
}

fn group_definition(body: GroupDefinitionBody) -> GroupDefinition {
    GroupDefinition {
        branch_id: body.branch_id,
        room_id: body.room_id,
        name: body.name.trim().to_owned(),
        description: body
            .description
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty()),
        teacher_ids: body.teacher_ids,
        min_age_months: body.min_age_months,
        max_age_months: body.max_age_months,
        capacity: body.capacity,
        trial_policy_override: body.trial_policy_override,
        track_attendance_override: body.track_attendance_override,
        allow_single_visits_override: body.allow_single_visits_override,
        status: body.status,
    }
}

fn recurrence_rule_inputs(
    bodies: Vec<RecurrenceRuleBody>,
) -> Result<Vec<RecurrenceRuleInput>, (StatusCode, Json<Value>)> {
    bodies
        .into_iter()
        .map(|body| {
            let start_time =
                NaiveTime::parse_from_str(&body.start_time, "%H:%M").map_err(|_| {
                    api_error(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "invalid AirHub recurrence time",
                    )
                })?;
            let end_time = NaiveTime::parse_from_str(&body.end_time, "%H:%M").map_err(|_| {
                api_error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "invalid AirHub recurrence time",
                )
            })?;
            Ok(RecurrenceRuleInput {
                id: body.id,
                starts_on: body.starts_on,
                ends_on: body.ends_on,
                weekdays: body.weekdays,
                start_time,
                end_time,
                branch_id_override: body.branch_id_override,
                room_override_set: body.room_override_set,
                room_id_override: body.room_id_override,
                teacher_ids_override: body.teacher_ids_override,
                capacity_override_set: body.capacity_override_set,
                capacity_override: body.capacity_override,
                trial_policy_override: body.trial_policy_override,
            })
        })
        .collect()
}

fn lesson_exception_change(
    body: PutLessonExceptionBody,
) -> Result<ParsedLessonExceptionBody, (StatusCode, Json<Value>)> {
    match body {
        PutLessonExceptionBody::Cancel {
            expected_version,
            reason,
        } => Ok(ParsedLessonExceptionBody {
            expected_version,
            change: LessonExceptionChange::Cancel,
            reason,
        }),
        PutLessonExceptionBody::Restore { expected_version } => Ok(ParsedLessonExceptionBody {
            expected_version,
            change: LessonExceptionChange::Restore,
            reason: None,
        }),
        PutLessonExceptionBody::Override {
            expected_version,
            r#override,
            reason,
        } => {
            let start_time = r#override
                .start_time
                .as_deref()
                .map(parse_lesson_time)
                .transpose()?;
            let end_time = r#override
                .end_time
                .as_deref()
                .map(parse_lesson_time)
                .transpose()?;
            Ok(ParsedLessonExceptionBody {
                expected_version,
                change: LessonExceptionChange::Override(OccurrenceOverride {
                    date: r#override.date,
                    start_time,
                    end_time,
                    branch_id: r#override.branch_id,
                    room_id: nullable_override(r#override.room_override_set, r#override.room_id),
                    teacher_ids: r#override.teacher_ids,
                    capacity: nullable_override(
                        r#override.capacity_override_set,
                        r#override.capacity,
                    ),
                    trial_policy: r#override.trial_policy,
                    allow_single_visits: r#override.allow_single_visits,
                }),
                reason,
            })
        }
    }
}

fn parse_lesson_time(value: &str) -> Result<NaiveTime, (StatusCode, Json<Value>)> {
    NaiveTime::parse_from_str(value, "%H:%M").map_err(|_| {
        api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid AirHub lesson time",
        )
    })
}

fn nullable_override<T>(is_set: bool, value: Option<T>) -> NullableOverride<T> {
    if !is_set {
        NullableOverride::Inherit
    } else {
        value.map_or(NullableOverride::Clear, NullableOverride::Set)
    }
}

fn branch_json(branch: &AirhopBranch) -> Value {
    let working_hours = branch
        .working_hours
        .iter()
        .map(|(weekday, periods)| {
            (
                weekday_name(*weekday).to_owned(),
                Value::Array(
                    periods
                        .iter()
                        .map(|period| {
                            json!({
                                "startTime": period.start_time.format("%H:%M").to_string(),
                                "endTime": period.end_time.format("%H:%M").to_string(),
                            })
                        })
                        .collect(),
                ),
            )
        })
        .collect::<serde_json::Map<_, _>>();
    json!({
        "id": branch.id,
        "organizationId": branch.organization_id,
        "name": branch.name,
        "address": branch.address,
        "workingHours": working_hours,
        "defaultBuzzChannelId": branch.default_buzz_channel_id,
        "status": branch.status,
        "version": branch.version,
        "createdAt": branch.created_at,
        "updatedAt": branch.updated_at,
    })
}

fn tariff_json(tariff: &AirhopTariff) -> Value {
    json!({
        "id": tariff.id,
        "organizationId": tariff.organization_id,
        "name": tariff.name,
        "description": tariff.description,
        "priceMinor": tariff.price_minor,
        "currency": tariff.currency,
        "weeklyScheduleLimit": tariff.weekly_schedule_limit,
        "paymentDayOfMonth": tariff.payment_day_of_month,
        "status": tariff.status,
        "activeEnrollmentCount": tariff.active_enrollment_count,
        "version": tariff.version,
        "createdAt": tariff.created_at,
        "updatedAt": tariff.updated_at,
    })
}

fn room_json(room: &AirhopRoom) -> Value {
    json!({
        "id": room.id,
        "organizationId": room.organization_id,
        "branchId": room.branch_id,
        "name": room.name,
        "status": room.status,
        "version": room.version,
        "createdAt": room.created_at,
        "updatedAt": room.updated_at,
    })
}

fn group_json(group: &AirhopGroup) -> Value {
    let mut value = json!({
        "id": group.id,
        "organizationId": group.organization_id,
        "branchId": group.branch_id,
        "name": group.name,
        "teacherIds": group.teacher_ids,
        "status": group.status,
        "version": group.version,
        "createdAt": group.created_at,
        "updatedAt": group.updated_at,
    });
    let Value::Object(object) = &mut value else {
        return Value::Null;
    };
    if let Some(description) = &group.description {
        object.insert("description".to_owned(), json!(description));
    }
    if let Some(room_id) = group.room_id {
        object.insert("roomId".to_owned(), json!(room_id));
    }
    if let Some(min_age_months) = group.min_age_months {
        object.insert("minAgeMonths".to_owned(), json!(min_age_months));
    }
    if let Some(max_age_months) = group.max_age_months {
        object.insert("maxAgeMonths".to_owned(), json!(max_age_months));
    }
    if let Some(capacity) = group.capacity {
        object.insert("capacity".to_owned(), json!(capacity));
    }
    if let Some(policy) = &group.trial_policy_override {
        object.insert("trialPolicyOverride".to_owned(), json!(policy));
    }
    if let Some(track_attendance) = group.track_attendance_override {
        object.insert(
            "trackAttendanceOverride".to_owned(),
            json!(track_attendance),
        );
    }
    if let Some(allow_single_visits) = group.allow_single_visits_override {
        object.insert(
            "allowSingleVisitsOverride".to_owned(),
            json!(allow_single_visits),
        );
    }
    value
}

fn recurrence_rule_json(rule: &AirhopRecurrenceRule) -> Value {
    let mut value = json!({
        "id": rule.id,
        "organizationId": rule.organization_id,
        "groupId": rule.group_id,
        "startsOn": rule.starts_on,
        "endsOn": rule.ends_on,
        "weekdays": rule.weekdays,
        "startTime": rule.start_time.format("%H:%M").to_string(),
        "endTime": rule.end_time.format("%H:%M").to_string(),
        "status": rule.status,
        "version": rule.version,
        "createdAt": rule.created_at,
        "updatedAt": rule.updated_at,
    });
    let Value::Object(object) = &mut value else {
        return Value::Null;
    };
    if let Some(branch_id) = rule.branch_id_override {
        object.insert("branchIdOverride".to_owned(), json!(branch_id));
    }
    if rule.room_override_set {
        object.insert("roomIdOverride".to_owned(), json!(rule.room_id_override));
    }
    if let Some(teacher_ids) = &rule.teacher_ids_override {
        object.insert("teacherIdsOverride".to_owned(), json!(teacher_ids));
    }
    if rule.capacity_override_set {
        object.insert("capacityOverride".to_owned(), json!(rule.capacity_override));
    }
    if let Some(policy) = &rule.trial_policy_override {
        object.insert("trialPolicyOverride".to_owned(), json!(policy));
    }
    value
}

fn lesson_exception_json(exception: &AirhopLessonException) -> Value {
    let mut value = json!({
        "id": exception.id,
        "organizationId": exception.organization_id,
        "recurrenceRuleId": exception.recurrence_rule_id,
        "originalDate": exception.original_date,
        "original": exception.original_snapshot,
        "kind": exception.kind,
        "version": exception.version,
        "updatedAt": exception.updated_at,
    });
    let Value::Object(object) = &mut value else {
        return Value::Null;
    };
    if let Some(reason) = &exception.reason {
        object.insert("reason".to_owned(), json!(reason));
    }
    match exception.kind.as_str() {
        "override" => {
            if let Some(payload) = &exception.override_payload {
                object.insert("override".to_owned(), payload.clone());
            }
        }
        "cancelled" => {
            if let Some(payload) = &exception.effective_payload {
                object.insert("effective".to_owned(), payload.clone());
            }
        }
        _ => {}
    }
    value
}

const fn weekday_name(weekday: Weekday) -> &'static str {
    match weekday {
        Weekday::Monday => "monday",
        Weekday::Tuesday => "tuesday",
        Weekday::Wednesday => "wednesday",
        Weekday::Thursday => "thursday",
        Weekday::Friday => "friday",
        Weekday::Saturday => "saturday",
        Weekday::Sunday => "sunday",
    }
}

fn organization_json(
    organization_id: Uuid,
    name: &str,
    locale: &str,
    time_zone: &str,
    payments_buzz_channel_id: Option<Uuid>,
    settings: &OrganizationSettings,
) -> Value {
    let mut value = json!({
        "id": organization_id,
        "name": name,
        "locale": locale,
        "timeZone": time_zone,
        "defaultTrialPolicy": settings.default_trial_policy,
        "trackAttendanceByDefault": settings.track_attendance_by_default,
        "allowSingleVisitsByDefault": settings.allow_single_visits_by_default,
        "existingStudentsOnboarding": {
            "status": settings.existing_students_onboarding_status,
        },
        "publicBooking": {
            "purpose": settings.public_booking_purpose,
            "appearance": settings.public_booking_appearance,
        },
        "paymentDayOfMonth": settings.payment_day_of_month,
    });
    if let Some(channel_id) = payments_buzz_channel_id {
        value["paymentsBuzzChannelId"] = json!(channel_id);
    }
    value
}

fn organization_settings_payload(organization: Value, version: i64, replayed: bool) -> Value {
    json!({
        "organization": organization,
        "version": version,
        "replayed": replayed,
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

fn command_request_hash(method: &str, path: &str, body: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    for component in [method.as_bytes(), path.as_bytes(), body] {
        hasher.update((component.len() as u64).to_be_bytes());
        hasher.update(component);
    }
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

fn trimmed_optional(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_owned())
        .filter(|item| !item.is_empty())
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
        DbError::AirhopPaymentTransition => api_error(
            StatusCode::CONFLICT,
            "AirHub payment is no longer available for this action",
        ),
        DbError::AirhopOccurrenceUnavailable => api_error(
            StatusCode::CONFLICT,
            "AirHub lesson occurrence is no longer available",
        ),
        DbError::AirhopCapacityFull => api_error(
            StatusCode::CONFLICT,
            "AirHub lesson has no available places",
        ),
        DbError::AirhopAgeMismatch => api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Child does not match the AirHub lesson age limits",
        ),
        DbError::AirhopVisitDisabled => api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Selected AirHub visit kind is disabled",
        ),
        DbError::AirhopBookingConflict => api_error(
            StatusCode::CONFLICT,
            "Child already has a conflicting AirHub lesson booking",
        ),
        DbError::AirhopAttendanceDisabled => api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Attendance tracking is disabled for this AirHub lesson",
        ),
        DbError::AirhopLessonParticipantMissing => api_error(
            StatusCode::CONFLICT,
            "Child is not expected at this AirHub lesson",
        ),
        DbError::AirhopTariffUnavailable => api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Selected AirHub tariff is unavailable",
        ),
        DbError::AirhopEnrollmentConflict => api_error(
            StatusCode::CONFLICT,
            "Child already has an overlapping AirHub enrollment",
        ),
        DbError::AirhopEnrollmentScheduleInvalid => api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Selected AirHub enrollment schedule is invalid",
        ),
        DbError::AirhopConfirmedTrialRequired => api_error(
            StatusCode::CONFLICT,
            "A confirmed AirHub trial booking is required",
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
            "AirHub family, representative, or child identity is inconsistent",
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
    fn organization_settings_payload_matches_the_desktop_contract() {
        let settings = OrganizationSettings {
            default_trial_policy: TrialPolicy::Free,
            track_attendance_by_default: true,
            allow_single_visits_by_default: false,
            existing_students_onboarding_status: ExistingStudentsOnboardingStatus::NotStarted,
            public_booking_purpose: PublicBookingPurpose::Trial,
            public_booking_appearance: PublicBookingAppearance::Automatic,
            payment_day_of_month: 5,
        };
        let organization_id = Uuid::new_v4();
        let payments_channel_id = Uuid::new_v4();
        let payload = organization_settings_payload(
            organization_json(
                organization_id,
                "Каляка Маляка",
                "ru-RU",
                "Europe/Moscow",
                Some(payments_channel_id),
                &settings,
            ),
            3,
            false,
        );
        assert_eq!(payload["organization"]["id"], json!(organization_id));
        assert_eq!(
            payload["organization"]["paymentsBuzzChannelId"],
            json!(payments_channel_id)
        );
        assert_eq!(
            payload["organization"]["defaultTrialPolicy"]["mode"],
            "free"
        );
        assert_eq!(
            payload["organization"]["existingStudentsOnboarding"]["status"],
            "not_started"
        );
        assert_eq!(payload["version"], 3);
    }

    #[test]
    fn branch_body_contract_uses_camel_case_weekly_hours() {
        let body: CreateBranchBody = serde_json::from_value(json!({
            "name": "Курская",
            "address": "Земляной Вал, 1",
            "workingHours": {
                "monday": [{"startTime": "09:00", "endTime": "18:00"}],
                "sunday": []
            },
            "defaultBuzzChannelId": null
        }))
        .expect("valid branch body");
        let periods = branch_working_periods(body.working_hours).expect("valid working hours");
        assert_eq!(periods.len(), 1);
        assert_eq!(periods[0].weekday, Weekday::Monday);
        assert_eq!(periods[0].start_time.format("%H:%M").to_string(), "09:00");
    }

    #[test]
    fn branch_command_hash_binds_the_resource_path() {
        let body = br#"{"expectedVersion":1}"#;
        assert_ne!(
            command_request_hash("PUT", "/branches/first", body),
            command_request_hash("PUT", "/branches/second", body)
        );
    }

    #[test]
    fn room_body_contract_uses_camel_case_and_explicit_status() {
        let body: PutRoomBody = serde_json::from_value(json!({
            "expectedVersion": 2,
            "name": "Большой зал",
            "status": "archived"
        }))
        .expect("valid room body");
        assert_eq!(body.expected_version, 2);
        assert_eq!(body.status, RoomStatus::Archived);
    }

    #[test]
    fn tariff_body_contract_keeps_minor_money_and_schedule_limit_explicit() {
        let body: PutTariffBody = serde_json::from_value(json!({
            "expectedVersion": 3,
            "name": "Два раза в неделю",
            "description": "Восемь занятий в месяц",
            "priceMinor": 600000,
            "currency": "RUB",
            "weeklyScheduleLimit": 2,
            "paymentDayOfMonth": null,
            "status": "active"
        }))
        .expect("valid tariff body");
        assert_eq!(body.expected_version, 3);
        assert_eq!(body.price_minor, 600_000);
        assert_eq!(body.weekly_schedule_limit, 2);
        assert_eq!(body.payment_day_of_month, None);
    }

    #[test]
    fn payment_body_contract_is_explicit_and_requires_move_reason() {
        let body: MutatePaymentBody = serde_json::from_value(json!({
            "action": "move_due_date",
            "expectedVersion": 4,
            "dueDate": "2026-08-25",
            "reason": "По договорённости с семьёй"
        }))
        .expect("valid payment body");
        assert_eq!(body.expected_version(), 4);
        assert!(matches!(
            body.into_change(),
            PaymentChange::MoveDueDate { due_date, reason }
                if due_date.to_string() == "2026-08-25" && reason == "По договорённости с семьёй"
        ));
        assert!(serde_json::from_value::<MutatePaymentBody>(json!({
            "action": "move_due_date",
            "expectedVersion": 4,
            "dueDate": "2026-08-25"
        }))
        .is_err());
    }

    #[test]
    fn trial_enrollment_body_requires_explicit_weekly_slots() {
        let rule_id = Uuid::new_v4();
        let body: EnrollTrialParticipantBody = serde_json::from_value(json!({
            "tariffId": Uuid::new_v4(),
            "startDate": "2026-08-18",
            "schedule": [{
                "recurrenceRuleId": rule_id,
                "weekday": "tuesday"
            }]
        }))
        .expect("valid trial enrollment body");
        assert_eq!(body.schedule.len(), 1);
        assert_eq!(body.schedule[0].recurrence_rule_id, rule_id);
        assert_eq!(body.schedule[0].weekday, Weekday::Tuesday);
    }

    #[test]
    fn group_body_contract_keeps_group_and_rules_atomic() {
        let branch_id = Uuid::new_v4();
        let body: CreateGroupBody = serde_json::from_value(json!({
            "group": {
                "branchId": branch_id,
                "roomId": null,
                "name": "Воздушные полотна 7–9",
                "description": null,
                "teacherIds": [],
                "minAgeMonths": 84,
                "maxAgeMonths": 119,
                "capacity": 10,
                "trialPolicyOverride": null,
                "trackAttendanceOverride": null,
                "allowSingleVisitsOverride": null,
                "status": "active"
            },
            "activeRules": [{
                "startsOn": "2026-08-17",
                "endsOn": "2026-11-17",
                "weekdays": ["monday"],
                "startTime": "17:00",
                "endTime": "18:00",
                "branchIdOverride": null,
                "roomOverrideSet": false,
                "roomIdOverride": null,
                "capacityOverrideSet": false,
                "capacityOverride": null,
                "trialPolicyOverride": null
            }]
        }))
        .expect("valid group body");
        let rules = recurrence_rule_inputs(body.active_rules).expect("valid recurrence rules");
        assert_eq!(body.group.branch_id, branch_id);
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].weekdays, vec![Weekday::Monday]);
        assert_eq!(
            rules[0].start_time,
            NaiveTime::from_hms_opt(17, 0, 0).expect("valid test time")
        );
    }

    #[test]
    fn lesson_override_body_preserves_nullable_override_semantics() {
        let body: PutLessonExceptionBody = serde_json::from_value(json!({
            "action": "override",
            "expectedVersion": 2,
            "override": {
                "date": "2026-08-18",
                "startTime": "19:00",
                "endTime": "20:00",
                "roomOverrideSet": true,
                "roomId": null,
                "capacityOverrideSet": true,
                "capacity": 8
            },
            "reason": "Разовое изменение"
        }))
        .expect("valid lesson override body");
        let parsed = lesson_exception_change(body).expect("convert lesson override");
        assert_eq!(parsed.expected_version, 2);
        assert_eq!(parsed.reason.as_deref(), Some("Разовое изменение"));
        let LessonExceptionChange::Override(changes) = parsed.change else {
            panic!("expected override change");
        };
        assert_eq!(
            changes.start_time,
            Some(NaiveTime::from_hms_opt(19, 0, 0).expect("valid time"))
        );
        assert_eq!(changes.room_id, NullableOverride::Clear);
        assert_eq!(changes.capacity, NullableOverride::Set(8));
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
