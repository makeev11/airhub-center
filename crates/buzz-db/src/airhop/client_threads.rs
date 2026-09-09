//! Shared-channel client conversations. Membership remains the sole visibility boundary.
use airhop_core::client_conversations::{ClientAction, ClientCommand};
use buzz_core::{CommunityId, TenantContext};
use chrono::{DateTime, Utc};
use nostr::{Event, EventBuilder, Keys, Kind, Tag};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use super::external_conversation::ExternalConversation;
use crate::event::{insert_event_with_thread_metadata_tx, ThreadMetadataParams};
use crate::{Db, DbError, Result};

mod branch_responsibles;
mod gateway_retry;
mod migration;
mod notifications;
#[cfg(test)]
mod tests;

/// Bounded, server-filtered Inbox request; never a permissions grant.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClientInboxFilter {
    /// Exact visible work channel for conversation presentation.
    pub channel_id: Option<Uuid>,
    /// Up to 100 visible thread roots, comma-separated hexadecimal event IDs.
    pub root_ids: Option<String>,
    /// A selected branch, or all accessible branches.
    pub branch_id: Option<Uuid>,
    /// Only conversations whose branch has not been selected.
    #[serde(default)]
    pub unassigned_branch: bool,
    /// Exact queue status.
    pub status: Option<String>,
    /// Exact connection.
    pub connection_id: Option<Uuid>,
    /// Only conversations assigned to the authenticated reader.
    #[serde(default)]
    pub mine: bool,
    /// Exact staff public key; still constrained by the reader's membership.
    pub assignee: Option<String>,
    /// Search the current client title without reading message bodies.
    pub search: Option<String>,
    /// Optional family-card filter.
    pub family_id: Option<Uuid>,
    /// Exact representative associated with a booking card.
    pub representative_id: Option<Uuid>,
    /// Optional exact conversation for cards and deep links.
    pub conversation_id: Option<Uuid>,
    /// Keyset pagination timestamp from the previous response.
    pub before: Option<DateTime<Utc>>,
    /// Tie-breaker from the previous response.
    pub after_id: Option<Uuid>,
}

