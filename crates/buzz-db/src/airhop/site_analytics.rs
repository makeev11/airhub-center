//! First-party site analytics, booking attribution, and tracked links.

use buzz_core::TenantContext;
use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use super::{
    append_domain_event, commit_command, insert_pending_command, ActorKind, AirhopActor,
    AirhopCommand, CommandInsertOutcome, CommandStatus, NewAirhopCommand, NewDomainEvent,
    PrivacyClass,
};
use crate::{Db, DbError, Result};

const CREATE_LINK_COMMAND_TYPE: &str = "CreateTrackingLink";
const CREATE_LINK_EVENT_TYPE: &str = "airhop.tracking-link.created.v1";
const MIN_ANALYTICS_DAYS: u16 = 1;
const MAX_ANALYTICS_DAYS: u16 = 366;

#[cfg(test)]
mod integration_tests;

/// Closed event vocabulary accepted by the anonymous analytics boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SiteAnalyticsEventType {
    /// One public site route was displayed.
    SitePageView,
    /// A phone, email, or messenger call-to-action was activated.
    ContactClick,
    /// One public booking journey was opened.
    BookingOpened,
    /// One booking step became visible.
    BookingStepViewed,
    /// One booking step was validly completed.
    BookingStepCompleted,
    /// The final booking submit action was activated.
    BookingSubmit,
    /// Booking Core committed a new booking.
    BookingCreated,
    /// A server-owned tracked link was opened.
    TrackingLinkOpen,
}

impl SiteAnalyticsEventType {
    const fn as_str(self) -> &'static str {
        match self {
            Self::SitePageView => "site_page_view",
            Self::ContactClick => "contact_click",
            Self::BookingOpened => "booking_opened",
            Self::BookingStepViewed => "booking_step_viewed",
            Self::BookingStepCompleted => "booking_step_completed",
            Self::BookingSubmit => "booking_submit",
            Self::BookingCreated => "booking_created",
            Self::TrackingLinkOpen => "tracking_link_open",
        }
    }
}

/// Stable booking step names used by the public flow funnel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SiteAnalyticsStep {
    /// Branch and child age.
    Basics,
    /// Program or group.
    Groups,
    /// Concrete date and time.
    Occurrences,
    /// Parent and child contact form.
    Contact,
    /// Final booking review.
    Preview,
}

impl SiteAnalyticsStep {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Basics => "basics",
            Self::Groups => "groups",
            Self::Occurrences => "occurrences",
            Self::Contact => "contact",
            Self::Preview => "preview",
        }
    }
}

/// Public contact destination. A click is not treated as a confirmed contact.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SiteAnalyticsTarget {
    /// Telephone link.
    Phone,
    /// Email link.
    Email,
    /// Telegram link.
    Telegram,
    /// WhatsApp link.
    Whatsapp,
    /// MAX link.
    Max,
    /// Another explicitly instrumented contact link.
    Other,
}

impl SiteAnalyticsTarget {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Phone => "phone",
            Self::Email => "email",
            Self::Telegram => "telegram",
            Self::Whatsapp => "whatsapp",
            Self::Max => "max",
            Self::Other => "other",
        }
    }
}

/// One validated and privacy-reduced browser event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordSiteAnalyticsEventInput {
    /// Caller-generated idempotency identity.
    pub event_id: Uuid,
    /// Closed event type.
    pub event_type: SiteAnalyticsEventType,
    /// Client occurrence time after route-level clock validation.
    pub occurred_at: DateTime<Utc>,
    /// Tenant-keyed digest of a random first-party browser id.
    pub visitor_digest: Option<[u8; 32]>,
    /// Tenant-keyed digest of a random 30-minute session id.
    pub session_digest: Option<[u8; 32]>,
    /// One attempt to complete the booking flow.
    pub journey_id: Option<Uuid>,
    /// Signed tracked-link attribution resolved from the request cookie.
    pub tracking_link_id: Option<Uuid>,
    /// Public branch context when known.
    pub branch_id: Option<Uuid>,
    /// Same-origin path without query or fragment.
    pub path: Option<String>,
    /// Normalized hostname only.
    pub referrer_host: Option<String>,
    /// Normalized source for non-tracked-link traffic.
    pub source: Option<String>,
    /// Bounded campaign label.
    pub campaign: Option<String>,
    /// Booking step for step events.
    pub step: Option<SiteAnalyticsStep>,
    /// Contact target for contact-click events.
    pub target: Option<SiteAnalyticsTarget>,
}

