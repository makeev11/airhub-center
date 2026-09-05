//! Airhop Welcome one-responder route gate.

use std::collections::{BTreeMap, HashSet};
use std::future::Future;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Mutex;

use nostr::Event;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::queue::FlushBatch;
use crate::relay::{BuzzEvent, RelayError, RestClient};

/// Stable product role carried by managed-agent environment and relay APIs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AirhopRole {
    Fizz,
    Administrator,
    Analyst,
    ContentMarketer,
    ParentAdministrator,
}

impl AirhopRole {
    pub(crate) fn parse_config(value: &str) -> Result<Self, String> {
        match value.trim() {
            "fizz" => Ok(Self::Fizz),
            "administrator" => Ok(Self::Administrator),
            "analyst" => Ok(Self::Analyst),
            "content_marketer" => Ok(Self::ContentMarketer),
            "parent_administrator" => Ok(Self::ParentAdministrator),
            other => Err(format!("unknown Airhop role: {other}")),
        }
    }

    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Fizz => "fizz",
            Self::Administrator => "administrator",
            Self::Analyst => "analyst",
            Self::ContentMarketer => "content_marketer",
            Self::ParentAdministrator => "parent_administrator",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WelcomeRouteDecision {
    pub event_id: String,
    pub channel_id: Uuid,
    pub target_role: AirhopRole,
    pub target_pubkey: String,
    pub reason: String,
    pub replayed: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WelcomeManifest {
    channel_id: Uuid,
    members: BTreeMap<AirhopRole, String>,
}

/// Pre-queue outcome. Drop and DropDuplicate both stop before EventQueue::push.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RouteGate {
    Accept,
    Drop,
    DropDuplicate,
    Bypass,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParentClaimResponse {
    token: String,
}

/// Dispatch-time hosted supervisor gate for the parent-facing Hermes role.
/// The token file is visible to AirHop MCP only, never to the model process.
pub(crate) struct ParentSupervisorGate {
    enabled: bool,
    context_file: Option<PathBuf>,
    client: RestClient,
}

impl ParentSupervisorGate {
    pub(crate) fn new(
        role: Option<AirhopRole>,
        context_file: Option<PathBuf>,
        client: RestClient,
    ) -> Self {
        Self {
            enabled: role == Some(AirhopRole::ParentAdministrator) && context_file.is_some(),
            context_file,
            client,
        }
    }

    /// Claims the newest triggerable event in a coalesced batch. Receipts prove
    /// that it is current parent input or an explicit authorized staff resume;
    /// all other staff/internal events fail closed.
    pub(crate) async fn claim_batch(&self, batch: &FlushBatch) -> bool {
        if !self.enabled {
            return true;
        }
        let source_event_ids = parent_batch_source_ids(batch);
        let Some(event_id) = source_event_ids.first() else {
            return false;
        };
        let input_batch_id = deterministic_batch_id(batch);
        let path = format!("/api/airhop/agents/v1/supervisor/events/{event_id}/claim");
        let response = self
            .client
            .post_json(
                &path,
                &serde_json::json!({
                    "inputBatchId": input_batch_id,
                    "sourceEventIds": source_event_ids,
                    "leaseSeconds": 600,
                    "ttlSeconds": 300,
                }),
            )
            .await
            .and_then(|value| serde_json::from_value(value).map_err(RelayError::Json));
        match response {
            Ok(ParentClaimResponse { token }) => {
                let Some(path) = self.context_file.as_deref() else {
                    return false;
                };
                match write_context_grant(path, &token) {
                    Ok(()) => true,
                    Err(error) => {
                        tracing::error!(
                            event_id,
                            error = %error,
                            "AirHop supervisor could not hand context to MCP"
                        );
                        false
                    }
                }
            }
            Err(error) => {
                tracing::debug!(
                    event_id,
                    error = %bounded_error(&error),
                    "AirHop supervisor dropped non-triggerable event batch"
                );
                false
            }
        }
    }
}

fn parent_batch_source_ids(batch: &FlushBatch) -> Vec<String> {
    let mut seen = HashSet::new();
    batch
        .events
        .iter()
        .rev()
        .chain(batch.cancelled_events.iter().rev())
        .map(|source| source.event.id.to_hex())
        .filter(|id| seen.insert(id.clone()))
        .collect()
}

fn deterministic_batch_id(batch: &FlushBatch) -> Uuid {
    let mut hasher = Sha256::new();
    hasher.update(b"airhop.hermes.input-batch.v1");
    hasher.update(batch.channel_id.as_bytes());
    for event in batch.cancelled_events.iter().chain(&batch.events) {
        hasher.update(event.event.id.as_bytes());
    }
    let digest = hasher.finalize();
    let mut bytes = [0_u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Uuid::from_bytes(bytes)
}

fn write_context_grant(path: &Path, token: &str) -> std::io::Result<()> {
    if token.trim().is_empty() || token.len() > 24_000 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "context grant is empty or oversized",
        ));
    }
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "context path has no parent",
        )
    })?;
    std::fs::create_dir_all(parent)?;
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("context"),
        Uuid::new_v4()
    ));
    let mut options = std::fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary)?;
    file.write_all(token.trim().as_bytes())?;
    file.sync_all()?;
    drop(file);
    if let Err(error) = std::fs::rename(&temporary, path) {
        let _ = std::fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(())
}

type ClientFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, RelayError>> + Send + 'a>>;

pub(crate) trait AirhopRouteClient: Send + Sync {
    fn claim<'a>(&'a self, event_id: &'a str) -> ClientFuture<'a, WelcomeRouteDecision>;
    fn manifest(&self) -> ClientFuture<'_, WelcomeManifest>;
}

impl AirhopRouteClient for RestClient {
    fn claim<'a>(&'a self, event_id: &'a str) -> ClientFuture<'a, WelcomeRouteDecision> {
        Box::pin(async move {
            let path = format!("/api/airhop/agents/v1/routes/{event_id}/claim");
            let value = self.post_empty_json(&path).await?;
            serde_json::from_value(value).map_err(RelayError::Json)
        })
    }

    fn manifest(&self) -> ClientFuture<'_, WelcomeManifest> {
        Box::pin(async move {
            let value = self.get_json("/api/airhop/agents/v1/welcome-team").await?;
            serde_json::from_value(value).map_err(RelayError::Json)
        })
    }
}

/// Atomic server claim plus process-local replay protection for one agent.
pub(crate) struct WelcomeRouteGate<C = RestClient> {
    enabled: bool,
    flat_channel_ids: HashSet<Uuid>,
    role: Option<AirhopRole>,
    agent_pubkey: String,
    owner_pubkey: Option<String>,
    client: C,
    seen: Mutex<HashSet<String>>,
    manifest: Mutex<Option<WelcomeManifest>>,
}

impl<C: AirhopRouteClient> WelcomeRouteGate<C> {
    pub(crate) fn new(
        enabled: bool,
        flat_channel_ids: HashSet<Uuid>,
        role: Option<AirhopRole>,
        agent_pubkey: String,
        owner_pubkey: Option<String>,
        client: C,
    ) -> Self {
        Self {
            enabled,
            flat_channel_ids,
            role,
            agent_pubkey: agent_pubkey.to_ascii_lowercase(),
            owner_pubkey: owner_pubkey.map(|value| value.to_ascii_lowercase()),
            client,
            seen: Mutex::new(HashSet::new()),
            manifest: Mutex::new(None),
        }
    }

    pub(crate) async fn evaluate(&self, event: &BuzzEvent) -> RouteGate {
        if !self.enabled || !self.flat_channel_ids.contains(&event.channel_id) {
            return RouteGate::Bypass;
        }

        let event_id = event.event.id.to_hex();
        if self.was_seen(&event_id) {
            return RouteGate::DropDuplicate;
        }

        if is_kickoff_task(&event.event) {
            return self.evaluate_kickoff(event, &event_id).await;
        }
        if has_tag(&event.event, "airhop-handoff", None) {
            return self.evaluate_handoff(event, &event_id).await;
        }

        match self.client.claim(&event_id).await {
            Ok(decision)
                if !decision.event_id.eq_ignore_ascii_case(&event_id)
                    || decision.channel_id != event.channel_id =>
            {
                tracing::warn!(event_id = %event_id, "Airhop Welcome route response mismatch");
                RouteGate::Drop
            }
            Ok(decision)
                if decision
                    .target_pubkey
                    .eq_ignore_ascii_case(&self.agent_pubkey)
                    && self.role == Some(decision.target_role) =>
            {
                tracing::debug!(
                    event_id = %event_id,
                    role = %decision.target_role.as_str(),
                    reason = %decision.reason,
                    replayed = decision.replayed,
                    "Airhop Welcome route accepted"
                );
                self.accept_once(event_id)
            }
            Ok(decision) => {
                tracing::debug!(
                    event_id = %event_id,
                    target = %decision.target_role.as_str(),
                    "Airhop Welcome route assigned to another agent"
                );
                RouteGate::Drop
            }
            Err(error) => {
                tracing::warn!(
                    event_id = %event_id,
                    error = %bounded_error(&error),
                    "Airhop Welcome route claim failed closed"
                );
                RouteGate::Drop
            }
        }
    }

