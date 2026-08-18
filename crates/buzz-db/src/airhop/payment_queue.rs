//! Tenant-scoped payment ledger, work queue, and audited staff commands.

use std::collections::BTreeMap;

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

/// Immutable direction of one money movement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaymentTransactionKind {
    /// Money received from a family.
    Receipt,
    /// Money returned to a family.
    Refund,
}

impl PaymentTransactionKind {
    fn from_db(value: &str) -> Result<Self> {
        match value {
            "receipt" => Ok(Self::Receipt),
            "refund" => Ok(Self::Refund),
            other => Err(DbError::InvalidData(format!(
                "unknown AirHub payment transaction kind {other:?}"
            ))),
        }
    }

    const fn as_db(self) -> &'static str {
        match self {
            Self::Receipt => "receipt",
            Self::Refund => "refund",
        }
    }
}

/// Staff-selected payment method or a trusted system source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaymentMethod {
    /// Physical cash.
    Cash,
    /// Card or acquiring terminal.
    Card,
    /// Bank transfer.
    BankTransfer,
    /// Another staff-described method.
    Other,
    /// Full outstanding balance confirmed from a reserved Buzz card.
    Buzz,
    /// Receipt materialized from a pre-ledger paid row.
    Legacy,
}

impl PaymentMethod {
    fn from_db(value: &str) -> Result<Self> {
        match value {
            "cash" => Ok(Self::Cash),
            "card" => Ok(Self::Card),
            "bank_transfer" => Ok(Self::BankTransfer),
            "other" => Ok(Self::Other),
            "buzz" => Ok(Self::Buzz),
            "legacy" => Ok(Self::Legacy),
            other => Err(DbError::InvalidData(format!(
                "unknown AirHub payment method {other:?}"
            ))),
        }
    }

    const fn as_db(self) -> &'static str {
        match self {
            Self::Cash => "cash",
            Self::Card => "card",
            Self::BankTransfer => "bank_transfer",
            Self::Other => "other",
            Self::Buzz => "buzz",
            Self::Legacy => "legacy",
        }
    }
}

/// One append-only receipt or refund belonging to an expected payment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffPaymentTransaction {
    /// Stable transaction identity.
    pub id: Uuid,
    /// Parent expected payment.
    pub payment_expectation_id: Uuid,
    /// Receipt or refund.
    pub kind: PaymentTransactionKind,
    /// Positive magnitude in minor units.
    pub amount_minor: i64,
    /// Currency snapshot, always matching the parent expectation.
    pub currency: String,
    /// Staff-selected method or system source.
    pub payment_method: PaymentMethod,
    /// Optional staff note or refund reason.
    pub note: Option<String>,
    /// Business occurrence instant.
    pub occurred_at: DateTime<Utc>,
    /// Verified staff/system attribution.
    pub recorded_by: String,
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
    /// Net received amount after refunds, in minor units.
    pub paid_minor: i64,
    /// Amount still expected, in minor units.
    pub outstanding_minor: i64,
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
    /// Newest-first immutable money movements.
    pub transactions: Vec<StaffPaymentTransaction>,
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
    /// Record a partial or full receipt.
    RecordPayment {
        /// Positive received amount in minor units.
        amount_minor: i64,
        /// How the family paid.
        method: PaymentMethod,
        /// Optional staff note.
        note: Option<String>,
    },
    /// Record a partial or full refund without deleting the original receipt.
    RefundPayment {
        /// Positive returned amount in minor units.
        amount_minor: i64,
        /// Required staff reason.
        reason: String,
    },
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
    paid_minor: i64,
    currency: String,
    due_date: NaiveDate,
    version: i64,
}

