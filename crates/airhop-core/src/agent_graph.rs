//! Shared execution boundaries for every Airhop role. Domain tools choose facts.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::agent_policy::AgentRole;

/// Stable execution contract attached to traces and learned procedures.
pub const GRAPH_VERSION: &str = "airhop.agent-graph.v1";

/// Common states; role adapters can expose more specific domain states.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GraphNode {
    /// Resolve current actor, role, task, permissions and relevant facts.
    #[default]
    Context,
    /// Choose the missing facts or a direct answer.
    Decide,
    /// A bounded authoritative lookup is in progress.
    Read,
    /// An action has been prepared and needs its domain confirmation.
    AwaitConfirmation,
    /// An authorized mutation or delegation is in progress.
    Act,
    /// Use actual results to construct the final response.
    Reply,
    /// Recover from an error without erasing budgets or successful receipts.
    Recovery,
    /// A durable reply or handoff has completed this turn.
    Done,
}

/// Semantic edge categories; adapters retain typed domain validation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GraphAction {
    /// Initial or refreshed context.
    Context,
    /// Read only missing facts.
    Read,
    /// Prepare a domain change for confirmation.
    Prepare,
    /// Apply a domain-authorized change.
    Commit,
    /// Delegate one concrete task to another internal specialist.
    Delegate,
    /// Publish the final response or staff handoff.
    Reply,
}

/// Serializable per-turn state. Successful action receipts are stored by the adapter.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionGraph {
    role: AgentRole,
    node: GraphNode,
    context_loaded: bool,
    reads: u8,
    writes: u8,
    attempts: u8,
    recovery_contexts: u8,
    repeats: BTreeMap<String, u8>,
}

impl ExecutionGraph {
    /// Starts a new independently authorized task.
    pub fn new(role: AgentRole) -> Self {
        Self {
            role,
            node: GraphNode::Context,
            context_loaded: false,
            reads: 0,
            writes: 0,
            attempts: 0,
            recovery_contexts: 0,
            repeats: BTreeMap::new(),
        }
    }

    /// Current common execution state.
    pub const fn node(&self) -> GraphNode {
        self.node
    }

    /// Whether a valid context is available for publication and domain actions.
    pub const fn has_context(&self) -> bool {
        self.context_loaded
    }

    /// Remaining actual backend reads, excluding a bounded essential refresh reserve.
    pub fn remaining_reads(&self) -> u8 {
        self.read_limit().saturating_sub(self.reads)
    }

    /// Remaining domain mutation attempts.
    pub fn remaining_writes(&self) -> u8 {
        self.write_limit().saturating_sub(self.writes)
    }

    /// Remaining tool attempts, including repeats that use a local cache.
    pub fn remaining_attempts(&self) -> u8 {
        24u8.saturating_sub(self.attempts)
    }

    fn read_limit(&self) -> u8 {
        if self.role == AgentRole::ParentAdministrator {
            6
        } else {
            8
        }
    }

    fn write_limit(&self) -> u8 {
        match self.role {
            AgentRole::Analyst => 0,
            AgentRole::Fizz => 3,
            _ => 4,
        }
    }

