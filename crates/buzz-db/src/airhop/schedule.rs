//! Transactional persistence for materialized AirHub occurrences.

use std::collections::BTreeSet;

use airhop_core::{OccurrenceStatus, ScheduleOccurrence};
use buzz_core::TenantContext;
use chrono::{DateTime, Utc};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use crate::{DbError, Result};

/// Server-computed materialization metadata around one domain occurrence.
#[derive(Debug)]
pub struct MaterializedOccurrenceInput<'a> {
    /// Organization selected from the host-resolved tenant.
    pub organization_id: Uuid,
    /// Identifier used only when this stable occurrence is first inserted.
    pub id: Uuid,
    /// Fully resolved domain occurrence.
    pub occurrence: &'a ScheduleOccurrence,
    /// UTC start instant computed with the organization's IANA time zone.
    pub starts_at: DateTime<Utc>,
    /// UTC end instant computed with the organization's IANA time zone.
    pub ends_at: DateTime<Utc>,
    /// IANA time-zone name used for the UTC conversion.
    pub time_zone: &'a str,
    /// Recurrence-rule version used by the materializer.
    pub source_rule_version: i64,
    /// Exception version used by the materializer, when one was applied.
    pub source_exception_version: Option<i64>,
}

/// Database identity and version of a persisted materialized occurrence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MaterializedOccurrenceRecord {
    /// Stable database row identifier.
    pub id: Uuid,
    /// Version incremented whenever the read model is rebuilt.
    pub version: i64,
}

/// Inserts or refreshes one stable materialized occurrence.
///
/// The caller must keep this transaction open while performing any related
/// command/event/outbox writes. Teacher rows are replaced in the same
/// transaction, so readers never observe a partial materialization.
pub async fn upsert_materialized_occurrence(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    input: &MaterializedOccurrenceInput<'_>,
) -> Result<MaterializedOccurrenceRecord> {
    validate_materialization(input)?;
    let capacity = input
        .occurrence
        .capacity
        .map(i32::try_from)
        .transpose()
        .map_err(|_| DbError::InvalidData("AirHub occurrence capacity is too large".to_owned()))?;
    let trial_policy = serde_json::to_value(&input.occurrence.trial_policy)?;
    let row = sqlx::query(
        "INSERT INTO airhop_lesson_occurrences (\
             community_id, organization_id, id, recurrence_rule_id, original_date, \
             group_id, branch_id, room_id, original_start_time, original_end_time, \
             effective_date, start_time, end_time, starts_at, ends_at, time_zone, \
             capacity, trial_policy, allow_single_visits, track_attendance, status, \
             exception_id, source_rule_version, source_exception_version\
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, \
                   $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24) \
         ON CONFLICT (community_id, organization_id, recurrence_rule_id, original_date) \
         DO UPDATE SET group_id = EXCLUDED.group_id, branch_id = EXCLUDED.branch_id, \
             room_id = EXCLUDED.room_id, original_start_time = EXCLUDED.original_start_time, \
             original_end_time = EXCLUDED.original_end_time, \
             effective_date = EXCLUDED.effective_date, start_time = EXCLUDED.start_time, \
             end_time = EXCLUDED.end_time, starts_at = EXCLUDED.starts_at, \
             ends_at = EXCLUDED.ends_at, time_zone = EXCLUDED.time_zone, \
             capacity = EXCLUDED.capacity, trial_policy = EXCLUDED.trial_policy, \
             allow_single_visits = EXCLUDED.allow_single_visits, \
             track_attendance = EXCLUDED.track_attendance, status = EXCLUDED.status, \
             exception_id = EXCLUDED.exception_id, \
             source_rule_version = EXCLUDED.source_rule_version, \
             source_exception_version = EXCLUDED.source_exception_version, \
             version = airhop_lesson_occurrences.version + 1, \
             materialized_at = now(), updated_at = now() \
         RETURNING id, version",
    )
    .bind(tenant.community().as_uuid())
    .bind(input.organization_id)
    .bind(input.id)
    .bind(input.occurrence.lesson_ref.recurrence_rule_id)
    .bind(input.occurrence.lesson_ref.original_date)
    .bind(input.occurrence.group_id)
    .bind(input.occurrence.branch_id)
    .bind(input.occurrence.room_id)
    .bind(input.occurrence.original_start_time)
    .bind(input.occurrence.original_end_time)
    .bind(input.occurrence.date)
    .bind(input.occurrence.start_time)
    .bind(input.occurrence.end_time)
    .bind(input.starts_at)
    .bind(input.ends_at)
    .bind(input.time_zone)
    .bind(capacity)
    .bind(trial_policy)
    .bind(input.occurrence.single_visit_allowed)
    .bind(input.occurrence.track_attendance)
    .bind(occurrence_status_str(input.occurrence.status))
    .bind(input.occurrence.exception_id)
    .bind(input.source_rule_version)
    .bind(input.source_exception_version)
    .fetch_one(&mut **transaction)
    .await?;
    let record = MaterializedOccurrenceRecord {
        id: row.try_get("id")?,
        version: row.try_get("version")?,
    };

    sqlx::query(
        "DELETE FROM airhop_occurrence_teachers \
         WHERE community_id = $1 AND organization_id = $2 AND occurrence_id = $3",
    )
    .bind(tenant.community().as_uuid())
    .bind(input.organization_id)
    .bind(record.id)
    .execute(&mut **transaction)
    .await?;
    for teacher_id in &input.occurrence.teacher_ids {
        sqlx::query(
            "INSERT INTO airhop_occurrence_teachers (\
                 community_id, organization_id, occurrence_id, teacher_id\
             ) VALUES ($1, $2, $3, $4)",
        )
        .bind(tenant.community().as_uuid())
        .bind(input.organization_id)
        .bind(record.id)
        .bind(teacher_id)
        .execute(&mut **transaction)
        .await?;
    }
    Ok(record)
}

