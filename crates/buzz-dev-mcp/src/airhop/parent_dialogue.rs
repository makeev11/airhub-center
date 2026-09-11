//! Executable, lease-local dialogue graph. Core remains the authority for writes.

use std::collections::BTreeMap;
use std::time::Duration;

use airhop_core::agent_graph::{ExecutionGraph, GraphAction};
use airhop_core::agent_policy::AgentRole;
use airhop_core::conversation_booking::is_booking_confirmation;
use serde::Serialize;
use serde_json::{json, Value};
use tokio::time::Instant;

struct ReplyPacing {
    input_at: Instant,
    continuing: bool,
    confirmation: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Node {
    #[default]
    Context,
    ChooseRoute,
    DirectReply,
    Knowledge,
    Family,
    Options,
    Collecting,
    AwaitConfirmation,
    ConfirmBooking,
    Reply,
    Recovery,
    Done,
}

pub(super) struct Dialogue {
    pub(super) grant: String,
    node: Node,
    context: Option<Value>,
    execution: ExecutionGraph,
    results: BTreeMap<String, Value>,
    pub(super) reply_receipt: Option<Value>,
    turn_started_at: Option<Instant>,
    pacing: Option<ReplyPacing>,
    pub(super) learning: airhop_core::agent_learning::LearningTrace,
}

impl Default for Dialogue {
    fn default() -> Self {
        Self {
            grant: String::new(),
            node: Node::Context,
            context: None,
            execution: ExecutionGraph::new(AgentRole::ParentAdministrator),
            results: BTreeMap::new(),
            reply_receipt: None,
            turn_started_at: None,
            pacing: None,
            learning: Default::default(),
        }
    }
}

impl Dialogue {
    pub(super) fn context_data(&self) -> Option<Value> {
        self.context.clone()
    }
    pub(super) fn reset_for(&mut self, grant: String) {
        if self.grant != grant {
            *self = Self {
                grant,
                turn_started_at: Some(Instant::now()),
                ..Self::default()
            };
        }
    }

    pub(super) fn guidance(&self) -> Value {
        json!({
            "node": self.node,
            "next": match self.node {
                Node::Context => "airhop_get_turn_context",
                Node::ConfirmBooking => "airhop_commit_booking_draft; include confirmedReply to send immediately on confirmed receipt. Do not reload options or save the same draft.",
                Node::DirectReply | Node::Reply => "airhop_send_parent_reply: one concise answer; do not repeat successful operations.",
                Node::Done => "Stop: the reply is already committed.",
                Node::AwaitConfirmation => "Answer the current question. Correct changed fields only; commit only on current explicit consent. Do not repeat the form.",
                Node::Recovery => "Use the error to recover or hand off. Do not claim success. Further reads and writes remain bounded.",
                _ => "Use existing facts. Read only the missing facts for this question, or ask one useful clarification; then send one answer.",
            },
            "graphVersion": airhop_core::agent_graph::GRAPH_VERSION,
            "remainingReads": self.execution.remaining_reads(),
            "remainingWrites": self.execution.remaining_writes(),
            "remainingAttempts": self.execution.remaining_attempts(),
        })
    }

    pub(super) fn prepare(&mut self, request: &Value) -> Result<Option<Value>, String> {
        let operation = request["operation"].as_str().unwrap_or("");
        if self.node == Node::Done {
            return Err("Reply already committed. End this turn.".into());
        }
        let key = request.to_string();
        if let Some(result) = self.results.get(&key) {
            self.execution
                .prepare(graph_action(operation), &key, true)
                .map_err(str::to_owned)?;
            // A successful mutation receipt is safe to replay. Repeated reads
            // return a small reference instead of injecting the same large data.
            return Ok(Some(if is_read(operation) {
                json!({"alreadyLoaded": true, "operation": operation,
                    "instruction": "Use the result already returned in this turn. Do not repeat this read.",
                    "dialogue": self.guidance()})
            } else {
                result.clone()
            }));
        }
        if operation != "get_turn_context" && self.context.is_none() {
            return Err("Load airhop_get_turn_context before choosing a dialogue action.".into());
        }
        if operation == "get_family"
            && self.context.as_ref().and_then(|c| c.get("family")) == Some(&Value::Null)
        {
            return Err("This contact has no verified Family binding. Use the current dialogue; do not search for or read a family card.".into());
        }
        if self.node == Node::DirectReply && operation != "get_turn_context" {
            return Err("This is a standalone greeting. Answer from the available context; no lookup or booking action is needed.".into());
        }
        if self.node == Node::ConfirmBooking
            && !matches!(operation, "commit_booking_draft" | "get_turn_context")
        {
            return Err("The parent confirmed a ready draft. Commit its current version directly; do not repeat reads or change the draft. Core will recheck consent and availability.".into());
        }
        self.execution
            .prepare(graph_action(operation), &key, false)
            .map_err(str::to_owned)?;
        self.node = match operation {
            "search_knowledge" => Node::Knowledge,
            "get_family" => Node::Family,
            "list_booking_options" => Node::Options,
            _ => self.node,
        };
        Ok(None)
    }