/// Privacy-safe attribution carried from the public boundary into Booking Core.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BookingAnalyticsAttribution {
    /// Tenant-keyed first-party browser digest.
    pub visitor_digest: [u8; 32],
    /// Tenant-keyed session digest.
    pub session_digest: [u8; 32],
    /// Public booking journey id.
    pub journey_id: Uuid,
    /// Signed tracked-link attribution when present.
    pub tracking_link_id: Option<Uuid>,
    /// Non-link traffic source.
    pub source: Option<String>,
    /// Optional campaign label.
    pub campaign: Option<String>,
    /// Normalized referring hostname.
    pub referrer_host: Option<String>,
}

pub(super) struct BookingCreatedAnalyticsInput<'a> {
    pub organization_id: Uuid,
    pub booking_id: Uuid,
    pub recurrence_rule_id: Uuid,
    pub original_date: NaiveDate,
    pub occurred_at: DateTime<Utc>,
    pub attribution: Option<&'a BookingAnalyticsAttribution>,
}

/// Supported tracked-link sources.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrackingLinkSource {
    /// Yandex Maps organization card.
    YandexMaps,
    /// Google Maps business profile.
    GoogleMaps,
    /// 2GIS organization card.
    TwoGis,
    /// Printed or displayed QR code.
    Qr,
    /// Named marketing campaign.
    Campaign,
    /// Another explicit source.
    Custom,
}

impl TrackingLinkSource {
    const fn as_str(self) -> &'static str {
        match self {
            Self::YandexMaps => "yandex_maps",
            Self::GoogleMaps => "google_maps",
            Self::TwoGis => "two_gis",
            Self::Qr => "qr",
            Self::Campaign => "campaign",
            Self::Custom => "custom",
        }
    }

    const fn slug_prefix(self) -> &'static str {
        match self {
            Self::YandexMaps => "ym",
            Self::GoogleMaps => "gm",
            Self::TwoGis => "2g",
            Self::Qr => "qr",
            Self::Campaign => "cp",
            Self::Custom => "ln",
        }
    }

    fn from_db(value: &str) -> Result<Self> {
        match value {
            "yandex_maps" => Ok(Self::YandexMaps),
            "google_maps" => Ok(Self::GoogleMaps),
            "two_gis" => Ok(Self::TwoGis),
            "qr" => Ok(Self::Qr),
            "campaign" => Ok(Self::Campaign),
            "custom" => Ok(Self::Custom),
            other => Err(DbError::InvalidData(format!(
                "unknown AirHub tracking-link source {other:?}"
            ))),
        }
    }
}

/// Business goal assigned to a tracked link.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrackingLinkGoal {
    /// Land on the public site.
    Site,
    /// Open the booking flow.
    Booking,
    /// Reach a contact surface.
    Contact,
}

impl TrackingLinkGoal {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Site => "site",
            Self::Booking => "booking",
            Self::Contact => "contact",
        }
    }

    fn from_db(value: &str) -> Result<Self> {
        match value {
            "site" => Ok(Self::Site),
            "booking" => Ok(Self::Booking),
            "contact" => Ok(Self::Contact),
            other => Err(DbError::InvalidData(format!(
                "unknown AirHub tracking-link goal {other:?}"
            ))),
        }
    }
}

/// Lifecycle of a tracked link.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TrackingLinkStatus {
    /// Redirect and attribution are active.
    Active,
    /// Retained for historical analytics but no longer used.
    Archived,
}

impl TrackingLinkStatus {
    fn from_db(value: &str) -> Result<Self> {
        match value {
            "active" => Ok(Self::Active),
            "archived" => Ok(Self::Archived),
            other => Err(DbError::InvalidData(format!(
                "unknown AirHub tracking-link status {other:?}"
            ))),
        }
    }
}

/// Server-owned tracked redirect and its reconciled outcome counts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackingLink {
    /// Stable server id.
    pub id: Uuid,
    /// Public redirect slug.
    pub slug: String,
    /// Staff-facing label.
    pub name: String,
    /// Acquisition source.
    pub source: TrackingLinkSource,
    /// Intended goal.
    pub goal: TrackingLinkGoal,
    /// Validated same-origin destination.
    pub destination_path: String,
    /// Optional branch context.
    pub branch_id: Option<Uuid>,
    /// Current lifecycle.
    pub status: TrackingLinkStatus,
    /// Optimistic version.
    pub version: i64,
    /// Server-observed opens within the retained 13-month history.
    pub open_count: i64,
    /// Booking Core conversions within the retained 13-month history.
    pub booking_count: i64,
    /// Contact clicks within the retained 13-month history.
    pub contact_click_count: i64,
    /// Creation instant.
    pub created_at: DateTime<Utc>,
}

