use std::collections::BTreeSet;

use airhop_core::age::completed_months_on;
use airhop_core::capacity::{has_capacity_for_child, occupancy};
use airhop_core::{
    AssignmentState, BookingSeat, BookingStatus, Enrollment, EnrollmentStatus, Lesson,
    NullableOverride, RecurrenceRule, StableLessonReference, Weekday,
};
use chrono::{NaiveDate, NaiveTime};
use serde::Deserialize;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContractFixture {
    age_cases: Vec<AgeCase>,
    booking_transition_cases: Vec<TransitionCase>,
    seat_holding_cases: Vec<SeatHoldingCase>,
    recurrence_cases: Vec<RecurrenceCase>,
    capacity_cases: Vec<CapacityCase>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgeCase {
    birth_date: String,
    lesson_date: String,
    completed_months: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct TransitionCase {
    from: BookingStatus,
    to: BookingStatus,
    allowed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SeatHoldingCase {
    status: BookingStatus,
    holds_seat: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecurrenceCase {
    starts_on: String,
    ends_on: String,
    weekdays: BTreeSet<Weekday>,
    date: String,
    occurs: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CapacityCase {
    enrollment_status: EnrollmentStatus,
    booking_status: BookingStatus,
    same_child: bool,
    expected_occupancy: usize,
    capacity: u32,
    candidate_is_existing_child: bool,
    candidate_allowed: bool,
}

fn fixtures() -> ContractFixture {
    serde_json::from_str(include_str!("../../../testdata/airhop/domain-v1.json"))
        .expect("valid AirHub domain contract fixture")
}

fn date(value: &str) -> NaiveDate {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").expect("valid fixture date")
}

fn time(value: &str) -> NaiveTime {
    NaiveTime::parse_from_str(value, "%H:%M").expect("valid fixture time")
}

#[test]
fn exact_age_contract_matches_current_airhub_behavior() {
    for case in fixtures().age_cases {
        assert_eq!(
            completed_months_on(date(&case.birth_date), date(&case.lesson_date)),
            case.completed_months,
            "birth={} lesson={}",
            case.birth_date,
            case.lesson_date
        );
    }
}

#[test]
fn booking_transition_contract_is_explicit() {
    for case in fixtures().booking_transition_cases {
        assert_eq!(
            case.from.can_transition_to(case.to),
            case.allowed,
            "from={:?} to={:?}",
            case.from,
            case.to
        );
    }
}

#[test]
fn booking_capacity_states_match_the_browser_contract() {
    for case in fixtures().seat_holding_cases {
        assert_eq!(case.status.holds_seat(), case.holds_seat);
    }
}

#[test]
fn recurrence_contract_uses_original_local_dates() {
    for (index, case) in fixtures().recurrence_cases.into_iter().enumerate() {
        let rule = RecurrenceRule {
            id: Uuid::from_u128(100 + index as u128),
            group_id: Uuid::from_u128(1),
            starts_on: date(&case.starts_on),
            ends_on: date(&case.ends_on),
            weekdays: case.weekdays,
            start_time: time("10:00"),
            end_time: time("11:00"),
            branch_id_override: None,
            room_id_override: NullableOverride::Inherit,
            teacher_ids_override: None,
            capacity_override: NullableOverride::Inherit,
            trial_policy_override: None,
            active: true,
        };
        assert_eq!(rule.occurs_on(date(&case.date)), case.occurs);
    }
}

#[test]
fn capacity_contract_counts_unique_children() {
    for case in fixtures().capacity_cases {
        let lesson = Lesson {
            group_id: Uuid::from_u128(1),
            date: date("2026-08-05"),
            lesson_ref: StableLessonReference {
                recurrence_rule_id: Uuid::from_u128(2),
                original_date: date("2026-08-03"),
            },
        };
        let enrollment_child = Uuid::from_u128(10);
        let booking_child = if case.same_child {
            enrollment_child
        } else {
            Uuid::from_u128(11)
        };
        let enrollments = [Enrollment {
            child_id: enrollment_child,
            group_id: lesson.group_id,
            start_date: date("2026-08-01"),
            end_date: None,
            status: case.enrollment_status,
            assignment: AssignmentState::NeedsAssignment,
        }];
        let bookings = [BookingSeat {
            child_id: booking_child,
            lesson_ref: lesson.lesson_ref,
            status: case.booking_status,
        }];
        let candidate = if case.candidate_is_existing_child {
            enrollment_child
        } else {
            Uuid::from_u128(12)
        };

        assert_eq!(
            occupancy(&lesson, &enrollments, &bookings),
            case.expected_occupancy
        );
        assert_eq!(
            has_capacity_for_child(
                &lesson,
                Some(case.capacity),
                candidate,
                &enrollments,
                &bookings,
            ),
            case.candidate_allowed
        );
    }
}