    pub(super) fn observe(&mut self, request: &Value, response: &mut Value) {
        let operation = request["operation"].as_str().unwrap_or("");
        self.execution.succeeded(graph_action(operation));
        use airhop_core::agent_learning::FactSource;
        match operation {
            "get_family" => self.learning.read(FactSource::Family),
            "search_knowledge" => self.learning.read(FactSource::Knowledge),
            "list_booking_options" => self.learning.read(FactSource::Schedule),
            _ => {}
        }
        if operation == "get_turn_context" {
            let recovering = self.node == Node::Recovery;
            self.context = response.get("data").cloned();
            if self.pacing.is_none() {
                self.initialize_pacing();
            }
            self.node = if recovering {
                Node::Recovery
            } else {
                self.context_node()
            };
        } else if let Some(draft) = response.pointer("/data/bookingDraft") {
            if let Some(context) = self.context.as_mut() {
                context["bookingDraft"] = draft.clone();
            }
            self.node = if draft["state"] == "ready" {
                Node::AwaitConfirmation
            } else {
                Node::Collecting
            };
        } else if matches!(operation, "commit_booking_draft" | "manage_booking") {
            self.node = Node::Reply;
        } else if operation == "assign_conversation_branch" {
            // Branch routing and handoff targets must be refreshed after an
            // assignment, rather than using the old branch from our snapshot.
            self.context = None;
            self.execution.invalidate_context();
            self.node = Node::Context;
        }
        // A write may change facts previously read. Re-read is then allowed;
        // successful mutation receipts remain available for idempotent retries.
        if !is_read(operation) {
            self.results.retain(|key, _| {
                serde_json::from_str::<Value>(key)
                    .ok()
                    .is_some_and(|value| !is_read(value["operation"].as_str().unwrap_or("")))
            });
        }
        response["dialogue"] = self.guidance();
        self.results.insert(request.to_string(), response.clone());
    }

    pub(super) fn failed(&mut self) {
        self.node = Node::Recovery;
        self.learning.failed();
        self.execution.failed();
        // Keep successful mutation receipts but allow refreshing stale reads.
        self.results.retain(|key, _| {
            serde_json::from_str::<Value>(key)
                .ok()
                .is_some_and(|value| !is_read(value["operation"].as_str().unwrap_or("")))
        });
    }

    pub(super) fn validate_reply(&mut self, messages: &[String]) -> Result<(), String> {
        self.execution
            .prepare(GraphAction::Reply, "reply", false)
            .map_err(str::to_owned)?;
        if messages.is_empty() || messages.len() > 2 {
            return Err("Send one combined answer. A second message is allowed only for the exact booking preview.".into());
        }
        if messages.len() == 2 {
            let preview = self
                .context
                .as_ref()
                .and_then(|c| c.pointer("/bookingDraft/preview"))
                .and_then(Value::as_str);
            if preview != Some(messages[1].as_str()) || messages[0].trim() == messages[1].trim() {
                return Err("Combine the reply into one message. Keep a second message only for the unchanged booking preview, without duplication.".into());
            }
        }
        Ok(())
    }

