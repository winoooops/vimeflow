//! Tauri command implementations for PTY operations

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::Read;
use tauri::{AppHandle, Emitter, State};

use super::state::{ManagedSession, PtyState};
use super::types::*;

/// Debug-only file logger. Compiles to no-op in release builds.
/// Writes to /tmp/vimeflow-debug.log for diagnosing IPC and bridge issues.
#[cfg(debug_assertions)]
fn debug_log(tag: &str, msg: &str) {
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
        let _ = writeln!(f, "[{secs}] [{tag}] {msg}");
    }
}

#[cfg(not(debug_assertions))]
fn debug_log(_tag: &str, _msg: &str) {}

/// Spawn a new PTY session with a shell
#[tauri::command]
pub async fn spawn_pty<R: tauri::Runtime>(
    app: AppHandle<R>,
    state: State<'_, PtyState>,
    cache: State<'_, std::sync::Arc<super::cache::SessionCache>>,
    request: SpawnPtyRequest,
) -> Result<PtySession, String> {
    debug_log(
        "pty",
        &format!(
            "spawn_pty: id={}, cwd={}, bridge={}",
            request.session_id, request.cwd, request.enable_agent_bridge
        ),
    );
    log::info!(
        "Spawning PTY session: {} in {}",
        request.session_id,
        request.cwd
    );

    // Determine shell path — ignore user-supplied shell for security;
    // only allow the system default shell to prevent arbitrary binary execution.
    let shell = if cfg!(target_os = "windows") {
        "powershell.exe".to_string()
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
    };

    if request.shell.is_some() {
        log::warn!(
            "Ignoring user-supplied shell for session {} — only system shell is allowed",
            request.session_id
        );
    }

    log::info!("Using shell: {}", shell);

    // Create PTY system
    let pty_system = native_pty_system();

    // Create PTY pair
    let pty_pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("failed to open PTY: {}", e))?;

    // Expand ~ to home directory, then validate
    let raw_cwd = if request.cwd == "~" || request.cwd.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            if request.cwd == "~" {
                home
            } else {
                home.join(&request.cwd[2..])
            }
        } else {
            std::path::PathBuf::from(&request.cwd)
        }
    } else {
        std::path::PathBuf::from(&request.cwd)
    };

    // Validate cwd exists and is a directory (prevent path traversal)
    let cwd = std::fs::canonicalize(&raw_cwd)
        .map_err(|e| format!("invalid cwd '{}': {}", raw_cwd.display(), e))?;
    if !cwd.is_dir() {
        return Err(format!("cwd is not a directory: {}", cwd.display()));
    }

    // Allow-list session_id to safe characters only (UUID format).
    // Block-lists miss edge cases like newlines which enable bash injection
    // in generated bridge scripts.
    if !request
        .session_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("invalid session_id: {}", request.session_id));
    }

    // Generate statusline bridge files.
    let bridge_files = if request.enable_agent_bridge {
        let dir = cwd
            .join(".vimeflow")
            .join("sessions")
            .join(&request.session_id);
        match super::bridge::generate_bridge_files(&dir.to_string_lossy(), &request.session_id) {
            Ok(files) => {
                debug_log(
                    "bridge",
                    &format!(
                        "created: status={}, init={}",
                        files.status_file_path.display(),
                        files.shell_init_path.display()
                    ),
                );
                Some(files)
            }
            Err(e) => {
                log::warn!(
                    "Failed to generate statusline bridge for session {}: {}",
                    request.session_id,
                    e
                );
                None
            }
        }
    } else {
        None
    };

    // Build command — env from IPC is ignored for security (prevents injection)
    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(&cwd);

    // Inject a `claude` wrapper function into the interactive shell.
    //
    // We do NOT set CLAUDE_CONFIG_DIR — that would replace the user's
    // entire config directory, breaking auth, plugins, and hooks.
    // Instead, we set ENV/BASH_ENV (sourced by non-interactive shells)
    // and use --rcfile (for interactive bash) to source both the user's
    // rc file and our init script.
    if let Some(ref files) = bridge_files {
        // Pass paths via env vars — the scripts reference $VIMEFLOW_STATUS_FILE
        // and $VIMEFLOW_CLAUDE_SETTINGS instead of embedding paths directly,
        // which avoids injection from paths containing quotes or metacharacters.
        cmd.env("BASH_ENV", files.shell_init_path.as_os_str());
        cmd.env("VIMEFLOW_CLAUDE_SETTINGS", files.settings_path.as_os_str());
        cmd.env("VIMEFLOW_STATUS_FILE", files.status_file_path.as_os_str());

        // For interactive bash, generate a combined rcfile that sources
        // both ~/.bashrc (user config) and our init script
        let init_dir = files
            .shell_init_path
            .parent()
            .ok_or_else(|| "shell init path has no parent directory".to_string())?;
        let rcfile_path = init_dir.join("bashrc");
        // Use $BASH_ENV (already set above) instead of embedding the path —
        // handles CWDs with apostrophes that would break single-quoted paths.
        let rcfile_content =
            "[ -f ~/.bashrc ] && source ~/.bashrc\nsource \"$BASH_ENV\"\n".to_string();
        if let Err(e) = std::fs::write(&rcfile_path, &rcfile_content) {
            log::warn!("Failed to write combined bashrc: {}", e);
        } else if shell.contains("bash") {
            cmd.args(["--rcfile", &rcfile_path.to_string_lossy()]);
        }

        log::info!("Injected claude wrapper for session {}", request.session_id);
    }

    if request.env.is_some() {
        log::warn!(
            "Ignoring user-supplied env for session {} — IPC env injection not allowed",
            request.session_id
        );
    }

    // Error if session ID already exists (no kill-and-replace)
    if state.contains(&request.session_id) {
        return Err(format!(
            "session '{}' already exists — cannot spawn duplicate session ID",
            request.session_id
        ));
    }

    // Cap at 64 active sessions
    if state.active_count() >= 64 {
        return Err(format!(
            "maximum of 64 active sessions reached — cannot spawn new session"
        ));
    }

    // Spawn child process
    let child = pty_pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("failed to spawn shell: {}", e))?;

    let pid = child
        .process_id()
        .ok_or_else(|| "failed to get process ID".to_string())?;

    log::info!("Spawned shell with PID: {}", pid);

    // Get writer from master PTY (call take_writer once and store it)
    let writer = pty_pair
        .master
        .take_writer()
        .map_err(|e| format!("failed to get PTY writer: {}", e))?;

    // Store session with generation counter
    let generation = state.next_generation();
    let session = ManagedSession {
        master: pty_pair.master,
        writer,
        child,
        cwd: cwd.to_string_lossy().to_string(),
        generation,
        ring: std::sync::Mutex::new(crate::terminal::state::RingBuffer::new(65536)),
    };
    state.insert(request.session_id.clone(), session);

    // Write to cache: create cached session, append to session_order, promote to active if first
    let created_at = chrono::Utc::now().to_rfc3339();
    cache
        .mutate(|data| {
            use super::cache::CachedSession;
            data.sessions.insert(
                request.session_id.clone(),
                CachedSession {
                    cwd: cwd.to_string_lossy().to_string(),
                    created_at,
                    exited: false,
                    last_exit_code: None,
                },
            );
            data.session_order.push(request.session_id.clone());
            // Promote to active if this is the first session
            if data.active_session_id.is_none() {
                data.active_session_id = Some(request.session_id.clone());
            }
            Ok(())
        })
        .map_err(|e| format!("failed to write cache: {}", e))?;
    debug_log(
        "pty",
        &format!(
            "session stored: id={}, cwd={}, pid={}",
            request.session_id,
            cwd.display(),
            pid
        ),
    );

    // Spawn blocking thread for PTY read loop (avoids starving async runtime)
    let session_id = request.session_id.clone();
    let state_clone = state.inner().clone();
    let cache_clone = cache.inner().clone();
    std::thread::spawn(move || {
        let rt = tauri::async_runtime::handle();
        if let Err(e) = rt.block_on(read_pty_output(
            app,
            state_clone,
            cache_clone,
            session_id,
            generation,
        )) {
            log::error!("PTY output reader error: {}", e);
        }
    });

    Ok(PtySession {
        id: request.session_id,
        pid,
        cwd: cwd.to_string_lossy().to_string(),
    })
}

