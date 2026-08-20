//! Atomic family creation and explicit family lifecycle commands.

use buzz_core::TenantContext;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use super::{
    append_domain_event, commit_command, insert_pending_command, ActorKind, AirhopActor,
    CommandInsertOutcome, CommandStatus, NewAirhopCommand, NewDomainEvent, PrivacyClass,
};
use crate::{Db, DbError, Result};

const CREATE_FAMILY_COMMAND_TYPE: &str = "CreateFamily";
const SET_FAMILY_STATUS_COMMAND_TYPE: &str = "SetFamilyStatus";

/// Staff-entered first family graph persisted atomically.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateFamilyInput {
    /// Staff-facing family label.
    pub display_name: String,
    /// Primary representative name.
    pub representative_name: String,
    /// Exact primary representative first name when staff has confirmed it.
    pub representative_first_name: Option<String>,
    /// Exact primary representative last name when staff has confirmed it.
    pub representative_last_name: Option<String>,
    /// E.164 primary phone.
    pub phone_normalized: String,
    /// Human-readable primary phone.
    pub phone_display: String,
    /// Tenant-keyed phone matching digest.
    pub phone_match_digest: [u8; 32],
    /// Initial service contact preference.
    pub preferred_contact_channel: String,
    /// First child name.
    pub child_name: String,
    /// Exact first-child first name when staff has confirmed it.
    pub child_first_name: Option<String>,
    /// Exact first-child last name when staff has confirmed it.
    pub child_last_name: Option<String>,
    /// First child exact birth date.
    pub child_birth_date: NaiveDate,
    /// Optional first-child staff note.
    pub child_note: Option<String>,
    /// Keyed digest of the HTTP idempotency key.
    pub idempotency_digest: [u8; 32],
    /// Hash of the canonical HTTP body.
    pub request_hash: [u8; 32],
    /// Verified staff attribution.
    pub actor: AirhopActor,
}

/// Identities created by one atomic family command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateFamilyOutcome {
    /// New family.
    pub family_id: Uuid,
    /// New primary representative.
    pub representative_id: Uuid,
    /// New first child.
    pub child_id: Uuid,
    /// Whether duplicate review is required.
    pub has_pending_duplicate: bool,
    /// True when an existing command receipt was replayed.
    pub replayed: bool,
}

/// Family lifecycle target.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FamilyLifecycleStatus {
    /// Operational family.
    Active,
    /// Retained historical family.
    Archived,
}

impl FamilyLifecycleStatus {
    const fn as_db_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Archived => "archived",
        }
    }

    const fn event_type(self) -> &'static str {
        match self {
            Self::Active => "airhop.family.restored.v1",
            Self::Archived => "airhop.family.archived.v1",
        }
    }
}

/// Explicit archive or restore command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SetFamilyStatusInput {
    /// Family to transition.
    pub family_id: Uuid,
    /// Version observed by staff.
    pub expected_version: i64,
    /// Explicit target lifecycle.
    pub status: FamilyLifecycleStatus,
    /// Keyed digest of the HTTP idempotency key.
    pub idempotency_digest: [u8; 32],
    /// Hash of the canonical HTTP body.
    pub request_hash: [u8; 32],
    /// Verified staff attribution.
    pub actor: AirhopActor,
}

