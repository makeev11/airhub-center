//! Tenant-scoped persistence primitives for the AirHub operational core.
//!
//! These functions do not derive tenancy from request data. Every query binds
//! the server-resolved [`TenantContext`] as its first key, and transactional
//! command/event/outbox writes accept one caller-owned PostgreSQL connection.

use airhop_core::{
    ExistingStudentsOnboardingStatus, OrganizationSettings, PublicBookingAppearance,
    PublicBookingPurpose, TrialPolicy,
};
use buzz_core::TenantContext;
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{PgConnection, Row};
use uuid::Uuid;

use crate::{Db, DbError, Result};

/// Capacity-safe booking persistence.
pub mod booking;
/// Atomic public booking command application service.
pub mod public_booking;
/// Authoritative occurrence read-model persistence.
pub mod schedule;

/// Lifecycle of an AirHub organization.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrganizationStatus {
    /// Operational reads and writes are allowed subject to policy.
    Active,
    /// The organization is retained for history but operational writes stop.
    Archived,
}

impl OrganizationStatus {
    fn from_db(value: &str) -> Result<Self> {
        match value {
            "active" => Ok(Self::Active),
            "archived" => Ok(Self::Archived),
            other => Err(DbError::InvalidData(format!(
                "unknown AirHub organization status {other:?}"
            ))),
        }
    }
}

/// One AirHub organization resolved inside a Buzz community.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AirhopOrganization {
    /// Business organization identifier.
    pub id: Uuid,
    /// Display name.
    pub name: String,
    /// BCP-47/Intl locale string.
    pub locale: String,
    /// IANA time-zone name.
    pub time_zone: String,
    /// Organization-level operational settings.
    pub settings: OrganizationSettings,
    /// Lifecycle status.
    pub status: OrganizationStatus,
    /// Optimistic aggregate version.
    pub version: i64,
    /// Creation instant.
    pub created_at: DateTime<Utc>,
    /// Last update instant.
    pub updated_at: DateTime<Utc>,
}

/// Input for the one-time Community → AirHub Organization mapping.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewAirhopOrganization {
    /// Business organization identifier allocated by the server/import.
    pub id: Uuid,
    /// Display name.
    pub name: String,
    /// BCP-47/Intl locale string.
    pub locale: String,
    /// IANA time-zone name.
    pub time_zone: String,
    /// Initial organization settings.
    pub settings: OrganizationSettings,
}

/// Actor category recorded on commands and domain events.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActorKind {
    /// Authenticated human member.
    Staff,
    /// Authenticated automated member.
    Bot,
    /// Unauthenticated, rate-limited public booking surface.
    Public,
    /// Relay-owned deterministic process.
    System,
    /// Explicit owner/admin import workflow.
    Import,
}

impl ActorKind {
    pub(super) const fn as_db_str(self) -> &'static str {
        match self {
            Self::Staff => "staff",
            Self::Bot => "bot",
            Self::Public => "public",
            Self::System => "system",
            Self::Import => "import",
        }
    }
}

/// Verified actor attribution for a command or event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AirhopActor {
    /// Actor category.
    pub kind: ActorKind,
    /// Authenticated Nostr public key for staff/bot actors.
    pub pubkey: Option<[u8; 32]>,
    /// Verified human delegation, if an agent acts on behalf of a member.
    pub on_behalf_of_pubkey: Option<[u8; 32]>,
    /// Authenticated agent public key, when distinct from the primary actor.
    pub agent_pubkey: Option<[u8; 32]>,
}

impl AirhopActor {
    pub(super) fn validate(&self) -> Result<()> {
        if matches!(self.kind, ActorKind::Staff | ActorKind::Bot) && self.pubkey.is_none() {
            return Err(DbError::InvalidData(
                "staff and bot AirHub actors require an authenticated pubkey".to_owned(),
            ));
        }
        Ok(())
    }
}

/// Persisted state of a command receipt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandStatus {
    /// The command transaction is being assembled.
    Pending,
    /// State, events, and outbox rows committed.
    Committed,
    /// A durable failure receipt was explicitly recorded.
    Failed,
}

