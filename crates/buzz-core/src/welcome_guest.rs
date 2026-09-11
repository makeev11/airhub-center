//! Closed guest-introduction envelope shared by Hermes and the relay.
//!
//! This is not a channel membership or a domain-tool grant. The relay must
//! separately authenticate the current deployment and invitation before using
//! `matches_reply`; envelope validation alone never grants publication rights.

use nostr::{Event, EventBuilder, EventId, Kind, PublicKey, Tag, Timestamp};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Stable stage marker understood by the Welcome orchestrator.
pub const HERMES_GUEST_STAGE: &str = "hermes_guest_intro";

/// Only the information required for one introduction reaches Hermes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GuestInvitation {
    /// Destination, verified against the server's Welcome registration.
    pub channel_id: Uuid,
    /// Durable invitation identity, not an arbitrary source message.
    pub invitation_id: EventId,
    /// Exact registered Hermes principal for this invitation.
    pub guest_pubkey: PublicKey,
    /// The organization's supported presentation language.
    pub language: GuestLanguage,
    /// Server-assigned stable timestamp for byte-identical retry payloads.
    pub created_at: u64,
}

/// Supported presentation languages; arbitrary prompt text is never accepted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GuestLanguage {
    /// Russian.
    Ru,
    /// English.
    En,
    /// Turkish.
    Tr,
    /// Portuguese.
    Pt,
}

impl GuestLanguage {
    /// Match the product locale, with an explicit English fallback.
    pub fn from_locale(locale: &str) -> Self {
        match locale
            .split(['-', '_'])
            .next()
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str()
        {
            "ru" => Self::Ru,
            "tr" => Self::Tr,
            "pt" => Self::Pt,
            _ => Self::En,
        }
    }

    /// A short, product-owned introduction rather than an executable prompt.
    pub const fn introduction(self) -> &'static str {
        match self {
            Self::Ru => "Я Гермес — общаюсь с родителями: отвечаю на вопросы и помогаю записаться на занятия. Например, родитель может написать подключённому Telegram-боту: «Хочу записать ребёнка на пробное». Переписку и мои ответы вы увидите в обращениях клиентов; здесь с настройкой поможет Физ.",
            Self::En => "I'm Hermes. I answer parents' questions and help them book classes. For example, a parent can message the connected Telegram bot: ‘I'd like to book a trial class for my child.’ You can follow our conversation in client inquiries; Fizz helps you with setup here.",
            Self::Tr => "Ben Hermes. Velilerin sorularını yanıtlar ve ders rezervasyonuna yardımcı olurum. Örneğin bir veli bağlı Telegram botuna ‘Çocuğum için deneme dersine kaydolmak istiyorum’ yazabilir. Görüşmelerimizi müşteri başvurularında görebilirsiniz; burada kurulum için Fizz yardımcı olur.",
            Self::Pt => "Sou Hermes. Respondo às dúvidas dos responsáveis e ajudo a agendar aulas. Por exemplo, alguém pode escrever ao bot conectado do Telegram: ‘Quero agendar uma aula experimental para meu filho.’ Você acompanha a conversa nos atendimentos; aqui, Fizz ajuda na configuração.",
        }
    }
}

impl GuestInvitation {
    fn tags(&self) -> Result<Vec<Tag>, nostr::event::tag::Error> {
        Ok(vec![
            Tag::parse(["h", &self.channel_id.to_string()])?,
            Tag::parse(["airhop-kickoff-stage", HERMES_GUEST_STAGE])?,
            Tag::parse(["airhop-guest-invitation", &self.invitation_id.to_hex()])?,
        ])
    }

    /// Build only the approved top-level introduction, with no mentions/thread.
    pub fn reply_builder(&self) -> Result<EventBuilder, nostr::event::tag::Error> {
        Ok(EventBuilder::new(
            Kind::Custom(crate::kind::KIND_STREAM_MESSAGE as u16),
            self.language.introduction(),
        )
        .custom_created_at(Timestamp::from_secs(self.created_at))
        .tags(self.tags()?))
    }

    /// Verify the exact signed reply. Callers must also verify server eligibility.
    pub fn matches_reply(&self, event: &Event) -> bool {
        event.pubkey == self.guest_pubkey
            && event.kind == Kind::Custom(crate::kind::KIND_STREAM_MESSAGE as u16)
            && event.created_at.as_secs() == self.created_at
            && event.content == self.language.introduction()
            && self
                .tags()
                .is_ok_and(|tags| event.tags.iter().eq(tags.iter()))
            && event.verify().is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::Keys;

    #[test]
    fn exact_guest_reply_is_replay_stable_and_fenced() {
        let keys = Keys::generate();
        let invitation = GuestInvitation {
            channel_id: Uuid::new_v4(),
            invitation_id: EventId::from_hex(&"a".repeat(64)).unwrap(),
            guest_pubkey: keys.public_key(),
            language: GuestLanguage::Ru,
            created_at: 100,
        };
        let reply = invitation
            .reply_builder()
            .unwrap()
            .sign_with_keys(&keys)
            .unwrap();
        let retry = invitation
            .reply_builder()
            .unwrap()
            .sign_with_keys(&keys)
            .unwrap();
        assert_eq!(reply.id, retry.id);
        assert!(invitation.matches_reply(&reply));
        assert!(!GuestInvitation {
            channel_id: Uuid::new_v4(),
            ..invitation.clone()
        }
        .matches_reply(&reply));
        assert!(!GuestInvitation {
            guest_pubkey: Keys::generate().public_key(),
            ..invitation.clone()
        }
        .matches_reply(&reply));
        let changed = EventBuilder::new(Kind::Custom(9), "arbitrary internal message")
            .tags(invitation.tags().unwrap())
            .custom_created_at(Timestamp::from_secs(100))
            .sign_with_keys(&keys)
            .unwrap();
        assert!(!invitation.matches_reply(&changed));
        let threaded = invitation
            .reply_builder()
            .unwrap()
            .tags([Tag::parse(["e", &"b".repeat(64)]).unwrap()])
            .sign_with_keys(&keys)
            .unwrap();
        assert!(!invitation.matches_reply(&threaded));
    }

    #[test]
    fn locales_are_closed_and_context_has_no_history_or_tools() {
        assert_eq!(GuestLanguage::from_locale("pt-BR"), GuestLanguage::Pt);
        assert_eq!(GuestLanguage::from_locale("RU-ru"), GuestLanguage::Ru);
        assert_eq!(GuestLanguage::from_locale("unknown"), GuestLanguage::En);
        let value = serde_json::json!({"channelId":Uuid::new_v4(), "invitationId":"a".repeat(64),
            "guestPubkey":Keys::generate().public_key(), "language":"ru", "createdAt":100,
            "history":"must not be supplied"});
        assert!(serde_json::from_value::<GuestInvitation>(value).is_err());
    }
}
