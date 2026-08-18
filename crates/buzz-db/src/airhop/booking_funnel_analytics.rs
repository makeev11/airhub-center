//! Tenant-scoped cohort analytics for trial bookings and first payments.

use std::collections::BTreeMap;

use buzz_core::TenantContext;
use chrono::NaiveDate;
use serde::Serialize;
use sqlx::Row;
use uuid::Uuid;

use crate::{Db, DbError, Result};

/// Independently observed stages for one cohort or segment.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookingFunnelStages {
    /// Trial bookings created in the cohort.
    pub trial_bookings: i64,
    /// Trial bookings that were confirmed at least once.
    pub confirmed_trials: i64,
    /// Trial bookings with a current `present` attendance mark.
    pub attended_trials: i64,
    /// Trial bookings converted through the explicit trial-enrollment command.
    pub permanent_enrollments: i64,
    /// Converted trials whose first expected payment is currently paid.
    pub first_payments_paid: i64,
}

impl BookingFunnelStages {
    fn add(&mut self, other: &Self) {
        self.trial_bookings += other.trial_bookings;
        self.confirmed_trials += other.confirmed_trials;
        self.attended_trials += other.attended_trials;
        self.permanent_enrollments += other.permanent_enrollments;
        self.first_payments_paid += other.first_payments_paid;
    }
}

/// Currency-safe first-payment amount for a cohort or segment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookingFunnelCurrencyAmount {
    /// ISO 4217 currency code.
    pub currency: String,
    /// Number of first payments included in this currency bucket.
    pub paid_count: i64,
    /// Paid amount in minor units.
    pub paid_minor: i64,
}

/// Joint source-channel and branch segment for safe client-side filtering.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookingFunnelSegment {
    /// Normalized booking source channel.
    pub source_channel: String,
    /// Branch of the immutable lesson occurrence.
    pub branch_id: Uuid,
    /// Current staff-facing branch label.
    pub branch_name: String,
    /// Observed funnel stages within this segment.
    pub stages: BookingFunnelStages,
    /// First paid amounts, never mixed across currencies.
    pub first_paid_currencies: Vec<BookingFunnelCurrencyAmount>,
}

/// One organization-local booking cohort month.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookingFunnelPeriod {
    /// First organization-local day of the booking cohort month.
    pub period_start: NaiveDate,
    /// Totals across all source and branch segments.
    pub stages: BookingFunnelStages,
    /// Cohort first paid amounts, separated by currency.
    pub first_paid_currencies: Vec<BookingFunnelCurrencyAmount>,
    /// Joint segments used by the staff UI filters.
    pub segments: Vec<BookingFunnelSegment>,
}

/// Server-authoritative six-month trial-booking funnel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffBookingFunnelAnalytics {
    /// Organization-local date used as the report boundary.
    pub as_of_date: NaiveDate,
    /// Six consecutive booking cohort months ending with the current month.
    pub periods: Vec<BookingFunnelPeriod>,
}