impl CommandStatus {
    fn from_db(value: &str) -> Result<Self> {
        match value {
            "pending" => Ok(Self::Pending),
            "committed" => Ok(Self::Committed),
            "failed" => Ok(Self::Failed),
            other => Err(DbError::InvalidData(format!(
                "unknown AirHub command status {other:?}"
            ))),
        }
    }
}

/// One idempotent command receipt.
#[derive(Debug, Clone, PartialEq)]
pub struct AirhopCommand {
    /// Command identifier used as event causation.
    pub id: Uuid,
    /// Organization selected by the server.
    pub organization_id: Uuid,
    /// Typed command discriminator.
    pub command_type: String,
    /// Keyed digest of the caller's idempotency key.
    pub idempotency_digest: Vec<u8>,
    /// SHA-256 hash of the canonical request body.
    pub request_hash: Vec<u8>,
    /// Correlation identifier across commands/events/workflows.
    pub correlation_id: Uuid,
    /// Receipt lifecycle.
    pub status: CommandStatus,
    /// Committed response, when available.
    pub result: Option<Value>,
    /// Stable failure code, when available.
    pub error_code: Option<String>,
    /// Receipt creation instant.
    pub created_at: DateTime<Utc>,
    /// Terminal instant, when available.
    pub finished_at: Option<DateTime<Utc>>,
}

/// Input for inserting a pending idempotent command receipt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewAirhopCommand {
    /// Command identifier allocated by the server.
    pub id: Uuid,
    /// Organization selected by the server from the tenant mapping.
    pub organization_id: Uuid,
    /// Typed command discriminator.
    pub command_type: String,
    /// Keyed 32-byte digest of the idempotency key.
    pub idempotency_digest: [u8; 32],
    /// SHA-256 canonical request hash.
    pub request_hash: [u8; 32],
    /// Verified actor envelope.
    pub actor: AirhopActor,
    /// Correlation identifier.
    pub correlation_id: Uuid,
}

/// Result of reserving a command's idempotency key.
#[derive(Debug, Clone, PartialEq)]
pub enum CommandInsertOutcome {
    /// This transaction inserted the pending receipt and may execute the command.
    Inserted(AirhopCommand),
    /// The same command/body was already seen and its receipt is returned.
    Existing(AirhopCommand),
}

/// Privacy classification attached to a domain event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrivacyClass {
    /// Safe for deliberately public projections.
    Public,
    /// Internal operational metadata without copied customer PII.
    Operational,
    /// Personally identifiable customer data.
    Pii,
    /// Sensitive information about a child.
    SensitiveChild,
}

impl PrivacyClass {
    const fn as_db_str(self) -> &'static str {
        match self {
            Self::Public => "public",
            Self::Operational => "operational",
            Self::Pii => "pii",
            Self::SensitiveChild => "sensitive_child",
        }
    }
}

/// Input for appending one immutable domain event.
#[derive(Debug, Clone, PartialEq)]
pub struct NewDomainEvent {
    /// Event identifier.
    pub id: Uuid,
    /// Organization selected by the server.
    pub organization_id: Uuid,
    /// Aggregate/stream category.
    pub stream_type: String,
    /// Aggregate identifier.
    pub stream_id: Uuid,
    /// Monotonic version within the stream.
    pub stream_version: i64,
    /// Semantic event type such as `airhop.booking.requested.v1`.
    pub event_type: String,
    /// Payload schema version.
    pub schema_version: i32,
    /// Business occurrence instant.
    pub occurred_at: DateTime<Utc>,
    /// Verified actor envelope.
    pub actor: AirhopActor,
    /// Command receipt that caused the event.
    pub causation_id: Uuid,
    /// Cross-command/workflow correlation identifier.
    pub correlation_id: Uuid,
    /// Minimal semantic payload.
    pub payload: Value,
    /// Privacy classification.
    pub privacy_class: PrivacyClass,
}

