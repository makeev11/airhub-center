//! Capacity-safe AirHub booking persistence.

use airhop_core::{AgeLimits, BookingStatus, StableLessonReference, TrialPolicy, Weekday};
use buzz_core::TenantContext;
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use serde_json::Value;
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use super::AirhopActor;
use crate::{DbError, Result};

/// Revalidates an existing held seat before an agent confirms it. The booking
/// is locked by the command service; the occurrence serializes capacity changes.
pub(super) async fn recheck_online_confirmation(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    booking_id: Uuid,
) -> Result<()> {
    let row = sqlx::query(
        "SELECT b.organization_id, b.recurrence_rule_id, b.original_date, b.child_id,
                b.visit_kind, b.transfer_request, o.group_id, o.effective_date, o.capacity,
                o.trial_policy, o.allow_single_visits, g.min_age_months, g.max_age_months, child.birth_date
         FROM airhop_bookings b
         JOIN airhop_lesson_occurrences o ON o.community_id = b.community_id AND o.organization_id = b.organization_id
           AND o.recurrence_rule_id = b.recurrence_rule_id AND o.original_date = b.original_date
         JOIN airhop_groups g ON g.community_id = o.community_id AND g.organization_id = o.organization_id AND g.id = o.group_id
         JOIN airhop_children child ON child.community_id = b.community_id AND child.organization_id = b.organization_id AND child.id = b.child_id
         JOIN airhop_families f ON f.community_id = b.community_id AND f.organization_id = b.organization_id AND f.id = b.family_id
         JOIN airhop_representatives p ON p.community_id = b.community_id AND p.organization_id = b.organization_id AND p.id = b.representative_id
         JOIN airhop_consents consent ON consent.community_id = b.community_id AND consent.organization_id = b.organization_id AND consent.id = b.consent_id
         WHERE b.community_id = $1 AND b.id = $2 AND b.status = 'pending_confirmation'
           AND o.starts_at > now() AND o.status <> 'cancelled' AND g.status = 'active'
           AND child.status = 'active' AND f.status = 'active' AND p.status = 'active'
           AND consent.purpose = 'public_booking' AND consent.status = 'granted' AND consent.effective_at <= now()
           AND NOT EXISTS (SELECT 1 FROM airhop_duplicate_candidates candidate
               WHERE candidate.community_id = b.community_id AND candidate.organization_id = b.organization_id
                 AND candidate.status = 'pending' AND (
                   (candidate.new_entity_type = 'representative' AND candidate.new_entity_id = b.representative_id)
                   OR (candidate.existing_entity_type = 'representative' AND candidate.existing_entity_id = b.representative_id)
                   OR (candidate.new_entity_type = 'child' AND candidate.new_entity_id = b.child_id)
                   OR (candidate.existing_entity_type = 'child' AND candidate.existing_entity_id = b.child_id)))
         FOR UPDATE OF o",
    ).bind(tenant.community().as_uuid()).bind(booking_id).fetch_optional(&mut **tx).await?
        .ok_or(DbError::AirhopOccurrenceUnavailable)?;
    if row
        .try_get::<Option<Value>, _>("transfer_request")?
        .is_some()
    {
        return Err(DbError::AirhopBookingTransition);
    }
    let trial_policy: TrialPolicy = serde_json::from_value(row.try_get("trial_policy")?)?;
    validate_visit_policy(
        BookingVisitKind::from_db(row.try_get("visit_kind")?)?,
        &trial_policy,
        row.try_get("allow_single_visits")?,
    )?;
    let age = AgeLimits::new(
        optional_months(row.try_get("min_age_months")?)?,
        optional_months(row.try_get("max_age_months")?)?,
    )
    .map_err(|error| DbError::InvalidData(error.to_string()))?;
    let date: NaiveDate = row.try_get("effective_date")?;
    if !age.contains_birth_date(row.try_get("birth_date")?, date) {
        return Err(DbError::AirhopAgeMismatch);
    }
    // Pending bookings already hold seats. Count unique children across both
    // permanent enrollments and bookings, using the Core's schedule selection.
    let original_date: NaiveDate = row.try_get("original_date")?;
    let occupied: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::BIGINT FROM (
           SELECT e.child_id FROM airhop_enrollments e
           WHERE e.community_id = $1 AND e.organization_id = $2 AND e.group_id = $3 AND e.status = 'active'
             AND e.start_date <= $4 AND (e.end_date IS NULL OR e.end_date >= $4)
             AND (e.assignment_state = 'needs_assignment' OR EXISTS (
                 SELECT 1 FROM airhop_enrollment_schedule s WHERE s.community_id = e.community_id
                   AND s.organization_id = e.organization_id AND s.enrollment_id = e.id
                   AND s.recurrence_rule_id = $5 AND s.weekday = $6))
           UNION SELECT b.child_id FROM airhop_bookings b WHERE b.community_id = $1 AND b.organization_id = $2
             AND b.recurrence_rule_id = $5 AND b.original_date = $7 AND b.status IN ('pending_confirmation', 'confirmed')
         ) participants",
    ).bind(tenant.community().as_uuid()).bind(row.try_get::<Uuid, _>("organization_id")?)
        .bind(row.try_get::<Uuid, _>("group_id")?).bind(date)
        .bind(row.try_get::<Uuid, _>("recurrence_rule_id")?).bind(weekday_str(Weekday::from(original_date.weekday())))
        .bind(original_date).fetch_one(&mut **tx).await?;
    if row
        .try_get::<Option<i32>, _>("capacity")?
        .is_some_and(|capacity| occupied > i64::from(capacity))
    {
        return Err(DbError::AirhopCapacityFull);
    }
    Ok(())
}

