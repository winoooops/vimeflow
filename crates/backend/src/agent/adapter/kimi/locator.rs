//! kimi-code session locator.
//!
//! Reads `<kimi_home>/session_index.jsonl` to resolve the attach cwd to a
//! session directory, then points `status_path` at
//! `<sessionDir>/agents/main/wire.jsonl`. Retries a bounded number of
//! times while the agent races to create the index entry + file. Falls
//! back to a best-effort newest-session scan under `<kimi_home>/sessions/`
//! when the index has no matching `workDir`.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Deserialize;

use crate::agent::adapter::traits::StatusSourceLocator;
use crate::agent::adapter::types::LocatedStatusSource;

const KIMI_BIND_RETRY_INTERVAL_MS: u64 = 100;
const KIMI_BIND_RETRY_MAX_ATTEMPTS: u32 = 5;

/// One `session_index.jsonl` line.
#[derive(Deserialize)]
struct SessionIndexEntry {
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    #[serde(rename = "sessionDir")]
    session_dir: Option<String>,
    #[serde(rename = "workDir")]
    work_dir: Option<String>,
}

pub(crate) struct KimiLocator {
    kimi_home: PathBuf,
}

impl KimiLocator {
    pub(crate) fn new(kimi_home: PathBuf) -> Self {
        Self { kimi_home }
    }

    fn session_index_path(&self) -> PathBuf {
        self.kimi_home.join("session_index.jsonl")
    }

    /// Resolve the last `session_index.jsonl` entry whose `workDir`
    /// matches `cwd` (canonicalized comparison, string-equal fallback).
    /// Returns the located source only when the wire.jsonl file also
    /// exists, so a fresh-attach race retries instead of binding to a
    /// half-written session.
    fn try_resolve_from_index(&self, cwd: &Path) -> Option<LocatedStatusSource> {
        let raw = std::fs::read_to_string(self.session_index_path()).ok()?;
        let target = canonical_or_owned(cwd);

        let mut matched: Option<SessionIndexEntry> = None;
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let Ok(entry) = serde_json::from_str::<SessionIndexEntry>(line) else {
                continue;
            };
            let Some(work_dir) = entry.work_dir.as_deref() else {
                continue;
            };
            if paths_match(work_dir, cwd, &target) {
                matched = Some(entry);
            }
        }

        let entry = matched?;
        let session_dir = entry.session_dir?;
        let status_path = PathBuf::from(&session_dir)
            .join("agents")
            .join("main")
            .join("wire.jsonl");
        if !status_path.is_file() {
            return None;
        }

        Some(LocatedStatusSource {
            static_transcript_hint: status_path.to_str().map(str::to_owned),
            status_path,
            trust_root: self.kimi_home.clone(),
            agent_session_id: entry.session_id,
        })
    }

    /// Best-effort fallback when the index has no matching `workDir`:
    /// pick the newest `session_*` subdir (by mtime) whose
    /// `agents/main/wire.jsonl` exists, scoped to this cwd's bucket(s)
    /// (`wd_<basename>_*`). Without a `sha2` dependency the exact
    /// `sha256(cwd)[:12]` suffix is not reconstructed, but the basename
    /// prefix keeps the fallback from binding another project's session.
    /// The index path remains the primary, reliable route.
    fn try_resolve_fallback(&self, cwd: &Path) -> Option<LocatedStatusSource> {
        let sessions_root = self.kimi_home.join("sessions");
        // Scope to this cwd's bucket(s); kimi names buckets wd_<basename>_<hash>.
        let prefix = format!("wd_{}_", cwd.file_name()?.to_str()?);
        let mut newest: Option<(SystemTime, PathBuf)> = None;

        let buckets = std::fs::read_dir(&sessions_root).ok()?;
        for bucket in buckets.flatten() {
            let bucket_path = bucket.path();
            if !bucket_path.is_dir() {
                continue;
            }
            if !bucket_path
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|name| name.starts_with(&prefix))
            {
                continue;
            }
            let Ok(sessions) = std::fs::read_dir(&bucket_path) else {
                continue;
            };
            for session in sessions.flatten() {
                let name = session.file_name();
                let Some(name) = name.to_str() else {
                    continue;
                };
                if !name.starts_with("session_") {
                    continue;
                }
                let session_path = session.path();
                let wire = session_path.join("agents").join("main").join("wire.jsonl");
                if !wire.is_file() {
                    continue;
                }
                let mtime = session
                    .metadata()
                    .and_then(|m| m.modified())
                    .unwrap_or(SystemTime::UNIX_EPOCH);
                if newest.as_ref().map_or(true, |(seen, _)| mtime > *seen) {
                    newest = Some((mtime, session_path));
                }
            }
        }

        let (_, session_path) = newest?;
        let status_path = session_path.join("agents").join("main").join("wire.jsonl");
        let agent_session_id = session_path
            .file_name()
            .and_then(|n| n.to_str())
            .map(str::to_owned);
        Some(LocatedStatusSource {
            static_transcript_hint: status_path.to_str().map(str::to_owned),
            status_path,
            trust_root: self.kimi_home.clone(),
            agent_session_id,
        })
    }
}

impl StatusSourceLocator for KimiLocator {
    fn locate(&self, cwd: &Path, _session_id: &str) -> Result<LocatedStatusSource, String> {
        for attempt in 0..KIMI_BIND_RETRY_MAX_ATTEMPTS {
            if let Some(located) = self.try_resolve_from_index(cwd) {
                return Ok(located);
            }
            if attempt + 1 < KIMI_BIND_RETRY_MAX_ATTEMPTS {
                std::thread::sleep(std::time::Duration::from_millis(
                    KIMI_BIND_RETRY_INTERVAL_MS,
                ));
            }
        }

        // Index never produced a ready match — best-effort fallback.
        if let Some(located) = self.try_resolve_fallback(cwd) {
            return Ok(located);
        }

        Err(format!(
            "kimi locator: no session_index.jsonl entry for cwd={} and no fallback session under {}",
            cwd.display(),
            self.kimi_home.join("sessions").display(),
        ))
    }
}

