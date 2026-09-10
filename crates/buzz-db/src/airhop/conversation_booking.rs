//! Conversation-scoped intake and atomic parent-confirmed booking creation.

use airhop_core::conversation_booking::{is_booking_confirmation, ConversationBookingData};
use airhop_core::{BookingStatus, StableLessonReference};
use buzz_core::TenantContext;
use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use super::agent_runtime::ValidateParentAgentTurnLeaseInput;
use super::booking::{get_booking_by_id, reserve_booking, BookingVisitKind, NewBooking};
use super::public_booking::{
    acquire_identity_lock, applicant_snapshot, normalize_applicant, resolve_child,
    resolve_identity, IdentityConsent, PreferredContactChannel, PublicBookingApplicant,
    ResolvedIdentity,
};
use super::{
    append_domain_event, commit_command, enqueue_outbox, insert_pending_command, ActorKind,
    AirhopActor, CommandInsertOutcome, NewAirhopCommand, NewDomainEvent, NewOutboxMessage,
    PrivacyClass,
};
use crate::{Db, DbError, Result};

mod support;
use support::*;

/// Server-owned snapshot of the current intake. It does not reserve a place.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationBookingDraft {
    /// Optimistic revision used by edits, cancellation and confirmation.
    pub version: i64,
    /// `collecting`, `ready`, `cancelled` or `booked`.
    pub state: String,
    /// Collected fields; available only inside the originating conversation.
    pub data: ConversationBookingData,
    /// Exact summary to send via airhop_send_parent_reply before confirmation.
    pub preview: Option<String>,
    /// Persisted booking after successful confirmation.
    pub booking_id: Option<Uuid>,
}

/// Server-issued evidence needed to commit a conversation draft.
#[derive(Debug, Clone)]
pub struct CommitConversationBookingInput {
    /// Authenticated, current supervisor lease.
    pub lease: ValidateParentAgentTurnLeaseInput,
    /// Exact draft revision the parent was shown.
    pub version: i64,
    /// Same tenant phone index digest as the public and staff booking flows.
    pub phone_match_digest: [u8; 32],
    /// Retry-stable command identity, scoped to conversation and draft revision.
    pub command_digest: [u8; 32],
    /// Unexposed management credential digest; the authenticated chat manages it.
    pub management_token_digest: [u8; 32],
}

/// Authoritative outcome; only `confirmed` permits promising a confirmed place.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationBookingResult {
    /// Persisted booking identity.
    pub booking_id: Uuid,
    /// Current Core status.
    pub status: BookingStatus,
    /// Whether this returned an already created booking.
    pub replayed: bool,
    /// Staff must review the identity or confirm the pending request.
    pub requires_staff: bool,
}

impl Db {
    /// Loads intake only for a conversation resolved from an authenticated grant.
    pub async fn get_airhop_booking_draft(
        &self,
        tenant: &TenantContext,
        conversation_id: Uuid,
    ) -> Result<Option<ConversationBookingDraft>> {
        let row = sqlx::query("SELECT * FROM airhop_conversation_booking_drafts WHERE community_id=$1 AND conversation_id=$2")
            .bind(tenant.community().as_uuid()).bind(conversation_id)
            .fetch_optional(&self.pool).await?;
        row.as_ref().map(draft_from_row).transpose()
    }

