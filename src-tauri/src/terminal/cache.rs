//! Filesystem cache for session metadata.
//!
//! Single source of truth for: session order, active session id, per-session
//! cwd / created_at / exited / last_exit_code. Lives at
//! `app_data_dir/sessions.json`; written atomically via `tempfile.persist`.
//! In-memory mirror (Mutex<SessionCache>) avoids re-reading the file on
//! every IPC call.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CachedSession {
    pub cwd: String,
    pub created_at: String, // ISO-8601 UTC
    pub exited: bool,
    pub last_exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionCacheData {
    pub version: u32,
    #[serde(default)]
    pub active_session_id: Option<String>,
    #[serde(default)]
    pub session_order: Vec<String>,
    #[serde(default)]
    pub sessions: HashMap<String, CachedSession>,
}

impl Default for SessionCacheData {
    fn default() -> Self {
        Self {
            version: SCHEMA_VERSION,
            active_session_id: None,
            session_order: Vec::new(),
            sessions: HashMap::new(),
        }
    }
}

#[derive(Debug)]
pub struct SessionCache {
    path: PathBuf,
    data: Mutex<SessionCacheData>,
}

impl SessionCache {
    /// Load from disk; if file is absent, return an empty cache.
    /// Returns Err only on corrupted/unreadable files — caller logs + degrades.
    pub fn load(path: PathBuf) -> Result<Self, String> {
        let data = if path.exists() {
            let bytes = fs::read(&path).map_err(|e| format!("read cache: {e}"))?;
            serde_json::from_slice::<SessionCacheData>(&bytes)
                .map_err(|e| format!("parse cache: {e}"))?
        } else {
            SessionCacheData::default()
        };
        Ok(Self {
            path,
            data: Mutex::new(data),
        })
    }

    /// Load from disk; if corrupted, move aside and start empty.
    /// Never panics; always returns a valid cache.
    pub fn load_or_recover(path: PathBuf) -> Self {
        match Self::load(path.clone()) {
            Ok(cache) => cache,
            Err(e) => {
                log::warn!("cache load failed ({e}); moving aside and starting empty");
                let backup = path.with_extension(format!(
                    "json.corrupt-{}",
                    chrono::Utc::now().format("%Y%m%d%H%M%S")
                ));
                let _ = std::fs::rename(&path, &backup);
                Self::load(path).expect("empty cache load should never fail")
            }
        }
    }

    /// Snapshot the in-memory mirror.
    pub fn snapshot(&self) -> SessionCacheData {
        self.data.lock().expect("cache mutex poisoned").clone()
    }