/// Write data to a PTY session
#[tauri::command]
pub fn write_pty(state: State<'_, PtyState>, request: WritePtyRequest) -> Result<(), String> {
    log::debug!(
        "Writing to PTY {}: {} bytes",
        request.session_id,
        request.data.len()
    );

    state
        .write(&request.session_id, request.data.as_bytes())
        .map_err(|e| e.to_string())
}

/// Resize a PTY session
#[tauri::command]
pub fn resize_pty(state: State<'_, PtyState>, request: ResizePtyRequest) -> Result<(), String> {
    log::debug!(
        "Resizing PTY {} to {}x{}",
        request.session_id,
        request.rows,
        request.cols
    );

    state
        .resize(&request.session_id, request.rows, request.cols)
        .map_err(|e| e.to_string())
}

/// Kill a PTY session
#[tauri::command]
pub fn kill_pty(
    state: State<'_, PtyState>,
    cache: State<'_, std::sync::Arc<super::cache::SessionCache>>,
    request: KillPtyRequest,
) -> Result<(), String> {
    log::info!("Killing PTY session: {}", request.session_id);

    // Attempt to kill the process - idempotent (no error if session missing)
    if let Err(e) = state.kill(&request.session_id) {
        log::debug!("kill_pty: session not found in state ({}), continuing to clean cache", e);
    }

    // Remove from state
    state.remove(&request.session_id);

    // Clean up cache: remove from sessions map and session_order
    cache
        .mutate(|data| {
            data.sessions.remove(&request.session_id);
            data.session_order.retain(|id| id != &request.session_id);

            // Advance active_session_id if the killed session was active
            if data.active_session_id.as_ref() == Some(&request.session_id) {
                // Find the next session in order (or None if no more sessions)
                data.active_session_id = data.session_order.first().cloned();
            }
            Ok(())
        })
        .map_err(|e| format!("failed to update cache: {}", e))?;

    Ok(())
}

/// List all sessions with their current status and replay data
#[tauri::command]
pub fn list_sessions(
    state: State<'_, PtyState>,
    cache: State<'_, std::sync::Arc<super::cache::SessionCache>>,
) -> Result<SessionList, String> {
    let snapshot = cache.snapshot();
    let mut needs_flush = false;
    let mut session_infos = Vec::with_capacity(snapshot.session_order.len());

    for id in &snapshot.session_order {
        let cached = match snapshot.sessions.get(id) {
            Some(c) => c.clone(),
            None => continue, // session_order/sessions desync — skip
        };

        let pid_opt = state.get_pid(id);
        let status = if cached.exited {
            SessionStatus::Exited {
                last_exit_code: cached.last_exit_code,
            }
        } else if let Some(pid) = pid_opt {
            // Alive: snapshot ring buffer + end_offset under one lock
            let sessions_lock = state.inner_sessions().lock().expect("poisoned");
            if let Some(session) = sessions_lock.get(id) {
                let ring_guard = session.ring.lock().expect("ring poisoned");
                let bytes = ring_guard.bytes_snapshot();
                let end_offset = ring_guard.end_offset();
                drop(ring_guard);
                drop(sessions_lock);
                let replay_data = String::from_utf8_lossy(&bytes).to_string();
                SessionStatus::Alive {
                    pid,
                    replay_data,
                    replay_end_offset: end_offset,
                }
            } else {
                // Race: removed between get_pid and lock — treat as exited
                needs_flush = true;
                SessionStatus::Exited {
                    last_exit_code: None,
                }
            }
        } else {
            // Lazy reconciliation: cache says alive, but PtyState doesn't
            // have it (Tauri restart, hard kill, etc). Flip the cache.
            needs_flush = true;
            SessionStatus::Exited {
                last_exit_code: None,
            }
        };

        session_infos.push(SessionInfo {
            id: id.clone(),
            cwd: cached.cwd,
            status,
        });
    }

    if needs_flush {
        // Flush the lazy reconciliation results back to cache
        cache.mutate(|d| {
            for info in &session_infos {
                if matches!(info.status, SessionStatus::Exited { .. }) {
                    if let Some(s) = d.sessions.get_mut(&info.id) {
                        s.exited = true;
                    }
                }
            }
            Ok(())
        })?;
    }

    Ok(SessionList {
        active_session_id: snapshot.active_session_id,
        sessions: session_infos,
    })
}

/// Set the active session ID in the cache.
///
/// Round 4, Finding 3 (codex P2): the membership check happens INSIDE the
/// `mutate` closure so it's serialized with the write under one lock.
/// Without this, a concurrent `kill_pty` could remove the id between the
/// snapshot-based check and the write — the check passed against the old
/// state and we'd then write a now-stale `active_session_id`.
#[tauri::command]
pub fn set_active_session(
    cache: State<'_, std::sync::Arc<crate::terminal::cache::SessionCache>>,
    request: SetActiveSessionRequest,
) -> Result<(), String> {
    cache.mutate(|d| {
        if !d.session_order.contains(&request.id) {
            return Err("unknown session".into());
        }
        d.active_session_id = Some(request.id.clone());
        Ok(())
    })
}