impl Db {
    /// Operational branch metadata for an already supervisor-authorized conversation.
    pub async fn client_turn_routing(&self, tenant: &TenantContext, id: Uuid) -> Result<Value> {
        sqlx::query_scalar("SELECT jsonb_build_object('branchId',v.branch_id,'branchName',b.name,'version',v.version,'status',v.queue_status,'title',v.title,'rootEventId',encode(v.root_event_id,'hex'),'channelId',v.channel_id,'branches',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',branch.id,'name',branch.name,'address',branch.address) ORDER BY branch.name),'[]'::jsonb) FROM airhop_branches branch WHERE branch.community_id=v.community_id AND branch.organization_id=v.organization_id AND branch.status='active')) FROM airhop_external_conversations v LEFT JOIN airhop_branches b ON b.community_id=v.community_id AND b.id=v.branch_id WHERE v.community_id=$1 AND v.id=$2 AND v.status='active'")
            .bind(tenant.community().as_uuid()).bind(id).fetch_optional(&self.pool).await?.ok_or_else(|| DbError::NotFound("conversation routing".into()))
    }
    /// Return at most 100 metadata rows visible through real channel membership.
    pub async fn client_inbox(
        &self,
        tenant: &TenantContext,
        actor: &[u8; 32],
        filter: &ClientInboxFilter,
    ) -> Result<Value> {
        if filter
            .search
            .as_ref()
            .is_some_and(|s| s.chars().count() > 160)
            || filter.before.is_some() != filter.after_id.is_some()
            || filter
                .status
                .as_deref()
                .is_some_and(|s| !matches!(s, "waiting_staff" | "waiting_parent" | "resolved"))
        {
            return Err(DbError::InvalidData("invalid client Inbox filter".into()));
        }
        let assignee = filter
            .assignee
            .as_deref()
            .map(|key| {
                hex::decode(key)
                    .ok()
                    .filter(|bytes| bytes.len() == 32)
                    .ok_or_else(|| DbError::InvalidData("invalid assignee public key".into()))
            })
            .transpose()?;
        let roots = filter
            .root_ids
            .as_ref()
            .map(|value| {
                let parts: Vec<_> = value.split(',').collect();
                if parts.is_empty() || parts.len() > 100 {
                    return Err(DbError::InvalidData("invalid visible roots".into()));
                }
                parts
                    .into_iter()
                    .map(|part| {
                        hex::decode(part)
                            .ok()
                            .filter(|bytes| bytes.len() == 32)
                            .ok_or_else(|| DbError::InvalidData("invalid visible root".into()))
                    })
                    .collect::<Result<Vec<Vec<u8>>>>()
            })
            .transpose()?;
        let rows: Vec<Value> = sqlx::query_scalar(
            "SELECT jsonb_build_object('id',v.id,'channelId',v.channel_id,'rootEventId',encode(v.root_event_id,'hex'),
                'threaded',v.threaded,'title',COALESCE(p.display_name || ' · ' || family.display_name,v.title),'branchId',v.branch_id,'branchName',b.name,
                'assignee',encode(v.assignee_pubkey,'hex'),'status',v.queue_status,'version',v.version,
                'familyId',v.family_id,'representativeId',v.representative_id,'owner',v.owner,
                'provider',c.provider,'connectionId',c.id,'connectionName',c.display_name,
                'connectorPubkey',encode(c.connector_pubkey,'hex'),
                'parentName',p.display_name,
                'hermesPubkey',(SELECT encode(d.agent_pubkey,'hex') FROM airhop_agent_deployments d WHERE d.community_id=v.community_id AND d.organization_id=v.organization_id AND d.role='parent_administrator' LIMIT 1),
                'hermesInChannel',EXISTS(SELECT 1 FROM airhop_agent_deployments d JOIN channel_members hm ON hm.community_id=d.community_id AND hm.pubkey=d.agent_pubkey AND hm.channel_id=v.channel_id AND hm.removed_at IS NULL WHERE d.community_id=v.community_id AND d.organization_id=v.organization_id AND d.role='parent_administrator'),
                'connectionStatus',c.status,'updatedAt',v.updated_at,'lastInboundAt',v.last_inbound_at,
                'legacyChannelId',(SELECT l.channel_id FROM airhop_conversation_legacy_locations l WHERE l.community_id=v.community_id AND l.conversation_id=v.id))
             FROM airhop_external_conversations v
             JOIN airhop_organizations o ON o.community_id=v.community_id AND o.id=v.organization_id AND o.status='active'
             JOIN channel_members m ON m.community_id=v.community_id AND m.channel_id=v.channel_id AND m.pubkey=$2 AND m.removed_at IS NULL
             JOIN relay_members staff ON staff.community_id=m.community_id AND staff.pubkey=encode(m.pubkey,'hex')
             JOIN channels channel ON channel.community_id=v.community_id AND channel.id=v.channel_id AND channel.deleted_at IS NULL
             JOIN airhop_external_conversation_routes r ON r.community_id=v.community_id AND r.conversation_id=v.id
             JOIN airhop_channel_connections c ON c.community_id=r.community_id AND c.id=r.connection_id AND c.organization_id=v.organization_id
             LEFT JOIN airhop_branches b ON b.community_id=v.community_id AND b.organization_id=v.organization_id AND b.id=v.branch_id
             LEFT JOIN airhop_families family ON family.community_id=v.community_id AND family.organization_id=v.organization_id AND family.id=v.family_id AND family.status='active'
             LEFT JOIN airhop_representatives p ON p.community_id=v.community_id AND p.organization_id=v.organization_id AND p.id=v.representative_id AND p.family_id=family.id AND p.status='active'
             WHERE v.community_id=$1 AND v.status='active' AND m.role<>'bot' AND (NOT v.threaded OR v.root_event_id IS NOT NULL)
               AND ($3::uuid IS NULL OR v.branch_id=$3) AND (NOT $4 OR v.branch_id IS NULL)
               AND ($5::text IS NULL OR v.queue_status=$5) AND ($6::uuid IS NULL OR c.id=$6)
               AND (NOT $7 OR v.assignee_pubkey=$2) AND ($8::text IS NULL OR strpos(lower(COALESCE(p.display_name || ' · ' || family.display_name,v.title)),lower($8))>0 OR EXISTS(SELECT 1 FROM airhop_children child WHERE child.community_id=v.community_id AND child.organization_id=v.organization_id AND child.family_id=family.id AND child.status='active' AND strpos(lower(child.display_name),lower($8))>0))
               AND ($9::uuid IS NULL OR v.family_id=$9) AND ($10::uuid IS NULL OR v.id=$10)
               AND ($11::timestamptz IS NULL OR (v.updated_at,v.id)<($11,$12))
               AND ($13::uuid IS NULL OR v.representative_id=$13)
               AND ($14::bytea IS NULL OR v.assignee_pubkey=$14)
               AND ($15::uuid IS NULL OR v.channel_id=$15)
               AND ($16::bytea[] IS NULL OR v.root_event_id=ANY($16))
             ORDER BY v.updated_at DESC,v.id DESC LIMIT 101")
            .bind(tenant.community().as_uuid()).bind(actor.as_slice()).bind(filter.branch_id).bind(filter.unassigned_branch)
            .bind(&filter.status).bind(filter.connection_id).bind(filter.mine).bind(&filter.search)
            .bind(filter.family_id).bind(filter.conversation_id).bind(filter.before).bind(filter.after_id).bind(filter.representative_id).bind(assignee).bind(filter.channel_id).bind(roots).fetch_all(&self.pool).await?;
        let more = rows.len() > 100;
        let items: Vec<_> = rows.into_iter().take(100).collect();
        let cursor = if more {
            items
                .last()
                .map(|v| json!({"before":v["updatedAt"],"afterId":v["id"]}))
        } else {
            None
        };
        let branches:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'name',name,'channelId',default_buzz_channel_id,'version',version,'responsiblePubkeys',(SELECT COALESCE(jsonb_agg(encode(r.pubkey,'hex') ORDER BY r.pubkey),'[]'::jsonb) FROM airhop_branch_client_responsibles r WHERE r.community_id=airhop_branches.community_id AND r.branch_id=airhop_branches.id)) FROM airhop_branches WHERE community_id=$1 AND status='active' ORDER BY name,id LIMIT 500")
            .bind(tenant.community().as_uuid()).fetch_all(&self.pool).await?;
        let staff:Vec<Value>=sqlx::query_scalar("SELECT DISTINCT jsonb_build_object('pubkey',encode(m.pubkey,'hex'),'name',COALESCE(NULLIF(u.display_name,''),encode(m.pubkey,'hex')),'channelId',m.channel_id) FROM channel_members m JOIN channel_members viewer ON viewer.community_id=m.community_id AND viewer.channel_id=m.channel_id AND viewer.pubkey=$2 AND viewer.removed_at IS NULL JOIN relay_members r ON r.community_id=m.community_id AND r.pubkey=encode(m.pubkey,'hex') LEFT JOIN users u ON u.community_id=m.community_id AND u.pubkey=m.pubkey WHERE m.community_id=$1 AND m.removed_at IS NULL AND m.role<>'bot' AND u.deactivated_at IS NULL AND NOT EXISTS(SELECT 1 FROM airhop_channel_connections c WHERE c.community_id=m.community_id AND c.connector_pubkey=m.pubkey) LIMIT 1000")
            .bind(tenant.community().as_uuid()).bind(actor.as_slice()).fetch_all(&self.pool).await?;
        let can_manage:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM relay_members WHERE community_id=$1 AND pubkey=$2 AND role IN ('owner','admin'))").bind(tenant.community().as_uuid()).bind(hex::encode(actor)).fetch_one(&self.pool).await?;
        let connections:Vec<Value>=sqlx::query_scalar("SELECT DISTINCT jsonb_build_object('id',c.id,'name',c.display_name) FROM airhop_channel_connections c JOIN channel_members m ON m.community_id=c.community_id AND (m.channel_id=c.buzz_channel_id OR EXISTS(SELECT 1 FROM airhop_external_conversation_routes r JOIN airhop_external_conversations v ON v.community_id=r.community_id AND v.id=r.conversation_id WHERE r.community_id=c.community_id AND r.connection_id=c.id AND v.channel_id=m.channel_id)) WHERE c.community_id=$1 AND m.pubkey=$2 AND m.removed_at IS NULL AND m.role<>'bot' LIMIT 500").bind(tenant.community().as_uuid()).bind(actor.as_slice()).fetch_all(&self.pool).await?;
        Ok(
            json!({"communityId":tenant.community().as_uuid(),"viewerPubkey":hex::encode(actor),"items":items,"nextCursor":cursor,"branches":branches,"staff":staff,"canManageRouting":can_manage,"connections":connections}),
        )
    }

    /// Fetch the canonical root for a trusted conversation scope.
    pub async fn client_thread_root(
        &self,
        tenant: &TenantContext,
        conversation_id: Uuid,
    ) -> Result<Option<String>> {
        sqlx::query_scalar("SELECT encode(root_event_id,'hex') FROM airhop_external_conversations WHERE community_id=$1 AND id=$2 AND status='active'")
            .bind(tenant.community().as_uuid()).bind(conversation_id).fetch_optional(&self.pool).await?
            .ok_or_else(|| DbError::NotFound("client conversation".into()))
    }

    /// Transactional staff command: CAS, replay receipt, audit and signed internal notice.
    pub async fn apply_client_command(
        &self,
        tenant: &TenantContext,
        actor: &[u8; 32],
        command: &ClientCommand,
        relay_keys: &Keys,
    ) -> Result<Value> {
        self.apply_client_command_inner(tenant, actor, command, relay_keys, None)
            .await
    }

    /// Apply only an explicitly quoted branch choice from the current parent input.
    /// A fresh supervisor lease and gateway receipt are rechecked inside the write transaction.
    pub async fn assign_client_branch_from_parent(
        &self,
        tenant: &TenantContext,
        lease: &super::agent_runtime::ValidateParentAgentTurnLeaseInput,
        command: &ClientCommand,
        quote: &str,
        relay_keys: &Keys,
    ) -> Result<Value> {
        if !matches!(command.action, ClientAction::AssignBranch { .. })
            || quote.trim().chars().count() < 3
            || quote.chars().count() > 300
        {
            return Err(DbError::InvalidData(
                "Explicit parent branch selection is required".into(),
            ));
        }
        self.apply_client_command_inner(
            tenant,
            &lease.agent_pubkey,
            command,
            relay_keys,
            Some((lease, quote)),
        )
        .await
    }

    async fn apply_client_command_inner(
        &self,
        tenant: &TenantContext,
        actor: &[u8; 32],
        command: &ClientCommand,
        relay_keys: &Keys,
        parent: Option<(
            &super::agent_runtime::ValidateParentAgentTurnLeaseInput,
            &str,
        )>,
    ) -> Result<Value> {
        command
            .validate()
            .map_err(|e| DbError::InvalidData(e.into()))?;
        let community = *tenant.community().as_uuid();
        let mut tx = self.pool.begin().await?;
        // Scope and actor are resolved before replay, so revocation is effective on retries.
        let row=sqlx::query("SELECT v.*,staff.role AS staff_role FROM airhop_external_conversations v JOIN airhop_organizations o ON o.community_id=v.community_id AND o.id=v.organization_id AND o.status='active' JOIN channel_members m ON m.community_id=v.community_id AND m.channel_id=v.channel_id AND m.pubkey=$3 AND m.removed_at IS NULL LEFT JOIN relay_members staff ON staff.community_id=m.community_id AND staff.pubkey=encode(m.pubkey,'hex') WHERE v.community_id=$1 AND v.id=$2 AND v.status='active' AND ((m.role<>'bot' AND staff.pubkey IS NOT NULL) OR $4) FOR UPDATE OF v")
            .bind(community).bind(command.conversation_id).bind(actor.as_slice()).bind(parent.is_some()).fetch_optional(&mut *tx).await?
            .ok_or_else(|| DbError::AccessDenied("Conversation requires active staff channel membership".into()))?;
        if parent.is_none() {
            require_staff(&mut tx, community, row.try_get("channel_id")?, actor).await?;
        }
        let mut request = serde_json::to_value(command)?;
        if let Some((lease, quote)) = parent {
            let source:Option<Vec<u8>>=sqlx::query_scalar("SELECT t.source_message_id FROM airhop_hermes_turn_receipts t JOIN airhop_agent_deployments d ON d.community_id=t.community_id AND d.id=t.deployment_id AND d.agent_pubkey=t.agent_pubkey JOIN airhop_external_inbound_receipts receipt ON receipt.community_id=t.community_id AND receipt.event_id=t.source_message_id AND receipt.conversation_id=t.conversation_id JOIN airhop_external_conversations v ON v.community_id=t.community_id AND v.id=t.conversation_id JOIN airhop_gateway_inbound_receipts gateway ON gateway.community_id=t.community_id AND gateway.conversation_id=t.conversation_id AND gateway.buzz_event_id=t.source_message_id JOIN events source ON source.community_id=t.community_id AND source.id=t.source_message_id WHERE t.community_id=$1 AND t.organization_id=$2 AND t.deployment_id=$3 AND d.version=$4 AND t.id=$5 AND t.lease_token=$6 AND t.agent_pubkey=$7 AND t.conversation_id=$8 AND t.status='leased' AND t.lease_expires_at>now() AND d.enabled AND NOT d.paused AND v.owner='hermes' AND NOT v.hermes_paused AND t.cycle_id=v.current_cycle_id AND receipt.control_version=v.control_version AND receipt.decision='trigger' AND source.deleted_at IS NULL AND strpos(lower(source.content),lower($9))>0")
                .bind(community).bind(lease.organization_id).bind(lease.deployment_id).bind(lease.deployment_version).bind(lease.turn_id).bind(lease.lease_token)
                .bind(actor.as_slice()).bind(command.conversation_id).bind(quote.trim()).fetch_optional(&mut *tx).await?;
            let source=source.ok_or_else(|| DbError::AccessDenied("Branch selection must quote the current authenticated parent message under a live lease".into()))?;
            request["parentEvidence"] =
                json!({"sourceEventId":hex::encode(source),"quote":quote.trim()});
        }
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
            .bind(format!(
                "airhop_client_command:{community}:{}",
                command.idempotency_key
            ))
            .execute(&mut *tx)
            .await?;
        if let Some(receipt)=sqlx::query("SELECT actor_pubkey,request,result FROM airhop_conversation_changes WHERE community_id=$1 AND idempotency_key=$2")
            .bind(community).bind(command.idempotency_key).fetch_optional(&mut *tx).await? {
            if receipt.try_get::<Value,_>("request")?!=request || receipt.try_get::<Vec<u8>,_>("actor_pubkey")?.as_slice()!=actor {
                return Err(DbError::AirhopVersionConflict);
            }
            return Ok(receipt.try_get("result")?);
        }
        if row.try_get::<i64, _>("version")? != command.expected_version {
            return Err(DbError::AirhopVersionConflict);
        }
        let organization: Uuid = row.try_get("organization_id")?;
        let channel: Uuid = row.try_get("channel_id")?;
        let root: Option<Vec<u8>> = row.try_get("root_event_id")?;
        let notice = match &command.action {
            ClientAction::AssignBranch { branch_id } => {
                let name:String=sqlx::query_scalar("SELECT name FROM airhop_branches WHERE community_id=$1 AND organization_id=$2 AND id=$3 AND status='active' FOR SHARE")
                    .bind(community).bind(organization).bind(branch_id).fetch_optional(&mut *tx).await?.ok_or_else(|| DbError::NotFound("active branch".into()))?;
                let targets =
                    responsibles(&mut tx, community, organization, channel, Some(*branch_id))
                        .await?;
                let assignee=targets.first().ok_or_else(|| DbError::AccessDenied("No responsible staff can access this channel; ask the owner to configure membership".into()))?;
                sqlx::query("UPDATE airhop_external_conversations SET branch_id=$3,assignee_pubkey=$4,queue_status='waiting_staff',resolved_at=NULL WHERE community_id=$1 AND id=$2")
                    .bind(community).bind(command.conversation_id).bind(branch_id).bind(assignee).execute(&mut *tx).await?;
                Some(store_notice(&mut tx,tenant,relay_keys,channel,root.as_deref(),&targets,&format!("Требует внимания: обращение назначено филиалу «{name}». Переписка остаётся в этом треде.")).await?)
            }
            ClientAction::Assign { pubkey } => {
                let assignee = hex::decode(pubkey)
                    .map_err(|_| DbError::InvalidData("invalid assignee".into()))?;
                require_staff(&mut tx, community, channel, &assignee).await?;
                sqlx::query("UPDATE airhop_external_conversations SET assignee_pubkey=$3 WHERE community_id=$1 AND id=$2")
                    .bind(community).bind(command.conversation_id).bind(&assignee).execute(&mut *tx).await?;
                Some(
                    store_notice(
                        &mut tx,
                        tenant,
                        relay_keys,
                        channel,
                        root.as_deref(),
                        &[assignee],
                        "Требует внимания: вы назначены ответственным за обращение.",
                    )
                    .await?,
                )
            }
            ClientAction::SetStatus { status } => {
                sqlx::query("UPDATE airhop_external_conversations SET queue_status=$3,resolved_at=CASE WHEN $3='resolved' THEN now() ELSE NULL END,control_version=control_version+1 WHERE community_id=$1 AND id=$2")
                    .bind(community).bind(command.conversation_id).bind(status).execute(&mut *tx).await?;
                sqlx::query("UPDATE airhop_hermes_turn_receipts SET status='cancelled',finished_at=now(),outcome=NULL,error_code='staff_queue_changed' WHERE community_id=$1 AND conversation_id=$2 AND status='leased'")
                    .bind(community).bind(command.conversation_id).execute(&mut *tx).await?;
                None
            }
            ClientAction::MigrateLegacy {
                expected_route_version,
            } => {
                if !matches!(
                    row.try_get::<Option<String>, _>("staff_role")?
                        .as_deref()
                        .unwrap_or(""),
                    "owner" | "admin"
                ) {
                    return Err(DbError::AccessDenied(
                        "Migration requires owner/admin".into(),
                    ));
                }
                Some(
                    migration::apply(
                        &mut tx,
                        tenant,
                        actor,
                        command.conversation_id,
                        &row,
                        *expected_route_version,
                        relay_keys,
                    )
                    .await?,
                )
            }
        };
        let result:Value=sqlx::query_scalar("UPDATE airhop_external_conversations SET version=version+1,updated_at=now() WHERE community_id=$1 AND id=$2 RETURNING jsonb_build_object('id',id,'version',version,'channelId',channel_id,'rootEventId',encode(root_event_id,'hex'),'branchId',branch_id,'assignee',encode(assignee_pubkey,'hex'),'status',queue_status)")
            .bind(community).bind(command.conversation_id).fetch_one(&mut *tx).await?;
        sqlx::query("INSERT INTO airhop_conversation_changes (community_id,organization_id,idempotency_key,conversation_id,actor_pubkey,request,result,notification_event_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)")
            .bind(community).bind(organization).bind(command.idempotency_key).bind(command.conversation_id).bind(actor.as_slice()).bind(request).bind(&result).bind(notice).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(result)
    }
}

