//! Authoritative staff decisions and the AirHub Center messenger-delivery seam.
//!
//! The decision transaction updates the booking, appends its semantic event,
//! and creates exactly one redacted outbox row. Provider identities are only
//! exposed by the lease API to an authenticated connector in the same tenant.

use airhop_core::BookingStatus;
use buzz_core::TenantContext;
use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use super::{
    append_domain_event, commit_command, enqueue_outbox, insert_pending_command, ActorKind,
    AirhopActor, CommandInsertOutcome, CommandStatus, NewAirhopCommand, NewDomainEvent,
    NewOutboxMessage, PrivacyClass,
};
use crate::{Db, DbError, Result};

const DECIDE_COMMAND_TYPE: &str = "DecideBooking";
const BIND_COMMAND_TYPE: &str = "BindBookingMessengerAccount";
const MAX_DELIVERY_ATTEMPTS: i32 = 5;

/// Staff-controlled terminal choice for a pending booking.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BookingDecision {
    /// Accept the request.
    Confirm,
    /// Reject the request.
    Reject,
}

impl BookingDecision {
    const fn target_status(self) -> BookingStatus {
        match self {
            Self::Confirm => BookingStatus::Confirmed,
            Self::Reject => BookingStatus::Rejected,
        }
    }

    const fn event_type(self) -> &'static str {
        match self {
            Self::Confirm => "airhop.booking.confirmed.v1",
            Self::Reject => "airhop.booking.rejected.v1",
        }
    }

    const fn template_key(self) -> &'static str {
        match self {
            Self::Confirm => "booking_confirmed_v1",
            Self::Reject => "booking_rejected_v1",
        }
    }
}

/// Idempotent staff decision envelope.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecideBookingInput {
    /// Booking aggregate to mutate.
    pub booking_id: Uuid,
    /// Confirm or reject.
    pub decision: BookingDecision,
    /// Keyed digest of the HTTP idempotency key.
    pub idempotency_digest: [u8; 32],
    /// Hash of the canonical HTTP body.
    pub request_hash: [u8; 32],
    /// Verified Buzz member attribution.
    pub actor: AirhopActor,
}

/// How the parent will be contacted after the authoritative decision.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ParentNotificationRoute {
    /// A verified provider identity exists in the selected channel.
    Messenger {
        /// Provider channel.
        channel: String,
    },
    /// No routable provider identity exists; staff must call the parent.
    StaffCall,
}

/// Result of applying or replaying a staff decision.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BookingDecisionOutcome {
    /// Booking aggregate.
    pub booking_id: Uuid,
    /// Persisted target status.
    pub status: BookingStatus,
    /// Delivery/fallback route selected transactionally.
    pub notification_route: ParentNotificationRoute,
    /// True when an existing command receipt was replayed.
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredDecisionResult {
    booking_id: Uuid,
    status: BookingStatus,
    notification_route: ParentNotificationRoute,
}

/// Trusted connector input for binding a provider identity to a booking owner.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BindMessengerAccountInput {
    /// Booking whose representative completed the messenger handoff.
    pub booking_id: Uuid,
    /// `telegram`, `max`, or `whatsapp`.
    pub channel: String,
    /// Provider-specific routable user/conversation identifier.
    pub external_user_id: String,
    /// Tenant-keyed digest of the provider identifier.
    pub external_user_digest: [u8; 32],
    /// Optional display handle for staff diagnostics.
    pub display_handle: Option<String>,
    /// Keyed command idempotency digest.
    pub idempotency_digest: [u8; 32],
    /// Canonical body hash.
    pub request_hash: [u8; 32],
    /// Verified connector attribution.
    pub actor: AirhopActor,
}

/// Result of a provider-identity binding command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BindMessengerAccountOutcome {
    /// Representative bound through the booking.
    pub representative_id: Uuid,
    /// Persisted account row.
    pub messenger_account_id: Uuid,
    /// Bound channel.
    pub channel: String,
    /// True when an existing command receipt was replayed.
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredBindingResult {
    representative_id: Uuid,
    messenger_account_id: Uuid,
    channel: String,
}

