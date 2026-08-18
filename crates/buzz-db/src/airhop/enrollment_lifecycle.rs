//! Optimistic lifecycle and tariff commands for permanent enrollments.

use buzz_core::TenantContext;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

use super::{
    append_domain_event, commit_command, insert_pending_command, AirhopActor, AirhopCommand,
    CommandInsertOutcome, CommandStatus, NewAirhopCommand, NewDomainEvent, PrivacyClass,
};
use crate::{Db, DbError, Result};

const MUTATE_ENROLLMENT_COMMAND_TYPE: &str = "MutateEnrollment";

/// Explicit mutation accepted by a permanent enrollment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EnrollmentChange {
    /// Stop future participation and payment materialization until resumed.
    Pause,
    /// Return a paused enrollment to active service without backfilling paused months.
    Resume,
    /// Permanently finish an active or paused enrollment on the organization-local date.
    End,
    /// Use another active tariff for payment expectations that do not exist yet.
    ChangeTariff {
        /// Replacement tariff.
        tariff_id: Uuid,
    },
}

/// Idempotent optimistic command for one enrollment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MutateEnrollmentInput {
    /// Enrollment selected by the authenticated path.
    pub enrollment_id: Uuid,
    /// Version observed by the staff client.
    pub expected_version: i64,
    /// Explicit desired mutation.
    pub change: EnrollmentChange,
    /// Keyed digest of the HTTP idempotency key.
    pub idempotency_digest: [u8; 32],
    /// Canonical method/path/body request hash.
    pub request_hash: [u8; 32],
    /// Verified staff attribution.
    pub actor: AirhopActor,
}

