//! Delivery of configured internal duties through the normal Buzz event store.

use crate::{
    airhop_payments::{nostr_timestamp, persist_message},
    state::AppState,
};
use buzz_core::{kind::KIND_STREAM_MESSAGE, TenantContext};
use chrono::Utc;
use nostr::{EventBuilder, Kind, Tag};
use std::sync::Arc;

/// Publishes each due role digest once; partial failures retain durable retry inputs.
pub async fn publish_pending_agent_notices(state: &Arc<AppState>) -> anyhow::Result<usize> {
    let jobs = state.db.prepare_airhop_agent_notices(Utc::now()).await?;
    let mut count = 0;
    for job in jobs {
        let result = async {
            let Some(mut guard) = state.db.lock_airhop_agent_notice(&job).await? else {
                return Ok::<bool, anyhow::Error>(false);
            };
            let tenant = TenantContext::resolved(job.community_id, job.host.clone());
            let event = EventBuilder::new(Kind::from(KIND_STREAM_MESSAGE as u16), &job.content)
                .tags([
                    Tag::parse(["h", &job.channel_id.to_string()])?,
                    Tag::parse(["airhop-agent-notice", &job.role, &job.id.to_string()])?,
                ])
                .custom_created_at(nostr_timestamp(job.created_at)?)
                .sign_with_keys(&state.relay_keypair)?;
            let inserted =
                persist_message(state, &tenant, job.channel_id, &event, None, None, 0).await?;
            sqlx::query(
                "UPDATE airhop_agent_notice_jobs
                 SET status='published',event_id=$3,published_at=now()
                 WHERE community_id=$1 AND id=$2 AND status='pending'",
            )
            .bind(job.community_id.as_uuid())
            .bind(job.id)
            .bind(event.id.as_bytes().as_slice())
            .execute(guard.as_mut())
            .await?;
            guard.commit().await?;
            Ok(inserted)
        }
        .await;
        match result {
            Ok(true) => count += 1,
            Ok(false) => {}
            Err(error) => tracing::warn!(id=%job.id,%error,"agent duty publication failed"),
        }
    }
    Ok(count)
}
