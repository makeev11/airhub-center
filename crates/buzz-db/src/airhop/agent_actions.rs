//! Durable pending actions prepared by the registered Airhop Administrator.

use std::collections::BTreeMap;

use airhop_core::{
    ExistingStudentsOnboardingStatus, OrganizationSettings, PublicBookingAppearance,
    PublicBookingPurpose, TrialPolicy, Weekday,
};
use buzz_core::TenantContext;
use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, Postgres, Row, Transaction};
use uuid::Uuid;

use super::branch_directory::{
    create_airhop_branch_in_transaction, BranchWorkingPeriod, CreateBranchInput,
};
use super::family_lifecycle::{create_airhop_family_in_transaction, CreateFamilyInput};
use super::group_directory::{
    create_airhop_group_in_transaction, CreateGroupInput, GroupDefinition, RecurrenceRuleInput,
};
use super::lesson_participants::{
    enroll_airhop_staff_participant_in_transaction, EnrollStaffParticipantInput,
    EnrollmentScheduleSelection,
};
use super::organization_settings::{
    lock_airhop_organization_settings_write, put_airhop_organization_settings_in_transaction,
    PutOrganizationSettingsInput,
};
use super::payment_queue::{
    mutate_airhop_payment_in_transaction, MutatePaymentInput, PaymentChange,
};
use super::room_directory::{create_airhop_room_in_transaction, CreateRoomInput};
use super::tariff_directory::{create_airhop_tariff_in_transaction, CreateTariffInput};
use super::teacher_directory::{create_airhop_teacher_in_transaction, CreateTeacherInput};
use super::welcome_agents::AirhopWelcomeRole;
use super::{ActorKind, AirhopActor};
use crate::{Db, DbError, Result};

/// Lifecycle of one human-confirmed agent action.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentActionStatus {
    /// Prepared and waiting for a human confirmation reaction.
    Pending,
    /// Replaced by a corrected command before confirmation.
    Cancelled,
    /// Applied atomically after confirmation.
    Committed,
    /// Confirmation window elapsed.
    Expired,
    /// A terminal application failure was recorded.
    Failed,
}

impl AgentActionStatus {
    /// Stable database/API value.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Cancelled => "cancelled",
            Self::Committed => "committed",
            Self::Expired => "expired",
            Self::Failed => "failed",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "pending" => Ok(Self::Pending),
            "cancelled" => Ok(Self::Cancelled),
            "committed" => Ok(Self::Committed),
            "expired" => Ok(Self::Expired),
            "failed" => Ok(Self::Failed),
            other => Err(DbError::InvalidData(format!(
                "unknown Airhop agent action status: {other}"
            ))),
        }
    }
}

/// One tenant-fenced action awaiting explicit human confirmation.
#[derive(Debug, Clone, PartialEq)]
pub struct PendingAgentAction {
    /// Stable action identifier.
    pub id: Uuid,
    /// Server-resolved organization.
    pub organization_id: Uuid,
    /// Registered private Welcome channel.
    pub channel_id: Uuid,
    /// Human Welcome event that caused the preparation.
    pub triggering_event_id: [u8; 32],
    /// Human author of the triggering event.
    pub initiator_pubkey: [u8; 32],
    /// Exact registered agent that prepared the action.
    pub prepared_by_agent_pubkey: [u8; 32],
    /// Specialist role used for authorization and attribution.
    pub specialist_role: AirhopWelcomeRole,
    /// Closed command JSON parsed by the relay before persistence.
    pub command: Value,
    /// SHA-256 of the canonical typed command JSON.
    pub command_digest: [u8; 32],
    /// Resource versions captured while preparing the action.
    pub expected_versions: Value,
    /// Retry-stable relay-signed preview event, once reserved.
    pub preview_event_id: Option<[u8; 32]>,
    /// Current action lifecycle.
    pub status: AgentActionStatus,
    /// Confirmation deadline.
    pub expires_at: DateTime<Utc>,
    /// Stable creation time used to reproduce the preview event ID.
    pub created_at: DateTime<Utc>,
}

/// Validated preparation input supplied by the relay service.
#[derive(Debug, Clone, PartialEq)]
pub struct NewPendingAgentAction {
    /// Registered Welcome channel claimed by the caller.
    pub channel_id: Uuid,
    /// Human Welcome source event.
    pub triggering_event_id: [u8; 32],
    /// Authenticated registered specialist.
    pub prepared_by_agent_pubkey: [u8; 32],
    /// Closed specialist role.
    pub specialist_role: AirhopWelcomeRole,
    /// Canonical typed command JSON.
    pub command: Value,
    /// SHA-256 of `command`.
    pub command_digest: [u8; 32],
    /// Current resource versions captured by validation.
    pub expected_versions: Value,
    /// Confirmation deadline.
    pub expires_at: DateTime<Utc>,
}

/// Result of preparing or replaying a pending action.
#[derive(Debug, Clone, PartialEq)]
pub struct PreparedAgentAction {
    /// Persisted action.
    pub action: PendingAgentAction,
    /// True when the exact trigger and digest were already persisted.
    pub replayed: bool,
    /// Older pending action IDs cancelled by this corrected command.
    pub cancelled_action_ids: Vec<Uuid>,
}

