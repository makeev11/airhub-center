//! Canonical Buzz conversation ownership for parent-facing Hermes.

use buzz_core::{StoredEvent, TenantContext};
use chrono::{DateTime, Utc};
use nostr::Event;
use serde::Serialize;
use serde_json::Value;
use sqlx::Row;
use uuid::Uuid;

use crate::event::{insert_event_with_thread_metadata_tx, ThreadMetadataParams};
use crate::{Db, DbError, Result};

use super::channel_gateway::GatewayInboundContext;

mod handoff;
pub use handoff::{is_hermes_handoff_event, HermesHandoffTarget};
#[cfg(test)]
mod integration_tests;

/// Creates the immutable identity binding for one private parent conversation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegisterExternalConversationInput {
    /// Stable conversation identity.
    pub conversation_id: Uuid,
    /// Canonical private Buzz channel.
    pub channel_id: Uuid,
    /// Verified Family, when identity has already been resolved.
    pub family_id: Option<Uuid>,
    /// Verified representative paired with the Family.
    pub representative_id: Option<Uuid>,
    /// Exact Buzz principal representing the parent on the canonical channel.
    pub parent_pubkey: [u8; 32],
    /// Stable first ownership cycle.
    pub cycle_id: Uuid,
    /// Zero for create; one for an idempotent replay of the created binding.
    pub expected_version: i64,
    /// Authenticated owner/admin creating the binding.
    pub opened_by_pubkey: [u8; 32],
}

/// The only two actors that may own the next external reply.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConversationOwner {
    /// Hermes may answer validated parent input.
    Hermes,
    /// A human has taken over; Hermes remains silent.
    Human,
}

impl ConversationOwner {
    fn parse(value: &str) -> Result<Self> {
        match value {
            "hermes" => Ok(Self::Hermes),
            "human" => Ok(Self::Human),
            other => Err(DbError::InvalidData(format!(
                "unknown AirHop conversation owner: {other}"
            ))),
        }
    }
}

/// Safe current state of one canonical parent conversation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalConversation {
    /// Server-resolved organization.
    pub organization_id: Uuid,
    /// Stable conversation identity.
    pub id: Uuid,
    /// Canonical private Buzz channel.
    pub channel_id: Uuid,
    /// Verified Family, when known.
    pub family_id: Option<Uuid>,
    /// Verified representative, when known.
    pub representative_id: Option<Uuid>,
    /// Exact parent principal.
    pub parent_pubkey: [u8; 32],
    /// Current ownership cycle.
    pub current_cycle_id: Uuid,
    /// Actor that owns the next external reply.
    pub owner: ConversationOwner,
    /// Explicit Hermes pause flag.
    pub hermes_paused: bool,
    /// Monotonic takeover/resume fence.
    pub control_version: i64,
    /// Creation time.
    pub created_at: DateTime<Utc>,
    /// Last ownership change.
    pub updated_at: DateTime<Utc>,
}

/// Server-side routing result committed with a kind-9 Buzz event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExternalConversationEventProjection {
    /// The channel is not registered as a parent conversation.
    NotExternalConversation,
    /// The event is durable but must never start a Hermes turn.
    StoredOnly,
    /// A validated parent event may start a turn in the captured fence.
    TriggerHermes {
        /// Conversation identity.
        conversation_id: Uuid,
        /// Ownership cycle captured with the inbound event.
        cycle_id: Uuid,
        /// Control version captured with the inbound event.
        control_version: i64,
        /// Verified Family, when known.
        family_id: Option<Uuid>,
        /// Verified representative, when known.
        representative_id: Option<Uuid>,
    },
}

/// Result of atomically storing and projecting one parent-channel event.
#[derive(Debug)]
pub struct ExternalConversationEventInsert {
    /// Stored Buzz event.
    pub stored_event: StoredEvent,
    /// Whether this call inserted rather than replayed the event.
    pub was_inserted: bool,
    /// Durable conversation routing decision.
    pub projection: ExternalConversationEventProjection,
}

/// One supervisor-authorized, already signed Hermes reply batch.
#[derive(Debug, Clone)]
pub struct CommitHermesReplyInput {
    /// Durable turn that produced the reply.
    pub turn_id: Uuid,
    /// Exact runtime lease proof.
    pub lease_token: Uuid,
    /// Authenticated Hermes principal.
    pub agent_pubkey: [u8; 32],
    /// Stable result used to close the turn.
    pub outcome: String,
    /// One to three parent messages, optionally followed by an internal handoff.
    pub events: Vec<Event>,
}

/// Durable state of one signed Hermes outbound event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HermesOutboundIntent {
    /// Signed Nostr event ID.
    pub event_id: [u8; 32],
    /// One-based position inside the bounded reply batch.
    pub sequence: i16,
    /// `committed` until normal Buzz ingestion publishes it.
    pub status: String,
}

/// Current server-derived scope for one triggerable parent event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HermesParentEventRoute {
    /// The server-selected trigger, which may precede internal notes in a batch.
    pub source_message_id: [u8; 32],
    /// Hosted deployment that owns the turn.
    pub deployment_id: Uuid,
    /// Canonical private Buzz channel.
    pub channel_id: Uuid,
    /// Stable external conversation.
    pub conversation_id: Uuid,
    /// Current ownership cycle.
    pub cycle_id: Uuid,
    /// Verified Family, when known.
    pub family_id: Option<Uuid>,
    /// Verified representative, when known.
    pub representative_id: Option<Uuid>,
}

impl Db {
    /// Resolves a previously projected parent event for the exact deployed
    /// Hermes principal. Stale receipts fail closed after takeover or resume.
    pub async fn get_airhop_hermes_parent_event_route(
        &self,
        tenant: &TenantContext,
        event_id: [u8; 32],
        agent_pubkey: [u8; 32],
    ) -> Result<Option<HermesParentEventRoute>> {
        self.get_airhop_hermes_parent_batch_route(tenant, &[event_id], agent_pubkey)
            .await
    }

