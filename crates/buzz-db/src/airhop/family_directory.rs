//! Tenant-scoped staff family directory projection.
//!
//! This read model deliberately returns only the contact and relationship
//! summary required by the client directory. Child birth dates and notes,
//! consent evidence, messenger identifiers, and management credentials remain
//! outside the list projection.

use buzz_core::TenantContext;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use crate::{Db, DbError, Result};

/// Family lifecycle accepted by the staff directory.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StaffFamilyDirectoryStatus {
    /// Operational families.
    Active,
    /// Retained historical families.
    Archived,
}

impl StaffFamilyDirectoryStatus {
    const fn as_db_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Archived => "archived",
        }
    }
}

/// Stable keyset after the last family returned to a staff client.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffFamilyDirectoryCursor {
    /// Case-folded family name used by the database ordering.
    pub sort_name: String,
    /// UUID tiebreak for equal names.
    pub family_id: Uuid,
}

/// Validated filters for one directory page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StaffFamilyDirectoryFilter {
    /// Family lifecycle to return.
    pub status: StaffFamilyDirectoryStatus,
    /// Optional literal staff search term.
    pub search: Option<String>,
    /// Server-validated page size.
    pub limit: u16,
    /// Composite keyset supplied by the previous response.
    pub cursor: Option<StaffFamilyDirectoryCursor>,
}

/// Primary contact shown in one directory card.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffFamilyDirectoryRepresentative {
    /// Representative identifier.
    pub id: Uuid,
    /// Current display name.
    pub display_name: String,
    /// Exact first name when confirmed by staff.
    pub first_name: Option<String>,
    /// Exact last name when confirmed by staff.
    pub last_name: Option<String>,
    /// E.164 phone retained for authenticated staff operations.
    pub phone_normalized: String,
    /// Human-readable phone.
    pub phone_display: String,
    /// Preferred service contact channel.
    pub preferred_contact_channel: String,
}

/// Privacy-bounded child label shown in one directory card.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffFamilyDirectoryChild {
    /// Child identifier.
    pub id: Uuid,
    /// Current display name.
    pub display_name: String,
    /// Exact first name when confirmed by staff.
    pub first_name: Option<String>,
    /// Exact last name when confirmed by staff.
    pub last_name: Option<String>,
    /// `active` or `archived`.
    pub status: String,
}

/// Minimal authoritative family card needed by the staff directory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffFamilyDirectoryItem {
    /// Family identifier.
    pub id: Uuid,
    /// Staff-facing family label.
    pub display_name: String,
    /// `active` or `archived`.
    pub status: String,
    /// Last authoritative family update.
    pub updated_at: DateTime<Utc>,
    /// Current primary contact.
    pub primary_representative: StaffFamilyDirectoryRepresentative,
    /// Current child labels without sensitive child details.
    pub children: Vec<StaffFamilyDirectoryChild>,
    /// Number of all retained bookings for this family.
    pub booking_count: i64,
    /// Number of currently active enrollments.
    pub active_enrollment_count: i64,
    /// Whether a pending duplicate candidate touches this family.
    pub has_pending_duplicate: bool,
    #[serde(skip)]
    sort_name: String,
}

/// One stable family-directory page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffFamilyDirectoryPage {
    /// Directory rows in stable name order.
    pub items: Vec<StaffFamilyDirectoryItem>,
    /// Cursor for the next page, present only when another row exists.
    pub next_cursor: Option<StaffFamilyDirectoryCursor>,
}

