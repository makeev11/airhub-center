//! Versioned product duties. Runtime skills never grant additional authority.

use chrono::{Datelike, NaiveDate};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Canonical product roles, independent of the model or runtime name.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum AgentRole {
    /// Internal team coordinator.
    Fizz,
    /// Internal operations specialist.
    Administrator,
    /// Internal reporting specialist.
    Analyst,
    /// Internal website/content specialist.
    ContentMarketer,
    /// External family-scoped administrator.
    ParentAdministrator,
}

impl AgentRole {
    /// Every product role covered by the shared execution contract.
    pub const ALL: [Self; 5] = [
        Self::Fizz,
        Self::Administrator,
        Self::Analyst,
        Self::ContentMarketer,
        Self::ParentAdministrator,
    ];

    /// Stable wire and persistence identifier.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Fizz => "fizz",
            Self::Administrator => "administrator",
            Self::Analyst => "analyst",
            Self::ContentMarketer => "content_marketer",
            Self::ParentAdministrator => "parent_administrator",
        }
    }

    /// Parses only supported product identifiers.
    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|role| role.as_str() == value)
    }
}

/// Internal destination; no external provider destination is accepted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
pub enum NoticeDestination {
    /// Derive each active branch's private staff channel on the server.
    Branches,
    /// Explicitly chosen internal stream, validated at save and delivery.
    Channel {
        /// Destination within the same community and organization.
        #[serde(rename = "channelId")]
        #[schemars(with = "String")]
        channel_id: Uuid,
    },
}

/// Local wall-clock time; scheduling uses the organization's IANA timezone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalDeliveryTime {
    /// Hour in 24-hour notation.
    pub hour: u8,
    /// Minute within the hour.
    pub minute: u8,
}

impl Default for LocalDeliveryTime {
    fn default() -> Self {
        Self { hour: 9, minute: 0 }
    }
}

/// Administrative reminders, derived from authoritative active child records.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BirthdayPolicy {
    /// Enables the recurring check, subject to the role's master switch.
    pub enabled: bool,
    /// Include birthdays occurring today.
    pub today: bool,
    /// Include birthdays exactly this many days ahead; zero disables advance notice.
    pub advance_days: u8,
    /// Local delivery time.
    pub time: LocalDeliveryTime,
    /// Validated internal destination.
    pub destination: NoticeDestination,
}

impl Default for BirthdayPolicy {
    fn default() -> Self {
        Self {
            enabled: true,
            today: true,
            advance_days: 2,
            time: LocalDeliveryTime::default(),
            destination: NoticeDestination::Branches,
        }
    }
}

/// Available authoritative sections of the regular internal report.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum AnalyticsSection {
    /// Booking applications and their outcomes.
    Bookings,
    /// Expected, received and outstanding payments, separated by currency.
    Payments,
    /// Recorded lesson attendance.
    Attendance,
    /// Upcoming capacity and occupancy.
    Capacity,
    /// Observed acquisition and attribution.
    Acquisition,
}

/// A daily or weekly snapshot, not a continuous stream of every metric change.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalyticsPolicy {
    /// Enables regular reports, subject to the role's master switch.
    pub enabled: bool,
    /// Explicit channel; absent uses the organization's analytics channel.
    #[schemars(with = "Option<String>")]
    pub channel_id: Option<Uuid>,
    /// Local delivery time.
    pub time: LocalDeliveryTime,
    /// ISO weekday (1–7) for weekly reporting; absent means every day.
    pub weekday: Option<u8>,
    /// Selected, independently meaningful report sections.
    pub sections: Vec<AnalyticsSection>,
}

impl Default for AnalyticsPolicy {
    fn default() -> Self {
        Self {
            enabled: true,
            channel_id: None,
            time: LocalDeliveryTime::default(),
            weekday: None,
            sections: vec![
                AnalyticsSection::Bookings,
                AnalyticsSection::Payments,
                AnalyticsSection::Attendance,
                AnalyticsSection::Capacity,
                AnalyticsSection::Acquisition,
            ],
        }
    }
}

/// Product content permission; human confirmation remains required for publication.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContentPolicy {
    /// Allows preparing and confirming changes through the existing website workflow.
    pub website_editing: bool,
}

/// Procedural learning permission. Reviewed examples cannot expand tool authority.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum LearningMode {
    /// Do not collect or activate procedural candidates.
    Off,
    /// Collect structural candidates; do not apply them to future tasks.
    #[default]
    Observe,
    /// Apply compatible lookup hints only after explicit human review and activation.
    Validated,
}

/// Desired state for one organization role; optimistic version is stored separately.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentPolicy {
    /// Master switch for both interactive and proactive work.
    pub enabled: bool,
    /// Explicit internal conversation access. Missing legacy fields do not
    /// grant broader access and must be preserved by old-client saves.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub communication: Option<crate::agent_access::AgentConversationAccess>,
    /// Role-specific administrative duties; never accepted for other roles.
    pub birthdays: Option<BirthdayPolicy>,
    /// Role-specific regular reports.
    pub analytics: Option<AnalyticsPolicy>,
    /// Role-specific website capabilities.
    pub content: Option<ContentPolicy>,
    /// Procedural learning mode, independent of personal memory.
    pub learning: LearningMode,
}

