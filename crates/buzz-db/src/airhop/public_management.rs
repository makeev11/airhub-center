//! Credential-scoped public booking management commands and projection.

use airhop_core::{BookingStatus, PublicBookingPurpose, StableLessonReference, TrialPolicy};
use buzz_core::TenantContext;
use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use super::public_booking::PreferredContactChannel;
use super::{
    append_domain_event, commit_command, enqueue_outbox, insert_pending_command, ActorKind,
    AirhopActor, CommandInsertOutcome, CommandStatus, NewAirhopCommand, NewDomainEvent,
    NewOutboxMessage, PrivacyClass,
};
use crate::{Db, DbError, Result};

/// Versioned keyed digest of an opaque management token.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PublicManagementCredential {
    /// Management-key version embedded in the token.
    pub key_version: i16,
    /// Server-derived token digest; raw bearer tokens never reach the DB layer.
    pub token_digest: [u8; 32],
}

/// Idempotent command evidence derived at the trusted HTTP boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PublicManagementCommand {
    /// Keyed digest of the required Idempotency-Key header.
    pub idempotency_digest: [u8; 32],
    /// Tenant/action/credential-scoped request digest.
    pub request_hash: [u8; 32],
}

/// Server-scoped command used by the parent-facing AirHop agent backend.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentFamilyManagementCommand {
    /// Family derived from the short-lived server context grant.
    pub family_id: Uuid,
    /// Booking selected from that family's authoritative projection.
    pub booking_id: Uuid,
    /// Persisted deployment that owns the active turn.
    pub deployment_id: Uuid,
    /// Desired-state version captured in the signed context.
    pub deployment_version: i64,
    /// Durable Hermes turn identity.
    pub turn_id: Uuid,
    /// Exact active lease proof.
    pub turn_lease_token: Uuid,
    /// Retry-stable digest of the turn/action idempotency key.
    pub idempotency_digest: [u8; 32],
    /// Digest of the complete typed action request.
    pub request_hash: [u8; 32],
    /// Authenticated agent attribution.
    pub actor: AirhopActor,
}

/// Durable result returned to the agent after a family-scoped booking action.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentFamilyManagementResult {
    /// Booking changed or confirmed as already changed.
    pub booking_id: Uuid,
    /// Authoritative lifecycle after the transaction.
    pub status: BookingStatus,
    /// Optimistic booking version after the transaction.
    pub version: i64,
    /// Whether an earlier command receipt was replayed.
    pub replayed: bool,
}

/// Parent-visible transfer request state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicTransferRequest {
    /// Current request lifecycle; initially `pending`.
    pub status: String,
    /// Server timestamp at which the request was accepted.
    pub requested_at: DateTime<Utc>,
    /// Optional parent comment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

/// PII-minimized booking projection returned only for a valid bearer token.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicManagementCard {
    /// Booking lifecycle.
    pub status: BookingStatus,
    /// Child display name captured when the booking was submitted.
    pub child_name: String,
    /// Normalized phone used only by the HTTP boundary to create a masked value.
    pub phone_normalized: String,
    /// Current contact preference.
    pub preferred_contact_channel: PreferredContactChannel,
    /// Current transfer request, if any.
    pub transfer_request: Option<PublicTransferRequest>,
    /// Center display name.
    pub organization_name: String,
    /// Effective branch display name.
    pub branch_name: String,
    /// Effective public branch address.
    pub branch_address: String,
    /// Group display name.
    pub group_name: String,
    /// Effective room display name.
    pub room_name: Option<String>,
    /// Effective active teacher display names.
    pub teacher_names: Vec<String>,
    /// Effective local lesson date.
    pub date: NaiveDate,
    /// Effective local start time.
    pub start_time: NaiveTime,
    /// Effective local end time.
    pub end_time: NaiveTime,
    /// Trial terms effective for the occurrence.
    pub trial_policy: TrialPolicy,
    /// Trial or one-off lesson semantics.
    pub purpose: PublicBookingPurpose,
    /// Whether the parent can cancel this future booking.
    pub can_cancel: bool,
    /// Whether the parent can request a transfer for this future booking.
    pub can_request_transfer: bool,
}

/// Parent-authorized management mutation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PublicManagementAction {
    /// Cancel an active booking.
    CancelByParent,
    /// Create one pending transfer request.
    RequestTransfer {
        /// Optional parent comment, bounded by the service.
        comment: Option<String>,
    },
    /// Change the representative's preferred contact route.
    SetPreferredContactChannel {
        /// New contact route.
        channel: PreferredContactChannel,
    },
}

