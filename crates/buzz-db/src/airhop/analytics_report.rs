//! Retry-stable monthly analytics reports for a dedicated Buzz stream.

use std::collections::BTreeMap;

use buzz_core::{CommunityId, TenantContext};
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

use super::booking_funnel_analytics::{
    BookingFunnelPeriod, BookingFunnelStages, StaffBookingFunnelAnalytics,
};
use super::payment_analytics::{PaymentAnalyticsCurrency, StaffPaymentAnalytics};
use crate::{Db, DbError, Result};

/// One reserved analytics report. Persisted copy and timestamp keep retries stable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingAnalyticsReport {
    /// Server-resolved community.
    pub community_id: CommunityId,
    /// Host mapped to the community.
    pub host: String,
    /// AirHub organization.
    pub organization_id: Uuid,
    /// Dedicated analytics stream.
    pub channel_id: Uuid,
    /// Idempotent pending-delivery identity.
    pub pending_id: Uuid,
    /// Local calendar month represented by the thread.
    pub period_start: NaiveDate,
    /// Stable monthly thread root copy.
    pub root_content: String,
    /// Stable changed analytics snapshot.
    pub content: String,
    /// Persisted event timestamp used for retry-stable signing.
    pub created_at: DateTime<Utc>,
    /// Existing monthly thread root, when present.
    pub root_event_id: Option<Vec<u8>>,
    /// Existing root timestamp.
    pub root_event_created_at: Option<DateTime<Utc>>,
}

#[derive(Debug)]
struct AnalyticsTarget {
    community_id: Uuid,
    host: String,
    organization_id: Uuid,
    name: String,
    locale: String,
    channel_id: Uuid,
}

#[derive(Debug)]
struct ReportState {
    channel_id: Uuid,
    period_start: NaiveDate,
    root_event_id: Option<Vec<u8>>,
    root_event_created_at: Option<DateTime<Utc>>,
    last_digest: Option<Vec<u8>>,
    pending_id: Option<Uuid>,
    pending_digest: Option<Vec<u8>>,
    pending_root_content: Option<String>,
    pending_content: Option<String>,
    pending_created_at: Option<DateTime<Utc>>,
}

impl Db {
    /// Reserves every changed current-month analytics snapshot for Buzz publication.
    pub async fn prepare_airhop_analytics_reports(&self) -> Result<Vec<PendingAnalyticsReport>> {
        let targets = load_targets(self).await?;
        let mut jobs = Vec::new();
        let mut first_error = None;
        for target in targets {
            let tenant = TenantContext::resolved(
                CommunityId::from_uuid(target.community_id),
                target.host.clone(),
            );
            let result = async {
                let payments = self.get_airhop_staff_payment_analytics(&tenant).await?;
                let funnel = self
                    .get_airhop_staff_booking_funnel_analytics(&tenant)
                    .await?;
                self.prepare_organization_report(&target, &payments, &funnel)
                    .await
            }
            .await;
            match result {
                Ok(Some(job)) => jobs.push(job),
                Ok(None) => {}
                Err(error) => {
                    tracing::warn!(
                        community_id = %target.community_id,
                        organization_id = %target.organization_id,
                        %error,
                        "AirHub analytics report preparation failed"
                    );
                    if first_error.is_none() {
                        first_error = Some(error);
                    }
                }
            }
        }
        if let Some(error) = first_error {
            Err(error)
        } else {
            Ok(jobs)
        }
    }

