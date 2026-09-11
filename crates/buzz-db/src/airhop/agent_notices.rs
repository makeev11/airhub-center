//! Durable local-calendar duties. No model is needed to compute factual reminders.

use std::collections::BTreeMap;

use airhop_core::agent_policy::{
    birthday_age_on, AgentPolicy, AgentRole, AnalyticsSection, NoticeDestination,
};
use buzz_core::{CommunityId, TenantContext};
use chrono::{DateTime, Datelike, Days, NaiveDate, NaiveTime, Timelike, Utc};
use serde_json::Value;
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use super::agent_policy::validate_notice_channel;
use crate::{Db, DbError, Result};

/// Immutable pending event inputs, retained across worker restarts.
#[derive(Debug)]
pub struct AgentNotice {
    /// Tenant resolved by the server.
    pub community_id: CommunityId,
    /// Tenant's canonical host.
    pub host: String,
    /// Receipt identity.
    pub id: Uuid,
    /// Private staff destination.
    pub channel_id: Uuid,
    /// Responsible product role.
    pub role: String,
    /// Authoritative, localized text.
    pub content: String,
    /// Stable signing timestamp.
    pub created_at: DateTime<Utc>,
}

impl Db {
    /// Reserves due duties once per role, local date and destination, then reads pending work.
    pub async fn prepare_airhop_agent_notices(
        &self,
        now: DateTime<Utc>,
    ) -> Result<Vec<AgentNotice>> {
        let targets = sqlx::query("SELECT o.community_id,o.id,o.locale,o.analytics_buzz_channel_id,c.host,($1 AT TIME ZONE o.time_zone)::date AS today,($1 AT TIME ZONE o.time_zone)::time AS local_time FROM airhop_organizations o JOIN communities c ON c.id=o.community_id WHERE o.status='active'")
            .bind(now).fetch_all(&self.pool).await?;
        for row in targets {
            let community: Uuid = row.try_get("community_id")?;
            let organization: Uuid = row.try_get("id")?;
            let tenant = TenantContext::resolved(
                CommunityId::from_uuid(community),
                row.try_get::<String, _>("host")?,
            );
            let today: NaiveDate = row.try_get("today")?;
            let time: NaiveTime = row.try_get("local_time")?;
            let locale: String = row.try_get("locale")?;
            for role in [AgentRole::Administrator, AgentRole::Analyst] {
                let result = async {
                    let completed:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM airhop_agent_duty_runs WHERE community_id=$1 AND role=$2 AND local_date=$3)")
                        .bind(community).bind(role.as_str()).bind(today).fetch_one(&self.pool).await?;
                    if completed {return Ok::<(),DbError>(());}
                    let (policy, version) = self.airhop_agent_policy(&tenant, role).await?;
                    if !policy.enabled {
                        return Ok::<(), DbError>(());
                    }
                    let mut messages = BTreeMap::new();
                    if let Some(birthdays) = policy.birthdays.as_ref().filter(|p| p.enabled) {
                        if (time.hour(), time.minute())
                            < (
                                u32::from(birthdays.time.hour),
                                u32::from(birthdays.time.minute),
                            )
                        {
                            return Ok(());
                        }
                        // Calendar selection happens before traversing enrollment/group/branch links.
                        let mut dates = Vec::new();
                        if birthdays.today {
                            dates.push(today);
                        }
                        if birthdays.advance_days > 0 {
                            if let Some(date) =
                                today.checked_add_days(Days::new(u64::from(birthdays.advance_days)))
                            {
                                dates.push(date);
                            }
                        }
                        for date in dates {
                            let rows = sqlx::query(include_str!("agent_notices/birthdays.sql"))
                                .bind(community)
                                .bind(organization)
                                .bind(date)
                                .fetch_all(&self.pool)
                                .await?;
                            for child in rows {
                                let birth: NaiveDate = child.try_get("birth_date")?;
                                let Some(age) = birthday_age_on(birth, date) else {
                                    continue;
                                };
                                let channel = match birthdays.destination {
                                    NoticeDestination::Channel { channel_id } => Some(channel_id),
                                    NoticeDestination::Branches => {
                                        child.try_get::<Option<Uuid>, _>("channel_id")?
                                    }
                                };
                                let Some(channel) = channel else {
                                    continue;
                                };
                                let child_id: Uuid = child.try_get("id")?;
                                let name: String = child.try_get("display_name")?;
                                let bucket: &mut BTreeMap<(NaiveDate, Uuid), String> =
                                    messages.entry(channel).or_default();
                                bucket.insert(
                                    (date, child_id),
                                    birthday_line(&locale, &name, age, date, today),
                                );
                            }
                        }
                        for (channel, children) in messages {
                            // Keep one digest; never emit one message per child.
                            let mut lines: Vec<String> =
                                children.values().take(60).cloned().collect();
                            if children.len() > 60 {
                                lines.push(format!("+{}", children.len() - 60));
                            }
                            match self.reserve_agent_notice(
                                community,
                                organization,
                                role,
                                version,
                                today,
                                channel,
                                &lines.join("\n"),
                                now,
                            ).await {
                                Ok(()) => {}
                                // One archived or non-staff branch must not block
                                // every other branch's birthday digest.
                                Err(DbError::AccessDenied(error)) => {
                                    tracing::warn!(%community, %channel, %error, "skipping unavailable birthday destination");
                                }
                                Err(error) => return Err(error),
                            }
                        }
                    }
                    if let Some(analytics) = policy.analytics.as_ref().filter(|p| p.enabled) {
                        if (time.hour(), time.minute())
                            < (
                                u32::from(analytics.time.hour),
                                u32::from(analytics.time.minute),
                            )
                            || analytics.weekday.is_some_and(|day| {
                                u32::from(day) != today.weekday().number_from_monday()
                            })
                        {
                            return Ok(());
                        }
                        let channel = analytics
                            .channel_id
                            .or(row.try_get("analytics_buzz_channel_id")?);
                        let Some(channel) = channel else {
                            return Ok(());
                        };
                        if self
                            .agent_notice_exists(community, organization, role, today, channel)
                            .await?
                        {
                            return Ok(());
                        }
                        let data = self
                            .get_airhop_staff_center_analytics(
                                &tenant,
                                if analytics.weekday.is_some() { 7 } else { 1 },
                                true,
                            )
                            .await?;
                        let content = analytics_text(&locale, &data, &analytics.sections);
                        self.reserve_agent_notice(
                            community,
                            organization,
                            role,
                            version,
                            today,
                            channel,
                            &content,
                            now,
                        )
                        .await?;
                    }
                    if policy.birthdays.as_ref().is_some_and(|p|p.enabled) || policy.analytics.as_ref().is_some_and(|p|p.enabled) {
                        sqlx::query("INSERT INTO airhop_agent_duty_runs(community_id,role,local_date) SELECT $1,$2,$3 WHERE COALESCE((SELECT version FROM airhop_agent_policies WHERE community_id=$1 AND role=$2),0)=$4 ON CONFLICT DO NOTHING")
                            .bind(community).bind(role.as_str()).bind(today).bind(version).execute(&self.pool).await?;
                    }
                    Ok(())
                }
                .await;
                if let Err(error) = result {
                    tracing::warn!(%community,role=role.as_str(),%error,"agent duty preparation failed");
                }
            }
        }
        let rows = sqlx::query("SELECT j.*,c.host FROM airhop_agent_notice_jobs j JOIN communities c ON c.id=j.community_id WHERE j.status='pending' ORDER BY j.created_at,j.id LIMIT 100")
            .fetch_all(&self.pool).await?;
        rows.into_iter()
            .map(|r| {
                Ok(AgentNotice {
                    community_id: CommunityId::from_uuid(r.try_get("community_id")?),
                    host: r.try_get("host")?,
                    id: r.try_get("id")?,
                    channel_id: r.try_get("channel_id")?,
                    role: r.try_get("role")?,
                    content: r.try_get("content")?,
                    created_at: r.try_get("created_at")?,
                })
            })
            .collect()
    }

    async fn agent_notice_exists(
        &self,
        community: Uuid,
        organization: Uuid,
        role: AgentRole,
        date: NaiveDate,
        channel: Uuid,
    ) -> Result<bool> {
        Ok(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM airhop_agent_notice_jobs WHERE community_id=$1 AND organization_id=$2 AND role=$3 AND local_date=$4 AND channel_id=$5)")
            .bind(community).bind(organization).bind(role.as_str()).bind(date).bind(channel).fetch_one(&self.pool).await?)
    }

    #[allow(clippy::too_many_arguments)]
    async fn reserve_agent_notice(
        &self,
        community: Uuid,
        organization: Uuid,
        role: AgentRole,
        version: i64,
        date: NaiveDate,
        channel: Uuid,
        content: &str,
        now: DateTime<Utc>,
    ) -> Result<()> {
        if content.is_empty() {
            return Ok(());
        }
        let mut tx = self.pool.begin().await?;
        // Serialize with policy changes, and reject content prepared under an old revision.
        sqlx::query(
            "SELECT id FROM airhop_organizations WHERE community_id=$1 AND id=$2 FOR SHARE",
        )
        .bind(community)
        .bind(organization)
        .fetch_one(tx.as_mut())
        .await?;
        let current:i64=sqlx::query_scalar("SELECT version FROM airhop_agent_policies WHERE community_id=$1 AND organization_id=$2 AND role=$3").bind(community).bind(organization).bind(role.as_str()).fetch_optional(tx.as_mut()).await?.unwrap_or(0);
        if current != version {
            return Ok(());
        }
        validate_notice_channel(tx.as_mut(), community, channel).await?;
        sqlx::query("INSERT INTO airhop_agent_notice_jobs(community_id,organization_id,role,local_date,channel_id,policy_version,content,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING")
            .bind(community).bind(organization).bind(role.as_str()).bind(date).bind(channel).bind(version).bind(content).bind(now).execute(tx.as_mut()).await?;
        tx.commit().await?;
        Ok(())
    }

    /// Locks the duty against concurrent workers and settings changes until publication finishes.
    /// Old pending dates are cancelled instead of sending stale birthday reminders after downtime.
    pub async fn lock_airhop_agent_notice(
        &self,
        job: &AgentNotice,
    ) -> Result<Option<Transaction<'_, Postgres>>> {
        let mut tx = self.pool.begin().await?;
        let community = job.community_id.as_uuid();
        let org:Option<Uuid>=sqlx::query_scalar("SELECT o.id FROM airhop_organizations o JOIN airhop_agent_notice_jobs j ON j.community_id=o.community_id AND j.organization_id=o.id WHERE j.community_id=$1 AND j.id=$2 AND o.status='active' FOR SHARE OF o")
            .bind(community).bind(job.id).fetch_optional(tx.as_mut()).await?;
        if org.is_none() {
            return Ok(None);
        }
        let row=sqlx::query("SELECT j.status,j.policy_version,j.local_date=(now() AT TIME ZONE o.time_zone)::date AS current_date,COALESCE(p.version,0) AS version,p.policy FROM airhop_agent_notice_jobs j JOIN airhop_organizations o ON o.community_id=j.community_id AND o.id=j.organization_id LEFT JOIN airhop_agent_policies p ON p.community_id=j.community_id AND p.organization_id=j.organization_id AND p.role=j.role WHERE j.community_id=$1 AND j.id=$2 FOR UPDATE OF j SKIP LOCKED")
            .bind(community).bind(job.id).fetch_optional(tx.as_mut()).await?;
        let Some(row) = row else {
            return Ok(None);
        };
        if row.try_get::<String, _>("status")? != "pending" {
            return Ok(None);
        }
        let valid = row.try_get::<bool, _>("current_date")?
            && row.try_get::<i64, _>("version")? == row.try_get::<i64, _>("policy_version")?;
        if !valid {
            sqlx::query("UPDATE airhop_agent_notice_jobs SET status='cancelled' WHERE community_id=$1 AND id=$2").bind(community).bind(job.id).execute(tx.as_mut()).await?;
            tx.commit().await?;
            return Ok(None);
        }
        let role = AgentRole::parse(&job.role)
            .ok_or_else(|| DbError::InvalidData("invalid notice role".into()))?;
        let policy: AgentPolicy = match row.try_get::<Option<Value>, _>("policy")? {
            Some(v) => {
                serde_json::from_value(v).map_err(|e| DbError::InvalidData(e.to_string()))?
            }
            None => AgentPolicy::for_role(role),
        };
        if !policy.enabled {
            return Ok(None);
        }
        validate_notice_channel(tx.as_mut(), *community, job.channel_id).await?;
        Ok(Some(tx))
    }
}

