//! Tenant-scoped payment work queue and audited staff commands.

use buzz_core::TenantContext;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

use super::{
    append_domain_event, commit_command, insert_pending_command, AirhopActor, AirhopCommand,
    CommandInsertOutcome, CommandStatus, NewAirhopCommand, NewDomainEvent, PrivacyClass,
};
use crate::{Db, DbError, Result};

const MUTATE_PAYMENT_COMMAND_TYPE: &str = "MutatePaymentExpectation";
const CONFIRM_PAYMENT_FROM_BUZZ_COMMAND_TYPE: &str = "ConfirmPaymentFromBuzzReaction";

/// Durable lifecycle of one expected payment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaymentStatus {
    /// Still belongs in the staff work queue.
    Expected,
    /// Staff confirmed that money was received.
    Paid,
    /// Staff explicitly cancelled the expectation.
    Cancelled,
}

impl PaymentStatus {
    fn from_db(value: &str) -> Result<Self> {
        match value {
            "expected" => Ok(Self::Expected),
            "paid" => Ok(Self::Paid),
            "cancelled" => Ok(Self::Cancelled),
            other => Err(DbError::InvalidData(format!(
                "unknown AirHub payment status {other:?}"
            ))),
        }
    }
}

/// Server-authoritative expected-payment record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffPaymentRecord {
    /// Payment identifier.
    pub id: Uuid,
    /// Server-resolved organization.
    pub organization_id: Uuid,
    /// Owning family.
    pub family_id: Uuid,
    /// Child whose enrollment created the payment.
    pub child_id: Uuid,
    /// Permanent enrollment that owns the payment.
    pub enrollment_id: Uuid,
    /// Tariff selected when the payment was created.
    pub tariff_id: Uuid,
    /// Immutable staff-facing tariff label snapshot.
    pub tariff_name_snapshot: String,
    /// Current amount for this payment only, in minor units.
    pub amount_minor: i64,
    /// Three-letter currency code.
    pub currency: String,
    /// Organization-local due date.
    pub due_date: NaiveDate,
    /// Current payment lifecycle.
    pub status: PaymentStatus,
    /// When staff marked the payment paid.
    pub paid_at: Option<DateTime<Utc>>,
    /// Staff public key responsible for the paid decision.
    pub paid_by: Option<String>,
    /// When staff cancelled the payment.
    pub cancelled_at: Option<DateTime<Utc>>,
    /// Staff public key responsible for cancellation.
    pub cancelled_by: Option<String>,
    /// Current cancellation reason. Restore reasons remain in the event log.
    pub internal_reason: Option<String>,
    /// Optimistic entity version.
    pub version: i64,
    /// Creation instant.
    pub created_at: DateTime<Utc>,
    /// Last mutation instant.
    pub updated_at: DateTime<Utc>,
}

/// Minimal family label required by the payment queue.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffPaymentFamily {
    /// Family identifier.
    pub id: Uuid,
    /// Staff-facing family label.
    pub display_name: String,
}

/// Minimal child label required by the payment queue.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffPaymentChild {
    /// Child identifier.
    pub id: Uuid,
    /// Current child display name.
    pub display_name: String,
}

/// Minimal enrollment link required by the payment queue.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffPaymentEnrollment {
    /// Enrollment identifier.
    pub id: Uuid,
}

/// Minimal group label required by the payment queue.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffPaymentGroup {
    /// Group identifier.
    pub id: Uuid,
    /// Current group name.
    pub name: String,
}

/// One denormalized, privacy-bounded payment work-queue row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffPaymentQueueItem {
    /// Authoritative payment state.
    pub payment: StaffPaymentRecord,
    /// Family label.
    pub family: StaffPaymentFamily,
    /// Child label.
    pub child: StaffPaymentChild,
    /// Enrollment identity.
    pub enrollment: StaffPaymentEnrollment,
    /// Current group label.
    pub group: StaffPaymentGroup,
}