/// Compare an index `workDir` string against the attach `cwd`. Prefers a
/// canonicalized comparison (resolves symlinks / `..`); falls back to a
/// raw string-equal when either side fails to canonicalize.
fn paths_match(work_dir: &str, cwd: &Path, canonical_cwd: &Path) -> bool {
    let work_path = Path::new(work_dir);
    match std::fs::canonicalize(work_path) {
        Ok(canonical_work) => canonical_work == canonical_cwd,
        Err(_) => work_path == cwd || work_dir == cwd.to_string_lossy(),
    }
}

fn canonical_or_owned(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_wire(session_dir: &Path) -> PathBuf {
        let wire = session_dir.join("agents").join("main").join("wire.jsonl");
        std::fs::create_dir_all(wire.parent().expect("parent")).expect("mkdir wire");
        std::fs::write(&wire, b"{\"type\":\"metadata\"}\n").expect("write wire");
        wire
    }

    fn write_index(kimi_home: &Path, entries: &[(&str, &Path, &Path)]) {
        let path = kimi_home.join("session_index.jsonl");
        let mut file = std::fs::File::create(&path).expect("create index");
        for (session_id, session_dir, work_dir) in entries {
            writeln!(
                file,
                r#"{{"sessionId":"{}","sessionDir":"{}","workDir":"{}"}}"#,
                session_id,
                session_dir.display(),
                work_dir.display(),
            )
            .expect("write index line");
        }
    }

    #[test]
    fn resolves_status_path_and_session_id_from_index() {
        let kimi_home = tempfile::tempdir().expect("kimi home");
        let work = tempfile::tempdir().expect("work dir");
        let session_dir = kimi_home
            .path()
            .join("sessions")
            .join("wd_x")
            .join("session_abc");
        let wire = write_wire(&session_dir);
        write_index(
            kimi_home.path(),
            &[("session_abc", &session_dir, work.path())],
        );

        let locator = KimiLocator::new(kimi_home.path().to_path_buf());
        let located = locator.locate(work.path(), "pty-1").expect("locate ok");

        assert_eq!(
            located.status_path, wire,
            "status_path points at agents/main/wire.jsonl"
        );
        assert_eq!(located.trust_root, kimi_home.path());
        assert_eq!(located.agent_session_id.as_deref(), Some("session_abc"));
        assert_eq!(located.static_transcript_hint.as_deref(), wire.to_str(),);
    }

    #[test]
    fn takes_last_matching_workdir_entry() {
        let kimi_home = tempfile::tempdir().expect("kimi home");
        let work = tempfile::tempdir().expect("work dir");
        let old_dir = kimi_home
            .path()
            .join("sessions")
            .join("wd_x")
            .join("session_old");
        let new_dir = kimi_home
            .path()
            .join("sessions")
            .join("wd_x")
            .join("session_new");
        write_wire(&old_dir);
        let new_wire = write_wire(&new_dir);
        write_index(
            kimi_home.path(),
            &[
                ("session_old", &old_dir, work.path()),
                ("session_new", &new_dir, work.path()),
            ],
        );

        let locator = KimiLocator::new(kimi_home.path().to_path_buf());
        let located = locator.locate(work.path(), "pty-1").expect("locate ok");
        assert_eq!(located.status_path, new_wire);
        assert_eq!(located.agent_session_id.as_deref(), Some("session_new"));
    }

    #[test]
    fn fallback_is_scoped_to_cwd_bucket() {
        let kimi_home = tempfile::tempdir().expect("kimi home");
        let work = tempfile::tempdir().expect("work dir");
        let other_work = tempfile::tempdir().expect("other work");
        let base = work
            .path()
            .file_name()
            .and_then(|n| n.to_str())
            .expect("work basename");

        // Session in THIS cwd's bucket (wd_<basename>_<hash>) → must win.
        let scoped = kimi_home
            .path()
            .join("sessions")
            .join(format!("wd_{base}_aaaaaaaaaaaa"))
            .join("session_scoped");
        let scoped_wire = write_wire(&scoped);

        // Newer decoy in a DIFFERENT project's bucket → must be ignored.
        let decoy = kimi_home
            .path()
            .join("sessions")
            .join("wd_otherproject_bbbbbbbbbbbb")
            .join("session_decoy");
        write_wire(&decoy);

        // Index entry is for a different workDir, so the index never matches.
        write_index(
            kimi_home.path(),
            &[("session_scoped", &scoped, other_work.path())],
        );

        let locator = KimiLocator::new(kimi_home.path().to_path_buf());
        let located = locator
            .locate(work.path(), "pty-1")
            .expect("scoped fallback resolves");
        assert_eq!(
            located.status_path, scoped_wire,
            "fallback must pick the session in this cwd's bucket, not the newer decoy"
        );
        assert_eq!(located.agent_session_id.as_deref(), Some("session_scoped"));
    }

    #[test]
    fn errors_when_no_index_and_no_sessions() {
        let kimi_home = tempfile::tempdir().expect("kimi home");
        let work = tempfile::tempdir().expect("work dir");
        let locator = KimiLocator::new(kimi_home.path().to_path_buf());
        let err = locator
            .locate(work.path(), "pty-1")
            .expect_err("empty kimi home should error");
        assert!(err.contains("kimi locator"), "got: {}", err);
    }
}
