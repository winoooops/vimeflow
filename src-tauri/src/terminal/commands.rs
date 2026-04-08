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

    // Determine shell path
    let shell = request.shell.unwrap_or_else(|| {
        if cfg!(target_os = "windows") {
            "powershell.exe".to_string()
        } else {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
        }
    });

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

    // Build command
    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(&request.cwd);

    // Add environment variables
    if let Some(env) = request.env {
        for (key, value) in env {
            cmd.env(key, value);
        }
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

    // Store session
    let session = ManagedSession {
        master: pty_pair.master,
        child,
        cwd: request.cwd.clone(),
    };
    state.insert(request.session_id.clone(), session);

    // Spawn background task to read PTY output
    let session_id = request.session_id.clone();
    let state_clone = state.inner().clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = read_pty_output(app, state_clone, session_id).await {
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
) -> anyhow::Result<()> {
    log::info!("Starting PTY output reader for session: {}", session_id);

    // Take the session out of state to get exclusive access to the reader
    let session = state
        .remove(&session_id)
        .ok_or_else(|| anyhow::anyhow!("session not found"))?;

    // Get reader from master PTY
    let mut reader = session
        .master
        .try_clone_reader()
        .map_err(|e| anyhow::anyhow!("failed to clone PTY reader: {}", e))?;

    // Put the session back into state
    state.insert(session_id.clone(), session);

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
                        exit_code: None,
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
                        error: e.to_string(),
                    },
                )
                .ok();
                break;
            }
        }
    }

    // Clean up session
    state.remove(&session_id);

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
}
