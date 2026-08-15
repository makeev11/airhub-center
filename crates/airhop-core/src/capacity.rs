//! Deterministic lesson participation and capacity rules.

use std::collections::BTreeSet;

use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::booking::{BookingStatus, StableLessonReference};
use crate::schedule::Weekday;

/// Lifecycle status of an enrollment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EnrollmentStatus {
    /// The enrollment may occupy covered lessons.
    Active,
    /// The enrollment is temporarily inactive.
    Paused,
    /// The enrollment is terminal.
    Ended,
}

/// One configured weekly slot in an enrollment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyScheduleSelection {
    /// Selected recurrence series.
    pub recurrence_rule_id: Uuid,
    /// Selected original weekday within the series.
    pub weekday: Weekday,
}

/// Whether an enrollment has explicit weekly slots.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AssignmentState {
    /// Legacy/imported enrollment awaiting explicit schedule assignment.
    ///
    /// It temporarily covers the whole group to avoid understating capacity.
    NeedsAssignment,
    /// Enrollment with explicit weekly slots.
    Configured {
        /// Recurrence/weekday pairs selected by the family.
        selections: BTreeSet<WeeklyScheduleSelection>,
    },
}

/// Enrollment fields required by capacity calculations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Enrollment {
    /// Enrolled child.
    pub child_id: Uuid,
    /// Enrolled group.
    pub group_id: Uuid,
    /// First active date, inclusive.
    pub start_date: NaiveDate,
    /// Last active date, inclusive, if ended in advance.
    pub end_date: Option<NaiveDate>,
    /// Enrollment lifecycle.
    pub status: EnrollmentStatus,
    /// Weekly assignment state.
    pub assignment: AssignmentState,
}

impl Enrollment {
    /// Returns whether this enrollment is active on a local lesson date.
    pub fn is_active_on(&self, date: NaiveDate) -> bool {
        self.status == EnrollmentStatus::Active
            && self.start_date <= date
            && self.end_date.is_none_or(|end_date| date <= end_date)
    }

    /// Returns whether this enrollment occupies the supplied lesson.
    ///
    /// Configured enrollments follow moved occurrences using the original
    /// recurrence weekday, matching the current AirHub behavior.
    pub fn covers(&self, lesson: &Lesson) -> bool {
        if self.group_id != lesson.group_id || !self.is_active_on(lesson.date) {
            return false;
        }
        match &self.assignment {
            AssignmentState::NeedsAssignment => true,
            AssignmentState::Configured { selections } => {
                let weekday = Weekday::from(lesson.lesson_ref.original_date.weekday());
                selections.contains(&WeeklyScheduleSelection {
                    recurrence_rule_id: lesson.lesson_ref.recurrence_rule_id,
                    weekday,
                })
            }
        }
    }
}

/// Materialized lesson identity used for participation checks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Lesson {
    /// Owning group.
    pub group_id: Uuid,
    /// Effective local date; it may differ from the stable original date.
    pub date: NaiveDate,
    /// Stable recurrence identity.
    pub lesson_ref: StableLessonReference,
}

/// Booking fields required by capacity calculations.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BookingSeat {
    /// Booked child.
    pub child_id: Uuid,
    /// Booked stable occurrence.
    pub lesson_ref: StableLessonReference,
    /// Booking lifecycle.
    pub status: BookingStatus,
}

impl BookingSeat {
    /// Returns whether this booking reserves a seat in the supplied lesson.
    pub fn holds_seat_for(self, lesson: &Lesson) -> bool {
        self.status.holds_seat() && self.lesson_ref == lesson.lesson_ref
    }
}

/// Returns unique child IDs occupying a lesson through enrollment or booking.
pub fn participant_child_ids(
    lesson: &Lesson,
    enrollments: &[Enrollment],
    bookings: &[BookingSeat],
) -> BTreeSet<Uuid> {
    let mut child_ids: BTreeSet<_> = enrollments
        .iter()
        .filter(|enrollment| enrollment.covers(lesson))
        .map(|enrollment| enrollment.child_id)
        .collect();
    child_ids.extend(
        bookings
            .iter()
            .copied()
            .filter(|booking| booking.holds_seat_for(lesson))
            .map(|booking| booking.child_id),
    );
    child_ids
}

/// Counts unique children occupying a lesson.
pub fn occupancy(lesson: &Lesson, enrollments: &[Enrollment], bookings: &[BookingSeat]) -> usize {
    participant_child_ids(lesson, enrollments, bookings).len()
}

/// Returns whether one more distinct child can reserve a place.
///
/// `None` capacity is unbounded. A child already counted in the lesson does
/// not consume a second place.
pub fn has_capacity_for_child(
    lesson: &Lesson,
    capacity: Option<u32>,
    child_id: Uuid,
    enrollments: &[Enrollment],
    bookings: &[BookingSeat],
) -> bool {
    let participants = participant_child_ids(lesson, enrollments, bookings);
    participants.contains(&child_id)
        || capacity.is_none_or(|limit| participants.len() < limit as usize)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn uuid(value: u128) -> Uuid {
        Uuid::from_u128(value)
    }

    fn date(value: &str) -> NaiveDate {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").expect("valid test date")
    }

    fn lesson() -> Lesson {
        Lesson {
            group_id: uuid(1),
            date: date("2026-08-05"),
            lesson_ref: StableLessonReference {
                recurrence_rule_id: uuid(2),
                original_date: date("2026-08-03"),
            },
        }
    }

    fn enrollment(child_id: Uuid, assignment: AssignmentState) -> Enrollment {
        Enrollment {
            child_id,
            group_id: uuid(1),
            start_date: date("2026-08-01"),
            end_date: None,
            status: EnrollmentStatus::Active,
            assignment,
        }
    }

    #[test]
    fn configured_enrollment_follows_moved_lesson_by_original_weekday() {
        let enrollment = enrollment(
            uuid(10),
            AssignmentState::Configured {
                selections: [WeeklyScheduleSelection {
                    recurrence_rule_id: uuid(2),
                    weekday: Weekday::Monday,
                }]
                .into_iter()
                .collect(),
            },
        );
        assert!(enrollment.covers(&lesson()));
    }

    #[test]
    fn needs_assignment_temporarily_covers_whole_group() {
        assert!(enrollment(uuid(10), AssignmentState::NeedsAssignment).covers(&lesson()));
    }

    #[test]
    fn occupancy_deduplicates_enrollment_and_booking_for_same_child() {
        let child_id = uuid(10);
        let enrollments = [enrollment(child_id, AssignmentState::NeedsAssignment)];
        let bookings = [BookingSeat {
            child_id,
            lesson_ref: lesson().lesson_ref,
            status: BookingStatus::PendingConfirmation,
        }];
        assert_eq!(occupancy(&lesson(), &enrollments, &bookings), 1);
    }

    #[test]
    fn last_seat_allows_existing_child_but_rejects_a_new_child() {
        let enrollments = [enrollment(uuid(10), AssignmentState::NeedsAssignment)];
        assert!(has_capacity_for_child(
            &lesson(),
            Some(1),
            uuid(10),
            &enrollments,
            &[]
        ));
        assert!(!has_capacity_for_child(
            &lesson(),
            Some(1),
            uuid(11),
            &enrollments,
            &[]
        ));
    }
}