fn birthday_line(locale: &str, name: &str, age: u32, date: NaiveDate, today: NaiveDate) -> String {
    let locale = locale.split(['-', '_']).next().unwrap_or("en");
    // Names are data, not Markdown mentions or commands.
    let name: String = name
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '[' | ']' | '@' | '<' | '>' | '`'))
        .take(160)
        .collect();
    let when = if date == today {
        match locale {
            "ru" => "Сегодня",
            "pt" => "Hoje",
            "tr" => "Bugün",
            _ => "Today",
        }
        .to_owned()
    } else {
        match locale {
            "ru" | "pt" | "tr" => date.format("%d.%m.%Y").to_string(),
            _ => date.to_string(),
        }
    };
    match locale {
        "ru" => {
            let unit = if (11..=14).contains(&(age % 100)) {
                "лет"
            } else {
                match age % 10 {
                    1 => "год",
                    2..=4 => "года",
                    _ => "лет",
                }
            };
            format!("🎂 {when}: {name} — исполняется {age} {unit}.")
        }
        "pt" => format!("🎂 {when}: {name} — faz {age} anos."),
        "tr" => format!("🎂 {when}: {name} — {age} yaşına giriyor."),
        _ => format!("🎂 {when}: {name} — turns {age}."),
    }
}

fn analytics_text(locale: &str, data: &Value, sections: &[AnalyticsSection]) -> String {
    let locale = locale.split(['-', '_']).next().unwrap_or("en");
    let labels = match locale {
        "ru" => [
            "Отчёт",
            "Заявки / подтверждены / ожидают",
            "Оплаты / возвраты / долг / просрочено",
            "Посетили / отсутствовали / занятия без отметок",
            "Места заняты / всего; переполненные занятия (следующие 7 дней)",
            "Источники: с атрибуцией / без атрибуции",
            "Текущие остатки и будущая загрузка рассчитаны на момент отчёта.",
        ],
        "pt" => [
            "Relatório",
            "Reservas / confirmadas / pendentes",
            "Recebimentos / reembolsos / saldo / vencido",
            "Presenças / faltas / aulas sem registro",
            "Vagas ocupadas / total; aulas lotadas (próximos 7 dias)",
            "Origens: atribuídas / sem atribuição",
            "Saldos e capacidade futura são atuais.",
        ],
        "tr" => [
            "Rapor",
            "Rezervasyon / onaylanan / bekleyen",
            "Tahsilat / iade / bakiye / gecikmiş",
            "Katılım / devamsız / kayıtsız dersler",
            "Dolu / toplam yer; kapasite aşımı (gelecek 7 gün)",
            "Kaynaklar: ilişkilendirilmiş / belirsiz",
            "Bakiyeler ve gelecek kapasite günceldir.",
        ],
        _ => [
            "Report",
            "Bookings / confirmed / pending",
            "Receipts / refunds / outstanding / overdue",
            "Present / absent / unmarked lessons",
            "Occupied / total places; overbooked lessons (next 7 days)",
            "Acquisition: attributed / unattributed",
            "Balances and future capacity are current.",
        ],
    };
    let value = |path: &str| {
        data.pointer(path)
            .map(|v| {
                v.as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| v.to_string())
            })
            .unwrap_or_else(|| "—".into())
    };
    let mut lines = vec![format!(
        "{}: {} — {}",
        labels[0],
        value("/periodStart"),
        value("/asOfDate")
    )];
    for section in sections {
        match section {
            AnalyticsSection::Bookings => lines.push(format!(
                "{}: {} / {} / {}",
                labels[1],
                value("/cohort/bookings"),
                value("/cohort/confirmed"),
                value("/cohort/pending")
            )),
            AnalyticsSection::Payments => {
                lines.push(labels[2].into());
                if let Some(money) = data["money"].as_array() {
                    for m in money {
                        let currency = m["currency"].as_str().unwrap_or("?");
                        lines.push(format!(
                            "{}: {} / {} / {} / {}",
                            currency,
                            notice_money(&m["receiptsMinor"], currency, locale),
                            notice_money(&m["refundsMinor"], currency, locale),
                            notice_money(&m["outstandingMinor"], currency, locale),
                            notice_money(&m["overdueMinor"], currency, locale)
                        ));
                    }
                }
            }
            AnalyticsSection::Attendance => lines.push(format!(
                "{}: {} / {} / {}",
                labels[3],
                value("/attendance/present"),
                value("/attendance/absent"),
                value("/coverage/unmarkedLessons")
            )),
            AnalyticsSection::Capacity => lines.push(format!(
                "{}: {} / {}; {}",
                labels[4],
                value("/capacity/occupied"),
                value("/capacity/places"),
                value("/capacity/overbookedLessons")
            )),
            AnalyticsSection::Acquisition => lines.push(format!(
                "{}: {} / {}",
                labels[5],
                value("/coverage/attributedBookings"),
                value("/coverage/unattributedBookings")
            )),
        }
    }
    lines.push(labels[6].into());
    lines.join("\n")
}

