#![deny(unsafe_code)]
#![warn(missing_docs)]
//! Server-authoritative domain rules for AirHub operations.
//!
//! This crate deliberately has no database, HTTP, Nostr, or UI dependencies.
//! It is the deterministic boundary shared by future command handlers,
//! projections, imports, and contract tests.

pub mod age;
pub mod agent_access;
pub mod agent_graph;
pub mod agent_learning;
pub mod agent_policy;
pub mod booking;
pub mod capacity;
pub mod client_conversations;
pub mod consultation;
pub mod conversation_booking;
pub mod knowledge;
pub mod organization;
pub mod schedule;

pub use age::{AgeLimits, AgeLimitsError};
pub use booking::{BookingStatus, BookingTransitionError, StableLessonReference};
pub use capacity::{
    AssignmentState, BookingSeat, Enrollment, EnrollmentStatus, Lesson, WeeklyScheduleSelection,
};
pub use organization::{
    ExistingStudentsOnboardingStatus, OrganizationSettings, OrganizationSettingsError,
    PublicBookingAppearance, PublicBookingPurpose, StaffWorkingPeriod, WeeklyStaffWorkingHours,
};
pub use schedule::{
    GroupSchedulePolicy, LessonException, LessonExceptionKind, LessonOriginal,
    MaterializeScheduleOptions, Money, NullableOverride, OccurrenceEffective, OccurrenceOverride,
    OccurrenceStatus, RecurrenceRule, ScheduleError, ScheduleOccurrence, SchedulePolicy,
    ScheduleRange, TrialPolicy, Weekday,
};
