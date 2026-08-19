use crate::managed_agents::{known_acp_runtime, ManagedAgentRecord};

const WELCOME_TEAM_ID: &str = "builtin-team:welcome";
const AGENT_MCP_COMMAND: &str = "airhop-agent-mcp";

fn is_builtin_welcome_agent(record: &ManagedAgentRecord) -> bool {
    if record.team_id.as_deref() != Some(WELCOME_TEAM_ID) {
        return false;
    }
    let Some(role) = record.env_vars.get("BUZZ_AIRHOP_ROLE") else {
        return false;
    };
    if record
        .env_vars
        .get("BUZZ_ACP_ROUTE_GATE")
        .map(String::as_str)
        != Some("airhop")
    {
        return false;
    }

    matches!(
        (record.persona_id.as_deref(), role.as_str()),
        (Some("builtin:airhop-fizz"), "fizz")
            | (Some("builtin:airhop-administrator"), "administrator")
            | (Some("builtin:airhop-analyst"), "analyst")
            | (Some("builtin:airhop-content-marketer"), "content_marketer")
    )
}

/// Select the product MCP only from trusted persona and team metadata. The
/// persisted free-form MCP field is deliberately not an executable selector.
pub(crate) fn effective_mcp_command(
    record: &ManagedAgentRecord,
    agent_command: &str,
) -> &'static str {
    let Some(runtime) = known_acp_runtime(agent_command) else {
        return "";
    };
    if runtime.id == "buzz-agent" && is_builtin_welcome_agent(record) {
        AGENT_MCP_COMMAND
    } else {
        runtime.mcp_command.unwrap_or("")
    }
}

/// Validate the configured authority while preserving `localhost` for the
/// child connection. Pair identity canonicalization remains a separate step.
pub(super) fn agent_connection_relay_url(relay_url: &str) -> Result<String, String> {
    let configured = relay_url.trim();
    if configured.is_empty() {
        return Err("relay URL must not be empty".to_string());
    }
    buzz_core_pkg::relay::normalize_relay_url(configured).map_err(|error| error.to_string())?;
    Ok(configured.to_string())
}
