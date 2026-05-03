//! Transcript tailer registry used by the watcher runtime.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use crate::agent::adapter::AgentAdapter;

/// Internal lifecycle type — created by adapter `tail_transcript`
/// implementations (e.g., `claude_code::transcript::start_tailing` via
/// `TranscriptHandle::new`, which is `pub(crate)`) and owned by
/// `TranscriptState`'s internal `TranscriptWatcher` map. The type
/// itself must remain `pub` because it appears in the
/// `AgentAdapter::tail_transcript` trait signature, which is publicly
/// visible from `agent::adapter::mod`. Construction is gated to the
/// crate via `pub(crate) fn new`; do not bypass that path.
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
        // Release pairs with the Acquire load in the tail loop so the
        // stop signal is observed promptly even on weakly-ordered
        // architectures (Claude review on PR #152, F12 — consistency
        // with the F8 fix that already promoted `WatcherHandle`'s
        // stop_flag to Release/Acquire).
        self.stop_flag.store(true, Ordering::Release);
        if let Some(handle) = self.join_handle.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for TranscriptHandle {
    fn drop(&mut self) {
        // See `stop()` above — Release for cross-thread visibility.
        self.stop_flag.store(true, Ordering::Release);
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

/// Tauri-managed registry of in-flight transcript tailers, one per
/// session. Constructed once at app startup in `lib.rs` via
/// `.manage(TranscriptState::new())` and accessed via
/// `app_handle.state::<TranscriptState>()` from `WatcherHandle::Drop`,
/// `AgentAdapter::start`, and adapter `tail_transcript` impls. `pub` is
/// for Tauri's managed-state machinery (it requires `'static` types
/// reachable from outside the defining module) and for direct
/// instantiation in `#[cfg(test)]` integration tests under
/// `src-tauri/tests/transcript_*.rs`; do not construct ad hoc instances
/// in production code paths — there must be exactly one registered with
/// the app.
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

        // Extract any old watcher BEFORE spawning the new tail thread, so
        // the old thread is fully joined before the new one starts emitting
        // events for this session_id. The previous order (spawn → insert
        // (capturing old) → stop old outside the lock) created a
        // ~POLL_INTERVAL (500 ms) overlap window during which both tail
        // threads were live; on the cwd-change Replaced path (same
        // transcript_path, different cwd) the new thread replays all events
        // from byte 0 while the old thread still drains its read buffer,
        // producing duplicate `agent-tool-call` and `agent-turn` events that
        // inflate `recentToolCalls` and aggregate counters in the frontend
        // (which has no toolUseId-level dedup). Claude review on PR #152, F19.
        //
        // Lock-ordering remains gate → watchers; the watchers mutex is never
        // held across the blocking `handle.stop()` join. Between extracting
        // and re-inserting the entry the map has no row for this session_id
        // for ~500 ms, but the per-session gate ensures no concurrent
        // `start_or_replace` or `stop()` for this session can observe that
        // gap (both acquire the gate first, F4).
        //
        // Trade-off: if `adapter.tail_transcript` fails AFTER the old
        // watcher is stopped, the caller gets the error AND the session is
        // left with no active watcher. Previously (spawn-first order) a
        // tail_transcript failure preserved the old watcher. The new
        // behaviour is intentional for the Replaced path: a cwd change
        // means the old cwd is no longer the correct routing context, so a
        // failed swap should fail loudly rather than silently keep a
        // stale-cwd tailer alive.
        let old_handle = {
            let mut watchers = self.watchers.lock().expect("failed to lock watchers");
            if let Some(current) = watchers.get(&session_id) {
                if current.transcript_path == transcript_path && current.cwd == cwd {
                    return Ok(TranscriptStartStatus::AlreadyRunning);
                }
            }
            watchers.remove(&session_id).map(|watcher| watcher.handle)
        };

        let had_old = old_handle.is_some();
        if let Some(handle) = old_handle {
            handle.stop();
        }

        let new_handle = adapter.tail_transcript(
            app_handle,
            session_id.clone(),
            cwd.clone(),
            transcript_path.clone(),
        )?;

        // The per-session gate guarantees no concurrent `start_or_replace`
        // can have inserted between the check above and this insert.
        // `stop()` also acquires the gate (Claude review on PR #152, F4),
        // so it cannot have removed an entry mid-flight either. Outcome is
        // determined by whether the pre-spawn extract found an entry:
        // present → Replaced (different identity, since the early-return
        // above handled the same-identity case under the same gate);
        // absent → Started.
        {
            let mut watchers = self.watchers.lock().expect("failed to lock watchers");
            watchers.insert(
                session_id,
                TranscriptWatcher {
                    transcript_path,
                    cwd,
                    handle: new_handle,
                },
            );
        }

        Ok(if had_old {
            TranscriptStartStatus::Replaced
        } else {
            TranscriptStartStatus::Started
        })
    }

    /// Check if a session already has an active transcript watcher.
    #[allow(dead_code)]
    pub fn contains(&self, session_id: &str) -> bool {
        let watchers = self.watchers.lock().expect("failed to lock watchers");
        watchers.contains_key(session_id)
    }

    /// Stop tailing for the given session.
    pub fn stop(&self, session_id: &str) -> Result<(), String> {
        // Acquire the per-session start gate before touching `watchers`
        // (Claude review on PR #152, F4). Without this, an in-flight
        // `start_or_replace` could be between its drop-watchers-lock /
        // tail_transcript-spawn / re-acquire-watchers steps when stop()
        // ran concurrently and removed the entry. `start_or_replace`
        // would then insert the freshly-spawned T1 as `Started` even
        // though `stop()` already ran — leaving T1 as a zombie tail
        // thread with no owning `WatcherHandle` (the original handle
        // whose Drop called us has already been dropped). Acquiring
        // the gate here forces stop() to wait for any in-flight start
        // to finish, so the entry stop() removes is exactly the entry
        // start_or_replace just inserted — there is no zombie.
        //
        // Lock ordering: gate → watchers, matching `start_or_replace`.
        //
        // Intentionally do NOT remove this session's entry from
        // `start_gates`. If we deleted the gate after releasing it, a
        // subsequent `start_or_replace` would lookup the empty map
        // slot, create a NEW gate, and enter `tail_transcript`
        // concurrently with another already-in-flight start that still
        // holds a clone of the OLD gate. Gates are ~56 bytes each
        // (`String` key + `Arc<Mutex<()>>` value); leaving them for
        // the session_id's lifetime is small enough that periodic
        // cleanup isn't worth the lock-ordering complexity.
        let gate = {
            let mut gates = self
                .start_gates
                .lock()
                .expect("failed to lock start_gates");
            gates
                .entry(session_id.to_string())
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };
        let _gate_guard = gate.lock().expect("failed to lock per-session start gate");

        let handle = {
            let mut watchers = self.watchers.lock().expect("failed to lock watchers");
            watchers.remove(session_id)
        };
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

    /// Regression test for F19 — start_or_replace on the cwd-change
    /// Replaced path must fully stop the old tail thread BEFORE spawning
    /// the new one. The pre-fix order was (spawn-new → insert → stop-old),
    /// which left both threads live for ~POLL_INTERVAL (500 ms) and
    /// produced duplicate `agent-tool-call` / `agent-turn` events on the
    /// frontend.
    ///
    /// The invariant is observed via a custom adapter that records the
    /// order of `tail_transcript` calls AND the order of stop-flag flips
    /// on the handles it returns. After two `start_or_replace` calls (cwd
    /// A then cwd B on the same transcript_path), the recorded sequence
    /// must be: `spawn(A)`, `stop(A)`, `spawn(B)` — NOT `spawn(A)`,
    /// `spawn(B)`, `stop(A)`.
    ///
    /// Claude review on PR #152, F19.
    #[test]
    fn replace_on_cwd_change_stops_old_before_spawning_new() {
        use std::sync::Mutex;

        struct OrderingAdapter {
            events: Arc<Mutex<Vec<String>>>,
            stop_flags: Arc<Mutex<Vec<Arc<AtomicBool>>>>,
        }

        impl<R: tauri::Runtime> AgentAdapter<R> for OrderingAdapter {
            fn agent_type(&self) -> crate::agent::types::AgentType {
                crate::agent::types::AgentType::ClaudeCode
            }

            fn status_source(
                &self,
                _cwd: &std::path::Path,
                _session_id: &str,
            ) -> crate::agent::adapter::types::StatusSource {
                unreachable!("status_source not exercised in this test")
            }

            fn parse_status(
                &self,
                _session_id: &str,
                _raw: &str,
            ) -> Result<crate::agent::adapter::types::ParsedStatus, String> {
                unreachable!("parse_status not exercised in this test")
            }

            fn validate_transcript(&self, _raw: &str) -> Result<PathBuf, String> {
                unreachable!("validate_transcript not exercised in this test")
            }

            fn tail_transcript(
                &self,
                _app: tauri::AppHandle<R>,
                _session_id: String,
                cwd: Option<PathBuf>,
                _transcript_path: PathBuf,
            ) -> Result<TranscriptHandle, String> {
                let cwd_label = cwd
                    .as_deref()
                    .map(|p| p.display().to_string())
                    .unwrap_or_else(|| "<none>".to_string());
                self.events
                    .lock()
                    .expect("events lock")
                    .push(format!("spawn({})", cwd_label));

                let stop_flag = Arc::new(AtomicBool::new(false));
                let stop_clone = Arc::clone(&stop_flag);
                let events_clone = Arc::clone(&self.events);
                let cwd_for_thread = cwd_label.clone();
                self.stop_flags
                    .lock()
                    .expect("stop_flags lock")
                    .push(Arc::clone(&stop_flag));

                // The mock thread polls the stop flag and records when it
                // observes the stop. Real adapters do real I/O here; the
                // poll cadence below is deliberately tight so the test
                // doesn't pad runtime.
                let join_handle = std::thread::spawn(move || {
                    while !stop_clone.load(Ordering::Acquire) {
                        std::thread::sleep(std::time::Duration::from_millis(1));
                    }
                    events_clone
                        .lock()
                        .expect("events lock in mock thread")
                        .push(format!("stop({})", cwd_for_thread));
                });

                Ok(TranscriptHandle::new(stop_flag, join_handle))
            }
        }

        let app = tauri::test::mock_builder()
            .build(tauri::generate_context!())
            .expect("failed to build test app");
        let tmp = tempfile::tempdir().expect("failed to create temp dir");
        let transcript_path = tmp.path().join("t.jsonl");
        std::fs::write(&transcript_path, "").expect("failed to write transcript");
        let cwd_a = tempfile::tempdir().expect("failed to create cwd_a");
        let cwd_b = tempfile::tempdir().expect("failed to create cwd_b");

        let events = Arc::new(Mutex::new(Vec::<String>::new()));
        let stop_flags = Arc::new(Mutex::new(Vec::<Arc<AtomicBool>>::new()));
        let adapter: Arc<dyn AgentAdapter<tauri::test::MockRuntime>> =
            Arc::new(OrderingAdapter {
                events: Arc::clone(&events),
                stop_flags: Arc::clone(&stop_flags),
            });

        let state = TranscriptState::new();
        let session_id = "session-f19".to_string();

        state
            .start_or_replace(
                adapter.clone(),
                app.handle().clone(),
                session_id.clone(),
                transcript_path.clone(),
                Some(cwd_a.path().to_path_buf()),
            )
            .expect("failed to start with cwd_a");

        state
            .start_or_replace(
                adapter,
                app.handle().clone(),
                session_id.clone(),
                transcript_path,
                Some(cwd_b.path().to_path_buf()),
            )
            .expect("failed to replace with cwd_b");

        state.stop(&session_id).expect("failed to stop watcher");

        // After `state.stop()` returns, the second handle's `stop()` has
        // joined the thread, so both `stop(A)` and `stop(B)` events are
        // guaranteed to be in the log (the mock thread pushes the stop
        // event before exiting; `handle.stop()` waits for that exit).
        let recorded = events.lock().expect("events lock").clone();
        // The invariant: stop(A) appears BEFORE spawn(B). Pre-fix order
        // (spawn-then-stop) would have produced spawn(A), spawn(B),
        // stop(A), stop(B). Post-fix order produces spawn(A), stop(A),
        // spawn(B), stop(B).
        let spawn_b_idx = recorded
            .iter()
            .position(|e| e.starts_with("spawn(") && e.contains(cwd_b.path().to_str().unwrap()))
            .expect("spawn(B) must appear in event log");
        let stop_a_idx = recorded
            .iter()
            .position(|e| e.starts_with("stop(") && e.contains(cwd_a.path().to_str().unwrap()))
            .expect("stop(A) must appear in event log");
        assert!(
            stop_a_idx < spawn_b_idx,
            "F19 regression: expected stop(A) before spawn(B); got events {:?}",
            recorded
        );
    }
}
