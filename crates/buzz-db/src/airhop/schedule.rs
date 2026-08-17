//! Transactional persistence for materialized AirHub occurrences.

use std::collections::{BTreeMap, BTreeSet};

use airhop_core::schedule::materialize_schedule;
use airhop_core::{
    AgeLimits, GroupSchedulePolicy, LessonException, LessonExceptionKind, LessonOriginal,
    MaterializeScheduleOptions, NullableOverride, OccurrenceEffective, OccurrenceOverride,
    OccurrenceStatus, RecurrenceRule, ScheduleOccurrence, SchedulePolicy, ScheduleRange,
    TrialPolicy, Weekday,
};
use buzz_core::{CommunityId, TenantContext};
use chrono::{DateTime, Days, NaiveDate, NaiveTime, Utc};
use serde_json::{Map, Value};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use crate::{Db, DbError, Result};

/// Number of local calendar days kept published ahead of an organization.
pub const OCCURRENCE_HORIZON_DAYS: u64 = 180;

/// Outcome of rebuilding one group's rolling occurrence projection.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ScheduleMaterializationSummary {
    /// Number of stable occurrences desired inside the rolling window.
    pub desired: usize,
    /// Number of rows inserted or refreshed with new source data.
    pub changed: usize,
    /// Number of previously published future rows made unavailable.
    pub cancelled_stale: usize,
}

#[derive(Debug)]
struct OrganizationScheduleSource {
    time_zone: String,
    current_date: NaiveDate,
    version: i64,
    policy: SchedulePolicy,
}

#[derive(Debug)]
struct GroupScheduleSource {
    policy: GroupSchedulePolicy,
    version: i64,
}

#[derive(Debug)]
struct RuleScheduleSource {
    rule: RecurrenceRule,
    version: i64,
}

#[derive(Debug)]
struct ExceptionScheduleSource {
    exception: LessonException,
    version: i64,
}

/// Server-computed materialization metadata around one domain occurrence.
#[derive(Debug)]
pub struct MaterializedOccurrenceInput<'a> {
    /// Organization selected from the host-resolved tenant.
    pub organization_id: Uuid,
    /// Identifier used only when this stable occurrence is first inserted.
    pub id: Uuid,
    /// Fully resolved domain occurrence.
    pub occurrence: &'a ScheduleOccurrence,
    /// IANA time-zone name used for the UTC conversion.
    pub time_zone: &'a str,
    /// Group aggregate version used by the materializer.
    pub source_group_version: i64,
    /// Recurrence-rule version used by the materializer.
    pub source_rule_version: i64,
    /// Exception version used by the materializer, when one was applied.
    pub source_exception_version: Option<i64>,
    /// Organization aggregate version used by the materializer.
    pub source_organization_version: i64,
    /// Authoritative database instant for this rebuild.
    pub materialized_at: DateTime<Utc>,
}

