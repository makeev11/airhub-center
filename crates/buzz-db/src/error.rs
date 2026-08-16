//! Database error types.

use thiserror::Error;

/// Errors produced by database operations.
#[derive(Debug, Error)]
pub enum DbError {
    /// A SQLx driver-level error.
    #[error("database error: {0}")]
    Sqlx(#[from] sqlx::Error),

    /// A SQLx migration error.
    #[error("migration error: {0}")]
    Migrate(#[from] sqlx::migrate::MigrateError),

    /// Attempted to store an AUTH event (kind 22242), which is forbidden.
    #[error("AUTH events (kind 22242) must not be stored")]
    AuthEventRejected,

    /// Attempted to store an ephemeral event (kinds 20000–29999), which is forbidden.
    #[error("ephemeral events (kind {0}) must not be stored")]
    EphemeralEventRejected(u16),

    /// The requested channel does not exist.
    #[error("channel not found: {0}")]
    ChannelNotFound(uuid::Uuid),

    /// The requested member is not in the channel.
    #[error("member not found in channel {0}")]
    MemberNotFound(uuid::Uuid),

    /// A generic not-found error.
    #[error("not found: {0}")]
    NotFound(String),

    /// The caller lacks permission for the requested operation.
    #[error("access denied: {0}")]
    AccessDenied(String),

    /// JSON serialization or deserialization failed.
    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    /// A value in the database is malformed or unexpected.
    #[error("invalid data: {0}")]
    InvalidData(String),

    /// A stored timestamp value could not be interpreted.
    #[error("invalid timestamp: {0}")]
    InvalidTimestamp(i64),

    /// The stable AirHub lesson is cancelled, archived, or otherwise unavailable.
    #[error("AirHub lesson occurrence is unavailable")]
    AirhopOccurrenceUnavailable,

    /// The child is outside the group's inclusive age limits on the lesson date.
    #[error("child does not match the AirHub lesson age limits")]
    AirhopAgeMismatch,

    /// The occurrence has no seat for another distinct child.
    #[error("AirHub lesson occurrence is at capacity")]
    AirhopCapacityFull,

    /// The requested trial or one-off visit kind is disabled by effective policy.
    #[error("requested AirHub visit kind is disabled")]
    AirhopVisitDisabled,

    /// Family, representative, child, consent, or command identity is inconsistent.
    #[error("AirHub booking identity is inconsistent")]
    AirhopIdentityMismatch,

    /// A seat-holding booking or management credential conflicts with an existing row.
    #[error("AirHub booking conflicts with an existing reservation")]
    AirhopBookingConflict,

    /// An idempotent AirHub command receipt exists but has not reached a terminal state.
    #[error("AirHub command is already in progress")]
    AirhopCommandInProgress,

    /// An idempotent AirHub command receipt is durably marked failed.
    #[error("AirHub command previously failed")]
    AirhopCommandPreviouslyFailed,

    /// An idempotency key was reused with a different canonical request body.
    #[error("AirHub idempotency key was reused with a different request")]
    AirhopIdempotencyConflict,

    /// A parent management action is invalid for the booking lifecycle or time.
    #[error("AirHub public booking management transition is not allowed")]
    AirhopBookingTransition,

    /// A staff mutation used a stale optimistic entity version.
    #[error("AirHub entity version is no longer current")]
    AirhopVersionConflict,

    /// The family primary representative cannot be archived in place.
    #[error("AirHub primary representative must be reassigned before archiving")]
    AirhopPrimaryRepresentativeRequired,

    /// A family member still has active enrollment or future booking commitments.
    #[error("AirHub family member has active or future commitments")]
    AirhopMemberHasActiveCommitments,
}

/// Convenience alias for `Result<T, DbError>`.
pub type Result<T> = std::result::Result<T, DbError>;
