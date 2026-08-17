//! Atomic staff commands for one stable AirHub lesson occurrence.
//!
//! The command identity is `(recurrence_rule_id, original_date)`. Moving,
//! editing, cancelling, and restoring a lesson never replace that identity.

use airhop_core::{NullableOverride, OccurrenceOverride};
use buzz_core::TenantContext;
use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sqlx::Row;
use uuid::Uuid;

use super::{
    append_domain_event, commit_command, insert_pending_command, AirhopActor, AirhopCommand,
    CommandInsertOutcome, CommandStatus, NewAirhopCommand, NewDomainEvent, PrivacyClass,
};
use crate::{Db, DbError, Result};

const PUT_EXCEPTION_COMMAND_TYPE: &str = "PutLessonException";

/// Authoritative stored exception returned to staff read models.
#[derive(Debug, Clone, PartialEq)]
pub struct AirhopLessonException {
    /// Stable exception row identifier.
    pub id: Uuid,
    /// Owning organization.
    pub organization_id: Uuid,
    /// Stable recurrence rule.
    pub recurrence_rule_id: Uuid,
    /// Stable original occurrence date.
    pub original_date: NaiveDate,
    /// `cancelled` or `override`.
    pub kind: String,
    /// Immutable series snapshot captured on first exception creation.
    pub original_snapshot: Value,
    /// Partial override payload for an active exception.
    pub override_payload: Option<Value>,
    /// Last effective values retained when an overridden lesson is cancelled.
    pub effective_payload: Option<Value>,
    /// Optional staff-facing reason.
    pub reason: Option<String>,
    /// Optimistic exception version.
    pub version: i64,
    /// Last mutation instant.
    pub updated_at: DateTime<Utc>,
}

/// Semantic mutation applied to one stable lesson.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LessonExceptionChange {
    /// Cancel the current effective lesson.
    Cancel,
    /// Replace the current exception with a partial override.
    Override(OccurrenceOverride),
    /// Delete the exception and return to the current series definition.
    Restore,
}

impl LessonExceptionChange {
    const fn action(&self) -> LessonExceptionAction {
        match self {
            Self::Cancel => LessonExceptionAction::Cancel,
            Self::Override(_) => LessonExceptionAction::Override,
            Self::Restore => LessonExceptionAction::Restore,
        }
    }
}

/// Stable action discriminator returned by a lesson command.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LessonExceptionAction {
    /// Lesson was cancelled.
    Cancel,
    /// Lesson was moved or otherwise overridden.
    Override,
    /// Lesson was returned to its series.
    Restore,
}

/// Idempotent and optimistic input for one staff lesson mutation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PutLessonExceptionInput {
    /// Stable recurrence rule.
    pub recurrence_rule_id: Uuid,
    /// Stable original occurrence date.
    pub original_date: NaiveDate,
    /// Zero for a new exception, otherwise the current exception version.
    pub expected_version: i64,
    /// Cancel, override, or restore.
    pub change: LessonExceptionChange,
    /// Optional staff-facing reason.
    pub reason: Option<String>,
    /// Keyed digest of the HTTP idempotency key.
    pub idempotency_digest: [u8; 32],
    /// Canonical request hash bound to method and resource path.
    pub request_hash: [u8; 32],
    /// Verified staff attribution.
    pub actor: AirhopActor,
}

/// Result of applying or replaying one staff lesson mutation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LessonExceptionMutationOutcome {
    /// Stable recurrence rule.
    pub recurrence_rule_id: Uuid,
    /// Stable original occurrence date.
    pub original_date: NaiveDate,
    /// Current exception id, or none after restore.
    pub exception_id: Option<Uuid>,
    /// Current exception version, or the terminal event version after restore.
    pub version: i64,
    /// Applied semantic action.
    pub action: LessonExceptionAction,
    /// Active bookings ended by a cancellation.
    pub cancelled_bookings: usize,
    /// True when an existing command receipt was replayed.
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredMutationResult {
    recurrence_rule_id: Uuid,
    original_date: NaiveDate,
    exception_id: Option<Uuid>,
    version: i64,
    action: LessonExceptionAction,
    cancelled_bookings: usize,
}

