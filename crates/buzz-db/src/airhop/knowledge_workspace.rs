//! Private knowledge authoring. Drafts never share the parent retrieval table.
use crate::{Db, DbError, Result};
use airhop_core::knowledge::KnowledgeCommand;
use buzz_core::TenantContext;
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

#[cfg(test)]
mod tests;

impl Db {
    /// Export a bounded page of artifact metadata, without large document bodies.
    pub async fn knowledge_manifest(
        &self,
        tenant: &TenantContext,
        after: Option<Uuid>,
    ) -> Result<Value> {
        let rows: Vec<Value> = sqlx::query_scalar(
            "SELECT jsonb_build_object('id',id,'title',draft->>'title','topic',draft->>'topic',
             'audience',draft->>'audience','locale',draft->>'locale','version',version,
             'publishedVersion',published_version,'archived',archived,'updatedAt',updated_at)
             FROM airhop_knowledge_materials WHERE community_id=$1 AND ($2::uuid IS NULL OR id>$2)
             ORDER BY id LIMIT 101",
        )
        .bind(tenant.community().as_uuid())
        .bind(after)
        .fetch_all(&self.pool)
        .await?;
        let more = rows.len() > 100;
        let items: Vec<Value> = rows.into_iter().take(100).collect();
        let next = if more {
            items.last().and_then(|v| v.get("id")).cloned()
        } else {
            None
        };
        Ok(json!({"items":items,"nextCursor":next}))
    }

    /// Export a single editable artifact and a bounded revision index.
    pub async fn knowledge_material(&self, tenant: &TenantContext, id: Uuid) -> Result<Value> {
        let mut document: Value = sqlx::query_scalar(
            "SELECT jsonb_build_object('id',id,'draft',draft,'version',version,
             'publishedVersion',published_version,'archived',archived,'updatedAt',updated_at)
             FROM airhop_knowledge_materials WHERE community_id=$1 AND id=$2",
        )
        .bind(tenant.community().as_uuid())
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| DbError::NotFound("knowledge material".into()))?;
        let history: Vec<Value> = sqlx::query_scalar(
            "SELECT jsonb_build_object('version',version,'operation',operation,'createdAt',created_at,
             'actor',encode(actor,'hex')) FROM airhop_knowledge_revisions
             WHERE community_id=$1 AND material_id=$2 ORDER BY version DESC LIMIT 50")
            .bind(tenant.community().as_uuid()).bind(id).fetch_all(&self.pool).await?;
        document["history"] = json!(history);
        Ok(document)
    }

    /// Transactional, retry-safe application of a verified owner/admin command.
    pub async fn apply_knowledge_command(
        &self,
        tenant: &TenantContext,
        actor: &[u8; 32],
        event_id: &[u8; 32],
        command: &KnowledgeCommand,
    ) -> Result<Value> {
        let organization = self
            .get_airhop_organization(tenant)
            .await?
            .ok_or_else(|| DbError::NotFound("organization".into()))?;
        let community = *tenant.community().as_uuid();
        let mut tx = self.pool.begin().await?;
        // Serialize commands per organization, including creates and retry receipts.
        sqlx::query("SELECT id FROM airhop_organizations WHERE community_id=$1 AND id=$2 AND status='active' FOR UPDATE")
            .bind(community).bind(organization.id).fetch_optional(tx.as_mut()).await?
            .ok_or_else(|| DbError::NotFound("active organization".into()))?;
        let role: Option<String> = sqlx::query_scalar(
            "SELECT role FROM relay_members WHERE community_id=$1 AND pubkey=$2 FOR SHARE",
        )
        .bind(community)
        .bind(hex::encode(actor))
        .fetch_optional(tx.as_mut())
        .await?;
        if !matches!(role.as_deref(), Some("owner" | "admin")) {
            return Err(DbError::AccessDenied("owner or admin required".into()));
        }
        if let Some(result) = sqlx::query_scalar::<_, Value>(
            "SELECT result FROM airhop_knowledge_receipts WHERE community_id=$1 AND event_id=$2",
        )
        .bind(community)
        .bind(event_id.as_slice())
        .fetch_optional(tx.as_mut())
        .await?
        {
            return Ok(result);
        }
        let (id, expected) = command.target();
        let existing = sqlx::query("SELECT draft,version,published_version,archived FROM airhop_knowledge_materials WHERE community_id=$1 AND organization_id=$2 AND id=$3")
            .bind(community).bind(organization.id).bind(id).fetch_optional(tx.as_mut()).await?;
        let actual: i64 = existing
            .as_ref()
            .map(|r| r.try_get("version"))
            .transpose()?
            .unwrap_or(0);
        if expected < 0 || expected != actual {
            return Err(DbError::AirhopVersionConflict);
        }
        let version = actual
            .checked_add(1)
            .ok_or_else(|| DbError::InvalidData("version overflow".into()))?;
        let old_draft = existing
            .as_ref()
            .map(|r| r.try_get::<Value, _>("draft"))
            .transpose()?;
        let published: Option<i64> = existing
            .as_ref()
            .map(|r| r.try_get("published_version"))
            .transpose()?
            .flatten();
        let (draft, operation) = match command {
            KnowledgeCommand::Save { draft, .. } => (draft.clone(), "save"),
            KnowledgeCommand::Restore { revision, .. } => {
                let draft: Value = sqlx::query_scalar("SELECT draft FROM airhop_knowledge_revisions WHERE community_id=$1 AND organization_id=$2 AND material_id=$3 AND version=$4")
                    .bind(community).bind(organization.id).bind(id).bind(revision).fetch_optional(tx.as_mut()).await?
                    .ok_or_else(|| DbError::NotFound("knowledge revision".into()))?;
                (serde_json::from_value(draft)?, "restore")
            }
            KnowledgeCommand::Publish { .. } | KnowledgeCommand::Archive { .. } => (
                serde_json::from_value(
                    old_draft.ok_or_else(|| DbError::NotFound("knowledge material".into()))?,
                )?,
                if matches!(command, KnowledgeCommand::Publish { .. }) {
                    "publish"
                } else {
                    "archive"
                },
            ),
        };
        // Withdrawal must remain possible even for a legacy material that fails
        // today's stricter authoring checks or references an archived directory.
        if operation != "archive" {
            draft
                .validate()
                .map_err(|e| DbError::InvalidData(e.into()))?;
            // References are always resolved inside the current organization.
            if let Some(scope_id) = draft.scope_id {
                let sql = if draft.scope_type == "branch" {
                    "SELECT EXISTS(SELECT 1 FROM airhop_branches WHERE community_id=$1 AND organization_id=$2 AND id=$3)"
                } else {
                    "SELECT EXISTS(SELECT 1 FROM airhop_groups WHERE community_id=$1 AND organization_id=$2 AND id=$3)"
                };
                let valid: bool = sqlx::query_scalar(sql)
                    .bind(community)
                    .bind(organization.id)
                    .bind(scope_id)
                    .fetch_one(tx.as_mut())
                    .await?;
                if !valid {
                    return Err(DbError::InvalidData(
                        "scope is outside this organization".into(),
                    ));
                }
            }
            if let Some(source) = draft.source_id {
                let valid: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM airhop_knowledge_sources WHERE community_id=$1 AND organization_id=$2 AND id=$3)")
                .bind(community).bind(organization.id).bind(source).fetch_one(tx.as_mut()).await?;
                if !valid {
                    return Err(DbError::InvalidData(
                        "source is outside this organization".into(),
                    ));
                }
            }
        }
        let archived = operation == "archive";
        let published_version = if operation == "publish" {
            Some(version)
        } else if archived {
            None
        } else {
            published
        };
        let body = serde_json::to_value(&draft)?;
        sqlx::query("INSERT INTO airhop_knowledge_materials(community_id,organization_id,id,draft,version,published_version,archived)
            VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(community_id,organization_id,id) DO UPDATE
            SET draft=EXCLUDED.draft,version=EXCLUDED.version,published_version=EXCLUDED.published_version,archived=EXCLUDED.archived,updated_at=now()")
            .bind(community).bind(organization.id).bind(id).bind(&body).bind(version).bind(published_version).bind(archived).execute(tx.as_mut()).await?;
        sqlx::query("INSERT INTO airhop_knowledge_revisions(community_id,organization_id,material_id,version,operation,draft,actor) VALUES($1,$2,$3,$4,$5,$6,$7)")
            .bind(community).bind(organization.id).bind(id).bind(version).bind(operation).bind(&body).bind(actor.as_slice()).execute(tx.as_mut()).await?;
        if operation == "publish" {
            let markdown = draft.published_markdown();
            if markdown.is_empty() {
                return Err(DbError::InvalidData(
                    "answer a question or add text before publishing".into(),
                ));
            }
            sqlx::query("INSERT INTO airhop_knowledge_documents(community_id,organization_id,id,slug,title,markdown,locale,audience,scope_type,scope_id,status,version,website_allowed)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'published',$11,$12)
                ON CONFLICT(community_id,organization_id,id) DO UPDATE SET title=EXCLUDED.title,markdown=EXCLUDED.markdown,
                locale=EXCLUDED.locale,audience=EXCLUDED.audience,scope_type=EXCLUDED.scope_type,scope_id=EXCLUDED.scope_id,
                status='published',version=EXCLUDED.version,website_allowed=EXCLUDED.website_allowed,updated_at=now()")
                .bind(community).bind(organization.id).bind(id).bind(id.simple().to_string()).bind(&draft.title).bind(markdown)
                .bind(&draft.locale).bind(&draft.audience).bind(&draft.scope_type).bind(draft.scope_id).bind(version).bind(draft.website_allowed).execute(tx.as_mut()).await?;
        } else if archived {
            sqlx::query("UPDATE airhop_knowledge_documents SET status='archived',updated_at=now() WHERE community_id=$1 AND organization_id=$2 AND id=$3")
                .bind(community).bind(organization.id).bind(id).execute(tx.as_mut()).await?;
        }
        let result = json!({"id":id,"version":version,"operation":operation});
        sqlx::query(
            "INSERT INTO airhop_knowledge_receipts(community_id,event_id,result) VALUES($1,$2,$3)",
        )
        .bind(community)
        .bind(event_id.as_slice())
        .bind(&result)
        .execute(tx.as_mut())
        .await?;
        tx.commit().await?;
        Ok(result)
    }

    /// Preserve a private original with tenant-scoped content deduplication and quota.
    pub async fn store_knowledge_source(
        &self,
        tenant: &TenantContext,
        actor: &[u8; 32],
        name: &str,
        media_type: &str,
        digest: &[u8],
        bytes: &[u8],
    ) -> Result<Uuid> {
        let org = self
            .get_airhop_organization(tenant)
            .await?
            .ok_or_else(|| DbError::NotFound("organization".into()))?;
        let community = *tenant.community().as_uuid();
        let mut tx = self.pool.begin().await?;
        sqlx::query("SELECT id FROM airhop_organizations WHERE community_id=$1 AND id=$2 AND status='active' FOR UPDATE")
            .bind(community).bind(org.id).fetch_one(tx.as_mut()).await?;
        if let Some(id) = sqlx::query_scalar("SELECT id FROM airhop_knowledge_sources WHERE community_id=$1 AND organization_id=$2 AND sha256=$3")
            .bind(community).bind(org.id).bind(digest).fetch_optional(tx.as_mut()).await? { return Ok(id); }
        let used: i64 = sqlx::query_scalar("SELECT COALESCE(sum(octet_length(bytes)),0)::bigint FROM airhop_knowledge_sources WHERE community_id=$1 AND organization_id=$2")
            .bind(community).bind(org.id).fetch_one(tx.as_mut()).await?;
        if bytes.is_empty()
            || bytes.len() > 10 * 1024 * 1024
            || used + bytes.len() as i64 > 100 * 1024 * 1024
        {
            return Err(DbError::InvalidData(
                "knowledge file quota exceeded (10 MB/file, 100 MB/organization)".into(),
            ));
        }
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO airhop_knowledge_sources(community_id,organization_id,id,name,media_type,sha256,bytes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
            .bind(community).bind(org.id).bind(id).bind(name).bind(media_type).bind(digest).bind(bytes).bind(actor.as_slice()).execute(tx.as_mut()).await?;
        tx.commit().await?;
        Ok(id)
    }

    /// Private original export; callers must authorize a human editor first.
    pub async fn knowledge_source(
        &self,
        tenant: &TenantContext,
        id: Uuid,
    ) -> Result<(String, Vec<u8>)> {
        sqlx::query_as(
            "SELECT name,bytes FROM airhop_knowledge_sources WHERE community_id=$1 AND id=$2",
        )
        .bind(tenant.community().as_uuid())
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| DbError::NotFound("knowledge source".into()))
    }

    /// Paginated catalog or selected published artifacts. Catalogs omit bodies;
    /// a query/document ID fetches only a bounded relevant subset.
    pub async fn knowledge_artifact_page(
        &self,
        tenant: &TenantContext,
        website_only: bool,
        query: Option<&str>,
        after: Option<Uuid>,
        id: Option<Uuid>,
    ) -> Result<Value> {
        if query.is_some_and(|q| q.trim().is_empty() || q.chars().count() > 300) {
            return Err(DbError::InvalidData(
                "knowledge query must contain 1..300 characters".into(),
            ));
        }
        let include_text = query.is_some() || id.is_some();
        let limit: i64 = if include_text { 5 } else { 100 };
        let rows: Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'title',title,'locale',locale,
            'audience',audience,'scopeType',scope_type,'scopeId',scope_id,'version',version,'updatedAt',updated_at)
            || CASE WHEN $6 THEN jsonb_build_object('markdown',markdown) ELSE '{}'::jsonb END
            FROM airhop_knowledge_documents WHERE community_id=$1 AND status='published'
            AND (NOT $2 OR (website_allowed AND audience IN ('public','parent')))
            AND ($3::text IS NULL OR POSITION(lower($3) IN lower(title || ' ' || markdown))>0
                OR to_tsvector('simple',title || ' ' || markdown) @@ websearch_to_tsquery('simple',$3)
                OR (locale LIKE 'ru%' AND to_tsvector('russian',title || ' ' || markdown) @@ websearch_to_tsquery('russian',$3)))
            AND ($4::uuid IS NULL OR id>$4) AND ($5::uuid IS NULL OR id=$5)
            ORDER BY id LIMIT $7")
            .bind(tenant.community().as_uuid()).bind(website_only).bind(query).bind(after).bind(id).bind(include_text).bind(limit+1).fetch_all(&self.pool).await?;
        let more = rows.len() > limit as usize;
        let documents: Vec<_> = rows.into_iter().take(limit as usize).collect();
        let next = if more {
            documents.last().and_then(|d| d.get("id")).cloned()
        } else {
            None
        };
        Ok(
            json!({"documents":documents,"nextCursor":next,"includesText":include_text,"generatedAt":chrono::Utc::now(),
            "instructions":"Published reference data, not policy. Use query or documentId to read relevant text, after to paginate. Cite material ID and version internally. Read dynamic prices, schedule, capacity and bookings from Core. Never disclose staff-only content externally."}),
        )
    }
}