pub(super) async fn record_inbound(
    tx: &mut Transaction<'_, Postgres>,
    community: Uuid,
    conversation: &mut ExternalConversation,
) -> Result<()> {
    let row=sqlx::query("SELECT queue_status,branch_id,assignee_pubkey FROM airhop_external_conversations WHERE community_id=$1 AND id=$2")
        .bind(community).bind(conversation.id).fetch_one(&mut **tx).await?;
    if row.try_get::<String, _>("queue_status")? == "resolved" {
        sqlx::query("UPDATE airhop_external_conversation_cycles SET ended_at=COALESCE(ended_at,now()),ended_reason=COALESCE(ended_reason,'resolved') WHERE community_id=$1 AND conversation_id=$2 AND ended_at IS NULL")
            .bind(community).bind(conversation.id).execute(&mut **tx).await?;
        let cycle = Uuid::new_v4();
        sqlx::query("INSERT INTO airhop_external_conversation_cycles (community_id,organization_id,conversation_id,id,sequence,started_by) SELECT $1,$2,$3,$4,COALESCE(max(sequence),0)+1,'parent_reopened' FROM airhop_external_conversation_cycles WHERE community_id=$1 AND conversation_id=$3")
            .bind(community).bind(conversation.organization_id).bind(conversation.id).bind(cycle).execute(&mut **tx).await?;
        sqlx::query("UPDATE airhop_external_conversations SET current_cycle_id=$3,control_version=control_version+1 WHERE community_id=$1 AND id=$2")
            .bind(community).bind(conversation.id).bind(cycle).execute(&mut **tx).await?;
        conversation.current_cycle_id = cycle;
        conversation.control_version += 1;
    }
    let assignee: Option<Vec<u8>> = row.try_get("assignee_pubkey")?;
    let assignee = match assignee {
        Some(value) => match require_staff(tx, community, conversation.channel_id, &value).await {
            Ok(()) => Some(value),
            Err(DbError::AccessDenied(_)) => responsibles(
                tx,
                community,
                conversation.organization_id,
                conversation.channel_id,
                row.try_get("branch_id")?,
            )
            .await?
            .into_iter()
            .next(),
            Err(error) => return Err(error),
        },
        None => responsibles(
            tx,
            community,
            conversation.organization_id,
            conversation.channel_id,
            row.try_get("branch_id")?,
        )
        .await?
        .into_iter()
        .next(),
    };
    sqlx::query("UPDATE airhop_external_conversations SET queue_status='waiting_staff',resolved_at=NULL,last_inbound_at=now(),updated_at=now(),version=version+1,assignee_pubkey=$3 WHERE community_id=$1 AND id=$2")
        .bind(community).bind(conversation.id).bind(assignee).execute(&mut **tx).await?;
    Ok(())
}