/// One leased parent notification returned only to a trusted connector.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParentNotificationJob {
    /// Outbox identity used for completion callbacks.
    pub outbox_id: Uuid,
    /// Per-lease capability; changes when a lease is recovered.
    pub lease_token: Uuid,
    /// Provider channel.
    pub channel: String,
    /// Provider-specific delivery address.
    pub external_user_id: String,
    /// Deterministic template discriminator.
    pub template_key: String,
    /// Booking identity for traceability.
    pub booking_id: Uuid,
    /// Current authoritative status.
    pub status: BookingStatus,
    /// Organization locale.
    pub locale: String,
    /// Organization time zone.
    pub time_zone: String,
    /// Parent-visible child name.
    pub child_name: String,
    /// Parent-visible group name.
    pub group_name: String,
    /// Parent-visible branch name.
    pub branch_name: String,
    /// Parent-visible branch address.
    pub branch_address: String,
    /// Effective lesson date.
    pub lesson_date: NaiveDate,
    /// Effective local lesson start time.
    pub start_time: NaiveTime,
}

/// Connector completion callback.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeliveryCompletion {
    /// Provider accepted/delivered the service message.
    Delivered {
        /// Optional provider receipt identifier.
        provider_message_id: Option<String>,
    },
    /// Provider failed this attempt.
    Failed {
        /// Stable, non-secret provider error code.
        error_code: String,
        /// Requested retry delay. Ignored after the terminal attempt.
        retry_after_seconds: i64,
    },
}

/// Observable result of acknowledging one lease.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryAckState {
    /// Delivery is complete.
    Delivered,
    /// A future retry is scheduled.
    RetryScheduled,
    /// Delivery exhausted retries and a staff-call fallback was created.
    FailedOverToStaff,
}

