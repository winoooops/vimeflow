use std::collections::HashMap;
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::Serialize;
use thiserror::Error;

use crate::orchestrator::{OrchestratorIssue, OrchestratorRun, WorkspacePlan};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunRequest {
    pub issue: OrchestratorIssue,
    pub attempt_number: u32,
    pub workspace: WorkspacePlan,
    pub command: String,
    pub args: Vec<String>,
    pub prompt: String,
    pub prompt_file: PathBuf,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRun {
    pub run_id: String,
    pub process_id: Option<u32>,
    pub stdout_log_path: Option<PathBuf>,
    pub stderr_log_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunExit {
    pub run_id: String,
    pub success: bool,
    pub exit_code: Option<i32>,
    pub message: String,
}

pub trait AgentRunner {
    fn start(&self, request: AgentRunRequest) -> Result<AgentRun, AgentRunnerError>;

    fn stop(&self, run: &OrchestratorRun) -> Result<(), AgentRunnerError> {
        Err(AgentRunnerError::Stop {
            run_id: run.run_id.clone(),
            message: "agent runner does not support stop".to_string(),
        })
    }

    fn take_finished(&self, _run_id: &str) -> Option<AgentRunExit> {
        None
    }
}

#[derive(Debug, Clone, Default)]
pub struct CommandAgentRunner {
    finished_runs: Arc<Mutex<HashMap<String, AgentRunExit>>>,
}

#[derive(Debug, Clone, Error, PartialEq, Eq)]
pub enum AgentRunnerError {
    #[error("failed to start agent: {message}")]
    Start { message: String },
    #[error("failed to write prompt to agent stdin: {message}")]
    Stdin { message: String },
    #[error("failed to stop agent run {run_id}: {message}")]
    Stop { run_id: String, message: String },
}

impl AgentRunner for CommandAgentRunner {
    fn start(&self, request: AgentRunRequest) -> Result<AgentRun, AgentRunnerError> {
        let Some(log_dir) = request.prompt_file.parent() else {
            return Err(AgentRunnerError::Start {
                message: "prompt file has no parent directory".to_string(),
            });
        };
        let stdout_log_path = log_dir.join("stdout.log");
        let stderr_log_path = log_dir.join("stderr.log");
        let stdout_log =
            File::create(&stdout_log_path).map_err(|error| AgentRunnerError::Start {
                message: format!("failed to create stdout log: {error}"),
            })?;
        let stderr_log =
            File::create(&stderr_log_path).map_err(|error| AgentRunnerError::Start {
                message: format!("failed to create stderr log: {error}"),
            })?;

        let mut child = Command::new(&request.command)
            .args(&request.args)
            .current_dir(&request.workspace.path)
            .env("VIMEFLOW_ISSUE_ID", &request.issue.id)
            .env("VIMEFLOW_ISSUE_IDENTIFIER", &request.issue.identifier)
            .env("VIMEFLOW_PROMPT_FILE", &request.prompt_file)
            .env("VIMEFLOW_WORKSPACE", &request.workspace.path)
            .stdin(Stdio::piped())
            .stdout(Stdio::from(stdout_log))
            .stderr(Stdio::from(stderr_log))
            .spawn()
            .map_err(|error| AgentRunnerError::Start {
                message: error.to_string(),
            })?;

        let Some(mut stdin) = child.stdin.take() else {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AgentRunnerError::Start {
                message: "agent stdin unavailable".to_string(),
            });
        };

        if let Err(error) = stdin.write_all(request.prompt.as_bytes()) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AgentRunnerError::Stdin {
                message: error.to_string(),
            });
        }
        drop(stdin);

        let process_id = child.id();
        let run_id = format!("{}:process-{process_id}", request.issue.id);
        let finished_runs = Arc::clone(&self.finished_runs);
        let thread_run_id = run_id.clone();
        thread::spawn(move || {
            let exit = match child.wait() {
                Ok(status) => AgentRunExit::from_status(thread_run_id, status),
                Err(error) => {
                    let message = format!("failed to wait for agent process: {error}");
                    log::warn!("{message}");
                    AgentRunExit {
                        run_id: thread_run_id,
                        success: false,
                        exit_code: None,
                        message,
                    }
                }
            };

            if let Ok(mut guard) = finished_runs.lock() {
                guard.insert(exit.run_id.clone(), exit);
            } else {
                log::warn!("failed to record completed orchestrator agent process");
            }
        });

        Ok(AgentRun {
            run_id,
            process_id: Some(process_id),
            stdout_log_path: Some(stdout_log_path),
            stderr_log_path: Some(stderr_log_path),
        })
    }

    fn stop(&self, run: &OrchestratorRun) -> Result<(), AgentRunnerError> {
        let Some(process_id) = run.process_id else {
            return Err(AgentRunnerError::Stop {
                run_id: run.run_id.clone(),
                message: "agent run has no process id".to_string(),
            });
        };

        stop_process(process_id, &run.run_id)
    }

    fn take_finished(&self, run_id: &str) -> Option<AgentRunExit> {
        self.finished_runs
            .lock()
            .map(|mut guard| guard.remove(run_id))
            .unwrap_or_else(|_| {
                log::warn!("failed to read completed orchestrator agent process");
                None
            })
    }
}

impl AgentRunExit {
    fn from_status(run_id: String, status: ExitStatus) -> Self {
        let success = status.success();
        let exit_code = status.code();
        let message = if success {
            "agent process exited successfully".to_string()
        } else {
            format!("agent process exited with status {status}")
        };

        Self {
            run_id,
            success,
            exit_code,
            message,
        }
    }
}

