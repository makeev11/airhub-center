//! Typed observations attached to an agent's signed, parent-facing reply.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Agent-declared subject of this reply. Only booking enquiries enter the funnel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ConsultationPurpose {
    /// Selecting or booking a new lesson.
    Booking,
    /// General information without a booking enquiry.
    Information,
    /// Help with an existing booking or family.
    Support,
}

/// The single next answer requested in the last message of a reply batch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ConsultationQuestion {
    /// Child's age or actual date of birth.
    Age,
    /// Convenient location.
    Branch,
    /// Lesson or activity preference.
    Activity,
    /// Date or time selection.
    Time,
    /// Names and contact details.
    Contact,
    /// Explicit confirmation of the server-generated summary.
    Confirmation,
    /// Another necessary question.
    Other,
}

/// Semantic observations, never authority to create a booking or claim delivery.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConsultationProgress {
    /// Distinguishes booking enquiries from information and support.
    pub purpose: ConsultationPurpose,
    /// Null when this reply does not ask the parent to answer a question.
    pub waiting_for: Option<ConsultationQuestion>,
    /// Exact quote from the current parent message explicitly declining booking.
    /// Silence and a request for more information never qualify.
    pub declined_quote: Option<String>,
}

impl ConsultationProgress {
    /// Rejects contradictory or unbounded observations before signing or storing.
    pub fn validate(&self) -> Result<(), &'static str> {
        if let Some(quote) = &self.declined_quote {
            if self.purpose != ConsultationPurpose::Booking
                || self.waiting_for.is_some()
                || quote.trim().chars().count() < 3
                || quote.len() > 1000
            {
                return Err("declinedQuote requires a booking refusal, no waitingFor, and 3–1000 bytes of evidence");
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn observations_are_bounded_and_do_not_turn_silence_into_refusal() {
        let mut p = ConsultationProgress {
            purpose: ConsultationPurpose::Booking,
            waiting_for: Some(ConsultationQuestion::Time),
            declined_quote: None,
        };
        assert!(p.validate().is_ok());
        p.declined_quote = Some("Не будем записываться".into());
        assert!(p.validate().is_err());
        p.waiting_for = None;
        assert!(p.validate().is_ok());
        p.purpose = ConsultationPurpose::Support;
        assert!(p.validate().is_err());
        assert!(serde_json::from_str::<ConsultationProgress>(
            r#"{"purpose":"booking","waitingFor":"invented"}"#
        )
        .is_err());
    }
}
