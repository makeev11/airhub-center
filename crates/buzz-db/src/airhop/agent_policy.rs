//! Authoritative, role-specific duties changed only by versioned staff commands.

use airhop_core::agent_policy::{AgentPolicy, AgentRole, NoticeDestination, SetAgentPolicy};
use buzz_core::TenantContext;
use serde_json::{json, Value};
use sqlx::{PgConnection, Row};
use uuid::Uuid;

use crate::{Db, DbError, Result};

impl Db {
    /// Enforces the organization switch independently of model instructions.
    pub async fn require_airhop_agent_enabled(
        &self,
        tenant: &TenantContext,
        role: AgentRole,
    ) -> Result<()> {
        if self.airhop_agent_policy(tenant, role).await?.0.enabled {
            Ok(())
        } else {
            Err(DbError::AccessDenied(
                "agent disabled by organization policy".into(),
            ))
        }
    }

    /// Publication boundary for registered product agents; ordinary staff are unaffected.
    pub async fn authorize_airhop_agent_publication(
        &self,
        tenant: &TenantContext,
        actor: &[u8; 32],
    ) -> Result<()> {
        let roles=sqlx::query_scalar::<_,String>("SELECT role FROM airhop_registered_principals WHERE community_id=$1 AND pubkey=$2 AND principal_kind='agent'")
            .bind(tenant.community().as_uuid()).bind(actor.as_slice()).fetch_all(&self.pool).await?;
        for role in roles {
            if let Some(role) = AgentRole::parse(&role) {
                self.require_airhop_agent_enabled(tenant, role).await?;
            }
        }
        Ok(())
    }
    /// Effective policy and revision; defaults have revision zero.
    pub async fn airhop_agent_policy(
        &self,
        tenant: &TenantContext,
        role: AgentRole,
    ) -> Result<(AgentPolicy, i64)> {
        let row = sqlx::query(
            "SELECT policy,version FROM airhop_agent_policies WHERE community_id=$1 AND role=$2",
        )
        .bind(tenant.community().as_uuid())
        .bind(role.as_str())
        .fetch_optional(&self.pool)
        .await?;
        match row {
            Some(row) => Ok((
                serde_json::from_value(row.try_get("policy")?)
                    .map_err(|e| DbError::InvalidData(e.to_string()))?,
                row.try_get("version")?,
            )),
            None => Ok((AgentPolicy::for_role(role), 0)),
        }
    }

