//! Tenant-scoped staff booking queue projection.
//!
//! This read model deliberately exposes current operational entities instead
//! of the immutable public applicant snapshot. Management credentials,
//! consent evidence, internal comments, and messenger provider identifiers are
//! outside the projection.

use airhop_core::BookingStatus;
use buzz_core::TenantContext;
use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use super::public_management::PublicTransferRequest;
use crate::{Db, DbError, Result};

/// Stable keyset after the last row returned to a staff client.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StaffBookingQueueCursor {
    /// Queue priority, lower values first.
    pub priority: i16,
    /// Last authoritative booking update instant.
    pub updated_at: DateTime<Utc>,
    /// UUID tiebreak for rows updated at the same instant.
    pub booking_id: Uuid,
}

/// Bounded filters for one staff queue page.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StaffBookingQueueFilter {
    /// Optional exact booking lifecycle filter.
    pub status: Option<BookingStatus>,
    /// When true, omit completed rows without another attention signal.
    pub attention_only: bool,
    /// Server-validated page size.
    pub limit: u16,
    /// Composite keyset supplied by the previous response.
    pub cursor: Option<StaffBookingQueueCursor>,
}

/// Why a booking is currently actionable in the staff queue.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StaffBookingAttentionReason {
    /// The center must confirm or reject the booking.
    PendingConfirmation,
    /// A parent requested a transfer that staff must resolve.
    TransferRequest,
    /// A duplicate candidate involving the representative or child is pending.
    PossibleDuplicate,
}

/// Minimal authoritative booking card needed by the staff inbox.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StaffBookingQueueRow {
    /// Booking aggregate identifier.
    pub booking_id: Uuid,
    /// Current booking lifecycle.
    pub status: BookingStatus,
    /// `trial` or `single`.
    pub visit_kind: String,
    /// Current parent transfer request.
    pub transfer_request: Option<PublicTransferRequest>,
    /// Stable lesson rule identifier.
    pub recurrence_rule_id: Uuid,
    /// Stable original occurrence date.
    pub original_date: NaiveDate,
    /// Family aggregate identifier.
    pub family_id: Uuid,
    /// Current family display name.
    pub family_name: String,
    /// Current representative identifier.
    pub representative_id: Uuid,
    /// Current representative display name.
    pub representative_name: String,
    /// E.164 contact used for staff search and calling.
    pub phone_normalized: String,
    /// Human-readable contact used by the queue card.
    pub phone_display: String,
    /// Current preferred service channel.
    pub preferred_contact_channel: String,
    /// Current child identifier.
    pub child_id: Uuid,
    /// Current child display name.
    pub child_name: String,
    /// Current child birth date.
    pub child_birth_date: NaiveDate,
    /// Materialized occurrence identifier.
    pub occurrence_id: Uuid,
    /// Effective local lesson date.
    pub lesson_date: NaiveDate,
    /// Effective local start time.
    pub start_time: NaiveTime,
    /// Effective local end time.
    pub end_time: NaiveTime,
    /// Current occurrence state, retained for historical queue cards.
    pub occurrence_status: String,
    /// Effective group identifier.
    pub group_id: Uuid,
    /// Effective group display name.
    pub group_name: String,
    /// Effective branch identifier.
    pub branch_id: Uuid,
    /// Effective branch display name.
    pub branch_name: String,
    /// Typed actionable signals used to order the queue.
    pub attention_reasons: Vec<StaffBookingAttentionReason>,
    /// Optimistic booking aggregate version.
    pub version: i64,
    /// Booking creation instant.
    pub created_at: DateTime<Utc>,
    /// Last authoritative booking update instant.
    pub updated_at: DateTime<Utc>,
    priority: i16,
}

/// One stable staff queue page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StaffBookingQueuePage {
    /// Rows in attention priority, then newest-update order.
    pub items: Vec<StaffBookingQueueRow>,
    /// Cursor for the next page, present only when another row exists.
    pub next_cursor: Option<StaffBookingQueueCursor>,
}