    /// Marks one retry-stable analytics report as durably published.
    pub async fn complete_airhop_analytics_report(
        &self,
        tenant: &TenantContext,
        organization_id: Uuid,
        pending_id: Uuid,
        root_event_id: &[u8],
        root_event_created_at: DateTime<Utc>,
        report_event_id: &[u8],
    ) -> Result<bool> {
        if organization_id.is_nil()
            || pending_id.is_nil()
            || root_event_id.len() != 32
            || report_event_id.len() != 32
        {
            return Err(DbError::InvalidData(
                "AirHub analytics report event identity is invalid".to_owned(),
            ));
        }
        let result = sqlx::query(
            "UPDATE airhop_analytics_buzz_report_state \
             SET root_event_id = $4, root_event_created_at = $5, \
                 last_report_event_id = $6, last_digest = pending_digest, \
                 pending_id = NULL, pending_digest = NULL, pending_root_content = NULL, \
                 pending_content = NULL, pending_created_at = NULL, updated_at = now() \
             WHERE community_id = $1 AND organization_id = $2 AND pending_id = $3",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(pending_id)
        .bind(root_event_id)
        .bind(root_event_created_at)
        .bind(report_event_id)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    async fn prepare_organization_report(
        &self,
        target: &AnalyticsTarget,
        payments: &StaffPaymentAnalytics,
        funnel: &StaffBookingFunnelAnalytics,
    ) -> Result<Option<PendingAnalyticsReport>> {
        if payments.as_of_date != funnel.as_of_date {
            return Err(DbError::InvalidData(
                "AirHub analytics read models disagree on the local date".to_owned(),
            ));
        }
        let period_start = first_of_month(payments.as_of_date)?;
        let content = format_report(&target.locale, payments, funnel);
        let digest = report_digest(&content);
        let mut transaction = self.pool.begin().await?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 8130))")
            .bind(target.organization_id)
            .execute(&mut *transaction)
            .await?;
        let state = load_report_state(
            &mut transaction,
            target.community_id,
            target.organization_id,
        )
        .await?;
        if let Some(job) = pending_job_from_state(target, state.as_ref())? {
            transaction.commit().await?;
            return Ok(Some(job));
        }
        let same_scope = state.as_ref().is_some_and(|current| {
            current.channel_id == target.channel_id && current.period_start == period_start
        });
        if same_scope
            && state
                .as_ref()
                .and_then(|current| current.last_digest.as_deref())
                == Some(digest.as_slice())
        {
            transaction.commit().await?;
            return Ok(None);
        }
        let pending_id = Uuid::new_v4();
        let root_content = format_root(&target.locale, &target.name, period_start);
        let created_at: DateTime<Utc> = sqlx::query_scalar("SELECT now()")
            .fetch_one(&mut *transaction)
            .await?;
        sqlx::query(
            "INSERT INTO airhop_analytics_buzz_report_state (\
                 community_id, organization_id, channel_id, period_start, pending_id, \
                 pending_digest, pending_root_content, pending_content, pending_created_at, updated_at\
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) \
             ON CONFLICT (community_id, organization_id) DO UPDATE SET \
                 channel_id = EXCLUDED.channel_id, period_start = EXCLUDED.period_start, \
                 root_event_id = CASE \
                     WHEN airhop_analytics_buzz_report_state.channel_id = EXCLUDED.channel_id \
                      AND airhop_analytics_buzz_report_state.period_start = EXCLUDED.period_start \
                     THEN airhop_analytics_buzz_report_state.root_event_id ELSE NULL END, \
                 root_event_created_at = CASE \
                     WHEN airhop_analytics_buzz_report_state.channel_id = EXCLUDED.channel_id \
                      AND airhop_analytics_buzz_report_state.period_start = EXCLUDED.period_start \
                     THEN airhop_analytics_buzz_report_state.root_event_created_at ELSE NULL END, \
                 pending_id = EXCLUDED.pending_id, pending_digest = EXCLUDED.pending_digest, \
                 pending_root_content = EXCLUDED.pending_root_content, \
                 pending_content = EXCLUDED.pending_content, \
                 pending_created_at = EXCLUDED.pending_created_at, updated_at = EXCLUDED.updated_at",
        )
        .bind(target.community_id)
        .bind(target.organization_id)
        .bind(target.channel_id)
        .bind(period_start)
        .bind(pending_id)
        .bind(&digest)
        .bind(&root_content)
        .bind(&content)
        .bind(created_at)
        .execute(&mut *transaction)
        .await?;
        let (root_event_id, root_event_created_at) = if same_scope {
            state.map_or((None, None), |current| {
                (current.root_event_id, current.root_event_created_at)
            })
        } else {
            (None, None)
        };
        transaction.commit().await?;
        Ok(Some(PendingAnalyticsReport {
            community_id: CommunityId::from_uuid(target.community_id),
            host: target.host.clone(),
            organization_id: target.organization_id,
            channel_id: target.channel_id,
            pending_id,
            period_start,
            root_content,
            content,
            created_at,
            root_event_id,
            root_event_created_at,
        }))
    }
}