#[derive(Debug)]
struct CurrentOccurrence {
    group_id: Uuid,
    exception_id: Option<Uuid>,
    original_start_time: NaiveTime,
    original_end_time: NaiveTime,
    effective_date: NaiveDate,
    start_time: NaiveTime,
    end_time: NaiveTime,
    branch_id: Uuid,
    room_id: Option<Uuid>,
    teacher_ids: Vec<Uuid>,
    capacity: Option<i32>,
    trial_policy: Value,
    allow_single_visits: bool,
}

impl Db {
    /// Lists active and historical lesson exceptions for the tenant organization.
    pub async fn list_airhop_lesson_exceptions(
        &self,
        tenant: &TenantContext,
    ) -> Result<Vec<AirhopLessonException>> {
        let rows = sqlx::query(
            "SELECT exception.id, exception.organization_id, exception.recurrence_rule_id, \
                    exception.original_date, exception.kind, exception.original_snapshot, \
                    exception.override_payload, exception.effective_payload, exception.reason, \
                    exception.version, exception.updated_at \
             FROM airhop_lesson_exceptions exception \
             JOIN airhop_organizations organization \
               ON organization.community_id = exception.community_id \
              AND organization.id = exception.organization_id \
             WHERE exception.community_id = $1 AND organization.status = 'active' \
             ORDER BY exception.original_date, exception.recurrence_rule_id",
        )
        .bind(tenant.community().as_uuid())
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(parse_exception_row).collect()
    }

    /// Cancels, overrides, or restores one occurrence in a single command transaction.
    pub async fn put_airhop_lesson_exception(
        &self,
        tenant: &TenantContext,
        input: &PutLessonExceptionInput,
    ) -> Result<LessonExceptionMutationOutcome> {
        validate_input(input)?;
        let mut transaction = self.pool.begin().await?;
        let organization = sqlx::query(
            "SELECT id, now() AS occurred_at FROM airhop_organizations \
             WHERE community_id = $1 AND status = 'active' FOR SHARE",
        )
        .bind(tenant.community().as_uuid())
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| DbError::NotFound("active AirHub organization".to_owned()))?;
        let organization_id: Uuid = organization.try_get("id")?;
        let occurred_at: DateTime<Utc> = organization.try_get("occurred_at")?;
        let command = NewAirhopCommand {
            id: Uuid::new_v4(),
            organization_id,
            command_type: PUT_EXCEPTION_COMMAND_TYPE.to_owned(),
            idempotency_digest: input.idempotency_digest,
            request_hash: input.request_hash,
            actor: input.actor.clone(),
            correlation_id: Uuid::new_v4(),
        };
        let command = match insert_pending_command(&mut transaction, tenant, &command).await? {
            CommandInsertOutcome::Inserted(command) => command,
            CommandInsertOutcome::Existing(command) => {
                return replay_mutation(transaction, command).await;
            }
        };

