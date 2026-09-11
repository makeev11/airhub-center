//! Portable procedural experience contains source categories, never customer text.
use crate::agent_policy::AgentRole;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// An authoritative source category, resolved through the role's existing tools.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum FactSource {
    /// Scoped published knowledge.
    Knowledge,
    /// Current organization settings.
    Organization,
    /// Known family and its linked children; verified binding for external agents.
    Family,
    /// Branches, groups and available lessons.
    Schedule,
    /// Operational aggregate report.
    CenterAnalytics,
    /// Website aggregate report.
    SiteAnalytics,
    /// Attributed acquisition links.
    TrackingLinks,
}

/// A proposed reusable lookup order. It cannot contain executable code or write actions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProcedurePlan {
    /// Compatibility boundary; old graph versions never activate implicitly.
    pub graph_version: String,
    /// Successful source order observed in a completed task, without identifiers.
    pub sources: Vec<FactSource>,
}

/// A short structural trace; never stores queries, identifiers, text or tool results.
#[derive(Debug, Default)]
pub struct LearningTrace {
    sources: Vec<FactSource>,
    failed: bool,
}
impl LearningTrace {
    /// Records a successful authoritative source category at most once.
    pub fn read(&mut self, source: FactSource) {
        if !self.sources.contains(&source) {
            if self.sources.len() < 4 {
                self.sources.push(source);
            } else {
                self.failed = true;
            }
        }
    }
    /// A recovered/failed task is kept out of automatic candidate observations.
    pub fn failed(&mut self) {
        self.failed = true;
    }
    /// Produces an optional role-compatible candidate after a committed response.
    pub fn plan(&self, role: AgentRole) -> Option<ProcedurePlan> {
        let plan = ProcedurePlan {
            graph_version: crate::agent_graph::GRAPH_VERSION.into(),
            sources: self.sources.clone(),
        };
        (!self.failed && plan.validate(role).is_ok()).then_some(plan)
    }
}
impl ProcedurePlan {
    /// Checks bounded, distinct source categories against the immutable role boundary.
    pub fn validate(&self, role: AgentRole) -> Result<(), &'static str> {
        if self.graph_version != crate::agent_graph::GRAPH_VERSION {
            return Err("procedure graph version is incompatible");
        }
        if self.sources.is_empty() || self.sources.len() > 4 {
            return Err("procedure needs one to four sources");
        }
        let unique: std::collections::BTreeSet<_> = self.sources.iter().collect();
        if unique.len() != self.sources.len() {
            return Err("procedure sources must be distinct");
        }
        for source in &self.sources {
            let allowed = match source {
                FactSource::Knowledge | FactSource::Organization => true,
                FactSource::Family => matches!(
                    role,
                    AgentRole::Administrator | AgentRole::ParentAdministrator
                ),
                FactSource::Schedule => role != AgentRole::Analyst,
                FactSource::CenterAnalytics | FactSource::SiteAnalytics => {
                    matches!(role, AgentRole::Fizz | AgentRole::Analyst)
                }
                FactSource::TrackingLinks => matches!(
                    role,
                    AgentRole::Fizz | AgentRole::Analyst | AgentRole::ContentMarketer
                ),
            };
            if !allowed {
                return Err("procedure source exceeds this role's authority");
            }
        }
        Ok(())
    }
}

/// Signed learning commands. Observation and activation have separate server permissions.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
pub enum AgentLearningCommand {
    /// Record one completed task's structural experience idempotently.
    Observe {
        /// Product role of the registered signing agent.
        role: AgentRole,
        /// Actual server-committed response used as the observation receipt.
        #[serde(rename = "replyEventId")]
        reply_event_id: String,
        /// A data-free, non-executable procedure candidate.
        plan: ProcedurePlan,
    },
    /// Apply a reviewed candidate, or return to the base behavior with a null ID.
    Activate {
        /// Product role whose behavior is being reviewed.
        role: AgentRole,
        /// Existing compatible candidate, or null for rollback to base behavior.
        #[serde(rename = "procedureId")]
        #[schemars(with = "Option<String>")]
        procedure_id: Option<Uuid>,
        /// Optimistic version of the active procedure selection.
        #[serde(rename = "expectedVersion")]
        expected_version: i64,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn learned_procedures_never_expand_permissions_or_change_graph_contract() {
        for role in AgentRole::ALL {
            assert!(ProcedurePlan {
                graph_version: crate::agent_graph::GRAPH_VERSION.into(),
                sources: vec![FactSource::Knowledge]
            }
            .validate(role)
            .is_ok());
        }
        assert!(ProcedurePlan {
            graph_version: crate::agent_graph::GRAPH_VERSION.into(),
            sources: vec![FactSource::Family]
        }
        .validate(AgentRole::Analyst)
        .is_err());
        assert!(ProcedurePlan {
            graph_version: "future".into(),
            sources: vec![FactSource::Knowledge]
        }
        .validate(AgentRole::Fizz)
        .is_err());
        assert!(serde_json::from_value::<ProcedurePlan>(serde_json::json!({"graphVersion":crate::agent_graph::GRAPH_VERSION,"sources":["run_shell"]})).is_err());
    }
}
