//! Private event-based changes to organization agent duties.
use airhop_core::{agent_learning::AgentLearningCommand, agent_policy::SetAgentPolicy};
use buzz_core::TenantContext;
use buzz_db::DbError;
use serde_json::Value;
use std::sync::Arc;

use crate::{handlers::ingest::IngestError, state::AppState};

pub(crate) async fn apply_command(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    event: &nostr::Event,
    channel_scoped_token: bool,
) -> Result<Value, IngestError> {
    let bindings: Vec<_> = event
        .tags
        .iter()
        .filter(|tag| {
            tag.as_slice()
                .first()
                .is_some_and(|value| value == "airhop-community")
        })
        .collect();
    if bindings.len() != 1
        || bindings[0].as_slice().get(1).map(String::as_str)
            != Some(tenant.community().as_uuid().to_string().as_str())
    {
        return Err(IngestError::Rejected(
            "invalid: agent settings tenant binding required".into(),
        ));
    }
    let result =
        if event.kind.as_u16() as u32 == buzz_core::kind::KIND_AIRHOP_AGENT_LEARNING_COMMAND {
            let command: AgentLearningCommand = serde_json::from_str(&event.content)
                .map_err(|_| IngestError::Rejected("invalid: procedure command".into()))?;
            let channel = learning_channel(&command, event, channel_scoped_token)?;
            match &command {
                AgentLearningCommand::Observe { reply_event_id, .. } => {
                    let id = nostr::EventId::from_hex(reply_event_id)
                        .map_err(|_| IngestError::Rejected("invalid: observation reply".into()))?;
                    let reply = state
                        .db
                        .get_event_by_id(tenant.community(), id.as_bytes())
                        .await
                        .map_err(|_| {
                            IngestError::Internal("observation source lookup failed".into())
                        })?;
                    if !reply.is_some_and(|reply| {
                        reply.channel_id == channel && reply.event.pubkey == event.pubkey
                    }) {
                        return Err(IngestError::AuthFailed(
                            "restricted: observation must reference your own reply in this channel"
                                .into(),
                        ));
                    }
                }
                AgentLearningCommand::Activate { .. } => {}
            }

            state
                .db
                .apply_airhop_agent_learning(
                    tenant,
                    &event.pubkey.to_bytes(),
                    &event.id.to_bytes(),
                    &command,
                )
                .await
        } else {
            if channel_scoped_token {
                return Err(IngestError::AuthFailed(
                    "restricted: agent settings require an unscoped owner/admin credential".into(),
                ));
            }
            let command: SetAgentPolicy = serde_json::from_str(&event.content)
                .map_err(|_| IngestError::Rejected("invalid: agent settings command".into()))?;
            state
                .db
                .apply_airhop_agent_policy(
                    tenant,
                    &event.pubkey.to_bytes(),
                    &event.id.to_bytes(),
                    &command,
                )
                .await
        };
    result.map_err(|error| match error {
        DbError::AccessDenied(message) => IngestError::AuthFailed(format!("restricted: {message}")),
        DbError::AirhopVersionConflict => {
            IngestError::Rejected("conflict: agent settings changed; reload before saving".into())
        }
        DbError::InvalidData(message) => IngestError::Rejected(format!("invalid: {message}")),
        DbError::NotFound(message) => IngestError::Rejected(format!("invalid: {message}")),
        error => {
            tracing::error!(%error,"Agent policy command failed");
            IngestError::Internal("error: agent settings update failed".into())
        }
    })
}

fn learning_channel(
    command: &AgentLearningCommand,
    event: &nostr::Event,
    scoped: bool,
) -> Result<Option<uuid::Uuid>, IngestError> {
    let channels: Vec<_> = event
        .tags
        .iter()
        .filter(|tag| tag.as_slice().first().is_some_and(|key| key == "h"))
        .collect();
    match command {
        AgentLearningCommand::Observe { .. } => (channels.len() == 1)
            .then(|| channels[0].as_slice().get(1))
            .flatten()
            .and_then(|id| uuid::Uuid::parse_str(id).ok())
            .map(Some)
            .ok_or_else(|| {
                IngestError::Rejected("invalid: observation requires its reply channel".into())
            }),
        AgentLearningCommand::Activate { .. } if scoped || !channels.is_empty() => {
            Err(IngestError::AuthFailed(
                "restricted: procedure management requires an unscoped owner/admin credential"
                    .into(),
            ))
        }
        AgentLearningCommand::Activate { .. } => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use airhop_core::{
        agent_graph::GRAPH_VERSION,
        agent_learning::{FactSource, ProcedurePlan},
        agent_policy::AgentRole,
    };
    #[test]
    fn scoped_agents_can_observe_only_in_a_named_channel_but_cannot_activate() {
        let id = uuid::Uuid::new_v4();
        let build = |channels: Vec<uuid::Uuid>| {
            nostr::EventBuilder::new(
                nostr::Kind::Custom(buzz_core::kind::KIND_AIRHOP_AGENT_LEARNING_COMMAND as u16),
                "",
            )
            .tags(
                channels
                    .iter()
                    .map(|id| nostr::Tag::parse(["h", id.to_string().as_str()]).unwrap()),
            )
            .sign_with_keys(&nostr::Keys::generate())
            .unwrap()
        };
        let observation = AgentLearningCommand::Observe {
            role: AgentRole::Fizz,
            reply_event_id: "ab".repeat(32),
            plan: ProcedurePlan {
                graph_version: GRAPH_VERSION.into(),
                sources: vec![FactSource::Knowledge],
            },
        };
        assert_eq!(
            learning_channel(&observation, &build(vec![id]), true).unwrap(),
            Some(id)
        );
        assert!(learning_channel(&observation, &build(vec![]), true).is_err());
        assert!(
            learning_channel(&observation, &build(vec![id, uuid::Uuid::new_v4()]), true).is_err()
        );
        let activation = AgentLearningCommand::Activate {
            role: AgentRole::Fizz,
            procedure_id: None,
            expected_version: 0,
        };
        assert!(learning_channel(&activation, &build(vec![id]), true).is_err());
        assert!(learning_channel(&activation, &build(vec![]), true).is_err());
        assert_eq!(
            learning_channel(&activation, &build(vec![]), false).unwrap(),
            None
        );
        assert!(!crate::handlers::ingest::is_global_only_kind(
            buzz_core::kind::KIND_AIRHOP_AGENT_LEARNING_COMMAND
        ));
        assert!(crate::handlers::ingest::is_global_only_kind(
            buzz_core::kind::KIND_AIRHOP_AGENT_POLICY_COMMAND
        ));
    }
}