    /// Apply a mutation under the lock, then atomically flush to disk WHILE
    /// STILL HOLDING THE LOCK. Returns Ok even if disk flush fails —
    /// in-memory mirror is updated regardless so frontend reload still
    /// restores correctly. Disk failure is logged.
    ///
    /// Round 3, Finding 1 (codex P1): the lock MUST be held across
    /// `flush_to_disk` so two overlapping mutations cannot persist their
    /// snapshots out of order. With the previous implementation the lock was
    /// released before the disk write, so two concurrent `mutate()` calls
    /// could run as `lock-A → modify → unlock-A → lock-B → modify → unlock-B
    /// → flush-B → flush-A`, leaving disk with the OLDER snapshot even
    /// though the in-memory mirror ended in the right state. After a reload
    /// (which reads the disk file), the wrong active tab or tab order would
    /// surface. Serializing the flush with the mutation is correctness by
    /// construction.
    ///
    /// Round 4, Finding 3 (codex P2): the closure can now return
    /// `Result<(), String>` so callers may VALIDATE state and reject the
    /// mutation under the same lock. Without this, callers had to snapshot,
    /// validate, drop the lock, then mutate — letting a concurrent
    /// spawn/kill change the underlying state between the validation and
    /// the write. `reorder_sessions` was the canonical victim: it could
    /// pass a permutation check against an old `session_order`, then
    /// overwrite the newer state with stale ids. Validation under the
    /// mutate lock makes the check + write atomic.
    ///
    /// The perf cost is real but acceptable: `mutate()` is called at
    /// human-interactive frequency (tab create / kill / reorder), not in
    /// tight loops. A typical local-SSD `flush_to_disk` takes a few ms
    /// (mkdir + tempfile write + persist-rename), and the mutex is
    /// uncontended in the steady state. Holding the lock across the I/O
    /// blocks other mutators for that window — at human cadence this is
    /// invisible. Validation is done under the same lock — a closure that
    /// returns Err DOES NOT trigger a flush (no state to persist).
    pub fn mutate<F>(&self, f: F) -> Result<(), String>
    where
        F: FnOnce(&mut SessionCacheData) -> Result<(), String>,
    {
        // Round 7, Finding 1 (claude HIGH) test hook: lets `commands.rs`
        // unit tests force a `mutate` failure to verify spawn_pty's
        // cache-first ordering reaps the orphan child instead of leaving
        // it in PtyState. Compiled out of release builds. Returning Err
        // BEFORE acquiring the lock is intentional — we want the tested
        // failure path to behave identically to a closure that returns
        // Err, which is what real cache writes can do (validation under
        // lock per round 4 finding 3).
        #[cfg(test)]
        if let Some(err) = test_force_mutate_err::take() {
            return Err(err);
        }

        let mut guard = self.data.lock().expect("cache mutex poisoned");
        // Snapshot the pre-mutation state so a closure that returns Err
        // doesn't half-modify the in-memory mirror. Cheap enough at
        // human-interactive frequency, and only paid on the validation
        // failure path.
        let pre = guard.clone();
        match f(&mut guard) {
            Ok(()) => {
                // Best-effort disk write — held under the lock so concurrent
                // mutations cannot reorder their flushes.
                if let Err(e) = self.flush_to_disk(&guard) {
                    log::warn!("cache flush failed (in-memory still updated): {e}");
                }
                Ok(())
            }
            Err(e) => {
                // Roll back any partial mutation. The closure may have
                // touched the data before deciding to bail (e.g. validation
                // happens after a clone or partial assignment), so restore
                // the pre-mutation snapshot to keep the in-memory mirror
                // consistent with what callers see via `snapshot()`.
                *guard = pre;
                Err(e)
            }
        }
    }

    /// Wipe all sessions, session order, and active id — for graceful-exit
    /// cleanup so the next launch starts fresh instead of showing ghost
    /// "Restart" tabs for sessions that died with the app.
    ///
    /// This is invoked from the Tauri `RunEvent::ExitRequested` handler in
    /// `lib.rs`. Process-kill paths (SIGKILL, OOM, panic, sudden power loss)
    /// skip that handler — the lazy reconciliation in `list_sessions`
    /// (cache says alive + PtyState empty → flip to Exited) is the
    /// correctness safety net for those, by design (see
    /// memory: feedback_lazy_reconciliation_over_shutdown_hooks).
    ///
    /// Held under the same `mutate` lock + atomic disk flush as every other
    /// state change, so a concurrent IPC mutation can't race the wipe.
    pub fn clear_all(&self) -> Result<(), String> {
        self.mutate(|d| {
            d.sessions.clear();
            d.session_order.clear();
            d.active_session_id = None;
            Ok(())
        })
    }

    fn flush_to_disk(&self, data: &SessionCacheData) -> Result<(), String> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| "cache path has no parent".to_string())?;
        fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
        let mut tmp = tempfile::NamedTempFile::new_in(parent)
            .map_err(|e| format!("create tempfile: {e}"))?;
        let bytes = serde_json::to_vec_pretty(data).map_err(|e| format!("serialize: {e}"))?;
        tmp.write_all(&bytes).map_err(|e| format!("write: {e}"))?;
        tmp.persist(&self.path)
            .map_err(|e| format!("persist: {e}"))?;
        Ok(())
    }
}

/// Test-only injection point used by `commands.rs` round-7 finding-1 tests.
/// Setting `next` causes the NEXT call to `mutate` (on any cache) to return
/// `Err(next.clone())` without invoking the closure or touching state.
/// Thread-local so parallel cargo-test runs cannot interfere with each other.
#[cfg(test)]
pub(crate) mod test_force_mutate_err {
    use std::cell::RefCell;

    thread_local! {
        static FORCED_ERR: RefCell<Option<String>> = const { RefCell::new(None) };
    }

    pub fn arm(err: impl Into<String>) {
        FORCED_ERR.with(|cell| {
            *cell.borrow_mut() = Some(err.into());
        });
    }

