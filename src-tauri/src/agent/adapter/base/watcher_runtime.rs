//! File watcher runtime for agent status sources.
//!
//! Watches adapter-provided status files for changes and emits Tauri events
//! when they update. Uses the `notify` crate plus a polling fallback for
//! environments where file-system notifications are unreliable.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{Emitter, Manager};

use super::diagnostics::{EventTiming, PathHistory, TxOutcome, record_event_diag, short_sid};
use super::transcript_state::{TranscriptStartStatus, TranscriptState};
use crate::agent::adapter::AgentAdapter;

/// Handle to a running watcher — dropping it stops the watcher and polling thread
pub struct WatcherHandle {
    _watcher: Option<RecommendedWatcher>,
    /// Signals the polling fallback thread to exit
    stop_flag: Arc<AtomicBool>,
    /// Polling fallback thread. Stored so Drop can join after signalling
    /// stop, rather than leaving the thread briefly detached.
    join_handle: Option<std::thread::JoinHandle<()>>,
    /// Captured for diagnostic logging on drop. `#[cfg(debug_assertions)]`
    /// gates the FIELD itself so release builds skip the `String::clone`
    /// in the constructor — `cfg!()` on the read site alone left the
    /// allocation in release. Conditional struct fields are part of
    /// stable Rust.
    transcript_state: TranscriptState,
    session_id: String,
    #[cfg(debug_assertions)]
    session_id_for_log: String,
}

impl Drop for WatcherHandle {
    fn drop(&mut self) {
        drop(self._watcher.take());
        self.stop_flag.store(true, Ordering::Relaxed);
        if let Some(handle) = self.join_handle.take() {
            let _ = handle.join();
        }
        let _ = self.transcript_state.stop(&self.session_id);
        // `#[cfg(...)]` (attribute) on a statement, NOT `if cfg!(...)`
        // (runtime). The attribute physically removes both the
        // statement and the `self.session_id` access in release builds,
        // matching the field's `#[cfg(...)]` gate above.
        #[cfg(debug_assertions)]
        log::info!(
            "watcher.handle.dropped session={}",
            short_sid(&self.session_id_for_log)
        );
    }
}

/// Thread-safe state for managing active agent watchers per session
#[derive(Default, Clone)]
pub struct AgentWatcherState {
    watchers: Arc<Mutex<HashMap<String, WatcherHandle>>>,
}

