//! Server-derived booking milestones and signed question observations.
//! All writers run inside the existing locked conversation transaction.
use crate::{DbError, Result};
use airhop_core::consultation::{ConsultationProgress, ConsultationPurpose, ConsultationQuestion};
use airhop_core::conversation_booking::ConversationBookingData;
use nostr::Event;
use serde_json::Value;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

pub(super) async fn ensure_session(
    tx: &mut Transaction<'_, Postgres>,
    community: Uuid,
    organization: Uuid,
    conversation: Uuid,
    source: &[u8],
) -> Result<Uuid> {
    // The final reply after committing a booking belongs to the same enquiry.
    let current: Option<Uuid> = sqlx::query_scalar("SELECT id FROM airhop_consultations WHERE community_id=$1 AND organization_id=$2 AND conversation_id=$3 AND (closed_at IS NULL OR closed_source_event_id=$4) ORDER BY started_at DESC,id DESC LIMIT 1")
        .bind(community).bind(organization).bind(conversation).bind(source).fetch_optional(&mut **tx).await?;
    let id = match current {
        Some(id) => id,
        None => sqlx::query_scalar("INSERT INTO airhop_consultations(community_id,organization_id,conversation_id) VALUES($1,$2,$3) RETURNING id")
            .bind(community).bind(organization).bind(conversation).fetch_one(&mut **tx).await?,
    };
    record_exposure(tx, community, id, source, false).await?;
    if current.is_none() {
        sqlx::query("UPDATE airhop_consultations SET version_tracking_started=EXISTS(SELECT 1 FROM airhop_consultation_exposures WHERE community_id=$1 AND consultation_id=$2) WHERE community_id=$1 AND id=$2")
            .bind(community).bind(id).execute(&mut **tx).await?;
    }
    Ok(id)
}

