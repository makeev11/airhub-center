//! Gateway retries across explicit legacy cutover, before generic archive rejection.
use super::super::channel_gateway::GatewayInboundContext;
use super::*;
impl Db {
    /// Exact accepted-event replay stays acknowledged after migration/disable. An
    /// unaccepted candidate aimed at a migrated location must resolve and re-sign.
    pub async fn check_client_gateway_retry(
        &self,
        tenant: &TenantContext,
        event: &Event,
        gateway: &GatewayInboundContext,
    ) -> Result<bool> {
        if event.pubkey.to_bytes() != gateway.connector_pubkey || event.verify().is_err() {
            return Err(DbError::AccessDenied(
                "invalid gateway event signature".into(),
            ));
        }
        let accepted:Option<Vec<u8>>=sqlx::query_scalar("SELECT g.buzz_event_id FROM airhop_gateway_inbound_receipts g JOIN airhop_channel_connections c ON c.community_id=g.community_id AND c.id=g.connection_id WHERE g.community_id=$1 AND g.connection_id=$2 AND g.provider_event_digest=$3 AND g.connector_pubkey=$4 AND c.connector_pubkey=$4")
            .bind(tenant.community().as_uuid()).bind(gateway.connection_id).bind(gateway.provider_event_digest.as_slice()).bind(gateway.connector_pubkey.as_slice()).fetch_optional(&self.pool).await?;
        if let Some(id) = accepted {
            return if id.as_slice() == event.id.as_bytes() {
                Ok(true)
            } else {
                Err(DbError::AccessDenied(
                    "provider event already accepted with a different signed event".into(),
                ))
            };
        }
        let tags: Vec<_> = event
            .tags
            .iter()
            .filter(|tag| {
                tag.as_slice()
                    .first()
                    .is_some_and(|v| v == "airhop-conversation")
            })
            .collect();
        let channels: Vec<_> = event
            .tags
            .iter()
            .filter(|tag| tag.as_slice().first().is_some_and(|v| v == "h"))
            .collect();
        if tags.len() != 1 || channels.len() != 1 {
            return Ok(false);
        }
        let id = tags[0]
            .as_slice()
            .get(1)
            .and_then(|v| Uuid::parse_str(v).ok());
        let channel = channels[0]
            .as_slice()
            .get(1)
            .and_then(|v| Uuid::parse_str(v).ok());
        if let (Some(id), Some(channel)) = (id, channel) {
            let migrated:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM airhop_conversation_legacy_locations l JOIN airhop_external_conversation_routes r ON r.community_id=l.community_id AND r.conversation_id=l.conversation_id JOIN airhop_channel_connections c ON c.community_id=r.community_id AND c.id=r.connection_id WHERE l.community_id=$1 AND l.conversation_id=$2 AND l.channel_id=$3 AND r.connection_id=$4 AND c.connector_pubkey=$5)")
                .bind(tenant.community().as_uuid()).bind(id).bind(channel).bind(gateway.connection_id).bind(gateway.connector_pubkey.as_slice()).fetch_one(&self.pool).await?;
            if migrated {
                return Err(DbError::AccessDenied("airhop_thread_changed".into()));
            }
        }
        Ok(false)
    }
}