impl Db {
    /// Reads one authoritative family-directory page for the host-resolved tenant.
    pub async fn list_airhop_staff_families(
        &self,
        tenant: &TenantContext,
        filter: StaffFamilyDirectoryFilter,
    ) -> Result<StaffFamilyDirectoryPage> {
        validate_filter(&filter)?;
        let search_pattern = filter.search.as_deref().map(literal_search_pattern);
        let (cursor_sort_name, cursor_family_id) = filter
            .cursor
            .as_ref()
            .map(|cursor| (Some(cursor.sort_name.as_str()), Some(cursor.family_id)))
            .unwrap_or((None, None));
        let fetch_limit = i64::from(filter.limit) + 1;
        let rows = sqlx::query(
            r#"
            SELECT family.id, family.display_name, family.status, family.updated_at,
                   lower(family.display_name) AS sort_name,
                   representative.id AS representative_id,
                   representative.display_name AS representative_name,
                   representative.first_name AS representative_first_name,
                   representative.last_name AS representative_last_name,
                   representative.phone_normalized, representative.phone_display,
                   representative.preferred_contact_channel,
                   COALESCE(child_rows.children, '[]'::JSONB) AS children,
                   booking_rows.booking_count,
                   enrollment_rows.active_enrollment_count,
                   duplicate_rows.has_pending_duplicate
            FROM airhop_families family
            JOIN airhop_organizations organization
              ON organization.community_id = family.community_id
             AND organization.id = family.organization_id
             AND organization.status = 'active'
            JOIN airhop_representatives representative
              ON representative.community_id = family.community_id
             AND representative.organization_id = family.organization_id
             AND representative.family_id = family.id
             AND representative.id = family.primary_representative_id
            CROSS JOIN LATERAL (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'id', child.id,
                        'displayName', child.display_name,
                        'firstName', child.first_name,
                        'lastName', child.last_name,
                        'status', child.status
                    ) ORDER BY lower(child.display_name), child.id
                ) AS children
                FROM airhop_children child
                WHERE child.community_id = family.community_id
                  AND child.organization_id = family.organization_id
                  AND child.family_id = family.id
            ) child_rows
            CROSS JOIN LATERAL (
                SELECT count(*)::BIGINT AS booking_count
                FROM airhop_bookings booking
                WHERE booking.community_id = family.community_id
                  AND booking.organization_id = family.organization_id
                  AND booking.family_id = family.id
            ) booking_rows
            CROSS JOIN LATERAL (
                SELECT count(*)::BIGINT AS active_enrollment_count
                FROM airhop_enrollments enrollment
                WHERE enrollment.community_id = family.community_id
                  AND enrollment.organization_id = family.organization_id
                  AND enrollment.family_id = family.id
                  AND enrollment.status = 'active'
            ) enrollment_rows
            CROSS JOIN LATERAL (
                SELECT EXISTS (
                    SELECT 1
                    FROM airhop_duplicate_candidates candidate
                    WHERE candidate.community_id = family.community_id
                      AND candidate.organization_id = family.organization_id
                      AND candidate.status = 'pending'
                      AND (
                          candidate.new_entity_id IN (
                              SELECT id FROM airhop_representatives
                              WHERE community_id = family.community_id
                                AND organization_id = family.organization_id
                                AND family_id = family.id
                              UNION ALL
                              SELECT id FROM airhop_children
                              WHERE community_id = family.community_id
                                AND organization_id = family.organization_id
                                AND family_id = family.id
                          )
                          OR candidate.existing_entity_id IN (
                              SELECT id FROM airhop_representatives
                              WHERE community_id = family.community_id
                                AND organization_id = family.organization_id
                                AND family_id = family.id
                              UNION ALL
                              SELECT id FROM airhop_children
                              WHERE community_id = family.community_id
                                AND organization_id = family.organization_id
                                AND family_id = family.id
                          )
                      )
                ) AS has_pending_duplicate
            ) duplicate_rows
            WHERE family.community_id = $1
              AND family.status = $2
              AND (
                  $3::TEXT IS NULL
                  OR family.display_name ILIKE $3 ESCAPE '\'
                  OR EXISTS (
                      SELECT 1 FROM airhop_representatives search_representative
                      WHERE search_representative.community_id = family.community_id
                        AND search_representative.organization_id = family.organization_id
                        AND search_representative.family_id = family.id
                        AND (
                            search_representative.display_name ILIKE $3 ESCAPE '\'
                            OR search_representative.first_name ILIKE $3 ESCAPE '\'
                            OR search_representative.last_name ILIKE $3 ESCAPE '\'
                            OR search_representative.phone_display ILIKE $3 ESCAPE '\'
                            OR search_representative.phone_normalized ILIKE $3 ESCAPE '\'
                        )
                  )
                  OR EXISTS (
                      SELECT 1 FROM airhop_children search_child
                      WHERE search_child.community_id = family.community_id
                        AND search_child.organization_id = family.organization_id
                        AND search_child.family_id = family.id
                        AND (
                            search_child.display_name ILIKE $3 ESCAPE '\'
                            OR search_child.first_name ILIKE $3 ESCAPE '\'
                            OR search_child.last_name ILIKE $3 ESCAPE '\'
                        )
                  )
              )
              AND (
                  $4::TEXT IS NULL
                  OR (lower(family.display_name), family.id) > ($4, $5)
              )
            ORDER BY lower(family.display_name) ASC, family.id ASC
            LIMIT $6
            "#,
        )
        .bind(tenant.community().as_uuid())
        .bind(filter.status.as_db_str())
        .bind(search_pattern)
        .bind(cursor_sort_name)
        .bind(cursor_family_id)
        .bind(fetch_limit)
        .fetch_all(&self.pool)
        .await?;

        let has_more = rows.len() > usize::from(filter.limit);
        let items = rows
            .into_iter()
            .take(usize::from(filter.limit))
            .map(parse_directory_item)
            .collect::<Result<Vec<_>>>()?;
        let next_cursor = if has_more {
            items.last().map(|item| StaffFamilyDirectoryCursor {
                sort_name: item.sort_name.clone(),
                family_id: item.id,
            })
        } else {
            None
        };
        Ok(StaffFamilyDirectoryPage { items, next_cursor })
    }
}

