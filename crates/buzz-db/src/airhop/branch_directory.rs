//! Authoritative AirHub branch directory and audited staff commands.

use std::collections::BTreeMap;

use airhop_core::Weekday;
use buzz_core::TenantContext;
use chrono::{DateTime, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use super::{
    append_domain_event, commit_command, insert_pending_command, ActorKind, AirhopActor,
    AirhopCommand, CommandInsertOutcome, CommandStatus, NewAirhopCommand, NewDomainEvent,
    PrivacyClass,
};
use crate::{Db, DbError, Result};

const CREATE_BRANCH_COMMAND_TYPE: &str = "CreateBranch";
const PUT_BRANCH_COMMAND_TYPE: &str = "PutBranch";
const MAX_WORKING_PERIODS: usize = 64;

/// Lifecycle of an operational branch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BranchStatus {
    /// Available for new groups, schedules, and public booking.
    Active,
    /// Retained for history but unavailable for new operational assignments.
    Archived,
}

impl BranchStatus {
    const fn as_db_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Archived => "archived",
        }
    }

    fn from_db(value: &str) -> Result<Self> {
        match value {
            "active" => Ok(Self::Active),
            "archived" => Ok(Self::Archived),
            other => Err(DbError::InvalidData(format!(
                "unknown AirHub branch status {other:?}"
            ))),
        }
    }
}

/// One local-time working period for a branch weekday.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchWorkingPeriod {
    /// Weekday containing this period.
    pub weekday: Weekday,
    /// Inclusive local opening time.
    pub start_time: NaiveTime,
    /// Exclusive local closing time.
    pub end_time: NaiveTime,
}

/// Server-authoritative branch projection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AirhopBranch {
    /// Server-owned branch identifier.
    pub id: Uuid,
    /// Server-resolved organization identifier.
    pub organization_id: Uuid,
    /// Human-readable branch name.
    pub name: String,
    /// Public postal or free-form address.
    pub address: String,
    /// Weekly local opening periods.
    pub working_hours: BTreeMap<Weekday, Vec<BranchWorkingPeriod>>,
    /// Optional private Buzz work channel in the same community.
    pub default_buzz_channel_id: Option<Uuid>,
    /// Operational lifecycle.
    pub status: BranchStatus,
    /// Optimistic entity version.
    pub version: i64,
    /// Creation instant.
    pub created_at: DateTime<Utc>,
    /// Last update instant.
    pub updated_at: DateTime<Utc>,
}

/// Idempotent input for creating a branch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateBranchInput {
    /// Human-readable branch name.
    pub name: String,
    /// Public postal or free-form address.
    pub address: String,
    /// Weekly local opening periods.
    pub working_periods: Vec<BranchWorkingPeriod>,
    /// Optional Buzz work channel selected in the same community.
    pub default_buzz_channel_id: Option<Uuid>,
    /// Keyed digest of the HTTP idempotency key.
    pub idempotency_digest: [u8; 32],
    /// Hash of method, path, and canonical HTTP body.
    pub request_hash: [u8; 32],
    /// Verified staff attribution.
    pub actor: AirhopActor,
}

/// Full optimistic replacement of one branch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PutBranchInput {
    /// Branch selected by the authenticated request path.
    pub branch_id: Uuid,
    /// Version observed by the staff client.
    pub expected_version: i64,
    /// Human-readable branch name.
    pub name: String,
    /// Public postal or free-form address.
    pub address: String,
    /// Weekly local opening periods.
    pub working_periods: Vec<BranchWorkingPeriod>,
    /// Optional Buzz work channel selected in the same community.
    pub default_buzz_channel_id: Option<Uuid>,
    /// Desired operational lifecycle.
    pub status: BranchStatus,
    /// Keyed digest of the HTTP idempotency key.
    pub idempotency_digest: [u8; 32],
    /// Hash of method, path, and canonical HTTP body.
    pub request_hash: [u8; 32],
    /// Verified staff attribution.
    pub actor: AirhopActor,
}

/// Result of a create, update, archive, or restore command.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BranchMutationOutcome {
    /// Affected branch.
    pub branch_id: Uuid,
    /// New or replayed optimistic version.
    pub version: i64,
    /// True when an existing committed command receipt was replayed.
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredBranchMutationResult {
    branch_id: Uuid,
    version: i64,
}

