//! Tenant-scoped public catalog and lesson-availability projections.

use airhop_core::{
    PublicBookingAppearance, PublicBookingPurpose, StableLessonReference, TrialPolicy,
};
use buzz_core::TenantContext;
use chrono::{Datelike, Months, NaiveDate, NaiveTime};
use sqlx::Row;
use uuid::Uuid;

use crate::{Db, DbError, Result};

const PUBLIC_OCCURRENCE_LIMIT: i64 = 500;
const PUBLIC_OCCURRENCE_HORIZON_DAYS: i32 = 120;

/// Public organization settings and branch list for the booking form.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicBookingCatalog {
    /// Server-owned organization identifier.
    pub organization_id: Uuid,
    /// Center display name.
    pub organization_name: String,
    /// BCP-47 locale used for public copy and formatting.
    pub locale: String,
    /// IANA time zone used for organization-local dates.
    pub time_zone: String,
    /// Current organization-local date calculated by Postgres.
    pub current_date: NaiveDate,
    /// Default public booking purpose.
    pub purpose: PublicBookingPurpose,
    /// Public booking color preference.
    pub appearance: PublicBookingAppearance,
    /// Active public branches.
    pub branches: Vec<PublicBookingBranch>,
}

/// Public branch presentation without internal channel or version fields.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicBookingBranch {
    /// Branch identifier accepted by occurrence filters.
    pub id: Uuid,
    /// Branch display name.
    pub name: String,
    /// Public address.
    pub address: String,
}

/// Optional age input used only to narrow public choices.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PublicBookingAgeFilter {
    /// Completed age on the organization's current local date.
    CompletedYears(u8),
    /// Approximate birth month; exact birth date is checked by the command.
    BirthMonth {
        /// Four-digit birth year.
        year: i32,
        /// One-based birth month.
        month: u32,
    },
}

/// Safe filters for the public occurrence projection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PublicBookingOccurrenceFilters {
    /// Optional active branch.
    pub branch_id: Option<Uuid>,
    /// Optional active group.
    pub group_id: Option<Uuid>,
    /// Trial or permitted one-off lesson.
    pub purpose: PublicBookingPurpose,
    /// Optional approximate age filter.
    pub age: Option<PublicBookingAgeFilter>,
}

/// One server-computed public lesson choice.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicBookingOccurrence {
    /// Stable identity retained through moves and overrides.
    pub lesson_ref: StableLessonReference,
    /// Active group identifier.
    pub group_id: Uuid,
    /// Group display name.
    pub group_name: String,
    /// Optional public group description.
    pub group_description: Option<String>,
    /// Minimum exact age in months.
    pub min_age_months: Option<u32>,
    /// Maximum exact age in months.
    pub max_age_months: Option<u32>,
    /// Effective active branch identifier.
    pub branch_id: Uuid,
    /// Branch display name.
    pub branch_name: String,
    /// Branch address.
    pub branch_address: String,
    /// Optional effective room name.
    pub room_name: Option<String>,
    /// Effective active teacher names.
    pub teacher_names: Vec<String>,
    /// Effective organization-local date.
    pub date: NaiveDate,
    /// Effective organization-local start time.
    pub start_time: NaiveTime,
    /// Effective organization-local end time.
    pub end_time: NaiveTime,
    /// Effective trial policy.
    pub trial_policy: TrialPolicy,
    /// Effective capacity, or no limit.
    pub capacity: Option<u32>,
    /// Distinct children currently holding seats.
    pub occupied: u32,
    /// Remaining seats, or no limit.
    pub remaining: Option<u32>,
    /// Whether another distinct child can currently reserve a seat.
    pub available: bool,
}

#[derive(Debug, Clone, Copy)]
struct PublicOrganizationScope {
    id: Uuid,
    current_date: NaiveDate,
}

