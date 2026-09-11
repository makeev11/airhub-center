//! Audited branch responsibility settings. This roster never grants channel access.
use super::*;
use airhop_core::client_conversations::BranchResponsiblesCommand;

impl Db {
    /// Owner/admin-only branch roster replacement with CAS and retry receipts.
    pub async fn set_branch_client_responsibles(
        &self,
        tenant: &TenantContext,
        actor: &[u8; 32],
        command: &BranchResponsiblesCommand,
    ) -> Result<Value> {
        if command.branch_id.is_nil()
            || command.idempotency_key.is_nil()
            || command.expected_version < 1
            || command.responsible_pubkeys.len() > 8
        {
            return Err(DbError::InvalidData("invalid responsible roster".into()));
        }
        let mut keys = std::collections::BTreeSet::new();
        for value in &command.responsible_pubkeys {
            let key = hex::decode(value)
                .map_err(|_| DbError::InvalidData("invalid staff public key".into()))?;
            if key.len() != 32 || !keys.insert(key) {
                return Err(DbError::InvalidData(
                    "invalid or duplicate staff public key".into(),
                ));
            }
        }
        let community = *tenant.community().as_uuid();
        let mut tx = self.pool.begin().await?;
        let row=sqlx::query("SELECT b.organization_id,b.version FROM airhop_branches b JOIN airhop_organizations o ON o.community_id=b.community_id AND o.id=b.organization_id AND o.status='active' JOIN relay_members owner ON owner.community_id=b.community_id AND owner.pubkey=$3 AND owner.role IN ('owner','admin') WHERE b.community_id=$1 AND b.id=$2 AND b.status='active' FOR UPDATE OF b")
            .bind(community).bind(command.branch_id).bind(hex::encode(actor)).fetch_optional(&mut *tx).await?.ok_or_else(||DbError::AccessDenied("Active branch and owner/admin required".into()))?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
            .bind(format!(
                "airhop_branch_responsibles:{community}:{}",
                command.idempotency_key
            ))
            .execute(&mut *tx)
            .await?;
        let request = serde_json::to_value(command)?;
        if let Some(receipt)=sqlx::query("SELECT request,result,actor_pubkey FROM airhop_branch_client_routing_changes WHERE community_id=$1 AND idempotency_key=$2")
            .bind(community).bind(command.idempotency_key).fetch_optional(&mut *tx).await? {
            if receipt.try_get::<Value,_>("request")?!=request || receipt.try_get::<Vec<u8>,_>("actor_pubkey")?.as_slice()!=actor {return Err(DbError::AirhopVersionConflict);}
            return Ok(receipt.try_get("result")?);
        }
        if row.try_get::<i64, _>("version")? != command.expected_version {
            return Err(DbError::AirhopVersionConflict);
        }
        let organization: Uuid = row.try_get("organization_id")?;
        for key in &keys {
            let valid:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM relay_members staff LEFT JOIN users u ON u.community_id=staff.community_id AND u.pubkey=decode(staff.pubkey,'hex') WHERE staff.community_id=$1 AND staff.pubkey=$2 AND u.deactivated_at IS NULL AND NOT EXISTS(SELECT 1 FROM airhop_agent_deployments d WHERE d.community_id=staff.community_id AND d.agent_pubkey=$3) AND NOT EXISTS(SELECT 1 FROM airhop_channel_connections c WHERE c.community_id=staff.community_id AND c.connector_pubkey=$3))")
                .bind(community).bind(hex::encode(key)).bind(key).fetch_one(&mut *tx).await?;
            if !valid {
                return Err(DbError::AccessDenied(
                    "Responsible must be existing active internal staff".into(),
                ));
            }
        }
        sqlx::query("DELETE FROM airhop_branch_client_responsibles WHERE community_id=$1 AND organization_id=$2 AND branch_id=$3")
            .bind(community).bind(organization).bind(command.branch_id).execute(&mut *tx).await?;
        for key in keys {
            sqlx::query("INSERT INTO airhop_branch_client_responsibles (community_id,organization_id,branch_id,pubkey) VALUES ($1,$2,$3,$4)")
                .bind(community).bind(organization).bind(command.branch_id).bind(key).execute(&mut *tx).await?;
        }
        let result:Value=sqlx::query_scalar("UPDATE airhop_branches SET version=version+1,updated_at=now() WHERE community_id=$1 AND id=$2 RETURNING jsonb_build_object('branchId',id,'version',version)")
            .bind(community).bind(command.branch_id).fetch_one(&mut *tx).await?;
        sqlx::query("INSERT INTO airhop_branch_client_routing_changes (community_id,organization_id,branch_id,idempotency_key,actor_pubkey,request,result) VALUES ($1,$2,$3,$4,$5,$6,$7)")
            .bind(community).bind(organization).bind(command.branch_id).bind(command.idempotency_key).bind(actor.as_slice()).bind(request).bind(&result).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(result)
    }
}