pub(super) async fn responsibles(
    tx: &mut Transaction<'_, Postgres>,
    community: Uuid,
    organization: Uuid,
    channel: Uuid,
    branch: Option<Uuid>,
) -> Result<Vec<Vec<u8>>> {
    let rows=sqlx::query("SELECT m.pubkey, EXISTS(SELECT 1 FROM airhop_branch_client_responsibles r WHERE r.community_id=m.community_id AND r.organization_id=$2 AND r.branch_id=$4 AND r.pubkey=m.pubkey) AS responsible FROM channel_members m JOIN relay_members staff ON staff.community_id=m.community_id AND staff.pubkey=encode(m.pubkey,'hex') LEFT JOIN users u ON u.community_id=m.community_id AND u.pubkey=m.pubkey WHERE m.community_id=$1 AND m.channel_id=$3 AND m.removed_at IS NULL AND m.role<>'bot' AND u.deactivated_at IS NULL AND NOT EXISTS(SELECT 1 FROM airhop_channel_connections c WHERE c.community_id=m.community_id AND c.connector_pubkey=m.pubkey) AND (staff.role IN ('owner','admin') OR EXISTS(SELECT 1 FROM airhop_branch_client_responsibles r WHERE r.community_id=m.community_id AND r.organization_id=$2 AND r.branch_id=$4 AND r.pubkey=m.pubkey)) ORDER BY responsible DESC,CASE staff.role WHEN 'owner' THEN 0 ELSE 1 END,m.pubkey LIMIT 8")
        .bind(community).bind(organization).bind(channel).bind(branch).fetch_all(&mut **tx).await?;
    let has_branch = rows
        .iter()
        .any(|r| r.try_get::<bool, _>("responsible").unwrap_or(false));
    rows.iter()
        .filter(|r| !has_branch || r.try_get::<bool, _>("responsible").unwrap_or(false))
        .map(|r| r.try_get("pubkey").map_err(Into::into))
        .collect()
}

