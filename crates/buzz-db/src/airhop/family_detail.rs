//! Tenant-scoped staff family detail projection.
//!
//! The projection returns current operational relationships plus bounded
//! booking history. It deliberately omits management credentials, consent
//! evidence, messenger provider identifiers, and immutable applicant payloads.

use std::collections::HashMap;

use airhop_core::BookingStatus;
use buzz_core::TenantContext;
use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::Serialize;
use sqlx::Row;
use uuid::Uuid;

use super::public_management::PublicTransferRequest;
use crate::{Db, DbError, Result};

const BOOKING_HISTORY_LIMIT: i64 = 200;

/// Organization presentation needed to interpret local dates in a family card.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffFamilyOrganization {
    /// Server-owned organization identifier.
    pub id: Uuid,
    /// Center display name.
    pub name: String,
    /// BCP-47 locale.
    pub locale: String,
    /// IANA time zone.
    pub time_zone: String,
    /// Current organization-local date calculated by Postgres.
    pub current_date: NaiveDate,
}

/// Current family aggregate metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffFamilyRecord {
    /// Family identifier.
    pub id: Uuid,
    /// Staff-facing family label.
    pub display_name: String,
    /// Representative selected as the primary contact.
    pub primary_representative_id: Uuid,
    /// `active` or `archived`.
    pub status: String,
    /// Optimistic aggregate version.
    pub version: i64,
    /// Creation instant.
    pub created_at: DateTime<Utc>,
    /// Last update instant.
    pub updated_at: DateTime<Utc>,
}

/// One representative belonging to the family.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffFamilyRepresentative {
    /// Representative identifier.
    pub id: Uuid,
    /// Current display name.
    pub display_name: String,
    /// E.164 phone retained for staff operations.
    pub phone_normalized: String,
    /// Human-readable phone.
    pub phone_display: String,
    /// Preferred service contact channel.
    pub preferred_contact_channel: String,
    /// Verified messenger channels without provider identifiers.
    pub verified_messenger_channels: Vec<String>,
    /// `active` or `archived`.
    pub status: String,
    /// Optimistic entity version.
    pub version: i64,
    /// Creation instant.
    pub created_at: DateTime<Utc>,
    /// Last update instant.
    pub updated_at: DateTime<Utc>,
}

/// One child belonging to the family.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffFamilyChild {
    /// Child identifier.
    pub id: Uuid,
    /// Current display name.
    pub display_name: String,
    /// Exact birth date visible only to authenticated staff.
    pub birth_date: NaiveDate,
    /// Optional operational note.
    pub note: Option<String>,
    /// `active` or `archived`.
    pub status: String,
    /// Optimistic entity version.
    pub version: i64,
    /// Creation instant.
    pub created_at: DateTime<Utc>,
    /// Last update instant.
    pub updated_at: DateTime<Utc>,
}

/// One recurrence slot selected for an enrollment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffFamilyEnrollmentSchedule {
    /// Recurrence series identifier.
    pub recurrence_rule_id: Uuid,
    /// Stable weekday name.
    pub weekday: String,
    /// Local lesson start time.
    pub start_time: NaiveTime,
    /// Local lesson end time.
    pub end_time: NaiveTime,
}

/// Optional tariff attached to an enrollment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffFamilyEnrollmentTariff {
    /// Tariff identifier.
    pub id: Uuid,
    /// Tariff display name.
    pub name: String,
    /// Price in minor currency units.
    pub price_minor: i64,
    /// ISO-4217 currency code.
    pub currency: String,
}

/// One current or historical enrollment for a family child.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffFamilyEnrollment {
    /// Enrollment identifier.
    pub id: Uuid,
    /// Enrolled child.
    pub child_id: Uuid,
    /// Group identifier.
    pub group_id: Uuid,
    /// Current group display name.
    pub group_name: String,
    /// Optional attached tariff.
    pub tariff: Option<StaffFamilyEnrollmentTariff>,
    /// First active local date.
    pub start_date: NaiveDate,
    /// Last active local date, when scheduled.
    pub end_date: Option<NaiveDate>,
    /// `active`, `paused`, or `ended`.
    pub status: String,
    /// `needs_assignment` or `configured`.
    pub assignment_state: String,
    /// Explicit weekly slots for configured enrollments.
    pub schedule: Vec<StaffFamilyEnrollmentSchedule>,
    /// Optimistic entity version.
    pub version: i64,
    /// Creation instant.
    pub created_at: DateTime<Utc>,
    /// Last update instant.
    pub updated_at: DateTime<Utc>,
}