/// Commercial meaning of one booking.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BookingVisitKind {
    /// A trial visit governed by the occurrence's effective trial policy.
    Trial,
    /// A permitted one-off lesson visit.
    Single,
}

impl BookingVisitKind {
    pub(super) const fn as_db_str(self) -> &'static str {
        match self {
            Self::Trial => "trial",
            Self::Single => "single",
        }
    }

    pub(super) fn from_db(value: &str) -> Result<Self> {
        match value {
            "trial" => Ok(Self::Trial),
            "single" => Ok(Self::Single),
            other => Err(DbError::InvalidData(format!(
                "unknown AirHub booking visit kind {other:?}"
            ))),
        }
    }
}

/// Inputs already resolved or created by an authenticated command service.
#[derive(Debug, Clone, PartialEq)]
pub struct NewBooking {
    /// Booking identifier allocated by the command service.
    pub id: Uuid,
    /// Organization selected from the host-resolved tenant.
    pub organization_id: Uuid,
    /// Family owning both the representative and child.
    pub family_id: Uuid,
    /// Representative who submitted or authorized the booking.
    pub representative_id: Uuid,
    /// Child reserving the seat.
    pub child_id: Uuid,
    /// Append-only granted public-booking consent evidence.
    pub consent_id: Uuid,
    /// Stable occurrence identity.
    pub lesson_ref: StableLessonReference,
    /// Pending command receipt that causes this state change.
    pub command_id: Uuid,
    /// Immutable applicant fields as presented when the command was accepted.
    pub applicant_snapshot: Value,
    /// Requested commercial visit kind.
    pub visit_kind: BookingVisitKind,
    /// Initial seat-holding state.
    pub status: BookingStatus,
    /// Keyed digest of the opaque parent management credential.
    pub management_token_digest: [u8; 32],
    /// Secret-key version used to produce the credential digest.
    pub management_key_version: i16,
    /// Structured surface/channel/workflow attribution.
    pub source: Value,
    /// Verified actor attribution copied from the command envelope.
    pub actor: AirhopActor,
    /// Stable human-readable creator label.
    pub created_by: String,
    /// Optional private note for center staff.
    pub internal_comment: Option<String>,
}