/// Input for enqueueing one redacted event delivery.
#[derive(Debug, Clone, PartialEq)]
pub struct NewOutboxMessage {
    /// Outbox row identifier.
    pub id: Uuid,
    /// Organization selected by the server.
    pub organization_id: Uuid,
    /// Domain event to deliver.
    pub event_id: Uuid,
    /// Consumer/destination discriminator.
    pub destination: String,
    /// Payload safe for the selected destination.
    pub redacted_payload: Value,
    /// Earliest dispatch instant.
    pub not_before: DateTime<Utc>,
}

impl Db {
    /// Returns the organization mapped to this host-resolved community.
    pub async fn get_airhop_organization(
        &self,
        tenant: &TenantContext,
    ) -> Result<Option<AirhopOrganization>> {
        let row = sqlx::query(
            "SELECT id, name, locale, time_zone, default_trial_policy, \
                    track_attendance_by_default, allow_single_visits_by_default, \
                    existing_students_onboarding_status, public_booking_purpose, \
                    public_booking_appearance, payment_day_of_month, status, version, \
                    created_at, updated_at \
             FROM airhop_organizations \
             WHERE community_id = $1",
        )
        .bind(tenant.community().as_uuid())
        .fetch_optional(&self.pool)
        .await?;
        row.map(parse_organization_row).transpose()
    }

    /// Creates the one AirHub organization mapped to this community.
    ///
    /// The database's `UNIQUE (community_id)` constraint rejects a second
    /// organization until a future multi-organization ADR changes the model.
    pub async fn create_airhop_organization(
        &self,
        tenant: &TenantContext,
        input: &NewAirhopOrganization,
    ) -> Result<AirhopOrganization> {
        validate_new_organization(input)?;
        let trial_policy = serde_json::to_value(&input.settings.default_trial_policy)?;
        let row = sqlx::query(
            "INSERT INTO airhop_organizations (\
                 community_id, id, name, locale, time_zone, default_trial_policy, \
                 track_attendance_by_default, allow_single_visits_by_default, \
                 existing_students_onboarding_status, public_booking_purpose, \
                 public_booking_appearance, payment_day_of_month\
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) \
             RETURNING id, name, locale, time_zone, default_trial_policy, \
                 track_attendance_by_default, allow_single_visits_by_default, \
                 existing_students_onboarding_status, public_booking_purpose, \
                 public_booking_appearance, payment_day_of_month, status, version, \
                 created_at, updated_at",
        )
        .bind(tenant.community().as_uuid())
        .bind(input.id)
        .bind(&input.name)
        .bind(&input.locale)
        .bind(&input.time_zone)
        .bind(trial_policy)
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
        .fetch_one(&self.pool)
        .await?;
        parse_organization_row(row)
    }
}

/// Inserts a pending command receipt or returns the existing idempotent receipt.
///
/// A reused idempotency key with a different request hash is rejected. Callers
/// must hold the transaction used for all subsequent state/event/outbox writes.
pub async fn insert_pending_command(
    connection: &mut PgConnection,
    tenant: &TenantContext,
    input: &NewAirhopCommand,
) -> Result<CommandInsertOutcome> {
    validate_new_command(input)?;
    let actor_pubkey = input.actor.pubkey.map(Vec::from);
    let on_behalf_of_pubkey = input.actor.on_behalf_of_pubkey.map(Vec::from);
    let agent_pubkey = input.actor.agent_pubkey.map(Vec::from);
    let inserted = sqlx::query(
        "INSERT INTO airhop_commands (\
             community_id, organization_id, id, command_type, idempotency_digest, \
             request_hash, actor_kind, actor_pubkey, on_behalf_of_pubkey, agent_pubkey, \
             correlation_id\
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) \
         ON CONFLICT (community_id, organization_id, command_type, idempotency_digest) \
         DO NOTHING \
         RETURNING id, organization_id, command_type, idempotency_digest, request_hash, \
             correlation_id, status, result, error_code, created_at, finished_at",
    )
    .bind(tenant.community().as_uuid())
    .bind(input.organization_id)
    .bind(input.id)
    .bind(&input.command_type)
    .bind(input.idempotency_digest.as_slice())
    .bind(input.request_hash.as_slice())
    .bind(input.actor.kind.as_db_str())
    .bind(actor_pubkey)
    .bind(on_behalf_of_pubkey)
    .bind(agent_pubkey)
    .bind(input.correlation_id)
    .fetch_optional(&mut *connection)
    .await?;

    if let Some(row) = inserted {
        return parse_command_row(row).map(CommandInsertOutcome::Inserted);
    }

    let row = sqlx::query(
        "SELECT id, organization_id, command_type, idempotency_digest, request_hash, \
                correlation_id, status, result, error_code, created_at, finished_at \
         FROM airhop_commands \
         WHERE community_id = $1 AND organization_id = $2 \
           AND command_type = $3 AND idempotency_digest = $4",
    )
    .bind(tenant.community().as_uuid())
    .bind(input.organization_id)
    .bind(&input.command_type)
    .bind(input.idempotency_digest.as_slice())
    .fetch_optional(&mut *connection)
    .await?
    .ok_or_else(|| DbError::NotFound("AirHub idempotent command receipt".to_owned()))?;
    let command = parse_command_row(row)?;
    if command.request_hash.as_slice() != input.request_hash {
        return Err(DbError::InvalidData(
            "AirHub idempotency key was reused with a different request".to_owned(),
        ));
    }
    Ok(CommandInsertOutcome::Existing(command))
}