impl AgentWatcherState {
    /// Create a new empty watcher state
    pub fn new() -> Self {
        Self {
            watchers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Insert a watcher for a session, stopping any existing watcher
    pub fn insert(&self, session_id: String, handle: WatcherHandle) {
        let mut watchers = self.watchers.lock().expect("failed to lock watchers");
        watchers.insert(session_id, handle);
    }

    /// Remove and stop a watcher for a session
    pub fn remove(&self, session_id: &str) -> bool {
        let mut watchers = self.watchers.lock().expect("failed to lock watchers");
        watchers.remove(session_id).is_some()
    }

    /// Check if a session has an active watcher
    #[allow(dead_code)]
    pub fn contains(&self, session_id: &str) -> bool {
        let watchers = self.watchers.lock().expect("failed to lock watchers");
        watchers.contains_key(session_id)
    }

    /// Number of active watchers across all sessions. Used for the
    /// diagnostic "active_watchers=N" log line — surfaces leaked
    /// watchers from prior sessions that are still polling old
    /// status.json files in the background.
    pub(super) fn active_count(&self) -> usize {
        let watchers = self.watchers.lock().expect("failed to lock watchers");
        watchers.len()
    }
}

/// Try to start transcript tailing, switching files if Claude reports a new path.
///
/// `cwd` is queried fresh from PtyState at every call rather than captured
/// by the outer `start_watching` closures. The user can `cd` mid-session
/// without restarting the agent watcher; we want the test-runner parser to
/// pick up the new workspace immediately. Combined with
/// `TranscriptState::start_or_replace`'s (transcript_path, cwd) identity
/// check, a cwd change triggers a Replace of the tail thread.
fn maybe_start_transcript<R: tauri::Runtime>(
    adapter: &Arc<dyn AgentAdapter<R>>,
    app_handle: &tauri::AppHandle<R>,
    session_id: &str,
    transcript_path: &str,
) -> TxOutcome {
    let canonical = match adapter.validate_transcript(transcript_path) {
        Ok(path) => path,
        Err(e) => {
            log::warn!(
                "Skipping transcript tailing for session {}: {}",
                session_id,
                e
            );
            // Classify the failure for diagnostic logs. The
            // missing-file case uses `Path::exists()` for
            // platform-neutrality — Linux's "No such file or
            // directory" string is forwarded by
            // `validate_transcript_path`, but Windows reports a
            // different OS-localized message for ENOENT (and other
            // platforms vary too). `Path::exists()` returns false
            // uniformly across platforms for a non-existent path, so
            // it's the right primary signal. The "access denied"
            // substring is a CUSTOM string from
            // `validate_transcript_path` (not OS-localized), so it's
            // safe to substring-match.
            return if !std::path::Path::new(transcript_path).exists() {
                TxOutcome::Missing
            } else if e.contains("access denied") {
                TxOutcome::OutsidePath
            } else {
                TxOutcome::NotFile
            };
        }
    };

    let cwd = app_handle
        .state::<crate::terminal::PtyState>()
        .get_cwd(&session_id.to_string())
        .map(PathBuf::from);

    let ts = app_handle.state::<TranscriptState>();
    match ts.start_or_replace(
        adapter.clone(),
        app_handle.clone(),
        session_id.to_string(),
        canonical.clone(),
        cwd,
    ) {
        Ok(TranscriptStartStatus::Started) => {
            log::info!(
                "Started transcript tailing for session {}: {}",
                session_id,
                canonical.display()
            );
            TxOutcome::Started
        }
        Ok(TranscriptStartStatus::Replaced) => {
            log::info!(
                "Switched transcript tailing for session {}: {}",
                session_id,
                canonical.display()
            );
            TxOutcome::Replaced
        }
        Ok(TranscriptStartStatus::AlreadyRunning) => TxOutcome::AlreadyRunning,
        Err(e) => {
            log::warn!(
                "Failed to start transcript tailing for session {}: {}",
                session_id,
                e
            );
            TxOutcome::StartFailed
        }
    }
}

/// Start watching a statusline file for changes.
///
/// Watches the parent directory and filters for events on the target file.
/// Debounces at 100ms to avoid redundant processing.
///
/// CWD is intentionally NOT captured here. `maybe_start_transcript` queries
/// PtyState fresh on every invocation so a `cd` mid-session updates the
/// workspace seen by the test-runner parser.
pub(super) fn start_watching<R: tauri::Runtime>(
    adapter: Arc<dyn AgentAdapter<R>>,
    app_handle: tauri::AppHandle<R>,
    session_id: String,
    status_file_path: PathBuf,
) -> Result<WatcherHandle, String> {
    let target_path = status_file_path.clone();
    let sid = session_id.clone();
    let last_processed = Arc::new(Mutex::new(Instant::now()));
    let app_handle_for_poll = app_handle.clone();
    let stop_flag = Arc::new(AtomicBool::new(false));
    let transcript_state_for_handle = app_handle.state::<TranscriptState>().inner().clone();

    // Diagnostic state — per-source timing for sources that fire
    // repeatedly (notify, poll), and a SHARED path history so the
    // speculative→resolved transcript-path flip is detected even when
    // it spans sources (e.g. inline saw the speculative path, notify
    // sees the resolved one). The inline-init source has NO timing
    // mutex: it's one-shot and `dt` would be structurally zero —
    // record_event_diag accepts `Option<&Mutex<EventTiming>>` and
    // logs `dt=n/a` when None.
    let notify_timing = Arc::new(Mutex::new(EventTiming::default()));
    let poll_timing = Arc::new(Mutex::new(EventTiming::default()));
    let path_history = Arc::new(Mutex::new(PathHistory::default()));

    let notify_timing_for_cb = notify_timing.clone();
    let path_history_for_cb = path_history.clone();
    let adapter_for_cb = adapter.clone();

    // Debounce interval — ignore events within 100ms of the last processed one
    let debounce_ms = 100;

    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        let event = match res {
            Ok(ev) => ev,
            Err(e) => {
                log::error!("Watcher error for session {}: {}", sid, e);
                return;
            }
        };

        // Only react to data modifications or file creation
        let dominated = matches!(
            event.kind,
            EventKind::Modify(notify::event::ModifyKind::Data(_))
                | EventKind::Create(notify::event::CreateKind::File)
        );
        if !dominated {
            return;
        }

        // Filter: only process events for the target status file
        let is_target = event.paths.iter().any(|p| p == &target_path);
        if !is_target {
            return;
        }

        // Debounce: skip if processed too recently
        {
            let mut last = last_processed.lock().expect("failed to lock debounce");
            let now = Instant::now();
            if now.duration_since(*last).as_millis() < debounce_ms {
                return;
            }
            *last = now;
        }

        let started = Instant::now();

        // Read and parse the status file
        let contents = match std::fs::read_to_string(&target_path) {
            Ok(c) => c,
            Err(e) => {
                log::warn!("Failed to read statusline file for session {}: {}", sid, e);
                return;
            }
        };

        if contents.trim().is_empty() {
            return;
        }

        let (outcome, tx_path) = match adapter_for_cb.parse_status(&sid, &contents) {
            Ok(parsed) => {
                if let Err(e) = app_handle.emit("agent-status", &parsed.event) {
                    log::error!("Failed to emit agent-status event: {}", e);
                }

                if let Some(ref path) = parsed.transcript_path {
                    let outcome = maybe_start_transcript(&adapter_for_cb, &app_handle, &sid, path);
                    (outcome, Some(path.clone()))
                } else {
                    (TxOutcome::NoPath, None)
                }
            }
            Err(e) => {
                log::warn!("Failed to parse statusline for session {}: {}", sid, e);
                (TxOutcome::ParseError, None)
            }
        };

        record_event_diag(
            Some(&notify_timing_for_cb),
            &path_history_for_cb,
            "notify",
            &sid,
            started.elapsed(),
            outcome,
            tx_path.as_deref(),
        );
    })
    .map_err(|e| format!("failed to create watcher: {}", e))?;
    // Watch the parent directory (notify watches directories, not individual
    // files). The directory is guaranteed to exist and to have passed the
    // canonicalize-and-verify trust-root check by `path_security::
    // ensure_status_source_under_trust_root`, the only path that reaches
    // this function (Claude review on PR #152, F3 — removed a redundant
    // create_dir_all that re-did path_security's work). If `start_watching`
    // is ever promoted to `pub` and gains a caller that bypasses
    // `start_for`, that caller is responsible for invoking
    // `ensure_status_source_under_trust_root` first; do NOT add a defensive
    // create_dir_all here, because it would create the directory without
    // the post-create symlink-race re-canonicalize check that
    // `path_security` performs.
    let parent_dir = status_file_path
        .parent()
        .ok_or_else(|| "status file path has no parent directory".to_string())?;

