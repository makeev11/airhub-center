//! Server authorization fence for optional multilingual staff-intent inference.

use super::*;
use serde::Deserialize;

/// The classifier can select an intention, never author an event or pick a scope.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StaffControlIntent {
    /// Clearly asks Hermes to resume serving this parent now.
    Resume,
    /// Clearly asks Hermes to stop serving this parent now.
    Pause,
    /// Questions, quotes, hypotheticals and ambiguous messages.
    Other,
}

/// Data-minimized, server-authorized classification input (no parent history).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffControlCandidate {
    /// Exact signed staff message, already persisted in this community.
    pub event_id: String,
    /// Ownership version that must still match when applying the result.
    pub control_version: i64,
    /// Staff message, treated as untrusted classifier input.
    pub content: String,
}

impl Db {
    /// Returns or consumes an unresolved staff mention. Both phases verify the
    /// sender's staff authority and lock the current conversation. Stale input,
    /// parents, transport principals and other agents cannot resume Hermes.
    pub async fn resolve_airhop_staff_control(
        &self,
        tenant: &TenantContext,
        event_id: [u8; 32],
        agent_pubkey: [u8; 32],
        decision: Option<(i64, StaffControlIntent)>,
    ) -> Result<Option<StaffControlCandidate>> {
        self.resolve_airhop_staff_control_batch(
            tenant,
            &[event_id],
            agent_pubkey,
            decision.map(|(version, intent)| (event_id, version, intent)),
        )
        .await
    }

