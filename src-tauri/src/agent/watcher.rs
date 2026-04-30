//! File watcher for agent statusline files
//!
//! Watches Claude Code statusline JSON files for changes and emits
//! Tauri events when they update. Uses the `notify` crate for
//! cross-platform file system notifications.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{Emitter, Manager};

use super::statusline::parse_statusline;
use super::transcript::{validate_transcript_path, TranscriptStartStatus, TranscriptState};

// ----------------------------------------------------------------------
// Diagnostic logging (dev/debug builds only)
//
// Every event-processing callback emits a structured INFO line that
// surrounds the existing WARN ("Skipping transcript tailing ...") with
// enough context to diagnose freezes from `Vimeflow.log` alone:
// source, inter-event delta, total processing duration, transcript-path
// status, and a same-path repeat counter that captures Claude Code's
// "speculative path → resolved path" flip pattern.
//
// Gated by `cfg!(debug_assertions)` so packaged release builds emit zero
// extra log volume. The real WARN stays at WARN level untouched per the
// user's directive that the warning frequency itself is signal.
// ----------------------------------------------------------------------

/// Outcome of a `maybe_start_transcript` call. Returned so the caller
/// can record an accurate `tx_status` in the diagnostic log without
/// re-walking the path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TxOutcome {
    Started,
    Replaced,
    AlreadyRunning,
    Missing,
    OutsidePath,
    NotFile,
    StartFailed,
    NoPath,
    ParseError,
}

impl TxOutcome {
    fn label(&self) -> &'static str {
        match self {
            Self::Started => "started",
            Self::Replaced => "replaced",
            Self::AlreadyRunning => "already_running",
            Self::Missing => "missing",
            Self::OutsidePath => "outside_path",
            Self::NotFile => "not_file",
            Self::StartFailed => "start_failed",
            Self::NoPath => "no_path",
            Self::ParseError => "parse_error",
        }
    }
}

#[derive(Default)]
struct EventDiag {
    last_event_at: Option<Instant>,
    last_tx_path: Option<String>,
    /// How many consecutive events have had the SAME transcript path
    /// (with the SAME outcome) — high values indicate the bridge is
    /// stuck waiting for Claude Code to resolve a speculative path.
    same_path_repeat: u32,
}

fn short_sid(sid: &str) -> &str {
    sid.get(..8).unwrap_or(sid)
}

fn short_path(path: &str) -> String {
    std::path::Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.get(..8).unwrap_or(s).to_string())
        .unwrap_or_else(|| "?".to_string())
}

/// Emit the per-event diagnostic line. Gated by `cfg!(debug_assertions)`.
/// Also tracks the running `last_tx_path` for path-flip detection and
/// `same_path_repeat` for stuck-bridge visibility.
fn record_event_diag(
    diag: &Mutex<EventDiag>,
    source: &'static str,
    sid: &str,
    total: Duration,
    outcome: TxOutcome,
    tx_path: Option<&str>,
) {
    if !cfg!(debug_assertions) {
        return;
    }

    let now = Instant::now();
    let (dt, path_change, repeat) = {
        let mut d = diag.lock().expect("watcher diag lock");
        let dt = d
            .last_event_at
            .map(|prev| now.duration_since(prev))
            .unwrap_or(Duration::ZERO);
        d.last_event_at = Some(now);

        let path_change = match (tx_path, d.last_tx_path.as_deref()) {
            (Some(new), Some(old)) if new != old => {
                let old_owned = old.to_string();
                d.last_tx_path = Some(new.to_string());
                d.same_path_repeat = 1;
                Some(old_owned)
            }
            (Some(new), None) => {
                d.last_tx_path = Some(new.to_string());
                d.same_path_repeat = 1;
                None
            }
            (Some(_), Some(_)) => {
                d.same_path_repeat = d.same_path_repeat.saturating_add(1);
                None
            }
            (None, _) => None,
        };
        (dt, path_change, d.same_path_repeat)
    };

    if let Some(old) = path_change {
        log::info!(
            "watcher.tx_path_change session={} from={} to={}",
            short_sid(sid),
            short_path(&old),
            tx_path.map(short_path).unwrap_or_else(|| "(none)".into()),
        );
    }

    let total_ms = total.as_millis();
    let tx_path_short = tx_path.map(short_path).unwrap_or_else(|| "(none)".into());
    if total_ms > 50 {
        log::warn!(
            "watcher.slow_event source={} session={} dt={}ms total={}ms tx_status={} tx_path={} repeat={}",
            source,
            short_sid(sid),
            dt.as_millis(),
            total_ms,
            outcome.label(),
            tx_path_short,
            repeat,
        );
    } else {
        log::info!(
            "watcher.event source={} session={} dt={}ms total={}ms tx_status={} tx_path={} repeat={}",
            source,
            short_sid(sid),
            dt.as_millis(),
            total_ms,
            outcome.label(),
            tx_path_short,
            repeat,
        );
    }
}