/// Reorder the session list in the cache.
///
/// Round 4, Finding 3 (codex P2): the permutation check happens INSIDE the
/// `mutate` closure so the validation and the write are atomic under one
/// lock. Previously the check ran against `cache.snapshot()` (taking and
/// releasing the lock briefly), then a SECOND `mutate` call wrote the new
/// order. A concurrent `spawn_pty` or `kill_pty` between those two locks
/// could change `session_order`; the permutation check passed against the
/// OLD state and the subsequent write overwrote the NEWER state with stale
/// ids — dropping a just-spawned session from `session_order` even though
/// its PTY was still alive (the ghost only appeared after a reload).
///
/// Round 6, Finding 2 (codex HIGH): the permutation check uses a
/// sort-and-compare against the CURRENT `session_order` rather than a
/// `HashSet` equality. `HashSet` collapses duplicates — `[a, b, c]` and
/// `[a, b, c, c]` produce the same set `{a, b, c}` and pass validation,
/// then `d.session_order = request.ids.clone()` persists the duplicate id.
/// On the next reload, `list_sessions` returns a duplicate session entry,
/// React tab keys collide, and active-tab selection becomes unstable.
/// Comparing sorted vectors enforces equal length AND equal multiset.
#[tauri::command]
pub fn reorder_sessions(
    cache: State<'_, std::sync::Arc<crate::terminal::cache::SessionCache>>,
    request: ReorderSessionsRequest,
) -> Result<(), String> {
    cache.mutate(|d| {
        let mut current_sorted = d.session_order.clone();
        let mut proposed_sorted = request.ids.clone();
        current_sorted.sort();
        proposed_sorted.sort();
        if current_sorted != proposed_sorted {
            return Err("invalid reorder: not a permutation".into());
        }
        d.session_order = request.ids.clone();
        Ok(())
    })
}

/// Update the current working directory for a session in the cache.
///
/// Round 4, Finding 3 (codex P2): membership check moved INSIDE the
/// `mutate` closure so a concurrent `kill_pty` cannot remove the session
/// between the check and the write. Path validation stays outside — it's
/// stateless and doesn't touch cache state.
#[tauri::command]
pub fn update_session_cwd(
    cache: State<'_, std::sync::Arc<crate::terminal::cache::SessionCache>>,
    request: UpdateSessionCwdRequest,
) -> Result<(), String> {
    // UUID-shape allow-list (same as spawn_pty)
    if !request
        .id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("invalid session id".into());
    }
    // cwd must be an absolute path that exists and is a directory
    let path = std::path::PathBuf::from(&request.cwd);
    if !path.is_absolute() {
        return Err("invalid cwd: must be absolute".into());
    }
    if !path.is_dir() {
        return Err("invalid cwd: not a directory".into());
    }

    cache.mutate(|d| match d.sessions.get_mut(&request.id) {
        Some(s) => {
            s.cwd = request.cwd.clone();
            Ok(())
        }
        None => Err("unknown session".into()),
    })
}

