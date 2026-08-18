/// NIP-42 authentication handler.
pub mod auth;
/// Subscription close (CLOSE) handler.
pub mod close;
/// Command executor — transactional processing for command kinds.
pub mod command_executor;
/// Relay-operator community provisioning HTTP support.
pub mod community_provisioning;
/// NIP-45 COUNT handler.
pub mod count;
/// EVENT handler — WS dispatcher → ingest pipeline → fan-out.
pub mod event;
/// NIP-IA identity archive request handler (kinds 9035–9036).
pub mod identity_archive;
/// imeta tag validation helpers.
pub mod imeta;
/// Transport-neutral event ingestion pipeline.
pub mod ingest;
/// Community moderation authorization seam (capability helper).
pub mod moderation_authz;
/// Community moderation command handler (kinds 9040–9044).
pub mod moderation_commands;
/// Relay-signed moderation notice DMs.
pub mod moderation_notices;
/// Product-feedback validation + deployment sidecar persistence.
pub mod product_feedback;
#[allow(dead_code, missing_docs)]
pub mod push_lease;
/// NIP-43 relay membership admin command handler (kinds 9030–9032).
pub mod relay_admin;
/// NIP-56 report (kind:1984) validation + moderation queue persistence.
pub mod report;
/// REQ handler — subscribe, deliver historical events, then EOSE.
pub mod req;
/// NIP-29 and NIP-25 side-effect handlers.
pub mod side_effects;

/// Extract an optional TTL (in seconds) from a Nostr event's `ttl` tag,
/// applying the server-side override when configured.
///
/// Returns `None` when the event carries no `ttl` tag — the channel is permanent.
pub fn resolve_ttl(event: &nostr::Event, ephemeral_ttl_override: Option<i32>) -> Option<i32> {
    let from_tag: Option<i32> = event.tags.iter().find_map(|t| {
        if t.kind().to_string() == "ttl" {
            t.content().and_then(|s| s.parse::<i32>().ok())
        } else {
            None
        }
    });

    match (from_tag, ephemeral_ttl_override) {
        (Some(original), Some(ovr)) => {
            tracing::debug!(
                original,
                override_val = ovr,
                "Applying BUZZ_EPHEMERAL_TTL_OVERRIDE"
            );
            Some(ovr)
        }
        (ttl, _) => ttl,
    }
}

/// Relay lifecycle seam that can mutate Airhop Welcome turn state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AirhopWelcomeTurnProjection {
    /// Durable kind-9 agent answer or question, projected after insert.
    Stored,
    /// Ephemeral Fizz delegation, projected before channel fan-out.
    Ephemeral,
}

/// Classifies only the two trusted Airhop Welcome protocol event kinds.
pub(crate) const fn airhop_welcome_turn_projection(
    kind: u32,
) -> Option<AirhopWelcomeTurnProjection> {
    match kind {
        buzz_core::kind::KIND_STREAM_MESSAGE => Some(AirhopWelcomeTurnProjection::Stored),
        buzz_core::kind::KIND_AIRHOP_AGENT_TASK => Some(AirhopWelcomeTurnProjection::Ephemeral),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn welcome_turn_state_projection_selects_only_agent_protocol_events() {
        assert_eq!(
            airhop_welcome_turn_projection(buzz_core::kind::KIND_STREAM_MESSAGE),
            Some(AirhopWelcomeTurnProjection::Stored),
        );
        assert_eq!(
            airhop_welcome_turn_projection(buzz_core::kind::KIND_AIRHOP_AGENT_TASK),
            Some(AirhopWelcomeTurnProjection::Ephemeral),
        );
        assert_eq!(airhop_welcome_turn_projection(1), None);
        assert_eq!(
            airhop_welcome_turn_projection(buzz_core::kind::KIND_REACTION),
            None,
        );
    }
}
