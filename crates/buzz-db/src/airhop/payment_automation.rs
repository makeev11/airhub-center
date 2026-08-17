//! Rolling payment creation and durable Buzz overdue-summary state.

use std::collections::BTreeMap;

use buzz_core::{CommunityId, TenantContext};
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

use super::{
    append_domain_event, commit_command, insert_pending_command, ActorKind, AirhopActor,
    CommandInsertOutcome, CommandStatus, NewAirhopCommand, NewDomainEvent, PrivacyClass,
};
use crate::{Db, DbError, Result};

const MATERIALIZE_PAYMENT_COMMAND_TYPE: &str = "MaterializePaymentExpectation";
const MAX_CREATED_PER_ENROLLMENT: usize = 24;

/// One reserved overdue-summary publication. Its content and timestamp remain
/// stable across retries, so the relay produces the same signed event IDs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingOverdueSummary {
    /// Server-resolved community.
    pub community_id: CommunityId,
    /// Host mapped to the community.
    pub host: String,
    /// AirHub organization.
    pub organization_id: Uuid,
    /// Configured shared payment channel.
    pub channel_id: Uuid,
    /// Idempotent pending-delivery identity.
    pub pending_id: Uuid,
    /// Calendar month represented by the thread root.
    pub period_start: NaiveDate,
    /// Stable top-level thread copy.
    pub root_content: String,
    /// Stable reply containing the changed snapshot.
    pub content: String,
    /// Persisted event timestamp used for retry-stable signing.
    pub created_at: DateTime<Utc>,
    /// Existing thread root event, when the month already has one.
    pub root_event_id: Option<Vec<u8>>,
    /// Existing thread root timestamp.
    pub root_event_created_at: Option<DateTime<Utc>>,
}

#[derive(Debug)]
struct OrganizationTarget {
    community_id: Uuid,
    host: String,
    organization_id: Uuid,
    name: String,
    locale: String,
    channel_id: Option<Uuid>,
    local_date: NaiveDate,
}

#[derive(Debug)]
struct EnrollmentSource {
    id: Uuid,
    family_id: Uuid,
    child_id: Uuid,
    tariff_id: Uuid,
    start_date: NaiveDate,
    end_date: Option<NaiveDate>,
    tariff_name: String,
    amount_minor: i64,
    currency: String,
    payment_day: u32,
    latest_billing_period: Option<NaiveDate>,
}

#[derive(Debug)]
struct SummaryState {
    channel_id: Uuid,
    period_start: NaiveDate,
    root_event_id: Option<Vec<u8>>,
    root_event_created_at: Option<DateTime<Utc>>,
    last_digest: Option<Vec<u8>>,
    last_overdue_count: i32,
    pending_id: Option<Uuid>,
    pending_root_content: Option<String>,
    pending_content: Option<String>,
    pending_created_at: Option<DateTime<Utc>>,
}

#[derive(Debug)]
struct OverdueRow {
    child_name: String,
    family_name: String,
    group_name: String,
    branch_name: String,
    amount_minor: i64,
    currency: String,
    due_date: NaiveDate,
}

