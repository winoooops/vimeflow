//! opencode session locator (filesystem, pid-first).
//!
//! Resolves a PTY attach to the `<sessionID>.jsonl` the vimeflow bridge plugin
//! is writing for the DETECTED opencode process. Resolution order, from the
//! bridge dir's `index.jsonl` (each row `{sessionID, pid, directory, slug,
//! time}`):
//!
//! 1. **pid match (primary).** The row whose `pid == agent_pid` — `pid` is the
//!    opencode process's own `process.pid`, the same value Vimeflow detected as
//!    `agent_pid`. This is exact process identity and disambiguates two
//!    opencode sessions sharing one cwd. When several rows share the pid (the
//!    same process opened multiple sessions) the newest `time` wins.
//! 2. **cwd + freshness (fallback).** Among rows whose canonicalized
//!    `directory == cwd` AND whose `time` (epoch-ms) is `>= pty_start − SLACK`,
//!    pick the newest `time`. The freshness floor rejects a stale same-cwd row
//!    left by an earlier run (a reused pid that didn't exact-match above).
//!
//! Unlike the Kimi locator there is no `/proc` fast-path: the bridge dir is a
//! Vimeflow-owned XDG path and the index carries the authoritative pid, so
//! resolution is pure filesystem on every OS. A missing `index.jsonl` or zero
//! usable rows is the startup-window signal — the locator returns `Err` and the
//! runtime retries, exactly like Kimi returns `Err` before its session dir is
//! written. The chosen `<sessionID>.jsonl`'s existence is the tail engine's
//! concern, not the locator's (matches Kimi's fallback path / data-file split).

use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::agent::adapter::traits::StatusSourceLocator;
use crate::agent::adapter::types::{LocatedStatusSource, ValidateTranscriptError};

use super::transcript_dto::OpencodeIndexRowDto;

/// Slack (ms) subtracted from `pty_start` before the cwd-fallback freshness
/// check, so a session whose index row was written a moment before the PTY
/// clock was read still counts as fresh. Mirrors Kimi's freshness-slack idea
/// (3s there); 5s here gives the bridge's `session.created` → `index.jsonl`
/// append a slightly wider window over the OSC-detected attach.
const SLACK_MS: i64 = 5_000;

/// Filesystem, pid-first opencode locator. Shares its resolved
/// `(sessionID, status_path)` behind an `Arc<Mutex<…>>` (the Kimi shared-state
/// pattern) so a re-`locate` is idempotent and M5's validator can delegate to
/// [`OpenCodeLocator::effective_bridge_root`].
pub(crate) struct OpenCodeLocator {
    /// The bridge dir (`trust_root`) — `index.jsonl` and every
    /// `<sessionID>.jsonl` live directly under it.
    bridge_root: PathBuf,
    /// The detected opencode process's pid — the index's primary disambiguator.
    agent_pid: u32,
    /// PTY start instant; the cwd-fallback rejects rows older than
    /// `pty_start − SLACK`.
    pty_start: SystemTime,
    /// `(sessionID, status_path)` of the last successful `locate`. `None` until
    /// the first resolve; a cached value short-circuits re-locate.
    resolved: Arc<Mutex<Option<(String, PathBuf)>>>,
}

impl OpenCodeLocator {
    pub(crate) fn new(bridge_root: PathBuf, agent_pid: u32, pty_start: SystemTime) -> Self {
        Self {
            bridge_root,
            agent_pid,
            pty_start,
            resolved: Arc::new(Mutex::new(None)),
        }
    }

    /// The trust root the validator and tailer scope every transcript path to.
    /// M5's `validate_transcript_path_with_root` delegates here so both sides
    /// resolve the root from one source.
    pub(crate) fn effective_bridge_root(&self) -> &Path {
        &self.bridge_root
    }

    fn index_path(&self) -> PathBuf {
        self.bridge_root.join("index.jsonl")
    }

    /// `<bridge_root>/<session_id>.jsonl`.
    fn status_path_for(&self, session_id: &str) -> PathBuf {
        self.bridge_root.join(format!("{session_id}.jsonl"))
    }