fn validate_filter(filter: &StaffFamilyDirectoryFilter) -> Result<()> {
    if !(1..=100).contains(&filter.limit) {
        return Err(DbError::InvalidData(
            "AirHub family directory limit must be between 1 and 100".to_owned(),
        ));
    }
    if filter
        .search
        .as_ref()
        .is_some_and(|search| search.trim().is_empty() || search.chars().count() > 100)
    {
        return Err(DbError::InvalidData(
            "AirHub family directory search must contain 1 to 100 characters".to_owned(),
        ));
    }
    if filter.cursor.as_ref().is_some_and(|cursor| {
        cursor.sort_name.is_empty()
            || cursor.sort_name.chars().count() > 200
            || cursor.family_id.is_nil()
    }) {
        return Err(DbError::InvalidData(
            "AirHub family directory cursor is invalid".to_owned(),
        ));
    }
    Ok(())
}

fn literal_search_pattern(search: &str) -> String {
    let escaped = search
        .trim()
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

fn parse_directory_item(row: sqlx::postgres::PgRow) -> Result<StaffFamilyDirectoryItem> {
    let status: String = row.try_get("status")?;
    validate_entity_status(&status)?;
    let preferred_contact_channel: String = row.try_get("preferred_contact_channel")?;
    if !matches!(
        preferred_contact_channel.as_str(),
        "telegram" | "max" | "whatsapp" | "phone" | "none"
    ) {
        return Err(DbError::InvalidData(format!(
            "unknown AirHub contact channel {preferred_contact_channel:?}"
        )));
    }
    let children =
        serde_json::from_value::<Vec<StaffFamilyDirectoryChild>>(row.try_get("children")?)?;
    for child in &children {
        validate_entity_status(&child.status)?;
    }
    Ok(StaffFamilyDirectoryItem {
        id: row.try_get("id")?,
        display_name: row.try_get("display_name")?,
        status,
        updated_at: row.try_get("updated_at")?,
        primary_representative: StaffFamilyDirectoryRepresentative {
            id: row.try_get("representative_id")?,
            display_name: row.try_get("representative_name")?,
            first_name: row.try_get("representative_first_name")?,
            last_name: row.try_get("representative_last_name")?,
            phone_normalized: row.try_get("phone_normalized")?,
            phone_display: row.try_get("phone_display")?,
            preferred_contact_channel,
        },
        children,
        booking_count: row.try_get("booking_count")?,
        active_enrollment_count: row.try_get("active_enrollment_count")?,
        has_pending_duplicate: row.try_get("has_pending_duplicate")?,
        sort_name: row.try_get("sort_name")?,
    })
}

fn validate_entity_status(status: &str) -> Result<()> {
    if matches!(status, "active" | "archived") {
        Ok(())
    } else {
        Err(DbError::InvalidData(format!(
            "unknown AirHub entity status {status:?}"
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn filter() -> StaffFamilyDirectoryFilter {
        StaffFamilyDirectoryFilter {
            status: StaffFamilyDirectoryStatus::Active,
            search: None,
            limit: 50,
            cursor: None,
        }
    }

    #[test]
    fn directory_bounds_are_enforced_below_http() {
        assert!(validate_filter(&filter()).is_ok());
        assert!(validate_filter(&StaffFamilyDirectoryFilter {
            limit: 0,
            ..filter()
        })
        .is_err());
        assert!(validate_filter(&StaffFamilyDirectoryFilter {
            search: Some(" ".to_owned()),
            ..filter()
        })
        .is_err());
        assert!(validate_filter(&StaffFamilyDirectoryFilter {
            cursor: Some(StaffFamilyDirectoryCursor {
                sort_name: "family".to_owned(),
                family_id: Uuid::nil(),
            }),
            ..filter()
        })
        .is_err());
    }

    #[test]
    fn staff_search_treats_sql_wildcards_as_literals() {
        assert_eq!(literal_search_pattern(r#" 50%_\ "#), r#"%50\%\_\\%"#);
    }
}
