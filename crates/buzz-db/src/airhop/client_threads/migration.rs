//! Explicit cutover; signed history is retained in the original archived channel.
use super::*;

impl Db {
    /// Read-only, membership-scoped migration preview. Apply rechecks every fence.
    pub async fn preview_client_migration(
        &self,
        tenant: &TenantContext,
        actor: &[u8; 32],
        id: Uuid,
    ) -> Result<Value> {
        sqlx::query_scalar("SELECT jsonb_build_object('conversationId',v.id,'version',v.version,'threaded',v.threaded,'oldChannelId',v.channel_id,'targetChannelId',c.buzz_channel_id,'routeVersion',r.version,'pendingDeliveries',(SELECT count(*) FROM airhop_external_message_outbox o WHERE o.community_id=v.community_id AND o.conversation_id=v.id AND o.status IN ('pending','leased')),'unpublishedReplies',(SELECT count(*) FROM airhop_hermes_outbound_intents i WHERE i.community_id=v.community_id AND i.conversation_id=v.id AND i.status='committed'),'liveTurns',(SELECT count(*) FROM airhop_hermes_turn_receipts t WHERE t.community_id=v.community_id AND t.conversation_id=v.id AND t.status='leased' AND t.lease_expires_at>now())) FROM airhop_external_conversations v JOIN airhop_external_conversation_routes r ON r.community_id=v.community_id AND r.conversation_id=v.id JOIN airhop_channel_connections c ON c.community_id=r.community_id AND c.id=r.connection_id JOIN channel_members m ON m.community_id=v.community_id AND m.channel_id=v.channel_id AND m.pubkey=$3 AND m.removed_at IS NULL JOIN relay_members staff ON staff.community_id=m.community_id AND staff.pubkey=encode(m.pubkey,'hex') AND staff.role IN ('owner','admin') WHERE v.community_id=$1 AND v.id=$2")
            .bind(tenant.community().as_uuid()).bind(id).bind(actor.as_slice()).fetch_optional(&self.pool).await?
            .ok_or_else(|| DbError::AccessDenied("Migration preview requires owner/admin channel membership".into()))
    }
}

