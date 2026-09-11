//! Authoritative profile for relay-signed AirHop service messages.

use std::sync::Arc;

use buzz_core::{kind::KIND_PROFILE, TenantContext};
use nostr::{Event, EventBuilder, Keys, Kind};

use crate::handlers::event::dispatch_persistent_event;
use crate::state::AppState;

fn build_profile(keys: &Keys) -> anyhow::Result<Event> {
    Ok(EventBuilder::new(
        Kind::Metadata,
        serde_json::json!({
            "name": "airhop-center",
            "display_name": "AirHop Center",
            "about": "Service notifications and confirmation previews. Not a human or an AI agent.",
        })
        .to_string(),
    )
    .sign_with_keys(keys)?)
}

pub(super) async fn ensure(state: &Arc<AppState>, tenant: &TenantContext) -> anyhow::Result<()> {
    let profile = build_profile(&state.relay_keypair)?;
    let existing = state
        .db
        .query_events(&buzz_db::event::EventQuery {
            kinds: Some(vec![KIND_PROFILE as i32]),
            authors: Some(vec![profile.pubkey.to_bytes().to_vec()]),
            limit: Some(1),
            ..buzz_db::event::EventQuery::for_community(tenant.community())
        })
        .await?;
    if existing
        .iter()
        .any(|stored| stored.event.content == profile.content)
    {
        return Ok(());
    }
    let (stored, inserted) = state
        .db
        .replace_addressable_event(tenant.community(), &profile, None)
        .await?;
    if inserted {
        dispatch_persistent_event(
            tenant,
            state,
            &stored,
            KIND_PROFILE,
            &profile.pubkey.to_hex(),
            None,
        )
        .await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_profile_uses_real_signer_and_does_not_impersonate_an_agent() {
        let keys = Keys::generate();
        let event = build_profile(&keys).expect("signed service profile");
        assert_eq!(event.pubkey, keys.public_key());
        assert_eq!(event.kind, Kind::Metadata);
        event.verify().expect("valid service signature");
        let content: serde_json::Value = serde_json::from_str(&event.content).expect("metadata");
        assert_eq!(content["display_name"], "AirHop Center");
        assert!(content.get("bot").is_none());
    }
}
