use super::tests::fixture;
use crate::managed_agents::{types::RespondTo, ManagedAgentRuntimeKey};

#[test]
fn connection_preserves_configured_loopback_authority() {
    let configured = " ws://localhost:3030/ ";
    let connection = super::airhop::agent_connection_relay_url(configured).unwrap();
    let identity = ManagedAgentRuntimeKey::new("a".repeat(64), configured).unwrap();

    assert_eq!(connection, "ws://localhost:3030/");
    assert_eq!(identity.relay_url, "ws://127.0.0.1:3030");
}

#[test]
fn builtin_welcome_agents_use_airhop_mcp_with_trusted_runtimes() {
    for (persona_id, role) in [
        ("builtin:airhop-fizz", "fizz"),
        ("builtin:airhop-administrator", "administrator"),
        ("builtin:airhop-analyst", "analyst"),
        ("builtin:airhop-content-marketer", "content_marketer"),
    ] {
        let mut record = fixture(RespondTo::Anyone, vec![], Some("tag".into()));
        record.persona_id = Some(persona_id.into());
        record.team_id = Some("builtin-team:welcome".into());
        record
            .env_vars
            .insert("BUZZ_ACP_ROUTE_GATE".into(), "airhop".into());
        record
            .env_vars
            .insert("BUZZ_AIRHOP_ROLE".into(), role.into());

        for command in ["buzz-agent", "airhop-hermes-acp"] {
            assert!(super::airhop::require_product_runtime(&record, command).is_ok());
            assert_eq!(
                super::airhop::effective_mcp_command(&record, command),
                "airhop-agent-mcp"
            );
        }
        for command in [
            "hermes-acp",
            "claude-agent-acp",
            "codex-acp",
            "/custom/hermes-acp",
        ] {
            assert!(super::airhop::require_product_runtime(&record, command).is_err());
        }
    }
}

#[test]
fn non_welcome_agents_keep_catalog_mcp() {
    let mut record = fixture(RespondTo::Anyone, vec![], Some("tag".into()));
    record.persona_id = Some("builtin:airhop-fizz".into());
    record.team_id = Some("custom-team".into());
    record
        .env_vars
        .insert("BUZZ_ACP_ROUTE_GATE".into(), "airhop".into());
    record
        .env_vars
        .insert("BUZZ_AIRHOP_ROLE".into(), "fizz".into());

    assert_eq!(
        super::airhop::effective_mcp_command(&record, "buzz-agent"),
        "buzz-dev-mcp"
    );
    assert_eq!(
        super::airhop::effective_mcp_command(&record, "hermes-acp"),
        ""
    );
    assert!(super::airhop::require_product_runtime(&record, "hermes-acp").is_ok());
}

#[test]
fn hermes_profiles_are_separated_by_agent_and_center() {
    let first = ManagedAgentRuntimeKey::new("a".repeat(64), "wss://one.example").unwrap();
    let other_center = ManagedAgentRuntimeKey::new("a".repeat(64), "wss://two.example").unwrap();
    let other_agent = ManagedAgentRuntimeKey::new("b".repeat(64), "wss://one.example").unwrap();
    let profile = |key: &ManagedAgentRuntimeKey| {
        let mut command = std::process::Command::new("test");
        super::airhop::configure_hermes_profile(
            &mut command,
            std::path::Path::new("/profiles"),
            key,
            Some("deepseek"),
        );
        command
            .get_envs()
            .find(|(name, _)| *name == "AIRHOP_HERMES_RUNTIME_ROOT")
            .unwrap()
            .1
            .unwrap()
            .to_owned()
    };
    assert_ne!(profile(&first), profile(&other_center));
    assert_ne!(profile(&first), profile(&other_agent));
    assert_eq!(profile(&first), profile(&first));
}
