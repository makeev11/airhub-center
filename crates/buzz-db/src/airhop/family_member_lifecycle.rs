//! Explicit archive and restore commands for family-owned members.

use buzz_core::TenantContext;
use chrono::{DateTime, NaiveDate, Utc};
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

const SET_REPRESENTATIVE_STATUS_COMMAND_TYPE: &str = "SetFamilyRepresentativeStatus";
const SET_CHILD_STATUS_COMMAND_TYPE: &str = "SetFamilyChildStatus";

/// Explicit lifecycle target for a family member.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FamilyMemberStatus {
    /// Member can participate in new operations.
    Active,
    /// Member is historical and excluded from new operations.
    Archived,
}

impl FamilyMemberStatus {
    const fn as_db_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Archived => "archived",
        }
    }

    const fn representative_event_type(self) -> &'static str {
        match self {
            Self::Active => "airhop.representative.restored.v1",
            Self::Archived => "airhop.representative.archived.v1",
        }
    }

    const fn child_event_type(self) -> &'static str {
        match self {
            Self::Active => "airhop.child.restored.v1",
            Self::Archived => "airhop.child.archived.v1",
        }
    }
}

/// Archive or restore one representative.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SetFamilyRepresentativeStatusInput {
    /// Owning family.
    pub family_id: Uuid,
    /// Representative to transition.
    pub representative_id: Uuid,
    /// Version observed by staff.
    pub expected_version: i64,
    /// Explicit target state.
    pub status: FamilyMemberStatus,
    /// Keyed digest of the HTTP idempotency key.
    pub idempotency_digest: [u8; 32],
    /// Hash of the canonical HTTP body.
    pub request_hash: [u8; 32],
    /// Verified staff attribution.
    pub actor: AirhopActor,
}

/// Result of a representative lifecycle command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SetFamilyRepresentativeStatusOutcome {
    /// Transitioned representative.
    pub representative_id: Uuid,
    /// Persisted lifecycle.
    pub status: FamilyMemberStatus,
    /// New or unchanged version.
    pub version: i64,
    /// Whether duplicate review is pending.
    pub has_pending_duplicate: bool,
    /// True when an existing command receipt was replayed.
    pub replayed: bool,
}

/// Archive or restore one child.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SetFamilyChildStatusInput {
    /// Owning family.
    pub family_id: Uuid,
    /// Child to transition.
    pub child_id: Uuid,
    /// Version observed by staff.
    pub expected_version: i64,
    /// Explicit target state.
    pub status: FamilyMemberStatus,
    /// Keyed digest of the HTTP idempotency key.
    pub idempotency_digest: [u8; 32],
    /// Hash of the canonical HTTP body.
    pub request_hash: [u8; 32],
    /// Verified staff attribution.
    pub actor: AirhopActor,
}

