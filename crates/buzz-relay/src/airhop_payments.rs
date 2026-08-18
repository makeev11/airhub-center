//! AirHub overdue-summary publication into a durable Buzz thread.

use std::sync::Arc;

use buzz_core::kind::KIND_STREAM_MESSAGE;
use buzz_core::TenantContext;
use buzz_db::airhop::payment_automation::{
    PendingOverdueSummary, PendingPaymentAction, PublishedPaymentAction,
};
use chrono::{DateTime, Duration, Utc};
use nostr::{Event, EventBuilder, Kind, Tag, Timestamp};
use tracing::{info, warn};

use crate::handlers::event::dispatch_persistent_event;
use crate::handlers::side_effects::emit_live_thread_summary;
use crate::state::AppState;

/// Publishes every retry-stable overdue snapshot currently reserved in the DB.
pub async fn publish_pending_overdue_summaries(state: &Arc<AppState>) -> anyhow::Result<usize> {
    let jobs = state.db.prepare_airhop_overdue_summaries().await?;
    let mut published = 0usize;
    let mut first_error = None;
    for job in jobs {
        match publish_one(state, &job).await {
            Ok(()) => published += 1,
            Err(error) => {
                warn!(
                    community_id = %job.community_id,
                    organization_id = %job.organization_id,
                    pending_id = %job.pending_id,
                    %error,
                    "AirHub overdue Buzz summary publication failed"
                );
                if first_error.is_none() {
                    first_error = Some(error);
                }
            }
        }
    }
    if let Some(error) = first_error {
        Err(error)
    } else {
        Ok(published)
    }
}

async fn publish_one(state: &Arc<AppState>, job: &PendingOverdueSummary) -> anyhow::Result<()> {
    let tenant = TenantContext::resolved(job.community_id, job.host.clone());
    let channel = state
        .db
        .get_channel(tenant.community(), job.channel_id)
        .await?;
    if channel.archived_at.is_some()
        || channel.deleted_at.is_some()
        || channel.channel_type != "stream"
    {
        anyhow::bail!("configured AirHub payments channel is not an active stream");
    }

    let (root_event_id, root_created_at) = if let (Some(root_id), Some(root_created_at)) =
        (&job.root_event_id, job.root_event_created_at)
    {
        if root_id.len() != 32 {
            anyhow::bail!("stored AirHub payment thread root has an invalid event id");
        }
        (root_id.clone(), root_created_at)
    } else {
        let created_at = job
            .created_at
            .checked_sub_signed(Duration::seconds(1))
            .unwrap_or(job.created_at);
        let event = build_root_event(state, job, created_at)?;
        persist_message(state, &tenant, job.channel_id, &event, None, None, 0).await?;
        (event.id.as_bytes().to_vec(), event_created_at(&event)?)
    };

    let reply = build_reply_event(state, job, &root_event_id)?;
    let summary_inserted = persist_message(
        state,
        &tenant,
        job.channel_id,
        &reply,
        Some((&root_event_id, root_created_at)),
        Some((&root_event_id, root_created_at)),
        1,
    )
    .await?;
    let action_events = job
        .actions
        .iter()
        .map(|action| build_payment_action_event(state, job, action, &root_event_id))
        .collect::<anyhow::Result<Vec<_>>>()?;
    let published_actions = job
        .actions
        .iter()
        .zip(&action_events)
        .map(|(action, event)| PublishedPaymentAction {
            payment_id: action.payment_id,
            payment_version: action.payment_version,
            event_id: event.id.as_bytes().to_vec(),
        })
        .collect::<Vec<_>>();
    if !published_actions.is_empty()
        && !state
            .db
            .reserve_airhop_payment_action_events(
                &tenant,
                job.organization_id,
                job.pending_id,
                &published_actions,
            )
            .await?
    {
        anyhow::bail!("AirHub payment card delivery reservation is no longer current");
    }
    let mut action_inserted = false;
    for event in &action_events {
        action_inserted |= persist_message(
            state,
            &tenant,
            job.channel_id,
            event,
            Some((&root_event_id, root_created_at)),
            Some((&root_event_id, root_created_at)),
            1,
        )
        .await?;
    }
    let completed = state
        .db
        .complete_airhop_overdue_summary(
            &tenant,
            job.organization_id,
            job.pending_id,
            &root_event_id,
            root_created_at,
            reply.id.as_bytes(),
            &published_actions,
        )
        .await?;
    if summary_inserted || action_inserted {
        emit_live_thread_summary(&tenant, state, job.channel_id, root_event_id.clone());
    }
    info!(
        organization_id = %job.organization_id,
        channel_id = %job.channel_id,
        summary_event_id = %reply.id,
        payment_cards = published_actions.len(),
        completed,
        "AirHub overdue Buzz summary published"
    );
    Ok(())
}

