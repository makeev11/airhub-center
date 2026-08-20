//! Idempotent staff commands for adding members to an existing family.

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

const ADD_REPRESENTATIVE_COMMAND_TYPE: &str = "AddFamilyRepresentative";
const ADD_CHILD_COMMAND_TYPE: &str = "AddFamilyChild";

/// New representative attached to an existing active family.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AddFamilyRepresentativeInput {
    /// Family receiving the representative.
    pub family_id: Uuid,
    /// Representative name.
    pub display_name: String,
    /// Exact first name when supplied by the staff client.
    pub first_name: Option<String>,
    /// Exact last name when supplied by the staff client.
    pub last_name: Option<String>,
    /// E.164 phone produced by the trusted HTTP boundary.
    pub phone_normalized: String,
    /// Human-readable phone entered by staff.
    pub phone_display: String,
    /// Tenant-keyed phone matching digest.
    pub phone_match_digest: [u8; 32],
    /// Service contact preference.
    pub preferred_contact_channel: String,
    /// Keyed digest of the HTTP idempotency key.
    pub idempotency_digest: [u8; 32],
    /// Hash of the canonical HTTP body.
    pub request_hash: [u8; 32],
    /// Verified staff attribution.
    pub actor: AirhopActor,
}

/// Result of adding or replaying a representative.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AddFamilyRepresentativeOutcome {
    /// Created representative.
    pub representative_id: Uuid,
    /// Whether duplicate review is required.
    pub has_pending_duplicate: bool,
    /// True when an existing command receipt was replayed.
    pub replayed: bool,
}

/// New child attached to an existing active family.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AddFamilyChildInput {
    /// Family receiving the child.
    pub family_id: Uuid,
    /// Child name.
    pub display_name: String,
    /// Exact first name when supplied by the staff client.
    pub first_name: Option<String>,
    /// Exact last name when supplied by the staff client.
    pub last_name: Option<String>,
    /// Exact birth date.
    pub birth_date: NaiveDate,
    /// Optional internal staff note.
    pub note: Option<String>,
    /// Keyed digest of the HTTP idempotency key.
    pub idempotency_digest: [u8; 32],
    /// Hash of the canonical HTTP body.
    pub request_hash: [u8; 32],
    /// Verified staff attribution.
    pub actor: AirhopActor,
}

