//! Provider-neutral agent watcher orchestration.
//!
//! This module intentionally keeps a narrow external surface while splitting
//! the runtime internals into smaller files. Adapter implementations provide
//! provider-specific hooks; this layer owns watcher lifecycle, transcript
//! lifecycle, diagnostics, and path-trust enforcement.

mod diagnostics;
mod path_security;
mod transcript_state;
mod watcher_runtime;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::agent::adapter::types::{BindContext, BindError, StatusSource};
use crate::agent::adapter::AgentAdapter;

pub use transcript_state::{TranscriptHandle, TranscriptStartStatus, TranscriptState};
pub use watcher_runtime::{AgentWatcherState, WatcherHandle};

const BIND_RETRY_INTERVAL_MS: u64 = 100;
const BIND_RETRY_MAX_ATTEMPTS: u32 = 5;

pub(crate) fn start_for<R: tauri::Runtime>(
    adapter: Arc<dyn AgentAdapter<R>>,
    app_handle: tauri::AppHandle<R>,
    session_id: String,
    cwd: PathBuf,
    pid: u32,
    pty_start: std::time::SystemTime,
    state: AgentWatcherState,
) -> Result<(), String> {
    let source =
        resolve_status_source_with_retry(adapter.as_ref(), &session_id, &cwd, pid, pty_start)?;
    path_security::ensure_status_source_under_trust_root(&source.path, &source.trust_root)?;

    log::debug!(
        "Watcher startup detail: session={}, cwd={}, path={}",
        session_id,
        cwd.display(),
        source.path.display()
    );

    // Stop any existing watcher for this session before counting active
    // watchers. Restarting the same session would otherwise produce a false
    // leaked-watcher signal.
    state.remove(&session_id);

    log::info!(
        "Starting agent watcher: session={}, path={}, active_watchers={}",
        session_id,
        source.path.display(),
        state.active_count(),
    );

    let handle =
        watcher_runtime::start_watching(adapter, app_handle, session_id.clone(), source.path)?;
    state.insert(session_id, handle);

    Ok(())
}

fn resolve_status_source_with_retry<R: tauri::Runtime>(
    adapter: &dyn AgentAdapter<R>,
    session_id: &str,
    cwd: &std::path::Path,
    pid: u32,
    pty_start: std::time::SystemTime,
) -> Result<StatusSource, String> {
    let ctx = BindContext {
        session_id,
        cwd,
        pid,
        pty_start,
    };
    let started = Instant::now();
    let mut last_err: Option<BindError> = None;

    for _ in 0..BIND_RETRY_MAX_ATTEMPTS {
        match adapter.status_source(&ctx) {
            Ok(source) => return Ok(source),
            Err(BindError::Fatal(reason)) => return Err(format!("bind fatal: {}", reason)),
            Err(pending @ BindError::Pending(_)) => {
                last_err = Some(pending);
                std::thread::sleep(Duration::from_millis(BIND_RETRY_INTERVAL_MS));
            }
        }
    }

    log::warn!(
        "start_for: bind retry budget exhausted for session={} (elapsed={:?})",
        session_id,
        started.elapsed()
    );

    Err(last_err
        .unwrap_or_else(|| BindError::Pending("no attempts".to_string()))
        .to_string())
}

#[cfg(test)]
mod start_for_retry_tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::SystemTime;
    use tauri::test::{mock_builder, MockRuntime};
    use tauri::AppHandle;

    use crate::agent::adapter::types::{ParsedStatus, ValidateTranscriptError};

    struct PendingThenOkAdapter {
        calls: AtomicUsize,
        flip_after: usize,
        path: PathBuf,
    }

    impl AgentAdapter<MockRuntime> for PendingThenOkAdapter {
        fn agent_type(&self) -> crate::agent::types::AgentType {
            crate::agent::types::AgentType::Codex
        }

        fn status_source(&self, _ctx: &BindContext<'_>) -> Result<StatusSource, BindError> {
            let n = self.calls.fetch_add(1, Ordering::SeqCst);
            if n < self.flip_after {
                Err(BindError::Pending(format!("attempt {}", n)))
            } else {
                Ok(StatusSource {
                    path: self.path.clone(),
                    trust_root: self.path.parent().expect("status parent").to_path_buf(),
                })
            }
        }

        fn parse_status(&self, _: &str, _: &str) -> Result<ParsedStatus, String> {
            Err("not used".to_string())
        }

        fn validate_transcript(&self, _: &str) -> Result<PathBuf, ValidateTranscriptError> {
            Err(ValidateTranscriptError::Other("not used".to_string()))
        }

        fn tail_transcript(
            &self,
            _: AppHandle<MockRuntime>,
            _: String,
            _: Option<PathBuf>,
            _: PathBuf,
        ) -> Result<TranscriptHandle, String> {
            Err("not used".to_string())
        }
    }

    #[test]
    fn start_for_retries_on_pending_then_succeeds_under_budget() {
        let app = mock_builder()
            .manage(crate::terminal::PtyState::new())
            .manage(TranscriptState::new())
            .build(tauri::generate_context!())
            .expect("mock app build");
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("rollout.jsonl");
        std::fs::write(&path, "").expect("seed status file");

        let adapter: Arc<dyn AgentAdapter<MockRuntime>> = Arc::new(PendingThenOkAdapter {
            calls: AtomicUsize::new(0),
            flip_after: 3,
            path,
        });

        let state = AgentWatcherState::new();
        let started = Instant::now();
        let result = start_for(
            adapter,
            app.handle().clone(),
            "test-sid".to_string(),
            dir.path().to_path_buf(),
            12345,
            SystemTime::now(),
            state,
        );
        let elapsed = started.elapsed();

        assert!(
            result.is_ok(),
            "start_for should succeed after retries: {:?}",
            result
        );
        assert!(
            elapsed < Duration::from_millis(900),
            "retry budget exceeded: {:?}",
            elapsed
        );
    }

    #[test]
    fn start_for_returns_err_when_pending_budget_exhausted() {
        let app = mock_builder()
            .manage(crate::terminal::PtyState::new())
            .manage(TranscriptState::new())
            .build(tauri::generate_context!())
            .expect("mock app build");
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("rollout.jsonl");
        std::fs::write(&path, "").expect("seed status file");

        let adapter: Arc<dyn AgentAdapter<MockRuntime>> = Arc::new(PendingThenOkAdapter {
            calls: AtomicUsize::new(0),
            flip_after: usize::MAX,
            path,
        });

        let state = AgentWatcherState::new();
        let started = Instant::now();
        let result = start_for(
            adapter,
            app.handle().clone(),
            "exhausted-sid".to_string(),
            dir.path().to_path_buf(),
            12345,
            SystemTime::now(),
            state,
        );
        let elapsed = started.elapsed();

        assert!(result.is_err(), "expected Err on exhausted retries");
        assert!(
            result
                .expect_err("bind should fail after exhausted retries")
                .contains("bind pending"),
            "error string should mention bind pending"
        );
        assert!(
            elapsed < Duration::from_millis(900),
            "retry budget exceeded on exhaustion path: {:?}",
            elapsed
        );
    }
}
