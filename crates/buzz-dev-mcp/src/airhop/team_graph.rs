//! Shared role graph with a per-task cache. Authority remains in Core/relay tools.
use super::*;
use airhop_core::agent_graph::{ExecutionGraph, GraphAction};
use airhop_core::agent_policy::AgentRole;

pub(super) struct TeamGraph {
    pub(super) task: String,
    pub(super) settings: Option<Value>,
    execution: ExecutionGraph,
    cache: BTreeMap<String, Value>,
    completed: BTreeMap<String, Value>,
    pub(super) learning: airhop_core::agent_learning::LearningTrace,
}

impl TeamGraph {
    pub(super) fn new(role: AirhopRole) -> Self {
        let role = AgentRole::parse(role.as_str()).unwrap_or(AgentRole::Fizz);
        Self {
            task: String::new(),
            settings: None,
            execution: ExecutionGraph::new(role),
            cache: BTreeMap::new(),
            completed: BTreeMap::new(),
            learning: Default::default(),
        }
    }
    pub(super) fn start(&mut self, role: AirhopRole, task: String) -> Result<(), AirhopError> {
        if self.completed.contains_key(&task) {
            return Err(AirhopError(
                "This task already has a reply receipt. Do not repeat it.".into(),
            ));
        }
        if self.task != task {
            let completed = std::mem::take(&mut self.completed);
            *self = Self::new(role);
            self.completed = completed;
            self.task = task;
        }
        Ok(())
    }
    pub(super) fn prepare(
        &mut self,
        action: GraphAction,
        key: &str,
    ) -> Result<Option<Value>, AirhopError> {
        self.execution
            .prepare(action, key, self.cache.contains_key(key))
            .map_err(|e| AirhopError(e.into()))?;
        Ok(self.cache.get(key).map(|v| if matches!(action,GraphAction::Read|GraphAction::Context) {
            json!({"alreadyLoaded":true,"graph":self.guidance(),"instruction":"Use the facts already returned for this task. Read only missing facts."})
        } else {v.clone()}))
    }
    pub(super) fn finish(
        &mut self,
        action: GraphAction,
        key: String,
        result: Result<Value, AirhopError>,
    ) -> Result<Value, AirhopError> {
        match result {
            Ok(mut value) => {
                self.execution.succeeded(action);
                if matches!(
                    action,
                    GraphAction::Prepare | GraphAction::Commit | GraphAction::Delegate
                ) {
                    self.cache.clear();
                }
                if action == GraphAction::Commit {
                    self.settings = None;
                    self.execution.invalidate_context();
                }
                value["graph"] = self.guidance();
                self.cache.insert(key, value.clone());
                if action == GraphAction::Reply {
                    if self.completed.len() >= 64 {
                        if let Some(old) = self.completed.keys().next().cloned() {
                            self.completed.remove(&old);
                        }
                    }
                    self.completed.insert(self.task.clone(), value.clone());
                }
                Ok(value)
            }
            Err(e) => {
                self.execution.failed();
                self.learning.failed();
                Err(e)
            }
        }
    }
    pub(super) fn guidance(&self) -> Value {
        json!({"version":airhop_core::agent_graph::GRAPH_VERSION,"node":self.execution.node(),"remainingReads":self.execution.remaining_reads(),"remainingWrites":self.execution.remaining_writes(),"remainingAttempts":self.execution.remaining_attempts()})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cached_facts_do_not_repeat_backend_work_and_completed_tasks_stay_closed() {
        let mut graph = TeamGraph::new(AirhopRole::Administrator);
        graph
            .start(AirhopRole::Administrator, "task-1".into())
            .unwrap();
        assert!(graph.prepare(GraphAction::Reply, "reply").is_err());
        graph.prepare(GraphAction::Context, "context").unwrap();
        graph
            .finish(
                GraphAction::Context,
                "context".into(),
                Ok(json!({"fact":"current"})),
            )
            .unwrap();
        graph.prepare(GraphAction::Read, "family").unwrap();
        graph
            .finish(
                GraphAction::Read,
                "family".into(),
                Ok(json!({"privateFact":"large result"})),
            )
            .unwrap();
        let reads = graph.execution.remaining_reads();
        let repeated = graph.prepare(GraphAction::Read, "family").unwrap().unwrap();
        assert_eq!(repeated["alreadyLoaded"], true);
        assert!(repeated.get("privateFact").is_none());
        assert_eq!(graph.execution.remaining_reads(), reads);
        graph.prepare(GraphAction::Read, "family").unwrap();
        assert!(graph.prepare(GraphAction::Read, "family").is_err());
        graph
            .finish(
                GraphAction::Reply,
                "reply".into(),
                Ok(json!({"eventId":"receipt"})),
            )
            .unwrap();
        assert!(graph.prepare(GraphAction::Reply, "reply").is_err());
        assert!(graph
            .start(AirhopRole::Administrator, "task-1".into())
            .is_err());
        graph
            .start(AirhopRole::Administrator, "task-2".into())
            .unwrap();
        assert!(graph.settings.is_none());
        assert!(graph.cache.is_empty());
        assert!(graph.prepare(GraphAction::Read, "family").is_err());
    }
    #[test]
    fn failed_tasks_cannot_teach_and_mutations_drop_cached_facts() {
        let mut graph = TeamGraph::new(AirhopRole::Administrator);
        graph.prepare(GraphAction::Context, "context").unwrap();
        graph
            .finish(GraphAction::Context, "context".into(), Ok(json!({})))
            .unwrap();
        graph
            .learning
            .read(airhop_core::agent_learning::FactSource::Family);
        graph.prepare(GraphAction::Prepare, "prepare").unwrap();
        graph
            .finish(
                GraphAction::Prepare,
                "prepare".into(),
                Ok(json!({"actionId":"prepared"})),
            )
            .unwrap();
        assert!(!graph.cache.contains_key("context"));
        assert!(graph
            .finish(
                GraphAction::Commit,
                "commit".into(),
                Err(AirhopError("stale".into()))
            )
            .is_err());
        assert!(graph.learning.plan(AgentRole::Administrator).is_none());
    }
}
