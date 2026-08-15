//! Organization-level operational settings.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::schedule::TrialPolicy;

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
    /// Payment day must be valid in every calendar month.
    #[error("payment day must be between 1 and 28, got {0}")]
    InvalidPaymentDay(u8),
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(payment_day_of_month: u8) -> OrganizationSettings {
        OrganizationSettings {
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
}