fn build_payment_action_event(
    state: &Arc<AppState>,
    job: &PendingOverdueSummary,
    action: &PendingPaymentAction,
    root_event_id: &[u8],
) -> anyhow::Result<Event> {
    let root_hex = hex::encode(root_event_id);
    let tags = vec![
        Tag::parse(["h", &job.channel_id.to_string()])?,
        Tag::parse(["e", &root_hex, "", "root"])?,
        Tag::parse(["e", &root_hex, "", "reply"])?,
        Tag::parse([
            "airhop-payment",
            &job.organization_id.to_string(),
            &action.payment_id.to_string(),
            &action.payment_version.to_string(),
        ])?,
    ];
    EventBuilder::new(Kind::from(KIND_STREAM_MESSAGE as u16), &action.content)
        .tags(tags)
        .custom_created_at(nostr_timestamp(job.created_at)?)
        .sign_with_keys(&state.relay_keypair)
        .map_err(Into::into)
}

fn build_root_event(
    state: &Arc<AppState>,
    job: &PendingOverdueSummary,
    created_at: DateTime<Utc>,
) -> anyhow::Result<Event> {
    let tags = vec![
        Tag::parse(["h", &job.channel_id.to_string()])?,
        Tag::parse(["airhop", "overdue-payments-root"])?,
        Tag::parse([
            "d",
            &format!("{}:{}", job.organization_id, job.period_start),
        ])?,
    ];
    EventBuilder::new(Kind::from(KIND_STREAM_MESSAGE as u16), &job.root_content)
        .tags(tags)
        .custom_created_at(nostr_timestamp(created_at)?)
        .sign_with_keys(&state.relay_keypair)
        .map_err(Into::into)
}

fn build_reply_event(
    state: &Arc<AppState>,
    job: &PendingOverdueSummary,
    root_event_id: &[u8],
) -> anyhow::Result<Event> {
    let root_hex = hex::encode(root_event_id);
    let tags = vec![
        Tag::parse(["h", &job.channel_id.to_string()])?,
        Tag::parse(["e", &root_hex, "", "root"])?,
        Tag::parse(["e", &root_hex, "", "reply"])?,
        Tag::parse(["airhop", "overdue-payments-summary"])?,
    ];
    EventBuilder::new(Kind::from(KIND_STREAM_MESSAGE as u16), &job.content)
        .tags(tags)
        .custom_created_at(nostr_timestamp(job.created_at)?)
        .sign_with_keys(&state.relay_keypair)
        .map_err(Into::into)
}

pub(crate) async fn persist_message(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    channel_id: uuid::Uuid,
    event: &Event,
    parent: Option<(&[u8], DateTime<Utc>)>,
    root: Option<(&[u8], DateTime<Utc>)>,
    depth: i32,
) -> anyhow::Result<bool> {
    let event_id = event.id.as_bytes().to_vec();
    let metadata = buzz_db::event::ThreadMetadataParams {
        event_id: &event_id,
        event_created_at: event_created_at(event)?,
        channel_id,
        parent_event_id: parent.map(|(id, _)| id),
        parent_event_created_at: parent.map(|(_, created_at)| created_at),
        root_event_id: root.map(|(id, _)| id),
        root_event_created_at: root.map(|(_, created_at)| created_at),
        depth,
        broadcast: false,
    };
    let (stored, inserted) = state
        .db
        .insert_event_with_thread_metadata(
            tenant.community(),
            event,
            Some(channel_id),
            Some(metadata),
        )
        .await?;
    if inserted {
        dispatch_persistent_event(
            tenant,
            state,
            &stored,
            KIND_STREAM_MESSAGE,
            &event.pubkey.to_hex(),
            None,
        )
        .await;
    }
    Ok(inserted)
}