    watcher
        .watch(parent_dir, RecursiveMode::NonRecursive)
        .map_err(|e| format!("failed to start watching: {}", e))?;

    // Read the file immediately in case it was already written before
    // the watcher started (common race: status.json written by statusline.sh
    // before the frontend calls start_agent_watcher).
    {
        let initial_sid = session_id.clone();
        let initial_path = status_file_path.clone();
        let initial_app = app_handle_for_poll.clone();
        let initial_adapter = adapter.clone();
        let started = Instant::now();
        let mut outcome = TxOutcome::NoPath;
        let mut inline_tx_path: Option<String> = None;
        if let Ok(contents) = std::fs::read_to_string(&initial_path) {
            if !contents.trim().is_empty() {
                match initial_adapter.parse_status(&initial_sid, &contents) {
                    Ok(parsed) => {
                        let _ = initial_app.emit("agent-status", &parsed.event);
                        if let Some(ref path) = parsed.transcript_path {
                            outcome = maybe_start_transcript(
                                &initial_adapter,
                                &initial_app,
                                &initial_sid,
                                path,
                            );
                            inline_tx_path = Some(path.clone());
                        }
                    }
                    Err(_) => {
                        outcome = TxOutcome::ParseError;
                    }
                }
                record_event_diag(
                    None,
                    &path_history,
                    "inline",
                    &initial_sid,
                    started.elapsed(),
                    outcome,
                    inline_tx_path.as_deref(),
                );
            }
        }
    }