    /// All configured roles, with explicit permissions for the current staff caller.
    pub async fn airhop_agent_policies(
        &self,
        tenant: &TenantContext,
        actor: &[u8; 32],
    ) -> Result<Value> {
        let can_manage: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM relay_members WHERE community_id=$1 AND pubkey=$2 AND role IN ('owner','admin') AND NOT EXISTS(SELECT 1 FROM airhop_registered_principals p WHERE p.community_id=$1 AND encode(p.pubkey,'hex')=$2))")
            .bind(tenant.community().as_uuid()).bind(hex::encode(actor)).fetch_one(&self.pool).await?;
        let rows = sqlx::query(
            "SELECT role,policy,version FROM airhop_agent_policies WHERE community_id=$1",
        )
        .bind(tenant.community().as_uuid())
        .fetch_all(&self.pool)
        .await?;
        let candidates=sqlx::query("SELECT role,id,plan,observations FROM (SELECT *,row_number() OVER(PARTITION BY role ORDER BY observations DESC,created_at DESC,id) AS rank FROM airhop_agent_procedures WHERE community_id=$1) p WHERE rank<=8 ORDER BY role,rank")
            .bind(tenant.community().as_uuid()).fetch_all(&self.pool).await?;
        let selections=sqlx::query("SELECT v.role,v.version,v.procedure_id,p.plan FROM (SELECT DISTINCT ON(role) * FROM airhop_agent_procedure_versions WHERE community_id=$1 ORDER BY role,version DESC) v LEFT JOIN airhop_agent_procedures p ON p.community_id=v.community_id AND p.role=v.role AND p.id=v.procedure_id")
            .bind(tenant.community().as_uuid()).fetch_all(&self.pool).await?;
        let mut policies = Vec::new();
        for role in AgentRole::ALL {
            let row = rows
                .iter()
                .find(|row| row.get::<&str, _>("role") == role.as_str());
            let (policy, version) = match row {
                Some(row) => (
                    serde_json::from_value::<AgentPolicy>(row.try_get("policy")?)
                        .map_err(|e| DbError::InvalidData(e.to_string()))?,
                    row.try_get::<i64, _>("version")?,
                ),
                None => (AgentPolicy::for_role(role), 0),
            };
            let selected = selections
                .iter()
                .find(|row| row.try_get::<&str, _>("role").ok() == Some(role.as_str()));
            let procedure_version = selected
                .map(|r| r.try_get::<i64, _>("version"))
                .transpose()?
                .unwrap_or(0);
            let active_id = selected
                .map(|r| r.try_get::<Option<Uuid>, _>("procedure_id"))
                .transpose()?
                .flatten();
            let plans=candidates.iter().filter(|row|row.try_get::<&str,_>("role").ok()==Some(role.as_str())).map(|r|Ok(json!({"id":r.try_get::<Uuid,_>("id")?,"plan":r.try_get::<Value,_>("plan")?,"observations":r.try_get::<i64,_>("observations")?}))).collect::<Result<Vec<_>>>()?;
            let procedures =
                json!({"version":procedure_version,"activeId":active_id,"candidates":plans});
            let active_plan = selected
                .map(|r| r.try_get::<Option<Value>, _>("plan"))
                .transpose()?
                .flatten()
                .and_then(|v| {
                    serde_json::from_value::<airhop_core::agent_learning::ProcedurePlan>(v).ok()
                })
                .filter(|plan| plan.validate(role).is_ok());
            let active_procedure = if policy.enabled
                && policy.learning == airhop_core::agent_policy::LearningMode::Validated
            {
                active_plan.map(|plan|json!({"version":procedure_version,"plan":plan,"instruction":"Use this reviewed lookup order only for a matching task. Skip facts already known. Current role permissions and graph guards always win."}))
            } else {
                None
            };
            policies.push(json!({"role":role,"version":version,"policy":policy,"procedures":procedures,"activeProcedure":active_procedure}));
        }
        Ok(
            json!({"schemaVersion":"airhop.agent-policies.v1","canManage":can_manage,"policies":policies}),
        )
    }

    /// Applies one signed policy update atomically with its replay receipt.
    pub async fn apply_airhop_agent_policy(
        &self,
        tenant: &TenantContext,
        actor: &[u8; 32],
        event: &[u8; 32],
        command: &SetAgentPolicy,
    ) -> Result<Value> {
        command
            .policy
            .validate(command.role)
            .map_err(|e| DbError::InvalidData(e.into()))?;
        let community = *tenant.community().as_uuid();
        let mut tx = self.pool.begin().await?;
        let organization: Uuid = sqlx::query_scalar("SELECT id FROM airhop_organizations WHERE community_id=$1 AND status='active' FOR UPDATE")
            .bind(community).fetch_optional(tx.as_mut()).await?.ok_or_else(|| DbError::NotFound("active organization".into()))?;
        let role: Option<String> = sqlx::query_scalar(
            "SELECT role FROM relay_members WHERE community_id=$1 AND pubkey=$2 AND NOT EXISTS(SELECT 1 FROM airhop_registered_principals p WHERE p.community_id=$1 AND encode(p.pubkey,'hex')=$2) FOR SHARE",
        )
        .bind(community)
        .bind(hex::encode(actor))
        .fetch_optional(tx.as_mut())
        .await?;
        if !matches!(role.as_deref(), Some("owner" | "admin")) {
            return Err(DbError::AccessDenied(
                "agent settings require owner/admin".into(),
            ));
        }
        if let Some(receipt) = sqlx::query_scalar::<_, Value>(
            "SELECT result FROM airhop_agent_policy_receipts WHERE community_id=$1 AND event_id=$2",
        )
        .bind(community)
        .bind(event.as_slice())
        .fetch_optional(tx.as_mut())
        .await?
        {
            return Ok(receipt);
        }
        let actual: i64 = sqlx::query_scalar("SELECT version FROM airhop_agent_policies WHERE community_id=$1 AND organization_id=$2 AND role=$3")
            .bind(community).bind(organization).bind(command.role.as_str()).fetch_optional(tx.as_mut()).await?.unwrap_or(0);
        if actual != command.expected_version || actual < 0 {
            return Err(DbError::AirhopVersionConflict);
        }
        let version = actual
            .checked_add(1)
            .ok_or_else(|| DbError::InvalidData("policy version overflow".into()))?;
        if let Some(birthdays) = command
            .policy
            .birthdays
            .as_ref()
            .filter(|p| command.policy.enabled && p.enabled)
        {
            if let NoticeDestination::Channel { channel_id } = birthdays.destination {
                validate_notice_channel(tx.as_mut(), community, channel_id).await?;
            }
        }
        if let Some(channel) = command
            .policy
            .analytics
            .as_ref()
            .filter(|p| command.policy.enabled && p.enabled)
            .and_then(|policy| policy.channel_id)
        {
            validate_notice_channel(tx.as_mut(), community, channel).await?;
        }
        let policy = serde_json::to_value(&command.policy)
            .map_err(|e| DbError::InvalidData(e.to_string()))?;
        sqlx::query("INSERT INTO airhop_agent_policies(community_id,organization_id,role,policy,version,updated_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(community_id,organization_id,role) DO UPDATE SET policy=EXCLUDED.policy,version=EXCLUDED.version,updated_by=EXCLUDED.updated_by,updated_at=now()")
            .bind(community).bind(organization).bind(command.role.as_str()).bind(&policy).bind(version).bind(actor.as_slice()).execute(tx.as_mut()).await?;
        // A queued message must never carry old content or use a revoked destination.
        sqlx::query("UPDATE airhop_agent_notice_jobs SET status='cancelled' WHERE community_id=$1 AND organization_id=$2 AND role=$3 AND status='pending'")
            .bind(community).bind(organization).bind(command.role.as_str()).execute(tx.as_mut()).await?;
        let result = json!({"role":command.role,"version":version,"policy":policy});
        sqlx::query("INSERT INTO airhop_agent_policy_receipts(community_id,event_id,result) VALUES($1,$2,$3)")
            .bind(community).bind(event.as_slice()).bind(&result).execute(tx.as_mut()).await?;
        tx.commit().await?;
        Ok(result)
    }
}

