//! Compatibility cleanup for retired per-message staff alerts.
use super::*;
impl Db {
    /// Retire a bounded batch of legacy inbound alerts without creating messages.
    ///
    /// Ordinary inbound messages use thread subscriptions. Explicit routing and
    /// handoff notices remain in `airhop_conversation_changes` and are unaffected.
    /// Keep already stored events as history; never replay their obsolete alerts.
    pub async fn prepare_client_inbound_notifications(&self, _keys: &Keys) -> Result<()> {
        sqlx::query(
            "UPDATE airhop_client_inbound_notifications SET notification_dispatched_at=now() \
             WHERE (community_id,source_event_id) IN ( \
                 SELECT community_id,source_event_id FROM airhop_client_inbound_notifications \
                 WHERE notification_dispatched_at IS NULL ORDER BY created_at LIMIT 100 \
                 FOR UPDATE SKIP LOCKED)",
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
