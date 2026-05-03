//! Transcript tailer registry used by the watcher runtime.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use crate::agent::adapter::AgentAdapter;

/// Test-only public surface. Production code must use `AgentAdapter::start`.
#[doc(hidden)]
pub struct TranscriptHandle {
    stop_flag: Arc<AtomicBool>,
    join_handle: Option<std::thread::JoinHandle<()>>,
}

impl TranscriptHandle {
    pub(crate) fn new(
        stop_flag: Arc<AtomicBool>,
        join_handle: std::thread::JoinHandle<()>,
    ) -> Self {
        Self {
            stop_flag,
            join_handle: Some(join_handle),
        }
    }

    /// Signal the background thread to stop and wait for it to finish.
    pub fn stop(mut self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        if let Some(handle) = self.join_handle.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for TranscriptHandle {
    fn drop(&mut self) {
        self.stop_flag.store(true, Ordering::Relaxed);
    }
}

#[doc(hidden)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TranscriptStartStatus {
    Started,
    Replaced,
    AlreadyRunning,
}

struct TranscriptWatcher {
    transcript_path: PathBuf,
    cwd: Option<PathBuf>,
    handle: TranscriptHandle,
}

/// Test-only public surface. Production code must use `AgentAdapter::start`.
#[doc(hidden)]
#[derive(Default, Clone)]
pub struct TranscriptState {
    watchers: Arc<Mutex<HashMap<String, TranscriptWatcher>>>,
    /// Per-session "start gate" — held across `tail_transcript` so the
    /// notify callback and the 3s poll thread can't both pass the
    /// AlreadyRunning check, both spawn, and both emit duplicate
    /// `agent-tool-call` / `agent-turn` events from byte 0 of the
    /// JSONL before the loser's thread is stopped (Claude review on
    /// PR #152, F2). Different sessions still spawn concurrently
    /// because each session has its own `Arc<Mutex<()>>`.
    start_gates: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
}

impl TranscriptState {
    pub fn new() -> Self {
        Self {
            watchers: Arc::new(Mutex::new(HashMap::new())),
            start_gates: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Start tailing when none is active, or switch to a newer transcript
    /// path or workspace cwd.
    pub fn start_or_replace<R: tauri::Runtime>(
        &self,
        adapter: Arc<dyn AgentAdapter<R>>,
        app_handle: tauri::AppHandle<R>,
        session_id: String,
        transcript_path: PathBuf,
        cwd: Option<PathBuf>,
    ) -> Result<TranscriptStartStatus, String> {
        // Acquire (or lazily create) the per-session start gate so only
        // one start_or_replace call per session can be inside the
        // check + spawn + insert critical section at a time. Without
        // this, the notify callback and 3s poll thread can both pass
        // the AlreadyRunning check, both call adapter.tail_transcript,
        // and both emit events from byte 0 of the JSONL during the
        // tens-of-ms thread-spawn window before the loser's handle is
        // stopped (Claude review on PR #152, F2).
        let gate = {
            let mut gates = self
                .start_gates
                .lock()
                .expect("failed to lock start_gates");
            gates
                .entry(session_id.clone())
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };
        let _gate_guard = gate.lock().expect("failed to lock per-session start gate");

        {
            let watchers = self.watchers.lock().expect("failed to lock watchers");
            if let Some(current) = watchers.get(&session_id) {
                if current.transcript_path == transcript_path && current.cwd == cwd {
                    return Ok(TranscriptStartStatus::AlreadyRunning);
                }
            }
        }

        let mut new_handle = Some(adapter.tail_transcript(
            app_handle,
            session_id.clone(),
            cwd.clone(),
            transcript_path.clone(),
        )?);

        let (old_handle, status) = {
            let mut watchers = self.watchers.lock().expect("failed to lock watchers");

            if let Some(current) = watchers.get(&session_id) {
                if current.transcript_path == transcript_path && current.cwd == cwd {
                    (None, TranscriptStartStatus::AlreadyRunning)
                } else {
                    let old = watchers.insert(
                        session_id,
                        TranscriptWatcher {
                            transcript_path: transcript_path.clone(),
                            cwd: cwd.clone(),
                            handle: new_handle
                                .take()
                                .expect("new transcript handle should be available"),
                        },
                    );

                    (
                        old.map(|watcher| watcher.handle),
                        TranscriptStartStatus::Replaced,
                    )
                }
            } else {
                watchers.insert(
                    session_id,
                    TranscriptWatcher {
                        transcript_path,
                        cwd,
                        handle: new_handle
                            .take()
                            .expect("new transcript handle should be available"),
                    },
                );

                (None, TranscriptStartStatus::Started)
            }
        };

        if let Some(handle) = new_handle {
            handle.stop();
        }

        if let Some(handle) = old_handle {
            handle.stop();
        }

        Ok(status)
    }

    /// Check if a session already has an active transcript watcher.
    #[allow(dead_code)]
    pub fn contains(&self, session_id: &str) -> bool {
        let watchers = self.watchers.lock().expect("failed to lock watchers");
        watchers.contains_key(session_id)
    }

    /// Stop tailing for the given session.
    pub fn stop(&self, session_id: &str) -> Result<(), String> {
        let handle = {
            let mut watchers = self.watchers.lock().expect("failed to lock watchers");
            watchers.remove(session_id)
        };
        // Intentionally do NOT remove this session's entry from
        // `start_gates`. If `stop()` deleted the gate without first
        // acquiring it, a notify callback already inside
        // `start_or_replace` would still hold a clone of the OLD gate's
        // `Arc<Mutex<()>>`, and a subsequent restart would lookup the
        // empty map slot, create a NEW gate, and enter `tail_transcript`
        // concurrently with the in-flight start — reintroducing the
        // duplicate-tailer race the gate was added to prevent (Codex
        // verify cycle 2 follow-up to PR #152's F2). Gates are ~56 bytes
        // each (`String` key + `Arc<Mutex<()>>` value); leaving them
        // for the session_id's lifetime is small enough that periodic
        // cleanup isn't worth the lock-ordering complexity.
        match handle {
            Some(watcher) => {
                watcher.handle.stop();
                Ok(())
            }
            None => Err(format!("No transcript watcher for session: {}", session_id)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transcript_state_contains_empty() {
        let state = TranscriptState::new();
        assert!(!state.contains("any-session"));
    }

    #[test]
    fn transcript_state_replaces_changed_path() {
        let app = tauri::test::mock_builder()
            .build(tauri::generate_context!())
            .expect("failed to build test app");
        let tmp = tempfile::tempdir().expect("failed to create temp dir");
        let first_path = tmp.path().join("first.jsonl");
        let second_path = tmp.path().join("second.jsonl");
        std::fs::write(&first_path, "").expect("failed to write first transcript");
        std::fs::write(&second_path, "").expect("failed to write second transcript");

        let state = TranscriptState::new();
        let session_id = "session-1".to_string();
        let adapter: Arc<dyn AgentAdapter<tauri::test::MockRuntime>> =
            Arc::new(crate::agent::adapter::claude_code::ClaudeCodeAdapter);

        let first_status = state
            .start_or_replace(
                adapter.clone(),
                app.handle().clone(),
                session_id.clone(),
                first_path.clone(),
                None,
            )
            .expect("failed to start first transcript watcher");
        assert_eq!(first_status, TranscriptStartStatus::Started);

        let duplicate_status = state
            .start_or_replace(
                adapter.clone(),
                app.handle().clone(),
                session_id.clone(),
                first_path,
                None,
            )
            .expect("failed to check duplicate transcript watcher");
        assert_eq!(duplicate_status, TranscriptStartStatus::AlreadyRunning);

        let replaced_status = state
            .start_or_replace(
                adapter,
                app.handle().clone(),
                session_id.clone(),
                second_path,
                None,
            )
            .expect("failed to replace transcript watcher");
        assert_eq!(replaced_status, TranscriptStartStatus::Replaced);

        state.stop(&session_id).expect("failed to stop watcher");
    }

    #[test]
    fn transcript_state_threads_cwd_through() {
        let app = tauri::test::mock_builder()
            .build(tauri::generate_context!())
            .expect("failed to build test app");
        let tmp = tempfile::tempdir().expect("failed to create temp dir");
        let transcript_path = tmp.path().join("t.jsonl");
        std::fs::write(&transcript_path, "").expect("failed to write transcript");
        let cwd = tmp.path().to_path_buf();

        let state = TranscriptState::new();
        let adapter: Arc<dyn AgentAdapter<tauri::test::MockRuntime>> =
            Arc::new(crate::agent::adapter::claude_code::ClaudeCodeAdapter);

        let status = state
            .start_or_replace(
                adapter,
                app.handle().clone(),
                "session-cwd".to_string(),
                transcript_path,
                Some(cwd),
            )
            .expect("failed to start watcher with cwd");
        assert_eq!(status, TranscriptStartStatus::Started);

        state.stop("session-cwd").expect("failed to stop watcher");
    }

    #[test]
    fn transcript_state_replaces_when_only_cwd_changes() {
        let app = tauri::test::mock_builder()
            .build(tauri::generate_context!())
            .expect("failed to build test app");
        let tmp = tempfile::tempdir().expect("failed to create temp dir");
        let transcript_path = tmp.path().join("t.jsonl");
        std::fs::write(&transcript_path, "").expect("failed to write transcript");
        let cwd_a = tempfile::tempdir().expect("failed to create cwd_a");
        let cwd_b = tempfile::tempdir().expect("failed to create cwd_b");

        let state = TranscriptState::new();
        let session_id = "session-cwd-change".to_string();
        let adapter: Arc<dyn AgentAdapter<tauri::test::MockRuntime>> =
            Arc::new(crate::agent::adapter::claude_code::ClaudeCodeAdapter);

        let first = state
            .start_or_replace(
                adapter.clone(),
                app.handle().clone(),
                session_id.clone(),
                transcript_path.clone(),
                Some(cwd_a.path().to_path_buf()),
            )
            .expect("failed to start with cwd_a");
        assert_eq!(first, TranscriptStartStatus::Started);

        let same = state
            .start_or_replace(
                adapter.clone(),
                app.handle().clone(),
                session_id.clone(),
                transcript_path.clone(),
                Some(cwd_a.path().to_path_buf()),
            )
            .expect("failed to detect already-running");
        assert_eq!(same, TranscriptStartStatus::AlreadyRunning);

        let replaced = state
            .start_or_replace(
                adapter.clone(),
                app.handle().clone(),
                session_id.clone(),
                transcript_path.clone(),
                Some(cwd_b.path().to_path_buf()),
            )
            .expect("failed to replace on cwd change");
        assert_eq!(replaced, TranscriptStartStatus::Replaced);

        let replaced_to_none = state
            .start_or_replace(
                adapter,
                app.handle().clone(),
                session_id.clone(),
                transcript_path,
                None,
            )
            .expect("failed to replace on cwd to None transition");
        assert_eq!(replaced_to_none, TranscriptStartStatus::Replaced);

        state.stop(&session_id).expect("failed to stop watcher");
    }

    #[test]
    fn transcript_handle_drop_sets_stop_flag() {
        let stop_flag = Arc::new(AtomicBool::new(false));
        let handle = std::thread::spawn(|| {});

        {
            let _handle = TranscriptHandle::new(Arc::clone(&stop_flag), handle);
        }

        assert!(stop_flag.load(Ordering::Relaxed));
    }
}