    /// Build (and cache) a [`LocatedStatusSource`] for a resolved session id.
    fn locate_session(&self, session_id: String) -> LocatedStatusSource {
        let status_path = self.status_path_for(&session_id);
        *self.resolved.lock().expect("opencode resolved lock") =
            Some((session_id.clone(), status_path.clone()));
        located_from(status_path, self.bridge_root.clone(), session_id)
    }

    /// All usable index rows (a `sessionID` is required; everything else is
    /// optional). Malformed lines are skipped. `Err` when `index.jsonl` is
    /// absent OR has zero usable rows — the not-ready / startup-window signal.
    fn read_index_rows(&self) -> Result<Vec<OpencodeIndexRowDto>, String> {
        let index_path = self.index_path();
        let raw = std::fs::read_to_string(&index_path).map_err(|e| {
            if e.kind() == ErrorKind::NotFound {
                format!(
                    "opencode index not ready: {} does not exist yet",
                    index_path.display()
                )
            } else {
                format!(
                    "opencode index not ready: failed to read {}: {}",
                    index_path.display(),
                    e
                )
            }
        })?;

        let rows: Vec<OpencodeIndexRowDto> = raw
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            // Lenient parse: skip a malformed line rather than poison the read.
            .filter_map(|line| serde_json::from_str::<OpencodeIndexRowDto>(line).ok())
            // A row with no sessionID can't name a `<sessionID>.jsonl`.
            .filter(|row| row.session_id.is_some())
            .collect();

        if rows.is_empty() {
            return Err(format!(
                "opencode index not ready: no usable rows in {}",
                index_path.display()
            ));
        }
        Ok(rows)
    }

    /// (1) The newest pid-matching row's sessionID, if any. `pid` is the exact
    /// process identity; among ties the latest `time` wins.
    fn resolve_by_pid(&self, rows: &[OpencodeIndexRowDto]) -> Option<String> {
        rows.iter()
            .filter(|row| row.pid == Some(self.agent_pid as u64))
            .max_by_key(|row| row.time.unwrap_or(i64::MIN))
            .and_then(|row| row.session_id.clone())
    }

    /// (2) The newest fresh same-cwd row's sessionID, if any. A row qualifies
    /// when its canonicalized `directory == cwd` (string-eq fallback if either
    /// side fails to canonicalize) AND its `time >= pty_start − SLACK`. Among
    /// qualifiers the latest `time` wins.
    fn resolve_by_cwd(&self, rows: &[OpencodeIndexRowDto], cwd: &Path) -> Option<String> {
        let floor = self.freshness_floor_ms();
        rows.iter()
            .filter(|row| row.time.is_some_and(|time| time >= floor))
            .filter(|row| {
                row.directory
                    .as_deref()
                    .is_some_and(|dir| same_directory(dir, cwd))
            })
            .max_by_key(|row| row.time.expect("filtered to Some above"))
            .and_then(|row| row.session_id.clone())
    }

    /// `pty_start − SLACK` as epoch-ms; the cwd-fallback freshness floor.
    /// Saturates at `i64::MIN` for a pre-epoch / unreadable clock so the gate
    /// never wraps into rejecting everything.
    fn freshness_floor_ms(&self) -> i64 {
        let start_ms = self
            .pty_start
            .duration_since(UNIX_EPOCH)
            .map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
            .unwrap_or(i64::MIN);
        start_ms.saturating_sub(SLACK_MS)
    }
}

impl StatusSourceLocator for OpenCodeLocator {
    fn locate(&self, cwd: &Path, _session_id: &str) -> Result<LocatedStatusSource, String> {
        // Idempotent re-locate: a cached resolve short-circuits the index read.
        if let Some((session_id, status_path)) =
            self.resolved.lock().expect("opencode resolved lock").clone()
        {
            return Ok(located_from(status_path, self.bridge_root.clone(), session_id));
        }

        let rows = self.read_index_rows()?;

        // (a) pid (primary), then (b) cwd + freshness (fallback).
        if let Some(session_id) = self
            .resolve_by_pid(&rows)
            .or_else(|| self.resolve_by_cwd(&rows, cwd))
        {
            return Ok(self.locate_session(session_id));
        }

        Err(format!(
            "opencode index not ready: no matching session for pid={} or cwd={} in {}",
            self.agent_pid,
            cwd.display(),
            self.index_path().display(),
        ))
    }
}