async fn load_targets(db: &Db) -> Result<Vec<AnalyticsTarget>> {
    let rows = sqlx::query(
        "SELECT organization.community_id, community.host, organization.id, \
                organization.name, organization.locale, organization.analytics_buzz_channel_id \
         FROM airhop_organizations organization \
         JOIN communities community ON community.id = organization.community_id \
         WHERE organization.status = 'active' \
           AND organization.analytics_buzz_channel_id IS NOT NULL \
         ORDER BY organization.community_id",
    )
    .fetch_all(&db.pool)
    .await?;
    rows.into_iter()
        .map(|row| {
            Ok(AnalyticsTarget {
                community_id: row.try_get("community_id")?,
                host: row.try_get("host")?,
                organization_id: row.try_get("id")?,
                name: row.try_get("name")?,
                locale: row.try_get("locale")?,
                channel_id: row.try_get("analytics_buzz_channel_id")?,
            })
        })
        .collect()
}

async fn load_report_state(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: Uuid,
    organization_id: Uuid,
) -> Result<Option<ReportState>> {
    let row = sqlx::query(
        "SELECT channel_id, period_start, root_event_id, root_event_created_at, last_digest, \
                pending_id, pending_digest, pending_root_content, pending_content, pending_created_at \
         FROM airhop_analytics_buzz_report_state \
         WHERE community_id = $1 AND organization_id = $2 FOR UPDATE",
    )
    .bind(community_id)
    .bind(organization_id)
    .fetch_optional(&mut **transaction)
    .await?;
    row.map(|row| {
        Ok(ReportState {
            channel_id: row.try_get("channel_id")?,
            period_start: row.try_get("period_start")?,
            root_event_id: row.try_get("root_event_id")?,
            root_event_created_at: row.try_get("root_event_created_at")?,
            last_digest: row.try_get("last_digest")?,
            pending_id: row.try_get("pending_id")?,
            pending_digest: row.try_get("pending_digest")?,
            pending_root_content: row.try_get("pending_root_content")?,
            pending_content: row.try_get("pending_content")?,
            pending_created_at: row.try_get("pending_created_at")?,
        })
    })
    .transpose()
}

fn pending_job_from_state(
    target: &AnalyticsTarget,
    state: Option<&ReportState>,
) -> Result<Option<PendingAnalyticsReport>> {
    let Some(state) = state else {
        return Ok(None);
    };
    let Some(pending_id) = state.pending_id else {
        return Ok(None);
    };
    let _digest = state.pending_digest.as_ref().ok_or_else(|| {
        DbError::InvalidData("AirHub analytics report has no pending digest".to_owned())
    })?;
    let root_content = state.pending_root_content.clone().ok_or_else(|| {
        DbError::InvalidData("AirHub analytics report has no pending root copy".to_owned())
    })?;
    let content = state.pending_content.clone().ok_or_else(|| {
        DbError::InvalidData("AirHub analytics report has no pending copy".to_owned())
    })?;
    let created_at = state.pending_created_at.ok_or_else(|| {
        DbError::InvalidData("AirHub analytics report has no pending timestamp".to_owned())
    })?;
    Ok(Some(PendingAnalyticsReport {
        community_id: CommunityId::from_uuid(target.community_id),
        host: target.host.clone(),
        organization_id: target.organization_id,
        channel_id: state.channel_id,
        pending_id,
        period_start: state.period_start,
        root_content,
        content,
        created_at,
        root_event_id: state.root_event_id.clone(),
        root_event_created_at: state.root_event_created_at,
    }))
}

