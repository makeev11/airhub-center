use crate::managed_agents::{known_acp_runtime, ManagedAgentRecord};

const WELCOME_TEAM_ID: &str = "builtin-team:welcome";
const AGENT_MCP_COMMAND: &str = "airhop-agent-mcp";
const HERMES_ACP_COMMAND: &str = "airhop-hermes-acp";

pub(super) fn is_builtin_welcome_agent(record: &ManagedAgentRecord) -> bool {
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
    let runtime = known_acp_runtime(agent_command);
    // Hermes is a tier-2 preset, so it is intentionally absent from the
    // tier-1 `known_acp_runtime` metadata table.
    let trusted_product_runtime = runtime.is_some_and(|runtime| runtime.id == "buzz-agent")
        || agent_command == HERMES_ACP_COMMAND;
    if trusted_product_runtime && is_builtin_welcome_agent(record) {
        AGENT_MCP_COMMAND
    } else {
        runtime
            .and_then(|runtime| runtime.mcp_command)
            .unwrap_or("")
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

/// Trusted profile identity includes both agent key and canonical relay authority.
pub(super) fn configure_hermes_profile(
    command: &mut std::process::Command,
    base: &std::path::Path,
    key: &crate::managed_agents::ManagedAgentRuntimeKey,
    provider: Option<&str>,
) {
    command.env(
        "AIRHOP_HERMES_RUNTIME_ROOT",
        base.join("hermes-profiles").join(key.runtime_id()),
    );
    if let Some(provider) = provider {
        command.env("AIRHOP_HERMES_PROVIDER", provider);
    }
}

/// Refuse a product runtime without its authoritative tools; generic runtimes
/// retain the existing optional-MCP behavior.
pub(super) fn resolve_mcp_command(
    record: &ManagedAgentRecord,
    agent_command: &str,
) -> Result<Option<std::path::PathBuf>, String> {
    let name = effective_mcp_command(record, agent_command);
    if name.is_empty() {
        return Ok(None);
    }
    let path = crate::managed_agents::resolve_command(name);
    if path.is_none() {
        if is_builtin_welcome_agent(record) {
            return Err(crate::managed_agents::missing_command_message(
                name,
                "Airhop product MCP",
            ));
        }
        eprintln!("buzz-desktop: mcp_command {name:?} not found, skipping");
    }
    Ok(path)
}

/// Shared built-in roles must use a runtime whose tools pass through the product graph.
/// Preserve saved custom choices, but refuse to expose a native host toolset to staff.
pub(super) fn require_product_runtime(
    record: &ManagedAgentRecord,
    command: &str,
) -> Result<(), String> {
    if is_builtin_welcome_agent(record)
        && effective_mcp_command(record, command) != AGENT_MCP_COMMAND
    {
        return Err("Airhop team agents require a product runtime with role-scoped tools. Select Airhop Hermes and install scripts/install-airhop-hermes-team.sh. The existing Buzz Agent product runtime is also supported.".into());
    }
    Ok(())
}
