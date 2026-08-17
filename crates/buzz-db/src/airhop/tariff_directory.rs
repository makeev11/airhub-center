//! Authoritative AirHub tariff directory and audited staff commands.

use buzz_core::TenantContext;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

use super::{
    append_domain_event, commit_command, insert_pending_command, AirhopActor, AirhopCommand,
    CommandInsertOutcome, CommandStatus, NewAirhopCommand, NewDomainEvent, PrivacyClass,
};
use crate::{Db, DbError, Result};

const CREATE_TARIFF_COMMAND_TYPE: &str = "CreateTariff";
const PUT_TARIFF_COMMAND_TYPE: &str = "PutTariff";

/// Operational lifecycle of a reusable center tariff.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TariffStatus {
    /// May be selected for new permanent enrollments.
    Active,
    /// Retained for enrollment and payment history only.
    Archived,
}

impl TariffStatus {
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
                "unknown AirHub tariff status {other:?}"
            ))),
        }
    }
}

/// Server-authoritative reusable tariff projection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AirhopTariff {
    /// Server-owned tariff identifier.
    pub id: Uuid,
    /// Server-resolved organization identifier.
    pub organization_id: Uuid,
    /// Human-readable tariff name.
    pub name: String,
    /// Optional commercial description.
    pub description: Option<String>,
    /// Current price in currency minor units.
    pub price_minor: i64,
    /// ISO 4217-style three-letter currency code.
    pub currency: String,
    /// Maximum number of selected weekly slots.
    pub weekly_schedule_limit: i16,
    /// Optional override of the center payment day.
    pub payment_day_of_month: Option<i16>,
    /// Operational lifecycle.
    pub status: TariffStatus,
    /// Number of current active enrollments referencing this tariff.
    pub active_enrollment_count: i64,
    /// Optimistic entity version.
    pub version: i64,
    /// Creation instant.
    pub created_at: DateTime<Utc>,
    /// Last update instant.
    pub updated_at: DateTime<Utc>,
}

/// Idempotent input for creating a reusable tariff.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateTariffInput {
    /// Human-readable tariff name.
    pub name: String,
    /// Optional commercial description.
    pub description: Option<String>,
    /// Current price in currency minor units.
    pub price_minor: i64,
    /// Three-letter uppercase currency code.
    pub currency: String,
    /// Maximum number of selected weekly slots.
    pub weekly_schedule_limit: i16,
    /// Optional override of the center payment day.
    pub payment_day_of_month: Option<i16>,
    /// Keyed digest of the HTTP idempotency key.
    pub idempotency_digest: [u8; 32],
    /// Canonical method/path/body request hash.
    pub request_hash: [u8; 32],
    /// Verified staff attribution.
    pub actor: AirhopActor,
}

/// Full optimistic replacement of one tariff.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PutTariffInput {
    /// Tariff selected by the authenticated request path.
    pub tariff_id: Uuid,
    /// Version observed by the staff client.
    pub expected_version: i64,
    /// Human-readable tariff name.
    pub name: String,
    /// Optional commercial description.
    pub description: Option<String>,
    /// Current price in currency minor units.
    pub price_minor: i64,
    /// Three-letter uppercase currency code.
    pub currency: String,
    /// Maximum number of selected weekly slots.
    pub weekly_schedule_limit: i16,
    /// Optional override of the center payment day.
    pub payment_day_of_month: Option<i16>,
    /// Desired operational lifecycle.
    pub status: TariffStatus,
    /// Keyed digest of the HTTP idempotency key.
    pub idempotency_digest: [u8; 32],
    /// Canonical method/path/body request hash.
    pub request_hash: [u8; 32],
    /// Verified staff attribution.
    pub actor: AirhopActor,
}

/// Result of a tariff create, update, archive, or restore command.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TariffMutationOutcome {
    /// Affected tariff.
    pub tariff_id: Uuid,
    /// New or replayed optimistic version.
    pub version: i64,
    /// True when an existing committed command receipt was replayed.
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredTariffMutationResult {
    tariff_id: Uuid,
    version: i64,
}