impl Db {
    /// Lists all active and archived branches for the host-resolved tenant.
    pub async fn list_airhop_branches(&self, tenant: &TenantContext) -> Result<Vec<AirhopBranch>> {
        let organization_id = resolve_active_organization(&self.pool, tenant).await?;
        let rows = sqlx::query(
            "SELECT id, organization_id, name, address, default_buzz_channel_id, \
                    status, version, created_at, updated_at \
             FROM airhop_branches \
             WHERE community_id = $1 AND organization_id = $2 \
             ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, lower(name), id",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .fetch_all(&self.pool)
        .await?;
        let mut branches = rows
            .into_iter()
            .map(parse_branch_row)
            .collect::<Result<Vec<_>>>()?;
        let periods = sqlx::query(
            "SELECT branch_id, weekday, start_time, end_time \
             FROM airhop_branch_working_periods \
             WHERE community_id = $1 AND organization_id = $2 \
             ORDER BY branch_id, weekday, ordinal",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .fetch_all(&self.pool)
        .await?;
        let positions = branches
            .iter()
            .enumerate()
            .map(|(index, branch)| (branch.id, index))
            .collect::<BTreeMap<_, _>>();
        for row in periods {
            let branch_id: Uuid = row.try_get("branch_id")?;
            let index = positions.get(&branch_id).ok_or_else(|| {
                DbError::InvalidData("AirHub branch working period has no branch".to_owned())
            })?;
            let weekday = parse_weekday(row.try_get("weekday")?)?;
            branches[*index]
                .working_hours
                .entry(weekday)
                .or_default()
                .push(BranchWorkingPeriod {
                    weekday,
                    start_time: row.try_get("start_time")?,
                    end_time: row.try_get("end_time")?,
                });
        }
        Ok(branches)
    }

    /// Creates a branch, working periods, audit event, and command receipt atomically.
    pub async fn create_airhop_branch(
        &self,
        tenant: &TenantContext,
        input: &CreateBranchInput,
    ) -> Result<BranchMutationOutcome> {
        validate_create_input(input)?;
        let mut transaction = self.pool.begin().await?;
        let organization_id = resolve_active_organization(&mut *transaction, tenant).await?;
        validate_channel(&mut transaction, tenant, input.default_buzz_channel_id).await?;
        let command = match insert_pending_command(
            &mut transaction,
            tenant,
            &NewAirhopCommand {
                id: Uuid::new_v4(),
                organization_id,
                command_type: CREATE_BRANCH_COMMAND_TYPE.to_owned(),
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
        let branch_id = Uuid::new_v4();
        let occurred_at: DateTime<Utc> = sqlx::query_scalar("SELECT now()")
            .fetch_one(&mut *transaction)
            .await?;
        sqlx::query(
            "INSERT INTO airhop_branches (\
                 community_id, organization_id, id, name, address, \
                 default_buzz_channel_id, created_at, updated_at\
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(branch_id)
        .bind(input.name.trim())
        .bind(input.address.trim())
        .bind(input.default_buzz_channel_id)
        .bind(occurred_at)
        .execute(&mut *transaction)
        .await?;
        replace_working_periods(
            &mut transaction,
            tenant,
            organization_id,
            branch_id,
            &input.working_periods,
        )
        .await?;
        append_domain_event(
            &mut transaction,
            tenant,
            &NewDomainEvent {
                id: Uuid::new_v4(),
                organization_id,
                stream_type: "branch".to_owned(),
                stream_id: branch_id,
                stream_version: 1,
                event_type: "airhop.branch.created.v1".to_owned(),
                schema_version: 1,
                occurred_at,
                actor: input.actor.clone(),
                causation_id: command.id,
                correlation_id: command.correlation_id,
                payload: json!({
                    "branchId": branch_id,
                    "defaultBuzzChannelId": input.default_buzz_channel_id,
                    "workingPeriodCount": input.working_periods.len(),
                }),
                privacy_class: PrivacyClass::Operational,
            },
        )
        .await?;
        finish_mutation(
            transaction,
            tenant,
            organization_id,
            command.id,
            branch_id,
            1,
        )
        .await
    }

    /// Replaces one branch with optimistic concurrency and immutable audit.
    pub async fn put_airhop_branch(
        &self,
        tenant: &TenantContext,
        input: &PutBranchInput,
    ) -> Result<BranchMutationOutcome> {
        validate_put_input(input)?;
        let mut transaction = self.pool.begin().await?;
        let organization_id = resolve_active_organization(&mut *transaction, tenant).await?;
        validate_channel(&mut transaction, tenant, input.default_buzz_channel_id).await?;
        let command = match insert_pending_command(
            &mut transaction,
            tenant,
            &NewAirhopCommand {
                id: Uuid::new_v4(),
                organization_id,
                command_type: PUT_BRANCH_COMMAND_TYPE.to_owned(),
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
        let current_status: String = sqlx::query_scalar(
            "SELECT status \
             FROM airhop_branches \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3 \
             FOR UPDATE",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(input.branch_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| DbError::NotFound("AirHub branch".to_owned()))?;
        let current_status = BranchStatus::from_db(&current_status)?;
        let occurred_at: DateTime<Utc> = sqlx::query_scalar("SELECT now()")
            .fetch_one(&mut *transaction)
            .await?;
        let version: i64 = sqlx::query_scalar(
            "UPDATE airhop_branches \
             SET name = $4, address = $5, default_buzz_channel_id = $6, status = $7, \
                 version = version + 1, updated_at = $8 \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3 \
               AND version = $9 \
             RETURNING version",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(input.branch_id)
        .bind(input.name.trim())
        .bind(input.address.trim())
        .bind(input.default_buzz_channel_id)
        .bind(input.status.as_db_str())
        .bind(occurred_at)
        .bind(input.expected_version)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(DbError::AirhopVersionConflict)?;
        replace_working_periods(
            &mut transaction,
            tenant,
            organization_id,
            input.branch_id,
            &input.working_periods,
        )
        .await?;
        let event_type = match (current_status, input.status) {
            (BranchStatus::Active, BranchStatus::Archived) => "airhop.branch.archived.v1",
            (BranchStatus::Archived, BranchStatus::Active) => "airhop.branch.restored.v1",
            _ => "airhop.branch.updated.v1",
        };
        append_domain_event(
            &mut transaction,
            tenant,
            &NewDomainEvent {
                id: Uuid::new_v4(),
                organization_id,
                stream_type: "branch".to_owned(),
                stream_id: input.branch_id,
                stream_version: version,
                event_type: event_type.to_owned(),
                schema_version: 1,
                occurred_at,
                actor: input.actor.clone(),
                causation_id: command.id,
                correlation_id: command.correlation_id,
                payload: json!({
                    "branchId": input.branch_id,
                    "status": input.status,
                    "defaultBuzzChannelId": input.default_buzz_channel_id,
                    "workingPeriodCount": input.working_periods.len(),
                }),
                privacy_class: PrivacyClass::Operational,
            },
        )
        .await?;
        finish_mutation(
            transaction,
            tenant,
            organization_id,
            command.id,
            input.branch_id,
            version,
        )
        .await
    }
}

/// Executes the normal branch creation service inside a caller-owned transaction.
pub(super) async fn create_airhop_branch_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    input: &CreateBranchInput,
) -> Result<BranchMutationOutcome> {
    validate_agent_create_input(input)?;
    let organization_id = resolve_active_organization(&mut **transaction, tenant).await?;
    validate_channel(transaction, tenant, input.default_buzz_channel_id).await?;
    let command = match insert_pending_command(
        transaction,
        tenant,
        &NewAirhopCommand {
            id: Uuid::new_v4(),
            organization_id,
            command_type: CREATE_BRANCH_COMMAND_TYPE.to_owned(),
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
            return replay_mutation_without_commit(command);
        }
    };
    let branch_id = Uuid::new_v4();
    let occurred_at: DateTime<Utc> = sqlx::query_scalar("SELECT now()")
        .fetch_one(&mut **transaction)
        .await?;
    sqlx::query(
        "INSERT INTO airhop_branches (\
             community_id, organization_id, id, name, address, \
             default_buzz_channel_id, created_at, updated_at\
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(branch_id)
    .bind(input.name.trim())
    .bind(input.address.trim())
    .bind(input.default_buzz_channel_id)
    .bind(occurred_at)
    .execute(&mut **transaction)
    .await?;
    replace_working_periods(
        transaction,
        tenant,
        organization_id,
        branch_id,
        &input.working_periods,
    )
    .await?;
    append_domain_event(
        transaction,
        tenant,
        &NewDomainEvent {
            id: Uuid::new_v4(),
            organization_id,
            stream_type: "branch".to_owned(),
            stream_id: branch_id,
            stream_version: 1,
            event_type: "airhop.branch.created.v1".to_owned(),
            schema_version: 1,
            occurred_at,
            actor: input.actor.clone(),
            causation_id: command.id,
            correlation_id: command.correlation_id,
            payload: json!({
                "branchId": branch_id,
                "defaultBuzzChannelId": input.default_buzz_channel_id,
                "workingPeriodCount": input.working_periods.len(),
            }),
            privacy_class: PrivacyClass::Operational,
        },
    )
    .await?;
    let stored = StoredBranchMutationResult {
        branch_id,
        version: 1,
    };
    commit_command(
        transaction,
        tenant,
        organization_id,
        command.id,
        &serde_json::to_value(&stored)?,
    )
    .await?;
    Ok(BranchMutationOutcome {
        branch_id,
        version: 1,
        replayed: false,
    })
}

fn replay_mutation_without_commit(command: AirhopCommand) -> Result<BranchMutationOutcome> {
    match command.status {
        CommandStatus::Pending => Err(DbError::AirhopCommandInProgress),
        CommandStatus::Failed => Err(DbError::AirhopCommandPreviouslyFailed),
        CommandStatus::Committed => {
            let stored: StoredBranchMutationResult =
                serde_json::from_value(command.result.ok_or_else(|| {
                    DbError::InvalidData("committed AirHub command has no result".to_owned())
                })?)?;
            Ok(BranchMutationOutcome {
                branch_id: stored.branch_id,
                version: stored.version,
                replayed: true,
            })
        }
    }
}

async fn resolve_active_organization<'e, E>(executor: E, tenant: &TenantContext) -> Result<Uuid>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query_scalar(
        "SELECT id FROM airhop_organizations \
         WHERE community_id = $1 AND status = 'active'",
    )
    .bind(tenant.community().as_uuid())
    .fetch_optional(executor)
    .await?
    .ok_or_else(|| DbError::NotFound("active AirHub organization".to_owned()))
}

async fn validate_channel(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: &TenantContext,
    channel_id: Option<Uuid>,
) -> Result<()> {
    let Some(channel_id) = channel_id else {
        return Ok(());
    };
    let channel_type: Option<String> = sqlx::query_scalar(
        "SELECT channel_type::text FROM channels \
         WHERE community_id = $1 AND id = $2 \
           AND deleted_at IS NULL AND archived_at IS NULL \
         FOR SHARE",
    )
    .bind(tenant.community().as_uuid())
    .bind(channel_id)
    .fetch_optional(&mut **transaction)
    .await?;
    if channel_type.as_deref() == Some("stream") {
        Ok(())
    } else {
        Err(DbError::NotFound("active Buzz work channel".to_owned()))
    }
}

async fn replace_working_periods(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    branch_id: Uuid,
    periods: &[BranchWorkingPeriod],
) -> Result<()> {
    sqlx::query(
        "DELETE FROM airhop_branch_working_periods \
         WHERE community_id = $1 AND organization_id = $2 AND branch_id = $3",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(branch_id)
    .execute(&mut **transaction)
    .await?;
    let mut ordinals = BTreeMap::<Weekday, i16>::new();
    for period in periods {
        let ordinal = ordinals.entry(period.weekday).or_default();
        sqlx::query(
            "INSERT INTO airhop_branch_working_periods (\
                 community_id, organization_id, branch_id, weekday, ordinal, \
                 start_time, end_time\
             ) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(branch_id)
        .bind(weekday_str(period.weekday))
        .bind(*ordinal)
        .bind(period.start_time)
        .bind(period.end_time)
        .execute(&mut **transaction)
        .await?;
        *ordinal += 1;
    }
    Ok(())
}

async fn finish_mutation(
    mut transaction: sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    command_id: Uuid,
    branch_id: Uuid,
    version: i64,
) -> Result<BranchMutationOutcome> {
    let stored = StoredBranchMutationResult { branch_id, version };
    commit_command(
        &mut transaction,
        tenant,
        organization_id,
        command_id,
        &serde_json::to_value(&stored)?,
    )
    .await?;
    transaction.commit().await?;
    Ok(BranchMutationOutcome {
        branch_id,
        version,
        replayed: false,
    })
}

async fn replay_mutation(
    transaction: sqlx::Transaction<'_, sqlx::Postgres>,
    command: AirhopCommand,
) -> Result<BranchMutationOutcome> {
    match command.status {
        CommandStatus::Pending => Err(DbError::AirhopCommandInProgress),
        CommandStatus::Failed => Err(DbError::AirhopCommandPreviouslyFailed),
        CommandStatus::Committed => {
            let stored: StoredBranchMutationResult =
                serde_json::from_value(command.result.ok_or_else(|| {
                    DbError::InvalidData("committed AirHub command has no result".to_owned())
                })?)?;
            transaction.commit().await?;
            Ok(BranchMutationOutcome {
                branch_id: stored.branch_id,
                version: stored.version,
                replayed: true,
            })
        }
    }
}

fn parse_branch_row(row: sqlx::postgres::PgRow) -> Result<AirhopBranch> {
    Ok(AirhopBranch {
        id: row.try_get("id")?,
        organization_id: row.try_get("organization_id")?,
        name: row.try_get("name")?,
        address: row.try_get("address")?,
        working_hours: all_weekdays()
            .into_iter()
            .map(|weekday| (weekday, Vec::new()))
            .collect(),
        default_buzz_channel_id: row.try_get("default_buzz_channel_id")?,
        status: BranchStatus::from_db(row.try_get("status")?)?,
        version: row.try_get("version")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn validate_create_input(input: &CreateBranchInput) -> Result<()> {
    validate_create_input_for_actor(input, false)
}

fn validate_agent_create_input(input: &CreateBranchInput) -> Result<()> {
    validate_create_input_for_actor(input, true)
}

fn validate_create_input_for_actor(input: &CreateBranchInput, allow_bot: bool) -> Result<()> {
    validate_common(
        &input.name,
        &input.address,
        &input.working_periods,
        input.default_buzz_channel_id,
        &input.actor,
        allow_bot,
    )
}

fn validate_put_input(input: &PutBranchInput) -> Result<()> {
    if input.branch_id.is_nil() || input.expected_version <= 0 {
        return Err(DbError::InvalidData(
            "AirHub branch identity or version is invalid".to_owned(),
        ));
    }
    validate_common(
        &input.name,
        &input.address,
        &input.working_periods,
        input.default_buzz_channel_id,
        &input.actor,
        false,
    )
}

fn validate_common(
    name: &str,
    address: &str,
    periods: &[BranchWorkingPeriod],
    default_buzz_channel_id: Option<Uuid>,
    actor: &AirhopActor,
    allow_bot: bool,
) -> Result<()> {
    actor.validate()?;
    if !(actor.kind == ActorKind::Staff || (allow_bot && actor.kind == ActorKind::Bot))
        || name.trim().is_empty()
        || name.chars().count() > 160
        || address.trim().is_empty()
        || address.chars().count() > 500
        || periods.len() > MAX_WORKING_PERIODS
        || default_buzz_channel_id.is_some_and(|id| id.is_nil())
        || periods
            .iter()
            .any(|period| period.start_time >= period.end_time)
    {
        return Err(DbError::InvalidData(
            "AirHub branch input is invalid".to_owned(),
        ));
    }
    Ok(())
}

const fn all_weekdays() -> [Weekday; 7] {
    [
        Weekday::Monday,
        Weekday::Tuesday,
        Weekday::Wednesday,
        Weekday::Thursday,
        Weekday::Friday,
        Weekday::Saturday,
        Weekday::Sunday,
    ]
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
            "unknown AirHub branch weekday {other:?}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use buzz_core::{CommunityId, TenantContext};

    use super::*;

    fn actor() -> AirhopActor {
        AirhopActor {
            kind: ActorKind::Staff,
            pubkey: Some([7; 32]),
            on_behalf_of_pubkey: None,
            agent_pubkey: None,
        }
    }

    fn period() -> BranchWorkingPeriod {
        BranchWorkingPeriod {
            weekday: Weekday::Monday,
            start_time: NaiveTime::from_hms_opt(9, 0, 0).expect("valid test time"),
            end_time: NaiveTime::from_hms_opt(18, 0, 0).expect("valid test time"),
        }
    }

    fn create_input() -> CreateBranchInput {
        CreateBranchInput {
            name: "Курская".to_owned(),
            address: "Земляной Вал, 1".to_owned(),
            working_periods: vec![period()],
            default_buzz_channel_id: None,
            idempotency_digest: [1; 32],
            request_hash: [2; 32],
            actor: actor(),
        }
    }

    #[test]
    fn branch_validation_rejects_invalid_periods_and_nil_channels() {
        let mut input = create_input();
        input.working_periods[0].end_time = input.working_periods[0].start_time;
        assert!(validate_create_input(&input).is_err());

        input = create_input();
        input.default_buzz_channel_id = Some(Uuid::nil());
        assert!(validate_create_input(&input).is_err());
    }

    #[tokio::test]
    #[ignore = "requires a dedicated migrated Postgres database"]
    async fn branch_commands_are_persistent_idempotent_and_versioned() {
        let database_url = std::env::var("BUZZ_TEST_DATABASE_URL")
            .expect("BUZZ_TEST_DATABASE_URL must point to a dedicated migrated database");
        let db = Db::new(&crate::DbConfig {
            database_url,
            max_connections: 5,
            min_connections: 0,
            ..crate::DbConfig::default()
        })
        .await
        .expect("connect test database");
        db.migrate().await.expect("migrate test database");

        let community_id = Uuid::new_v4();
        let organization_id = Uuid::new_v4();
        let host = format!("branch-directory-{}.test", community_id.simple());
        let tenant = TenantContext::resolved(CommunityId::from_uuid(community_id), host.clone());
        sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
            .bind(community_id)
            .bind(&host)
            .execute(&db.pool)
            .await
            .expect("insert community");
        sqlx::query(
            "INSERT INTO airhop_organizations (\
                 community_id, id, name, locale, time_zone, default_trial_policy\
             ) VALUES ($1, $2, 'Branch test', 'ru-RU', 'Europe/Moscow', $3)",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(json!({ "mode": "free" }))
        .execute(&db.pool)
        .await
        .expect("insert organization");

        let created = db
            .create_airhop_branch(&tenant, &create_input())
            .await
            .expect("create branch");
        assert_eq!(created.version, 1);
        assert!(!created.replayed);
        assert!(
            db.create_airhop_branch(&tenant, &create_input())
                .await
                .expect("replay create")
                .replayed
        );
        let branches = db
            .list_airhop_branches(&tenant)
            .await
            .expect("list branches");
        assert_eq!(branches.len(), 1);
        assert_eq!(branches[0].working_hours[&Weekday::Monday], vec![period()]);

        let update = PutBranchInput {
            branch_id: created.branch_id,
            expected_version: 1,
            name: "Курская — главный зал".to_owned(),
            address: "Земляной Вал, 2".to_owned(),
            working_periods: vec![period()],
            default_buzz_channel_id: None,
            status: BranchStatus::Archived,
            idempotency_digest: [3; 32],
            request_hash: [4; 32],
            actor: actor(),
        };
        let updated = db
            .put_airhop_branch(&tenant, &update)
            .await
            .expect("archive branch");
        assert_eq!(updated.version, 2);
        assert!(matches!(
            db.put_airhop_branch(
                &tenant,
                &PutBranchInput {
                    idempotency_digest: [5; 32],
                    request_hash: [6; 32],
                    ..update.clone()
                }
            )
            .await,
            Err(DbError::AirhopVersionConflict)
        ));
        let persisted = db
            .list_airhop_branches(&tenant)
            .await
            .expect("reload branches");
        assert_eq!(persisted[0].name, "Курская — главный зал");
        assert_eq!(persisted[0].status, BranchStatus::Archived);
        assert_eq!(persisted[0].version, 2);
    }
}