/// Build a [`LocatedStatusSource`] from a resolved status path + session id.
/// `static_transcript_hint` carries the same path so M5's
/// `TranscriptPathSource::static_hint` can surface it at attach.
fn located_from(
    status_path: PathBuf,
    bridge_root: PathBuf,
    session_id: String,
) -> LocatedStatusSource {
    LocatedStatusSource {
        static_transcript_hint: Some(status_path.to_string_lossy().into_owned()),
        status_path,
        trust_root: bridge_root,
        agent_session_id: Some(session_id),
    }
}

/// True when index `directory` and the attach `cwd` name the same directory.
/// Canonicalizes both (resolving symlinks / `..`); falls back to a raw
/// `Path`-eq when either side fails to canonicalize (a not-yet-created cwd or
/// a removed `directory`). Equality, not ancestry — opencode records the
/// session's own cwd, so a deeper pane cwd is a different session, not a match.
fn same_directory(directory: &str, cwd: &Path) -> bool {
    let dir_path = Path::new(directory);
    match (std::fs::canonicalize(dir_path), std::fs::canonicalize(cwd)) {
        (Ok(dir), Ok(cwd)) => dir == cwd,
        _ => dir_path == cwd,
    }
}

/// Validate a raw transcript path (NUL check → canonicalize → must be under the
/// canonicalized bridge root → must be a `*.jsonl` file) against the locator's
/// bridge root. Mirrors `kimi/transcript.rs`'s validator for the canonicalize +
/// under-root logic, with the extra `.jsonl` extension gate the spec requires.
pub(crate) fn validate_transcript_path_with_root(
    raw: &str,
    bridge_root: &Path,
) -> Result<PathBuf, ValidateTranscriptError> {
    if raw.bytes().any(|b| b == 0) {
        return Err(ValidateTranscriptError::InvalidPath(
            "transcript path contains null byte".to_string(),
        ));
    }

    let path = PathBuf::from(raw);
    let canonical = std::fs::canonicalize(&path).map_err(|e| {
        let kind = e.kind();
        if kind == ErrorKind::NotFound {
            return ValidateTranscriptError::NotFound(path.clone());
        }
        if kind == ErrorKind::PermissionDenied {
            if let Ok(false) = path.try_exists() {
                return ValidateTranscriptError::NotFound(path.clone());
            }
        }
        ValidateTranscriptError::Other(format!("invalid transcript path '{}': {}", raw, e))
    })?;

    if !canonical.is_file() {
        return Err(ValidateTranscriptError::NotAFile(canonical));
    }

    let bridge_root = std::fs::canonicalize(bridge_root).map_err(|e| {
        ValidateTranscriptError::Other(format!(
            "cannot resolve opencode bridge root '{}': {}",
            bridge_root.display(),
            e
        ))
    })?;

    if !canonical.starts_with(&bridge_root) {
        return Err(ValidateTranscriptError::OutsideRoot {
            path: canonical,
            root: bridge_root,
        });
    }

    // The bridge writes only `<sessionID>.jsonl`; reject anything else under
    // the root (a stray non-transcript file) as not-a-file-shape.
    let is_jsonl = canonical
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("jsonl"));
    if !is_jsonl {
        return Err(ValidateTranscriptError::InvalidPath(format!(
            "transcript path is not a .jsonl file: {}",
            canonical.display()
        )));
    }

    Ok(canonical)
}

