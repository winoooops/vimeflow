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
    pub issue_id: String,
    pub issue_identifier: String,
    pub attempt_number: u32,
    pub status: RunStatus,
    pub workspace_path: PathBuf,
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

#[derive(Debug, Error, PartialEq, Eq)]
pub enum StateError {
    #[error("issue is already claimed, running, or retrying: {issue_id}")]
    IssueAlreadyActive { issue_id: String },
    #[error("issue must be claimed before it can run: {issue_id}")]
    IssueNotClaimed { issue_id: String },
}

#[derive(Debug, Clone, Default)]
pub struct OrchestratorState {
    claimed: HashMap<String, String>,
    running: HashMap<String, OrchestratorRun>,
    retry_queue: HashMap<String, RetryEntry>,
    terminal_statuses: HashMap<String, RunStatus>,
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
        self.claimed
            .insert(issue.id.clone(), issue.identifier.clone());

        Ok(QueueIssue {
            issue: issue.clone(),
            status: RunStatus::Claimed,
            run_id: None,
            attempt_number: None,
            next_retry_at: None,
            last_error: None,
        })
    }

    pub fn mark_running(
        &mut self,
        issue_id: &str,
        run_id: &str,
        attempt_number: u32,
        workspace_path: PathBuf,
        started_at: &str,
    ) -> Result<(), StateError> {
        let Some(issue_identifier) = self.claimed.get(issue_id).cloned() else {
            return Err(StateError::IssueNotClaimed {
                issue_id: issue_id.to_string(),
            });
        };

        self.running.insert(
            issue_id.to_string(),
            OrchestratorRun {
                run_id: run_id.to_string(),
                issue_id: issue_id.to_string(),
                issue_identifier,
                attempt_number,
                status: RunStatus::Running,
                workspace_path,
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

    pub fn release_issue(&mut self, issue_id: &str, status: RunStatus) {
        self.claimed.remove(issue_id);
        self.running.remove(issue_id);
        self.retry_queue.remove(issue_id);
        self.terminal_statuses.insert(issue_id.to_string(), status);
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

        let status = if self.claimed.contains_key(&issue.id) {
            RunStatus::Claimed
        } else {
            self.terminal_statuses
                .get(&issue.id)
                .copied()
                .unwrap_or(RunStatus::Queued)
        };

        QueueIssue {
            issue,
            status,
            run_id: None,
            attempt_number: None,
            next_retry_at: None,
            last_error: None,
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
                2,
                PathBuf::from("/tmp/workspace"),
                "2026-05-02T00:00:00Z",
            )
            .unwrap();

        let snapshot = state.snapshot(vec![issue]);

        assert_eq!(snapshot.running.len(), 1);
        assert_eq!(snapshot.running[0].run_id, "run-1");
        assert_eq!(snapshot.queue[0].status, RunStatus::Running);
        assert_eq!(snapshot.queue[0].attempt_number, Some(2));
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
    fn release_removes_running_and_claimed_state() {
        let mut state = OrchestratorState::new();
        let issue = issue("issue-108", "#108");
        state.claim_issue(&issue).unwrap();
        state
            .mark_running(
                "issue-108",
                "run-1",
                1,
                PathBuf::from("/tmp/workspace"),
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