fn report_digest(content: &str) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(b"airhop.analytics-report.snapshot.v1\0");
    hasher.update(content.as_bytes());
    hasher.finalize().to_vec()
}

fn first_of_month(date: NaiveDate) -> Result<NaiveDate> {
    date.with_day(1)
        .ok_or_else(|| DbError::InvalidData("invalid AirHub analytics date".to_owned()))
}

fn format_root(locale: &str, organization_name: &str, period_start: NaiveDate) -> String {
    if is_russian(locale) {
        format!(
            "📊 Аналитика AirHub · {} {}\n\n{} · новые снимки месяца публикуются ответами в этом треде.",
            ru_month(period_start.month()),
            period_start.year(),
            organization_name.trim(),
        )
    } else {
        format!(
            "📊 AirHub analytics · {} {}\n\n{} · changed monthly snapshots are posted as replies in this thread.",
            en_month(period_start.month()),
            period_start.year(),
            organization_name.trim(),
        )
    }
}

fn format_report(
    locale: &str,
    payments: &StaffPaymentAnalytics,
    funnel: &StaffBookingFunnelAnalytics,
) -> String {
    let russian = is_russian(locale);
    let payment_lines = if payments.currencies.is_empty() {
        vec![if russian {
            "• Оплат пока нет.".to_owned()
        } else {
            "• No payments yet.".to_owned()
        }]
    } else {
        payments
            .currencies
            .iter()
            .map(|currency| format_payment_currency(currency, russian))
            .collect()
    };
    let funnel_period = funnel.periods.last();
    let funnel_lines = funnel_period.map_or_else(
        || {
            vec![if russian {
                "• Пробных заявок пока нет.".to_owned()
            } else {
                "• No trial bookings yet.".to_owned()
            }]
        },
        |period| format_funnel(period, russian),
    );
    if russian {
        format!(
            "Снимок за {} {}\n\n💳 Оплаты\n{}\n\n🎯 Воронка пробных\n{}",
            ru_month(payments.as_of_date.month()),
            payments.as_of_date.year(),
            payment_lines.join("\n"),
            funnel_lines.join("\n"),
        )
    } else {
        format!(
            "Snapshot for {} {}\n\n💳 Payments\n{}\n\n🎯 Trial funnel\n{}",
            en_month(payments.as_of_date.month()),
            payments.as_of_date.year(),
            payment_lines.join("\n"),
            funnel_lines.join("\n"),
        )
    }
}

fn format_payment_currency(series: &PaymentAnalyticsCurrency, russian: bool) -> String {
    let current = series.periods.last();
    let Some(current) = current else {
        return if russian {
            format!("• {}: данных за месяц нет.", series.currency)
        } else {
            format!("• {}: no monthly data.", series.currency)
        };
    };
    let share = format_share(current.paid_share_bps, russian);
    if russian {
        format!(
            "• {}: начислено {} · оплачено {} · ожидается {} · просрочено {} · собираемость {}\n  Открыто всего {} · просрочено всего {}",
            series.currency,
            format_money(current.scheduled_minor, &series.currency, true),
            format_money(current.paid_minor, &series.currency, true),
            format_money(current.outstanding_minor, &series.currency, true),
            format_money(current.overdue_minor, &series.currency, true),
            share,
            format_money(series.open_minor, &series.currency, true),
            format_money(series.overdue_minor, &series.currency, true),
        )
    } else {
        format!(
            "• {}: scheduled {} · paid {} · outstanding {} · overdue {} · collection {}\n  Open total {} · overdue total {}",
            series.currency,
            format_money(current.scheduled_minor, &series.currency, false),
            format_money(current.paid_minor, &series.currency, false),
            format_money(current.outstanding_minor, &series.currency, false),
            format_money(current.overdue_minor, &series.currency, false),
            share,
            format_money(series.open_minor, &series.currency, false),
            format_money(series.overdue_minor, &series.currency, false),
        )
    }
}