fn notice_money(value: &Value, currency: &str, locale: &str) -> String {
    // Generated from Intl.supportedValuesOf/NumberFormat, matching bookingMoney.ts.
    static UNITS: std::sync::OnceLock<Option<BTreeMap<String, u32>>> = std::sync::OnceLock::new();
    let units = UNITS.get_or_init(|| {
        serde_json::from_str(include_str!("agent_notices/currency_units.json")).ok()
    });
    let Some(amount) = value.as_i64() else {
        return "—".into();
    };
    let Some(digits) = units
        .as_ref()
        .and_then(|map| map.get(currency))
        .copied()
        .filter(|v| *v <= 6)
    else {
        return format!("{amount} (minor)");
    };
    let scale = 10u64.pow(digits);
    let magnitude = amount.unsigned_abs();
    let sign = if amount < 0 { "-" } else { "" };
    if digits == 0 {
        return format!("{sign}{}", magnitude / scale);
    }
    let separator = if locale == "en" { "." } else { "," };
    format!(
        "{sign}{}{separator}{:0width$}",
        magnitude / scale,
        magnitude % scale,
        width = digits as usize
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn amounts_respect_currency_minor_units_and_missing_data() {
        assert_eq!(notice_money(&json!(12345), "USD", "en"), "123.45");
        assert_eq!(notice_money(&json!(-1), "RUB", "ru"), "-0,01");
        assert_eq!(notice_money(&json!(12345), "JPY", "en"), "12345");
        assert_eq!(notice_money(&json!(12345), "KWD", "en"), "12.345");
        assert_eq!(notice_money(&Value::Null, "USD", "en"), "—");
        assert_eq!(notice_money(&json!(50), "UNKNOWN", "en"), "50 (minor)");
    }
    #[test]
    fn birthday_copy_uses_actual_age_and_sanitizes_mentions() {
        let today = NaiveDate::from_ymd_opt(2026, 9, 11).unwrap();
        for (age, text) in [
            (1, "1 год."),
            (2, "2 года."),
            (5, "5 лет."),
            (11, "11 лет."),
            (21, "21 год."),
        ] {
            let line = birthday_line("ru-RU", "@Анна\n[имя]", age, today, today);
            assert!(line.ends_with(text));
            assert!(!line.contains('@') && !line.contains('\n') && !line.contains('['));
        }
    }
    #[test]
    fn report_respects_section_selection_and_never_invents_missing_facts() {
        let text = analytics_text(
            "en",
            &serde_json::json!({"periodStart":"2026-09-10","asOfDate":"2026-09-10","attendance":{"present":3,"absent":1},"coverage":{"unmarkedLessons":2}}),
            &[AnalyticsSection::Attendance],
        );
        assert!(text.contains("3 / 1 / 2"));
        assert!(!text.contains("Bookings /"));
        assert!(!text.contains("Receipts /"));
        assert!(
            analytics_text("en", &Value::Null, &[AnalyticsSection::Bookings]).contains("— / — / —")
        );
    }
}
