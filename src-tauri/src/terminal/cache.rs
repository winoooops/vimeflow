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

    /// Snapshot the in-memory mirror.
    pub fn snapshot(&self) -> SessionCacheData {
        self.data.lock().expect("cache mutex poisoned").clone()
    }

    /// Apply a mutation under the lock, then atomically flush to disk.
    /// Returns Ok even if disk flush fails — in-memory mirror is updated
    /// regardless so frontend reload still restores correctly. Disk failure
    /// is logged.
    pub fn mutate<F>(&self, f: F) -> Result<(), String>
    where
        F: FnOnce(&mut SessionCacheData),
    {
        let snapshot = {
            let mut guard = self.data.lock().expect("cache mutex poisoned");
            f(&mut guard);
            guard.clone()
        };
        // Best-effort disk write
        if let Err(e) = self.flush_to_disk(&snapshot) {
            log::warn!("cache flush failed (in-memory still updated): {e}");
        }
        Ok(())
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
                })
                .unwrap();
            // In-memory mirror updated even though disk flush failed
            let snap = cache.snapshot();
            assert_eq!(snap.session_order, vec!["uuid-a".to_string()]);
        }
    }
}
