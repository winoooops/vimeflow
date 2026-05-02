use serde::Serialize;
use thiserror::Error;

use crate::orchestrator::{
    OrchestratorEvent, OrchestratorIssue, OrchestratorSnapshot, OrchestratorState, QueueIssue,
    RunStatus, StateError, TrackerClient, TrackerError, WorkflowDefinition,
};

#[derive(Debug, Error, PartialEq, Eq)]
pub enum OrchestratorRuntimeError {
    #[error(transparent)]
    Tracker(#[from] TrackerError),
    #[error(transparent)]
    State(#[from] StateError),
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClaimBatch {
    pub snapshot: OrchestratorSnapshot,
    pub claimed: Vec<QueueIssue>,
    pub events: Vec<OrchestratorEvent>,
}

#[derive(Debug, Clone)]
pub struct OrchestratorRuntime<T> {
    workflow: WorkflowDefinition,
    tracker: T,
    state: OrchestratorState,
}

impl<T> OrchestratorRuntime<T> {
    pub fn new(workflow: WorkflowDefinition, tracker: T) -> Self {
        Self {
            workflow,
            tracker,
            state: OrchestratorState::new(),
        }
    }

    pub fn set_paused(&mut self, paused: bool) {
        self.state.set_paused(paused);
    }

    pub fn in_flight_count(&self) -> usize {
        self.state.in_flight_count()
    }
}

impl<T> OrchestratorRuntime<T>
where
    T: TrackerClient,
{
    pub fn snapshot(&self) -> Result<OrchestratorSnapshot, OrchestratorRuntimeError> {
        let issues = self.tracker.fetch_issues()?;
        Ok(self.state.snapshot(issues))
    }

    pub fn claim_ready(&mut self, timestamp: &str) -> Result<ClaimBatch, OrchestratorRuntimeError> {
        let issues = self.tracker.fetch_issues()?;
        let mut claimed = Vec::new();
        let mut events = Vec::new();

        if !self.state.is_paused() {
            let available_slots = self.available_slots();
            let claimable: Vec<_> = issues
                .iter()
                .filter(|issue| self.is_active_issue(issue))
                .filter(|issue| !self.state.is_issue_active(&issue.id))
                .take(available_slots)
                .cloned()
                .collect();

            for issue in claimable {
                let claim = self.state.claim_issue(&issue)?;
                events.push(self.claim_event(&issue, timestamp));
                claimed.push(claim);
            }
        }

        Ok(ClaimBatch {
            snapshot: self.state.snapshot(issues),
            claimed,
            events,
        })
    }

    fn available_slots(&self) -> usize {
        usize::from(self.workflow.config.agent.max_concurrent)
            .saturating_sub(self.state.in_flight_count())
    }

    fn is_active_issue(&self, issue: &OrchestratorIssue) -> bool {
        self.workflow
            .config
            .tracker
            .active_states
            .iter()
            .any(|state| state == &issue.state)
    }

    fn claim_event(&self, issue: &OrchestratorIssue, timestamp: &str) -> OrchestratorEvent {
        OrchestratorEvent {
            timestamp: timestamp.to_string(),
            workflow_path: self.workflow.path.clone(),
            issue_id: issue.id.clone(),
            issue_identifier: issue.identifier.clone(),
            run_id: None,
            attempt_number: None,
            status: RunStatus::Claimed,
            workspace_path: None,
            message: Some("issue claimed for dispatch".to_string()),
            error: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;
    use crate::orchestrator::{
        load_workflow_from_path_with_env, OrchestratorIssue, RunStatus, TrackerClient,
        TrackerError, WorkflowDefinition,
    };

    #[derive(Debug, Clone)]
    struct StaticTracker {
        result: Result<Vec<OrchestratorIssue>, TrackerError>,
    }

    impl StaticTracker {
        fn with_issues(issues: Vec<OrchestratorIssue>) -> Self {
            Self { result: Ok(issues) }
        }

        fn with_error(message: &str) -> Self {
            Self {
                result: Err(TrackerError::Transient {
                    message: message.to_string(),
                }),
            }
        }
    }

    impl TrackerClient for StaticTracker {
        fn fetch_issues(&self) -> Result<Vec<OrchestratorIssue>, TrackerError> {
            self.result.clone()
        }
    }

    fn issue(id: &str, identifier: &str, state: &str) -> OrchestratorIssue {
        OrchestratorIssue {
            id: id.to_string(),
            identifier: identifier.to_string(),
            title: format!("Issue {identifier}"),
            description: None,
            state: state.to_string(),
            url: None,
            labels: Vec::new(),
            priority: None,
            updated_at: None,
        }
    }

    #[test]
    fn claim_ready_respects_workflow_max_concurrent() {
        let workflow = workflow_with_max_concurrent(2);
        let tracker = StaticTracker::with_issues(vec![
            issue("issue-1", "#1", "open"),
            issue("issue-2", "#2", "open"),
            issue("issue-3", "#3", "open"),
        ]);
        let mut runtime = OrchestratorRuntime::new(workflow, tracker);

        let batch = runtime.claim_ready("2026-05-02T07:55:00Z").unwrap();

        assert_eq!(batch.claimed.len(), 2);
        assert_eq!(batch.claimed[0].issue.identifier, "#1");
        assert_eq!(batch.claimed[1].issue.identifier, "#2");
        assert_eq!(batch.events.len(), 2);
        assert_eq!(batch.events[0].status, RunStatus::Claimed);
        assert_eq!(batch.snapshot.queue[0].status, RunStatus::Claimed);
        assert_eq!(batch.snapshot.queue[1].status, RunStatus::Claimed);
        assert_eq!(batch.snapshot.queue[2].status, RunStatus::Queued);
    }

    #[test]
    fn claim_ready_does_not_dispatch_same_issue_twice() {
        let workflow = workflow_with_max_concurrent(1);
        let tracker = StaticTracker::with_issues(vec![issue("issue-1", "#1", "open")]);
        let mut runtime = OrchestratorRuntime::new(workflow, tracker);

        let first = runtime.claim_ready("2026-05-02T07:55:00Z").unwrap();
        let second = runtime.claim_ready("2026-05-02T07:56:00Z").unwrap();

        assert_eq!(first.claimed.len(), 1);
        assert!(second.claimed.is_empty());
        assert_eq!(second.snapshot.queue[0].status, RunStatus::Claimed);
    }

    #[test]
    fn claim_ready_does_not_claim_when_paused() {
        let workflow = workflow_with_max_concurrent(1);
        let tracker = StaticTracker::with_issues(vec![issue("issue-1", "#1", "open")]);
        let mut runtime = OrchestratorRuntime::new(workflow, tracker);
        runtime.set_paused(true);

        let batch = runtime.claim_ready("2026-05-02T07:55:00Z").unwrap();

        assert!(batch.claimed.is_empty());
        assert!(batch.events.is_empty());
        assert!(batch.snapshot.paused);
        assert_eq!(batch.snapshot.queue[0].status, RunStatus::Queued);
    }

    #[test]
    fn claim_ready_skips_terminal_state_issues() {
        let workflow = workflow_with_max_concurrent(2);
        let tracker = StaticTracker::with_issues(vec![
            issue("issue-1", "#1", "closed"),
            issue("issue-2", "#2", "open"),
        ]);
        let mut runtime = OrchestratorRuntime::new(workflow, tracker);

        let batch = runtime.claim_ready("2026-05-02T07:55:00Z").unwrap();

        assert_eq!(batch.claimed.len(), 1);
        assert_eq!(batch.claimed[0].issue.identifier, "#2");
        assert_eq!(batch.snapshot.queue[0].status, RunStatus::Queued);
        assert_eq!(batch.snapshot.queue[1].status, RunStatus::Claimed);
    }

    #[test]
    fn claim_ready_surfaces_tracker_errors_without_claiming() {
        let workflow = workflow_with_max_concurrent(1);
        let tracker = StaticTracker::with_error("tracker unavailable");
        let mut runtime = OrchestratorRuntime::new(workflow, tracker);

        let error = runtime.claim_ready("2026-05-02T07:55:00Z").unwrap_err();

        assert!(matches!(error, OrchestratorRuntimeError::Tracker(_)));
        assert_eq!(runtime.in_flight_count(), 0);
    }

    fn workflow_with_max_concurrent(max_concurrent: u8) -> WorkflowDefinition {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("WORKFLOW.md");
        fs::write(
            &path,
            format!(
                r#"---
tracker:
  kind: github_issues
  owner: winoooops
  repo: vimeflow
  token: $GITHUB_TOKEN
  active_states:
    - open
  terminal_states:
    - closed
agent:
  command: codex
  max_concurrent: {max_concurrent}
---
Fix {{ issue.identifier }}.
"#
            ),
        )
        .unwrap();

        load_workflow_from_path_with_env(&path, |name| {
            (name == "GITHUB_TOKEN").then_some("secret-token".to_string())
        })
        .unwrap()
    }
}