/// Result of archive, restore, or replay.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SetFamilyStatusOutcome {
    /// Transitioned family.
    pub family_id: Uuid,
    /// Persisted lifecycle.
    pub status: FamilyLifecycleStatus,
    /// New or unchanged version.
    pub version: i64,
    /// True when an existing command receipt was replayed.
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredCreateResult {
    family_id: Uuid,
    representative_id: Uuid,
    child_id: Uuid,
    has_pending_duplicate: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredStatusResult {
    family_id: Uuid,
    status: FamilyLifecycleStatus,
    version: i64,
}

impl Db {
    /// Creates family, primary representative, and first child in one transaction.
    pub async fn create_airhop_family(
        &self,
        tenant: &TenantContext,
        input: &CreateFamilyInput,
    ) -> Result<CreateFamilyOutcome> {
        validate_create(input)?;
        let mut transaction = self.pool.begin().await?;
        let (organization_id, occurred_at, current_date) =
            resolve_organization(&mut transaction, tenant).await?;
        if input.child_birth_date > current_date {
            return Err(DbError::InvalidData(
                "AirHub child birth date cannot be in the future".to_owned(),
            ));
        }
        let command = NewAirhopCommand {
            id: Uuid::new_v4(),
            organization_id,
            command_type: CREATE_FAMILY_COMMAND_TYPE.to_owned(),
            idempotency_digest: input.idempotency_digest,
            request_hash: input.request_hash,
            actor: input.actor.clone(),
            correlation_id: Uuid::new_v4(),
        };
        let command = match insert_pending_command(&mut transaction, tenant, &command).await? {
            CommandInsertOutcome::Inserted(command) => command,
            CommandInsertOutcome::Existing(command) => {
                return replay_create(transaction, command).await;
            }
        };
        let family_id = Uuid::new_v4();
        let representative_id = Uuid::new_v4();
        let child_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO airhop_families (community_id, organization_id, id, \
                 display_name, primary_representative_id) VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(family_id)
        .bind(input.display_name.trim())
        .bind(representative_id)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "INSERT INTO airhop_representatives (community_id, organization_id, id, \
                 family_id, display_name, first_name, last_name, phone_normalized, phone_display, \
                 phone_match_digest, preferred_contact_channel) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(representative_id)
        .bind(family_id)
        .bind(input.representative_name.trim())
        .bind(normalized_name_part(
            input.representative_first_name.as_deref(),
        ))
        .bind(normalized_name_part(
            input.representative_last_name.as_deref(),
        ))
        .bind(&input.phone_normalized)
        .bind(input.phone_display.trim())
        .bind(input.phone_match_digest.as_slice())
        .bind(&input.preferred_contact_channel)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "INSERT INTO airhop_children (community_id, organization_id, id, family_id, \
                 display_name, first_name, last_name, birth_date, note) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(child_id)
        .bind(family_id)
        .bind(input.child_name.trim())
        .bind(normalized_name_part(input.child_first_name.as_deref()))
        .bind(normalized_name_part(input.child_last_name.as_deref()))
        .bind(input.child_birth_date)
        .bind(normalized_note(input.child_note.as_deref()))
        .execute(&mut *transaction)
        .await?;
        create_duplicate_candidates(
            &mut transaction,
            tenant,
            organization_id,
            representative_id,
            child_id,
            input,
        )
        .await?;
        let has_pending_duplicate = pending_duplicate(
            &mut transaction,
            tenant,
            organization_id,
            representative_id,
            child_id,
        )
        .await?;
        append_domain_event(
            &mut transaction,
            tenant,
            &NewDomainEvent {
                id: Uuid::new_v4(),
                organization_id,
                stream_type: "family".to_owned(),
                stream_id: family_id,
                stream_version: 1,
                event_type: "airhop.family.created.v1".to_owned(),
                schema_version: 1,
                occurred_at,
                actor: input.actor.clone(),
                causation_id: command.id,
                correlation_id: command.correlation_id,
                payload: json!({
                    "familyId": family_id,
                    "primaryRepresentativeId": representative_id,
                    "firstChildId": child_id,
                    "hasPendingDuplicate": has_pending_duplicate
                }),
                privacy_class: PrivacyClass::SensitiveChild,
            },
        )
        .await?;
        let stored = StoredCreateResult {
            family_id,
            representative_id,
            child_id,
            has_pending_duplicate,
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
        Ok(CreateFamilyOutcome {
            family_id,
            representative_id,
            child_id,
            has_pending_duplicate,
            replayed: false,
        })
    }

    /// Archives or restores one family without deleting its relationships.
    pub async fn set_airhop_family_status(
        &self,
        tenant: &TenantContext,
        input: &SetFamilyStatusInput,
    ) -> Result<SetFamilyStatusOutcome> {
        validate_status(input)?;
        let mut transaction = self.pool.begin().await?;
        let (organization_id, occurred_at, _) =
            resolve_organization(&mut transaction, tenant).await?;
        let command = NewAirhopCommand {
            id: Uuid::new_v4(),
            organization_id,
            command_type: SET_FAMILY_STATUS_COMMAND_TYPE.to_owned(),
            idempotency_digest: input.idempotency_digest,
            request_hash: input.request_hash,
            actor: input.actor.clone(),
            correlation_id: Uuid::new_v4(),
        };
        let command = match insert_pending_command(&mut transaction, tenant, &command).await? {
            CommandInsertOutcome::Inserted(command) => command,
            CommandInsertOutcome::Existing(command) => {
                return replay_status(transaction, command).await;
            }
        };
        let row = sqlx::query(
            "SELECT status, version FROM airhop_families \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3 FOR UPDATE",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(input.family_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| DbError::NotFound("AirHub family".to_owned()))?;
        let current_status: &str = row.try_get("status")?;
        let current_version: i64 = row.try_get("version")?;
        if current_version != input.expected_version {
            return Err(DbError::AirhopVersionConflict);
        }
        let version = if current_status == input.status.as_db_str() {
            current_version
        } else {
            let version = sqlx::query_scalar(
                "UPDATE airhop_families SET status = $4, version = version + 1, \
                     updated_at = $5 WHERE community_id = $1 AND organization_id = $2 \
                     AND id = $3 AND version = $6 RETURNING version",
            )
            .bind(tenant.community().as_uuid())
            .bind(organization_id)
            .bind(input.family_id)
            .bind(input.status.as_db_str())
            .bind(occurred_at)
            .bind(input.expected_version)
            .fetch_optional(&mut *transaction)
            .await?
            .ok_or(DbError::AirhopVersionConflict)?;
            append_domain_event(
                &mut transaction,
                tenant,
                &NewDomainEvent {
                    id: Uuid::new_v4(),
                    organization_id,
                    stream_type: "family".to_owned(),
                    stream_id: input.family_id,
                    stream_version: version,
                    event_type: input.status.event_type().to_owned(),
                    schema_version: 1,
                    occurred_at,
                    actor: input.actor.clone(),
                    causation_id: command.id,
                    correlation_id: command.correlation_id,
                    payload: json!({"familyId": input.family_id, "status": input.status}),
                    privacy_class: PrivacyClass::Pii,
                },
            )
            .await?;
            version
        };
        let stored = StoredStatusResult {
            family_id: input.family_id,
            status: input.status,
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
        Ok(SetFamilyStatusOutcome {
            family_id: stored.family_id,
            status: stored.status,
            version: stored.version,
            replayed: false,
        })
    }
}

/// Executes the normal family creation service inside a caller-owned transaction.
pub(super) async fn create_airhop_family_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    input: &CreateFamilyInput,
) -> Result<CreateFamilyOutcome> {
    validate_agent_create(input)?;
    let (organization_id, occurred_at, current_date) =
        resolve_organization(transaction, tenant).await?;
    if input.child_birth_date > current_date {
        return Err(DbError::InvalidData(
            "AirHub child birth date cannot be in the future".to_owned(),
        ));
    }
    let command = NewAirhopCommand {
        id: Uuid::new_v4(),
        organization_id,
        command_type: CREATE_FAMILY_COMMAND_TYPE.to_owned(),
        idempotency_digest: input.idempotency_digest,
        request_hash: input.request_hash,
        actor: input.actor.clone(),
        correlation_id: Uuid::new_v4(),
    };
    let command = match insert_pending_command(transaction, tenant, &command).await? {
        CommandInsertOutcome::Inserted(command) => command,
        CommandInsertOutcome::Existing(command) => return replay_create_without_commit(command),
    };
    let family_id = Uuid::new_v4();
    let representative_id = Uuid::new_v4();
    let child_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO airhop_families (community_id, organization_id, id, \
             display_name, primary_representative_id) VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(family_id)
    .bind(input.display_name.trim())
    .bind(representative_id)
    .execute(&mut **transaction)
    .await?;
    sqlx::query(
        "INSERT INTO airhop_representatives (community_id, organization_id, id, \
             family_id, display_name, first_name, last_name, phone_normalized, phone_display, \
             phone_match_digest, preferred_contact_channel) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(representative_id)
    .bind(family_id)
    .bind(input.representative_name.trim())
    .bind(normalized_name_part(
        input.representative_first_name.as_deref(),
    ))
    .bind(normalized_name_part(
        input.representative_last_name.as_deref(),
    ))
    .bind(&input.phone_normalized)
    .bind(input.phone_display.trim())
    .bind(input.phone_match_digest.as_slice())
    .bind(&input.preferred_contact_channel)
    .execute(&mut **transaction)
    .await?;
    sqlx::query(
        "INSERT INTO airhop_children (community_id, organization_id, id, family_id, \
             display_name, first_name, last_name, birth_date, note) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(child_id)
    .bind(family_id)
    .bind(input.child_name.trim())
    .bind(normalized_name_part(input.child_first_name.as_deref()))
    .bind(normalized_name_part(input.child_last_name.as_deref()))
    .bind(input.child_birth_date)
    .bind(normalized_note(input.child_note.as_deref()))
    .execute(&mut **transaction)
    .await?;
    create_duplicate_candidates(
        transaction,
        tenant,
        organization_id,
        representative_id,
        child_id,
        input,
    )
    .await?;
    let has_pending_duplicate = pending_duplicate(
        transaction,
        tenant,
        organization_id,
        representative_id,
        child_id,
    )
    .await?;
    append_domain_event(
        transaction,
        tenant,
        &NewDomainEvent {
            id: Uuid::new_v4(),
            organization_id,
            stream_type: "family".to_owned(),
            stream_id: family_id,
            stream_version: 1,
            event_type: "airhop.family.created.v1".to_owned(),
            schema_version: 1,
            occurred_at,
            actor: input.actor.clone(),
            causation_id: command.id,
            correlation_id: command.correlation_id,
            payload: json!({
                "familyId": family_id,
                "primaryRepresentativeId": representative_id,
                "firstChildId": child_id,
                "hasPendingDuplicate": has_pending_duplicate
            }),
            privacy_class: PrivacyClass::SensitiveChild,
        },
    )
    .await?;
    let stored = StoredCreateResult {
        family_id,
        representative_id,
        child_id,
        has_pending_duplicate,
    };
    commit_command(
        transaction,
        tenant,
        organization_id,
        command.id,
        &serde_json::to_value(&stored)?,
    )
    .await?;
    Ok(CreateFamilyOutcome {
        family_id,
        representative_id,
        child_id,
        has_pending_duplicate,
        replayed: false,
    })
}

fn replay_create_without_commit(command: super::AirhopCommand) -> Result<CreateFamilyOutcome> {
    match command.status {
        CommandStatus::Pending => Err(DbError::AirhopCommandInProgress),
        CommandStatus::Failed => Err(DbError::AirhopCommandPreviouslyFailed),
        CommandStatus::Committed => {
            let stored: StoredCreateResult =
                serde_json::from_value(command.result.ok_or_else(|| {
                    DbError::InvalidData("committed AirHub command has no result".to_owned())
                })?)?;
            Ok(CreateFamilyOutcome {
                family_id: stored.family_id,
                representative_id: stored.representative_id,
                child_id: stored.child_id,
                has_pending_duplicate: stored.has_pending_duplicate,
                replayed: true,
            })
        }
    }
}

async fn create_duplicate_candidates(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    representative_id: Uuid,
    child_id: Uuid,
    input: &CreateFamilyInput,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO airhop_duplicate_candidates (community_id, organization_id, \
             new_entity_type, new_entity_id, existing_entity_type, existing_entity_id, signals) \
         SELECT $1, $2, 'representative', $3, 'representative', existing.id, ARRAY['phone']::TEXT[] \
         FROM airhop_representatives existing WHERE existing.community_id = $1 \
           AND existing.organization_id = $2 AND existing.id <> $3 AND existing.status = 'active' \
           AND existing.phone_match_digest = $4 AND existing.phone_normalized = $5 \
         ON CONFLICT DO NOTHING",
    )
    .bind(tenant.community().as_uuid()).bind(organization_id).bind(representative_id)
    .bind(input.phone_match_digest.as_slice()).bind(&input.phone_normalized)
    .execute(&mut **transaction).await?;
    sqlx::query(
        "INSERT INTO airhop_duplicate_candidates (community_id, organization_id, \
             new_entity_type, new_entity_id, existing_entity_type, existing_entity_id, signals) \
         SELECT $1, $2, 'child', $3, 'child', existing.id, ARRAY['name_and_birth_date']::TEXT[] \
         FROM airhop_children existing WHERE existing.community_id = $1 \
           AND existing.organization_id = $2 AND existing.id <> $3 AND existing.status = 'active' \
           AND lower(btrim(existing.display_name)) = lower(btrim($4)) AND existing.birth_date = $5 \
         ON CONFLICT DO NOTHING",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(child_id)
    .bind(input.child_name.trim())
    .bind(input.child_birth_date)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn pending_duplicate(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    representative_id: Uuid,
    child_id: Uuid,
) -> Result<bool> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM airhop_duplicate_candidates WHERE community_id = $1 \
         AND organization_id = $2 AND status = 'pending' AND \
         (new_entity_id IN ($3, $4) OR existing_entity_id IN ($3, $4)))",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(representative_id)
    .bind(child_id)
    .fetch_one(&mut **transaction)
    .await?)
}

async fn resolve_organization(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
) -> Result<(Uuid, DateTime<Utc>, NaiveDate)> {
    let row = sqlx::query(
        "SELECT id, now() AS occurred_at, (now() AT TIME ZONE time_zone)::date AS current_date \
         FROM airhop_organizations WHERE community_id = $1 AND status = 'active'",
    )
    .bind(tenant.community().as_uuid())
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or_else(|| DbError::NotFound("active AirHub organization".to_owned()))?;
    Ok((
        row.try_get("id")?,
        row.try_get("occurred_at")?,
        row.try_get("current_date")?,
    ))
}

async fn replay_create(
    transaction: Transaction<'_, Postgres>,
    command: super::AirhopCommand,
) -> Result<CreateFamilyOutcome> {
    let stored: StoredCreateResult = replay_result(transaction, command).await?;
    Ok(CreateFamilyOutcome {
        family_id: stored.family_id,
        representative_id: stored.representative_id,
        child_id: stored.child_id,
        has_pending_duplicate: stored.has_pending_duplicate,
        replayed: true,
    })
}

async fn replay_status(
    transaction: Transaction<'_, Postgres>,
    command: super::AirhopCommand,
) -> Result<SetFamilyStatusOutcome> {
    let stored: StoredStatusResult = replay_result(transaction, command).await?;
    Ok(SetFamilyStatusOutcome {
        family_id: stored.family_id,
        status: stored.status,
        version: stored.version,
        replayed: true,
    })
}

async fn replay_result<T: for<'de> Deserialize<'de>>(
    transaction: Transaction<'_, Postgres>,
    command: super::AirhopCommand,
) -> Result<T> {
    match command.status {
        CommandStatus::Pending => Err(DbError::AirhopCommandInProgress),
        CommandStatus::Failed => Err(DbError::AirhopCommandPreviouslyFailed),
        CommandStatus::Committed => {
            let result = serde_json::from_value(command.result.ok_or_else(|| {
                DbError::InvalidData("committed AirHub command has no result".to_owned())
            })?)?;
            transaction.commit().await?;
            Ok(result)
        }
    }
}

fn validate_create(input: &CreateFamilyInput) -> Result<()> {
    validate_create_for_actor(input, false)
}

fn validate_agent_create(input: &CreateFamilyInput) -> Result<()> {
    validate_create_for_actor(input, true)
}

fn validate_create_for_actor(input: &CreateFamilyInput, allow_bot: bool) -> Result<()> {
    input.actor.validate()?;
    let note = input.child_note.as_deref().map(str::trim);
    if !(input.actor.kind == ActorKind::Staff || (allow_bot && input.actor.kind == ActorKind::Bot))
        || !bounded(&input.display_name, 200)
        || !bounded(&input.representative_name, 160)
        || !valid_structured_name(
            input.representative_first_name.as_deref(),
            input.representative_last_name.as_deref(),
        )
        || !bounded(&input.phone_display, 80)
        || !bounded(&input.child_name, 160)
        || !valid_structured_name(
            input.child_first_name.as_deref(),
            input.child_last_name.as_deref(),
        )
        || !valid_e164(&input.phone_normalized)
        || !matches!(
            input.preferred_contact_channel.as_str(),
            "telegram" | "max" | "whatsapp" | "phone" | "none"
        )
        || note.is_some_and(|value| value.chars().count() > 4_000)
    {
        return Err(DbError::InvalidData(
            "AirHub family creation is invalid".to_owned(),
        ));
    }
    Ok(())
}

fn validate_status(input: &SetFamilyStatusInput) -> Result<()> {
    input.actor.validate()?;
    if input.actor.kind != ActorKind::Staff
        || input.family_id.is_nil()
        || input.expected_version < 1
    {
        return Err(DbError::InvalidData(
            "AirHub family status command is invalid".to_owned(),
        ));
    }
    Ok(())
}

fn bounded(value: &str, max: usize) -> bool {
    let value = value.trim();
    !value.is_empty() && value.chars().count() <= max
}

fn valid_structured_name(first_name: Option<&str>, last_name: Option<&str>) -> bool {
    match (first_name, last_name) {
        (None, None) => true,
        (Some(first_name), Some(last_name)) => bounded(first_name, 80) && bounded(last_name, 80),
        _ => false,
    }
}

fn normalized_name_part(value: Option<&str>) -> Option<String> {
    value.map(str::trim).map(ToOwned::to_owned)
}

fn valid_e164(value: &str) -> bool {
    value.strip_prefix('+').is_some_and(|digits| {
        (10..=15).contains(&digits.len())
            && !digits.starts_with('0')
            && digits.bytes().all(|byte| byte.is_ascii_digit())
    })
}

fn normalized_note(note: Option<&str>) -> Option<String> {
    note.map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn actor() -> AirhopActor {
        AirhopActor {
            kind: ActorKind::Staff,
            pubkey: Some([1; 32]),
            on_behalf_of_pubkey: None,
            agent_pubkey: None,
        }
    }

    #[test]
    fn lifecycle_inputs_are_bounded_and_explicit() {
        let create = CreateFamilyInput {
            display_name: "Семья Ивановых".to_owned(),
            representative_name: "Мария".to_owned(),
            representative_first_name: Some("Мария".to_owned()),
            representative_last_name: Some("Иванова".to_owned()),
            phone_normalized: "+79991234567".to_owned(),
            phone_display: "+7 999 123-45-67".to_owned(),
            phone_match_digest: [2; 32],
            preferred_contact_channel: "phone".to_owned(),
            child_name: "Анна".to_owned(),
            child_first_name: Some("Анна".to_owned()),
            child_last_name: Some("Иванова".to_owned()),
            child_birth_date: NaiveDate::from_ymd_opt(2019, 5, 20).expect("date"),
            child_note: None,
            idempotency_digest: [3; 32],
            request_hash: [4; 32],
            actor: actor(),
        };
        assert!(validate_create(&create).is_ok());
        assert!(validate_create(&CreateFamilyInput {
            representative_last_name: None,
            ..create.clone()
        })
        .is_err());
        assert!(validate_create(&CreateFamilyInput {
            phone_normalized: "8999".to_owned(),
            ..create
        })
        .is_err());
        assert!(validate_status(&SetFamilyStatusInput {
            family_id: Uuid::new_v4(),
            expected_version: 1,
            status: FamilyLifecycleStatus::Archived,
            idempotency_digest: [5; 32],
            request_hash: [6; 32],
            actor: actor()
        })
        .is_ok());
    }
}
