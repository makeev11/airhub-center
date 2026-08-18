use nostr::{EventBuilder, PublicKey, Tag};
use tauri::State;

use crate::{app_state::AppState, relay::submit_event};

const KICKOFF_STAGES: [&str; 5] = [
    "fizz_intro",
    "administrator_intro",
    "analyst_intro",
    "content_marketer_intro",
    "fizz_first_question",
];

pub(super) fn build_task(
    channel_id: uuid::Uuid,
    agent_pubkey: &str,
    task_id: &str,
    stage: &str,
    instruction: &str,
) -> Result<EventBuilder, String> {
    let agent_pubkey = PublicKey::from_hex(agent_pubkey.trim())
        .map_err(|error| format!("invalid Airhop agent pubkey: {error}"))?
        .to_hex();
    let task_id = task_id.trim();
    if task_id.is_empty() || task_id.len() > 240 {
        return Err("Airhop task id must contain 1..=240 characters".to_string());
    }
    if !KICKOFF_STAGES.contains(&stage) {
        return Err(format!("unsupported Airhop kickoff stage: {stage}"));
    }
    let instruction = instruction.trim();
    if instruction.is_empty() {
        return Err("Airhop task instruction is required".to_string());
    }
    let tags = [
        vec!["h".to_string(), channel_id.to_string()],
        vec!["p".to_string(), agent_pubkey],
        vec!["airhop-task".to_string(), task_id.to_string()],
        vec!["airhop-kickoff-stage".to_string(), stage.to_string()],
    ]
    .into_iter()
    .map(Tag::parse)
    .collect::<Result<Vec<_>, _>>()
    .map_err(|error| format!("invalid Airhop task tag: {error}"))?;

    Ok(EventBuilder::new(
        nostr::Kind::Custom(buzz_core_pkg::kind::KIND_AIRHOP_AGENT_TASK as u16),
        instruction,
    )
    .tags(tags))
}

#[tauri::command]
pub async fn dispatch_airhop_agent_task(
    channel_id: String,
    agent_pubkey: String,
    task_id: String,
    stage: String,
    instruction: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let channel_id = uuid::Uuid::parse_str(&channel_id)
        .map_err(|_| format!("invalid channel UUID: {channel_id}"))?;
    let builder = build_task(channel_id, &agent_pubkey, &task_id, &stage, &instruction)?;
    submit_event(builder, &state)
        .await
        .map(|result| result.event_id)
}
