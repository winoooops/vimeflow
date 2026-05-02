use std::collections::HashMap;
use std::path::PathBuf;

use serde::Serialize;
use thiserror::Error;

use crate::orchestrator::OrchestratorIssue;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Queued,
    Claimed,
    PreparingWorkspace,
    RenderingPrompt,
    Running,
    RetryScheduled,
    Succeeded,
    Failed,
    Stopped,
    Released,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QueueIssue {
    pub issue: OrchestratorIssue,
    pub status: RunStatus,
    pub run_id: Option<String>,
    pub attempt_number: Option<u32>,
    pub next_retry_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OrchestratorRun {
    pub run_id: String,
    pub process_id: Option<u32>,
    pub issue_id: String,
    pub issue_identifier: String,
    pub attempt_number: u32,
    pub status: RunStatus,
    pub workspace_path: PathBuf,
    pub stdout_log_path: Option<PathBuf>,
    pub stderr_log_path: Option<PathBuf>,
    pub started_at: String,
    pub last_event: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RetryEntry {
    pub issue_id: String,
    pub issue_identifier: String,
    pub attempt_number: u32,
    pub next_retry_at: String,
    pub last_error: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OrchestratorSnapshot {
    pub paused: bool,
    pub queue: Vec<QueueIssue>,
    pub running: Vec<OrchestratorRun>,
    pub retry_queue: Vec<RetryEntry>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OrchestratorEvent {
    pub timestamp: String,
    pub workflow_path: PathBuf,
    pub issue_id: String,
    pub issue_identifier: String,
    pub run_id: Option<String>,
    pub attempt_number: Option<u32>,
    pub status: RunStatus,
    pub workspace_path: Option<PathBuf>,
    pub message: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveWork {
    pub issue_id: String,
    pub issue_identifier: String,
    pub status: RunStatus,
    pub run_id: Option<String>,
    pub attempt_number: Option<u32>,
    pub workspace_path: Option<PathBuf>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TerminalEntry {
    status: RunStatus,
    attempt_number: Option<u32>,
    last_error: Option<String>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum StateError {
    #[error("issue is already claimed, running, or retrying: {issue_id}")]
    IssueAlreadyActive { issue_id: String },
    #[error("issue must be claimed before it can run: {issue_id}")]
    IssueNotClaimed { issue_id: String },
    #[error("issue is not running: {issue_id}")]
    IssueNotRunning { issue_id: String },
    #[error("issue is not scheduled for retry: {issue_id}")]
    IssueNotRetrying { issue_id: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaimedAttempt {
    pub issue_identifier: String,
    pub attempt_number: u32,
    pub previous_error: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct OrchestratorState {
    claimed: HashMap<String, ClaimedAttempt>,
    running: HashMap<String, OrchestratorRun>,
    retry_queue: HashMap<String, RetryEntry>,
    terminal_statuses: HashMap<String, TerminalEntry>,
    paused: bool,
}

impl OrchestratorState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_paused(&mut self, paused: bool) {
        self.paused = paused;
    }

    pub fn is_paused(&self) -> bool {
        self.paused
    }

    pub fn in_flight_count(&self) -> usize {
        self.claimed.len() + self.running.len()
    }

    pub fn is_issue_active(&self, issue_id: &str) -> bool {
        self.claimed.contains_key(issue_id)
            || self.running.contains_key(issue_id)
            || self.retry_queue.contains_key(issue_id)
    }

    pub fn claim_issue(&mut self, issue: &OrchestratorIssue) -> Result<QueueIssue, StateError> {
        if self.is_issue_active(&issue.id) {
            return Err(StateError::IssueAlreadyActive {
                issue_id: issue.id.clone(),
            });
        }

        self.terminal_statuses.remove(&issue.id);
        self.claimed.insert(
            issue.id.clone(),
            ClaimedAttempt {
                issue_identifier: issue.identifier.clone(),
                attempt_number: 1,
                previous_error: None,
            },
        );

        Ok(QueueIssue {
            issue: issue.clone(),
            status: RunStatus::Claimed,
            run_id: None,
            attempt_number: Some(1),
            next_retry_at: None,
            last_error: None,
        })
    }

    pub fn claim_retry(&mut self, issue: &OrchestratorIssue) -> Result<QueueIssue, StateError> {
        if self.claimed.contains_key(&issue.id) || self.running.contains_key(&issue.id) {
            return Err(StateError::IssueAlreadyActive {
                issue_id: issue.id.clone(),
            });
        }

        let Some(retry) = self.retry_queue.remove(&issue.id) else {
            return self.claim_issue(issue);
        };

        self.terminal_statuses.remove(&issue.id);
        self.claimed.insert(
            issue.id.clone(),
            ClaimedAttempt {
                issue_identifier: retry.issue_identifier,
                attempt_number: retry.attempt_number,
                previous_error: Some(retry.last_error.clone()),
            },
        );

        Ok(QueueIssue {
            issue: issue.clone(),
            status: RunStatus::Claimed,
            run_id: None,
            attempt_number: Some(retry.attempt_number),
            next_retry_at: None,
            last_error: Some(retry.last_error),
        })
    }

    pub fn ensure_issue_retryable(&self, issue_id: &str) -> Result<(), StateError> {
        if self.retry_queue.contains_key(issue_id) {
            return Ok(());
        }

        if matches!(
            self.terminal_statuses
                .get(issue_id)
                .map(|entry| entry.status),
            Some(RunStatus::Failed | RunStatus::Stopped)
        ) {
            return Ok(());
        }

        Err(StateError::IssueNotRetrying {
            issue_id: issue_id.to_string(),
        })
    }

    pub fn claim_manual_retry(
        &mut self,
        issue: &OrchestratorIssue,
    ) -> Result<QueueIssue, StateError> {
        self.ensure_issue_retryable(&issue.id)?;

        if self.retry_queue.contains_key(&issue.id) {
            return self.claim_retry(issue);
        }

        if self.claimed.contains_key(&issue.id) || self.running.contains_key(&issue.id) {
            return Err(StateError::IssueAlreadyActive {
                issue_id: issue.id.clone(),
            });
        }

        let terminal = self.terminal_statuses.remove(&issue.id).ok_or_else(|| {
            StateError::IssueNotRetrying {
                issue_id: issue.id.clone(),
            }
        })?;
        let attempt_number = terminal.attempt_number.unwrap_or(1).saturating_add(1);

        self.claimed.insert(
            issue.id.clone(),
            ClaimedAttempt {
                issue_identifier: issue.identifier.clone(),
                attempt_number,
                previous_error: terminal.last_error.clone(),
            },
        );

        Ok(QueueIssue {
            issue: issue.clone(),
            status: RunStatus::Claimed,
            run_id: None,
            attempt_number: Some(attempt_number),
            next_retry_at: None,
            last_error: terminal.last_error,
        })
    }

    pub fn claimed_attempt(&self, issue_id: &str) -> Result<ClaimedAttempt, StateError> {
        self.claimed
            .get(issue_id)
            .cloned()
            .ok_or_else(|| StateError::IssueNotClaimed {
                issue_id: issue_id.to_string(),
            })
    }

    pub fn mark_running(
        &mut self,
        issue_id: &str,
        run_id: &str,
        process_id: Option<u32>,
        attempt_number: u32,
        workspace_path: PathBuf,
        stdout_log_path: Option<PathBuf>,
        stderr_log_path: Option<PathBuf>,
        started_at: &str,
    ) -> Result<(), StateError> {
        let claimed_attempt = self.claimed_attempt(issue_id)?;

        self.claimed.remove(issue_id);
        self.running.insert(
            issue_id.to_string(),
            OrchestratorRun {
                run_id: run_id.to_string(),
                process_id,
                issue_id: issue_id.to_string(),
                issue_identifier: claimed_attempt.issue_identifier,
                attempt_number,
                status: RunStatus::Running,
                workspace_path,
                stdout_log_path,
                stderr_log_path,
                started_at: started_at.to_string(),
                last_event: None,
            },
        );
        Ok(())
    }

    pub fn schedule_retry(&mut self, entry: RetryEntry) {
        self.claimed.remove(&entry.issue_id);
        self.running.remove(&entry.issue_id);
        self.terminal_statuses.remove(&entry.issue_id);
        self.retry_queue.insert(entry.issue_id.clone(), entry);
    }

    pub fn retry_entries(&self) -> Vec<RetryEntry> {
        let mut entries: Vec<_> = self.retry_queue.values().cloned().collect();
        entries.sort_by(|left, right| left.issue_identifier.cmp(&right.issue_identifier));
        entries
    }

    pub fn running_run(&self, issue_id: &str) -> Result<OrchestratorRun, StateError> {
        self.running
            .get(issue_id)
            .cloned()
            .ok_or_else(|| StateError::IssueNotRunning {
                issue_id: issue_id.to_string(),
            })
    }

    pub fn running_runs(&self) -> Vec<OrchestratorRun> {
        let mut runs: Vec<_> = self.running.values().cloned().collect();
        runs.sort_by(|left, right| left.issue_identifier.cmp(&right.issue_identifier));
        runs
    }

    pub fn retry_entry(&self, issue_id: &str) -> Result<RetryEntry, StateError> {
        self.retry_queue
            .get(issue_id)
            .cloned()
            .ok_or_else(|| StateError::IssueNotRetrying {
                issue_id: issue_id.to_string(),
            })
    }

    pub fn terminal_status(&self, issue_id: &str) -> Option<RunStatus> {
        self.terminal_statuses
            .get(issue_id)
            .map(|entry| entry.status)
    }

    pub fn active_work(&self) -> Vec<ActiveWork> {
        let mut work = Vec::new();

        work.extend(self.claimed.iter().map(|(issue_id, claim)| ActiveWork {
            issue_id: issue_id.clone(),
            issue_identifier: claim.issue_identifier.clone(),
            status: RunStatus::Claimed,
            run_id: None,
            attempt_number: Some(claim.attempt_number),
            workspace_path: None,
            last_error: claim.previous_error.clone(),
        }));
        work.extend(self.running.values().map(|run| ActiveWork {
            issue_id: run.issue_id.clone(),
            issue_identifier: run.issue_identifier.clone(),
            status: RunStatus::Running,
            run_id: Some(run.run_id.clone()),
            attempt_number: Some(run.attempt_number),
            workspace_path: Some(run.workspace_path.clone()),
            last_error: None,
        }));
        work.extend(self.retry_queue.values().map(|retry| ActiveWork {
            issue_id: retry.issue_id.clone(),
            issue_identifier: retry.issue_identifier.clone(),
            status: RunStatus::RetryScheduled,
            run_id: None,
            attempt_number: Some(retry.attempt_number),
            workspace_path: None,
            last_error: Some(retry.last_error.clone()),
        }));
        work.sort_by(|left, right| left.issue_identifier.cmp(&right.issue_identifier));
        work
    }

    pub fn release_issue(&mut self, issue_id: &str, status: RunStatus) {
        self.release_issue_with_error(issue_id, status, None);
    }

    pub fn release_issue_with_error(
        &mut self,
        issue_id: &str,
        status: RunStatus,
        last_error: Option<String>,
    ) {
        let terminal = self.terminal_context(issue_id, status, last_error);
        self.claimed.remove(issue_id);
        self.running.remove(issue_id);
        self.retry_queue.remove(issue_id);
        self.terminal_statuses
            .insert(issue_id.to_string(), terminal);
    }

    pub fn record_terminal_issue(
        &mut self,
        issue: &OrchestratorIssue,
        status: RunStatus,
        attempt_number: Option<u32>,
        last_error: Option<String>,
    ) -> Result<(), StateError> {
        if self.is_issue_active(&issue.id) {
            return Err(StateError::IssueAlreadyActive {
                issue_id: issue.id.clone(),
            });
        }

        self.terminal_statuses.insert(
            issue.id.clone(),
            TerminalEntry {
                status,
                attempt_number,
                last_error,
            },
        );

        Ok(())
    }

    pub fn snapshot(&self, issues: Vec<OrchestratorIssue>) -> OrchestratorSnapshot {
        let mut running: Vec<_> = self.running.values().cloned().collect();
        running.sort_by(|left, right| left.issue_identifier.cmp(&right.issue_identifier));

        let mut retry_queue: Vec<_> = self.retry_queue.values().cloned().collect();
        retry_queue.sort_by(|left, right| left.issue_identifier.cmp(&right.issue_identifier));

        let queue = issues
            .into_iter()
            .map(|issue| self.queue_issue(issue))
            .collect();

        OrchestratorSnapshot {
            paused: self.paused,
            queue,
            running,
            retry_queue,
        }
    }

    fn queue_issue(&self, issue: OrchestratorIssue) -> QueueIssue {
        if let Some(run) = self.running.get(&issue.id) {
            return QueueIssue {
                issue,
                status: RunStatus::Running,
                run_id: Some(run.run_id.clone()),
                attempt_number: Some(run.attempt_number),
                next_retry_at: None,
                last_error: None,
            };
        }

        if let Some(retry) = self.retry_queue.get(&issue.id) {
            return QueueIssue {
                issue,
                status: RunStatus::RetryScheduled,
                run_id: None,
                attempt_number: Some(retry.attempt_number),
                next_retry_at: Some(retry.next_retry_at.clone()),
                last_error: Some(retry.last_error.clone()),
            };
        }

        let issue_id = issue.id.clone();
        let claimed = self.claimed.get(&issue_id);
        let status = if claimed.is_some() {
            RunStatus::Claimed
        } else {
            self.terminal_statuses
                .get(&issue_id)
                .map(|entry| entry.status)
                .unwrap_or(RunStatus::Queued)
        };
        let attempt_number = claimed.map(|claim| claim.attempt_number).or_else(|| {
            self.terminal_statuses
                .get(&issue_id)
                .and_then(|entry| entry.attempt_number)
        });
        let last_error = claimed
            .and_then(|claim| claim.previous_error.clone())
            .or_else(|| {
                self.terminal_statuses
                    .get(&issue_id)
                    .and_then(|entry| entry.last_error.clone())
            });

        QueueIssue {
            issue,
            status,
            run_id: None,
            attempt_number,
            next_retry_at: None,
            last_error,
        }
    }

    fn terminal_context(
        &self,
        issue_id: &str,
        status: RunStatus,
        last_error: Option<String>,
    ) -> TerminalEntry {
        let claimed = self.claimed.get(issue_id);
        let running = self.running.get(issue_id);
        let retry = self.retry_queue.get(issue_id);
        let terminal = self.terminal_statuses.get(issue_id);
        let attempt_number = claimed
            .map(|claim| claim.attempt_number)
            .or_else(|| running.map(|run| run.attempt_number))
            .or_else(|| retry.map(|entry| entry.attempt_number))
            .or_else(|| terminal.and_then(|entry| entry.attempt_number));
        let last_error = last_error
            .or_else(|| claimed.and_then(|claim| claim.previous_error.clone()))
            .or_else(|| retry.map(|entry| entry.last_error.clone()))
            .or_else(|| terminal.and_then(|entry| entry.last_error.clone()));

        TerminalEntry {
            status,
            attempt_number,
            last_error,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn issue(id: &str, identifier: &str) -> OrchestratorIssue {
        OrchestratorIssue {
            id: id.to_string(),
            identifier: identifier.to_string(),
            title: format!("Issue {identifier}"),
            description: None,
            state: "open".to_string(),
            url: None,
            labels: vec!["agent-ready".to_string()],
            priority: None,
            updated_at: None,
        }
    }

    #[test]
    fn claim_prevents_duplicate_dispatch() {
        let mut state = OrchestratorState::new();
        let issue = issue("issue-108", "#108");

        let claimed = state.claim_issue(&issue).unwrap();
        let err = state.claim_issue(&issue).unwrap_err();

        assert_eq!(claimed.status, RunStatus::Claimed);
        assert_eq!(claimed.attempt_number, Some(1));
        assert_eq!(
            err,
            StateError::IssueAlreadyActive {
                issue_id: "issue-108".to_string(),
            }
        );
        assert!(state.is_issue_active("issue-108"));
    }

    #[test]
    fn running_issue_appears_in_snapshot() {
        let mut state = OrchestratorState::new();
        let issue = issue("issue-108", "#108");
        state.claim_issue(&issue).unwrap();
        state
            .mark_running(
                "issue-108",
                "run-1",
                Some(42),
                2,
                PathBuf::from("/tmp/workspace"),
                Some(PathBuf::from("/tmp/workspace/stdout.log")),
                Some(PathBuf::from("/tmp/workspace/stderr.log")),
                "2026-05-02T00:00:00Z",
            )
            .unwrap();

        let snapshot = state.snapshot(vec![issue]);

        assert_eq!(snapshot.running.len(), 1);
        assert_eq!(snapshot.running[0].run_id, "run-1");
        assert_eq!(snapshot.running[0].process_id, Some(42));
        assert_eq!(
            snapshot.running[0].stdout_log_path.as_ref(),
            Some(&PathBuf::from("/tmp/workspace/stdout.log"))
        );
        assert_eq!(snapshot.queue[0].status, RunStatus::Running);
        assert_eq!(snapshot.queue[0].attempt_number, Some(2));
    }

    #[test]
    fn mark_running_removes_claimed_entry_from_in_flight_count() {
        let mut state = OrchestratorState::new();
        let issue = issue("issue-108", "#108");
        state.claim_issue(&issue).unwrap();

        state
            .mark_running(
                "issue-108",
                "run-1",
                None,
                1,
                PathBuf::from("/tmp/workspace"),
                None,
                None,
                "2026-05-02T00:00:00Z",
            )
            .unwrap();

        assert_eq!(state.in_flight_count(), 1);
        assert!(state.is_issue_active("issue-108"));
    }

    #[test]
    fn retry_scheduled_blocks_claim_until_released() {
        let mut state = OrchestratorState::new();
        let issue = issue("issue-108", "#108");
        state.schedule_retry(RetryEntry {
            issue_id: "issue-108".to_string(),
            issue_identifier: "#108".to_string(),
            attempt_number: 1,
            next_retry_at: "2026-05-02T00:01:00Z".to_string(),
            last_error: "agent exited 1".to_string(),
        });

        let err = state.claim_issue(&issue).unwrap_err();
        let snapshot = state.snapshot(vec![issue.clone()]);

        assert_eq!(
            err,
            StateError::IssueAlreadyActive {
                issue_id: "issue-108".to_string(),
            }
        );
        assert_eq!(snapshot.queue[0].status, RunStatus::RetryScheduled);
        assert_eq!(
            snapshot.queue[0].next_retry_at.as_deref(),
            Some("2026-05-02T00:01:00Z")
        );

        state.release_issue("issue-108", RunStatus::Released);

        assert!(state.claim_issue(&issue).is_ok());
    }

    #[test]
    fn claim_retry_promotes_retry_attempt_and_previous_error() {
        let mut state = OrchestratorState::new();
        let issue = issue("issue-108", "#108");
        state.schedule_retry(RetryEntry {
            issue_id: "issue-108".to_string(),
            issue_identifier: "#108".to_string(),
            attempt_number: 2,
            next_retry_at: "2026-05-02T00:01:00Z".to_string(),
            last_error: "agent exited 1".to_string(),
        });

        let claimed = state.claim_retry(&issue).unwrap();
        let attempt = state.claimed_attempt("issue-108").unwrap();
        let snapshot = state.snapshot(vec![issue]);

        assert_eq!(claimed.status, RunStatus::Claimed);
        assert_eq!(claimed.attempt_number, Some(2));
        assert_eq!(claimed.last_error.as_deref(), Some("agent exited 1"));
        assert_eq!(attempt.attempt_number, 2);
        assert_eq!(attempt.previous_error.as_deref(), Some("agent exited 1"));
        assert!(snapshot.retry_queue.is_empty());
        assert_eq!(snapshot.queue[0].status, RunStatus::Claimed);
        assert_eq!(snapshot.queue[0].attempt_number, Some(2));
    }

    #[test]
    fn claim_manual_retry_promotes_failed_terminal_attempt() {
        let mut state = OrchestratorState::new();
        let issue = issue("issue-108", "#108");
        state.claim_issue(&issue).unwrap();
        state
            .mark_running(
                "issue-108",
                "run-1",
                None,
                2,
                PathBuf::from("/tmp/workspace"),
                None,
                None,
                "2026-05-02T00:00:00Z",
            )
            .unwrap();
        state.release_issue_with_error(
            "issue-108",
            RunStatus::Failed,
            Some("agent exited 1".to_string()),
        );

        let failed = state.snapshot(vec![issue.clone()]);
        let claimed = state.claim_manual_retry(&issue).unwrap();
        let attempt = state.claimed_attempt("issue-108").unwrap();

        assert_eq!(failed.queue[0].status, RunStatus::Failed);
        assert_eq!(failed.queue[0].attempt_number, Some(2));
        assert_eq!(
            failed.queue[0].last_error.as_deref(),
            Some("agent exited 1")
        );
        assert_eq!(claimed.status, RunStatus::Claimed);
        assert_eq!(claimed.attempt_number, Some(3));
        assert_eq!(claimed.last_error.as_deref(), Some("agent exited 1"));
        assert_eq!(attempt.previous_error.as_deref(), Some("agent exited 1"));
    }

    #[test]
    fn claim_manual_retry_rejects_succeeded_terminal_attempt() {
        let mut state = OrchestratorState::new();
        let issue = issue("issue-108", "#108");
        state.release_issue("issue-108", RunStatus::Succeeded);

        let error = state.claim_manual_retry(&issue).unwrap_err();

        assert_eq!(
            error,
            StateError::IssueNotRetrying {
                issue_id: "issue-108".to_string(),
            }
        );
    }

    #[test]
    fn release_removes_running_and_claimed_state() {
        let mut state = OrchestratorState::new();
        let issue = issue("issue-108", "#108");
        state.claim_issue(&issue).unwrap();
        state
            .mark_running(
                "issue-108",
                "run-1",
                None,
                1,
                PathBuf::from("/tmp/workspace"),
                None,
                None,
                "2026-05-02T00:00:00Z",
            )
            .unwrap();

        state.release_issue("issue-108", RunStatus::Stopped);
        let snapshot = state.snapshot(vec![issue]);

        assert!(!state.is_issue_active("issue-108"));
        assert!(snapshot.running.is_empty());
        assert_eq!(snapshot.queue[0].status, RunStatus::Stopped);
    }

    #[test]
    fn active_work_lists_claimed_running_and_retry_entries() {
        let mut state = OrchestratorState::new();
        let claimed = issue("issue-108", "#108");
        let running = issue("issue-109", "#109");
        state.claim_issue(&claimed).unwrap();
        state.claim_issue(&running).unwrap();
        state
            .mark_running(
                "issue-109",
                "run-109",
                Some(109),
                1,
                PathBuf::from("/tmp/workspace-109"),
                Some(PathBuf::from("/tmp/workspace-109/stdout.log")),
                Some(PathBuf::from("/tmp/workspace-109/stderr.log")),
                "2026-05-02T00:00:00Z",
            )
            .unwrap();
        state.schedule_retry(RetryEntry {
            issue_id: "issue-110".to_string(),
            issue_identifier: "#110".to_string(),
            attempt_number: 2,
            next_retry_at: "2026-05-02T00:01:00Z".to_string(),
            last_error: "agent exited 1".to_string(),
        });

        let work = state.active_work();

        assert_eq!(work.len(), 3);
        assert_eq!(work[0].issue_identifier, "#108");
        assert_eq!(work[0].status, RunStatus::Claimed);
        assert_eq!(work[1].issue_identifier, "#109");
        assert_eq!(work[1].status, RunStatus::Running);
        assert_eq!(work[1].run_id.as_deref(), Some("run-109"));
        assert_eq!(work[2].issue_identifier, "#110");
        assert_eq!(work[2].status, RunStatus::RetryScheduled);
        assert_eq!(work[2].last_error.as_deref(), Some("agent exited 1"));
    }

    #[test]
    fn lifecycle_event_captures_display_fields() {
        let event = OrchestratorEvent {
            timestamp: "2026-05-02T00:00:00Z".to_string(),
            workflow_path: "/repo/WORKFLOW.md".into(),
            issue_id: "issue-108".to_string(),
            issue_identifier: "#108".to_string(),
            run_id: Some("run-1".to_string()),
            attempt_number: Some(1),
            status: RunStatus::Running,
            workspace_path: Some("/tmp/workspace".into()),
            message: Some("agent started".to_string()),
            error: None,
        };

        assert_eq!(event.status, RunStatus::Running);
        assert_eq!(event.message.as_deref(), Some("agent started"));
        assert!(format!("{event:?}").contains("agent started"));
    }
}
