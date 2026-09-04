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

        for command in ["buzz-agent", "hermes-acp"] {
            assert_eq!(
                super::airhop::effective_mcp_command(&record, command),
                "airhop-agent-mcp"
            );
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
}
