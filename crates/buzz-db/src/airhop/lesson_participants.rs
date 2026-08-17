//! Authoritative roster, direct participants, and attendance for one lesson.

use airhop_core::{BookingStatus, StableLessonReference, Weekday};
use buzz_core::TenantContext;
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use super::booking::{reserve_booking, BookingVisitKind, NewBooking};
use super::public_booking::{
    acquire_identity_lock, applicant_snapshot, normalize_applicant, resolve_identity,
    IdentityConsent, PublicBookingApplicant,
};
use super::{
    append_domain_event, commit_command, insert_pending_command, AirhopActor, AirhopCommand,
    CommandInsertOutcome, CommandStatus, NewAirhopCommand, NewDomainEvent, PrivacyClass,
};
use crate::{Db, DbError, Result};

const ADD_PARTICIPANT_COMMAND_TYPE: &str = "AddLessonParticipant";
const SET_ATTENDANCE_COMMAND_TYPE: &str = "SetLessonAttendance";

/// Explicit attendance value stored for one expected child.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LessonAttendanceStatus {
    /// The child attended the lesson.
    Present,
    /// The child did not attend the lesson.
    Absent,
}

impl LessonAttendanceStatus {
    const fn as_db_str(self) -> &'static str {
        match self {
            Self::Present => "present",
            Self::Absent => "absent",
        }
    }

    fn from_db(value: &str) -> Result<Self> {
        match value {
            "present" => Ok(Self::Present),
            "absent" => Ok(Self::Absent),
            other => Err(DbError::InvalidData(format!(
                "unknown AirHub attendance status {other:?}"
            ))),
        }
    }
}

/// One authoritative participant row for a stable lesson occurrence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffLessonRosterEntry {
    /// Owning family.
    pub family_id: Uuid,
    /// Current family display name.
    pub family_name: String,
    /// Representative used for the booking or the family's primary contact.
    pub representative_id: Uuid,
    /// Current representative display name.
    pub representative_name: String,
    /// Expected child.
    pub child_id: Uuid,
    /// Current child display name.
    pub child_name: String,
    /// Active booking when the child attends as a trial or one-off visitor.
    pub booking_id: Option<Uuid>,
    /// Current booking status.
    pub booking_status: Option<String>,
    /// `trial` or `single` for booking-backed participants.
    pub visit_kind: Option<String>,
    /// Active permanent enrollment covering this occurrence.
    pub enrollment_id: Option<Uuid>,
    /// Current attendance projection id.
    pub attendance_id: Option<Uuid>,
    /// Explicit attendance mark.
    pub attendance_status: Option<LessonAttendanceStatus>,
    /// Optimistic attendance version, zero when unmarked.
    pub attendance_version: i64,
    /// Last attendance mutation instant.
    pub attendance_marked_at: Option<DateTime<Utc>>,
}

/// Bounded roster projection for exactly one stable lesson.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffLessonRoster {
    /// Stable lesson identity.
    pub lesson_ref: StableLessonReference,
    /// Whether the effective group policy allows attendance marks.
    pub track_attendance: bool,
    /// Expected children, deduplicated across enrollments and bookings.
    pub items: Vec<StaffLessonRosterEntry>,
}

/// Existing or newly entered customer identity selected by staff.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StaffLessonParticipantClient {
    /// Existing active family-owned identity.
    Existing {
        /// Family identifier.
        family_id: Uuid,
        /// Active representative identifier.
        representative_id: Uuid,
        /// Active child identifier.
        child_id: Uuid,
    },
    /// New staff-entered applicant, matched with the public identity rules.
    New {
        /// Normalized applicant fields.
        applicant: PublicBookingApplicant,
        /// Tenant-keyed exact-phone digest.
        phone_match_digest: [u8; 32],
    },
}

/// Atomic staff command to put one child onto one lesson roster.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AddStaffLessonParticipantInput {
    /// Stable lesson identity.
    pub lesson_ref: StableLessonReference,
    /// Existing or new customer identity.
    pub client: StaffLessonParticipantClient,
    /// Trial or one-off commercial meaning.
    pub visit_kind: BookingVisitKind,
    /// Digest used for a non-parent-facing booking management credential.
    pub management_token_digest: [u8; 32],
    /// Key namespace version for that digest.
    pub management_key_version: i16,
    /// Keyed digest of the HTTP idempotency key.
    pub idempotency_digest: [u8; 32],
    /// Canonical method/path/body request hash.
    pub request_hash: [u8; 32],
    /// Verified staff attribution.
    pub actor: AirhopActor,
}

/// Deterministic result of a direct participant command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AddStaffLessonParticipantOutcome {
    /// Owning family.
    pub family_id: Uuid,
    /// Representative used for the direct booking.
    pub representative_id: Uuid,
    /// Child now expected at the lesson.
    pub child_id: Uuid,
    /// Booking row, absent when an enrollment already covers the lesson.
    pub booking_id: Option<Uuid>,
    /// `confirmed` or `enrolled`.
    pub participant_status: String,
    /// Authoritative visit kind when booking-backed.
    pub visit_kind: Option<String>,
    /// True when a committed command receipt was replayed.
    pub replayed: bool,
}