/// Persisted booking identity and lifecycle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BookingRecord {
    /// Booking identifier.
    pub id: Uuid,
    /// Organization identifier.
    pub organization_id: Uuid,
    /// Family identifier.
    pub family_id: Uuid,
    /// Representative identifier.
    pub representative_id: Uuid,
    /// Child identifier.
    pub child_id: Uuid,
    /// Stable occurrence identity.
    pub lesson_ref: StableLessonReference,
    /// Visit kind.
    pub visit_kind: BookingVisitKind,
    /// Booking lifecycle status.
    pub status: BookingStatus,
    /// Optimistic row version.
    pub version: i64,
    /// Creation instant.
    pub created_at: DateTime<Utc>,
    /// Last update instant.
    pub updated_at: DateTime<Utc>,
}

/// Reserves one lesson for one distinct child inside the command transaction.
///
/// The stable materialized occurrence row is locked before authoritative age,
/// policy, identity, and capacity checks. Concurrent reservations for the same
/// occurrence therefore serialize, while enrollment and booking occupancy is
/// deduplicated by child id. The caller is responsible for appending the
/// resulting domain event and committing the command in this same transaction.
pub async fn reserve_booking(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    input: &NewBooking,
) -> Result<BookingRecord> {
    validate_new_booking(input)?;
    let occurrence = sqlx::query(
        "SELECT o.group_id, o.effective_date, o.capacity, o.trial_policy, \
                o.allow_single_visits, o.status AS occurrence_status, \
                g.min_age_months, g.max_age_months, g.status AS group_status, \
                org.status AS organization_status \
         FROM airhop_lesson_occurrences o \
         JOIN airhop_groups g \
           ON g.community_id = o.community_id \
          AND g.organization_id = o.organization_id AND g.id = o.group_id \
         JOIN airhop_organizations org \
           ON org.community_id = o.community_id AND org.id = o.organization_id \
         WHERE o.community_id = $1 AND o.organization_id = $2 \
           AND o.recurrence_rule_id = $3 AND o.original_date = $4 \
           AND o.starts_at > now() \
         FOR UPDATE OF o",
    )
    .bind(tenant.community().as_uuid())
    .bind(input.organization_id)
    .bind(input.lesson_ref.recurrence_rule_id)
    .bind(input.lesson_ref.original_date)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or(DbError::AirhopOccurrenceUnavailable)?;

    let occurrence_status: &str = occurrence.try_get("occurrence_status")?;
    let group_status: &str = occurrence.try_get("group_status")?;
    let organization_status: &str = occurrence.try_get("organization_status")?;
    if occurrence_status == "cancelled"
        || group_status != "active"
        || organization_status != "active"
    {
        return Err(DbError::AirhopOccurrenceUnavailable);
    }
    let effective_date: NaiveDate = occurrence.try_get("effective_date")?;
    let group_id: Uuid = occurrence.try_get("group_id")?;
    let trial_policy: TrialPolicy = serde_json::from_value(occurrence.try_get("trial_policy")?)?;
    validate_visit_policy(
        input.visit_kind,
        &trial_policy,
        occurrence.try_get("allow_single_visits")?,
    )?;

    let identity = sqlx::query(
        "SELECT child.birth_date \
         FROM airhop_children child \
         JOIN airhop_families family \
           ON family.community_id = child.community_id \
          AND family.organization_id = child.organization_id \
          AND family.id = child.family_id \
         JOIN airhop_representatives representative \
           ON representative.community_id = child.community_id \
          AND representative.organization_id = child.organization_id \
          AND representative.family_id = child.family_id \
          AND representative.id = $4 \
         JOIN airhop_consents consent \
           ON consent.community_id = representative.community_id \
          AND consent.organization_id = representative.organization_id \
          AND consent.representative_id = representative.id \
          AND consent.id = $6 \
         JOIN airhop_commands command \
           ON command.community_id = child.community_id \
          AND command.organization_id = child.organization_id \
          AND command.id = $7 \
         WHERE child.community_id = $1 AND child.organization_id = $2 \
           AND child.family_id = $3 AND child.id = $5 \
           AND family.status = 'active' AND child.status = 'active' \
           AND representative.status = 'active' \
           AND consent.purpose = 'public_booking' AND consent.status = 'granted' \
           AND consent.effective_at <= now() AND command.status = 'pending' \
         FOR SHARE OF family, child, representative",
    )
    .bind(tenant.community().as_uuid())
    .bind(input.organization_id)
    .bind(input.family_id)
    .bind(input.representative_id)
    .bind(input.child_id)
    .bind(input.consent_id)
    .bind(input.command_id)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or(DbError::AirhopIdentityMismatch)?;
    let birth_date: NaiveDate = identity.try_get("birth_date")?;
    let minimum_age = optional_months(occurrence.try_get("min_age_months")?)?;
    let maximum_age = optional_months(occurrence.try_get("max_age_months")?)?;
    let age_limits = AgeLimits::new(minimum_age, maximum_age)
        .map_err(|error| DbError::InvalidData(error.to_string()))?;
    if !age_limits.contains_birth_date(birth_date, effective_date) {
        return Err(DbError::AirhopAgeMismatch);
    }

    let occupancy = sqlx::query(
        "SELECT COUNT(*)::BIGINT AS occupancy, \
                COALESCE(bool_or(child_id = $7), FALSE) AS already_present \
         FROM ( \
             SELECT enrollment.child_id \
             FROM airhop_enrollments enrollment \
             WHERE enrollment.community_id = $1 AND enrollment.organization_id = $2 \
               AND enrollment.group_id = $3 AND enrollment.status = 'active' \
               AND enrollment.start_date <= $4 \
               AND (enrollment.end_date IS NULL OR enrollment.end_date >= $4) \
               AND ( \
                   enrollment.assignment_state = 'needs_assignment' \
                   OR EXISTS ( \
                       SELECT 1 FROM airhop_enrollment_schedule selection \
                       WHERE selection.community_id = enrollment.community_id \
                         AND selection.organization_id = enrollment.organization_id \
                         AND selection.enrollment_id = enrollment.id \
                         AND selection.recurrence_rule_id = $5 \
                         AND selection.weekday = $6 \
                   ) \
               ) \
             UNION \
             SELECT booking.child_id \
             FROM airhop_bookings booking \
             WHERE booking.community_id = $1 AND booking.organization_id = $2 \
               AND booking.recurrence_rule_id = $5 \
               AND booking.original_date = $8 \
               AND booking.status IN ('pending_confirmation', 'confirmed') \
         ) participants",
    )
    .bind(tenant.community().as_uuid())
    .bind(input.organization_id)
    .bind(group_id)
    .bind(effective_date)
    .bind(input.lesson_ref.recurrence_rule_id)
    .bind(weekday_str(Weekday::from(
        input.lesson_ref.original_date.weekday(),
    )))
    .bind(input.child_id)
    .bind(input.lesson_ref.original_date)
    .fetch_one(&mut **transaction)
    .await?;
    let occupied: i64 = occupancy.try_get("occupancy")?;
    let already_present: bool = occupancy.try_get("already_present")?;
    let capacity: Option<i32> = occurrence.try_get("capacity")?;
    if !has_capacity(capacity, occupied, already_present) {
        return Err(DbError::AirhopCapacityFull);
    }

    let actor_pubkey = input.actor.pubkey.map(Vec::from);
    let inserted = sqlx::query(
        "INSERT INTO airhop_bookings (\
             community_id, organization_id, id, family_id, representative_id, child_id, \
             consent_id, recurrence_rule_id, original_date, command_id, \
             applicant_snapshot, visit_kind, status, management_token_digest, \
             management_key_version, source, actor_kind, actor_pubkey, created_by, \
             internal_comment\
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, \
                   $14, $15, $16, $17, $18, $19, $20) \
         RETURNING id, organization_id, family_id, representative_id, child_id, \
             recurrence_rule_id, original_date, visit_kind, status, version, \
             created_at, updated_at",
    )
    .bind(tenant.community().as_uuid())
    .bind(input.organization_id)
    .bind(input.id)
    .bind(input.family_id)
    .bind(input.representative_id)
    .bind(input.child_id)
    .bind(input.consent_id)
    .bind(input.lesson_ref.recurrence_rule_id)
    .bind(input.lesson_ref.original_date)
    .bind(input.command_id)
    .bind(&input.applicant_snapshot)
    .bind(input.visit_kind.as_db_str())
    .bind(booking_status_str(input.status))
    .bind(input.management_token_digest.as_slice())
    .bind(input.management_key_version)
    .bind(&input.source)
    .bind(input.actor.kind.as_db_str())
    .bind(actor_pubkey)
    .bind(&input.created_by)
    .bind(&input.internal_comment)
    .fetch_one(&mut **transaction)
    .await;
    match inserted {
        Ok(row) => parse_booking_row(row),
        Err(sqlx::Error::Database(error)) if error.code().as_deref() == Some("23505") => {
            Err(DbError::AirhopBookingConflict)
        }
        Err(error) => Err(error.into()),
    }
}