/// Idempotent staff input for one automatically generated link.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateTrackingLinkInput {
    /// Staff-facing label.
    pub name: String,
    /// Acquisition source.
    pub source: TrackingLinkSource,
    /// Intended goal.
    pub goal: TrackingLinkGoal,
    /// Same-origin redirect destination.
    pub destination_path: String,
    /// Optional branch context.
    pub branch_id: Option<Uuid>,
    /// Keyed HTTP idempotency digest.
    pub idempotency_digest: [u8; 32],
    /// Canonical request hash.
    pub request_hash: [u8; 32],
    /// Verified staff actor.
    pub actor: AirhopActor,
}

/// Result of creating or replaying a tracked-link command.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CreateTrackingLinkOutcome {
    /// Created link identity.
    pub link_id: Uuid,
    /// Optimistic version.
    pub version: i64,
    /// Whether an existing command result was replayed.
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredCreateTrackingLinkResult {
    link_id: Uuid,
    version: i64,
}

/// Summary KPI cards for a selected local-date period.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteAnalyticsTotals {
    /// Distinct first-party browser ids observed in the period.
    pub visitors: i64,
    /// Distinct 30-minute sessions observed in the period.
    pub sessions: i64,
    /// Observed route views, including repeat visits.
    pub page_views: i64,
    /// Distinct booking journeys opened in the period.
    pub booking_opens: i64,
    /// Server-committed bookings in the period.
    pub bookings_created: i64,
    /// Contact CTA clicks in the period.
    pub contact_clicks: i64,
    /// Attributed created journeys divided by opened journeys, in basis points.
    pub booking_conversion_bps: Option<i32>,
}

/// One organization-local calendar day in the trend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteAnalyticsDay {
    /// Local date.
    pub date: NaiveDate,
    /// Distinct visitors observed that day.
    pub visitors: i64,
    /// Distinct sessions observed that day.
    pub sessions: i64,
    /// Server-created bookings that day.
    pub bookings_created: i64,
    /// Contact CTA clicks that day.
    pub contact_clicks: i64,
}

/// Distinct booking journeys reaching each funnel step.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteAnalyticsFunnel {
    /// Booking flow opened.
    pub opened: i64,
    /// Branch and age completed.
    pub basics_completed: i64,
    /// Group completed.
    pub groups_completed: i64,
    /// Date/time completed.
    pub occurrences_completed: i64,
    /// Contact form completed.
    pub contact_completed: i64,
    /// Preview reached and completed.
    pub preview_completed: i64,
    /// Final submit activated.
    pub submitted: i64,
    /// Booking Core committed a booking.
    pub created: i64,
}

/// Source-level acquisition and outcome breakdown.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteAnalyticsSource {
    /// Normalized source key.
    pub source: String,
    /// Distinct sessions carrying this source.
    pub sessions: i64,
    /// Tracked redirect opens.
    pub tracked_link_opens: i64,
    /// Server-created bookings.
    pub bookings_created: i64,
    /// Contact CTA clicks.
    pub contact_clicks: i64,
}

/// Sessions with a page view in the period and their observed outcomes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteSessionFunnel {
    /// Sessions with an observed page view.
    pub viewed_sessions: i64,
    /// Viewed sessions that opened booking.
    pub booking_sessions: i64,
    /// Viewed sessions that activated a contact link.
    pub contact_sessions: i64,
    /// Viewed sessions with a server-created booking.
    pub booked_sessions: i64,
}

/// Per-path activity without queries or fragments.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteAnalyticsPage {
    /// Privacy-reduced page path.
    pub path: String,
    /// Route views.
    pub views: i64,
    /// Contact clicks on this page.
    pub contact_clicks: i64,
}

/// Contact destination totals; a click does not confirm contact.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SiteAnalyticsContact {
    /// Closed destination type.
    pub target: SiteAnalyticsTarget,
    /// Observed clicks.
    pub clicks: i64,
}

/// Server-authoritative site analytics report from a single database snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffSiteAnalytics {
    /// First included organization-local date.
    pub period_start: NaiveDate,
    /// Last included organization-local date.
    pub as_of_date: NaiveDate,
    /// Snapshot timestamp; the current day is partial.
    pub generated_at: DateTime<Utc>,
    /// Organization timezone used for calendar boundaries.
    pub time_zone: String,
    /// Earliest event still available after retention, not installation time.
    pub first_event_at: Option<DateTime<Utc>>,
    /// Latest stored event, or none when nothing has been collected.
    pub last_event_at: Option<DateTime<Utc>>,
    /// KPI totals.
    pub totals: SiteAnalyticsTotals,
    /// Gap-filled local daily trend.
    pub days: Vec<SiteAnalyticsDay>,
    /// Booking-journey funnel.
    pub funnel: SiteAnalyticsFunnel,
    /// Acquisition source breakdown.
    pub sources: Vec<SiteAnalyticsSource>,
    /// Whether source rows were capped at the first 100.
    pub sources_truncated: bool,
    /// Session-based site funnel, separate from booking attempts.
    pub site_funnel: SiteSessionFunnel,
    /// Top 100 paths by views.
    pub pages: Vec<SiteAnalyticsPage>,
    /// Whether more page rows exist than are returned.
    pub pages_truncated: bool,
    /// All observed contact destination types.
    pub contacts: Vec<SiteAnalyticsContact>,
}