    /// Selects the newest still-triggerable input from one bounded ACP batch.
    /// IDs are newest first; all candidates must share the first event's channel.
    pub async fn get_airhop_hermes_parent_batch_route(
        &self,
        tenant: &TenantContext,
        event_ids: &[[u8; 32]],
        agent_pubkey: [u8; 32],
    ) -> Result<Option<HermesParentEventRoute>> {
        if event_ids.is_empty() || event_ids.len() > 500 {
            return Err(DbError::InvalidData(
                "invalid Hermes input batch size".to_owned(),
            ));
        }
        let ids: Vec<Vec<u8>> = event_ids.iter().map(|id| id.to_vec()).collect();
        let row = sqlx::query(
            "SELECT receipt.event_id AS source_message_id,
                    deployment.id AS deployment_id, conversation.channel_id,
                    conversation.id AS conversation_id,
                    conversation.current_cycle_id, conversation.family_id,
                    conversation.representative_id
             FROM airhop_external_inbound_receipts receipt
             JOIN airhop_external_conversations conversation
               ON conversation.community_id = receipt.community_id
              AND conversation.organization_id = receipt.organization_id
              AND conversation.id = receipt.conversation_id
             JOIN airhop_agent_deployments deployment
               ON deployment.community_id = conversation.community_id
              AND deployment.organization_id = conversation.organization_id
              AND deployment.role = 'parent_administrator'
             JOIN events anchor
               ON anchor.community_id = conversation.community_id
              AND anchor.id = $4 AND anchor.channel_id = conversation.channel_id
              AND anchor.deleted_at IS NULL
             WHERE receipt.community_id = $1 AND receipt.event_id = ANY($2::bytea[])
               AND receipt.decision = 'trigger'
               AND receipt.cycle_id = conversation.current_cycle_id
               AND receipt.control_version = conversation.control_version
               AND conversation.status = 'active' AND conversation.owner = 'hermes'
               AND NOT conversation.hermes_paused
               AND deployment.agent_pubkey = $3
               AND deployment.enabled AND NOT deployment.paused
               AND NOT EXISTS (
                 SELECT 1 FROM airhop_external_conversation_routes route
                 JOIN airhop_channel_connections connection
                   ON connection.community_id = route.community_id
                  AND connection.organization_id = route.organization_id
                  AND connection.id = route.connection_id
                 WHERE route.community_id = conversation.community_id
                   AND route.organization_id = conversation.organization_id
                   AND route.conversation_id = conversation.id
                   AND (route.status <> 'active' OR connection.status <> 'active'
                        OR NOT connection.hermes_enabled)
               )
             ORDER BY array_position($2::bytea[], receipt.event_id)
             LIMIT 1",
        )
        .bind(tenant.community().as_uuid())
        .bind(ids)
        .bind(agent_pubkey.as_slice())
        .bind(event_ids[0].as_slice())
        .fetch_optional(&self.pool)
        .await?;
        row.map(|row| {
            let source: Vec<u8> = row.try_get("source_message_id")?;
            Ok(HermesParentEventRoute {
                source_message_id: source.try_into().map_err(|_| {
                    DbError::InvalidData("invalid Hermes source event ID".to_owned())
                })?,
                deployment_id: row.try_get("deployment_id")?,
                channel_id: row.try_get("channel_id")?,
                conversation_id: row.try_get("conversation_id")?,
                cycle_id: row.try_get("current_cycle_id")?,
                family_id: row.try_get("family_id")?,
                representative_id: row.try_get("representative_id")?,
            })
        })
        .transpose()
    }