    /// Resolve the newest eligible staff command in one same-channel batch.
    /// A later parent input does not hide a command; a later staff input does.
    pub async fn resolve_airhop_staff_control_batch(
        &self,
        tenant: &TenantContext,
        event_ids: &[[u8; 32]],
        agent_pubkey: [u8; 32],
        decision: Option<([u8; 32], i64, StaffControlIntent)>,
    ) -> Result<Option<StaffControlCandidate>> {
        let Some(anchor) = event_ids.first().filter(|_| event_ids.len() <= 500) else {
            return Err(DbError::InvalidData("invalid staff control batch".into()));
        };
        if decision
            .as_ref()
            .is_some_and(|(id, _, _)| !event_ids.contains(id))
        {
            return Err(DbError::AccessDenied("staff command outside batch".into()));
        }
        let ids: Vec<Vec<u8>> = event_ids.iter().map(|id| id.to_vec()).collect();
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query(
            "SELECT conversation.*, message.id AS command_id, message.content, message.pubkey, message.kind,
                    message.tags, message.sig, extract(epoch FROM message.created_at)::BIGINT AS timestamp
             FROM airhop_external_inbound_receipts receipt
             JOIN airhop_external_conversations conversation
               ON conversation.community_id = receipt.community_id
              AND conversation.organization_id = receipt.organization_id
              AND conversation.id = receipt.conversation_id
             JOIN airhop_agent_deployments deployment
               ON deployment.community_id = conversation.community_id
              AND deployment.organization_id = conversation.organization_id
              AND deployment.role = 'parent_administrator'
             JOIN events message ON message.community_id = receipt.community_id
              AND message.id = receipt.event_id AND message.channel_id = conversation.channel_id
             JOIN channel_members member ON member.community_id = message.community_id
              AND member.channel_id = message.channel_id AND member.pubkey = message.pubkey
              AND member.removed_at IS NULL AND member.role <> 'bot'
             JOIN users profile ON profile.community_id = message.community_id AND profile.pubkey = message.pubkey
              AND profile.deactivated_at IS NULL
             JOIN relay_members staff ON staff.community_id = message.community_id
              AND staff.pubkey = encode(message.pubkey, 'hex') AND staff.role IN ('owner', 'admin')
             JOIN events anchor ON anchor.community_id=message.community_id
              AND anchor.id=$4 AND anchor.channel_id=message.channel_id AND anchor.deleted_at IS NULL
             WHERE receipt.community_id = $1 AND receipt.event_id = ANY($2::bytea[])
               AND ($5::bytea IS NULL OR receipt.event_id=$5)
               AND receipt.reason = 'staff_control_pending' AND receipt.decision = 'suppressed'
               AND receipt.control_version = conversation.control_version
               AND receipt.cycle_id = conversation.current_cycle_id
               AND deployment.agent_pubkey = $3 AND deployment.enabled AND NOT deployment.paused
               AND conversation.status = 'active' AND message.deleted_at IS NULL AND message.kind = 9
               AND message.received_at > now() - interval '10 minutes'
               AND NOT EXISTS (SELECT 1 FROM events newer
                 JOIN relay_members newer_staff ON newer_staff.community_id=newer.community_id
                  AND newer_staff.pubkey=encode(newer.pubkey, 'hex') AND newer_staff.role IN ('owner', 'admin')
                 WHERE newer.community_id=message.community_id AND newer.channel_id=message.channel_id
                  AND newer.kind=9 AND newer.deleted_at IS NULL AND newer.received_at>message.received_at)
               AND message.pubkey <> conversation.parent_pubkey AND message.pubkey <> $3
               AND NOT EXISTS (SELECT 1 FROM airhop_gateway_inbound_receipts gateway
                 WHERE gateway.community_id = message.community_id AND gateway.buzz_event_id = message.id)
               AND NOT EXISTS (SELECT 1 FROM airhop_external_conversation_routes route
                 JOIN airhop_channel_connections connection ON connection.community_id = route.community_id
                  AND connection.organization_id = route.organization_id AND connection.id = route.connection_id
                 WHERE route.community_id = conversation.community_id AND route.conversation_id = conversation.id
                  AND (route.status <> 'active' OR connection.status <> 'active' OR NOT connection.hermes_enabled))
             ORDER BY message.received_at DESC, message.id DESC LIMIT 1
             FOR UPDATE OF conversation",
        ).bind(tenant.community().as_uuid()).bind(ids).bind(agent_pubkey.as_slice())
        .bind(anchor.as_slice()).bind(decision.as_ref().map(|(id, _, _)| id.to_vec()))
        .fetch_optional(&mut *tx).await?;
        let Some(row) = row else {
            return Ok(None);
        };
        let conversation = conversation_from_row(&row)?;
        let event_id: Vec<u8> = row.try_get("command_id")?;
        let content: String = row.try_get("content")?;
        if content.chars().count() > 1000 {
            return Ok(None);
        }
        let event: Event = serde_json::from_value(serde_json::json!({
            "id": hex::encode(&event_id), "pubkey": hex::encode(row.try_get::<Vec<u8>, _>("pubkey")?),
            "created_at": row.try_get::<i64, _>("timestamp")?, "kind": row.try_get::<i32, _>("kind")?,
            "content": content, "tags": row.try_get::<Value, _>("tags")?,
            "sig": hex::encode(row.try_get::<Vec<u8>, _>("sig")?),
        }))?;
        if mentioned_pubkeys(&event) != vec![hex::encode(agent_pubkey)] {
            return Ok(None);
        }
        if let Some((_, version, intent)) = decision {
            if version != conversation.control_version {
                return Err(DbError::AirhopVersionConflict);
            }
            match intent {
                StaffControlIntent::Resume => {
                    sqlx::query("DELETE FROM airhop_external_inbound_receipts WHERE community_id=$1 AND event_id=$2 AND reason='staff_control_pending'")
                        .bind(tenant.community().as_uuid()).bind(event_id.as_slice()).execute(&mut *tx).await?;
                    apply_staff_control_decision(
                        &mut tx,
                        *tenant.community().as_uuid(),
                        &conversation,
                        &event,
                        Some(HermesControl::Resume),
                    )
                    .await?;
                    // Parent inputs may arrive while classification is running.
                    // Re-fence only authenticated parent receipts after this
                    // command in the old ownership version, never staff text,
                    // older questions or inputs from another conversation.
                    sqlx::query(
                        "UPDATE airhop_external_inbound_receipts receipt
                         SET cycle_id=current.current_cycle_id, control_version=current.control_version,
                             decision='trigger', reason='hermes_owns_conversation'
                         FROM airhop_external_conversations current, events parent, events command
                         WHERE receipt.community_id=$1 AND receipt.conversation_id=$2
                          AND receipt.cycle_id=$3 AND receipt.control_version=$4
                          AND receipt.reason IN ('hermes_not_available', 'hermes_owns_conversation')
                          AND current.community_id=receipt.community_id AND current.id=receipt.conversation_id
                          AND parent.community_id=receipt.community_id AND parent.id=receipt.event_id
                          AND parent.channel_id=current.channel_id AND parent.kind=9 AND parent.deleted_at IS NULL
                          AND command.community_id=receipt.community_id AND command.id=$5
                          AND parent.received_at>command.received_at
                          AND (parent.pubkey=current.parent_pubkey OR EXISTS (
                            SELECT 1 FROM airhop_gateway_inbound_receipts gateway
                            WHERE gateway.community_id=parent.community_id AND gateway.conversation_id=current.id
                              AND gateway.buzz_event_id=parent.id))"
                    ).bind(tenant.community().as_uuid()).bind(conversation.id)
                    .bind(conversation.current_cycle_id).bind(conversation.control_version)
                    .bind(event_id.as_slice()).execute(&mut *tx).await?;
                }
                StaffControlIntent::Pause | StaffControlIntent::Other => {
                    sqlx::query("UPDATE airhop_external_inbound_receipts SET reason=$3 WHERE community_id=$1 AND event_id=$2 AND reason='staff_control_pending'")
                        .bind(tenant.community().as_uuid()).bind(event_id.as_slice())
                        .bind(if intent == StaffControlIntent::Pause { "staff_pause" } else { "staff_internal" })
                        .execute(&mut *tx).await?;
                    if intent == StaffControlIntent::Pause {
                        apply_staff_control_decision(
                            &mut tx,
                            *tenant.community().as_uuid(),
                            &conversation,
                            &event,
                            Some(HermesControl::Pause),
                        )
                        .await?;
                    }
                }
            }
            tx.commit().await?;
            return Ok(None);
        }
        tx.commit().await?;
        Ok(Some(StaffControlCandidate {
            event_id: hex::encode(event_id),
            control_version: conversation.control_version,
            content,
        }))
    }
}