impl Db {
    /// Inserts a bounded batch of privacy-reduced public events idempotently.
    pub async fn record_airhop_site_analytics_events(
        &self,
        tenant: &TenantContext,
        events: &[RecordSiteAnalyticsEventInput],
    ) -> Result<u64> {
        if events.is_empty() || events.len() > 20 {
            return Err(DbError::InvalidData(
                "AirHub analytics event batch must contain 1 to 20 events".to_owned(),
            ));
        }
        for event in events {
            validate_public_event(event)?;
        }
        let mut transaction = self.pool.begin().await?;
        let organization_id = resolve_active_organization(&mut *transaction, tenant).await?;
        let mut branches = std::collections::HashSet::new();
        let mut links = std::collections::HashSet::new();
        for event in events {
            if branches.insert(event.branch_id) {
                validate_optional_branch(
                    &mut *transaction,
                    tenant,
                    organization_id,
                    event.branch_id,
                )
                .await?;
            }
            if links.insert(event.tracking_link_id) {
                validate_optional_link(
                    &mut *transaction,
                    tenant,
                    organization_id,
                    event.tracking_link_id,
                )
                .await?;
            }
        }
        let mut query = sqlx::QueryBuilder::<Postgres>::new(
            "INSERT INTO airhop_site_analytics_events (community_id, organization_id, event_id, event_type, occurred_at, visitor_digest, session_digest, journey_id, tracking_link_id, branch_id, path, referrer_host, source, campaign, step, target) ",
        );
        query.push_values(events, |mut row, event| {
            row.push_bind(tenant.community().as_uuid())
                .push_bind(organization_id)
                .push_bind(event.event_id)
                .push_bind(event.event_type.as_str())
                .push_bind(event.occurred_at)
                .push_bind(event.visitor_digest.map(Vec::from))
                .push_bind(event.session_digest.map(Vec::from))
                .push_bind(event.journey_id)
                .push_bind(event.tracking_link_id)
                .push_bind(event.branch_id)
                .push_bind(event.path.as_deref())
                .push_bind(event.referrer_host.as_deref())
                .push_bind(event.source.as_deref())
                .push_bind(event.campaign.as_deref())
                .push_bind(event.step.map(SiteAnalyticsStep::as_str))
                .push_bind(event.target.map(SiteAnalyticsTarget::as_str));
        });
        query.push(" ON CONFLICT (community_id, event_id) DO NOTHING");
        let inserted = query
            .build()
            .execute(&mut *transaction)
            .await?
            .rows_affected();
        transaction.commit().await?;
        Ok(inserted)
    }

