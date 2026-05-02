use std::fs;
use std::path::PathBuf;

use chrono::{DateTime, Duration, SecondsFormat, Utc};
use serde::Serialize;
use thiserror::Error;

use crate::orchestrator::{
    render_prompt, ActiveWork, AgentRun, AgentRunExit, AgentRunRequest, AgentRunner,
    AgentRunnerError, AttemptTemplateContext, OrchestratorEvent, OrchestratorIssue,
    OrchestratorRun, OrchestratorSnapshot, OrchestratorState, PromptTemplateContext, QueueIssue,
    RetryEntry, RunStatus, StateError, TrackerClient, TrackerError, WorkflowDefinition,
    WorkspaceManager, WorkspacePlan, WorkspaceTemplateContext,
};

#[derive(Debug, Error, PartialEq, Eq)]
pub enum OrchestratorRuntimeError {
    #[error(transparent)]
    Tracker(#[from] TrackerError),
    #[error(transparent)]
    State(#[from] StateError),
    #[error(transparent)]
    Runner(#[from] AgentRunnerError),
    #[error("no orchestrator concurrency slots are available for issue: {issue_id}")]
    NoAvailableSlots { issue_id: String },
    #[error("invalid orchestrator timestamp {value}: {message}")]
    InvalidTimestamp { value: String, message: String },
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
pub struct ControlBatch {
    pub snapshot: OrchestratorSnapshot,
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
    pub fn snapshot(&mut self) -> Result<OrchestratorSnapshot, OrchestratorRuntimeError> {
        let issues = self.tracker.fetch_issues()?;
        self.reconcile_ineligible_work(&issues, None, &mut Vec::new());

        Ok(self.state.snapshot(issues))
    }

    pub fn claim_ready(&mut self, timestamp: &str) -> Result<ClaimBatch, OrchestratorRuntimeError> {
        let issues = self.tracker.fetch_issues()?;
        self.claim_ready_from_issues(issues, timestamp)
    }

    pub fn reconcile_finished_runs<R>(
        &mut self,
        runner: &R,
        timestamp: &str,
    ) -> Vec<OrchestratorEvent>
    where
        R: AgentRunner,
    {
        let mut events = Vec::new();

        for run in self.state.running_runs() {
            let Some(exit) = runner.take_finished(&run.run_id) else {
                continue;
            };
            let status = if exit.success {
                RunStatus::Succeeded
            } else {
                RunStatus::Failed
            };
            self.state.release_issue_with_error(
                &run.issue_id,
                status,
                (!exit.success).then(|| exit.message.clone()),
            );
            events.push(self.run_exit_event(&run, &exit, timestamp, status));
        }

        events
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
        let mut events = self.reconcile_finished_runs(runner, timestamp);
        let issues = self.tracker.fetch_issues()?;
        let claim_batch = self.claim_ready_from_issues(issues.clone(), timestamp)?;
        events.extend(claim_batch.events.clone());
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

    pub fn stop_run<R>(
        &mut self,
        runner: &R,
        issue_id: &str,
        timestamp: &str,
    ) -> Result<ControlBatch, OrchestratorRuntimeError>
    where
        R: AgentRunner,
    {
        let run = self.state.running_run(issue_id)?;
        runner.stop(&run)?;
        self.state.release_issue_with_error(
            issue_id,
            RunStatus::Stopped,
            Some("operator stopped agent run".to_string()),
        );

        let issues = self.tracker.fetch_issues()?;
        let mut events = vec![self.stop_event(&issues, &run, timestamp)];
        self.reconcile_ineligible_work(&issues, Some(timestamp), &mut events);

        Ok(ControlBatch {
            snapshot: self.state.snapshot(issues),
            events,
        })
    }

    pub fn retry_issue_now<R>(
        &mut self,
        workspace_manager: &WorkspaceManager,
        runner: &R,
        issue_id: &str,
        timestamp: &str,
    ) -> Result<DispatchBatch, OrchestratorRuntimeError>
    where
        R: AgentRunner,
    {
        let issues = self.tracker.fetch_issues()?;
        let mut events = self.reconcile_finished_runs(runner, timestamp);
        self.reconcile_ineligible_work(&issues, Some(timestamp), &mut events);

        self.state.ensure_issue_retryable(issue_id)?;
        let issue = issues
            .iter()
            .find(|issue| issue.id == issue_id && self.is_active_issue(issue))
            .cloned()
            .ok_or_else(|| StateError::IssueNotRetrying {
                issue_id: issue_id.to_string(),
            })?;
        if self.available_slots() == 0 {
            return Err(OrchestratorRuntimeError::NoAvailableSlots {
                issue_id: issue_id.to_string(),
            });
        }

        let claim = self.state.claim_manual_retry(&issue)?;
        events.push(self.retry_claim_event(&issue, &claim, timestamp));

        let mut started = Vec::new();
        let mut failed = Vec::new();
        self.dispatch_claim(
            &claim,
            workspace_manager,
            runner,
            timestamp,
            &mut started,
            &mut failed,
            &mut events,
        )?;

        Ok(DispatchBatch {
            snapshot: self.state.snapshot(issues),
            claimed: vec![claim],
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
        self.reconcile_ineligible_work(&issues, Some(timestamp), &mut events);

        if !self.state.is_paused() {
            let mut available_slots = self.available_slots();

            for issue in self.retry_claimable_issues(&issues, timestamp)? {
                if available_slots == 0 {
                    break;
                }

                let claim = self.state.claim_retry(&issue)?;
                events.push(self.retry_claim_event(&issue, &claim, timestamp));
                claimed.push(claim);
                available_slots -= 1;
            }

            let claimable: Vec<_> = issues
                .iter()
                .filter(|issue| self.is_auto_claimable_issue(issue))
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
        let issue = &claim.issue;
        let claimed_attempt = self.state.claimed_attempt(&issue.id)?;
        let attempt_number = claimed_attempt.attempt_number;

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
                )?;
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
        let prompt = match self.render_prompt_for_issue(
            issue,
            attempt_number,
            claimed_attempt.previous_error.as_deref(),
            &workspace,
        ) {
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
                )?;
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
            )?;
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
                )?;
                return Ok(());
            }
        };

        self.state.mark_running(
            &issue.id,
            &run.run_id,
            run.process_id,
            attempt_number,
            workspace.path.clone(),
            run.stdout_log_path.clone(),
            run.stderr_log_path.clone(),
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
        previous_error: Option<&str>,
        workspace: &WorkspacePlan,
    ) -> Result<String, crate::orchestrator::WorkflowError> {
        render_prompt(
            &self.workflow.prompt_template,
            &PromptTemplateContext {
                issue: issue.clone(),
                attempt: AttemptTemplateContext {
                    number: attempt_number,
                    previous_error: previous_error.map(ToString::to_string),
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
    ) -> Result<(), OrchestratorRuntimeError> {
        if let Some(retry) =
            self.retry_entry_for_failure(issue, attempt_number, timestamp, &error)?
        {
            self.state.schedule_retry(retry);
            events.push(self.issue_event(
                issue,
                timestamp,
                RunStatus::RetryScheduled,
                None,
                Some(attempt_number),
                workspace_path.clone(),
                Some("agent dispatch failed; retry scheduled".to_string()),
                Some(error.clone()),
            ));
        } else {
            self.state
                .release_issue_with_error(&issue.id, RunStatus::Failed, Some(error.clone()));
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
        }
        failed.push(DispatchFailure {
            issue: issue.clone(),
            attempt_number,
            workspace_path,
            error,
        });

        Ok(())
    }

    fn retry_claimable_issues(
        &self,
        issues: &[OrchestratorIssue],
        timestamp: &str,
    ) -> Result<Vec<OrchestratorIssue>, OrchestratorRuntimeError> {
        let mut claimable = Vec::new();

        for retry in self.state.retry_entries() {
            if !self.is_retry_due(&retry.next_retry_at, timestamp)? {
                continue;
            }

            if let Some(issue) = issues
                .iter()
                .find(|issue| issue.id == retry.issue_id && self.is_active_issue(issue))
            {
                claimable.push(issue.clone());
            }
        }

        Ok(claimable)
    }

    fn retry_entry_for_failure(
        &self,
        issue: &OrchestratorIssue,
        attempt_number: u32,
        timestamp: &str,
        error: &str,
    ) -> Result<Option<RetryEntry>, OrchestratorRuntimeError> {
        if attempt_number >= u32::from(self.workflow.config.agent.max_attempts) {
            return Ok(None);
        }

        Ok(Some(RetryEntry {
            issue_id: issue.id.clone(),
            issue_identifier: issue.identifier.clone(),
            attempt_number: attempt_number + 1,
            next_retry_at: self.next_retry_at(timestamp, attempt_number)?,
            last_error: error.to_string(),
        }))
    }

    fn next_retry_at(
        &self,
        timestamp: &str,
        failed_attempt_number: u32,
    ) -> Result<String, OrchestratorRuntimeError> {
        let timestamp = parse_timestamp(timestamp)?;
        let delay_ms = self.retry_delay_ms(failed_attempt_number);
        let delay_ms = delay_ms.min(i64::MAX as u64) as i64;
        let next_retry = timestamp + Duration::milliseconds(delay_ms);

        Ok(next_retry.to_rfc3339_opts(SecondsFormat::Millis, true))
    }

    fn retry_delay_ms(&self, failed_attempt_number: u32) -> u64 {
        let exponent = failed_attempt_number.saturating_sub(1).min(31);
        let multiplier = 1_u64 << exponent;

        self.workflow
            .config
            .polling
            .interval_ms
            .saturating_mul(multiplier)
            .min(self.workflow.config.agent.max_retry_backoff_ms)
    }

    fn is_retry_due(
        &self,
        next_retry_at: &str,
        timestamp: &str,
    ) -> Result<bool, OrchestratorRuntimeError> {
        Ok(parse_timestamp(next_retry_at)? <= parse_timestamp(timestamp)?)
    }

    fn reconcile_ineligible_work(
        &mut self,
        issues: &[OrchestratorIssue],
        timestamp: Option<&str>,
        events: &mut Vec<OrchestratorEvent>,
    ) {
        for work in self.state.active_work() {
            let issue = issues.iter().find(|issue| issue.id == work.issue_id);
            if issue.is_some_and(|issue| self.is_active_issue(issue)) {
                continue;
            }

            let status = self.release_status_for_work(work.status);
            self.state.release_issue(&work.issue_id, status);

            if let Some(timestamp) = timestamp {
                events.push(self.reconciliation_event(issue, &work, timestamp, status));
            }
        }
    }

    fn release_status_for_work(&self, status: RunStatus) -> RunStatus {
        if status == RunStatus::Running {
            RunStatus::Stopped
        } else {
            RunStatus::Released
        }
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

    fn is_auto_claimable_issue(&self, issue: &OrchestratorIssue) -> bool {
        self.is_active_issue(issue)
            && !self.state.is_issue_active(&issue.id)
            && !matches!(
                self.state.terminal_status(&issue.id),
                Some(RunStatus::Succeeded | RunStatus::Failed | RunStatus::Stopped)
            )
    }

    fn claim_event(&self, issue: &OrchestratorIssue, timestamp: &str) -> OrchestratorEvent {
        self.issue_event(
            issue,
            timestamp,
            RunStatus::Claimed,
            None,
            Some(1),
            None,
            Some("issue claimed for dispatch".to_string()),
            None,
        )
    }

    fn retry_claim_event(
        &self,
        issue: &OrchestratorIssue,
        claim: &QueueIssue,
        timestamp: &str,
    ) -> OrchestratorEvent {
        self.issue_event(
            issue,
            timestamp,
            RunStatus::Claimed,
            None,
            claim.attempt_number,
            None,
            Some("retry claimed for dispatch".to_string()),
            claim.last_error.clone(),
        )
    }

    fn reconciliation_event(
        &self,
        issue: Option<&OrchestratorIssue>,
        work: &ActiveWork,
        timestamp: &str,
        status: RunStatus,
    ) -> OrchestratorEvent {
        OrchestratorEvent {
            timestamp: timestamp.to_string(),
            workflow_path: self.workflow.path.clone(),
            issue_id: work.issue_id.clone(),
            issue_identifier: issue
                .map(|issue| issue.identifier.clone())
                .unwrap_or_else(|| work.issue_identifier.clone()),
            run_id: work.run_id.clone(),
            attempt_number: work.attempt_number,
            status,
            workspace_path: work.workspace_path.clone(),
            message: Some("issue no longer eligible; releasing orchestrator work".to_string()),
            error: work.last_error.clone(),
        }
    }

    fn stop_event(
        &self,
        issues: &[OrchestratorIssue],
        run: &OrchestratorRun,
        timestamp: &str,
    ) -> OrchestratorEvent {
        let issue = issues.iter().find(|issue| issue.id == run.issue_id);

        OrchestratorEvent {
            timestamp: timestamp.to_string(),
            workflow_path: self.workflow.path.clone(),
            issue_id: run.issue_id.clone(),
            issue_identifier: issue
                .map(|issue| issue.identifier.clone())
                .unwrap_or_else(|| run.issue_identifier.clone()),
            run_id: Some(run.run_id.clone()),
            attempt_number: Some(run.attempt_number),
            status: RunStatus::Stopped,
            workspace_path: Some(run.workspace_path.clone()),
            message: Some("operator stopped agent run".to_string()),
            error: None,
        }
    }

    fn run_exit_event(
        &self,
        run: &OrchestratorRun,
        exit: &AgentRunExit,
        timestamp: &str,
        status: RunStatus,
    ) -> OrchestratorEvent {
        OrchestratorEvent {
            timestamp: timestamp.to_string(),
            workflow_path: self.workflow.path.clone(),
            issue_id: run.issue_id.clone(),
            issue_identifier: run.issue_identifier.clone(),
            run_id: Some(run.run_id.clone()),
            attempt_number: Some(run.attempt_number),
            status,
            workspace_path: Some(run.workspace_path.clone()),
            message: Some(exit.message.clone()),
            error: (!exit.success).then(|| exit.message.clone()),
        }
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

fn parse_timestamp(timestamp: &str) -> Result<DateTime<Utc>, OrchestratorRuntimeError> {
    DateTime::parse_from_rfc3339(timestamp)
        .map(|timestamp| timestamp.with_timezone(&Utc))
        .map_err(|error| OrchestratorRuntimeError::InvalidTimestamp {
            value: timestamp.to_string(),
            message: error.to_string(),
        })
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::fs;
    use std::rc::Rc;

    use tempfile::TempDir;

    use super::*;
    use crate::orchestrator::{
        load_workflow_from_path_with_env, AgentRun, AgentRunExit, AgentRunRequest, AgentRunner,
        AgentRunnerError, OrchestratorIssue, RunStatus, TrackerClient, TrackerError,
        WorkflowDefinition, WorkspaceManager,
    };

    #[derive(Debug, Clone)]
    struct StaticTracker {
        result: Rc<RefCell<Result<Vec<OrchestratorIssue>, TrackerError>>>,
    }

    impl StaticTracker {
        fn with_issues(issues: Vec<OrchestratorIssue>) -> Self {
            Self {
                result: Rc::new(RefCell::new(Ok(issues))),
            }
        }

        fn with_error(message: &str) -> Self {
            Self {
                result: Rc::new(RefCell::new(Err(TrackerError::Transient {
                    message: message.to_string(),
                }))),
            }
        }

        fn set_issues(&self, issues: Vec<OrchestratorIssue>) {
            *self.result.borrow_mut() = Ok(issues);
        }
    }

    impl TrackerClient for StaticTracker {
        fn fetch_issues(&self) -> Result<Vec<OrchestratorIssue>, TrackerError> {
            self.result.borrow().clone()
        }
    }

    #[derive(Debug, Clone)]
    struct RecordingRunner {
        requests: Rc<RefCell<Vec<AgentRunRequest>>>,
        stopped_runs: Rc<RefCell<Vec<String>>>,
        exits: Rc<RefCell<Vec<AgentRunExit>>>,
        result: Result<AgentRun, AgentRunnerError>,
        stop_result: Result<(), AgentRunnerError>,
    }

    impl RecordingRunner {
        fn with_run(run_id: &str) -> Self {
            Self {
                requests: Rc::new(RefCell::new(Vec::new())),
                stopped_runs: Rc::new(RefCell::new(Vec::new())),
                exits: Rc::new(RefCell::new(Vec::new())),
                result: Ok(AgentRun {
                    run_id: run_id.to_string(),
                    process_id: Some(42),
                    stdout_log_path: None,
                    stderr_log_path: None,
                }),
                stop_result: Ok(()),
            }
        }

        fn with_error(message: &str) -> Self {
            Self {
                requests: Rc::new(RefCell::new(Vec::new())),
                stopped_runs: Rc::new(RefCell::new(Vec::new())),
                exits: Rc::new(RefCell::new(Vec::new())),
                result: Err(AgentRunnerError::Start {
                    message: message.to_string(),
                }),
                stop_result: Ok(()),
            }
        }

        fn push_exit(&self, exit: AgentRunExit) {
            self.exits.borrow_mut().push(exit);
        }
    }

    impl AgentRunner for RecordingRunner {
        fn start(&self, request: AgentRunRequest) -> Result<AgentRun, AgentRunnerError> {
            self.requests.borrow_mut().push(request);
            self.result.clone()
        }

        fn stop(&self, run: &OrchestratorRun) -> Result<(), AgentRunnerError> {
            self.stopped_runs.borrow_mut().push(run.run_id.clone());
            self.stop_result.clone()
        }

        fn take_finished(&self, run_id: &str) -> Option<AgentRunExit> {
            let mut exits = self.exits.borrow_mut();
            let index = exits.iter().position(|exit| exit.run_id == run_id)?;

            Some(exits.remove(index))
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
    fn claim_ready_releases_claimed_work_when_issue_becomes_ineligible() {
        let workflow = workflow_with_max_concurrent(1);
        let tracker = StaticTracker::with_issues(vec![issue("issue-1", "#1", "open")]);
        let mut runtime = OrchestratorRuntime::new(workflow, tracker.clone());

        let first = runtime.claim_ready("2026-05-02T07:55:00Z").unwrap();
        tracker.set_issues(vec![issue("issue-1", "#1", "closed")]);
        let second = runtime.claim_ready("2026-05-02T07:56:00Z").unwrap();

        assert_eq!(first.claimed.len(), 1);
        assert!(second.claimed.is_empty());
        assert_eq!(second.snapshot.queue[0].status, RunStatus::Released);
        assert_eq!(runtime.in_flight_count(), 0);
        assert!(second.events.iter().any(|event| {
            event.status == RunStatus::Released
                && event.issue_identifier == "#1"
                && event.message.as_deref()
                    == Some("issue no longer eligible; releasing orchestrator work")
        }));
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
    fn snapshot_releases_ineligible_active_work_without_requiring_dispatch() {
        let workflow = workflow_with_max_concurrent(1);
        let tracker = StaticTracker::with_issues(vec![issue("issue-1", "#1", "open")]);
        let mut runtime = OrchestratorRuntime::new(workflow, tracker.clone());

        runtime.claim_ready("2026-05-02T07:55:00Z").unwrap();
        tracker.set_issues(vec![issue("issue-1", "#1", "closed")]);
        let snapshot = runtime.snapshot().unwrap();

        assert_eq!(snapshot.queue[0].status, RunStatus::Released);
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
    fn stop_run_marks_running_work_stopped_and_calls_runner() {
        let (_dir, workflow) = workflow_fixture(1);
        let workspace_manager = WorkspaceManager::from_workflow(&workflow).unwrap();
        let tracker = StaticTracker::with_issues(vec![issue("issue-108", "#108", "open")]);
        let runner = RecordingRunner::with_run("run-108");
        let mut runtime = OrchestratorRuntime::new(workflow, tracker);

        runtime
            .dispatch_ready(&workspace_manager, &runner, "2026-05-02T08:15:00Z")
            .unwrap();
        let batch = runtime
            .stop_run(&runner, "issue-108", "2026-05-02T08:16:00Z")
            .unwrap();

        assert_eq!(runner.stopped_runs.borrow().as_slice(), ["run-108"]);
        assert!(batch.snapshot.running.is_empty());
        assert_eq!(batch.snapshot.queue[0].status, RunStatus::Stopped);
        assert_eq!(runtime.in_flight_count(), 0);
        assert_eq!(batch.events.len(), 1);
        assert_eq!(batch.events[0].status, RunStatus::Stopped);
        assert_eq!(batch.events[0].run_id.as_deref(), Some("run-108"));
        assert_eq!(
            batch.events[0].message.as_deref(),
            Some("operator stopped agent run")
        );
    }

    #[test]
    fn stop_run_rejects_non_running_issue() {
        let workflow = workflow_with_max_concurrent(1);
        let tracker = StaticTracker::with_issues(vec![issue("issue-108", "#108", "open")]);
        let runner = RecordingRunner::with_run("run-108");
        let mut runtime = OrchestratorRuntime::new(workflow, tracker);

        let error = runtime
            .stop_run(&runner, "issue-108", "2026-05-02T08:16:00Z")
            .unwrap_err();

        assert_eq!(
            error,
            OrchestratorRuntimeError::State(StateError::IssueNotRunning {
                issue_id: "issue-108".to_string()
            })
        );
        assert!(runner.stopped_runs.borrow().is_empty());
    }

    #[test]
    fn reconcile_finished_runs_marks_successful_run_succeeded() {
        let (_dir, workflow) = workflow_fixture(1);
        let workspace_manager = WorkspaceManager::from_workflow(&workflow).unwrap();
        let tracker = StaticTracker::with_issues(vec![issue("issue-108", "#108", "open")]);
        let runner = RecordingRunner::with_run("run-108");
        let mut runtime = OrchestratorRuntime::new(workflow, tracker);

        runtime
            .dispatch_ready(&workspace_manager, &runner, "2026-05-02T08:15:00Z")
            .unwrap();
        runner.push_exit(AgentRunExit {
            run_id: "run-108".to_string(),
            success: true,
            exit_code: Some(0),
            message: "agent process exited successfully".to_string(),
        });
        let events = runtime.reconcile_finished_runs(&runner, "2026-05-02T08:16:00Z");
        let snapshot = runtime.snapshot().unwrap();

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].status, RunStatus::Succeeded);
        assert_eq!(events[0].error, None);
        assert_eq!(snapshot.queue[0].status, RunStatus::Succeeded);
        assert!(snapshot.running.is_empty());
        assert_eq!(runtime.in_flight_count(), 0);
    }

    #[test]
    fn dispatch_ready_reconciles_failed_runs_before_claiming_new_work() {
        let (_dir, workflow) = workflow_fixture(1);
        let workspace_manager = WorkspaceManager::from_workflow(&workflow).unwrap();
        let tracker = StaticTracker::with_issues(vec![
            issue("issue-108", "#108", "open"),
            issue("issue-109", "#109", "open"),
        ]);
        let runner = RecordingRunner::with_run("run-108");
        let mut runtime = OrchestratorRuntime::new(workflow, tracker);

        runtime
            .dispatch_ready(&workspace_manager, &runner, "2026-05-02T08:15:00Z")
            .unwrap();
        runner.push_exit(AgentRunExit {
            run_id: "run-108".to_string(),
            success: false,
            exit_code: Some(1),
            message: "agent process exited with status 1".to_string(),
        });
        let batch = runtime
            .dispatch_ready(&workspace_manager, &runner, "2026-05-02T08:16:00Z")
            .unwrap();

        assert_eq!(batch.claimed.len(), 1);
        assert_eq!(batch.claimed[0].issue.identifier, "#109");
        assert_eq!(batch.started[0].issue.identifier, "#109");
        assert_eq!(batch.events[0].status, RunStatus::Failed);
        assert_eq!(
            batch.events[0].error.as_deref(),
            Some("agent process exited with status 1")
        );
        assert_eq!(batch.snapshot.queue[0].status, RunStatus::Failed);
        assert_eq!(batch.snapshot.queue[1].status, RunStatus::Running);
    }

    #[test]
    fn claim_ready_stops_running_work_when_issue_becomes_ineligible() {
        let (_dir, workflow) = workflow_fixture(1);
        let workspace_manager = WorkspaceManager::from_workflow(&workflow).unwrap();
        let tracker = StaticTracker::with_issues(vec![issue("issue-108", "#108", "open")]);
        let runner = RecordingRunner::with_run("run-108");
        let mut runtime = OrchestratorRuntime::new(workflow, tracker.clone());

        runtime
            .dispatch_ready(&workspace_manager, &runner, "2026-05-02T08:15:00Z")
            .unwrap();
        tracker.set_issues(vec![issue("issue-108", "#108", "closed")]);
        let batch = runtime.claim_ready("2026-05-02T08:16:00Z").unwrap();

        assert!(batch.claimed.is_empty());
        assert!(batch.snapshot.running.is_empty());
        assert_eq!(batch.snapshot.queue[0].status, RunStatus::Stopped);
        assert_eq!(runtime.in_flight_count(), 0);
        assert!(batch.events.iter().any(|event| {
            event.status == RunStatus::Stopped
                && event.run_id.as_deref() == Some("run-108")
                && event.workspace_path.is_some()
        }));
    }

    #[test]
    fn dispatch_ready_schedules_retry_when_runner_start_fails_before_max_attempts() {
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
        assert_eq!(batch.snapshot.queue[0].status, RunStatus::RetryScheduled);
        assert_eq!(batch.snapshot.retry_queue.len(), 1);
        assert_eq!(batch.snapshot.retry_queue[0].attempt_number, 2);
        assert_eq!(
            batch.snapshot.retry_queue[0].next_retry_at,
            "2026-05-02T08:15:30.000Z"
        );
        assert!(batch.snapshot.running.is_empty());
        assert_eq!(runtime.in_flight_count(), 0);
        assert!(batch
            .events
            .iter()
            .any(|event| event.status == RunStatus::RetryScheduled
                && event.error.as_deref() == Some("failed to start agent: codex missing")));
    }

    #[test]
    fn claim_ready_releases_retry_work_when_issue_becomes_ineligible() {
        let (_dir, workflow) = workflow_fixture(1);
        let workspace_manager = WorkspaceManager::from_workflow(&workflow).unwrap();
        let tracker = StaticTracker::with_issues(vec![issue("issue-108", "#108", "open")]);
        let runner = RecordingRunner::with_error("codex missing");
        let mut runtime = OrchestratorRuntime::new(workflow, tracker.clone());

        runtime
            .dispatch_ready(&workspace_manager, &runner, "2026-05-02T08:15:00Z")
            .unwrap();
        tracker.set_issues(vec![issue("issue-108", "#108", "closed")]);
        let batch = runtime.claim_ready("2026-05-02T08:16:00Z").unwrap();

        assert!(batch.claimed.is_empty());
        assert!(batch.snapshot.retry_queue.is_empty());
        assert_eq!(batch.snapshot.queue[0].status, RunStatus::Released);
        assert!(batch.events.iter().any(|event| {
            event.status == RunStatus::Released
                && event.error.as_deref() == Some("failed to start agent: codex missing")
        }));
    }

    #[test]
    fn dispatch_ready_retries_due_attempt_with_previous_error() {
        let (_dir, workflow) = workflow_fixture(1);
        let workspace_manager = WorkspaceManager::from_workflow(&workflow).unwrap();
        let tracker = StaticTracker::with_issues(vec![issue("issue-108", "#108", "open")]);
        let failing_runner = RecordingRunner::with_error("codex missing");
        let success_runner = RecordingRunner::with_run("run-108-retry");
        let mut runtime = OrchestratorRuntime::new(workflow, tracker);

        runtime
            .dispatch_ready(&workspace_manager, &failing_runner, "2026-05-02T08:15:00Z")
            .unwrap();
        let early = runtime
            .dispatch_ready(&workspace_manager, &success_runner, "2026-05-02T08:15:29Z")
            .unwrap();
        let retried = runtime
            .dispatch_ready(&workspace_manager, &success_runner, "2026-05-02T08:15:30Z")
            .unwrap();

        assert!(early.claimed.is_empty());
        assert!(early.started.is_empty());
        assert_eq!(early.snapshot.queue[0].status, RunStatus::RetryScheduled);
        assert_eq!(retried.claimed.len(), 1);
        assert_eq!(retried.claimed[0].attempt_number, Some(2));
        assert_eq!(retried.started.len(), 1);
        assert_eq!(retried.started[0].attempt_number, 2);
        assert_eq!(retried.snapshot.queue[0].status, RunStatus::Running);

        let requests = success_runner.requests.borrow();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].attempt_number, 2);
        assert!(requests[0]
            .prompt
            .contains("Previous error: failed to start agent: codex missing"));
        assert!(retried
            .events
            .iter()
            .any(|event| event.message.as_deref() == Some("retry claimed for dispatch")));
    }

    #[test]
    fn retry_issue_now_dispatches_retry_before_due_time() {
        let (_dir, workflow) = workflow_fixture(1);
        let workspace_manager = WorkspaceManager::from_workflow(&workflow).unwrap();
        let tracker = StaticTracker::with_issues(vec![issue("issue-108", "#108", "open")]);
        let failing_runner = RecordingRunner::with_error("codex missing");
        let success_runner = RecordingRunner::with_run("run-108-manual-retry");
        let mut runtime = OrchestratorRuntime::new(workflow, tracker);

        runtime
            .dispatch_ready(&workspace_manager, &failing_runner, "2026-05-02T08:15:00Z")
            .unwrap();
        let retried = runtime
            .retry_issue_now(
                &workspace_manager,
                &success_runner,
                "issue-108",
                "2026-05-02T08:15:05Z",
            )
            .unwrap();

        assert_eq!(retried.claimed.len(), 1);
        assert_eq!(retried.claimed[0].attempt_number, Some(2));
        assert_eq!(retried.started.len(), 1);
        assert_eq!(retried.started[0].run.run_id, "run-108-manual-retry");
        assert!(retried.snapshot.retry_queue.is_empty());
        assert_eq!(retried.snapshot.queue[0].status, RunStatus::Running);
        assert!(retried
            .events
            .iter()
            .any(|event| event.message.as_deref() == Some("retry claimed for dispatch")));
    }

    #[test]
    fn retry_issue_now_dispatches_failed_terminal_issue() {
        let (_dir, workflow) = workflow_fixture(1);
        let workspace_manager = WorkspaceManager::from_workflow(&workflow).unwrap();
        let tracker = StaticTracker::with_issues(vec![issue("issue-108", "#108", "open")]);
        let runner = RecordingRunner::with_run("run-108");
        let mut runtime = OrchestratorRuntime::new(workflow, tracker);

        runtime
            .dispatch_ready(&workspace_manager, &runner, "2026-05-02T08:15:00Z")
            .unwrap();
        runner.push_exit(AgentRunExit {
            run_id: "run-108".to_string(),
            success: false,
            exit_code: Some(1),
            message: "agent process exited with status 1".to_string(),
        });
        let retried = runtime
            .retry_issue_now(
                &workspace_manager,
                &runner,
                "issue-108",
                "2026-05-02T08:16:00Z",
            )
            .unwrap();

        assert_eq!(retried.claimed.len(), 1);
        assert_eq!(retried.claimed[0].attempt_number, Some(2));
        assert_eq!(
            retried.claimed[0].last_error.as_deref(),
            Some("agent process exited with status 1")
        );
        assert_eq!(retried.started.len(), 1);
        assert_eq!(retried.started[0].attempt_number, 2);
        assert_eq!(retried.snapshot.queue[0].status, RunStatus::Running);
        assert!(retried.events.iter().any(|event| {
            event.status == RunStatus::Failed
                && event.error.as_deref() == Some("agent process exited with status 1")
        }));

        let requests = runner.requests.borrow();
        assert_eq!(requests.len(), 2);
        assert!(requests[1]
            .prompt
            .contains("Previous error: agent process exited with status 1"));
    }

    #[test]
    fn retry_issue_now_dispatches_stopped_terminal_issue() {
        let (_dir, workflow) = workflow_fixture(1);
        let workspace_manager = WorkspaceManager::from_workflow(&workflow).unwrap();
        let tracker = StaticTracker::with_issues(vec![issue("issue-108", "#108", "open")]);
        let running_runner = RecordingRunner::with_run("run-108");
        let retry_runner = RecordingRunner::with_run("run-108-manual-retry");
        let mut runtime = OrchestratorRuntime::new(workflow, tracker);

        runtime
            .dispatch_ready(&workspace_manager, &running_runner, "2026-05-02T08:15:00Z")
            .unwrap();
        runtime
            .stop_run(&running_runner, "issue-108", "2026-05-02T08:15:30Z")
            .unwrap();
        let retried = runtime
            .retry_issue_now(
                &workspace_manager,
                &retry_runner,
                "issue-108",
                "2026-05-02T08:16:00Z",
            )
            .unwrap();

        assert_eq!(retried.claimed.len(), 1);
        assert_eq!(retried.claimed[0].attempt_number, Some(2));
        assert_eq!(
            retried.claimed[0].last_error.as_deref(),
            Some("operator stopped agent run")
        );
        assert_eq!(retried.started.len(), 1);
        assert_eq!(retried.started[0].attempt_number, 2);
        assert_eq!(retried.snapshot.queue[0].status, RunStatus::Running);

        let requests = retry_runner.requests.borrow();
        assert_eq!(requests.len(), 1);
        assert!(requests[0]
            .prompt
            .contains("Previous error: operator stopped agent run"));
    }

    #[test]
    fn retry_issue_now_respects_max_concurrent() {
        let (_dir, workflow) = workflow_fixture(1);
        let workspace_manager = WorkspaceManager::from_workflow(&workflow).unwrap();
        let tracker = StaticTracker::with_issues(vec![
            issue("issue-108", "#108", "open"),
            issue("issue-109", "#109", "open"),
        ]);
        let failing_runner = RecordingRunner::with_error("codex missing");
        let running_runner = RecordingRunner::with_run("run-109");
        let mut runtime = OrchestratorRuntime::new(workflow, tracker);

        runtime
            .dispatch_ready(&workspace_manager, &failing_runner, "2026-05-02T08:15:00Z")
            .unwrap();
        runtime
            .dispatch_ready(&workspace_manager, &running_runner, "2026-05-02T08:15:05Z")
            .unwrap();
        let error = runtime
            .retry_issue_now(
                &workspace_manager,
                &running_runner,
                "issue-108",
                "2026-05-02T08:15:06Z",
            )
            .unwrap_err();

        assert_eq!(
            error,
            OrchestratorRuntimeError::NoAvailableSlots {
                issue_id: "issue-108".to_string()
            }
        );
    }

    #[test]
    fn dispatch_ready_releases_issue_as_failed_after_max_attempts() {
        let (_dir, mut workflow) = workflow_fixture(1);
        workflow.config.agent.max_attempts = 1;
        let workspace_manager = WorkspaceManager::from_workflow(&workflow).unwrap();
        let tracker = StaticTracker::with_issues(vec![issue("issue-108", "#108", "open")]);
        let runner = RecordingRunner::with_error("codex missing");
        let mut runtime = OrchestratorRuntime::new(workflow, tracker);

        let batch = runtime
            .dispatch_ready(&workspace_manager, &runner, "2026-05-02T08:15:00Z")
            .unwrap();

        assert!(batch.started.is_empty());
        assert_eq!(batch.failed.len(), 1);
        assert_eq!(batch.snapshot.queue[0].status, RunStatus::Failed);
        assert!(batch.snapshot.retry_queue.is_empty());
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
Previous error: {{{{ attempt.previous_error }}}}.
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