/// Optimistic command for setting or clearing one attendance mark.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SetStaffLessonAttendanceInput {
    /// Stable lesson identity.
    pub lesson_ref: StableLessonReference,
    /// Expected child.
    pub child_id: Uuid,
    /// Zero for an unmarked row, otherwise the current row version.
    pub expected_version: i64,
    /// Present/absent, or none to clear the explicit mark.
    pub status: Option<LessonAttendanceStatus>,
    /// Keyed digest of the HTTP idempotency key.
    pub idempotency_digest: [u8; 32],
    /// Canonical method/path/body request hash.
    pub request_hash: [u8; 32],
    /// Verified staff attribution.
    pub actor: AirhopActor,
}

/// Deterministic attendance command result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SetStaffLessonAttendanceOutcome {
    /// Child whose mark changed.
    pub child_id: Uuid,
    /// Current projection id, absent after clearing.
    pub attendance_id: Option<Uuid>,
    /// Current explicit status.
    pub status: Option<LessonAttendanceStatus>,
    /// Current row version, or the terminal event version after clearing.
    pub version: i64,
    /// True when a committed command receipt was replayed.
    pub replayed: bool,
}

#[derive(Debug)]
struct LessonOccurrence {
    group_id: Uuid,
    effective_date: NaiveDate,
    starts_at: DateTime<Utc>,
    status: String,
    track_attendance: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredParticipantResult {
    family_id: Uuid,
    representative_id: Uuid,
    child_id: Uuid,
    booking_id: Option<Uuid>,
    participant_status: String,
    visit_kind: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredAttendanceResult {
    child_id: Uuid,
    attendance_id: Option<Uuid>,
    status: Option<LessonAttendanceStatus>,
    version: i64,
}

#[derive(Debug)]
struct ResolvedStaffIdentity {
    family_id: Uuid,
    representative_id: Uuid,
    child_id: Uuid,
    consent_id: Uuid,
    applicant_snapshot: Value,
}

#[derive(Debug)]
struct ExistingBooking {
    id: Uuid,
    status: String,
    visit_kind: BookingVisitKind,
}

impl Db {
    /// Loads expected children and attendance for exactly one stable lesson.
    pub async fn get_airhop_staff_lesson_roster(
        &self,
        tenant: &TenantContext,
        lesson_ref: StableLessonReference,
    ) -> Result<StaffLessonRoster> {
        let organization_id = active_organization_id(&self.pool, tenant).await?;
        let occurrence =
            load_occurrence(&self.pool, tenant, organization_id, lesson_ref, false).await?;
        let rows = sqlx::query(
            "WITH participants AS ( \
                 SELECT booking.child_id \
                 FROM airhop_bookings booking \
                 WHERE booking.community_id = $1 AND booking.organization_id = $2 \
                   AND booking.recurrence_rule_id = $3 AND booking.original_date = $4 \
                   AND booking.status IN ('pending_confirmation', 'confirmed') \
                 UNION \
                 SELECT enrollment.child_id \
                 FROM airhop_enrollments enrollment \
                 WHERE enrollment.community_id = $1 AND enrollment.organization_id = $2 \
                   AND enrollment.group_id = $5 AND enrollment.status = 'active' \
                   AND enrollment.start_date <= $6 \
                   AND (enrollment.end_date IS NULL OR enrollment.end_date >= $6) \
                   AND (enrollment.assignment_state = 'needs_assignment' OR EXISTS ( \
                       SELECT 1 FROM airhop_enrollment_schedule selection \
                       WHERE selection.community_id = enrollment.community_id \
                         AND selection.organization_id = enrollment.organization_id \
                         AND selection.enrollment_id = enrollment.id \
                         AND selection.recurrence_rule_id = $3 AND selection.weekday = $7 \
                   )) \
             ) \
             SELECT family.id AS family_id, family.display_name AS family_name, \
                    representative.id AS representative_id, \
                    representative.display_name AS representative_name, \
                    child.id AS child_id, child.display_name AS child_name, \
                    booking.id AS booking_id, booking.status AS booking_status, \
                    booking.visit_kind, enrollment.id AS enrollment_id, \
                    attendance.id AS attendance_id, attendance.status AS attendance_status, \
                    COALESCE(attendance.version, 0) AS attendance_version, \
                    attendance.marked_at AS attendance_marked_at \
             FROM participants participant \
             JOIN airhop_children child \
               ON child.community_id = $1 AND child.organization_id = $2 \
              AND child.id = participant.child_id \
             JOIN airhop_families family \
               ON family.community_id = child.community_id \
              AND family.organization_id = child.organization_id AND family.id = child.family_id \
             LEFT JOIN LATERAL ( \
                 SELECT row.id, row.representative_id, row.status, row.visit_kind \
                 FROM airhop_bookings row \
                 WHERE row.community_id = $1 AND row.organization_id = $2 \
                   AND row.child_id = child.id AND row.recurrence_rule_id = $3 \
                   AND row.original_date = $4 \
                   AND row.status IN ('pending_confirmation', 'confirmed') \
                 ORDER BY (row.status = 'confirmed') DESC, row.updated_at DESC, row.id \
                 LIMIT 1 \
             ) booking ON TRUE \
             LEFT JOIN LATERAL ( \
                 SELECT row.id \
                 FROM airhop_enrollments row \
                 WHERE row.community_id = $1 AND row.organization_id = $2 \
                   AND row.child_id = child.id AND row.group_id = $5 \
                   AND row.status = 'active' AND row.start_date <= $6 \
                   AND (row.end_date IS NULL OR row.end_date >= $6) \
                   AND (row.assignment_state = 'needs_assignment' OR EXISTS ( \
                       SELECT 1 FROM airhop_enrollment_schedule selection \
                       WHERE selection.community_id = row.community_id \
                         AND selection.organization_id = row.organization_id \
                         AND selection.enrollment_id = row.id \
                         AND selection.recurrence_rule_id = $3 AND selection.weekday = $7 \
                   )) \
                 ORDER BY row.updated_at DESC, row.id LIMIT 1 \
             ) enrollment ON TRUE \
             JOIN airhop_representatives representative \
               ON representative.community_id = family.community_id \
              AND representative.organization_id = family.organization_id \
              AND representative.id = COALESCE(booking.representative_id, \
                                                family.primary_representative_id) \
             LEFT JOIN airhop_lesson_attendance attendance \
               ON attendance.community_id = $1 AND attendance.organization_id = $2 \
              AND attendance.recurrence_rule_id = $3 AND attendance.original_date = $4 \
              AND attendance.child_id = child.id \
             ORDER BY lower(child.display_name), child.id",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(lesson_ref.recurrence_rule_id)
        .bind(lesson_ref.original_date)
        .bind(occurrence.group_id)
        .bind(occurrence.effective_date)
        .bind(weekday_str(Weekday::from(
            lesson_ref.original_date.weekday(),
        )))
        .fetch_all(&self.pool)
        .await?;
        let items = rows
            .into_iter()
            .map(parse_roster_entry)
            .collect::<Result<Vec<_>>>()?;
        Ok(StaffLessonRoster {
            lesson_ref,
            track_attendance: occurrence.track_attendance,
            items,
        })
    }

    /// Atomically adds or confirms one direct participant for a future lesson.
    pub async fn add_airhop_staff_lesson_participant(
        &self,
        tenant: &TenantContext,
        input: &AddStaffLessonParticipantInput,
    ) -> Result<AddStaffLessonParticipantOutcome> {
        validate_add_participant(input)?;
        let mut transaction = self.pool.begin().await?;
        let (organization_id, current_date, occurred_at) =
            active_organization_clock(&mut transaction, tenant).await?;
        let command_input = NewAirhopCommand {
            id: Uuid::new_v4(),
            organization_id,
            command_type: ADD_PARTICIPANT_COMMAND_TYPE.to_owned(),
            idempotency_digest: input.idempotency_digest,
            request_hash: input.request_hash,
            actor: input.actor.clone(),
            correlation_id: Uuid::new_v4(),
        };
        let command = match insert_pending_command(&mut transaction, tenant, &command_input).await?
        {
            CommandInsertOutcome::Inserted(command) => command,
            CommandInsertOutcome::Existing(command) => {
                return replay_participant(transaction, command).await;
            }
        };
        let identity = resolve_staff_identity(
            &mut transaction,
            tenant,
            organization_id,
            current_date,
            occurred_at,
            &input.client,
        )
        .await?;
        let occurrence = load_occurrence(
            &mut *transaction,
            tenant,
            organization_id,
            input.lesson_ref,
            true,
        )
        .await?;
        if occurrence.status == "cancelled" || occurrence.starts_at <= occurred_at {
            return Err(DbError::AirhopOccurrenceUnavailable);
        }
        let existing_booking = load_existing_booking(
            &mut transaction,
            tenant,
            organization_id,
            input.lesson_ref,
            identity.child_id,
        )
        .await?;
        let enrolled = enrollment_exists(
            &mut *transaction,
            tenant,
            organization_id,
            input.lesson_ref,
            identity.child_id,
            &occurrence,
        )
        .await?;

        let (booking_id, participant_status, visit_kind, promoted_version) =
            if let Some(existing) = existing_booking {
                let version = if existing.status == "pending_confirmation" {
                    Some(
                        promote_booking(
                            &mut transaction,
                            tenant,
                            organization_id,
                            existing.id,
                            &input.actor,
                            occurred_at,
                        )
                        .await?,
                    )
                } else {
                    None
                };
                (
                    Some(existing.id),
                    "confirmed".to_owned(),
                    Some(existing.visit_kind.as_db_str().to_owned()),
                    version,
                )
            } else if enrolled {
                (None, "enrolled".to_owned(), None, None)
            } else {
                let booking = reserve_booking(
                    &mut transaction,
                    tenant,
                    &NewBooking {
                        id: Uuid::new_v4(),
                        organization_id,
                        family_id: identity.family_id,
                        representative_id: identity.representative_id,
                        child_id: identity.child_id,
                        consent_id: identity.consent_id,
                        lesson_ref: input.lesson_ref,
                        command_id: command.id,
                        applicant_snapshot: identity.applicant_snapshot.clone(),
                        visit_kind: input.visit_kind,
                        status: BookingStatus::Confirmed,
                        management_token_digest: input.management_token_digest,
                        management_key_version: input.management_key_version,
                        source: json!({
                            "surface": "staff_ui",
                            "channel": "phone",
                            "workflow": "direct"
                        }),
                        actor: input.actor.clone(),
                        created_by: "airhop-center-staff".to_owned(),
                        internal_comment: None,
                    },
                )
                .await?;
                (
                    Some(booking.id),
                    "confirmed".to_owned(),
                    Some(input.visit_kind.as_db_str().to_owned()),
                    None,
                )
            };

        if let (Some(booking_id), Some(version)) = (booking_id, promoted_version) {
            append_domain_event(
                &mut transaction,
                tenant,
                &NewDomainEvent {
                    id: Uuid::new_v4(),
                    organization_id,
                    stream_type: "booking".to_owned(),
                    stream_id: booking_id,
                    stream_version: version,
                    event_type: "airhop.booking.confirmed_by_staff.v1".to_owned(),
                    schema_version: 1,
                    occurred_at,
                    actor: input.actor.clone(),
                    causation_id: command.id,
                    correlation_id: command.correlation_id,
                    payload: json!({ "bookingId": booking_id, "status": "confirmed" }),
                    privacy_class: PrivacyClass::SensitiveChild,
                },
            )
            .await?;
        }
        append_domain_event(
            &mut transaction,
            tenant,
            &NewDomainEvent {
                id: Uuid::new_v4(),
                organization_id,
                stream_type: "lesson_participant".to_owned(),
                stream_id: command.id,
                stream_version: 1,
                event_type: "airhop.lesson.participant_added.v1".to_owned(),
                schema_version: 1,
                occurred_at,
                actor: input.actor.clone(),
                causation_id: command.id,
                correlation_id: command.correlation_id,
                payload: json!({
                    "recurrenceRuleId": input.lesson_ref.recurrence_rule_id,
                    "originalDate": input.lesson_ref.original_date,
                    "familyId": identity.family_id,
                    "representativeId": identity.representative_id,
                    "childId": identity.child_id,
                    "bookingId": booking_id,
                    "participantStatus": participant_status,
                    "visitKind": visit_kind,
                }),
                privacy_class: PrivacyClass::SensitiveChild,
            },
        )
        .await?;
        let stored = StoredParticipantResult {
            family_id: identity.family_id,
            representative_id: identity.representative_id,
            child_id: identity.child_id,
            booking_id,
            participant_status: participant_status.clone(),
            visit_kind: visit_kind.clone(),
        };
        commit_command(
            &mut transaction,
            tenant,
            organization_id,
            command.id,
            &serde_json::to_value(&stored)?,
        )
        .await?;
        transaction.commit().await?;
        Ok(AddStaffLessonParticipantOutcome {
            family_id: stored.family_id,
            representative_id: stored.representative_id,
            child_id: stored.child_id,
            booking_id: stored.booking_id,
            participant_status,
            visit_kind,
            replayed: false,
        })
    }

    /// Optimistically sets or clears attendance for one expected child.
    pub async fn set_airhop_staff_lesson_attendance(
        &self,
        tenant: &TenantContext,
        input: &SetStaffLessonAttendanceInput,
    ) -> Result<SetStaffLessonAttendanceOutcome> {
        validate_attendance(input)?;
        let mut transaction = self.pool.begin().await?;
        let (organization_id, _, occurred_at) =
            active_organization_clock(&mut transaction, tenant).await?;
        let command_input = NewAirhopCommand {
            id: Uuid::new_v4(),
            organization_id,
            command_type: SET_ATTENDANCE_COMMAND_TYPE.to_owned(),
            idempotency_digest: input.idempotency_digest,
            request_hash: input.request_hash,
            actor: input.actor.clone(),
            correlation_id: Uuid::new_v4(),
        };
        let command = match insert_pending_command(&mut transaction, tenant, &command_input).await?
        {
            CommandInsertOutcome::Inserted(command) => command,
            CommandInsertOutcome::Existing(command) => {
                return replay_attendance(transaction, command).await;
            }
        };
        let occurrence = load_occurrence(
            &mut *transaction,
            tenant,
            organization_id,
            input.lesson_ref,
            true,
        )
        .await?;
        if occurrence.status == "cancelled" {
            return Err(DbError::AirhopOccurrenceUnavailable);
        }
        if !occurrence.track_attendance {
            return Err(DbError::AirhopAttendanceDisabled);
        }
        if !child_has_enrollment_or_booking(
            &mut transaction,
            tenant,
            organization_id,
            input.lesson_ref,
            input.child_id,
            &occurrence,
        )
        .await?
        {
            return Err(DbError::AirhopLessonParticipantMissing);
        }
        let existing = sqlx::query(
            "SELECT id, status, version FROM airhop_lesson_attendance \
             WHERE community_id = $1 AND organization_id = $2 \
               AND recurrence_rule_id = $3 AND original_date = $4 AND child_id = $5 \
             FOR UPDATE",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(input.lesson_ref.recurrence_rule_id)
        .bind(input.lesson_ref.original_date)
        .bind(input.child_id)
        .fetch_optional(&mut *transaction)
        .await?;
        let current_version = existing
            .as_ref()
            .map(|row| row.try_get::<i64, _>("version"))
            .transpose()?
            .unwrap_or(0);
        if current_version != input.expected_version {
            return Err(DbError::AirhopVersionConflict);
        }
        let stream_id = existing
            .as_ref()
            .map(|row| row.try_get::<Uuid, _>("id"))
            .transpose()?;
        let event_version = current_version + 1;
        let attendance_id = match input.status {
            Some(status) => Some(
                upsert_attendance(
                    &mut transaction,
                    tenant,
                    organization_id,
                    input,
                    stream_id,
                    status,
                    occurred_at,
                )
                .await?,
            ),
            None => {
                if let Some(id) = stream_id {
                    sqlx::query(
                        "DELETE FROM airhop_lesson_attendance \
                         WHERE community_id = $1 AND organization_id = $2 AND id = $3",
                    )
                    .bind(tenant.community().as_uuid())
                    .bind(organization_id)
                    .bind(id)
                    .execute(&mut *transaction)
                    .await?;
                }
                None
            }
        };
        if let Some(event_stream_id) = stream_id.or(attendance_id) {
            append_domain_event(
                &mut transaction,
                tenant,
                &NewDomainEvent {
                    id: Uuid::new_v4(),
                    organization_id,
                    stream_type: "lesson_attendance".to_owned(),
                    stream_id: event_stream_id,
                    stream_version: event_version,
                    event_type: if input.status.is_some() {
                        "airhop.lesson.attendance_marked.v1"
                    } else {
                        "airhop.lesson.attendance_cleared.v1"
                    }
                    .to_owned(),
                    schema_version: 1,
                    occurred_at,
                    actor: input.actor.clone(),
                    causation_id: command.id,
                    correlation_id: command.correlation_id,
                    payload: json!({
                        "recurrenceRuleId": input.lesson_ref.recurrence_rule_id,
                        "originalDate": input.lesson_ref.original_date,
                        "childId": input.child_id,
                        "attendanceId": attendance_id,
                        "status": input.status,
                    }),
                    privacy_class: PrivacyClass::SensitiveChild,
                },
            )
            .await?;
        }
        let result_version = if stream_id.is_none() && input.status.is_none() {
            0
        } else {
            event_version
        };
        let stored = StoredAttendanceResult {
            child_id: input.child_id,
            attendance_id,
            status: input.status,
            version: result_version,
        };
        commit_command(
            &mut transaction,
            tenant,
            organization_id,
            command.id,
            &serde_json::to_value(&stored)?,
        )
        .await?;
        transaction.commit().await?;
        Ok(SetStaffLessonAttendanceOutcome {
            child_id: stored.child_id,
            attendance_id: stored.attendance_id,
            status: stored.status,
            version: stored.version,
            replayed: false,
        })
    }
}

async fn active_organization_id(pool: &sqlx::PgPool, tenant: &TenantContext) -> Result<Uuid> {
    sqlx::query_scalar(
        "SELECT id FROM airhop_organizations WHERE community_id = $1 AND status = 'active'",
    )
    .bind(tenant.community().as_uuid())
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| DbError::NotFound("active AirHub organization".to_owned()))
}

async fn active_organization_clock(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
) -> Result<(Uuid, NaiveDate, DateTime<Utc>)> {
    let row = sqlx::query(
        "SELECT id, (now() AT TIME ZONE time_zone)::date AS current_date, \
                now() AS occurred_at \
         FROM airhop_organizations WHERE community_id = $1 AND status = 'active' FOR SHARE",
    )
    .bind(tenant.community().as_uuid())
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or_else(|| DbError::NotFound("active AirHub organization".to_owned()))?;
    Ok((
        row.try_get("id")?,
        row.try_get("current_date")?,
        row.try_get("occurred_at")?,
    ))
}

async fn load_occurrence<'e, E>(
    executor: E,
    tenant: &TenantContext,
    organization_id: Uuid,
    lesson_ref: StableLessonReference,
    lock: bool,
) -> Result<LessonOccurrence>
where
    E: sqlx::Executor<'e, Database = Postgres>,
{
    let query = if lock {
        "SELECT group_id, effective_date, starts_at, status, track_attendance \
         FROM airhop_lesson_occurrences \
         WHERE community_id = $1 AND organization_id = $2 \
           AND recurrence_rule_id = $3 AND original_date = $4 FOR UPDATE"
    } else {
        "SELECT group_id, effective_date, starts_at, status, track_attendance \
         FROM airhop_lesson_occurrences \
         WHERE community_id = $1 AND organization_id = $2 \
           AND recurrence_rule_id = $3 AND original_date = $4"
    };
    let row = sqlx::query(query)
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(lesson_ref.recurrence_rule_id)
        .bind(lesson_ref.original_date)
        .fetch_optional(executor)
        .await?
        .ok_or_else(|| DbError::NotFound("AirHub lesson occurrence".to_owned()))?;
    Ok(LessonOccurrence {
        group_id: row.try_get("group_id")?,
        effective_date: row.try_get("effective_date")?,
        starts_at: row.try_get("starts_at")?,
        status: row.try_get("status")?,
        track_attendance: row.try_get("track_attendance")?,
    })
}

fn parse_roster_entry(row: sqlx::postgres::PgRow) -> Result<StaffLessonRosterEntry> {
    let status = row
        .try_get::<Option<&str>, _>("attendance_status")?
        .map(LessonAttendanceStatus::from_db)
        .transpose()?;
    Ok(StaffLessonRosterEntry {
        family_id: row.try_get("family_id")?,
        family_name: row.try_get("family_name")?,
        representative_id: row.try_get("representative_id")?,
        representative_name: row.try_get("representative_name")?,
        child_id: row.try_get("child_id")?,
        child_name: row.try_get("child_name")?,
        booking_id: row.try_get("booking_id")?,
        booking_status: row.try_get("booking_status")?,
        visit_kind: row.try_get("visit_kind")?,
        enrollment_id: row.try_get("enrollment_id")?,
        attendance_id: row.try_get("attendance_id")?,
        attendance_status: status,
        attendance_version: row.try_get("attendance_version")?,
        attendance_marked_at: row.try_get("attendance_marked_at")?,
    })
}

async fn resolve_staff_identity(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    current_date: NaiveDate,
    occurred_at: DateTime<Utc>,
    client: &StaffLessonParticipantClient,
) -> Result<ResolvedStaffIdentity> {
    match client {
        StaffLessonParticipantClient::Existing {
            family_id,
            representative_id,
            child_id,
        } => {
            let row = sqlx::query(
                "SELECT family.display_name AS family_name, \
                        representative.display_name AS representative_name, \
                        representative.phone_normalized, representative.phone_display, \
                        representative.preferred_contact_channel, \
                        child.display_name AS child_name, child.birth_date \
                 FROM airhop_families family \
                 JOIN airhop_representatives representative \
                   ON representative.community_id = family.community_id \
                  AND representative.organization_id = family.organization_id \
                  AND representative.family_id = family.id AND representative.id = $4 \
                 JOIN airhop_children child \
                   ON child.community_id = family.community_id \
                  AND child.organization_id = family.organization_id \
                  AND child.family_id = family.id AND child.id = $5 \
                 WHERE family.community_id = $1 AND family.organization_id = $2 \
                   AND family.id = $3 AND family.status = 'active' \
                   AND representative.status = 'active' AND child.status = 'active' \
                 FOR SHARE OF family, representative, child",
            )
            .bind(tenant.community().as_uuid())
            .bind(organization_id)
            .bind(*family_id)
            .bind(*representative_id)
            .bind(*child_id)
            .fetch_optional(&mut **transaction)
            .await?
            .ok_or(DbError::AirhopIdentityMismatch)?;
            let consent_id = insert_staff_consent(
                transaction,
                tenant,
                organization_id,
                *representative_id,
                occurred_at,
            )
            .await?;
            Ok(ResolvedStaffIdentity {
                family_id: *family_id,
                representative_id: *representative_id,
                child_id: *child_id,
                consent_id,
                applicant_snapshot: json!({
                    "parentName": row.try_get::<String, _>("representative_name")?,
                    "phoneNormalized": row.try_get::<String, _>("phone_normalized")?,
                    "phoneDisplay": row.try_get::<String, _>("phone_display")?,
                    "childName": row.try_get::<String, _>("child_name")?,
                    "childBirthDate": row.try_get::<NaiveDate, _>("birth_date")?,
                    "preferredContactChannel": row.try_get::<String, _>("preferred_contact_channel")?,
                    "consentPolicyVersion": "staff-entry-v1",
                    "consentAcceptedAt": occurred_at,
                }),
            })
        }
        StaffLessonParticipantClient::New {
            applicant,
            phone_match_digest,
        } => {
            let applicant = normalize_applicant(applicant, current_date)?;
            acquire_identity_lock(
                transaction,
                tenant,
                organization_id,
                phone_match_digest,
                &applicant.phone_normalized,
            )
            .await?;
            let evidence = json!({ "schemaVersion": 1, "source": "staff_direct" });
            let identity = resolve_identity(
                transaction,
                tenant,
                organization_id,
                &applicant,
                IdentityConsent {
                    phone_match_digest,
                    channel: "staff_ui",
                    evidence: &evidence,
                },
                occurred_at,
            )
            .await?;
            Ok(ResolvedStaffIdentity {
                family_id: identity.family_id,
                representative_id: identity.representative_id,
                child_id: identity.child_id,
                consent_id: identity.consent_id,
                applicant_snapshot: applicant_snapshot(&applicant, occurred_at),
            })
        }
    }
}

async fn insert_staff_consent(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    representative_id: Uuid,
    occurred_at: DateTime<Utc>,
) -> Result<Uuid> {
    let consent_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO airhop_consents ( \
             community_id, organization_id, id, representative_id, purpose, channel, \
             policy_version, status, effective_at, evidence \
         ) VALUES ($1, $2, $3, $4, 'public_booking', 'staff_ui', \
                   'staff-entry-v1', 'granted', $5, $6)",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(consent_id)
    .bind(representative_id)
    .bind(occurred_at)
    .bind(json!({ "schemaVersion": 1, "source": "staff_direct" }))
    .execute(&mut **transaction)
    .await?;
    Ok(consent_id)
}

async fn load_existing_booking(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    lesson_ref: StableLessonReference,
    child_id: Uuid,
) -> Result<Option<ExistingBooking>> {
    let row = sqlx::query(
        "SELECT id, status, visit_kind FROM airhop_bookings \
         WHERE community_id = $1 AND organization_id = $2 AND child_id = $3 \
           AND recurrence_rule_id = $4 AND original_date = $5 \
           AND status IN ('pending_confirmation', 'confirmed') FOR UPDATE",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(child_id)
    .bind(lesson_ref.recurrence_rule_id)
    .bind(lesson_ref.original_date)
    .fetch_optional(&mut **transaction)
    .await?;
    row.map(|row| {
        Ok(ExistingBooking {
            id: row.try_get("id")?,
            status: row.try_get("status")?,
            visit_kind: BookingVisitKind::from_db(row.try_get("visit_kind")?)?,
        })
    })
    .transpose()
}

async fn promote_booking(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    booking_id: Uuid,
    actor: &AirhopActor,
    occurred_at: DateTime<Utc>,
) -> Result<i64> {
    let version = sqlx::query_scalar(
        "UPDATE airhop_bookings \
         SET status = 'confirmed', transfer_request = NULL, \
             source = jsonb_set(source, '{workflow}', '\"direct\"'::jsonb, true), \
             actor_kind = $4, actor_pubkey = $5, updated_at = $6, version = version + 1 \
         WHERE community_id = $1 AND organization_id = $2 AND id = $3 \
           AND status = 'pending_confirmation' RETURNING version",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(booking_id)
    .bind(actor.kind.as_db_str())
    .bind(actor.pubkey.map(Vec::from))
    .bind(occurred_at)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or(DbError::AirhopBookingConflict)?;
    Ok(version)
}

async fn child_has_enrollment_or_booking(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    lesson_ref: StableLessonReference,
    child_id: Uuid,
    occurrence: &LessonOccurrence,
) -> Result<bool> {
    let booking_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM airhop_bookings \
         WHERE community_id = $1 AND organization_id = $2 AND child_id = $3 \
           AND recurrence_rule_id = $4 AND original_date = $5 \
           AND status IN ('pending_confirmation', 'confirmed'))",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(child_id)
    .bind(lesson_ref.recurrence_rule_id)
    .bind(lesson_ref.original_date)
    .fetch_one(&mut **transaction)
    .await?;
    if booking_exists {
        return Ok(true);
    }
    enrollment_exists(
        &mut **transaction,
        tenant,
        organization_id,
        lesson_ref,
        child_id,
        occurrence,
    )
    .await
}

async fn enrollment_exists<'e, E>(
    executor: E,
    tenant: &TenantContext,
    organization_id: Uuid,
    lesson_ref: StableLessonReference,
    child_id: Uuid,
    occurrence: &LessonOccurrence,
) -> Result<bool>
where
    E: sqlx::Executor<'e, Database = Postgres>,
{
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM airhop_enrollments enrollment \
         WHERE enrollment.community_id = $1 AND enrollment.organization_id = $2 \
           AND enrollment.child_id = $3 AND enrollment.group_id = $4 \
           AND enrollment.status = 'active' AND enrollment.start_date <= $5 \
           AND (enrollment.end_date IS NULL OR enrollment.end_date >= $5) \
           AND (enrollment.assignment_state = 'needs_assignment' OR EXISTS ( \
               SELECT 1 FROM airhop_enrollment_schedule selection \
               WHERE selection.community_id = enrollment.community_id \
                 AND selection.organization_id = enrollment.organization_id \
                 AND selection.enrollment_id = enrollment.id \
                 AND selection.recurrence_rule_id = $6 AND selection.weekday = $7)))",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(child_id)
    .bind(occurrence.group_id)
    .bind(occurrence.effective_date)
    .bind(lesson_ref.recurrence_rule_id)
    .bind(weekday_str(Weekday::from(
        lesson_ref.original_date.weekday(),
    )))
    .fetch_one(executor)
    .await?)
}