    /// Resolves and records a public tracked-link redirect atomically.
    pub async fn open_airhop_tracking_link(
        &self,
        tenant: &TenantContext,
        slug: &str,
    ) -> Result<TrackingLink> {
        let mut transaction = self.pool.begin().await?;
        let organization_id = resolve_active_organization(&mut *transaction, tenant).await?;
        let row = sqlx::query(
            "SELECT id, slug, name, source, goal, destination_path, branch_id, status, \
                    version, created_at \
             FROM airhop_tracking_links \
             WHERE community_id = $1 AND organization_id = $2 AND slug = $3 \
               AND status = 'active' \
             FOR SHARE",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(slug)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| DbError::NotFound("active AirHub tracking link".to_owned()))?;
        let link = parse_link_row(row, 0, 0, 0)?;
        sqlx::query("SAVEPOINT analytics_open")
            .execute(&mut *transaction)
            .await?;
        let recorded = sqlx::query(
            "INSERT INTO airhop_site_analytics_events (\
                 community_id, organization_id, event_id, event_type, occurred_at, \
                 tracking_link_id, branch_id, path, source\
             ) VALUES ($1, $2, $3, 'tracking_link_open', now(), $4, $5, $6, $7)",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(Uuid::new_v4())
        .bind(link.id)
        .bind(link.branch_id)
        .bind(&link.destination_path)
        .bind(link.source.as_str())
        .execute(&mut *transaction)
        .await;
        if let Err(error) = recorded {
            sqlx::query("ROLLBACK TO SAVEPOINT analytics_open")
                .execute(&mut *transaction)
                .await?;
            tracing::warn!(%error, "tracked link redirect preserved after analytics write failure");
        }
        transaction.commit().await?;
        Ok(link)
    }

    /// Lists links with outcomes reconciled from the retained raw-event history.
    pub async fn list_airhop_tracking_links(
        &self,
        tenant: &TenantContext,
    ) -> Result<Vec<TrackingLink>> {
        let organization_id = resolve_active_organization(&self.pool, tenant).await?;
        let rows = sqlx::query(
            "SELECT link.id, link.slug, link.name, link.source, link.goal, \
                    link.destination_path, link.branch_id, link.status, link.version, \
                    link.created_at, \
                    COUNT(event.event_id) FILTER (WHERE event.event_type = 'tracking_link_open')::BIGINT AS open_count, \
                    COUNT(DISTINCT event.booking_id) FILTER (WHERE event.event_type = 'booking_created')::BIGINT AS booking_count, \
                    COUNT(event.event_id) FILTER (WHERE event.event_type = 'contact_click')::BIGINT AS contact_click_count \
             FROM airhop_tracking_links link \
             LEFT JOIN airhop_site_analytics_events event \
               ON event.community_id = link.community_id \
              AND event.organization_id = link.organization_id \
              AND event.tracking_link_id = link.id \
             WHERE link.community_id = $1 AND link.organization_id = $2 \
             GROUP BY link.community_id, link.organization_id, link.id \
             ORDER BY CASE link.status WHEN 'active' THEN 0 ELSE 1 END, link.created_at DESC, link.id",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                let opens = row.try_get("open_count")?;
                let bookings = row.try_get("booking_count")?;
                let contacts = row.try_get("contact_click_count")?;
                parse_link_row(row, opens, bookings, contacts)
            })
            .collect()
    }

    /// Creates one audited, idempotent tracked link.
    pub async fn create_airhop_tracking_link(
        &self,
        tenant: &TenantContext,
        input: &CreateTrackingLinkInput,
    ) -> Result<CreateTrackingLinkOutcome> {
        validate_create_link(input)?;
        let mut transaction = self.pool.begin().await?;
        let organization_id = resolve_active_organization(&mut *transaction, tenant).await?;
        validate_optional_branch(&mut *transaction, tenant, organization_id, input.branch_id)
            .await?;
        let command = match insert_pending_command(
            &mut transaction,
            tenant,
            &NewAirhopCommand {
                id: Uuid::new_v4(),
                organization_id,
                command_type: CREATE_LINK_COMMAND_TYPE.to_owned(),
                idempotency_digest: input.idempotency_digest,
                request_hash: input.request_hash,
                actor: input.actor.clone(),
                correlation_id: Uuid::new_v4(),
            },
        )
        .await?
        {
            CommandInsertOutcome::Inserted(command) => command,
            CommandInsertOutcome::Existing(command) => {
                return replay_create_link(transaction, command).await;
            }
        };
        let link_id = Uuid::new_v4();
        let suffix = link_id.simple().to_string();
        let slug = format!("{}-{}", input.source.slug_prefix(), &suffix[..12]);
        let occurred_at: DateTime<Utc> = sqlx::query_scalar("SELECT now()")
            .fetch_one(&mut *transaction)
            .await?;
        sqlx::query(
            "INSERT INTO airhop_tracking_links (\
                 community_id, organization_id, id, slug, name, source, goal, \
                 destination_path, branch_id, created_at, updated_at\
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(link_id)
        .bind(&slug)
        .bind(input.name.trim())
        .bind(input.source.as_str())
        .bind(input.goal.as_str())
        .bind(input.destination_path.trim())
        .bind(input.branch_id)
        .bind(occurred_at)
        .execute(&mut *transaction)
        .await?;
        append_domain_event(
            &mut transaction,
            tenant,
            &NewDomainEvent {
                id: Uuid::new_v4(),
                organization_id,
                stream_type: "tracking_link".to_owned(),
                stream_id: link_id,
                stream_version: 1,
                event_type: CREATE_LINK_EVENT_TYPE.to_owned(),
                schema_version: 1,
                occurred_at,
                actor: input.actor.clone(),
                causation_id: command.id,
                correlation_id: command.correlation_id,
                payload: json!({
                    "linkId": link_id,
                    "slug": slug,
                    "name": input.name.trim(),
                    "source": input.source.as_str(),
                    "goal": input.goal.as_str(),
                    "destinationPath": input.destination_path.trim(),
                    "branchId": input.branch_id,
                }),
                privacy_class: PrivacyClass::Public,
            },
        )
        .await?;
        let stored = StoredCreateTrackingLinkResult {
            link_id,
            version: 1,
        };
        commit_command(
            &mut transaction,
            tenant,
            organization_id,
            command.id,
            &serde_json::to_value(&stored)?,
        )
        .await?;
        transaction.commit().await?;
        Ok(CreateTrackingLinkOutcome {
            link_id,
            version: 1,
            replayed: false,
        })
    }

    /// Returns a local-date analytics window for the active organization.
    pub async fn get_airhop_staff_site_analytics(
        &self,
        tenant: &TenantContext,
        days: u16,
    ) -> Result<StaffSiteAnalytics> {
        self.get_airhop_staff_site_analytics_ending(tenant, days, false)
            .await
    }

    /// Reads a local-calendar window ending today or on the completed yesterday.
    pub async fn get_airhop_staff_site_analytics_ending(
        &self,
        tenant: &TenantContext,
        days: u16,
        until_yesterday: bool,
    ) -> Result<StaffSiteAnalytics> {
        if !(MIN_ANALYTICS_DAYS..=MAX_ANALYTICS_DAYS).contains(&days) {
            return Err(DbError::InvalidData(
                "AirHub site analytics days must be between 1 and 366".to_owned(),
            ));
        }
        let context = sqlx::query(
            "SELECT id, time_zone, (now() AT TIME ZONE time_zone)::date AS local_date \
             FROM airhop_organizations \
             WHERE community_id = $1 AND status = 'active'",
        )
        .bind(tenant.community().as_uuid())
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| DbError::NotFound("active AirHub organization".to_owned()))?;
        let organization_id: Uuid = context.try_get("id")?;
        let time_zone: String = context.try_get("time_zone")?;
        let local_date: NaiveDate = context.try_get("local_date")?;
        let as_of_date = local_date
            .checked_sub_signed(Duration::days(i64::from(until_yesterday)))
            .ok_or_else(|| DbError::InvalidData("invalid analytics end date".to_owned()))?;
        let period_start = as_of_date
            .checked_sub_signed(Duration::days(i64::from(days.saturating_sub(1))))
            .ok_or_else(|| DbError::InvalidData("invalid analytics period".to_owned()))?;

        let mut transaction = self.pool.begin().await?;
        sqlx::query("SET LOCAL statement_timeout = '5s'")
            .execute(&mut *transaction)
            .await?;
        let value: serde_json::Value =
            sqlx::query_scalar(include_str!("site_analytics/report.sql"))
                .bind(tenant.community().as_uuid())
                .bind(organization_id)
                .bind(period_start)
                .bind(as_of_date)
                .bind(&time_zone)
                .fetch_one(&mut *transaction)
                .await?;
        let report = serde_json::from_value(value)?;
        transaction.commit().await?;
        Ok(report)
    }