        // Match group-command lock ordering: organization -> group -> rule -> occurrence.
        let group_id: Uuid = sqlx::query_scalar(
            "SELECT group_id FROM airhop_lesson_occurrences \
             WHERE community_id = $1 AND organization_id = $2 \
               AND recurrence_rule_id = $3 AND original_date = $4",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(input.recurrence_rule_id)
        .bind(input.original_date)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| DbError::NotFound("AirHub lesson occurrence".to_owned()))?;
        let group_active: bool = sqlx::query_scalar(
            "SELECT status = 'active' FROM airhop_groups \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3 FOR UPDATE",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(group_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| DbError::NotFound("AirHub group".to_owned()))?;
        if !group_active {
            return Err(DbError::AirhopOccurrenceUnavailable);
        }
        let rule_active: bool = sqlx::query_scalar(
            "SELECT status = 'active' FROM airhop_recurrence_rules \
             WHERE community_id = $1 AND organization_id = $2 AND group_id = $3 AND id = $4 \
             FOR UPDATE",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(group_id)
        .bind(input.recurrence_rule_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| DbError::NotFound("AirHub recurrence rule".to_owned()))?;
        if !rule_active {
            return Err(DbError::AirhopOccurrenceUnavailable);
        }
        let occurrence = load_current_occurrence(
            &mut transaction,
            tenant,
            organization_id,
            input.recurrence_rule_id,
            input.original_date,
        )
        .await?;
        if occurrence.group_id != group_id {
            return Err(DbError::InvalidData(
                "AirHub occurrence group changed during lesson mutation".to_owned(),
            ));
        }
        let existing = sqlx::query(
            "SELECT id, organization_id, recurrence_rule_id, original_date, kind, \
                    original_snapshot, override_payload, effective_payload, reason, version, \
                    updated_at \
             FROM airhop_lesson_exceptions \
             WHERE community_id = $1 AND organization_id = $2 \
               AND recurrence_rule_id = $3 AND original_date = $4 FOR UPDATE",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(input.recurrence_rule_id)
        .bind(input.original_date)
        .fetch_optional(&mut *transaction)
        .await?
        .map(parse_exception_row)
        .transpose()?;
        if occurrence.exception_id != existing.as_ref().map(|value| value.id) {
            return Err(DbError::InvalidData(
                "AirHub occurrence and exception projection are inconsistent".to_owned(),
            ));
        }
        match &existing {
            Some(value) if value.version != input.expected_version => {
                return Err(DbError::AirhopVersionConflict)
            }
            None if input.expected_version != 0 => return Err(DbError::AirhopVersionConflict),
            None if matches!(input.change, LessonExceptionChange::Restore) => {
                return Err(DbError::AirhopVersionConflict)
            }
            _ => {}
        }

        let original_snapshot = existing
            .as_ref()
            .map(|value| value.original_snapshot.clone())
            .unwrap_or_else(|| original_snapshot_json(&occurrence));
        let current_version = existing.as_ref().map_or(0, |value| value.version);
        let event_version = current_version + 1;
        let action = input.change.action();
        let reason = clean_optional(input.reason.as_deref());
        let exception_id = match &input.change {
            LessonExceptionChange::Restore => {
                let existing_id = existing
                    .as_ref()
                    .map(|value| value.id)
                    .ok_or(DbError::AirhopVersionConflict)?;
                sqlx::query(
                    "UPDATE airhop_lesson_occurrences \
                     SET exception_id = NULL, source_exception_version = NULL, updated_at = $5 \
                     WHERE community_id = $1 AND organization_id = $2 \
                       AND recurrence_rule_id = $3 AND original_date = $4",
                )
                .bind(tenant.community().as_uuid())
                .bind(organization_id)
                .bind(input.recurrence_rule_id)
                .bind(input.original_date)
                .bind(occurred_at)
                .execute(&mut *transaction)
                .await?;
                sqlx::query(
                    "DELETE FROM airhop_lesson_exceptions \
                     WHERE community_id = $1 AND organization_id = $2 AND id = $3",
                )
                .bind(tenant.community().as_uuid())
                .bind(organization_id)
                .bind(existing_id)
                .execute(&mut *transaction)
                .await?;
                None
            }
            LessonExceptionChange::Cancel => {
                let effective_payload = match existing.as_ref().map(|value| value.kind.as_str()) {
                    Some("override") => Some(effective_payload_json(&occurrence)?),
                    Some("cancelled") => existing
                        .as_ref()
                        .and_then(|value| value.effective_payload.clone()),
                    Some(other) => {
                        return Err(DbError::InvalidData(format!(
                            "unknown AirHub lesson exception kind {other:?}"
                        )))
                    }
                    None => Some(effective_payload_json(&occurrence)?),
                };
                Some(
                    write_exception(
                        &mut transaction,
                        tenant,
                        organization_id,
                        input,
                        existing.as_ref().map(|value| value.id),
                        &original_snapshot,
                        "cancelled",
                        None,
                        effective_payload.as_ref(),
                        reason.as_deref(),
                        occurred_at,
                    )
                    .await?,
                )
            }
            LessonExceptionChange::Override(changes) => {
                let override_payload = override_payload_json(changes)?;
                Some(
                    write_exception(
                        &mut transaction,
                        tenant,
                        organization_id,
                        input,
                        existing.as_ref().map(|value| value.id),
                        &original_snapshot,
                        "override",
                        Some(&override_payload),
                        None,
                        reason.as_deref(),
                        occurred_at,
                    )
                    .await?,
                )
            }
        };

        super::schedule::rematerialize_group_schedule(
            &mut transaction,
            tenant,
            organization_id,
            group_id,
            occurred_at,
        )
        .await?;

        let cancelled_bookings = if matches!(input.change, LessonExceptionChange::Cancel) {
            cancel_active_bookings(
                &mut transaction,
                tenant,
                organization_id,
                input,
                &command,
                occurred_at,
            )
            .await?
        } else {
            0
        };
        append_domain_event(
            &mut transaction,
            tenant,
            &NewDomainEvent {
                id: Uuid::new_v4(),
                organization_id,
                stream_type: "lesson_exception".to_owned(),
                stream_id: existing
                    .as_ref()
                    .map(|value| value.id)
                    .or(exception_id)
                    .ok_or_else(|| {
                        DbError::InvalidData("AirHub lesson exception has no stream id".to_owned())
                    })?,
                stream_version: event_version,
                event_type: match action {
                    LessonExceptionAction::Cancel => "airhop.lesson.cancelled.v1",
                    LessonExceptionAction::Override => "airhop.lesson.overridden.v1",
                    LessonExceptionAction::Restore => "airhop.lesson.restored.v1",
                }
                .to_owned(),
                schema_version: 1,
                occurred_at,
                actor: input.actor.clone(),
                causation_id: command.id,
                correlation_id: command.correlation_id,
                payload: json!({
                    "recurrenceRuleId": input.recurrence_rule_id,
                    "originalDate": input.original_date,
                    "exceptionId": exception_id,
                    "action": action,
                    "reason": reason,
                    "cancelledBookingCount": cancelled_bookings,
                }),
                privacy_class: PrivacyClass::Operational,
            },
        )
        .await?;
        let stored = StoredMutationResult {
            recurrence_rule_id: input.recurrence_rule_id,
            original_date: input.original_date,
            exception_id,
            version: event_version,
            action,
            cancelled_bookings,
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
        Ok(LessonExceptionMutationOutcome {
            recurrence_rule_id: input.recurrence_rule_id,
            original_date: input.original_date,
            exception_id,
            version: event_version,
            action,
            cancelled_bookings,
            replayed: false,
        })
    }
}

async fn load_current_occurrence(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    recurrence_rule_id: Uuid,
    original_date: NaiveDate,
) -> Result<CurrentOccurrence> {
    let row = sqlx::query(
        "SELECT group_id, exception_id, original_start_time, original_end_time, \
                effective_date, start_time, end_time, branch_id, room_id, capacity, \
                trial_policy, allow_single_visits \
         FROM airhop_lesson_occurrences \
         WHERE community_id = $1 AND organization_id = $2 \
           AND recurrence_rule_id = $3 AND original_date = $4 FOR UPDATE",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(recurrence_rule_id)
    .bind(original_date)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or_else(|| DbError::NotFound("AirHub lesson occurrence".to_owned()))?;
    let teacher_ids = sqlx::query_scalar(
        "SELECT teacher.teacher_id FROM airhop_occurrence_teachers teacher \
         JOIN airhop_lesson_occurrences occurrence \
           ON occurrence.community_id = teacher.community_id \
          AND occurrence.organization_id = teacher.organization_id \
          AND occurrence.id = teacher.occurrence_id \
         WHERE occurrence.community_id = $1 AND occurrence.organization_id = $2 \
           AND occurrence.recurrence_rule_id = $3 AND occurrence.original_date = $4 \
         ORDER BY teacher.teacher_id",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(recurrence_rule_id)
    .bind(original_date)
    .fetch_all(&mut **transaction)
    .await?;
    Ok(CurrentOccurrence {
        group_id: row.try_get("group_id")?,
        exception_id: row.try_get("exception_id")?,
        original_start_time: row.try_get("original_start_time")?,
        original_end_time: row.try_get("original_end_time")?,
        effective_date: row.try_get("effective_date")?,
        start_time: row.try_get("start_time")?,
        end_time: row.try_get("end_time")?,
        branch_id: row.try_get("branch_id")?,
        room_id: row.try_get("room_id")?,
        teacher_ids,
        capacity: row.try_get("capacity")?,
        trial_policy: row.try_get("trial_policy")?,
        allow_single_visits: row.try_get("allow_single_visits")?,
    })
}

#[allow(clippy::too_many_arguments)]
async fn write_exception(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    input: &PutLessonExceptionInput,
    existing_id: Option<Uuid>,
    original_snapshot: &Value,
    kind: &str,
    override_payload: Option<&Value>,
    effective_payload: Option<&Value>,
    reason: Option<&str>,
    occurred_at: DateTime<Utc>,
) -> Result<Uuid> {
    if let Some(id) = existing_id {
        sqlx::query(
            "UPDATE airhop_lesson_exceptions \
             SET kind = $4, override_payload = $5, effective_payload = $6, reason = $7, \
                 version = version + 1, updated_at = $8 \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(id)
        .bind(kind)
        .bind(override_payload)
        .bind(effective_payload)
        .bind(reason)
        .bind(occurred_at)
        .execute(&mut **transaction)
        .await?;
        Ok(id)
    } else {
        let id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO airhop_lesson_exceptions (\
                 community_id, organization_id, id, recurrence_rule_id, original_date, kind, \
                 original_snapshot, override_payload, effective_payload, reason, updated_at\
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(id)
        .bind(input.recurrence_rule_id)
        .bind(input.original_date)
        .bind(kind)
        .bind(original_snapshot)
        .bind(override_payload)
        .bind(effective_payload)
        .bind(reason)
        .bind(occurred_at)
        .execute(&mut **transaction)
        .await?;
        Ok(id)
    }
}

async fn cancel_active_bookings(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    input: &PutLessonExceptionInput,
    command: &AirhopCommand,
    occurred_at: DateTime<Utc>,
) -> Result<usize> {
    let rows = sqlx::query(
        "UPDATE airhop_bookings \
         SET status = 'cancelled_by_center', transfer_request = NULL, \
             version = version + 1, updated_at = $5 \
         WHERE community_id = $1 AND organization_id = $2 \
           AND recurrence_rule_id = $3 AND original_date = $4 \
           AND status IN ('pending_confirmation', 'confirmed') \
         RETURNING id, version",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(input.recurrence_rule_id)
    .bind(input.original_date)
    .bind(occurred_at)
    .fetch_all(&mut **transaction)
    .await?;
    for row in &rows {
        let booking_id: Uuid = row.try_get("id")?;
        append_domain_event(
            transaction,
            tenant,
            &NewDomainEvent {
                id: Uuid::new_v4(),
                organization_id,
                stream_type: "booking".to_owned(),
                stream_id: booking_id,
                stream_version: row.try_get("version")?,
                event_type: "airhop.booking.cancelled_by_center.v1".to_owned(),
                schema_version: 1,
                occurred_at,
                actor: input.actor.clone(),
                causation_id: command.id,
                correlation_id: command.correlation_id,
                payload: json!({
                    "bookingId": booking_id,
                    "recurrenceRuleId": input.recurrence_rule_id,
                    "originalDate": input.original_date,
                    "status": "cancelled_by_center",
                }),
                privacy_class: PrivacyClass::Operational,
            },
        )
        .await?;
    }
    Ok(rows.len())
}

fn original_snapshot_json(occurrence: &CurrentOccurrence) -> Value {
    json!({
        "startTime": occurrence.original_start_time.format("%H:%M").to_string(),
        "endTime": occurrence.original_end_time.format("%H:%M").to_string(),
        "branchId": occurrence.branch_id,
        "roomId": occurrence.room_id,
        "teacherIds": occurrence.teacher_ids,
    })
}

fn effective_payload_json(occurrence: &CurrentOccurrence) -> Result<Value> {
    let capacity = occurrence
        .capacity
        .map(u32::try_from)
        .transpose()
        .map_err(|_| DbError::InvalidData("AirHub occurrence capacity is invalid".to_owned()))?;
    Ok(json!({
        "date": occurrence.effective_date,
        "startTime": occurrence.start_time.format("%H:%M").to_string(),
        "endTime": occurrence.end_time.format("%H:%M").to_string(),
        "branchId": occurrence.branch_id,
        "roomId": occurrence.room_id,
        "teacherIds": occurrence.teacher_ids,
        "capacity": capacity,
        "trialPolicy": occurrence.trial_policy,
        "allowSingleVisits": occurrence.allow_single_visits,
    }))
}

fn override_payload_json(changes: &OccurrenceOverride) -> Result<Value> {
    if changes == &OccurrenceOverride::default() {
        return Err(DbError::InvalidData(
            "AirHub lesson override must change at least one field".to_owned(),
        ));
    }
    let mut object = Map::new();
    insert_optional(&mut object, "date", changes.date)?;
    insert_optional(
        &mut object,
        "startTime",
        changes
            .start_time
            .map(|value| value.format("%H:%M").to_string()),
    )?;
    insert_optional(
        &mut object,
        "endTime",
        changes
            .end_time
            .map(|value| value.format("%H:%M").to_string()),
    )?;
    insert_optional(&mut object, "branchId", changes.branch_id)?;
    insert_nullable_override(&mut object, "roomId", &changes.room_id)?;
    insert_optional(&mut object, "teacherIds", changes.teacher_ids.as_ref())?;
    insert_nullable_override(&mut object, "capacity", &changes.capacity)?;
    insert_optional(&mut object, "trialPolicy", changes.trial_policy.as_ref())?;
    insert_optional(
        &mut object,
        "allowSingleVisits",
        changes.allow_single_visits,
    )?;
    Ok(Value::Object(object))
}

fn insert_optional<T: Serialize>(
    object: &mut Map<String, Value>,
    field: &str,
    value: Option<T>,
) -> Result<()> {
    if let Some(value) = value {
        object.insert(field.to_owned(), serde_json::to_value(value)?);
    }
    Ok(())
}

fn insert_nullable_override<T: Serialize>(
    object: &mut Map<String, Value>,
    field: &str,
    value: &NullableOverride<T>,
) -> Result<()> {
    match value {
        NullableOverride::Inherit => {}
        NullableOverride::Clear => {
            object.insert(field.to_owned(), Value::Null);
        }
        NullableOverride::Set(value) => {
            object.insert(field.to_owned(), serde_json::to_value(value)?);
        }
    }
    Ok(())
}

fn parse_exception_row(row: sqlx::postgres::PgRow) -> Result<AirhopLessonException> {
    Ok(AirhopLessonException {
        id: row.try_get("id")?,
        organization_id: row.try_get("organization_id")?,
        recurrence_rule_id: row.try_get("recurrence_rule_id")?,
        original_date: row.try_get("original_date")?,
        kind: row.try_get("kind")?,
        original_snapshot: row.try_get("original_snapshot")?,
        override_payload: row.try_get("override_payload")?,
        effective_payload: row.try_get("effective_payload")?,
        reason: row.try_get("reason")?,
        version: row.try_get("version")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn validate_input(input: &PutLessonExceptionInput) -> Result<()> {
    input.actor.validate()?;
    if input.recurrence_rule_id.is_nil() || input.expected_version < 0 {
        return Err(DbError::InvalidData(
            "AirHub lesson mutation identity or version is invalid".to_owned(),
        ));
    }
    if input
        .reason
        .as_ref()
        .is_some_and(|value| value.chars().count() > 1_000)
    {
        return Err(DbError::InvalidData(
            "AirHub lesson mutation reason is too long".to_owned(),
        ));
    }
    if let LessonExceptionChange::Override(changes) = &input.change {
        let teacher_ids = changes.teacher_ids.as_ref().map(|values| {
            values
                .iter()
                .copied()
                .collect::<std::collections::BTreeSet<_>>()
        });
        if teacher_ids
            .as_ref()
            .is_some_and(|values| values.len() != changes.teacher_ids.as_ref().map_or(0, Vec::len))
        {
            return Err(DbError::InvalidData(
                "AirHub lesson override teachers must be unique".to_owned(),
            ));
        }
        if changes
            .teacher_ids
            .as_ref()
            .is_some_and(|values| values.iter().any(Uuid::is_nil))
            || changes.branch_id.is_some_and(|value| value.is_nil())
            || matches!(&changes.room_id, NullableOverride::Set(value) if value.is_nil())
        {
            return Err(DbError::InvalidData(
                "AirHub lesson override contains a nil identifier".to_owned(),
            ));
        }
        if matches!(&changes.capacity, NullableOverride::Set(0)) {
            return Err(DbError::InvalidData(
                "AirHub lesson override capacity must be positive".to_owned(),
            ));
        }
    }
    Ok(())
}

fn clean_optional(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

async fn replay_mutation(
    transaction: sqlx::Transaction<'_, sqlx::Postgres>,
    command: AirhopCommand,
) -> Result<LessonExceptionMutationOutcome> {
    match command.status {
        CommandStatus::Pending => Err(DbError::AirhopCommandInProgress),
        CommandStatus::Failed => Err(DbError::AirhopCommandPreviouslyFailed),
        CommandStatus::Committed => {
            let stored: StoredMutationResult =
                serde_json::from_value(command.result.ok_or_else(|| {
                    DbError::InvalidData("committed AirHub command has no result".to_owned())
                })?)?;
            transaction.commit().await?;
            Ok(LessonExceptionMutationOutcome {
                recurrence_rule_id: stored.recurrence_rule_id,
                original_date: stored.original_date,
                exception_id: stored.exception_id,
                version: stored.version,
                action: stored.action,
                cancelled_bookings: stored.cancelled_bookings,
                replayed: true,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn override_payload_preserves_inherit_clear_and_set() {
        let changes = OccurrenceOverride {
            room_id: NullableOverride::Clear,
            capacity: NullableOverride::Set(12),
            trial_policy: Some(airhop_core::TrialPolicy::Free),
            ..OccurrenceOverride::default()
        };
        let payload = override_payload_json(&changes).expect("serialize override");
        assert_eq!(payload["roomId"], Value::Null);
        assert_eq!(payload["capacity"], json!(12));
        assert_eq!(payload["trialPolicy"]["mode"], "free");
        assert!(payload.get("date").is_none());
    }

    #[test]
    fn empty_override_is_rejected() {
        assert!(override_payload_json(&OccurrenceOverride::default()).is_err());
    }
}
