//! Tauri command implementations for PTY operations

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::Read;
use tauri::{AppHandle, Emitter, State};

use super::state::{ManagedSession, PtyState};
use super::types::*;

/// Spawn a new PTY session with a shell
#[tauri::command]
pub async fn spawn_pty<R: tauri::Runtime>(
    app: AppHandle<R>,
    state: State<'_, PtyState>,
    request: SpawnPtyRequest,
) -> Result<PtySession, String> {
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

    // Validate cwd exists and is a directory (prevent path traversal)
    let cwd = std::fs::canonicalize(&request.cwd)
        .map_err(|e| format!("invalid cwd '{}': {}", request.cwd, e))?;
    if !cwd.is_dir() {
        return Err(format!("cwd is not a directory: {}", cwd.display()));
    }

    // Build command — env from IPC is ignored for security (prevents injection)
    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(&cwd);

    if request.env.is_some() {
        log::warn!(
            "Ignoring user-supplied env for session {} — IPC env injection not allowed",
            request.session_id
        );
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

    // Kill existing session if session_id is reused, to avoid orphaned processes
    if let Some(mut old_session) = state.remove(&request.session_id) {
        log::warn!(
            "Session {} already exists — killing old PTY before replacing",
            request.session_id
        );
        old_session.child.kill().ok();
        old_session.child.wait().ok();
    }

    // Store session with generation counter
    let generation = state.next_generation();
    let session = ManagedSession {
        master: pty_pair.master,
        writer,
        child,
        cwd: request.cwd.clone(),
        generation,
    };
    state.insert(request.session_id.clone(), session);

    // Spawn blocking thread for PTY read loop (avoids starving async runtime)
    let session_id = request.session_id.clone();
    let state_clone = state.inner().clone();
    std::thread::spawn(move || {
        let rt = tauri::async_runtime::handle();
        if let Err(e) = rt.block_on(read_pty_output(app, state_clone, session_id, generation)) {
            log::error!("PTY output reader error: {}", e);
        }
    });

    Ok(PtySession {
        id: request.session_id,
        pid,
        cwd: request.cwd,
    })
}

/// Write data to a PTY session
#[tauri::command]
pub fn write_pty(state: State<'_, PtyState>, request: WritePtyRequest) -> Result<(), String> {
    log::debug!("Writing to PTY {}: {:?}", request.session_id, request.data);

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
pub fn kill_pty(state: State<'_, PtyState>, request: KillPtyRequest) -> Result<(), String> {
    log::info!("Killing PTY session: {}", request.session_id);

    // Kill the process
    state
        .kill(&request.session_id)
        .map_err(|e| e.to_string())?;

    // Remove from state
    state.remove(&request.session_id);

    Ok(())
}

/// Background task to read PTY output and emit events
async fn read_pty_output<R: tauri::Runtime>(
    app: AppHandle<R>,
    state: PtyState,
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
                // Got data - emit to frontend
                let data = String::from_utf8_lossy(&buf[..n]).to_string();
                app.emit(
                    "pty-data",
                    PtyDataEvent {
                        session_id: session_id.clone(),
                        data,
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
    use tauri::test::{mock_builder, MockRuntime};
    use tauri::Manager;

    // Helper to create a test app handle
    fn create_test_app() -> tauri::App<MockRuntime> {
        let state = PtyState::new();
        mock_builder()
            .manage(state)
            .build(tauri::generate_context!())
            .expect("failed to build test app")
    }

    #[tokio::test]
    async fn spawn_pty_creates_session() {
        let app = create_test_app();
        let handle = app.handle();
        let state = handle.state::<PtyState>();

        let request = SpawnPtyRequest {
            session_id: "test-session".to_string(),
            cwd: std::env::current_dir()
                .unwrap()
                .to_string_lossy()
                .to_string(),
            shell: None,
            env: None,
        };

        let result = spawn_pty(handle.clone(), state.clone(), request).await;

        assert!(result.is_ok(), "spawn_pty should succeed");
        let session = result.unwrap();
        assert_eq!(session.id, "test-session");
        assert!(session.pid > 0);

        // Cleanup
        let _ = kill_pty(
            state.clone(),
            KillPtyRequest {
                session_id: "test-session".to_string(),
            },
        );
    }

    #[tokio::test]
    async fn write_pty_fails_for_nonexistent_session() {
        let app = create_test_app();
        let state = app.handle().state::<PtyState>();

        let request = WritePtyRequest {
            session_id: "nonexistent".to_string(),
            data: "test\n".to_string(),
        };

        let result = write_pty(state.clone(), request);

        assert!(result.is_err(), "write_pty should fail for nonexistent session");
    }

    #[tokio::test]
    async fn resize_pty_fails_for_nonexistent_session() {
        let app = create_test_app();
        let state = app.handle().state::<PtyState>();

        let request = ResizePtyRequest {
            session_id: "nonexistent".to_string(),
            rows: 24,
            cols: 80,
        };

        let result = resize_pty(state.clone(), request);

        assert!(result.is_err(), "resize_pty should fail for nonexistent session");
    }

    #[tokio::test]
    async fn kill_pty_removes_session() {
        let app = create_test_app();
        let handle = app.handle();
        let state = handle.state::<PtyState>();

        // First spawn a session
        let spawn_request = SpawnPtyRequest {
            session_id: "test-kill".to_string(),
            cwd: std::env::current_dir()
                .unwrap()
                .to_string_lossy()
                .to_string(),
            shell: None,
            env: None,
        };

        spawn_pty(handle.clone(), state.clone(), spawn_request)
            .await
            .expect("spawn should succeed");

        // Give background reader task time to initialize session
        std::thread::sleep(std::time::Duration::from_millis(50));

        // Verify session exists
        assert!(state.contains(&"test-kill".to_string()));

        // Kill it
        let kill_request = KillPtyRequest {
            session_id: "test-kill".to_string(),
        };

        let result = kill_pty(state.clone(), kill_request);

        assert!(result.is_ok(), "kill_pty should succeed");
        assert!(
            !state.contains(&"test-kill".to_string()),
            "session should be removed after kill"
        );
    }

    #[tokio::test]
    async fn write_pty_succeeds_multiple_times() {
        let app = create_test_app();
        let handle = app.handle();
        let state = handle.state::<PtyState>();

        // Spawn a session
        let spawn_request = SpawnPtyRequest {
            session_id: "test-multi-write".to_string(),
            cwd: std::env::current_dir()
                .unwrap()
                .to_string_lossy()
                .to_string(),
            shell: None,
            env: None,
        };

        spawn_pty(handle.clone(), state.clone(), spawn_request)
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
        let _ = kill_pty(
            state.clone(),
            KillPtyRequest {
                session_id: "test-multi-write".to_string(),
            },
        );
    }

    #[tokio::test]
    async fn session_remains_accessible_during_reader_startup() {
        // This test verifies the fix for the race condition where session was
        // temporarily removed from state during reader cloning, causing concurrent
        // writes/resizes to fail with "session not found"
        let app = create_test_app();
        let handle = app.handle();
        let state = handle.state::<PtyState>();

        // Spawn a session (this starts the background reader task)
        let spawn_request = SpawnPtyRequest {
            session_id: "test-race".to_string(),
            cwd: std::env::current_dir()
                .unwrap()
                .to_string_lossy()
                .to_string(),
            shell: None,
            env: None,
        };

        spawn_pty(handle.clone(), state.clone(), spawn_request)
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
        let _ = kill_pty(
            state.clone(),
            KillPtyRequest {
                session_id: "test-race".to_string(),
            },
        );
    }
}
