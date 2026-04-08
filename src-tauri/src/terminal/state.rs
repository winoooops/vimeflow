//! PTY session state management

use portable_pty::{Child, MasterPty};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use super::types::SessionId;

/// Managed PTY session with process handle and master PTY
pub struct ManagedSession {
    /// Master PTY (for writing input)
    pub master: Box<dyn MasterPty + Send>,
    /// Child process handle
    pub child: Box<dyn Child + Send + Sync>,
    /// Current working directory
    #[allow(dead_code)]
    pub cwd: String,
}

/// Thread-safe PTY session state
///
/// Stores active PTY sessions in a HashMap protected by a Mutex.
/// Shared across the Tauri application via Arc.
#[derive(Default, Clone)]
pub struct PtyState {
    sessions: Arc<Mutex<HashMap<SessionId, ManagedSession>>>,
}

impl PtyState {
    /// Create a new empty PTY state
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Insert a new PTY session
    pub fn insert(&self, session_id: SessionId, session: ManagedSession) {
        let mut sessions = self.sessions.lock().expect("failed to lock sessions");
        sessions.insert(session_id, session);
    }

    /// Remove a PTY session
    pub fn remove(&self, session_id: &SessionId) -> Option<ManagedSession> {
        let mut sessions = self.sessions.lock().expect("failed to lock sessions");
        sessions.remove(session_id)
    }

    /// Check if a session exists
    #[allow(dead_code)]
    pub fn contains(&self, session_id: &SessionId) -> bool {
        let sessions = self.sessions.lock().expect("failed to lock sessions");
        sessions.contains_key(session_id)
    }

    /// Get the process ID for a session
    #[allow(dead_code)]
    pub fn get_pid(&self, session_id: &SessionId) -> Option<u32> {
        let sessions = self.sessions.lock().expect("failed to lock sessions");
        sessions.get(session_id).and_then(|s| s.child.process_id())
    }

    /// Write data to a PTY session
    pub fn write(&self, session_id: &SessionId, data: &[u8]) -> anyhow::Result<()> {
        let mut sessions = self.sessions.lock().expect("failed to lock sessions");
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| anyhow::anyhow!("session not found: {}", session_id))?;

        use std::io::Write;
        let mut writer = session.master.take_writer().map_err(|e| {
            anyhow::anyhow!("failed to get PTY writer: {}", e)
        })?;

        writer
            .write_all(data)
            .map_err(|e| anyhow::anyhow!("failed to write to PTY: {}", e))?;

        Ok(())
    }

    /// Resize a PTY session
    pub fn resize(&self, session_id: &SessionId, rows: u16, cols: u16) -> anyhow::Result<()> {
        let mut sessions = self.sessions.lock().expect("failed to lock sessions");
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| anyhow::anyhow!("session not found: {}", session_id))?;

        let size = portable_pty::PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };

        session
            .master
            .resize(size)
            .map_err(|e| anyhow::anyhow!("failed to resize PTY: {}", e))?;

        Ok(())
    }

    /// Kill a PTY session (send SIGTERM)
    pub fn kill(&self, session_id: &SessionId) -> anyhow::Result<()> {
        let mut sessions = self.sessions.lock().expect("failed to lock sessions");
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| anyhow::anyhow!("session not found: {}", session_id))?;

        session
            .child
            .kill()
            .map_err(|e| anyhow::anyhow!("failed to kill PTY process: {}", e))?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_empty_state() {
        let state = PtyState::new();
        assert!(!state.contains(&"test-session".to_string()));
    }

    #[test]
    fn contains_returns_false_for_missing_session() {
        let state = PtyState::new();
        assert!(!state.contains(&"nonexistent".to_string()));
    }
}
