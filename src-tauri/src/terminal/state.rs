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

/// Reason why `PtyState::try_insert` rejected a new session — returned to
/// `spawn_pty` for mapping to user-facing error strings.
#[derive(Debug, PartialEq, Eq)]
pub enum TryInsertError {
    /// A session with the same id already exists in `PtyState`.
    AlreadyExists,
    /// `sessions.len() >= max` — adding would exceed the configured cap.
    CapReached,
}

/// Why `PtyState::kill` failed.
///
/// Round 9, Finding 1 (codex P1): `kill_pty` needs to distinguish "the
/// session isn't here, treat as already-dead" (idempotent path — clean up
/// the cache) from "the session IS here but the OS-level kill syscall
/// failed" (the child may still be alive — preserve state and propagate
/// the error so the user sees it and can retry instead of orphaning the
/// PTY process). The previous `anyhow::Result<()>` collapsed both into
/// one string, which forced `kill_pty` to swallow every error and clean
/// up unconditionally — eating real failures and leaking the live child.
#[derive(Debug)]
pub enum KillError {
    /// The session id was not present in `PtyState`. From the caller's
    /// perspective this is no-op territory — there is no PTY left to kill,
    /// so the state/cache cleanup that follows in `kill_pty` is safe.
    NotPresent,
    /// The session was present and we attempted `child.kill()`, but the
    /// underlying syscall returned an error. The child may still be alive;
    /// the session entry stays in `PtyState` so a retry can find it.
    KillFailed(String),
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

    /// Insert a new PTY session.
    ///
    /// Test-only after round 7 finding 3 — production callers use
    /// `try_insert` to take the cap check + insert under a single lock.
    /// Retained for tests that don't care about the cap and want a
    /// straight insert.
    #[cfg(test)]
    pub fn insert(&self, session_id: SessionId, session: ManagedSession) {
        let mut sessions = self.sessions.lock().expect("failed to lock sessions");
        sessions.insert(session_id, session);
    }