impl Db {
    /// Loads the public catalog for the host-resolved tenant.
    pub async fn get_public_booking_catalog(
        &self,
        tenant: &TenantContext,
    ) -> Result<PublicBookingCatalog> {
        let organization = sqlx::query(
            "SELECT id, name, locale, time_zone, public_booking_purpose, \
                    public_booking_appearance, \
                    (now() AT TIME ZONE time_zone)::date AS current_date \
             FROM airhop_organizations \
             WHERE community_id = $1 AND status = 'active'",
        )
        .bind(tenant.community().as_uuid())
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| DbError::NotFound("active AirHub organization".to_owned()))?;
        let organization_id: Uuid = organization.try_get("id")?;
        let branches = sqlx::query(
            "SELECT id, name, address \
             FROM airhop_branches \
             WHERE community_id = $1 AND organization_id = $2 AND status = 'active' \
             ORDER BY name, id",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(|row| {
            Ok(PublicBookingBranch {
                id: row.try_get("id")?,
                name: row.try_get("name")?,
                address: row.try_get("address")?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
        Ok(PublicBookingCatalog {
            organization_id,
            organization_name: organization.try_get("name")?,
            locale: organization.try_get("locale")?,
            time_zone: organization.try_get("time_zone")?,
            current_date: organization.try_get("current_date")?,
            purpose: parse_purpose(organization.try_get("public_booking_purpose")?)?,
            appearance: parse_appearance(organization.try_get("public_booking_appearance")?)?,
            branches,
        })
    }

    /// Lists future materialized occurrences with authoritative occupancy.
    pub async fn find_public_booking_occurrences(
        &self,
        tenant: &TenantContext,
        filters: PublicBookingOccurrenceFilters,
    ) -> Result<Vec<PublicBookingOccurrence>> {
        validate_filters(filters)?;
        let organization = resolve_public_organization(self, tenant).await?;
        let purpose = purpose_str(filters.purpose);
        let rows = sqlx::query(
            "WITH candidates AS ( \
                 SELECT occurrence.recurrence_rule_id, occurrence.original_date, \
                        occurrence.group_id, occurrence.branch_id, occurrence.room_id, \
                        occurrence.effective_date, occurrence.start_time, occurrence.end_time, \
                        occurrence.capacity, occurrence.trial_policy, \
                        group_row.name AS group_name, group_row.description AS group_description, \
                        group_row.min_age_months, group_row.max_age_months, \
                        branch.name AS branch_name, branch.address AS branch_address, \
                        room.name AS room_name, occurrence.id AS occurrence_id \
                 FROM airhop_lesson_occurrences occurrence \
                 JOIN airhop_groups group_row \
                   ON group_row.community_id = occurrence.community_id \
                  AND group_row.organization_id = occurrence.organization_id \
                  AND group_row.id = occurrence.group_id \
                 JOIN airhop_branches branch \
                   ON branch.community_id = occurrence.community_id \
                  AND branch.organization_id = occurrence.organization_id \
                  AND branch.id = occurrence.branch_id \
                 LEFT JOIN airhop_rooms room \
                   ON room.community_id = occurrence.community_id \
                  AND room.organization_id = occurrence.organization_id \
                  AND room.id = occurrence.room_id AND room.status = 'active' \
                 WHERE occurrence.community_id = $1 AND occurrence.organization_id = $2 \
                   AND occurrence.starts_at > now() \
                   AND occurrence.effective_date <= $3 + $4::INT \
                   AND occurrence.status <> 'cancelled' \
                   AND group_row.status = 'active' AND branch.status = 'active' \
                   AND ($5::UUID IS NULL OR occurrence.branch_id = $5) \
                   AND ($6::UUID IS NULL OR occurrence.group_id = $6) \
                   AND (($7 = 'trial' AND occurrence.trial_policy->>'mode' <> 'disabled') \
                        OR ($7 = 'lesson' AND occurrence.allow_single_visits)) \
                 ORDER BY occurrence.starts_at, occurrence.id \
                 LIMIT $8 \
             ) \
             SELECT candidate.*, \
                    ARRAY( \
                        SELECT teacher.display_name \
                        FROM airhop_occurrence_teachers occurrence_teacher \
                        JOIN airhop_teachers teacher \
                          ON teacher.community_id = occurrence_teacher.community_id \
                         AND teacher.organization_id = occurrence_teacher.organization_id \
                         AND teacher.id = occurrence_teacher.teacher_id \
                        WHERE occurrence_teacher.community_id = $1 \
                          AND occurrence_teacher.organization_id = $2 \
                          AND occurrence_teacher.occurrence_id = candidate.occurrence_id \
                          AND teacher.status = 'active' \
                        ORDER BY teacher.display_name, teacher.id \
                    ) AS teacher_names, \
                    ( \
                        SELECT COUNT(*)::BIGINT \
                        FROM ( \
                            SELECT enrollment.child_id \
                            FROM airhop_enrollments enrollment \
                            WHERE enrollment.community_id = $1 \
                              AND enrollment.organization_id = $2 \
                              AND enrollment.group_id = candidate.group_id \
                              AND enrollment.status = 'active' \
                              AND enrollment.start_date <= candidate.effective_date \
                              AND (enrollment.end_date IS NULL \
                                   OR enrollment.end_date >= candidate.effective_date) \
                              AND ( \
                                  enrollment.assignment_state = 'needs_assignment' \
                                  OR EXISTS ( \
                                      SELECT 1 FROM airhop_enrollment_schedule selection \
                                      WHERE selection.community_id = enrollment.community_id \
                                        AND selection.organization_id = enrollment.organization_id \
                                        AND selection.enrollment_id = enrollment.id \
                                        AND selection.recurrence_rule_id = candidate.recurrence_rule_id \
                                        AND selection.weekday = CASE EXTRACT(ISODOW FROM candidate.original_date)::INT \
                                            WHEN 1 THEN 'monday' WHEN 2 THEN 'tuesday' \
                                            WHEN 3 THEN 'wednesday' WHEN 4 THEN 'thursday' \
                                            WHEN 5 THEN 'friday' WHEN 6 THEN 'saturday' \
                                            ELSE 'sunday' END \
                                  ) \
                              ) \
                            UNION \
                            SELECT booking.child_id \
                            FROM airhop_bookings booking \
                            WHERE booking.community_id = $1 \
                              AND booking.organization_id = $2 \
                              AND booking.recurrence_rule_id = candidate.recurrence_rule_id \
                              AND booking.original_date = candidate.original_date \
                              AND booking.status IN ('pending_confirmation', 'confirmed') \
                        ) participant \
                    ) AS occupied \
             FROM candidates candidate \
             ORDER BY candidate.effective_date, candidate.start_time, candidate.occurrence_id",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization.id)
        .bind(organization.current_date)
        .bind(PUBLIC_OCCURRENCE_HORIZON_DAYS)
        .bind(filters.branch_id)
        .bind(filters.group_id)
        .bind(purpose)
        .bind(PUBLIC_OCCURRENCE_LIMIT)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(parse_occurrence)
            .filter(|result| match result {
                Ok(occurrence) => age_matches(
                    filters.age,
                    organization.current_date,
                    occurrence.date,
                    occurrence.min_age_months,
                    occurrence.max_age_months,
                ),
                Err(_) => true,
            })
            .collect()
    }
}

async fn resolve_public_organization(
    db: &Db,
    tenant: &TenantContext,
) -> Result<PublicOrganizationScope> {
    let row = sqlx::query(
        "SELECT id, (now() AT TIME ZONE time_zone)::date AS current_date \
         FROM airhop_organizations \
         WHERE community_id = $1 AND status = 'active'",
    )
    .bind(tenant.community().as_uuid())
    .fetch_optional(&db.pool)
    .await?
    .ok_or_else(|| DbError::NotFound("active AirHub organization".to_owned()))?;
    Ok(PublicOrganizationScope {
        id: row.try_get("id")?,
        current_date: row.try_get("current_date")?,
    })
}

fn parse_occurrence(row: sqlx::postgres::PgRow) -> Result<PublicBookingOccurrence> {
    let capacity = optional_u32(row.try_get("capacity")?, "occurrence capacity")?;
    let occupied = u32::try_from(row.try_get::<i64, _>("occupied")?)
        .map_err(|_| DbError::InvalidData("AirHub occurrence occupancy is invalid".to_owned()))?;
    let remaining = capacity.map(|limit| limit.saturating_sub(occupied));
    Ok(PublicBookingOccurrence {
        lesson_ref: StableLessonReference {
            recurrence_rule_id: row.try_get("recurrence_rule_id")?,
            original_date: row.try_get("original_date")?,
        },
        group_id: row.try_get("group_id")?,
        group_name: row.try_get("group_name")?,
        group_description: row.try_get("group_description")?,
        min_age_months: optional_u32(row.try_get("min_age_months")?, "minimum age")?,
        max_age_months: optional_u32(row.try_get("max_age_months")?, "maximum age")?,
        branch_id: row.try_get("branch_id")?,
        branch_name: row.try_get("branch_name")?,
        branch_address: row.try_get("branch_address")?,
        room_name: row.try_get("room_name")?,
        teacher_names: row.try_get("teacher_names")?,
        date: row.try_get("effective_date")?,
        start_time: row.try_get("start_time")?,
        end_time: row.try_get("end_time")?,
        trial_policy: serde_json::from_value(row.try_get("trial_policy")?)?,
        capacity,
        occupied,
        remaining,
        available: remaining.is_none_or(|seats| seats > 0),
    })
}

fn validate_filters(filters: PublicBookingOccurrenceFilters) -> Result<()> {
    if filters.branch_id.is_some_and(|id| id.is_nil())
        || filters.group_id.is_some_and(|id| id.is_nil())
    {
        return Err(DbError::InvalidData(
            "AirHub public occurrence filters contain a nil id".to_owned(),
        ));
    }
    if let Some(PublicBookingAgeFilter::BirthMonth { year, month }) = filters.age {
        if !(1900..=9999).contains(&year) || !(1..=12).contains(&month) {
            return Err(DbError::InvalidData(
                "AirHub public birth month filter is invalid".to_owned(),
            ));
        }
    }
    Ok(())
}

fn age_matches(
    filter: Option<PublicBookingAgeFilter>,
    reference_date: NaiveDate,
    lesson_date: NaiveDate,
    minimum: Option<u32>,
    maximum: Option<u32>,
) -> bool {
    let Some(filter) = filter else {
        return true;
    };
    let (oldest_birth_date, youngest_birth_date) = match filter {
        PublicBookingAgeFilter::CompletedYears(years) => {
            let youngest = shift_years(reference_date, -i32::from(years));
            let oldest = shift_years(reference_date, -(i32::from(years) + 1))
                .and_then(|date| date.succ_opt());
            (oldest, youngest)
        }
        PublicBookingAgeFilter::BirthMonth { year, month } => {
            let oldest = NaiveDate::from_ymd_opt(year, month, 1);
            let youngest = oldest
                .and_then(|date| date.checked_add_months(Months::new(1)))
                .and_then(|date| date.pred_opt());
            (oldest, youngest)
        }
    };
    let (Some(oldest_birth_date), Some(youngest_birth_date)) =
        (oldest_birth_date, youngest_birth_date)
    else {
        return false;
    };
    let Some(oldest_age) = age_in_months(oldest_birth_date, lesson_date) else {
        return false;
    };
    let Some(youngest_age) = age_in_months(youngest_birth_date, lesson_date) else {
        return false;
    };
    oldest_age >= minimum.unwrap_or(0) && maximum.is_none_or(|limit| youngest_age <= limit)
}

fn shift_years(date: NaiveDate, years: i32) -> Option<NaiveDate> {
    let year = date.year().checked_add(years)?;
    NaiveDate::from_ymd_opt(year, date.month(), date.day()).or_else(|| {
        let first = NaiveDate::from_ymd_opt(year, date.month(), 1)?;
        first
            .checked_add_months(Months::new(1))
            .and_then(|next_month| next_month.pred_opt())
    })
}

fn age_in_months(birth_date: NaiveDate, lesson_date: NaiveDate) -> Option<u32> {
    if birth_date > lesson_date {
        return None;
    }
    let mut months = (lesson_date.year() - birth_date.year()) * 12
        + i32::try_from(lesson_date.month()).ok()?
        - i32::try_from(birth_date.month()).ok()?;
    if lesson_date.day() < birth_date.day() {
        months -= 1;
    }
    u32::try_from(months).ok()
}

fn optional_u32(value: Option<i32>, label: &str) -> Result<Option<u32>> {
    value
        .map(u32::try_from)
        .transpose()
        .map_err(|_| DbError::InvalidData(format!("AirHub {label} is invalid")))
}

fn parse_purpose(value: &str) -> Result<PublicBookingPurpose> {
    match value {
        "trial" => Ok(PublicBookingPurpose::Trial),
        "lesson" => Ok(PublicBookingPurpose::Lesson),
        other => Err(DbError::InvalidData(format!(
            "unknown AirHub public booking purpose {other:?}"
        ))),
    }
}

fn parse_appearance(value: &str) -> Result<PublicBookingAppearance> {
    match value {
        "automatic" => Ok(PublicBookingAppearance::Automatic),
        "light" => Ok(PublicBookingAppearance::Light),
        "dark" => Ok(PublicBookingAppearance::Dark),
        other => Err(DbError::InvalidData(format!(
            "unknown AirHub public booking appearance {other:?}"
        ))),
    }
}

const fn purpose_str(value: PublicBookingPurpose) -> &'static str {
    match value {
        PublicBookingPurpose::Trial => "trial",
        PublicBookingPurpose::Lesson => "lesson",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn completed_age_filter_is_conservative_until_exact_birth_date() {
        let reference = NaiveDate::from_ymd_opt(2026, 8, 16).expect("reference date");
        let lesson = NaiveDate::from_ymd_opt(2026, 9, 1).expect("lesson date");
        assert!(age_matches(
            Some(PublicBookingAgeFilter::CompletedYears(6)),
            reference,
            lesson,
            Some(72),
            Some(84)
        ));
        assert!(!age_matches(
            Some(PublicBookingAgeFilter::CompletedYears(5)),
            reference,
            lesson,
            Some(84),
            None
        ));
    }

    #[test]
    fn birth_month_filter_accepts_any_potential_exact_birthday() {
        let reference = NaiveDate::from_ymd_opt(2026, 8, 16).expect("reference date");
        let lesson = NaiveDate::from_ymd_opt(2026, 9, 1).expect("lesson date");
        assert!(age_matches(
            Some(PublicBookingAgeFilter::BirthMonth {
                year: 2020,
                month: 8,
            }),
            reference,
            lesson,
            Some(72),
            Some(73)
        ));
        assert!(age_matches(
            Some(PublicBookingAgeFilter::BirthMonth {
                year: 2020,
                month: 8,
            }),
            reference,
            lesson,
            Some(73),
            Some(73)
        ));
        assert!(!age_matches(
            Some(PublicBookingAgeFilter::BirthMonth {
                year: 2020,
                month: 8,
            }),
            reference,
            lesson,
            Some(74),
            None
        ));
    }

    #[test]
    fn remaining_capacity_saturates_instead_of_underflowing() {
        assert_eq!(Some(2_u32).map(|limit| limit.saturating_sub(3)), Some(0));
        assert!(None::<u32>.is_none_or(|seats| seats > 0));
    }
}
