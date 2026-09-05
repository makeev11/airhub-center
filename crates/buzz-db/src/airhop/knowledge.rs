//! Tenant-scoped published Markdown for AirHop agent retrieval.

use buzz_core::TenantContext;
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::Row;
use uuid::Uuid;

use crate::{Db, DbError, Result};

const MAX_QUERY_CHARS: usize = 300;
const MAX_RESULTS: i64 = 20;

/// One approved knowledge document visible to an agent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishedKnowledgeDocument {
    /// Stable document identifier.
    pub id: Uuid,
    /// Stable human-readable key.
    pub slug: String,
    /// Display title.
    pub title: String,
    /// Approved Markdown body.
    pub markdown: String,
    /// Exact BCP-47 locale of this revision.
    pub locale: String,
    /// `public` or `parent` for the parent-facing surface.
    pub audience: String,
    /// `organization`, `branch`, or `group`.
    pub scope_type: String,
    /// Branch/group identifier for scoped documents.
    pub scope_id: Option<Uuid>,
    /// Optimistic document version.
    pub version: i64,
    /// Last publication update.
    pub updated_at: DateTime<Utc>,
}

/// Server-derived scopes that parent-facing retrieval may traverse.
#[derive(Debug, Clone)]
pub struct ParentKnowledgeScope {
    /// Exact requested locale.
    pub locale: String,
    /// Branches connected to this family or current public selection.
    pub branch_ids: Vec<Uuid>,
    /// Groups connected to this family or current public selection.
    pub group_ids: Vec<Uuid>,
}

impl Db {
    /// Searches only published parent-safe documents inside server-derived scope.
    pub async fn search_airhop_parent_knowledge(
        &self,
        tenant: &TenantContext,
        scope: &ParentKnowledgeScope,
        query: &str,
        limit: u8,
    ) -> Result<Vec<PublishedKnowledgeDocument>> {
        let query = query.trim();
        if query.is_empty() || query.chars().count() > MAX_QUERY_CHARS {
            return Err(DbError::InvalidData(format!(
                "AirHub knowledge query must contain 1..={MAX_QUERY_CHARS} characters"
            )));
        }
        let locale = scope.locale.trim();
        if locale.len() < 2 || locale.len() > 35 {
            return Err(DbError::InvalidData(
                "AirHub knowledge locale is invalid".to_owned(),
            ));
        }
        let limit = i64::from(limit).clamp(1, MAX_RESULTS);
        let organization = self
            .get_airhop_organization(tenant)
            .await?
            .ok_or_else(|| DbError::NotFound("AirHub organization".to_owned()))?;
        let rows = sqlx::query(
            "SELECT id, slug, title, markdown, locale, audience, scope_type, scope_id, \
                    version, updated_at \
             FROM airhop_knowledge_documents \
             WHERE community_id = $1 AND organization_id = $2 \
               AND status = 'published' AND audience IN ('public', 'parent') \
               AND locale = $3 \
               AND (scope_type = 'organization' \
                    OR (scope_type = 'branch' AND scope_id = ANY($4::UUID[])) \
                    OR (scope_type = 'group' AND scope_id = ANY($5::UUID[]))) \
               AND (POSITION(lower($6) IN lower(title)) > 0 \
                    OR POSITION(lower($6) IN lower(markdown)) > 0) \
             ORDER BY CASE scope_type WHEN 'group' THEN 0 WHEN 'branch' THEN 1 ELSE 2 END, \
                      CASE audience WHEN 'parent' THEN 0 ELSE 1 END, updated_at DESC, id \
             LIMIT $7",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization.id)
        .bind(locale)
        .bind(&scope.branch_ids)
        .bind(&scope.group_ids)
        .bind(query)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(parse_document).collect()
    }
}

fn parse_document(row: sqlx::postgres::PgRow) -> Result<PublishedKnowledgeDocument> {
    let audience: String = row.try_get("audience")?;
    if !matches!(audience.as_str(), "public" | "parent") {
        return Err(DbError::InvalidData(
            "AirHub parent knowledge audience is invalid".to_owned(),
        ));
    }
    let scope_type: String = row.try_get("scope_type")?;
    if !matches!(scope_type.as_str(), "organization" | "branch" | "group") {
        return Err(DbError::InvalidData(
            "AirHub knowledge scope is invalid".to_owned(),
        ));
    }
    Ok(PublishedKnowledgeDocument {
        id: row.try_get("id")?,
        slug: row.try_get("slug")?,
        title: row.try_get("title")?,
        markdown: row.try_get("markdown")?,
        locale: row.try_get("locale")?,
        audience,
        scope_type,
        scope_id: row.try_get("scope_id")?,
        version: row.try_get("version")?,
        updated_at: row.try_get("updated_at")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parent_scope_is_explicit_and_bounded() {
        let scope = ParentKnowledgeScope {
            locale: "pt-BR".to_owned(),
            branch_ids: vec![Uuid::new_v4()],
            group_ids: vec![Uuid::new_v4()],
        };
        assert_eq!(scope.locale, "pt-BR");
        assert_eq!(scope.branch_ids.len(), 1);
        assert_eq!(scope.group_ids.len(), 1);
        assert_eq!(MAX_RESULTS, 20);
    }
}