/// Database identity and version of a persisted materialized occurrence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MaterializedOccurrenceRecord {
    /// Stable database row identifier.
    pub id: Uuid,
    /// Version incremented whenever the read model is rebuilt.
    pub version: i64,
    /// True when the persisted projection or its teacher links changed.
    pub changed: bool,
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
             exception_id, source_rule_version, source_exception_version, \
             source_group_version, source_organization_version, materialized_at, updated_at\
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, \
                   (($11::date + $12::time) AT TIME ZONE $14), \
                   (($11::date + $13::time) AT TIME ZONE $14), \
                   $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $25) \
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
             source_group_version = EXCLUDED.source_group_version, \
             source_organization_version = EXCLUDED.source_organization_version, \
             version = airhop_lesson_occurrences.version + 1, \
             materialized_at = EXCLUDED.materialized_at, updated_at = EXCLUDED.updated_at \
         WHERE (airhop_lesson_occurrences.group_id, \
                airhop_lesson_occurrences.branch_id, \
                airhop_lesson_occurrences.room_id, \
                airhop_lesson_occurrences.original_start_time, \
                airhop_lesson_occurrences.original_end_time, \
                airhop_lesson_occurrences.effective_date, \
                airhop_lesson_occurrences.start_time, \
                airhop_lesson_occurrences.end_time, \
                airhop_lesson_occurrences.starts_at, \
                airhop_lesson_occurrences.ends_at, \
                airhop_lesson_occurrences.time_zone, \
                airhop_lesson_occurrences.capacity, \
                airhop_lesson_occurrences.trial_policy, \
                airhop_lesson_occurrences.allow_single_visits, \
                airhop_lesson_occurrences.track_attendance, \
                airhop_lesson_occurrences.status, \
                airhop_lesson_occurrences.exception_id, \
                airhop_lesson_occurrences.source_rule_version, \
                airhop_lesson_occurrences.source_exception_version, \
                airhop_lesson_occurrences.source_group_version, \
                airhop_lesson_occurrences.source_organization_version) \
              IS DISTINCT FROM \
               (EXCLUDED.group_id, EXCLUDED.branch_id, EXCLUDED.room_id, \
                EXCLUDED.original_start_time, EXCLUDED.original_end_time, \
                EXCLUDED.effective_date, EXCLUDED.start_time, EXCLUDED.end_time, \
                EXCLUDED.starts_at, EXCLUDED.ends_at, EXCLUDED.time_zone, \
                EXCLUDED.capacity, EXCLUDED.trial_policy, \
                EXCLUDED.allow_single_visits, EXCLUDED.track_attendance, \
                EXCLUDED.status, EXCLUDED.exception_id, EXCLUDED.source_rule_version, \
                EXCLUDED.source_exception_version, EXCLUDED.source_group_version, \
                EXCLUDED.source_organization_version) \
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
    .bind(input.time_zone)
    .bind(capacity)
    .bind(trial_policy)
    .bind(input.occurrence.single_visit_allowed)
    .bind(input.occurrence.track_attendance)
    .bind(occurrence_status_str(input.occurrence.status))
    .bind(input.occurrence.exception_id)
    .bind(input.source_rule_version)
    .bind(input.source_exception_version)
    .bind(input.source_group_version)
    .bind(input.source_organization_version)
    .bind(input.materialized_at)
    .fetch_optional(&mut **transaction)
    .await?;
    let record = if let Some(row) = row {
        MaterializedOccurrenceRecord {
            id: row.try_get("id")?,
            version: row.try_get("version")?,
            changed: true,
        }
    } else {
        let row = sqlx::query(
            "SELECT id, version FROM airhop_lesson_occurrences \
             WHERE community_id = $1 AND organization_id = $2 \
               AND recurrence_rule_id = $3 AND original_date = $4",
        )
        .bind(tenant.community().as_uuid())
        .bind(input.organization_id)
        .bind(input.occurrence.lesson_ref.recurrence_rule_id)
        .bind(input.occurrence.lesson_ref.original_date)
        .fetch_one(&mut **transaction)
        .await?;
        MaterializedOccurrenceRecord {
            id: row.try_get("id")?,
            version: row.try_get("version")?,
            changed: false,
        }
    };

    if !record.changed {
        return Ok(record);
    }
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

