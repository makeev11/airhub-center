//! Explicit primary representative reassignment command.

use buzz_core::TenantContext;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use super::{
    append_domain_event, commit_command, insert_pending_command, ActorKind, AirhopActor,
    CommandInsertOutcome, CommandStatus, NewAirhopCommand, NewDomainEvent, PrivacyClass,
};
use crate::{Db, DbError, Result};

const SET_PRIMARY_REPRESENTATIVE_COMMAND_TYPE: &str = "SetFamilyPrimaryRepresentative";

/// Selects one active representative in the same family as its primary contact.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SetFamilyPrimaryRepresentativeInput {
    /// Family whose primary edge changes.
    pub family_id: Uuid,
    /// Active representative in that family.
    pub representative_id: Uuid,
    /// Family version observed by staff.
    pub expected_version: i64,
    /// Keyed digest of the HTTP idempotency key.
    pub idempotency_digest: [u8; 32],
    /// Hash of the canonical HTTP body.
    pub request_hash: [u8; 32],
    /// Verified staff attribution.
    pub actor: AirhopActor,
}

/// Result of applying or replaying primary representative reassignment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SetFamilyPrimaryRepresentativeOutcome {
    /// Updated family.
    pub family_id: Uuid,
    /// Newly selected primary representative.
    pub representative_id: Uuid,
    /// Representative that was primary before the command.
    pub previous_representative_id: Uuid,
    /// New or unchanged family version.
    pub version: i64,
    /// True when an existing command receipt was replayed.
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredResult {
    family_id: Uuid,
    representative_id: Uuid,
    previous_representative_id: Uuid,
    version: i64,
}

impl Db {
    /// Repoints the family primary edge to an active representative in one transaction.
    pub async fn set_airhop_family_primary_representative(
        &self,
        tenant: &TenantContext,
        input: &SetFamilyPrimaryRepresentativeInput,
    ) -> Result<SetFamilyPrimaryRepresentativeOutcome> {
        validate_input(input)?;
        let mut transaction = self.pool.begin().await?;
        let (organization_id, occurred_at) =
            resolve_active_organization(&mut transaction, tenant).await?;
        let command = NewAirhopCommand {
            id: Uuid::new_v4(),
            organization_id,
            command_type: SET_PRIMARY_REPRESENTATIVE_COMMAND_TYPE.to_owned(),
            idempotency_digest: input.idempotency_digest,
            request_hash: input.request_hash,
            actor: input.actor.clone(),
            correlation_id: Uuid::new_v4(),
        };
        let command = match insert_pending_command(&mut transaction, tenant, &command).await? {
            CommandInsertOutcome::Inserted(command) => command,
            CommandInsertOutcome::Existing(command) => {
                return replay(transaction, command).await;
            }
        };
        let family = sqlx::query(
            "SELECT version, primary_representative_id FROM airhop_families \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3 \
              AND status = 'active' FOR UPDATE",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(input.family_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| DbError::NotFound("active AirHub family".to_owned()))?;
        let current_version: i64 = family.try_get("version")?;
        let previous_representative_id: Uuid = family.try_get("primary_representative_id")?;
        if current_version != input.expected_version {
            return Err(DbError::AirhopVersionConflict);
        }
        ensure_available_representative(
            &mut transaction,
            tenant,
            organization_id,
            input.family_id,
            input.representative_id,
        )
        .await?;
        let version = if previous_representative_id == input.representative_id {
            current_version
        } else {
            let version = sqlx::query_scalar(
                "UPDATE airhop_families SET primary_representative_id = $4, \
                 version = version + 1, updated_at = $5 \
                 WHERE community_id = $1 AND organization_id = $2 AND id = $3 \
                  AND version = $6 RETURNING version",
            )
            .bind(tenant.community().as_uuid())
            .bind(organization_id)
            .bind(input.family_id)
            .bind(input.representative_id)
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
                    event_type: "airhop.family.primary_representative_changed.v1".to_owned(),
                    schema_version: 1,
                    occurred_at,
                    actor: input.actor.clone(),
                    causation_id: command.id,
                    correlation_id: command.correlation_id,
                    payload: json!({
                        "familyId": input.family_id,
                        "previousRepresentativeId": previous_representative_id,
                        "representativeId": input.representative_id
                    }),
                    privacy_class: PrivacyClass::Pii,
                },
            )
            .await?;
            version
        };
        let stored = StoredResult {
            family_id: input.family_id,
            representative_id: input.representative_id,
            previous_representative_id,
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
        Ok(SetFamilyPrimaryRepresentativeOutcome {
            family_id: stored.family_id,
            representative_id: stored.representative_id,
            previous_representative_id: stored.previous_representative_id,
            version: stored.version,
            replayed: false,
        })
    }
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

async fn ensure_available_representative(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    family_id: Uuid,
    representative_id: Uuid,
) -> Result<()> {
    let representative = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM airhop_representatives WHERE community_id = $1 \
         AND organization_id = $2 AND family_id = $3 AND id = $4 \
          AND status = 'active' FOR SHARE",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(family_id)
    .bind(representative_id)
    .fetch_optional(&mut **transaction)
    .await?;
    if representative.is_none() {
        return Err(DbError::AirhopRepresentativeUnavailable);
    }
    Ok(())
}

async fn replay(
    transaction: Transaction<'_, Postgres>,
    command: super::AirhopCommand,
) -> Result<SetFamilyPrimaryRepresentativeOutcome> {
    match command.status {
        CommandStatus::Pending => Err(DbError::AirhopCommandInProgress),
        CommandStatus::Failed => Err(DbError::AirhopCommandPreviouslyFailed),
        CommandStatus::Committed => {
            let stored: StoredResult =
                serde_json::from_value(command.result.ok_or_else(|| {
                    DbError::InvalidData("committed AirHub command has no result".to_owned())
                })?)?;
            transaction.commit().await?;
            Ok(SetFamilyPrimaryRepresentativeOutcome {
                family_id: stored.family_id,
                representative_id: stored.representative_id,
                previous_representative_id: stored.previous_representative_id,
                version: stored.version,
                replayed: true,
            })
        }
    }
}

fn validate_input(input: &SetFamilyPrimaryRepresentativeInput) -> Result<()> {
    input.actor.validate()?;
    if input.family_id.is_nil()
        || input.representative_id.is_nil()
        || input.expected_version < 1
        || input.actor.kind != ActorKind::Staff
    {
        return Err(DbError::InvalidData(
            "AirHub primary representative command is invalid".to_owned(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn primary_representative_command_requires_staff_and_versions() {
        let input = SetFamilyPrimaryRepresentativeInput {
            family_id: Uuid::new_v4(),
            representative_id: Uuid::new_v4(),
            expected_version: 2,
            idempotency_digest: [1; 32],
            request_hash: [2; 32],
            actor: AirhopActor {
                kind: ActorKind::Staff,
                pubkey: Some([3; 32]),
                on_behalf_of_pubkey: None,
                agent_pubkey: None,
            },
        };
        assert!(validate_input(&input).is_ok());
        assert!(validate_input(&SetFamilyPrimaryRepresentativeInput {
            expected_version: 0,
            ..input
        })
        .is_err());
    }
}
