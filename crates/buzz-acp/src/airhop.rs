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

pub(crate) mod guest;
mod staff_intent;

/// Welcome's server route claim, not a mandatory mention, chooses the responder.
pub(crate) fn welcome_message_rule(
    enabled: bool,
    channels: &HashSet<Uuid>,
) -> Option<crate::filter::SubscriptionRule> {
    if !enabled || channels.is_empty() {
        return None;
    }
    Some(crate::filter::SubscriptionRule {
        name: "airhop-welcome-owner-messages".into(),
        channels: crate::filter::ChannelScope::List(
            channels.iter().map(ToString::to_string).collect(),
        ),
        kinds: vec![buzz_core::kind::KIND_STREAM_MESSAGE],
        require_mention: false,
        filter: None,
        compiled_filter: None,
        consecutive_timeouts: std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0)),
        prompt_tag: Some("airhop-welcome".into()),
    })
}

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
    #[serde(default)]
    pub communication_configured: bool,
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
    /// The relay checked an explicit organization conversation policy.
    AcceptConfigured,
    Drop,
    DropDuplicate,
    Bypass,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParentClaimResponse {
    token: String,
    turn: ParentTurnLease,
    context: ParentClaimContext,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParentClaimContext {
    scope: ParentClaimScope,
    // Absence means an older server: retain conservative thread isolation.
    threaded: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParentClaimScope {
    conversation_id: Uuid,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParentTurnLease {
    id: Uuid,
    lease_token: Uuid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ParentClaimDecision {
    Run(Option<ParentConversationScope>),
    Retry,
    Drop,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ParentConversationScope {
    pub conversation_id: Uuid,
    pub threaded: Option<bool>,
}

/// Dispatch-time hosted supervisor gate for the parent-facing Hermes role.
/// The token file is visible to AirHop MCP only, never to the model process.
pub(crate) struct ParentSupervisorGate {
    enabled: bool,
    classify_staff_control: bool,
    context_file: Option<PathBuf>,
    client: RestClient,
    leases: Mutex<BTreeMap<Uuid, ParentTurnLease>>,
}

impl ParentSupervisorGate {
    pub(crate) fn new(
        role: Option<AirhopRole>,
        context_file: Option<PathBuf>,
        client: RestClient,
    ) -> Self {
        Self {
            enabled: role == Some(AirhopRole::ParentAdministrator),
            classify_staff_control: std::env::var("AIRHOP_STAFF_INTENT_ENABLED").as_deref()
                == Ok("1"),
            context_file,
            client,
            leases: Mutex::new(BTreeMap::new()),
        }
    }

    /// Claims the newest triggerable event in a coalesced batch. Receipts prove
    /// that it is current parent input or an explicit authorized staff resume;
    /// all other staff/internal events fail closed.
    pub(crate) async fn claim_batch(&self, batch: &FlushBatch) -> ParentClaimDecision {
        if !self.enabled {
            return ParentClaimDecision::Run(None);
        }
        if self
            .leases
            .lock()
            .map(|leases| !leases.is_empty())
            .unwrap_or(true)
        {
            return ParentClaimDecision::Retry;
        }
        // A static grant can support a single explicitly scoped invocation, but
        // must never bypass fresh supervisor authorization in the live queue.
        let Some(context_path) = self.context_file.as_deref() else {
            return ParentClaimDecision::Drop;
        };
        let source_event_ids = parent_batch_source_ids(batch);
        let Some(event_id) = source_event_ids.first() else {
            return ParentClaimDecision::Drop;
        };
        let input_batch_id = deterministic_batch_id(batch);
        let path = format!("/api/airhop/agents/v1/supervisor/events/{event_id}/claim");
        let mut body = serde_json::json!({
            "inputBatchId": input_batch_id, "sourceEventIds": source_event_ids,
            "leaseSeconds": 600, "ttlSeconds": 600,
            "classifyStaffControl": self.classify_staff_control,
        });
        let response = async {
            let mut value = self.post_claim(&path, &body).await?;
            if let Some(raw) = value.get("controlCandidate") {
                if !self.classify_staff_control {
                    return Err(RelayError::HttpResponse { status: 422 });
                }
                let candidate: staff_intent::Candidate =
                    serde_json::from_value(raw.clone()).map_err(RelayError::Json)?;
                if !source_event_ids.contains(&candidate.event_id) || candidate.control_version < 0
                {
                    return Err(RelayError::HttpResponse { status: 422 });
                }
                let started = std::time::Instant::now();
                let intent = staff_intent::classify(&candidate)
                    .await
                    .map_err(|code| RelayError::Http(code.to_owned()))?;
                tracing::info!(event_id = %candidate.event_id, intent,
                    elapsed_ms = started.elapsed().as_millis(),
                    "AirHop staff control classified; awaiting server authorization");
                body["staffControl"] = serde_json::json!({
                    "eventId": candidate.event_id,
                    "controlVersion": candidate.control_version, "intent": intent,
                });
                value = self.post_claim(&path, &body).await?;
            }
            serde_json::from_value(value).map_err(RelayError::Json)
        }
        .await;
        match response {
            Ok(ParentClaimResponse {
                token,
                turn,
                context,
            }) => {
                let Ok(mut leases) = self.leases.lock() else {
                    return ParentClaimDecision::Retry;
                };
                leases.insert(batch.channel_id, turn);
                match write_context_grant(context_path, &token) {
                    Ok(()) => ParentClaimDecision::Run(Some(ParentConversationScope {
                        conversation_id: context.scope.conversation_id,
                        threaded: context.threaded,
                    })),
                    Err(error) => {
                        tracing::error!(
                            event_id,
                            error = %error,
                            "AirHop supervisor could not hand context to MCP"
                        );
                        ParentClaimDecision::Retry
                    }
                }
            }
            Err(error) => {
                let decision = parent_claim_error_decision(&error);
                tracing::warn!(
                    event_id,
                    ?decision,
                    error = %bounded_error(&error),
                    "AirHop supervisor could not claim event batch"
                );
                decision
            }
        }
    }

    async fn post_claim(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> Result<serde_json::Value, RelayError> {
        tokio::time::timeout(
            std::time::Duration::from_secs(5),
            self.client.post_json(path, body),
        )
        .await
        .unwrap_or(Err(RelayError::Timeout))
    }

    /// Ask the server whether the exact lease still needs a reply. Never infer
    /// delivery from model text, and never repair a completed or silent-resume turn.
    pub(crate) async fn needs_reply(&self, channel: Uuid) -> bool {
        let lease = self
            .leases
            .lock()
            .ok()
            .and_then(|leases| leases.get(&channel).cloned());
        let Some(lease) = lease else {
            return false;
        };
        let response = self
            .post_claim(
                &format!("/api/airhop/agents/v1/turns/{}/finish", lease.id),
                &serde_json::json!({"status": "check", "leaseToken": lease.lease_token}),
            )
            .await;
        match response {
            Ok(value) => value.get("needsReply").and_then(serde_json::Value::as_bool) == Some(true),
            Err(error) => {
                tracing::warn!(%channel, error = %bounded_error(&error), "AirHop reply check unavailable; deferring to finalization");
                false
            }
        }
    }

    /// Release the runtime lease even when the model forgot to send a reply.
    /// Server-side completion preserves an already committed reply or takeover.
    /// Failed acknowledgements remain pending and block redispatch until retried.
    pub(crate) async fn finish_channel(&self, channel: Uuid) -> bool {
        let lease = self
            .leases
            .lock()
            .ok()
            .and_then(|leases| leases.get(&channel).cloned());
        let Some(lease) = lease else {
            return false;
        };
        let response = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            self.client.post_json(
                &format!("/api/airhop/agents/v1/turns/{}/finish", lease.id),
                &serde_json::json!({
                    "status": "failed", "leaseToken": lease.lease_token,
                    "errorCode": "runtime_finished_without_reply",
                }),
            ),
        )
        .await
        .unwrap_or(Err(RelayError::Timeout));
        match response {
            Ok(value) => {
                let status = value.get("status").and_then(serde_json::Value::as_str);
                if !matches!(status, Some("completed" | "cancelled" | "failed")) {
                    tracing::error!(%channel, "AirHop turn completion returned no terminal status");
                    return true;
                }
                if let Ok(mut leases) = self.leases.lock() {
                    leases.remove(&channel);
                }
                status == Some("failed")
            }
            Err(RelayError::HttpResponse {
                status: status @ (403 | 404 | 409),
            }) => {
                // Lease expired, was rotated or cancelled. Never clear somebody
                // else's lease; the server retains the final authority.
                if let Ok(mut leases) = self.leases.lock() {
                    leases.remove(&channel);
                }
                // Losing/expiring a lease is not proof of a committed reply.
                // Reclaim will reject completed or no-longer-owned input.
                status != 404
            }
            Err(error) => {
                tracing::warn!(%channel, error = %bounded_error(&error), "AirHop turn completion will be retried");
                true
            }
        }
    }

    pub(crate) async fn finish_idle_channels(&self, active: &HashSet<Uuid>) {
        let channels: Vec<_> = self
            .leases
            .lock()
            .map(|leases| {
                leases
                    .keys()
                    .copied()
                    .filter(|ch| !active.contains(ch))
                    .collect()
            })
            .unwrap_or_default();
        for channel in channels {
            self.finish_channel(channel).await;
        }
    }
}

fn parent_claim_error_decision(error: &RelayError) -> ParentClaimDecision {
    match error {
        RelayError::HttpResponse {
            status: 400 | 401 | 403 | 404 | 410 | 422,
        } => ParentClaimDecision::Drop,
        // Includes concurrent lease conflicts and transient transport failures.
        _ => ParentClaimDecision::Retry,
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
        if !self.enabled || self.role == Some(AirhopRole::ParentAdministrator) {
            return RouteGate::Bypass;
        }

        let event_id = event.event.id.to_hex();
        if self.was_seen(&event_id) {
            return RouteGate::DropDuplicate;
        }

        if is_kickoff_task(&event.event) {
            if !self.flat_channel_ids.contains(&event.channel_id) {
                return RouteGate::Drop;
            }
            return self.evaluate_kickoff(event, &event_id).await;
        }
        if has_tag(&event.event, "airhop-handoff", None) {
            if !self.flat_channel_ids.contains(&event.channel_id) {
                return RouteGate::Drop;
            }
            return self.evaluate_handoff(event, &event_id).await;
        }

        self.evaluate_claim(event, event_id).await
    }

    async fn evaluate_claim(&self, event: &BuzzEvent, event_id: String) -> RouteGate {
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
                match self.accept_once(event_id) {
                    RouteGate::Accept if decision.communication_configured => {
                        RouteGate::AcceptConfigured
                    }
                    result => result,
                }
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
                self.evaluate_claim(event, event_id.to_owned()).await
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

pub(crate) fn is_kickoff_task(event: &Event) -> bool {
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
pub(crate) mod tests {
    use super::*;
    use nostr::{EventBuilder, Keys, Kind, Tag};
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn hosted_parent_runtime_keeps_tools_direct_and_profile_memory_disabled() {
        let config = include_str!("../../../integrations/hermes-airhop-parent-runtime/config.yaml");
        assert!(config.contains("tools:\n  tool_search:\n    enabled: \"off\""));
        assert!(config.contains("memory_enabled: false"));
        assert!(config.contains("user_profile_enabled: false"));
        let overlay = include_str!("../../../deploy/airhop/Dockerfile.hermes-booking");
        assert!(overlay.contains(
            "integrations/hermes-airhop-parent-runtime/config.yaml /opt/airhop-hermes/config.yaml"
        ));
    }

    #[tokio::test]
    async fn welcome_plain_message_rule_is_channel_and_kind_scoped() {
        let welcome = Uuid::new_v4();
        let channels = HashSet::from([welcome]);
        assert!(welcome_message_rule(false, &channels).is_none());
        assert!(welcome_message_rule(true, &HashSet::new()).is_none());
        let rules = vec![welcome_message_rule(true, &channels).unwrap()];
        let message = event(welcome).event;
        let agent = Keys::generate().public_key().to_hex();
        assert!(
            crate::filter::match_event(&message, welcome, &rules, &agent)
                .await
                .is_some()
        );
        assert!(
            crate::filter::match_event(&message, Uuid::new_v4(), &rules, &agent)
                .await
                .is_none()
        );
        let reaction = EventBuilder::new(Kind::Custom(7), "+")
            .sign_with_keys(&Keys::generate())
            .unwrap();
        assert!(
            crate::filter::match_event(&reaction, welcome, &rules, &agent)
                .await
                .is_none()
        );
    }

    pub(crate) async fn supervisor_server(
        responses: Vec<(u16, serde_json::Value)>,
    ) -> (RestClient, tokio::task::JoinHandle<Vec<serde_json::Value>>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let mut requests = Vec::new();
            for (status, body) in responses {
                let (mut stream, _) =
                    tokio::time::timeout(std::time::Duration::from_secs(10), listener.accept())
                        .await
                        .unwrap()
                        .unwrap();
                let mut bytes = Vec::new();
                let request = loop {
                    let mut chunk = [0; 4096];
                    let count = stream.read(&mut chunk).await.unwrap();
                    assert!(count > 0);
                    bytes.extend_from_slice(&chunk[..count]);
                    if let Some(end) = bytes.windows(4).position(|s| s == b"\r\n\r\n") {
                        let header = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                        let length: usize = header
                            .lines()
                            .find_map(|line| line.strip_prefix("content-length:"))
                            .unwrap()
                            .trim()
                            .parse()
                            .unwrap();
                        if bytes.len() >= end + 4 + length {
                            assert!(header.contains("authorization: nostr "));
                            break serde_json::from_slice::<serde_json::Value>(
                                &bytes[end + 4..end + 4 + length],
                            )
                            .unwrap();
                        }
                    }
                };
                requests.push(request);
                let body = body.to_string();
                stream.write_all(format!("HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
            }
            requests
        });
        (
            RestClient {
                http: reqwest::Client::new(),
                base_url: format!("http://{address}"),
                keys: Keys::generate(),
                auth_tag_json: None,
            },
            server,
        )
    }

    fn parent_test_batch(channel: Uuid) -> FlushBatch {
        FlushBatch {
            channel_id: channel,
            events: vec![crate::queue::BatchEvent {
                event: event(channel).event,
                prompt_tag: "parent".into(),
                received_at: std::time::Instant::now(),
            }],
            cancelled_events: Vec::new(),
            cancel_reason: None,
        }
    }

    #[tokio::test]
    async fn parent_reply_check_preserves_lease_and_requires_explicit_server_approval() {
        for (status, response, expected) in [
            (200, serde_json::json!({"needsReply": true}), true),
            (200, serde_json::json!({"needsReply": false}), false),
            (200, serde_json::json!({"status": "completed"}), false),
            (403, serde_json::json!({"error": "cancelled"}), false),
            (500, serde_json::json!({"error": "temporary"}), false),
        ] {
            let (client, server) = supervisor_server(vec![(status, response)]).await;
            let gate =
                ParentSupervisorGate::new(Some(AirhopRole::ParentAdministrator), None, client);
            let channel = Uuid::new_v4();
            let lease = ParentTurnLease {
                id: Uuid::new_v4(),
                lease_token: Uuid::new_v4(),
            };
            gate.leases.lock().unwrap().insert(channel, lease.clone());
            assert_eq!(gate.needs_reply(channel).await, expected);
            assert_eq!(gate.leases.lock().unwrap().len(), 1);
            assert_eq!(
                server.await.unwrap(),
                vec![serde_json::json!({"status":"check", "leaseToken":lease.lease_token})]
            );
        }
    }

    #[tokio::test]
    async fn parent_supervisor_rejects_classifier_candidate_outside_batch() {
        let (client, server) = supervisor_server(vec![(200, serde_json::json!({
            "controlCandidate": {"eventId": "ff".repeat(32), "controlVersion": 1, "content": "take over"}
        }))]).await;
        let mut gate = ParentSupervisorGate::new(
            Some(AirhopRole::ParentAdministrator),
            Some(std::env::temp_dir().join(format!("airhop-no-grant-{}", Uuid::new_v4()))),
            client,
        );
        gate.classify_staff_control = true;
        assert_eq!(
            gate.claim_batch(&parent_test_batch(Uuid::new_v4())).await,
            ParentClaimDecision::Drop
        );
        assert!(gate.leases.lock().unwrap().is_empty());
        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0]["classifyStaffControl"], true);
    }

    #[tokio::test]
    async fn parent_supervisor_consumes_rejected_oversize_candidate_without_model_call() {
        let batch = parent_test_batch(Uuid::new_v4());
        let id = batch.events[0].event.id.to_hex();
        let (client, server) = supervisor_server(vec![
            (200, serde_json::json!({"controlCandidate": {"eventId": id, "controlVersion": 7, "content": "x".repeat(1001)}})),
            (410, serde_json::json!({"error":"no trigger"})),
        ]).await;
        let mut gate = ParentSupervisorGate::new(
            Some(AirhopRole::ParentAdministrator),
            Some(std::env::temp_dir().join(format!("airhop-no-grant-{}", Uuid::new_v4()))),
            client,
        );
        gate.classify_staff_control = true;
        assert_eq!(gate.claim_batch(&batch).await, ParentClaimDecision::Drop);
        let requests = server.await.unwrap();
        assert_eq!(
            requests[1]["staffControl"],
            serde_json::json!({"eventId":id, "controlVersion":7, "intent":"other"})
        );
        assert_eq!(requests[0]["inputBatchId"], requests[1]["inputBatchId"]);
    }

    #[tokio::test]
    async fn parent_supervisor_retries_input_when_completion_lease_expired() {
        let (client, server) = supervisor_server(vec![
            (200, serde_json::json!({"token":"context", "context":{"scope":{"conversationId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}}, "turn":{"id":Uuid::new_v4(),"leaseToken":Uuid::new_v4()}})),
            (409, serde_json::json!({"error":"lease expired"})),
        ]).await;
        let path = std::env::temp_dir().join(format!("airhop-expired-{}", Uuid::new_v4()));
        let gate = ParentSupervisorGate::new(
            Some(AirhopRole::ParentAdministrator),
            Some(path.clone()),
            client,
        );
        let batch = parent_test_batch(Uuid::new_v4());
        assert_eq!(
            gate.claim_batch(&batch).await,
            ParentClaimDecision::Run(Some(ParentConversationScope {
                conversation_id: Uuid::parse_str("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").unwrap(),
                threaded: None,
            }))
        );
        assert!(gate.finish_channel(batch.channel_id).await);
        assert!(gate.leases.lock().unwrap().is_empty());
        assert_eq!(server.await.unwrap().len(), 2);
        std::fs::remove_file(path).unwrap();
    }

    #[tokio::test]
    async fn parent_supervisor_finalizes_unsent_turn_and_retries_failed_ack() {
        let turn = Uuid::new_v4();
        let lease = Uuid::new_v4();
        let (client, server) = supervisor_server(vec![
            (
                200,
                serde_json::json!({"token":"test-context", "context":{"scope":{"conversationId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}}, "turn":{"id":turn,"leaseToken":lease}}),
            ),
            (500, serde_json::json!({"error":"temporary"})),
            (200, serde_json::json!({"status":"failed"})),
        ])
        .await;
        let path = std::env::temp_dir().join(format!("airhop-supervisor-test-{}", Uuid::new_v4()));
        let gate = ParentSupervisorGate::new(
            Some(AirhopRole::ParentAdministrator),
            Some(path.clone()),
            client,
        );
        let batch = parent_test_batch(Uuid::new_v4());
        assert_eq!(
            gate.claim_batch(&batch).await,
            ParentClaimDecision::Run(Some(ParentConversationScope {
                conversation_id: Uuid::parse_str("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").unwrap(),
                threaded: None,
            }))
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "test-context");
        gate.finish_idle_channels(&HashSet::from([batch.channel_id]))
            .await;
        assert_eq!(gate.claim_batch(&batch).await, ParentClaimDecision::Retry);
        assert!(gate.finish_channel(batch.channel_id).await);
        assert_eq!(gate.leases.lock().unwrap().len(), 1);
        gate.finish_idle_channels(&HashSet::new()).await;
        assert!(gate.leases.lock().unwrap().is_empty());
        let requests = server.await.unwrap();
        assert_eq!(requests[1]["leaseToken"], lease.to_string());
        assert_eq!(requests[1]["errorCode"], "runtime_finished_without_reply");
        assert_eq!(requests[1], requests[2]);
        std::fs::remove_file(path).unwrap();
    }

    #[tokio::test]
    async fn parent_supervisor_does_not_retry_a_committed_reply() {
        let (client, server) = supervisor_server(vec![
            (200, serde_json::json!({"token":"test-context", "context":{"scope":{"conversationId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}}, "turn":{"id":Uuid::new_v4(),"leaseToken":Uuid::new_v4()}})),
            (200, serde_json::json!({"status":"completed"})),
        ]).await;
        let path = std::env::temp_dir().join(format!("airhop-supervisor-test-{}", Uuid::new_v4()));
        let gate = ParentSupervisorGate::new(
            Some(AirhopRole::ParentAdministrator),
            Some(path.clone()),
            client,
        );
        let batch = parent_test_batch(Uuid::new_v4());
        assert_eq!(
            gate.claim_batch(&batch).await,
            ParentClaimDecision::Run(Some(ParentConversationScope {
                conversation_id: Uuid::parse_str("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").unwrap(),
                threaded: None,
            }))
        );
        assert!(!gate.finish_channel(batch.channel_id).await);
        assert!(gate.leases.lock().unwrap().is_empty());
        assert_eq!(server.await.unwrap().len(), 2);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn parent_claim_distinguishes_busy_or_network_from_permanent_rejection() {
        for status in [409, 423, 429, 500, 502, 503, 504] {
            assert_eq!(
                parent_claim_error_decision(&RelayError::HttpResponse { status }),
                ParentClaimDecision::Retry
            );
        }
        for status in [400, 401, 403, 404, 410, 422] {
            assert_eq!(
                parent_claim_error_decision(&RelayError::HttpResponse { status }),
                ParentClaimDecision::Drop
            );
        }
        assert_eq!(
            parent_claim_error_decision(&RelayError::Timeout),
            ParentClaimDecision::Retry
        );
    }

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
                    communication_configured: false,
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
    async fn ordinary_conversations_are_also_checked_and_fail_closed() {
        let welcome_id = Uuid::new_v4();
        let other_id = Uuid::new_v4();
        let admin = "aa".repeat(32);
        let gate = gate(welcome_id, &admin, &admin, true);

        assert_eq!(gate.evaluate(&event(other_id)).await, RouteGate::Drop);
        assert_eq!(gate.evaluate(&event(welcome_id)).await, RouteGate::Drop);
    }

    #[tokio::test]
    async fn explicit_policy_is_authoritative_outside_welcome_but_generic_agents_bypass() {
        let channel = Uuid::new_v4();
        let admin = "aa".repeat(32);
        let mut gate = gate(channel, &admin, &admin, false);
        gate.flat_channel_ids.clear();
        gate.client.decision.communication_configured = true;
        assert_eq!(
            gate.evaluate(&event(channel)).await,
            RouteGate::AcceptConfigured
        );
        gate.enabled = false;
        assert_eq!(
            gate.evaluate(&event(Uuid::new_v4())).await,
            RouteGate::Bypass
        );
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
                        communication_configured: false,
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
        let mut handoff_gate = make_gate();
        handoff_gate.client.decision.event_id = handoff.event.id.to_hex();
        assert_eq!(handoff_gate.evaluate(&handoff).await, RouteGate::Accept);
        assert_eq!(handoff_gate.client.claims.load(Ordering::SeqCst), 1);

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

    #[tokio::test]
    async fn parent_live_queue_without_rotating_grant_fails_closed() {
        let gate = ParentSupervisorGate::new(
            Some(AirhopRole::ParentAdministrator),
            None,
            RestClient {
                http: reqwest::Client::new(),
                base_url: "http://127.0.0.1:1".into(),
                keys: nostr::Keys::generate(),
                auth_tag_json: None,
            },
        );
        assert!(gate.enabled);
        let batch = FlushBatch {
            channel_id: Uuid::new_v4(),
            events: Vec::new(),
            cancelled_events: Vec::new(),
            cancel_reason: None,
        };
        assert_eq!(gate.claim_batch(&batch).await, ParentClaimDecision::Drop);
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
