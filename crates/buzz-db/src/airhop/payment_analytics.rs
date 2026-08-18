//! Tenant-scoped server analytics over authoritative payment expectations.

use buzz_core::TenantContext;
use chrono::NaiveDate;
use serde::Serialize;
use sqlx::Row;
use uuid::Uuid;

use crate::{Db, DbError, Result};

/// Aggregated payment amounts and operation counts for one billing period.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentAnalyticsPeriod {
    /// First organization-local day of the immutable billing month.
    pub period_start: NaiveDate,
    /// Non-cancelled expectations created for the period.
    pub scheduled_count: i64,
    /// Non-cancelled amount created for the period, in minor units.
    pub scheduled_minor: i64,
    /// Expectations confirmed as paid.
    pub paid_count: i64,
    /// Confirmed paid amount, in minor units.
    pub paid_minor: i64,
    /// Expectations that are still open.
    pub outstanding_count: i64,
    /// Amount that is still open, in minor units.
    pub outstanding_minor: i64,
    /// Open expectations past their current due date.
    pub overdue_count: i64,
    /// Open overdue amount, in minor units.
    pub overdue_minor: i64,
    /// Expectations explicitly cancelled by staff.
    pub cancelled_count: i64,
    /// Cancelled amount retained for audit, in minor units.
    pub cancelled_minor: i64,
    /// Paid share of non-cancelled scheduled amount in basis points.
    pub paid_share_bps: Option<i32>,
}

/// One currency-safe analytics series. Different currencies are never summed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentAnalyticsCurrency {
    /// ISO 4217 currency code.
    pub currency: String,
    /// All currently open expectations, including future periods.
    pub open_count: i64,
    /// All currently open amount, in minor units.
    pub open_minor: i64,
    /// Open expectations past their current due date across all periods.
    pub overdue_count: i64,
    /// Open overdue amount across all periods, in minor units.
    pub overdue_minor: i64,
    /// Six consecutive billing months ending with the current month.
    pub periods: Vec<PaymentAnalyticsPeriod>,
}

/// Server-authoritative first payment analytics read model.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffPaymentAnalytics {
    /// Organization-local date used for overdue classification.
    pub as_of_date: NaiveDate,
    /// Stable currency-separated series ordered by currency code.
    pub currencies: Vec<PaymentAnalyticsCurrency>,
}

impl Db {
    /// Aggregates payment expectations for one active organization.
    pub async fn get_airhop_staff_payment_analytics(
        &self,
        tenant: &TenantContext,
    ) -> Result<StaffPaymentAnalytics> {
        let context = sqlx::query(
            "SELECT id, (now() AT TIME ZONE time_zone)::date AS local_date, \
                    date_trunc('month', now() AT TIME ZONE time_zone)::date AS current_period \
             FROM airhop_organizations \
             WHERE community_id = $1 AND status = 'active'",
        )
        .bind(tenant.community().as_uuid())
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| DbError::NotFound("active AirHub organization".to_owned()))?;
        let organization_id: Uuid = context.try_get("id")?;
        let as_of_date: NaiveDate = context.try_get("local_date")?;
        let current_period: NaiveDate = context.try_get("current_period")?;