impl Db {
    /// Applies or idempotently replays a staff booking decision.
    pub async fn decide_airhop_booking(
        &self,
        tenant: &TenantContext,
        input: &DecideBookingInput,
    ) -> Result<BookingDecisionOutcome> {
        validate_decision_input(input)?;
        let mut transaction = self.pool.begin().await?;
        let (organization_id, occurred_at) =
            resolve_active_organization(&mut transaction, tenant).await?;
        let command = NewAirhopCommand {
            id: Uuid::new_v4(),
            organization_id,
            command_type: DECIDE_COMMAND_TYPE.to_owned(),
            idempotency_digest: input.idempotency_digest,
            request_hash: input.request_hash,
            actor: input.actor.clone(),
            correlation_id: Uuid::new_v4(),
        };
        let command = match insert_pending_command(&mut transaction, tenant, &command).await? {
            CommandInsertOutcome::Inserted(command) => command,
            CommandInsertOutcome::Existing(command) => {
                return replay_decision(transaction, command).await;
            }
        };

        let row = sqlx::query(
            "SELECT booking.status, booking.version, booking.representative_id, \
                    representative.preferred_contact_channel \
             FROM airhop_bookings booking \
             JOIN airhop_representatives representative \
               ON representative.community_id = booking.community_id \
              AND representative.organization_id = booking.organization_id \
              AND representative.id = booking.representative_id \
             WHERE booking.community_id = $1 AND booking.organization_id = $2 \
               AND booking.id = $3 \
             FOR UPDATE OF booking",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(input.booking_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| DbError::NotFound("AirHub booking".to_owned()))?;
        let current_status = booking_status_from_db(row.try_get("status")?)?;
        if current_status != BookingStatus::PendingConfirmation {
            return Err(DbError::AirhopBookingTransition);
        }
        let current_version: i64 = row.try_get("version")?;
        let representative_id: Uuid = row.try_get("representative_id")?;
        let preferred_channel: &str = row.try_get("preferred_contact_channel")?;
        let target_status = input.decision.target_status();
        let target_status_db = booking_status_str(target_status);
        sqlx::query(
            "UPDATE airhop_bookings \
             SET status = $4, version = version + 1, updated_at = $5 \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(input.booking_id)
        .bind(target_status_db)
        .bind(occurred_at)
        .execute(&mut *transaction)
        .await?;

        let messenger_account = if is_messenger_channel(preferred_channel) {
            sqlx::query(
                "SELECT id \
                 FROM airhop_messenger_accounts \
                 WHERE community_id = $1 AND organization_id = $2 \
                   AND representative_id = $3 AND channel = $4 \
                   AND verified_at IS NOT NULL \
                 ORDER BY last_inbound_at DESC NULLS LAST, verified_at DESC, id DESC \
                 LIMIT 1",
            )
            .bind(tenant.community().as_uuid())
            .bind(organization_id)
            .bind(representative_id)
            .bind(preferred_channel)
            .fetch_optional(&mut *transaction)
            .await?
            .map(|account| account.try_get::<Uuid, _>("id"))
            .transpose()?
        } else {
            None
        };

        let notification_route =
            messenger_account.map_or(ParentNotificationRoute::StaffCall, |_| {
                ParentNotificationRoute::Messenger {
                    channel: preferred_channel.to_owned(),
                }
            });
        let event_id = Uuid::new_v4();
        append_domain_event(
            &mut transaction,
            tenant,
            &NewDomainEvent {
                id: event_id,
                organization_id,
                stream_type: "booking".to_owned(),
                stream_id: input.booking_id,
                stream_version: current_version + 1,
                event_type: input.decision.event_type().to_owned(),
                schema_version: 1,
                occurred_at,
                actor: input.actor.clone(),
                causation_id: command.id,
                correlation_id: command.correlation_id,
                payload: json!({
                    "bookingId": input.booking_id,
                    "status": target_status_db
                }),
                privacy_class: PrivacyClass::Operational,
            },
        )
        .await?;

        let (destination, redacted_payload) = match messenger_account {
            Some(messenger_account_id) => (
                format!("airhop.parent.booking-decision.{preferred_channel}"),
                json!({
                    "bookingId": input.booking_id,
                    "messengerAccountId": messenger_account_id,
                    "status": target_status_db,
                    "templateKey": input.decision.template_key()
                }),
            ),
            None => (
                "airhop.staff.call-parent".to_owned(),
                json!({
                    "bookingId": input.booking_id,
                    "reason": "messenger_unavailable",
                    "status": target_status_db
                }),
            ),
        };
        enqueue_outbox(
            &mut transaction,
            tenant,
            &NewOutboxMessage {
                id: Uuid::new_v4(),
                organization_id,
                event_id,
                destination,
                redacted_payload,
                not_before: occurred_at,
            },
        )
        .await?;
        let stored = StoredDecisionResult {
            booking_id: input.booking_id,
            status: target_status,
            notification_route: notification_route.clone(),
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
        Ok(BookingDecisionOutcome {
            booking_id: input.booking_id,
            status: target_status,
            notification_route,
            replayed: false,
        })
    }

    /// Creates or verifies a messenger identity for the representative who owns a booking.
    pub async fn bind_airhop_booking_messenger_account(
        &self,
        tenant: &TenantContext,
        input: &BindMessengerAccountInput,
    ) -> Result<BindMessengerAccountOutcome> {
        validate_binding_input(input)?;
        let mut transaction = self.pool.begin().await?;
        let (organization_id, occurred_at) =
            resolve_active_organization(&mut transaction, tenant).await?;
        let command = NewAirhopCommand {
            id: Uuid::new_v4(),
            organization_id,
            command_type: BIND_COMMAND_TYPE.to_owned(),
            idempotency_digest: input.idempotency_digest,
            request_hash: input.request_hash,
            actor: input.actor.clone(),
            correlation_id: Uuid::new_v4(),
        };
        let command = match insert_pending_command(&mut transaction, tenant, &command).await? {
            CommandInsertOutcome::Inserted(command) => command,
            CommandInsertOutcome::Existing(command) => {
                return replay_binding(transaction, command).await;
            }
        };
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(format!(
                "{}:{}:{}",
                organization_id,
                input.channel,
                hex::encode(input.external_user_digest)
            ))
            .execute(&mut *transaction)
            .await?;
        let representative_id: Uuid = sqlx::query(
            "SELECT representative_id FROM airhop_bookings \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(input.booking_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| DbError::NotFound("AirHub booking".to_owned()))?
        .try_get("representative_id")?;

        let existing = sqlx::query(
            "SELECT id, representative_id, verified_at \
             FROM airhop_messenger_accounts \
             WHERE community_id = $1 AND organization_id = $2 \
               AND channel = $3 AND external_user_digest = $4 \
             FOR UPDATE",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(&input.channel)
        .bind(input.external_user_digest.as_slice())
        .fetch_optional(&mut *transaction)
        .await?;
        let (messenger_account_id, newly_bound) = match existing {
            Some(row) => {
                let owner: Uuid = row.try_get("representative_id")?;
                if owner != representative_id {
                    return Err(DbError::AirhopIdentityMismatch);
                }
                let account_id: Uuid = row.try_get("id")?;
                let was_verified: Option<DateTime<Utc>> = row.try_get("verified_at")?;
                sqlx::query(
                    "UPDATE airhop_messenger_accounts \
                     SET external_user_id = $5, display_handle = $6, \
                         verified_at = COALESCE(verified_at, $7), \
                         verified_by_pubkey = COALESCE(verified_by_pubkey, $8), \
                         last_inbound_at = $7, updated_at = $7 \
                     WHERE community_id = $1 AND organization_id = $2 AND id = $3 \
                       AND representative_id = $4",
                )
                .bind(tenant.community().as_uuid())
                .bind(organization_id)
                .bind(account_id)
                .bind(representative_id)
                .bind(&input.external_user_id)
                .bind(&input.display_handle)
                .bind(occurred_at)
                .bind(input.actor.pubkey.map(Vec::from))
                .execute(&mut *transaction)
                .await?;
                (account_id, was_verified.is_none())
            }
            None => {
                let account_id = Uuid::new_v4();
                sqlx::query(
                    "INSERT INTO airhop_messenger_accounts (\
                         community_id, organization_id, id, representative_id, channel, \
                         external_user_id, external_user_digest, display_handle, verified_at, \
                         verified_by_pubkey, last_inbound_at\
                     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $9)",
                )
                .bind(tenant.community().as_uuid())
                .bind(organization_id)
                .bind(account_id)
                .bind(representative_id)
                .bind(&input.channel)
                .bind(&input.external_user_id)
                .bind(input.external_user_digest.as_slice())
                .bind(&input.display_handle)
                .bind(occurred_at)
                .bind(input.actor.pubkey.map(Vec::from))
                .execute(&mut *transaction)
                .await?;
                (account_id, true)
            }
        };
        let preference_changed = sqlx::query(
            "UPDATE airhop_representatives \
             SET preferred_contact_channel = $4, version = version + 1, updated_at = $5 \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3 \
               AND preferred_contact_channel <> $4",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(representative_id)
        .bind(&input.channel)
        .bind(occurred_at)
        .execute(&mut *transaction)
        .await?
        .rows_affected()
            > 0;
        if newly_bound && !preference_changed {
            sqlx::query(
                "UPDATE airhop_representatives \
                 SET version = version + 1, updated_at = $4 \
                 WHERE community_id = $1 AND organization_id = $2 AND id = $3",
            )
            .bind(tenant.community().as_uuid())
            .bind(organization_id)
            .bind(representative_id)
            .bind(occurred_at)
            .execute(&mut *transaction)
            .await?;
        }
        if newly_bound || preference_changed {
            let representative_version: i64 = sqlx::query(
                "SELECT version FROM airhop_representatives \
                 WHERE community_id = $1 AND organization_id = $2 AND id = $3",
            )
            .bind(tenant.community().as_uuid())
            .bind(organization_id)
            .bind(representative_id)
            .fetch_one(&mut *transaction)
            .await?
            .try_get("version")?;
            append_domain_event(
                &mut transaction,
                tenant,
                &NewDomainEvent {
                    id: Uuid::new_v4(),
                    organization_id,
                    stream_type: "representative".to_owned(),
                    stream_id: representative_id,
                    stream_version: representative_version,
                    event_type: "airhop.representative.messenger-bound.v1".to_owned(),
                    schema_version: 1,
                    occurred_at,
                    actor: input.actor.clone(),
                    causation_id: command.id,
                    correlation_id: command.correlation_id,
                    payload: json!({
                        "representativeId": representative_id,
                        "messengerAccountId": messenger_account_id,
                        "channel": input.channel
                    }),
                    privacy_class: PrivacyClass::Pii,
                },
            )
            .await?;
        }
        let stored = StoredBindingResult {
            representative_id,
            messenger_account_id,
            channel: input.channel.clone(),
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
        Ok(BindMessengerAccountOutcome {
            representative_id,
            messenger_account_id,
            channel: input.channel.clone(),
            replayed: false,
        })
    }

    /// Leases pending messenger deliveries for one tenant and connector.
    pub async fn claim_airhop_parent_notifications(
        &self,
        tenant: &TenantContext,
        connector_pubkey: [u8; 32],
        requested_limit: u16,
        requested_lease_seconds: i64,
    ) -> Result<Vec<ParentNotificationJob>> {
        let limit = i64::from(requested_limit.clamp(1, 50));
        let lease_seconds = requested_lease_seconds.clamp(30, 300);
        let rows = sqlx::query(
            "WITH organization AS ( \
                 SELECT id FROM airhop_organizations \
                 WHERE community_id = $1 AND status = 'active' \
             ), candidates AS ( \
                 SELECT outbox.community_id, outbox.id \
                 FROM airhop_outbox outbox \
                 JOIN organization ON organization.id = outbox.organization_id \
                 WHERE outbox.community_id = $1 \
                   AND outbox.destination LIKE 'airhop.parent.booking-decision.%' \
                   AND outbox.published_at IS NULL AND outbox.failed_at IS NULL \
                   AND outbox.not_before <= now() \
                   AND (outbox.lease_expires_at IS NULL OR outbox.lease_expires_at < now()) \
                   AND EXISTS ( \
                       SELECT 1 FROM airhop_messenger_accounts account \
                       WHERE account.community_id = outbox.community_id \
                         AND account.organization_id = outbox.organization_id \
                         AND account.id = NULLIF(outbox.redacted_payload ->> 'messengerAccountId', '')::uuid \
                         AND account.verified_at IS NOT NULL \
                   ) \
                 ORDER BY outbox.not_before, outbox.id \
                 FOR UPDATE OF outbox SKIP LOCKED \
                 LIMIT $2 \
             ), leased AS ( \
                 UPDATE airhop_outbox outbox \
                 SET lease_token = gen_random_uuid(), leased_by_pubkey = $3, \
                     lease_expires_at = now() + ($4::BIGINT * interval '1 second') \
                 FROM candidates \
                 WHERE outbox.community_id = candidates.community_id \
                   AND outbox.id = candidates.id \
                 RETURNING outbox.* \
             ) \
             SELECT leased.id AS outbox_id, leased.lease_token, account.channel, \
                    account.external_user_id, leased.redacted_payload ->> 'templateKey' AS template_key, \
                    booking.id AS booking_id, booking.status, organization_row.locale, \
                    organization_row.time_zone, child.display_name AS child_name, \
                    group_row.name AS group_name, branch.name AS branch_name, \
                    branch.address AS branch_address, occurrence.effective_date AS lesson_date, \
                    occurrence.start_time \
             FROM leased \
             JOIN airhop_organizations organization_row \
               ON organization_row.community_id = leased.community_id \
              AND organization_row.id = leased.organization_id \
             JOIN airhop_messenger_accounts account \
               ON account.community_id = leased.community_id \
              AND account.organization_id = leased.organization_id \
              AND account.id = (leased.redacted_payload ->> 'messengerAccountId')::uuid \
              AND account.verified_at IS NOT NULL \
             JOIN airhop_bookings booking \
               ON booking.community_id = leased.community_id \
              AND booking.organization_id = leased.organization_id \
              AND booking.id = (leased.redacted_payload ->> 'bookingId')::uuid \
             JOIN airhop_children child \
               ON child.community_id = booking.community_id \
              AND child.organization_id = booking.organization_id \
              AND child.id = booking.child_id \
             JOIN airhop_lesson_occurrences occurrence \
               ON occurrence.community_id = booking.community_id \
              AND occurrence.organization_id = booking.organization_id \
              AND occurrence.recurrence_rule_id = booking.recurrence_rule_id \
              AND occurrence.original_date = booking.original_date \
             JOIN airhop_groups group_row \
               ON group_row.community_id = occurrence.community_id \
              AND group_row.organization_id = occurrence.organization_id \
              AND group_row.id = occurrence.group_id \
             JOIN airhop_branches branch \
               ON branch.community_id = occurrence.community_id \
              AND branch.organization_id = occurrence.organization_id \
              AND branch.id = occurrence.branch_id \
             ORDER BY leased.not_before, leased.id",
        )
        .bind(tenant.community().as_uuid())
        .bind(limit)
        .bind(connector_pubkey.as_slice())
        .bind(lease_seconds)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(parse_notification_job).collect()
    }

    /// Acknowledges a leased delivery, scheduling a retry or staff fallback on failure.
    pub async fn complete_airhop_parent_notification(
        &self,
        tenant: &TenantContext,
        connector_pubkey: [u8; 32],
        outbox_id: Uuid,
        lease_token: Uuid,
        completion: &DeliveryCompletion,
    ) -> Result<DeliveryAckState> {
        validate_completion(completion)?;
        let mut transaction = self.pool.begin().await?;
        let organization_id: Uuid = sqlx::query(
            "SELECT id FROM airhop_organizations \
             WHERE community_id = $1 AND status = 'active'",
        )
        .bind(tenant.community().as_uuid())
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| DbError::NotFound("active AirHub organization".to_owned()))?
        .try_get("id")?;
        if let Some(existing) = sqlx::query(
            "SELECT outcome FROM airhop_outbox_delivery_attempts \
             WHERE community_id = $1 AND organization_id = $2 \
               AND outbox_id = $3 AND lease_token = $4",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(outbox_id)
        .bind(lease_token)
        .fetch_optional(&mut *transaction)
        .await?
        {
            let state = ack_state_from_outcome(existing.try_get("outcome")?);
            transaction.commit().await?;
            return state;
        }
        let outbox = sqlx::query(
            "SELECT event_id, redacted_payload, attempts, lease_token, leased_by_pubkey, \
                    published_at, failed_at \
             FROM airhop_outbox \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3 \
               AND destination LIKE 'airhop.parent.booking-decision.%' \
             FOR UPDATE",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(outbox_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| DbError::NotFound("leased AirHub parent notification".to_owned()))?;
        // A concurrent callback can pass the optimistic receipt read above,
        // wait on this row lock, and resume after the first callback commits.
        // Re-read the append-only receipt under the lock so that race remains
        // idempotent instead of surfacing a false not-found/access error.
        if let Some(existing) = sqlx::query(
            "SELECT outcome FROM airhop_outbox_delivery_attempts \
             WHERE community_id = $1 AND organization_id = $2 \
               AND outbox_id = $3 AND lease_token = $4",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(outbox_id)
        .bind(lease_token)
        .fetch_optional(&mut *transaction)
        .await?
        {
            let state = ack_state_from_outcome(existing.try_get("outcome")?);
            transaction.commit().await?;
            return state;
        }
        let published_at: Option<DateTime<Utc>> = outbox.try_get("published_at")?;
        let failed_at: Option<DateTime<Utc>> = outbox.try_get("failed_at")?;
        if published_at.is_some() || failed_at.is_some() {
            return Err(DbError::NotFound(
                "active AirHub parent notification lease".to_owned(),
            ));
        }
        let persisted_lease: Option<Uuid> = outbox.try_get("lease_token")?;
        let persisted_connector: Option<Vec<u8>> = outbox.try_get("leased_by_pubkey")?;
        if persisted_lease != Some(lease_token)
            || persisted_connector.as_deref() != Some(connector_pubkey.as_slice())
        {
            return Err(DbError::AccessDenied(
                "AirHub notification lease does not belong to this connector".to_owned(),
            ));
        }
        let attempts: i32 = outbox.try_get("attempts")?;
        let next_attempt = attempts + 1;
        let (outcome, error_code, provider_message_id, state) = match completion {
            DeliveryCompletion::Delivered {
                provider_message_id,
            } => (
                "delivered",
                None,
                provider_message_id.as_deref(),
                DeliveryAckState::Delivered,
            ),
            DeliveryCompletion::Failed {
                error_code,
                retry_after_seconds: _,
            } if next_attempt >= MAX_DELIVERY_ATTEMPTS => (
                "failed",
                Some(error_code.as_str()),
                None,
                DeliveryAckState::FailedOverToStaff,
            ),
            DeliveryCompletion::Failed {
                error_code,
                retry_after_seconds: _,
            } => (
                "retry",
                Some(error_code.as_str()),
                None,
                DeliveryAckState::RetryScheduled,
            ),
        };
        sqlx::query(
            "INSERT INTO airhop_outbox_delivery_attempts (\
                 community_id, organization_id, outbox_id, lease_token, connector_pubkey, \
                 outcome, provider_message_id, error_code\
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(outbox_id)
        .bind(lease_token)
        .bind(connector_pubkey.as_slice())
        .bind(outcome)
        .bind(provider_message_id)
        .bind(error_code)
        .execute(&mut *transaction)
        .await?;
        match completion {
            DeliveryCompletion::Delivered { .. } => {
                sqlx::query(
                    "UPDATE airhop_outbox \
                     SET attempts = $4, published_at = now(), last_error_code = NULL, \
                         lease_token = NULL, leased_by_pubkey = NULL, lease_expires_at = NULL \
                     WHERE community_id = $1 AND organization_id = $2 AND id = $3",
                )
                .bind(tenant.community().as_uuid())
                .bind(organization_id)
                .bind(outbox_id)
                .bind(next_attempt)
                .execute(&mut *transaction)
                .await?;
            }
            DeliveryCompletion::Failed {
                error_code,
                retry_after_seconds,
            } if next_attempt < MAX_DELIVERY_ATTEMPTS => {
                let retry_after_seconds = (*retry_after_seconds).clamp(30, 86_400);
                sqlx::query(
                    "UPDATE airhop_outbox \
                     SET attempts = $4, last_error_code = $5, \
                         not_before = now() + ($6::BIGINT * interval '1 second'), \
                         lease_token = NULL, leased_by_pubkey = NULL, lease_expires_at = NULL \
                     WHERE community_id = $1 AND organization_id = $2 AND id = $3",
                )
                .bind(tenant.community().as_uuid())
                .bind(organization_id)
                .bind(outbox_id)
                .bind(next_attempt)
                .bind(error_code)
                .bind(retry_after_seconds)
                .execute(&mut *transaction)
                .await?;
            }
            DeliveryCompletion::Failed { error_code, .. } => {
                sqlx::query(
                    "UPDATE airhop_outbox \
                     SET attempts = $4, last_error_code = $5, failed_at = now(), \
                         lease_token = NULL, leased_by_pubkey = NULL, lease_expires_at = NULL \
                     WHERE community_id = $1 AND organization_id = $2 AND id = $3",
                )
                .bind(tenant.community().as_uuid())
                .bind(organization_id)
                .bind(outbox_id)
                .bind(next_attempt)
                .bind(error_code)
                .execute(&mut *transaction)
                .await?;
                let event_id: Uuid = outbox.try_get("event_id")?;
                let redacted_payload: serde_json::Value = outbox.try_get("redacted_payload")?;
                let booking_id = redacted_payload
                    .get("bookingId")
                    .and_then(serde_json::Value::as_str)
                    .ok_or_else(|| {
                        DbError::InvalidData(
                            "AirHub notification outbox is missing bookingId".to_owned(),
                        )
                    })?;
                sqlx::query(
                    "INSERT INTO airhop_outbox (\
                         community_id, organization_id, event_id, destination, redacted_payload\
                     ) VALUES ($1, $2, $3, 'airhop.staff.call-parent', $4) \
                     ON CONFLICT (community_id, organization_id, event_id, destination) \
                     DO NOTHING",
                )
                .bind(tenant.community().as_uuid())
                .bind(organization_id)
                .bind(event_id)
                .bind(json!({
                    "bookingId": booking_id,
                    "reason": "messenger_delivery_failed"
                }))
                .execute(&mut *transaction)
                .await?;
            }
        }
        transaction.commit().await?;
        Ok(state)
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

async fn replay_decision(
    transaction: Transaction<'_, Postgres>,
    command: super::AirhopCommand,
) -> Result<BookingDecisionOutcome> {
    let stored: StoredDecisionResult = replay_result(transaction, command).await?;
    Ok(BookingDecisionOutcome {
        booking_id: stored.booking_id,
        status: stored.status,
        notification_route: stored.notification_route,
        replayed: true,
    })
}

async fn replay_binding(
    transaction: Transaction<'_, Postgres>,
    command: super::AirhopCommand,
) -> Result<BindMessengerAccountOutcome> {
    let stored: StoredBindingResult = replay_result(transaction, command).await?;
    Ok(BindMessengerAccountOutcome {
        representative_id: stored.representative_id,
        messenger_account_id: stored.messenger_account_id,
        channel: stored.channel,
        replayed: true,
    })
}

async fn replay_result<T: for<'de> Deserialize<'de>>(
    transaction: Transaction<'_, Postgres>,
    command: super::AirhopCommand,
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

fn parse_notification_job(row: sqlx::postgres::PgRow) -> Result<ParentNotificationJob> {
    Ok(ParentNotificationJob {
        outbox_id: row.try_get("outbox_id")?,
        lease_token: row.try_get("lease_token")?,
        channel: row.try_get("channel")?,
        external_user_id: row.try_get("external_user_id")?,
        template_key: row.try_get("template_key")?,
        booking_id: row.try_get("booking_id")?,
        status: booking_status_from_db(row.try_get("status")?)?,
        locale: row.try_get("locale")?,
        time_zone: row.try_get("time_zone")?,
        child_name: row.try_get("child_name")?,
        group_name: row.try_get("group_name")?,
        branch_name: row.try_get("branch_name")?,
        branch_address: row.try_get("branch_address")?,
        lesson_date: row.try_get("lesson_date")?,
        start_time: row.try_get("start_time")?,
    })
}

fn validate_decision_input(input: &DecideBookingInput) -> Result<()> {
    input.actor.validate()?;
    if input.booking_id.is_nil() || input.actor.kind != ActorKind::Staff {
        return Err(DbError::InvalidData(
            "AirHub staff decision envelope is invalid".to_owned(),
        ));
    }
    Ok(())
}

fn validate_binding_input(input: &BindMessengerAccountInput) -> Result<()> {
    input.actor.validate()?;
    if input.booking_id.is_nil()
        || input.actor.kind != ActorKind::Bot
        || !is_messenger_channel(&input.channel)
        || input.external_user_id.trim().is_empty()
        || input.external_user_id.len() > 200
        || input
            .display_handle
            .as_ref()
            .is_some_and(|value| value.len() > 200)
    {
        return Err(DbError::InvalidData(
            "AirHub messenger binding envelope is invalid".to_owned(),
        ));
    }
    Ok(())
}

fn validate_completion(completion: &DeliveryCompletion) -> Result<()> {
    match completion {
        DeliveryCompletion::Delivered {
            provider_message_id,
        } if provider_message_id
            .as_ref()
            .is_some_and(|value| value.len() > 300) =>
        {
            Err(DbError::InvalidData(
                "AirHub provider message id is too long".to_owned(),
            ))
        }
        DeliveryCompletion::Failed { error_code, .. }
            if error_code.trim().is_empty() || error_code.len() > 120 =>
        {
            Err(DbError::InvalidData(
                "AirHub provider error code is invalid".to_owned(),
            ))
        }
        _ => Ok(()),
    }
}

fn ack_state_from_outcome(value: &str) -> Result<DeliveryAckState> {
    match value {
        "delivered" => Ok(DeliveryAckState::Delivered),
        "retry" => Ok(DeliveryAckState::RetryScheduled),
        "failed" => Ok(DeliveryAckState::FailedOverToStaff),
        other => Err(DbError::InvalidData(format!(
            "unknown AirHub delivery outcome {other:?}"
        ))),
    }
}

fn is_messenger_channel(value: &str) -> bool {
    matches!(value, "telegram" | "max" | "whatsapp")
}

const fn booking_status_str(status: BookingStatus) -> &'static str {
    match status {
        BookingStatus::PendingConfirmation => "pending_confirmation",
        BookingStatus::Confirmed => "confirmed",
        BookingStatus::Rejected => "rejected",
        BookingStatus::CancelledByParent => "cancelled_by_parent",
        BookingStatus::CancelledByCenter => "cancelled_by_center",
    }
}

fn booking_status_from_db(value: &str) -> Result<BookingStatus> {
    match value {
        "pending_confirmation" => Ok(BookingStatus::PendingConfirmation),
        "confirmed" => Ok(BookingStatus::Confirmed),
        "rejected" => Ok(BookingStatus::Rejected),
        "cancelled_by_parent" => Ok(BookingStatus::CancelledByParent),
        "cancelled_by_center" => Ok(BookingStatus::CancelledByCenter),
        other => Err(DbError::InvalidData(format!(
            "unknown AirHub booking status {other:?}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decision_event_and_template_are_stable() {
        assert_eq!(
            BookingDecision::Confirm.event_type(),
            "airhop.booking.confirmed.v1"
        );
        assert_eq!(
            BookingDecision::Reject.template_key(),
            "booking_rejected_v1"
        );
    }

    #[test]
    fn only_supported_messenger_channels_are_routable() {
        assert!(is_messenger_channel("telegram"));
        assert!(is_messenger_channel("max"));
        assert!(is_messenger_channel("whatsapp"));
        assert!(!is_messenger_channel("phone"));
        assert!(!is_messenger_channel("none"));
    }

    #[test]
    fn delivery_outcomes_map_to_observable_states() {
        assert_eq!(
            ack_state_from_outcome("delivered").unwrap(),
            DeliveryAckState::Delivered
        );
        assert!(ack_state_from_outcome("unknown").is_err());
    }
}