    pub fn take() -> Option<String> {
        FORCED_ERR.with(|cell| cell.borrow_mut().take())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn load_returns_empty_when_file_absent() {
        let dir = TempDir::new().unwrap();
        let cache = SessionCache::load(dir.path().join("sessions.json")).unwrap();
        let snap = cache.snapshot();
        assert_eq!(snap.version, SCHEMA_VERSION);
        assert_eq!(snap.session_order.len(), 0);
        assert!(snap.sessions.is_empty());
        assert!(snap.active_session_id.is_none());
    }

    #[test]
    fn mutate_then_load_round_trips() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("sessions.json");

        let cache = SessionCache::load(path.clone()).unwrap();
        cache
            .mutate(|d| {
                d.session_order.push("uuid-a".into());
                d.active_session_id = Some("uuid-a".into());
                d.sessions.insert(
                    "uuid-a".into(),
                    CachedSession {
                        cwd: "/home/x".into(),
                        created_at: "2026-04-25T07:30:00Z".into(),
                        exited: false,
                        last_exit_code: None,
                    },
                );
                Ok(())
            })
            .unwrap();

        let reloaded = SessionCache::load(path).unwrap();
        let snap = reloaded.snapshot();
        assert_eq!(snap.session_order, vec!["uuid-a".to_string()]);
        assert_eq!(snap.active_session_id.as_deref(), Some("uuid-a"));
        assert!(snap.sessions.contains_key("uuid-a"));
    }

    #[test]
    fn corrupt_file_returns_err_no_panic() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("sessions.json");
        std::fs::write(&path, b"{ this is not json").unwrap();