/// One bounded booking-history row for the family.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffFamilyBooking {
    /// Booking identifier.
    pub id: Uuid,
    /// Representative who made the booking.
    pub representative_id: Uuid,
    /// Child who attends the lesson.
    pub child_id: Uuid,
    /// Current lifecycle state.
    pub status: BookingStatus,
    /// `trial` or `single`.
    pub visit_kind: String,
    /// Current parent transfer request.
    pub transfer_request: Option<PublicTransferRequest>,
    /// Stable recurrence series identifier.
    pub recurrence_rule_id: Uuid,
    /// Stable original occurrence date.
    pub original_date: NaiveDate,
    /// Current materialized occurrence identifier.
    pub occurrence_id: Uuid,
    /// Effective local lesson date.
    pub date: NaiveDate,
    /// Effective local start time.
    pub start_time: NaiveTime,
    /// Effective local end time.
    pub end_time: NaiveTime,
    /// Current occurrence state.
    pub occurrence_status: String,
    /// Current group identifier.
    pub group_id: Uuid,
    /// Current group display name.
    pub group_name: String,
    /// Current branch identifier.
    pub branch_id: Uuid,
    /// Current branch display name.
    pub branch_name: String,
    /// Optimistic booking version.
    pub version: i64,
    /// Creation instant.
    pub created_at: DateTime<Utc>,
    /// Last update instant.
    pub updated_at: DateTime<Utc>,
}

/// Authoritative staff view of one family and its operational relationships.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffFamilyDetail {
    /// Organization formatting context.
    pub organization: StaffFamilyOrganization,
    /// Family aggregate.
    pub family: StaffFamilyRecord,
    /// Current representative records.
    pub representatives: Vec<StaffFamilyRepresentative>,
    /// Current child records.
    pub children: Vec<StaffFamilyChild>,
    /// Current and historical enrollments.
    pub enrollments: Vec<StaffFamilyEnrollment>,
    /// Newest-first bounded booking history.
    pub bookings: Vec<StaffFamilyBooking>,
    /// Whether more booking history exists than this card returns.
    pub booking_history_truncated: bool,
    /// Whether a pending duplicate candidate touches this family.
    pub has_pending_duplicate: bool,
}

impl Db {
    /// Loads one coherent staff family projection for the host-resolved tenant.
    pub async fn get_airhop_staff_family_detail(
        &self,
        tenant: &TenantContext,
        family_id: Uuid,
    ) -> Result<StaffFamilyDetail> {
        if family_id.is_nil() {
            return Err(DbError::InvalidData(
                "AirHub family id cannot be nil".to_owned(),
            ));
        }
        let mut transaction = self.pool.begin().await?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            .execute(&mut *transaction)
            .await?;
        let root = sqlx::query(
            "SELECT organization.id AS organization_id, organization.name AS organization_name, \
                    organization.locale, organization.time_zone, \
                    (now() AT TIME ZONE organization.time_zone)::date AS current_date, \
                    family.id AS family_id, family.display_name AS family_name, \
                    family.primary_representative_id, family.status AS family_status, \
                    family.version AS family_version, family.created_at AS family_created_at, \
                    family.updated_at AS family_updated_at \
             FROM airhop_organizations organization \
             JOIN airhop_families family \
               ON family.community_id = organization.community_id \
              AND family.organization_id = organization.id \
             WHERE organization.community_id = $1 AND family.id = $2",
        )
        .bind(tenant.community().as_uuid())
        .bind(family_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| DbError::NotFound("AirHub family".to_owned()))?;
        let organization_id: Uuid = root.try_get("organization_id")?;
        let organization = StaffFamilyOrganization {
            id: organization_id,
            name: root.try_get("organization_name")?,
            locale: root.try_get("locale")?,
            time_zone: root.try_get("time_zone")?,
            current_date: root.try_get("current_date")?,
        };
        let family_status: String = root.try_get("family_status")?;
        validate_value(&family_status, &["active", "archived"], "family status")?;
        let family = StaffFamilyRecord {
            id: root.try_get("family_id")?,
            display_name: root.try_get("family_name")?,
            primary_representative_id: root.try_get("primary_representative_id")?,
            status: family_status,
            version: root.try_get("family_version")?,
            created_at: root.try_get("family_created_at")?,
            updated_at: root.try_get("family_updated_at")?,
        };

        let representatives = load_representatives(
            &mut transaction,
            tenant.community().as_uuid(),
            organization_id,
            family_id,
        )
        .await?;
        let children = load_children(
            &mut transaction,
            tenant.community().as_uuid(),
            organization_id,
            family_id,
        )
        .await?;
        let enrollments = load_enrollments(
            &mut transaction,
            tenant.community().as_uuid(),
            organization_id,
            family_id,
        )
        .await?;
        let (bookings, booking_history_truncated) = load_bookings(
            &mut transaction,
            tenant.community().as_uuid(),
            organization_id,
            family_id,
        )
        .await?;
        let has_pending_duplicate = load_duplicate_signal(
            &mut transaction,
            tenant.community().as_uuid(),
            organization_id,
            family_id,
        )
        .await?;
        transaction.commit().await?;

        Ok(StaffFamilyDetail {
            organization,
            family,
            representatives,
            children,
            enrollments,
            bookings,
            booking_history_truncated,
            has_pending_duplicate,
        })
    }
}

