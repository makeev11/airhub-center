//! Private, relay-authored status for a rejected internal-agent request.
//!
//! The source channel stays silent: policy and audience details are delivered
//! only to the human author in a two-party DM with the relay. The status event
//! is deterministic for a source event and denial reason, so retries and
//! concurrent instances cannot create duplicate messages.

use std::sync::Arc;

use buzz_core::{kind::KIND_STREAM_MESSAGE, TenantContext};
use buzz_db::{AirhopAgentRequestDenial, AirhopAgentRequestDenialReason};
use nostr::{Event, EventBuilder, Keys, Kind, Tag};

use crate::{
    airhop_payments::{nostr_timestamp, persist_message},
    handlers::side_effects::emit_group_discovery_events,
    state::AppState,
};

const STATUS_SENTINEL: &str = "buzz:agent-request-status";
const STATUS_TAG: &str = "airhop-agent-request-status";

/// Deliver one corrective status to the source author when the exact addressed
/// agent claimant observes a route denial.
pub async fn send_agent_request_denial(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    denial: &AirhopAgentRequestDenial,
) -> anyhow::Result<bool> {
    let relay_pubkey = state.relay_keypair.public_key().to_bytes();
    if denial.source_author_pubkey == relay_pubkey {
        return Ok(false);
    }

    let (dm, was_created) = state
        .db
        .open_dm(
            tenant.community(),
            &[denial.source_author_pubkey.as_slice()],
            relay_pubkey.as_slice(),
        )
        .await?;
    if was_created {
        metrics::counter!(
            "buzz_channels_created_total",
            "community" => tenant.host().to_owned(),
            "type" => "dm"
        )
        .increment(1);
    }
    state
        .db
        .unhide_dm(
            tenant.community(),
            dm.id,
            denial.source_author_pubkey.as_slice(),
        )
        .await?;
    emit_group_discovery_events(tenant, state, dm.id).await?;

    let event = build_status_event(&state.relay_keypair, denial, dm.id)?;
    persist_message(state, tenant, dm.id, &event, None, None, 0).await
}

fn build_status_event(
    relay_keypair: &Keys,
    denial: &AirhopAgentRequestDenial,
    dm_channel_id: uuid::Uuid,
) -> anyhow::Result<Event> {
    let source_id = hex::encode(denial.source_event_id);
    let payload = serde_json::json!({
        "version": 1,
        "source_event_id": source_id,
        "source_channel_id": denial.channel_id,
        "target_role": denial.target_role,
        "reason": denial.reason.as_str(),
    });
    let body = format!(
        "{}\n\n```{STATUS_SENTINEL}\n{}\n```",
        fallback_body(&denial.locale, denial.reason),
        payload
    );
    EventBuilder::new(Kind::from(KIND_STREAM_MESSAGE as u16), body)
        .tags([
            Tag::parse(["h", &dm_channel_id.to_string()])?,
            Tag::parse([
                STATUS_TAG,
                &source_id,
                denial.reason.as_str(),
                &denial.target_role,
                &denial.channel_id.to_string(),
            ])?,
        ])
        .custom_created_at(nostr_timestamp(denial.source_created_at)?)
        .sign_with_keys(relay_keypair)
        .map_err(Into::into)
}