/// Convert ms-since-the-Unix-epoch to a `SystemTime` for test construction.
#[cfg(test)]
fn epoch_ms(ms: i64) -> SystemTime {
    UNIX_EPOCH + std::time::Duration::from_millis(ms as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A bridge dir under a tempdir, plus a constructor for the locator.
    struct Bridge {
        _tmp: tempfile::TempDir,
        root: PathBuf,
    }

    impl Bridge {
        fn new() -> Self {
            let tmp = tempfile::tempdir().expect("bridge tempdir");
            let root = tmp.path().to_path_buf();
            Self { _tmp: tmp, root }
        }

        fn write_index(&self, rows: &[serde_json::Value]) {
            let raw = rows
                .iter()
                .map(|row| row.to_string())
                .collect::<Vec<_>>()
                .join("\n");
            std::fs::write(self.root.join("index.jsonl"), format!("{raw}\n"))
                .expect("write index");
        }

        /// Touch `<sessionID>.jsonl` so a tailer could open it (not required by
        /// the locator, but real on disk for the validator tests).
        fn write_session_file(&self, session_id: &str) -> PathBuf {
            let path = self.root.join(format!("{session_id}.jsonl"));
            std::fs::write(&path, "").expect("write session file");
            path
        }

        fn locator(&self, agent_pid: u32, pty_start: SystemTime) -> OpenCodeLocator {
            OpenCodeLocator::new(self.root.clone(), agent_pid, pty_start)
        }
    }

    fn index_row(session_id: &str, pid: u64, directory: &str, time: i64) -> serde_json::Value {
        json!({
            "sessionID": session_id,
            "pid": pid,
            "directory": directory,
            "slug": "happy-otter",
            "time": time,
        })
    }

    /// pid match is the primary disambiguator: a newer same-cwd row with a
    /// DIFFERENT pid must lose to the older row carrying `agent_pid`.
    #[test]
    fn pid_match_wins_over_newer_same_cwd_session() {
        let bridge = Bridge::new();
        let cwd = bridge._tmp.path().join("proj");
        std::fs::create_dir_all(&cwd).expect("mkdir cwd");
        let cwd_str = cwd.to_string_lossy().into_owned();

        let agent_pid = 4242u32;
        // Older row owned by THIS process; newer row owned by another pid.
        bridge.write_index(&[
            index_row("ses_ours", agent_pid as u64, &cwd_str, 1_000),
            index_row("ses_other", 9999, &cwd_str, 5_000),
        ]);

        let locator = bridge.locator(agent_pid, epoch_ms(0));
        let located = locator.locate(&cwd, "pty-1").expect("locate ok");

        assert_eq!(located.agent_session_id.as_deref(), Some("ses_ours"));
        assert_eq!(located.status_path, bridge.root.join("ses_ours.jsonl"));
        assert_eq!(located.trust_root, bridge.root);
        assert_eq!(
            located.static_transcript_hint.as_deref(),
            located.status_path.to_str()
        );
    }

    /// Several rows share the pid (one process, multiple sessions): the newest
    /// `time` among the pid matches wins.
    #[test]
    fn pid_match_picks_newest_time_among_same_pid_rows() {
        let bridge = Bridge::new();
        let cwd = bridge._tmp.path().to_path_buf();
        let cwd_str = cwd.to_string_lossy().into_owned();
        let agent_pid = 7u32;
        bridge.write_index(&[
            index_row("ses_old", agent_pid as u64, &cwd_str, 100),
            index_row("ses_new", agent_pid as u64, &cwd_str, 900),
        ]);

        let locator = bridge.locator(agent_pid, epoch_ms(0));
        let located = locator.locate(&cwd, "pty").expect("locate ok");
        assert_eq!(located.agent_session_id.as_deref(), Some("ses_new"));
    }

    /// No pid match ⇒ the newest fresh same-cwd row is chosen.
    #[test]
    fn cwd_freshness_fallback_picks_newest_fresh_same_cwd_row() {
        let bridge = Bridge::new();
        let cwd = bridge._tmp.path().join("work");
        std::fs::create_dir_all(&cwd).expect("mkdir cwd");
        let cwd_str = cwd.to_string_lossy().into_owned();

        // pty_start = 10_000ms; SLACK = 5_000 ⇒ floor = 5_000ms.
        let pty_start = epoch_ms(10_000);
        // No row carries the agent pid (1), so the cwd fallback decides.
        bridge.write_index(&[
            index_row("ses_old_fresh", 2, &cwd_str, 6_000),
            index_row("ses_new_fresh", 3, &cwd_str, 9_000),
        ]);

        let locator = bridge.locator(1, pty_start);
        let located = locator.locate(&cwd, "pty").expect("locate ok");
        assert_eq!(located.agent_session_id.as_deref(), Some("ses_new_fresh"));
    }

    /// A same-cwd row older than `pty_start − SLACK` is rejected — when it is
    /// the only candidate, locate returns Err (retry signal).
    #[test]
    fn freshness_gate_rejects_stale_same_cwd_row() {
        let bridge = Bridge::new();
        let cwd = bridge._tmp.path().join("work");
        std::fs::create_dir_all(&cwd).expect("mkdir cwd");
        let cwd_str = cwd.to_string_lossy().into_owned();

        // floor = 10_000 − 5_000 = 5_000ms; the only row is at 4_000ms (stale).
        let pty_start = epoch_ms(10_000);
        bridge.write_index(&[index_row("ses_stale", 2, &cwd_str, 4_000)]);

        let locator = bridge.locator(1, pty_start);
        let err = locator
            .locate(&cwd, "pty")
            .expect_err("stale-only must not bind");
        assert!(
            err.contains("not ready"),
            "stale-only failure is a retry/not-ready signal: {err}"
        );
    }

    /// A row exactly on the freshness floor is accepted (`>=`, not `>`).
    #[test]
    fn freshness_gate_accepts_row_exactly_on_floor() {
        let bridge = Bridge::new();
        let cwd = bridge._tmp.path().join("work");
        std::fs::create_dir_all(&cwd).expect("mkdir cwd");
        let cwd_str = cwd.to_string_lossy().into_owned();
        let pty_start = epoch_ms(10_000); // floor = 5_000
        bridge.write_index(&[index_row("ses_edge", 2, &cwd_str, 5_000)]);

        let locator = bridge.locator(1, pty_start);
        let located = locator.locate(&cwd, "pty").expect("on-floor row binds");
        assert_eq!(located.agent_session_id.as_deref(), Some("ses_edge"));
    }

    /// Missing `index.jsonl` ⇒ Err (not-ready / retry), not a panic/fatal.
    #[test]
    fn missing_index_is_not_ready_err() {
        let bridge = Bridge::new();
        // No index written.
        let locator = bridge.locator(1, epoch_ms(0));
        let err = locator
            .locate(bridge._tmp.path(), "pty")
            .expect_err("missing index ⇒ Err");
        assert!(err.contains("not ready"), "missing index is not-ready: {err}");
    }

    /// The locator returns the `<sessionID>.jsonl` path even though that file
    /// does not exist yet — the data file's existence is the tailer's concern
    /// (matches Kimi's locator/data-file split).
    #[test]
    fn missing_session_file_is_tolerated_by_locator() {
        let bridge = Bridge::new();
        let cwd = bridge._tmp.path().to_path_buf();
        let cwd_str = cwd.to_string_lossy().into_owned();
        bridge.write_index(&[index_row("ses_only_index", 42, &cwd_str, 1)]);
        // Note: NO `ses_only_index.jsonl` file written.

        let locator = bridge.locator(42, epoch_ms(0));
        let located = locator.locate(&cwd, "pty").expect("locate ok despite no file");
        assert_eq!(located.status_path, bridge.root.join("ses_only_index.jsonl"));
        assert!(!located.status_path.exists(), "data file is absent on disk");
    }

    /// A malformed index line is skipped; a usable row after it still resolves.
    #[test]
    fn malformed_index_line_is_skipped() {
        let bridge = Bridge::new();
        let cwd = bridge._tmp.path().to_path_buf();
        let cwd_str = cwd.to_string_lossy().into_owned();
        let raw = format!("not json at all\n{}\n", index_row("ses_good", 5, &cwd_str, 1));
        std::fs::write(bridge.root.join("index.jsonl"), raw).expect("write index");

        let locator = bridge.locator(5, epoch_ms(0));
        let located = locator.locate(&cwd, "pty").expect("good row resolves");
        assert_eq!(located.agent_session_id.as_deref(), Some("ses_good"));
    }

    /// A second `locate` returns the cached result without re-reading the index
    /// (proven by deleting the index between calls — the cache still answers).
    #[test]
    fn second_locate_returns_cached_result() {
        let bridge = Bridge::new();
        let cwd = bridge._tmp.path().to_path_buf();
        let cwd_str = cwd.to_string_lossy().into_owned();
        bridge.write_index(&[index_row("ses_cached", 1, &cwd_str, 1)]);

        let locator = bridge.locator(1, epoch_ms(0));
        let first = locator.locate(&cwd, "pty").expect("first locate");

        // Remove the index; a non-cached path would now Err.
        std::fs::remove_file(bridge.root.join("index.jsonl")).expect("rm index");

        let second = locator.locate(&cwd, "pty").expect("cached locate ok");
        assert_eq!(first.agent_session_id, second.agent_session_id);
        assert_eq!(first.status_path, second.status_path);
        assert_eq!(second.agent_session_id.as_deref(), Some("ses_cached"));
    }

    #[test]
    fn effective_bridge_root_returns_bridge_root() {
        let bridge = Bridge::new();
        let locator = bridge.locator(1, epoch_ms(0));
        assert_eq!(locator.effective_bridge_root(), bridge.root.as_path());
    }

    // ---- validator ----

    #[test]
    fn validator_accepts_real_jsonl_under_bridge_root() {
        let bridge = Bridge::new();
        let path = bridge.write_session_file("ses_x");
        let canonical = validate_transcript_path_with_root(
            path.to_str().expect("utf8 path"),
            &bridge.root,
        )
        .expect("real jsonl under root validates");
        assert_eq!(canonical, std::fs::canonicalize(&path).expect("canonical"));
    }

    #[test]
    fn validator_rejects_null_byte() {
        let bridge = Bridge::new();
        let result = validate_transcript_path_with_root("/tmp/ses\0.jsonl", &bridge.root);
        assert!(matches!(result, Err(ValidateTranscriptError::InvalidPath(_))));
    }

    #[test]
    fn validator_rejects_path_outside_bridge_root() {
        let bridge = Bridge::new();
        // A real `.jsonl` file but OUTSIDE the bridge root (sibling tempdir).
        let outside_tmp = tempfile::tempdir().expect("outside tempdir");
        let outside = outside_tmp.path().join("escape.jsonl");
        std::fs::write(&outside, "").expect("write outside");

        let result =
            validate_transcript_path_with_root(outside.to_str().expect("utf8"), &bridge.root);
        assert!(matches!(
            result,
            Err(ValidateTranscriptError::OutsideRoot { .. })
        ));
    }

    #[test]
    fn validator_rejects_traversal_out_of_bridge_root() {
        let bridge = Bridge::new();
        let outside_tmp = tempfile::tempdir().expect("outside tempdir");
        let outside = outside_tmp.path().join("escape.jsonl");
        std::fs::write(&outside, "").expect("write outside");

        // `<bridge>/../<outside-basename>` style traversal — canonicalize
        // collapses it to the real outside path, which fails the under-root gate.
        let traversal = bridge
            .root
            .join("..")
            .join(outside_tmp.path().file_name().expect("name"))
            .join("escape.jsonl");
        let result = validate_transcript_path_with_root(
            traversal.to_str().expect("utf8"),
            &bridge.root,
        );
        assert!(
            matches!(result, Err(ValidateTranscriptError::OutsideRoot { .. }))
                || matches!(result, Err(ValidateTranscriptError::NotFound(_))),
            "traversal out of root must not validate: {result:?}"
        );
    }

    #[test]
    fn validator_rejects_non_jsonl_file_under_root() {
        let bridge = Bridge::new();
        let txt = bridge.root.join("notes.txt");
        std::fs::write(&txt, "").expect("write txt");
        let result =
            validate_transcript_path_with_root(txt.to_str().expect("utf8"), &bridge.root);
        assert!(matches!(result, Err(ValidateTranscriptError::InvalidPath(_))));
    }

    #[test]
    fn validator_reports_not_found_for_missing_path() {
        let bridge = Bridge::new();
        let missing = bridge.root.join("nope.jsonl");
        let result =
            validate_transcript_path_with_root(missing.to_str().expect("utf8"), &bridge.root);
        assert!(matches!(result, Err(ValidateTranscriptError::NotFound(_))));
    }
}