/// Handle to a running watcher — dropping it stops the watcher and polling thread
pub struct WatcherHandle {
    _watcher: RecommendedWatcher,
    /// Signals the polling fallback thread to exit
    stop_flag: Arc<AtomicBool>,
    /// Captured for diagnostic logging on drop (dev builds only)
    session_id: String,
}

impl Drop for WatcherHandle {
    fn drop(&mut self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        if cfg!(debug_assertions) {
            log::info!(
                "watcher.handle.dropped session={}",
                short_sid(&self.session_id)
            );
        }
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
    fn active_count(&self) -> usize {
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
fn maybe_start_transcript(
    app_handle: &tauri::AppHandle,
    session_id: &str,
    transcript_path: &str,
) -> TxOutcome {
    let canonical = match validate_transcript_path(transcript_path) {
        Ok(path) => path,
        Err(e) => {
            log::warn!(
                "Skipping transcript tailing for session {}: {}",
                session_id,
                e
            );
            // Classify the failure for diagnostic logs. Substring matching
            // mirrors the error strings in `validate_transcript_path`; if
            // those strings change, this fallback returns NotFile rather
            // than misclassifying.
            return if e.contains("No such file") {
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
pub fn start_watching(
    app_handle: tauri::AppHandle,
    session_id: String,
    status_file_path: PathBuf,
) -> Result<WatcherHandle, String> {
    let target_path = status_file_path.clone();
    let sid = session_id.clone();
    let last_processed = Arc::new(Mutex::new(Instant::now()));
    let app_handle_for_poll = app_handle.clone();
    let stop_flag = Arc::new(AtomicBool::new(false));

    // Diagnostic state — one EventDiag per source so we can correlate
    // notify-vs-poll-vs-inline patterns in the log.
    let notify_diag = Arc::new(Mutex::new(EventDiag::default()));
    let poll_diag = Arc::new(Mutex::new(EventDiag::default()));
    let inline_diag = Arc::new(Mutex::new(EventDiag::default()));

    let notify_diag_for_cb = notify_diag.clone();

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

        let (outcome, tx_path) = match parse_statusline(&sid, &contents) {
            Ok(parsed) => {
                if let Err(e) = app_handle.emit("agent-status", &parsed.event) {
                    log::error!("Failed to emit agent-status event: {}", e);
                }

                if let Some(ref path) = parsed.transcript_path {
                    let outcome = maybe_start_transcript(&app_handle, &sid, path);
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
            &notify_diag_for_cb,
            "notify",
            &sid,
            started.elapsed(),
            outcome,
            tx_path.as_deref(),
        );
    })
    .map_err(|e| format!("failed to create watcher: {}", e))?;

    // Watch the parent directory (notify watches directories, not individual files)
    let parent_dir = status_file_path
        .parent()
        .ok_or_else(|| "status file path has no parent directory".to_string())?;

    // Create the parent directory if it does not exist
    std::fs::create_dir_all(parent_dir)
        .map_err(|e| format!("failed to create status directory: {}", e))?;

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
        let started = Instant::now();
        let mut outcome = TxOutcome::NoPath;
        let mut inline_tx_path: Option<String> = None;
        if let Ok(contents) = std::fs::read_to_string(&initial_path) {
            if !contents.trim().is_empty() {
                match parse_statusline(&initial_sid, &contents) {
                    Ok(parsed) => {
                        let _ = initial_app.emit("agent-status", &parsed.event);
                        if let Some(ref path) = parsed.transcript_path {
                            outcome = maybe_start_transcript(&initial_app, &initial_sid, path);
                            inline_tx_path = Some(path.clone());
                        }
                    }
                    Err(_) => {
                        outcome = TxOutcome::ParseError;
                    }
                }
                record_event_diag(
                    &inline_diag,
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
    {
        let poll_sid = session_id.clone();
        let poll_path = status_file_path.clone();
        let poll_app = app_handle_for_poll;
        let poll_last = Arc::new(Mutex::new(String::new()));
        let poll_stop = stop_flag.clone();
        let poll_diag_for_thread = poll_diag.clone();
        std::thread::spawn(move || {
            while !poll_stop.load(Ordering::Relaxed) {
                std::thread::sleep(std::time::Duration::from_secs(3));
                if poll_stop.load(Ordering::Relaxed) {
                    break;
                }

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

                let started = Instant::now();
                let (outcome, tx_path) = match parse_statusline(&poll_sid, &contents) {
                    Ok(parsed) => {
                        let _ = poll_app.emit("agent-status", &parsed.event);
                        if let Some(ref path) = parsed.transcript_path {
                            let outcome = maybe_start_transcript(&poll_app, &poll_sid, path);
                            (outcome, Some(path.clone()))
                        } else {
                            (TxOutcome::NoPath, None)
                        }
                    }
                    Err(_) => (TxOutcome::ParseError, None),
                };

                record_event_diag(
                    &poll_diag_for_thread,
                    "poll",
                    &poll_sid,
                    started.elapsed(),
                    outcome,
                    tx_path.as_deref(),
                );
            }
        });
    }

    log::info!(
        "Started watching statusline for session {}: {}",
        session_id,
        status_file_path.display()
    );

    Ok(WatcherHandle {
        _watcher: watcher,
        stop_flag,
        session_id: session_id.clone(),
    })
}

/// Start watching a statusline file (Tauri command).
///
/// The status file path is derived server-side from the PTY session's
/// known CWD — the frontend only provides the session ID. This prevents
/// path traversal attacks from crafted IPC calls.
#[tauri::command]
pub async fn start_agent_watcher(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AgentWatcherState>,
    pty_state: tauri::State<'_, crate::terminal::PtyState>,
    session_id: String,
) -> Result<(), String> {
    // Derive the status file path from the PTY session's resolved CWD
    let cwd = pty_state
        .get_cwd(&session_id)
        .ok_or_else(|| format!("PTY session not found: {}", session_id))?;

    let path = PathBuf::from(&cwd)
        .join(".vimeflow")
        .join("sessions")
        .join(&session_id)
        .join("status.json");

    log::info!(
        "Starting agent watcher: session={}, path={}, active_watchers={}",
        session_id,
        path.display(),
        state.active_count(),
    );

    // Use the structured logger (already configured for the rest of this
    // file) for startup diagnostics. The earlier debug-only file log at
    // `/tmp/vimeflow-debug.log` was dropped: a fixed predictable path
    // under /tmp without O_EXCL follows symlinks, allowing a local actor
    // on a shared system to redirect appends, and Linux's default umask
    // 022 left the file world-readable. Run with RUST_LOG=debug to see
    // these lines.
    log::debug!(
        "Watcher startup detail: session={}, cwd={}, path={}",
        session_id,
        cwd,
        path.display()
    );

    // Stop any existing watcher for this session
    state.remove(&session_id);

    let handle = start_watching(app_handle, session_id.clone(), path)?;
    state.insert(session_id.clone(), handle);

    Ok(())
}

/// Stop watching a statusline file (Tauri command)
#[tauri::command]
pub async fn stop_agent_watcher(
    state: tauri::State<'_, AgentWatcherState>,
    session_id: String,
) -> Result<(), String> {
    if state.remove(&session_id) {
        log::info!("Stopped watching statusline for session {}", session_id);
        Ok(())
    } else {
        Err(format!("No active watcher for session: {}", session_id))
    }
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