#[cfg(unix)]
fn stop_process(process_id: u32, run_id: &str) -> Result<(), AgentRunnerError> {
    let result = unsafe { libc::kill(process_id as libc::pid_t, libc::SIGTERM) };
    if result == 0 {
        return Ok(());
    }

    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ESRCH) {
        return Ok(());
    }

    Err(AgentRunnerError::Stop {
        run_id: run_id.to_string(),
        message: error.to_string(),
    })
}

#[cfg(windows)]
fn stop_process(process_id: u32, run_id: &str) -> Result<(), AgentRunnerError> {
    let status = Command::new("taskkill")
        .args(["/PID", &process_id.to_string(), "/T", "/F"])
        .status()
        .map_err(|error| AgentRunnerError::Stop {
            run_id: run_id.to_string(),
            message: error.to_string(),
        })?;

    if status.success() {
        return Ok(());
    }

    Err(AgentRunnerError::Stop {
        run_id: run_id.to_string(),
        message: format!("taskkill exited with status {status}"),
    })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::{Duration, Instant};

    use tempfile::TempDir;

    use super::*;

    #[cfg(unix)]
    #[test]
    fn command_agent_runner_uses_workspace_cwd_prompt_stdin_and_prompt_env() {
        let workspace_dir = TempDir::new().unwrap();
        let prompt_file = workspace_dir
            .path()
            .join(".vimeflow/orchestrator/prompt.md");
        fs::create_dir_all(prompt_file.parent().unwrap()).unwrap();
        let request = AgentRunRequest {
            issue: issue("issue-108", "#108"),
            attempt_number: 1,
            workspace: WorkspacePlan {
                issue_id: "issue-108".to_string(),
                issue_identifier: "#108".to_string(),
                workspace_slug: "108".to_string(),
                path: workspace_dir.path().to_path_buf(),
                base_ref: "main".to_string(),
                branch_name: "agent/108".to_string(),
                prompt_file: prompt_file.clone(),
            },
            command: "sh".to_string(),
            args: vec![
                "-c".to_string(),
                "cat > stdin.txt && pwd > cwd.txt && echo agent-out && echo agent-err >&2 && printf '%s' \"$VIMEFLOW_PROMPT_FILE\" > prompt-env.txt"
                    .to_string(),
            ],
            prompt: "Fix #108".to_string(),
            prompt_file: prompt_file.clone(),
        };

        let runner = CommandAgentRunner::default();
        let run = runner.start(request).unwrap();
        wait_for_file(&workspace_dir.path().join("prompt-env.txt"));

        assert_eq!(
            run.run_id,
            format!("issue-108:process-{}", run.process_id.unwrap())
        );
        assert_eq!(
            fs::read_to_string(workspace_dir.path().join("stdin.txt")).unwrap(),
            "Fix #108"
        );
        assert_eq!(
            fs::read_to_string(workspace_dir.path().join("cwd.txt"))
                .unwrap()
                .trim(),
            workspace_dir.path().display().to_string()
        );
        assert_eq!(
            fs::read_to_string(workspace_dir.path().join("prompt-env.txt")).unwrap(),
            prompt_file.display().to_string()
        );
        assert_eq!(
            fs::read_to_string(run.stdout_log_path.unwrap()).unwrap(),
            "agent-out\n"
        );
        assert_eq!(
            fs::read_to_string(run.stderr_log_path.unwrap()).unwrap(),
            "agent-err\n"
        );
    }

    #[cfg(unix)]
    #[test]
    fn command_agent_runner_reports_completed_process() {
        let workspace_dir = TempDir::new().unwrap();
        let prompt_file = workspace_dir
            .path()
            .join(".vimeflow/orchestrator/prompt.md");
        fs::create_dir_all(prompt_file.parent().unwrap()).unwrap();
        let runner = CommandAgentRunner::default();
        let request = AgentRunRequest {
            issue: issue("issue-108", "#108"),
            attempt_number: 1,
            workspace: WorkspacePlan {
                issue_id: "issue-108".to_string(),
                issue_identifier: "#108".to_string(),
                workspace_slug: "108".to_string(),
                path: workspace_dir.path().to_path_buf(),
                base_ref: "main".to_string(),
                branch_name: "agent/108".to_string(),
                prompt_file: prompt_file.clone(),
            },
            command: "sh".to_string(),
            args: vec!["-c".to_string(), "exit 7".to_string()],
            prompt: "Fix #108".to_string(),
            prompt_file,
        };

        let run = runner.start(request).unwrap();
        let exit = wait_for_exit(&runner, &run.run_id);

        assert_eq!(exit.run_id, run.run_id);
        assert!(!exit.success);
        assert_eq!(exit.exit_code, Some(7));
        assert!(exit.message.contains("status"));
        assert!(runner.take_finished(&run.run_id).is_none());
    }

    fn issue(id: &str, identifier: &str) -> OrchestratorIssue {
        OrchestratorIssue {
            id: id.to_string(),
            identifier: identifier.to_string(),
            title: format!("Issue {identifier}"),
            description: None,
            state: "open".to_string(),
            url: None,
            labels: Vec::new(),
            priority: None,
            updated_at: None,
        }
    }

    fn wait_for_file(path: &std::path::Path) {
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if path.exists() {
                return;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("timed out waiting for {}", path.display());
    }

    fn wait_for_exit(runner: &CommandAgentRunner, run_id: &str) -> AgentRunExit {
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if let Some(exit) = runner.take_finished(run_id) {
                return exit;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("timed out waiting for exit {run_id}");
    }
}