    /// Deletes one bounded batch of anonymous raw events older than 13 months.
    ///
    /// The append-only trigger accepts deletes only inside this explicitly
    /// marked transaction, keeping ordinary application paths immutable.
    pub async fn reap_airhop_site_analytics_events(&self) -> Result<u64> {
        const RETENTION_SWEEP_BATCH_SIZE: i64 = 1_000;

        let mut transaction = self.pool.begin().await?;
        sqlx::query("SELECT set_config('buzz.airhop_analytics_retention', 'on', true)")
            .execute(&mut *transaction)
            .await?;
        let result = sqlx::query(
            "DELETE FROM airhop_site_analytics_events \
             WHERE (community_id, event_id) IN ( \
                 SELECT community_id, event_id \
                 FROM airhop_site_analytics_events \
                 WHERE occurred_at < now() - INTERVAL '13 months' \
                 ORDER BY occurred_at, community_id, event_id \
                 LIMIT $1 \
             )",
        )
        .bind(RETENTION_SWEEP_BATCH_SIZE)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(result.rows_affected())
    }
}

/// Inserts the authoritative final funnel event in the booking transaction.
pub(super) async fn record_booking_created(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    input: BookingCreatedAnalyticsInput<'_>,
) -> Result<()> {
    let branch_id: Uuid = sqlx::query_scalar(
        "SELECT branch_id FROM airhop_lesson_occurrences \
         WHERE community_id = $1 AND organization_id = $2 \
           AND recurrence_rule_id = $3 AND original_date = $4",
    )
    .bind(tenant.community().as_uuid())
    .bind(input.organization_id)
    .bind(input.recurrence_rule_id)
    .bind(input.original_date)
    .fetch_one(&mut **transaction)
    .await?;
    if let Some(value) = input.attribution {
        validate_attribution(value)?;
        validate_optional_link(
            &mut **transaction,
            tenant,
            input.organization_id,
            value.tracking_link_id,
        )
        .await?;
    }
    sqlx::query(
        "INSERT INTO airhop_site_analytics_events (\
             community_id, organization_id, event_id, event_type, occurred_at, \
             visitor_digest, session_digest, journey_id, booking_id, tracking_link_id, \
             branch_id, path, referrer_host, source, campaign\
         ) VALUES ($1, $2, $3, 'booking_created', $4, $5, $6, $7, $8, $9, $10, \
                   '/booking', $11, $12, $13)",
    )
    .bind(tenant.community().as_uuid())
    .bind(input.organization_id)
    .bind(Uuid::new_v4())
    .bind(input.occurred_at)
    .bind(
        input
            .attribution
            .map(|value| Vec::from(value.visitor_digest)),
    )
    .bind(
        input
            .attribution
            .map(|value| Vec::from(value.session_digest)),
    )
    .bind(input.attribution.map(|value| value.journey_id))
    .bind(input.booking_id)
    .bind(input.attribution.and_then(|value| value.tracking_link_id))
    .bind(branch_id)
    .bind(
        input
            .attribution
            .and_then(|value| value.referrer_host.as_deref()),
    )
    .bind(input.attribution.and_then(|value| value.source.as_deref()))
    .bind(
        input
            .attribution
            .and_then(|value| value.campaign.as_deref()),
    )
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn resolve_active_organization<'e, E>(executor: E, tenant: &TenantContext) -> Result<Uuid>
where
    E: sqlx::Executor<'e, Database = Postgres>,
{
    sqlx::query_scalar(
        "SELECT id FROM airhop_organizations \
         WHERE community_id = $1 AND status = 'active'",
    )
    .bind(tenant.community().as_uuid())
    .fetch_optional(executor)
    .await?
    .ok_or_else(|| DbError::NotFound("active AirHub organization".to_owned()))
}

async fn validate_optional_branch<'e, E>(
    executor: E,
    tenant: &TenantContext,
    organization_id: Uuid,
    branch_id: Option<Uuid>,
) -> Result<()>
where
    E: sqlx::Executor<'e, Database = Postgres>,
{
    let Some(branch_id) = branch_id else {
        return Ok(());
    };
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM airhop_branches \
         WHERE community_id = $1 AND organization_id = $2 AND id = $3)",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(branch_id)
    .fetch_one(executor)
    .await?;
    if exists {
        Ok(())
    } else {
        Err(DbError::InvalidData(
            "AirHub analytics branch is invalid".to_owned(),
        ))
    }
}

