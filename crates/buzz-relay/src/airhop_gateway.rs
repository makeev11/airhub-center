//! Crash recovery for committed Hermes events before provider delivery.

use std::sync::Arc;

use buzz_core::TenantContext;
use nostr::PublicKey;
use tracing::{info, warn};

use crate::handlers::ingest::{IngestAuth, IngestError};
use crate::state::AppState;

/// Replays due committed Hermes intents through the ordinary Buzz ingestion
/// pipeline. Provider delivery is a separate lease owned by Channel Gateway.
pub async fn recover_pending_hermes_publications(
    state: &Arc<AppState>,
    batch_limit: i64,
) -> anyhow::Result<usize> {
    // Routing notices are committed with their metadata change, then dispatched
    // through the ordinary Buzz event fan-out. Recovery never sends them externally.
    state
        .db
        .prepare_client_inbound_notifications(&state.relay_keypair)
        .await?;
    for notice in state.db.pending_client_notifications().await? {
        let tenant = TenantContext::resolved(notice.community_id, notice.host);
        if let Some(stored) = state
            .db
            .get_event_by_id(tenant.community(), &notice.event_id)
            .await?
        {
            let dispatched = crate::handlers::event::dispatch_stored_recovery_event(
                &tenant,
                state,
                &stored,
                buzz_core::kind::KIND_STREAM_MESSAGE,
                &stored.event.pubkey.to_hex(),
                None,
            )
            .await;
            if !dispatched {
                continue;
            }
            if let Some(channel_id) = stored.channel_id {
                let root = stored
                    .event
                    .tags
                    .iter()
                    .find_map(|tag| {
                        let parts = tag.as_slice();
                        (parts.len() >= 4 && parts[0] == "e" && parts[3] == "root")
                            .then(|| hex::decode(&parts[1]).ok())
                            .flatten()
                    })
                    .unwrap_or_else(|| notice.event_id.clone());
                crate::handlers::side_effects::emit_live_thread_summary(
                    &tenant, state, channel_id, root,
                );
            }
            if let Some(channel) = notice.archived_channel_id {
                crate::handlers::side_effects::emit_group_discovery_events(&tenant, state, channel)
                    .await?;
            }
            state
                .db
                .complete_client_notification(tenant.community(), &notice.event_id)
                .await?;
        }
    }
    let jobs = state
        .db
        .prepare_airhop_hermes_publication_recovery(batch_limit)
        .await?;
    let mut published = 0usize;
    for job in jobs {
        let event_id = *job.event.id.as_bytes();
        let agent = match PublicKey::from_slice(&job.agent_pubkey) {
            Ok(agent) if agent == job.event.pubkey => agent,
            _ => {
                state
                    .db
                    .record_airhop_hermes_publication_failure(
                        job.community_id,
                        event_id,
                        "stored_agent_mismatch",
                    )
                    .await?;
                continue;
            }
        };
        let tenant = TenantContext::resolved(job.community_id, job.host);
        match crate::handlers::ingest::ingest_event(
            state,
            &tenant,
            job.event,
            IngestAuth::HermesRecovery {
                pubkey: agent,
                scopes: vec![buzz_auth::Scope::MessagesWrite],
            },
        )
        .await
        {
            Ok(_) => published += 1,
            Err(error) => {
                let error_code = publication_error_code(&error);
                warn!(
                    community_id = %tenant.community(),
                    event_id = %hex::encode(event_id),
                    error = ?error,
                    "AirHop Hermes Buzz publication recovery failed"
                );
                state
                    .db
                    .record_airhop_hermes_publication_failure(
                        tenant.community(),
                        event_id,
                        error_code,
                    )
                    .await?;
            }
        }
    }
    if published > 0 {
        info!(published, "AirHop Hermes committed publications recovered");
    }
    Ok(published)
}

fn publication_error_code(error: &IngestError) -> &'static str {
    match error {
        IngestError::Rejected(_) => "ingest_rejected",
        IngestError::AuthFailed(_) => "ingest_unauthorized",
        IngestError::Internal(_) => "ingest_internal",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn publication_failures_have_bounded_stable_codes() {
        assert_eq!(
            publication_error_code(&IngestError::Rejected("event text".to_owned())),
            "ingest_rejected"
        );
        assert_eq!(
            publication_error_code(&IngestError::Internal("database url".to_owned())),
            "ingest_internal"
        );
    }
}