/// Explicit mutation accepted by the payment aggregate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PaymentChange {
    /// Confirm receipt of money.
    MarkPaid,
    /// Cancel the expectation and retain a staff reason on the row.
    Cancel {
        /// Staff-only reason retained on the cancelled row.
        reason: String,
    },
    /// Return a paid or cancelled row to the expected work queue.
    Restore {
        /// Staff-only reason retained in the immutable event.
        reason: String,
    },
    /// Change this payment's amount without changing its tariff.
    ChangeAmount {
        /// Replacement amount in currency minor units.
        amount_minor: i64,
    },
    /// Move this payment to another organization-local due date.
    MoveDueDate {
        /// Replacement organization-local due date.
        due_date: NaiveDate,
        /// Staff-only reason retained in the immutable event.
        reason: String,
    },
}

/// Idempotent optimistic command for one payment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MutatePaymentInput {
    /// Payment selected by the authenticated path.
    pub payment_id: Uuid,
    /// Version observed by the staff client.
    pub expected_version: i64,
    /// Explicit desired change.
    pub change: PaymentChange,
    /// Keyed digest of the HTTP idempotency key.
    pub idempotency_digest: [u8; 32],
    /// Canonical method/path/body request hash.
    pub request_hash: [u8; 32],
    /// Verified staff attribution.
    pub actor: AirhopActor,
}

/// Result of a payment command or its idempotent replay.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PaymentMutationOutcome {
    /// Affected payment.
    pub payment_id: Uuid,
    /// New or replayed optimistic version.
    pub version: i64,
    /// True when an existing committed command was replayed.
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredPaymentMutationResult {
    payment_id: Uuid,
    version: i64,
}

#[derive(Debug)]
struct LockedPayment {
    status: PaymentStatus,
    amount_minor: i64,
    due_date: NaiveDate,
    version: i64,
}