fn validate_new_booking(input: &NewBooking) -> Result<()> {
    input.actor.validate()?;
    if input.id.is_nil()
        || input.organization_id.is_nil()
        || input.family_id.is_nil()
        || input.representative_id.is_nil()
        || input.child_id.is_nil()
        || input.consent_id.is_nil()
        || input.lesson_ref.recurrence_rule_id.is_nil()
        || input.command_id.is_nil()
    {
        return Err(DbError::InvalidData(
            "AirHub booking identifiers cannot be nil".to_owned(),
        ));
    }
    if !input.status.holds_seat() {
        return Err(DbError::InvalidData(
            "AirHub reservation must start in a seat-holding state".to_owned(),
        ));
    }
    if input.management_key_version <= 0 {
        return Err(DbError::InvalidData(
            "AirHub management key version must be positive".to_owned(),
        ));
    }
    if !input.applicant_snapshot.is_object() || !input.source.is_object() {
        return Err(DbError::InvalidData(
            "AirHub booking snapshot and source must be objects".to_owned(),
        ));
    }
    if input.created_by.trim().is_empty() || input.created_by.len() > 200 {
        return Err(DbError::InvalidData(
            "AirHub booking creator label is invalid".to_owned(),
        ));
    }
    if input
        .internal_comment
        .as_ref()
        .is_some_and(|comment| comment.len() > 4_000)
    {
        return Err(DbError::InvalidData(
            "AirHub booking internal comment is too long".to_owned(),
        ));
    }
    Ok(())
}