    async fn evaluate_kickoff(&self, event: &BuzzEvent, event_id: &str) -> RouteGate {
        let Some(owner) = self.owner_pubkey.as_deref() else {
            return RouteGate::Drop;
        };
        if !event.event.pubkey.to_hex().eq_ignore_ascii_case(owner)
            || !targets_pubkey(&event.event, &self.agent_pubkey)
            || !has_channel_tag(&event.event, event.channel_id)
        {
            return RouteGate::Drop;
        }
        match self.registered_manifest().await {
            Ok(manifest) if self.matches_registered_member(&manifest, event.channel_id) => {
                self.accept_once(event_id.to_owned())
            }
            Ok(_) => RouteGate::Drop,
            Err(error) => {
                tracing::warn!(
                    event_id,
                    error = %bounded_error(&error),
                    "Airhop kickoff manifest check failed closed"
                );
                RouteGate::Drop
            }
        }
    }

    async fn evaluate_handoff(&self, event: &BuzzEvent, event_id: &str) -> RouteGate {
        if !targets_pubkey(&event.event, &self.agent_pubkey)
            || !has_channel_tag(&event.event, event.channel_id)
            || self
                .role
                .is_none_or(|role| !has_tag(&event.event, "airhop-handoff", Some(role.as_str())))
        {
            return RouteGate::Drop;
        }
        match self.registered_manifest().await {
            Ok(manifest)
                if self.matches_registered_member(&manifest, event.channel_id)
                    && manifest.members.get(&AirhopRole::Fizz).is_some_and(|fizz| {
                        event.event.pubkey.to_hex().eq_ignore_ascii_case(fizz)
                    }) =>
            {
                self.accept_once(event_id.to_owned())
            }
            Ok(_) => RouteGate::Drop,
            Err(error) => {
                tracing::warn!(
                    event_id,
                    error = %bounded_error(&error),
                    "Airhop handoff manifest check failed closed"
                );
                RouteGate::Drop
            }
        }
    }

    async fn registered_manifest(&self) -> Result<WelcomeManifest, RelayError> {
        if let Some(manifest) = self.manifest.lock().ok().and_then(|value| value.clone()) {
            return Ok(manifest);
        }
        let manifest = self.client.manifest().await?;
        if let Ok(mut cached) = self.manifest.lock() {
            *cached = Some(manifest.clone());
        }
        Ok(manifest)
    }

    fn matches_registered_member(&self, manifest: &WelcomeManifest, channel_id: Uuid) -> bool {
        self.role.is_some_and(|role| {
            manifest.channel_id == channel_id
                && manifest
                    .members
                    .get(&role)
                    .is_some_and(|pubkey| pubkey.eq_ignore_ascii_case(&self.agent_pubkey))
        })
    }

    fn was_seen(&self, event_id: &str) -> bool {
        self.seen.lock().is_ok_and(|seen| seen.contains(event_id))
    }

    fn accept_once(&self, event_id: String) -> RouteGate {
        match self.seen.lock() {
            Ok(mut seen) => {
                if seen.insert(event_id) {
                    RouteGate::Accept
                } else {
                    RouteGate::DropDuplicate
                }
            }
            Err(_) => RouteGate::Drop,
        }
    }
}

fn is_kickoff_task(event: &Event) -> bool {
    u32::from(event.kind.as_u16()) == buzz_core::kind::KIND_AIRHOP_AGENT_TASK
        && has_tag(event, "airhop-task", None)
        && has_tag(event, "airhop-kickoff-stage", None)
}

fn targets_pubkey(event: &Event, pubkey: &str) -> bool {
    has_tag(event, "p", Some(pubkey))
}

fn has_channel_tag(event: &Event, channel_id: Uuid) -> bool {
    has_tag(event, "h", Some(&channel_id.to_string()))
}