impl Db {
    /// Lists all expected payments and retained decisions for one tenant.
    pub async fn list_airhop_staff_payments(
        &self,
        tenant: &TenantContext,
    ) -> Result<Vec<StaffPaymentQueueItem>> {
        let organization_id = resolve_active_organization(&self.pool, tenant).await?;
        let rows = sqlx::query(
            "SELECT payment.id, payment.organization_id, payment.family_id, payment.child_id, \
                    payment.enrollment_id, payment.tariff_id, payment.tariff_name_snapshot, \
                    payment.amount_minor, payment.currency, payment.due_date, payment.status, \
                    payment.paid_at, payment.paid_by, payment.cancelled_at, \
                    payment.cancelled_by, payment.internal_reason, payment.version, \
                    payment.created_at, payment.updated_at, \
                    family.display_name AS family_name, child.display_name AS child_name, \
                    enrollment.group_id, group_row.name AS group_name \
             FROM airhop_payment_expectations payment \
             JOIN airhop_families family \
               ON family.community_id = payment.community_id \
              AND family.organization_id = payment.organization_id \
              AND family.id = payment.family_id \
             JOIN airhop_children child \
               ON child.community_id = payment.community_id \
              AND child.organization_id = payment.organization_id \
              AND child.id = payment.child_id \
             JOIN airhop_enrollments enrollment \
               ON enrollment.community_id = payment.community_id \
              AND enrollment.organization_id = payment.organization_id \
              AND enrollment.id = payment.enrollment_id \
             JOIN airhop_groups group_row \
               ON group_row.community_id = enrollment.community_id \
              AND group_row.organization_id = enrollment.organization_id \
              AND group_row.id = enrollment.group_id \
             WHERE payment.community_id = $1 AND payment.organization_id = $2 \
             ORDER BY CASE payment.status WHEN 'expected' THEN 0 WHEN 'paid' THEN 1 ELSE 2 END, \
                      payment.due_date, lower(child.display_name), payment.id",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(parse_queue_row).collect()
    }

    /// Mutates one payment, its immutable audit event, and command receipt atomically.
    pub async fn mutate_airhop_payment(
        &self,
        tenant: &TenantContext,
        input: &MutatePaymentInput,
    ) -> Result<PaymentMutationOutcome> {
        validate_input(input)?;
        input.actor.validate()?;
        let mut transaction = self.pool.begin().await?;
        let organization_id = resolve_active_organization(&mut *transaction, tenant).await?;
        let command = match insert_pending_command(
            &mut transaction,
            tenant,
            &NewAirhopCommand {
                id: Uuid::new_v4(),
                organization_id,
                command_type: MUTATE_PAYMENT_COMMAND_TYPE.to_owned(),
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
        let row = sqlx::query(
            "SELECT status, amount_minor, due_date, version \
             FROM airhop_payment_expectations \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3 FOR UPDATE",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(input.payment_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| DbError::NotFound("AirHub payment".to_owned()))?;
        let current = LockedPayment {
            status: PaymentStatus::from_db(row.try_get("status")?)?,
            amount_minor: row.try_get("amount_minor")?,
            due_date: row.try_get("due_date")?,
            version: row.try_get("version")?,
        };
        if current.version != input.expected_version {
            return Err(DbError::AirhopVersionConflict);
        }
        validate_transition(&current, &input.change)?;
        let occurred_at: DateTime<Utc> = sqlx::query_scalar("SELECT now()")
            .fetch_one(&mut *transaction)
            .await?;
        let actor_reference = input
            .actor
            .pubkey
            .map(hex::encode)
            .ok_or_else(|| DbError::InvalidData("staff actor has no public key".to_owned()))?;
        let version = apply_change(
            &mut transaction,
            tenant,
            organization_id,
            input,
            occurred_at,
            &actor_reference,
        )
        .await?;
        let (event_type, payload) = event_for_change(input.payment_id, &current, &input.change);
        append_domain_event(
            &mut transaction,
            tenant,
            &NewDomainEvent {
                id: Uuid::new_v4(),
                organization_id,
                stream_type: "payment_expectation".to_owned(),
                stream_id: input.payment_id,
                stream_version: version,
                event_type: event_type.to_owned(),
                schema_version: 1,
                occurred_at,
                actor: input.actor.clone(),
                causation_id: command.id,
                correlation_id: command.correlation_id,
                payload,
                privacy_class: PrivacyClass::Operational,
            },
        )
        .await?;
        finish_mutation(
            transaction,
            tenant,
            organization_id,
            command.id,
            input.payment_id,
            version,
        )
        .await
    }
}

/// Marks the versioned payment preview selected by a relay-signed Buzz card paid.
///
/// The caller owns the transaction that also persists the kind:7 event and
/// reaction row. A stale card therefore rolls back the visual reaction together
/// with the business command instead of leaving the two sources inconsistent.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn confirm_airhop_payment_from_buzz_reaction(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    payment_id: Uuid,
    expected_version: i64,
    channel_id: Uuid,
    actor_pubkey: &[u8],
    reaction_event_id: &[u8],
    target_event_id: &[u8],
) -> Result<i64> {
    let actor_pubkey: [u8; 32] = actor_pubkey.try_into().map_err(|_| {
        DbError::InvalidData("AirHub Buzz confirmation actor is invalid".to_owned())
    })?;
    if organization_id.is_nil()
        || payment_id.is_nil()
        || expected_version <= 0
        || reaction_event_id.len() != 32
        || target_event_id.len() != 32
    {
        return Err(DbError::InvalidData(
            "AirHub Buzz payment preview identity is invalid".to_owned(),
        ));
    }
    let channel_is_current: bool = sqlx::query_scalar(
        "SELECT EXISTS (\
             SELECT 1 FROM airhop_organizations \
             WHERE community_id = $1 AND id = $2 AND status = 'active' \
               AND payments_buzz_channel_id = $3\
         )",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(channel_id)
    .fetch_one(&mut **transaction)
    .await?;
    if !channel_is_current {
        return Err(DbError::AirhopPaymentTransition);
    }
    let target_is_reserved: bool = sqlx::query_scalar(
        "SELECT EXISTS (\
             SELECT 1 FROM airhop_payment_buzz_action_state \
             WHERE community_id = $1 AND organization_id = $2 AND payment_id = $3 \
               AND channel_id = $4 AND payment_version = $5 AND event_id = $6\
         )",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(payment_id)
    .bind(channel_id)
    .bind(expected_version)
    .bind(target_event_id)
    .fetch_one(&mut **transaction)
    .await?;
    if !target_is_reserved {
        return Err(DbError::AirhopPaymentTransition);
    }

    let actor = AirhopActor {
        kind: super::ActorKind::Staff,
        pubkey: Some(actor_pubkey),
        on_behalf_of_pubkey: None,
        agent_pubkey: None,
    };
    let idempotency_digest = buzz_confirmation_digest(reaction_event_id);
    let request_hash = buzz_confirmation_request_hash(
        organization_id,
        payment_id,
        expected_version,
        channel_id,
        &actor_pubkey,
        reaction_event_id,
        target_event_id,
    );
    let command = match insert_pending_command(
        transaction,
        tenant,
        &NewAirhopCommand {
            id: Uuid::new_v4(),
            organization_id,
            command_type: CONFIRM_PAYMENT_FROM_BUZZ_COMMAND_TYPE.to_owned(),
            idempotency_digest,
            request_hash,
            actor: actor.clone(),
            correlation_id: Uuid::new_v4(),
        },
    )
    .await?
    {
        CommandInsertOutcome::Inserted(command) => command,
        CommandInsertOutcome::Existing(command) => match command.status {
            CommandStatus::Committed => {
                let stored: StoredPaymentMutationResult =
                    serde_json::from_value(command.result.ok_or_else(|| {
                        DbError::InvalidData(
                            "committed AirHub Buzz confirmation has no result".to_owned(),
                        )
                    })?)?;
                if stored.payment_id != payment_id {
                    return Err(DbError::AirhopIdempotencyConflict);
                }
                return Ok(stored.version);
            }
            CommandStatus::Pending => return Err(DbError::AirhopCommandInProgress),
            CommandStatus::Failed => return Err(DbError::AirhopCommandPreviouslyFailed),
        },
    };

    let row = sqlx::query(
        "SELECT status, amount_minor, due_date, version \
         FROM airhop_payment_expectations \
         WHERE community_id = $1 AND organization_id = $2 AND id = $3 FOR UPDATE",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(payment_id)
    .fetch_optional(&mut **transaction)
    .await?;
    let Some(row) = row else {
        return Err(DbError::AirhopPaymentTransition);
    };
    let current = LockedPayment {
        status: PaymentStatus::from_db(row.try_get("status")?)?,
        amount_minor: row.try_get("amount_minor")?,
        due_date: row.try_get("due_date")?,
        version: row.try_get("version")?,
    };
    if current.version != expected_version {
        return Err(DbError::AirhopVersionConflict);
    }
    validate_transition(&current, &PaymentChange::MarkPaid)?;
    let occurred_at: DateTime<Utc> = sqlx::query_scalar("SELECT now()")
        .fetch_one(&mut **transaction)
        .await?;
    let actor_reference = hex::encode(actor_pubkey);
    let version: i64 = sqlx::query_scalar(
        "UPDATE airhop_payment_expectations \
         SET status = 'paid', paid_at = $5, paid_by = $6, \
             cancelled_at = NULL, cancelled_by = NULL, internal_reason = NULL, \
             version = version + 1, updated_at = $5 \
         WHERE community_id = $1 AND organization_id = $2 AND id = $3 AND version = $4 \
         RETURNING version",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(payment_id)
    .bind(expected_version)
    .bind(occurred_at)
    .bind(actor_reference)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or(DbError::AirhopVersionConflict)?;
    append_domain_event(
        transaction,
        tenant,
        &NewDomainEvent {
            id: Uuid::new_v4(),
            organization_id,
            stream_type: "payment_expectation".to_owned(),
            stream_id: payment_id,
            stream_version: version,
            event_type: "airhop.payment.paid.v1".to_owned(),
            schema_version: 1,
            occurred_at,
            actor,
            causation_id: command.id,
            correlation_id: command.correlation_id,
            payload: json!({
                "paymentId": payment_id,
                "previousStatus": current.status,
                "source": "buzz_reaction",
                "reactionEventId": hex::encode(reaction_event_id),
                "targetEventId": hex::encode(target_event_id),
            }),
            privacy_class: PrivacyClass::Operational,
        },
    )
    .await?;
    commit_command(
        transaction,
        tenant,
        organization_id,
        command.id,
        &serde_json::to_value(StoredPaymentMutationResult {
            payment_id,
            version,
        })?,
    )
    .await?;
    Ok(version)
}

fn buzz_confirmation_digest(reaction_event_id: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"airhop.payment.buzz-confirmation.idempotency.v1\0");
    hasher.update(reaction_event_id);
    hasher.finalize().into()
}

#[allow(clippy::too_many_arguments)]
fn buzz_confirmation_request_hash(
    organization_id: Uuid,
    payment_id: Uuid,
    expected_version: i64,
    channel_id: Uuid,
    actor_pubkey: &[u8; 32],
    reaction_event_id: &[u8],
    target_event_id: &[u8],
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"airhop.payment.buzz-confirmation.request.v1\0");
    hasher.update(organization_id.as_bytes());
    hasher.update(payment_id.as_bytes());
    hasher.update(expected_version.to_be_bytes());
    hasher.update(channel_id.as_bytes());
    hasher.update(actor_pubkey);
    hasher.update(reaction_event_id);
    hasher.update(target_event_id);
    hasher.finalize().into()
}

async fn apply_change(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    input: &MutatePaymentInput,
    occurred_at: DateTime<Utc>,
    actor_reference: &str,
) -> Result<i64> {
    let community_id = *tenant.community().as_uuid();
    let query = match &input.change {
        PaymentChange::MarkPaid => sqlx::query_scalar(
            "UPDATE airhop_payment_expectations \
             SET status = 'paid', paid_at = $5, paid_by = $6, \
                 cancelled_at = NULL, cancelled_by = NULL, internal_reason = NULL, \
                 version = version + 1, updated_at = $5 \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3 AND version = $4 \
             RETURNING version",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(input.payment_id)
        .bind(input.expected_version)
        .bind(occurred_at)
        .bind(actor_reference),
        PaymentChange::Cancel { reason } => sqlx::query_scalar(
            "UPDATE airhop_payment_expectations \
             SET status = 'cancelled', paid_at = NULL, paid_by = NULL, \
                 cancelled_at = $5, cancelled_by = $6, internal_reason = $7, \
                 version = version + 1, updated_at = $5 \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3 AND version = $4 \
             RETURNING version",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(input.payment_id)
        .bind(input.expected_version)
        .bind(occurred_at)
        .bind(actor_reference)
        .bind(reason.trim()),
        PaymentChange::Restore { .. } => sqlx::query_scalar(
            "UPDATE airhop_payment_expectations \
             SET status = 'expected', paid_at = NULL, paid_by = NULL, \
                 cancelled_at = NULL, cancelled_by = NULL, internal_reason = NULL, \
                 version = version + 1, updated_at = $5 \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3 AND version = $4 \
             RETURNING version",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(input.payment_id)
        .bind(input.expected_version)
        .bind(occurred_at),
        PaymentChange::ChangeAmount { amount_minor } => sqlx::query_scalar(
            "UPDATE airhop_payment_expectations \
             SET amount_minor = $5, version = version + 1, updated_at = $6 \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3 AND version = $4 \
             RETURNING version",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(input.payment_id)
        .bind(input.expected_version)
        .bind(amount_minor)
        .bind(occurred_at),
        PaymentChange::MoveDueDate { due_date, .. } => sqlx::query_scalar(
            "UPDATE airhop_payment_expectations \
             SET due_date = $5, version = version + 1, updated_at = $6 \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3 AND version = $4 \
             RETURNING version",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(input.payment_id)
        .bind(input.expected_version)
        .bind(due_date)
        .bind(occurred_at),
    };
    query
        .fetch_optional(&mut **transaction)
        .await?
        .ok_or(DbError::AirhopVersionConflict)
}

fn event_for_change(
    payment_id: Uuid,
    current: &LockedPayment,
    change: &PaymentChange,
) -> (&'static str, serde_json::Value) {
    match change {
        PaymentChange::MarkPaid => (
            "airhop.payment.paid.v1",
            json!({ "paymentId": payment_id, "previousStatus": current.status }),
        ),
        PaymentChange::Cancel { reason } => (
            "airhop.payment.cancelled.v1",
            json!({
                "paymentId": payment_id,
                "previousStatus": current.status,
                "reason": reason.trim(),
            }),
        ),
        PaymentChange::Restore { reason } => (
            "airhop.payment.restored.v1",
            json!({
                "paymentId": payment_id,
                "previousStatus": current.status,
                "reason": reason.trim(),
            }),
        ),
        PaymentChange::ChangeAmount { amount_minor } => (
            "airhop.payment.amount_changed.v1",
            json!({
                "paymentId": payment_id,
                "previousAmountMinor": current.amount_minor,
                "amountMinor": amount_minor,
            }),
        ),
        PaymentChange::MoveDueDate { due_date, reason } => (
            "airhop.payment.due_date_moved.v1",
            json!({
                "paymentId": payment_id,
                "previousDueDate": current.due_date,
                "dueDate": due_date,
                "reason": reason.trim(),
            }),
        ),
    }
}

fn validate_input(input: &MutatePaymentInput) -> Result<()> {
    if input.payment_id.is_nil() || input.expected_version <= 0 {
        return Err(DbError::InvalidData(
            "AirHub payment identity or version is invalid".to_owned(),
        ));
    }
    match &input.change {
        PaymentChange::ChangeAmount { amount_minor } if *amount_minor < 0 => Err(
            DbError::InvalidData("AirHub payment amount is invalid".to_owned()),
        ),
        PaymentChange::Cancel { reason }
        | PaymentChange::Restore { reason }
        | PaymentChange::MoveDueDate { reason, .. }
            if reason.trim().is_empty() || reason.trim().chars().count() > 4_000 =>
        {
            Err(DbError::InvalidData(
                "AirHub payment reason is invalid".to_owned(),
            ))
        }
        _ => Ok(()),
    }
}

fn validate_transition(current: &LockedPayment, change: &PaymentChange) -> Result<()> {
    let allowed = match change {
        PaymentChange::MarkPaid
        | PaymentChange::Cancel { .. }
        | PaymentChange::ChangeAmount { .. }
        | PaymentChange::MoveDueDate { .. } => current.status == PaymentStatus::Expected,
        PaymentChange::Restore { .. } => {
            matches!(
                current.status,
                PaymentStatus::Paid | PaymentStatus::Cancelled
            )
        }
    };
    let changes_value = match change {
        PaymentChange::ChangeAmount { amount_minor } => *amount_minor != current.amount_minor,
        PaymentChange::MoveDueDate { due_date, .. } => *due_date != current.due_date,
        _ => true,
    };
    if !allowed || !changes_value {
        return Err(DbError::AirhopPaymentTransition);
    }
    Ok(())
}

fn parse_queue_row(row: sqlx::postgres::PgRow) -> Result<StaffPaymentQueueItem> {
    let payment_id = row.try_get("id")?;
    let family_id = row.try_get("family_id")?;
    let child_id = row.try_get("child_id")?;
    let enrollment_id = row.try_get("enrollment_id")?;
    Ok(StaffPaymentQueueItem {
        payment: StaffPaymentRecord {
            id: payment_id,
            organization_id: row.try_get("organization_id")?,
            family_id,
            child_id,
            enrollment_id,
            tariff_id: row.try_get("tariff_id")?,
            tariff_name_snapshot: row.try_get("tariff_name_snapshot")?,
            amount_minor: row.try_get("amount_minor")?,
            currency: row.try_get::<String, _>("currency")?.trim().to_owned(),
            due_date: row.try_get("due_date")?,
            status: PaymentStatus::from_db(row.try_get("status")?)?,
            paid_at: row.try_get("paid_at")?,
            paid_by: row.try_get("paid_by")?,
            cancelled_at: row.try_get("cancelled_at")?,
            cancelled_by: row.try_get("cancelled_by")?,
            internal_reason: row.try_get("internal_reason")?,
            version: row.try_get("version")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        },
        family: StaffPaymentFamily {
            id: family_id,
            display_name: row.try_get("family_name")?,
        },
        child: StaffPaymentChild {
            id: child_id,
            display_name: row.try_get("child_name")?,
        },
        enrollment: StaffPaymentEnrollment { id: enrollment_id },
        group: StaffPaymentGroup {
            id: row.try_get("group_id")?,
            name: row.try_get("group_name")?,
        },
    })
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
    payment_id: Uuid,
    version: i64,
) -> Result<PaymentMutationOutcome> {
    let stored = StoredPaymentMutationResult {
        payment_id,
        version,
    };
    commit_command(
        &mut transaction,
        tenant,
        organization_id,
        command_id,
        &serde_json::to_value(&stored)?,
    )
    .await?;
    transaction.commit().await?;
    Ok(PaymentMutationOutcome {
        payment_id,
        version,
        replayed: false,
    })
}

async fn replay_mutation(
    transaction: sqlx::Transaction<'_, sqlx::Postgres>,
    command: AirhopCommand,
) -> Result<PaymentMutationOutcome> {
    match command.status {
        CommandStatus::Pending => Err(DbError::AirhopCommandInProgress),
        CommandStatus::Failed => Err(DbError::AirhopCommandPreviouslyFailed),
        CommandStatus::Committed => {
            let stored: StoredPaymentMutationResult =
                serde_json::from_value(command.result.ok_or_else(|| {
                    DbError::InvalidData("committed AirHub command has no result".to_owned())
                })?)?;
            transaction.commit().await?;
            Ok(PaymentMutationOutcome {
                payment_id: stored.payment_id,
                version: stored.version,
                replayed: true,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn locked(status: PaymentStatus) -> LockedPayment {
        LockedPayment {
            status,
            amount_minor: 450_000,
            due_date: NaiveDate::from_ymd_opt(2026, 8, 18).unwrap(),
            version: 1,
        }
    }

    #[test]
    fn open_payment_accepts_operational_commands() {
        let payment = locked(PaymentStatus::Expected);
        assert!(validate_transition(&payment, &PaymentChange::MarkPaid).is_ok());
        assert!(validate_transition(
            &payment,
            &PaymentChange::ChangeAmount {
                amount_minor: 500_000
            }
        )
        .is_ok());
        assert!(validate_transition(
            &payment,
            &PaymentChange::MoveDueDate {
                due_date: NaiveDate::from_ymd_opt(2026, 8, 25).unwrap(),
                reason: "По договорённости".to_owned(),
            }
        )
        .is_ok());
    }

    #[test]
    fn resolved_payment_only_accepts_explicit_restore() {
        for status in [PaymentStatus::Paid, PaymentStatus::Cancelled] {
            let payment = locked(status);
            assert!(validate_transition(
                &payment,
                &PaymentChange::Restore {
                    reason: "Исправление ошибки".to_owned()
                }
            )
            .is_ok());
            assert!(validate_transition(&payment, &PaymentChange::MarkPaid).is_err());
        }
    }

    #[test]
    fn no_op_amount_and_due_date_are_rejected() {
        let payment = locked(PaymentStatus::Expected);
        assert!(validate_transition(
            &payment,
            &PaymentChange::ChangeAmount {
                amount_minor: 450_000
            }
        )
        .is_err());
        assert!(validate_transition(
            &payment,
            &PaymentChange::MoveDueDate {
                due_date: payment.due_date,
                reason: "Без изменений".to_owned(),
            }
        )
        .is_err());
    }

    #[test]
    fn buzz_confirmation_receipt_is_bound_to_reaction_and_preview() {
        let reaction_id = [4_u8; 32];
        assert_eq!(
            buzz_confirmation_digest(&reaction_id),
            buzz_confirmation_digest(&reaction_id)
        );
        let base = buzz_confirmation_request_hash(
            Uuid::from_u128(1),
            Uuid::from_u128(2),
            3,
            Uuid::from_u128(4),
            &[5_u8; 32],
            &reaction_id,
            &[6_u8; 32],
        );
        let stale_version = buzz_confirmation_request_hash(
            Uuid::from_u128(1),
            Uuid::from_u128(2),
            4,
            Uuid::from_u128(4),
            &[5_u8; 32],
            &reaction_id,
            &[6_u8; 32],
        );
        assert_ne!(base, stale_version);
        assert_ne!(
            buzz_confirmation_digest(&reaction_id),
            buzz_confirmation_digest(&[7_u8; 32])
        );
    }
}
