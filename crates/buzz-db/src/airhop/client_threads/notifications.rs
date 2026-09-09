//! Durable needs-action notices. Provider input itself never broadcasts staff alerts.
use super::*;
impl Db {
    /// Sign pending inbound alerts with current responsibility and membership, transactionally.
    pub async fn prepare_client_inbound_notifications(&self, keys: &Keys) -> Result<()> {
        let jobs=sqlx::query("SELECT n.community_id,n.conversation_id,n.source_event_id,c.host FROM airhop_client_inbound_notifications n JOIN communities c ON c.id=n.community_id WHERE n.notification_event_id IS NULL AND n.notification_dispatched_at IS NULL AND n.next_attempt_at<=now() ORDER BY n.next_attempt_at,n.created_at LIMIT 100").fetch_all(&self.pool).await?;
        for job in jobs {
            let community: Uuid = job.try_get("community_id")?;
            let id: Uuid = job.try_get("conversation_id")?;
            let source: Vec<u8> = job.try_get("source_event_id")?;
            let tenant = TenantContext::resolved(
                CommunityId::from_uuid(community),
                job.try_get::<String, _>("host")?,
            );
            let mut tx = self.pool.begin().await?;
            // All writers take conversation before notification locks, including migration.
            let row=sqlx::query("SELECT organization_id,channel_id,root_event_id,assignee_pubkey,branch_id,queue_status,title FROM airhop_external_conversations WHERE community_id=$1 AND id=$2 FOR UPDATE").bind(community).bind(id).fetch_one(&mut *tx).await?;
            let pending:Option<Vec<u8>>=sqlx::query_scalar("SELECT source_event_id FROM airhop_client_inbound_notifications WHERE community_id=$1 AND source_event_id=$2 AND notification_event_id IS NULL AND notification_dispatched_at IS NULL FOR UPDATE").bind(community).bind(&source).fetch_optional(&mut *tx).await?;
            if pending.is_none() {
                continue;
            }
            if row.try_get::<String, _>("queue_status")? != "waiting_staff" {
                sqlx::query("UPDATE airhop_client_inbound_notifications SET notification_dispatched_at=now() WHERE community_id=$1 AND source_event_id=$2").bind(community).bind(&source).execute(&mut *tx).await?;
                tx.commit().await?;
                continue;
            }
            let channel: Uuid = row.try_get("channel_id")?;
            let assignee: Option<Vec<u8>> = row.try_get("assignee_pubkey")?;
            let target = if let Some(key) = assignee {
                match require_staff(&mut tx, community, channel, &key).await {
                    Ok(()) => Some(key),
                    Err(DbError::AccessDenied(_)) => None,
                    Err(error) => return Err(error),
                }
            } else {
                None
            };
            let targets = match target {
                Some(key) => vec![key],
                None => {
                    responsibles(
                        &mut tx,
                        community,
                        row.try_get("organization_id")?,
                        channel,
                        row.try_get("branch_id")?,
                    )
                    .await?
                }
            };
            if targets.is_empty() {
                // An inaccessible conversation must not starve later tenants/jobs.
                sqlx::query("UPDATE airhop_client_inbound_notifications SET next_attempt_at=now()+interval '60 seconds' WHERE community_id=$1 AND source_event_id=$2")
                    .bind(community).bind(&source).execute(&mut *tx).await?;
                tx.commit().await?;
                continue;
            }
            let root: Option<Vec<u8>> = row.try_get("root_event_id")?;
            let title: String = row.try_get("title")?;
            let notice = store_notice(
                &mut tx,
                &tenant,
                keys,
                channel,
                root.as_deref(),
                &targets,
                &format!("Требует внимания: новое сообщение клиента. {title}"),
            )
            .await?;
            sqlx::query("UPDATE airhop_client_inbound_notifications SET notification_event_id=$3 WHERE community_id=$1 AND source_event_id=$2").bind(community).bind(&source).bind(notice).execute(&mut *tx).await?;
            tx.commit().await?;
        }
        Ok(())
    }
}