#[derive(Debug)]
struct LockedBooking {
    id: Uuid,
    organization_id: Uuid,
    representative_id: Uuid,
    lesson_ref: StableLessonReference,
    status: BookingStatus,
    transfer_request: Option<PublicTransferRequest>,
    version: i64,
    occurrence_is_future: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredManagementResult {
    booking_id: Uuid,
}

impl Db {
    /// Resolves a parent-visible booking card by versioned token digest.
    pub async fn get_public_management_card(
        &self,
        tenant: &TenantContext,
        credential: PublicManagementCredential,
    ) -> Result<Option<PublicManagementCard>> {
        validate_credential(credential)?;
        let row = sqlx::query(
            "SELECT booking.status, booking.transfer_request, booking.visit_kind, \
                    booking.applicant_snapshot->>'childName' AS child_name, \
                    representative.phone_normalized, representative.preferred_contact_channel, \
                    organization.name AS organization_name, branch.name AS branch_name, \
                    branch.address AS branch_address, group_row.name AS group_name, \
                    room.name AS room_name, occurrence.effective_date, \
                    occurrence.start_time, occurrence.end_time, occurrence.trial_policy, \
                    occurrence.starts_at > now() AS occurrence_is_future, \
                    ARRAY( \
                        SELECT teacher.display_name \
                        FROM airhop_occurrence_teachers occurrence_teacher \
                        JOIN airhop_teachers teacher \
                          ON teacher.community_id = occurrence_teacher.community_id \
                         AND teacher.organization_id = occurrence_teacher.organization_id \
                         AND teacher.id = occurrence_teacher.teacher_id \
                        WHERE occurrence_teacher.community_id = booking.community_id \
                          AND occurrence_teacher.organization_id = booking.organization_id \
                          AND occurrence_teacher.occurrence_id = occurrence.id \
                          AND teacher.status = 'active' \
                        ORDER BY teacher.display_name, teacher.id \
                    ) AS teacher_names \
             FROM airhop_bookings booking \
             JOIN airhop_organizations organization \
               ON organization.community_id = booking.community_id \
              AND organization.id = booking.organization_id \
             JOIN airhop_representatives representative \
               ON representative.community_id = booking.community_id \
              AND representative.organization_id = booking.organization_id \
              AND representative.id = booking.representative_id \
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
             LEFT JOIN airhop_rooms room \
               ON room.community_id = occurrence.community_id \
              AND room.organization_id = occurrence.organization_id \
              AND room.id = occurrence.room_id \
             WHERE booking.community_id = $1 \
               AND organization.status = 'active' \
               AND booking.management_key_version = $2 \
               AND booking.management_token_digest = $3",
        )
        .bind(tenant.community().as_uuid())
        .bind(credential.key_version)
        .bind(credential.token_digest.as_slice())
        .fetch_optional(&self.pool)
        .await?;
        row.map(parse_management_card).transpose()
    }

