//! Explicit conversation permissions for internal product agents.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Humans allowed to start an agent task, subject to current server membership.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
pub enum AgentAudience {
    /// All active human employees; external clients and bots are excluded.
    Staff {},
    /// Only current human owners of the center.
    Owner {},
    /// Specific active employees; ownership does not bypass this list.
    Selected {
        /// Canonical lowercase public keys, not display names.
        pubkeys: Vec<String>,
    },
}

/// Conversation surfaces, independent of the authorized audience.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentConversationSurfaces {
    /// Channels and private direct conversations.
    Both,
    /// Stream channels only.
    Channels,
    /// Private direct conversations only.
    DirectMessages,
}

/// An explicit owner/admin choice. Absence preserves legacy access.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentConversationAccess {
    /// Who may address the agent.
    pub audience: AgentAudience,
    /// Where permitted requests may originate.
    pub surfaces: AgentConversationSurfaces,
}

impl AgentConversationAccess {
    /// Validates the closed identity list before persistence.
    pub fn validate(&self) -> Result<(), &'static str> {
        if let AgentAudience::Selected { pubkeys } = &self.audience {
            let unique: std::collections::BTreeSet<_> = pubkeys.iter().collect();
            if pubkeys.is_empty() || pubkeys.len() > 200 || unique.len() != pubkeys.len() {
                return Err("choose 1–200 distinct employees");
            }
            if pubkeys.iter().any(|key| {
                key.len() != 64
                    || !key
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            }) {
                return Err("employee public keys must be canonical lowercase hex");
            }
        }
        Ok(())
    }

    /// Evaluates an explicitly configured audience after human membership validation.
    pub fn allows_actor(&self, pubkey: &str, member_role: &str) -> bool {
        if !matches!(member_role, "owner" | "admin" | "member") {
            return false;
        }
        match &self.audience {
            AgentAudience::Staff {} => true,
            AgentAudience::Owner {} => member_role == "owner",
            AgentAudience::Selected { pubkeys } => pubkeys.iter().any(|key| key == pubkey),
        }
    }

    /// Evaluates a server-loaded channel type, without granting membership.
    pub const fn allows_surface(&self, is_direct_message: bool) -> bool {
        matches!(self.surfaces, AgentConversationSurfaces::Both)
            || (is_direct_message
                && matches!(self.surfaces, AgentConversationSurfaces::DirectMessages))
            || (!is_direct_message && matches!(self.surfaces, AgentConversationSurfaces::Channels))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_audiences_do_not_admit_guests_or_bots() {
        let mut access = AgentConversationAccess {
            audience: AgentAudience::Staff {},
            surfaces: AgentConversationSurfaces::Both,
        };
        assert!(access.allows_actor(&"aa".repeat(32), "member"));
        for role in ["guest", "bot", "agent", ""] {
            assert!(!access.allows_actor(&"aa".repeat(32), role));
        }
        access.audience = AgentAudience::Owner {};
        assert!(access.allows_actor(&"aa".repeat(32), "owner"));
        assert!(!access.allows_actor(&"aa".repeat(32), "admin"));
        access.audience = AgentAudience::Selected {
            pubkeys: vec!["aa".repeat(32)],
        };
        assert!(access.allows_actor(&"aa".repeat(32), "member"));
        assert!(!access.allows_actor(&"bb".repeat(32), "owner"));
        assert!(access.allows_surface(true) && access.allows_surface(false));
        access.surfaces = AgentConversationSurfaces::Channels;
        assert!(!access.allows_surface(true) && access.allows_surface(false));
        access.surfaces = AgentConversationSurfaces::DirectMessages;
        assert!(access.allows_surface(true) && !access.allows_surface(false));
    }

    #[test]
    fn selected_people_are_unambiguous() {
        for keys in [
            vec![],
            vec!["not-a-key".into()],
            vec!["AA".repeat(32)],
            vec!["aa".repeat(32); 2],
        ] {
            assert!(AgentConversationAccess {
                audience: AgentAudience::Selected { pubkeys: keys },
                surfaces: AgentConversationSurfaces::Both
            }
            .validate()
            .is_err());
        }
        assert!(serde_json::from_value::<AgentAudience>(
            serde_json::json!({"mode":"staff","pubkeys":[]})
        )
        .is_err());
    }
}
