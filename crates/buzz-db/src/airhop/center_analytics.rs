//! Read-only operational analytics; never infers business facts from telemetry.

use buzz_core::TenantContext;
use serde_json::Value;

use crate::{Db, DbError, Result};

impl Db {
    /// Reads one tenant-fenced snapshot of acquisition, attendance, students,
    /// near-term occupancy and currency-separated cash movements.
    ///
    /// The selected window ends with today's partial local date, or yesterday's
    /// complete local date when requested. Capacity always describes upcoming
    /// lessons in the next seven local dates; balances and student counts are current.
    pub async fn get_airhop_staff_center_analytics(
        &self,
        tenant: &TenantContext,
        days: u16,
        until_yesterday: bool,
    ) -> Result<Value> {
        if !(1..=366).contains(&days) {
            return Err(DbError::InvalidData(
                "AirHub center analytics days must be between 1 and 366".to_owned(),
            ));
        }
        let mut transaction = self.pool.begin().await?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            .execute(&mut *transaction)
            .await?;
        sqlx::query("SET LOCAL statement_timeout = '5s'")
            .execute(&mut *transaction)
            .await?;
        let report: Option<Value> = sqlx::query_scalar(include_str!("center_analytics/report.sql"))
            .bind(tenant.community().as_uuid())
            .bind(i32::from(days))
            .bind(i32::from(until_yesterday))
            .fetch_optional(&mut *transaction)
            .await?;
        transaction.commit().await?;
        report.ok_or_else(|| DbError::NotFound("active AirHub organization".to_owned()))
    }
}

#[cfg(test)]
mod integration_tests;