fn validate_visit_policy(
    visit_kind: BookingVisitKind,
    trial_policy: &TrialPolicy,
    single_visit_allowed: bool,
) -> Result<()> {
    match visit_kind {
        BookingVisitKind::Trial if matches!(trial_policy, TrialPolicy::Disabled) => {
            Err(DbError::AirhopVisitDisabled)
        }
        BookingVisitKind::Single if !single_visit_allowed => Err(DbError::AirhopVisitDisabled),
        BookingVisitKind::Trial | BookingVisitKind::Single => Ok(()),
    }
}

fn optional_months(value: Option<i32>) -> Result<Option<u32>> {
    value
        .map(u32::try_from)
        .transpose()
        .map_err(|_| DbError::InvalidData("AirHub age limit is invalid".to_owned()))
}

const fn has_capacity(capacity: Option<i32>, occupied: i64, already_present: bool) -> bool {
    already_present
        || match capacity {
            None => true,
            Some(limit) => occupied < limit as i64,
        }
}

const fn weekday_str(weekday: Weekday) -> &'static str {
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

const fn booking_status_str(status: BookingStatus) -> &'static str {
    match status {
        BookingStatus::PendingConfirmation => "pending_confirmation",
        BookingStatus::Confirmed => "confirmed",
        BookingStatus::Rejected => "rejected",
        BookingStatus::CancelledByParent => "cancelled_by_parent",
        BookingStatus::CancelledByCenter => "cancelled_by_center",
    }
}

fn booking_status_from_db(value: &str) -> Result<BookingStatus> {
    match value {
        "pending_confirmation" => Ok(BookingStatus::PendingConfirmation),
        "confirmed" => Ok(BookingStatus::Confirmed),
        "rejected" => Ok(BookingStatus::Rejected),
        "cancelled_by_parent" => Ok(BookingStatus::CancelledByParent),
        "cancelled_by_center" => Ok(BookingStatus::CancelledByCenter),
        other => Err(DbError::InvalidData(format!(
            "unknown AirHub booking status {other:?}"
        ))),
    }
}