    /// A minimum total response interval, never an extra delay after slow work.
    /// The first response, confirmations and recovery retain immediate delivery.
    pub(super) fn reply_delay(&self, message_chars: usize, now: Instant) -> Duration {
        let Some(pacing) = &self.pacing else {
            return Duration::ZERO;
        };
        if !pacing.continuing || pacing.confirmation || self.node == Node::Recovery {
            return Duration::ZERO;
        }
        let minimum = Duration::from_secs(match message_chars {
            0..=160 => 2,
            161..=450 => 3,
            _ => 4,
        });
        minimum.saturating_sub(now.saturating_duration_since(pacing.input_at))
    }

    fn initialize_pacing(&mut self) {
        let Some(context) = &self.context else {
            return;
        };
        let Some(messages) = context
            .pointer("/history/messages")
            .and_then(Value::as_array)
        else {
            return;
        };
        let source = context.pointer("/conversation/sourceMessageId");
        let Some(current) = messages.iter().find(|message| {
            Some(&message["id"]) == source
                && message["actor"] == "parent"
                && message["internal"] != true
        }) else {
            return;
        };
        let now = Instant::now();
        let input_at = current["receivedAt"]
            .as_str()
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
            .and_then(|received| {
                let elapsed = (chrono::Utc::now() - received.with_timezone(&chrono::Utc))
                    .to_std()
                    .unwrap_or_default();
                now.checked_sub(elapsed)
            })
            .unwrap_or_else(|| self.turn_started_at.unwrap_or(now));
        self.pacing = Some(ReplyPacing {
            input_at,
            continuing: messages.iter().any(|message| {
                matches!(message["actor"].as_str(), Some("hermes" | "staff"))
                    && message["internal"] == false
            }),
            confirmation: is_booking_confirmation(current["content"].as_str().unwrap_or("")),
        });
    }

    pub(super) fn sent(&mut self, receipt: Value) {
        self.reply_receipt = Some(receipt);
        self.execution.succeeded(GraphAction::Reply);
        self.node = Node::Done;
    }

