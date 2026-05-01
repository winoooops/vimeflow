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

/// Per-source timing state. Each source (notify, inline-init, poll-fallback)
/// gets its own instance so we can correlate inter-event delta with the
/// source that fired it.
#[derive(Default)]
struct EventTiming {
    last_event_at: Option<Instant>,
}

/// Cross-source transcript-path history. SHARED across all event sources
/// in a watcher, so the speculative→resolved flip is detected even when
/// the speculative path was first seen by the inline read and the
/// resolved path is later picked up by notify or the poll fallback.
/// Without this sharing, each source starts with `last_tx_path = None`
/// and never observes the flip — `watcher.tx_path_change` would never
/// fire for the cross-source case it is meant to diagnose.
#[derive(Default)]
struct PathHistory {
    last_tx_path: Option<String>,
    /// How many consecutive events have had the SAME transcript path
    /// across ALL sources — high values indicate the bridge is stuck
    /// waiting for Claude Code to resolve a speculative path.
    same_path_repeat: u32,
}

impl PathHistory {
    /// Record one event's observation of the transcript-path field and
    /// update the streak counter. Returns `Some(old)` when the path
    /// changed (caller logs `watcher.tx_path_change`), `None` otherwise.
    ///
    /// Extracted as a method so the state machine is unit-testable
    /// without driving the surrounding `record_event_diag` (which
    /// otherwise needs a `Mutex` + a logger to be exercised). The four
    /// arms encode:
    ///
    ///   1. Path differs from the last seen → log a path_change, reset
    ///      the streak counter to 1, return the old path.
    ///   2. First observation (no prior path) → set, repeat=1.
    ///   3. Same path as last → increment streak counter.
    ///   4. No path on this event → reset BOTH `last_tx_path` AND
    ///      `same_path_repeat`. Without this reset, a sequence
    ///      `[path=A, no-path, path=A]` would log the second A with
    ///      `repeat=2` (treated as a consecutive observation across
    ///      the no-path interlude), which is precisely the
    ///      speculative/missing-path window this diagnostic exists
    ///      to capture.
    fn observe(&mut self, tx_path: Option<&str>) -> Option<String> {
        match (tx_path, self.last_tx_path.as_deref()) {
            (Some(new), Some(old)) if new != old => {
                let old_owned = old.to_string();
                self.last_tx_path = Some(new.to_string());
                self.same_path_repeat = 1;
                Some(old_owned)
            }
            (Some(new), None) => {
                self.last_tx_path = Some(new.to_string());
                self.same_path_repeat = 1;
                None
            }
            (Some(_), Some(_)) => {
                self.same_path_repeat = self.same_path_repeat.saturating_add(1);
                None
            }
            (None, _) => {
                self.last_tx_path = None;
                self.same_path_repeat = 0;
                None
            }
        }
    }
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
///
/// Reads per-source timing from `timing` (None for one-shot sources
/// like the inline-init read, where `dt` would be structurally zero
/// and misleading) and the cross-source path history from
/// `path_history` (shared across all sources). The path history MUST
/// be shared so the speculative→resolved flip — which frequently
/// spans sources (e.g. inline reads the speculative path, notify
/// sees the resolved one) — is detected.
fn record_event_diag(
    timing: Option<&Mutex<EventTiming>>,
    path_history: &Mutex<PathHistory>,
    source: &'static str,
    sid: &str,
    total: Duration,
    outcome: TxOutcome,
    tx_path: Option<&str>,
) {
    if !cfg!(debug_assertions) {
        return;
    }

    // `dt` is only meaningful for sources that fire repeatedly. The
    // inline-init source runs once per watcher start, so its `dt`
    // would always be `Duration::ZERO` (the default for a None
    // `last_event_at`) — emitting `dt=0ms` for inline alongside real
    // dt values from notify/poll lets a reader misread the zero as
    // recency. `None` here means "this source is one-shot, log dt as
    // n/a so the reader doesn't compare it against real deltas."
    let dt_label = match timing {
        Some(t) => {
            let now = Instant::now();
            let mut t = t.lock().expect("watcher timing lock");
            let dt = t
                .last_event_at
                .map(|prev| now.duration_since(prev))
                .unwrap_or(Duration::ZERO);
            t.last_event_at = Some(now);
            format!("dt={}ms", dt.as_millis())
        }
        None => "dt=n/a".to_string(),
    };

    let (path_change, repeat) = {
        let mut h = path_history.lock().expect("watcher path-history lock");
        let path_change = h.observe(tx_path);
        (path_change, h.same_path_repeat)
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
            "watcher.slow_event source={} session={} {} total={}ms tx_status={} tx_path={} repeat={}",
            source,
            short_sid(sid),
            dt_label,
            total_ms,
            outcome.label(),
            tx_path_short,
            repeat,
        );
    } else {
        log::info!(
            "watcher.event source={} session={} {} total={}ms tx_status={} tx_path={} repeat={}",
            source,
            short_sid(sid),
            dt_label,
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
    /// Polling fallback thread. Stored so Drop can join after signalling
    /// stop, rather than leaving the thread briefly detached.
    join_handle: Option<std::thread::JoinHandle<()>>,
    /// Captured for diagnostic logging on drop. `#[cfg(debug_assertions)]`
    /// gates the FIELD itself so release builds skip the `String::clone`
    /// in the constructor — `cfg!()` on the read site alone left the
    /// allocation in release. Conditional struct fields are part of
    /// stable Rust.
    #[cfg(debug_assertions)]
    session_id: String,
}

impl Drop for WatcherHandle {
    fn drop(&mut self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        if let Some(handle) = self.join_handle.take() {
            let _ = handle.join();
        }
        // `#[cfg(...)]` (attribute) on a statement, NOT `if cfg!(...)`
        // (runtime). The attribute physically removes both the
        // statement and the `self.session_id` access in release builds,
        // matching the field's `#[cfg(...)]` gate above.
        #[cfg(debug_assertions)]
        log::info!(
            "watcher.handle.dropped session={}",
            short_sid(&self.session_id)
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
        _watcher: watcher,
        stop_flag,
        join_handle: poll_join_handle,
        #[cfg(debug_assertions)]
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

    // Stop any existing watcher for this session BEFORE counting active
    // watchers — restarting the same session would otherwise inflate the
    // count and produce a false "leaked watcher" signal. The post-remove
    // count reflects watchers from OTHER sessions only, which is the
    // useful leak signal for this log.
    state.remove(&session_id);

    log::info!(
        "Starting agent watcher: session={}, path={}, active_watchers={}",
        session_id,
        path.display(),
        state.active_count(),
    );

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

    // -- PathHistory state machine ----------------------------------
    //
    // These tests cover all four arms of `PathHistory::observe` and act
    // as regression guards for the round-1 `(None, _)` reset and the
    // round-1 fix that ensured `same_path_repeat = 1` (not 0) on a
    // path change. They run against the extracted method rather than
    // driving `record_event_diag` end-to-end, which is the only
    // production caller — that function early-returns under
    // `cfg!(debug_assertions)` and emits log side effects, both of
    // which make end-to-end testing noisier than necessary for a pure
    // state-machine check.

    #[test]
    fn path_history_first_observation_sets_path_and_repeat_1() {
        let mut h = PathHistory::default();
        let r = h.observe(Some("path-a"));
        assert!(r.is_none(), "first observation must not report a path change");
        assert_eq!(h.last_tx_path.as_deref(), Some("path-a"));
        assert_eq!(h.same_path_repeat, 1);
    }

    #[test]
    fn path_history_repeat_increments_on_same_path() {
        let mut h = PathHistory::default();
        h.observe(Some("path-a"));
        h.observe(Some("path-a"));
        assert_eq!(h.same_path_repeat, 2);

        let r = h.observe(Some("path-a"));
        assert!(
            r.is_none(),
            "same-path observation must not report a path change"
        );
        assert_eq!(h.same_path_repeat, 3);
    }

    #[test]
    fn path_history_path_change_returns_old_and_resets_repeat() {
        let mut h = PathHistory::default();
        h.observe(Some("path-a"));
        h.observe(Some("path-a"));
        assert_eq!(h.same_path_repeat, 2);

        let r = h.observe(Some("path-b"));
        assert_eq!(
            r.as_deref(),
            Some("path-a"),
            "path change must return the previous value"
        );
        assert_eq!(h.last_tx_path.as_deref(), Some("path-b"));
        assert_eq!(
            h.same_path_repeat, 1,
            "streak counter resets to 1 on a fresh path"
        );
    }

    #[test]
    fn path_history_no_path_resets_streak_after_repeat() {
        // Regression guard for the round-1 `(None, _)` bug. The
        // sequence [path=A, no-path, path=A] MUST NOT report the
        // second A as repeat=2 — the no-path interlude breaks the
        // streak, and the next path-bearing event is fresh.
        let mut h = PathHistory::default();
        h.observe(Some("path-a"));
        h.observe(Some("path-a"));
        assert_eq!(h.same_path_repeat, 2);

        let r = h.observe(None);
        assert!(r.is_none());
        assert_eq!(h.last_tx_path, None, "no-path must clear the path cache");
        assert_eq!(h.same_path_repeat, 0, "no-path must reset the streak");

        let r = h.observe(Some("path-a"));
        assert!(
            r.is_none(),
            "the next path-bearing event after a no-path is treated as fresh — \
             it does not report a change against the cleared cache"
        );
        assert_eq!(h.same_path_repeat, 1, "streak starts at 1, not 3");
    }

    #[test]
    fn path_history_no_path_when_already_no_path_is_idempotent() {
        let mut h = PathHistory::default();
        let r = h.observe(None);
        assert!(r.is_none());
        assert_eq!(h.last_tx_path, None);
        assert_eq!(h.same_path_repeat, 0);
    }

    // -- short_sid / short_path / TxOutcome::label -------------------

    #[test]
    fn short_sid_truncates_long_to_8_chars() {
        assert_eq!(short_sid("abcdefghijklmnop"), "abcdefgh");
    }

    #[test]
    fn short_sid_returns_input_unchanged_when_short() {
        assert_eq!(short_sid("abc"), "abc");
        assert_eq!(short_sid(""), "");
    }

    #[test]
    fn short_sid_handles_uuid_form() {
        // Real session IDs are UUIDs; the canonical 8-char prefix is
        // what the diagnostic logs render.
        assert_eq!(
            short_sid("ddb8d9f1-30b1-43dc-a1a2-405aaaf95e14"),
            "ddb8d9f1"
        );
    }

    #[test]
    fn short_path_extracts_basename_without_extension() {
        assert_eq!(
            short_path("/home/x/projects/abcdefghijklm.jsonl"),
            "abcdefgh",
            "basename file_stem truncated to 8 chars"
        );
        assert_eq!(short_path("/x/y/short.jsonl"), "short");
    }

    #[test]
    fn short_path_handles_input_without_directory() {
        assert_eq!(short_path("nofileonly.jsonl"), "nofileon");
    }

    #[test]
    fn short_path_returns_question_mark_when_no_basename() {
        assert_eq!(
            short_path("/"),
            "?",
            "root path has no file_stem — fall back to ? sentinel"
        );
    }

    #[test]
    fn tx_outcome_label_covers_every_variant() {
        // Drives every match arm so adding a new variant without a
        // label causes this test to fail to compile (exhaustive match
        // by construction in TxOutcome::label, plus this test reads
        // every variant).
        assert_eq!(TxOutcome::Started.label(), "started");
        assert_eq!(TxOutcome::Replaced.label(), "replaced");
        assert_eq!(TxOutcome::AlreadyRunning.label(), "already_running");
        assert_eq!(TxOutcome::Missing.label(), "missing");
        assert_eq!(TxOutcome::OutsidePath.label(), "outside_path");
        assert_eq!(TxOutcome::NotFile.label(), "not_file");
        assert_eq!(TxOutcome::StartFailed.label(), "start_failed");
        assert_eq!(TxOutcome::NoPath.label(), "no_path");
        assert_eq!(TxOutcome::ParseError.label(), "parse_error");
    }
}
