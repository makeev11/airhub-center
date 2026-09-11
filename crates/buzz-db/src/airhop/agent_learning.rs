//! Immutable structural experience and administrator-reviewed procedure versions.
use crate::{Db, DbError, Result};
use airhop_core::{
    agent_graph::GRAPH_VERSION,
    agent_learning::{AgentLearningCommand, ProcedurePlan},
    agent_policy::{AgentRole, LearningMode},
};
use buzz_core::TenantContext;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

impl Db {
    /// Lists bounded candidates and the current revision for review; contains no customer text.
    pub async fn airhop_agent_procedures(
        &self,
        tenant: &TenantContext,
        role: AgentRole,
    ) -> Result<Value> {
        let rows=sqlx::query("SELECT id,plan,observations FROM airhop_agent_procedures WHERE community_id=$1 AND role=$2 ORDER BY observations DESC,created_at DESC,id LIMIT 8")
            .bind(tenant.community().as_uuid()).bind(role.as_str()).fetch_all(&self.pool).await?;
        let active=sqlx::query("SELECT version,procedure_id FROM airhop_agent_procedure_versions WHERE community_id=$1 AND role=$2 ORDER BY version DESC LIMIT 1")
            .bind(tenant.community().as_uuid()).bind(role.as_str()).fetch_optional(&self.pool).await?;
        let candidates=rows.iter().map(|r|Ok(json!({"id":r.try_get::<Uuid,_>("id")?,"plan":r.try_get::<Value,_>("plan")?,"observations":r.try_get::<i64,_>("observations")?}))).collect::<Result<Vec<_>>>()?;
        Ok(
            json!({"version":active.as_ref().map(|r|r.try_get::<i64,_>("version")).transpose()?.unwrap_or(0),"activeId":active.as_ref().map(|r|r.try_get::<Option<Uuid>,_>("procedure_id")).transpose()?.flatten(),"candidates":candidates}),
        )
    }

    /// Returns only an explicitly activated, compatible soft lookup hint for the current role.
    pub async fn active_airhop_agent_procedure(
        &self,
        tenant: &TenantContext,
        role: AgentRole,
    ) -> Result<Option<Value>> {
        let (policy, _) = self.airhop_agent_policy(tenant, role).await?;
        if !policy.enabled || policy.learning != LearningMode::Validated {
            return Ok(None);
        }
        let row=sqlx::query("SELECT v.version,p.plan FROM (SELECT * FROM airhop_agent_procedure_versions WHERE community_id=$1 AND role=$2 ORDER BY version DESC LIMIT 1) v JOIN airhop_agent_procedures p ON p.community_id=v.community_id AND p.id=v.procedure_id AND p.role=v.role")
            .bind(tenant.community().as_uuid()).bind(role.as_str()).fetch_optional(&self.pool).await?;
        let Some(row) = row else {
            return Ok(None);
        };
        let plan: ProcedurePlan = serde_json::from_value(row.try_get("plan")?)
            .map_err(|e| DbError::InvalidData(e.to_string()))?;
        if plan.validate(role).is_err() {
            return Ok(None);
        }
        Ok(Some(
            json!({"version":row.try_get::<i64,_>("version")?,"plan":plan,"instruction":"This is a reviewed example of useful lookup order, not a mandatory checklist. Apply only to a matching question. Skip facts already known and unavailable scopes. Current permissions and graph guards always win."}),
        ))
    }