    /// Applies one idempotent parent management command and returns its card.
    pub async fn apply_public_management_action(
        &self,
        tenant: &TenantContext,
        credential: PublicManagementCredential,
        command: PublicManagementCommand,
        action: PublicManagementAction,
    ) -> Result<PublicManagementCard> {
        validate_credential(credential)?;
        validate_action(&action)?;
        let mut transaction = self.pool.begin().await?;
        let mut booking = lock_booking(&mut transaction, tenant, credential).await?;
        let actor = public_actor();
        let command_input = NewAirhopCommand {
            id: Uuid::new_v4(),
            organization_id: booking.organization_id,
            command_type: action.command_type().to_owned(),
            idempotency_digest: command.idempotency_digest,
            request_hash: command.request_hash,
            actor: actor.clone(),
            correlation_id: Uuid::new_v4(),
        };
        let command_row = match insert_pending_command(&mut transaction, tenant, &command_input)
            .await?
        {
            CommandInsertOutcome::Inserted(command_row) => command_row,
            CommandInsertOutcome::Existing(existing) => {
                verify_replayed_management_command(&existing, booking.id)?;
                transaction.commit().await?;
                return self
                    .get_public_management_card(tenant, credential)
                    .await?
                    .ok_or_else(|| DbError::NotFound("public booking management card".to_owned()));
            }
        };

        let event =
            apply_action(&mut transaction, tenant, &mut booking, &action, Utc::now()).await?;
        if let Some(event) = event {
            let event_id = Uuid::new_v4();
            append_domain_event(
                &mut transaction,
                tenant,
                &NewDomainEvent {
                    id: event_id,
                    organization_id: booking.organization_id,
                    stream_type: "booking".to_owned(),
                    stream_id: booking.id,
                    stream_version: booking.version,
                    event_type: event.event_type.to_owned(),
                    schema_version: 1,
                    occurred_at: event.occurred_at,
                    actor,
                    causation_id: command_row.id,
                    correlation_id: command_row.correlation_id,
                    payload: event.payload.clone(),
                    privacy_class: PrivacyClass::SensitiveChild,
                },
            )
            .await?;
            enqueue_outbox(
                &mut transaction,
                tenant,
                &NewOutboxMessage {
                    id: Uuid::new_v4(),
                    organization_id: booking.organization_id,
                    event_id,
                    destination: event.destination.to_owned(),
                    redacted_payload: event.payload,
                    not_before: event.occurred_at,
                },
            )
            .await?;
        }
        commit_command(
            &mut transaction,
            tenant,
            booking.organization_id,
            command_row.id,
            &serde_json::to_value(StoredManagementResult {
                booking_id: booking.id,
            })?,
        )
        .await?;
        transaction.commit().await?;
        self.get_public_management_card(tenant, credential)
            .await?
            .ok_or_else(|| DbError::NotFound("public booking management card".to_owned()))
    }