async fn validate_optional_link<'e, E>(
    executor: E,
    tenant: &TenantContext,
    organization_id: Uuid,
    link_id: Option<Uuid>,
) -> Result<()>
where
    E: sqlx::Executor<'e, Database = Postgres>,
{
    let Some(link_id) = link_id else {
        return Ok(());
    };
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM airhop_tracking_links \
         WHERE community_id = $1 AND organization_id = $2 AND id = $3)",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(link_id)
    .fetch_one(executor)
    .await?;
    if exists {
        Ok(())
    } else {
        Err(DbError::InvalidData(
            "AirHub analytics tracking link is invalid".to_owned(),
        ))
    }
}

fn validate_public_event(event: &RecordSiteAnalyticsEventInput) -> Result<()> {
    if event.event_id.is_nil()
        || event.journey_id.is_some_and(|value| value.is_nil())
        || event.path.as_ref().is_some_and(|value| !valid_path(value))
        || event
            .referrer_host
            .as_ref()
            .is_some_and(|value| !valid_referrer_host(value))
        || event
            .source
            .as_ref()
            .is_some_and(|value| !valid_label(value, 80))
        || event
            .campaign
            .as_ref()
            .is_some_and(|value| !valid_label(value, 160))
        || matches!(
            event.event_type,
            SiteAnalyticsEventType::BookingCreated | SiteAnalyticsEventType::TrackingLinkOpen
        )
        || matches!(
            event.event_type,
            SiteAnalyticsEventType::BookingStepViewed
                | SiteAnalyticsEventType::BookingStepCompleted
        ) != event.step.is_some()
        || (event.event_type == SiteAnalyticsEventType::ContactClick) != event.target.is_some()
        || matches!(
            event.event_type,
            SiteAnalyticsEventType::BookingOpened
                | SiteAnalyticsEventType::BookingStepViewed
                | SiteAnalyticsEventType::BookingStepCompleted
                | SiteAnalyticsEventType::BookingSubmit
        ) && event.journey_id.is_none()
    {
        return Err(DbError::InvalidData(
            "AirHub public analytics event is invalid".to_owned(),
        ));
    }
    if event.visitor_digest.is_none() || event.session_digest.is_none() {
        return Err(DbError::InvalidData(
            "AirHub public analytics event requires visitor and session identity".to_owned(),
        ));
    }
    Ok(())
}

