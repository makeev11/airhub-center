//! Organization-level operational settings.

use std::collections::BTreeMap;

use chrono::NaiveTime;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::schedule::{TrialPolicy, Weekday};

/// One interval when human staff normally responds to customers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffWorkingPeriod {
    /// Inclusive local start time in `HH:mm` format.
    pub start_time: String,
    /// Exclusive local end time in `HH:mm` format.
    pub end_time: String,
}

/// Weekly human-staff availability in the organization's local time zone.
pub type WeeklyStaffWorkingHours = BTreeMap<Weekday, Vec<StaffWorkingPeriod>>;

/// Purpose shown by the public booking surface.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PublicBookingPurpose {
    /// Book a trial visit.
    Trial,
    /// Book a permitted one-off lesson.
    Lesson,
}

/// Appearance mode of the public booking surface.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PublicBookingAppearance {
    /// Follow the client operating-system preference.
    Automatic,
    /// Always use the light palette.
    Light,
    /// Always use the dark palette.
    Dark,
}

/// Progress of onboarding pre-existing students.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExistingStudentsOnboardingStatus {
    /// Onboarding has not begun.
    NotStarted,
    /// Onboarding is active.
    InProgress,
    /// Onboarding is intentionally postponed.
    Postponed,
    /// Onboarding is complete.
    Completed,
}

/// Settings inherited by operational AirHub entities.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizationSettings {
    /// Human-staff availability, independent of lesson and branch hours.
    #[serde(default)]
    pub staff_working_hours: WeeklyStaffWorkingHours,
    /// Default trial policy for groups and occurrences.
    pub default_trial_policy: TrialPolicy,
    /// Whether attendance is tracked unless a group overrides the setting.
    pub track_attendance_by_default: bool,
    /// Whether one-off visits are allowed unless a group overrides the setting.
    pub allow_single_visits_by_default: bool,
    /// Existing-student onboarding progress.
    pub existing_students_onboarding_status: ExistingStudentsOnboardingStatus,
    /// Default public booking purpose.
    pub public_booking_purpose: PublicBookingPurpose,
    /// Public booking appearance.
    pub public_booking_appearance: PublicBookingAppearance,
    /// Default monthly payment day, restricted to avoid short-month ambiguity.
    pub payment_day_of_month: u8,
}

impl OrganizationSettings {
    /// Validates organization-level numeric invariants.
    pub fn validate(&self) -> Result<(), OrganizationSettingsError> {
        for (weekday, periods) in &self.staff_working_hours {
            for (period_index, period) in periods.iter().enumerate() {
                let start = NaiveTime::parse_from_str(&period.start_time, "%H:%M");
                let end = NaiveTime::parse_from_str(&period.end_time, "%H:%M");
                if period.start_time.len() != 5
                    || period.end_time.len() != 5
                    || !matches!((start, end), (Ok(start), Ok(end)) if start < end)
                {
                    return Err(OrganizationSettingsError::InvalidStaffWorkingPeriod {
                        weekday: *weekday,
                        period_index,
                    });
                }
            }
        }
        if !(1..=28).contains(&self.payment_day_of_month) {
            return Err(OrganizationSettingsError::InvalidPaymentDay(
                self.payment_day_of_month,
            ));
        }
        Ok(())
    }
}

/// Invalid organization settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum OrganizationSettingsError {
    /// Staff working periods use valid local times and end after they begin.
    #[error("invalid staff working period {period_index} on {weekday:?}")]
    InvalidStaffWorkingPeriod {
        /// Day containing the invalid period.
        weekday: Weekday,
        /// Zero-based period position within that day.
        period_index: usize,
    },
    /// Payment day must be valid in every calendar month.
    #[error("payment day must be between 1 and 28, got {0}")]
    InvalidPaymentDay(u8),
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(payment_day_of_month: u8) -> OrganizationSettings {
        OrganizationSettings {
            staff_working_hours: BTreeMap::new(),
            default_trial_policy: TrialPolicy::Free,
            track_attendance_by_default: true,
            allow_single_visits_by_default: false,
            existing_students_onboarding_status: ExistingStudentsOnboardingStatus::NotStarted,
            public_booking_purpose: PublicBookingPurpose::Trial,
            public_booking_appearance: PublicBookingAppearance::Automatic,
            payment_day_of_month,
        }
    }

    #[test]
    fn payment_day_is_restricted_to_every_month() {
        assert!(settings(1).validate().is_ok());
        assert!(settings(28).validate().is_ok());
        assert_eq!(
            settings(29).validate(),
            Err(OrganizationSettingsError::InvalidPaymentDay(29))
        );
    }

    #[test]
    fn staff_hours_are_validated_independently_from_lesson_hours() {
        let mut configured = settings(5);
        configured.staff_working_hours.insert(
            Weekday::Monday,
            vec![StaffWorkingPeriod {
                start_time: "09:00".to_owned(),
                end_time: "18:00".to_owned(),
            }],
        );
        assert!(configured.validate().is_ok());

        configured.staff_working_hours.insert(
            Weekday::Tuesday,
            vec![StaffWorkingPeriod {
                start_time: "18:00".to_owned(),
                end_time: "09:00".to_owned(),
            }],
        );
        assert_eq!(
            configured.validate(),
            Err(OrganizationSettingsError::InvalidStaffWorkingPeriod {
                weekday: Weekday::Tuesday,
                period_index: 0,
            })
        );

        configured.staff_working_hours.insert(
            Weekday::Tuesday,
            vec![StaffWorkingPeriod {
                start_time: "9:00".to_owned(),
                end_time: "18:00".to_owned(),
            }],
        );
        assert!(configured.validate().is_err());
    }
}