impl Db {
    /// Aggregates the trial-booking funnel for one active organization.
    pub async fn get_airhop_staff_booking_funnel_analytics(
        &self,
        tenant: &TenantContext,
    ) -> Result<StaffBookingFunnelAnalytics> {
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
            "WITH months AS ( \
                 SELECT generate_series( \
                     ($3::date - INTERVAL '5 months')::timestamp, \
                     $3::date::timestamp, INTERVAL '1 month' \
                 )::date AS period_start \
             ), trial_cohorts AS ( \
                 SELECT date_trunc( \
                            'month', booking.created_at AT TIME ZONE organization.time_zone \
                        )::date AS period_start, \
                        CASE booking.source->>'channel' \
                            WHEN 'website' THEN 'website' WHEN 'phone' THEN 'phone' \
                            WHEN 'visit' THEN 'visit' WHEN 'telegram' THEN 'telegram' \
                            WHEN 'max' THEN 'max' WHEN 'whatsapp' THEN 'whatsapp' \
                            WHEN 'buzz' THEN 'buzz' ELSE 'other' \
                        END AS source_channel, \
                        occurrence.branch_id, branch.name AS branch_name, \
                        (booking.source->>'workflow' = 'direct' \
                         OR booking.status = 'confirmed' \
                         OR EXISTS ( \
                             SELECT 1 FROM airhop_domain_events confirmation \
                             WHERE confirmation.community_id = booking.community_id \
                               AND confirmation.organization_id = booking.organization_id \
                               AND confirmation.stream_type = 'booking' \
                               AND confirmation.stream_id = booking.id \
                               AND confirmation.event_type IN ( \
                                   'airhop.booking.confirmed.v1', \
                                   'airhop.booking.confirmed_by_staff.v1' \
                               ) \
                         )) AS confirmed, \
                        (attendance.status = 'present') AS attended, \
                        conversion.enrollment_id, payment.currency, payment.amount_minor, \
                        (payment.status = 'paid') AS first_paid \
                 FROM airhop_bookings booking \
                 JOIN airhop_organizations organization \
                   ON organization.community_id = booking.community_id \
                  AND organization.id = booking.organization_id \
                 JOIN airhop_lesson_occurrences occurrence \
                   ON occurrence.community_id = booking.community_id \
                  AND occurrence.organization_id = booking.organization_id \
                  AND occurrence.recurrence_rule_id = booking.recurrence_rule_id \
                  AND occurrence.original_date = booking.original_date \
                 JOIN airhop_branches branch \
                   ON branch.community_id = occurrence.community_id \
                  AND branch.organization_id = occurrence.organization_id \
                  AND branch.id = occurrence.branch_id \
                 LEFT JOIN airhop_lesson_attendance attendance \
                   ON attendance.community_id = booking.community_id \
                  AND attendance.organization_id = booking.organization_id \
                  AND attendance.recurrence_rule_id = booking.recurrence_rule_id \
                  AND attendance.original_date = booking.original_date \
                  AND attendance.child_id = booking.child_id \
                 LEFT JOIN LATERAL ( \
                     SELECT event.payload->>'enrollmentId' AS enrollment_id, \
                            event.payload->>'paymentExpectationId' AS payment_id \
                     FROM airhop_domain_events event \
                     WHERE event.community_id = booking.community_id \
                       AND event.organization_id = booking.organization_id \
                       AND event.event_type = 'airhop.enrollment.created_from_trial.v1' \
                       AND ( \
                           event.payload->>'sourceBookingId' = booking.id::text \
                           OR (NOT (event.payload ? 'sourceBookingId') \
                               AND event.payload->>'childId' = booking.child_id::text \
                               AND event.payload->'sourceLesson'->>'recurrenceRuleId' = \
                                   booking.recurrence_rule_id::text \
                               AND event.payload->'sourceLesson'->>'originalDate' = \
                                   booking.original_date::text) \
                       ) \
                     ORDER BY event.occurred_at, event.id LIMIT 1 \
                 ) conversion ON TRUE \
                 LEFT JOIN airhop_payment_expectations payment \
                   ON payment.community_id = booking.community_id \
                  AND payment.organization_id = booking.organization_id \
                  AND payment.id::text = conversion.payment_id \
                 WHERE booking.community_id = $1 AND booking.organization_id = $2 \
                   AND booking.visit_kind = 'trial' \
                   AND booking.created_at >= (($3::date - INTERVAL '5 months')::timestamp \
                                               AT TIME ZONE organization.time_zone) \
                   AND booking.created_at < (($3::date + INTERVAL '1 month')::timestamp \
                                              AT TIME ZONE organization.time_zone) \
             ), segment_counts AS ( \
                 SELECT period_start, source_channel, branch_id, branch_name, \
                        COUNT(*)::BIGINT AS trial_bookings, \
                        COUNT(*) FILTER (WHERE confirmed)::BIGINT AS confirmed_trials, \
                        COUNT(*) FILTER (WHERE attended)::BIGINT AS attended_trials, \
                        COUNT(*) FILTER (WHERE enrollment_id IS NOT NULL)::BIGINT \
                            AS permanent_enrollments, \
                        COUNT(*) FILTER (WHERE first_paid)::BIGINT AS first_payments_paid \
                 FROM trial_cohorts \
                 GROUP BY period_start, source_channel, branch_id, branch_name \
             ), segment_money AS ( \
                 SELECT period_start, source_channel, branch_id, currency, \
                        COUNT(*)::BIGINT AS paid_count, \
                        COALESCE(SUM(amount_minor), 0)::BIGINT AS paid_minor \
                 FROM trial_cohorts WHERE first_paid \
                 GROUP BY period_start, source_channel, branch_id, currency \
             ) \
             SELECT months.period_start, counts.source_channel, counts.branch_id, \
                    counts.branch_name, counts.trial_bookings, counts.confirmed_trials, \
                    counts.attended_trials, counts.permanent_enrollments, \
                    counts.first_payments_paid, money.currency, money.paid_count, money.paid_minor \
             FROM months \
             LEFT JOIN segment_counts counts ON counts.period_start = months.period_start \
             LEFT JOIN segment_money money ON money.period_start = counts.period_start \
              AND money.source_channel = counts.source_channel \
              AND money.branch_id = counts.branch_id \
             ORDER BY months.period_start, counts.source_channel NULLS FIRST, \
                      counts.branch_name NULLS FIRST, counts.branch_id NULLS FIRST, \
                      money.currency NULLS FIRST",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(current_period)
        .fetch_all(&self.pool)
        .await?;

        let mut periods: Vec<BookingFunnelPeriod> = Vec::with_capacity(6);
        for row in rows {
            let period_start: NaiveDate = row.try_get("period_start")?;
            if periods.last().map(|period| period.period_start) != Some(period_start) {
                periods.push(empty_period(period_start));
            }
            let Some(source_channel) = row.try_get::<Option<String>, _>("source_channel")? else {
                continue;
            };
            let branch_id: Uuid = row.try_get("branch_id")?;
            let period = periods
                .last_mut()
                .ok_or_else(|| DbError::InvalidData("missing funnel cohort month".to_owned()))?;
            let is_new_segment = period.segments.last().map(|segment| {
                segment.source_channel.as_str() != source_channel.as_str()
                    || segment.branch_id != branch_id
            }) != Some(false);
            if is_new_segment {
                period.segments.push(BookingFunnelSegment {
                    source_channel: source_channel.clone(),
                    branch_id,
                    branch_name: row.try_get("branch_name")?,
                    stages: stages_from_row(&row)?,
                    first_paid_currencies: Vec::new(),
                });
            }
            if let Some(currency) = row.try_get::<Option<String>, _>("currency")? {
                period
                    .segments
                    .last_mut()
                    .ok_or_else(|| {
                        DbError::InvalidData("missing funnel source segment".to_owned())
                    })?
                    .first_paid_currencies
                    .push(BookingFunnelCurrencyAmount {
                        currency: currency.trim().to_owned(),
                        paid_count: row.try_get("paid_count")?,
                        paid_minor: row.try_get("paid_minor")?,
                    });
            }
        }
        for period in &mut periods {
            summarize_period(period);
        }

        Ok(StaffBookingFunnelAnalytics {
            as_of_date,
            periods,
        })
    }
}

