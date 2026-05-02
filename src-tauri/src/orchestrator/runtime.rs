use std::fs;
use std::path::PathBuf;

use serde::Serialize;
use thiserror::Error;

use crate::orchestrator::{
    render_prompt, AgentRun, AgentRunRequest, AgentRunner, AttemptTemplateContext,
    OrchestratorEvent, OrchestratorIssue, OrchestratorSnapshot, OrchestratorState,
    PromptTemplateContext, QueueIssue, RunStatus, StateError, TrackerClient, TrackerError,
    WorkflowDefinition, WorkspaceManager, WorkspacePlan, WorkspaceTemplateContext,
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

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DispatchBatch {
    pub snapshot: OrchestratorSnapshot,
    pub claimed: Vec<QueueIssue>,
    pub started: Vec<DispatchedRun>,
    pub failed: Vec<DispatchFailure>,
    pub events: Vec<OrchestratorEvent>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DispatchedRun {
    pub issue: OrchestratorIssue,
    pub attempt_number: u32,
    pub workspace: WorkspacePlan,
    pub run: AgentRun,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DispatchFailure {
    pub issue: OrchestratorIssue,
    pub attempt_number: u32,
    pub workspace_path: Option<PathBuf>,
    pub error: String,
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
        self.claim_ready_from_issues(issues, timestamp)
    }

    pub fn dispatch_ready<R>(
        &mut self,
        workspace_manager: &WorkspaceManager,
        runner: &R,
        timestamp: &str,
    ) -> Result<DispatchBatch, OrchestratorRuntimeError>
    where
        R: AgentRunner,
    {
        let issues = self.tracker.fetch_issues()?;
        let claim_batch = self.claim_ready_from_issues(issues.clone(), timestamp)?;
        let mut events = claim_batch.events.clone();
        let mut started = Vec::new();
        let mut failed = Vec::new();

        for claim in &claim_batch.claimed {
            self.dispatch_claim(
                claim,
                workspace_manager,
                runner,
                timestamp,
                &mut started,
                &mut failed,
                &mut events,
            )?;
        }

        Ok(DispatchBatch {
            snapshot: self.state.snapshot(issues),
            claimed: claim_batch.claimed,
            started,
            failed,
            events,
        })
    }

    fn claim_ready_from_issues(
        &mut self,
        issues: Vec<OrchestratorIssue>,
        timestamp: &str,
    ) -> Result<ClaimBatch, OrchestratorRuntimeError> {
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

    fn dispatch_claim<R>(
        &mut self,
        claim: &QueueIssue,
        workspace_manager: &WorkspaceManager,
        runner: &R,
        timestamp: &str,
        started: &mut Vec<DispatchedRun>,
        failed: &mut Vec<DispatchFailure>,
        events: &mut Vec<OrchestratorEvent>,
    ) -> Result<(), OrchestratorRuntimeError>
    where
        R: AgentRunner,
    {
        let attempt_number = 1;
        let issue = &claim.issue;

        events.push(self.issue_event(
            issue,
            timestamp,
            RunStatus::PreparingWorkspace,
            None,
            Some(attempt_number),
            None,
            Some("preparing issue workspace".to_string()),
            None,
        ));
        let workspace = match workspace_manager.prepare_workspace(issue) {
            Ok(workspace) => workspace,
            Err(error) => {
                self.record_dispatch_failure(
                    issue,
                    attempt_number,
                    None,
                    timestamp,
                    error.to_string(),
                    failed,
                    events,
                );
                return Ok(());
            }
        };

        events.push(self.issue_event(
            issue,
            timestamp,
            RunStatus::RenderingPrompt,
            None,
            Some(attempt_number),
            Some(workspace.path.clone()),
            Some("rendering workflow prompt".to_string()),
            None,
        ));
        let prompt = match self.render_prompt_for_issue(issue, attempt_number, &workspace) {
            Ok(prompt) => prompt,
            Err(error) => {
                self.record_dispatch_failure(
                    issue,
                    attempt_number,
                    Some(workspace.path.clone()),
                    timestamp,
                    error.to_string(),
                    failed,
                    events,
                );
                return Ok(());
            }
        };
        if let Err(error) = fs::write(&workspace.prompt_file, &prompt) {
            self.record_dispatch_failure(
                issue,
                attempt_number,
                Some(workspace.path.clone()),
                timestamp,
                format!(
                    "failed to write prompt file {}: {error}",
                    workspace.prompt_file.display()
                ),
                failed,
                events,
            );
            return Ok(());
        }

        let request = AgentRunRequest {
            issue: issue.clone(),
            attempt_number,
            workspace: workspace.clone(),
            command: self.workflow.config.agent.command.clone(),
            args: self.workflow.config.agent.args.clone(),
            prompt,
            prompt_file: workspace.prompt_file.clone(),
        };
        let run = match runner.start(request) {
            Ok(run) => run,
            Err(error) => {
                self.record_dispatch_failure(
                    issue,
                    attempt_number,
                    Some(workspace.path.clone()),
                    timestamp,
                    error.to_string(),
                    failed,
                    events,
                );
                return Ok(());
            }
        };

        self.state.mark_running(
            &issue.id,
            &run.run_id,
            attempt_number,
            workspace.path.clone(),
            timestamp,
        )?;
        events.push(self.issue_event(
            issue,
            timestamp,
            RunStatus::Running,
            Some(run.run_id.clone()),
            Some(attempt_number),
            Some(workspace.path.clone()),
            Some("agent run started".to_string()),
            None,
        ));
        started.push(DispatchedRun {
            issue: issue.clone(),
            attempt_number,
            workspace,
            run,
        });

        Ok(())
    }

    fn render_prompt_for_issue(
        &self,
        issue: &OrchestratorIssue,
        attempt_number: u32,
        workspace: &WorkspacePlan,
    ) -> Result<String, crate::orchestrator::WorkflowError> {
        render_prompt(
            &self.workflow.prompt_template,
            &PromptTemplateContext {
                issue: issue.clone(),
                attempt: AttemptTemplateContext {
                    number: attempt_number,
                    previous_error: None,
                },
                workspace: WorkspaceTemplateContext {
                    path: workspace.path.clone(),
                },
                prompt_file: workspace.prompt_file.clone(),
            },
        )
    }

    fn record_dispatch_failure(
        &mut self,
        issue: &OrchestratorIssue,
        attempt_number: u32,
        workspace_path: Option<PathBuf>,
        timestamp: &str,
        error: String,
        failed: &mut Vec<DispatchFailure>,
        events: &mut Vec<OrchestratorEvent>,
    ) {
        self.state.release_issue(&issue.id, RunStatus::Failed);
        events.push(self.issue_event(
            issue,
            timestamp,
            RunStatus::Failed,
            None,
            Some(attempt_number),
            workspace_path.clone(),
            Some("agent dispatch failed".to_string()),
            Some(error.clone()),
        ));
        failed.push(DispatchFailure {
            issue: issue.clone(),
            attempt_number,
            workspace_path,
            error,
        });
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
        self.issue_event(
            issue,
            timestamp,
            RunStatus::Claimed,
            None,
            None,
            None,
            Some("issue claimed for dispatch".to_string()),
            None,
        )
    }

    fn issue_event(
        &self,
        issue: &OrchestratorIssue,
        timestamp: &str,
        status: RunStatus,
        run_id: Option<String>,
        attempt_number: Option<u32>,
        workspace_path: Option<PathBuf>,
        message: Option<String>,
        error: Option<String>,
    ) -> OrchestratorEvent {
        OrchestratorEvent {
            timestamp: timestamp.to_string(),
            workflow_path: self.workflow.path.clone(),
            issue_id: issue.id.clone(),
            issue_identifier: issue.identifier.clone(),
            run_id,
            attempt_number,
            status,
            workspace_path,
            message,
            error,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::fs;
    use std::rc::Rc;

    use tempfile::TempDir;

    use super::*;
    use crate::orchestrator::{
        load_workflow_from_path_with_env, AgentRun, AgentRunRequest, AgentRunner, AgentRunnerError,
        OrchestratorIssue, RunStatus, TrackerClient, TrackerError, WorkflowDefinition,
        WorkspaceManager,
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

    #[derive(Debug, Clone)]
    struct RecordingRunner {
        requests: Rc<RefCell<Vec<AgentRunRequest>>>,
        result: Result<AgentRun, AgentRunnerError>,
    }

    impl RecordingRunner {
        fn with_run(run_id: &str) -> Self {
            Self {
                requests: Rc::new(RefCell::new(Vec::new())),
                result: Ok(AgentRun {
                    run_id: run_id.to_string(),
                    process_id: Some(42),
                    stdout_log_path: None,
                    stderr_log_path: None,
                }),
            }
        }

        fn with_error(message: &str) -> Self {
            Self {
                requests: Rc::new(RefCell::new(Vec::new())),
                result: Err(AgentRunnerError::Start {
                    message: message.to_string(),
                }),
            }
        }
    }

    impl AgentRunner for RecordingRunner {
        fn start(&self, request: AgentRunRequest) -> Result<AgentRun, AgentRunnerError> {
            self.requests.borrow_mut().push(request);
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

    #[test]
    fn dispatch_ready_prepares_workspace_renders_prompt_and_starts_runner() {
        let (_dir, workflow) = workflow_fixture(1);
        let workspace_manager = WorkspaceManager::from_workflow(&workflow).unwrap();
        let tracker = StaticTracker::with_issues(vec![issue("issue-108", "#108", "open")]);
        let runner = RecordingRunner::with_run("run-108");
        let mut runtime = OrchestratorRuntime::new(workflow, tracker);

        let batch = runtime
            .dispatch_ready(&workspace_manager, &runner, "2026-05-02T08:15:00Z")
            .unwrap();

        assert_eq!(batch.claimed.len(), 1);
        assert_eq!(batch.started.len(), 1);
        assert!(batch.failed.is_empty());
        assert_eq!(batch.started[0].run.run_id, "run-108");
        assert_eq!(batch.started[0].attempt_number, 1);
        assert_eq!(batch.snapshot.queue[0].status, RunStatus::Running);
        assert_eq!(batch.snapshot.running[0].run_id, "run-108");
        assert_eq!(runtime.in_flight_count(), 1);

        let requests = runner.requests.borrow();
        assert_eq!(requests.len(), 1);
        let request = &requests[0];
        assert_eq!(request.issue.identifier, "#108");
        assert_eq!(request.command, "codex");
        assert_eq!(request.args, vec!["exec", "--ask-for-approval", "never"]);
        assert_eq!(request.attempt_number, 1);
        assert_eq!(request.workspace.path, batch.started[0].workspace.path);
        assert_eq!(request.prompt_file, batch.started[0].workspace.prompt_file);
        assert!(request.workspace.path.starts_with(workspace_manager.root()));
        assert!(request
            .prompt
            .contains("Fix #108 from attempt 1 in workspace"));
        assert!(request
            .prompt
            .contains(&request.workspace.path.display().to_string()));

        let prompt = fs::read_to_string(&request.prompt_file).unwrap();
        assert_eq!(prompt, request.prompt);

        let statuses: Vec<_> = batch.events.iter().map(|event| event.status).collect();
        assert_eq!(
            statuses,
            vec![
                RunStatus::Claimed,
                RunStatus::PreparingWorkspace,
                RunStatus::RenderingPrompt,
                RunStatus::Running
            ]
        );
    }

    #[test]
    fn dispatch_ready_releases_issue_as_failed_when_runner_start_fails() {
        let (_dir, workflow) = workflow_fixture(1);
        let workspace_manager = WorkspaceManager::from_workflow(&workflow).unwrap();
        let tracker = StaticTracker::with_issues(vec![issue("issue-108", "#108", "open")]);
        let runner = RecordingRunner::with_error("codex missing");
        let mut runtime = OrchestratorRuntime::new(workflow, tracker);

        let batch = runtime
            .dispatch_ready(&workspace_manager, &runner, "2026-05-02T08:15:00Z")
            .unwrap();

        assert!(batch.started.is_empty());
        assert_eq!(batch.failed.len(), 1);
        assert_eq!(batch.failed[0].issue.identifier, "#108");
        assert_eq!(batch.failed[0].attempt_number, 1);
        assert!(batch.failed[0].error.contains("codex missing"));
        assert_eq!(batch.snapshot.queue[0].status, RunStatus::Failed);
        assert!(batch.snapshot.running.is_empty());
        assert_eq!(runtime.in_flight_count(), 0);
        assert!(batch
            .events
            .iter()
            .any(|event| event.status == RunStatus::Failed
                && event.error.as_deref() == Some("failed to start agent: codex missing")));
    }

    fn workflow_with_max_concurrent(max_concurrent: u8) -> WorkflowDefinition {
        let (_dir, workflow) = workflow_fixture(max_concurrent);
        workflow
    }

    fn workflow_fixture(max_concurrent: u8) -> (TempDir, WorkflowDefinition) {
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
  args:
    - exec
    - --ask-for-approval
    - never
  max_concurrent: {max_concurrent}
---
Fix {{{{ issue.identifier }}}} from attempt {{{{ attempt.number }}}} in workspace {{{{ workspace.path }}}}.
"#
            ),
        )
        .unwrap();

        let workflow = load_workflow_from_path_with_env(&path, |name| {
            (name == "GITHUB_TOKEN").then_some("secret-token".to_string())
        })
        .unwrap();

        (dir, workflow)
    }
}