        let result = SessionCache::load(path);
        assert!(result.is_err(), "expected Err for corrupt file");
        assert!(result.unwrap_err().contains("parse cache"));
    }

    #[test]
    fn flush_to_disk_is_atomic_via_tempfile_persist() {
        // The persist() call uses rename which is atomic on POSIX
        // and best-effort atomic on Windows. We verify the file
        // is fully present after a successful mutate.
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("sessions.json");
        let cache = SessionCache::load(path.clone()).unwrap();
        cache
            .mutate(|d| {
                d.session_order.push("uuid-a".into());
                Ok(())
            })
            .unwrap();
        assert!(path.exists());
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(raw.contains("uuid-a"));
        assert!(raw.contains(&format!("\"version\": {SCHEMA_VERSION}")));
    }

    #[test]
    fn flush_failure_does_not_block_in_memory_update() {
        // Force flush failure by putting cache file in a non-existent
        // parent that we make unwritable. Easier: use /dev/null/foo.json
        // on POSIX — parent /dev/null isn't a directory.
        #[cfg(unix)]
        {
            let cache =
                SessionCache::load(std::path::PathBuf::from("/dev/null/sessions.json")).unwrap();
            // Initial state: empty cache (file doesn't exist, parent isn't a dir
            // — but load() only fails if exists() returns true, which it doesn't here).
            cache
                .mutate(|d| {
                    d.session_order.push("uuid-a".into());
                    Ok(())
                })
                .unwrap();
            // In-memory mirror updated even though disk flush failed
            let snap = cache.snapshot();
            assert_eq!(snap.session_order, vec!["uuid-a".to_string()]);
        }
    }

    /// Round 3, Finding 1 (codex P1) regression test.
    ///
    /// Simulates two concurrent `mutate()` calls. With the previous
    /// implementation (lock released before `flush_to_disk`), the disk file
    /// could end up with the OLDER snapshot — even though the in-memory
    /// mirror ended in the right state. This test would fail intermittently
    /// against that old code: the slow flush from thread A (writing
    /// `["a-only"]`) could win the race and overwrite thread B's already-
    /// persisted `["a-only","b"]`. With the lock held across the flush,
    /// the only valid disk states are `["a-only"]` (thread A flushed first
    /// then thread B both mutated and flushed) or `["a-only","b"]` (thread
    /// B got the lock first); the file can never end at `["a-only"]` AFTER
    /// `["a-only","b"]` was written.
    ///
    /// We assert the strong post-condition: after both mutations resolve,
    /// disk == in-memory. That's only achievable if flushes are serialized
    /// with mutations.
    #[test]
    fn mutate_holds_lock_through_flush() {
        use std::sync::Arc;
        use std::thread;
        use std::time::Duration;

        let dir = TempDir::new().unwrap();
        let path = dir.path().join("sessions.json");
        let cache = Arc::new(SessionCache::load(path.clone()).unwrap());

        // Thread A: appends "a", then sleeps inside the closure to widen the
        // critical section. Under a buggy mutate (lock released before
        // flush), thread B's mutate-and-flush could slip between A's modify
        // and A's flush, then A would persist its older snapshot on top of
        // B's newer one.
        let cache_a = Arc::clone(&cache);
        let handle_a = thread::spawn(move || {
            cache_a
                .mutate(|d| {
                    d.session_order.push("a".into());
                    // Force the critical section to overlap with thread B.
                    thread::sleep(Duration::from_millis(50));
                    Ok(())
                })
                .unwrap();
        });

        // Stagger so thread A definitely starts first and is mid-mutation.
        thread::sleep(Duration::from_millis(10));

        let cache_b = Arc::clone(&cache);
        let handle_b = thread::spawn(move || {
            cache_b
                .mutate(|d| {
                    d.session_order.push("b".into());
                    Ok(())
                })
                .unwrap();
        });

        handle_a.join().unwrap();
        handle_b.join().unwrap();

        // Strong invariant: after both threads finish, the disk snapshot
        // MUST equal the in-memory snapshot. With the buggy version where
        // the lock was released before flush, the disk could end up at
        // ["a"] while the in-memory state is ["a","b"].
        let in_memory = cache.snapshot();
        let on_disk = SessionCache::load(path).unwrap().snapshot();
        assert_eq!(
            on_disk.session_order, in_memory.session_order,
            "disk snapshot must match in-memory after concurrent mutations"
        );
        // Both ids must be present — no mutation was lost.
        assert!(in_memory.session_order.contains(&"a".to_string()));
        assert!(in_memory.session_order.contains(&"b".to_string()));
    }

    #[test]
    fn load_or_recover_moves_corrupt_aside() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("sessions.json");
        std::fs::write(&path, b"corrupt!").unwrap();

        let cache = SessionCache::load_or_recover(path.clone());
        let snap = cache.snapshot();
        assert_eq!(snap.session_order.len(), 0);

        // Backup file exists
        let entries: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains("corrupt-"))
            .collect();
        assert_eq!(entries.len(), 1, "expected one .corrupt-* backup");
    }

    /// Pins the graceful-exit cleanup path. `clear_all()` must wipe all
    /// three top-level fields (sessions, session_order, active_session_id)
    /// AND persist the wipe to disk — so that the next `SessionCache::load`
    /// returns an empty cache (no ghost "Restart" tabs on next launch).
    #[test]
    fn clear_all_wipes_all_fields_and_persists() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("sessions.json");

        let cache = SessionCache::load(path.clone()).unwrap();
        cache
            .mutate(|d| {
                d.session_order.push("uuid-a".into());
                d.session_order.push("uuid-b".into());
                d.active_session_id = Some("uuid-a".into());
                d.sessions.insert(
                    "uuid-a".into(),
                    CachedSession {
                        cwd: "/tmp/a".into(),
                        created_at: "2026-04-26T00:00:00Z".into(),
                        exited: false,
                        last_exit_code: None,
                    },
                );
                d.sessions.insert(
                    "uuid-b".into(),
                    CachedSession {
                        cwd: "/tmp/b".into(),
                        created_at: "2026-04-26T00:01:00Z".into(),
                        exited: true,
                        last_exit_code: None,
                    },
                );
                Ok(())
            })
            .unwrap();

        // Verify pre-state: cache has content.
        let pre = cache.snapshot();
        assert_eq!(pre.session_order.len(), 2);
        assert_eq!(pre.sessions.len(), 2);
        assert!(pre.active_session_id.is_some());

        // Clear all — the graceful-exit path.
        cache.clear_all().unwrap();

        // In-memory mirror is empty.
        let post = cache.snapshot();
        assert_eq!(post.session_order.len(), 0);
        assert_eq!(post.sessions.len(), 0);
        assert!(post.active_session_id.is_none());

        // Disk is empty too — load again from a fresh handle, simulating
        // a next-launch read. This is the actual user-facing assertion:
        // the next launch must NOT see ghost sessions.
        let reloaded = SessionCache::load(path).unwrap();
        let snap = reloaded.snapshot();
        assert_eq!(snap.session_order.len(), 0);
        assert_eq!(snap.sessions.len(), 0);
        assert!(snap.active_session_id.is_none());
    }
}