fn parse_booking_row(row: sqlx::postgres::PgRow) -> Result<BookingRecord> {
    Ok(BookingRecord {
        id: row.try_get("id")?,
        organization_id: row.try_get("organization_id")?,
        family_id: row.try_get("family_id")?,
        representative_id: row.try_get("representative_id")?,
        child_id: row.try_get("child_id")?,
        lesson_ref: StableLessonReference {
            recurrence_rule_id: row.try_get("recurrence_rule_id")?,
            original_date: row.try_get("original_date")?,
        },
        visit_kind: BookingVisitKind::from_db(row.try_get("visit_kind")?)?,
        status: booking_status_from_db(row.try_get("status")?)?,
        version: row.try_get("version")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

/// Loads one booking from the authoritative writer transaction.
pub(super) async fn get_booking_by_id(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    booking_id: Uuid,
) -> Result<Option<BookingRecord>> {
    let row = sqlx::query(
        "SELECT id, organization_id, family_id, representative_id, child_id, \
                recurrence_rule_id, original_date, visit_kind, status, version, \
                created_at, updated_at \
         FROM airhop_bookings \
         WHERE community_id = $1 AND organization_id = $2 AND id = $3",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(booking_id)
    .fetch_optional(&mut **transaction)
    .await?;
    row.map(parse_booking_row).transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::airhop::ActorKind;

    fn input(status: BookingStatus) -> NewBooking {
        NewBooking {
            id: Uuid::from_u128(1),
            organization_id: Uuid::from_u128(2),
            family_id: Uuid::from_u128(3),
            representative_id: Uuid::from_u128(4),
            child_id: Uuid::from_u128(5),
            consent_id: Uuid::from_u128(6),
            lesson_ref: StableLessonReference {
                recurrence_rule_id: Uuid::from_u128(7),
                original_date: NaiveDate::from_ymd_opt(2026, 8, 17).expect("valid test date"),
            },
            command_id: Uuid::from_u128(8),
            applicant_snapshot: serde_json::json!({"childName": "Мария"}),
            visit_kind: BookingVisitKind::Trial,
            status,
            management_token_digest: [9; 32],
            management_key_version: 1,
            source: serde_json::json!({"surface": "standalone"}),
            actor: AirhopActor {
                kind: ActorKind::Public,
                pubkey: None,
                on_behalf_of_pubkey: None,
                agent_pubkey: None,
            },
            created_by: "public-booking".to_owned(),
            internal_comment: None,
        }
    }

    #[test]
    fn reservation_requires_a_seat_holding_initial_status() {
        assert!(validate_new_booking(&input(BookingStatus::PendingConfirmation)).is_ok());
        assert!(validate_new_booking(&input(BookingStatus::Confirmed)).is_ok());
        assert!(validate_new_booking(&input(BookingStatus::Rejected)).is_err());
    }

    #[test]
    fn effective_policy_gates_trial_and_single_visits() {
        assert!(
            validate_visit_policy(BookingVisitKind::Trial, &TrialPolicy::Disabled, true).is_err()
        );
        assert!(validate_visit_policy(BookingVisitKind::Trial, &TrialPolicy::Free, false).is_ok());
        assert!(
            validate_visit_policy(BookingVisitKind::Single, &TrialPolicy::Free, false).is_err()
        );
        assert!(
            validate_visit_policy(BookingVisitKind::Single, &TrialPolicy::Disabled, true).is_ok()
        );
    }

    #[test]
    fn full_capacity_still_allows_an_existing_participant() {
        assert!(!has_capacity(Some(12), 12, false));
        assert!(has_capacity(Some(12), 12, true));
        assert!(has_capacity(None, 10_000, false));
    }

    #[test]
    fn stable_original_weekday_is_used_for_moved_occurrences() {
        let monday = NaiveDate::from_ymd_opt(2026, 8, 17).expect("valid test date");
        assert_eq!(weekday_str(Weekday::from(monday.weekday())), "monday");
    }
}
