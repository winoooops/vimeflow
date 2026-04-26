//! PTY session state management

use portable_pty::{Child, MasterPty};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use super::types::SessionId;

/// Global generation counter — monotonically increasing across all sessions
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// Bounded circular byte buffer paired with a monotonic byte offset.
///
/// Both fields advance under the same mutex (the one wrapping `RingBuffer`
/// inside `ManagedSession`), so a snapshot always returns `(bytes, end_offset)`
/// where `end_offset == start_offset + bytes.len()`. Required for the
/// replay/cursor protocol — see docs/superpowers/specs/2026-04-25-pty-reattach-on-reload-design.md
/// "Replay Buffer + Offset Cursor".
pub struct RingBuffer {
    bytes: VecDeque<u8>,
    capacity: usize,
    end_offset: u64,
}

impl RingBuffer {
    pub fn new(capacity: usize) -> Self {
        Self {
            bytes: VecDeque::with_capacity(capacity),
            capacity,
            end_offset: 0,
        }
    }

    /// Append a chunk and return its starting offset (the byte index of
    /// the first appended byte in the lifetime stream).
    pub fn append(&mut self, chunk: &[u8]) -> u64 {
        let chunk_start = self.end_offset;
        self.bytes.extend(chunk.iter().copied());
        while self.bytes.len() > self.capacity {
            self.bytes.pop_front();
        }
        self.end_offset += chunk.len() as u64;
        chunk_start
    }

    pub fn bytes_snapshot(&self) -> Vec<u8> {
        self.bytes.iter().copied().collect()
    }

    pub fn end_offset(&self) -> u64 {
        self.end_offset
    }
}

/// Managed PTY session with process handle and master PTY
pub struct ManagedSession {
    /// Master PTY (for resizing)
    pub master: Box<dyn MasterPty + Send>,
    /// PTY writer (for sending input)
    pub writer: Box<dyn std::io::Write + Send>,
    /// Child process handle
    pub child: Box<dyn Child + Send + Sync>,
    /// Current working directory
    #[allow(dead_code)]
    pub cwd: String,
    /// Generation counter — distinguishes old vs new session on ID reuse
    pub generation: u64,
    /// Ring buffer for recent output + monotonic offset (replay protocol)
    pub ring: Mutex<RingBuffer>,
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

    /// Allocate the next generation number
    pub fn next_generation(&self) -> u64 {
        GENERATION.fetch_add(1, Ordering::Relaxed)
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

    /// Remove a PTY session only if its generation matches the expected value.
    /// Prevents a stale reader thread from removing a replacement session.
    pub fn remove_if_generation(
        &self,
        session_id: &SessionId,
        expected_gen: u64,
    ) -> Option<ManagedSession> {
        let mut sessions = self.sessions.lock().expect("failed to lock sessions");
        let matches = sessions
            .get(session_id)
            .is_some_and(|s| s.generation == expected_gen);
        if matches {
            sessions.remove(session_id)
        } else {
            None
        }
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

    /// Get the resolved CWD for a session
    pub fn get_cwd(&self, session_id: &SessionId) -> Option<String> {
        let sessions = self.sessions.lock().expect("failed to lock sessions");
        sessions.get(session_id).map(|s| s.cwd.clone())
    }

    /// List all active PTY session IDs (E2E test-only)
    #[cfg(feature = "e2e-test")]
    pub fn active_ids(&self) -> Vec<SessionId> {
        let sessions = self.sessions.lock().expect("failed to lock sessions");
        sessions.keys().cloned().collect()
    }

    /// Write data to a PTY session
    pub fn write(&self, session_id: &SessionId, data: &[u8]) -> anyhow::Result<()> {
        let mut sessions = self.sessions.lock().expect("failed to lock sessions");
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| anyhow::anyhow!("session not found: {}", session_id))?;

        use std::io::Write;
        session
            .writer
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

    /// Clone the PTY reader for a session while keeping the session in state
    ///
    /// This avoids the race condition where removing/reinserting the session
    /// causes concurrent writes/resizes to fail with "session not found".
    pub fn clone_reader(
        &self,
        session_id: &SessionId,
    ) -> anyhow::Result<Box<dyn std::io::Read + Send>> {
        let sessions = self.sessions.lock().expect("failed to lock sessions");
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("session not found: {}", session_id))?;

        session
            .master
            .try_clone_reader()
            .map_err(|e| anyhow::anyhow!("failed to clone PTY reader: {}", e))
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

    #[test]
    fn ring_buffer_appends_and_advances_offset_under_one_lock() {
        use super::RingBuffer;
        let mut buf = RingBuffer::new(16);
        let start1 = buf.append(b"hello");
        assert_eq!(start1, 0);
        assert_eq!(buf.end_offset(), 5);
        assert_eq!(buf.bytes_snapshot(), b"hello");

        let start2 = buf.append(b"world");
        assert_eq!(start2, 5);
        assert_eq!(buf.end_offset(), 10);
        assert_eq!(buf.bytes_snapshot(), b"helloworld");
    }

    #[test]
    fn ring_buffer_truncates_from_front_at_capacity() {
        use super::RingBuffer;
        let mut buf = RingBuffer::new(8);
        buf.append(b"abcdefgh"); // exactly capacity
        assert_eq!(buf.bytes_snapshot(), b"abcdefgh");
        assert_eq!(buf.end_offset(), 8);

        buf.append(b"ij"); // overflows by 2
        assert_eq!(buf.bytes_snapshot(), b"cdefghij");
        assert_eq!(buf.end_offset(), 10); // total bytes ever, not buffer bytes
    }

    #[test]
    fn ring_buffer_end_offset_continues_past_truncation() {
        use super::RingBuffer;
        let mut buf = RingBuffer::new(4);
        for _ in 0..10 {
            buf.append(b"xy");
        }
        assert_eq!(buf.end_offset(), 20);
        assert_eq!(buf.bytes_snapshot().len(), 4);
    }
}
