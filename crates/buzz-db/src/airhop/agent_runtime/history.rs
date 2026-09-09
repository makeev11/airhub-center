//! Bounded transcript derived only from a validated runtime lease.

use super::*;

pub(super) async fn resume_has_no_pending_parent(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community: Uuid,
    turn: &HermesTurnReceipt,
) -> Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM airhop_external_inbound_receipts receipt
         JOIN events source ON source.community_id=receipt.community_id AND source.id=receipt.event_id
         JOIN airhop_external_conversations conversation ON conversation.community_id=receipt.community_id
          AND conversation.id=receipt.conversation_id
         WHERE receipt.community_id=$1 AND receipt.event_id=$2 AND receipt.conversation_id=$3
          AND receipt.reason='staff_resume'
          AND NOT EXISTS (SELECT 1 FROM events parent
            WHERE parent.community_id=source.community_id AND parent.channel_id=source.channel_id
             AND parent.kind=9 AND parent.deleted_at IS NULL AND parent.received_at<=source.received_at
             AND (NOT conversation.threaded OR parent.id=conversation.root_event_id OR EXISTS (
               SELECT 1 FROM thread_metadata thread WHERE thread.community_id=parent.community_id
                AND thread.event_id=parent.id
                AND COALESCE(thread.root_event_id,thread.parent_event_id)=conversation.root_event_id))
             AND (parent.pubkey=conversation.parent_pubkey OR EXISTS (
               SELECT 1 FROM airhop_gateway_inbound_receipts gateway WHERE gateway.community_id=parent.community_id
                AND gateway.conversation_id=conversation.id AND gateway.buzz_event_id=parent.id))
             AND NOT EXISTS (SELECT 1 FROM airhop_external_message_outbox reply
               WHERE reply.community_id=parent.community_id AND reply.conversation_id=conversation.id
                AND reply.status='delivered' AND reply.delivered_at>parent.received_at
                AND reply.delivered_at<=source.received_at)))",
    ).bind(community).bind(turn.source_message_id.as_slice()).bind(turn.conversation_id)
    .fetch_one(&mut **tx).await.map_err(Into::into)
}

impl Db {
    /// Reads at most 40 chat messages in this lease's conversation. Incoming
    /// messages stop at the source event; delivered replies additionally extend
    /// through acquisition of this lease attempt. The server-owned watermark is
    /// stable across context reads, with started_at as a legacy fallback.
    /// No caller-selected channel, cross-family search or deleted content.
    pub async fn get_airhop_parent_turn_history(
        &self,
        tenant: &TenantContext,
        turn_id: Uuid,
        lease_token: Uuid,
        agent_pubkey: [u8; 32],
    ) -> Result<serde_json::Value> {
        let rows = sqlx::query(
            "SELECT encode(message.id, 'hex') AS id,
                    message.received_at,
                    left(message.content, 2000) AS content,
                    length(message.content) > 2000 AS truncated,
                    CASE WHEN message.pubkey = conversation.parent_pubkey OR EXISTS (
                         SELECT 1 FROM airhop_gateway_inbound_receipts gateway
                         WHERE gateway.community_id=message.community_id AND gateway.conversation_id=conversation.id
                           AND gateway.buzz_event_id=message.id) THEN 'parent'
                         WHEN message.pubkey = turn.agent_pubkey THEN 'hermes'
                         ELSE 'staff' END AS actor,
                    CASE WHEN message.pubkey = conversation.parent_pubkey OR EXISTS (
                         SELECT 1 FROM airhop_gateway_inbound_receipts gateway
                         WHERE gateway.community_id=message.community_id AND gateway.conversation_id=conversation.id
                           AND gateway.buzz_event_id=message.id) THEN FALSE
                         ELSE NOT EXISTS (
                            SELECT 1 FROM airhop_external_message_outbox outbound
                            WHERE outbound.community_id = message.community_id
                              AND outbound.conversation_id = conversation.id
                              AND outbound.buzz_event_id = message.id
                              AND outbound.status = 'delivered'
                              AND outbound.delivered_at <= snapshot.reply_cutoff
                         ) END AS internal
             FROM airhop_hermes_turn_receipts turn
             CROSS JOIN LATERAL (SELECT COALESCE(
               (turn.configuration_snapshot->>'historySnapshotAt')::TIMESTAMPTZ,
               turn.started_at) AS reply_cutoff) snapshot
             JOIN airhop_external_conversations conversation
               ON conversation.community_id = turn.community_id
              AND conversation.organization_id = turn.organization_id
              AND conversation.id = turn.conversation_id
              AND conversation.channel_id = turn.channel_id
              AND conversation.current_cycle_id = turn.cycle_id
              AND conversation.owner = 'hermes' AND NOT conversation.hermes_paused
             JOIN events source ON source.community_id = turn.community_id
              AND source.id = turn.source_message_id AND source.channel_id = turn.channel_id
             JOIN events message ON message.community_id = turn.community_id
              AND message.channel_id = turn.channel_id AND message.kind = 9
              AND message.deleted_at IS NULL
              AND (NOT conversation.threaded OR message.id=conversation.root_event_id OR EXISTS (
                SELECT 1 FROM thread_metadata thread WHERE thread.community_id=message.community_id
                 AND thread.event_id=message.id
                 AND COALESCE(thread.root_event_id,thread.parent_event_id)=conversation.root_event_id))
              AND message.received_at <= GREATEST(source.received_at, snapshot.reply_cutoff)
              AND (message.received_at <= source.received_at OR (
                message.received_at <= snapshot.reply_cutoff AND EXISTS (
                  SELECT 1 FROM airhop_external_message_outbox outbound
                  WHERE outbound.community_id = message.community_id
                    AND outbound.conversation_id = conversation.id
                    AND outbound.buzz_event_id = message.id
                    AND outbound.actor_kind IN ('hermes', 'staff')
                    AND outbound.status = 'delivered'
                    AND outbound.delivered_at <= snapshot.reply_cutoff)))
             WHERE turn.community_id = $1 AND turn.id = $2 AND turn.lease_token = $3
               AND turn.agent_pubkey = $4 AND turn.status = 'leased'
               AND turn.lease_expires_at > now()
             ORDER BY message.received_at DESC, message.id DESC LIMIT 40",
        )
        .bind(tenant.community().as_uuid())
        .bind(turn_id)
        .bind(lease_token)
        .bind(agent_pubkey.as_slice())
        .fetch_all(&self.pool)
        .await?;
        let messages = rows
            .iter()
            .rev()
            .map(|row| -> Result<_> {
                Ok(json!({
                    "id": row.try_get::<String, _>("id")?,
                    "receivedAt": row.try_get::<DateTime<Utc>, _>("received_at")?,
                    "actor": row.try_get::<String, _>("actor")?,
                    "internal": row.try_get::<bool, _>("internal")?,
                    "content": row.try_get::<String, _>("content")?,
                    "truncated": row.try_get::<bool, _>("truncated")?,
                }))
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(json!({"messages": messages, "limit": 40, "contentIsUntrusted": true}))
    }
}