    // Polling fallback — WSL2's inotify can miss events and Claude Code
    // may use atomic writes (rename). The stop_flag is set when the
    // WatcherHandle is dropped, causing the thread to exit cleanly.
    let poll_join_handle = {
        let poll_sid = session_id.clone();
        let poll_path = status_file_path.clone();
        let poll_app = app_handle_for_poll;
        let poll_last = Arc::new(Mutex::new(String::new()));
        let poll_stop = stop_flag.clone();
        let poll_timing_for_thread = poll_timing.clone();
        let path_history_for_poll = path_history.clone();
        let adapter_for_poll = adapter.clone();
        Some(std::thread::spawn(move || {
            while !poll_stop.load(Ordering::Relaxed) {
                std::thread::sleep(std::time::Duration::from_secs(3));
                if poll_stop.load(Ordering::Relaxed) {
                    break;
                }

                // Capture `started` BEFORE the read so `total` covers file
                // I/O the same way the notify and inline sources do —
                // otherwise WSL2/virtio-fs read latency is silently
                // excluded from poll's number, making cross-source
                // comparison unsound and biasing the freeze diagnosis
                // toward notify. Dedup-skip `continue` paths run before
                // `record_event_diag`, so unchanged-content polls never
                // log a number — no noise.
                let started = Instant::now();

                let contents = match std::fs::read_to_string(&poll_path) {
                    Ok(c) if !c.trim().is_empty() => c,
                    _ => continue,
                };

                {
                    let mut last = poll_last.lock().expect("lock");
                    if *last == contents {
                        continue;
                    }
                    *last = contents.clone();
                }

                let (outcome, tx_path) = match adapter_for_poll.parse_status(&poll_sid, &contents) {
                    Ok(parsed) => {
                        let _ = poll_app.emit("agent-status", &parsed.event);
                        if let Some(ref path) = parsed.transcript_path {
                            let outcome = maybe_start_transcript(
                                &adapter_for_poll,
                                &poll_app,
                                &poll_sid,
                                path,
                            );
                            (outcome, Some(path.clone()))
                        } else {
                            (TxOutcome::NoPath, None)
                        }
                    }
                    Err(_) => (TxOutcome::ParseError, None),
                };

                record_event_diag(
                    Some(&poll_timing_for_thread),
                    &path_history_for_poll,
                    "poll",
                    &poll_sid,
                    started.elapsed(),
                    outcome,
                    tx_path.as_deref(),
                );
            }
        }))
    };

    log::info!(
        "Started watching statusline for session {}: {}",
        session_id,
        status_file_path.display()
    );

    Ok(WatcherHandle {
        _watcher: Some(watcher),
        stop_flag,
        join_handle: poll_join_handle,
        transcript_state: transcript_state_for_handle,
        session_id: session_id.clone(),
        #[cfg(debug_assertions)]
        session_id_for_log: session_id.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_empty_watcher_state() {
        let state = AgentWatcherState::new();
        assert!(!state.contains("test-session"));
    }

    #[test]
    fn remove_returns_false_for_missing_session() {
        let state = AgentWatcherState::new();
        assert!(!state.remove("nonexistent"));
    }
}