fn format_share(value: Option<i32>, russian: bool) -> String {
    let Some(value) = value else {
        return "—".to_owned();
    };
    let whole = value / 100;
    let decimal = (value % 100) / 10;
    let separator = if russian { ',' } else { '.' };
    format!("{whole}{separator}{decimal}%")
}

fn format_funnel(period: &BookingFunnelPeriod, russian: bool) -> Vec<String> {
    let mut lines = vec![format_stages(
        if russian {
            "• Всего"
        } else {
            "• Total"
        },
        &period.stages,
        russian,
    )];
    let mut branches = BTreeMap::<String, BookingFunnelStages>::new();
    let mut sources = BTreeMap::<String, BookingFunnelStages>::new();
    for segment in &period.segments {
        add_stages(
            branches.entry(segment.branch_name.clone()).or_default(),
            &segment.stages,
        );
        add_stages(
            sources.entry(segment.source_channel.clone()).or_default(),
            &segment.stages,
        );
    }
    if !branches.is_empty() {
        lines.push(if russian {
            "Филиалы:".to_owned()
        } else {
            "Branches:".to_owned()
        });
        lines.extend(
            branches
                .iter()
                .map(|(name, stages)| format_stages(&format!("• {name}"), stages, russian)),
        );
    }
    if !sources.is_empty() {
        lines.push(if russian {
            "Источники:".to_owned()
        } else {
            "Sources:".to_owned()
        });
        lines.extend(sources.iter().map(|(source, stages)| {
            format_stages(
                &format!("• {}", source_label(source, russian)),
                stages,
                russian,
            )
        }));
    }
    lines
}

fn add_stages(target: &mut BookingFunnelStages, source: &BookingFunnelStages) {
    target.trial_bookings += source.trial_bookings;
    target.confirmed_trials += source.confirmed_trials;
    target.attended_trials += source.attended_trials;
    target.permanent_enrollments += source.permanent_enrollments;
    target.first_payments_paid += source.first_payments_paid;
}

fn format_stages(label: &str, stages: &BookingFunnelStages, russian: bool) -> String {
    if russian {
        format!(
            "{label}: заявки {} → подтверждено {} → пришли {} → зачислено {} → первая оплата {}",
            stages.trial_bookings,
            stages.confirmed_trials,
            stages.attended_trials,
            stages.permanent_enrollments,
            stages.first_payments_paid,
        )
    } else {
        format!(
            "{label}: bookings {} → confirmed {} → attended {} → enrolled {} → first payment {}",
            stages.trial_bookings,
            stages.confirmed_trials,
            stages.attended_trials,
            stages.permanent_enrollments,
            stages.first_payments_paid,
        )
    }
}

fn source_label(source: &str, russian: bool) -> &str {
    if !russian {
        return source;
    }
    match source {
        "website" => "Сайт",
        "phone" => "Телефон",
        "visit" => "Визит",
        "telegram" => "Telegram",
        "max" => "MAX",
        "whatsapp" => "WhatsApp",
        "buzz" => "Buzz",
        "other" => "Другое",
        value => value,
    }
}

fn format_money(amount_minor: i64, currency: &str, russian: bool) -> String {
    let major = amount_minor / 100;
    let minor = amount_minor.abs() % 100;
    let mut digits = major.abs().to_string();
    let mut index = digits.len().saturating_sub(3);
    while index > 0 {
        digits.insert(index, ' ');
        index = index.saturating_sub(3);
    }
    let sign = if amount_minor < 0 { "-" } else { "" };
    let separator = if russian { ',' } else { '.' };
    let suffix = if currency == "RUB" { " ₽" } else { "" };
    if suffix.is_empty() {
        format!("{sign}{digits}{separator}{minor:02} {currency}")
    } else {
        format!("{sign}{digits}{separator}{minor:02}{suffix}")
    }
}