pub(crate) fn nostr_timestamp(value: DateTime<Utc>) -> anyhow::Result<Timestamp> {
    let seconds = u64::try_from(value.timestamp())?;
    Ok(Timestamp::from(seconds))
}

pub(crate) fn event_created_at(event: &Event) -> anyhow::Result<DateTime<Utc>> {
    let seconds = i64::try_from(event.created_at.as_secs())?;
    DateTime::from_timestamp(seconds, 0)
        .ok_or_else(|| anyhow::anyhow!("AirHub Buzz event timestamp is invalid"))
}

#[cfg(test)]
mod tests {
    use buzz_core::CommunityId;
    use chrono::NaiveDate;
    use uuid::Uuid;

    use super::*;

    fn job() -> PendingOverdueSummary {
        PendingOverdueSummary {
            community_id: CommunityId::from_uuid(Uuid::new_v4()),
            host: "center.example".to_owned(),
            organization_id: Uuid::new_v4(),
            channel_id: Uuid::new_v4(),
            pending_id: Uuid::new_v4(),
            period_start: NaiveDate::from_ymd_opt(2026, 8, 1).unwrap(),
            root_content: "Overdue payments".to_owned(),
            content: "One changed snapshot".to_owned(),
            actions: vec![PendingPaymentAction {
                payment_id: Uuid::from_u128(4),
                payment_version: 2,
                content: "React ✅ to confirm".to_owned(),
            }],
            created_at: DateTime::from_timestamp(1_800_000_000, 0).unwrap(),
            root_event_id: None,
            root_event_created_at: None,
        }
    }

    #[test]
    fn retry_stable_inputs_produce_identical_event_ids() {
        let keys = nostr::Keys::generate();
        let job = job();
        let build = || {
            let tags = vec![
                Tag::parse(["h", &job.channel_id.to_string()]).unwrap(),
                Tag::parse(["airhop", "overdue-payments-summary"]).unwrap(),
            ];
            EventBuilder::new(Kind::from(KIND_STREAM_MESSAGE as u16), &job.content)
                .tags(tags)
                .custom_created_at(nostr_timestamp(job.created_at).unwrap())
                .sign_with_keys(&keys)
                .unwrap()
        };
        assert_eq!(build().id, build().id);
    }

    #[test]
    fn payment_card_binds_organization_payment_and_version() {
        let state_keys = nostr::Keys::generate();
        let job = job();
        let root_id = [9_u8; 32];
        let root_hex = hex::encode(root_id);
        let tags = vec![
            Tag::parse(["h", &job.channel_id.to_string()]).unwrap(),
            Tag::parse(["e", &root_hex, "", "root"]).unwrap(),
            Tag::parse(["e", &root_hex, "", "reply"]).unwrap(),
            Tag::parse([
                "airhop-payment",
                &job.organization_id.to_string(),
                &job.actions[0].payment_id.to_string(),
                &job.actions[0].payment_version.to_string(),
            ])
            .unwrap(),
        ];
        let event = EventBuilder::new(
            Kind::from(KIND_STREAM_MESSAGE as u16),
            &job.actions[0].content,
        )
        .tags(tags)
        .custom_created_at(nostr_timestamp(job.created_at).unwrap())
        .sign_with_keys(&state_keys)
        .unwrap();
        assert!(event.tags.iter().any(|tag| {
            let parts = tag.as_slice();
            parts.len() == 4
                && parts[0] == "airhop-payment"
                && parts[1] == job.organization_id.to_string()
                && parts[2] == job.actions[0].payment_id.to_string()
                && parts[3] == "2"
        }));
    }
}