async fn record_exposure(
    tx: &mut Transaction<'_, Postgres>,
    community: Uuid,
    consultation: Uuid,
    source: &[u8],
    handed_off: bool,
) -> Result<()> {
    // Callers hold the live conversation lease. Only that active turn can write
    // an exposure; metadata in a model-produced reply is never trusted here.
    sqlx::query("INSERT INTO airhop_consultation_exposures(community_id,organization_id,consultation_id,turn_id,configuration,family_linked,handed_off)
        SELECT s.community_id,s.organization_id,s.id,t.id,
          t.configuration_snapshot - 'historySnapshotAt',t.family_id IS NOT NULL,$4
        FROM airhop_consultations s JOIN airhop_hermes_turn_receipts t
          ON t.community_id=s.community_id AND t.organization_id=s.organization_id AND t.conversation_id=s.conversation_id
        WHERE s.community_id=$1 AND s.id=$2 AND t.source_message_id=$3
          AND t.status='leased' AND t.lease_expires_at>now()
        ON CONFLICT(community_id,consultation_id,turn_id) DO UPDATE
          SET handed_off=airhop_consultation_exposures.handed_off OR EXCLUDED.handed_off")
        .bind(community).bind(consultation).bind(source).bind(handed_off)
        .execute(&mut **tx).await?;
    Ok(())
}

pub(super) async fn record_draft(
    tx: &mut Transaction<'_, Postgres>,
    community: Uuid,
    organization: Uuid,
    conversation: Uuid,
    source: &[u8],
    data: &ConversationBookingData,
    ready: bool,
) -> Result<()> {
    let id = ensure_session(tx, community, organization, conversation, source).await?;
    sqlx::query("UPDATE airhop_consultations SET group_selected_at=CASE WHEN $3 THEN COALESCE(group_selected_at,clock_timestamp()) ELSE group_selected_at END, time_selected_at=CASE WHEN $4 THEN COALESCE(time_selected_at,clock_timestamp()) ELSE time_selected_at END, details_complete_at=CASE WHEN $5 THEN COALESCE(details_complete_at,clock_timestamp()) ELSE details_complete_at END WHERE community_id=$1 AND id=$2")
        .bind(community).bind(id).bind(data.recurrence_rule_id.is_some())
        .bind(data.recurrence_rule_id.is_some() && data.original_date.is_some()).bind(ready)
        .execute(&mut **tx).await?;
    Ok(())
}

pub(super) async fn close_session(
    tx: &mut Transaction<'_, Postgres>,
    community: Uuid,
    conversation: Uuid,
    source: &[u8],
    reason: &str,
    booking: Option<Uuid>,
) -> Result<()> {
    sqlx::query("UPDATE airhop_consultations SET closed_at=clock_timestamp(),closed_reason=$4,closed_source_event_id=$3,booking_id=$5 WHERE community_id=$1 AND conversation_id=$2 AND closed_at IS NULL")
        .bind(community).bind(conversation).bind(source).bind(reason).bind(booking).execute(&mut **tx).await?;
    Ok(())
}

/// Parses at most one observation on the last external message of the batch.
/// Internal handoffs cannot masquerade as delivered parent questions.
pub(super) fn observation(events: &[Event]) -> Result<Option<(&Event, ConsultationProgress)>> {
    let external: Vec<_> = events
        .iter()
        .filter(|event| {
            !event.tags.iter().any(|tag| {
                tag.as_slice()
                    .first()
                    .is_some_and(|s| s == "airhop-handoff")
            })
        })
        .collect();
    let mut result = None;
    for event in events {
        for tag in event.tags.iter().filter(|tag| {
            tag.as_slice()
                .first()
                .is_some_and(|s| s == "airhop-consultation")
        }) {
            let parts = tag.as_slice();
            if parts.len() != 2
                || parts[1].len() > 2000
                || result.is_some()
                || external.last().map(|e| e.id) != Some(event.id)
            {
                return Err(DbError::InvalidData(
                    "consultation observation must occur once on the last parent reply".into(),
                ));
            }
            let progress: ConsultationProgress = serde_json::from_str(&parts[1])?;
            progress
                .validate()
                .map_err(|e| DbError::InvalidData(e.into()))?;
            result = Some((event, progress));
        }
    }
    Ok(result)
}

pub(super) async fn record_reply(
    tx: &mut Transaction<'_, Postgres>,
    community: Uuid,
    organization: Uuid,
    conversation: Uuid,
    source: &[u8],
    events: &[Event],
) -> Result<()> {
    let current: Option<Uuid> = sqlx::query_scalar("SELECT id FROM airhop_consultations WHERE community_id=$1 AND organization_id=$2 AND conversation_id=$3 AND (closed_at IS NULL OR closed_source_event_id=$4) ORDER BY started_at DESC,id DESC LIMIT 1")
        .bind(community).bind(organization).bind(conversation).bind(source).fetch_optional(&mut **tx).await?;
    if let Some(id) = current {
        let handed_off = events.iter().any(|event| {
            event.tags.iter().any(|tag| {
                tag.as_slice()
                    .first()
                    .is_some_and(|s| s == "airhop-handoff")
            })
        });
        record_exposure(tx, community, id, source, handed_off).await?;
    }
    let Some((event, progress)) = observation(events)? else {
        return Ok(());
    };
    if progress.purpose != ConsultationPurpose::Booking {
        return Ok(());
    }
    if progress.waiting_for == Some(ConsultationQuestion::Confirmation) {
        let exact_summary: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM airhop_conversation_booking_drafts WHERE community_id=$1 AND organization_id=$2 AND conversation_id=$3 AND state='ready' AND preview=$4)")
            .bind(community).bind(organization).bind(conversation).bind(&event.content).fetch_one(&mut **tx).await?;
        if !exact_summary {
            return Err(DbError::InvalidData(
                "confirmation observation requires the exact ready booking summary".into(),
            ));
        }
    }
    if let Some(quote) = &progress.declined_quote {
        let matches: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM airhop_gateway_inbound_receipts r JOIN events e ON e.community_id=r.community_id AND e.id=r.buzz_event_id JOIN airhop_external_conversations c ON c.community_id=r.community_id AND c.id=r.conversation_id WHERE r.community_id=$1 AND r.organization_id=$2 AND r.conversation_id=$3 AND r.buzz_event_id=$4 AND e.pubkey=c.parent_pubkey AND e.deleted_at IS NULL AND strpos(lower(e.content),lower($5))>0)")
            .bind(community).bind(organization).bind(conversation).bind(source).bind(quote.trim()).fetch_one(&mut **tx).await?;
        if !matches {
            return Err(DbError::InvalidData(
                "consultation refusal needs a quote from the current authenticated parent message"
                    .into(),
            ));
        }
    }
    // Informational acknowledgements after a completed enquiry don't start another.
    let id = if progress.waiting_for.is_some() || progress.declined_quote.is_some() {
        Some(ensure_session(tx, community, organization, conversation, source).await?)
    } else {
        sqlx::query_scalar("SELECT id FROM airhop_consultations WHERE community_id=$1 AND organization_id=$2 AND conversation_id=$3 ORDER BY started_at DESC,id DESC LIMIT 1")
            .bind(community).bind(organization).bind(conversation).fetch_optional(&mut **tx).await?
    };
    let Some(id) = id else {
        return Ok(());
    };
    let question = serde_json::to_value(progress.waiting_for)?;
    sqlx::query("INSERT INTO airhop_consultation_questions(community_id,organization_id,consultation_id,event_id,source_event_id,question) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING")
        .bind(community).bind(organization).bind(id).bind(event.id.as_bytes().as_slice()).bind(source)
        .bind(question.as_str()).execute(&mut **tx).await?;
    if progress.declined_quote.is_some() {
        close_session(tx, community, conversation, source, "declined", None).await?;
    }
    Ok(())
}

impl crate::Db {
    /// Consultation outcomes: staff channel-scoped details, or organization aggregates
    /// without conversation identities for the currently registered Analyst and Fizz.
    pub async fn get_airhop_consultation_analytics(
        &self,
        tenant: &buzz_core::TenantContext,
        actor: &[u8; 32],
        days: u16,
        yesterday: bool,
    ) -> Result<Value> {
        if !(1..=366).contains(&days) {
            return Err(DbError::InvalidData("invalid consultation period".into()));
        }
        let mut tx = self.pool.begin().await?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            .execute(&mut *tx)
            .await?;
        sqlx::query("SET LOCAL statement_timeout = '5s'")
            .execute(&mut *tx)
            .await?;
        let value = sqlx::query_scalar(include_str!("consultation/report.sql"))
            .bind(tenant.community().as_uuid())
            .bind(actor.as_slice())
            .bind(i32::from(days))
            .bind(i32::from(yesterday))
            .fetch_one(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(value)
    }
}