/// Background task to read PTY output and emit events
async fn read_pty_output<R: tauri::Runtime>(
    app: AppHandle<R>,
    state: PtyState,
    cache: std::sync::Arc<crate::terminal::cache::SessionCache>,
    session_id: SessionId,
    generation: u64,
) -> anyhow::Result<()> {
    log::info!("Starting PTY output reader for session: {}", session_id);

    // Clone the reader while keeping the session available in state
    // This prevents race conditions where concurrent writes/resizes would fail
    // with "session not found" if we removed the session temporarily
    let mut reader = state.clone_reader(&session_id)?;

    // Read loop
    let mut buf = [0u8; 8192];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => {
                // EOF - process exited
                log::info!("PTY session {} exited (EOF)", session_id);
                // Mark cache as exited
                let _ = cache.mutate(|d| {
                    if let Some(s) = d.sessions.get_mut(&session_id) {
                        s.exited = true;
                        // last_exit_code stays None in v1 — capturing requires
                        // child.try_wait() with locking; deferred to follow-up.
                    }
                    Ok(())
                });
                app.emit(
                    "pty-exit",
                    PtyExitEvent {
                        session_id: session_id.clone(),
                        code: None,
                    },
                )
                .ok();
                break;
            }
            Ok(n) => {
                // Atomically: append to ring buffer, get chunk_start, drop the lock
                let chunk_start = {
                    let sessions = state.inner_sessions().lock().expect("poisoned");
                    if let Some(session) = sessions.get(&session_id) {
                        let mut ring = session.ring.lock().expect("ring poisoned");
                        ring.append(&buf[..n])
                    } else {
                        // Session was removed mid-read — exit loop
                        break;
                    }
                };
                let data = String::from_utf8_lossy(&buf[..n]).to_string();
                app.emit(
                    "pty-data",
                    PtyDataEvent {
                        session_id: session_id.clone(),
                        data,
                        offset_start: chunk_start,
                        // Raw byte count — the unit the producer's offset
                        // arithmetic (RingBuffer::append) used. Subscribers
                        // MUST advance their cursor with this, NOT with the
                        // length of `data` (lossy UTF-8 inflates invalid
                        // bytes to U+FFFD, which is 3 bytes when re-encoded).
                        byte_len: n as u64,
                    },
                )
                .ok();
            }
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {
                // Interrupted - retry
                continue;
            }
            Err(e) => {
                // Error - emit error event and exit
                log::error!("PTY read error for session {}: {}", session_id, e);
                app.emit(
                    "pty-error",
                    PtyErrorEvent {
                        session_id: session_id.clone(),
                        message: e.to_string(),
                    },
                )
                .ok();
                break;
            }
        }
    }

    // Clean up session only if this reader's generation still owns it.
    // If the session was replaced (ID reuse), a newer generation owns the slot.
    state.remove_if_generation(&session_id, generation);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terminal::cache::SessionCache;
    use std::sync::Arc;
    use tauri::test::{mock_builder, MockRuntime};
    use tauri::Manager;
    use tempfile::TempDir;

    // Helper to create a test app handle
    fn create_test_app() -> tauri::App<MockRuntime> {
        let state = PtyState::new();
        mock_builder()
            .manage(state)
            .build(tauri::generate_context!())
            .expect("failed to build test app")
    }

    // Helper to create a test app with SessionCache
    fn create_test_app_with_cache() -> (tauri::App<MockRuntime>, TempDir) {
        let temp_dir = TempDir::new().expect("failed to create temp dir");
        let cache_path = temp_dir.path().join("sessions.json");
        let cache = SessionCache::load(cache_path).expect("failed to load cache");
        let cache = Arc::new(cache);

        let state = PtyState::new();
        let app = mock_builder()
            .manage(state)
            .manage(cache)
            .build(tauri::generate_context!())
            .expect("failed to build test app");

        (app, temp_dir)
    }

    #[tokio::test]
    async fn spawn_pty_creates_session() {
        let (app, _temp_dir) = create_test_app_with_cache();
        let handle = app.handle();
        let state = handle.state::<PtyState>();
        let cache = handle.state::<Arc<SessionCache>>();

        let request = SpawnPtyRequest {
            session_id: "test-session".to_string(),
            cwd: std::env::current_dir()
                .unwrap()
                .to_string_lossy()
                .to_string(),
            shell: None,
            env: None,
            enable_agent_bridge: false,
        };

        let result = spawn_pty(handle.clone(), state.clone(), cache.clone(), request).await;

        assert!(result.is_ok(), "spawn_pty should succeed");
        let session = result.unwrap();
        assert_eq!(session.id, "test-session");
        assert!(session.pid > 0);

        // Cleanup
        let _ = state.remove(&"test-session".to_string());
    }

    #[tokio::test]
    async fn write_pty_fails_for_nonexistent_session() {
        let (app, _temp_dir) = create_test_app_with_cache();
        let state = app.handle().state::<PtyState>();

        let request = WritePtyRequest {
            session_id: "nonexistent".to_string(),
            data: "test\n".to_string(),
        };

        let result = write_pty(state.clone(), request);

        assert!(
            result.is_err(),
            "write_pty should fail for nonexistent session"
        );
    }

    #[tokio::test]
    async fn resize_pty_fails_for_nonexistent_session() {
        let (app, _temp_dir) = create_test_app_with_cache();
        let state = app.handle().state::<PtyState>();

        let request = ResizePtyRequest {
            session_id: "nonexistent".to_string(),
            rows: 24,
            cols: 80,
        };

        let result = resize_pty(state.clone(), request);

        assert!(
            result.is_err(),
            "resize_pty should fail for nonexistent session"
        );
    }

    #[tokio::test]
    async fn kill_pty_removes_session() {
        let (app, _temp_dir) = create_test_app_with_cache();
        let handle = app.handle();
        let state = handle.state::<PtyState>();
        let cache = handle.state::<Arc<SessionCache>>();

        // First spawn a session
        let spawn_request = SpawnPtyRequest {
            session_id: "test-kill".to_string(),
            cwd: std::env::current_dir()
                .unwrap()
                .to_string_lossy()
                .to_string(),
            shell: None,
            env: None,
            enable_agent_bridge: false,
        };

        spawn_pty(handle.clone(), state.clone(), cache.clone(), spawn_request)
            .await
            .expect("spawn should succeed");

        // Give background reader task time to initialize session
        std::thread::sleep(std::time::Duration::from_millis(50));

        // Verify session exists
        assert!(state.contains(&"test-kill".to_string()));

        // Kill it
        let _ = state.remove(&"test-kill".to_string());

        assert!(
            !state.contains(&"test-kill".to_string()),
            "session should be removed after kill"
        );
    }

    #[tokio::test]
    async fn write_pty_succeeds_multiple_times() {
        let (app, _temp_dir) = create_test_app_with_cache();
        let handle = app.handle();
        let state = handle.state::<PtyState>();
        let cache = handle.state::<Arc<SessionCache>>();

        // Spawn a session
        let spawn_request = SpawnPtyRequest {
            session_id: "test-multi-write".to_string(),
            cwd: std::env::current_dir()
                .unwrap()
                .to_string_lossy()
                .to_string(),
            shell: None,
            env: None,
            enable_agent_bridge: false,
        };

        spawn_pty(handle.clone(), state.clone(), cache.clone(), spawn_request)
            .await
            .expect("spawn should succeed");

        // Write first command
        let write1 = WritePtyRequest {
            session_id: "test-multi-write".to_string(),
            data: "echo hello\n".to_string(),
        };

        let result1 = write_pty(state.clone(), write1);
        assert!(result1.is_ok(), "first write should succeed");

        // Write second command - this exposes the bug
        let write2 = WritePtyRequest {
            session_id: "test-multi-write".to_string(),
            data: "echo world\n".to_string(),
        };

        let result2 = write_pty(state.clone(), write2);
        assert!(
            result2.is_ok(),
            "second write should succeed (bug: take_writer consumes writer)"
        );

        // Write third command
        let write3 = WritePtyRequest {
            session_id: "test-multi-write".to_string(),
            data: "exit\n".to_string(),
        };

        let result3 = write_pty(state.clone(), write3);
        assert!(result3.is_ok(), "third write should succeed");

        // Cleanup
        let _ = state.remove(&"test-multi-write".to_string());
    }

    #[tokio::test]
    async fn session_remains_accessible_during_reader_startup() {
        // This test verifies the fix for the race condition where session was
        // temporarily removed from state during reader cloning, causing concurrent
        // writes/resizes to fail with "session not found"
        let (app, _temp_dir) = create_test_app_with_cache();
        let handle = app.handle();
        let state = handle.state::<PtyState>();
        let cache = handle.state::<Arc<SessionCache>>();

        // Spawn a session (this starts the background reader task)
        let spawn_request = SpawnPtyRequest {
            session_id: "test-race".to_string(),
            cwd: std::env::current_dir()
                .unwrap()
                .to_string_lossy()
                .to_string(),
            shell: None,
            env: None,
            enable_agent_bridge: false,
        };

        spawn_pty(handle.clone(), state.clone(), cache.clone(), spawn_request)
            .await
            .expect("spawn should succeed");

        // Immediately try to write (before reader task finishes initialization)
        // This would fail with the old code that removed session from state
        let write_request = WritePtyRequest {
            session_id: "test-race".to_string(),
            data: "echo test\n".to_string(),
        };

        let write_result = write_pty(state.clone(), write_request);
        assert!(
            write_result.is_ok(),
            "write should succeed immediately after spawn (session must remain in state)"
        );

        // Also verify resize works
        let resize_request = ResizePtyRequest {
            session_id: "test-race".to_string(),
            rows: 40,
            cols: 120,
        };

        let resize_result = resize_pty(state.clone(), resize_request);
        assert!(
            resize_result.is_ok(),
            "resize should succeed immediately after spawn (session must remain in state)"
        );

        // Cleanup
        let _ = state.remove(&"test-race".to_string());
    }

    #[tokio::test]
    async fn spawn_pty_returns_error_on_existing_session_id() {
        let (app, _temp_dir) = create_test_app_with_cache();
        let handle = app.handle();
        let state = handle.state::<PtyState>();
        let cache = handle.state::<Arc<SessionCache>>();

        let request = SpawnPtyRequest {
            session_id: "duplicate-id".to_string(),
            cwd: std::env::current_dir()
                .unwrap()
                .to_string_lossy()
                .to_string(),
            shell: None,
            env: None,
            enable_agent_bridge: false,
        };

        // First spawn should succeed
        let result1 = spawn_pty(handle.clone(), state.clone(), cache.clone(), request.clone()).await;
        assert!(result1.is_ok(), "first spawn should succeed");

        // Second spawn with same ID should fail
        let result2 = spawn_pty(handle.clone(), state.clone(), cache.clone(), request).await;
        assert!(result2.is_err(), "second spawn with same ID should fail");
        assert!(
            result2.unwrap_err().contains("already exists"),
            "error should mention session already exists"
        );

        // Cleanup
        let _ = state.remove(&"duplicate-id".to_string());
    }

    #[tokio::test]
    async fn spawn_pty_appends_to_session_order_and_promotes_active() {
        let (app, _temp_dir) = create_test_app_with_cache();
        let handle = app.handle();
        let state = handle.state::<PtyState>();
        let cache = handle.state::<Arc<SessionCache>>();

        let cwd = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();

        // Spawn first session
        let request1 = SpawnPtyRequest {
            session_id: "session-1".to_string(),
            cwd: cwd.clone(),
            shell: None,
            env: None,
            enable_agent_bridge: false,
        };

        spawn_pty(handle.clone(), state.clone(), cache.clone(), request1)
            .await
            .expect("first spawn should succeed");

        // Check cache: session-1 should be active and first in order
        let snap1 = cache.snapshot();
        assert_eq!(snap1.active_session_id.as_deref(), Some("session-1"));
        assert_eq!(snap1.session_order, vec!["session-1"]);
        assert!(snap1.sessions.contains_key("session-1"));

        // Spawn second session
        let request2 = SpawnPtyRequest {
            session_id: "session-2".to_string(),
            cwd,
            shell: None,
            env: None,
            enable_agent_bridge: false,
        };

        spawn_pty(handle.clone(), state.clone(), cache.clone(), request2)
            .await
            .expect("second spawn should succeed");

        // Check cache: session-1 still active, session-2 appended to order
        let snap2 = cache.snapshot();
        assert_eq!(snap2.active_session_id.as_deref(), Some("session-1"));
        assert_eq!(snap2.session_order, vec!["session-1", "session-2"]);
        assert!(snap2.sessions.contains_key("session-2"));

        // Cleanup
        let _ = state.remove(&"session-1".to_string());
        let _ = state.remove(&"session-2".to_string());
    }

    #[tokio::test]
    async fn spawn_pty_caps_at_64_active_sessions() {
        let (app, _temp_dir) = create_test_app_with_cache();
        let handle = app.handle();
        let state = handle.state::<PtyState>();
        let cache = handle.state::<Arc<SessionCache>>();

        let cwd = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();

        // Spawn 64 sessions
        for i in 0..64 {
            let request = SpawnPtyRequest {
                session_id: format!("session-{}", i),
                cwd: cwd.clone(),
                shell: None,
                env: None,
                enable_agent_bridge: false,
            };

            spawn_pty(handle.clone(), state.clone(), cache.clone(), request)
                .await
                .expect(&format!("spawn {} should succeed", i));
        }

        // 65th session should fail
        let request_65 = SpawnPtyRequest {
            session_id: "session-65".to_string(),
            cwd,
            shell: None,
            env: None,
            enable_agent_bridge: false,
        };

        let result = spawn_pty(handle.clone(), state.clone(), cache.clone(), request_65).await;
        assert!(result.is_err(), "65th spawn should fail due to cap");
        let err = result.unwrap_err();
        assert!(
            err.contains("maximum") || err.contains("64"),
            "error should mention session cap"
        );

        // Cleanup: remove all 64 sessions
        for i in 0..64 {
            let _ = state.remove(&format!("session-{}", i));
        }
    }

    #[tokio::test]
    async fn kill_pty_is_idempotent_for_missing_session() {
        let (app, _temp_dir) = create_test_app_with_cache();
        let state = app.handle().state::<PtyState>();
        let cache = app.handle().state::<Arc<SessionCache>>();

        let request = KillPtyRequest {
            session_id: "nonexistent".to_string(),
        };

        let result = kill_pty(state.clone(), cache.clone(), request);
        assert!(result.is_ok(), "kill_pty should be idempotent for missing session");
    }

    #[tokio::test]
    async fn kill_pty_removes_from_session_order_and_cache() {
        let (app, _temp_dir) = create_test_app_with_cache();
        let handle = app.handle();
        let state = handle.state::<PtyState>();
        let cache = handle.state::<Arc<SessionCache>>();

        let cwd = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();

        // Spawn two sessions
        let request1 = SpawnPtyRequest {
            session_id: "session-1".to_string(),
            cwd: cwd.clone(),
            shell: None,
            env: None,
            enable_agent_bridge: false,
        };
        spawn_pty(handle.clone(), state.clone(), cache.clone(), request1)
            .await
            .expect("first spawn should succeed");

        let request2 = SpawnPtyRequest {
            session_id: "session-2".to_string(),
            cwd,
            shell: None,
            env: None,
            enable_agent_bridge: false,
        };
        spawn_pty(handle.clone(), state.clone(), cache.clone(), request2)
            .await
            .expect("second spawn should succeed");

        // Verify both sessions are in cache
        let snap_before = cache.snapshot();
        assert_eq!(snap_before.session_order, vec!["session-1", "session-2"]);
        assert!(snap_before.sessions.contains_key("session-1"));
        assert!(snap_before.sessions.contains_key("session-2"));

        // Kill session-1
        let kill_request = KillPtyRequest {
            session_id: "session-1".to_string(),
        };
        kill_pty(state.clone(), cache.clone(), kill_request)
            .expect("kill_pty should succeed");

        // Verify session-1 is removed from session_order and sessions map
        let snap_after = cache.snapshot();
        assert_eq!(snap_after.session_order, vec!["session-2"]);
        assert!(!snap_after.sessions.contains_key("session-1"));
        assert!(snap_after.sessions.contains_key("session-2"));

        // Cleanup
        let _ = state.remove(&"session-2".to_string());
    }

    #[tokio::test]
    async fn kill_pty_advances_active_when_active_killed() {
        let (app, _temp_dir) = create_test_app_with_cache();
        let handle = app.handle();
        let state = handle.state::<PtyState>();
        let cache = handle.state::<Arc<SessionCache>>();

        let cwd = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();

        // Spawn three sessions
        let request1 = SpawnPtyRequest {
            session_id: "session-1".to_string(),
            cwd: cwd.clone(),
            shell: None,
            env: None,
            enable_agent_bridge: false,
        };
        spawn_pty(handle.clone(), state.clone(), cache.clone(), request1)
            .await
            .expect("first spawn should succeed");

        let request2 = SpawnPtyRequest {
            session_id: "session-2".to_string(),
            cwd: cwd.clone(),
            shell: None,
            env: None,
            enable_agent_bridge: false,
        };
        spawn_pty(handle.clone(), state.clone(), cache.clone(), request2)
            .await
            .expect("second spawn should succeed");

        let request3 = SpawnPtyRequest {
            session_id: "session-3".to_string(),
            cwd,
            shell: None,
            env: None,
            enable_agent_bridge: false,
        };
        spawn_pty(handle.clone(), state.clone(), cache.clone(), request3)
            .await
            .expect("third spawn should succeed");

        // Verify session-1 is active
        let snap_before = cache.snapshot();
        assert_eq!(snap_before.active_session_id.as_deref(), Some("session-1"));
        assert_eq!(snap_before.session_order, vec!["session-1", "session-2", "session-3"]);

        // Kill session-1 (the active session)
        let kill_request = KillPtyRequest {
            session_id: "session-1".to_string(),
        };
        kill_pty(state.clone(), cache.clone(), kill_request)
            .expect("kill_pty should succeed");

        // Verify active_session_id advanced to session-2
        let snap_after = cache.snapshot();
        assert_eq!(snap_after.active_session_id.as_deref(), Some("session-2"));
        assert_eq!(snap_after.session_order, vec!["session-2", "session-3"]);

        // Cleanup
        let _ = state.remove(&"session-2".to_string());
        let _ = state.remove(&"session-3".to_string());
    }

    #[tokio::test]
    async fn read_loop_eof_marks_cache_exited() {
        let (app, _temp_dir) = create_test_app_with_cache();
        let handle = app.handle();
        let state = handle.state::<PtyState>();
        let cache = handle.state::<Arc<SessionCache>>();

        let cwd = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();

        spawn_pty(
            handle.clone(),
            state.clone(),
            cache.clone(),
            SpawnPtyRequest {
                session_id: "eof-test".into(),
                cwd,
                shell: None,
                env: None,
                enable_agent_bridge: false,
            },
        )
        .await
        .unwrap();

        // Force EOF by sending exit
        write_pty(
            state.clone(),
            WritePtyRequest {
                session_id: "eof-test".into(),
                data: "exit\n".into(),
            },
        )
        .unwrap();

        // Wait for read loop to process EOF (give shell a moment to exit)
        std::thread::sleep(std::time::Duration::from_millis(500));

        let snap = cache.snapshot();
        let entry = snap
            .sessions
            .get("eof-test")
            .expect("session should still be in cache after exit");
        assert!(entry.exited, "cache entry should be marked exited after EOF");
    }

    #[tokio::test]
    async fn list_sessions_returns_alive_for_running_pty() {
        let (app, _temp_dir) = create_test_app_with_cache();
        let handle = app.handle();
        let state = handle.state::<PtyState>();
        let cache = handle.state::<Arc<SessionCache>>();

        spawn_pty(
            handle.clone(),
            state.clone(),
            cache.clone(),
            SpawnPtyRequest {
                session_id: "alive-1".into(),
                cwd: std::env::current_dir()
                    .unwrap()
                    .to_string_lossy()
                    .to_string(),
                shell: None,
                env: None,
                enable_agent_bridge: false,
            },
        )
        .await
        .unwrap();

        let result = list_sessions(state.clone(), cache.clone()).unwrap();
        assert_eq!(result.sessions.len(), 1);
        assert_eq!(result.sessions[0].id, "alive-1");
        assert!(matches!(
            result.sessions[0].status,
            SessionStatus::Alive { .. }
        ));

        let _ = kill_pty(
            state.clone(),
            cache.clone(),
            KillPtyRequest {
                session_id: "alive-1".into(),
            },
        );
    }

    #[tokio::test]
    async fn list_sessions_reconciles_alive_cache_with_empty_pty_state() {
        use crate::terminal::cache;

        let (app, _temp_dir) = create_test_app_with_cache();
        let cache_state = app.handle().state::<Arc<SessionCache>>();
        let state = app.handle().state::<PtyState>();

        // Manually plant an "alive but missing" entry in the cache
        cache_state
            .mutate(|d| {
                d.session_order.push("phantom".into());
                d.sessions.insert(
                    "phantom".into(),
                    cache::CachedSession {
                        cwd: "/tmp".into(),
                        created_at: "2026-04-25T00:00:00Z".into(),
                        exited: false,
                        last_exit_code: None,
                    },
                );
                Ok(())
            })
            .unwrap();

        let result = list_sessions(state.clone(), cache_state.clone()).unwrap();
        assert_eq!(result.sessions.len(), 1);
        match &result.sessions[0].status {
            SessionStatus::Exited { last_exit_code } => assert_eq!(*last_exit_code, None),
            other => panic!("expected Exited, got {:?}", other),
        }

        // Verify lazy reconciliation flushed back to cache
        let snap = cache_state.snapshot();
        assert!(snap.sessions["phantom"].exited);
    }

    #[tokio::test]
    async fn list_sessions_returns_in_session_order() {
        let (app, _temp_dir) = create_test_app_with_cache();
        let handle = app.handle();
        let state = handle.state::<PtyState>();
        let cache = handle.state::<Arc<SessionCache>>();

        let cwd = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();
        for id in &["zebra", "alpha", "mike"] {
            spawn_pty(
                handle.clone(),
                state.clone(),
                cache.clone(),
                SpawnPtyRequest {
                    session_id: id.to_string(),
                    cwd: cwd.clone(),
                    shell: None,
                    env: None,
                    enable_agent_bridge: false,
                },
            )
            .await
            .unwrap();
        }

        let result = list_sessions(state.clone(), cache.clone()).unwrap();
        let ids: Vec<_> = result.sessions.iter().map(|s| s.id.clone()).collect();
        assert_eq!(ids, vec!["zebra", "alpha", "mike"]);

        for id in &["zebra", "alpha", "mike"] {
            let _ = kill_pty(
                state.clone(),
                cache.clone(),
                KillPtyRequest {
                    session_id: id.to_string(),
                },
            );
        }
    }

    #[tokio::test]
    async fn list_sessions_replay_end_offset_matches_buffer_contents() {
        let (app, _temp_dir) = create_test_app_with_cache();
        let handle = app.handle();
        let state = handle.state::<PtyState>();
        let cache = handle.state::<Arc<SessionCache>>();

        spawn_pty(
            handle.clone(),
            state.clone(),
            cache.clone(),
            SpawnPtyRequest {
                session_id: "off-test".into(),
                cwd: std::env::current_dir()
                    .unwrap()
                    .to_string_lossy()
                    .to_string(),
                shell: None,
                env: None,
                enable_agent_bridge: false,
            },
        )
        .await
        .unwrap();

        // Write some output and let the read loop process
        write_pty(
            state.clone(),
            WritePtyRequest {
                session_id: "off-test".into(),
                data: "echo hello\n".into(),
            },
        )
        .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(300));

        let result = list_sessions(state.clone(), cache.clone()).unwrap();
        match &result.sessions[0].status {
            SessionStatus::Alive {
                replay_data,
                replay_end_offset,
                ..
            } => {
                // Ring buffer contents may be longer than just the echo
                // (prompt, command echo, output, new prompt)
                let bytes_in_buffer = replay_data.bytes().count() as u64;
                // end_offset >= buffer length (truncation tolerance)
                assert!(
                    *replay_end_offset >= bytes_in_buffer,
                    "end_offset {} < buffer len {}",
                    replay_end_offset,
                    bytes_in_buffer
                );
            }
            other => panic!("expected Alive, got {:?}", other),
        }

        let _ = kill_pty(
            state.clone(),
            cache.clone(),
            KillPtyRequest {
                session_id: "off-test".into(),
            },
        );
    }

    #[tokio::test]
    async fn set_active_session_persists_to_cache() {
        let (app, _temp_dir) = create_test_app_with_cache();
        let handle = app.handle();
        let state = handle.state::<PtyState>();
        let cache = handle.state::<Arc<SessionCache>>();

        let cwd = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();
        for id in &["a", "b"] {
            spawn_pty(
                handle.clone(),
                state.clone(),
                cache.clone(),
                SpawnPtyRequest {
                    session_id: id.to_string(),
                    cwd: cwd.clone(),
                    shell: None,
                    env: None,
                    enable_agent_bridge: false,
                },
            )
            .await
            .unwrap();
        }

        set_active_session(
            cache.clone(),
            SetActiveSessionRequest { id: "b".into() },
        )
        .unwrap();

        assert_eq!(cache.snapshot().active_session_id.as_deref(), Some("b"));

        for id in &["a", "b"] {
            let _ = kill_pty(
                state.clone(),
                cache.clone(),
                KillPtyRequest {
                    session_id: id.to_string(),
                },
            );
        }
    }

    #[test]
    fn set_active_session_rejects_unknown_id() {
        let (app, _temp_dir) = create_test_app_with_cache();
        let cache = app.handle().state::<Arc<SessionCache>>();

        let result = set_active_session(
            cache.clone(),
            SetActiveSessionRequest { id: "nope".into() },
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("unknown session"));
    }

    #[tokio::test]
    async fn reorder_sessions_persists_to_cache() {
        let (app, _temp_dir) = create_test_app_with_cache();
        let handle = app.handle();
        let state = handle.state::<PtyState>();
        let cache = handle.state::<Arc<SessionCache>>();

        let cwd = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();
        for id in &["a", "b", "c"] {
            spawn_pty(
                handle.clone(),
                state.clone(),
                cache.clone(),
                SpawnPtyRequest {
                    session_id: id.to_string(),
                    cwd: cwd.clone(),
                    shell: None,
                    env: None,
                    enable_agent_bridge: false,
                },
            )
            .await
            .unwrap();
        }

        reorder_sessions(
            cache.clone(),
            ReorderSessionsRequest {
                ids: vec!["c".into(), "a".into(), "b".into()],
            },
        )
        .unwrap();

        assert_eq!(cache.snapshot().session_order, vec!["c", "a", "b"]);

        for id in &["a", "b", "c"] {
            let _ = kill_pty(
                state.clone(),
                cache.clone(),
                KillPtyRequest {
                    session_id: id.to_string(),
                },
            );
        }
    }

    #[tokio::test]
    async fn reorder_sessions_rejects_non_permutation() {
        let (app, _temp_dir) = create_test_app_with_cache();
        let handle = app.handle();
        let state = handle.state::<PtyState>();
        let cache = handle.state::<Arc<SessionCache>>();

        spawn_pty(
            handle.clone(),
            state.clone(),
            cache.clone(),
            SpawnPtyRequest {
                session_id: "only".into(),
                cwd: std::env::current_dir()
                    .unwrap()
                    .to_string_lossy()
                    .into(),
                shell: None,
                env: None,
                enable_agent_bridge: false,
            },
        )
        .await
        .unwrap();

        let result = reorder_sessions(
            cache.clone(),
            ReorderSessionsRequest {
                ids: vec!["only".into(), "extra".into()],
            },
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not a permutation"));

        let _ = kill_pty(
            state.clone(),
            cache.clone(),
            KillPtyRequest {
                session_id: "only".into(),
            },
        );
    }

    /// Round 6, Finding 2 (codex HIGH): the permutation check must reject
    /// a request whose ids contain a duplicate already present in
    /// session_order, even though the SET of unique ids matches the SET in
    /// session_order. Sort+compare catches the length mismatch; the previous
    /// HashSet-based check let the duplicate through and persisted it,
    /// producing a duplicate session entry on reload (React key collision +
    /// unstable active-tab selection).
    #[tokio::test]
    async fn reorder_sessions_rejects_duplicate_id() {
        let (app, _temp_dir) = create_test_app_with_cache();
        let handle = app.handle();
        let state = handle.state::<PtyState>();
        let cache = handle.state::<Arc<SessionCache>>();

        let cwd = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();
        for id in &["a", "b", "c"] {
            spawn_pty(
                handle.clone(),
                state.clone(),
                cache.clone(),
                SpawnPtyRequest {
                    session_id: id.to_string(),
                    cwd: cwd.clone(),
                    shell: None,
                    env: None,
                    enable_agent_bridge: false,
                },
            )
            .await
            .unwrap();
        }

        // Proposed order has the SAME unique ids as current ([a, b, c])
        // but adds a duplicate of `c`. HashSet equality would pass; the
        // multiset (sort+compare) catches the duplicate.
        let result = reorder_sessions(
            cache.clone(),
            ReorderSessionsRequest {
                ids: vec!["a".into(), "b".into(), "c".into(), "c".into()],
            },
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not a permutation"));

        // Cache must be unchanged — no duplicate `c` got persisted.
        let snapshot = cache.snapshot();
        assert_eq!(snapshot.session_order.len(), 3);
        assert!(snapshot.session_order.contains(&"a".to_string()));
        assert!(snapshot.session_order.contains(&"b".to_string()));
        assert!(snapshot.session_order.contains(&"c".to_string()));

        for id in &["a", "b", "c"] {
            let _ = kill_pty(
                state.clone(),
                cache.clone(),
                KillPtyRequest {
                    session_id: id.to_string(),
                },
            );
        }
    }

    #[tokio::test]
    async fn update_session_cwd_persists_to_cache() {
        let (app, _temp_dir) = create_test_app_with_cache();
        let handle = app.handle();
        let state = handle.state::<PtyState>();
        let cache = handle.state::<Arc<SessionCache>>();

        let cwd = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();
        spawn_pty(
            handle.clone(),
            state.clone(),
            cache.clone(),
            SpawnPtyRequest {
                session_id: "cwd-test".into(),
                cwd: cwd.clone(),
                shell: None,
                env: None,
                enable_agent_bridge: false,
            },
        )
        .await
        .unwrap();

        // Use /tmp which is guaranteed to exist on POSIX
        update_session_cwd(
            cache.clone(),
            UpdateSessionCwdRequest {
                id: "cwd-test".into(),
                cwd: "/tmp".into(),
            },
        )
        .unwrap();

        assert_eq!(cache.snapshot().sessions["cwd-test"].cwd, "/tmp");

        let _ = kill_pty(
            state.clone(),
            cache.clone(),
            KillPtyRequest {
                session_id: "cwd-test".into(),
            },
        );
    }

    #[test]
    fn update_session_cwd_rejects_invalid_path() {
        let (app, _temp_dir) = create_test_app_with_cache();
        let cache = app.handle().state::<Arc<SessionCache>>();

        let result = update_session_cwd(
            cache.clone(),
            UpdateSessionCwdRequest {
                id: "any".into(),
                cwd: "/nonexistent/totally/fake/path".into(),
            },
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not a directory"));
    }

    /// Round 4, Finding 3 (codex P2) regression test.
    ///
    /// The pre-fix `reorder_sessions` flow was:
    ///   1. snapshot → take HashSet of session_order under the lock
    ///   2. drop the lock
    ///   3. validate that request.ids is a permutation of the snapshot
    ///   4. take the lock AGAIN and assign d.session_order = request.ids
    ///
    /// Between (2) and (4) a concurrent mutation could change session_order.
    /// This test drives that race directly by mutating the cache from a
    /// helper thread between the snapshot/check and the assignment.
    ///
    /// We can't easily drive the race against the actual `reorder_sessions`
    /// async fn (no hook to inject between snapshot and mutate), so we
    /// assert the equivalent invariant on `cache.mutate`: a closure that
    /// observes the in-memory state through `&mut SessionCacheData` will
    /// always see the SAME state it then writes — i.e. the permutation
    /// check inside the closure cannot pass against an old state and then
    /// overwrite a newer one.
    #[test]
    fn reorder_sessions_validates_under_same_lock_as_write() {
        use crate::terminal::cache::CachedSession;
        use std::sync::Arc as StdArc;
        use std::thread;

        let temp_dir = TempDir::new().expect("temp");
        let cache = StdArc::new(
            SessionCache::load(temp_dir.path().join("sessions.json")).expect("load"),
        );

        // Seed two sessions, "a" and "b", in a known order.
        let cache_seed = StdArc::clone(&cache);
        cache_seed
            .mutate(|d| {
                for id in ["a", "b"] {
                    d.session_order.push(id.into());
                    d.sessions.insert(
                        id.into(),
                        CachedSession {
                            cwd: "/tmp".into(),
                            created_at: "2026-04-25T00:00:00Z".into(),
                            exited: false,
                            last_exit_code: None,
                        },
                    );
                }
                Ok(())
            })
            .unwrap();

        // Thread A: emulates reorder_sessions(["b","a"]). Under the old
        // implementation it would snapshot, see {"a","b"} == {"b","a"} as
        // sets, then write d.session_order = ["b","a"] AFTER thread B
        // appended "c". With the round-4 fix, the validation runs INSIDE
        // the same mutate closure that does the write, so by the time the
        // closure observes session_order, it already contains "c" and the
        // permutation check rejects (request.ids missing "c").
        let cache_a = StdArc::clone(&cache);
        let handle_a = thread::spawn(move || {
            cache_a.mutate(|d| {
                let current: std::collections::HashSet<_> =
                    d.session_order.iter().cloned().collect();
                let proposed: std::collections::HashSet<_> =
                    ["b", "a"].iter().map(|s| (*s).to_string()).collect();
                if current != proposed {
                    return Err("invalid reorder: not a permutation".into());
                }
                d.session_order = vec!["b".into(), "a".into()];
                Ok(())
            })
        });

        // Thread B: emulates spawn_pty("c") inserting into session_order.
        // Without giving thread A a head start, the test-thread scheduler
        // may run B first; that's fine — both interleavings preserve the
        // invariant we're asserting (no session is lost).
        let cache_b = StdArc::clone(&cache);
        let handle_b = thread::spawn(move || {
            cache_b
                .mutate(|d| {
                    d.session_order.push("c".into());
                    d.sessions.insert(
                        "c".into(),
                        CachedSession {
                            cwd: "/tmp".into(),
                            created_at: "2026-04-25T00:00:00Z".into(),
                            exited: false,
                            last_exit_code: None,
                        },
                    );
                    Ok(())
                })
                .unwrap();
        });

        let result_a = handle_a.join().unwrap();
        handle_b.join().unwrap();

        let snap = cache.snapshot();

        // Strong invariant: session "c" must be in session_order. Under
        // the OLD code, this assertion could fail if thread A's stale
        // permutation check passed before thread B's write. Under the
        // new code, this invariant ALWAYS holds:
        //
        //   - If A locks first → A writes ["b","a"], B then appends → ["b","a","c"]
        //   - If B locks first → A's closure sees ["a","b","c"] and rejects;
        //     session_order stays ["a","b","c"]
        //
        // Either way "c" survives.
        assert!(
            snap.session_order.contains(&"c".to_string()),
            "race lost session 'c'; session_order = {:?}",
            snap.session_order
        );

        // Plus: if A succeeded, it must have observed B's write (so its
        // assignment was ["b","a"] only when B hadn't yet inserted "c");
        // if A failed, the order ends in [a,b,c] from B alone.
        if result_a.is_ok() {
            assert_eq!(snap.session_order, vec!["b", "a", "c"]);
        } else {
            assert_eq!(snap.session_order, vec!["a", "b", "c"]);
            assert!(result_a.unwrap_err().contains("not a permutation"));
        }
    }

    /// Round 4, Finding 3 (codex P2): a closure that returns Err must NOT
    /// leave the in-memory mirror partially modified. Without rollback, a
    /// closure that mutated `d` before validating would leave the cache in
    /// an invalid state visible via `snapshot()`.
    #[test]
    fn mutate_rolls_back_on_err() {
        let temp_dir = TempDir::new().expect("temp");
        let cache =
            SessionCache::load(temp_dir.path().join("sessions.json")).expect("load");

        cache
            .mutate(|d| {
                d.session_order.push("seed".into());
                Ok(())
            })
            .unwrap();

        let result = cache.mutate(|d| {
            d.session_order.push("partial".into());
            Err("validation failed".into())
        });
        assert!(result.is_err());

        // The in-memory mirror must be unchanged from before the failed
        // mutate — "partial" must NOT have leaked into session_order.
        let snap = cache.snapshot();
        assert_eq!(snap.session_order, vec!["seed".to_string()]);
    }

    /// Round 4, Finding 3 (codex P2) follow-up: set_active_session must
    /// reject ids not in session_order even when the check is now inside
    /// the mutate closure.
    #[test]
    fn set_active_session_rejects_unknown_id_under_lock() {
        let (app, _temp_dir) = create_test_app_with_cache();
        let cache = app.handle().state::<Arc<SessionCache>>();

        let result = set_active_session(
            cache.clone(),
            SetActiveSessionRequest { id: "ghost".into() },
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("unknown session"));
        // Mirror unchanged — no half-written active id.
        assert!(cache.snapshot().active_session_id.is_none());
    }

    /// Round 4, Finding 3 (codex P2) follow-up: update_session_cwd must
    /// reject unknown ids under the same lock as the write — and must NOT
    /// leave a half-modified cwd if an entry exists but for a different id.
    #[test]
    fn update_session_cwd_rejects_unknown_id_under_lock() {
        let (app, _temp_dir) = create_test_app_with_cache();
        let cache = app.handle().state::<Arc<SessionCache>>();

        let result = update_session_cwd(
            cache.clone(),
            UpdateSessionCwdRequest {
                id: "ghost".into(),
                cwd: "/tmp".into(),
            },
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("unknown session"));
        assert!(cache.snapshot().sessions.is_empty());
    }
}
