//! Editable knowledge is data, never agent policy or an operational source of truth.
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// One optional question and its human-approved answer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KnowledgeQuestion {
    /// Editable prompt.
    pub question: String,
    /// Blank answers are excluded from agent artifacts.
    pub answer: String,
}

/// Canonical editable material. Published Markdown is derived from this source.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KnowledgeDraft {
    /// Human title.
    pub title: String,
    /// Stable topic, independent of title.
    pub topic: String,
    /// Content language, not interface language.
    pub locale: String,
    /// Parent-safe or staff-only.
    pub audience: String,
    /// Allows website content preparation, not automatic website publication.
    pub website_allowed: bool,
    /// Organization, branch or group.
    pub scope_type: String,
    /// Required for branch/group, forbidden for organization.
    pub scope_id: Option<Uuid>,
    /// Questionnaire source, including unanswered prompts.
    pub questions: Vec<KnowledgeQuestion>,
    /// Optional additional or imported text.
    pub markdown: String,
    /// Privately stored original attachment.
    pub source_id: Option<Uuid>,
}

impl KnowledgeDraft {
    /// Validates the bounded, non-executable authoring contract.
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.title.trim().is_empty() || self.title.chars().count() > 200 {
            return Err("title must contain 1..200 characters");
        }
        if self.topic.is_empty()
            || self.topic.len() > 80
            || !self
                .topic
                .bytes()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_')
        {
            return Err("invalid topic");
        }
        if !(2..=35).contains(&self.locale.len())
            || !self
                .locale
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-')
        {
            return Err("invalid locale");
        }
        if !matches!(self.audience.as_str(), "parent" | "staff")
            || (self.website_allowed && self.audience == "staff")
        {
            return Err("staff-only material cannot be used on a website");
        }
        if !matches!(
            (self.scope_type.as_str(), self.scope_id),
            ("organization", None) | ("branch" | "group", Some(_))
        ) {
            return Err("invalid knowledge scope");
        }
        if self.questions.len() > 30
            || self.questions.iter().any(|q| {
                q.question.trim().is_empty()
                    || q.question.chars().count() > 300
                    || q.answer.chars().count() > 10000
            })
        {
            return Err("invalid question or answer length");
        }
        if self.published_markdown().chars().count() > 50000 {
            return Err("material exceeds 50000 characters; split it into smaller topics");
        }
        if self.markdown.contains('\0')
            || self
                .questions
                .iter()
                .any(|q| q.question.contains('\0') || q.answer.contains('\0'))
        {
            return Err("binary content is not supported");
        }
        for event in pulldown_cmark::Parser::new(&self.published_markdown()) {
            match event {
                pulldown_cmark::Event::Html(_) | pulldown_cmark::Event::InlineHtml(_) => {
                    return Err("raw HTML is not allowed")
                }
                pulldown_cmark::Event::Start(pulldown_cmark::Tag::Image { .. }) => {
                    return Err("embedded images are not allowed; describe them in text")
                }
                pulldown_cmark::Event::Start(pulldown_cmark::Tag::Link { dest_url, .. })
                    if !(dest_url.starts_with("https://")
                        || dest_url.starts_with("http://")
                        || dest_url.starts_with("mailto:")) =>
                {
                    return Err("unsupported link scheme")
                }
                _ => {}
            }
        }
        Ok(())
    }

    /// Produces a stable artifact, omitting unanswered prompts.
    pub fn published_markdown(&self) -> String {
        let mut blocks = Vec::new();
        for q in &self.questions {
            if !q.answer.trim().is_empty() {
                blocks.push(format!(
                    "## {}\n\n{}",
                    q.question.trim().replace(['\r', '\n'], " "),
                    q.answer.trim()
                ));
            }
        }
        if !self.markdown.trim().is_empty() {
            blocks.push(self.markdown.trim().to_owned());
        }
        blocks.join("\n\n")
    }
}

/// Owner/admin command carried by a signed Nostr event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum KnowledgeCommand {
    /// Create or save a draft, without altering the active publication.
    Save {
        /// Material identifier, generated before the first save.
        id: Uuid,
        /// Last observed revision, or zero for creation.
        expected_version: i64,
        /// Complete editable source.
        draft: KnowledgeDraft,
    },
    /// Atomically activate precisely the reviewed draft revision.
    Publish {
        /// Material to publish.
        id: Uuid,
        /// Exact reviewed revision.
        expected_version: i64,
    },
    /// Withdraw an artifact immediately, preserving all history.
    Archive {
        /// Material to withdraw.
        id: Uuid,
        /// Last observed revision.
        expected_version: i64,
    },
    /// Copy an earlier revision into a new draft; never auto-publish it.
    Restore {
        /// Material to restore.
        id: Uuid,
        /// Last observed revision.
        expected_version: i64,
        /// Historical revision to copy into a new draft.
        revision: i64,
    },
}

impl KnowledgeCommand {
    /// Target identifier and optimistic version.
    pub fn target(&self) -> (Uuid, i64) {
        match self {
            Self::Save {
                id,
                expected_version,
                ..
            }
            | Self::Publish {
                id,
                expected_version,
            }
            | Self::Archive {
                id,
                expected_version,
            }
            | Self::Restore {
                id,
                expected_version,
                ..
            } => (*id, *expected_version),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn draft() -> KnowledgeDraft {
        KnowledgeDraft {
            title: "Первое занятие".into(),
            topic: "first_visit".into(),
            locale: "ru-RU".into(),
            audience: "parent".into(),
            website_allowed: false,
            scope_type: "organization".into(),
            scope_id: None,
            questions: vec![
                KnowledgeQuestion {
                    question: "Что взять?".into(),
                    answer: "Воду.".into(),
                },
                KnowledgeQuestion {
                    question: "Парковка?".into(),
                    answer: "  ".into(),
                },
            ],
            markdown: "".into(),
            source_id: None,
        }
    }
    #[test]
    fn unanswered_prompts_are_not_knowledge() {
        let d = draft();
        assert!(d.validate().is_ok());
        assert_eq!(d.published_markdown(), "## Что взять?\n\nВоду.");
    }
    #[test]
    fn private_website_and_unbound_scopes_are_rejected() {
        let mut d = draft();
        d.audience = "staff".into();
        d.website_allowed = true;
        assert!(d.validate().is_err());
        d.website_allowed = false;
        d.scope_type = "branch".into();
        assert!(d.validate().is_err());
    }

    #[test]
    fn published_content_is_non_executable_including_question_answers() {
        for text in [
            "<script>bad()</script>",
            "![track](https://example.test/pixel)",
            "[bad](javascript:alert)",
        ] {
            let mut d = draft();
            d.markdown = text.into();
            assert!(d.validate().is_err());
            d.markdown.clear();
            d.questions[0].answer = text.into();
            assert!(d.validate().is_err());
        }
        let mut d = draft();
        d.markdown = "[Правила](https://example.test/rules) и **вода**".into();
        assert!(d.validate().is_ok());
    }
}