async fn require_staff(
    tx: &mut Transaction<'_, Postgres>,
    community: Uuid,
    channel: Uuid,
    pubkey: &[u8],
) -> Result<()> {
    let valid:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM channel_members m JOIN relay_members r ON r.community_id=m.community_id AND r.pubkey=encode(m.pubkey,'hex') LEFT JOIN users u ON u.community_id=m.community_id AND u.pubkey=m.pubkey WHERE m.community_id=$1 AND m.channel_id=$2 AND m.pubkey=$3 AND m.role<>'bot' AND m.removed_at IS NULL AND u.deactivated_at IS NULL AND NOT EXISTS(SELECT 1 FROM airhop_channel_connections c WHERE c.community_id=m.community_id AND c.connector_pubkey=m.pubkey))")
        .bind(community).bind(channel).bind(pubkey).fetch_one(&mut **tx).await?;
    if !valid {
        return Err(DbError::AccessDenied(
            "Assignee must already be an active staff member of this channel".into(),
        ));
    }
    Ok(())
}

async fn store_notice(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    keys: &Keys,
    channel: Uuid,
    root: Option<&[u8]>,
    recipients: &[Vec<u8>],
    content: &str,
) -> Result<Vec<u8>> {
    let mut tags = vec![
        Tag::parse(["nonce", &Uuid::new_v4().to_string()])
            .map_err(|e| DbError::InvalidData(e.to_string()))?,
        Tag::parse(["h", &channel.to_string()]).map_err(|e| DbError::InvalidData(e.to_string()))?,
        Tag::parse(["airhop-internal", "client-routing"])
            .map_err(|e| DbError::InvalidData(e.to_string()))?,
    ];
    if let Some(root) = root {
        for marker in ["root", "reply"] {
            tags.push(
                Tag::parse(["e", &hex::encode(root), "", marker])
                    .map_err(|e| DbError::InvalidData(e.to_string()))?,
            );
        }
    }
    for recipient in recipients {
        tags.push(
            Tag::parse(["p", &hex::encode(recipient)])
                .map_err(|e| DbError::InvalidData(e.to_string()))?,
        );
    }
    let event = EventBuilder::new(
        Kind::Custom(buzz_core::kind::KIND_STREAM_MESSAGE as u16),
        content,
    )
    .tags(tags)
    .sign_with_keys(keys)
    .map_err(|e| DbError::InvalidData(e.to_string()))?;
    store_service_event(tx, tenant, channel, root, &event).await?;
    Ok(event.id.as_bytes().to_vec())
}

