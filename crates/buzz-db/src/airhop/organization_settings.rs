//! Authoritative organization bootstrap and settings updates.
//!
//! The first settings write creates the tenant's one AirHub organization.
//! Later writes replace the complete staff-editable settings aggregate with
//! optimistic concurrency, an idempotent command receipt, and one audit event.

use airhop_core::OrganizationSettings;
use buzz_core::TenantContext;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

use super::{
    append_domain_event, commit_command, insert_pending_command, onboarding_status_str,
    parse_organization_row, public_appearance_str, public_purpose_str, ActorKind, AirhopActor,
    AirhopOrganization, CommandInsertOutcome, CommandStatus, NewAirhopCommand, NewDomainEvent,
    OrganizationStatus, PrivacyClass,
};
use crate::{Db, DbError, Result};

const PUT_ORGANIZATION_SETTINGS_COMMAND_TYPE: &str = "PutOrganizationSettings";

/// Complete staff-editable organization settings replacement.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PutOrganizationSettingsInput {
    /// Version observed by the staff client, or zero for initial setup.
    pub expected_version: i64,
    /// Organization display name.
    pub name: String,
    /// BCP-47/Intl locale string.
    pub locale: String,
    /// IANA time-zone name.
    pub time_zone: String,
    /// Operational defaults and public-booking presentation.
    pub settings: OrganizationSettings,
    /// Keyed digest of the HTTP idempotency key.
    pub idempotency_digest: [u8; 32],
    /// Hash of the canonical HTTP body.
    pub request_hash: [u8; 32],
    /// Verified Buzz member attribution.
    pub actor: AirhopActor,
}

/// Result of bootstrapping or updating organization settings.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PutOrganizationSettingsOutcome {
    /// Server-owned organization identifier.
    pub organization_id: Uuid,
    /// New or unchanged optimistic version.
    pub version: i64,
    /// True when an existing command receipt was replayed.
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredOrganizationSettingsResult {
    organization_id: Uuid,
    version: i64,
}

impl Db {
    /// Creates or replaces the tenant's organization settings atomically.
    pub async fn put_airhop_organization_settings(
        &self,
        tenant: &TenantContext,
        input: &PutOrganizationSettingsInput,
    ) -> Result<PutOrganizationSettingsOutcome> {
        validate_input(input)?;
        let mut transaction = self.pool.begin().await?;

        // The organization row does not exist during bootstrap, so a row lock
        // alone cannot serialize two first writes. A tenant-keyed transaction
        // advisory lock closes that race without introducing a global lock.
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 4107))")
            .bind(tenant.community().as_uuid())
            .execute(&mut *transaction)
            .await?;

        let current = load_locked_organization(&mut transaction, tenant).await?;
        let organization_id = current
            .as_ref()
            .map_or_else(Uuid::new_v4, |organization| organization.id);
        let occurred_at: DateTime<Utc> = sqlx::query_scalar("SELECT now()")
            .fetch_one(&mut *transaction)
            .await?;

        if current.is_none() {
            if input.expected_version != 0 {
                return Err(DbError::AirhopVersionConflict);
            }
            insert_organization(
                &mut transaction,
                tenant,
                organization_id,
                input,
                occurred_at,
            )
            .await?;
        }

        let command_input = NewAirhopCommand {
            id: Uuid::new_v4(),
            organization_id,
            command_type: PUT_ORGANIZATION_SETTINGS_COMMAND_TYPE.to_owned(),
            idempotency_digest: input.idempotency_digest,
            request_hash: input.request_hash,
            actor: input.actor.clone(),
            correlation_id: Uuid::new_v4(),
        };
        let command = match insert_pending_command(&mut transaction, tenant, &command_input).await?
        {
            CommandInsertOutcome::Inserted(command) => command,
            CommandInsertOutcome::Existing(command) => {
                return replay_settings_write(transaction, command).await;
            }
        };

        let (version, event_type, changed_fields) = match current {
            None => (
                1,
                "airhop.organization.configured.v1",
                vec![
                    "name",
                    "locale",
                    "time_zone",
                    "default_trial_policy",
                    "track_attendance_by_default",
                    "allow_single_visits_by_default",
                    "existing_students_onboarding_status",
                    "public_booking_purpose",
                    "public_booking_appearance",
                    "payment_day_of_month",
                ],
            ),
            Some(current) => {
                if current.status != OrganizationStatus::Active {
                    return Err(DbError::NotFound("active AirHub organization".to_owned()));
                }
                if current.version != input.expected_version {
                    return Err(DbError::AirhopVersionConflict);
                }
                let changed_fields = changed_fields(&current, input);
                if changed_fields.is_empty() {
                    (current.version, "", changed_fields)
                } else {
                    let version = update_organization(
                        &mut transaction,
                        tenant,
                        organization_id,
                        input,
                        occurred_at,
                    )
                    .await?;
                    (
                        version,
                        "airhop.organization.settings-updated.v1",
                        changed_fields,
                    )
                }
            }
        };

        if !event_type.is_empty() {
            append_domain_event(
                &mut transaction,
                tenant,
                &NewDomainEvent {
                    id: Uuid::new_v4(),
                    organization_id,
                    stream_type: "organization".to_owned(),
                    stream_id: organization_id,
                    stream_version: version,
                    event_type: event_type.to_owned(),
                    schema_version: 1,
                    occurred_at,
                    actor: input.actor.clone(),
                    causation_id: command.id,
                    correlation_id: command.correlation_id,
                    payload: json!({
                        "organizationId": organization_id,
                        "changedFields": changed_fields,
                    }),
                    privacy_class: PrivacyClass::Operational,
                },
            )
            .await?;
        }

        let stored = StoredOrganizationSettingsResult {
            organization_id,
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
        Ok(PutOrganizationSettingsOutcome {
            organization_id,
            version,
            replayed: false,
        })
    }
}

