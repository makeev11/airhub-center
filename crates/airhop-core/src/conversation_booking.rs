//! Persistable parent booking intake, shared by the backend and its tool schema.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Complete snapshot of information collected so far. Missing fields stay null;
/// callers must never invent dates of birth, names, phone numbers, or consent.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationBookingData {
    /// Stable rule returned by booking options.
    #[schemars(with = "Option<String>")]
    pub recurrence_rule_id: Option<Uuid>,
    /// Original occurrence date, YYYY-MM-DD, returned by booking options.
    pub original_date: Option<String>,
    /// `trial` or `lesson`.
    pub purpose: Option<String>,
    /// Existing child from this turn's verified Family, when selecting one.
    #[schemars(with = "Option<String>")]
    pub child_id: Option<Uuid>,
    /// Parent's stated name; server fills it for a verified Family.
    pub parent_name: Option<String>,
    /// Parent's contact number; typing it never verifies another Family.
    pub phone: Option<String>,
    /// Child's stated name; server fills it when childId is supplied.
    pub child_name: Option<String>,
    /// Actual date of birth, YYYY-MM-DD. Ask if only age is known.
    pub child_birth_date: Option<String>,
}

/// Exact affirmative response to the latest server-generated booking summary.
/// Negations, quotations, conditional replies and staff instructions do not qualify.
pub fn is_booking_confirmation(text: &str) -> bool {
    let normalized = text
        .trim()
        .trim_end_matches(['.', '!', '。'])
        .trim()
        .to_lowercase();
    matches!(
        normalized.as_str(),
        "да" | "подтверждаю"
            | "подтверждаю запись"
            | "да, подтверждаю"
            | "yes"
            | "confirm"
            | "i confirm"
            | "confirm booking"
            | "sim"
            | "confirmo"
            | "confirmo a reserva"
            | "evet"
            | "onaylıyorum"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn confirmation_is_explicit_and_unconditional() {
        for text in [
            "Да!",
            " Подтверждаю запись. ",
            "YES",
            "Confirmo",
            "Onaylıyorum",
        ] {
            assert!(is_booking_confirmation(text), "{text}");
        }
        for text in [
            "не подтверждаю",
            "да, но в другое время",
            "он сказал да",
            "@Гермес продолжай",
            "запишите если бесплатно",
            "",
        ] {
            assert!(!is_booking_confirmation(text), "{text}");
        }
    }
}