/// Result of applying or replaying an enrollment mutation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EnrollmentMutationOutcome {
    /// Affected enrollment.
    pub enrollment_id: Uuid,
    /// New optimistic version.
    pub version: i64,
    /// True when an existing committed command was replayed.
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredEnrollmentMutationResult {
    enrollment_id: Uuid,
    version: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum EnrollmentStatus {
    Active,
    Paused,
    Ended,
}

impl EnrollmentStatus {
    fn from_db(value: &str) -> Result<Self> {
        match value {
            "active" => Ok(Self::Active),
            "paused" => Ok(Self::Paused),
            "ended" => Ok(Self::Ended),
            other => Err(DbError::InvalidData(format!(
                "unknown AirHub enrollment status {other:?}"
            ))),
        }
    }
}

#[derive(Debug)]
struct LockedEnrollment {
    status: EnrollmentStatus,
    tariff_id: Option<Uuid>,
    start_date: NaiveDate,
    current_date: NaiveDate,
    schedule_count: i64,
    assignment_state: String,
    version: i64,
}

impl Db {
    /// Mutates one enrollment, its immutable audit event, and command receipt atomically.
    pub async fn mutate_airhop_enrollment(
        &self,
        tenant: &TenantContext,
        input: &MutateEnrollmentInput,
    ) -> Result<EnrollmentMutationOutcome> {
        validate_input(input)?;
        input.actor.validate()?;
        let mut transaction = self.pool.begin().await?;
        let organization_id: Uuid = sqlx::query_scalar(
            "SELECT id FROM airhop_organizations \
             WHERE community_id = $1 AND status = 'active'",
        )
        .bind(tenant.community().as_uuid())
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| DbError::NotFound("active AirHub organization".to_owned()))?;
        let command = match insert_pending_command(
            &mut transaction,
            tenant,
            &NewAirhopCommand {
                id: Uuid::new_v4(),
                organization_id,
                command_type: MUTATE_ENROLLMENT_COMMAND_TYPE.to_owned(),
                idempotency_digest: input.idempotency_digest,
                request_hash: input.request_hash,
                actor: input.actor.clone(),
                correlation_id: Uuid::new_v4(),
            },
        )
        .await?
        {
            CommandInsertOutcome::Inserted(command) => command,
            CommandInsertOutcome::Existing(command) => {
                return replay_mutation(transaction, command).await;
            }
        };
        let row = sqlx::query(
            "SELECT enrollment.status, enrollment.tariff_id, enrollment.start_date, \
                    enrollment.assignment_state, enrollment.version, \
                    (now() AT TIME ZONE organization.time_zone)::date AS current_date, \
                    (SELECT COUNT(*) FROM airhop_enrollment_schedule schedule \
                     WHERE schedule.community_id = enrollment.community_id \
                       AND schedule.organization_id = enrollment.organization_id \
                       AND schedule.enrollment_id = enrollment.id) AS schedule_count \
             FROM airhop_enrollments enrollment \
             JOIN airhop_organizations organization \
               ON organization.community_id = enrollment.community_id \
              AND organization.id = enrollment.organization_id \
             WHERE enrollment.community_id = $1 AND enrollment.organization_id = $2 \
               AND enrollment.id = $3 FOR UPDATE OF enrollment",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(input.enrollment_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| DbError::NotFound("AirHub enrollment".to_owned()))?;
        let current = LockedEnrollment {
            status: EnrollmentStatus::from_db(row.try_get("status")?)?,
            tariff_id: row.try_get("tariff_id")?,
            start_date: row.try_get("start_date")?,
            current_date: row.try_get("current_date")?,
            schedule_count: row.try_get("schedule_count")?,
            assignment_state: row.try_get("assignment_state")?,
            version: row.try_get("version")?,
        };
        if current.version != input.expected_version {
            return Err(DbError::AirhopVersionConflict);
        }
        validate_transition(
            &mut transaction,
            tenant,
            organization_id,
            &current,
            &input.change,
        )
        .await?;
        let occurred_at: DateTime<Utc> = sqlx::query_scalar("SELECT now()")
            .fetch_one(&mut *transaction)
            .await?;
        let version = apply_change(
            &mut transaction,
            tenant,
            organization_id,
            input,
            &current,
            occurred_at,
        )
        .await?;
        let (event_type, payload) = event_for_change(input.enrollment_id, &current, &input.change);
        append_domain_event(
            &mut transaction,
            tenant,
            &NewDomainEvent {
                id: Uuid::new_v4(),
                organization_id,
                stream_type: "enrollment".to_owned(),
                stream_id: input.enrollment_id,
                stream_version: version,
                event_type: event_type.to_owned(),
                schema_version: 1,
                occurred_at,
                actor: input.actor.clone(),
                causation_id: command.id,
                correlation_id: command.correlation_id,
                payload,
                privacy_class: PrivacyClass::Operational,
            },
        )
        .await?;
        let stored = StoredEnrollmentMutationResult {
            enrollment_id: input.enrollment_id,
            version,
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
        Ok(EnrollmentMutationOutcome {
            enrollment_id: stored.enrollment_id,
            version: stored.version,
            replayed: false,
        })
    }
}

async fn validate_transition(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    current: &LockedEnrollment,
    change: &EnrollmentChange,
) -> Result<()> {
    match change {
        EnrollmentChange::Pause if current.status == EnrollmentStatus::Active => Ok(()),
        EnrollmentChange::Resume if current.status == EnrollmentStatus::Paused => Ok(()),
        EnrollmentChange::End
            if matches!(
                current.status,
                EnrollmentStatus::Active | EnrollmentStatus::Paused
            ) =>
        {
            Ok(())
        }
        EnrollmentChange::ChangeTariff { tariff_id }
            if matches!(
                current.status,
                EnrollmentStatus::Active | EnrollmentStatus::Paused
            ) && current.assignment_state == "configured"
                && current.tariff_id != Some(*tariff_id) =>
        {
            let limit: Option<i16> = sqlx::query_scalar(
                "SELECT weekly_schedule_limit FROM airhop_tariffs \
                 WHERE community_id = $1 AND organization_id = $2 AND id = $3 \
                   AND status = 'active'",
            )
            .bind(tenant.community().as_uuid())
            .bind(organization_id)
            .bind(tariff_id)
            .fetch_optional(&mut **transaction)
            .await?;
            match limit {
                Some(limit) if current.schedule_count <= i64::from(limit) => Ok(()),
                Some(_) => Err(DbError::AirhopEnrollmentScheduleInvalid),
                None => Err(DbError::AirhopTariffUnavailable),
            }
        }
        _ => Err(DbError::AirhopEnrollmentTransition),
    }
}

async fn apply_change(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    input: &MutateEnrollmentInput,
    current: &LockedEnrollment,
    occurred_at: DateTime<Utc>,
) -> Result<i64> {
    let community_id = *tenant.community().as_uuid();
    let query = match input.change {
        EnrollmentChange::Pause => sqlx::query_scalar(
            "UPDATE airhop_enrollments SET status = 'paused', \
                 version = version + 1, updated_at = $5 \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3 AND version = $4 \
             RETURNING version",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(input.enrollment_id)
        .bind(input.expected_version)
        .bind(occurred_at),
        EnrollmentChange::Resume => sqlx::query_scalar(
            "UPDATE airhop_enrollments SET status = 'active', end_date = NULL, \
                 payment_generation_from = GREATEST(start_date, $5), \
                 version = version + 1, updated_at = $6 \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3 AND version = $4 \
             RETURNING version",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(input.enrollment_id)
        .bind(input.expected_version)
        .bind(current.current_date)
        .bind(occurred_at),
        EnrollmentChange::End => sqlx::query_scalar(
            "UPDATE airhop_enrollments SET status = 'ended', \
                 end_date = GREATEST(start_date, $5), \
                 version = version + 1, updated_at = $6 \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3 AND version = $4 \
             RETURNING version",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(input.enrollment_id)
        .bind(input.expected_version)
        .bind(current.current_date)
        .bind(occurred_at),
        EnrollmentChange::ChangeTariff { tariff_id } => sqlx::query_scalar(
            "UPDATE airhop_enrollments SET tariff_id = $5, \
                 version = version + 1, updated_at = $6 \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3 AND version = $4 \
             RETURNING version",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(input.enrollment_id)
        .bind(input.expected_version)
        .bind(tariff_id)
        .bind(occurred_at),
    };
    query
        .fetch_optional(&mut **transaction)
        .await?
        .ok_or(DbError::AirhopVersionConflict)
}

fn event_for_change(
    enrollment_id: Uuid,
    current: &LockedEnrollment,
    change: &EnrollmentChange,
) -> (&'static str, serde_json::Value) {
    match change {
        EnrollmentChange::Pause => (
            "airhop.enrollment.paused.v1",
            json!({ "enrollmentId": enrollment_id, "previousStatus": current.status }),
        ),
        EnrollmentChange::Resume => (
            "airhop.enrollment.resumed.v1",
            json!({
                "enrollmentId": enrollment_id,
                "previousStatus": current.status,
                "paymentGenerationFrom": current.current_date.max(current.start_date),
            }),
        ),
        EnrollmentChange::End => (
            "airhop.enrollment.ended.v1",
            json!({
                "enrollmentId": enrollment_id,
                "previousStatus": current.status,
                "endDate": current.current_date.max(current.start_date),
            }),
        ),
        EnrollmentChange::ChangeTariff { tariff_id } => (
            "airhop.enrollment.tariff_changed.v1",
            json!({
                "enrollmentId": enrollment_id,
                "previousTariffId": current.tariff_id,
                "tariffId": tariff_id,
            }),
        ),
    }
}

fn validate_input(input: &MutateEnrollmentInput) -> Result<()> {
    if input.enrollment_id.is_nil() || input.expected_version <= 0 {
        return Err(DbError::InvalidData(
            "AirHub enrollment identity or version is invalid".to_owned(),
        ));
    }
    if matches!(input.change, EnrollmentChange::ChangeTariff { tariff_id } if tariff_id.is_nil()) {
        return Err(DbError::InvalidData(
            "AirHub tariff identity is invalid".to_owned(),
        ));
    }
    Ok(())
}

async fn replay_mutation(
    transaction: sqlx::Transaction<'_, sqlx::Postgres>,
    command: AirhopCommand,
) -> Result<EnrollmentMutationOutcome> {
    match command.status {
        CommandStatus::Pending => Err(DbError::AirhopCommandInProgress),
        CommandStatus::Failed => Err(DbError::AirhopCommandPreviouslyFailed),
        CommandStatus::Committed => {
            let stored: StoredEnrollmentMutationResult =
                serde_json::from_value(command.result.ok_or_else(|| {
                    DbError::InvalidData("committed AirHub command has no result".to_owned())
                })?)?;
            transaction.commit().await?;
            Ok(EnrollmentMutationOutcome {
                enrollment_id: stored.enrollment_id,
                version: stored.version,
                replayed: true,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_requires_identity_version_and_tariff() {
        let input = MutateEnrollmentInput {
            enrollment_id: Uuid::nil(),
            expected_version: 0,
            change: EnrollmentChange::ChangeTariff {
                tariff_id: Uuid::nil(),
            },
            idempotency_digest: [1; 32],
            request_hash: [2; 32],
            actor: AirhopActor {
                kind: super::super::ActorKind::Staff,
                pubkey: Some([3; 32]),
                on_behalf_of_pubkey: None,
                agent_pubkey: None,
            },
        };
        assert!(validate_input(&input).is_err());
    }
}