fn is_russian(locale: &str) -> bool {
    locale.to_ascii_lowercase().starts_with("ru")
}

const fn ru_month(month: u32) -> &'static str {
    match month {
        1 => "январь",
        2 => "февраль",
        3 => "март",
        4 => "апрель",
        5 => "май",
        6 => "июнь",
        7 => "июль",
        8 => "август",
        9 => "сентябрь",
        10 => "октябрь",
        11 => "ноябрь",
        _ => "декабрь",
    }
}

const fn en_month(month: u32) -> &'static str {
    match month {
        1 => "January",
        2 => "February",
        3 => "March",
        4 => "April",
        5 => "May",
        6 => "June",
        7 => "July",
        8 => "August",
        9 => "September",
        10 => "October",
        11 => "November",
        _ => "December",
    }
}

#[cfg(test)]
mod tests {
    use super::super::booking_funnel_analytics::BookingFunnelSegment;
    use super::super::payment_analytics::PaymentAnalyticsPeriod;
    use super::*;

    fn period() -> PaymentAnalyticsPeriod {
        PaymentAnalyticsPeriod {
            period_start: NaiveDate::from_ymd_opt(2026, 8, 1).expect("date"),
            scheduled_count: 2,
            scheduled_minor: 60_000,
            paid_count: 1,
            paid_minor: 45_000,
            outstanding_count: 1,
            outstanding_minor: 15_000,
            overdue_count: 1,
            overdue_minor: 15_000,
            cancelled_count: 0,
            cancelled_minor: 0,
            paid_share_bps: Some(7_500),
        }
    }

    #[test]
    fn report_keeps_currencies_separate_and_aggregates_joint_segments() {
        let date = NaiveDate::from_ymd_opt(2026, 8, 18).expect("date");
        let payments = StaffPaymentAnalytics {
            as_of_date: date,
            currencies: vec![
                PaymentAnalyticsCurrency {
                    currency: "EUR".to_owned(),
                    open_count: 1,
                    open_minor: 8_000,
                    overdue_count: 0,
                    overdue_minor: 0,
                    periods: vec![period()],
                },
                PaymentAnalyticsCurrency {
                    currency: "RUB".to_owned(),
                    open_count: 1,
                    open_minor: 15_000,
                    overdue_count: 1,
                    overdue_minor: 15_000,
                    periods: vec![period()],
                },
            ],
        };
        let stages = BookingFunnelStages {
            trial_bookings: 2,
            confirmed_trials: 2,
            attended_trials: 1,
            permanent_enrollments: 1,
            first_payments_paid: 1,
        };
        let funnel = StaffBookingFunnelAnalytics {
            as_of_date: date,
            periods: vec![BookingFunnelPeriod {
                period_start: NaiveDate::from_ymd_opt(2026, 8, 1).expect("date"),
                stages: stages.clone(),
                first_paid_currencies: Vec::new(),
                segments: vec![BookingFunnelSegment {
                    source_channel: "website".to_owned(),
                    branch_id: Uuid::new_v4(),
                    branch_name: "Центр".to_owned(),
                    stages,
                    first_paid_currencies: Vec::new(),
                }],
            }],
        };

        let content = format_report("ru-RU", &payments, &funnel);

        assert!(content.contains("• EUR:"));
        assert!(content.contains("• RUB:"));
        assert!(content.contains("Филиалы:\n• Центр: заявки 2"));
        assert!(content.contains("Источники:\n• Сайт: заявки 2"));
        assert_eq!(report_digest(&content), report_digest(&content));
    }
}