async fn upsert_attendance(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    input: &SetStaffLessonAttendanceInput,
    existing_id: Option<Uuid>,
    status: LessonAttendanceStatus,
    occurred_at: DateTime<Utc>,
) -> Result<Uuid> {
    let actor_pubkey = input.actor.pubkey.ok_or_else(|| {
        DbError::InvalidData("AirHub attendance actor requires a pubkey".to_owned())
    })?;
    if let Some(id) = existing_id {
        sqlx::query(
            "UPDATE airhop_lesson_attendance SET status = $4, marked_by_pubkey = $5, \
                    marked_at = $6, updated_at = $6, version = version + 1 \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(id)
        .bind(status.as_db_str())
        .bind(actor_pubkey.as_slice())
        .bind(occurred_at)
        .execute(&mut **transaction)
        .await?;
        Ok(id)
    } else {
        let id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO airhop_lesson_attendance ( \
                 community_id, organization_id, id, recurrence_rule_id, original_date, \
                 child_id, status, marked_by_pubkey, marked_at, updated_at \
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(id)
        .bind(input.lesson_ref.recurrence_rule_id)
        .bind(input.lesson_ref.original_date)
        .bind(input.child_id)
        .bind(status.as_db_str())
        .bind(actor_pubkey.as_slice())
        .bind(occurred_at)
        .execute(&mut **transaction)
        .await?;
        Ok(id)
    }
}

async fn replay_participant(
    transaction: Transaction<'_, Postgres>,
    command: AirhopCommand,
) -> Result<AddStaffLessonParticipantOutcome> {
    match command.status {
        CommandStatus::Pending => Err(DbError::AirhopCommandInProgress),
        CommandStatus::Failed => Err(DbError::AirhopCommandPreviouslyFailed),
        CommandStatus::Committed => {
            let stored: StoredParticipantResult =
                serde_json::from_value(command.result.ok_or_else(|| {
                    DbError::InvalidData("committed AirHub command has no result".to_owned())
                })?)?;
            transaction.commit().await?;
            Ok(AddStaffLessonParticipantOutcome {
                family_id: stored.family_id,
                representative_id: stored.representative_id,
                child_id: stored.child_id,
                booking_id: stored.booking_id,
                participant_status: stored.participant_status,
                visit_kind: stored.visit_kind,
                replayed: true,
            })
        }
    }
}

async fn replay_attendance(
    transaction: Transaction<'_, Postgres>,
    command: AirhopCommand,
) -> Result<SetStaffLessonAttendanceOutcome> {
    match command.status {
        CommandStatus::Pending => Err(DbError::AirhopCommandInProgress),
        CommandStatus::Failed => Err(DbError::AirhopCommandPreviouslyFailed),
        CommandStatus::Committed => {
            let stored: StoredAttendanceResult =
                serde_json::from_value(command.result.ok_or_else(|| {
                    DbError::InvalidData("committed AirHub command has no result".to_owned())
                })?)?;
            transaction.commit().await?;
            Ok(SetStaffLessonAttendanceOutcome {
                child_id: stored.child_id,
                attendance_id: stored.attendance_id,
                status: stored.status,
                version: stored.version,
                replayed: true,
            })
        }
    }
}

fn validate_add_participant(input: &AddStaffLessonParticipantInput) -> Result<()> {
    input.actor.validate()?;
    if input.lesson_ref.recurrence_rule_id.is_nil() || input.management_key_version <= 0 {
        return Err(DbError::InvalidData(
            "AirHub participant lesson identity is invalid".to_owned(),
        ));
    }
    match &input.client {
        StaffLessonParticipantClient::Existing {
            family_id,
            representative_id,
            child_id,
        } if family_id.is_nil() || representative_id.is_nil() || child_id.is_nil() => Err(
            DbError::InvalidData("AirHub participant identity is invalid".to_owned()),
        ),
        _ => Ok(()),
    }
}

fn validate_attendance(input: &SetStaffLessonAttendanceInput) -> Result<()> {
    input.actor.validate()?;
    if input.lesson_ref.recurrence_rule_id.is_nil()
        || input.child_id.is_nil()
        || input.expected_version < 0
    {
        return Err(DbError::InvalidData(
            "AirHub attendance identity or version is invalid".to_owned(),
        ));
    }
    Ok(())
}

const fn weekday_str(value: Weekday) -> &'static str {
    match value {
        Weekday::Monday => "monday",
        Weekday::Tuesday => "tuesday",
        Weekday::Wednesday => "wednesday",
        Weekday::Thursday => "thursday",
        Weekday::Friday => "friday",
        Weekday::Saturday => "saturday",
        Weekday::Sunday => "sunday",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attendance_status_uses_stable_wire_values() {
        assert_eq!(LessonAttendanceStatus::Present.as_db_str(), "present");
        assert_eq!(LessonAttendanceStatus::Absent.as_db_str(), "absent");
        assert_eq!(
            serde_json::to_value(LessonAttendanceStatus::Present).unwrap(),
            json!("present")
        );
    }

    #[test]
    fn weekday_mapping_matches_enrollment_schema() {
        assert_eq!(weekday_str(Weekday::Monday), "monday");
        assert_eq!(weekday_str(Weekday::Sunday), "sunday");
    }

    #[test]
    fn new_staff_applicant_keeps_phone_contact_semantics() {
        let applicant = PublicBookingApplicant {
            parent_name: "Анна".to_owned(),
            phone_normalized: "+79991234567".to_owned(),
            phone_display: "+7 999 123-45-67".to_owned(),
            child_name: "Маша".to_owned(),
            child_birth_date: NaiveDate::from_ymd_opt(2020, 1, 1).unwrap(),
            preferred_contact_channel: super::super::public_booking::PreferredContactChannel::Phone,
            consent_policy_version: "staff-entry-v1".to_owned(),
        };
        assert_eq!(applicant.preferred_contact_channel.as_db_str(), "phone");
    }
}
