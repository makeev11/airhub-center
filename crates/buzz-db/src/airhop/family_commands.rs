//! Idempotent staff commands for family-owned operational entities.
//!
//! Staff mutations update the normalized operational row and append a
//! semantic event in one transaction. They do not notify a parent: messenger
//! delivery belongs to explicit parent-facing workflows such as a booking
//! decision, not ordinary client-card maintenance.

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

const UPDATE_REPRESENTATIVE_COMMAND_TYPE: &str = "UpdateFamilyRepresentative";
const UPDATE_FAMILY_COMMAND_TYPE: &str = "UpdateFamily";
const UPDATE_CHILD_COMMAND_TYPE: &str = "UpdateFamilyChild";

/// Complete replacement of staff-editable family fields.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateFamilyInput {
    /// Family to update.
    pub family_id: Uuid,
    /// Version observed by the staff client.
    pub expected_version: i64,
    /// Staff-facing family label.
    pub display_name: String,
    /// Keyed digest of the HTTP idempotency key.
    pub idempotency_digest: [u8; 32],
    /// Hash of the canonical HTTP body.
    pub request_hash: [u8; 32],
    /// Verified Buzz member attribution.
    pub actor: AirhopActor,
}

/// Result of applying or replaying a family update.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateFamilyOutcome {
    /// Updated family.
    pub family_id: Uuid,
    /// New or unchanged optimistic version.
    pub version: i64,
    /// True when an existing command receipt was replayed.
    pub replayed: bool,
}

/// Complete replacement of staff-editable child fields.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateFamilyChildInput {
    /// Family owning the child.
    pub family_id: Uuid,
    /// Child to update.
    pub child_id: Uuid,
    /// Version observed by the staff client.
    pub expected_version: i64,
    /// Current child name.
    pub display_name: String,
    /// Exact birth date, never a derived age.
    pub birth_date: NaiveDate,
    /// Optional internal staff note.
    pub note: Option<String>,
    /// Keyed digest of the HTTP idempotency key.
    pub idempotency_digest: [u8; 32],
    /// Hash of the canonical HTTP body.
    pub request_hash: [u8; 32],
    /// Verified Buzz member attribution.
    pub actor: AirhopActor,
}

/// Result of applying or replaying a child update.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateFamilyChildOutcome {
    /// Updated child.
    pub child_id: Uuid,
    /// New or unchanged optimistic version.
    pub version: i64,
    /// True when an existing command receipt was replayed.
    pub replayed: bool,
}

/// Complete replacement of staff-editable representative fields.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateFamilyRepresentativeInput {
    /// Family owning the representative.
    pub family_id: Uuid,
    /// Representative to update.
    pub representative_id: Uuid,
    /// Version observed by the staff client.
    pub expected_version: i64,
    /// Current representative name.
    pub display_name: String,
    /// E.164 phone produced by the trusted HTTP boundary.
    pub phone_normalized: String,
    /// Human-readable phone entered by staff.
    pub phone_display: String,
    /// Tenant-keyed phone matching digest.
    pub phone_match_digest: [u8; 32],
    /// `telegram`, `max`, `whatsapp`, `phone`, or `none`.
    pub preferred_contact_channel: String,
    /// Keyed digest of the HTTP idempotency key.
    pub idempotency_digest: [u8; 32],
    /// Hash of the canonical HTTP body.
    pub request_hash: [u8; 32],
    /// Verified Buzz member attribution.
    pub actor: AirhopActor,
}