fn has_tag(event: &Event, name: &str, value: Option<&str>) -> bool {
    event.tags.iter().any(|tag| {
        let parts = tag.as_slice();
        parts.first().is_some_and(|part| part == name)
            && value.is_none_or(|expected| {
                parts
                    .get(1)
                    .is_some_and(|actual| actual.eq_ignore_ascii_case(expected))
            })
    })
}

fn bounded_error(error: &RelayError) -> String {
    error.to_string().chars().take(240).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::{EventBuilder, Keys, Kind, Tag};
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct FakeClient {
        decision: WelcomeRouteDecision,
        claims: AtomicUsize,
        fail: bool,
        manifest: Option<WelcomeManifest>,
    }

    impl AirhopRouteClient for FakeClient {
        fn claim<'a>(&'a self, event_id: &'a str) -> ClientFuture<'a, WelcomeRouteDecision> {
            self.claims.fetch_add(1, Ordering::SeqCst);
            let mut decision = self.decision.clone();
            decision.event_id = event_id.to_owned();
            let fail = self.fail;
            Box::pin(async move {
                if fail {
                    Err(RelayError::Http("route unavailable".to_owned()))
                } else {
                    Ok(decision)
                }
            })
        }

        fn manifest(&self) -> ClientFuture<'_, WelcomeManifest> {
            let manifest = self.manifest.clone();
            Box::pin(async move {
                manifest.ok_or_else(|| RelayError::Http("unused manifest".to_owned()))
            })
        }
    }

    fn event(channel_id: Uuid) -> BuzzEvent {
        let keys = Keys::generate();
        let tag = Tag::parse(["h", &channel_id.to_string()]).unwrap();
        BuzzEvent {
            channel_id,
            event: EventBuilder::new(Kind::Custom(9), "Администратор, проверь")
                .tags([tag])
                .sign_with_keys(&keys)
                .unwrap(),
        }
    }

    fn gate(
        channel_id: Uuid,
        agent_pubkey: &str,
        target_pubkey: &str,
        fail: bool,
    ) -> WelcomeRouteGate<FakeClient> {
        WelcomeRouteGate::new(
            true,
            HashSet::from([channel_id]),
            Some(AirhopRole::Administrator),
            agent_pubkey.to_owned(),
            None,
            FakeClient {
                decision: WelcomeRouteDecision {
                    event_id: "ab".repeat(32),
                    channel_id,
                    target_role: AirhopRole::Administrator,
                    target_pubkey: target_pubkey.to_owned(),
                    reason: "natural_role".to_owned(),
                    replayed: true,
                },
                claims: AtomicUsize::new(0),
                fail,
                manifest: None,
            },
        )
    }

    #[tokio::test]
    async fn accepts_only_the_target_and_drops_local_replay() {
        let channel_id = Uuid::new_v4();
        let admin = "aa".repeat(32);
        let fizz = "bb".repeat(32);
        let input = event(channel_id);
        let admin_gate = gate(channel_id, &admin, &admin, false);
        let fizz_gate = gate(channel_id, &fizz, &admin, false);

        assert_eq!(admin_gate.evaluate(&input).await, RouteGate::Accept);
        assert_eq!(fizz_gate.evaluate(&input).await, RouteGate::Drop);
        assert_eq!(admin_gate.evaluate(&input).await, RouteGate::DropDuplicate);
        assert_eq!(admin_gate.client.claims.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn bypasses_non_welcome_and_fails_closed() {
        let welcome_id = Uuid::new_v4();
        let other_id = Uuid::new_v4();
        let admin = "aa".repeat(32);
        let gate = gate(welcome_id, &admin, &admin, true);

        assert_eq!(gate.evaluate(&event(other_id)).await, RouteGate::Bypass);
        assert_eq!(gate.evaluate(&event(welcome_id)).await, RouteGate::Drop);
    }

    #[tokio::test]
    async fn trusted_kickoff_and_fizz_handoff_bypass_human_claim_only_for_manifest_target() {
        let channel_id = Uuid::new_v4();
        let owner = Keys::generate();
        let fizz = Keys::generate();
        let administrator = Keys::generate();
        let admin_hex = administrator.public_key().to_hex();
        let fizz_hex = fizz.public_key().to_hex();
        let manifest = WelcomeManifest {
            channel_id,
            members: BTreeMap::from([
                (AirhopRole::Fizz, fizz_hex.clone()),
                (AirhopRole::Administrator, admin_hex.clone()),
                (AirhopRole::Analyst, "cc".repeat(32)),
                (AirhopRole::ContentMarketer, "dd".repeat(32)),
            ]),
        };
        let make_gate = || {
            WelcomeRouteGate::new(
                true,
                HashSet::from([channel_id]),
                Some(AirhopRole::Administrator),
                admin_hex.clone(),
                Some(owner.public_key().to_hex()),
                FakeClient {
                    decision: WelcomeRouteDecision {
                        event_id: "ab".repeat(32),
                        channel_id,
                        target_role: AirhopRole::Administrator,
                        target_pubkey: admin_hex.clone(),
                        reason: "fallback".to_owned(),
                        replayed: false,
                    },
                    claims: AtomicUsize::new(0),
                    fail: false,
                    manifest: Some(manifest.clone()),
                },
            )
        };
        let common = [
            Tag::parse(["h", &channel_id.to_string()]).unwrap(),
            Tag::parse(["p", &admin_hex]).unwrap(),
        ];
        let kickoff = BuzzEvent {
            channel_id,
            event: EventBuilder::new(
                Kind::Custom(buzz_core::kind::KIND_AIRHOP_AGENT_TASK as u16),
                "semantic task",
            )
            .tags([
                common[0].clone(),
                common[1].clone(),
                Tag::parse(["airhop-task", "task-id"]).unwrap(),
                Tag::parse(["airhop-kickoff-stage", "administrator_intro"]).unwrap(),
            ])
            .sign_with_keys(&owner)
            .unwrap(),
        };
        let kickoff_gate = make_gate();
        assert_eq!(kickoff_gate.evaluate(&kickoff).await, RouteGate::Accept);
        assert_eq!(kickoff_gate.client.claims.load(Ordering::SeqCst), 0);

        let handoff = BuzzEvent {
            channel_id,
            event: EventBuilder::new(Kind::Custom(9), "проверь расписание")
                .tags([
                    common[0].clone(),
                    common[1].clone(),
                    Tag::parse(["airhop-handoff", "administrator"]).unwrap(),
                ])
                .sign_with_keys(&fizz)
                .unwrap(),
        };
        let handoff_gate = make_gate();
        assert_eq!(handoff_gate.evaluate(&handoff).await, RouteGate::Accept);
        assert_eq!(handoff_gate.client.claims.load(Ordering::SeqCst), 0);

        let forged = BuzzEvent {
            channel_id,
            event: EventBuilder::new(Kind::Custom(9), "forged")
                .tags([
                    common[0].clone(),
                    common[1].clone(),
                    Tag::parse(["airhop-handoff", "administrator"]).unwrap(),
                ])
                .sign_with_keys(&owner)
                .unwrap(),
        };
        assert_eq!(make_gate().evaluate(&forged).await, RouteGate::Drop);
    }

    #[test]
    fn parent_input_batch_identity_is_stable_and_order_sensitive() {
        use crate::queue::BatchEvent;
        use std::time::Instant;

        let channel_id = Uuid::new_v4();
        let first = event(channel_id).event;
        let second = event(channel_id).event;
        let batch = FlushBatch {
            channel_id,
            events: vec![
                BatchEvent {
                    event: first,
                    prompt_tag: "parent".into(),
                    received_at: Instant::now(),
                },
                BatchEvent {
                    event: second,
                    prompt_tag: "parent".into(),
                    received_at: Instant::now(),
                },
            ],
            cancelled_events: Vec::new(),
            cancel_reason: None,
        };
        assert_eq!(
            deterministic_batch_id(&batch),
            deterministic_batch_id(&batch)
        );
        assert_eq!(
            parent_batch_source_ids(&batch),
            vec![
                batch.events[1].event.id.to_hex(),
                batch.events[0].event.id.to_hex()
            ]
        );
        let merged = FlushBatch {
            cancelled_events: batch.events.clone(),
            ..batch.clone()
        };
        assert_eq!(
            parent_batch_source_ids(&merged),
            parent_batch_source_ids(&batch)
        );

        let reversed = FlushBatch {
            channel_id,
            events: batch.events.iter().cloned().rev().collect(),
            cancelled_events: Vec::new(),
            cancel_reason: None,
        };
        assert_ne!(
            deterministic_batch_id(&batch),
            deterministic_batch_id(&reversed)
        );
    }
}