pub(super) async fn apply(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    actor: &[u8; 32],
    id: Uuid,
    conversation: &sqlx::postgres::PgRow,
    expected_route: i64,
    keys: &Keys,
) -> Result<Vec<u8>> {
    if conversation.try_get::<bool, _>("threaded")? {
        return Err(DbError::AirhopVersionConflict);
    }
    let community = *tenant.community().as_uuid();
    let organization: Uuid = conversation.try_get("organization_id")?;
    let old_channel: Uuid = conversation.try_get("channel_id")?;
    let route=sqlx::query("SELECT r.version,c.buzz_channel_id,c.branch_id,c.connector_pubkey,d.agent_pubkey FROM airhop_external_conversation_routes r JOIN airhop_channel_connections c ON c.community_id=r.community_id AND c.organization_id=r.organization_id AND c.id=r.connection_id JOIN airhop_agent_deployments d ON d.community_id=c.community_id AND d.organization_id=c.organization_id AND d.role='parent_administrator' WHERE r.community_id=$1 AND r.organization_id=$2 AND r.conversation_id=$3 FOR UPDATE OF r,c")
        .bind(community).bind(organization).bind(id).fetch_optional(&mut **tx).await?.ok_or_else(|| DbError::NotFound("conversation route".into()))?;
    if route.try_get::<i64, _>("version")? != expected_route {
        return Err(DbError::AirhopVersionConflict);
    }
    let destination: Uuid = route
        .try_get::<Option<Uuid>, _>("buzz_channel_id")?
        .ok_or_else(|| {
            DbError::InvalidData(
                "Configure the connection's parent channel before migration".into(),
            )
        })?;
    if destination == old_channel {
        return Err(DbError::InvalidData(
            "Migration must target a different work channel".into(),
        ));
    }
    require_staff(tx, community, destination, actor).await?;
    let valid:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM channels c WHERE c.community_id=$1 AND c.id=$2 AND c.visibility='private' AND c.channel_type='stream' AND c.archived_at IS NULL AND c.deleted_at IS NULL AND EXISTS(SELECT 1 FROM channel_members m WHERE m.community_id=c.community_id AND m.channel_id=c.id AND m.pubkey=$3 AND m.removed_at IS NULL) AND EXISTS(SELECT 1 FROM channel_members m WHERE m.community_id=c.community_id AND m.channel_id=c.id AND m.pubkey=$4 AND m.role='bot' AND m.removed_at IS NULL))")
        .bind(community).bind(destination).bind(route.try_get::<Vec<u8>,_>("connector_pubkey")?).bind(route.try_get::<Vec<u8>,_>("agent_pubkey")?).fetch_one(&mut **tx).await?;
    if !valid {
        return Err(DbError::AccessDenied(
            "Destination channel or service membership is unavailable".into(),
        ));
    }
    let blocked:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM airhop_external_message_outbox WHERE community_id=$1 AND conversation_id=$2 AND status IN ('pending','leased')) OR EXISTS(SELECT 1 FROM airhop_hermes_outbound_intents WHERE community_id=$1 AND conversation_id=$2 AND status='committed') OR EXISTS(SELECT 1 FROM airhop_hermes_turn_receipts WHERE community_id=$1 AND conversation_id=$2 AND status='leased' AND lease_expires_at>now())")
        .bind(community).bind(id).fetch_one(&mut **tx).await?;
    if blocked {
        return Err(DbError::InvalidData("Drain or explicitly reconcile pending deliveries, unpublished replies and live Hermes turns before migration".into()));
    }
    let first:Vec<u8>=sqlx::query_scalar("SELECT id FROM events WHERE community_id=$1 AND channel_id=$2 AND kind=9 AND deleted_at IS NULL ORDER BY created_at,id LIMIT 1")
        .bind(community).bind(old_channel).fetch_optional(&mut **tx).await?.ok_or_else(|| DbError::InvalidData("Legacy channel has no readable history to link".into()))?;
    let title: String = conversation.try_get("title")?;
    let content=format!("{title}\n\nПродолжение разговора. [Предыдущая история](buzz://message?channel={old_channel}&id={}) сохранена в архиве. Это служебная отметка переноса, не сообщение клиента.",hex::encode(first));
    let branch = conversation
        .try_get::<Option<Uuid>, _>("branch_id")?
        .or(route.try_get("branch_id")?);
    let targets = responsibles(tx, community, organization, destination, branch).await?;
    let assignee = targets.first().ok_or_else(|| {
        DbError::AccessDenied("Destination needs an accessible responsible staff member".into())
    })?;
    let root = store_notice(tx, tenant, keys, destination, None, &targets, &content).await?;
    sqlx::query("INSERT INTO airhop_conversation_legacy_locations (community_id,organization_id,conversation_id,channel_id,new_root_event_id) VALUES ($1,$2,$3,$4,$5)")
        .bind(community).bind(organization).bind(id).bind(old_channel).bind(&root).execute(&mut **tx).await?;
    sqlx::query("UPDATE airhop_external_conversations SET threaded=TRUE,channel_id=$3,root_event_id=$4,branch_id=$5,assignee_pubkey=$6,control_version=control_version+1 WHERE community_id=$1 AND id=$2")
        .bind(community).bind(id).bind(destination).bind(&root).bind(branch).bind(assignee).execute(&mut **tx).await?;
    sqlx::query("UPDATE airhop_external_conversation_routes SET version=version+1,routing_version=routing_version+1,updated_at=now(),updated_by_pubkey=$3 WHERE community_id=$1 AND conversation_id=$2")
        .bind(community).bind(id).bind(actor.as_slice()).execute(&mut **tx).await?;
    sqlx::query("UPDATE channels SET archived_at=now() WHERE community_id=$1 AND id=$2 AND archived_at IS NULL")
        .bind(community).bind(old_channel).execute(&mut **tx).await?;
    sqlx::query("UPDATE airhop_hermes_turn_receipts SET status='cancelled',finished_at=now(),outcome=NULL,error_code='thread_migrated' WHERE community_id=$1 AND conversation_id=$2 AND status='leased'")
        .bind(community).bind(id).execute(&mut **tx).await?;
    Ok(root)
}
