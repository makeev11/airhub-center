//! AirHub monthly analytics publication into a dedicated Buzz thread.

use std::sync::Arc;

use buzz_core::kind::KIND_STREAM_MESSAGE;
use buzz_core::TenantContext;
use buzz_db::airhop::analytics_report::PendingAnalyticsReport;
use chrono::{Duration, Utc};
use nostr::{Event, EventBuilder, Kind, Tag};
use tracing::{info, warn};

use crate::airhop_payments::{event_created_at, nostr_timestamp, persist_message};
use crate::handlers::side_effects::emit_live_thread_summary;
use crate::state::AppState;

/// Publishes every retry-stable analytics snapshot currently reserved in the DB.
pub async fn publish_pending_analytics_reports(state: &Arc<AppState>) -> anyhow::Result<usize> {
    let jobs = state.db.prepare_airhop_analytics_reports().await?;
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
                    "AirHub analytics Buzz report publication failed"
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

async fn publish_one(state: &Arc<AppState>, job: &PendingAnalyticsReport) -> anyhow::Result<()> {
    let tenant = TenantContext::resolved(job.community_id, job.host.clone());
    let channel = state
        .db
        .get_channel(tenant.community(), job.channel_id)
        .await?;
    if channel.archived_at.is_some()
        || channel.deleted_at.is_some()
        || channel.channel_type != "stream"
    {
        anyhow::bail!("configured AirHub analytics channel is not an active stream");
    }

    let (root_event_id, root_created_at) = if let (Some(root_id), Some(root_created_at)) =
        (&job.root_event_id, job.root_event_created_at)
    {
        if root_id.len() != 32 {
            anyhow::bail!("stored AirHub analytics thread root has an invalid event id");
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

    let report = build_report_event(state, job, &root_event_id)?;
    let inserted = persist_message(
        state,
        &tenant,
        job.channel_id,
        &report,
        Some((&root_event_id, root_created_at)),
        Some((&root_event_id, root_created_at)),
        1,
    )
    .await?;
    let completed = state
        .db
        .complete_airhop_analytics_report(
            &tenant,
            job.organization_id,
            job.pending_id,
            &root_event_id,
            root_created_at,
            report.id.as_bytes(),
        )
        .await?;
    if inserted {
        emit_live_thread_summary(&tenant, state, job.channel_id, root_event_id);
    }
    info!(
        organization_id = %job.organization_id,
        channel_id = %job.channel_id,
        report_event_id = %report.id,
        completed,
        "AirHub analytics Buzz report published"
    );
    Ok(())
}

fn build_root_event(
    state: &Arc<AppState>,
    job: &PendingAnalyticsReport,
    created_at: chrono::DateTime<Utc>,
) -> anyhow::Result<Event> {
    let tags = vec![
        Tag::parse(["h", &job.channel_id.to_string()])?,
        Tag::parse(["airhop", "analytics-report-root"])?,
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

fn build_report_event(
    state: &Arc<AppState>,
    job: &PendingAnalyticsReport,
    root_event_id: &[u8],
) -> anyhow::Result<Event> {
    let root_hex = hex::encode(root_event_id);
    let tags = vec![
        Tag::parse(["h", &job.channel_id.to_string()])?,
        Tag::parse(["e", &root_hex, "", "root"])?,
        Tag::parse(["e", &root_hex, "", "reply"])?,
        Tag::parse(["airhop", "analytics-report-snapshot"])?,
    ];
    EventBuilder::new(Kind::from(KIND_STREAM_MESSAGE as u16), &job.content)
        .tags(tags)
        .custom_created_at(nostr_timestamp(job.created_at)?)
        .sign_with_keys(&state.relay_keypair)
        .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use buzz_core::CommunityId;
    use chrono::{DateTime, NaiveDate};
    use uuid::Uuid;

    use super::*;

    fn job() -> PendingAnalyticsReport {
        PendingAnalyticsReport {
            community_id: CommunityId::from_uuid(Uuid::new_v4()),
            host: "center.example".to_owned(),
            organization_id: Uuid::new_v4(),
            channel_id: Uuid::new_v4(),
            pending_id: Uuid::new_v4(),
            period_start: NaiveDate::from_ymd_opt(2026, 8, 1).expect("date"),
            root_content: "Analytics root".to_owned(),
            content: "Analytics snapshot".to_owned(),
            created_at: DateTime::from_timestamp(1_800_000_000, 0).expect("timestamp"),
            root_event_id: None,
            root_event_created_at: None,
        }
    }

    #[test]
    fn retry_stable_snapshot_inputs_produce_identical_event_ids() {
        let keys = nostr::Keys::generate();
        let job = job();
        let root_id = [9_u8; 32];
        let build = || {
            let root_hex = hex::encode(root_id);
            let tags = vec![
                Tag::parse(["h", &job.channel_id.to_string()]).expect("h tag"),
                Tag::parse(["e", &root_hex, "", "root"]).expect("root tag"),
                Tag::parse(["e", &root_hex, "", "reply"]).expect("reply tag"),
                Tag::parse(["airhop", "analytics-report-snapshot"]).expect("report tag"),
            ];
            EventBuilder::new(Kind::from(KIND_STREAM_MESSAGE as u16), &job.content)
                .tags(tags)
                .custom_created_at(nostr_timestamp(job.created_at).expect("timestamp"))
                .sign_with_keys(&keys)
                .expect("signed event")
        };
        let first = build();
        let second = build();
        assert_eq!(first.id, second.id);
        assert!(first.tags.iter().any(|tag| {
            let parts = tag.as_slice();
            parts == ["airhop", "analytics-report-snapshot"]
        }));
    }
}