    fn context_node(&self) -> Node {
        let Some(context) = &self.context else {
            return Node::ChooseRoute;
        };
        let messages = context
            .pointer("/history/messages")
            .and_then(Value::as_array);
        let source = context.pointer("/conversation/sourceMessageId");
        let current = messages.and_then(|messages| {
            messages.iter().find(|m| {
                Some(&m["id"]) == source && m["actor"] == "parent" && m["internal"] != true
            })
        });
        let text = current.and_then(|m| m["content"].as_str()).unwrap_or("");
        let state = context
            .pointer("/bookingDraft/state")
            .and_then(Value::as_str);
        if state == Some("ready") && is_booking_confirmation(text) {
            return Node::ConfirmBooking;
        }
        let normalized = text
            .trim()
            .trim_end_matches(['!', '.', '。'])
            .trim()
            .to_lowercase();
        if context["bookingDraft"].is_null()
            && messages.is_some_and(|m| m.len() == 1)
            && matches!(
                normalized.as_str(),
                "здравствуйте"
                    | "привет"
                    | "добрый день"
                    | "hello"
                    | "hi"
                    | "olá"
                    | "ola"
                    | "merhaba"
            )
        {
            return Node::DirectReply;
        }
        match state {
            Some("collecting") => Node::Collecting,
            Some("ready") => Node::AwaitConfirmation,
            _ => Node::ChooseRoute,
        }
    }
}

fn graph_action(operation: &str) -> GraphAction {
    match operation {
        "get_turn_context" => GraphAction::Context,
        "get_family" | "list_booking_options" | "search_knowledge" => GraphAction::Read,
        "save_booking_draft" => GraphAction::Prepare,
        _ => GraphAction::Commit,
    }
}

fn is_read(operation: &str) -> bool {
    matches!(
        operation,
        "get_turn_context" | "get_family" | "list_booking_options" | "search_knowledge"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn start(text: &str, draft: Value) -> Dialogue {
        let mut graph = Dialogue::default();
        graph.reset_for("lease-one".into());
        let request = json!({"operation":"get_turn_context"});
        assert!(graph.prepare(&request).unwrap().is_none());
        graph.observe(
            &request,
            &mut json!({"data":{
                "conversation":{"sourceMessageId":"current"},
                "history":{"messages":[{"id":"current","actor":"parent","content":text}]},
                "bookingDraft":draft,
            }}),
        );
        graph
    }

    #[test]
    fn greeting_needs_no_catalog_or_family_and_reply_finishes_the_graph() {
        let mut graph = start("Здравствуйте!", Value::Null);
        assert_eq!(graph.node, Node::DirectReply);
        for op in [
            "get_family",
            "search_knowledge",
            "list_booking_options",
            "save_booking_draft",
        ] {
            assert!(graph.prepare(&json!({"operation":op})).is_err());
        }
        graph
            .validate_reply(&["Здравствуйте! Чем могу помочь?".into()])
            .unwrap();
        graph.sent(json!({"status":"committed"}));
        assert!(graph
            .prepare(&json!({"operation":"get_turn_context"}))
            .is_err());
        graph.reset_for("lease-two".into());
        assert!(graph.reply_receipt.is_none());
        assert!(graph.prepare(&json!({"operation":"get_family"})).is_err());
    }

    #[test]
    fn reply_cannot_skip_authorized_context_or_its_pacing() {
        let mut graph = Dialogue::default();
        graph.reset_for("new-grant".into());
        assert!(graph.validate_reply(&["Hello".into()]).is_err());
        assert!(graph.reply_receipt.is_none());
    }

    #[test]
    fn branch_change_can_refresh_handoff_targets_after_regular_budget() {
        let mut graph = start("Нужна помощь с занятиями", Value::Null);
        for n in 0..5 {
            let request = json!({"operation":"search_knowledge","query":format!("query-{n}")});
            graph.prepare(&request).unwrap();
            graph.observe(&request, &mut json!({"data":[]}));
        }
        let assign = json!({"operation":"assign_conversation_branch","branchId":"known"});
        graph.prepare(&assign).unwrap();
        graph.observe(&assign, &mut json!({"data":{"assigned":true}}));
        let context = json!({"operation":"get_turn_context"});
        graph.prepare(&context).unwrap();
        graph.observe(&context, &mut json!({"data":{"handoffTargets":["staff"]}}));
        assert!(graph
            .validate_reply(&["Передаю администратору".into()])
            .is_ok());
    }

    #[test]
    fn exact_confirmation_skips_reads_but_corrections_and_questions_remain_flexible() {
        let draft = json!({"state":"ready","version":3,"preview":"Проверьте запись"});
        for text in ["Подтверждаю", "YES", "confirmo"] {
            let mut graph = start(text, draft.clone());
            assert_eq!(graph.node, Node::ConfirmBooking);
            assert!(graph
                .prepare(&json!({"operation":"list_booking_options"}))
                .is_err());
            assert!(graph
                .prepare(&json!({"operation":"save_booking_draft"}))
                .is_err());
            assert!(graph
                .prepare(&json!({"operation":"commit_booking_draft","version":3}))
                .unwrap()
                .is_none());
            graph.failed();
            assert!(graph
                .prepare(&json!({"operation":"list_booking_options"}))
                .unwrap()
                .is_none());
        }
        for text in [
            "ой, Путина",
            "да, но в другой день",
            "что принести?",
            "подтвердите, пожалуйста",
        ] {
            let mut graph = start(text, draft.clone());
            assert_eq!(graph.node, Node::AwaitConfirmation);
            assert!(graph
                .prepare(&json!({"operation":"search_knowledge","query":text}))
                .unwrap()
                .is_none());
        }
    }

    #[test]
    fn repeat_reads_are_small_and_writes_replay_their_receipt_without_another_action() {
        let mut graph = start("Что принести?", Value::Null);
        let read = json!({"operation":"search_knowledge","query":"Что принести?"});
        graph.prepare(&read).unwrap();
        graph.observe(&read, &mut json!({"data":{"text":"a".repeat(20_000)}}));
        let repeat = graph.prepare(&read).unwrap().unwrap();
        assert_eq!(repeat["alreadyLoaded"], true);
        assert!(repeat.to_string().len() < 1000);
        let write = json!({"operation":"save_booking_draft","expectedVersion":0,"data":{"childName":"Лида"}});
        graph.prepare(&write).unwrap();
        let mut receipt = json!({"data":{"bookingDraft":{"state":"collecting","version":1}}});
        graph.observe(&write, &mut receipt);
        assert_eq!(graph.prepare(&write).unwrap(), Some(receipt));
        // A write invalidates cached reads, so an actual change can be checked.
        assert!(graph.prepare(&read).unwrap().is_none());
        graph.reset_for("different-lease".into());
        assert!(graph.prepare(&write).is_err());
    }

    #[test]
    fn one_reply_or_answer_plus_exact_preview_without_duplicate_bubbles() {
        let mut graph = start(
            "ой, Путина",
            json!({"state":"ready","preview":"Новый итог"}),
        );
        assert!(graph
            .validate_reply(&["Имя исправлено".into(), "Новый итог".into()])
            .is_ok());
        assert!(graph
            .validate_reply(&["Первое".into(), "Второе".into()])
            .is_err());
        assert!(graph
            .validate_reply(&["Новый итог".into(), "Новый итог".into()])
            .is_err());
        assert!(graph.validate_reply(&vec!["Повтор".into(); 5]).is_err());
    }

    #[test]
    fn loops_are_bounded_even_when_queries_change_or_the_backend_fails() {
        let mut graph = start("Расскажите о занятиях", Value::Null);
        for n in 0..5 {
            graph
                .prepare(&json!({"operation":"search_knowledge","query":n.to_string()}))
                .unwrap();
            graph.failed();
        }
        assert!(graph
            .prepare(&json!({"operation":"search_knowledge","query":"ещё"}))
            .is_err());
        assert!(graph
            .validate_reply(&["Уточню этот вопрос у сотрудника.".into()])
            .is_ok());
    }

    #[test]
    fn pacing_is_a_total_interval_with_fast_first_reply_and_confirmation() {
        let now = Instant::now();
        let mut graph = start("Что взять?", Value::Null);
        assert_eq!(graph.reply_delay(600, now), Duration::ZERO);
        graph.pacing = Some(ReplyPacing {
            input_at: now,
            continuing: true,
            confirmation: false,
        });
        assert_eq!(graph.reply_delay(100, now), Duration::from_secs(2));
        assert_eq!(graph.reply_delay(300, now), Duration::from_secs(3));
        assert_eq!(graph.reply_delay(600, now), Duration::from_secs(4));
        assert_eq!(
            graph.reply_delay(300, now + Duration::from_millis(1800)),
            Duration::from_millis(1200)
        );
        assert_eq!(
            graph.reply_delay(600, now + Duration::from_secs(8)),
            Duration::ZERO
        );
        graph.pacing.as_mut().unwrap().confirmation = true;
        assert_eq!(graph.reply_delay(600, now), Duration::ZERO);
        graph.pacing.as_mut().unwrap().confirmation = false;
        graph.failed();
        assert_eq!(graph.reply_delay(600, now), Duration::ZERO);
        graph.reset_for("next-turn".into());
        assert!(graph.pacing.is_none());
    }

    #[test]
    fn authoritative_input_age_counts_and_internal_notes_are_not_a_first_reply() {
        for (internal, age_seconds, expect_delay) in
            [(true, 0, false), (false, 0, true), (false, 20, false)]
        {
            let mut graph = Dialogue::default();
            graph.reset_for("lease".into());
            let mut response = json!({"data":{
                "conversation":{"sourceMessageId":"current"},
                "history":{"messages":[
                    {"id":"prior","actor":"staff","internal":internal,"content":"Предыдущее"},
                    {"id":"current","actor":"parent","internal":false,"content":"Что взять?",
                        "receivedAt":(chrono::Utc::now() - chrono::Duration::seconds(age_seconds)).to_rfc3339()}
                ]},
            }});
            graph.observe(&json!({"operation":"get_turn_context"}), &mut response);
            assert_eq!(
                !graph.reply_delay(100, Instant::now()).is_zero(),
                expect_delay
            );
            let original = graph.pacing.as_ref().unwrap().input_at;
            graph.failed();
            graph.observe(&json!({"operation":"get_turn_context"}), &mut response);
            assert_eq!(graph.pacing.as_ref().unwrap().input_at, original);
        }
    }
}
