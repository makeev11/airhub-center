//! Typed commands for client responsibility, not conversation-level permissions.
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// The client workspace has one signed command surface for conversations and routing settings.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum ClientWorkspaceCommand {
    /// Per-conversation operational change.
    Conversation(ClientCommand),
    /// Owner-authored branch responsible roster; never changes membership.
    BranchResponsibles(BranchResponsiblesCommand),
}

/// Replace one branch's responsible roster with a bounded, explicit selection.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BranchResponsiblesCommand {
    /// Stable retry identity.
    pub idempotency_key: Uuid,
    /// Exact active branch in the organization.
    pub branch_id: Uuid,
    /// Current branch revision.
    pub expected_version: i64,
    /// At most eight existing staff public keys; empty selects owner fallback.
    pub responsible_pubkeys: Vec<String>,
}

/// Owner/staff command transported as one signed Nostr event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClientCommand {
    /// Stable retry identity; reusing it with different content conflicts.
    pub idempotency_key: Uuid,
    /// Exact target, never inferred from a channel name.
    pub conversation_id: Uuid,
    /// Current Inbox metadata revision.
    pub expected_version: i64,
    /// Bounded mutation.
    pub action: ClientAction,
}

/// Changes to responsibility or lifecycle; branch assignment never moves a thread.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ClientAction {
    /// Assign a parent-selected active branch.
    AssignBranch {
        /// Branch from live organization data.
        branch_id: Uuid,
    },
    /// Explicit staff queue lifecycle decision.
    SetStatus {
        /// waiting_staff, waiting_parent, resolved.
        status: String,
    },
    /// Assign an internal member already allowed to read the channel.
    Assign {
        /// Staff Nostr public key in hexadecimal.
        pubkey: String,
    },
    /// Explicit migration of one legacy contact channel, after preview.
    MigrateLegacy {
        /// Current provider-route revision, from preview.
        expected_route_version: i64,
    },
}

impl ClientCommand {
    /// Validate shape before any persistence or authorization checks.
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.idempotency_key.is_nil()
            || self.conversation_id.is_nil()
            || self.expected_version < 1
        {
            return Err("invalid conversation command identity or version");
        }
        match &self.action {
            ClientAction::AssignBranch { branch_id } if branch_id.is_nil() => Err("invalid branch"),
            ClientAction::SetStatus { status }
                if !matches!(
                    status.as_str(),
                    "waiting_staff" | "waiting_parent" | "resolved"
                ) =>
            {
                Err("invalid queue status")
            }
            ClientAction::Assign { pubkey }
                if pubkey.len() != 64 || !pubkey.bytes().all(|c| c.is_ascii_hexdigit()) =>
            {
                Err("invalid assignee")
            }
            ClientAction::MigrateLegacy {
                expected_route_version,
            } if *expected_route_version < 1 => Err("invalid route version"),
            _ => Ok(()),
        }
    }
}
