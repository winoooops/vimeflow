//! File watcher for agent statusline files
//!
//! Watches Claude Code statusline JSON files for changes and emits
//! Tauri events when they update. Uses the `notify` crate for
//! cross-platform file system notifications.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{Emitter, Manager};

use super::statusline::parse_statusline;
use super::transcript::{validate_transcript_path, TranscriptStartStatus, TranscriptState};

/// Handle to a running watcher — dropping it stops the watcher and polling thread
pub struct WatcherHandle {
    _watcher: RecommendedWatcher,
    /// Signals the polling fallback thread to exit
    stop_flag: Arc<AtomicBool>,
}

impl Drop for WatcherHandle {
    fn drop(&mut self) {
        self.stop_flag.store(true, Ordering::Relaxed);
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
) {
    let transcript_path = match validate_transcript_path(transcript_path) {
        Ok(path) => path,
        Err(e) => {
            log::warn!(
                "Skipping transcript tailing for session {}: {}",
                session_id,
                e
            );
            return;
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
        transcript_path.clone(),
        cwd,
    ) {
        Ok(TranscriptStartStatus::Started) => {
            log::info!(
                "Started transcript tailing for session {}: {}",
                session_id,
                transcript_path.display()
            );
        }
        Ok(TranscriptStartStatus::Replaced) => {
            log::info!(
                "Switched transcript tailing for session {}: {}",
                session_id,
                transcript_path.display()
            );
        }
        Ok(TranscriptStartStatus::AlreadyRunning) => {}
        Err(e) => {
            log::warn!(
                "Failed to start transcript tailing for session {}: {}",
                session_id,
                e
            );
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

        match parse_statusline(&sid, &contents) {
            Ok(parsed) => {
                if let Err(e) = app_handle.emit("agent-status", &parsed.event) {
                    log::error!("Failed to emit agent-status event: {}", e);
                }

                if let Some(ref path) = parsed.transcript_path {
                    log::debug!("Transcript path for session {}: {}", sid, path);
                    maybe_start_transcript(&app_handle, &sid, path);
                }
            }
            Err(e) => {
                log::warn!("Failed to parse statusline for session {}: {}", sid, e);
            }
        }
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
        if let Ok(contents) = std::fs::read_to_string(&initial_path) {
            if !contents.trim().is_empty() {
                if let Ok(parsed) = parse_statusline(&initial_sid, &contents) {
                    let _ = initial_app.emit("agent-status", &parsed.event);
                    if let Some(ref path) = parsed.transcript_path {
                        maybe_start_transcript(&initial_app, &initial_sid, path);
                    }
                }
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

                if let Ok(parsed) = parse_statusline(&poll_sid, &contents) {
                    let _ = poll_app.emit("agent-status", &parsed.event);
                    if let Some(ref path) = parsed.transcript_path {
                        maybe_start_transcript(&poll_app, &poll_sid, path);
                    }
                }
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
        "Starting agent watcher: session={}, path={}",
        session_id,
        path.display()
    );

    // Debug-only file log for diagnosing watcher startup
    #[cfg(debug_assertions)]
    {
        use std::io::Write;
        use std::time::SystemTime;
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open("/tmp/vimeflow-debug.log")
        {
            let secs = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let _ = writeln!(
                f,
                "[{}] [watcher] start: session={}, cwd={}, path={}",
                secs,
                session_id,
                cwd,
                path.display()
            );
        }
    }

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