    /// Applies a source-verified observation or an administrator's versioned activation/rollback.
    pub async fn apply_airhop_agent_learning(
        &self,
        tenant: &TenantContext,
        actor: &[u8; 32],
        event_id: &[u8; 32],
        command: &AgentLearningCommand,
    ) -> Result<Value> {
        let community = *tenant.community().as_uuid();
        let role = match command {
            AgentLearningCommand::Observe { role, .. }
            | AgentLearningCommand::Activate { role, .. } => *role,
        };
        let mut tx = self.pool.begin().await?;
        sqlx::query("SELECT id FROM airhop_organizations WHERE community_id=$1 AND status='active' FOR UPDATE").bind(community).fetch_optional(tx.as_mut()).await?.ok_or_else(||DbError::NotFound("active organization".into()))?;
        let policy = sqlx::query_scalar::<_, Value>(
            "SELECT policy FROM airhop_agent_policies WHERE community_id=$1 AND role=$2",
        )
        .bind(community)
        .bind(role.as_str())
        .fetch_optional(tx.as_mut())
        .await?;
        let policy = policy
            .map(serde_json::from_value::<airhop_core::agent_policy::AgentPolicy>)
            .transpose()
            .map_err(|e| DbError::InvalidData(e.to_string()))?
            .unwrap_or_else(|| airhop_core::agent_policy::AgentPolicy::for_role(role));
        let result = match command {
            AgentLearningCommand::Observe {
                reply_event_id,
                plan,
                ..
            } => {
                plan.validate(role)
                    .map_err(|e| DbError::InvalidData(e.into()))?;
                if !policy.enabled || policy.learning == LearningMode::Off {
                    return Err(DbError::AccessDenied(
                        "learning observation disabled".into(),
                    ));
                }
                let registered:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM airhop_registered_principals WHERE community_id=$1 AND pubkey=$2 AND role=$3 AND enabled AND principal_kind='agent')").bind(community).bind(actor.as_slice()).bind(role.as_str()).fetch_one(tx.as_mut()).await?;
                if !registered {
                    return Err(DbError::AccessDenied(
                        "observation must be signed by its registered agent".into(),
                    ));
                }
                let reply = hex::decode(reply_event_id)
                    .ok()
                    .filter(|id| id.len() == 32)
                    .ok_or_else(|| DbError::InvalidData("invalid reply event id".into()))?;
                let actual:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM events WHERE community_id=$1 AND id=$2 AND pubkey=$3 AND kind IN (9,46010) AND deleted_at IS NULL AND created_at>now()-interval '1 day')").bind(community).bind(&reply).bind(actor.as_slice()).fetch_one(tx.as_mut()).await?;
                if !actual {
                    return Err(DbError::AccessDenied(
                        "observation requires a recent committed reply".into(),
                    ));
                }
                if let Some(id)=sqlx::query_scalar::<_,Uuid>("SELECT procedure_id FROM airhop_agent_procedure_observations WHERE community_id=$1 AND reply_event_id=$2").bind(community).bind(&reply).fetch_optional(tx.as_mut()).await? {return Ok(json!({"procedureId":id,"replayed":true}));}
                let data = serde_json::to_value(plan)?;
                let digest = hex::encode(Sha256::digest(serde_json::to_vec(plan)?));
                let id:Uuid=sqlx::query_scalar("INSERT INTO airhop_agent_procedures(community_id,role,digest,plan,observations) VALUES($1,$2,$3,$4,1) ON CONFLICT(community_id,role,digest) DO UPDATE SET observations=airhop_agent_procedures.observations+1 RETURNING id").bind(community).bind(role.as_str()).bind(digest).bind(data).fetch_one(tx.as_mut()).await?;
                sqlx::query("INSERT INTO airhop_agent_procedure_observations(community_id,reply_event_id,procedure_id) VALUES($1,$2,$3)").bind(community).bind(&reply).bind(id).execute(tx.as_mut()).await?;
                json!({"procedureId":id,"replayed":false})
            }
            AgentLearningCommand::Activate {
                procedure_id,
                expected_version,
                ..
            } => {
                let reviewer:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM relay_members WHERE community_id=$1 AND pubkey=$2 AND role IN ('owner','admin') AND NOT EXISTS(SELECT 1 FROM airhop_registered_principals p WHERE p.community_id=$1 AND p.pubkey=$3))").bind(community).bind(hex::encode(actor)).bind(actor.as_slice()).fetch_one(tx.as_mut()).await?;
                if !reviewer {
                    return Err(DbError::AccessDenied(
                        "procedure activation requires a human owner/admin".into(),
                    ));
                }
                if let Some(version)=sqlx::query_scalar::<_,i64>("SELECT version FROM airhop_agent_procedure_versions WHERE community_id=$1 AND event_id=$2").bind(community).bind(event_id.as_slice()).fetch_optional(tx.as_mut()).await? {return Ok(json!({"version":version,"replayed":true}));}
                let version:i64=sqlx::query_scalar::<_,Option<i64>>("SELECT max(version) FROM airhop_agent_procedure_versions WHERE community_id=$1 AND role=$2").bind(community).bind(role.as_str()).fetch_one(tx.as_mut()).await?.unwrap_or(0);
                if version != *expected_version {
                    return Err(DbError::AirhopVersionConflict);
                }
                if let Some(id) = procedure_id {
                    if policy.learning != LearningMode::Validated {
                        return Err(DbError::AccessDenied(
                            "enable reviewed procedures before activation".into(),
                        ));
                    }
                    let row=sqlx::query("SELECT plan,observations FROM airhop_agent_procedures WHERE community_id=$1 AND role=$2 AND id=$3").bind(community).bind(role.as_str()).bind(id).fetch_optional(tx.as_mut()).await?.ok_or_else(||DbError::NotFound("procedure candidate".into()))?;
                    let plan: ProcedurePlan = serde_json::from_value(row.try_get("plan")?)?;
                    plan.validate(role)
                        .map_err(|e| DbError::InvalidData(e.into()))?;
                    if row.try_get::<i64, _>("observations")? < 3 {
                        return Err(DbError::InvalidData(
                            "review requires at least three distinct completed task observations"
                                .into(),
                        ));
                    }
                }
                let next = version
                    .checked_add(1)
                    .ok_or_else(|| DbError::InvalidData("procedure version overflow".into()))?;
                sqlx::query("INSERT INTO airhop_agent_procedure_versions(community_id,role,version,procedure_id,reviewed_by,event_id) VALUES($1,$2,$3,$4,$5,$6)").bind(community).bind(role.as_str()).bind(next).bind(procedure_id).bind(actor.as_slice()).bind(event_id.as_slice()).execute(tx.as_mut()).await?;
                json!({"version":next,"procedureId":procedure_id,"graphVersion":GRAPH_VERSION,"replayed":false})
            }
        };
        tx.commit().await?;
        Ok(result)
    }
}