#[derive(Debug)]
struct AppliedPaymentChange {
    version: i64,
    transaction_id: Option<Uuid>,
    paid_minor: i64,
    outstanding_minor: i64,
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
                    payment.amount_minor, COALESCE(ledger.paid_minor, 0)::BIGINT AS paid_minor, \
                    GREATEST(payment.amount_minor - COALESCE(ledger.paid_minor, 0), 0)::BIGINT \
                        AS outstanding_minor, \
                    payment.currency, payment.due_date, payment.status, \
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
             LEFT JOIN LATERAL ( \
                 SELECT COALESCE(SUM(CASE movement.kind \
                     WHEN 'receipt' THEN movement.amount_minor \
                     ELSE -movement.amount_minor END), 0)::BIGINT AS paid_minor \
                 FROM airhop_payment_transactions movement \
                 WHERE movement.community_id = payment.community_id \
                   AND movement.organization_id = payment.organization_id \
                   AND movement.payment_expectation_id = payment.id \
             ) ledger ON TRUE \
             WHERE payment.community_id = $1 AND payment.organization_id = $2 \
             ORDER BY CASE payment.status WHEN 'expected' THEN 0 WHEN 'paid' THEN 1 ELSE 2 END, \
                      payment.due_date, lower(child.display_name), payment.id",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .fetch_all(&self.pool)
        .await?;
        let transaction_rows = sqlx::query(
            "SELECT id, payment_expectation_id, kind, amount_minor, currency, \
                    payment_method, note, occurred_at, recorded_by \
             FROM airhop_payment_transactions \
             WHERE community_id = $1 AND organization_id = $2 \
             ORDER BY occurred_at DESC, id DESC",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .fetch_all(&self.pool)
        .await?;
        let mut transactions = BTreeMap::<Uuid, Vec<StaffPaymentTransaction>>::new();
        for row in transaction_rows {
            let transaction = parse_payment_transaction(row)?;
            transactions
                .entry(transaction.payment_expectation_id)
                .or_default()
                .push(transaction);
        }
        rows.into_iter()
            .map(|row| {
                let payment_id = row.try_get("id")?;
                parse_queue_row(row, transactions.remove(&payment_id).unwrap_or_default())
            })
            .collect()
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
        let current =
            load_locked_payment(&mut transaction, tenant, organization_id, input.payment_id)
                .await?
                .ok_or_else(|| DbError::NotFound("AirHub payment".to_owned()))?;
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
        let applied = apply_change(
            &mut transaction,
            tenant,
            organization_id,
            input.payment_id,
            input.expected_version,
            &current,
            &input.change,
            PaymentMethod::Other,
            occurred_at,
            &actor_reference,
        )
        .await?;
        let (event_type, payload) =
            event_for_change(input.payment_id, &current, &input.change, &applied);
        append_domain_event(
            &mut transaction,
            tenant,
            &NewDomainEvent {
                id: Uuid::new_v4(),
                organization_id,
                stream_type: "payment_expectation".to_owned(),
                stream_id: input.payment_id,
                stream_version: applied.version,
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
            applied.version,
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

    let current = load_locked_payment(transaction, tenant, organization_id, payment_id).await?;
    let Some(current) = current else {
        return Err(DbError::AirhopPaymentTransition);
    };
    if current.version != expected_version {
        return Err(DbError::AirhopVersionConflict);
    }
    let change = PaymentChange::MarkPaid;
    validate_transition(&current, &change)?;
    let occurred_at: DateTime<Utc> = sqlx::query_scalar("SELECT now()")
        .fetch_one(&mut **transaction)
        .await?;
    let actor_reference = hex::encode(actor_pubkey);
    let applied = apply_change(
        transaction,
        tenant,
        organization_id,
        payment_id,
        expected_version,
        &current,
        &change,
        PaymentMethod::Buzz,
        occurred_at,
        &actor_reference,
    )
    .await?;
    append_domain_event(
        transaction,
        tenant,
        &NewDomainEvent {
            id: Uuid::new_v4(),
            organization_id,
            stream_type: "payment_expectation".to_owned(),
            stream_id: payment_id,
            stream_version: applied.version,
            event_type: "airhop.payment.paid.v1".to_owned(),
            schema_version: 1,
            occurred_at,
            actor,
            causation_id: command.id,
            correlation_id: command.correlation_id,
            payload: json!({
                "paymentId": payment_id,
                "previousStatus": current.status,
                "transactionId": applied.transaction_id,
                "amountMinor": applied.paid_minor - current.paid_minor,
                "outstandingMinor": applied.outstanding_minor,
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
            version: applied.version,
        })?,
    )
    .await?;
    Ok(applied.version)
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

async fn load_locked_payment(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    payment_id: Uuid,
) -> Result<Option<LockedPayment>> {
    let row = sqlx::query(
        "SELECT payment.status, payment.amount_minor, payment.currency, payment.due_date, \
                payment.version, COALESCE(( \
                    SELECT SUM(CASE ledger.kind WHEN 'receipt' THEN ledger.amount_minor \
                        ELSE -ledger.amount_minor END) \
                    FROM airhop_payment_transactions ledger \
                    WHERE ledger.community_id = payment.community_id \
                      AND ledger.organization_id = payment.organization_id \
                      AND ledger.payment_expectation_id = payment.id \
                ), 0)::BIGINT AS paid_minor \
         FROM airhop_payment_expectations payment \
         WHERE payment.community_id = $1 AND payment.organization_id = $2 AND payment.id = $3 \
         FOR UPDATE",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(payment_id)
    .fetch_optional(&mut **transaction)
    .await?;
    row.map(|row| {
        Ok(LockedPayment {
            status: PaymentStatus::from_db(row.try_get("status")?)?,
            amount_minor: row.try_get("amount_minor")?,
            paid_minor: row.try_get("paid_minor")?,
            currency: row.try_get::<String, _>("currency")?.trim().to_owned(),
            due_date: row.try_get("due_date")?,
            version: row.try_get("version")?,
        })
    })
    .transpose()
}

#[allow(clippy::too_many_arguments)]
async fn insert_payment_transaction(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    payment_id: Uuid,
    kind: PaymentTransactionKind,
    amount_minor: i64,
    currency: &str,
    method: PaymentMethod,
    note: Option<&str>,
    occurred_at: DateTime<Utc>,
    actor_reference: &str,
) -> Result<Uuid> {
    let transaction_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO airhop_payment_transactions ( \
             community_id, organization_id, id, payment_expectation_id, kind, amount_minor, \
             currency, payment_method, note, occurred_at, recorded_by \
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(transaction_id)
    .bind(payment_id)
    .bind(kind.as_db())
    .bind(amount_minor)
    .bind(currency)
    .bind(method.as_db())
    .bind(note)
    .bind(occurred_at)
    .bind(actor_reference)
    .execute(&mut **transaction)
    .await?;
    Ok(transaction_id)
}

#[allow(clippy::too_many_arguments)]
async fn apply_ledger_movement(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    payment_id: Uuid,
    expected_version: i64,
    current: &LockedPayment,
    kind: PaymentTransactionKind,
    amount_minor: i64,
    method: PaymentMethod,
    note: Option<&str>,
    occurred_at: DateTime<Utc>,
    actor_reference: &str,
) -> Result<AppliedPaymentChange> {
    let paid_minor = match kind {
        PaymentTransactionKind::Receipt => current.paid_minor.checked_add(amount_minor),
        PaymentTransactionKind::Refund => current.paid_minor.checked_sub(amount_minor),
    }
    .ok_or_else(|| DbError::InvalidData("AirHub payment balance overflow".to_owned()))?;
    if paid_minor < 0 || paid_minor > current.amount_minor {
        return Err(DbError::AirhopPaymentTransition);
    }
    let transaction_id = insert_payment_transaction(
        transaction,
        tenant,
        organization_id,
        payment_id,
        kind,
        amount_minor,
        &current.currency,
        method,
        note,
        occurred_at,
        actor_reference,
    )
    .await?;
    let fully_paid = paid_minor == current.amount_minor;
    let status = if fully_paid { "paid" } else { "expected" };
    let version: i64 = sqlx::query_scalar(
        "UPDATE airhop_payment_expectations \
         SET status = $5, paid_at = CASE WHEN $6 THEN $7 ELSE NULL END, \
             paid_by = CASE WHEN $6 THEN $8 ELSE NULL END, \
             cancelled_at = NULL, cancelled_by = NULL, internal_reason = NULL, \
             version = version + 1, updated_at = $7 \
         WHERE community_id = $1 AND organization_id = $2 AND id = $3 AND version = $4 \
         RETURNING version",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(payment_id)
    .bind(expected_version)
    .bind(status)
    .bind(fully_paid)
    .bind(occurred_at)
    .bind(actor_reference)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or(DbError::AirhopVersionConflict)?;
    Ok(AppliedPaymentChange {
        version,
        transaction_id: Some(transaction_id),
        paid_minor,
        outstanding_minor: current.amount_minor - paid_minor,
    })
}

#[allow(clippy::too_many_arguments)]
async fn apply_change(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    payment_id: Uuid,
    expected_version: i64,
    current: &LockedPayment,
    change: &PaymentChange,
    mark_paid_method: PaymentMethod,
    occurred_at: DateTime<Utc>,
    actor_reference: &str,
) -> Result<AppliedPaymentChange> {
    let ledger = match change {
        PaymentChange::MarkPaid => Some((
            PaymentTransactionKind::Receipt,
            current.amount_minor - current.paid_minor,
            mark_paid_method,
            None,
        )),
        PaymentChange::RecordPayment {
            amount_minor,
            method,
            note,
        } => Some((
            PaymentTransactionKind::Receipt,
            *amount_minor,
            *method,
            note.as_deref(),
        )),
        PaymentChange::RefundPayment {
            amount_minor,
            reason,
        } => Some((
            PaymentTransactionKind::Refund,
            *amount_minor,
            PaymentMethod::Other,
            Some(reason.trim()),
        )),
        PaymentChange::Restore { reason } if current.status == PaymentStatus::Paid => Some((
            PaymentTransactionKind::Refund,
            current.paid_minor,
            PaymentMethod::Other,
            Some(reason.trim()),
        )),
        _ => None,
    };
    if let Some((kind, amount_minor, method, note)) = ledger {
        return apply_ledger_movement(
            transaction,
            tenant,
            organization_id,
            payment_id,
            expected_version,
            current,
            kind,
            amount_minor,
            method,
            note,
            occurred_at,
            actor_reference,
        )
        .await;
    }
    let version = apply_expectation_change(
        transaction,
        tenant,
        organization_id,
        payment_id,
        expected_version,
        change,
        occurred_at,
        actor_reference,
    )
    .await?;
    let amount_minor = match change {
        PaymentChange::ChangeAmount { amount_minor } => *amount_minor,
        _ => current.amount_minor,
    };
    Ok(AppliedPaymentChange {
        version,
        transaction_id: None,
        paid_minor: current.paid_minor,
        outstanding_minor: amount_minor - current.paid_minor,
    })
}

#[allow(clippy::too_many_arguments)]
async fn apply_expectation_change(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    payment_id: Uuid,
    expected_version: i64,
    change: &PaymentChange,
    occurred_at: DateTime<Utc>,
    actor_reference: &str,
) -> Result<i64> {
    let community_id = *tenant.community().as_uuid();
    let query = match change {
        PaymentChange::MarkPaid
        | PaymentChange::RecordPayment { .. }
        | PaymentChange::RefundPayment { .. } => {
            return Err(DbError::AirhopPaymentTransition);
        }
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
        .bind(payment_id)
        .bind(expected_version)
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
        .bind(payment_id)
        .bind(expected_version)
        .bind(occurred_at),
        PaymentChange::ChangeAmount { amount_minor } => sqlx::query_scalar(
            "UPDATE airhop_payment_expectations \
             SET amount_minor = $5, version = version + 1, updated_at = $6 \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3 AND version = $4 \
             RETURNING version",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(payment_id)
        .bind(expected_version)
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
        .bind(payment_id)
        .bind(expected_version)
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
    applied: &AppliedPaymentChange,
) -> (&'static str, serde_json::Value) {
    match change {
        PaymentChange::MarkPaid => (
            "airhop.payment.paid.v1",
            json!({
                "paymentId": payment_id,
                "previousStatus": current.status,
                "transactionId": applied.transaction_id,
                "amountMinor": applied.paid_minor - current.paid_minor,
                "paidMinor": applied.paid_minor,
                "outstandingMinor": applied.outstanding_minor,
            }),
        ),
        PaymentChange::RecordPayment {
            amount_minor,
            method,
            note,
        } => (
            "airhop.payment.receipt_recorded.v1",
            json!({
                "paymentId": payment_id,
                "transactionId": applied.transaction_id,
                "amountMinor": amount_minor,
                "paymentMethod": method,
                "note": note,
                "paidMinor": applied.paid_minor,
                "outstandingMinor": applied.outstanding_minor,
            }),
        ),
        PaymentChange::RefundPayment {
            amount_minor,
            reason,
        } => (
            "airhop.payment.refund_recorded.v1",
            json!({
                "paymentId": payment_id,
                "transactionId": applied.transaction_id,
                "amountMinor": amount_minor,
                "reason": reason.trim(),
                "paidMinor": applied.paid_minor,
                "outstandingMinor": applied.outstanding_minor,
            }),
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
        PaymentChange::RecordPayment { amount_minor, .. }
        | PaymentChange::RefundPayment { amount_minor, .. }
            if *amount_minor <= 0 =>
        {
            Err(DbError::InvalidData(
                "AirHub payment transaction amount is invalid".to_owned(),
            ))
        }
        PaymentChange::RecordPayment {
            method: PaymentMethod::Buzz | PaymentMethod::Legacy,
            ..
        } => Err(DbError::InvalidData(
            "AirHub staff payment method is invalid".to_owned(),
        )),
        PaymentChange::RecordPayment {
            note: Some(note), ..
        } if note.trim().is_empty() || note.trim().chars().count() > 4_000 => Err(
            DbError::InvalidData("AirHub payment note is invalid".to_owned()),
        ),
        PaymentChange::ChangeAmount { amount_minor } if *amount_minor < 0 => Err(
            DbError::InvalidData("AirHub payment amount is invalid".to_owned()),
        ),
        PaymentChange::Cancel { reason }
        | PaymentChange::Restore { reason }
        | PaymentChange::RefundPayment { reason, .. }
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
    let outstanding_minor = current.amount_minor - current.paid_minor;
    let allowed = match change {
        PaymentChange::MarkPaid => {
            current.status == PaymentStatus::Expected && outstanding_minor > 0
        }
        PaymentChange::RecordPayment { amount_minor, .. } => {
            current.status == PaymentStatus::Expected
                && *amount_minor > 0
                && *amount_minor <= outstanding_minor
        }
        PaymentChange::RefundPayment { amount_minor, .. } => {
            current.status != PaymentStatus::Cancelled
                && *amount_minor > 0
                && *amount_minor <= current.paid_minor
        }
        PaymentChange::Cancel { .. } => {
            current.status == PaymentStatus::Expected && current.paid_minor == 0
        }
        PaymentChange::Restore { .. } => match current.status {
            PaymentStatus::Paid => current.paid_minor > 0,
            PaymentStatus::Cancelled => current.paid_minor == 0,
            PaymentStatus::Expected => false,
        },
        PaymentChange::ChangeAmount { amount_minor } => {
            current.status == PaymentStatus::Expected
                && *amount_minor != current.amount_minor
                && (current.paid_minor == 0 || *amount_minor > current.paid_minor)
        }
        PaymentChange::MoveDueDate { due_date, .. } => {
            current.status == PaymentStatus::Expected && *due_date != current.due_date
        }
    };
    if !allowed {
        return Err(DbError::AirhopPaymentTransition);
    }
    Ok(())
}

fn parse_queue_row(
    row: sqlx::postgres::PgRow,
    transactions: Vec<StaffPaymentTransaction>,
) -> Result<StaffPaymentQueueItem> {
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
            paid_minor: row.try_get("paid_minor")?,
            outstanding_minor: row.try_get("outstanding_minor")?,
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
            transactions,
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

fn parse_payment_transaction(row: sqlx::postgres::PgRow) -> Result<StaffPaymentTransaction> {
    Ok(StaffPaymentTransaction {
        id: row.try_get("id")?,
        payment_expectation_id: row.try_get("payment_expectation_id")?,
        kind: PaymentTransactionKind::from_db(row.try_get("kind")?)?,
        amount_minor: row.try_get("amount_minor")?,
        currency: row.try_get::<String, _>("currency")?.trim().to_owned(),
        payment_method: PaymentMethod::from_db(row.try_get("payment_method")?)?,
        note: row.try_get("note")?,
        occurred_at: row.try_get("occurred_at")?,
        recorded_by: row.try_get("recorded_by")?,
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
        let paid_minor = i64::from(status == PaymentStatus::Paid) * 450_000;
        LockedPayment {
            status,
            amount_minor: 450_000,
            paid_minor,
            currency: "RUB".to_owned(),
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
    fn partial_balance_bounds_receipts_refunds_and_cancellation() {
        let mut payment = locked(PaymentStatus::Expected);
        payment.paid_minor = 150_000;
        assert!(validate_transition(
            &payment,
            &PaymentChange::RecordPayment {
                amount_minor: 300_000,
                method: PaymentMethod::Card,
                note: None,
            },
        )
        .is_ok());
        assert!(validate_transition(
            &payment,
            &PaymentChange::RecordPayment {
                amount_minor: 300_001,
                method: PaymentMethod::Card,
                note: None,
            },
        )
        .is_err());
        assert!(validate_transition(
            &payment,
            &PaymentChange::RefundPayment {
                amount_minor: 150_000,
                reason: "Возврат".to_owned(),
            },
        )
        .is_ok());
        assert!(validate_transition(
            &payment,
            &PaymentChange::RefundPayment {
                amount_minor: 150_001,
                reason: "Возврат".to_owned(),
            },
        )
        .is_err());
        assert!(validate_transition(
            &payment,
            &PaymentChange::Cancel {
                reason: "Отмена".to_owned(),
            },
        )
        .is_err());
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