    /// Applies a parent-safe booking action only when the booking belongs to
    /// the Family carried by a verified agent context grant.
    pub async fn apply_airhop_agent_family_management_action(
        &self,
        tenant: &TenantContext,
        command: AgentFamilyManagementCommand,
        action: PublicManagementAction,
    ) -> Result<AgentFamilyManagementResult> {
        if command.family_id.is_nil() || command.booking_id.is_nil() {
            return Err(DbError::InvalidData(
                "AirHub agent family and booking ids are required".to_owned(),
            ));
        }
        command.actor.validate()?;
        validate_action(&action)?;
        let mut transaction = self.pool.begin().await?;
        let guarded_organization_id =
            lock_active_agent_turn_for_action(&mut transaction, tenant, &command).await?;
        let mut booking = lock_family_booking(
            &mut transaction,
            tenant,
            command.family_id,
            command.booking_id,
        )
        .await?;
        if booking.organization_id != guarded_organization_id {
            return Err(DbError::AccessDenied(
                "AirHub booking is outside the active Hermes turn".to_owned(),
            ));
        }
        let command_input = NewAirhopCommand {
            id: Uuid::new_v4(),
            organization_id: booking.organization_id,
            command_type: format!("Agent{}", action.command_type()),
            idempotency_digest: command.idempotency_digest,
            request_hash: command.request_hash,
            actor: command.actor.clone(),
            correlation_id: Uuid::new_v4(),
        };
        let command_row = match insert_pending_command(&mut transaction, tenant, &command_input)
            .await?
        {
            CommandInsertOutcome::Inserted(command_row) => command_row,
            CommandInsertOutcome::Existing(existing) => {
                verify_replayed_management_command(&existing, booking.id)?;
                transaction.commit().await?;
                let mut result =
                    load_family_booking_result(self, tenant, command.family_id, command.booking_id)
                        .await?;
                result.replayed = true;
                return Ok(result);
            }
        };
        let event =
            apply_action(&mut transaction, tenant, &mut booking, &action, Utc::now()).await?;
        if let Some(event) = event {
            let event_id = Uuid::new_v4();
            append_domain_event(
                &mut transaction,
                tenant,
                &NewDomainEvent {
                    id: event_id,
                    organization_id: booking.organization_id,
                    stream_type: "booking".to_owned(),
                    stream_id: booking.id,
                    stream_version: booking.version,
                    event_type: event.event_type.to_owned(),
                    schema_version: 1,
                    occurred_at: event.occurred_at,
                    actor: command.actor,
                    causation_id: command_row.id,
                    correlation_id: command_row.correlation_id,
                    payload: event.payload.clone(),
                    privacy_class: PrivacyClass::SensitiveChild,
                },
            )
            .await?;
            enqueue_outbox(
                &mut transaction,
                tenant,
                &NewOutboxMessage {
                    id: Uuid::new_v4(),
                    organization_id: booking.organization_id,
                    event_id,
                    destination: event.destination.to_owned(),
                    redacted_payload: event.payload,
                    not_before: event.occurred_at,
                },
            )
            .await?;
        }
        commit_command(
            &mut transaction,
            tenant,
            booking.organization_id,
            command_row.id,
            &serde_json::to_value(StoredManagementResult {
                booking_id: booking.id,
            })?,
        )
        .await?;
        transaction.commit().await?;
        load_family_booking_result(self, tenant, command.family_id, command.booking_id).await
    }
}

async fn lock_active_agent_turn_for_action(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    command: &AgentFamilyManagementCommand,
) -> Result<Uuid> {
    if command.deployment_id.is_nil()
        || command.deployment_version <= 0
        || command.turn_id.is_nil()
        || command.turn_lease_token.is_nil()
    {
        return Err(DbError::InvalidData(
            "AirHub Hermes action lease fields are invalid".to_owned(),
        ));
    }
    let agent_pubkey = command.actor.agent_pubkey.ok_or_else(|| {
        DbError::InvalidData("AirHub Hermes action requires agent attribution".to_owned())
    })?;
    let organization_id: Uuid = sqlx::query_scalar(
        "SELECT deployment.organization_id
         FROM airhop_agent_deployments deployment
         JOIN airhop_organizations organization
           ON organization.community_id = deployment.community_id
          AND organization.id = deployment.organization_id
         WHERE deployment.community_id = $1 AND deployment.id = $2
           AND deployment.version = $3 AND deployment.agent_pubkey = $4
           AND deployment.enabled AND NOT deployment.paused
           AND deployment.manage_bookings
           AND organization.status = 'active'
         FOR SHARE OF deployment",
    )
    .bind(tenant.community().as_uuid())
    .bind(command.deployment_id)
    .bind(command.deployment_version)
    .bind(agent_pubkey.as_slice())
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or_else(|| {
        DbError::AccessDenied("AirHub Hermes deployment is no longer active".to_owned())
    })?;
    let turn_organization_id: Uuid = sqlx::query_scalar(
        "SELECT turn.organization_id
         FROM airhop_hermes_turn_receipts turn
         WHERE turn.community_id = $1 AND turn.organization_id = $2
           AND turn.id = $3 AND turn.deployment_id = $4
           AND turn.lease_token = $5 AND turn.agent_pubkey = $6
           AND turn.family_id = $7 AND turn.status = 'leased'
           AND turn.lease_expires_at > now()
         FOR SHARE OF turn",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(command.turn_id)
    .bind(command.deployment_id)
    .bind(command.turn_lease_token)
    .bind(agent_pubkey.as_slice())
    .bind(command.family_id)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or_else(|| {
        DbError::AccessDenied("AirHub Hermes action lease is no longer active".to_owned())
    })?;
    Ok(turn_organization_id)
}

#[derive(Debug)]
struct ManagementEvent {
    event_type: &'static str,
    destination: &'static str,
    occurred_at: DateTime<Utc>,
    payload: Value,
}

async fn lock_booking(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    credential: PublicManagementCredential,
) -> Result<LockedBooking> {
    let row = sqlx::query(
        "SELECT booking.id, booking.organization_id, booking.representative_id, \
                booking.recurrence_rule_id, booking.original_date, booking.status, \
                booking.transfer_request, booking.version, \
                occurrence.starts_at > now() AS occurrence_is_future \
         FROM airhop_bookings booking \
         JOIN airhop_organizations organization \
           ON organization.community_id = booking.community_id \
          AND organization.id = booking.organization_id \
         JOIN airhop_lesson_occurrences occurrence \
           ON occurrence.community_id = booking.community_id \
          AND occurrence.organization_id = booking.organization_id \
          AND occurrence.recurrence_rule_id = booking.recurrence_rule_id \
          AND occurrence.original_date = booking.original_date \
         WHERE booking.community_id = $1 AND organization.status = 'active' \
           AND booking.management_key_version = $2 \
           AND booking.management_token_digest = $3 \
         FOR UPDATE OF booking",
    )
    .bind(tenant.community().as_uuid())
    .bind(credential.key_version)
    .bind(credential.token_digest.as_slice())
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or_else(|| DbError::NotFound("public booking management credential".to_owned()))?;
    Ok(LockedBooking {
        id: row.try_get("id")?,
        organization_id: row.try_get("organization_id")?,
        representative_id: row.try_get("representative_id")?,
        lesson_ref: StableLessonReference {
            recurrence_rule_id: row.try_get("recurrence_rule_id")?,
            original_date: row.try_get("original_date")?,
        },
        status: parse_status(row.try_get("status")?)?,
        transfer_request: row
            .try_get::<Option<Value>, _>("transfer_request")?
            .map(serde_json::from_value)
            .transpose()?,
        version: row.try_get("version")?,
        occurrence_is_future: row.try_get("occurrence_is_future")?,
    })
}

async fn lock_family_booking(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    family_id: Uuid,
    booking_id: Uuid,
) -> Result<LockedBooking> {
    let row = sqlx::query(
        "SELECT booking.id, booking.organization_id, booking.representative_id, \
                booking.recurrence_rule_id, booking.original_date, booking.status, \
                booking.transfer_request, booking.version, \
                occurrence.starts_at > now() AS occurrence_is_future \
         FROM airhop_bookings booking \
         JOIN airhop_organizations organization \
           ON organization.community_id = booking.community_id \
          AND organization.id = booking.organization_id \
         JOIN airhop_lesson_occurrences occurrence \
           ON occurrence.community_id = booking.community_id \
          AND occurrence.organization_id = booking.organization_id \
          AND occurrence.recurrence_rule_id = booking.recurrence_rule_id \
          AND occurrence.original_date = booking.original_date \
         WHERE booking.community_id = $1 AND organization.status = 'active' \
           AND booking.family_id = $2 AND booking.id = $3 \
         FOR UPDATE OF booking",
    )
    .bind(tenant.community().as_uuid())
    .bind(family_id)
    .bind(booking_id)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or_else(|| DbError::NotFound("family-scoped AirHub booking".to_owned()))?;
    Ok(LockedBooking {
        id: row.try_get("id")?,
        organization_id: row.try_get("organization_id")?,
        representative_id: row.try_get("representative_id")?,
        lesson_ref: StableLessonReference {
            recurrence_rule_id: row.try_get("recurrence_rule_id")?,
            original_date: row.try_get("original_date")?,
        },
        status: parse_status(row.try_get("status")?)?,
        transfer_request: row
            .try_get::<Option<Value>, _>("transfer_request")?
            .map(serde_json::from_value)
            .transpose()?,
        version: row.try_get("version")?,
        occurrence_is_future: row.try_get("occurrence_is_future")?,
    })
}

async fn load_family_booking_result(
    db: &Db,
    tenant: &TenantContext,
    family_id: Uuid,
    booking_id: Uuid,
) -> Result<AgentFamilyManagementResult> {
    let row = sqlx::query(
        "SELECT status, version FROM airhop_bookings \
         WHERE community_id = $1 AND family_id = $2 AND id = $3",
    )
    .bind(tenant.community().as_uuid())
    .bind(family_id)
    .bind(booking_id)
    .fetch_optional(&db.pool)
    .await?
    .ok_or_else(|| DbError::NotFound("family-scoped AirHub booking".to_owned()))?;
    Ok(AgentFamilyManagementResult {
        booking_id,
        status: parse_status(row.try_get("status")?)?,
        version: row.try_get("version")?,
        replayed: false,
    })
}

async fn apply_action(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    booking: &mut LockedBooking,
    action: &PublicManagementAction,
    now: DateTime<Utc>,
) -> Result<Option<ManagementEvent>> {
    match action {
        PublicManagementAction::CancelByParent => {
            if booking.status == BookingStatus::CancelledByParent {
                return Ok(None);
            }
            ensure_changeable(booking)?;
            booking.version = sqlx::query_scalar(
                "UPDATE airhop_bookings \
                 SET status = 'cancelled_by_parent', transfer_request = NULL, \
                     version = version + 1, updated_at = $5 \
                 WHERE community_id = $1 AND organization_id = $2 AND id = $3 AND version = $4 \
                 RETURNING version",
            )
            .bind(tenant.community().as_uuid())
            .bind(booking.organization_id)
            .bind(booking.id)
            .bind(booking.version)
            .bind(now)
            .fetch_one(&mut **transaction)
            .await?;
            booking.status = BookingStatus::CancelledByParent;
            booking.transfer_request = None;
            Ok(Some(ManagementEvent {
                event_type: "airhop.booking.cancelled_by_parent.v1",
                destination: "airhop.booking.cancelled_by_parent",
                occurred_at: now,
                payload: json!({
                    "bookingId": booking.id,
                    "recurrenceRuleId": booking.lesson_ref.recurrence_rule_id,
                    "originalDate": booking.lesson_ref.original_date,
                    "status": "cancelled_by_parent"
                }),
            }))
        }
        PublicManagementAction::RequestTransfer { comment } => {
            ensure_changeable(booking)?;
            if booking.transfer_request.is_some() {
                return Ok(None);
            }
            let request = PublicTransferRequest {
                status: "pending".to_owned(),
                requested_at: now,
                comment: comment.clone(),
            };
            booking.version = sqlx::query_scalar(
                "UPDATE airhop_bookings \
                 SET transfer_request = $5, version = version + 1, updated_at = $6 \
                 WHERE community_id = $1 AND organization_id = $2 AND id = $3 AND version = $4 \
                 RETURNING version",
            )
            .bind(tenant.community().as_uuid())
            .bind(booking.organization_id)
            .bind(booking.id)
            .bind(booking.version)
            .bind(serde_json::to_value(&request)?)
            .bind(now)
            .fetch_one(&mut **transaction)
            .await?;
            booking.transfer_request = Some(request);
            Ok(Some(ManagementEvent {
                event_type: "airhop.booking.transfer_requested.v1",
                destination: "airhop.booking.transfer_requested",
                occurred_at: now,
                payload: json!({
                    "bookingId": booking.id,
                    "recurrenceRuleId": booking.lesson_ref.recurrence_rule_id,
                    "originalDate": booking.lesson_ref.original_date,
                    "status": "pending"
                }),
            }))
        }
        PublicManagementAction::SetPreferredContactChannel { channel } => {
            ensure_changeable(booking)?;
            let changed = sqlx::query(
                "UPDATE airhop_representatives \
                 SET preferred_contact_channel = $4, version = version + 1, updated_at = $5 \
                 WHERE community_id = $1 AND organization_id = $2 AND id = $3 \
                   AND preferred_contact_channel <> $4",
            )
            .bind(tenant.community().as_uuid())
            .bind(booking.organization_id)
            .bind(booking.representative_id)
            .bind(channel.as_db_str())
            .bind(now)
            .execute(&mut **transaction)
            .await?
            .rows_affected()
                > 0;
            if !changed {
                return Ok(None);
            }
            booking.version = sqlx::query_scalar(
                "UPDATE airhop_bookings \
                 SET version = version + 1, updated_at = $5 \
                 WHERE community_id = $1 AND organization_id = $2 AND id = $3 AND version = $4 \
                 RETURNING version",
            )
            .bind(tenant.community().as_uuid())
            .bind(booking.organization_id)
            .bind(booking.id)
            .bind(booking.version)
            .bind(now)
            .fetch_one(&mut **transaction)
            .await?;
            Ok(Some(ManagementEvent {
                event_type: "airhop.booking.contact_channel_changed.v1",
                destination: "airhop.booking.contact_channel_changed",
                occurred_at: now,
                payload: json!({
                    "bookingId": booking.id,
                    "preferredContactChannel": channel.as_db_str()
                }),
            }))
        }
    }
}

fn parse_management_card(row: sqlx::postgres::PgRow) -> Result<PublicManagementCard> {
    let status = parse_status(row.try_get("status")?)?;
    let occurrence_is_future: bool = row.try_get("occurrence_is_future")?;
    let can_change = occurrence_is_future
        && matches!(
            status,
            BookingStatus::PendingConfirmation | BookingStatus::Confirmed
        );
    Ok(PublicManagementCard {
        status,
        child_name: row.try_get("child_name")?,
        phone_normalized: row.try_get("phone_normalized")?,
        preferred_contact_channel: parse_contact_channel(
            row.try_get("preferred_contact_channel")?,
        )?,
        transfer_request: row
            .try_get::<Option<Value>, _>("transfer_request")?
            .map(serde_json::from_value)
            .transpose()?,
        organization_name: row.try_get("organization_name")?,
        branch_name: row.try_get("branch_name")?,
        branch_address: row.try_get("branch_address")?,
        group_name: row.try_get("group_name")?,
        room_name: row.try_get("room_name")?,
        teacher_names: row.try_get("teacher_names")?,
        date: row.try_get("effective_date")?,
        start_time: row.try_get("start_time")?,
        end_time: row.try_get("end_time")?,
        trial_policy: serde_json::from_value(row.try_get("trial_policy")?)?,
        purpose: match row.try_get::<&str, _>("visit_kind")? {
            "trial" => PublicBookingPurpose::Trial,
            "single" => PublicBookingPurpose::Lesson,
            other => {
                return Err(DbError::InvalidData(format!(
                    "unknown AirHub booking visit kind {other:?}"
                )))
            }
        },
        can_cancel: can_change,
        can_request_transfer: can_change,
    })
}

fn verify_replayed_management_command(
    command: &super::AirhopCommand,
    expected_booking_id: Uuid,
) -> Result<()> {
    match command.status {
        CommandStatus::Pending => Err(DbError::AirhopCommandInProgress),
        CommandStatus::Failed => Err(DbError::AirhopCommandPreviouslyFailed),
        CommandStatus::Committed => {
            let stored: StoredManagementResult =
                serde_json::from_value(command.result.clone().ok_or_else(|| {
                    DbError::InvalidData("committed AirHub command has no result".to_owned())
                })?)?;
            if stored.booking_id != expected_booking_id {
                return Err(DbError::AirhopIdempotencyConflict);
            }
            Ok(())
        }
    }
}

fn ensure_changeable(booking: &LockedBooking) -> Result<()> {
    if !booking.occurrence_is_future
        || !matches!(
            booking.status,
            BookingStatus::PendingConfirmation | BookingStatus::Confirmed
        )
    {
        return Err(DbError::AirhopBookingTransition);
    }
    Ok(())
}

fn validate_credential(credential: PublicManagementCredential) -> Result<()> {
    if credential.key_version <= 0 {
        return Err(DbError::InvalidData(
            "AirHub management key version must be positive".to_owned(),
        ));
    }
    Ok(())
}

fn validate_action(action: &PublicManagementAction) -> Result<()> {
    if let PublicManagementAction::RequestTransfer { comment } = action {
        if comment
            .as_ref()
            .is_some_and(|value| value.chars().count() > 1_000)
        {
            return Err(DbError::InvalidData(
                "AirHub transfer comment is too long".to_owned(),
            ));
        }
    }
    Ok(())
}

impl PublicManagementAction {
    const fn command_type(&self) -> &'static str {
        match self {
            Self::CancelByParent => "CancelPublicBookingByParent",
            Self::RequestTransfer { .. } => "RequestPublicBookingTransfer",
            Self::SetPreferredContactChannel { .. } => "SetPublicBookingContactChannel",
        }
    }
}

fn parse_status(value: &str) -> Result<BookingStatus> {
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

fn parse_contact_channel(value: &str) -> Result<PreferredContactChannel> {
    match value {
        "telegram" => Ok(PreferredContactChannel::Telegram),
        "max" => Ok(PreferredContactChannel::Max),
        "whatsapp" => Ok(PreferredContactChannel::Whatsapp),
        "phone" => Ok(PreferredContactChannel::Phone),
        "none" => Ok(PreferredContactChannel::None),
        other => Err(DbError::InvalidData(format!(
            "unknown AirHub contact channel {other:?}"
        ))),
    }
}

const fn public_actor() -> AirhopActor {
    AirhopActor {
        kind: ActorKind::Public,
        pubkey: None,
        on_behalf_of_pubkey: None,
        agent_pubkey: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn management_actions_have_distinct_command_types() {
        assert_ne!(
            PublicManagementAction::CancelByParent.command_type(),
            PublicManagementAction::RequestTransfer { comment: None }.command_type()
        );
        assert_ne!(
            PublicManagementAction::CancelByParent.command_type(),
            PublicManagementAction::SetPreferredContactChannel {
                channel: PreferredContactChannel::Telegram,
            }
            .command_type()
        );
    }

    #[test]
    fn transfer_comment_is_bounded_by_characters() {
        assert!(validate_action(&PublicManagementAction::RequestTransfer {
            comment: Some("я".repeat(1_000)),
        })
        .is_ok());
        assert!(validate_action(&PublicManagementAction::RequestTransfer {
            comment: Some("я".repeat(1_001)),
        })
        .is_err());
    }
}