    /// Checks an edge and reserves its attempt before execution. Cache hits count
    /// toward repetition limits, but do not repeat a backend read or mutation.
    pub fn prepare(
        &mut self,
        action: GraphAction,
        key: &str,
        cached: bool,
    ) -> Result<(), &'static str> {
        if self.node == GraphNode::Done {
            return Err("Reply already committed. End this turn.");
        }
        if action == GraphAction::Reply {
            return if self.context_loaded {
                Ok(())
            } else {
                Err("Load the authorized turn context before replying.")
            };
        }
        if action != GraphAction::Context && !self.context_loaded {
            return Err("Load the authorized turn context first.");
        }
        let essential_refresh =
            action == GraphAction::Context && !self.context_loaded && self.recovery_contexts < 2;
        if self.attempts >= 24 && !essential_refresh {
            return Err("Tool attempt limit reached. Reply with known facts or hand off.");
        }
        self.attempts = self.attempts.saturating_add(1);
        if cached {
            let count = self.repeats.entry(key.to_owned()).or_default();
            *count = count.saturating_add(1);
            if *count > 2 {
                return Err("This result is already available. Stop repeating this tool; answer or hand off.");
            }
            return Ok(());
        }
        match action {
            GraphAction::Context | GraphAction::Read => {
                if self.reads >= self.read_limit() {
                    if essential_refresh {
                        self.recovery_contexts += 1;
                    } else {
                        return Err("Enough lookups for this turn. Answer with available facts or hand off.");
                    }
                } else {
                    self.reads += 1;
                }
                self.node = if action == GraphAction::Context {
                    GraphNode::Context
                } else {
                    GraphNode::Read
                };
            }
            GraphAction::Delegate | GraphAction::Prepare | GraphAction::Commit => {
                if action == GraphAction::Delegate && self.role != AgentRole::Fizz {
                    return Err("Only Fizz may delegate internal tasks.");
                }
                if matches!(action, GraphAction::Prepare | GraphAction::Commit)
                    && matches!(self.role, AgentRole::Fizz | AgentRole::Analyst)
                {
                    return Err("This role does not mutate domain data.");
                }
                if self.writes >= self.write_limit() {
                    return Err("Action limit reached. Explain the current result or hand off.");
                }
                self.writes += 1;
                self.node = GraphNode::Act;
            }
            GraphAction::Reply => {}
        }
        Ok(())
    }

    /// Advances only after an authoritative successful result.
    pub fn succeeded(&mut self, action: GraphAction) {
        self.node = match action {
            GraphAction::Context => {
                self.context_loaded = true;
                GraphNode::Decide
            }
            GraphAction::Read => GraphNode::Decide,
            GraphAction::Prepare => GraphNode::AwaitConfirmation,
            GraphAction::Commit | GraphAction::Delegate => GraphNode::Reply,
            GraphAction::Reply => GraphNode::Done,
        };
    }

    /// Invalidates stale authority-dependent facts, retaining bounded refresh capacity.
    pub fn invalidate_context(&mut self) {
        self.context_loaded = false;
        self.node = GraphNode::Context;
    }

    /// Marks a failed operation without refunding attempts or removing receipts.
    pub fn failed(&mut self) {
        self.node = GraphNode::Recovery;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_role_requires_context_and_stops_after_publication() {
        for role in AgentRole::ALL {
            let mut graph = ExecutionGraph::new(role);
            assert!(graph.prepare(GraphAction::Reply, "reply", false).is_err());
            graph
                .prepare(GraphAction::Context, "context", false)
                .unwrap();
            graph.succeeded(GraphAction::Context);
            graph.prepare(GraphAction::Reply, "reply", false).unwrap();
            graph.succeeded(GraphAction::Reply);
            assert!(graph.prepare(GraphAction::Read, "lookup", false).is_err());
        }
    }

    #[test]
    fn cache_repetition_is_bounded_separately_from_io() {
        let mut graph = ExecutionGraph::new(AgentRole::Analyst);
        graph
            .prepare(GraphAction::Context, "context", false)
            .unwrap();
        graph.succeeded(GraphAction::Context);
        for _ in 0..2 {
            graph
                .prepare(GraphAction::Context, "context", true)
                .unwrap();
        }
        assert!(graph
            .prepare(GraphAction::Context, "context", true)
            .is_err());
        assert_eq!(graph.remaining_reads(), 7);
        assert!(graph.prepare(GraphAction::Reply, "reply", false).is_ok());
        assert!(graph
            .prepare(GraphAction::Commit, "mutation", false)
            .is_err());
    }

    #[test]
    fn required_handoff_context_has_a_finite_reserve() {
        let mut graph = ExecutionGraph::new(AgentRole::ParentAdministrator);
        graph
            .prepare(GraphAction::Context, "context", false)
            .unwrap();
        graph.succeeded(GraphAction::Context);
        for n in 0..5 {
            graph
                .prepare(GraphAction::Read, &format!("q{n}"), false)
                .unwrap();
            graph.succeeded(GraphAction::Read);
        }
        assert!(graph.prepare(GraphAction::Read, "another", false).is_err());
        for _ in 0..2 {
            graph.invalidate_context();
            graph
                .prepare(GraphAction::Context, "context", false)
                .unwrap();
            graph.succeeded(GraphAction::Context);
            assert!(graph.prepare(GraphAction::Reply, "handoff", false).is_ok());
        }
        graph.invalidate_context();
        assert!(graph
            .prepare(GraphAction::Context, "context", false)
            .is_err());
    }
}