    /// Registers a private Buzz channel as one canonical external conversation.
    pub async fn register_airhop_external_conversation(
        &self,
        tenant: &TenantContext,
        input: &RegisterExternalConversationInput,
    ) -> Result<ExternalConversation> {
        validate_registration(input)?;
        let community_id = *tenant.community().as_uuid();
        let mut tx = self.pool.begin().await?;
        let organization_id: Uuid = sqlx::query_scalar(
            "SELECT id FROM airhop_organizations
             WHERE community_id = $1 AND status = 'active'",
        )
        .bind(community_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| DbError::NotFound("active AirHop organization".to_owned()))?;
        require_owner_or_admin(&mut tx, community_id, input.opened_by_pubkey).await?;

        let deployment = sqlx::query(
            "SELECT agent_pubkey FROM airhop_agent_deployments
             WHERE community_id = $1 AND organization_id = $2
               AND role = 'parent_administrator'",
        )
        .bind(community_id)
        .bind(organization_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| DbError::NotFound("AirHop Hermes deployment".to_owned()))?;
        let agent_pubkey: Vec<u8> = deployment.try_get("agent_pubkey")?;

        validate_channel_binding(
            &mut tx,
            community_id,
            input.channel_id,
            &input.parent_pubkey,
            &agent_pubkey,
        )
        .await?;
        validate_family_binding(
            &mut tx,
            community_id,
            organization_id,
            input.family_id,
            input.representative_id,
        )
        .await?;

        let existing = sqlx::query(
            "SELECT organization_id, id, channel_id, family_id, representative_id,
                    parent_pubkey, current_cycle_id, owner, hermes_paused,
                    control_version, created_at, updated_at
             FROM airhop_external_conversations
             WHERE community_id = $1 AND channel_id = $2 FOR UPDATE",
        )
        .bind(community_id)
        .bind(input.channel_id)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(row) = existing {
            let conversation = conversation_from_row(&row)?;
            if input.expected_version == conversation.control_version
                && conversation.id == input.conversation_id
                && conversation.family_id == input.family_id
                && conversation.representative_id == input.representative_id
                && conversation.parent_pubkey == input.parent_pubkey
                && conversation.current_cycle_id == input.cycle_id
            {
                tx.commit().await?;
                return Ok(conversation);
            }
            return Err(DbError::AirhopVersionConflict);
        }
        if input.expected_version != 0 {
            return Err(DbError::AirhopVersionConflict);
        }

        let row = sqlx::query(
            "INSERT INTO airhop_external_conversations (
                community_id, organization_id, id, channel_id, family_id,
                representative_id, parent_pubkey, current_cycle_id,
                opened_by_pubkey
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING organization_id, id, channel_id, family_id, representative_id,
                parent_pubkey, current_cycle_id, owner, hermes_paused,
                control_version, created_at, updated_at",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(input.conversation_id)
        .bind(input.channel_id)
        .bind(input.family_id)
        .bind(input.representative_id)
        .bind(input.parent_pubkey.as_slice())
        .bind(input.cycle_id)
        .bind(input.opened_by_pubkey.as_slice())
        .fetch_one(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO airhop_external_conversation_cycles (
                community_id, organization_id, conversation_id, id, sequence, started_by
             ) VALUES ($1, $2, $3, $4, 1, 'registration')",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(input.conversation_id)
        .bind(input.cycle_id)
        .execute(&mut *tx)
        .await?;
        let conversation = conversation_from_row(&row)?;
        tx.commit().await?;
        Ok(conversation)
    }

    /// Inserts a non-replaceable event and applies the parent conversation
    /// ownership rule in the same transaction. `None` delegates normal channels
    /// to the existing event path.
    pub async fn insert_airhop_external_conversation_event(
        &self,
        tenant: &TenantContext,
        event: &Event,
        channel_id: Uuid,
        thread_meta: Option<ThreadMetadataParams<'_>>,
        gateway_inbound: Option<&GatewayInboundContext>,
    ) -> Result<Option<ExternalConversationEventInsert>> {
        let community = tenant.community();
        let community_id = *community.as_uuid();
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query(
            "SELECT conversation.organization_id, conversation.id, conversation.channel_id,
                    conversation.family_id, conversation.representative_id,
                    conversation.parent_pubkey, conversation.current_cycle_id,
                    conversation.owner, conversation.hermes_paused,
                    conversation.control_version, conversation.created_at,
                    conversation.updated_at, deployment.id AS deployment_id,
                    deployment.agent_pubkey, deployment.enabled AS deployment_enabled,
                    deployment.paused AS deployment_paused,
                    agent_profile.display_name AS agent_display_name,
                    route.connection_id AS route_connection_id,
                    route.status AS route_status,
                    route.routing_version,
                    connection.connector_pubkey,
                    connection.status AS connection_status,
                    connection.hermes_enabled AS connection_hermes_enabled
             FROM airhop_external_conversations conversation
             JOIN airhop_agent_deployments deployment
               ON deployment.community_id = conversation.community_id
              AND deployment.organization_id = conversation.organization_id
              AND deployment.role = 'parent_administrator'
             LEFT JOIN users agent_profile
               ON agent_profile.community_id = deployment.community_id
              AND agent_profile.pubkey = deployment.agent_pubkey
             LEFT JOIN airhop_external_conversation_routes route
               ON route.community_id = conversation.community_id
              AND route.organization_id = conversation.organization_id
              AND route.conversation_id = conversation.id
             LEFT JOIN airhop_channel_connections connection
               ON connection.community_id = route.community_id
              AND connection.organization_id = route.organization_id
              AND connection.id = route.connection_id
             WHERE conversation.community_id = $1 AND conversation.channel_id = $2
               AND conversation.status = 'active'
             FOR UPDATE OF conversation",
        )
        .bind(community_id)
        .bind(channel_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(row) = row else {
            tx.rollback().await?;
            return Ok(None);
        };
        let conversation = conversation_from_row(&row)?;
        let agent_pubkey: Vec<u8> = row.try_get("agent_pubkey")?;
        let deployment_id: Uuid = row.try_get("deployment_id")?;
        let author = event.pubkey.to_bytes();
        let mut is_parent = author == conversation.parent_pubkey;
        let is_agent = author.as_slice() == agent_pubkey.as_slice();

        if let Some(gateway) = gateway_inbound {
            validate_and_record_gateway_inbound(
                &mut tx,
                community_id,
                &conversation,
                &row,
                event,
                gateway,
            )
            .await?;
            // The transport principal authors the signed Nostr envelope. The
            // external parent's display identity comes from trusted
            // conversation metadata, never from a fabricated parent key.
            is_parent = true;
        }

        let hermes_intent = if is_agent {
            let event_json = serde_json::to_value(event)?;
            let intent = sqlx::query(
                "SELECT intent.id, intent.turn_id, intent.sequence
                 FROM airhop_hermes_outbound_intents intent
                 WHERE intent.community_id = $1 AND intent.organization_id = $2
                   AND intent.deployment_id = $3 AND intent.conversation_id = $4
                   AND intent.event_id = $5 AND intent.event_json = $6
                   AND intent.status IN ('committed', 'published')",
            )
            .bind(community_id)
            .bind(conversation.organization_id)
            .bind(deployment_id)
            .bind(conversation.id)
            .bind(event.id.as_bytes().as_slice())
            .bind(event_json)
            .fetch_optional(&mut *tx)
            .await?;
            if intent.is_none() {
                return Err(DbError::AccessDenied(
                    "Hermes parent-channel output requires a committed supervisor intent"
                        .to_owned(),
                ));
            }
            intent
        } else {
            None
        };

        let (stored_event, was_inserted) = insert_event_with_thread_metadata_tx(
            &mut tx,
            community,
            event,
            Some(channel_id),
            thread_meta,
        )
        .await?;
        if !was_inserted {
            tx.commit().await?;
            return Ok(Some(ExternalConversationEventInsert {
                stored_event,
                was_inserted,
                projection: ExternalConversationEventProjection::StoredOnly,
            }));
        }

        let projection = if is_parent {
            let enabled: bool = row.try_get("deployment_enabled")?;
            let deployment_paused: bool = row.try_get("deployment_paused")?;
            let connection_status: Option<String> = row.try_get("connection_status")?;
            let route_status: Option<String> = row.try_get("route_status")?;
            let connection_hermes_enabled: Option<bool> =
                row.try_get("connection_hermes_enabled")?;
            let connection_allows_hermes = connection_status
                .as_deref()
                .is_none_or(|status| status == "active")
                && route_status
                    .as_deref()
                    .is_none_or(|status| status == "active")
                && connection_hermes_enabled.unwrap_or(true);
            let trigger = conversation.owner == ConversationOwner::Hermes
                && !conversation.hermes_paused
                && enabled
                && !deployment_paused
                && connection_allows_hermes;
            sqlx::query(
                "INSERT INTO airhop_external_inbound_receipts (
                    community_id, organization_id, conversation_id, event_id,
                    cycle_id, control_version, decision, reason
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            )
            .bind(community_id)
            .bind(conversation.organization_id)
            .bind(conversation.id)
            .bind(event.id.as_bytes().as_slice())
            .bind(conversation.current_cycle_id)
            .bind(conversation.control_version)
            .bind(if trigger { "trigger" } else { "suppressed" })
            .bind(if trigger {
                "hermes_owns_conversation"
            } else if !connection_allows_hermes {
                "channel_connection_not_available"
            } else {
                "hermes_not_available"
            })
            .execute(&mut *tx)
            .await?;
            if trigger {
                ExternalConversationEventProjection::TriggerHermes {
                    conversation_id: conversation.id,
                    cycle_id: conversation.current_cycle_id,
                    control_version: conversation.control_version,
                    family_id: conversation.family_id,
                    representative_id: conversation.representative_id,
                }
            } else {
                ExternalConversationEventProjection::StoredOnly
            }
        } else if is_agent {
            let intent = hermes_intent.as_ref().ok_or_else(|| {
                DbError::InvalidData("authorized Hermes intent disappeared".to_owned())
            })?;
            if mentioned_pubkeys(event).is_empty() {
                enqueue_external_message(
                    &mut tx,
                    community_id,
                    &conversation,
                    event,
                    "hermes",
                    Some(intent.try_get("id")?),
                    uuid_batch_key(intent.try_get("turn_id")?),
                    intent.try_get("sequence")?,
                )
                .await?;
            }
            sqlx::query(
                "UPDATE airhop_hermes_outbound_intents
                 SET status = 'published', published_at = COALESCE(published_at, now()),
                     updated_at = now()
                 WHERE community_id = $1 AND event_id = $2
                   AND status IN ('committed', 'published')",
            )
            .bind(community_id)
            .bind(event.id.as_bytes().as_slice())
            .execute(&mut *tx)
            .await?;
            ExternalConversationEventProjection::StoredOnly
        } else {
            let projection = apply_staff_control(
                &mut tx,
                community_id,
                &conversation,
                &agent_pubkey,
                row.try_get::<Option<String>, _>("agent_display_name")?
                    .as_deref(),
                event,
            )
            .await?;
            if projection == StaffEventProjection::ExternalOutbound {
                enqueue_external_message(
                    &mut tx,
                    community_id,
                    &conversation,
                    event,
                    "staff",
                    None,
                    *event.id.as_bytes(),
                    1,
                )
                .await?;
            }
            ExternalConversationEventProjection::StoredOnly
        };
        tx.commit().await?;
        Ok(Some(ExternalConversationEventInsert {
            stored_event,
            was_inserted,
            projection,
        }))
    }

    /// Commits the final-send fence before any signed Hermes event is allowed
    /// through ordinary Buzz ingestion. Human takeover and this commit lock the
    /// same conversation row, giving them a deterministic database order.
    pub async fn commit_airhop_hermes_reply(
        &self,
        tenant: &TenantContext,
        input: &CommitHermesReplyInput,
    ) -> Result<Vec<HermesOutboundIntent>> {
        validate_reply_shape(input)?;
        let community_id = *tenant.community().as_uuid();
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query(
            "SELECT turn.organization_id, turn.deployment_id, turn.channel_id,
                    turn.conversation_id, turn.cycle_id, turn.agent_pubkey,
                    turn.lease_token, turn.lease_expires_at, turn.status AS turn_status,
                    turn.outcome AS turn_outcome,
                    conversation.current_cycle_id, conversation.control_version,
                    conversation.owner, conversation.hermes_paused,
                    conversation.parent_pubkey, conversation.id,
                    conversation.family_id, conversation.representative_id,
                    conversation.created_at, conversation.updated_at,
                    deployment.enabled AS deployment_enabled,
                    deployment.paused AS deployment_paused
             FROM airhop_hermes_turn_receipts turn
             JOIN airhop_external_conversations conversation
               ON conversation.community_id = turn.community_id
              AND conversation.organization_id = turn.organization_id
              AND conversation.id = turn.conversation_id
             JOIN airhop_agent_deployments deployment
               ON deployment.community_id = turn.community_id
              AND deployment.organization_id = turn.organization_id
              AND deployment.id = turn.deployment_id
              AND deployment.agent_pubkey = turn.agent_pubkey
             JOIN airhop_organizations organization
               ON organization.community_id = turn.community_id
              AND organization.id = turn.organization_id
              AND organization.status = 'active'
             WHERE turn.community_id = $1 AND turn.id = $2
             FOR UPDATE OF deployment, conversation, turn",
        )
        .bind(community_id)
        .bind(input.turn_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| DbError::NotFound("AirHop Hermes turn".to_owned()))?;
        let stored_agent: Vec<u8> = row.try_get("agent_pubkey")?;
        let stored_lease: Uuid = row.try_get("lease_token")?;
        if stored_agent.as_slice() != input.agent_pubkey || stored_lease != input.lease_token {
            return Err(DbError::AccessDenied(
                "AirHop Hermes final reply belongs to another runtime".to_owned(),
            ));
        }
        let turn_status: String = row.try_get("turn_status")?;
        if turn_status == "completed" {
            let stored_outcome: Option<String> = row.try_get("turn_outcome")?;
            if stored_outcome.as_deref() != Some(input.outcome.trim()) {
                return Err(DbError::AirhopVersionConflict);
            }
            let existing = load_outbound_intents(&mut tx, community_id, input.turn_id).await?;
            ensure_intents_match(&existing, input)?;
            tx.commit().await?;
            return Ok(existing
                .into_iter()
                .map(|intent| HermesOutboundIntent {
                    event_id: intent.event_id,
                    sequence: intent.sequence,
                    status: intent.status,
                })
                .collect());
        }
        if turn_status != "leased" {
            return Err(DbError::AccessDenied(
                "AirHop Hermes turn is no longer active".to_owned(),
            ));
        }
        let lease_expires_at: DateTime<Utc> = row.try_get("lease_expires_at")?;
        let current_cycle_id: Uuid = row.try_get("current_cycle_id")?;
        let turn_cycle_id: Uuid = row.try_get("cycle_id")?;
        let owner: String = row.try_get("owner")?;
        let hermes_paused: bool = row.try_get("hermes_paused")?;
        let deployment_enabled: bool = row.try_get("deployment_enabled")?;
        let deployment_paused: bool = row.try_get("deployment_paused")?;
        if lease_expires_at <= Utc::now()
            || current_cycle_id != turn_cycle_id
            || owner != "hermes"
            || hermes_paused
            || !deployment_enabled
            || deployment_paused
        {
            return Err(DbError::AccessDenied(
                "AirHop Hermes final reply lost the live conversation lease".to_owned(),
            ));
        }
        let organization_id: Uuid = row.try_get("organization_id")?;
        let conversation_id: Uuid = row.try_get("conversation_id")?;
        let route = sqlx::query(
            "SELECT route.status AS route_status, connection.status AS connection_status,
                    connection.hermes_enabled
             FROM airhop_external_conversation_routes route
             JOIN airhop_channel_connections connection
               ON connection.community_id = route.community_id
              AND connection.organization_id = route.organization_id
              AND connection.id = route.connection_id
             WHERE route.community_id = $1 AND route.organization_id = $2
               AND route.conversation_id = $3
             FOR SHARE OF route, connection",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(conversation_id)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(route) = route {
            let route_status: String = route.try_get("route_status")?;
            let connection_status: String = route.try_get("connection_status")?;
            let hermes_enabled: bool = route.try_get("hermes_enabled")?;
            if route_status != "active" || connection_status != "active" || !hermes_enabled {
                return Err(DbError::AccessDenied(
                    "AirHop Hermes channel connection is not available".to_owned(),
                ));
            }
        }
        let channel_id: Uuid = row.try_get("channel_id")?;
        validate_signed_reply_events(input, channel_id)?;
        let hands_off = input.events.last().is_some_and(is_hermes_handoff_event);
        if hands_off {
            handoff::validate_handoff_targets(&mut tx, community_id, channel_id, input).await?;
        }
        let deployment_id: Uuid = row.try_get("deployment_id")?;
        let control_version: i64 = row.try_get("control_version")?;

        let mut intents = Vec::with_capacity(input.events.len());
        for (index, event) in input.events.iter().enumerate() {
            let sequence = i16::try_from(index + 1).map_err(|_| {
                DbError::InvalidData("AirHop Hermes reply sequence is invalid".to_owned())
            })?;
            let event_json = serde_json::to_value(event)?;
            sqlx::query(
                "INSERT INTO airhop_hermes_outbound_intents (
                    community_id, organization_id, deployment_id, turn_id,
                    conversation_id, cycle_id, control_version, sequence,
                    event_id, event_json
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
            )
            .bind(community_id)
            .bind(organization_id)
            .bind(deployment_id)
            .bind(input.turn_id)
            .bind(conversation_id)
            .bind(turn_cycle_id)
            .bind(control_version)
            .bind(sequence)
            .bind(event.id.as_bytes().as_slice())
            .bind(event_json)
            .execute(&mut *tx)
            .await?;
            intents.push(HermesOutboundIntent {
                event_id: *event.id.as_bytes(),
                sequence,
                status: "committed".to_owned(),
            });
        }
        sqlx::query(
            "UPDATE airhop_hermes_turn_receipts
             SET status = 'completed', outcome = $4, error_code = NULL,
                 finished_at = now(), updated_at = now()
             WHERE community_id = $1 AND id = $2 AND lease_token = $3",
        )
        .bind(community_id)
        .bind(input.turn_id)
        .bind(input.lease_token)
        .bind(input.outcome.trim())
        .execute(&mut *tx)
        .await?;
        if hands_off {
            let conversation = conversation_from_row(&row)?;
            take_over(&mut tx, community_id, &conversation, "hermes_handoff").await?;
        }
        tx.commit().await?;
        Ok(intents)
    }
}

#[derive(Debug)]
struct StoredOutboundIntent {
    event_id: [u8; 32],
    sequence: i16,
    event_json: Value,
    status: String,
}

async fn load_outbound_intents(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: Uuid,
    turn_id: Uuid,
) -> Result<Vec<StoredOutboundIntent>> {
    let rows = sqlx::query(
        "SELECT event_id, sequence, event_json, status
         FROM airhop_hermes_outbound_intents
         WHERE community_id = $1 AND turn_id = $2 ORDER BY sequence",
    )
    .bind(community_id)
    .bind(turn_id)
    .fetch_all(&mut **tx)
    .await?;
    rows.iter()
        .map(|row| {
            let event_id: Vec<u8> = row.try_get("event_id")?;
            let event_id = event_id.try_into().map_err(|_| {
                DbError::InvalidData("stored Hermes outbound event id is invalid".to_owned())
            })?;
            Ok(StoredOutboundIntent {
                event_id,
                sequence: row.try_get("sequence")?,
                event_json: row.try_get("event_json")?,
                status: row.try_get("status")?,
            })
        })
        .collect()
}

fn ensure_intents_match(
    existing: &[StoredOutboundIntent],
    input: &CommitHermesReplyInput,
) -> Result<()> {
    if existing.len() != input.events.len() {
        return Err(DbError::AirhopVersionConflict);
    }
    for (stored, event) in existing.iter().zip(&input.events) {
        if stored.event_id != *event.id.as_bytes()
            || stored.event_json != serde_json::to_value(event)?
        {
            return Err(DbError::AirhopVersionConflict);
        }
    }
    Ok(())
}

fn validate_reply_shape(input: &CommitHermesReplyInput) -> Result<()> {
    if input.turn_id.is_nil()
        || input.outcome.trim().is_empty()
        || input.outcome.trim().len() > 120
        || !(1..=4).contains(&input.events.len())
    {
        return Err(DbError::InvalidData(
            "AirHop Hermes final reply is invalid".to_owned(),
        ));
    }
    Ok(())
}

fn validate_signed_reply_events(input: &CommitHermesReplyInput, channel_id: Uuid) -> Result<()> {
    let channel = channel_id.to_string();
    let handoff = input.events.last().is_some_and(is_hermes_handoff_event);
    let parent_count = input.events.len() - usize::from(handoff);
    if !(1..=3).contains(&parent_count) || (input.outcome == "human_handoff") != handoff {
        return Err(DbError::InvalidData(
            "invalid Hermes handoff batch".to_owned(),
        ));
    }
    for (index, event) in input.events.iter().enumerate() {
        let tags = event
            .tags
            .iter()
            .map(|tag| tag.as_slice())
            .collect::<Vec<_>>();
        let channel_tags = tags
            .iter()
            .filter(|tag| tag.len() >= 2 && tag[0] == "h")
            .collect::<Vec<_>>();
        let recipient_tags = tags
            .iter()
            .filter(|tag| tag.len() >= 2 && tag[0] == "p")
            .collect::<Vec<_>>();
        if event.pubkey.to_bytes() != input.agent_pubkey
            || event.kind.as_u16() as u32 != buzz_core::kind::KIND_STREAM_MESSAGE
            || !event.verify_signature()
            || event.content.trim().is_empty()
            || event.content.len() > 16_000
            || channel_tags.len() != 1
            || channel_tags[0][1] != channel
            || tags.iter().any(|tag| !tag.is_empty() && tag[0] == "e")
            || if handoff && index == parent_count {
                recipient_tags.is_empty()
            } else {
                !recipient_tags.is_empty() || is_hermes_handoff_event(event)
            }
        {
            return Err(DbError::InvalidData(
                "AirHop Hermes reply must be a signed top-level message in the granted parent channel"
                    .to_owned(),
            ));
        }
    }
    Ok(())
}

async fn validate_and_record_gateway_inbound(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: Uuid,
    conversation: &ExternalConversation,
    route_row: &sqlx::postgres::PgRow,
    event: &Event,
    gateway: &GatewayInboundContext,
) -> Result<()> {
    if event.pubkey.to_bytes() != gateway.connector_pubkey {
        return Err(DbError::AccessDenied(
            "AirHop gateway inbound must be signed by the exact connector principal".to_owned(),
        ));
    }
    let route_connection_id: Option<Uuid> = route_row.try_get("route_connection_id")?;
    let route_status: Option<String> = route_row.try_get("route_status")?;
    let connection_status: Option<String> = route_row.try_get("connection_status")?;
    let connector_pubkey: Option<Vec<u8>> = route_row.try_get("connector_pubkey")?;
    if route_connection_id != Some(gateway.connection_id)
        || route_status.as_deref() == Some("disabled")
        || connection_status.as_deref() == Some("disabled")
        || connector_pubkey.as_deref() != Some(gateway.connector_pubkey.as_slice())
    {
        return Err(DbError::AccessDenied(
            "AirHop gateway inbound does not match the active provider route".to_owned(),
        ));
    }
    let inserted = sqlx::query(
        "INSERT INTO airhop_gateway_inbound_receipts (
            community_id, organization_id, connection_id, conversation_id,
            provider_event_digest, buzz_event_id, connector_pubkey
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT DO NOTHING
         RETURNING buzz_event_id",
    )
    .bind(community_id)
    .bind(conversation.organization_id)
    .bind(gateway.connection_id)
    .bind(conversation.id)
    .bind(gateway.provider_event_digest.as_slice())
    .bind(event.id.as_bytes().as_slice())
    .bind(gateway.connector_pubkey.as_slice())
    .fetch_optional(&mut **tx)
    .await?;
    if inserted.is_none() {
        let existing: Option<Vec<u8>> = sqlx::query_scalar(
            "SELECT buzz_event_id FROM airhop_gateway_inbound_receipts
             WHERE community_id = $1 AND organization_id = $2
               AND connection_id = $3 AND provider_event_digest = $4",
        )
        .bind(community_id)
        .bind(conversation.organization_id)
        .bind(gateway.connection_id)
        .bind(gateway.provider_event_digest.as_slice())
        .fetch_optional(&mut **tx)
        .await?;
        if existing.as_deref() != Some(event.id.as_bytes().as_slice()) {
            return Err(DbError::AccessDenied(
                "provider event id was replayed with different content".to_owned(),
            ));
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn enqueue_external_message(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: Uuid,
    conversation: &ExternalConversation,
    event: &Event,
    actor_kind: &str,
    source_intent_id: Option<Uuid>,
    batch_key: [u8; 32],
    sequence: i16,
) -> Result<()> {
    let route = sqlx::query(
        "SELECT route.connection_id, route.routing_version,
                route.status AS route_status, connection.status AS connection_status
         FROM airhop_external_conversation_routes route
         JOIN airhop_channel_connections connection
           ON connection.community_id = route.community_id
          AND connection.organization_id = route.organization_id
          AND connection.id = route.connection_id
         WHERE route.community_id = $1 AND route.organization_id = $2
           AND route.conversation_id = $3",
    )
    .bind(community_id)
    .bind(conversation.organization_id)
    .bind(conversation.id)
    .fetch_optional(&mut **tx)
    .await?;
    let Some(route) = route else {
        return Ok(());
    };
    let route_status: String = route.try_get("route_status")?;
    let connection_status: String = route.try_get("connection_status")?;
    let disabled = route_status == "disabled" || connection_status == "disabled";
    let connection_id: Uuid = route.try_get("connection_id")?;
    let routing_version: i64 = route.try_get("routing_version")?;
    sqlx::query(
        "INSERT INTO airhop_external_message_outbox (
            community_id, organization_id, conversation_id, connection_id,
            route_version, source_intent_id, buzz_event_id, event_json,
            actor_kind, batch_key, sequence, status, last_error_code
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (community_id, buzz_event_id) DO NOTHING",
    )
    .bind(community_id)
    .bind(conversation.organization_id)
    .bind(conversation.id)
    .bind(connection_id)
    .bind(routing_version)
    .bind(source_intent_id)
    .bind(event.id.as_bytes().as_slice())
    .bind(serde_json::to_value(event)?)
    .bind(actor_kind)
    .bind(batch_key.as_slice())
    .bind(sequence)
    .bind(if disabled { "superseded" } else { "pending" })
    .bind(disabled.then_some("route_disabled"))
    .execute(&mut **tx)
    .await?;
    Ok(())
}

fn uuid_batch_key(id: Uuid) -> [u8; 32] {
    let mut key = [0_u8; 32];
    key[..16].copy_from_slice(id.as_bytes());
    key[16..].copy_from_slice(id.as_bytes());
    key
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StaffEventProjection {
    ExternalOutbound,
    InternalOnly,
}

async fn apply_staff_control(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: Uuid,
    conversation: &ExternalConversation,
    agent_pubkey: &[u8],
    agent_display_name: Option<&str>,
    event: &Event,
) -> Result<StaffEventProjection> {
    let mentions = mentioned_pubkeys(event);
    let mentions_hermes = mentions
        .iter()
        .any(|value| value == &hex::encode(agent_pubkey));
    let control = if mentions_hermes {
        parse_hermes_control(&event.content, agent_display_name)
    } else {
        None
    };
    let projection = match control {
        Some(HermesControl::Resume) => {
            sqlx::query(
                "UPDATE airhop_external_conversation_cycles
                 SET ended_reason = COALESCE(ended_reason, 'staff_resume'),
                     ended_at = COALESCE(ended_at, now())
                 WHERE community_id = $1 AND conversation_id = $2 AND ended_at IS NULL",
            )
            .bind(community_id)
            .bind(conversation.id)
            .execute(&mut **tx)
            .await?;
            let next_cycle_id = Uuid::new_v4();
            let next_sequence: i64 = sqlx::query_scalar(
                "SELECT COALESCE(max(sequence), 0) + 1
                 FROM airhop_external_conversation_cycles
                 WHERE community_id = $1 AND conversation_id = $2",
            )
            .bind(community_id)
            .bind(conversation.id)
            .fetch_one(&mut **tx)
            .await?;
            sqlx::query(
                "INSERT INTO airhop_external_conversation_cycles (
                    community_id, organization_id, conversation_id, id, sequence,
                    started_by, trigger_event_id
                 ) VALUES ($1, $2, $3, $4, $5, 'staff_resume', $6)",
            )
            .bind(community_id)
            .bind(conversation.organization_id)
            .bind(conversation.id)
            .bind(next_cycle_id)
            .bind(next_sequence)
            .bind(event.id.as_bytes().as_slice())
            .execute(&mut **tx)
            .await?;
            sqlx::query(
                "UPDATE airhop_external_conversations
                 SET owner = 'hermes', hermes_paused = FALSE,
                     current_cycle_id = $3, control_version = control_version + 1,
                     updated_at = now()
                 WHERE community_id = $1 AND id = $2",
            )
            .bind(community_id)
            .bind(conversation.id)
            .bind(next_cycle_id)
            .execute(&mut **tx)
            .await?;
            cancel_active_turns(tx, community_id, conversation.id, "staff_resume").await?;
            // A resume is an authorized internal trigger, not a fabricated
            // parent message. The command stays internal, while its receipt
            // permits exactly one turn in the new ownership fence.
            sqlx::query(
                "INSERT INTO airhop_external_inbound_receipts (
                    community_id, organization_id, conversation_id, event_id,
                    cycle_id, control_version, decision, reason
                 ) VALUES ($1, $2, $3, $4, $5, $6, 'trigger', 'staff_resume')",
            )
            .bind(community_id)
            .bind(conversation.organization_id)
            .bind(conversation.id)
            .bind(event.id.as_bytes().as_slice())
            .bind(next_cycle_id)
            .bind(conversation.control_version + 1)
            .execute(&mut **tx)
            .await?;
            StaffEventProjection::InternalOnly
        }
        Some(HermesControl::Pause) => {
            take_over(tx, community_id, conversation, "staff_pause").await?;
            StaffEventProjection::InternalOnly
        }
        None if mentions.is_empty() => {
            take_over(tx, community_id, conversation, "human_takeover").await?;
            StaffEventProjection::ExternalOutbound
        }
        None => {
            // Unified product rule: any mentioned person/agent makes this an
            // internal staff message. It never changes ownership by itself.
            StaffEventProjection::InternalOnly
        }
    };
    Ok(projection)
}

async fn take_over(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: Uuid,
    conversation: &ExternalConversation,
    reason: &str,
) -> Result<()> {
    if conversation.owner == ConversationOwner::Human && conversation.hermes_paused {
        return Ok(());
    }
    sqlx::query(
        "UPDATE airhop_external_conversations
         SET owner = 'human', hermes_paused = TRUE,
             control_version = control_version + 1, updated_at = now()
         WHERE community_id = $1 AND id = $2",
    )
    .bind(community_id)
    .bind(conversation.id)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "UPDATE airhop_external_conversation_cycles
         SET ended_reason = $3, ended_at = now()
         WHERE community_id = $1 AND conversation_id = $2 AND ended_at IS NULL",
    )
    .bind(community_id)
    .bind(conversation.id)
    .bind(reason)
    .execute(&mut **tx)
    .await?;
    cancel_active_turns(tx, community_id, conversation.id, reason).await
}

async fn cancel_active_turns(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: Uuid,
    conversation_id: Uuid,
    reason: &str,
) -> Result<()> {
    sqlx::query(
        "UPDATE airhop_hermes_turn_receipts
         SET status = 'cancelled', error_code = $3,
             finished_at = now(), updated_at = now()
         WHERE community_id = $1 AND conversation_id = $2 AND status = 'leased'",
    )
    .bind(community_id)
    .bind(conversation_id)
    .bind(reason)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HermesControl {
    Resume,
    Pause,
}

fn normalized_control_text(content: &str) -> String {
    content
        .chars()
        .map(|character| {
            if character.is_alphanumeric() {
                character.to_lowercase().collect::<String>()
            } else {
                " ".to_owned()
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn parse_hermes_control(content: &str, display_name: Option<&str>) -> Option<HermesControl> {
    let normalized = normalized_control_text(content);
    // Identity is checked by the signed p tag at the call site. Only strip
    // the exact current profile name (or the stable product aliases), never
    // an arbitrary prefix followed by a control verb.
    let names = [display_name.unwrap_or(""), "Гермес", "Hermes"];
    let command = names
        .iter()
        .filter(|name| !name.trim().is_empty())
        .find_map(|name| normalized.strip_prefix(&format!("{} ", normalized_control_text(name))))?;
    match command {
        "продолжай" | "continue" | "resume" | "continuar" | "continue atendendo" => {
            Some(HermesControl::Resume)
        }
        "остановись" | "стоп" | "stop" | "pause" | "pausar" => {
            Some(HermesControl::Pause)
        }
        _ => None,
    }
}

fn mentioned_pubkeys(event: &Event) -> Vec<String> {
    event
        .tags
        .iter()
        .filter_map(|tag| {
            let values = tag.as_slice();
            (values.len() >= 2 && values[0] == "p").then(|| values[1].to_ascii_lowercase())
        })
        .collect()
}

fn validate_registration(input: &RegisterExternalConversationInput) -> Result<()> {
    if input.conversation_id.is_nil()
        || input.channel_id.is_nil()
        || input.cycle_id.is_nil()
        || input.expected_version < 0
        || input.family_id.is_some_and(|id| id.is_nil())
        || input.representative_id.is_some_and(|id| id.is_nil())
        || matches!(
            (input.family_id, input.representative_id),
            (Some(_), None) | (None, Some(_))
        )
    {
        return Err(DbError::InvalidData(
            "AirHop external conversation binding is invalid".to_owned(),
        ));
    }
    Ok(())
}

async fn require_owner_or_admin(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: Uuid,
    pubkey: [u8; 32],
) -> Result<()> {
    let allowed: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM relay_members
         WHERE community_id = $1 AND pubkey = $2 AND role IN ('owner', 'admin'))",
    )
    .bind(community_id)
    .bind(hex::encode(pubkey))
    .fetch_one(&mut **tx)
    .await?;
    if allowed {
        Ok(())
    } else {
        Err(DbError::AccessDenied(
            "only an owner or admin may register an external conversation".to_owned(),
        ))
    }
}

async fn validate_channel_binding(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: Uuid,
    channel_id: Uuid,
    parent_pubkey: &[u8; 32],
    agent_pubkey: &[u8],
) -> Result<()> {
    let valid: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM channels channel
         WHERE channel.community_id = $1 AND channel.id = $2
           AND channel.channel_type = 'stream' AND channel.visibility = 'private'
           AND channel.archived_at IS NULL AND channel.deleted_at IS NULL
           AND EXISTS(SELECT 1 FROM channel_members parent
             WHERE parent.community_id = channel.community_id
               AND parent.channel_id = channel.id AND parent.pubkey = $3
               AND parent.removed_at IS NULL)
           AND EXISTS(SELECT 1 FROM channel_members agent
             WHERE agent.community_id = channel.community_id
               AND agent.channel_id = channel.id AND agent.pubkey = $4
               AND agent.role = 'bot' AND agent.removed_at IS NULL))",
    )
    .bind(community_id)
    .bind(channel_id)
    .bind(parent_pubkey.as_slice())
    .bind(agent_pubkey)
    .fetch_one(&mut **tx)
    .await?;
    if valid {
        Ok(())
    } else {
        Err(DbError::AccessDenied(
            "external conversation requires a private channel with the parent and Hermes"
                .to_owned(),
        ))
    }
}

async fn validate_family_binding(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: Uuid,
    organization_id: Uuid,
    family_id: Option<Uuid>,
    representative_id: Option<Uuid>,
) -> Result<()> {
    let (Some(family_id), Some(representative_id)) = (family_id, representative_id) else {
        return Ok(());
    };
    let valid: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM airhop_representatives representative
         JOIN airhop_families family
           ON family.community_id = representative.community_id
          AND family.organization_id = representative.organization_id
          AND family.id = representative.family_id
         WHERE representative.community_id = $1
           AND representative.organization_id = $2
           AND representative.family_id = $3 AND representative.id = $4
           AND representative.status = 'active' AND family.status = 'active')",
    )
    .bind(community_id)
    .bind(organization_id)
    .bind(family_id)
    .bind(representative_id)
    .fetch_one(&mut **tx)
    .await?;
    if valid {
        Ok(())
    } else {
        Err(DbError::AccessDenied(
            "external conversation Family binding is not active".to_owned(),
        ))
    }
}

fn conversation_from_row(row: &sqlx::postgres::PgRow) -> Result<ExternalConversation> {
    let parent_pubkey: Vec<u8> = row.try_get("parent_pubkey")?;
    let parent_pubkey: [u8; 32] = parent_pubkey.try_into().map_err(|_| {
        DbError::InvalidData("stored external conversation parent pubkey is invalid".to_owned())
    })?;
    Ok(ExternalConversation {
        organization_id: row.try_get("organization_id")?,
        id: row.try_get("id")?,
        channel_id: row.try_get("channel_id")?,
        family_id: row.try_get("family_id")?,
        representative_id: row.try_get("representative_id")?,
        parent_pubkey,
        current_cycle_id: row.try_get("current_cycle_id")?,
        owner: ConversationOwner::parse(row.try_get("owner")?)?,
        hermes_paused: row.try_get("hermes_paused")?,
        control_version: row.try_get("control_version")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::{EventBuilder, Keys, Kind, Tag};

    #[test]
    fn only_explicit_hermes_commands_change_control() {
        assert_eq!(
            parse_hermes_control("@Гермес, продолжай", None),
            Some(HermesControl::Resume)
        );
        assert_eq!(
            parse_hermes_control("Hermes: pause", None),
            Some(HermesControl::Pause)
        );
        assert_eq!(parse_hermes_control("Гермес, что ты думаешь?", None), None);
        assert_eq!(parse_hermes_control("продолжай", None), None);
        for (name, command) in [
            ("Администратор Гермес", "продолжай"),
            ("Administrator Hermes", "continue"),
            ("Administrador Hermes", "continuar"),
            ("Помощник центра", "продолжай"),
        ] {
            assert_eq!(
                parse_hermes_control(&format!("@{name}, {command}!"), Some(name)),
                Some(HermesControl::Resume)
            );
        }
        assert_eq!(
            parse_hermes_control("@Другой сотрудник продолжай", Some("Гермес")),
            None
        );
        assert_eq!(
            parse_hermes_control("@Гермес, родитель сказал продолжай", Some("Гермес")),
            None
        );
    }

    #[test]
    fn final_reply_shape_is_signed_flat_and_channel_scoped() {
        let keys = Keys::generate();
        let channel_id = Uuid::new_v4();
        let channel = channel_id.to_string();
        let event = EventBuilder::new(Kind::Custom(9), "Всё готово.")
            .tags([Tag::parse(["h", channel.as_str()]).unwrap()])
            .sign_with_keys(&keys)
            .unwrap();
        let input = CommitHermesReplyInput {
            turn_id: Uuid::new_v4(),
            lease_token: Uuid::new_v4(),
            agent_pubkey: keys.public_key().to_bytes(),
            outcome: "waiting_parent".into(),
            events: vec![event],
        };
        validate_reply_shape(&input).unwrap();
        validate_signed_reply_events(&input, channel_id).unwrap();

        let reply = EventBuilder::new(Kind::Custom(9), "nested")
            .tags([
                Tag::parse(["h", channel.as_str()]).unwrap(),
                Tag::parse(["e", "ab"]).unwrap(),
            ])
            .sign_with_keys(&keys)
            .unwrap();
        let nested = CommitHermesReplyInput {
            events: vec![reply],
            ..input
        };
        assert!(validate_signed_reply_events(&nested, channel_id).is_err());
    }
}