impl Db {
    /// Lists active and archived tariffs for the host-resolved tenant.
    pub async fn list_airhop_tariffs(&self, tenant: &TenantContext) -> Result<Vec<AirhopTariff>> {
        let organization_id = resolve_active_organization(&self.pool, tenant).await?;
        let rows = sqlx::query(
            "SELECT tariff.id, tariff.organization_id, tariff.name, tariff.description, \
                    tariff.price_minor, tariff.currency, tariff.weekly_schedule_limit, \
                    tariff.payment_day_of_month, tariff.status, tariff.version, \
                    tariff.created_at, tariff.updated_at, \
                    COUNT(enrollment.id) FILTER (WHERE enrollment.status = 'active' \
                        AND (enrollment.end_date IS NULL OR enrollment.end_date >= \
                            (now() AT TIME ZONE organization.time_zone)::date))::BIGINT \
                        AS active_enrollment_count \
             FROM airhop_tariffs tariff \
             JOIN airhop_organizations organization \
               ON organization.community_id = tariff.community_id \
              AND organization.id = tariff.organization_id \
             LEFT JOIN airhop_enrollments enrollment \
               ON enrollment.community_id = tariff.community_id \
              AND enrollment.organization_id = tariff.organization_id \
              AND enrollment.tariff_id = tariff.id \
             WHERE tariff.community_id = $1 AND tariff.organization_id = $2 \
             GROUP BY tariff.community_id, tariff.id, organization.time_zone \
             ORDER BY CASE tariff.status WHEN 'active' THEN 0 ELSE 1 END, \
                      lower(tariff.name), tariff.id",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(parse_tariff_row).collect()
    }

    /// Creates a tariff, audit event, and command receipt atomically.
    pub async fn create_airhop_tariff(
        &self,
        tenant: &TenantContext,
        input: &CreateTariffInput,
    ) -> Result<TariffMutationOutcome> {
        validate_tariff_fields(
            &input.name,
            input.description.as_deref(),
            input.price_minor,
            &input.currency,
            input.weekly_schedule_limit,
            input.payment_day_of_month,
        )?;
        input.actor.validate()?;
        let mut transaction = self.pool.begin().await?;
        let organization_id = resolve_active_organization(&mut *transaction, tenant).await?;
        let command = match insert_pending_command(
            &mut transaction,
            tenant,
            &NewAirhopCommand {
                id: Uuid::new_v4(),
                organization_id,
                command_type: CREATE_TARIFF_COMMAND_TYPE.to_owned(),
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
        let tariff_id = Uuid::new_v4();
        let occurred_at: DateTime<Utc> = sqlx::query_scalar("SELECT now()")
            .fetch_one(&mut *transaction)
            .await?;
        sqlx::query(
            "INSERT INTO airhop_tariffs ( \
                 community_id, organization_id, id, name, description, price_minor, \
                 currency, weekly_schedule_limit, payment_day_of_month, created_at, updated_at \
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(tariff_id)
        .bind(input.name.trim())
        .bind(trimmed_optional(input.description.as_deref()))
        .bind(input.price_minor)
        .bind(input.currency.as_str())
        .bind(input.weekly_schedule_limit)
        .bind(input.payment_day_of_month)
        .bind(occurred_at)
        .execute(&mut *transaction)
        .await?;
        append_domain_event(
            &mut transaction,
            tenant,
            &NewDomainEvent {
                id: Uuid::new_v4(),
                organization_id,
                stream_type: "tariff".to_owned(),
                stream_id: tariff_id,
                stream_version: 1,
                event_type: "airhop.tariff.created.v1".to_owned(),
                schema_version: 1,
                occurred_at,
                actor: input.actor.clone(),
                causation_id: command.id,
                correlation_id: command.correlation_id,
                payload: json!({
                    "tariffId": tariff_id,
                    "priceMinor": input.price_minor,
                    "currency": input.currency,
                    "weeklyScheduleLimit": input.weekly_schedule_limit,
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
            tariff_id,
            1,
        )
        .await
    }

    /// Replaces one tariff with optimistic concurrency and immutable audit.
    pub async fn put_airhop_tariff(
        &self,
        tenant: &TenantContext,
        input: &PutTariffInput,
    ) -> Result<TariffMutationOutcome> {
        validate_tariff_fields(
            &input.name,
            input.description.as_deref(),
            input.price_minor,
            &input.currency,
            input.weekly_schedule_limit,
            input.payment_day_of_month,
        )?;
        input.actor.validate()?;
        if input.tariff_id.is_nil() || input.expected_version <= 0 {
            return Err(DbError::InvalidData(
                "AirHub tariff identity or version is invalid".to_owned(),
            ));
        }
        let mut transaction = self.pool.begin().await?;
        let organization_id = resolve_active_organization(&mut *transaction, tenant).await?;
        let command = match insert_pending_command(
            &mut transaction,
            tenant,
            &NewAirhopCommand {
                id: Uuid::new_v4(),
                organization_id,
                command_type: PUT_TARIFF_COMMAND_TYPE.to_owned(),
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
            "SELECT status FROM airhop_tariffs \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3 FOR UPDATE",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(input.tariff_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| DbError::NotFound("AirHub tariff".to_owned()))?;
        let current_status = TariffStatus::from_db(&current_status)?;
        let occurred_at: DateTime<Utc> = sqlx::query_scalar("SELECT now()")
            .fetch_one(&mut *transaction)
            .await?;
        let version: i64 = sqlx::query_scalar(
            "UPDATE airhop_tariffs \
             SET name = $4, description = $5, price_minor = $6, currency = $7, \
                 weekly_schedule_limit = $8, payment_day_of_month = $9, status = $10, \
                 version = version + 1, updated_at = $11 \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3 AND version = $12 \
             RETURNING version",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(input.tariff_id)
        .bind(input.name.trim())
        .bind(trimmed_optional(input.description.as_deref()))
        .bind(input.price_minor)
        .bind(input.currency.as_str())
        .bind(input.weekly_schedule_limit)
        .bind(input.payment_day_of_month)
        .bind(input.status.as_db_str())
        .bind(occurred_at)
        .bind(input.expected_version)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(DbError::AirhopVersionConflict)?;
        let event_type = match (current_status, input.status) {
            (TariffStatus::Active, TariffStatus::Archived) => "airhop.tariff.archived.v1",
            (TariffStatus::Archived, TariffStatus::Active) => "airhop.tariff.restored.v1",
            _ => "airhop.tariff.updated.v1",
        };
        append_domain_event(
            &mut transaction,
            tenant,
            &NewDomainEvent {
                id: Uuid::new_v4(),
                organization_id,
                stream_type: "tariff".to_owned(),
                stream_id: input.tariff_id,
                stream_version: version,
                event_type: event_type.to_owned(),
                schema_version: 1,
                occurred_at,
                actor: input.actor.clone(),
                causation_id: command.id,
                correlation_id: command.correlation_id,
                payload: json!({
                    "tariffId": input.tariff_id,
                    "status": input.status,
                    "priceMinor": input.price_minor,
                    "currency": input.currency,
                    "weeklyScheduleLimit": input.weekly_schedule_limit,
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
            input.tariff_id,
            version,
        )
        .await
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

async fn finish_mutation(
    mut transaction: sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    command_id: Uuid,
    tariff_id: Uuid,
    version: i64,
) -> Result<TariffMutationOutcome> {
    let stored = StoredTariffMutationResult { tariff_id, version };
    commit_command(
        &mut transaction,
        tenant,
        organization_id,
        command_id,
        &serde_json::to_value(&stored)?,
    )
    .await?;
    transaction.commit().await?;
    Ok(TariffMutationOutcome {
        tariff_id,
        version,
        replayed: false,
    })
}

async fn replay_mutation(
    transaction: sqlx::Transaction<'_, sqlx::Postgres>,
    command: AirhopCommand,
) -> Result<TariffMutationOutcome> {
    match command.status {
        CommandStatus::Pending => Err(DbError::AirhopCommandInProgress),
        CommandStatus::Failed => Err(DbError::AirhopCommandPreviouslyFailed),
        CommandStatus::Committed => {
            let stored: StoredTariffMutationResult =
                serde_json::from_value(command.result.ok_or_else(|| {
                    DbError::InvalidData("committed AirHub command has no result".to_owned())
                })?)?;
            transaction.commit().await?;
            Ok(TariffMutationOutcome {
                tariff_id: stored.tariff_id,
                version: stored.version,
                replayed: true,
            })
        }
    }
}

fn parse_tariff_row(row: sqlx::postgres::PgRow) -> Result<AirhopTariff> {
    Ok(AirhopTariff {
        id: row.try_get("id")?,
        organization_id: row.try_get("organization_id")?,
        name: row.try_get("name")?,
        description: row.try_get("description")?,
        price_minor: row.try_get("price_minor")?,
        currency: row.try_get::<String, _>("currency")?.trim().to_owned(),
        weekly_schedule_limit: row.try_get("weekly_schedule_limit")?,
        payment_day_of_month: row.try_get("payment_day_of_month")?,
        status: TariffStatus::from_db(row.try_get("status")?)?,
        active_enrollment_count: row.try_get("active_enrollment_count")?,
        version: row.try_get("version")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn validate_tariff_fields(
    name: &str,
    description: Option<&str>,
    price_minor: i64,
    currency: &str,
    weekly_schedule_limit: i16,
    payment_day_of_month: Option<i16>,
) -> Result<()> {
    let name_length = name.trim().chars().count();
    if !(1..=160).contains(&name_length)
        || description.is_some_and(|value| value.trim().chars().count() > 4_000)
        || price_minor < 0
        || currency.len() != 3
        || !currency.bytes().all(|value| value.is_ascii_uppercase())
        || !(1..=7).contains(&weekly_schedule_limit)
        || payment_day_of_month.is_some_and(|value| !(1..=28).contains(&value))
    {
        return Err(DbError::InvalidData(
            "AirHub tariff fields are invalid".to_owned(),
        ));
    }
    Ok(())
}

fn trimmed_optional(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tariff_validation_accepts_business_boundaries() {
        assert!(validate_tariff_fields("Раз в неделю", None, 0, "RUB", 1, None).is_ok());
        assert!(
            validate_tariff_fields("Каждый день", Some("Описание"), 1, "USD", 7, Some(28)).is_ok()
        );
    }

    #[test]
    fn tariff_validation_rejects_invalid_money_schedule_and_payment_day() {
        assert!(validate_tariff_fields("", None, 1, "RUB", 1, None).is_err());
        assert!(validate_tariff_fields("Тариф", None, -1, "RUB", 1, None).is_err());
        assert!(validate_tariff_fields("Тариф", None, 1, "rub", 1, None).is_err());
        assert!(validate_tariff_fields("Тариф", None, 1, "RUB", 0, None).is_err());
        assert!(validate_tariff_fields("Тариф", None, 1, "RUB", 1, Some(29)).is_err());
    }
}