fn validate_attribution(value: &BookingAnalyticsAttribution) -> Result<()> {
    if value.journey_id.is_nil()
        || value
            .source
            .as_ref()
            .is_some_and(|item| !valid_label(item, 80))
        || value
            .campaign
            .as_ref()
            .is_some_and(|item| !valid_label(item, 160))
        || value
            .referrer_host
            .as_ref()
            .is_some_and(|item| !valid_referrer_host(item))
    {
        return Err(DbError::InvalidData(
            "AirHub booking analytics attribution is invalid".to_owned(),
        ));
    }
    Ok(())
}

fn validate_create_link(input: &CreateTrackingLinkInput) -> Result<()> {
    input.actor.validate()?;
    if input.actor.kind != ActorKind::Staff
        || !valid_label(&input.name, 160)
        || !valid_path(&input.destination_path)
        || input.branch_id.is_some_and(|value| value.is_nil())
    {
        return Err(DbError::InvalidData(
            "AirHub tracking-link input is invalid".to_owned(),
        ));
    }
    Ok(())
}

fn valid_path(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty()
        && value.len() <= 512
        && value.starts_with('/')
        && !value.starts_with("//")
        && !value.contains('\\')
        && !value.contains('?')
        && !value.contains('#')
        && !value.chars().any(char::is_control)
}

fn valid_referrer_host(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty()
        && value.len() <= 253
        && !value.contains('/')
        && !value.contains('@')
        && !value.chars().any(char::is_whitespace)
}

fn valid_label(value: &str, max: usize) -> bool {
    let value = value.trim();
    !value.is_empty() && value.chars().count() <= max && !value.chars().any(char::is_control)
}

fn parse_link_row(
    row: sqlx::postgres::PgRow,
    open_count: i64,
    booking_count: i64,
    contact_click_count: i64,
) -> Result<TrackingLink> {
    Ok(TrackingLink {
        id: row.try_get("id")?,
        slug: row.try_get("slug")?,
        name: row.try_get("name")?,
        source: TrackingLinkSource::from_db(row.try_get("source")?)?,
        goal: TrackingLinkGoal::from_db(row.try_get("goal")?)?,
        destination_path: row.try_get("destination_path")?,
        branch_id: row.try_get("branch_id")?,
        status: TrackingLinkStatus::from_db(row.try_get("status")?)?,
        version: row.try_get("version")?,
        open_count,
        booking_count,
        contact_click_count,
        created_at: row.try_get("created_at")?,
    })
}

async fn replay_create_link(
    transaction: Transaction<'_, Postgres>,
    command: AirhopCommand,
) -> Result<CreateTrackingLinkOutcome> {
    match command.status {
        CommandStatus::Pending => Err(DbError::AirhopCommandInProgress),
        CommandStatus::Failed => Err(DbError::AirhopCommandPreviouslyFailed),
        CommandStatus::Committed => {
            let stored: StoredCreateTrackingLinkResult =
                serde_json::from_value(command.result.ok_or_else(|| {
                    DbError::InvalidData("committed tracking-link command has no result".to_owned())
                })?)?;
            transaction.commit().await?;
            Ok(CreateTrackingLinkOutcome {
                link_id: stored.link_id,
                version: stored.version,
                replayed: true,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracked_destinations_are_same_origin_paths_without_queries() {
        assert!(valid_path("/booking"));
        assert!(valid_path("/groups/dance"));
        assert!(!valid_path("https://example.com/booking"));
        assert!(!valid_path("//evil.example"));
        assert!(!valid_path("/\\evil.example"));
        assert!(!valid_path("/booking?source=forged"));
        assert!(!valid_path("/booking#contacts"));
    }

    #[test]
    fn public_events_cannot_forge_authoritative_outcomes() {
        let common = RecordSiteAnalyticsEventInput {
            event_id: Uuid::new_v4(),
            event_type: SiteAnalyticsEventType::BookingOpened,
            occurred_at: Utc::now(),
            visitor_digest: Some([1; 32]),
            session_digest: Some([2; 32]),
            journey_id: Some(Uuid::new_v4()),
            tracking_link_id: None,
            branch_id: None,
            path: Some("/booking".to_owned()),
            referrer_host: None,
            source: Some("direct".to_owned()),
            campaign: None,
            step: None,
            target: None,
        };
        assert!(validate_public_event(&common).is_ok());
        assert!(validate_public_event(&RecordSiteAnalyticsEventInput {
            event_type: SiteAnalyticsEventType::BookingCreated,
            ..common.clone()
        })
        .is_err());
        assert!(validate_public_event(&RecordSiteAnalyticsEventInput {
            event_type: SiteAnalyticsEventType::BookingStepCompleted,
            step: None,
            ..common
        })
        .is_err());
    }
}