async fn store_service_event(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    channel: Uuid,
    root: Option<&[u8]>,
    event: &Event,
) -> Result<()> {
    let root_created=match root {
        Some(id)=>Some(sqlx::query_scalar::<_,DateTime<Utc>>("SELECT created_at FROM events WHERE community_id=$1 AND channel_id=$2 AND id=$3 AND deleted_at IS NULL")
            .bind(tenant.community().as_uuid()).bind(channel).bind(id).fetch_optional(&mut **tx).await?.ok_or_else(|| DbError::InvalidData("Conversation root is not available yet".into()))?),
        None=>None,
    };
    let created = DateTime::from_timestamp(event.created_at.as_secs() as i64, 0)
        .ok_or_else(|| DbError::InvalidData("invalid service timestamp".into()))?;
    insert_event_with_thread_metadata_tx(
        tx,
        tenant.community(),
        event,
        Some(channel),
        Some(ThreadMetadataParams {
            event_id: event.id.as_bytes(),
            event_created_at: created,
            channel_id: channel,
            parent_event_id: root,
            parent_event_created_at: root_created,
            root_event_id: root,
            root_event_created_at: root_created,
            depth: i32::from(root.is_some()),
            broadcast: false,
        }),
    )
    .await?;
    Ok(())
}

/// Durable post-commit notification reference; its event is already canonical.
#[derive(Debug)]
pub struct ClientNotification {
    /// Host-resolved tenant, not supplied by a command.
    pub community_id: CommunityId,
    /// Canonical community domain.
    pub host: String,
    /// Exact stored event.
    pub event_id: Vec<u8>,
    /// Legacy sidebar metadata to refresh after the same atomic cutover.
    pub archived_channel_id: Option<Uuid>,
}