        let rows = sqlx::query(
            "WITH currencies AS ( \
                 SELECT DISTINCT currency \
                 FROM airhop_payment_expectations \
                 WHERE community_id = $1 AND organization_id = $2 \
             ), months AS ( \
                 SELECT generate_series( \
                     ($3::date - INTERVAL '5 months')::timestamp, \
                     $3::date::timestamp, INTERVAL '1 month' \
                 )::date AS period_start \
             ), balances AS ( \
                 SELECT payment.*, COALESCE(( \
                     SELECT SUM(CASE ledger.kind \
                         WHEN 'receipt' THEN ledger.amount_minor \
                         ELSE -ledger.amount_minor END) \
                     FROM airhop_payment_transactions ledger \
                     WHERE ledger.community_id = payment.community_id \
                       AND ledger.organization_id = payment.organization_id \
                       AND ledger.payment_expectation_id = payment.id \
                 ), 0)::BIGINT AS paid_minor \
                 FROM airhop_payment_expectations payment \
                 WHERE payment.community_id = $1 AND payment.organization_id = $2 \
             ), overview AS ( \
                 SELECT currency, \
                        COUNT(*) FILTER (WHERE status = 'expected')::BIGINT AS open_count, \
                        COALESCE(SUM(amount_minor - paid_minor) FILTER (WHERE status = 'expected'), 0)::BIGINT \
                            AS open_minor, \
                        COUNT(*) FILTER (WHERE status = 'expected' AND due_date < $4)::BIGINT \
                            AS overdue_count, \
                        COALESCE(SUM(amount_minor - paid_minor) FILTER ( \
                            WHERE status = 'expected' AND due_date < $4 \
                        ), 0)::BIGINT AS overdue_minor \
                 FROM balances \
                 WHERE community_id = $1 AND organization_id = $2 \
                 GROUP BY currency \
             ), period_totals AS ( \
                 SELECT currency, billing_period AS period_start, \
                        COUNT(*) FILTER (WHERE status <> 'cancelled')::BIGINT \
                            AS scheduled_count, \
                        COALESCE(SUM(amount_minor) FILTER (WHERE status <> 'cancelled'), 0)::BIGINT \
                            AS scheduled_minor, \
                        COUNT(*) FILTER (WHERE status = 'paid')::BIGINT AS paid_count, \
                        COALESCE(SUM(paid_minor) FILTER (WHERE status <> 'cancelled'), 0)::BIGINT \
                            AS paid_minor, \
                        COUNT(*) FILTER (WHERE status = 'expected')::BIGINT \
                            AS outstanding_count, \
                        COALESCE(SUM(amount_minor - paid_minor) FILTER (WHERE status = 'expected'), 0)::BIGINT \
                            AS outstanding_minor, \
                        COUNT(*) FILTER (WHERE status = 'expected' AND due_date < $4)::BIGINT \
                            AS overdue_count, \
                        COALESCE(SUM(amount_minor - paid_minor) FILTER ( \
                            WHERE status = 'expected' AND due_date < $4 \
                        ), 0)::BIGINT AS overdue_minor, \
                        COUNT(*) FILTER (WHERE status = 'cancelled')::BIGINT \
                            AS cancelled_count, \
                        COALESCE(SUM(amount_minor) FILTER (WHERE status = 'cancelled'), 0)::BIGINT \
                            AS cancelled_minor \
                 FROM balances \
                 WHERE community_id = $1 AND organization_id = $2 \
                   AND billing_period BETWEEN ($3::date - INTERVAL '5 months')::date AND $3 \
                 GROUP BY currency, billing_period \
             ) \
             SELECT currencies.currency, months.period_start, \
                    COALESCE(overview.open_count, 0)::BIGINT AS open_count, \
                    COALESCE(overview.open_minor, 0)::BIGINT AS open_minor, \
                    COALESCE(overview.overdue_count, 0)::BIGINT AS total_overdue_count, \
                    COALESCE(overview.overdue_minor, 0)::BIGINT AS total_overdue_minor, \
                    COALESCE(period_totals.scheduled_count, 0)::BIGINT AS scheduled_count, \
                    COALESCE(period_totals.scheduled_minor, 0)::BIGINT AS scheduled_minor, \
                    COALESCE(period_totals.paid_count, 0)::BIGINT AS paid_count, \
                    COALESCE(period_totals.paid_minor, 0)::BIGINT AS paid_minor, \
                    COALESCE(period_totals.outstanding_count, 0)::BIGINT AS outstanding_count, \
                    COALESCE(period_totals.outstanding_minor, 0)::BIGINT AS outstanding_minor, \
                    COALESCE(period_totals.overdue_count, 0)::BIGINT AS overdue_count, \
                    COALESCE(period_totals.overdue_minor, 0)::BIGINT AS overdue_minor, \
                    COALESCE(period_totals.cancelled_count, 0)::BIGINT AS cancelled_count, \
                    COALESCE(period_totals.cancelled_minor, 0)::BIGINT AS cancelled_minor \
             FROM currencies \
             CROSS JOIN months \
             LEFT JOIN overview ON overview.currency = currencies.currency \
             LEFT JOIN period_totals \
               ON period_totals.currency = currencies.currency \
              AND period_totals.period_start = months.period_start \
             ORDER BY currencies.currency, months.period_start",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(current_period)
        .bind(as_of_date)
        .fetch_all(&self.pool)
        .await?;

        let mut currencies: Vec<PaymentAnalyticsCurrency> = Vec::new();
        for row in rows {
            let currency: String = row.try_get("currency")?;
            if currencies.last().map(|item| item.currency.as_str()) != Some(currency.as_str()) {
                currencies.push(PaymentAnalyticsCurrency {
                    currency: currency.clone(),
                    open_count: row.try_get("open_count")?,
                    open_minor: row.try_get("open_minor")?,
                    overdue_count: row.try_get("total_overdue_count")?,
                    overdue_minor: row.try_get("total_overdue_minor")?,
                    periods: Vec::with_capacity(6),
                });
            }
            let scheduled_minor = row.try_get("scheduled_minor")?;
            let paid_minor = row.try_get("paid_minor")?;
            let period = PaymentAnalyticsPeriod {
                period_start: row.try_get("period_start")?,
                scheduled_count: row.try_get("scheduled_count")?,
                scheduled_minor,
                paid_count: row.try_get("paid_count")?,
                paid_minor,
                outstanding_count: row.try_get("outstanding_count")?,
                outstanding_minor: row.try_get("outstanding_minor")?,
                overdue_count: row.try_get("overdue_count")?,
                overdue_minor: row.try_get("overdue_minor")?,
                cancelled_count: row.try_get("cancelled_count")?,
                cancelled_minor: row.try_get("cancelled_minor")?,
                paid_share_bps: paid_share_bps(paid_minor, scheduled_minor),
            };
            currencies
                .last_mut()
                .ok_or_else(|| DbError::InvalidData("missing payment currency bucket".to_owned()))?
                .periods
                .push(period);
        }

        Ok(StaffPaymentAnalytics {
            as_of_date,
            currencies,
        })
    }
}

fn paid_share_bps(paid_minor: i64, scheduled_minor: i64) -> Option<i32> {
    if scheduled_minor <= 0 {
        return None;
    }
    i32::try_from((i128::from(paid_minor) * 10_000) / i128::from(scheduled_minor)).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paid_share_uses_minor_units_and_handles_empty_periods() {
        assert_eq!(paid_share_bps(450_000, 600_000), Some(7_500));
        assert_eq!(paid_share_bps(0, 600_000), Some(0));
        assert_eq!(paid_share_bps(0, 0), None);
    }
}