impl Db {
    /// Reads one authoritative request-workflow booking page for this tenant.
    pub async fn list_airhop_staff_booking_queue(
        &self,
        tenant: &TenantContext,
        filter: StaffBookingQueueFilter,
    ) -> Result<StaffBookingQueuePage> {
        validate_filter(filter)?;
        let (cursor_priority, cursor_updated_at, cursor_booking_id) = filter
            .cursor
            .map(|cursor| {
                (
                    Some(cursor.priority),
                    Some(cursor.updated_at),
                    Some(cursor.booking_id),
                )
            })
            .unwrap_or((None, None, None));
        let requested_status = filter.status.map(booking_status_str);
        let fetch_limit = i64::from(filter.limit) + 1;
        let rows = sqlx::query(
            r#"
            WITH queue_rows AS (
                SELECT booking.id AS booking_id, booking.status, booking.visit_kind,
                       booking.transfer_request, booking.recurrence_rule_id,
                       booking.original_date, booking.family_id,
                       family.display_name AS family_name,
                       booking.representative_id,
                       representative.display_name AS representative_name,
                       representative.phone_normalized, representative.phone_display,
                       representative.preferred_contact_channel, booking.child_id,
                       child.display_name AS child_name, child.birth_date AS child_birth_date,
                       occurrence.id AS occurrence_id,
                       occurrence.effective_date AS lesson_date,
                       occurrence.start_time, occurrence.end_time,
                       occurrence.status AS occurrence_status,
                       occurrence.group_id, group_row.name AS group_name,
                       occurrence.branch_id, branch.name AS branch_name,
                       booking.version, booking.created_at, booking.updated_at,
                       duplicate_signal.possible_duplicate,
                       CASE
                           WHEN booking.status = 'pending_confirmation' THEN 0
                           WHEN booking.transfer_request->>'status' = 'pending' THEN 1
                           WHEN duplicate_signal.possible_duplicate THEN 2
                           ELSE 3
                       END::SMALLINT AS priority
                FROM airhop_bookings booking
                JOIN airhop_organizations organization
                  ON organization.community_id = booking.community_id
                 AND organization.id = booking.organization_id
                 AND organization.status = 'active'
                JOIN airhop_families family
                  ON family.community_id = booking.community_id
                 AND family.organization_id = booking.organization_id
                 AND family.id = booking.family_id
                JOIN airhop_representatives representative
                  ON representative.community_id = booking.community_id
                 AND representative.organization_id = booking.organization_id
                 AND representative.id = booking.representative_id
                JOIN airhop_children child
                  ON child.community_id = booking.community_id
                 AND child.organization_id = booking.organization_id
                 AND child.id = booking.child_id
                JOIN airhop_lesson_occurrences occurrence
                  ON occurrence.community_id = booking.community_id
                 AND occurrence.organization_id = booking.organization_id
                 AND occurrence.recurrence_rule_id = booking.recurrence_rule_id
                 AND occurrence.original_date = booking.original_date
                JOIN airhop_groups group_row
                  ON group_row.community_id = occurrence.community_id
                 AND group_row.organization_id = occurrence.organization_id
                 AND group_row.id = occurrence.group_id
                JOIN airhop_branches branch
                  ON branch.community_id = occurrence.community_id
                 AND branch.organization_id = occurrence.organization_id
                 AND branch.id = occurrence.branch_id
                CROSS JOIN LATERAL (
                    SELECT EXISTS (
                        SELECT 1
                        FROM airhop_duplicate_candidates candidate
                        WHERE candidate.community_id = booking.community_id
                          AND candidate.organization_id = booking.organization_id
                          AND candidate.status = 'pending'
                          AND (
                              (candidate.new_entity_type = 'representative'
                               AND candidate.new_entity_id = booking.representative_id)
                              OR (candidate.existing_entity_type = 'representative'
                                  AND candidate.existing_entity_id = booking.representative_id)
                              OR (candidate.new_entity_type = 'child'
                                  AND candidate.new_entity_id = booking.child_id)
                              OR (candidate.existing_entity_type = 'child'
                                  AND candidate.existing_entity_id = booking.child_id)
                          )
                    ) AS possible_duplicate
                ) duplicate_signal
                WHERE booking.community_id = $1
                  AND booking.source->>'workflow' = 'request'
            )
            SELECT *
            FROM queue_rows
            WHERE ($2::TEXT IS NULL OR status = $2)
              AND (NOT $3::BOOLEAN OR priority < 3)
              AND (
                  $4::SMALLINT IS NULL
                  OR priority > $4
                  OR (priority = $4 AND (updated_at, booking_id) < ($5, $6))
              )
            ORDER BY priority ASC, updated_at DESC, booking_id DESC
            LIMIT $7
            "#,
        )
        .bind(tenant.community().as_uuid())
        .bind(requested_status)
        .bind(filter.attention_only)
        .bind(cursor_priority)
        .bind(cursor_updated_at)
        .bind(cursor_booking_id)
        .bind(fetch_limit)
        .fetch_all(&self.pool)
        .await?;

        let has_more = rows.len() > usize::from(filter.limit);
        let items = rows
            .into_iter()
            .take(usize::from(filter.limit))
            .map(parse_queue_row)
            .collect::<Result<Vec<_>>>()?;
        let next_cursor = if has_more {
            items.last().map(|row| StaffBookingQueueCursor {
                priority: row.priority,
                updated_at: row.updated_at,
                booking_id: row.booking_id,
            })
        } else {
            None
        };
        Ok(StaffBookingQueuePage { items, next_cursor })
    }
}