/// Shared delivery boundary: an active private stream with only admitted staff
/// and registered internal principals. Rechecked immediately before publication.
pub(crate) async fn validate_notice_channel(
    connection: &mut PgConnection,
    community: Uuid,
    channel: Uuid,
) -> Result<()> {
    let valid: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM channels c WHERE c.community_id=$1 AND c.id=$2 AND c.channel_type='stream' AND c.visibility='private' AND c.deleted_at IS NULL AND c.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM channel_members m WHERE m.community_id=c.community_id AND m.channel_id=c.id AND m.removed_at IS NULL AND NOT EXISTS(SELECT 1 FROM relay_members r WHERE r.community_id=m.community_id AND r.pubkey=encode(m.pubkey,'hex') AND r.role IN ('owner','admin','member') AND NOT EXISTS(SELECT 1 FROM airhop_registered_principals service WHERE service.community_id=m.community_id AND service.pubkey=m.pubkey) AND m.role<>'bot' AND NOT EXISTS(SELECT 1 FROM users u WHERE u.community_id=m.community_id AND u.pubkey=m.pubkey AND (u.deactivated_at IS NOT NULL OR u.agent_owner_pubkey IS NOT NULL))) AND NOT EXISTS(SELECT 1 FROM airhop_registered_principals p WHERE p.community_id=m.community_id AND p.pubkey=m.pubkey AND p.enabled AND p.role IN ('fizz','administrator','analyst','content_marketer'))))")
        .bind(community).bind(channel).fetch_one(connection).await?;
    if valid {
        Ok(())
    } else {
        Err(DbError::AccessDenied(
            "choose an active private staff channel".into(),
        ))
    }
}