impl AgentPolicy {
    /// Sensible product defaults without a guessed destination channel.
    pub fn for_role(role: AgentRole) -> Self {
        Self {
            enabled: true,
            communication: None,
            birthdays: (role == AgentRole::Administrator).then(BirthdayPolicy::default),
            analytics: (role == AgentRole::Analyst).then(AnalyticsPolicy::default),
            content: (role == AgentRole::ContentMarketer).then_some(ContentPolicy {
                website_editing: true,
            }),
            learning: LearningMode::Observe,
        }
    }

    /// Rejects unsupported duties and invalid schedules before persistence.
    pub fn validate(&self, role: AgentRole) -> Result<(), &'static str> {
        if let Some(access) = &self.communication {
            if role == AgentRole::ParentAdministrator {
                return Err("external administrator access is scoped by its client connection");
            }
            access.validate()?;
        }
        if self.birthdays.is_some() != (role == AgentRole::Administrator)
            || self.analytics.is_some() != (role == AgentRole::Analyst)
            || self.content.is_some() != (role == AgentRole::ContentMarketer)
        {
            return Err("duties do not match this agent role");
        }
        if let Some(policy) = &self.birthdays {
            validate_time(policy.time)?;
            if policy.advance_days > 30 {
                return Err("birthday advance must be 0–30 days");
            }
            if policy.enabled && !policy.today && policy.advance_days == 0 {
                return Err("choose at least one birthday notification");
            }
            if matches!(policy.destination, NoticeDestination::Channel { channel_id } if channel_id.is_nil())
            {
                return Err("destination channel is missing");
            }
        }
        if let Some(policy) = &self.analytics {
            validate_time(policy.time)?;
            if policy.weekday.is_some_and(|day| !(1..=7).contains(&day)) {
                return Err("weekday must be 1–7");
            }
            if policy.channel_id.is_some_and(|id| id.is_nil()) {
                return Err("destination channel is missing");
            }
            let unique: std::collections::BTreeSet<_> = policy.sections.iter().collect();
            if unique.len() != policy.sections.len()
                || policy.sections.len() > 5
                || (policy.enabled && policy.sections.is_empty())
            {
                return Err("select distinct analytics sections");
            }
        }
        Ok(())
    }
}

fn validate_time(time: LocalDeliveryTime) -> Result<(), &'static str> {
    if time.hour > 23 || time.minute > 59 {
        Err("invalid local delivery time")
    } else {
        Ok(())
    }
}

/// Version-checked command sent as a signed, tenant-bound product event.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetAgentPolicy {
    /// Product role being configured.
    pub role: AgentRole,
    /// Last observed version; zero denotes an unsaved default.
    pub expected_version: i64,
    /// Complete desired state; unknown fields are rejected.
    pub policy: AgentPolicy,
}

/// Age turning on this date; February 29 birthdays use February 28 in non-leap years.
pub fn birthday_age_on(birth: NaiveDate, date: NaiveDate) -> Option<u32> {
    let anniversary =
        NaiveDate::from_ymd_opt(date.year(), birth.month(), birth.day()).or_else(|| {
            (birth.month() == 2 && birth.day() == 29)
                .then(|| NaiveDate::from_ymd_opt(date.year(), 2, 28))
                .flatten()
        })?;
    (anniversary == date && date > birth)
        .then(|| u32::try_from(date.year() - birth.year()).ok())
        .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_role_has_valid_separate_defaults() {
        for role in AgentRole::ALL {
            assert!(AgentPolicy::for_role(role).validate(role).is_ok());
        }
        assert!(AgentPolicy::for_role(AgentRole::Administrator)
            .validate(AgentRole::Analyst)
            .is_err());
    }

    #[test]
    fn schedules_and_empty_notifications_are_rejected() {
        let mut policy = AgentPolicy::for_role(AgentRole::Administrator);
        let birthday = policy.birthdays.as_mut().unwrap();
        birthday.time.hour = 24;
        assert!(policy.validate(AgentRole::Administrator).is_err());
        let birthday = policy.birthdays.as_mut().unwrap();
        birthday.time.hour = 9;
        birthday.today = false;
        birthday.advance_days = 0;
        assert!(policy.validate(AgentRole::Administrator).is_err());
    }

    #[test]
    fn exact_age_handles_leap_days_new_year_and_future_births() {
        let day = |text: &str| NaiveDate::parse_from_str(text, "%Y-%m-%d").unwrap();
        assert_eq!(
            birthday_age_on(day("2020-02-29"), day("2027-02-28")),
            Some(7)
        );
        assert_eq!(birthday_age_on(day("2020-02-29"), day("2028-02-28")), None);
        assert_eq!(
            birthday_age_on(day("2020-02-29"), day("2028-02-29")),
            Some(8)
        );
        assert_eq!(
            birthday_age_on(day("2020-01-01"), day("2027-01-01")),
            Some(7)
        );
        assert_eq!(birthday_age_on(day("2030-01-01"), day("2027-01-01")), None);
    }
}