/// Result of a child lifecycle command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SetFamilyChildStatusOutcome {
    /// Transitioned child.
    pub child_id: Uuid,
    /// Persisted lifecycle.
    pub status: FamilyMemberStatus,
    /// New or unchanged version.
    pub version: i64,
    /// Whether duplicate review is pending.
    pub has_pending_duplicate: bool,
    /// True when an existing command receipt was replayed.
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredRepresentativeStatusResult {
    representative_id: Uuid,
    status: FamilyMemberStatus,
    version: i64,
    has_pending_duplicate: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredChildStatusResult {
    child_id: Uuid,
    status: FamilyMemberStatus,
    version: i64,
    has_pending_duplicate: bool,
}

#[derive(Debug)]
struct RepresentativeRow {
    status: String,
    version: i64,
    primary_representative_id: Uuid,
    phone_normalized: String,
    phone_match_digest: Vec<u8>,
}

#[derive(Debug)]
struct ChildRow {
    status: String,
    version: i64,
    display_name: String,
    birth_date: NaiveDate,
}

impl Db {
    /// Archives or restores a non-primary representative without deleting history.
    pub async fn set_airhop_family_representative_status(
        &self,
        tenant: &TenantContext,
        input: &SetFamilyRepresentativeStatusInput,
    ) -> Result<SetFamilyRepresentativeStatusOutcome> {
        validate_representative(input)?;
        let mut transaction = self.pool.begin().await?;
        let (organization_id, occurred_at) =
            resolve_active_organization(&mut transaction, tenant).await?;
        let command = NewAirhopCommand {
            id: Uuid::new_v4(),
            organization_id,
            command_type: SET_REPRESENTATIVE_STATUS_COMMAND_TYPE.to_owned(),
            idempotency_digest: input.idempotency_digest,
            request_hash: input.request_hash,
            actor: input.actor.clone(),
            correlation_id: Uuid::new_v4(),
        };
        let command = match insert_pending_command(&mut transaction, tenant, &command).await? {
            CommandInsertOutcome::Inserted(command) => command,
            CommandInsertOutcome::Existing(command) => {
                let stored: StoredRepresentativeStatusResult =
                    replay_result(transaction, command).await?;
                return Ok(SetFamilyRepresentativeStatusOutcome {
                    representative_id: stored.representative_id,
                    status: stored.status,
                    version: stored.version,
                    has_pending_duplicate: stored.has_pending_duplicate,
                    replayed: true,
                });
            }
        };
        ensure_active_family(&mut transaction, tenant, organization_id, input.family_id).await?;
        let row = load_representative(&mut transaction, tenant, organization_id, input).await?;
        if row.version != input.expected_version {
            return Err(DbError::AirhopVersionConflict);
        }
        if row.status != input.status.as_db_str() && input.status == FamilyMemberStatus::Archived {
            if row.primary_representative_id == input.representative_id {
                return Err(DbError::AirhopPrimaryRepresentativeRequired);
            }
            if representative_has_future_booking(
                &mut transaction,
                tenant,
                organization_id,
                input.representative_id,
            )
            .await?
            {
                return Err(DbError::AirhopMemberHasActiveCommitments);
            }
        }
        let version = update_representative_status(
            &mut transaction,
            tenant,
            organization_id,
            occurred_at,
            input,
            &row,
        )
        .await?;
        if row.status != input.status.as_db_str() && input.status == FamilyMemberStatus::Active {
            create_phone_duplicate_candidates(
                &mut transaction,
                tenant,
                organization_id,
                input.representative_id,
                &row,
            )
            .await?;
        }
        let has_pending_duplicate = pending_duplicate(
            &mut transaction,
            tenant,
            organization_id,
            input.representative_id,
        )
        .await?;
        if row.status != input.status.as_db_str() {
            append_member_event(
                &mut transaction,
                tenant,
                organization_id,
                occurred_at,
                &command,
                &input.actor,
                "representative",
                input.representative_id,
                version,
                input.status.representative_event_type(),
                input.family_id,
                input.status,
                has_pending_duplicate,
                PrivacyClass::Pii,
            )
            .await?;
        }
        let stored = StoredRepresentativeStatusResult {
            representative_id: input.representative_id,
            status: input.status,
            version,
            has_pending_duplicate,
        };
        commit_and_finish(
            &mut transaction,
            tenant,
            organization_id,
            command.id,
            &stored,
        )
        .await?;
        transaction.commit().await?;
        Ok(SetFamilyRepresentativeStatusOutcome {
            representative_id: stored.representative_id,
            status: stored.status,
            version: stored.version,
            has_pending_duplicate: stored.has_pending_duplicate,
            replayed: false,
        })
    }

    /// Archives or restores a child without deleting enrollment or booking history.
    pub async fn set_airhop_family_child_status(
        &self,
        tenant: &TenantContext,
        input: &SetFamilyChildStatusInput,
    ) -> Result<SetFamilyChildStatusOutcome> {
        validate_child(input)?;
        let mut transaction = self.pool.begin().await?;
        let (organization_id, occurred_at) =
            resolve_active_organization(&mut transaction, tenant).await?;
        let command = NewAirhopCommand {
            id: Uuid::new_v4(),
            organization_id,
            command_type: SET_CHILD_STATUS_COMMAND_TYPE.to_owned(),
            idempotency_digest: input.idempotency_digest,
            request_hash: input.request_hash,
            actor: input.actor.clone(),
            correlation_id: Uuid::new_v4(),
        };
        let command = match insert_pending_command(&mut transaction, tenant, &command).await? {
            CommandInsertOutcome::Inserted(command) => command,
            CommandInsertOutcome::Existing(command) => {
                let stored: StoredChildStatusResult = replay_result(transaction, command).await?;
                return Ok(SetFamilyChildStatusOutcome {
                    child_id: stored.child_id,
                    status: stored.status,
                    version: stored.version,
                    has_pending_duplicate: stored.has_pending_duplicate,
                    replayed: true,
                });
            }
        };
        ensure_active_family(&mut transaction, tenant, organization_id, input.family_id).await?;
        let row = load_child(&mut transaction, tenant, organization_id, input).await?;
        if row.version != input.expected_version {
            return Err(DbError::AirhopVersionConflict);
        }
        if row.status != input.status.as_db_str()
            && input.status == FamilyMemberStatus::Archived
            && child_has_active_commitments(
                &mut transaction,
                tenant,
                organization_id,
                input.child_id,
            )
            .await?
        {
            return Err(DbError::AirhopMemberHasActiveCommitments);
        }
        let version = update_child_status(
            &mut transaction,
            tenant,
            organization_id,
            occurred_at,
            input,
            &row,
        )
        .await?;
        if row.status != input.status.as_db_str() && input.status == FamilyMemberStatus::Active {
            create_child_duplicate_candidates(
                &mut transaction,
                tenant,
                organization_id,
                input.child_id,
                &row,
            )
            .await?;
        }
        let has_pending_duplicate =
            pending_duplicate(&mut transaction, tenant, organization_id, input.child_id).await?;
        if row.status != input.status.as_db_str() {
            append_member_event(
                &mut transaction,
                tenant,
                organization_id,
                occurred_at,
                &command,
                &input.actor,
                "child",
                input.child_id,
                version,
                input.status.child_event_type(),
                input.family_id,
                input.status,
                has_pending_duplicate,
                PrivacyClass::SensitiveChild,
            )
            .await?;
        }
        let stored = StoredChildStatusResult {
            child_id: input.child_id,
            status: input.status,
            version,
            has_pending_duplicate,
        };
        commit_and_finish(
            &mut transaction,
            tenant,
            organization_id,
            command.id,
            &stored,
        )
        .await?;
        transaction.commit().await?;
        Ok(SetFamilyChildStatusOutcome {
            child_id: stored.child_id,
            status: stored.status,
            version: stored.version,
            has_pending_duplicate: stored.has_pending_duplicate,
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

async fn ensure_active_family(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    family_id: Uuid,
) -> Result<()> {
    let family = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM airhop_families WHERE community_id = $1 \
         AND organization_id = $2 AND id = $3 AND status = 'active' FOR SHARE",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(family_id)
    .fetch_optional(&mut **transaction)
    .await?;
    if family.is_none() {
        return Err(DbError::NotFound("active AirHub family".to_owned()));
    }
    Ok(())
}

async fn load_representative(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    input: &SetFamilyRepresentativeStatusInput,
) -> Result<RepresentativeRow> {
    let row = sqlx::query(
        "SELECT representative.status, representative.version, \
                family.primary_representative_id, representative.phone_normalized, \
                representative.phone_match_digest \
         FROM airhop_representatives representative \
         JOIN airhop_families family ON family.community_id = representative.community_id \
          AND family.organization_id = representative.organization_id \
          AND family.id = representative.family_id \
         WHERE representative.community_id = $1 AND representative.organization_id = $2 \
          AND representative.family_id = $3 AND representative.id = $4 \
         FOR UPDATE OF representative",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(input.family_id)
    .bind(input.representative_id)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or_else(|| DbError::NotFound("AirHub family representative".to_owned()))?;
    Ok(RepresentativeRow {
        status: row.try_get("status")?,
        version: row.try_get("version")?,
        primary_representative_id: row.try_get("primary_representative_id")?,
        phone_normalized: row.try_get("phone_normalized")?,
        phone_match_digest: row.try_get("phone_match_digest")?,
    })
}

async fn load_child(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    input: &SetFamilyChildStatusInput,
) -> Result<ChildRow> {
    let row = sqlx::query(
        "SELECT status, version, display_name, birth_date FROM airhop_children \
         WHERE community_id = $1 AND organization_id = $2 AND family_id = $3 AND id = $4 \
         FOR UPDATE",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(input.family_id)
    .bind(input.child_id)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or_else(|| DbError::NotFound("AirHub family child".to_owned()))?;
    Ok(ChildRow {
        status: row.try_get("status")?,
        version: row.try_get("version")?,
        display_name: row.try_get("display_name")?,
        birth_date: row.try_get("birth_date")?,
    })
}

async fn representative_has_future_booking(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    representative_id: Uuid,
) -> Result<bool> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM airhop_bookings booking \
         JOIN airhop_lesson_occurrences occurrence \
          ON occurrence.community_id = booking.community_id \
          AND occurrence.organization_id = booking.organization_id \
          AND occurrence.recurrence_rule_id = booking.recurrence_rule_id \
          AND occurrence.original_date = booking.original_date \
         WHERE booking.community_id = $1 AND booking.organization_id = $2 \
          AND booking.representative_id = $3 \
          AND booking.status IN ('pending_confirmation', 'confirmed') \
          AND occurrence.status <> 'cancelled' AND occurrence.starts_at > now())",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(representative_id)
    .fetch_one(&mut **transaction)
    .await?)
}

async fn child_has_active_commitments(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    child_id: Uuid,
) -> Result<bool> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM airhop_enrollments enrollment \
          WHERE enrollment.community_id = $1 AND enrollment.organization_id = $2 \
           AND enrollment.child_id = $3 AND enrollment.status IN ('active', 'paused')) \
         OR EXISTS (SELECT 1 FROM airhop_bookings booking \
          JOIN airhop_lesson_occurrences occurrence \
           ON occurrence.community_id = booking.community_id \
           AND occurrence.organization_id = booking.organization_id \
           AND occurrence.recurrence_rule_id = booking.recurrence_rule_id \
           AND occurrence.original_date = booking.original_date \
          WHERE booking.community_id = $1 AND booking.organization_id = $2 \
           AND booking.child_id = $3 \
           AND booking.status IN ('pending_confirmation', 'confirmed') \
           AND occurrence.status <> 'cancelled' AND occurrence.starts_at > now())",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(child_id)
    .fetch_one(&mut **transaction)
    .await?)
}

async fn update_representative_status(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    occurred_at: DateTime<Utc>,
    input: &SetFamilyRepresentativeStatusInput,
    row: &RepresentativeRow,
) -> Result<i64> {
    if row.status == input.status.as_db_str() {
        return Ok(row.version);
    }
    sqlx::query_scalar(
        "UPDATE airhop_representatives SET status = $5, version = version + 1, updated_at = $6 \
         WHERE community_id = $1 AND organization_id = $2 AND family_id = $3 AND id = $4 \
          AND version = $7 RETURNING version",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(input.family_id)
    .bind(input.representative_id)
    .bind(input.status.as_db_str())
    .bind(occurred_at)
    .bind(input.expected_version)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or(DbError::AirhopVersionConflict)
}

async fn update_child_status(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    occurred_at: DateTime<Utc>,
    input: &SetFamilyChildStatusInput,
    row: &ChildRow,
) -> Result<i64> {
    if row.status == input.status.as_db_str() {
        return Ok(row.version);
    }
    sqlx::query_scalar(
        "UPDATE airhop_children SET status = $5, version = version + 1, updated_at = $6 \
         WHERE community_id = $1 AND organization_id = $2 AND family_id = $3 AND id = $4 \
          AND version = $7 RETURNING version",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(input.family_id)
    .bind(input.child_id)
    .bind(input.status.as_db_str())
    .bind(occurred_at)
    .bind(input.expected_version)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or(DbError::AirhopVersionConflict)
}

#[allow(clippy::too_many_arguments)]
async fn append_member_event(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    occurred_at: DateTime<Utc>,
    command: &AirhopCommand,
    actor: &AirhopActor,
    stream_type: &str,
    stream_id: Uuid,
    stream_version: i64,
    event_type: &str,
    family_id: Uuid,
    status: FamilyMemberStatus,
    has_pending_duplicate: bool,
    privacy_class: PrivacyClass,
) -> Result<()> {
    append_domain_event(
        transaction,
        tenant,
        &NewDomainEvent {
            id: Uuid::new_v4(),
            organization_id,
            stream_type: stream_type.to_owned(),
            stream_id,
            stream_version,
            event_type: event_type.to_owned(),
            schema_version: 1,
            occurred_at,
            actor: actor.clone(),
            causation_id: command.id,
            correlation_id: command.correlation_id,
            payload: json!({
                "familyId": family_id,
                "entityId": stream_id,
                "status": status,
                "hasPendingDuplicate": has_pending_duplicate
            }),
            privacy_class,
        },
    )
    .await
    .map(|_| ())
}

async fn create_phone_duplicate_candidates(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    representative_id: Uuid,
    row: &RepresentativeRow,
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
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(representative_id)
    .bind(&row.phone_match_digest)
    .bind(&row.phone_normalized)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn create_child_duplicate_candidates(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    child_id: Uuid,
    row: &ChildRow,
) -> Result<()> {
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
    .bind(&row.display_name)
    .bind(row.birth_date)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn pending_duplicate(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    entity_id: Uuid,
) -> Result<bool> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM airhop_duplicate_candidates WHERE community_id = $1 \
         AND organization_id = $2 AND status = 'pending' \
         AND (new_entity_id = $3 OR existing_entity_id = $3))",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(entity_id)
    .fetch_one(&mut **transaction)
    .await?)
}

async fn commit_and_finish<T: Serialize>(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    command_id: Uuid,
    result: &T,
) -> Result<()> {
    commit_command(
        transaction,
        tenant,
        organization_id,
        command_id,
        &serde_json::to_value(result)?,
    )
    .await
    .map(|_| ())
}

async fn replay_result<T: for<'de> Deserialize<'de>>(
    transaction: Transaction<'_, Postgres>,
    command: AirhopCommand,
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

fn validate_representative(input: &SetFamilyRepresentativeStatusInput) -> Result<()> {
    input.actor.validate()?;
    if input.family_id.is_nil()
        || input.representative_id.is_nil()
        || input.expected_version < 1
        || input.actor.kind != ActorKind::Staff
    {
        return Err(DbError::InvalidData(
            "AirHub representative lifecycle command is invalid".to_owned(),
        ));
    }
    Ok(())
}

fn validate_child(input: &SetFamilyChildStatusInput) -> Result<()> {
    input.actor.validate()?;
    if input.family_id.is_nil()
        || input.child_id.is_nil()
        || input.expected_version < 1
        || input.actor.kind != ActorKind::Staff
    {
        return Err(DbError::InvalidData(
            "AirHub child lifecycle command is invalid".to_owned(),
        ));
    }
    Ok(())
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
    fn member_lifecycle_requires_explicit_staff_scoped_identity() {
        let representative = SetFamilyRepresentativeStatusInput {
            family_id: Uuid::new_v4(),
            representative_id: Uuid::new_v4(),
            expected_version: 2,
            status: FamilyMemberStatus::Archived,
            idempotency_digest: [2; 32],
            request_hash: [3; 32],
            actor: actor(),
        };
        assert!(validate_representative(&representative).is_ok());
        assert!(
            validate_representative(&SetFamilyRepresentativeStatusInput {
                expected_version: 0,
                ..representative
            })
            .is_err()
        );
        assert!(validate_child(&SetFamilyChildStatusInput {
            family_id: Uuid::new_v4(),
            child_id: Uuid::new_v4(),
            expected_version: 1,
            status: FamilyMemberStatus::Active,
            idempotency_digest: [4; 32],
            request_hash: [5; 32],
            actor: actor(),
        })
        .is_ok());
    }
}