/// Result of applying or replaying a representative update.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateFamilyRepresentativeOutcome {
    /// Updated representative.
    pub representative_id: Uuid,
    /// New or unchanged optimistic version.
    pub version: i64,
    /// Whether the resulting phone matches another representative.
    pub has_pending_duplicate: bool,
    /// True when an existing command receipt was replayed.
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredRepresentativeUpdateResult {
    representative_id: Uuid,
    version: i64,
    has_pending_duplicate: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredFamilyUpdateResult {
    family_id: Uuid,
    version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredChildUpdateResult {
    child_id: Uuid,
    version: i64,
}

#[derive(Debug)]
struct CurrentRepresentative {
    version: i64,
    display_name: String,
    phone_normalized: String,
    phone_display: String,
    preferred_contact_channel: String,
}

impl Db {
    /// Updates one active family label and records one immutable audit event.
    pub async fn update_airhop_family(
        &self,
        tenant: &TenantContext,
        input: &UpdateFamilyInput,
    ) -> Result<UpdateFamilyOutcome> {
        validate_family_input(input)?;
        let mut transaction = self.pool.begin().await?;
        let (organization_id, occurred_at) =
            resolve_active_organization(&mut transaction, tenant).await?;
        let command = NewAirhopCommand {
            id: Uuid::new_v4(),
            organization_id,
            command_type: UPDATE_FAMILY_COMMAND_TYPE.to_owned(),
            idempotency_digest: input.idempotency_digest,
            request_hash: input.request_hash,
            actor: input.actor.clone(),
            correlation_id: Uuid::new_v4(),
        };
        let command = match insert_pending_command(&mut transaction, tenant, &command).await? {
            CommandInsertOutcome::Inserted(command) => command,
            CommandInsertOutcome::Existing(command) => {
                return replay_family_update(transaction, command).await;
            }
        };
        let row = sqlx::query(
            "SELECT version, display_name FROM airhop_families \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3 \
               AND status = 'active' \
             FOR UPDATE",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(input.family_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| DbError::NotFound("active AirHub family".to_owned()))?;
        let current_version: i64 = row.try_get("version")?;
        if current_version != input.expected_version {
            return Err(DbError::AirhopVersionConflict);
        }
        let current_name: String = row.try_get("display_name")?;
        let display_name = input.display_name.trim();
        let version = if current_name == display_name {
            current_version
        } else {
            let version = sqlx::query_scalar(
                "UPDATE airhop_families \
                 SET display_name = $4, version = version + 1, updated_at = $5 \
                 WHERE community_id = $1 AND organization_id = $2 AND id = $3 \
                   AND version = $6 \
                 RETURNING version",
            )
            .bind(tenant.community().as_uuid())
            .bind(organization_id)
            .bind(input.family_id)
            .bind(display_name)
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
                    event_type: "airhop.family.updated.v1".to_owned(),
                    schema_version: 1,
                    occurred_at,
                    actor: input.actor.clone(),
                    causation_id: command.id,
                    correlation_id: command.correlation_id,
                    payload: json!({
                        "familyId": input.family_id,
                        "changedFields": ["display_name"]
                    }),
                    privacy_class: PrivacyClass::Pii,
                },
            )
            .await?;
            version
        };
        let stored = StoredFamilyUpdateResult {
            family_id: input.family_id,
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
        Ok(UpdateFamilyOutcome {
            family_id: stored.family_id,
            version: stored.version,
            replayed: false,
        })
    }

    /// Updates one active child and records one immutable sensitive-child event.
    pub async fn update_airhop_family_child(
        &self,
        tenant: &TenantContext,
        input: &UpdateFamilyChildInput,
    ) -> Result<UpdateFamilyChildOutcome> {
        validate_child_input(input)?;
        let mut transaction = self.pool.begin().await?;
        let (organization_id, occurred_at) =
            resolve_active_organization(&mut transaction, tenant).await?;
        let command = NewAirhopCommand {
            id: Uuid::new_v4(),
            organization_id,
            command_type: UPDATE_CHILD_COMMAND_TYPE.to_owned(),
            idempotency_digest: input.idempotency_digest,
            request_hash: input.request_hash,
            actor: input.actor.clone(),
            correlation_id: Uuid::new_v4(),
        };
        let command = match insert_pending_command(&mut transaction, tenant, &command).await? {
            CommandInsertOutcome::Inserted(command) => command,
            CommandInsertOutcome::Existing(command) => {
                return replay_child_update(transaction, command).await;
            }
        };
        let row = sqlx::query(
            "SELECT child.version, child.display_name, child.birth_date, child.note, \
                    (now() AT TIME ZONE organization.time_zone)::date AS current_date \
             FROM airhop_children child \
             JOIN airhop_families family \
               ON family.community_id = child.community_id \
              AND family.organization_id = child.organization_id \
              AND family.id = child.family_id \
             JOIN airhop_organizations organization \
               ON organization.community_id = child.community_id \
              AND organization.id = child.organization_id \
             WHERE child.community_id = $1 AND child.organization_id = $2 \
               AND child.family_id = $3 AND child.id = $4 \
               AND child.status = 'active' AND family.status = 'active' \
             FOR UPDATE OF child",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(input.family_id)
        .bind(input.child_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| DbError::NotFound("active AirHub family child".to_owned()))?;
        let current_version: i64 = row.try_get("version")?;
        if current_version != input.expected_version {
            return Err(DbError::AirhopVersionConflict);
        }
        let current_date: NaiveDate = row.try_get("current_date")?;
        if input.birth_date > current_date {
            return Err(DbError::InvalidData(
                "AirHub child birth date cannot be in the future".to_owned(),
            ));
        }
        let display_name = input.display_name.trim();
        let note = normalized_note(input.note.as_deref());
        let current_name: String = row.try_get("display_name")?;
        let current_birth_date: NaiveDate = row.try_get("birth_date")?;
        let current_note: Option<String> = row.try_get("note")?;
        let mut changed_fields = Vec::with_capacity(3);
        if current_name != display_name {
            changed_fields.push("display_name");
        }
        if current_birth_date != input.birth_date {
            changed_fields.push("birth_date");
        }
        if current_note.as_deref() != note.as_deref() {
            changed_fields.push("note");
        }
        let version = if changed_fields.is_empty() {
            current_version
        } else {
            let version = sqlx::query_scalar(
                "UPDATE airhop_children \
                 SET display_name = $5, birth_date = $6, note = $7, \
                     version = version + 1, updated_at = $8 \
                 WHERE community_id = $1 AND organization_id = $2 \
                   AND family_id = $3 AND id = $4 AND version = $9 \
                 RETURNING version",
            )
            .bind(tenant.community().as_uuid())
            .bind(organization_id)
            .bind(input.family_id)
            .bind(input.child_id)
            .bind(display_name)
            .bind(input.birth_date)
            .bind(&note)
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
                    stream_type: "child".to_owned(),
                    stream_id: input.child_id,
                    stream_version: version,
                    event_type: "airhop.child.updated.v1".to_owned(),
                    schema_version: 1,
                    occurred_at,
                    actor: input.actor.clone(),
                    causation_id: command.id,
                    correlation_id: command.correlation_id,
                    payload: json!({
                        "familyId": input.family_id,
                        "childId": input.child_id,
                        "changedFields": changed_fields
                    }),
                    privacy_class: PrivacyClass::SensitiveChild,
                },
            )
            .await?;
            version
        };
        let stored = StoredChildUpdateResult {
            child_id: input.child_id,
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
        Ok(UpdateFamilyChildOutcome {
            child_id: stored.child_id,
            version: stored.version,
            replayed: false,
        })
    }

    /// Updates one active representative and records one immutable audit event.
    pub async fn update_airhop_family_representative(
        &self,
        tenant: &TenantContext,
        input: &UpdateFamilyRepresentativeInput,
    ) -> Result<UpdateFamilyRepresentativeOutcome> {
        validate_input(input)?;
        let mut transaction = self.pool.begin().await?;
        let (organization_id, occurred_at) =
            resolve_active_organization(&mut transaction, tenant).await?;
        let command = NewAirhopCommand {
            id: Uuid::new_v4(),
            organization_id,
            command_type: UPDATE_REPRESENTATIVE_COMMAND_TYPE.to_owned(),
            idempotency_digest: input.idempotency_digest,
            request_hash: input.request_hash,
            actor: input.actor.clone(),
            correlation_id: Uuid::new_v4(),
        };
        let command = match insert_pending_command(&mut transaction, tenant, &command).await? {
            CommandInsertOutcome::Inserted(command) => command,
            CommandInsertOutcome::Existing(command) => {
                return replay_update(transaction, command).await;
            }
        };

        let row = sqlx::query(
            "SELECT representative.version, representative.display_name, \
                    representative.phone_normalized, representative.phone_display, \
                    representative.preferred_contact_channel \
             FROM airhop_representatives representative \
             JOIN airhop_families family \
               ON family.community_id = representative.community_id \
              AND family.organization_id = representative.organization_id \
              AND family.id = representative.family_id \
             WHERE representative.community_id = $1 \
               AND representative.organization_id = $2 \
               AND representative.family_id = $3 \
               AND representative.id = $4 \
               AND representative.status = 'active' \
               AND family.status = 'active' \
             FOR UPDATE OF representative",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(input.family_id)
        .bind(input.representative_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| DbError::NotFound("active AirHub family representative".to_owned()))?;
        let current = CurrentRepresentative {
            version: row.try_get("version")?,
            display_name: row.try_get("display_name")?,
            phone_normalized: row.try_get("phone_normalized")?,
            phone_display: row.try_get("phone_display")?,
            preferred_contact_channel: row.try_get("preferred_contact_channel")?,
        };
        if current.version != input.expected_version {
            return Err(DbError::AirhopVersionConflict);
        }

        let changed_fields = changed_fields(&current, input);
        let version = if changed_fields.is_empty() {
            current.version
        } else {
            sqlx::query_scalar(
                "UPDATE airhop_representatives \
                 SET display_name = $5, phone_normalized = $6, phone_display = $7, \
                     phone_match_digest = $8, preferred_contact_channel = $9, \
                     version = version + 1, updated_at = $10 \
                 WHERE community_id = $1 AND organization_id = $2 \
                   AND family_id = $3 AND id = $4 AND version = $11 \
                 RETURNING version",
            )
            .bind(tenant.community().as_uuid())
            .bind(organization_id)
            .bind(input.family_id)
            .bind(input.representative_id)
            .bind(input.display_name.trim())
            .bind(&input.phone_normalized)
            .bind(input.phone_display.trim())
            .bind(input.phone_match_digest.as_slice())
            .bind(&input.preferred_contact_channel)
            .bind(occurred_at)
            .bind(input.expected_version)
            .fetch_optional(&mut *transaction)
            .await?
            .ok_or(DbError::AirhopVersionConflict)?
        };

        if current.phone_normalized != input.phone_normalized {
            create_phone_duplicate_candidates(&mut transaction, tenant, organization_id, input)
                .await?;
        }
        let has_pending_duplicate = has_pending_duplicate(
            &mut transaction,
            tenant,
            organization_id,
            input.representative_id,
        )
        .await?;

        if !changed_fields.is_empty() {
            append_domain_event(
                &mut transaction,
                tenant,
                &NewDomainEvent {
                    id: Uuid::new_v4(),
                    organization_id,
                    stream_type: "representative".to_owned(),
                    stream_id: input.representative_id,
                    stream_version: version,
                    event_type: "airhop.representative.updated.v1".to_owned(),
                    schema_version: 1,
                    occurred_at,
                    actor: input.actor.clone(),
                    causation_id: command.id,
                    correlation_id: command.correlation_id,
                    payload: json!({
                        "familyId": input.family_id,
                        "representativeId": input.representative_id,
                        "changedFields": changed_fields,
                        "hasPendingDuplicate": has_pending_duplicate
                    }),
                    privacy_class: PrivacyClass::Pii,
                },
            )
            .await?;
        }

        let stored = StoredRepresentativeUpdateResult {
            representative_id: input.representative_id,
            version,
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
        Ok(UpdateFamilyRepresentativeOutcome {
            representative_id: stored.representative_id,
            version: stored.version,
            has_pending_duplicate: stored.has_pending_duplicate,
            replayed: false,
        })
    }
}

fn changed_fields(
    current: &CurrentRepresentative,
    input: &UpdateFamilyRepresentativeInput,
) -> Vec<&'static str> {
    let mut fields = Vec::with_capacity(4);
    if current.display_name != input.display_name.trim() {
        fields.push("display_name");
    }
    if current.phone_normalized != input.phone_normalized {
        fields.push("phone");
    } else if current.phone_display != input.phone_display.trim() {
        fields.push("phone_display");
    }
    if current.preferred_contact_channel != input.preferred_contact_channel {
        fields.push("preferred_contact_channel");
    }
    fields
}

async fn create_phone_duplicate_candidates(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    input: &UpdateFamilyRepresentativeInput,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO airhop_duplicate_candidates (\
             community_id, organization_id, new_entity_type, new_entity_id, \
             existing_entity_type, existing_entity_id, signals\
         ) \
         SELECT $1, $2, 'representative', $3, 'representative', existing.id, \
                ARRAY['phone']::TEXT[] \
         FROM airhop_representatives existing \
         WHERE existing.community_id = $1 AND existing.organization_id = $2 \
           AND existing.id <> $3 AND existing.status = 'active' \
           AND existing.phone_match_digest = $4 \
           AND existing.phone_normalized = $5 \
         ON CONFLICT DO NOTHING",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(input.representative_id)
    .bind(input.phone_match_digest.as_slice())
    .bind(&input.phone_normalized)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn has_pending_duplicate(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    representative_id: Uuid,
) -> Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS (\
             SELECT 1 FROM airhop_duplicate_candidates \
             WHERE community_id = $1 AND organization_id = $2 \
               AND status = 'pending' \
               AND (new_entity_id = $3 OR existing_entity_id = $3)\
         )",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(representative_id)
    .fetch_one(&mut **transaction)
    .await
    .map_err(Into::into)
}

async fn resolve_active_organization(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
) -> Result<(Uuid, DateTime<Utc>)> {
    let row = sqlx::query(
        "SELECT id, now() AS occurred_at FROM airhop_organizations \
         WHERE community_id = $1 AND status = 'active'",
    )
    .bind(tenant.community().as_uuid())
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or_else(|| DbError::NotFound("active AirHub organization".to_owned()))?;
    Ok((row.try_get("id")?, row.try_get("occurred_at")?))
}

async fn replay_update(
    transaction: Transaction<'_, Postgres>,
    command: super::AirhopCommand,
) -> Result<UpdateFamilyRepresentativeOutcome> {
    match command.status {
        CommandStatus::Pending => Err(DbError::AirhopCommandInProgress),
        CommandStatus::Failed => Err(DbError::AirhopCommandPreviouslyFailed),
        CommandStatus::Committed => {
            let stored: StoredRepresentativeUpdateResult =
                serde_json::from_value(command.result.ok_or_else(|| {
                    DbError::InvalidData("committed AirHub command has no result".to_owned())
                })?)?;
            transaction.commit().await?;
            Ok(UpdateFamilyRepresentativeOutcome {
                representative_id: stored.representative_id,
                version: stored.version,
                has_pending_duplicate: stored.has_pending_duplicate,
                replayed: true,
            })
        }
    }
}

async fn replay_family_update(
    transaction: Transaction<'_, Postgres>,
    command: super::AirhopCommand,
) -> Result<UpdateFamilyOutcome> {
    match command.status {
        CommandStatus::Pending => Err(DbError::AirhopCommandInProgress),
        CommandStatus::Failed => Err(DbError::AirhopCommandPreviouslyFailed),
        CommandStatus::Committed => {
            let stored: StoredFamilyUpdateResult =
                serde_json::from_value(command.result.ok_or_else(|| {
                    DbError::InvalidData("committed AirHub command has no result".to_owned())
                })?)?;
            transaction.commit().await?;
            Ok(UpdateFamilyOutcome {
                family_id: stored.family_id,
                version: stored.version,
                replayed: true,
            })
        }
    }
}

async fn replay_child_update(
    transaction: Transaction<'_, Postgres>,
    command: super::AirhopCommand,
) -> Result<UpdateFamilyChildOutcome> {
    match command.status {
        CommandStatus::Pending => Err(DbError::AirhopCommandInProgress),
        CommandStatus::Failed => Err(DbError::AirhopCommandPreviouslyFailed),
        CommandStatus::Committed => {
            let stored: StoredChildUpdateResult =
                serde_json::from_value(command.result.ok_or_else(|| {
                    DbError::InvalidData("committed AirHub command has no result".to_owned())
                })?)?;
            transaction.commit().await?;
            Ok(UpdateFamilyChildOutcome {
                child_id: stored.child_id,
                version: stored.version,
                replayed: true,
            })
        }
    }
}

fn validate_family_input(input: &UpdateFamilyInput) -> Result<()> {
    input.actor.validate()?;
    let display_name = input.display_name.trim();
    if input.family_id.is_nil()
        || input.expected_version < 1
        || input.actor.kind != ActorKind::Staff
        || display_name.is_empty()
        || display_name.chars().count() > 200
    {
        return Err(DbError::InvalidData(
            "AirHub family update is invalid".to_owned(),
        ));
    }
    Ok(())
}

fn validate_child_input(input: &UpdateFamilyChildInput) -> Result<()> {
    input.actor.validate()?;
    let display_name = input.display_name.trim();
    if input.family_id.is_nil()
        || input.child_id.is_nil()
        || input.expected_version < 1
        || input.actor.kind != ActorKind::Staff
        || display_name.is_empty()
        || display_name.chars().count() > 160
        || input
            .note
            .as_ref()
            .is_some_and(|note| note.trim().chars().count() > 4_000)
    {
        return Err(DbError::InvalidData(
            "AirHub child update is invalid".to_owned(),
        ));
    }
    Ok(())
}

fn normalized_note(note: Option<&str>) -> Option<String> {
    note.map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn validate_input(input: &UpdateFamilyRepresentativeInput) -> Result<()> {
    input.actor.validate()?;
    let display_name = input.display_name.trim();
    let phone_display = input.phone_display.trim();
    if input.family_id.is_nil()
        || input.representative_id.is_nil()
        || input.expected_version < 1
        || input.actor.kind != ActorKind::Staff
        || display_name.is_empty()
        || display_name.chars().count() > 160
        || phone_display.is_empty()
        || phone_display.chars().count() > 80
        || !valid_e164(&input.phone_normalized)
        || !matches!(
            input.preferred_contact_channel.as_str(),
            "telegram" | "max" | "whatsapp" | "phone" | "none"
        )
    {
        return Err(DbError::InvalidData(
            "AirHub representative update is invalid".to_owned(),
        ));
    }
    Ok(())
}

fn valid_e164(value: &str) -> bool {
    let Some(digits) = value.strip_prefix('+') else {
        return false;
    };
    (10..=15).contains(&digits.len())
        && !digits.starts_with('0')
        && digits.bytes().all(|byte| byte.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> UpdateFamilyRepresentativeInput {
        UpdateFamilyRepresentativeInput {
            family_id: Uuid::new_v4(),
            representative_id: Uuid::new_v4(),
            expected_version: 2,
            display_name: "Мария Иванова".to_owned(),
            phone_normalized: "+79991234567".to_owned(),
            phone_display: "+7 999 123-45-67".to_owned(),
            phone_match_digest: [3; 32],
            preferred_contact_channel: "telegram".to_owned(),
            idempotency_digest: [4; 32],
            request_hash: [5; 32],
            actor: AirhopActor {
                kind: ActorKind::Staff,
                pubkey: Some([6; 32]),
                on_behalf_of_pubkey: None,
                agent_pubkey: None,
            },
        }
    }

    #[test]
    fn representative_update_requires_staff_identity_and_valid_values() {
        assert!(validate_input(&input()).is_ok());
        assert!(validate_input(&UpdateFamilyRepresentativeInput {
            expected_version: 0,
            ..input()
        })
        .is_err());
        assert!(validate_input(&UpdateFamilyRepresentativeInput {
            phone_normalized: "8999".to_owned(),
            ..input()
        })
        .is_err());
        assert!(validate_input(&UpdateFamilyRepresentativeInput {
            actor: AirhopActor {
                kind: ActorKind::Bot,
                ..input().actor
            },
            ..input()
        })
        .is_err());
    }

    #[test]
    fn family_and_child_updates_are_bounded_and_staff_only() {
        let actor = input().actor;
        let family = UpdateFamilyInput {
            family_id: Uuid::new_v4(),
            expected_version: 1,
            display_name: "Семья Ивановых".to_owned(),
            idempotency_digest: [1; 32],
            request_hash: [2; 32],
            actor: actor.clone(),
        };
        assert!(validate_family_input(&family).is_ok());
        assert!(validate_family_input(&UpdateFamilyInput {
            display_name: " ".to_owned(),
            ..family.clone()
        })
        .is_err());

        let child = UpdateFamilyChildInput {
            family_id: family.family_id,
            child_id: Uuid::new_v4(),
            expected_version: 1,
            display_name: "Анна".to_owned(),
            birth_date: NaiveDate::from_ymd_opt(2019, 5, 20).expect("valid date"),
            note: Some(" Аллергия ".to_owned()),
            idempotency_digest: [3; 32],
            request_hash: [4; 32],
            actor,
        };
        assert!(validate_child_input(&child).is_ok());
        assert_eq!(
            normalized_note(child.note.as_deref()),
            Some("Аллергия".to_owned())
        );
        assert_eq!(normalized_note(Some("  ")), None);
        assert!(validate_child_input(&UpdateFamilyChildInput {
            note: Some("x".repeat(4_001)),
            ..child
        })
        .is_err());
    }
}
