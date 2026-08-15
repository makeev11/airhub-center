//! Exact calendar-age rules used by public booking and group matching.

use chrono::{Datelike, NaiveDate};
use thiserror::Error;

/// Inclusive age boundaries for a group, expressed in completed calendar months.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct AgeLimits {
    minimum_months: Option<u32>,
    maximum_months: Option<u32>,
}

impl AgeLimits {
    /// Creates inclusive age limits.
    ///
    /// An absent boundary is unbounded. A minimum greater than the maximum is
    /// rejected rather than silently producing a group that can never match.
    pub fn new(
        minimum_months: Option<u32>,
        maximum_months: Option<u32>,
    ) -> Result<Self, AgeLimitsError> {
        if matches!(
            (minimum_months, maximum_months),
            (Some(minimum), Some(maximum)) if minimum > maximum
        ) {
            return Err(AgeLimitsError::Reversed);
        }
        Ok(Self {
            minimum_months,
            maximum_months,
        })
    }

    /// Returns the inclusive minimum in completed months, if configured.
    pub const fn minimum_months(self) -> Option<u32> {
        self.minimum_months
    }

    /// Returns the inclusive maximum in completed months, if configured.
    pub const fn maximum_months(self) -> Option<u32> {
        self.maximum_months
    }

    /// Checks an exact birth date against the limits on the lesson date.
    pub fn contains_birth_date(self, birth_date: NaiveDate, lesson_date: NaiveDate) -> bool {
        let Some(months) = completed_months_on(birth_date, lesson_date) else {
            return false;
        };
        self.contains_completed_months(months)
    }

    /// Checks a completed-month value against the inclusive limits.
    pub fn contains_completed_months(self, months: u32) -> bool {
        self.minimum_months.is_none_or(|minimum| months >= minimum)
            && self.maximum_months.is_none_or(|maximum| months <= maximum)
    }
}

/// An invalid age-limit configuration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum AgeLimitsError {
    /// The configured minimum is greater than the maximum.
    #[error("minimum age cannot exceed maximum age")]
    Reversed,
}

/// Calculates completed calendar months at the lesson date.
///
/// Returns `None` when the lesson is before the birth date. This matches the
/// current AirHub browser rule without relying on elapsed-day approximations.
pub fn completed_months_on(birth_date: NaiveDate, lesson_date: NaiveDate) -> Option<u32> {
    if lesson_date < birth_date {
        return None;
    }

    let years = lesson_date.year() - birth_date.year();
    let mut months = years * 12 + lesson_date.month() as i32 - birth_date.month() as i32;
    if lesson_date.day() < birth_date.day() {
        months -= 1;
    }
    u32::try_from(months).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(value: &str) -> NaiveDate {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").expect("valid test date")
    }

    #[test]
    fn completed_months_follow_exact_day_boundaries() {
        assert_eq!(
            completed_months_on(date("2020-08-10"), date("2026-08-09")),
            Some(71)
        );
        assert_eq!(
            completed_months_on(date("2020-08-10"), date("2026-08-10")),
            Some(72)
        );
        assert_eq!(
            completed_months_on(date("2020-08-31"), date("2026-02-28")),
            Some(65)
        );
        assert_eq!(
            completed_months_on(date("2026-08-11"), date("2026-08-10")),
            None
        );
    }

    #[test]
    fn boundaries_are_inclusive() {
        let limits = AgeLimits::new(Some(72), Some(96)).expect("valid limits");
        assert!(limits.contains_birth_date(date("2020-08-10"), date("2026-08-10")));
        assert!(!limits.contains_birth_date(date("2020-08-11"), date("2026-08-10")));
        assert!(limits.contains_birth_date(date("2018-08-10"), date("2026-08-10")));
        assert!(!limits.contains_birth_date(date("2018-07-10"), date("2026-08-10")));
    }

    #[test]
    fn reversed_limits_are_rejected() {
        assert_eq!(
            AgeLimits::new(Some(97), Some(96)),
            Err(AgeLimitsError::Reversed)
        );
    }
}
