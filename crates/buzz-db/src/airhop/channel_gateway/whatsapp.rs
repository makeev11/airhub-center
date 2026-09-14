//! Connection-scoped asynchronous WhatsApp delivery acknowledgements.
use super::*;

impl Db {
    /// Applies a provider receipt only to the exact connection and recipient.
    /// Returns false when acceptance has not yet arrived, so the gateway retries.
    #[allow(clippy::too_many_arguments)]
    pub async fn record_airhop_whatsapp_status(
        &self,
        tenant: &TenantContext,
        connector_pubkey: [u8; 32],
        connection_id: Uuid,
        provider_message_id: &str,
        recipient: &str,
        status: &str,
        timestamp: i64,
        error_code: Option<&str>,
    ) -> Result<bool> {
        if provider_message_id.is_empty()
            || provider_message_id.len() > 300
            || !(5..=20).contains(&recipient.len())
            || !recipient.bytes().all(|c| c.is_ascii_digit())
            || !matches!(status, "sent" | "delivered" | "read" | "failed")
            || timestamp < 0
            || timestamp > chrono::Utc::now().timestamp() + 300
            || error_code.is_some_and(|c| !is_error_code(c))
        {
            return Err(DbError::InvalidData("invalid WhatsApp receipt".into()));
        }
        let community_id = *tenant.community().as_uuid();
        let mut tx = self.pool.begin().await?;
        let authorized:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM airhop_channel_connections WHERE community_id=$1 AND id=$2 AND connector_pubkey=$3 AND provider='whatsapp_cloud')")
            .bind(community_id).bind(connection_id).bind(connector_pubkey.as_slice()).fetch_one(&mut *tx).await?;
        if !authorized {
            return Err(DbError::AccessDenied(
                "WhatsApp connection does not belong to connector".into(),
            ));
        }
        let row=sqlx::query("SELECT o.id,o.status,o.provider_status FROM airhop_external_message_outbox o WHERE o.community_id=$1 AND o.connection_id=$2 AND o.provider_message_id=$3 AND o.provider_recipient=$4 FOR UPDATE OF o")
            .bind(community_id).bind(connection_id).bind(provider_message_id).bind(recipient).fetch_optional(&mut *tx).await?;
        let Some(row) = row else {
            return Ok(false);
        };
        let id: Uuid = row.try_get("id")?;
        sqlx::query("INSERT INTO airhop_whatsapp_delivery_receipts(community_id,connection_id,outbox_id,provider_message_id,provider_status,provider_timestamp,error_code) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING")
            .bind(community_id).bind(connection_id).bind(id).bind(provider_message_id).bind(status).bind(timestamp).bind(error_code).execute(&mut *tx).await?;
        let current: String = row.try_get("status")?;
        let provider: Option<String> = row.try_get("provider_status")?;
        // Positive delivery evidence wins over out-of-order failure; read never regresses.
        let apply = match status {
            "sent" => current == "accepted" && provider.as_deref() == Some("accepted"),
            "failed" => current == "accepted",
            "delivered" => {
                matches!(current.as_str(), "accepted" | "failed")
                    && provider.as_deref() != Some("read")
            }
            "read" => {
                matches!(current.as_str(), "accepted" | "failed" | "delivered")
                    && provider.as_deref() != Some("read")
            }
            _ => false,
        };
        if apply {
            sqlx::query("UPDATE airhop_external_message_outbox SET provider_status=$3,status=CASE WHEN $3 IN ('delivered','read') THEN 'delivered' WHEN $3='failed' THEN 'failed' ELSE status END,delivered_at=CASE WHEN $3 IN ('delivered','read') THEN coalesce(delivered_at,to_timestamp($4::double precision)) ELSE delivered_at END,read_at=CASE WHEN $3='read' THEN to_timestamp($4::double precision) ELSE read_at END,failed_at=CASE WHEN $3='failed' THEN to_timestamp($4::double precision) ELSE NULL END,last_error_code=CASE WHEN $3='failed' THEN coalesce($5,'whatsapp_delivery_failed') ELSE NULL END,updated_at=now() WHERE community_id=$1 AND id=$2")
                .bind(community_id).bind(id).bind(status).bind(timestamp).bind(error_code).execute(&mut *tx).await?;
            if matches!(status, "delivered" | "read") {
                sqlx::query("UPDATE airhop_external_conversations v SET queue_status='waiting_parent',version=v.version+1,updated_at=now() FROM airhop_external_message_outbox o WHERE o.community_id=$1 AND o.id=$2 AND v.community_id=o.community_id AND v.id=o.conversation_id AND v.queue_status='waiting_staff' AND v.updated_at<=o.created_at AND (o.actor_kind='staff' OR NOT v.hermes_paused) AND (v.last_inbound_at IS NULL OR v.last_inbound_at<=o.created_at)")
                    .bind(community_id).bind(id).execute(&mut *tx).await?;
            }
        }
        if apply && status == "failed" {
            handoff_failed_delivery(&mut tx, community_id, id).await?;
        }
        tx.commit().await?;
        Ok(true)
    }
}

/// Escalates only the current failed reply; old receipts never steal a newer turn.
pub(super) async fn handoff_failed_delivery(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: Uuid,
    outbox_id: Uuid,
) -> Result<()> {
    let id:Option<Uuid>=sqlx::query_scalar("SELECT v.id FROM airhop_external_conversations v JOIN airhop_external_message_outbox o ON o.community_id=v.community_id AND o.conversation_id=v.id JOIN airhop_channel_connections c ON c.community_id=o.community_id AND c.id=o.connection_id WHERE o.community_id=$1 AND o.id=$2 AND o.status='failed' AND c.provider='whatsapp_cloud' AND v.queue_status<>'resolved' AND (v.last_inbound_at IS NULL OR v.last_inbound_at<=o.created_at) AND NOT EXISTS(SELECT 1 FROM airhop_external_message_outbox newer WHERE newer.community_id=o.community_id AND newer.conversation_id=o.conversation_id AND (newer.created_at,newer.id)>(o.created_at,o.id)) FOR UPDATE OF v")
        .bind(community_id).bind(outbox_id).fetch_optional(&mut **tx).await?;
    if let Some(id) = id {
        super::super::external_conversation::take_over_conversation(
            tx,
            community_id,
            id,
            "whatsapp_delivery_failed",
        )
        .await?;
        sqlx::query("UPDATE airhop_external_conversations SET queue_status='waiting_staff',version=version+1,updated_at=now() WHERE community_id=$1 AND id=$2").bind(community_id).bind(id).execute(&mut **tx).await?;
    }
    Ok(())
}
