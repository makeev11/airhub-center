//! Canonical identity classification for staff and the organization agent picker.
use super::*;

impl Db {
    /// Returns only this organization's registered active agents and its service keys.
    /// A missing profile never turns a human member into an agent or hides the member.
    pub async fn airhop_principal_directory(
        &self,
        tenant: &TenantContext,
        organization: Uuid,
    ) -> Result<Value> {
        let agents: Vec<Value> = sqlx::query_scalar(
            "SELECT jsonb_build_object('id',id,'pubkey',encode(pubkey,'hex'),'role',role,'deploymentId',deployment_id) FROM (
               SELECT DISTINCT ON (p.pubkey) p.organization_id::text || ':' || p.role AS id,p.pubkey,p.role,p.deployment_id
               FROM airhop_registered_principals p
               JOIN airhop_organizations o ON o.community_id=p.community_id AND o.id=p.organization_id AND o.status='active'
               LEFT JOIN users u ON u.community_id=p.community_id AND u.pubkey=p.pubkey
               WHERE p.community_id=$1 AND p.organization_id=$2 AND p.principal_kind='agent' AND p.enabled
                 AND u.deactivated_at IS NULL
                 AND EXISTS (SELECT 1 FROM channel_members m JOIN channels c ON c.community_id=m.community_id AND c.id=m.channel_id
                     WHERE m.community_id=p.community_id AND m.pubkey=p.pubkey AND m.removed_at IS NULL AND c.deleted_at IS NULL AND c.archived_at IS NULL)
               ORDER BY p.pubkey,p.role
             ) registered ORDER BY role,id",
        ).bind(tenant.community().as_uuid()).bind(organization).fetch_all(&self.pool).await?;
        let principals: Vec<Value> = sqlx::query_scalar(
            "SELECT jsonb_build_object('pubkey',encode(pubkey,'hex'),'kind',kind) FROM (
              SELECT DISTINCT ON (pubkey) pubkey,kind FROM (
                SELECT pubkey,principal_kind AS kind,0 AS priority FROM airhop_registered_principals WHERE community_id=$1
                UNION ALL SELECT pubkey,'agent',1 FROM channel_members WHERE community_id=$1 AND role='bot'
              ) candidates ORDER BY pubkey,priority,kind
            ) identities",
        ).bind(tenant.community().as_uuid()).fetch_all(&self.pool).await?;
        Ok(
            serde_json::json!({"communityId":tenant.community().as_uuid(),"organizationId":organization,"agents":agents,"principals":principals}),
        )
    }
}

#[cfg(test)]
mod tests;