/// Result of applying or replaying one exact agent preview confirmation.
#[derive(Debug, Clone, PartialEq)]
pub struct AgentActionCommitOutcome {
    /// Confirmed pending action.
    pub action_id: Uuid,
    /// Terminal lifecycle after confirmation.
    pub status: AgentActionStatus,
    /// Durable result and confirmation audit payload.
    pub result: Value,
    /// True when the action had already committed and no domain write ran.
    pub replayed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    content = "input",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum StoredAgentCommand {
    PutOrganizationSettings(PutOrganizationSettingsCommand),
    CreateBranch(CreateBranchCommand),
    CreateRoom {
        branch_id: Uuid,
        body: CreateRoomCommand,
    },
    CreateTeacher(CreateTeacherCommand),
    CreateGroup(CreateGroupCommand),
    CreateTariff(CreateTariffCommand),
    CreateFamily(CreateFamilyCommand),
    EnrollParticipant(EnrollParticipantCommand),
    MutatePayment {
        payment_id: Uuid,
        body: PaymentMutationCommand,
    },
}

#[cfg(test)]
impl StoredAgentCommand {
    fn kind(&self) -> &'static str {
        match self {
            Self::PutOrganizationSettings(_) => "put_organization_settings",
            Self::CreateBranch(_) => "create_branch",
            Self::CreateRoom { .. } => "create_room",
            Self::CreateTeacher(_) => "create_teacher",
            Self::CreateGroup(_) => "create_group",
            Self::CreateTariff(_) => "create_tariff",
            Self::CreateFamily(_) => "create_family",
            Self::EnrollParticipant(_) => "enroll_participant",
            Self::MutatePayment { .. } => "mutate_payment",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PutOrganizationSettingsCommand {
    expected_version: i64,
    name: String,
    locale: String,
    time_zone: String,
    #[serde(default)]
    payments_buzz_channel_id: Option<Uuid>,
    #[serde(default)]
    analytics_buzz_channel_id: Option<Uuid>,
    default_trial_policy: TrialPolicy,
    track_attendance_by_default: bool,
    allow_single_visits_by_default: bool,
    existing_students_onboarding_status: ExistingStudentsOnboardingStatus,
    public_booking_purpose: PublicBookingPurpose,
    public_booking_appearance: PublicBookingAppearance,
    payment_day_of_month: u8,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateBranchCommand {
    name: String,
    address: String,
    working_hours: BTreeMap<Weekday, Vec<BranchWorkingPeriodCommand>>,
    #[serde(default)]
    default_buzz_channel_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BranchWorkingPeriodCommand {
    start_time: String,
    end_time: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateRoomCommand {
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateTeacherCommand {
    display_name: String,
    #[serde(default)]
    buzz_username: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateGroupCommand {
    group: GroupDefinitionCommand,
    active_rules: Vec<RecurrenceRuleCommand>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GroupDefinitionCommand {
    branch_id: Uuid,
    #[serde(default)]
    room_id: Option<Uuid>,
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    teacher_ids: Vec<Uuid>,
    #[serde(default)]
    min_age_months: Option<i32>,
    #[serde(default)]
    max_age_months: Option<i32>,
    #[serde(default)]
    capacity: Option<i32>,
    #[serde(default)]
    trial_policy_override: Option<TrialPolicy>,
    #[serde(default)]
    track_attendance_override: Option<bool>,
    #[serde(default)]
    allow_single_visits_override: Option<bool>,
    status: super::group_directory::GroupStatus,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecurrenceRuleCommand {
    #[serde(default)]
    id: Option<Uuid>,
    starts_on: NaiveDate,
    ends_on: NaiveDate,
    weekdays: Vec<Weekday>,
    start_time: String,
    end_time: String,
    #[serde(default)]
    branch_id_override: Option<Uuid>,
    #[serde(default)]
    room_override_set: bool,
    #[serde(default)]
    room_id_override: Option<Uuid>,
    #[serde(default)]
    teacher_ids_override: Option<Vec<Uuid>>,
    #[serde(default)]
    capacity_override_set: bool,
    #[serde(default)]
    capacity_override: Option<i32>,
    #[serde(default)]
    trial_policy_override: Option<TrialPolicy>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateTariffCommand {
    name: String,
    #[serde(default)]
    description: Option<String>,
    price_minor: i64,
    currency: String,
    weekly_schedule_limit: i16,
    #[serde(default)]
    payment_day_of_month: Option<i16>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateFamilyCommand {
    display_name: String,
    representative_name: String,
    phone: String,
    phone_normalized: String,
    phone_match_digest: String,
    #[serde(default = "default_phone_contact_channel")]
    preferred_contact_channel: String,
    child_name: String,
    child_birth_date: NaiveDate,
    #[serde(default)]
    child_note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EnrollParticipantCommand {
    family_id: Uuid,
    child_id: Uuid,
    group_id: Uuid,
    tariff_id: Uuid,
    start_date: NaiveDate,
    schedule: Vec<EnrollmentScheduleCommand>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EnrollmentScheduleCommand {
    recurrence_rule_id: Uuid,
    weekday: Weekday,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "action",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum PaymentMutationCommand {
    MarkPaid {
        expected_version: i64,
    },
    Cancel {
        expected_version: i64,
        reason: String,
    },
    RecordPayment {
        expected_version: i64,
        amount_minor: i64,
        method: super::payment_queue::PaymentMethod,
        #[serde(default)]
        note: Option<String>,
    },
    RefundPayment {
        expected_version: i64,
        amount_minor: i64,
        reason: String,
    },
    Restore {
        expected_version: i64,
        reason: String,
    },
    ChangeAmount {
        expected_version: i64,
        amount_minor: i64,
    },
    MoveDueDate {
        expected_version: i64,
        due_date: NaiveDate,
        reason: String,
    },
}

impl PaymentMutationCommand {
    fn into_change(self) -> (i64, PaymentChange) {
        match self {
            Self::MarkPaid { expected_version } => (expected_version, PaymentChange::MarkPaid),
            Self::Cancel {
                expected_version,
                reason,
            } => (expected_version, PaymentChange::Cancel { reason }),
            Self::RecordPayment {
                expected_version,
                amount_minor,
                method,
                note,
            } => (
                expected_version,
                PaymentChange::RecordPayment {
                    amount_minor,
                    method,
                    note,
                },
            ),
            Self::RefundPayment {
                expected_version,
                amount_minor,
                reason,
            } => (
                expected_version,
                PaymentChange::RefundPayment {
                    amount_minor,
                    reason,
                },
            ),
            Self::Restore {
                expected_version,
                reason,
            } => (expected_version, PaymentChange::Restore { reason }),
            Self::ChangeAmount {
                expected_version,
                amount_minor,
            } => (
                expected_version,
                PaymentChange::ChangeAmount { amount_minor },
            ),
            Self::MoveDueDate {
                expected_version,
                due_date,
                reason,
            } => (
                expected_version,
                PaymentChange::MoveDueDate { due_date, reason },
            ),
        }
    }
}

fn default_phone_contact_channel() -> String {
    "phone".to_owned()
}

fn validate_input(input: &NewPendingAgentAction, now: DateTime<Utc>) -> Result<()> {
    if input.specialist_role != AirhopWelcomeRole::Administrator {
        return Err(DbError::AccessDenied(
            "only the registered Airhop Administrator may prepare setup actions".to_owned(),
        ));
    }
    if !input.command.is_object() {
        return Err(DbError::InvalidData(
            "Airhop agent command must be a JSON object".to_owned(),
        ));
    }
    if !input.expected_versions.is_object() {
        return Err(DbError::InvalidData(
            "Airhop expectedVersions must be a JSON object".to_owned(),
        ));
    }
    if input.expires_at <= now {
        return Err(DbError::InvalidData(
            "Airhop agent action expiry must be in the future".to_owned(),
        ));
    }
    Ok(())
}

impl Db {
    /// Prepares exactly one pending action for a human Welcome event.
    ///
    /// The source event row is locked so concurrent corrected commands cannot
    /// leave more than one pending action. An exact retry returns the original
    /// row; a different digest cancels older pending rows before insertion.
    pub async fn prepare_airhop_agent_action(
        &self,
        tenant: &TenantContext,
        input: &NewPendingAgentAction,
    ) -> Result<PreparedAgentAction> {
        validate_input(input, Utc::now())?;
        let community_id = *tenant.community().as_uuid();
        let mut tx = self.pool.begin().await?;

        let team = sqlx::query(
            "SELECT team.organization_id, team.channel_id, team.fizz_pubkey,
                    team.administrator_pubkey, team.analyst_pubkey,
                    team.content_marketer_pubkey
             FROM airhop_welcome_teams team
             JOIN channels channel
               ON channel.community_id = team.community_id
              AND channel.id = team.channel_id
             WHERE team.community_id = $1
               AND channel.channel_type = 'stream'
               AND channel.visibility = 'private'
               AND channel.archived_at IS NULL
               AND channel.deleted_at IS NULL
             FOR UPDATE OF team",
        )
        .bind(community_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| DbError::NotFound("active Airhop Welcome team".to_owned()))?;
        let organization_id: Uuid = team.try_get("organization_id")?;
        let registered_channel: Uuid = team.try_get("channel_id")?;
        if input.channel_id != registered_channel {
            return Err(DbError::AccessDenied(
                "agent action is outside the registered Welcome channel".to_owned(),
            ));
        }
        let administrator = vec_to_id(
            team.try_get("administrator_pubkey")?,
            "registered Administrator",
        )?;
        if input.prepared_by_agent_pubkey != administrator {
            return Err(DbError::AccessDenied(
                "only the registered Airhop Administrator may prepare setup actions".to_owned(),
            ));
        }

        let source = sqlx::query(
            "SELECT pubkey, kind, channel_id
             FROM events
             WHERE community_id = $1 AND id = $2 AND deleted_at IS NULL
             ORDER BY created_at DESC
             LIMIT 1
             FOR UPDATE",
        )
        .bind(community_id)
        .bind(input.triggering_event_id.as_slice())
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| DbError::NotFound("live Airhop Welcome source event".to_owned()))?;
        let source_channel: Option<Uuid> = source.try_get("channel_id")?;
        if source_channel != Some(registered_channel) {
            return Err(DbError::AccessDenied(
                "agent action source event is outside Welcome".to_owned(),
            ));
        }
        let source_kind: i32 = source.try_get("kind")?;
        if source_kind != i32::from(buzz_core::kind::KIND_STREAM_MESSAGE as u16) {
            return Err(DbError::InvalidData(
                "agent actions require a human stream-message source".to_owned(),
            ));
        }
        let initiator = vec_to_id(source.try_get("pubkey")?, "action initiator")?;
        for column in [
            "fizz_pubkey",
            "administrator_pubkey",
            "analyst_pubkey",
            "content_marketer_pubkey",
        ] {
            if initiator == vec_to_id(team.try_get(column)?, "registered Welcome agent")? {
                return Err(DbError::AccessDenied(
                    "agent-authored events cannot initiate setup actions".to_owned(),
                ));
            }
        }

        sqlx::query(
            "UPDATE airhop_agent_actions
             SET status = 'expired', updated_at = now()
             WHERE community_id = $1 AND triggering_event_id = $2
               AND status = 'pending' AND expires_at <= now()",
        )
        .bind(community_id)
        .bind(input.triggering_event_id.as_slice())
        .execute(&mut *tx)
        .await?;

        if let Some(row) = select_action(
            &mut tx,
            community_id,
            input.triggering_event_id,
            input.command_digest,
        )
        .await?
        {
            let action = action_from_row(&row)?;
            tx.commit().await?;
            return Ok(PreparedAgentAction {
                action,
                replayed: true,
                cancelled_action_ids: Vec::new(),
            });
        }

        let already_committed: bool = sqlx::query_scalar(
            "SELECT EXISTS(
                SELECT 1 FROM airhop_agent_actions
                WHERE community_id = $1 AND triggering_event_id = $2
                  AND status = 'committed'
             )",
        )
        .bind(community_id)
        .bind(input.triggering_event_id.as_slice())
        .fetch_one(&mut *tx)
        .await?;
        if already_committed {
            return Err(DbError::AirhopVersionConflict);
        }

        let cancelled = sqlx::query_scalar::<_, Uuid>(
            "UPDATE airhop_agent_actions
             SET status = 'cancelled', updated_at = now()
             WHERE community_id = $1 AND triggering_event_id = $2
               AND status = 'pending' AND command_digest <> $3
             RETURNING id",
        )
        .bind(community_id)
        .bind(input.triggering_event_id.as_slice())
        .bind(input.command_digest.as_slice())
        .fetch_all(&mut *tx)
        .await?;

        let id = Uuid::new_v4();
        let row = sqlx::query(
            "INSERT INTO airhop_agent_actions (
                community_id, organization_id, id, channel_id,
                triggering_event_id, initiator_pubkey, prepared_by_agent_pubkey,
                specialist_role, command, command_digest, expected_versions,
                status, expires_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                       'pending', $12)
             RETURNING id, organization_id, channel_id, triggering_event_id,
                 initiator_pubkey, prepared_by_agent_pubkey, specialist_role,
                 command, command_digest, expected_versions, preview_event_id,
                 status, expires_at, created_at",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(id)
        .bind(registered_channel)
        .bind(input.triggering_event_id.as_slice())
        .bind(initiator.as_slice())
        .bind(administrator.as_slice())
        .bind(input.specialist_role.as_str())
        .bind(&input.command)
        .bind(input.command_digest.as_slice())
        .bind(&input.expected_versions)
        .bind(input.expires_at)
        .fetch_one(&mut *tx)
        .await?;
        let action = action_from_row(&row)?;
        tx.commit().await?;
        Ok(PreparedAgentAction {
            action,
            replayed: false,
            cancelled_action_ids: cancelled,
        })
    }

    /// Atomically reserves the deterministic relay preview event ID.
    pub async fn reserve_airhop_agent_action_preview(
        &self,
        tenant: &TenantContext,
        action_id: Uuid,
        preview_event_id: [u8; 32],
    ) -> Result<PendingAgentAction> {
        let community_id = *tenant.community().as_uuid();
        let row = sqlx::query(
            "UPDATE airhop_agent_actions
             SET preview_event_id = COALESCE(preview_event_id, $3), updated_at = now()
             WHERE community_id = $1 AND id = $2 AND status = 'pending'
               AND expires_at > now()
               AND (preview_event_id IS NULL OR preview_event_id = $3)
             RETURNING id, organization_id, channel_id, triggering_event_id,
                 initiator_pubkey, prepared_by_agent_pubkey, specialist_role,
                 command, command_digest, expected_versions, preview_event_id,
                 status, expires_at, created_at",
        )
        .bind(community_id)
        .bind(action_id)
        .bind(preview_event_id.as_slice())
        .fetch_optional(&self.pool)
        .await?
        .ok_or(DbError::AirhopVersionConflict)?;
        action_from_row(&row)
    }
}

/// Applies the exact relay-signed action preview inside the reaction transaction.
///
/// The caller owns the transaction that also inserts the kind:7 event and
/// reaction row. Every failed identity, version, or expiry fence therefore
/// rolls those visual writes back together with the domain command.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn commit_airhop_agent_action_from_reaction(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    tagged_organization_id: Uuid,
    action_id: Uuid,
    tagged_command_digest: [u8; 32],
    channel_id: Uuid,
    confirmer_pubkey: &[u8],
    reaction_event_id: &[u8],
    target_event_id: &[u8],
) -> Result<AgentActionCommitOutcome> {
    let confirmer_pubkey: [u8; 32] = confirmer_pubkey.try_into().map_err(|_| {
        DbError::InvalidData("Airhop action confirmer public key is invalid".to_owned())
    })?;
    let reaction_event_id: [u8; 32] = reaction_event_id.try_into().map_err(|_| {
        DbError::InvalidData("Airhop action reaction event id is invalid".to_owned())
    })?;
    let target_event_id: [u8; 32] = target_event_id.try_into().map_err(|_| {
        DbError::InvalidData("Airhop action preview event id is invalid".to_owned())
    })?;
    if tagged_organization_id.is_nil() || action_id.is_nil() || channel_id.is_nil() {
        return Err(DbError::InvalidData(
            "Airhop action confirmation identity is invalid".to_owned(),
        ));
    }

    // Preparation locks the Welcome team before it updates pending actions.
    // Confirmation uses the same order so a correction cannot deadlock with a
    // reaction that is committing the superseded preview.
    let team = sqlx::query(
        "SELECT organization_id, channel_id, fizz_pubkey,
                administrator_pubkey, analyst_pubkey, content_marketer_pubkey
         FROM airhop_welcome_teams
         WHERE community_id = $1
         FOR UPDATE",
    )
    .bind(tenant.community().as_uuid())
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or(DbError::AirhopVersionConflict)?;

    let row = sqlx::query(
        "SELECT id, organization_id, channel_id, triggering_event_id,
                initiator_pubkey, prepared_by_agent_pubkey, specialist_role,
                command, command_digest, expected_versions, preview_event_id,
                status, expires_at, created_at, result
         FROM airhop_agent_actions
         WHERE community_id = $1 AND id = $2
         FOR UPDATE",
    )
    .bind(tenant.community().as_uuid())
    .bind(action_id)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or(DbError::AirhopVersionConflict)?;
    let action = action_from_row(&row)?;
    if action.organization_id != tagged_organization_id
        || action.channel_id != channel_id
        || action.command_digest != tagged_command_digest
        || action.preview_event_id != Some(target_event_id)
    {
        return Err(DbError::AirhopVersionConflict);
    }
    if !matches!(
        action.status,
        AgentActionStatus::Pending | AgentActionStatus::Committed
    ) || (action.status == AgentActionStatus::Pending && action.expires_at <= Utc::now())
    {
        return Err(DbError::AirhopVersionConflict);
    }

    if team.try_get::<Uuid, _>("organization_id")? != action.organization_id
        || team.try_get::<Uuid, _>("channel_id")? != action.channel_id
    {
        return Err(DbError::AirhopVersionConflict);
    }
    let administrator = vec_to_id(
        team.try_get("administrator_pubkey")?,
        "registered Administrator",
    )?;
    if action.specialist_role != AirhopWelcomeRole::Administrator
        || action.prepared_by_agent_pubkey != administrator
    {
        return Err(DbError::AccessDenied(
            "agent action was not prepared by the registered Administrator".to_owned(),
        ));
    }
    for column in [
        "fizz_pubkey",
        "administrator_pubkey",
        "analyst_pubkey",
        "content_marketer_pubkey",
    ] {
        if confirmer_pubkey == vec_to_id(team.try_get(column)?, "registered Welcome agent")? {
            return Err(DbError::AccessDenied(
                "Welcome agents cannot confirm their own actions".to_owned(),
            ));
        }
    }
    let confirmer_is_agent: bool = sqlx::query_scalar(
        "SELECT
            EXISTS(
                SELECT 1 FROM users
                WHERE community_id = $1 AND pubkey = $2
                  AND agent_type IS NOT NULL AND deactivated_at IS NULL
            ) OR EXISTS(
                SELECT 1 FROM channel_members
                WHERE community_id = $1 AND channel_id = $3 AND pubkey = $2
                  AND role = 'bot' AND removed_at IS NULL
            )",
    )
    .bind(tenant.community().as_uuid())
    .bind(confirmer_pubkey.as_slice())
    .bind(action.channel_id)
    .fetch_one(&mut **transaction)
    .await?;
    if confirmer_is_agent {
        return Err(DbError::AccessDenied(
            "only a human may confirm an Airhop agent action".to_owned(),
        ));
    }

    let current_digest: [u8; 32] = Sha256::digest(serde_json::to_vec(&action.command)?).into();
    if current_digest != action.command_digest {
        return Err(DbError::AirhopVersionConflict);
    }
    if action.status == AgentActionStatus::Committed {
        let result = row.try_get::<Option<Value>, _>("result")?.ok_or_else(|| {
            DbError::InvalidData("committed Airhop action has no result".to_owned())
        })?;
        return Ok(AgentActionCommitOutcome {
            action_id,
            status: AgentActionStatus::Committed,
            result,
            replayed: true,
        });
    }
    let command: StoredAgentCommand = serde_json::from_value(action.command.clone())?;
    if matches!(&command, StoredAgentCommand::PutOrganizationSettings(_)) {
        lock_airhop_organization_settings_write(transaction, tenant).await?;
    }
    require_expected_versions(transaction, tenant, &action).await?;

    let actor = AirhopActor {
        kind: ActorKind::Bot,
        pubkey: Some(action.prepared_by_agent_pubkey),
        on_behalf_of_pubkey: Some(confirmer_pubkey),
        agent_pubkey: Some(action.prepared_by_agent_pubkey),
    };
    let (command_type, result_ids, versions) = match command {
        StoredAgentCommand::PutOrganizationSettings(command) => {
            let outcome = put_airhop_organization_settings_in_transaction(
                transaction,
                tenant,
                &PutOrganizationSettingsInput {
                    expected_version: command.expected_version,
                    name: command.name,
                    locale: command.locale,
                    time_zone: command.time_zone,
                    payments_buzz_channel_id: command.payments_buzz_channel_id,
                    analytics_buzz_channel_id: command.analytics_buzz_channel_id,
                    settings: OrganizationSettings {
                        default_trial_policy: command.default_trial_policy,
                        track_attendance_by_default: command.track_attendance_by_default,
                        allow_single_visits_by_default: command.allow_single_visits_by_default,
                        existing_students_onboarding_status: command
                            .existing_students_onboarding_status,
                        public_booking_purpose: command.public_booking_purpose,
                        public_booking_appearance: command.public_booking_appearance,
                        payment_day_of_month: command.payment_day_of_month,
                    },
                    idempotency_digest: action_command_idempotency_digest(
                        action.id,
                        "put_organization_settings",
                    ),
                    request_hash: action.command_digest,
                    actor: actor.clone(),
                },
            )
            .await?;
            (
                "put_organization_settings",
                json!({"organizationId": outcome.organization_id}),
                json!({"organization": outcome.version}),
            )
        }
        StoredAgentCommand::CreateBranch(command) => {
            let mut working_periods = Vec::new();
            for (weekday, periods) in command.working_hours {
                for period in periods {
                    let start_time = parse_branch_time(&period.start_time)?;
                    let end_time = parse_branch_time(&period.end_time)?;
                    working_periods.push(BranchWorkingPeriod {
                        weekday,
                        start_time,
                        end_time,
                    });
                }
            }
            let outcome = create_airhop_branch_in_transaction(
                transaction,
                tenant,
                &CreateBranchInput {
                    name: command.name,
                    address: command.address,
                    working_periods,
                    default_buzz_channel_id: command.default_buzz_channel_id,
                    idempotency_digest: action_command_idempotency_digest(
                        action.id,
                        "create_branch",
                    ),
                    request_hash: action.command_digest,
                    actor: actor.clone(),
                },
            )
            .await?;
            (
                "create_branch",
                json!({"branchId": outcome.branch_id}),
                json!({"branch": outcome.version}),
            )
        }
        StoredAgentCommand::CreateRoom { branch_id, body } => {
            let outcome = create_airhop_room_in_transaction(
                transaction,
                tenant,
                &CreateRoomInput {
                    branch_id,
                    name: body.name,
                    idempotency_digest: action_command_idempotency_digest(action.id, "create_room"),
                    request_hash: action.command_digest,
                    actor: actor.clone(),
                },
            )
            .await?;
            (
                "create_room",
                json!({"roomId": outcome.room_id}),
                json!({"room": outcome.version}),
            )
        }
        StoredAgentCommand::CreateTeacher(command) => {
            let outcome = create_airhop_teacher_in_transaction(
                transaction,
                tenant,
                &CreateTeacherInput {
                    display_name: command.display_name,
                    buzz_username: command.buzz_username,
                    idempotency_digest: action_command_idempotency_digest(
                        action.id,
                        "create_teacher",
                    ),
                    request_hash: action.command_digest,
                    actor: actor.clone(),
                },
            )
            .await?;
            (
                "create_teacher",
                json!({"teacherId": outcome.teacher_id}),
                json!({"teacher": outcome.version}),
            )
        }
        StoredAgentCommand::CreateTariff(command) => {
            let outcome = create_airhop_tariff_in_transaction(
                transaction,
                tenant,
                &CreateTariffInput {
                    name: command.name,
                    description: command.description,
                    price_minor: command.price_minor,
                    currency: command.currency.trim().to_ascii_uppercase(),
                    weekly_schedule_limit: command.weekly_schedule_limit,
                    payment_day_of_month: command.payment_day_of_month,
                    idempotency_digest: action_command_idempotency_digest(
                        action.id,
                        "create_tariff",
                    ),
                    request_hash: action.command_digest,
                    actor: actor.clone(),
                },
            )
            .await?;
            (
                "create_tariff",
                json!({"tariffId": outcome.tariff_id}),
                json!({"tariff": outcome.version}),
            )
        }
        StoredAgentCommand::CreateGroup(command) => {
            let group = GroupDefinition {
                branch_id: command.group.branch_id,
                room_id: command.group.room_id,
                name: command.group.name,
                description: command.group.description,
                teacher_ids: command.group.teacher_ids,
                min_age_months: command.group.min_age_months,
                max_age_months: command.group.max_age_months,
                capacity: command.group.capacity,
                trial_policy_override: command.group.trial_policy_override,
                track_attendance_override: command.group.track_attendance_override,
                allow_single_visits_override: command.group.allow_single_visits_override,
                status: command.group.status,
            };
            let active_rules = command
                .active_rules
                .into_iter()
                .map(|rule| {
                    Ok(RecurrenceRuleInput {
                        id: rule.id,
                        starts_on: rule.starts_on,
                        ends_on: rule.ends_on,
                        weekdays: rule.weekdays,
                        start_time: parse_local_time(&rule.start_time)?,
                        end_time: parse_local_time(&rule.end_time)?,
                        branch_id_override: rule.branch_id_override,
                        room_override_set: rule.room_override_set,
                        room_id_override: rule.room_id_override,
                        teacher_ids_override: rule.teacher_ids_override,
                        capacity_override_set: rule.capacity_override_set,
                        capacity_override: rule.capacity_override,
                        trial_policy_override: rule.trial_policy_override,
                    })
                })
                .collect::<Result<Vec<_>>>()?;
            let outcome = create_airhop_group_in_transaction(
                transaction,
                tenant,
                &CreateGroupInput {
                    group,
                    active_rules,
                    idempotency_digest: action_command_idempotency_digest(
                        action.id,
                        "create_group",
                    ),
                    request_hash: action.command_digest,
                    actor: actor.clone(),
                },
            )
            .await?;
            (
                "create_group",
                json!({"groupId": outcome.group_id}),
                json!({"group": outcome.version}),
            )
        }
        StoredAgentCommand::CreateFamily(command) => {
            let phone_match_digest =
                decode_hex_id(&command.phone_match_digest, "family phone match digest")?;
            let outcome = create_airhop_family_in_transaction(
                transaction,
                tenant,
                &CreateFamilyInput {
                    display_name: command.display_name,
                    representative_name: command.representative_name,
                    phone_normalized: command.phone_normalized,
                    phone_display: command.phone,
                    phone_match_digest,
                    preferred_contact_channel: command.preferred_contact_channel,
                    child_name: command.child_name,
                    child_birth_date: command.child_birth_date,
                    child_note: command.child_note,
                    idempotency_digest: action_command_idempotency_digest(
                        action.id,
                        "create_family",
                    ),
                    request_hash: action.command_digest,
                    actor: actor.clone(),
                },
            )
            .await?;
            (
                "create_family",
                json!({
                    "familyId": outcome.family_id,
                    "representativeId": outcome.representative_id,
                    "childId": outcome.child_id,
                }),
                json!({"family": 1}),
            )
        }
        StoredAgentCommand::EnrollParticipant(command) => {
            let outcome = enroll_airhop_staff_participant_in_transaction(
                transaction,
                tenant,
                &EnrollStaffParticipantInput {
                    family_id: command.family_id,
                    child_id: command.child_id,
                    group_id: command.group_id,
                    tariff_id: command.tariff_id,
                    start_date: command.start_date,
                    schedule: command
                        .schedule
                        .into_iter()
                        .map(|selection| EnrollmentScheduleSelection {
                            recurrence_rule_id: selection.recurrence_rule_id,
                            weekday: selection.weekday,
                        })
                        .collect(),
                    idempotency_digest: action_command_idempotency_digest(
                        action.id,
                        "enroll_participant",
                    ),
                    request_hash: action.command_digest,
                    actor: actor.clone(),
                },
            )
            .await?;
            (
                "enroll_participant",
                json!({
                    "childId": outcome.child_id,
                    "enrollmentId": outcome.enrollment_id,
                    "paymentExpectationId": outcome.payment_expectation_id,
                }),
                json!({
                    "enrollment": outcome.enrollment_version,
                    "payment": outcome.payment_version,
                }),
            )
        }
        StoredAgentCommand::MutatePayment { payment_id, body } => {
            let (expected_version, change) = body.into_change();
            let outcome = mutate_airhop_payment_in_transaction(
                transaction,
                tenant,
                &MutatePaymentInput {
                    payment_id,
                    expected_version,
                    change,
                    idempotency_digest: action_command_idempotency_digest(
                        action.id,
                        "mutate_payment",
                    ),
                    request_hash: action.command_digest,
                    actor: actor.clone(),
                },
            )
            .await?;
            (
                "mutate_payment",
                json!({"paymentId": outcome.payment_id}),
                json!({"payment": outcome.version}),
            )
        }
    };
    let result = json!({
        "commandType": command_type,
        "resultIds": result_ids,
        "versions": versions,
        "audit": {
            "initiatorEventId": hex::encode(action.triggering_event_id),
            "initiatorPubkey": hex::encode(action.initiator_pubkey),
            "preparerAgentPubkey": hex::encode(action.prepared_by_agent_pubkey),
            "preparerRole": action.specialist_role.as_str(),
            "confirmerPubkey": hex::encode(confirmer_pubkey),
            "previewEventId": hex::encode(target_event_id),
            "reactionEventId": hex::encode(reaction_event_id),
            "commandDigest": hex::encode(action.command_digest),
        }
    });
    let updated = sqlx::query(
        "UPDATE airhop_agent_actions
         SET status = 'committed', confirmed_by_pubkey = $3,
             reaction_event_id = $4, result = $5,
             committed_at = now(), updated_at = now()
         WHERE community_id = $1 AND id = $2 AND status = 'pending'",
    )
    .bind(tenant.community().as_uuid())
    .bind(action.id)
    .bind(confirmer_pubkey.as_slice())
    .bind(reaction_event_id.as_slice())
    .bind(&result)
    .execute(&mut **transaction)
    .await?;
    if updated.rows_affected() != 1 {
        return Err(DbError::AirhopVersionConflict);
    }
    Ok(AgentActionCommitOutcome {
        action_id: action.id,
        status: AgentActionStatus::Committed,
        result,
        replayed: false,
    })
}

async fn require_expected_versions(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    action: &PendingAgentAction,
) -> Result<()> {
    let versions = action.expected_versions.as_object().ok_or_else(|| {
        DbError::InvalidData("Airhop action expected versions are invalid".to_owned())
    })?;
    let expected_organization = versions
        .get("organization")
        .and_then(Value::as_i64)
        .ok_or_else(|| {
            DbError::InvalidData("Airhop action has no expected organization version".to_owned())
        })?;
    let current: i64 = sqlx::query_scalar(
        "SELECT version FROM airhop_organizations
         WHERE community_id = $1 AND id = $2 AND status = 'active'
         FOR UPDATE",
    )
    .bind(tenant.community().as_uuid())
    .bind(action.organization_id)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or(DbError::AirhopVersionConflict)?;
    if current != expected_organization {
        return Err(DbError::AirhopVersionConflict);
    }

    for (key, value) in versions {
        if key == "organization" || key.starts_with("command.") {
            if value.as_i64().is_none_or(|version| version < 0) {
                return Err(DbError::InvalidData(
                    "Airhop action expected version is invalid".to_owned(),
                ));
            }
            continue;
        }
        let Some((kind, raw_id)) = key.split_once(':') else {
            return Err(DbError::InvalidData(format!(
                "unknown Airhop expected version key {key:?}"
            )));
        };
        let id = Uuid::parse_str(raw_id).map_err(|_| {
            DbError::InvalidData(format!("invalid Airhop expected version key {key:?}"))
        })?;
        let expected = value
            .as_i64()
            .filter(|version| *version > 0)
            .ok_or_else(|| {
                DbError::InvalidData(format!("invalid Airhop expected version for {key:?}"))
            })?;
        let query = match kind {
            "branch" => {
                "SELECT version FROM airhop_branches
                WHERE community_id = $1 AND organization_id = $2 AND id = $3
                  AND status = 'active' FOR UPDATE"
            }
            "room" => {
                "SELECT version FROM airhop_rooms
                WHERE community_id = $1 AND organization_id = $2 AND id = $3
                  AND status = 'active' FOR UPDATE"
            }
            "teacher" => {
                "SELECT version FROM airhop_teachers
                WHERE community_id = $1 AND organization_id = $2 AND id = $3
                  AND status = 'active' FOR UPDATE"
            }
            "group" => {
                "SELECT version FROM airhop_groups
                WHERE community_id = $1 AND organization_id = $2 AND id = $3
                  AND status = 'active' FOR UPDATE"
            }
            "tariff" => {
                "SELECT version FROM airhop_tariffs
                WHERE community_id = $1 AND organization_id = $2 AND id = $3
                  AND status = 'active' FOR UPDATE"
            }
            "family" => {
                "SELECT version FROM airhop_families
                WHERE community_id = $1 AND organization_id = $2 AND id = $3
                  AND status = 'active' FOR UPDATE"
            }
            "child" => {
                "SELECT version FROM airhop_children
                WHERE community_id = $1 AND organization_id = $2 AND id = $3
                  AND status = 'active' FOR UPDATE"
            }
            "recurrenceRule" => {
                "SELECT version FROM airhop_recurrence_rules
                WHERE community_id = $1 AND organization_id = $2 AND id = $3
                  AND status = 'active' FOR UPDATE"
            }
            "payment" => {
                "SELECT version FROM airhop_payment_expectations
                WHERE community_id = $1 AND organization_id = $2 AND id = $3
                FOR UPDATE"
            }
            _ => {
                return Err(DbError::InvalidData(format!(
                    "unknown Airhop expected resource kind {kind:?}"
                )));
            }
        };
        let current: i64 = sqlx::query_scalar(query)
            .bind(tenant.community().as_uuid())
            .bind(action.organization_id)
            .bind(id)
            .fetch_optional(&mut **transaction)
            .await?
            .ok_or(DbError::AirhopVersionConflict)?;
        if current != expected {
            return Err(DbError::AirhopVersionConflict);
        }
    }
    Ok(())
}

fn parse_branch_time(value: &str) -> Result<NaiveTime> {
    NaiveTime::parse_from_str(value, "%H:%M")
        .map_err(|_| DbError::InvalidData("invalid Airhop branch working time".to_owned()))
}

fn parse_local_time(value: &str) -> Result<NaiveTime> {
    NaiveTime::parse_from_str(value, "%H:%M")
        .map_err(|_| DbError::InvalidData("invalid Airhop local time".to_owned()))
}

fn decode_hex_id(value: &str, label: &str) -> Result<[u8; 32]> {
    let bytes =
        hex::decode(value).map_err(|_| DbError::InvalidData(format!("invalid Airhop {label}")))?;
    bytes.try_into().map_err(|bytes: Vec<u8>| {
        DbError::InvalidData(format!(
            "Airhop {label} must contain 32 bytes, got {}",
            bytes.len()
        ))
    })
}

fn action_command_idempotency_digest(action_id: Uuid, command_type: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"airhop.agent-action.domain-command.v1\0");
    hasher.update(action_id.as_bytes());
    hasher.update(command_type.as_bytes());
    hasher.finalize().into()
}

async fn select_action(
    connection: &mut PgConnection,
    community_id: Uuid,
    triggering_event_id: [u8; 32],
    command_digest: [u8; 32],
) -> Result<Option<sqlx::postgres::PgRow>> {
    sqlx::query(
        "SELECT id, organization_id, channel_id, triggering_event_id,
             initiator_pubkey, prepared_by_agent_pubkey, specialist_role,
             command, command_digest, expected_versions, preview_event_id,
             status, expires_at, created_at
         FROM airhop_agent_actions
         WHERE community_id = $1 AND triggering_event_id = $2 AND command_digest = $3",
    )
    .bind(community_id)
    .bind(triggering_event_id.as_slice())
    .bind(command_digest.as_slice())
    .fetch_optional(connection)
    .await
    .map_err(Into::into)
}

fn action_from_row(row: &sqlx::postgres::PgRow) -> Result<PendingAgentAction> {
    Ok(PendingAgentAction {
        id: row.try_get("id")?,
        organization_id: row.try_get("organization_id")?,
        channel_id: row.try_get("channel_id")?,
        triggering_event_id: vec_to_id(row.try_get("triggering_event_id")?, "trigger event")?,
        initiator_pubkey: vec_to_id(row.try_get("initiator_pubkey")?, "initiator")?,
        prepared_by_agent_pubkey: vec_to_id(
            row.try_get("prepared_by_agent_pubkey")?,
            "preparing agent",
        )?,
        specialist_role: parse_role(row.try_get("specialist_role")?)?,
        command: row.try_get("command")?,
        command_digest: vec_to_id(row.try_get("command_digest")?, "command digest")?,
        expected_versions: row.try_get("expected_versions")?,
        preview_event_id: row
            .try_get::<Option<Vec<u8>>, _>("preview_event_id")?
            .map(|value| vec_to_id(value, "preview event"))
            .transpose()?,
        status: AgentActionStatus::parse(row.try_get("status")?)?,
        expires_at: row.try_get("expires_at")?,
        created_at: row.try_get("created_at")?,
    })
}

fn parse_role(value: &str) -> Result<AirhopWelcomeRole> {
    match value {
        "fizz" => Ok(AirhopWelcomeRole::Fizz),
        "administrator" => Ok(AirhopWelcomeRole::Administrator),
        "analyst" => Ok(AirhopWelcomeRole::Analyst),
        "content_marketer" => Ok(AirhopWelcomeRole::ContentMarketer),
        other => Err(DbError::InvalidData(format!(
            "unknown Airhop specialist role: {other}"
        ))),
    }
}

fn vec_to_id(value: Vec<u8>, label: &str) -> Result<[u8; 32]> {
    value.try_into().map_err(|value: Vec<u8>| {
        DbError::InvalidData(format!(
            "Airhop {label} must contain 32 bytes, got {}",
            value.len()
        ))
    })
}

#[cfg(test)]
mod tests {
    use chrono::Duration;
    use serde_json::json;
    use sha2::Digest;

    use super::*;

    #[allow(clippy::too_many_arguments)]
    async fn prepare_test_preview(
        db: &Db,
        tenant: &buzz_core::TenantContext,
        organization_id: Uuid,
        channel_id: Uuid,
        administrator_pubkey: [u8; 32],
        source_keys: &nostr::Keys,
        relay_keys: &nostr::Keys,
        command: Value,
        expected_versions: Value,
        expires_at: DateTime<Utc>,
        tagged_digest: Option<[u8; 32]>,
    ) -> (PreparedAgentAction, nostr::Event, [u8; 32]) {
        let source = nostr::EventBuilder::new(
            nostr::Kind::Custom(9),
            format!("prepare action {}", Uuid::new_v4()),
        )
        .tags([nostr::Tag::parse(["h", &channel_id.to_string()]).unwrap()])
        .sign_with_keys(source_keys)
        .unwrap();
        db.insert_event(tenant.community(), &source, Some(channel_id))
            .await
            .unwrap();
        let digest: [u8; 32] = sha2::Sha256::digest(serde_json::to_vec(&command).unwrap()).into();
        let prepared = db
            .prepare_airhop_agent_action(
                tenant,
                &NewPendingAgentAction {
                    channel_id,
                    triggering_event_id: *source.id.as_bytes(),
                    prepared_by_agent_pubkey: administrator_pubkey,
                    specialist_role: AirhopWelcomeRole::Administrator,
                    command,
                    command_digest: digest,
                    expected_versions,
                    expires_at,
                },
            )
            .await
            .unwrap();
        let tagged_digest = tagged_digest.unwrap_or(digest);
        let preview = nostr::EventBuilder::new(nostr::Kind::Custom(9), "Confirm action")
            .tags([
                nostr::Tag::parse(["h", &channel_id.to_string()]).unwrap(),
                nostr::Tag::parse([
                    "airhop-action",
                    &organization_id.to_string(),
                    &prepared.action.id.to_string(),
                    "1",
                    &hex::encode(tagged_digest),
                ])
                .unwrap(),
            ])
            .sign_with_keys(relay_keys)
            .unwrap();
        db.reserve_airhop_agent_action_preview(tenant, prepared.action.id, *preview.id.as_bytes())
            .await
            .unwrap();
        db.insert_event(tenant.community(), &preview, Some(channel_id))
            .await
            .unwrap();
        (prepared, preview, digest)
    }

    fn input(role: AirhopWelcomeRole) -> NewPendingAgentAction {
        NewPendingAgentAction {
            channel_id: Uuid::new_v4(),
            triggering_event_id: [1; 32],
            prepared_by_agent_pubkey: [2; 32],
            specialist_role: role,
            command: json!({"type": "create_room", "input": {"branchId": Uuid::nil(), "body": {"name": "Blue"}}}),
            command_digest: [3; 32],
            expected_versions: json!({"branch": 1}),
            expires_at: Utc::now() + Duration::hours(24),
        }
    }

    #[test]
    fn agent_actions_fail_closed_for_non_administrator_and_invalid_shapes() {
        let now = Utc::now();
        assert!(validate_input(&input(AirhopWelcomeRole::Fizz), now).is_err());
        assert!(validate_input(&input(AirhopWelcomeRole::Analyst), now).is_err());
        assert!(validate_input(&input(AirhopWelcomeRole::ContentMarketer), now).is_err());
        assert!(validate_input(&input(AirhopWelcomeRole::Administrator), now).is_ok());

        let mut invalid = input(AirhopWelcomeRole::Administrator);
        invalid.command = json!([]);
        assert!(validate_input(&invalid, now).is_err());
        invalid = input(AirhopWelcomeRole::Administrator);
        invalid.expected_versions = json!([]);
        assert!(validate_input(&invalid, now).is_err());
        invalid = input(AirhopWelcomeRole::Administrator);
        invalid.expires_at = now;
        assert!(validate_input(&invalid, now).is_err());
    }

    #[test]
    fn agent_action_status_wire_values_are_closed() {
        for status in [
            AgentActionStatus::Pending,
            AgentActionStatus::Cancelled,
            AgentActionStatus::Committed,
            AgentActionStatus::Expired,
            AgentActionStatus::Failed,
        ] {
            assert_eq!(AgentActionStatus::parse(status.as_str()).unwrap(), status);
        }
        assert!(AgentActionStatus::parse("approved").is_err());
    }

    #[test]
    fn stored_agent_command_closes_every_task8_variant() {
        let id = Uuid::from_u128(99);
        let commands = [
            (
                json!({
                    "type": "put_organization_settings",
                    "input": {
                        "expectedVersion": 1,
                        "name": "Airhop",
                        "locale": "en-US",
                        "timeZone": "UTC",
                        "paymentsBuzzChannelId": null,
                        "analyticsBuzzChannelId": null,
                        "defaultTrialPolicy": {"mode": "free"},
                        "trackAttendanceByDefault": true,
                        "allowSingleVisitsByDefault": false,
                        "existingStudentsOnboardingStatus": "not_started",
                        "publicBookingPurpose": "trial",
                        "publicBookingAppearance": "automatic",
                        "paymentDayOfMonth": 10
                    }
                }),
                "put_organization_settings",
            ),
            (
                json!({
                    "type": "create_branch",
                    "input": {"name": "Center", "address": "Main", "workingHours": {}}
                }),
                "create_branch",
            ),
            (
                json!({
                    "type": "create_room",
                    "input": {"branchId": id, "body": {"name": "Blue"}}
                }),
                "create_room",
            ),
            (
                json!({
                    "type": "create_teacher",
                    "input": {"displayName": "Alex", "buzzUsername": null}
                }),
                "create_teacher",
            ),
            (
                json!({
                    "type": "create_group",
                    "input": {
                        "group": {
                            "branchId": id,
                            "roomId": null,
                            "name": "Kids",
                            "description": null,
                            "teacherIds": [],
                            "minAgeMonths": null,
                            "maxAgeMonths": null,
                            "capacity": 12,
                            "trialPolicyOverride": null,
                            "trackAttendanceOverride": null,
                            "allowSingleVisitsOverride": null,
                            "status": "active"
                        },
                        "activeRules": []
                    }
                }),
                "create_group",
            ),
            (
                json!({
                    "type": "create_tariff",
                    "input": {
                        "name": "Base",
                        "description": null,
                        "priceMinor": 4200,
                        "currency": "EUR",
                        "weeklyScheduleLimit": 2,
                        "paymentDayOfMonth": null
                    }
                }),
                "create_tariff",
            ),
            (
                json!({
                    "type": "create_family",
                    "input": {
                        "displayName": "Smith",
                        "representativeName": "Sam",
                        "phone": "+12025550123",
                        "phoneNormalized": "+12025550123",
                        "phoneMatchDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                        "preferredContactChannel": "phone",
                        "childName": "Kim",
                        "childBirthDate": "2020-01-02",
                        "childNote": null
                    }
                }),
                "create_family",
            ),
            (
                json!({
                    "type": "enroll_participant",
                    "input": {
                        "familyId": id,
                        "childId": id,
                        "groupId": id,
                        "tariffId": id,
                        "startDate": "2026-08-21",
                        "schedule": []
                    }
                }),
                "enroll_participant",
            ),
            (
                json!({
                    "type": "mutate_payment",
                    "input": {
                        "paymentId": id,
                        "body": {"action": "mark_paid", "expectedVersion": 1}
                    }
                }),
                "mutate_payment",
            ),
        ];

        for (value, expected_kind) in commands {
            let command: StoredAgentCommand = serde_json::from_value(value).unwrap();
            assert_eq!(command.kind(), expected_kind);
        }
        assert!(serde_json::from_value::<StoredAgentCommand>(json!({
            "type": "delete_everything",
            "input": {}
        }))
        .is_err());
    }

    #[tokio::test]
    #[ignore = "requires a dedicated migrated Postgres database"]
    async fn agent_actions_are_atomic_idempotent_and_correction_safe() {
        use std::collections::BTreeMap;

        use crate::airhop::welcome_agents::PutWelcomeTeamInput;
        use buzz_core::{CommunityId, TenantContext};
        use nostr::{EventBuilder, Keys, Kind, Tag};

        let database_url = std::env::var("BUZZ_TEST_DATABASE_URL")
            .expect("BUZZ_TEST_DATABASE_URL must point to a dedicated migrated database");
        let db = Db::new(&crate::DbConfig {
            database_url,
            max_connections: 8,
            min_connections: 0,
            ..crate::DbConfig::default()
        })
        .await
        .expect("connect test database");
        db.migrate().await.expect("migrate test database");

        let community_id = Uuid::new_v4();
        let host = format!("agent-action-{}.test", community_id.simple());
        let tenant = TenantContext::resolved(CommunityId::from_uuid(community_id), host.clone());
        sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
            .bind(community_id)
            .bind(&host)
            .execute(&db.pool)
            .await
            .unwrap();

        let owner_keys = Keys::generate();
        let owner = owner_keys.public_key().to_bytes();
        db.bootstrap_owner(tenant.community(), &hex::encode(owner))
            .await
            .unwrap();
        let organization_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO airhop_organizations (
                community_id, id, name, locale, time_zone, default_trial_policy
             ) VALUES ($1, $2, 'Action test', 'ru-RU', 'Europe/Moscow', $3)",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(json!({"mode": "free"}))
        .execute(&db.pool)
        .await
        .unwrap();
        let channel = crate::channel::create_channel(
            &db.pool,
            tenant.community(),
            "Welcome actions",
            crate::channel::ChannelType::Stream,
            crate::channel::ChannelVisibility::Private,
            None,
            &owner,
            None,
        )
        .await
        .unwrap();

        let agent_keys = AirhopWelcomeRole::ALL.map(|_| Keys::generate());
        let members = BTreeMap::from_iter(
            AirhopWelcomeRole::ALL
                .into_iter()
                .zip(agent_keys.iter().map(|keys| keys.public_key().to_bytes())),
        );
        for pubkey in members.values() {
            sqlx::query(
                "INSERT INTO users (community_id, pubkey, agent_type)
                 VALUES ($1, $2, 'managed-agent')",
            )
            .bind(community_id)
            .bind(pubkey.as_slice())
            .execute(&db.pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO channel_members (
                    community_id, channel_id, pubkey, role, invited_by
                 ) VALUES ($1, $2, $3, 'bot', $4)",
            )
            .bind(community_id)
            .bind(channel.id)
            .bind(pubkey.as_slice())
            .bind(owner.as_slice())
            .execute(&db.pool)
            .await
            .unwrap();
        }
        db.put_airhop_welcome_team(
            &tenant,
            &PutWelcomeTeamInput {
                organization_id,
                channel_id: channel.id,
                locale: "ru-RU".to_owned(),
                members: members.clone(),
                registered_by_pubkey: owner,
            },
        )
        .await
        .unwrap();

        let human = EventBuilder::new(Kind::Custom(9), "Создай зал")
            .tags([Tag::parse(["h", &channel.id.to_string()]).unwrap()])
            .sign_with_keys(&owner_keys)
            .unwrap();
        db.insert_event(tenant.community(), &human, Some(channel.id))
            .await
            .unwrap();
        let base = NewPendingAgentAction {
            channel_id: channel.id,
            triggering_event_id: *human.id.as_bytes(),
            prepared_by_agent_pubkey: members[&AirhopWelcomeRole::Administrator],
            specialist_role: AirhopWelcomeRole::Administrator,
            command: json!({"type": "create_room", "input": {"branchId": Uuid::nil(), "body": {"name": "Blue"}}}),
            command_digest: [11; 32],
            expected_versions: json!({"organization": 1}),
            expires_at: Utc::now() + Duration::hours(24),
        };

        let first = db.prepare_airhop_agent_action(&tenant, &base);
        let second = db.prepare_airhop_agent_action(&tenant, &base);
        let (first, second) = tokio::join!(first, second);
        let first = first.unwrap();
        let second = second.unwrap();
        assert_eq!(first.action.id, second.action.id);
        assert_eq!(
            usize::from(first.replayed) + usize::from(second.replayed),
            1
        );

        let mut corrected = base.clone();
        corrected.command = json!({"type": "create_room", "input": {"branchId": Uuid::nil(), "body": {"name": "Green"}}});
        corrected.command_digest = [12; 32];
        let corrected = db
            .prepare_airhop_agent_action(&tenant, &corrected)
            .await
            .unwrap();
        assert_ne!(corrected.action.id, first.action.id);
        assert_eq!(corrected.cancelled_action_ids, vec![first.action.id]);
        let old_status: String = sqlx::query_scalar(
            "SELECT status FROM airhop_agent_actions
             WHERE community_id = $1 AND id = $2",
        )
        .bind(community_id)
        .bind(first.action.id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(old_status, "cancelled");

        let reserved = db
            .reserve_airhop_agent_action_preview(&tenant, corrected.action.id, [21; 32])
            .await
            .unwrap();
        assert_eq!(reserved.preview_event_id, Some([21; 32]));
        assert!(db
            .reserve_airhop_agent_action_preview(&tenant, corrected.action.id, [22; 32])
            .await
            .is_err());
        assert!(db
            .prepare_airhop_agent_action(
                &tenant,
                &NewPendingAgentAction {
                    specialist_role: AirhopWelcomeRole::Analyst,
                    ..base
                },
            )
            .await
            .is_err());
    }

    #[tokio::test]
    #[ignore = "requires a dedicated migrated Postgres database"]
    async fn commit_directory_creates_are_exactly_once_and_audited_as_bot_delegation() {
        use std::collections::BTreeMap;

        use buzz_core::{CommunityId, TenantContext};
        use nostr::{EventBuilder, Keys, Kind, Tag};

        use crate::airhop::welcome_agents::PutWelcomeTeamInput;

        let database_url = std::env::var("BUZZ_TEST_DATABASE_URL")
            .expect("BUZZ_TEST_DATABASE_URL must point to a dedicated migrated database");
        let db = Db::new(&crate::DbConfig {
            database_url,
            max_connections: 8,
            min_connections: 0,
            ..crate::DbConfig::default()
        })
        .await
        .expect("connect test database");
        db.migrate().await.expect("migrate test database");

        let community_id = Uuid::new_v4();
        let host = format!("agent-commit-{}.test", community_id.simple());
        let tenant = TenantContext::resolved(CommunityId::from_uuid(community_id), host.clone());
        sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
            .bind(community_id)
            .bind(&host)
            .execute(&db.pool)
            .await
            .unwrap();

        let owner_keys = Keys::generate();
        let owner = owner_keys.public_key().to_bytes();
        db.bootstrap_owner(tenant.community(), &hex::encode(owner))
            .await
            .unwrap();
        let organization_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO airhop_organizations (
                community_id, id, name, locale, time_zone, default_trial_policy
             ) VALUES ($1, $2, 'Commit test', 'en-US', 'UTC', $3)",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(json!({"mode": "free"}))
        .execute(&db.pool)
        .await
        .unwrap();
        let channel = crate::channel::create_channel(
            &db.pool,
            tenant.community(),
            "Welcome commits",
            crate::channel::ChannelType::Stream,
            crate::channel::ChannelVisibility::Private,
            None,
            &owner,
            None,
        )
        .await
        .unwrap();

        let agent_keys = AirhopWelcomeRole::ALL.map(|_| Keys::generate());
        let members = BTreeMap::from_iter(
            AirhopWelcomeRole::ALL
                .into_iter()
                .zip(agent_keys.iter().map(|keys| keys.public_key().to_bytes())),
        );
        for pubkey in members.values() {
            sqlx::query(
                "INSERT INTO users (community_id, pubkey, agent_type)
                 VALUES ($1, $2, 'managed-agent')",
            )
            .bind(community_id)
            .bind(pubkey.as_slice())
            .execute(&db.pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO channel_members (
                    community_id, channel_id, pubkey, role, invited_by
                 ) VALUES ($1, $2, $3, 'bot', $4)",
            )
            .bind(community_id)
            .bind(channel.id)
            .bind(pubkey.as_slice())
            .bind(owner.as_slice())
            .execute(&db.pool)
            .await
            .unwrap();
        }
        db.put_airhop_welcome_team(
            &tenant,
            &PutWelcomeTeamInput {
                organization_id,
                channel_id: channel.id,
                locale: "en-US".to_owned(),
                members: members.clone(),
                registered_by_pubkey: owner,
            },
        )
        .await
        .unwrap();

        let human = EventBuilder::new(Kind::Custom(9), "Create the downtown branch")
            .tags([Tag::parse(["h", &channel.id.to_string()]).unwrap()])
            .sign_with_keys(&owner_keys)
            .unwrap();
        db.insert_event(tenant.community(), &human, Some(channel.id))
            .await
            .unwrap();
        let command = json!({
            "type": "create_branch",
            "input": {
                "name": "Downtown",
                "address": "1 Main Street",
                "workingHours": {
                    "monday": [{"startTime": "09:00", "endTime": "18:00"}]
                },
                "defaultBuzzChannelId": null
            }
        });
        let command_digest: [u8; 32] =
            sha2::Sha256::digest(serde_json::to_vec(&command).unwrap()).into();
        let prepared = db
            .prepare_airhop_agent_action(
                &tenant,
                &NewPendingAgentAction {
                    channel_id: channel.id,
                    triggering_event_id: *human.id.as_bytes(),
                    prepared_by_agent_pubkey: members[&AirhopWelcomeRole::Administrator],
                    specialist_role: AirhopWelcomeRole::Administrator,
                    command,
                    command_digest,
                    expected_versions: json!({"organization": 1}),
                    expires_at: Utc::now() + Duration::hours(24),
                },
            )
            .await
            .unwrap();
        let relay_keys = Keys::generate();
        let preview = EventBuilder::new(Kind::Custom(9), "Confirm branch creation")
            .tags([
                Tag::parse(["h", &channel.id.to_string()]).unwrap(),
                Tag::parse([
                    "airhop-action",
                    &organization_id.to_string(),
                    &prepared.action.id.to_string(),
                    "1",
                    &hex::encode(command_digest),
                ])
                .unwrap(),
            ])
            .sign_with_keys(&relay_keys)
            .unwrap();
        let preview_event_id = *preview.id.as_bytes();
        db.reserve_airhop_agent_action_preview(&tenant, prepared.action.id, preview_event_id)
            .await
            .unwrap();
        db.insert_event(tenant.community(), &preview, Some(channel.id))
            .await
            .unwrap();
        let reaction = EventBuilder::new(Kind::Reaction, "✅")
            .tags([
                Tag::parse(["e", &preview.id.to_hex()]).unwrap(),
                Tag::parse(["h", &channel.id.to_string()]).unwrap(),
            ])
            .sign_with_keys(&owner_keys)
            .unwrap();
        let first = match crate::event::insert_reaction_event_with_thread_metadata(
            &db.pool,
            &tenant,
            &reaction,
            Some(channel.id),
            None,
            preview.id.as_bytes(),
            &owner,
            "✅",
            &relay_keys.public_key().to_bytes(),
        )
        .await
        .unwrap()
        {
            crate::event::ReactionEventInsertOutcome::Inserted {
                airhop_action: Some(action),
                ..
            } => action,
            other => panic!("unexpected action reaction outcome: {other:?}"),
        };
        assert!(!first.replayed);

        let branch_id =
            Uuid::parse_str(first.result["resultIds"]["branchId"].as_str().unwrap()).unwrap();
        let audit = sqlx::query(
            "SELECT actor_kind, actor_pubkey, on_behalf_of_pubkey, agent_pubkey
             FROM airhop_domain_events
             WHERE community_id = $1 AND organization_id = $2
               AND stream_type = 'branch' AND stream_id = $3",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(branch_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(audit.try_get::<String, _>("actor_kind").unwrap(), "bot");
        assert_eq!(
            audit.try_get::<Vec<u8>, _>("actor_pubkey").unwrap(),
            members[&AirhopWelcomeRole::Administrator]
        );
        assert_eq!(
            audit.try_get::<Vec<u8>, _>("agent_pubkey").unwrap(),
            members[&AirhopWelcomeRole::Administrator]
        );
        assert_eq!(
            audit.try_get::<Vec<u8>, _>("on_behalf_of_pubkey").unwrap(),
            owner
        );

        let mut replay_transaction = db.pool.begin().await.unwrap();
        let replay = commit_airhop_agent_action_from_reaction(
            &mut replay_transaction,
            &tenant,
            organization_id,
            prepared.action.id,
            command_digest,
            channel.id,
            &owner,
            &[32_u8; 32],
            &preview_event_id,
        )
        .await
        .unwrap();
        replay_transaction.commit().await.unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.result, first.result);
        let branch_count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM airhop_branches
             WHERE community_id = $1 AND organization_id = $2",
        )
        .bind(community_id)
        .bind(organization_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(branch_count, 1);

        let directory_commands = [
            json!({
                "type": "create_room",
                "input": {"branchId": branch_id, "body": {"name": "Blue"}}
            }),
            json!({
                "type": "create_teacher",
                "input": {"displayName": "Alex", "buzzUsername": null}
            }),
            json!({
                "type": "create_tariff",
                "input": {
                    "name": "Base",
                    "description": null,
                    "priceMinor": 4200,
                    "currency": "EUR",
                    "weeklyScheduleLimit": 2,
                    "paymentDayOfMonth": null
                }
            }),
        ];
        for (index, command) in directory_commands.into_iter().enumerate() {
            let source = EventBuilder::new(Kind::Custom(9), format!("Directory command {index}"))
                .tags([Tag::parse(["h", &channel.id.to_string()]).unwrap()])
                .sign_with_keys(&owner_keys)
                .unwrap();
            db.insert_event(tenant.community(), &source, Some(channel.id))
                .await
                .unwrap();
            let digest: [u8; 32] =
                sha2::Sha256::digest(serde_json::to_vec(&command).unwrap()).into();
            let expected_versions = if index == 0 {
                json!({"organization": 1, format!("branch:{branch_id}"): 1})
            } else {
                json!({"organization": 1})
            };
            let prepared = db
                .prepare_airhop_agent_action(
                    &tenant,
                    &NewPendingAgentAction {
                        channel_id: channel.id,
                        triggering_event_id: *source.id.as_bytes(),
                        prepared_by_agent_pubkey: members[&AirhopWelcomeRole::Administrator],
                        specialist_role: AirhopWelcomeRole::Administrator,
                        command,
                        command_digest: digest,
                        expected_versions,
                        expires_at: Utc::now() + Duration::hours(24),
                    },
                )
                .await
                .unwrap();
            let preview = [(41 + index) as u8; 32];
            db.reserve_airhop_agent_action_preview(&tenant, prepared.action.id, preview)
                .await
                .unwrap();
            let mut transaction = db.pool.begin().await.unwrap();
            commit_airhop_agent_action_from_reaction(
                &mut transaction,
                &tenant,
                organization_id,
                prepared.action.id,
                digest,
                channel.id,
                &owner,
                &[(51 + index) as u8; 32],
                &preview,
            )
            .await
            .unwrap();
            transaction.commit().await.unwrap();
        }
        let group_source = EventBuilder::new(Kind::Custom(9), "Create the first group")
            .tags([Tag::parse(["h", &channel.id.to_string()]).unwrap()])
            .sign_with_keys(&owner_keys)
            .unwrap();
        db.insert_event(tenant.community(), &group_source, Some(channel.id))
            .await
            .unwrap();
        let group_command = json!({
            "type": "create_group",
            "input": {
                "group": {
                    "branchId": branch_id,
                    "roomId": null,
                    "name": "Kids",
                    "description": null,
                    "teacherIds": [],
                    "minAgeMonths": null,
                    "maxAgeMonths": null,
                    "capacity": 12,
                    "trialPolicyOverride": null,
                    "trackAttendanceOverride": null,
                    "allowSingleVisitsOverride": null,
                    "status": "active"
                },
                "activeRules": [{
                    "startsOn": "2026-08-01",
                    "endsOn": "2027-08-01",
                    "weekdays": ["monday"],
                    "startTime": "09:00",
                    "endTime": "10:00",
                    "branchIdOverride": null,
                    "roomOverrideSet": false,
                    "roomIdOverride": null,
                    "teacherIdsOverride": null,
                    "capacityOverrideSet": false,
                    "capacityOverride": null,
                    "trialPolicyOverride": null
                }]
            }
        });
        let group_digest: [u8; 32] =
            sha2::Sha256::digest(serde_json::to_vec(&group_command).unwrap()).into();
        let group_prepared = db
            .prepare_airhop_agent_action(
                &tenant,
                &NewPendingAgentAction {
                    channel_id: channel.id,
                    triggering_event_id: *group_source.id.as_bytes(),
                    prepared_by_agent_pubkey: members[&AirhopWelcomeRole::Administrator],
                    specialist_role: AirhopWelcomeRole::Administrator,
                    command: group_command,
                    command_digest: group_digest,
                    expected_versions: json!({"organization": 1}),
                    expires_at: Utc::now() + Duration::hours(24),
                },
            )
            .await
            .unwrap();
        let group_preview = [61_u8; 32];
        db.reserve_airhop_agent_action_preview(&tenant, group_prepared.action.id, group_preview)
            .await
            .unwrap();
        let mut group_transaction = db.pool.begin().await.unwrap();
        let group_result = commit_airhop_agent_action_from_reaction(
            &mut group_transaction,
            &tenant,
            organization_id,
            group_prepared.action.id,
            group_digest,
            channel.id,
            &owner,
            &[62_u8; 32],
            &group_preview,
        )
        .await
        .unwrap();
        group_transaction.commit().await.unwrap();
        assert!(group_result.result["resultIds"]["groupId"].is_string());

        let family_source = EventBuilder::new(Kind::Custom(9), "Create the first family")
            .tags([Tag::parse(["h", &channel.id.to_string()]).unwrap()])
            .sign_with_keys(&owner_keys)
            .unwrap();
        db.insert_event(tenant.community(), &family_source, Some(channel.id))
            .await
            .unwrap();
        let family_command = json!({
            "type": "create_family",
            "input": {
                "displayName": "Smith",
                "representativeName": "Sam",
                "phone": "+12025550123",
                "phoneNormalized": "+12025550123",
                "phoneMatchDigest": hex::encode([0xaa_u8; 32]),
                "preferredContactChannel": "phone",
                "childName": "Kim",
                "childBirthDate": "2020-01-02",
                "childNote": null
            }
        });
        let family_digest: [u8; 32] =
            sha2::Sha256::digest(serde_json::to_vec(&family_command).unwrap()).into();
        let family_prepared = db
            .prepare_airhop_agent_action(
                &tenant,
                &NewPendingAgentAction {
                    channel_id: channel.id,
                    triggering_event_id: *family_source.id.as_bytes(),
                    prepared_by_agent_pubkey: members[&AirhopWelcomeRole::Administrator],
                    specialist_role: AirhopWelcomeRole::Administrator,
                    command: family_command,
                    command_digest: family_digest,
                    expected_versions: json!({"organization": 1}),
                    expires_at: Utc::now() + Duration::hours(24),
                },
            )
            .await
            .unwrap();
        let family_preview = [71_u8; 32];
        db.reserve_airhop_agent_action_preview(&tenant, family_prepared.action.id, family_preview)
            .await
            .unwrap();
        let mut family_transaction = db.pool.begin().await.unwrap();
        let family_result = commit_airhop_agent_action_from_reaction(
            &mut family_transaction,
            &tenant,
            organization_id,
            family_prepared.action.id,
            family_digest,
            channel.id,
            &owner,
            &[72_u8; 32],
            &family_preview,
        )
        .await
        .unwrap();
        family_transaction.commit().await.unwrap();
        assert!(family_result.result["resultIds"]["familyId"].is_string());

        let group_id = Uuid::parse_str(
            group_result.result["resultIds"]["groupId"]
                .as_str()
                .unwrap(),
        )
        .unwrap();
        let family_id = Uuid::parse_str(
            family_result.result["resultIds"]["familyId"]
                .as_str()
                .unwrap(),
        )
        .unwrap();
        let child_id = Uuid::parse_str(
            family_result.result["resultIds"]["childId"]
                .as_str()
                .unwrap(),
        )
        .unwrap();
        let tariff_id: Uuid = sqlx::query_scalar(
            "SELECT id FROM airhop_tariffs
             WHERE community_id = $1 AND organization_id = $2
             ORDER BY created_at DESC LIMIT 1",
        )
        .bind(community_id)
        .bind(organization_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        let recurrence_rule_id: Uuid = sqlx::query_scalar(
            "SELECT id FROM airhop_recurrence_rules
             WHERE community_id = $1 AND organization_id = $2 AND group_id = $3
             LIMIT 1",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(group_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        let enrollment_source = EventBuilder::new(Kind::Custom(9), "Enroll Kim")
            .tags([Tag::parse(["h", &channel.id.to_string()]).unwrap()])
            .sign_with_keys(&owner_keys)
            .unwrap();
        db.insert_event(tenant.community(), &enrollment_source, Some(channel.id))
            .await
            .unwrap();
        let enrollment_command = json!({
            "type": "enroll_participant",
            "input": {
                "familyId": family_id,
                "childId": child_id,
                "groupId": group_id,
                "tariffId": tariff_id,
                "startDate": "2026-08-24",
                "schedule": [{
                    "recurrenceRuleId": recurrence_rule_id,
                    "weekday": "monday"
                }]
            }
        });
        let enrollment_digest: [u8; 32] =
            sha2::Sha256::digest(serde_json::to_vec(&enrollment_command).unwrap()).into();
        let enrollment_prepared = db
            .prepare_airhop_agent_action(
                &tenant,
                &NewPendingAgentAction {
                    channel_id: channel.id,
                    triggering_event_id: *enrollment_source.id.as_bytes(),
                    prepared_by_agent_pubkey: members[&AirhopWelcomeRole::Administrator],
                    specialist_role: AirhopWelcomeRole::Administrator,
                    command: enrollment_command,
                    command_digest: enrollment_digest,
                    expected_versions: json!({"organization": 1}),
                    expires_at: Utc::now() + Duration::hours(24),
                },
            )
            .await
            .unwrap();
        let enrollment_preview = [81_u8; 32];
        db.reserve_airhop_agent_action_preview(
            &tenant,
            enrollment_prepared.action.id,
            enrollment_preview,
        )
        .await
        .unwrap();
        let mut enrollment_transaction = db.pool.begin().await.unwrap();
        let enrollment_result = commit_airhop_agent_action_from_reaction(
            &mut enrollment_transaction,
            &tenant,
            organization_id,
            enrollment_prepared.action.id,
            enrollment_digest,
            channel.id,
            &owner,
            &[82_u8; 32],
            &enrollment_preview,
        )
        .await
        .unwrap();
        enrollment_transaction.commit().await.unwrap();
        let payment_id = Uuid::parse_str(
            enrollment_result.result["resultIds"]["paymentExpectationId"]
                .as_str()
                .unwrap(),
        )
        .unwrap();

        let payment_source = EventBuilder::new(Kind::Custom(9), "Mark payment paid")
            .tags([Tag::parse(["h", &channel.id.to_string()]).unwrap()])
            .sign_with_keys(&owner_keys)
            .unwrap();
        db.insert_event(tenant.community(), &payment_source, Some(channel.id))
            .await
            .unwrap();
        let payment_command = json!({
            "type": "mutate_payment",
            "input": {
                "paymentId": payment_id,
                "body": {"action": "mark_paid", "expectedVersion": 1}
            }
        });
        let payment_digest: [u8; 32] =
            sha2::Sha256::digest(serde_json::to_vec(&payment_command).unwrap()).into();
        let payment_prepared = db
            .prepare_airhop_agent_action(
                &tenant,
                &NewPendingAgentAction {
                    channel_id: channel.id,
                    triggering_event_id: *payment_source.id.as_bytes(),
                    prepared_by_agent_pubkey: members[&AirhopWelcomeRole::Administrator],
                    specialist_role: AirhopWelcomeRole::Administrator,
                    command: payment_command,
                    command_digest: payment_digest,
                    expected_versions: json!({"organization": 1, format!("payment:{payment_id}"): 1}),
                    expires_at: Utc::now() + Duration::hours(24),
                },
            )
            .await
            .unwrap();
        let payment_preview = [91_u8; 32];
        db.reserve_airhop_agent_action_preview(
            &tenant,
            payment_prepared.action.id,
            payment_preview,
        )
        .await
        .unwrap();
        let mut payment_transaction = db.pool.begin().await.unwrap();
        let payment_result = commit_airhop_agent_action_from_reaction(
            &mut payment_transaction,
            &tenant,
            organization_id,
            payment_prepared.action.id,
            payment_digest,
            channel.id,
            &owner,
            &[92_u8; 32],
            &payment_preview,
        )
        .await
        .unwrap();
        payment_transaction.commit().await.unwrap();
        assert_eq!(payment_result.result["versions"]["payment"], 2);

        let settings_source = EventBuilder::new(Kind::Custom(9), "Rename the organization")
            .tags([Tag::parse(["h", &channel.id.to_string()]).unwrap()])
            .sign_with_keys(&owner_keys)
            .unwrap();
        db.insert_event(tenant.community(), &settings_source, Some(channel.id))
            .await
            .unwrap();
        let settings_command = json!({
            "type": "put_organization_settings",
            "input": {
                "expectedVersion": 1,
                "name": "Commit test renamed",
                "locale": "en-US",
                "timeZone": "UTC",
                "paymentsBuzzChannelId": null,
                "analyticsBuzzChannelId": null,
                "defaultTrialPolicy": {"mode": "free"},
                "trackAttendanceByDefault": true,
                "allowSingleVisitsByDefault": false,
                "existingStudentsOnboardingStatus": "not_started",
                "publicBookingPurpose": "trial",
                "publicBookingAppearance": "automatic",
                "paymentDayOfMonth": 10
            }
        });
        let settings_digest: [u8; 32] =
            sha2::Sha256::digest(serde_json::to_vec(&settings_command).unwrap()).into();
        let settings_prepared = db
            .prepare_airhop_agent_action(
                &tenant,
                &NewPendingAgentAction {
                    channel_id: channel.id,
                    triggering_event_id: *settings_source.id.as_bytes(),
                    prepared_by_agent_pubkey: members[&AirhopWelcomeRole::Administrator],
                    specialist_role: AirhopWelcomeRole::Administrator,
                    command: settings_command,
                    command_digest: settings_digest,
                    expected_versions: json!({"organization": 1}),
                    expires_at: Utc::now() + Duration::hours(24),
                },
            )
            .await
            .unwrap();
        let settings_preview = [101_u8; 32];
        db.reserve_airhop_agent_action_preview(
            &tenant,
            settings_prepared.action.id,
            settings_preview,
        )
        .await
        .unwrap();
        let mut settings_transaction = db.pool.begin().await.unwrap();
        let settings_result = commit_airhop_agent_action_from_reaction(
            &mut settings_transaction,
            &tenant,
            organization_id,
            settings_prepared.action.id,
            settings_digest,
            channel.id,
            &owner,
            &[102_u8; 32],
            &settings_preview,
        )
        .await
        .unwrap();
        settings_transaction.commit().await.unwrap();
        assert_eq!(settings_result.result["versions"]["organization"], 2);
        let organization_name: String = sqlx::query_scalar(
            "SELECT name FROM airhop_organizations
             WHERE community_id = $1 AND id = $2",
        )
        .bind(community_id)
        .bind(organization_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(organization_name, "Commit test renamed");

        let stale_command = json!({
            "type": "create_teacher",
            "input": {"displayName": "Stale teacher", "buzzUsername": null}
        });
        let (stale_action, stale_preview, _) = prepare_test_preview(
            &db,
            &tenant,
            organization_id,
            channel.id,
            members[&AirhopWelcomeRole::Administrator],
            &owner_keys,
            &relay_keys,
            stale_command,
            json!({"organization": 1}),
            Utc::now() + Duration::hours(24),
            None,
        )
        .await;
        let stale_reaction = EventBuilder::new(Kind::Reaction, "✅")
            .tags([Tag::parse(["e", &stale_preview.id.to_hex()]).unwrap()])
            .sign_with_keys(&owner_keys)
            .unwrap();
        let stale_error = crate::event::insert_reaction_event_with_thread_metadata(
            &db.pool,
            &tenant,
            &stale_reaction,
            Some(channel.id),
            None,
            stale_preview.id.as_bytes(),
            &owner,
            "✅",
            &relay_keys.public_key().to_bytes(),
        )
        .await
        .unwrap_err();
        assert!(matches!(stale_error, DbError::AirhopVersionConflict));
        assert!(crate::event::get_event_by_id(
            &db.pool,
            tenant.community(),
            stale_reaction.id.as_bytes(),
        )
        .await
        .unwrap()
        .is_none());
        let stale_reaction_rows: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM reactions
             WHERE community_id = $1 AND reaction_event_id = $2 AND removed_at IS NULL",
        )
        .bind(community_id)
        .bind(stale_reaction.id.as_bytes().as_slice())
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(stale_reaction_rows, 0);
        let stale_status: String = sqlx::query_scalar(
            "SELECT status FROM airhop_agent_actions WHERE community_id = $1 AND id = $2",
        )
        .bind(community_id)
        .bind(stale_action.action.id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(stale_status, "pending");

        let fake_command = json!({
            "type": "create_teacher",
            "input": {"displayName": "Fake teacher", "buzzUsername": null}
        });
        let (fake_action, fake_preview, _) = prepare_test_preview(
            &db,
            &tenant,
            organization_id,
            channel.id,
            members[&AirhopWelcomeRole::Administrator],
            &owner_keys,
            &relay_keys,
            fake_command,
            json!({"organization": 2}),
            Utc::now() + Duration::hours(24),
            Some([222_u8; 32]),
        )
        .await;
        let fake_reaction = EventBuilder::new(Kind::Reaction, "✅")
            .tags([Tag::parse(["e", &fake_preview.id.to_hex()]).unwrap()])
            .sign_with_keys(&owner_keys)
            .unwrap();
        assert!(matches!(
            crate::event::insert_reaction_event_with_thread_metadata(
                &db.pool,
                &tenant,
                &fake_reaction,
                Some(channel.id),
                None,
                fake_preview.id.as_bytes(),
                &owner,
                "✅",
                &relay_keys.public_key().to_bytes(),
            )
            .await,
            Err(DbError::AirhopVersionConflict)
        ));
        let fake_status: String = sqlx::query_scalar(
            "SELECT status FROM airhop_agent_actions WHERE community_id = $1 AND id = $2",
        )
        .bind(community_id)
        .bind(fake_action.action.id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(fake_status, "pending");

        let agent_command = json!({
            "type": "create_teacher",
            "input": {"displayName": "Agent teacher", "buzzUsername": null}
        });
        let (_, agent_preview, _) = prepare_test_preview(
            &db,
            &tenant,
            organization_id,
            channel.id,
            members[&AirhopWelcomeRole::Administrator],
            &owner_keys,
            &relay_keys,
            agent_command,
            json!({"organization": 2}),
            Utc::now() + Duration::hours(24),
            None,
        )
        .await;
        let administrator_keys = agent_keys
            .iter()
            .find(|keys| keys.public_key().to_bytes() == members[&AirhopWelcomeRole::Administrator])
            .unwrap();
        let agent_reaction = EventBuilder::new(Kind::Reaction, "✅")
            .tags([Tag::parse(["e", &agent_preview.id.to_hex()]).unwrap()])
            .sign_with_keys(administrator_keys)
            .unwrap();
        assert!(matches!(
            crate::event::insert_reaction_event_with_thread_metadata(
                &db.pool,
                &tenant,
                &agent_reaction,
                Some(channel.id),
                None,
                agent_preview.id.as_bytes(),
                &members[&AirhopWelcomeRole::Administrator],
                "✅",
                &relay_keys.public_key().to_bytes(),
            )
            .await,
            Err(DbError::AccessDenied(_))
        ));
        assert!(crate::event::get_event_by_id(
            &db.pool,
            tenant.community(),
            agent_reaction.id.as_bytes(),
        )
        .await
        .unwrap()
        .is_none());

        let unrelated_agent_keys = Keys::generate();
        let unrelated_agent = unrelated_agent_keys.public_key().to_bytes();
        sqlx::query(
            "INSERT INTO users (community_id, pubkey, agent_type)
             VALUES ($1, $2, 'managed-agent')",
        )
        .bind(community_id)
        .bind(unrelated_agent.as_slice())
        .execute(&db.pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO channel_members (
                community_id, channel_id, pubkey, role, invited_by
             ) VALUES ($1, $2, $3, 'bot', $4)",
        )
        .bind(community_id)
        .bind(channel.id)
        .bind(unrelated_agent.as_slice())
        .bind(owner.as_slice())
        .execute(&db.pool)
        .await
        .unwrap();
        let unrelated_agent_command = json!({
            "type": "create_teacher",
            "input": {"displayName": "Unrelated agent teacher", "buzzUsername": null}
        });
        let (unrelated_action, unrelated_preview, _) = prepare_test_preview(
            &db,
            &tenant,
            organization_id,
            channel.id,
            members[&AirhopWelcomeRole::Administrator],
            &owner_keys,
            &relay_keys,
            unrelated_agent_command,
            json!({"organization": 2}),
            Utc::now() + Duration::hours(24),
            None,
        )
        .await;
        let unrelated_agent_reaction = EventBuilder::new(Kind::Reaction, "✅")
            .tags([Tag::parse(["e", &unrelated_preview.id.to_hex()]).unwrap()])
            .sign_with_keys(&unrelated_agent_keys)
            .unwrap();
        assert!(matches!(
            crate::event::insert_reaction_event_with_thread_metadata(
                &db.pool,
                &tenant,
                &unrelated_agent_reaction,
                Some(channel.id),
                None,
                unrelated_preview.id.as_bytes(),
                &unrelated_agent,
                "✅",
                &relay_keys.public_key().to_bytes(),
            )
            .await,
            Err(DbError::AccessDenied(_))
        ));
        assert!(crate::event::get_event_by_id(
            &db.pool,
            tenant.community(),
            unrelated_agent_reaction.id.as_bytes(),
        )
        .await
        .unwrap()
        .is_none());
        let unrelated_status: String = sqlx::query_scalar(
            "SELECT status FROM airhop_agent_actions
             WHERE community_id = $1 AND id = $2",
        )
        .bind(community_id)
        .bind(unrelated_action.action.id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(unrelated_status, "pending");

        let expired_command = json!({
            "type": "create_teacher",
            "input": {"displayName": "Expired teacher", "buzzUsername": null}
        });
        let (expired_action, expired_preview, _) = prepare_test_preview(
            &db,
            &tenant,
            organization_id,
            channel.id,
            members[&AirhopWelcomeRole::Administrator],
            &owner_keys,
            &relay_keys,
            expired_command,
            json!({"organization": 2}),
            Utc::now() + Duration::hours(24),
            None,
        )
        .await;
        sqlx::query(
            "UPDATE airhop_agent_actions SET expires_at = now() - interval '1 second'
             WHERE community_id = $1 AND id = $2",
        )
        .bind(community_id)
        .bind(expired_action.action.id)
        .execute(&db.pool)
        .await
        .unwrap();
        let expired_reaction = EventBuilder::new(Kind::Reaction, "✅")
            .tags([Tag::parse(["e", &expired_preview.id.to_hex()]).unwrap()])
            .sign_with_keys(&owner_keys)
            .unwrap();
        assert!(matches!(
            crate::event::insert_reaction_event_with_thread_metadata(
                &db.pool,
                &tenant,
                &expired_reaction,
                Some(channel.id),
                None,
                expired_preview.id.as_bytes(),
                &owner,
                "✅",
                &relay_keys.public_key().to_bytes(),
            )
            .await,
            Err(DbError::AirhopVersionConflict)
        ));
        assert!(crate::event::get_event_by_id(
            &db.pool,
            tenant.community(),
            expired_reaction.id.as_bytes(),
        )
        .await
        .unwrap()
        .is_none());

        let bot_directory_events: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM airhop_domain_events
             WHERE community_id = $1 AND organization_id = $2
               AND stream_type IN ('branch', 'room', 'teacher', 'tariff', 'group', 'family')
               AND actor_kind = 'bot' AND actor_pubkey = $3
               AND agent_pubkey = $3 AND on_behalf_of_pubkey = $4",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(members[&AirhopWelcomeRole::Administrator].as_slice())
        .bind(owner.as_slice())
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(bot_directory_events, 6);
    }
}