async fn load_representatives(
    connection: &mut sqlx::PgConnection,
    community_id: &Uuid,
    organization_id: Uuid,
    family_id: Uuid,
) -> Result<Vec<StaffFamilyRepresentative>> {
    sqlx::query(
        "SELECT representative.id, representative.display_name, \
                representative.phone_normalized, representative.phone_display, \
                representative.preferred_contact_channel, representative.status, \
                representative.version, representative.created_at, representative.updated_at, \
                ARRAY(SELECT DISTINCT account.channel \
                      FROM airhop_messenger_accounts account \
                      WHERE account.community_id = representative.community_id \
                        AND account.organization_id = representative.organization_id \
                        AND account.representative_id = representative.id \
                        AND account.verified_at IS NOT NULL \
                      ORDER BY account.channel) AS verified_messenger_channels \
         FROM airhop_representatives representative \
         WHERE representative.community_id = $1 AND representative.organization_id = $2 \
           AND representative.family_id = $3 \
         ORDER BY representative.status, representative.display_name, representative.id",
    )
    .bind(community_id)
    .bind(organization_id)
    .bind(family_id)
    .fetch_all(&mut *connection)
    .await?
    .into_iter()
    .map(|row| {
        let preferred_contact_channel: String = row.try_get("preferred_contact_channel")?;
        validate_value(
            &preferred_contact_channel,
            &["telegram", "max", "whatsapp", "phone", "none"],
            "preferred contact channel",
        )?;
        let status: String = row.try_get("status")?;
        validate_value(&status, &["active", "archived"], "representative status")?;
        Ok(StaffFamilyRepresentative {
            id: row.try_get("id")?,
            display_name: row.try_get("display_name")?,
            phone_normalized: row.try_get("phone_normalized")?,
            phone_display: row.try_get("phone_display")?,
            preferred_contact_channel,
            verified_messenger_channels: row.try_get("verified_messenger_channels")?,
            status,
            version: row.try_get("version")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    })
    .collect()
}

async fn load_children(
    connection: &mut sqlx::PgConnection,
    community_id: &Uuid,
    organization_id: Uuid,
    family_id: Uuid,
) -> Result<Vec<StaffFamilyChild>> {
    sqlx::query(
        "SELECT id, display_name, birth_date, note, status, version, created_at, updated_at \
         FROM airhop_children \
         WHERE community_id = $1 AND organization_id = $2 AND family_id = $3 \
         ORDER BY status, display_name, id",
    )
    .bind(community_id)
    .bind(organization_id)
    .bind(family_id)
    .fetch_all(&mut *connection)
    .await?
    .into_iter()
    .map(|row| {
        let status: String = row.try_get("status")?;
        validate_value(&status, &["active", "archived"], "child status")?;
        Ok(StaffFamilyChild {
            id: row.try_get("id")?,
            display_name: row.try_get("display_name")?,
            birth_date: row.try_get("birth_date")?,
            note: row.try_get("note")?,
            status,
            version: row.try_get("version")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    })
    .collect()
}

async fn load_enrollments(
    connection: &mut sqlx::PgConnection,
    community_id: &Uuid,
    organization_id: Uuid,
    family_id: Uuid,
) -> Result<Vec<StaffFamilyEnrollment>> {
    let schedule_rows = sqlx::query(
        "SELECT schedule.enrollment_id, schedule.recurrence_rule_id, schedule.weekday, \
                rule.start_time, rule.end_time \
         FROM airhop_enrollment_schedule schedule \
         JOIN airhop_enrollments enrollment \
           ON enrollment.community_id = schedule.community_id \
          AND enrollment.organization_id = schedule.organization_id \
          AND enrollment.id = schedule.enrollment_id \
         JOIN airhop_recurrence_rules rule \
           ON rule.community_id = schedule.community_id \
          AND rule.organization_id = schedule.organization_id \
          AND rule.id = schedule.recurrence_rule_id \
         WHERE enrollment.community_id = $1 AND enrollment.organization_id = $2 \
           AND enrollment.family_id = $3 \
         ORDER BY schedule.enrollment_id, schedule.weekday, rule.start_time, schedule.recurrence_rule_id",
    )
    .bind(community_id)
    .bind(organization_id)
    .bind(family_id)
    .fetch_all(&mut *connection)
    .await?;
    let mut schedules: HashMap<Uuid, Vec<StaffFamilyEnrollmentSchedule>> = HashMap::new();
    for row in schedule_rows {
        let weekday: String = row.try_get("weekday")?;
        validate_value(
            &weekday,
            &[
                "monday",
                "tuesday",
                "wednesday",
                "thursday",
                "friday",
                "saturday",
                "sunday",
            ],
            "enrollment weekday",
        )?;
        schedules
            .entry(row.try_get("enrollment_id")?)
            .or_default()
            .push(StaffFamilyEnrollmentSchedule {
                recurrence_rule_id: row.try_get("recurrence_rule_id")?,
                weekday,
                start_time: row.try_get("start_time")?,
                end_time: row.try_get("end_time")?,
            });
    }
    let rows = sqlx::query(
        "SELECT enrollment.id, enrollment.child_id, enrollment.group_id, \
                group_row.name AS group_name, enrollment.tariff_id, \
                tariff.name AS tariff_name, tariff.price_minor, tariff.currency, \
                enrollment.start_date, enrollment.end_date, enrollment.status, \
                enrollment.assignment_state, enrollment.version, \
                enrollment.created_at, enrollment.updated_at \
         FROM airhop_enrollments enrollment \
         JOIN airhop_groups group_row \
           ON group_row.community_id = enrollment.community_id \
          AND group_row.organization_id = enrollment.organization_id \
          AND group_row.id = enrollment.group_id \
         LEFT JOIN airhop_tariffs tariff \
           ON tariff.community_id = enrollment.community_id \
          AND tariff.organization_id = enrollment.organization_id \
          AND tariff.id = enrollment.tariff_id \
         WHERE enrollment.community_id = $1 AND enrollment.organization_id = $2 \
           AND enrollment.family_id = $3 \
         ORDER BY enrollment.start_date DESC, enrollment.id DESC",
    )
    .bind(community_id)
    .bind(organization_id)
    .bind(family_id)
    .fetch_all(&mut *connection)
    .await?;
    rows.into_iter()
        .map(|row| {
            let id: Uuid = row.try_get("id")?;
            let status: String = row.try_get("status")?;
            validate_value(&status, &["active", "paused", "ended"], "enrollment status")?;
            let assignment_state: String = row.try_get("assignment_state")?;
            validate_value(
                &assignment_state,
                &["needs_assignment", "configured"],
                "enrollment assignment state",
            )?;
            let tariff_id: Option<Uuid> = row.try_get("tariff_id")?;
            let tariff = match tariff_id {
                Some(id) => Some(StaffFamilyEnrollmentTariff {
                    id,
                    name: row.try_get("tariff_name")?,
                    price_minor: row.try_get("price_minor")?,
                    currency: row.try_get("currency")?,
                }),
                None => None,
            };
            Ok(StaffFamilyEnrollment {
                id,
                child_id: row.try_get("child_id")?,
                group_id: row.try_get("group_id")?,
                group_name: row.try_get("group_name")?,
                tariff,
                start_date: row.try_get("start_date")?,
                end_date: row.try_get("end_date")?,
                status,
                assignment_state,
                schedule: schedules.remove(&id).unwrap_or_default(),
                version: row.try_get("version")?,
                created_at: row.try_get("created_at")?,
                updated_at: row.try_get("updated_at")?,
            })
        })
        .collect()
}

async fn load_bookings(
    connection: &mut sqlx::PgConnection,
    community_id: &Uuid,
    organization_id: Uuid,
    family_id: Uuid,
) -> Result<(Vec<StaffFamilyBooking>, bool)> {
    let rows = sqlx::query(
        "SELECT booking.id, booking.representative_id, booking.child_id, booking.status, \
                booking.visit_kind, booking.transfer_request, booking.recurrence_rule_id, \
                booking.original_date, occurrence.id AS occurrence_id, \
                occurrence.effective_date, occurrence.start_time, occurrence.end_time, \
                occurrence.status AS occurrence_status, occurrence.group_id, \
                group_row.name AS group_name, occurrence.branch_id, branch.name AS branch_name, \
                booking.version, booking.created_at, booking.updated_at \
         FROM airhop_bookings booking \
         JOIN airhop_lesson_occurrences occurrence \
           ON occurrence.community_id = booking.community_id \
          AND occurrence.organization_id = booking.organization_id \
          AND occurrence.recurrence_rule_id = booking.recurrence_rule_id \
          AND occurrence.original_date = booking.original_date \
         JOIN airhop_groups group_row \
           ON group_row.community_id = occurrence.community_id \
          AND group_row.organization_id = occurrence.organization_id \
          AND group_row.id = occurrence.group_id \
         JOIN airhop_branches branch \
           ON branch.community_id = occurrence.community_id \
          AND branch.organization_id = occurrence.organization_id \
          AND branch.id = occurrence.branch_id \
         WHERE booking.community_id = $1 AND booking.organization_id = $2 \
           AND booking.family_id = $3 \
         ORDER BY booking.created_at DESC, booking.id DESC \
         LIMIT $4",
    )
    .bind(community_id)
    .bind(organization_id)
    .bind(family_id)
    .bind(BOOKING_HISTORY_LIMIT + 1)
    .fetch_all(&mut *connection)
    .await?;
    let truncated = rows.len() > BOOKING_HISTORY_LIMIT as usize;
    let bookings = rows
        .into_iter()
        .take(BOOKING_HISTORY_LIMIT as usize)
        .map(|row| {
            let status = parse_booking_status(row.try_get("status")?)?;
            let visit_kind: String = row.try_get("visit_kind")?;
            validate_value(&visit_kind, &["trial", "single"], "booking visit kind")?;
            let occurrence_status: String = row.try_get("occurrence_status")?;
            validate_value(
                &occurrence_status,
                &["scheduled", "moved", "modified", "cancelled"],
                "occurrence status",
            )?;
            let transfer_request = row
                .try_get::<Option<serde_json::Value>, _>("transfer_request")?
                .map(serde_json::from_value)
                .transpose()?;
            Ok(StaffFamilyBooking {
                id: row.try_get("id")?,
                representative_id: row.try_get("representative_id")?,
                child_id: row.try_get("child_id")?,
                status,
                visit_kind,
                transfer_request,
                recurrence_rule_id: row.try_get("recurrence_rule_id")?,
                original_date: row.try_get("original_date")?,
                occurrence_id: row.try_get("occurrence_id")?,
                date: row.try_get("effective_date")?,
                start_time: row.try_get("start_time")?,
                end_time: row.try_get("end_time")?,
                occurrence_status,
                group_id: row.try_get("group_id")?,
                group_name: row.try_get("group_name")?,
                branch_id: row.try_get("branch_id")?,
                branch_name: row.try_get("branch_name")?,
                version: row.try_get("version")?,
                created_at: row.try_get("created_at")?,
                updated_at: row.try_get("updated_at")?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok((bookings, truncated))
}

async fn load_duplicate_signal(
    connection: &mut sqlx::PgConnection,
    community_id: &Uuid,
    organization_id: Uuid,
    family_id: Uuid,
) -> Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS ( \
             SELECT 1 FROM airhop_duplicate_candidates candidate \
             WHERE candidate.community_id = $1 AND candidate.organization_id = $2 \
               AND candidate.status = 'pending' \
               AND ( \
                   candidate.new_entity_id IN ( \
                       SELECT id FROM airhop_representatives \
                       WHERE community_id = $1 AND organization_id = $2 AND family_id = $3 \
                       UNION ALL \
                       SELECT id FROM airhop_children \
                       WHERE community_id = $1 AND organization_id = $2 AND family_id = $3 \
                   ) \
                   OR candidate.existing_entity_id IN ( \
                       SELECT id FROM airhop_representatives \
                       WHERE community_id = $1 AND organization_id = $2 AND family_id = $3 \
                       UNION ALL \
                       SELECT id FROM airhop_children \
                       WHERE community_id = $1 AND organization_id = $2 AND family_id = $3 \
                   ) \
               ) \
         )",
    )
    .bind(community_id)
    .bind(organization_id)
    .bind(family_id)
    .fetch_one(&mut *connection)
    .await
    .map_err(Into::into)
}

fn validate_value(value: &str, allowed: &[&str], field: &str) -> Result<()> {
    if allowed.contains(&value) {
        Ok(())
    } else {
        Err(DbError::InvalidData(format!(
            "unknown AirHub {field} {value:?}"
        )))
    }
}

fn parse_booking_status(value: &str) -> Result<BookingStatus> {
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

#[cfg(test)]
#[path = "family_detail_tests.rs"]
mod tests;