    /// Atomic check-and-insert: rejects when the session id already exists
    /// or when the active count is at or above `max`. The mutex is held for
    /// the entire check + insert, so two concurrent `spawn_pty` calls at
    /// exactly cap-1 (e.g. 63) cannot both pass the cap check and both
    /// insert — one wins, the other gets `CapReached`.
    ///
    /// Round 7, Finding 3 (claude MEDIUM): closes the TOCTOU window between
    /// `state.contains()`, `state.active_count()`, and `state.insert()` —
    /// each of which used to acquire and release the lock independently in
    /// `spawn_pty`. The duplicate-id race is largely academic given UUIDs,
    /// but the cap race is real: a burst of 65+ spawn calls on a near-full
    /// state could push `sessions.len()` over 64.
    ///
    /// On rejection the session is returned back via the Err variant so the
    /// caller can kill the child it owns — without this, ownership of the
    /// `ManagedSession` (and its `Box<dyn Child>`) would be lost inside
    /// `try_insert` and the freshly-spawned process would leak.
    pub fn try_insert(
        &self,
        session_id: SessionId,
        session: ManagedSession,
        max: usize,
    ) -> Result<(), (TryInsertError, ManagedSession)> {
        let mut sessions = self.sessions.lock().expect("failed to lock sessions");
        if sessions.contains_key(&session_id) {
            return Err((TryInsertError::AlreadyExists, session));
        }
        if sessions.len() >= max {
            return Err((TryInsertError::CapReached, session));
        }
        sessions.insert(session_id, session);
        Ok(())
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

    /// Return the number of active sessions.
    ///
    /// Test-only after round 7 finding 3 — production cap checks now run
    /// inside `try_insert` under a single lock. Retained for tests that
    /// want to assert state size invariants.
    #[cfg(test)]
    pub fn active_count(&self) -> usize {
        let sessions = self.sessions.lock().expect("failed to lock sessions");
        sessions.len()
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

    /// Kill a PTY session (send SIGTERM).
    ///
    /// Round 9, Finding 1 (codex P1): returns a typed `KillError` so callers
    /// can distinguish "session already gone" (idempotent — safe to clean up)
    /// from "OS-level kill failed" (child may still be alive — must preserve
    /// state). The previous `anyhow::Result<()>` collapsed both into one
    /// string, forcing `kill_pty` to either swallow everything (orphans the
    /// child on real failures) or reject everything (breaks the idempotent
    /// contract for missing sessions).
    pub fn kill(&self, session_id: &SessionId) -> Result<(), KillError> {
        let mut sessions = self.sessions.lock().expect("failed to lock sessions");
        let Some(session) = sessions.get_mut(session_id) else {
            return Err(KillError::NotPresent);
        };

        if let Err(e) = session.child.kill() {
            // Round 14, Claude MEDIUM: the process may have exited between
            // the read loop's last `remove_if_generation` and this kill.
            // Unix surfaces ESRCH and Windows surfaces ERROR_ACCESS_DENIED
            // for an already-dead PID — both arrive here as Err. Distinguish
            // "already gone" from a real kill failure by asking the child:
            // try_wait returns Ok(Some(_)) iff the process has been reaped.
            //
            // Returning Ok lets kill_pty proceed with cache cleanup. The
            // read loop's later `remove_if_generation` (or remove() called
            // by kill_pty) drops the lingering PtyState entry — both paths
            // are idempotent on a missing id. Without this branch, every
            // race-window kill surfaced as a KillFailed error to the UI
            // and stranded the session in cache as `alive` until the
            // read loop processed EOF.
            if matches!(session.child.try_wait(), Ok(Some(_))) {
                return Ok(());
            }

            return Err(KillError::KillFailed(e.to_string()));
        }

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

    /// Internal accessor for code that needs to take the sessions lock directly
    /// (e.g., the read loop accessing the ring buffer atomically).
    pub fn inner_sessions(&self) -> &Arc<Mutex<HashMap<SessionId, ManagedSession>>> {
        &self.sessions
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

    /// Build a real but ephemeral `ManagedSession` for tests that need
    /// `PtyState::try_insert` exercising. The shell is `/bin/true` so the
    /// child exits immediately — we don't care about its output, only that
    /// `Box<dyn MasterPty + Send>` and `Box<dyn Child + Send + Sync>` are
    /// real values that satisfy `try_insert`'s signature. The `Drop` impl
    /// of the test (running at the end of the function) reaps the children.
    #[cfg(test)]
    fn make_test_session() -> ManagedSession {
        use portable_pty::{native_pty_system, CommandBuilder, PtySize};
        let pty_system = native_pty_system();
        let pty_pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("openpty");
        // /bin/true exits immediately with status 0 — keeps the test fast
        // and avoids leaving long-running shells around if cleanup is
        // skipped.
        let cmd = CommandBuilder::new("/bin/true");
        let child = pty_pair.slave.spawn_command(cmd).expect("spawn");
        let writer = pty_pair.master.take_writer().expect("take_writer");
        ManagedSession {
            master: pty_pair.master,
            writer,
            child,
            cwd: "/tmp".into(),
            generation: 0,
            ring: Mutex::new(super::RingBuffer::new(64)),
        }
    }

    /// Fake `Child` whose `kill()` returns an `io::Error` — exercises the
    /// `KillError::KillFailed` branch without depending on host-level
    /// scheduler races to make a real child's `kill()` syscall fail.
    ///
    /// Round 9, Finding 1 (codex P1) regression scaffold.
    #[derive(Debug)]
    struct FailingKillChild;

    impl portable_pty::ChildKiller for FailingKillChild {
        fn kill(&mut self) -> std::io::Result<()> {
            Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "synthetic kill failure",
            ))
        }
        fn clone_killer(&self) -> Box<dyn portable_pty::ChildKiller + Send + Sync> {
            Box::new(FailingKillChild)
        }
    }

    impl portable_pty::Child for FailingKillChild {
        fn try_wait(&mut self) -> std::io::Result<Option<portable_pty::ExitStatus>> {
            Ok(None)
        }
        fn wait(&mut self) -> std::io::Result<portable_pty::ExitStatus> {
            Ok(portable_pty::ExitStatus::with_exit_code(0))
        }
        fn process_id(&self) -> Option<u32> {
            // Use a sentinel non-zero so `state.get_pid` returns Some(...)
            // — pretends the child is alive.
            Some(1)
        }
    }

    /// Build a `ManagedSession` whose `child.kill()` always errors. Reuses a
    /// real PTY pair for `master`/`writer` (the only working way to satisfy
    /// the trait-object types) but swaps the child for `FailingKillChild`.
    /// Reap the spawned helper child immediately so the OS-level process
    /// table stays clean — we only kept the pair to source a master/writer.
    #[cfg(test)]
    fn make_failing_kill_session() -> ManagedSession {
        use portable_pty::{native_pty_system, CommandBuilder, PtySize};
        let pty_system = native_pty_system();
        let pty_pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("openpty");
        // Spawn /bin/true and immediately drop the real child handle —
        // we only used the pair to obtain a master + writer of correct
        // trait-object types. The writer dangles when the helper exits,
        // which is fine because the test never writes to it.
        let cmd = CommandBuilder::new("/bin/true");
        let mut helper_child = pty_pair.slave.spawn_command(cmd).expect("spawn");
        // Reap the helper so it doesn't linger as a zombie in CI. Best-effort.
        let _ = helper_child.wait();
        let writer = pty_pair.master.take_writer().expect("take_writer");
        ManagedSession {
            master: pty_pair.master,
            writer,
            child: Box::new(FailingKillChild),
            cwd: "/tmp".into(),
            generation: 0,
            ring: Mutex::new(super::RingBuffer::new(64)),
        }
    }

    #[test]
    fn kill_returns_not_present_for_missing_session() {
        let state = PtyState::new();
        match state.kill(&"ghost".to_string()) {
            Err(KillError::NotPresent) => {}
            other => panic!("expected NotPresent, got {:?}", other),
        }
    }

    /// Round 9, Finding 1 (codex P1) — when the OS-level kill syscall
    /// fails, `kill` returns `KillError::KillFailed(_)` and the session
    /// stays in `PtyState`. Without this, `kill_pty` would clean up the
    /// cache while the child kept running, orphaning the PTY process.
    #[test]
    fn kill_returns_kill_failed_when_child_kill_errors_and_preserves_session() {
        let state = PtyState::new();
        state.insert("stuck".into(), make_failing_kill_session());
        assert!(state.contains(&"stuck".to_string()));

        match state.kill(&"stuck".to_string()) {
            Err(KillError::KillFailed(msg)) => {
                assert!(
                    msg.contains("synthetic kill failure"),
                    "expected synthetic message in error, got {msg:?}"
                );
            }
            other => panic!("expected KillFailed, got {:?}", other),
        }
        // The session MUST remain in PtyState so a retry can find it —
        // the child may still be alive on the OS side.
        assert!(
            state.contains(&"stuck".to_string()),
            "session should be retained after KillFailed so the user can retry"
        );
    }

    #[test]
    fn try_insert_succeeds_under_cap() {
        let state = PtyState::new();
        let result = state.try_insert("a".into(), make_test_session(), 4);
        assert!(result.is_ok());
        assert_eq!(state.active_count(), 1);
    }

    #[test]
    fn try_insert_rejects_duplicate_id() {
        let state = PtyState::new();
        // .expect would require ManagedSession: Debug for the Err variant;
        // unwrap via match to avoid the bound.
        match state.try_insert("dup".into(), make_test_session(), 4) {
            Ok(()) => {}
            Err(_) => panic!("first insert should succeed"),
        }
        let result = state.try_insert("dup".into(), make_test_session(), 4);
        match result {
            Err((TryInsertError::AlreadyExists, _)) => {}
            Err((other_reason, _)) => panic!("expected AlreadyExists, got {:?}", other_reason),
            Ok(()) => panic!("expected AlreadyExists, got Ok"),
        }
        // Cap stayed at 1 — the rejected insert did NOT bump the count.
        assert_eq!(state.active_count(), 1);
    }

    #[test]
    fn try_insert_rejects_when_at_cap() {
        let state = PtyState::new();
        for i in 0..3 {
            match state.try_insert(format!("s{}", i), make_test_session(), 3) {
                Ok(()) => {}
                Err(_) => panic!("under-cap insert should succeed"),
            }
        }
        let result = state.try_insert("overflow".into(), make_test_session(), 3);
        match result {
            Err((TryInsertError::CapReached, _)) => {}
            Err((other_reason, _)) => panic!("expected CapReached, got {:?}", other_reason),
            Ok(()) => panic!("expected CapReached, got Ok"),
        }
        assert_eq!(state.active_count(), 3);
    }

    /// Round 7, Finding 3 (claude MEDIUM) regression test.
    ///
    /// `state.contains() / state.active_count() / state.insert()` ran as
    /// three INDEPENDENT lock acquisitions in `spawn_pty`. Two concurrent
    /// callers at exactly cap-1 could both pass the cap check and both
    /// insert, ending at cap+1. `try_insert` holds the lock across the
    /// entire check + insert, so a burst of N callers against capacity K
    /// produces EXACTLY K successes — never K+1.
    ///
    /// We validate this by spawning 8 threads against a cap of 4. With
    /// proper atomicity, exactly 4 succeed; 4 fail with CapReached. A
    /// `Barrier` synchronizes the 8 threads to start as close to
    /// simultaneously as possible, maximizing the race window. With the
    /// pre-fix code (separate locks), this test would intermittently see
    /// 5+ successes — under proper atomicity, it's deterministic.
    #[test]
    fn try_insert_concurrent_does_not_exceed_cap() {
        use std::sync::Arc;
        use std::sync::Barrier;
        use std::thread;

        let state = Arc::new(PtyState::new());
        let cap = 4usize;
        let workers = 8usize;
        let barrier = Arc::new(Barrier::new(workers));

        let mut handles = Vec::with_capacity(workers);
        for i in 0..workers {
            let state = Arc::clone(&state);
            let barrier = Arc::clone(&barrier);
            handles.push(thread::spawn(move || {
                let session = make_test_session();
                // Wait for all workers to reach the barrier before any of
                // them call try_insert — maximizes the chance that the
                // contains/cap checks would have raced under the buggy
                // pre-fix implementation.
                barrier.wait();
                state.try_insert(format!("s{}", i), session, cap)
            }));
        }

        let mut succeeded = 0;
        let mut cap_rejections = 0;
        for h in handles {
            match h.join().unwrap() {
                Ok(()) => succeeded += 1,
                Err((TryInsertError::CapReached, _)) => cap_rejections += 1,
                Err((TryInsertError::AlreadyExists, _)) => {
                    panic!("unique ids — AlreadyExists impossible")
                }
            }
        }

        // EXACTLY `cap` succeed — not `cap + 1` (the buggy outcome) or
        // anything else. The remaining `workers - cap` get CapReached.
        assert_eq!(
            succeeded, cap,
            "exactly {cap} inserts should succeed, got {succeeded}"
        );
        assert_eq!(cap_rejections, workers - cap);
        assert_eq!(state.active_count(), cap);
    }
}