async fn load_locked_organization(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: &TenantContext,
) -> Result<Option<AirhopOrganization>> {
    let row = sqlx::query(
        "SELECT id, name, locale, time_zone, default_trial_policy, \
                track_attendance_by_default, allow_single_visits_by_default, \
                existing_students_onboarding_status, public_booking_purpose, \
                public_booking_appearance, payment_day_of_month, status, version, \
                created_at, updated_at \
         FROM airhop_organizations \
         WHERE community_id = $1 \
         FOR UPDATE",
    )
    .bind(tenant.community().as_uuid())
    .fetch_optional(&mut **transaction)
    .await?;
    row.map(parse_organization_row).transpose()
}

async fn insert_organization(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    input: &PutOrganizationSettingsInput,
    occurred_at: DateTime<Utc>,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO airhop_organizations (\
             community_id, id, name, locale, time_zone, default_trial_policy, \
             track_attendance_by_default, allow_single_visits_by_default, \
             existing_students_onboarding_status, public_booking_purpose, \
             public_booking_appearance, payment_day_of_month, created_at, updated_at\
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(input.name.trim())
    .bind(input.locale.trim())
    .bind(input.time_zone.trim())
    .bind(serde_json::to_value(&input.settings.default_trial_policy)?)
    .bind(input.settings.track_attendance_by_default)
    .bind(input.settings.allow_single_visits_by_default)
    .bind(onboarding_status_str(
        input.settings.existing_students_onboarding_status,
    ))
    .bind(public_purpose_str(input.settings.public_booking_purpose))
    .bind(public_appearance_str(
        input.settings.public_booking_appearance,
    ))
    .bind(i16::from(input.settings.payment_day_of_month))
    .bind(occurred_at)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn update_organization(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    input: &PutOrganizationSettingsInput,
    occurred_at: DateTime<Utc>,
) -> Result<i64> {
    sqlx::query_scalar(
        "UPDATE airhop_organizations \
         SET name = $3, locale = $4, time_zone = $5, default_trial_policy = $6, \
             track_attendance_by_default = $7, allow_single_visits_by_default = $8, \
             existing_students_onboarding_status = $9, public_booking_purpose = $10, \
             public_booking_appearance = $11, payment_day_of_month = $12, \
             version = version + 1, updated_at = $13 \
         WHERE community_id = $1 AND id = $2 AND version = $14 AND status = 'active' \
         RETURNING version",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(input.name.trim())
    .bind(input.locale.trim())
    .bind(input.time_zone.trim())
    .bind(serde_json::to_value(&input.settings.default_trial_policy)?)
    .bind(input.settings.track_attendance_by_default)
    .bind(input.settings.allow_single_visits_by_default)
    .bind(onboarding_status_str(
        input.settings.existing_students_onboarding_status,
    ))
    .bind(public_purpose_str(input.settings.public_booking_purpose))
    .bind(public_appearance_str(
        input.settings.public_booking_appearance,
    ))
    .bind(i16::from(input.settings.payment_day_of_month))
    .bind(occurred_at)
    .bind(input.expected_version)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or(DbError::AirhopVersionConflict)
}

fn changed_fields(
    current: &AirhopOrganization,
    input: &PutOrganizationSettingsInput,
) -> Vec<&'static str> {
    let mut fields = Vec::new();
    if current.name != input.name.trim() {
        fields.push("name");
    }
    if current.locale != input.locale.trim() {
        fields.push("locale");
    }
    if current.time_zone != input.time_zone.trim() {
        fields.push("time_zone");
    }
    if current.settings.default_trial_policy != input.settings.default_trial_policy {
        fields.push("default_trial_policy");
    }
    if current.settings.track_attendance_by_default != input.settings.track_attendance_by_default {
        fields.push("track_attendance_by_default");
    }
    if current.settings.allow_single_visits_by_default
        != input.settings.allow_single_visits_by_default
    {
        fields.push("allow_single_visits_by_default");
    }
    if current.settings.existing_students_onboarding_status
        != input.settings.existing_students_onboarding_status
    {
        fields.push("existing_students_onboarding_status");
    }
    if current.settings.public_booking_purpose != input.settings.public_booking_purpose {
        fields.push("public_booking_purpose");
    }
    if current.settings.public_booking_appearance != input.settings.public_booking_appearance {
        fields.push("public_booking_appearance");
    }
    if current.settings.payment_day_of_month != input.settings.payment_day_of_month {
        fields.push("payment_day_of_month");
    }
    fields
}

async fn replay_settings_write(
    transaction: sqlx::Transaction<'_, sqlx::Postgres>,
    command: super::AirhopCommand,
) -> Result<PutOrganizationSettingsOutcome> {
    match command.status {
        CommandStatus::Pending => Err(DbError::AirhopCommandInProgress),
        CommandStatus::Failed => Err(DbError::AirhopCommandPreviouslyFailed),
        CommandStatus::Committed => {
            let stored: StoredOrganizationSettingsResult =
                serde_json::from_value(command.result.ok_or_else(|| {
                    DbError::InvalidData("committed AirHub command has no result".to_owned())
                })?)?;
            transaction.commit().await?;
            Ok(PutOrganizationSettingsOutcome {
                organization_id: stored.organization_id,
                version: stored.version,
                replayed: true,
            })
        }
    }
}

fn validate_input(input: &PutOrganizationSettingsInput) -> Result<()> {
    input.actor.validate()?;
    if input.expected_version < 0
        || input.actor.kind != ActorKind::Staff
        || input.name.trim().is_empty()
        || input.name.chars().count() > 160
        || input.locale.trim().len() < 2
        || input.locale.len() > 32
        || input.time_zone.trim().is_empty()
        || input.time_zone.len() > 80
    {
        return Err(DbError::InvalidData(
            "AirHub organization settings are invalid".to_owned(),
        ));
    }
    input
        .settings
        .validate()
        .map_err(|error| DbError::InvalidData(error.to_string()))
}

#[cfg(test)]
mod tests {
    use airhop_core::{
        ExistingStudentsOnboardingStatus, PublicBookingAppearance, PublicBookingPurpose,
        TrialPolicy,
    };

    use super::*;

    fn input() -> PutOrganizationSettingsInput {
        PutOrganizationSettingsInput {
            expected_version: 0,
            name: "Каляка Маляка".to_owned(),
            locale: "ru-RU".to_owned(),
            time_zone: "Europe/Moscow".to_owned(),
            settings: OrganizationSettings {
                default_trial_policy: TrialPolicy::Free,
                track_attendance_by_default: true,
                allow_single_visits_by_default: false,
                existing_students_onboarding_status: ExistingStudentsOnboardingStatus::NotStarted,
                public_booking_purpose: PublicBookingPurpose::Trial,
                public_booking_appearance: PublicBookingAppearance::Automatic,
                payment_day_of_month: 5,
            },
            idempotency_digest: [1; 32],
            request_hash: [2; 32],
            actor: AirhopActor {
                kind: ActorKind::Staff,
                pubkey: Some([3; 32]),
                on_behalf_of_pubkey: None,
                agent_pubkey: None,
            },
        }
    }

    #[test]
    fn settings_require_staff_identity_and_bounded_values() {
        assert!(validate_input(&input()).is_ok());
        assert!(validate_input(&PutOrganizationSettingsInput {
            expected_version: -1,
            ..input()
        })
        .is_err());
        assert!(validate_input(&PutOrganizationSettingsInput {
            name: " ".to_owned(),
            ..input()
        })
        .is_err());
        assert!(validate_input(&PutOrganizationSettingsInput {
            actor: AirhopActor {
                kind: ActorKind::Bot,
                ..input().actor
            },
            ..input()
        })
        .is_err());
    }
}