fn empty_period(period_start: NaiveDate) -> BookingFunnelPeriod {
    BookingFunnelPeriod {
        period_start,
        stages: BookingFunnelStages::default(),
        first_paid_currencies: Vec::new(),
        segments: Vec::new(),
    }
}

fn stages_from_row(row: &sqlx::postgres::PgRow) -> Result<BookingFunnelStages> {
    Ok(BookingFunnelStages {
        trial_bookings: row.try_get("trial_bookings")?,
        confirmed_trials: row.try_get("confirmed_trials")?,
        attended_trials: row.try_get("attended_trials")?,
        permanent_enrollments: row.try_get("permanent_enrollments")?,
        first_payments_paid: row.try_get("first_payments_paid")?,
    })
}

fn summarize_period(period: &mut BookingFunnelPeriod) {
    let mut stages = BookingFunnelStages::default();
    let mut currencies: BTreeMap<String, (i64, i64)> = BTreeMap::new();
    for segment in &period.segments {
        stages.add(&segment.stages);
        for amount in &segment.first_paid_currencies {
            let entry = currencies.entry(amount.currency.clone()).or_default();
            entry.0 += amount.paid_count;
            entry.1 += amount.paid_minor;
        }
    }
    period.stages = stages;
    period.first_paid_currencies = currencies
        .into_iter()
        .map(
            |(currency, (paid_count, paid_minor))| BookingFunnelCurrencyAmount {
                currency,
                paid_count,
                paid_minor,
            },
        )
        .collect();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn period_summary_keeps_currencies_separate_and_adds_each_segment_once() {
        let mut period = empty_period(NaiveDate::from_ymd_opt(2026, 8, 1).unwrap());
        period.segments = vec![
            BookingFunnelSegment {
                source_channel: "website".to_owned(),
                branch_id: Uuid::new_v4(),
                branch_name: "Центр".to_owned(),
                stages: BookingFunnelStages {
                    trial_bookings: 4,
                    confirmed_trials: 3,
                    attended_trials: 2,
                    permanent_enrollments: 2,
                    first_payments_paid: 1,
                },
                first_paid_currencies: vec![BookingFunnelCurrencyAmount {
                    currency: "RUB".to_owned(),
                    paid_count: 1,
                    paid_minor: 600_000,
                }],
            },
            BookingFunnelSegment {
                source_channel: "phone".to_owned(),
                branch_id: Uuid::new_v4(),
                branch_name: "Север".to_owned(),
                stages: BookingFunnelStages {
                    trial_bookings: 2,
                    confirmed_trials: 2,
                    attended_trials: 1,
                    permanent_enrollments: 1,
                    first_payments_paid: 1,
                },
                first_paid_currencies: vec![BookingFunnelCurrencyAmount {
                    currency: "EUR".to_owned(),
                    paid_count: 1,
                    paid_minor: 8_000,
                }],
            },
        ];

        summarize_period(&mut period);

        assert_eq!(period.stages.trial_bookings, 6);
        assert_eq!(period.stages.first_payments_paid, 2);
        assert_eq!(period.first_paid_currencies.len(), 2);
        assert_eq!(period.first_paid_currencies[0].currency, "EUR");
        assert_eq!(period.first_paid_currencies[1].paid_minor, 600_000);
    }
}