impl Db {
    /// Bounded recovery scan for stored routing notices awaiting normal Buzz fan-out.
    pub async fn pending_client_notifications(&self) -> Result<Vec<ClientNotification>> {
        self.pending_client_notifications_in(None).await
    }

    async fn pending_client_notifications_in(
        &self,
        community: Option<CommunityId>,
    ) -> Result<Vec<ClientNotification>> {
        let rows=sqlx::query("SELECT n.community_id,host.host,n.notification_event_id,l.channel_id AS archived_channel_id FROM airhop_conversation_changes n JOIN communities host ON host.id=n.community_id LEFT JOIN airhop_conversation_legacy_locations l ON l.community_id=n.community_id AND l.new_root_event_id=n.notification_event_id WHERE n.notification_event_id IS NOT NULL AND n.notification_dispatched_at IS NULL AND ($1::uuid IS NULL OR n.community_id=$1) ORDER BY n.created_at LIMIT 100")
            .bind(community.map(|id| *id.as_uuid())).fetch_all(&self.pool).await?;
        rows.iter()
            .map(|r| {
                Ok(ClientNotification {
                    community_id: CommunityId::from_uuid(r.try_get("community_id")?),
                    host: r.try_get("host")?,
                    event_id: r.try_get("notification_event_id")?,
                    archived_channel_id: r.try_get("archived_channel_id")?,
                })
            })
            .collect()
    }

    /// Mark only this exact already-stored event as dispatched; replay is harmless.
    pub async fn complete_client_notification(
        &self,
        community: CommunityId,
        event_id: &[u8],
    ) -> Result<()> {
        sqlx::query("UPDATE airhop_conversation_changes SET notification_dispatched_at=now() WHERE community_id=$1 AND notification_event_id=$2 AND notification_dispatched_at IS NULL")
            .bind(community.as_uuid()).bind(event_id).execute(&self.pool).await?;
        sqlx::query("UPDATE airhop_client_inbound_notifications SET notification_dispatched_at=now() WHERE community_id=$1 AND notification_event_id=$2 AND notification_dispatched_at IS NULL").bind(community.as_uuid()).bind(event_id).execute(&self.pool).await?;
        Ok(())
    }
}