fn validate_materialization(input: &MaterializedOccurrenceInput<'_>) -> Result<()> {
    if input.organization_id.is_nil()
        || input.id.is_nil()
        || input.occurrence.lesson_ref.recurrence_rule_id.is_nil()
        || input.occurrence.group_id.is_nil()
        || input.occurrence.branch_id.is_nil()
    {
        return Err(DbError::InvalidData(
            "AirHub materialization identifiers cannot be nil".to_owned(),
        ));
    }
    if input.time_zone.trim().is_empty() || input.time_zone.len() > 80 {
        return Err(DbError::InvalidData(
            "AirHub materialization time zone is invalid".to_owned(),
        ));
    }
    if input.starts_at >= input.ends_at || input.source_rule_version <= 0 {
        return Err(DbError::InvalidData(
            "AirHub materialization timestamps or source version are invalid".to_owned(),
        ));
    }
    if input.occurrence.exception_id.is_some() != input.source_exception_version.is_some()
        || input
            .source_exception_version
            .is_some_and(|version| version <= 0)
    {
        return Err(DbError::InvalidData(
            "AirHub materialization exception provenance is inconsistent".to_owned(),
        ));
    }
    let teacher_ids: BTreeSet<_> = input.occurrence.teacher_ids.iter().copied().collect();
    if teacher_ids.len() != input.occurrence.teacher_ids.len()
        || teacher_ids.iter().any(Uuid::is_nil)
    {
        return Err(DbError::InvalidData(
            "AirHub occurrence teachers must be unique non-nil ids".to_owned(),
        ));
    }
    Ok(())
}

const fn occurrence_status_str(status: OccurrenceStatus) -> &'static str {
    match status {
        OccurrenceStatus::Scheduled => "scheduled",
        OccurrenceStatus::Moved => "moved",
        OccurrenceStatus::Modified => "modified",
        OccurrenceStatus::Cancelled => "cancelled",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use airhop_core::{StableLessonReference, TrialPolicy};
    use chrono::{NaiveDate, NaiveTime};

    fn occurrence(teacher_ids: Vec<Uuid>) -> ScheduleOccurrence {
        ScheduleOccurrence {
            lesson_ref: StableLessonReference {
                recurrence_rule_id: Uuid::from_u128(2),
                original_date: NaiveDate::from_ymd_opt(2026, 8, 17).expect("valid test date"),
            },
            group_id: Uuid::from_u128(3),
            branch_id: Uuid::from_u128(4),
            room_id: None,
            teacher_ids,
            original_start_time: NaiveTime::from_hms_opt(10, 0, 0).expect("valid test time"),
            original_end_time: NaiveTime::from_hms_opt(11, 0, 0).expect("valid test time"),
            date: NaiveDate::from_ymd_opt(2026, 8, 17).expect("valid test date"),
            start_time: NaiveTime::from_hms_opt(10, 0, 0).expect("valid test time"),
            end_time: NaiveTime::from_hms_opt(11, 0, 0).expect("valid test time"),
            capacity: Some(12),
            trial_policy: TrialPolicy::Free,
            single_visit_allowed: false,
            track_attendance: true,
            status: OccurrenceStatus::Scheduled,
            exception_id: None,
        }
    }

    fn input(occurrence: &ScheduleOccurrence) -> MaterializedOccurrenceInput<'_> {
        MaterializedOccurrenceInput {
            organization_id: Uuid::from_u128(10),
            id: Uuid::from_u128(11),
            occurrence,
            starts_at: DateTime::from_timestamp(1_787_480_000, 0).expect("valid test instant"),
            ends_at: DateTime::from_timestamp(1_787_483_600, 0).expect("valid test instant"),
            time_zone: "Europe/Moscow",
            source_rule_version: 1,
            source_exception_version: None,
        }
    }

    #[test]
    fn materialization_rejects_duplicate_teachers() {
        let occurrence = occurrence(vec![Uuid::from_u128(7), Uuid::from_u128(7)]);
        assert!(validate_materialization(&input(&occurrence)).is_err());
    }

    #[test]
    fn exception_id_and_version_must_move_together() {
        let mut occurrence = occurrence(Vec::new());
        occurrence.exception_id = Some(Uuid::from_u128(8));
        assert!(validate_materialization(&input(&occurrence)).is_err());
    }
}