fn validate_filter(filter: StaffBookingQueueFilter) -> Result<()> {
    if !(1..=100).contains(&filter.limit) {
        return Err(DbError::InvalidData(
            "AirHub staff queue limit must be between 1 and 100".to_owned(),
        ));
    }
    if filter
        .cursor
        .is_some_and(|cursor| !(0..=3).contains(&cursor.priority))
    {
        return Err(DbError::InvalidData(
            "AirHub staff queue cursor priority is invalid".to_owned(),
        ));
    }
    Ok(())
}

fn parse_queue_row(row: sqlx::postgres::PgRow) -> Result<StaffBookingQueueRow> {
    let status = parse_booking_status(row.try_get("status")?)?;
    let transfer_request = row
        .try_get::<Option<serde_json::Value>, _>("transfer_request")?
        .map(serde_json::from_value)
        .transpose()?;
    let possible_duplicate: bool = row.try_get("possible_duplicate")?;
    let mut attention_reasons = Vec::with_capacity(3);
    if status == BookingStatus::PendingConfirmation {
        attention_reasons.push(StaffBookingAttentionReason::PendingConfirmation);
    }
    if transfer_request
        .as_ref()
        .is_some_and(|request: &PublicTransferRequest| request.status == "pending")
    {
        attention_reasons.push(StaffBookingAttentionReason::TransferRequest);
    }
    if possible_duplicate {
        attention_reasons.push(StaffBookingAttentionReason::PossibleDuplicate);
    }
    let visit_kind: String = row.try_get("visit_kind")?;
    if visit_kind != "trial" && visit_kind != "single" {
        return Err(DbError::InvalidData(format!(
            "unknown AirHub booking visit kind {visit_kind:?}"
        )));
    }
    let preferred_contact_channel: String = row.try_get("preferred_contact_channel")?;
    if !matches!(
        preferred_contact_channel.as_str(),
        "telegram" | "max" | "whatsapp" | "phone" | "none"
    ) {
        return Err(DbError::InvalidData(format!(
            "unknown AirHub contact channel {preferred_contact_channel:?}"
        )));
    }
    let occurrence_status: String = row.try_get("occurrence_status")?;
    if !matches!(
        occurrence_status.as_str(),
        "scheduled" | "moved" | "modified" | "cancelled"
    ) {
        return Err(DbError::InvalidData(format!(
            "unknown AirHub occurrence status {occurrence_status:?}"
        )));
    }
    Ok(StaffBookingQueueRow {
        booking_id: row.try_get("booking_id")?,
        status,
        visit_kind,
        transfer_request,
        recurrence_rule_id: row.try_get("recurrence_rule_id")?,
        original_date: row.try_get("original_date")?,
        family_id: row.try_get("family_id")?,
        family_name: row.try_get("family_name")?,
        representative_id: row.try_get("representative_id")?,
        representative_name: row.try_get("representative_name")?,
        phone_normalized: row.try_get("phone_normalized")?,
        phone_display: row.try_get("phone_display")?,
        preferred_contact_channel,
        child_id: row.try_get("child_id")?,
        child_name: row.try_get("child_name")?,
        child_birth_date: row.try_get("child_birth_date")?,
        occurrence_id: row.try_get("occurrence_id")?,
        lesson_date: row.try_get("lesson_date")?,
        start_time: row.try_get("start_time")?,
        end_time: row.try_get("end_time")?,
        occurrence_status,
        group_id: row.try_get("group_id")?,
        group_name: row.try_get("group_name")?,
        branch_id: row.try_get("branch_id")?,
        branch_name: row.try_get("branch_name")?,
        attention_reasons,
        version: row.try_get("version")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
        priority: row.try_get("priority")?,
    })
}