fn fallback_body(locale: &str, reason: AirhopAgentRequestDenialReason) -> &'static str {
    match (locale, reason) {
        ("ru-RU", AirhopAgentRequestDenialReason::ExternalReaders) => {
            "Агент не ответил: канал доступен внешнему участнику. Проверьте участников канала или напишите агенту в личные сообщения."
        }
        ("ru-RU", AirhopAgentRequestDenialReason::AgentNotInChannel) => {
            "Агент не ответил: его нет среди участников канала. Добавьте агента в канал или напишите ему в личные сообщения."
        }
        ("ru-RU", AirhopAgentRequestDenialReason::AgentDisabled) => {
            "Агент не ответил: он выключен в настройках. Откройте настройки агентов, чтобы включить его."
        }
        ("ru-RU", AirhopAgentRequestDenialReason::PolicyDenied) => {
            "Агент не ответил: текущие настройки не разрешают ответы в этом канале. Проверьте доступ агента к каналам."
        }
        ("tr-TR", AirhopAgentRequestDenialReason::ExternalReaders) => {
            "Aracı yanıt vermedi: kanala harici bir katılımcı erişebiliyor. Kanal üyelerini kontrol edin veya aracıya doğrudan mesaj gönderin."
        }
        ("tr-TR", AirhopAgentRequestDenialReason::AgentNotInChannel) => {
            "Aracı yanıt vermedi: kanalın üyesi değil. Aracıyı kanala ekleyin veya doğrudan mesaj gönderin."
        }
        ("tr-TR", AirhopAgentRequestDenialReason::AgentDisabled) => {
            "Aracı yanıt vermedi: ayarlarda devre dışı. Etkinleştirmek için aracı ayarlarını açın."
        }
        ("tr-TR", AirhopAgentRequestDenialReason::PolicyDenied) => {
            "Aracı yanıt vermedi: mevcut ayarlar bu kanalda yanıta izin vermiyor. Aracının kanal erişimini kontrol edin."
        }
        ("pt-BR", AirhopAgentRequestDenialReason::ExternalReaders) => {
            "O agente não respondeu: um participante externo pode acessar o canal. Revise os membros ou envie uma mensagem direta ao agente."
        }
        ("pt-BR", AirhopAgentRequestDenialReason::AgentNotInChannel) => {
            "O agente não respondeu: ele não participa deste canal. Adicione-o ao canal ou envie uma mensagem direta."
        }
        ("pt-BR", AirhopAgentRequestDenialReason::AgentDisabled) => {
            "O agente não respondeu: está desativado nas configurações. Abra as configurações de agentes para ativá-lo."
        }
        ("pt-BR", AirhopAgentRequestDenialReason::PolicyDenied) => {
            "O agente não respondeu: as configurações atuais não permitem respostas neste canal. Revise o acesso do agente aos canais."
        }
        (_, AirhopAgentRequestDenialReason::ExternalReaders) => {
            "The agent did not reply because an external participant can read the channel. Review channel members or message the agent directly."
        }
        (_, AirhopAgentRequestDenialReason::AgentNotInChannel) => {
            "The agent did not reply because it is not a channel member. Add the agent or message it directly."
        }
        (_, AirhopAgentRequestDenialReason::AgentDisabled) => {
            "The agent did not reply because it is disabled. Open agent settings to enable it."
        }
        (_, AirhopAgentRequestDenialReason::PolicyDenied) => {
            "The agent did not reply because current settings do not allow replies in this channel. Review the agent's channel access."
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};
    use uuid::Uuid;

    #[test]
    fn fallback_is_localized_without_policy_details() {
        let message = fallback_body("ru-RU", AirhopAgentRequestDenialReason::ExternalReaders);
        assert!(message.contains("внешнему участнику"));
        assert!(!message.contains("pubkey"));
        assert!(!message.contains("parent_administrator"));
    }

    #[test]
    fn status_event_is_retry_stable_private_and_non_attributed() {
        let keys = Keys::generate();
        let channel_id = Uuid::new_v4();
        let denial = AirhopAgentRequestDenial {
            source_event_id: [7; 32],
            source_created_at: Utc.timestamp_opt(1_750_000_000, 0).unwrap(),
            source_author_pubkey: [8; 32],
            channel_id: Uuid::new_v4(),
            target_pubkey: [9; 32],
            target_role: "analyst".into(),
            locale: "ru-RU".into(),
            reason: AirhopAgentRequestDenialReason::ExternalReaders,
        };
        let first = build_status_event(&keys, &denial, channel_id).unwrap();
        let retry = build_status_event(&keys, &denial, channel_id).unwrap();
        assert_eq!(
            first.id, retry.id,
            "retries must deduplicate at event insert"
        );
        first.verify().unwrap();
        assert!(first.tags.iter().any(|tag| {
            tag.as_slice()
                .first()
                .is_some_and(|name| name == STATUS_TAG)
        }));
        assert!(!first.tags.iter().any(|tag| {
            matches!(
                tag.as_slice().first().map(String::as_str),
                Some("p" | "actor")
            )
        }));
        assert!(!first.content.contains(&hex::encode(denial.target_pubkey)));
    }
}