/// Rebuilds one group's public occurrence window inside the caller's command transaction.
///
/// Active source rows are materialized from the organization's current local date through
/// [`OCCURRENCE_HORIZON_DAYS`]. Previously published future rows that are no longer produced
/// are cancelled rather than deleted, preserving bookings and stable lesson references.
pub async fn rematerialize_group_schedule(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    group_id: Uuid,
    materialized_at: DateTime<Utc>,
) -> Result<ScheduleMaterializationSummary> {
    let organization =
        load_organization_source(transaction, tenant, organization_id, materialized_at).await?;
    let group = load_group_source(transaction, tenant, organization_id, group_id).await?;
    let rules = load_rule_sources(transaction, tenant, organization_id, group_id).await?;
    let exceptions = load_exception_sources(transaction, tenant, organization_id, group_id).await?;
    let ends_on = organization
        .current_date
        .checked_add_days(Days::new(OCCURRENCE_HORIZON_DAYS))
        .ok_or_else(|| {
            DbError::InvalidData("AirHub occurrence horizon exceeds the calendar".to_owned())
        })?;
    let domain_rules = rules
        .iter()
        .map(|source| source.rule.clone())
        .collect::<Vec<_>>();
    let domain_exceptions = exceptions
        .iter()
        .map(|source| source.exception.clone())
        .collect::<Vec<_>>();
    let occurrences = materialize_schedule(
        &organization.policy,
        std::slice::from_ref(&group.policy),
        &domain_rules,
        &domain_exceptions,
        ScheduleRange {
            starts_on: organization.current_date,
            ends_on,
        },
        MaterializeScheduleOptions::default(),
    )
    .map_err(|error| {
        DbError::InvalidData(format!("AirHub schedule cannot be materialized: {error}"))
    })?;
    let rule_versions = rules
        .iter()
        .map(|source| (source.rule.id, source.version))
        .collect::<BTreeMap<_, _>>();
    let exception_versions = exceptions
        .iter()
        .map(|source| (source.exception.id, source.version))
        .collect::<BTreeMap<_, _>>();
    let desired_refs = occurrences
        .iter()
        .map(|occurrence| occurrence.lesson_ref)
        .collect::<BTreeSet<_>>();
    let mut summary = ScheduleMaterializationSummary {
        desired: occurrences.len(),
        ..ScheduleMaterializationSummary::default()
    };

    for occurrence in &occurrences {
        let source_rule_version = rule_versions
            .get(&occurrence.lesson_ref.recurrence_rule_id)
            .copied()
            .ok_or_else(|| {
                DbError::InvalidData("AirHub occurrence has no source rule version".to_owned())
            })?;
        let source_exception_version = occurrence
            .exception_id
            .map(|exception_id| {
                exception_versions
                    .get(&exception_id)
                    .copied()
                    .ok_or_else(|| {
                        DbError::InvalidData(
                            "AirHub occurrence has no source exception version".to_owned(),
                        )
                    })
            })
            .transpose()?;
        let persisted = upsert_materialized_occurrence(
            transaction,
            tenant,
            &MaterializedOccurrenceInput {
                organization_id,
                id: Uuid::new_v4(),
                occurrence,
                time_zone: &organization.time_zone,
                source_group_version: group.version,
                source_rule_version,
                source_exception_version,
                source_organization_version: organization.version,
                materialized_at,
            },
        )
        .await?;
        summary.changed += usize::from(persisted.changed);
    }

    let existing = sqlx::query(
        "SELECT id, recurrence_rule_id, original_date \
         FROM airhop_lesson_occurrences \
         WHERE community_id = $1 AND organization_id = $2 AND group_id = $3 \
           AND starts_at > $4 \
         FOR UPDATE",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(group_id)
    .bind(materialized_at)
    .fetch_all(&mut **transaction)
    .await?;
    for row in existing {
        let lesson_ref = airhop_core::StableLessonReference {
            recurrence_rule_id: row.try_get("recurrence_rule_id")?,
            original_date: row.try_get("original_date")?,
        };
        if desired_refs.contains(&lesson_ref) {
            continue;
        }
        let updated = sqlx::query(
            "UPDATE airhop_lesson_occurrences \
             SET status = 'cancelled', version = version + 1, materialized_at = $4, \
                 updated_at = $4 \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3 \
               AND status <> 'cancelled'",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(row.try_get::<Uuid, _>("id")?)
        .bind(materialized_at)
        .execute(&mut **transaction)
        .await?;
        summary.cancelled_stale += updated.rows_affected() as usize;
    }
    Ok(summary)
}

/// Rebuilds all active groups after an organization default or time-zone change.
pub async fn rematerialize_organization_schedule(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    materialized_at: DateTime<Utc>,
) -> Result<ScheduleMaterializationSummary> {
    let group_ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM airhop_groups \
         WHERE community_id = $1 AND organization_id = $2 AND status = 'active' \
         ORDER BY id",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .fetch_all(&mut **transaction)
    .await?;
    let mut total = ScheduleMaterializationSummary::default();
    for group_id in group_ids {
        let summary = rematerialize_group_schedule(
            transaction,
            tenant,
            organization_id,
            group_id,
            materialized_at,
        )
        .await?;
        total.desired += summary.desired;
        total.changed += summary.changed;
        total.cancelled_stale += summary.cancelled_stale;
    }
    Ok(total)
}

impl Db {
    /// Advances every active AirHub group's rolling occurrence horizon.
    ///
    /// Each group uses its own transaction and tenant context so one malformed
    /// center cannot expose or roll back another center's projection.
    pub async fn refresh_airhop_occurrence_horizons(&self) -> Result<usize> {
        let targets = sqlx::query(
            "SELECT organization.community_id, community.host, \
                    organization.id AS organization_id, group_row.id AS group_id \
             FROM airhop_organizations organization \
             JOIN communities community ON community.id = organization.community_id \
             JOIN airhop_groups group_row \
               ON group_row.community_id = organization.community_id \
              AND group_row.organization_id = organization.id \
             WHERE organization.status = 'active' AND group_row.status = 'active' \
             ORDER BY organization.community_id, group_row.id",
        )
        .fetch_all(&self.pool)
        .await?;
        let mut refreshed = 0usize;
        let mut first_error = None;
        for target in targets {
            let community_id: Uuid = target.try_get("community_id")?;
            let host: String = target.try_get("host")?;
            let organization_id: Uuid = target.try_get("organization_id")?;
            let group_id: Uuid = target.try_get("group_id")?;
            let tenant = TenantContext::resolved(CommunityId::from_uuid(community_id), host);
            let result = async {
                let mut transaction = self.pool.begin().await?;
                let materialized_at: DateTime<Utc> = sqlx::query_scalar("SELECT now()")
                    .fetch_one(&mut *transaction)
                    .await?;
                rematerialize_group_schedule(
                    &mut transaction,
                    &tenant,
                    organization_id,
                    group_id,
                    materialized_at,
                )
                .await?;
                transaction.commit().await?;
                Result::<()>::Ok(())
            }
            .await;
            match result {
                Ok(()) => refreshed += 1,
                Err(error) => {
                    tracing::warn!(
                        %community_id,
                        %organization_id,
                        %group_id,
                        %error,
                        "AirHub rolling occurrence refresh failed"
                    );
                    if first_error.is_none() {
                        first_error = Some(error);
                    }
                }
            }
        }
        if let Some(error) = first_error {
            Err(error)
        } else {
            Ok(refreshed)
        }
    }
}

async fn load_organization_source(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    materialized_at: DateTime<Utc>,
) -> Result<OrganizationScheduleSource> {
    let row = sqlx::query(
        "SELECT time_zone, default_trial_policy, track_attendance_by_default, \
                allow_single_visits_by_default, version, \
                ($3::timestamptz AT TIME ZONE time_zone)::date AS current_date \
         FROM airhop_organizations \
         WHERE community_id = $1 AND id = $2 AND status = 'active' \
         FOR SHARE",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(materialized_at)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or_else(|| DbError::NotFound("active AirHub organization".to_owned()))?;
    let default_trial_policy: Value = row.try_get("default_trial_policy")?;
    Ok(OrganizationScheduleSource {
        time_zone: row.try_get("time_zone")?,
        current_date: row.try_get("current_date")?,
        version: row.try_get("version")?,
        policy: SchedulePolicy {
            default_trial_policy: serde_json::from_value(default_trial_policy)?,
            track_attendance_by_default: row.try_get("track_attendance_by_default")?,
            allow_single_visits_by_default: row.try_get("allow_single_visits_by_default")?,
        },
    })
}

async fn load_group_source(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    group_id: Uuid,
) -> Result<GroupScheduleSource> {
    let row = sqlx::query(
        "SELECT branch_id, room_id, min_age_months, max_age_months, capacity, \
                trial_policy_override, track_attendance_override, \
                allow_single_visits_override, status, version \
         FROM airhop_groups \
         WHERE community_id = $1 AND organization_id = $2 AND id = $3 \
         FOR UPDATE",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(group_id)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or_else(|| DbError::NotFound("AirHub group".to_owned()))?;
    let min_age_months = optional_u32(row.try_get("min_age_months")?, "minimum group age")?;
    let max_age_months = optional_u32(row.try_get("max_age_months")?, "maximum group age")?;
    let capacity = optional_u32(row.try_get("capacity")?, "group capacity")?;
    let trial_policy: Option<Value> = row.try_get("trial_policy_override")?;
    let status: String = row.try_get("status")?;
    let teacher_ids = sqlx::query_scalar(
        "SELECT teacher_id FROM airhop_group_teachers \
         WHERE community_id = $1 AND organization_id = $2 AND group_id = $3 \
         ORDER BY teacher_id",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(group_id)
    .fetch_all(&mut **transaction)
    .await?;
    Ok(GroupScheduleSource {
        policy: GroupSchedulePolicy {
            id: group_id,
            branch_id: row.try_get("branch_id")?,
            room_id: row.try_get("room_id")?,
            teacher_ids,
            age_limits: AgeLimits::new(min_age_months, max_age_months)
                .map_err(|error| DbError::InvalidData(error.to_string()))?,
            capacity,
            trial_policy_override: trial_policy.map(serde_json::from_value).transpose()?,
            track_attendance_override: row.try_get("track_attendance_override")?,
            allow_single_visits_override: row.try_get("allow_single_visits_override")?,
            active: active_status(&status, "group")?,
        },
        version: row.try_get("version")?,
    })
}

async fn load_rule_sources(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    group_id: Uuid,
) -> Result<Vec<RuleScheduleSource>> {
    let rows = sqlx::query(
        "SELECT id, starts_on, ends_on, start_time, end_time, branch_id_override, \
                room_override_set, room_id_override, teacher_override_set, \
                capacity_override_set, capacity_override, trial_policy_override, \
                status, version \
         FROM airhop_recurrence_rules \
         WHERE community_id = $1 AND organization_id = $2 AND group_id = $3 \
         ORDER BY id",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(group_id)
    .fetch_all(&mut **transaction)
    .await?;
    let mut rules = Vec::with_capacity(rows.len());
    let mut positions = BTreeMap::new();
    for row in rows {
        let id: Uuid = row.try_get("id")?;
        let room_override_set: bool = row.try_get("room_override_set")?;
        let capacity_override_set: bool = row.try_get("capacity_override_set")?;
        let teacher_override_set: bool = row.try_get("teacher_override_set")?;
        let trial_policy: Option<Value> = row.try_get("trial_policy_override")?;
        let status: String = row.try_get("status")?;
        let capacity = optional_u32(row.try_get("capacity_override")?, "rule capacity")?;
        let position = rules.len();
        positions.insert(id, position);
        rules.push(RuleScheduleSource {
            rule: RecurrenceRule {
                id,
                group_id,
                starts_on: row.try_get("starts_on")?,
                ends_on: row.try_get("ends_on")?,
                weekdays: BTreeSet::new(),
                start_time: row.try_get("start_time")?,
                end_time: row.try_get("end_time")?,
                branch_id_override: row.try_get("branch_id_override")?,
                room_id_override: nullable_override(
                    room_override_set,
                    row.try_get("room_id_override")?,
                ),
                teacher_ids_override: teacher_override_set.then(Vec::new),
                capacity_override: nullable_override(capacity_override_set, capacity),
                trial_policy_override: trial_policy.map(serde_json::from_value).transpose()?,
                active: active_status(&status, "recurrence rule")?,
            },
            version: row.try_get("version")?,
        });
    }
    let weekdays = sqlx::query(
        "SELECT weekday.recurrence_rule_id, weekday.weekday \
         FROM airhop_recurrence_weekdays weekday \
         JOIN airhop_recurrence_rules rule_row \
           ON rule_row.community_id = weekday.community_id \
          AND rule_row.organization_id = weekday.organization_id \
          AND rule_row.id = weekday.recurrence_rule_id \
         WHERE weekday.community_id = $1 AND weekday.organization_id = $2 \
           AND rule_row.group_id = $3 \
         ORDER BY weekday.recurrence_rule_id, weekday.weekday",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(group_id)
    .fetch_all(&mut **transaction)
    .await?;
    for row in weekdays {
        let rule_id: Uuid = row.try_get("recurrence_rule_id")?;
        let position = positions.get(&rule_id).ok_or_else(|| {
            DbError::InvalidData("AirHub recurrence weekday has no source rule".to_owned())
        })?;
        rules[*position]
            .rule
            .weekdays
            .insert(parse_weekday(row.try_get("weekday")?)?);
    }
    let teachers = sqlx::query(
        "SELECT teacher.recurrence_rule_id, teacher.teacher_id \
         FROM airhop_recurrence_teachers teacher \
         JOIN airhop_recurrence_rules rule_row \
           ON rule_row.community_id = teacher.community_id \
          AND rule_row.organization_id = teacher.organization_id \
          AND rule_row.id = teacher.recurrence_rule_id \
         WHERE teacher.community_id = $1 AND teacher.organization_id = $2 \
           AND rule_row.group_id = $3 \
         ORDER BY teacher.recurrence_rule_id, teacher.teacher_id",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(group_id)
    .fetch_all(&mut **transaction)
    .await?;
    for row in teachers {
        let rule_id: Uuid = row.try_get("recurrence_rule_id")?;
        let position = positions.get(&rule_id).ok_or_else(|| {
            DbError::InvalidData("AirHub recurrence teacher has no source rule".to_owned())
        })?;
        rules[*position]
            .rule
            .teacher_ids_override
            .get_or_insert_with(Vec::new)
            .push(row.try_get("teacher_id")?);
    }
    Ok(rules)
}

async fn load_exception_sources(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    group_id: Uuid,
) -> Result<Vec<ExceptionScheduleSource>> {
    let rows = sqlx::query(
        "SELECT exception.id, exception.recurrence_rule_id, exception.original_date, \
                exception.kind, exception.original_snapshot, exception.override_payload, \
                exception.effective_payload, exception.version \
         FROM airhop_lesson_exceptions exception \
         JOIN airhop_recurrence_rules rule_row \
           ON rule_row.community_id = exception.community_id \
          AND rule_row.organization_id = exception.organization_id \
          AND rule_row.id = exception.recurrence_rule_id \
         WHERE exception.community_id = $1 AND exception.organization_id = $2 \
           AND rule_row.group_id = $3 \
         ORDER BY exception.recurrence_rule_id, exception.original_date",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(group_id)
    .fetch_all(&mut **transaction)
    .await?;
    rows.into_iter()
        .map(|row| {
            let kind: String = row.try_get("kind")?;
            let original_snapshot: Value = row.try_get("original_snapshot")?;
            let override_payload: Option<Value> = row.try_get("override_payload")?;
            let effective_payload: Option<Value> = row.try_get("effective_payload")?;
            let exception_kind = match kind.as_str() {
                "cancelled" => LessonExceptionKind::Cancelled {
                    effective: effective_payload
                        .as_ref()
                        .map(parse_effective_payload)
                        .transpose()?,
                },
                "override" => LessonExceptionKind::Override {
                    changes: parse_override_payload(override_payload.as_ref().ok_or_else(
                        || {
                            DbError::InvalidData(
                                "AirHub override exception has no payload".to_owned(),
                            )
                        },
                    )?)?,
                },
                other => {
                    return Err(DbError::InvalidData(format!(
                        "unknown AirHub lesson exception kind {other:?}"
                    )))
                }
            };
            Ok(ExceptionScheduleSource {
                exception: LessonException {
                    id: row.try_get("id")?,
                    recurrence_rule_id: row.try_get("recurrence_rule_id")?,
                    original_date: row.try_get("original_date")?,
                    original: parse_original_payload(&original_snapshot)?,
                    kind: exception_kind,
                },
                version: row.try_get("version")?,
            })
        })
        .collect()
}

fn parse_original_payload(value: &Value) -> Result<LessonOriginal> {
    let object = json_object(value, "AirHub lesson original snapshot")?;
    Ok(LessonOriginal {
        start_time: required_time(object, "startTime")?,
        end_time: required_time(object, "endTime")?,
        branch_id: required_uuid(object, "branchId")?,
        room_id: required_nullable_uuid(object, "roomId")?,
        teacher_ids: required_uuid_array(object, "teacherIds")?,
    })
}

fn parse_override_payload(value: &Value) -> Result<OccurrenceOverride> {
    let object = json_object(value, "AirHub lesson override payload")?;
    Ok(OccurrenceOverride {
        date: optional_date(object, "date")?,
        start_time: optional_time(object, "startTime")?,
        end_time: optional_time(object, "endTime")?,
        branch_id: optional_uuid(object, "branchId")?,
        room_id: nullable_json_override(object, "roomId")?,
        teacher_ids: optional_uuid_array(object, "teacherIds")?,
        capacity: nullable_json_override(object, "capacity")?,
        trial_policy: optional_trial_policy(object, "trialPolicy")?,
        allow_single_visits: optional_bool(object, "allowSingleVisits")?,
    })
}

fn parse_effective_payload(value: &Value) -> Result<OccurrenceEffective> {
    let object = json_object(value, "AirHub lesson effective payload")?;
    Ok(OccurrenceEffective {
        date: required_date(object, "date")?,
        start_time: required_time(object, "startTime")?,
        end_time: required_time(object, "endTime")?,
        branch_id: required_uuid(object, "branchId")?,
        room_id: required_nullable_uuid(object, "roomId")?,
        teacher_ids: required_uuid_array(object, "teacherIds")?,
        capacity: required_nullable_u32(object, "capacity")?,
        trial_policy: serde_json::from_value(required_value(object, "trialPolicy")?.clone())?,
        allow_single_visits: required_value(object, "allowSingleVisits")?
            .as_bool()
            .ok_or_else(|| invalid_json_field("allowSingleVisits"))?,
    })
}

fn json_object<'a>(value: &'a Value, label: &str) -> Result<&'a Map<String, Value>> {
    value
        .as_object()
        .ok_or_else(|| DbError::InvalidData(format!("{label} must be an object")))
}

fn required_value<'a>(object: &'a Map<String, Value>, field: &str) -> Result<&'a Value> {
    object
        .get(field)
        .ok_or_else(|| DbError::InvalidData(format!("AirHub JSON field {field:?} is missing")))
}

fn required_uuid(object: &Map<String, Value>, field: &str) -> Result<Uuid> {
    parse_uuid(required_value(object, field)?, field)
}

fn optional_uuid(object: &Map<String, Value>, field: &str) -> Result<Option<Uuid>> {
    object
        .get(field)
        .map(|value| parse_uuid(value, field))
        .transpose()
}

fn required_nullable_uuid(object: &Map<String, Value>, field: &str) -> Result<Option<Uuid>> {
    let value = required_value(object, field)?;
    if value.is_null() {
        Ok(None)
    } else {
        parse_uuid(value, field).map(Some)
    }
}

fn parse_uuid(value: &Value, field: &str) -> Result<Uuid> {
    value
        .as_str()
        .ok_or_else(|| invalid_json_field(field))?
        .parse()
        .map_err(|_| invalid_json_field(field))
}

fn required_uuid_array(object: &Map<String, Value>, field: &str) -> Result<Vec<Uuid>> {
    parse_uuid_array(required_value(object, field)?, field)
}

fn optional_uuid_array(object: &Map<String, Value>, field: &str) -> Result<Option<Vec<Uuid>>> {
    object
        .get(field)
        .map(|value| parse_uuid_array(value, field))
        .transpose()
}

fn parse_uuid_array(value: &Value, field: &str) -> Result<Vec<Uuid>> {
    value
        .as_array()
        .ok_or_else(|| invalid_json_field(field))?
        .iter()
        .map(|value| parse_uuid(value, field))
        .collect()
}

fn required_date(object: &Map<String, Value>, field: &str) -> Result<NaiveDate> {
    parse_date(required_value(object, field)?, field)
}

fn optional_date(object: &Map<String, Value>, field: &str) -> Result<Option<NaiveDate>> {
    object
        .get(field)
        .map(|value| parse_date(value, field))
        .transpose()
}

fn parse_date(value: &Value, field: &str) -> Result<NaiveDate> {
    NaiveDate::parse_from_str(
        value.as_str().ok_or_else(|| invalid_json_field(field))?,
        "%Y-%m-%d",
    )
    .map_err(|_| invalid_json_field(field))
}

fn required_time(object: &Map<String, Value>, field: &str) -> Result<NaiveTime> {
    parse_time(required_value(object, field)?, field)
}

fn optional_time(object: &Map<String, Value>, field: &str) -> Result<Option<NaiveTime>> {
    object
        .get(field)
        .map(|value| parse_time(value, field))
        .transpose()
}

fn parse_time(value: &Value, field: &str) -> Result<NaiveTime> {
    let value = value.as_str().ok_or_else(|| invalid_json_field(field))?;
    ["%H:%M", "%H:%M:%S", "%H:%M:%S%.f"]
        .into_iter()
        .find_map(|format| NaiveTime::parse_from_str(value, format).ok())
        .ok_or_else(|| invalid_json_field(field))
}

fn required_nullable_u32(object: &Map<String, Value>, field: &str) -> Result<Option<u32>> {
    let value = required_value(object, field)?;
    if value.is_null() {
        Ok(None)
    } else {
        parse_u32(value, field).map(Some)
    }
}

fn parse_u32(value: &Value, field: &str) -> Result<u32> {
    value
        .as_u64()
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(|| invalid_json_field(field))
}

fn optional_bool(object: &Map<String, Value>, field: &str) -> Result<Option<bool>> {
    object
        .get(field)
        .map(|value| value.as_bool().ok_or_else(|| invalid_json_field(field)))
        .transpose()
}

fn optional_trial_policy(object: &Map<String, Value>, field: &str) -> Result<Option<TrialPolicy>> {
    object
        .get(field)
        .map(|value| serde_json::from_value(value.clone()).map_err(Into::into))
        .transpose()
}

fn nullable_json_override<T>(
    object: &Map<String, Value>,
    field: &str,
) -> Result<NullableOverride<T>>
where
    T: serde::de::DeserializeOwned,
{
    match object.get(field) {
        None => Ok(NullableOverride::Inherit),
        Some(Value::Null) => Ok(NullableOverride::Clear),
        Some(value) => serde_json::from_value(value.clone())
            .map(NullableOverride::Set)
            .map_err(Into::into),
    }
}

fn invalid_json_field(field: &str) -> DbError {
    DbError::InvalidData(format!("AirHub JSON field {field:?} is invalid"))
}

fn nullable_override<T>(is_set: bool, value: Option<T>) -> NullableOverride<T> {
    if !is_set {
        NullableOverride::Inherit
    } else {
        value.map_or(NullableOverride::Clear, NullableOverride::Set)
    }
}

fn optional_u32(value: Option<i32>, label: &str) -> Result<Option<u32>> {
    value
        .map(|value| {
            u32::try_from(value)
                .map_err(|_| DbError::InvalidData(format!("AirHub {label} is invalid")))
        })
        .transpose()
}

fn active_status(value: &str, label: &str) -> Result<bool> {
    match value {
        "active" => Ok(true),
        "archived" => Ok(false),
        other => Err(DbError::InvalidData(format!(
            "unknown AirHub {label} status {other:?}"
        ))),
    }
}

fn parse_weekday(value: &str) -> Result<Weekday> {
    match value {
        "monday" => Ok(Weekday::Monday),
        "tuesday" => Ok(Weekday::Tuesday),
        "wednesday" => Ok(Weekday::Wednesday),
        "thursday" => Ok(Weekday::Thursday),
        "friday" => Ok(Weekday::Friday),
        "saturday" => Ok(Weekday::Saturday),
        "sunday" => Ok(Weekday::Sunday),
        other => Err(DbError::InvalidData(format!(
            "unknown AirHub recurrence weekday {other:?}"
        ))),
    }
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
    if input.source_group_version <= 0
        || input.source_rule_version <= 0
        || input.source_organization_version <= 0
    {
        return Err(DbError::InvalidData(
            "AirHub materialization source version is invalid".to_owned(),
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
            time_zone: "Europe/Moscow",
            source_group_version: 1,
            source_rule_version: 1,
            source_exception_version: None,
            source_organization_version: 1,
            materialized_at: DateTime::from_timestamp(1_787_480_000, 0)
                .expect("valid test instant"),
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