impl Db {
    /// Creates missing monthly expectations through the end of next local month.
    ///
    /// Only active configured enrollments participate. Every created row takes
    /// a fresh tariff snapshot; existing expectations are never rewritten.
    pub async fn refresh_airhop_payment_horizons(&self) -> Result<usize> {
        let targets = load_organization_targets(self).await?;
        let mut created = 0usize;
        let mut first_error = None;
        for target in targets {
            let tenant = TenantContext::resolved(
                CommunityId::from_uuid(target.community_id),
                target.host.clone(),
            );
            match self
                .materialize_organization_payments(
                    &tenant,
                    target.organization_id,
                    target.local_date,
                )
                .await
            {
                Ok(count) => created += count,
                Err(error) => {
                    tracing::warn!(
                        community_id = %target.community_id,
                        organization_id = %target.organization_id,
                        %error,
                        "AirHub payment horizon refresh failed"
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
            Ok(created)
        }
    }

    /// Reserves changed overdue snapshots for retry-stable Buzz publication.
    pub async fn prepare_airhop_overdue_summaries(&self) -> Result<Vec<PendingOverdueSummary>> {
        let targets = load_organization_targets(self).await?;
        let mut jobs = Vec::new();
        let mut first_error = None;
        for target in targets
            .into_iter()
            .filter(|target| target.channel_id.is_some())
        {
            match self.prepare_organization_summary(&target).await {
                Ok(Some(job)) => jobs.push(job),
                Ok(None) => {}
                Err(error) => {
                    tracing::warn!(
                        community_id = %target.community_id,
                        organization_id = %target.organization_id,
                        %error,
                        "AirHub overdue summary preparation failed"
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

    /// Marks one retry-stable overdue summary as durably published.
    pub async fn complete_airhop_overdue_summary(
        &self,
        tenant: &TenantContext,
        organization_id: Uuid,
        pending_id: Uuid,
        root_event_id: &[u8],
        root_event_created_at: DateTime<Utc>,
        summary_event_id: &[u8],
    ) -> Result<bool> {
        if root_event_id.len() != 32 || summary_event_id.len() != 32 || pending_id.is_nil() {
            return Err(DbError::InvalidData(
                "AirHub overdue summary event identity is invalid".to_owned(),
            ));
        }
        let result = sqlx::query(
            "UPDATE airhop_payment_buzz_summary_state \
             SET root_event_id = $4, root_event_created_at = $5, \
                 last_summary_event_id = $6, last_digest = pending_digest, \
                 last_overdue_count = pending_overdue_count, \
                 pending_id = NULL, pending_digest = NULL, pending_root_content = NULL, \
                 pending_content = NULL, \
                 pending_created_at = NULL, pending_overdue_count = NULL, updated_at = now() \
             WHERE community_id = $1 AND organization_id = $2 AND pending_id = $3",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(pending_id)
        .bind(root_event_id)
        .bind(root_event_created_at)
        .bind(summary_event_id)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    async fn materialize_organization_payments(
        &self,
        tenant: &TenantContext,
        organization_id: Uuid,
        local_date: NaiveDate,
    ) -> Result<usize> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 8127))")
            .bind(organization_id)
            .execute(&mut *transaction)
            .await?;
        let rows = sqlx::query(
            "SELECT enrollment.id, enrollment.family_id, enrollment.child_id, \
                    enrollment.tariff_id, enrollment.start_date, enrollment.end_date, \
                    tariff.name AS tariff_name, tariff.price_minor, tariff.currency, \
                    COALESCE(tariff.payment_day_of_month, organization.payment_day_of_month) \
                        AS payment_day, MAX(payment.billing_period) AS latest_billing_period \
             FROM airhop_enrollments enrollment \
             JOIN airhop_organizations organization \
               ON organization.community_id = enrollment.community_id \
              AND organization.id = enrollment.organization_id AND organization.status = 'active' \
             JOIN airhop_tariffs tariff \
               ON tariff.community_id = enrollment.community_id \
              AND tariff.organization_id = enrollment.organization_id \
              AND tariff.id = enrollment.tariff_id \
             LEFT JOIN airhop_payment_expectations payment \
               ON payment.community_id = enrollment.community_id \
              AND payment.organization_id = enrollment.organization_id \
              AND payment.enrollment_id = enrollment.id \
             WHERE enrollment.community_id = $1 AND enrollment.organization_id = $2 \
               AND enrollment.status = 'active' AND enrollment.assignment_state = 'configured' \
             GROUP BY enrollment.id, enrollment.family_id, enrollment.child_id, \
                      enrollment.tariff_id, enrollment.start_date, enrollment.end_date, \
                      tariff.name, tariff.price_minor, tariff.currency, \
                      tariff.payment_day_of_month, organization.payment_day_of_month \
             ORDER BY enrollment.id",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .fetch_all(&mut *transaction)
        .await?;
        let sources = rows
            .into_iter()
            .map(parse_enrollment_source)
            .collect::<Result<Vec<_>>>()?;
        let occurred_at: DateTime<Utc> = sqlx::query_scalar("SELECT now()")
            .fetch_one(&mut *transaction)
            .await?;
        let horizon_period = next_month(first_of_month(local_date)?);
        let mut created = 0usize;
        for source in sources {
            let (mut billing_period, mut due_date) = match source.latest_billing_period {
                Some(latest) => {
                    let period = next_month(first_of_month(latest)?);
                    (period, payment_date(period, source.payment_day)?)
                }
                None => (first_of_month(source.start_date)?, source.start_date),
            };
            for _ in 0..MAX_CREATED_PER_ENROLLMENT {
                if billing_period > horizon_period
                    || source.end_date.is_some_and(|end_date| due_date > end_date)
                {
                    break;
                }
                if materialize_payment(
                    &mut transaction,
                    tenant,
                    organization_id,
                    &source,
                    billing_period,
                    due_date,
                    occurred_at,
                )
                .await?
                {
                    created += 1;
                }
                billing_period = next_month(billing_period);
                due_date = payment_date(billing_period, source.payment_day)?;
            }
        }
        transaction.commit().await?;
        Ok(created)
    }

    async fn prepare_organization_summary(
        &self,
        target: &OrganizationTarget,
    ) -> Result<Option<PendingOverdueSummary>> {
        let channel_id = target
            .channel_id
            .ok_or_else(|| DbError::InvalidData("AirHub payments channel is missing".to_owned()))?;
        let mut transaction = self.pool.begin().await?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 8128))")
            .bind(target.organization_id)
            .execute(&mut *transaction)
            .await?;
        let state = load_summary_state(
            &mut transaction,
            target.community_id,
            target.organization_id,
        )
        .await?;
        if let Some(job) = pending_job_from_state(target, state.as_ref())? {
            transaction.commit().await?;
            return Ok(Some(job));
        }
        let rows = load_overdue_rows(
            &mut transaction,
            target.community_id,
            target.organization_id,
            target.local_date,
        )
        .await?;
        let overdue_count = i32::try_from(rows.len())
            .map_err(|_| DbError::InvalidData("AirHub overdue summary is too large".to_owned()))?;
        if overdue_count == 0
            && state
                .as_ref()
                .is_none_or(|summary| summary.last_overdue_count == 0)
        {
            transaction.commit().await?;
            return Ok(None);
        }
        let period_start = first_of_month(target.local_date)?;
        let content = format_summary(&target.locale, target.local_date, &rows);
        let digest = summary_digest(&rows);
        let same_scope = state.as_ref().is_some_and(|summary| {
            summary.channel_id == channel_id && summary.period_start == period_start
        });
        if same_scope
            && state
                .as_ref()
                .and_then(|summary| summary.last_digest.as_deref())
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
            "INSERT INTO airhop_payment_buzz_summary_state (\
                 community_id, organization_id, channel_id, period_start, \
                 pending_id, pending_digest, pending_root_content, pending_content, pending_created_at, \
                 pending_overdue_count, updated_at\
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $9) \
             ON CONFLICT (community_id, organization_id) DO UPDATE SET \
                 channel_id = EXCLUDED.channel_id, period_start = EXCLUDED.period_start, \
                 root_event_id = CASE \
                     WHEN airhop_payment_buzz_summary_state.channel_id = EXCLUDED.channel_id \
                      AND airhop_payment_buzz_summary_state.period_start = EXCLUDED.period_start \
                     THEN airhop_payment_buzz_summary_state.root_event_id ELSE NULL END, \
                 root_event_created_at = CASE \
                     WHEN airhop_payment_buzz_summary_state.channel_id = EXCLUDED.channel_id \
                      AND airhop_payment_buzz_summary_state.period_start = EXCLUDED.period_start \
                     THEN airhop_payment_buzz_summary_state.root_event_created_at ELSE NULL END, \
                 pending_id = EXCLUDED.pending_id, pending_digest = EXCLUDED.pending_digest, \
                 pending_root_content = EXCLUDED.pending_root_content, \
                 pending_content = EXCLUDED.pending_content, \
                 pending_created_at = EXCLUDED.pending_created_at, \
                 pending_overdue_count = EXCLUDED.pending_overdue_count, \
                 updated_at = EXCLUDED.updated_at",
        )
        .bind(target.community_id)
        .bind(target.organization_id)
        .bind(channel_id)
        .bind(period_start)
        .bind(pending_id)
        .bind(&digest)
        .bind(&root_content)
        .bind(&content)
        .bind(created_at)
        .bind(overdue_count)
        .execute(&mut *transaction)
        .await?;
        let (root_event_id, root_event_created_at) = if same_scope {
            state.map_or((None, None), |summary| {
                (summary.root_event_id, summary.root_event_created_at)
            })
        } else {
            (None, None)
        };
        transaction.commit().await?;
        Ok(Some(PendingOverdueSummary {
            community_id: CommunityId::from_uuid(target.community_id),
            host: target.host.clone(),
            organization_id: target.organization_id,
            channel_id,
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

async fn load_organization_targets(db: &Db) -> Result<Vec<OrganizationTarget>> {
    let rows = sqlx::query(
        "SELECT organization.community_id, community.host, organization.id, \
                organization.name, organization.locale, organization.payments_buzz_channel_id, \
                (now() AT TIME ZONE organization.time_zone)::date AS local_date \
         FROM airhop_organizations organization \
         JOIN communities community ON community.id = organization.community_id \
         WHERE organization.status = 'active' \
         ORDER BY organization.community_id",
    )
    .fetch_all(&db.pool)
    .await?;
    rows.into_iter()
        .map(|row| {
            Ok(OrganizationTarget {
                community_id: row.try_get("community_id")?,
                host: row.try_get("host")?,
                organization_id: row.try_get("id")?,
                name: row.try_get("name")?,
                locale: row.try_get("locale")?,
                channel_id: row.try_get("payments_buzz_channel_id")?,
                local_date: row.try_get("local_date")?,
            })
        })
        .collect()
}

fn parse_enrollment_source(row: sqlx::postgres::PgRow) -> Result<EnrollmentSource> {
    let payment_day: i16 = row.try_get("payment_day")?;
    let payment_day = u32::try_from(payment_day)
        .ok()
        .filter(|day| (1..=28).contains(day))
        .ok_or_else(|| DbError::InvalidData("invalid AirHub payment day".to_owned()))?;
    Ok(EnrollmentSource {
        id: row.try_get("id")?,
        family_id: row.try_get("family_id")?,
        child_id: row.try_get("child_id")?,
        tariff_id: row.try_get("tariff_id")?,
        start_date: row.try_get("start_date")?,
        end_date: row.try_get("end_date")?,
        tariff_name: row.try_get("tariff_name")?,
        amount_minor: row.try_get("price_minor")?,
        currency: row.try_get("currency")?,
        payment_day,
        latest_billing_period: row.try_get("latest_billing_period")?,
    })
}

async fn materialize_payment(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    source: &EnrollmentSource,
    billing_period: NaiveDate,
    due_date: NaiveDate,
    occurred_at: DateTime<Utc>,
) -> Result<bool> {
    let digest = materialization_digest(tenant, organization_id, source.id, billing_period);
    let actor = AirhopActor {
        kind: ActorKind::System,
        pubkey: None,
        on_behalf_of_pubkey: None,
        agent_pubkey: None,
    };
    let command = match insert_pending_command(
        transaction,
        tenant,
        &NewAirhopCommand {
            id: Uuid::new_v4(),
            organization_id,
            command_type: MATERIALIZE_PAYMENT_COMMAND_TYPE.to_owned(),
            idempotency_digest: digest,
            request_hash: digest,
            actor: actor.clone(),
            correlation_id: Uuid::new_v4(),
        },
    )
    .await?
    {
        CommandInsertOutcome::Inserted(command) => command,
        CommandInsertOutcome::Existing(command) => match command.status {
            CommandStatus::Committed => return Ok(false),
            CommandStatus::Pending => return Err(DbError::AirhopCommandInProgress),
            CommandStatus::Failed => return Err(DbError::AirhopCommandPreviouslyFailed),
        },
    };
    let payment_id = Uuid::new_v4();
    let inserted = sqlx::query_scalar(
        "INSERT INTO airhop_payment_expectations (\
             community_id, organization_id, id, family_id, child_id, enrollment_id, \
             tariff_id, tariff_name_snapshot, amount_minor, currency, billing_period, due_date, \
             created_at, updated_at\
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13) \
         ON CONFLICT (community_id, organization_id, enrollment_id, billing_period) DO NOTHING \
         RETURNING id",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(payment_id)
    .bind(source.family_id)
    .bind(source.child_id)
    .bind(source.id)
    .bind(source.tariff_id)
    .bind(source.tariff_name.trim())
    .bind(source.amount_minor)
    .bind(&source.currency)
    .bind(billing_period)
    .bind(due_date)
    .bind(occurred_at)
    .fetch_optional(&mut **transaction)
    .await?;
    let actual_payment_id = if let Some(inserted) = inserted {
        append_domain_event(
            transaction,
            tenant,
            &NewDomainEvent {
                id: Uuid::new_v4(),
                organization_id,
                stream_type: "payment_expectation".to_owned(),
                stream_id: inserted,
                stream_version: 1,
                event_type: "airhop.payment.expected.v1".to_owned(),
                schema_version: 1,
                occurred_at,
                actor,
                causation_id: command.id,
                correlation_id: command.correlation_id,
                payload: json!({
                    "paymentId": inserted,
                    "enrollmentId": source.id,
                    "billingPeriod": billing_period,
                    "dueDate": due_date,
                    "tariffId": source.tariff_id,
                    "tariffNameSnapshot": source.tariff_name,
                    "amountMinor": source.amount_minor,
                    "currency": source.currency,
                    "automatic": true,
                }),
                privacy_class: PrivacyClass::Operational,
            },
        )
        .await?;
        inserted
    } else {
        sqlx::query_scalar(
            "SELECT id FROM airhop_payment_expectations \
             WHERE community_id = $1 AND organization_id = $2 \
               AND enrollment_id = $3 AND billing_period = $4",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(source.id)
        .bind(billing_period)
        .fetch_one(&mut **transaction)
        .await?
    };
    commit_command(
        transaction,
        tenant,
        organization_id,
        command.id,
        &json!({
            "paymentId": actual_payment_id,
            "billingPeriod": billing_period,
            "dueDate": due_date,
        }),
    )
    .await?;
    Ok(actual_payment_id == payment_id)
}

fn materialization_digest(
    tenant: &TenantContext,
    organization_id: Uuid,
    enrollment_id: Uuid,
    billing_period: NaiveDate,
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"airhop.payment.materialization.v1\0");
    hasher.update(tenant.community().as_uuid().as_bytes());
    hasher.update(organization_id.as_bytes());
    hasher.update(enrollment_id.as_bytes());
    hasher.update(billing_period.to_string().as_bytes());
    hasher.finalize().into()
}

fn summary_digest(rows: &[OverdueRow]) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(b"airhop.overdue-summary.snapshot.v1\0");
    for row in rows {
        let due_date = row.due_date.to_string();
        let amount_minor = row.amount_minor.to_string();
        for value in [
            row.child_name.as_bytes(),
            row.family_name.as_bytes(),
            row.group_name.as_bytes(),
            row.branch_name.as_bytes(),
            row.currency.as_bytes(),
            due_date.as_bytes(),
            amount_minor.as_bytes(),
        ] {
            hasher.update((value.len() as u64).to_be_bytes());
            hasher.update(value);
        }
    }
    hasher.finalize().to_vec()
}

async fn load_summary_state(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: Uuid,
    organization_id: Uuid,
) -> Result<Option<SummaryState>> {
    let row = sqlx::query(
        "SELECT channel_id, period_start, root_event_id, root_event_created_at, \
                last_digest, last_overdue_count, pending_id, pending_root_content, pending_content, \
                pending_created_at \
         FROM airhop_payment_buzz_summary_state \
         WHERE community_id = $1 AND organization_id = $2 FOR UPDATE",
    )
    .bind(community_id)
    .bind(organization_id)
    .fetch_optional(&mut **transaction)
    .await?;
    row.map(|row| {
        Ok(SummaryState {
            channel_id: row.try_get("channel_id")?,
            period_start: row.try_get("period_start")?,
            root_event_id: row.try_get("root_event_id")?,
            root_event_created_at: row.try_get("root_event_created_at")?,
            last_digest: row.try_get("last_digest")?,
            last_overdue_count: row.try_get("last_overdue_count")?,
            pending_id: row.try_get("pending_id")?,
            pending_root_content: row.try_get("pending_root_content")?,
            pending_content: row.try_get("pending_content")?,
            pending_created_at: row.try_get("pending_created_at")?,
        })
    })
    .transpose()
}

fn pending_job_from_state(
    target: &OrganizationTarget,
    state: Option<&SummaryState>,
) -> Result<Option<PendingOverdueSummary>> {
    let Some(state) = state else {
        return Ok(None);
    };
    let Some(pending_id) = state.pending_id else {
        return Ok(None);
    };
    let content = state.pending_content.clone().ok_or_else(|| {
        DbError::InvalidData("AirHub overdue summary has incomplete pending state".to_owned())
    })?;
    let root_content = state.pending_root_content.clone().ok_or_else(|| {
        DbError::InvalidData("AirHub overdue summary has no pending root content".to_owned())
    })?;
    let created_at = state.pending_created_at.ok_or_else(|| {
        DbError::InvalidData("AirHub overdue summary has no pending timestamp".to_owned())
    })?;
    Ok(Some(PendingOverdueSummary {
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

async fn load_overdue_rows(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: Uuid,
    organization_id: Uuid,
    local_date: NaiveDate,
) -> Result<Vec<OverdueRow>> {
    let rows = sqlx::query(
        "SELECT child.display_name AS child_name, family.display_name AS family_name, \
                group_row.name AS group_name, branch.name AS branch_name, \
                payment.amount_minor, payment.currency, payment.due_date \
         FROM airhop_payment_expectations payment \
         JOIN airhop_children child \
           ON child.community_id = payment.community_id \
          AND child.organization_id = payment.organization_id AND child.id = payment.child_id \
         JOIN airhop_families family \
           ON family.community_id = payment.community_id \
          AND family.organization_id = payment.organization_id AND family.id = payment.family_id \
         JOIN airhop_enrollments enrollment \
           ON enrollment.community_id = payment.community_id \
          AND enrollment.organization_id = payment.organization_id \
          AND enrollment.id = payment.enrollment_id \
         JOIN airhop_groups group_row \
           ON group_row.community_id = enrollment.community_id \
          AND group_row.organization_id = enrollment.organization_id \
          AND group_row.id = enrollment.group_id \
         JOIN airhop_branches branch \
           ON branch.community_id = group_row.community_id \
          AND branch.organization_id = group_row.organization_id \
          AND branch.id = group_row.branch_id \
         WHERE payment.community_id = $1 AND payment.organization_id = $2 \
           AND payment.status = 'expected' AND payment.due_date < $3 \
         ORDER BY payment.due_date, lower(child.display_name), payment.id",
    )
    .bind(community_id)
    .bind(organization_id)
    .bind(local_date)
    .fetch_all(&mut **transaction)
    .await?;
    rows.into_iter()
        .map(|row| {
            Ok(OverdueRow {
                child_name: row.try_get("child_name")?,
                family_name: row.try_get("family_name")?,
                group_name: row.try_get("group_name")?,
                branch_name: row.try_get("branch_name")?,
                amount_minor: row.try_get("amount_minor")?,
                currency: row.try_get("currency")?,
                due_date: row.try_get("due_date")?,
            })
        })
        .collect()
}

fn first_of_month(date: NaiveDate) -> Result<NaiveDate> {
    date.with_day(1)
        .ok_or_else(|| DbError::InvalidData("invalid AirHub calendar date".to_owned()))
}

fn next_month(date: NaiveDate) -> NaiveDate {
    if date.month() == 12 {
        NaiveDate::from_ymd_opt(date.year() + 1, 1, 1).unwrap_or(date)
    } else {
        NaiveDate::from_ymd_opt(date.year(), date.month() + 1, 1).unwrap_or(date)
    }
}

fn payment_date(period_start: NaiveDate, payment_day: u32) -> Result<NaiveDate> {
    period_start
        .with_day(payment_day)
        .ok_or_else(|| DbError::InvalidData("invalid AirHub monthly payment date".to_owned()))
}

fn format_root(locale: &str, organization_name: &str, period_start: NaiveDate) -> String {
    if locale.to_ascii_lowercase().starts_with("ru") {
        format!(
            "💳 Просроченные оплаты · {} {}\n\n{} · сводка обновляется ответами в этом треде.",
            ru_month(period_start.month()),
            period_start.year(),
            organization_name.trim()
        )
    } else {
        format!(
            "💳 Overdue payments · {} {}\n\n{} · changed snapshots are posted as replies in this thread.",
            en_month(period_start.month()),
            period_start.year(),
            organization_name.trim()
        )
    }
}

fn format_summary(locale: &str, local_date: NaiveDate, rows: &[OverdueRow]) -> String {
    let russian = locale.to_ascii_lowercase().starts_with("ru");
    if rows.is_empty() {
        return if russian {
            format!(
                "✅ Просроченных оплат больше нет.\n\nСостояние на {}.",
                format_date(local_date, true)
            )
        } else {
            format!(
                "✅ There are no overdue payments.\n\nSnapshot for {}.",
                format_date(local_date, false)
            )
        };
    }
    let mut totals = BTreeMap::<String, i64>::new();
    let mut lines = Vec::with_capacity(rows.len());
    for row in rows {
        *totals.entry(row.currency.clone()).or_default() += row.amount_minor;
        if russian {
            lines.push(format!(
                "• {} · {}\n  {} · #{}\n  {} · срок {}",
                row.child_name,
                row.family_name,
                row.group_name,
                row.branch_name,
                format_money(row.amount_minor, &row.currency, true),
                format_date(row.due_date, true),
            ));
        } else {
            lines.push(format!(
                "• {} · {}\n  {} · #{}\n  {} · due {}",
                row.child_name,
                row.family_name,
                row.group_name,
                row.branch_name,
                format_money(row.amount_minor, &row.currency, false),
                format_date(row.due_date, false),
            ));
        }
    }
    let totals = totals
        .into_iter()
        .map(|(currency, amount)| format_money(amount, &currency, russian))
        .collect::<Vec<_>>()
        .join(" + ");
    if russian {
        format!(
            "Просрочено: {} · {}\nСостояние на {}\n\n{}\n\nИтого: {}\nОтметьте оплату в AirHub Center — следующая сводка обновится автоматически.",
            rows.len(),
            totals,
            format_date(local_date, true),
            lines.join("\n\n"),
            totals,
        )
    } else {
        format!(
            "Overdue: {} · {}\nSnapshot for {}\n\n{}\n\nTotal: {}\nMark payments in AirHub Center; the next snapshot updates automatically.",
            rows.len(),
            totals,
            format_date(local_date, false),
            lines.join("\n\n"),
            totals,
        )
    }
}

fn format_money(amount_minor: i64, currency: &str, russian: bool) -> String {
    let major = amount_minor / 100;
    let minor = amount_minor % 100;
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

fn format_date(date: NaiveDate, russian: bool) -> String {
    if russian {
        format!("{:02}.{:02}.{}", date.day(), date.month(), date.year())
    } else {
        date.to_string()
    }
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
    use super::*;

    #[test]
    fn next_payment_uses_the_configured_day_in_the_next_month() {
        let latest = NaiveDate::from_ymd_opt(2026, 8, 18).unwrap();
        let due = payment_date(next_month(first_of_month(latest).unwrap()), 5).unwrap();
        assert_eq!(due, NaiveDate::from_ymd_opt(2026, 9, 5).unwrap());
    }

    #[test]
    fn next_payment_crosses_the_year_boundary() {
        let latest = NaiveDate::from_ymd_opt(2026, 12, 28).unwrap();
        let due = payment_date(next_month(first_of_month(latest).unwrap()), 10).unwrap();
        assert_eq!(due, NaiveDate::from_ymd_opt(2027, 1, 10).unwrap());
    }

    #[test]
    fn moved_due_date_does_not_shift_the_next_billing_period() {
        let august_period = NaiveDate::from_ymd_opt(2026, 8, 1).unwrap();
        let moved_august_due_date = NaiveDate::from_ymd_opt(2026, 10, 20).unwrap();
        let september_period = next_month(august_period);
        let september_due_date = payment_date(september_period, 5).unwrap();
        assert_eq!(
            september_due_date,
            NaiveDate::from_ymd_opt(2026, 9, 5).unwrap()
        );
        assert!(september_due_date < moved_august_due_date);
    }

    #[test]
    fn russian_summary_is_bounded_and_contains_branch_context() {
        let rows = vec![OverdueRow {
            child_name: "Маша".to_owned(),
            family_name: "Семья Ивановых".to_owned(),
            group_name: "Рисование".to_owned(),
            branch_name: "Курская".to_owned(),
            amount_minor: 600_000,
            currency: "RUB".to_owned(),
            due_date: NaiveDate::from_ymd_opt(2026, 8, 5).unwrap(),
        }];
        let summary = format_summary(
            "ru-RU",
            NaiveDate::from_ymd_opt(2026, 8, 18).unwrap(),
            &rows,
        );
        assert!(summary.contains("#Курская"));
        assert!(summary.contains("6 000,00 ₽"));
        assert!(summary.contains("05.08.2026"));
    }

    #[test]
    fn empty_summary_closes_the_previous_overdue_state() {
        let summary = format_summary("en-US", NaiveDate::from_ymd_opt(2026, 8, 18).unwrap(), &[]);
        assert!(summary.contains("no overdue payments"));
    }

    #[test]
    fn overdue_digest_changes_with_the_queue_not_the_polling_date() {
        let row = OverdueRow {
            child_name: "Маша".to_owned(),
            family_name: "Ивановы".to_owned(),
            group_name: "Рисование".to_owned(),
            branch_name: "Курская".to_owned(),
            amount_minor: 600_000,
            currency: "RUB".to_owned(),
            due_date: NaiveDate::from_ymd_opt(2026, 8, 5).unwrap(),
        };
        assert_eq!(
            summary_digest(&[row]),
            summary_digest(&[OverdueRow {
                child_name: "Маша".to_owned(),
                family_name: "Ивановы".to_owned(),
                group_name: "Рисование".to_owned(),
                branch_name: "Курская".to_owned(),
                amount_minor: 600_000,
                currency: "RUB".to_owned(),
                due_date: NaiveDate::from_ymd_opt(2026, 8, 5).unwrap(),
            }])
        );
    }
}
