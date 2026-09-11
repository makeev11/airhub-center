//! Small, verified family context for the parent's first model read.

use buzz_core::TenantContext;
use chrono::NaiveDate;
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

use super::family_detail::load_bookings;
use crate::{Db, DbError, Result};

impl Db {
    /// Checks the exact active family/representative binding without loading a
    /// staff card, customer directory, children, enrollments or booking history.
    pub async fn airhop_parent_family_binding_is_active(
        &self,
        tenant: &TenantContext,
        family_id: Uuid,
        representative_id: Uuid,
    ) -> Result<bool> {
        Ok(sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM airhop_families family
             JOIN airhop_representatives representative
               ON representative.community_id = family.community_id
              AND representative.organization_id = family.organization_id
              AND representative.family_id = family.id
             WHERE family.community_id = $1 AND family.id = $2
               AND representative.id = $3
               AND family.status = 'active' AND representative.status = 'active')",
        )
        .bind(tenant.community().as_uuid())
        .bind(family_id)
        .bind(representative_id)
        .fetch_one(&self.pool)
        .await?)
    }

    /// Returns only the verified contact, active child names and up to three
    /// relevant bookings. The conversation's booking comes first, followed by
    /// upcoming live bookings and recently updated history. No staff notes,
    /// contact details, duplicate search or enrollment archive is loaded.
    pub async fn get_airhop_parent_family_context(
        &self,
        tenant: &TenantContext,
        family_id: Uuid,
        representative_id: Uuid,
        booking_id: Option<Uuid>,
    ) -> Result<Value> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            .execute(&mut *transaction)
            .await?;
        let row = sqlx::query(
            "SELECT family.id, family.organization_id, family.display_name, family.version,
                    representative.display_name AS representative_name,
                    (now() AT TIME ZONE organization.time_zone)::date AS current_date,
                    COALESCE((SELECT jsonb_agg(jsonb_build_object(
                      'id', child.id, 'displayName', child.display_name)
                      ORDER BY child.display_name, child.id)
                      FROM airhop_children child
                      WHERE child.community_id = family.community_id
                        AND child.organization_id = family.organization_id
                        AND child.family_id = family.id AND child.status = 'active'),
                      '[]'::jsonb) AS children
             FROM airhop_families family
             JOIN airhop_organizations organization
               ON organization.community_id = family.community_id
              AND organization.id = family.organization_id
             JOIN airhop_representatives representative
               ON representative.community_id = family.community_id
              AND representative.organization_id = family.organization_id
              AND representative.family_id = family.id
             WHERE family.community_id = $1 AND family.id = $2 AND representative.id = $3
               AND family.status = 'active' AND representative.status = 'active'",
        )
        .bind(tenant.community().as_uuid())
        .bind(family_id)
        .bind(representative_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| DbError::NotFound("AirHop active parent family binding".to_owned()))?;
        let (bookings, truncated) = load_bookings(
            &mut transaction,
            tenant.community().as_uuid(),
            row.try_get("organization_id")?,
            family_id,
            3,
            booking_id,
            Some(row.try_get::<NaiveDate, _>("current_date")?),
        )
        .await?;
        transaction.commit().await?;
        Ok(json!({
            "id": family_id,
            "displayName": row.try_get::<String, _>("display_name")?,
            "version": row.try_get::<i64, _>("version")?,
            "representative": {
                "id": representative_id,
                "displayName": row.try_get::<String, _>("representative_name")?,
            },
            "children": row.try_get::<Value, _>("children")?,
            "recentBookings": bookings,
            "bookingHistoryTruncated": truncated,
        }))
    }
}