/// Result of adding or replaying a child.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AddFamilyChildOutcome {
    /// Created child.
    pub child_id: Uuid,
    /// Whether duplicate review is required.
    pub has_pending_duplicate: bool,
    /// True when an existing command receipt was replayed.
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredRepresentativeResult {
    representative_id: Uuid,
    has_pending_duplicate: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredChildResult {
    child_id: Uuid,
    has_pending_duplicate: bool,
}

impl Db {
    /// Adds one active representative and records its family edge.
    pub async fn add_airhop_family_representative(
        &self,
        tenant: &TenantContext,
        input: &AddFamilyRepresentativeInput,
    ) -> Result<AddFamilyRepresentativeOutcome> {
        validate_representative(input)?;
        let mut transaction = self.pool.begin().await?;
        let (organization_id, occurred_at, _) =
            resolve_active_organization(&mut transaction, tenant).await?;
        let command = NewAirhopCommand {
            id: Uuid::new_v4(),
            organization_id,
            command_type: ADD_REPRESENTATIVE_COMMAND_TYPE.to_owned(),
            idempotency_digest: input.idempotency_digest,
            request_hash: input.request_hash,
            actor: input.actor.clone(),
            correlation_id: Uuid::new_v4(),
        };
        let command = match insert_pending_command(&mut transaction, tenant, &command).await? {
            CommandInsertOutcome::Inserted(command) => command,
            CommandInsertOutcome::Existing(command) => {
                let stored: StoredRepresentativeResult =
                    replay_result(transaction, command).await?;
                return Ok(AddFamilyRepresentativeOutcome {
                    representative_id: stored.representative_id,
                    has_pending_duplicate: stored.has_pending_duplicate,
                    replayed: true,
                });
            }
        };
        ensure_active_family(&mut transaction, tenant, organization_id, input.family_id).await?;
        let representative_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO airhop_representatives (community_id, organization_id, id, \
                 family_id, display_name, first_name, last_name, phone_normalized, phone_display, \
                 phone_match_digest, preferred_contact_channel) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(representative_id)
        .bind(input.family_id)
        .bind(input.display_name.trim())
        .bind(normalized_name_part(input.first_name.as_deref()))
        .bind(normalized_name_part(input.last_name.as_deref()))
        .bind(&input.phone_normalized)
        .bind(input.phone_display.trim())
        .bind(input.phone_match_digest.as_slice())
        .bind(&input.preferred_contact_channel)
        .execute(&mut *transaction)
        .await?;
        create_phone_duplicate_candidates(
            &mut transaction,
            tenant,
            organization_id,
            representative_id,
            input,
        )
        .await?;
        let has_pending_duplicate =
            pending_duplicate(&mut transaction, tenant, organization_id, representative_id).await?;
        append_domain_event(
            &mut transaction,
            tenant,
            &NewDomainEvent {
                id: Uuid::new_v4(),
                organization_id,
                stream_type: "representative".to_owned(),
                stream_id: representative_id,
                stream_version: 1,
                event_type: "airhop.representative.created.v1".to_owned(),
                schema_version: 1,
                occurred_at,
                actor: input.actor.clone(),
                causation_id: command.id,
                correlation_id: command.correlation_id,
                payload: json!({
                    "familyId": input.family_id,
                    "representativeId": representative_id,
                    "hasPendingDuplicate": has_pending_duplicate
                }),
                privacy_class: PrivacyClass::Pii,
            },
        )
        .await?;
        let stored = StoredRepresentativeResult {
            representative_id,
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
        Ok(AddFamilyRepresentativeOutcome {
            representative_id,
            has_pending_duplicate,
            replayed: false,
        })
    }

    /// Adds one active child and records its family edge.
    pub async fn add_airhop_family_child(
        &self,
        tenant: &TenantContext,
        input: &AddFamilyChildInput,
    ) -> Result<AddFamilyChildOutcome> {
        validate_child(input)?;
        let mut transaction = self.pool.begin().await?;
        let (organization_id, occurred_at, current_date) =
            resolve_active_organization(&mut transaction, tenant).await?;
        if input.birth_date > current_date {
            return Err(DbError::InvalidData(
                "AirHub child birth date cannot be in the future".to_owned(),
            ));
        }
        let command = NewAirhopCommand {
            id: Uuid::new_v4(),
            organization_id,
            command_type: ADD_CHILD_COMMAND_TYPE.to_owned(),
            idempotency_digest: input.idempotency_digest,
            request_hash: input.request_hash,
            actor: input.actor.clone(),
            correlation_id: Uuid::new_v4(),
        };
        let command = match insert_pending_command(&mut transaction, tenant, &command).await? {
            CommandInsertOutcome::Inserted(command) => command,
            CommandInsertOutcome::Existing(command) => {
                let stored: StoredChildResult = replay_result(transaction, command).await?;
                return Ok(AddFamilyChildOutcome {
                    child_id: stored.child_id,
                    has_pending_duplicate: stored.has_pending_duplicate,
                    replayed: true,
                });
            }
        };
        ensure_active_family(&mut transaction, tenant, organization_id, input.family_id).await?;
        let child_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO airhop_children (community_id, organization_id, id, family_id, \
                 display_name, first_name, last_name, birth_date, note) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(child_id)
        .bind(input.family_id)
        .bind(input.display_name.trim())
        .bind(normalized_name_part(input.first_name.as_deref()))
        .bind(normalized_name_part(input.last_name.as_deref()))
        .bind(input.birth_date)
        .bind(normalized_note(input.note.as_deref()))
        .execute(&mut *transaction)
        .await?;
        create_child_duplicate_candidates(
            &mut transaction,
            tenant,
            organization_id,
            child_id,
            input,
        )
        .await?;
        let has_pending_duplicate =
            pending_duplicate(&mut transaction, tenant, organization_id, child_id).await?;
        append_domain_event(
            &mut transaction,
            tenant,
            &NewDomainEvent {
                id: Uuid::new_v4(),
                organization_id,
                stream_type: "child".to_owned(),
                stream_id: child_id,
                stream_version: 1,
                event_type: "airhop.child.created.v1".to_owned(),
                schema_version: 1,
                occurred_at,
                actor: input.actor.clone(),
                causation_id: command.id,
                correlation_id: command.correlation_id,
                payload: json!({
                    "familyId": input.family_id,
                    "childId": child_id,
                    "hasPendingDuplicate": has_pending_duplicate
                }),
                privacy_class: PrivacyClass::SensitiveChild,
            },
        )
        .await?;
        let stored = StoredChildResult {
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
        Ok(AddFamilyChildOutcome {
            child_id,
            has_pending_duplicate,
            replayed: false,
        })
    }
}

async fn resolve_active_organization(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
) -> Result<(Uuid, DateTime<Utc>, NaiveDate)> {
    let row = sqlx::query(
        "SELECT id, now() AS occurred_at, \
                (now() AT TIME ZONE time_zone)::date AS current_date \
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

async fn ensure_active_family(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    family_id: Uuid,
) -> Result<()> {
    let exists = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM airhop_families WHERE community_id = $1 \
         AND organization_id = $2 AND id = $3 AND status = 'active' FOR SHARE",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(family_id)
    .fetch_optional(&mut **transaction)
    .await?;
    if exists.is_none() {
        return Err(DbError::NotFound("active AirHub family".to_owned()));
    }
    Ok(())
}

async fn create_phone_duplicate_candidates(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    representative_id: Uuid,
    input: &AddFamilyRepresentativeInput,
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
    .bind(input.phone_match_digest.as_slice())
    .bind(&input.phone_normalized)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn create_child_duplicate_candidates(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    child_id: Uuid,
    input: &AddFamilyChildInput,
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
    .bind(input.display_name.trim())
    .bind(input.birth_date)
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

fn validate_representative(input: &AddFamilyRepresentativeInput) -> Result<()> {
    input.actor.validate()?;
    if input.family_id.is_nil()
        || input.actor.kind != ActorKind::Staff
        || !bounded(&input.display_name, 160)
        || !valid_structured_name(input.first_name.as_deref(), input.last_name.as_deref())
        || !bounded(&input.phone_display, 80)
        || !valid_e164(&input.phone_normalized)
        || !matches!(
            input.preferred_contact_channel.as_str(),
            "telegram" | "max" | "whatsapp" | "phone" | "none"
        )
    {
        return Err(DbError::InvalidData(
            "AirHub representative creation is invalid".to_owned(),
        ));
    }
    Ok(())
}

fn validate_child(input: &AddFamilyChildInput) -> Result<()> {
    input.actor.validate()?;
    if input.family_id.is_nil()
        || input.actor.kind != ActorKind::Staff
        || !bounded(&input.display_name, 160)
        || !valid_structured_name(input.first_name.as_deref(), input.last_name.as_deref())
        || input
            .note
            .as_ref()
            .is_some_and(|note| note.trim().chars().count() > 4_000)
    {
        return Err(DbError::InvalidData(
            "AirHub child creation is invalid".to_owned(),
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
    fn member_inputs_are_bounded_and_staff_only() {
        let representative = AddFamilyRepresentativeInput {
            family_id: Uuid::new_v4(),
            display_name: "Мария".to_owned(),
            first_name: Some("Мария".to_owned()),
            last_name: Some("Иванова".to_owned()),
            phone_normalized: "+79991234567".to_owned(),
            phone_display: "+7 999 123-45-67".to_owned(),
            phone_match_digest: [2; 32],
            preferred_contact_channel: "telegram".to_owned(),
            idempotency_digest: [3; 32],
            request_hash: [4; 32],
            actor: actor(),
        };
        assert!(validate_representative(&representative).is_ok());
        assert!(validate_representative(&AddFamilyRepresentativeInput {
            last_name: None,
            ..representative.clone()
        })
        .is_err());
        assert!(validate_representative(&AddFamilyRepresentativeInput {
            phone_normalized: "8999".to_owned(),
            ..representative
        })
        .is_err());

        let child = AddFamilyChildInput {
            family_id: Uuid::new_v4(),
            display_name: "Анна".to_owned(),
            first_name: Some("Анна".to_owned()),
            last_name: Some("Иванова".to_owned()),
            birth_date: NaiveDate::from_ymd_opt(2019, 5, 20).expect("date"),
            note: Some(" Аллергия ".to_owned()),
            idempotency_digest: [5; 32],
            request_hash: [6; 32],
            actor: actor(),
        };
        assert!(validate_child(&child).is_ok());
        assert_eq!(
            normalized_note(child.note.as_deref()).as_deref(),
            Some("Аллергия")
        );
    }
}