    /// Saves a complete snapshot (possibly incomplete) using optimistic locking.
    /// Identical retries keep the revision and previously displayed summary.
    pub async fn save_airhop_booking_draft(
        &self,
        tenant: &TenantContext,
        lease: &ValidateParentAgentTurnLeaseInput,
        expected_version: i64,
        mut data: ConversationBookingData,
    ) -> Result<ConversationBookingDraft> {
        if expected_version < 0 || expected_version == i64::MAX {
            return Err(DbError::AirhopVersionConflict);
        }
        validate_fields(&data)?;
        let mut tx = self.pool.begin().await?;
        let scope = lock_scope(&mut tx, tenant, lease).await?;
        fill_verified_fields(&mut tx, tenant, &scope, &mut data).await?;
        let quote = quote_for_data(&mut tx, tenant, &scope, &data).await?;
        let current = lock_draft(&mut tx, tenant, scope.conversation_id).await?;
        if let Some(row) = &current {
            let draft = draft_from_row(row)?;
            if draft.data == data
                && draft.state != "cancelled"
                && row.try_get::<Option<Value>, _>("quote")? == quote
                && row.try_get::<DateTime<Utc>, _>("updated_at")? + chrono::Duration::hours(24)
                    > Utc::now()
                && (draft.version == expected_version || draft.version == expected_version + 1)
            {
                return Ok(draft);
            }
        }
        require_version(current.as_ref(), expected_version)?;
        let preview = quote
            .as_ref()
            .map(|quote| make_preview(&scope.locale, &data, quote));
        let state = if preview.is_some() {
            "ready"
        } else {
            "collecting"
        };
        let row = sqlx::query(
            "INSERT INTO airhop_conversation_booking_drafts
             (community_id,organization_id,conversation_id,version,state,data,quote,preview)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT(community_id,conversation_id) DO UPDATE SET version=EXCLUDED.version,
               state=EXCLUDED.state,data=EXCLUDED.data,quote=EXCLUDED.quote,preview=EXCLUDED.preview,
               booking_id=NULL,updated_at=clock_timestamp() RETURNING *")
            .bind(tenant.community().as_uuid()).bind(scope.organization_id).bind(scope.conversation_id)
            .bind(expected_version + 1).bind(state).bind(serde_json::to_value(&data)?)
            .bind(quote).bind(preview).fetch_one(&mut *tx).await?;
        let result = draft_from_row(&row)?;
        super::consultation::record_draft(
            &mut tx,
            *tenant.community().as_uuid(),
            scope.organization_id,
            scope.conversation_id,
            &scope.source_event_id,
            &data,
            state == "ready",
        )
        .await?;
        tx.commit().await?;
        Ok(result)
    }

    /// Cancels an uncommitted intake; it cannot cancel an existing booking.
    pub async fn cancel_airhop_booking_draft(
        &self,
        tenant: &TenantContext,
        lease: &ValidateParentAgentTurnLeaseInput,
        version: i64,
    ) -> Result<ConversationBookingDraft> {
        let mut tx = self.pool.begin().await?;
        let scope = lock_scope(&mut tx, tenant, lease).await?;
        let row = lock_draft(&mut tx, tenant, scope.conversation_id).await?;
        require_version(row.as_ref(), version)?;
        let draft = row
            .as_ref()
            .ok_or_else(|| DbError::NotFound("booking draft".into()))?;
        if draft.try_get::<&str, _>("state")? == "booked" {
            return Err(DbError::AirhopBookingTransition);
        }
        let row = sqlx::query("UPDATE airhop_conversation_booking_drafts SET state='cancelled',preview=NULL,quote=NULL,updated_at=clock_timestamp() WHERE community_id=$1 AND conversation_id=$2 RETURNING *")
            .bind(tenant.community().as_uuid()).bind(scope.conversation_id).fetch_one(&mut *tx).await?;
        let result = draft_from_row(&row)?;
        super::consultation::close_session(
            &mut tx,
            *tenant.community().as_uuid(),
            scope.conversation_id,
            &scope.source_event_id,
            "cancelled",
            None,
        )
        .await?;
        tx.commit().await?;
        Ok(result)
    }

    /// Creates the family/child, consent, booking, audit and chat binding in one
    /// transaction after a delivered summary and a later affirmative parent event.
    pub async fn commit_airhop_booking_draft(
        &self,
        tenant: &TenantContext,
        input: &CommitConversationBookingInput,
    ) -> Result<ConversationBookingResult> {
        let mut tx = self.pool.begin().await?;
        let scope = lock_scope(&mut tx, tenant, &input.lease).await?;
        let row = lock_draft(&mut tx, tenant, scope.conversation_id).await?;
        require_version(row.as_ref(), input.version)?;
        let row = row.ok_or_else(|| DbError::NotFound("booking draft".into()))?;
        let draft = draft_from_row(&row)?;
        if let Some(id) = draft.booking_id {
            let result = booking_result(&mut tx, tenant, scope.organization_id, id, true).await?;
            tx.commit().await?;
            return Ok(result);
        }
        if scope.family_id.is_none()
            && (draft.data.parent_first_name.is_none() || draft.data.parent_last_name.is_none())
        {
            return Err(DbError::InvalidData(
                "Parent given name and surname are required for a new Family. Save the completed draft, show its new summary and wait for parent confirmation.".into(),
            ));
        }
        if draft.state != "ready" || !is_booking_confirmation(&scope.source_content) {
            return Err(DbError::InvalidData("Show the booking summary and ask the parent to reply: Подтверждаю запись / Confirm booking".into()));
        }
        let summary_event_id = validate_confirmation(&mut tx, tenant, &scope, &row).await?;
        let mut applicant = applicant(&draft.data)?;
        if scope.provider == "whatsapp" {
            applicant.preferred_contact_channel = PreferredContactChannel::Whatsapp;
        }
        let normalized = normalize_applicant(&applicant, scope.current_date)?;
        // Match the public/staff writer lock order: identity before occurrence.
        acquire_identity_lock(
            &mut tx,
            tenant,
            scope.organization_id,
            &input.phone_match_digest,
            &normalized.phone_normalized,
        )
        .await?;
        let mut current_data = draft.data.clone();
        fill_verified_fields(&mut tx, tenant, &scope, &mut current_data).await?;
        if current_data != draft.data {
            return Err(DbError::InvalidData(
                "Family details changed. Save and show a new booking summary.".into(),
            ));
        }
        let quote = quote_for_data(&mut tx, tenant, &scope, &draft.data).await?;
        if quote != row.try_get::<Option<Value>, _>("quote")? {
            return Err(DbError::InvalidData("Lesson details changed. Save the draft again and show a new summary before confirming.".into()));
        }
        let actor = AirhopActor {
            kind: ActorKind::Bot,
            pubkey: Some(input.lease.agent_pubkey),
            agent_pubkey: Some(input.lease.agent_pubkey),
            on_behalf_of_pubkey: None,
        };
        let command = match insert_pending_command(
            &mut tx,
            tenant,
            &NewAirhopCommand {
                id: Uuid::new_v4(),
                organization_id: scope.organization_id,
                command_type: "CreateConversationBooking".into(),
                idempotency_digest: input.command_digest,
                request_hash: input.command_digest,
                actor: actor.clone(),
                correlation_id: Uuid::new_v4(),
            },
        )
        .await?
        {
            CommandInsertOutcome::Inserted(command) => command,
            CommandInsertOutcome::Existing(_) => return Err(DbError::AirhopVersionConflict),
        };
        let evidence = json!({"conversationId":scope.conversation_id,"draftVersion":input.version,
            "sourceMessageId":hex::encode(&scope.source_event_id),
            "summaryMessageId":hex::encode(summary_event_id),"policyVersion":"conversation-booking-v1","accepted":true});
        let identity = if let (Some(family_id), Some(representative_id)) =
            (scope.family_id, scope.representative_id)
        {
            let child_id = match draft.data.child_id {
                Some(id) => id,
                None => {
                    resolve_child(
                        &mut tx,
                        tenant,
                        scope.organization_id,
                        family_id,
                        &normalized,
                    )
                    .await?
                }
            };
            let consent_id = Uuid::new_v4();
            sqlx::query("INSERT INTO airhop_consents(community_id,organization_id,id,representative_id,purpose,channel,policy_version,status,effective_at,evidence) VALUES($1,$2,$3,$4,'public_booking','hermes','conversation-booking-v1','granted',now(),$5)")
                .bind(tenant.community().as_uuid()).bind(scope.organization_id).bind(consent_id).bind(representative_id).bind(&evidence).execute(&mut *tx).await?;
            ResolvedIdentity {
                family_id,
                representative_id,
                child_id,
                consent_id,
                created_representative: false,
            }
        } else {
            resolve_identity(
                &mut tx,
                tenant,
                scope.organization_id,
                &normalized,
                IdentityConsent {
                    phone_match_digest: &input.phone_match_digest,
                    channel: "hermes",
                    evidence: &evidence,
                },
                scope.current_instant,
            )
            .await?
        };
        let lesson_ref = lesson_ref(&draft.data)?;
        let existing: Option<Uuid> = sqlx::query_scalar("SELECT id FROM airhop_bookings WHERE community_id=$1 AND organization_id=$2 AND child_id=$3 AND recurrence_rule_id=$4 AND original_date=$5 AND status IN ('pending_confirmation','confirmed')")
            .bind(tenant.community().as_uuid()).bind(scope.organization_id).bind(identity.child_id)
            .bind(lesson_ref.recurrence_rule_id).bind(lesson_ref.original_date).fetch_optional(&mut *tx).await?;
        let (booking_id, replayed) = if let Some(id) = existing {
            (id, true)
        } else {
            let visit_kind = visit_kind(&draft.data)?;
            let booking = reserve_booking(
                &mut tx,
                tenant,
                &NewBooking {
                    id: Uuid::new_v4(),
                    organization_id: scope.organization_id,
                    family_id: identity.family_id,
                    representative_id: identity.representative_id,
                    child_id: identity.child_id,
                    consent_id: identity.consent_id,
                    lesson_ref,
                    command_id: command.id,
                    applicant_snapshot: applicant_snapshot(&normalized, Utc::now()),
                    visit_kind,
                    status: BookingStatus::PendingConfirmation,
                    management_token_digest: input.management_token_digest,
                    management_key_version: 1,
                    source: json!({"channel":scope.provider,"workflow":"conversation",
                    "conversationId":scope.conversation_id,"draftVersion":input.version,
                    "createdRepresentative":identity.created_representative}),
                    actor: actor.clone(),
                    created_by: "hermes".into(),
                    internal_comment: None,
                },
            )
            .await?;
            record_booking_event(
                &mut tx,
                tenant,
                &command,
                booking.id,
                1,
                "requested",
                &actor,
            )
            .await?;
            (booking.id, false)
        };
        let needs_review = has_identity_review(&mut tx, tenant, &identity).await?;
        if !needs_review && scope.family_id.is_none() {
            bind_new_identity(&mut tx, tenant, &scope, &identity, &command, &actor).await?;
        }
        // Single-visit pricing is not modeled yet; never promise an automatic
        // confirmation with the trial price substituted for it.
        if scope.auto_confirm
            && draft.data.purpose.as_deref() == Some("trial")
            && !needs_review
            && !replayed
        {
            super::booking::recheck_online_confirmation(&mut tx, tenant, booking_id).await?;
            sqlx::query("UPDATE airhop_bookings SET status='confirmed',version=version+1,updated_at=now() WHERE community_id=$1 AND id=$2")
                .bind(tenant.community().as_uuid()).bind(booking_id).execute(&mut *tx).await?;
            record_booking_event(
                &mut tx,
                tenant,
                &command,
                booking_id,
                2,
                "confirmed",
                &actor,
            )
            .await?;
        }
        sqlx::query("UPDATE airhop_conversation_booking_drafts SET state='booked',booking_id=$3 WHERE community_id=$1 AND conversation_id=$2")
            .bind(tenant.community().as_uuid()).bind(scope.conversation_id).bind(booking_id).execute(&mut *tx).await?;
        super::consultation::ensure_session(
            &mut tx,
            *tenant.community().as_uuid(),
            scope.organization_id,
            scope.conversation_id,
            &scope.source_event_id,
        )
        .await?;
        super::consultation::close_session(
            &mut tx,
            *tenant.community().as_uuid(),
            scope.conversation_id,
            &scope.source_event_id,
            "booked",
            Some(booking_id),
        )
        .await?;
        let result =
            booking_result(&mut tx, tenant, scope.organization_id, booking_id, replayed).await?;
        commit_command(
            &mut tx,
            tenant,
            scope.organization_id,
            command.id,
            &serde_json::to_value(&result)?,
        )
        .await?;
        tx.commit().await?;
        Ok(result)
    }
}