const fn booking_status_str(status: BookingStatus) -> &'static str {
    match status {
        BookingStatus::PendingConfirmation => "pending_confirmation",
        BookingStatus::Confirmed => "confirmed",
        BookingStatus::Rejected => "rejected",
        BookingStatus::CancelledByParent => "cancelled_by_parent",
        BookingStatus::CancelledByCenter => "cancelled_by_center",
    }
}

fn parse_booking_status(value: &str) -> Result<BookingStatus> {
    match value {
        "pending_confirmation" => Ok(BookingStatus::PendingConfirmation),
        "confirmed" => Ok(BookingStatus::Confirmed),
        "rejected" => Ok(BookingStatus::Rejected),
        "cancelled_by_parent" => Ok(BookingStatus::CancelledByParent),
        "cancelled_by_center" => Ok(BookingStatus::CancelledByCenter),
        other => Err(DbError::InvalidData(format!(
            "unknown AirHub booking status {other:?}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::CommunityId;
    use chrono::TimeZone;
    use serde_json::json;

    use crate::DbConfig;

    #[test]
    fn queue_bounds_are_enforced_below_the_http_boundary() {
        let base = StaffBookingQueueFilter {
            status: None,
            attention_only: false,
            limit: 50,
            cursor: None,
        };
        assert!(validate_filter(base).is_ok());
        assert!(validate_filter(StaffBookingQueueFilter { limit: 0, ..base }).is_err());
        assert!(validate_filter(StaffBookingQueueFilter { limit: 101, ..base }).is_err());
        assert!(validate_filter(StaffBookingQueueFilter {
            cursor: Some(StaffBookingQueueCursor {
                priority: 4,
                updated_at: Utc::now(),
                booking_id: Uuid::new_v4(),
            }),
            ..base
        })
        .is_err());
    }

    #[test]
    fn every_booking_status_has_a_stable_database_value() {
        for status in [
            BookingStatus::PendingConfirmation,
            BookingStatus::Confirmed,
            BookingStatus::Rejected,
            BookingStatus::CancelledByParent,
            BookingStatus::CancelledByCenter,
        ] {
            assert_eq!(
                parse_booking_status(booking_status_str(status)).unwrap(),
                status
            );
        }
    }

    #[tokio::test]
    #[ignore = "requires a dedicated migrated Postgres database"]
    async fn staff_queue_is_tenant_scoped_prioritized_and_cursor_safe() {
        let database_url = std::env::var("BUZZ_TEST_DATABASE_URL")
            .expect("BUZZ_TEST_DATABASE_URL must point to a dedicated migrated database");
        let db = Db::new(&DbConfig {
            database_url,
            max_connections: 5,
            min_connections: 0,
            ..DbConfig::default()
        })
        .await
        .expect("connect test database");
        db.migrate().await.expect("migrate test database");
        let community_a = Uuid::new_v4();
        let organization_a = Uuid::new_v4();
        let community_b = Uuid::new_v4();
        let organization_b = Uuid::new_v4();
        let tenant_a = tenant(community_a, "queue-a.test");
        let tenant_b = tenant(community_b, "queue-b.test");
        let schedule_a = insert_organization_schedule(&db, community_a, organization_a, "a").await;
        let schedule_b = insert_organization_schedule(&db, community_b, organization_b, "b").await;
        let base_time = Utc
            .with_ymd_and_hms(2026, 8, 16, 8, 0, 0)
            .single()
            .expect("valid timestamp");

        let pending = insert_booking_fixture(
            &db,
            community_a,
            organization_a,
            &schedule_a,
            1,
            "request",
            "pending_confirmation",
            None,
            false,
            base_time,
        )
        .await;
        let transfer = insert_booking_fixture(
            &db,
            community_a,
            organization_a,
            &schedule_a,
            2,
            "request",
            "confirmed",
            Some(json!({
                "status": "pending",
                "requestedAt": "2026-08-16T08:01:00Z",
                "comment": "Позже"
            })),
            false,
            base_time + chrono::Duration::minutes(1),
        )
        .await;
        let duplicate = insert_booking_fixture(
            &db,
            community_a,
            organization_a,
            &schedule_a,
            3,
            "request",
            "rejected",
            None,
            true,
            base_time + chrono::Duration::minutes(2),
        )
        .await;
        let completed = insert_booking_fixture(
            &db,
            community_a,
            organization_a,
            &schedule_a,
            4,
            "request",
            "rejected",
            None,
            false,
            base_time + chrono::Duration::minutes(3),
        )
        .await;
        insert_booking_fixture(
            &db,
            community_a,
            organization_a,
            &schedule_a,
            5,
            "direct",
            "pending_confirmation",
            None,
            false,
            base_time + chrono::Duration::minutes(4),
        )
        .await;
        insert_booking_fixture(
            &db,
            community_b,
            organization_b,
            &schedule_b,
            6,
            "request",
            "pending_confirmation",
            None,
            false,
            base_time + chrono::Duration::minutes(5),
        )
        .await;

        let first = db
            .list_airhop_staff_booking_queue(
                &tenant_a,
                StaffBookingQueueFilter {
                    status: None,
                    attention_only: false,
                    limit: 2,
                    cursor: None,
                },
            )
            .await
            .expect("first page");
        assert_eq!(
            first
                .items
                .iter()
                .map(|row| row.booking_id)
                .collect::<Vec<_>>(),
            vec![pending, transfer]
        );
        assert_eq!(first.items[0].priority, 0);
        assert_eq!(first.items[1].priority, 1);
        let second = db
            .list_airhop_staff_booking_queue(
                &tenant_a,
                StaffBookingQueueFilter {
                    status: None,
                    attention_only: false,
                    limit: 2,
                    cursor: first.next_cursor,
                },
            )
            .await
            .expect("second page");
        assert_eq!(
            second
                .items
                .iter()
                .map(|row| row.booking_id)
                .collect::<Vec<_>>(),
            vec![duplicate, completed]
        );
        assert!(second.next_cursor.is_none());

        let attention = db
            .list_airhop_staff_booking_queue(
                &tenant_a,
                StaffBookingQueueFilter {
                    status: None,
                    attention_only: true,
                    limit: 100,
                    cursor: None,
                },
            )
            .await
            .expect("attention page");
        assert_eq!(attention.items.len(), 3);
        assert_eq!(
            attention.items[2].attention_reasons,
            vec![StaffBookingAttentionReason::PossibleDuplicate]
        );

        let tenant_b_page = db
            .list_airhop_staff_booking_queue(
                &tenant_b,
                StaffBookingQueueFilter {
                    status: None,
                    attention_only: false,
                    limit: 100,
                    cursor: None,
                },
            )
            .await
            .expect("other tenant page");
        assert_eq!(tenant_b_page.items.len(), 1);
        assert!(tenant_b_page
            .items
            .iter()
            .all(|row| ![pending, transfer, duplicate, completed].contains(&row.booking_id)));
    }

    #[derive(Debug)]
    struct ScheduleFixture {
        branch_id: Uuid,
        group_id: Uuid,
        recurrence_rule_id: Uuid,
    }

    fn tenant(community_id: Uuid, host: &str) -> TenantContext {
        TenantContext::resolved(CommunityId::from_uuid(community_id), host.to_owned())
    }

    async fn insert_organization_schedule(
        db: &Db,
        community_id: Uuid,
        organization_id: Uuid,
        suffix: &str,
    ) -> ScheduleFixture {
        let branch_id = Uuid::new_v4();
        let group_id = Uuid::new_v4();
        let recurrence_rule_id = Uuid::new_v4();
        sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
            .bind(community_id)
            .bind(format!("queue-{suffix}.test"))
            .execute(&db.pool)
            .await
            .expect("insert community");
        sqlx::query(
            "INSERT INTO airhop_organizations (\
                 community_id, id, name, locale, time_zone, default_trial_policy\
             ) VALUES ($1, $2, $3, 'ru-RU', 'UTC', $4)",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(format!("Center {suffix}"))
        .bind(json!({"mode": "free"}))
        .execute(&db.pool)
        .await
        .expect("insert organization");
        sqlx::query(
            "INSERT INTO airhop_branches (community_id, organization_id, id, name, address) \
             VALUES ($1, $2, $3, 'Сокол', 'Адрес')",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(branch_id)
        .execute(&db.pool)
        .await
        .expect("insert branch");
        sqlx::query(
            "INSERT INTO airhop_groups (community_id, organization_id, id, branch_id, name) \
             VALUES ($1, $2, $3, $4, 'Football 6-7')",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(group_id)
        .bind(branch_id)
        .execute(&db.pool)
        .await
        .expect("insert group");
        sqlx::query(
            "INSERT INTO airhop_recurrence_rules (\
                 community_id, organization_id, id, group_id, starts_on, ends_on, \
                 start_time, end_time\
             ) VALUES ($1, $2, $3, $4, '2026-08-20', '2026-08-31', '10:00', '11:00')",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(recurrence_rule_id)
        .bind(group_id)
        .execute(&db.pool)
        .await
        .expect("insert recurrence rule");
        ScheduleFixture {
            branch_id,
            group_id,
            recurrence_rule_id,
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn insert_booking_fixture(
        db: &Db,
        community_id: Uuid,
        organization_id: Uuid,
        schedule: &ScheduleFixture,
        seed: u8,
        workflow: &str,
        status: &str,
        transfer_request: Option<serde_json::Value>,
        duplicate: bool,
        updated_at: DateTime<Utc>,
    ) -> Uuid {
        let booking_id = Uuid::new_v4();
        let occurrence_id = Uuid::new_v4();
        let family_id = Uuid::new_v4();
        let representative_id = Uuid::new_v4();
        let child_id = Uuid::new_v4();
        let consent_id = Uuid::new_v4();
        let command_id = Uuid::new_v4();
        let date = NaiveDate::from_ymd_opt(2026, 8, 19 + u32::from(seed)).expect("fixture date");
        let mut transaction = db.pool.begin().await.expect("begin fixture");
        sqlx::query(
            "INSERT INTO airhop_lesson_occurrences (\
                 community_id, organization_id, id, recurrence_rule_id, original_date, \
                 group_id, branch_id, original_start_time, original_end_time, \
                 effective_date, start_time, end_time, starts_at, ends_at, time_zone, \
                 trial_policy, allow_single_visits, track_attendance, status, \
                 source_rule_version\
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, '10:00', '11:00', $5, \
                       '10:00', '11:00', $8, $9, 'UTC', $10, FALSE, TRUE, \
                       'scheduled', 1)",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(occurrence_id)
        .bind(schedule.recurrence_rule_id)
        .bind(date)
        .bind(schedule.group_id)
        .bind(schedule.branch_id)
        .bind(date.and_hms_opt(10, 0, 0).expect("start").and_utc())
        .bind(date.and_hms_opt(11, 0, 0).expect("end").and_utc())
        .bind(json!({"mode": "free"}))
        .execute(&mut *transaction)
        .await
        .expect("insert occurrence");
        sqlx::query(
            "INSERT INTO airhop_families (\
                 community_id, organization_id, id, display_name, primary_representative_id\
             ) VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(family_id)
        .bind(format!("Семья {seed}"))
        .bind(representative_id)
        .execute(&mut *transaction)
        .await
        .expect("insert family");
        sqlx::query(
            "INSERT INTO airhop_representatives (\
                 community_id, organization_id, id, family_id, display_name, \
                 phone_normalized, phone_display, phone_match_digest\
             ) VALUES ($1, $2, $3, $4, $5, $6, $6, $7)",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(representative_id)
        .bind(family_id)
        .bind(format!("Родитель {seed}"))
        .bind(format!("+799900000{seed:02}"))
        .bind(vec![seed; 32])
        .execute(&mut *transaction)
        .await
        .expect("insert representative");
        sqlx::query(
            "INSERT INTO airhop_children (\
                 community_id, organization_id, id, family_id, display_name, birth_date\
             ) VALUES ($1, $2, $3, $4, $5, '2019-05-20')",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(child_id)
        .bind(family_id)
        .bind(format!("Ребёнок {seed}"))
        .execute(&mut *transaction)
        .await
        .expect("insert child");
        sqlx::query(
            "INSERT INTO airhop_consents (\
                 community_id, organization_id, id, representative_id, purpose, channel, \
                 policy_version, status, effective_at\
             ) VALUES ($1, $2, $3, $4, 'public_booking', 'web', 'v1', 'granted', $5)",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(consent_id)
        .bind(representative_id)
        .bind(updated_at)
        .execute(&mut *transaction)
        .await
        .expect("insert consent");
        sqlx::query(
            "INSERT INTO airhop_commands (\
                 community_id, organization_id, id, command_type, idempotency_digest, \
                 request_hash, actor_kind, correlation_id, status, result, finished_at\
             ) VALUES ($1, $2, $3, 'Fixture', $4, $5, 'public', $6, \
                       'committed', '{}'::jsonb, $7)",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(command_id)
        .bind(vec![seed; 32])
        .bind(vec![seed.saturating_add(20); 32])
        .bind(Uuid::new_v4())
        .bind(updated_at)
        .execute(&mut *transaction)
        .await
        .expect("insert command");
        sqlx::query(
            "INSERT INTO airhop_bookings (\
                 community_id, organization_id, id, family_id, representative_id, child_id, \
                 consent_id, recurrence_rule_id, original_date, command_id, \
                 applicant_snapshot, visit_kind, status, transfer_request, \
                 management_token_digest, management_key_version, source, actor_kind, \
                 created_by, created_at, updated_at\
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'trial', $12, \
                       $13, $14, 1, $15, 'public', 'fixture', $16, $16)",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(booking_id)
        .bind(family_id)
        .bind(representative_id)
        .bind(child_id)
        .bind(consent_id)
        .bind(schedule.recurrence_rule_id)
        .bind(date)
        .bind(command_id)
        .bind(json!({"childName": format!("Ребёнок {seed}")}))
        .bind(status)
        .bind(transfer_request)
        .bind(vec![seed.saturating_add(40); 32])
        .bind(json!({"workflow": workflow}))
        .bind(updated_at)
        .execute(&mut *transaction)
        .await
        .expect("insert booking");
        if duplicate {
            sqlx::query(
                "INSERT INTO airhop_duplicate_candidates (\
                     community_id, organization_id, new_entity_type, new_entity_id, \
                     existing_entity_type, existing_entity_id, signals\
                 ) VALUES ($1, $2, 'child', $3, 'child', $4, ARRAY['name_and_birth_date'])",
            )
            .bind(community_id)
            .bind(organization_id)
            .bind(child_id)
            .bind(Uuid::new_v4())
            .execute(&mut *transaction)
            .await
            .expect("insert duplicate candidate");
        }
        transaction.commit().await.expect("commit fixture");
        booking_id
    }
}