/// Marks a pending command committed and stores its deterministic result.
pub async fn commit_command(
    connection: &mut PgConnection,
    tenant: &TenantContext,
    organization_id: Uuid,
    command_id: Uuid,
    result: &Value,
) -> Result<AirhopCommand> {
    let row = sqlx::query(
        "UPDATE airhop_commands \
         SET status = 'committed', result = $4, finished_at = now() \
         WHERE community_id = $1 AND organization_id = $2 AND id = $3 \
           AND status = 'pending' \
         RETURNING id, organization_id, command_type, idempotency_digest, request_hash, \
             correlation_id, status, result, error_code, created_at, finished_at",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(command_id)
    .bind(result)
    .fetch_optional(&mut *connection)
    .await?
    .ok_or_else(|| DbError::NotFound("pending AirHub command".to_owned()))?;
    parse_command_row(row)
}

/// Appends one immutable domain event inside the caller's command transaction.
pub async fn append_domain_event(
    connection: &mut PgConnection,
    tenant: &TenantContext,
    event: &NewDomainEvent,
) -> Result<()> {
    event.actor.validate()?;
    ensure_json_object(&event.payload, "AirHub domain event payload")?;
    let actor_pubkey = event.actor.pubkey.map(Vec::from);
    let on_behalf_of_pubkey = event.actor.on_behalf_of_pubkey.map(Vec::from);
    let agent_pubkey = event.actor.agent_pubkey.map(Vec::from);
    sqlx::query(
        "INSERT INTO airhop_domain_events (\
             community_id, organization_id, id, stream_type, stream_id, stream_version, \
             event_type, schema_version, occurred_at, actor_kind, actor_pubkey, \
             on_behalf_of_pubkey, agent_pubkey, causation_id, correlation_id, payload, \
             privacy_class\
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, \
                   $14, $15, $16, $17)",
    )
    .bind(tenant.community().as_uuid())
    .bind(event.organization_id)
    .bind(event.id)
    .bind(&event.stream_type)
    .bind(event.stream_id)
    .bind(event.stream_version)
    .bind(&event.event_type)
    .bind(event.schema_version)
    .bind(event.occurred_at)
    .bind(event.actor.kind.as_db_str())
    .bind(actor_pubkey)
    .bind(on_behalf_of_pubkey)
    .bind(agent_pubkey)
    .bind(event.causation_id)
    .bind(event.correlation_id)
    .bind(&event.payload)
    .bind(event.privacy_class.as_db_str())
    .execute(&mut *connection)
    .await?;
    Ok(())
}

/// Enqueues one redacted delivery inside the caller's command transaction.
pub async fn enqueue_outbox(
    connection: &mut PgConnection,
    tenant: &TenantContext,
    message: &NewOutboxMessage,
) -> Result<()> {
    ensure_json_object(&message.redacted_payload, "AirHub outbox payload")?;
    sqlx::query(
        "INSERT INTO airhop_outbox (\
             community_id, organization_id, id, event_id, destination, \
             redacted_payload, not_before\
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(tenant.community().as_uuid())
    .bind(message.organization_id)
    .bind(message.id)
    .bind(message.event_id)
    .bind(&message.destination)
    .bind(&message.redacted_payload)
    .bind(message.not_before)
    .execute(&mut *connection)
    .await?;
    Ok(())
}

fn validate_new_organization(input: &NewAirhopOrganization) -> Result<()> {
    if input.id.is_nil() {
        return Err(DbError::InvalidData(
            "AirHub organization id cannot be nil".to_owned(),
        ));
    }
    if input.name.trim().is_empty() || input.name.len() > 160 {
        return Err(DbError::InvalidData(
            "AirHub organization name is invalid".to_owned(),
        ));
    }
    if input.locale.trim().len() < 2 || input.locale.len() > 32 {
        return Err(DbError::InvalidData(
            "AirHub organization locale is invalid".to_owned(),
        ));
    }
    if input.time_zone.trim().is_empty() || input.time_zone.len() > 80 {
        return Err(DbError::InvalidData(
            "AirHub organization time zone is invalid".to_owned(),
        ));
    }
    input
        .settings
        .validate()
        .map_err(|error| DbError::InvalidData(error.to_string()))?;
    Ok(())
}

fn validate_new_command(input: &NewAirhopCommand) -> Result<()> {
    input.actor.validate()?;
    if input.id.is_nil() || input.organization_id.is_nil() || input.correlation_id.is_nil() {
        return Err(DbError::InvalidData(
            "AirHub command identifiers cannot be nil".to_owned(),
        ));
    }
    if input.command_type.trim().is_empty() || input.command_type.len() > 120 {
        return Err(DbError::InvalidData(
            "AirHub command type is invalid".to_owned(),
        ));
    }
    Ok(())
}

fn ensure_json_object(value: &Value, label: &str) -> Result<()> {
    if value.is_object() {
        Ok(())
    } else {
        Err(DbError::InvalidData(format!("{label} must be an object")))
    }
}

fn parse_organization_row(row: sqlx::postgres::PgRow) -> Result<AirhopOrganization> {
    let default_trial_policy: TrialPolicy =
        serde_json::from_value(row.try_get("default_trial_policy")?)?;
    let onboarding = parse_onboarding_status(row.try_get("existing_students_onboarding_status")?)?;
    let public_purpose = parse_public_purpose(row.try_get("public_booking_purpose")?)?;
    let public_appearance = parse_public_appearance(row.try_get("public_booking_appearance")?)?;
    let payment_day: i16 = row.try_get("payment_day_of_month")?;
    let payment_day_of_month = u8::try_from(payment_day)
        .map_err(|_| DbError::InvalidData(format!("invalid AirHub payment day {payment_day}")))?;
    let settings = OrganizationSettings {
        default_trial_policy,
        track_attendance_by_default: row.try_get("track_attendance_by_default")?,
        allow_single_visits_by_default: row.try_get("allow_single_visits_by_default")?,
        existing_students_onboarding_status: onboarding,
        public_booking_purpose: public_purpose,
        public_booking_appearance: public_appearance,
        payment_day_of_month,
    };
    settings
        .validate()
        .map_err(|error| DbError::InvalidData(error.to_string()))?;
    Ok(AirhopOrganization {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        locale: row.try_get("locale")?,
        time_zone: row.try_get("time_zone")?,
        settings,
        status: OrganizationStatus::from_db(row.try_get("status")?)?,
        version: row.try_get("version")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn parse_command_row(row: sqlx::postgres::PgRow) -> Result<AirhopCommand> {
    Ok(AirhopCommand {
        id: row.try_get("id")?,
        organization_id: row.try_get("organization_id")?,
        command_type: row.try_get("command_type")?,
        idempotency_digest: row.try_get("idempotency_digest")?,
        request_hash: row.try_get("request_hash")?,
        correlation_id: row.try_get("correlation_id")?,
        status: CommandStatus::from_db(row.try_get("status")?)?,
        result: row.try_get("result")?,
        error_code: row.try_get("error_code")?,
        created_at: row.try_get("created_at")?,
        finished_at: row.try_get("finished_at")?,
    })
}

const fn onboarding_status_str(value: ExistingStudentsOnboardingStatus) -> &'static str {
    match value {
        ExistingStudentsOnboardingStatus::NotStarted => "not_started",
        ExistingStudentsOnboardingStatus::InProgress => "in_progress",
        ExistingStudentsOnboardingStatus::Postponed => "postponed",
        ExistingStudentsOnboardingStatus::Completed => "completed",
    }
}

fn parse_onboarding_status(value: &str) -> Result<ExistingStudentsOnboardingStatus> {
    match value {
        "not_started" => Ok(ExistingStudentsOnboardingStatus::NotStarted),
        "in_progress" => Ok(ExistingStudentsOnboardingStatus::InProgress),
        "postponed" => Ok(ExistingStudentsOnboardingStatus::Postponed),
        "completed" => Ok(ExistingStudentsOnboardingStatus::Completed),
        other => Err(DbError::InvalidData(format!(
            "unknown AirHub onboarding status {other:?}"
        ))),
    }
}

const fn public_purpose_str(value: PublicBookingPurpose) -> &'static str {
    match value {
        PublicBookingPurpose::Trial => "trial",
        PublicBookingPurpose::Lesson => "lesson",
    }
}

fn parse_public_purpose(value: &str) -> Result<PublicBookingPurpose> {
    match value {
        "trial" => Ok(PublicBookingPurpose::Trial),
        "lesson" => Ok(PublicBookingPurpose::Lesson),
        other => Err(DbError::InvalidData(format!(
            "unknown AirHub public booking purpose {other:?}"
        ))),
    }
}

const fn public_appearance_str(value: PublicBookingAppearance) -> &'static str {
    match value {
        PublicBookingAppearance::Automatic => "automatic",
        PublicBookingAppearance::Light => "light",
        PublicBookingAppearance::Dark => "dark",
    }
}

fn parse_public_appearance(value: &str) -> Result<PublicBookingAppearance> {
    match value {
        "automatic" => Ok(PublicBookingAppearance::Automatic),
        "light" => Ok(PublicBookingAppearance::Light),
        "dark" => Ok(PublicBookingAppearance::Dark),
        other => Err(DbError::InvalidData(format!(
            "unknown AirHub public booking appearance {other:?}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn staff_actor() -> AirhopActor {
        AirhopActor {
            kind: ActorKind::Staff,
            pubkey: Some([7; 32]),
            on_behalf_of_pubkey: None,
            agent_pubkey: None,
        }
    }

    #[test]
    fn authenticated_actor_kinds_require_pubkeys() {
        assert!(staff_actor().validate().is_ok());
        assert!(AirhopActor {
            kind: ActorKind::Staff,
            pubkey: None,
            on_behalf_of_pubkey: None,
            agent_pubkey: None,
        }
        .validate()
        .is_err());
        assert!(AirhopActor {
            kind: ActorKind::Public,
            pubkey: None,
            on_behalf_of_pubkey: None,
            agent_pubkey: None,
        }
        .validate()
        .is_ok());
    }

    #[test]
    fn command_validation_rejects_nil_server_ids() {
        let command = NewAirhopCommand {
            id: Uuid::nil(),
            organization_id: Uuid::from_u128(1),
            command_type: "CreateBooking".to_owned(),
            idempotency_digest: [1; 32],
            request_hash: [2; 32],
            actor: staff_actor(),
            correlation_id: Uuid::from_u128(2),
        };
        assert!(validate_new_command(&command).is_err());
    }

    #[test]
    fn outbox_and_event_payloads_must_be_objects() {
        assert!(ensure_json_object(&serde_json::json!({"event": "ok"}), "payload").is_ok());
        assert!(ensure_json_object(&serde_json::json!(["not", "object"]), "payload").is_err());
    }
}
