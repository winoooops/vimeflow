//! Codex session locator.

use super::types::BindContext;
use crate::agent::types::{RateLimitInfo, RateLimits};
use chrono::{Datelike, Duration as ChronoDuration, Local};
use rusqlite::{named_params, Connection, OpenFlags};
use serde_json::Value;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

#[derive(Debug, Clone)]
pub struct RolloutLocation {
    pub rollout_path: PathBuf,
    #[allow(dead_code)]
    pub thread_id: String,
    #[allow(dead_code)]
    pub state_updated_at_ms: i64,
}

#[derive(Debug, Clone)]
pub enum LocatorError {
    NotYetReady,
    Unresolved(String),
    Fatal(String),
}

/// Shared prefix tying the `SqliteFirstLocator` schema-drift producer
/// sites to the `CompositeLocator::resolve_rollout` fallback-dispatch
/// guard. Two producers (`"threads table not found"` and
/// `"logs table not found"`) prepend this string; the consumer checks
/// `reason.starts_with(SCHEMA_DRIFT_ERROR_PREFIX)`. Centralizing here
/// gives the build a compile-time contract — renaming the constant
/// updates all three sites in one diff (PR #261 cycle 15 review F40 —
/// the prior bare-string-literal form left the consumer guard 350
/// lines from the producers and trivially breakable by a rename).
pub(super) const SCHEMA_DRIFT_ERROR_PREFIX: &str = "schema drift: ";

impl std::fmt::Display for LocatorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotYetReady => f.write_str("locator: not yet ready"),
            Self::Unresolved(reason) => write!(f, "locator: unresolved - {}", reason),
            Self::Fatal(reason) => write!(f, "locator: fatal - {}", reason),
        }
    }
}

impl std::error::Error for LocatorError {}

pub trait CodexSessionLocator {
    fn resolve_rollout(&self, ctx: &BindContext<'_>) -> Result<RolloutLocation, LocatorError>;
}

pub(super) fn discover_db(
    codex_home: &Path,
    target_table: &str,
) -> Result<Option<PathBuf>, std::io::Error> {
    let mut candidates: Vec<(PathBuf, u32, SystemTime)> = Vec::new();

    for entry in std::fs::read_dir(codex_home)? {
        let entry = entry?;
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };

        // `*.sqlite-wal` and `*.sqlite-shm` are SQLite WAL sidecars, but
        // they don't end with `.sqlite`, so this single suffix check
        // already excludes them.
        if !name.ends_with(".sqlite") {
            continue;
        }

        let conn = match Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY) {
            Ok(conn) => conn,
            Err(_) => continue,
        };

        let has_table = conn
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1 LIMIT 1",
                [target_table],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if !has_table {
            continue;
        }

        let suffix = extract_numeric_suffix(name);
        let mtime = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        candidates.push((path, suffix, mtime));
    }

    if candidates.is_empty() {
        return Ok(None);
    }

    candidates.sort_by(|a, b| b.1.cmp(&a.1).then(b.2.cmp(&a.2)));
    Ok(Some(candidates.remove(0).0))
}

fn extract_numeric_suffix(name: &str) -> u32 {
    let without_ext = name.strip_suffix(".sqlite").unwrap_or(name);
    let suffix = without_ext
        .rsplit_once('_')
        .map(|(_, value)| value)
        .unwrap_or("");
    suffix.parse::<u32>().unwrap_or(0)
}

pub struct SqliteFirstLocator {
    pub codex_home: PathBuf,
    /// `Some(path)` on Linux (and in test harnesses that inject a
    /// tempdir-based fake proc); `None` on macOS/Windows where the
    /// `/proc` filesystem does not exist. The proc-backed fast-paths
    /// (`resume_thread_id_from_proc`, `open_rollout_paths_from_proc`)
    /// SKIP themselves when this is `None` rather than attempting to
    /// open `/proc/<pid>/cmdline` and silently failing with ENOENT
    /// (PR #302 Claude review F1 — the previous production fallback
    /// hardcoded `/proc` even on non-Linux, contradicting the design
    /// documented on `default_proc_root()` and `CompositeLocator::new`).
    proc_root: Option<PathBuf>,
}

impl SqliteFirstLocator {
    /// Default-`Some("/proc")` constructor — used by `locator` unit tests
    /// that don't need to inject a fake proc root. Production callers
    /// go through `CompositeLocator::new` → `with_proc_root` so
    /// `AttachContext.proc_root` (which is `None` on non-Linux) flows
    /// through and the proc fast-paths gate themselves.
    #[cfg(test)]
    pub fn new(codex_home: PathBuf) -> Self {
        Self::with_proc_root(codex_home, Some(PathBuf::from("/proc")))
    }

    /// Explicit `proc_root` constructor. `pub(super)` so
    /// `CompositeLocator::new` can thread an `AttachContext`-derived
    /// `Option<PathBuf>` through. `None` disables the proc-backed
    /// fast-paths (the locator falls through to the logs / FS-scan
    /// strategies); `Some(path)` enables them rooted at the given
    /// directory (PR #261 cycle 8 F22 added the proc_root parameter,
    /// PR #302 Claude review F1 widened it to `Option` so non-Linux
    /// production callers stop probing nonexistent `/proc` paths).
    pub(super) fn with_proc_root(codex_home: PathBuf, proc_root: Option<PathBuf>) -> Self {
        Self {
            codex_home,
            proc_root,
        }
    }

    fn query_logs_thread_id(
        &self,
        path: &Path,
        pid: u32,
        pty_secs: i64,
        pty_nanos: i64,
    ) -> Result<String, LocatorError> {
        let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| LocatorError::Fatal(format!("open logs db: {}", e)))?;
        let mut stmt = conn
            .prepare(
                "SELECT thread_id FROM logs
                 WHERE process_uuid LIKE :pid
                   AND thread_id IS NOT NULL
                   AND (ts > :pty_start_secs
                        OR (ts = :pty_start_secs AND ts_nanos >= :pty_start_nanos))
                 ORDER BY ts DESC, ts_nanos DESC
                 LIMIT 1",
            )
            .map_err(|e| LocatorError::Fatal(format!("prepare logs query: {}", e)))?;
        let pid_pattern = format!("pid:{}:%", pid);
        let mut rows = stmt
            .query(named_params! {
                ":pid": pid_pattern,
                ":pty_start_secs": pty_secs,
                ":pty_start_nanos": pty_nanos,
            })
            .map_err(|e| LocatorError::Fatal(format!("execute logs query: {}", e)))?;

        match rows.next() {
            Ok(Some(row)) => row
                .get::<_, String>(0)
                .map_err(|e| LocatorError::Fatal(format!("read thread_id: {}", e))),
            Ok(None) => Err(LocatorError::NotYetReady),
            Err(e) => Err(LocatorError::Fatal(format!("step logs query: {}", e))),
        }
    }

    fn query_thread_row(
        &self,
        path: &Path,
        thread_id: &str,
    ) -> Result<RolloutLocation, LocatorError> {
        let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| LocatorError::Fatal(format!("open state db: {}", e)))?;
        let mut stmt = conn
            .prepare("SELECT rollout_path, updated_at_ms FROM threads WHERE id = :thread_id")
            .map_err(|e| LocatorError::Fatal(format!("prepare threads query: {}", e)))?;
        let mut rows = stmt
            .query(named_params! { ":thread_id": thread_id })
            .map_err(|e| LocatorError::Fatal(format!("execute threads query: {}", e)))?;

        match rows.next() {
            Ok(Some(row)) => Ok(RolloutLocation {
                rollout_path: PathBuf::from(
                    row.get::<_, String>(0)
                        .map_err(|e| LocatorError::Fatal(format!("read rollout_path: {}", e)))?,
                ),
                thread_id: thread_id.to_string(),
                state_updated_at_ms: row.get::<_, i64>(1).unwrap_or(0),
            }),
            Ok(None) => Err(LocatorError::NotYetReady),
            Err(e) => Err(LocatorError::Fatal(format!("step threads query: {}", e))),
        }
    }

    fn query_thread_by_rollout_path(
        &self,
        path: &Path,
        rollout_path: &Path,
    ) -> Result<Option<RolloutLocation>, LocatorError> {
        let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| LocatorError::Fatal(format!("open state db: {}", e)))?;
        let mut stmt = conn
            .prepare(
                "SELECT id, updated_at_ms
                 FROM threads
                 WHERE rollout_path = :rollout_path
                 LIMIT 1",
            )
            .map_err(|e| LocatorError::Fatal(format!("prepare rollout lookup: {}", e)))?;
        let rollout_path = rollout_path.to_string_lossy().to_string();
        let mut rows = stmt
            .query(named_params! { ":rollout_path": &rollout_path })
            .map_err(|e| LocatorError::Fatal(format!("execute rollout lookup: {}", e)))?;

        match rows.next() {
            Ok(Some(row)) => Ok(Some(RolloutLocation {
                rollout_path: PathBuf::from(rollout_path),
                thread_id: row
                    .get::<_, String>(0)
                    .map_err(|e| LocatorError::Fatal(format!("read rollout thread id: {}", e)))?,
                state_updated_at_ms: row.get::<_, i64>(1).unwrap_or(0),
            })),
            Ok(None) => Ok(None),
            Err(e) => Err(LocatorError::Fatal(format!("step rollout lookup: {}", e))),
        }
    }

    fn query_candidate_rows(
        &self,
        path: &Path,
        updated_since_ms: Option<i64>,
        rollout_paths: Option<&HashSet<String>>,
    ) -> Result<Vec<StateCandidate>, LocatorError> {
        let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| LocatorError::Fatal(format!("open state db: {}", e)))?;
        let mut stmt = conn
            .prepare(
                "SELECT id, rollout_path, cwd, updated_at_ms
                 FROM threads
                 ORDER BY updated_at_ms DESC
                 LIMIT 64",
            )
            .map_err(|e| LocatorError::Fatal(format!("prepare candidate query: {}", e)))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(StateCandidate {
                    thread_id: row.get::<_, String>(0)?,
                    rollout_path: PathBuf::from(row.get::<_, String>(1)?),
                    cwd: row.get::<_, String>(2).unwrap_or_default(),
                    updated_at_ms: row.get::<_, i64>(3).unwrap_or(0),
                })
            })
            .map_err(|e| LocatorError::Fatal(format!("execute candidate query: {}", e)))?;

        let mut candidates = Vec::new();
        for row in rows {
            let candidate =
                row.map_err(|e| LocatorError::Fatal(format!("read candidate row: {}", e)))?;
            if let Some(min_updated_at_ms) = updated_since_ms {
                if candidate.updated_at_ms < min_updated_at_ms {
                    continue;
                }
            }
            if let Some(paths) = rollout_paths {
                let rollout_path = candidate.rollout_path.to_string_lossy().to_string();
                if !paths.contains(&rollout_path) {
                    continue;
                }
            }
            candidates.push(candidate);
        }

        Ok(candidates)
    }

    fn resolve_recent_state_candidate(
        &self,
        state_path: &Path,
        ctx: &BindContext<'_>,
    ) -> Result<RolloutLocation, LocatorError> {
        let pty_start_ms = pty_start_to_millis(ctx.pty_start)?;
        let candidates = self.query_candidate_rows(state_path, Some(pty_start_ms), None)?;
        match choose_state_candidate(&candidates, ctx)? {
            Some(candidate) => Ok(candidate.into_rollout_location()),
            None => Err(LocatorError::NotYetReady),
        }
    }

    fn resolve_from_resume_arg(
        &self,
        state_path: &Path,
        ctx: &BindContext<'_>,
    ) -> Result<Option<RolloutLocation>, LocatorError> {
        // No proc root on this platform — the resume-argv fast-path is a
        // Linux-only probe. Caller falls through to the FS-scan / logs path
        // (PR #302 Claude review F1).
        let Some(proc_root) = self.proc_root.as_deref() else {
            return Ok(None);
        };
        let Some(thread_id) = resume_thread_id_from_proc(proc_root, ctx.pid) else {
            return Ok(None);
        };

        match self.query_thread_row(state_path, &thread_id) {
            Ok(location) => {
                log::debug!(
                    "codex locator: using resume argv fast-path pid={} thread_id={}",
                    ctx.pid,
                    thread_id
                );
                Ok(Some(location))
            }
            Err(LocatorError::NotYetReady) => Ok(None),
            Err(other) => Err(other),
        }
    }

    fn resolve_from_proc_fds(
        &self,
        state_path: &Path,
        ctx: &BindContext<'_>,
    ) -> Result<Option<RolloutLocation>, LocatorError> {
        // Same platform gate as `resolve_from_resume_arg` — opening
        // `/proc/<pid>/fd/*` only makes sense on Linux (PR #302 Claude
        // review F1).
        let Some(proc_root) = self.proc_root.as_deref() else {
            return Ok(None);
        };
        let rollout_paths = open_rollout_paths_from_proc(proc_root, ctx.pid, &self.codex_home);
        if rollout_paths.is_empty() {
            return Ok(None);
        }

        if rollout_paths.len() == 1 {
            let rollout_path = rollout_paths
                .iter()
                .next()
                .map(PathBuf::from)
                .expect("len checked");
            let location = self.query_thread_by_rollout_path(state_path, &rollout_path)?;
            if location.is_some() {
                log::debug!(
                    "codex locator: using /proc fd fast-path pid={} rollout={}",
                    ctx.pid,
                    rollout_path.display()
                );
            }
            return Ok(location);
        }

        let candidates = self.query_candidate_rows(state_path, None, Some(&rollout_paths))?;
        match choose_state_candidate(&candidates, ctx)? {
            Some(candidate) => Ok(Some(candidate.into_rollout_location())),
            None => Ok(None),
        }
    }
}

impl CodexSessionLocator for SqliteFirstLocator {
    fn resolve_rollout(&self, ctx: &BindContext<'_>) -> Result<RolloutLocation, LocatorError> {
        let state_db = discover_db(&self.codex_home, "threads").map_err(|e| {
            LocatorError::Fatal(format!("scan {}: {}", self.codex_home.display(), e))
        })?;
        let logs_db = discover_db(&self.codex_home, "logs").map_err(|e| {
            LocatorError::Fatal(format!("scan {}: {}", self.codex_home.display(), e))
        })?;

        let Some(state_path) = state_db else {
            return Err(LocatorError::Unresolved(format!(
                "{}threads table not found",
                SCHEMA_DRIFT_ERROR_PREFIX
            )));
        };

        if let Some(location) = self.resolve_from_resume_arg(&state_path, ctx)? {
            return Ok(location);
        }
        if let Some(location) = self.resolve_from_proc_fds(&state_path, ctx)? {
            return Ok(location);
        }

        let Some(logs_path) = logs_db else {
            return Err(LocatorError::Unresolved(format!(
                "{}logs table not found",
                SCHEMA_DRIFT_ERROR_PREFIX
            )));
        };

        let (pty_secs, pty_nanos) = pty_start_to_secs_nanos(ctx.pty_start)?;
        match self.query_logs_thread_id(&logs_path, ctx.pid, pty_secs, pty_nanos) {
            Ok(thread_id) => self.query_thread_row(&state_path, &thread_id),
            Err(LocatorError::NotYetReady) => self.resolve_recent_state_candidate(&state_path, ctx),
            Err(other) => Err(other),
        }
    }
}

fn pty_start_to_secs_nanos(t: SystemTime) -> Result<(i64, i64), LocatorError> {
    let duration = t
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_err(|e| LocatorError::Fatal(format!("pty_start before epoch: {}", e)))?;
    Ok((duration.as_secs() as i64, duration.subsec_nanos() as i64))
}

fn pty_start_to_millis(t: SystemTime) -> Result<i64, LocatorError> {
    let duration = t
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_err(|e| LocatorError::Fatal(format!("pty_start before epoch: {}", e)))?;
    Ok(duration.as_millis() as i64)
}

#[derive(Debug, Clone)]
struct StateCandidate {
    thread_id: String,
    rollout_path: PathBuf,
    cwd: String,
    updated_at_ms: i64,
}

impl StateCandidate {
    fn into_rollout_location(self) -> RolloutLocation {
        RolloutLocation {
            rollout_path: self.rollout_path,
            thread_id: self.thread_id,
            state_updated_at_ms: self.updated_at_ms,
        }
    }
}

fn choose_state_candidate(
    candidates: &[StateCandidate],
    ctx: &BindContext<'_>,
) -> Result<Option<StateCandidate>, LocatorError> {
    if candidates.is_empty() {
        return Ok(None);
    }

    let cwd = ctx.cwd.to_string_lossy();
    let cwd_matches: Vec<&StateCandidate> = candidates.iter().filter(|c| c.cwd == cwd).collect();
    if cwd_matches.len() == 1 {
        return Ok(Some((*cwd_matches[0]).clone()));
    }
    if cwd_matches.len() > 1 {
        return Err(LocatorError::Unresolved(
            "multiple codex session candidates matched cwd".to_string(),
        ));
    }
    if candidates.len() == 1 {
        return Ok(Some(candidates[0].clone()));
    }

    Err(LocatorError::Unresolved(
        "multiple codex session candidates remained after bind heuristics".to_string(),
    ))
}

fn resume_thread_id_from_proc(proc_root: &Path, pid: u32) -> Option<String> {
    let args = read_cmdline_args(proc_root, pid)?;
    let resume_index = args.iter().position(|arg| arg == "resume")?;
    let session_arg = args.get(resume_index + 1)?;
    if session_arg.starts_with('-') {
        return None;
    }
    Some(session_arg.to_string())
}

fn read_cmdline_args(proc_root: &Path, pid: u32) -> Option<Vec<String>> {
    let path = proc_root.join(pid.to_string()).join("cmdline");
    let content = std::fs::read(path).ok()?;
    if content.is_empty() {
        return None;
    }

    let args: Vec<String> = content
        .split(|&b| b == 0)
        .filter(|chunk| !chunk.is_empty())
        .map(|chunk| String::from_utf8_lossy(chunk).to_string())
        .collect();
    if args.is_empty() {
        None
    } else {
        Some(args)
    }
}

fn open_rollout_paths_from_proc(proc_root: &Path, pid: u32, codex_home: &Path) -> HashSet<String> {
    let fd_dir = proc_root.join(pid.to_string()).join("fd");
    let mut rollout_paths = HashSet::new();
    let codex_sessions_root = codex_home.join("sessions");

    let Ok(entries) = std::fs::read_dir(fd_dir) else {
        return rollout_paths;
    };

    for entry in entries.flatten() {
        let Ok(target) = std::fs::read_link(entry.path()) else {
            continue;
        };
        if !target.starts_with(&codex_sessions_root) {
            continue;
        }
        let Some(name) = target.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if name.starts_with("rollout-") && name.ends_with(".jsonl") {
            rollout_paths.insert(target.to_string_lossy().to_string());
        }
    }

    rollout_paths
}

pub struct FsScanFallback {
    pub codex_home: PathBuf,
}

impl FsScanFallback {
    pub fn new(codex_home: PathBuf) -> Self {
        Self { codex_home }
    }

    fn scan_today_and_yesterday(&self, ctx: &BindContext<'_>) -> Vec<PathBuf> {
        let mut paths = Vec::new();

        for offset in 0..=1 {
            let date = Local::now().date_naive() - ChronoDuration::days(offset);
            let dir = self
                .codex_home
                .join("sessions")
                .join(format!("{:04}", date.year()))
                .join(format!("{:02}", date.month()))
                .join(format!("{:02}", date.day()));

            if let Ok(entries) = std::fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let name = path
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or("");
                    if name.starts_with("rollout-") && name.ends_with(".jsonl") {
                        paths.push(path);
                    }
                }
            }
        }

        paths.retain(|path| {
            std::fs::metadata(path)
                .and_then(|metadata| metadata.modified())
                .map(|mtime| mtime >= ctx.pty_start)
                .unwrap_or(false)
        });
        paths
    }
}

impl CodexSessionLocator for FsScanFallback {
    fn resolve_rollout(&self, ctx: &BindContext<'_>) -> Result<RolloutLocation, LocatorError> {
        let mut matches: Vec<(PathBuf, String)> = Vec::new();

        for path in self.scan_today_and_yesterday(ctx) {
            let Ok(file) = std::fs::File::open(&path) else {
                continue;
            };
            let mut first_line = String::new();
            let mut reader = std::io::BufReader::new(file);
            use std::io::BufRead;
            if reader.read_line(&mut first_line).is_err() {
                continue;
            }
            let Ok(value) = serde_json::from_str::<Value>(first_line.trim()) else {
                continue;
            };

            let cwd_match = value
                .pointer("/payload/cwd")
                .and_then(Value::as_str)
                .map(|cwd| cwd == ctx.cwd.to_string_lossy())
                .unwrap_or(false);
            if !cwd_match {
                continue;
            }

            let id = value
                .pointer("/payload/id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            matches.push((path, id));
        }

        match matches.len() {
            0 => Err(LocatorError::NotYetReady),
            1 => {
                let (rollout_path, thread_id) = matches.remove(0);
                Ok(RolloutLocation {
                    rollout_path,
                    thread_id,
                    state_updated_at_ms: 0,
                })
            }
            _ => Err(LocatorError::Unresolved(
                "multiple rollout candidates after FS scan".to_string(),
            )),
        }
    }
}

pub struct CompositeLocator {
    primary: SqliteFirstLocator,
    fallback: FsScanFallback,
    /// Codex home directory (`~/.codex` by default). Held here so the
    /// `StatusSourceLocator` impl can use it as the `trust_root` for
    /// the returned `LocatedStatusSource` without an extra clone from
    /// the adapter.
    codex_home: PathBuf,
    /// PID of the detected `codex` process inside the PTY session.
    /// Step B' moved this out of `CodexAdapter` and into the locator
    /// per frozen constraint #2: the `StatusSourceLocator` impl
    /// (below) needs to build the `BindContext` it forwards to the
    /// SQLite-first / FS-scan strategies, and that context wants
    /// pid + pty_start.
    pid: u32,
    /// `SystemTime` when the PTY session was spawned. Used by the
    /// SQLite filter to exclude stale rollout rows from earlier
    /// processes.
    pty_start: SystemTime,
}

impl CompositeLocator {
    pub(super) fn latest_account_rate_limits(&self, thread_id: &str) -> Option<RateLimits> {
        if thread_id.is_empty() {
            return None;
        }

        let logs_db = discover_db(&self.codex_home, "logs").ok().flatten()?;
        let conn = Connection::open_with_flags(&logs_db, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
        let mut stmt = conn
            .prepare(
                "SELECT feedback_log_body
                 FROM logs
                 WHERE thread_id = :thread_id
                   AND feedback_log_body IS NOT NULL
                   AND feedback_log_body LIKE '%x-codex-primary-used-percent%'
                 ORDER BY ts DESC, ts_nanos DESC
                 LIMIT 1",
            )
            .ok()?;
        let body: String = stmt
            .query_row(named_params! { ":thread_id": thread_id }, |row| row.get(0))
            .ok()?;

        account_rate_limits_from_log_body(&body)
    }
}

fn account_rate_limits_from_log_body(body: &str) -> Option<RateLimits> {
    let five_hour = RateLimitInfo {
        used_percentage: header_f64(body, "x-codex-primary-used-percent")?,
        resets_at: header_u64(body, "x-codex-primary-reset-at").unwrap_or(0),
    };

    let seven_day = match (
        header_f64(body, "x-codex-secondary-used-percent"),
        header_u64(body, "x-codex-secondary-reset-at"),
    ) {
        (Some(used_percentage), Some(resets_at)) => Some(RateLimitInfo {
            used_percentage,
            resets_at,
        }),
        (Some(used_percentage), None) => Some(RateLimitInfo {
            used_percentage,
            resets_at: 0,
        }),
        _ => None,
    };

    Some(RateLimits {
        five_hour,
        seven_day,
    })
}

fn header_f64(body: &str, name: &str) -> Option<f64> {
    header_value(body, name)?.parse::<f64>().ok()
}

fn header_u64(body: &str, name: &str) -> Option<u64> {
    header_value(body, name)?.parse::<u64>().ok()
}

fn header_value<'a>(body: &'a str, name: &str) -> Option<&'a str> {
    let key = format!("\"{}\"", name);
    let mut rest = body;

    loop {
        let pos = rest.find(&key)?;
        rest = &rest[pos + key.len()..];

        // Skip whitespace after key
        rest = rest.trim_start();

        // Expect colon
        if !rest.starts_with(':') {
            continue;
        }
        rest = &rest[1..];

        // Skip whitespace after colon
        rest = rest.trim_start();

        // Expect opening quote for value
        if !rest.starts_with('"') {
            continue;
        }
        rest = &rest[1..];

        let end = rest.find('"')?;
        return Some(&rest[..end]);
    }
}

// ----- Step B' retry budget (moved here from `codex/mod.rs`) -----
//
// Per frozen constraint #2: "Codex retry lives inside
// `CompositeLocator::resolve_rollout`'s `StatusSourceLocator` impl,
// NOT around individual SQLite/FS strategies." The retry sits at
// `<CompositeLocator as StatusSourceLocator>::locate` below — one
// wrapper around the strategy chain, so a transient
// `NotYetReady` from EITHER strategy gets retried, but each strategy
// runs only once per retry iteration.

const CODEX_BIND_RETRY_INTERVAL_MS: u64 = 100;
const CODEX_BIND_RETRY_MAX_ATTEMPTS: u32 = 5;

impl CompositeLocator {
    /// `proc_root` lets `AttachContext` inject the platform's proc
    /// directory (`Some("/proc")` on Linux), a tempdir-based fake proc
    /// for tests, or `None` on macOS / Windows where the `/proc`
    /// filesystem does not exist (PR #261 cycle 8 F22 added the
    /// parameter; PR #302 Claude review F1 widened it to `Option` so
    /// non-Linux callers stop hardcoding a nonexistent path). Production
    /// sites pass `ctx.proc_root.clone()` directly from
    /// `AgentBindings::for_attach`; the proc-backed fast-paths inside
    /// `SqliteFirstLocator` skip themselves when this is `None`, so the
    /// locator falls through cleanly to the logs / FS-scan strategies.
    pub fn new(
        codex_home: PathBuf,
        pid: u32,
        pty_start: SystemTime,
        proc_root: Option<PathBuf>,
    ) -> Self {
        // No log here. PR #261 cycle 4 F13 / cycle 11 F31:
        // `AgentBindings::for_attach` historically constructed two
        // `CompositeLocator`s per Codex attach (one outer, one inside
        // `CodexAdapter`). Cycle 11 fixed that by sharing a single
        // `Arc<CompositeLocator>` between `bindings.locator` and
        // `CodexAdapter::with_locator`, but the log site still belongs
        // here-or-the-caller decision stands: the attach-once
        // observability lives in `for_attach` so it fires exactly once
        // per attach regardless of how many adapters / consumers
        // clone the resulting `Arc`.
        Self {
            primary: SqliteFirstLocator::with_proc_root(codex_home.clone(), proc_root),
            fallback: FsScanFallback::new(codex_home.clone()),
            codex_home,
            pid,
            pty_start,
        }
    }
}

impl CodexSessionLocator for CompositeLocator {
    /// Two-strategy dispatch with an INTENTIONALLY narrow fallback
    /// gate. `FsScanFallback` runs only when `SqliteFirstLocator`
    /// reported `Unresolved(reason)` that **starts** with the
    /// `"schema drift: "` prefix — i.e. the SQLite tables themselves
    /// are missing or renamed.
    ///
    /// Ambiguity-class `Unresolved` errors (`"multiple codex session
    /// candidates matched cwd"` / `"multiple ... remained after bind
    /// heuristics"`) propagate to the caller and bubble up as
    /// `"codex bind ambiguous: ..."` without consulting the fallback.
    /// This is the **mutually-exclusive** design from the original
    /// design pass: the two strategies read different data sources
    /// (SQLite `threads.cwd` vs. JSONL `/payload/cwd`), and an
    /// ambiguity in one is overwhelmingly likely to also be an
    /// ambiguity in the other; dispatching the fallback would mostly
    /// add latency and either find the same N candidates or pick a
    /// different one for non-principled reasons (PR #261 cycle 12
    /// review F34 — reviewer flagged this as a potential recovery
    /// path but rated the suggestion 72% confidence with an explicit
    /// "the 'mutually exclusive' design rationale is legitimate"
    /// caveat; documenting the intent so future reviewers don't
    /// re-flag the same design choice).
    fn resolve_rollout(&self, ctx: &BindContext<'_>) -> Result<RolloutLocation, LocatorError> {
        match self.primary.resolve_rollout(ctx) {
            Ok(location) => Ok(location),
            // `starts_with(SCHEMA_DRIFT_ERROR_PREFIX)` rather than
            // `contains(...)` because the prefix is the structurally
            // significant part. Both producer sites in
            // `SqliteFirstLocator` build their message via
            // `format!("{}...", SCHEMA_DRIFT_ERROR_PREFIX)`, so a
            // rename of the constant updates both producers AND this
            // consumer in one diff — compile-time contract between
            // the three sites (PR #261 cycle 13 F35 introduced the
            // prefix match; cycle 15 F40 added the shared constant
            // so the guard can't silently desync from the producers).
            Err(LocatorError::Unresolved(reason))
                if reason.starts_with(SCHEMA_DRIFT_ERROR_PREFIX) =>
            {
                self.fallback.resolve_rollout(ctx)
            }
            Err(other) => Err(other),
        }
    }
}

// ----------- Step B' new trait surface -----------
//
// `StatusSourceLocator::locate` wraps `resolve_rollout` with the
// codex bind retry budget (5 attempts × 100ms inter-attempt sleeps).
// Per frozen constraint #2, the retry lives at THIS boundary — one
// outer loop around the full primary→fallback chain, not around
// individual strategies.

impl crate::agent::adapter::traits::StatusSourceLocator for CompositeLocator {
    fn locate(
        &self,
        cwd: &std::path::Path,
        _session_id: &str,
    ) -> Result<crate::agent::adapter::types::LocatedStatusSource, String> {
        let ctx = BindContext {
            cwd,
            pid: self.pid,
            pty_start: self.pty_start,
        };
        let location = retry_locator(|| self.resolve_rollout(&ctx))?;
        // `to_str()` rejects non-UTF-8 paths by returning `None`,
        // producing a clean `TxOutcome::NoPath` downstream. The
        // previous `to_string_lossy().into_owned()` silently replaced
        // invalid bytes with U+FFFD, yielding a "valid" String that
        // then failed `validate_transcript_path` on every watcher tick
        // — invisible at attach-time, noisy per-update warn spam.
        // PR #261 cycle 6 review F18 — Codex paths under `~/.codex/`
        // are ASCII in practice but the defensive None handles the
        // edge case (Windows home dirs with non-UTF-8 bytes, etc.).
        let static_transcript_hint = location.rollout_path.to_str().map(str::to_owned);
        if static_transcript_hint.is_none() {
            // Attach-time anchor so operators correlating "AgentToolCall
            // stream is empty for this session" have a single log line
            // to grep for rather than per-tick `TxOutcome::NoPath`
            // sentinels (PR #261 cycle 12 review F33). Fires at most
            // once per attach.
            log::warn!(
                "codex: rollout_path contains non-UTF-8 bytes — transcript tailing disabled (path={:?})",
                location.rollout_path,
            );
        }
        Ok(crate::agent::adapter::types::LocatedStatusSource {
            status_path: location.rollout_path,
            trust_root: self.codex_home.clone(),
            static_transcript_hint,
            // Codex's `thread_id` IS its agent_session_id — the same value
            // that appears as `id` in `session_index.jsonl`. Surfaces here
            // so `SessionLifecycle` can wire the codex title-sync watcher
            // back into production (PR #302 codex review F5 — the previous
            // refactor dropped this wiring, parking `agent-session-title`
            // emits for live Codex sessions).
            agent_session_id: Some(location.thread_id),
        })
    }
}

/// Retry a codex locator resolution up to the bind budget.
///
/// Moved from `codex/mod.rs` to live with the locator that uses it.
/// Private — the only caller is `StatusSourceLocator::locate`
/// above and same-file `retry_locator_tests`. Cycle 5 (F15)
/// narrowed `pub(crate)` → `pub(super)`; cycle 9 (F25) further
/// narrowed to plain `fn` since `codex/mod.rs` (the only sibling
/// module) has no caller. Closes the accidental surface so future
/// code can't bypass the trait and reintroduce ad-hoc retry chains.
fn retry_locator<F>(mut resolve: F) -> Result<RolloutLocation, String>
where
    F: FnMut() -> Result<RolloutLocation, LocatorError>,
{
    let started = std::time::Instant::now();
    let mut last_reason = String::from("no attempts");

    for attempt in 0..CODEX_BIND_RETRY_MAX_ATTEMPTS {
        match resolve() {
            Ok(location) => return Ok(location),
            Err(LocatorError::NotYetReady) => {
                last_reason = format!("not yet ready (attempt {})", attempt + 1);
                if attempt + 1 < CODEX_BIND_RETRY_MAX_ATTEMPTS {
                    std::thread::sleep(std::time::Duration::from_millis(
                        CODEX_BIND_RETRY_INTERVAL_MS,
                    ));
                }
            }
            // Distinct prefixes so incident triage + log scraping can
            // tell "no unique candidate" (ambiguous) apart from
            // "filesystem / DB really broken" (fatal). The split also
            // lines up with the `AttachError::LocatorAmbiguous` vs
            // `LocatorFatal` enum split in `error.rs` (PR #261
            // Claude review cycle 2, F4).
            Err(LocatorError::Unresolved(reason)) => {
                return Err(format!("codex bind ambiguous: {}", reason));
            }
            Err(LocatorError::Fatal(reason)) => {
                return Err(format!("codex bind fatal: {}", reason));
            }
        }
    }

    log::warn!(
        "codex bind retry exhausted after {} attempts (elapsed={:?})",
        CODEX_BIND_RETRY_MAX_ATTEMPTS,
        started.elapsed()
    );
    Err(format!("codex bind retry exhausted: {}", last_reason))
}

#[cfg(test)]
mod discovery_tests {
    use super::*;

    fn make_db(path: &Path, table: &str) {
        let conn = Connection::open(path).expect("open test db");
        conn.execute(
            &format!("CREATE TABLE {} (id INTEGER PRIMARY KEY)", table),
            [],
        )
        .expect("create test table");
    }

    #[test]
    fn picks_db_with_target_table() {
        let dir = tempfile::tempdir().expect("tempdir");
        make_db(&dir.path().join("logs_1.sqlite"), "logs");
        make_db(&dir.path().join("state_1.sqlite"), "threads");

        let logs = discover_db(dir.path(), "logs").expect("discover logs");
        let state = discover_db(dir.path(), "threads").expect("discover state");

        assert!(logs.expect("logs db").ends_with("logs_1.sqlite"));
        assert!(state.expect("state db").ends_with("state_1.sqlite"));
    }

    #[test]
    fn returns_none_when_no_db_has_target_table() {
        let dir = tempfile::tempdir().expect("tempdir");
        make_db(&dir.path().join("logs_1.sqlite"), "logs");

        let result = discover_db(dir.path(), "threads").expect("schema drift result");
        assert!(result.is_none());
    }

    #[test]
    fn highest_numeric_suffix_wins() {
        let dir = tempfile::tempdir().expect("tempdir");
        make_db(&dir.path().join("logs_1.sqlite"), "logs");
        make_db(&dir.path().join("logs_3.sqlite"), "logs");
        make_db(&dir.path().join("logs_2.sqlite"), "logs");

        let picked = discover_db(dir.path(), "logs")
            .expect("discover logs")
            .expect("logs db");
        assert!(picked.ends_with("logs_3.sqlite"));
    }

    #[test]
    fn skips_wal_and_shm_sidecars() {
        let dir = tempfile::tempdir().expect("tempdir");
        make_db(&dir.path().join("logs_1.sqlite"), "logs");
        std::fs::write(dir.path().join("logs_1.sqlite-wal"), b"").expect("touch wal");
        std::fs::write(dir.path().join("logs_1.sqlite-shm"), b"").expect("touch shm");

        let picked = discover_db(dir.path(), "logs")
            .expect("discover logs")
            .expect("logs db");
        assert!(picked.ends_with("logs_1.sqlite"));
    }
}

#[cfg(test)]
mod rate_limit_header_tests {
    use super::*;

    const LOG_BODY: &str = r#"Request completed method=POST headers={"x-codex-primary-used-percent": "10", "x-codex-secondary-used-percent": "50", "x-codex-primary-reset-at": "1781020167", "x-codex-secondary-reset-at": "1781144090", "x-codex-bengalfox-primary-used-percent": "0", "x-codex-bengalfox-secondary-used-percent": "0"}"#;

    #[test]
    fn parses_account_rate_limits_from_codex_response_headers() {
        let rate_limits =
            account_rate_limits_from_log_body(LOG_BODY).expect("account headers parse");

        assert_eq!(rate_limits.five_hour.used_percentage, 10.0);
        assert_eq!(rate_limits.five_hour.resets_at, 1781020167);

        let seven_day = rate_limits.seven_day.expect("weekly limit");
        assert_eq!(seven_day.used_percentage, 50.0);
        assert_eq!(seven_day.resets_at, 1781144090);
    }

    #[test]
    fn returns_none_when_account_headers_are_absent() {
        let body = r#"headers={"x-codex-bengalfox-primary-used-percent": "0"}"#;

        assert!(account_rate_limits_from_log_body(body).is_none());
    }

    #[test]
    fn latest_account_rate_limits_reads_newest_thread_log_row() {
        let dir = tempfile::tempdir().expect("tempdir");
        let logs_path = dir.path().join("logs_1.sqlite");
        let conn = Connection::open(&logs_path).expect("open logs db");
        conn.execute_batch(
            "CREATE TABLE logs (
                id INTEGER PRIMARY KEY,
                ts INTEGER NOT NULL,
                ts_nanos INTEGER NOT NULL,
                thread_id TEXT,
                feedback_log_body TEXT
            );",
        )
        .expect("logs schema");
        conn.execute(
            "INSERT INTO logs (ts, ts_nanos, thread_id, feedback_log_body)
             VALUES (1, 0, 'thread-A', ?1)",
            rusqlite::params![r#"headers={"x-codex-primary-used-percent": "1", "x-codex-secondary-used-percent": "2", "x-codex-primary-reset-at": "100", "x-codex-secondary-reset-at": "200"}"#],
        )
        .expect("insert old row");
        conn.execute(
            "INSERT INTO logs (ts, ts_nanos, thread_id, feedback_log_body)
             VALUES (2, 0, 'thread-B', ?1)",
            rusqlite::params![r#"headers={"x-codex-primary-used-percent": "90", "x-codex-secondary-used-percent": "91", "x-codex-primary-reset-at": "900", "x-codex-secondary-reset-at": "910"}"#],
        )
        .expect("insert other thread row");
        conn.execute(
            "INSERT INTO logs (ts, ts_nanos, thread_id, feedback_log_body)
             VALUES (3, 0, 'thread-A', ?1)",
            rusqlite::params![LOG_BODY],
        )
        .expect("insert newest row");

        let locator =
            CompositeLocator::new(dir.path().to_path_buf(), 123, SystemTime::UNIX_EPOCH, None);
        let rate_limits = locator
            .latest_account_rate_limits("thread-A")
            .expect("latest headers should parse");

        assert_eq!(rate_limits.five_hour.used_percentage, 10.0);
        assert_eq!(
            rate_limits.seven_day.expect("weekly limit").used_percentage,
            50.0
        );
    }

    #[test]
    fn parses_varied_json_whitespace() {
        // compact — no spaces
        let body_compact = r#"headers={"x-codex-primary-used-percent":"75","x-codex-primary-reset-at":"1781020167"}"#;
        let rate_limits =
            account_rate_limits_from_log_body(body_compact).expect("compact headers parse");
        assert_eq!(rate_limits.five_hour.used_percentage, 75.0);
        assert_eq!(rate_limits.five_hour.resets_at, 1781020167);

        // extra spaces around colon
        let body_spaced = r#"headers={"x-codex-primary-used-percent" : "60", "x-codex-primary-reset-at" : "1000"}"#;
        let rate_limits =
            account_rate_limits_from_log_body(body_spaced).expect("spaced headers parse");
        assert_eq!(rate_limits.five_hour.used_percentage, 60.0);
        assert_eq!(rate_limits.five_hour.resets_at, 1000);
    }

    #[test]
    fn preserves_usage_when_reset_header_is_absent() {
        let body = r#"headers={"x-codex-primary-used-percent": "80"}"#;

        let rate_limits =
            account_rate_limits_from_log_body(body).expect("usage without reset parses");

        assert_eq!(rate_limits.five_hour.used_percentage, 80.0);
        assert_eq!(rate_limits.five_hour.resets_at, 0);
        assert!(rate_limits.seven_day.is_none());
    }
}

#[cfg(test)]
mod sqlite_first_tests {
    use super::*;
    use std::time::Duration;

    fn build_logs_db(path: &Path) {
        let conn = Connection::open(path).expect("open logs db");
        conn.execute_batch(
            "CREATE TABLE logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts INTEGER NOT NULL,
                ts_nanos INTEGER NOT NULL,
                level TEXT NOT NULL,
                target TEXT NOT NULL,
                thread_id TEXT,
                process_uuid TEXT
            );",
        )
        .expect("create logs table");
    }

    fn build_state_db(path: &Path) {
        let conn = Connection::open(path).expect("open state db");
        conn.execute_batch(
            "CREATE TABLE threads (
                id TEXT PRIMARY KEY,
                rollout_path TEXT NOT NULL,
                cwd TEXT,
                updated_at_ms INTEGER NOT NULL DEFAULT 0
            );",
        )
        .expect("create threads table");
    }

    fn fake_proc_root() -> tempfile::TempDir {
        tempfile::tempdir().expect("temp proc root")
    }

    fn write_cmdline(proc_root: &Path, pid: u32, args: &[&str]) {
        let pid_dir = proc_root.join(pid.to_string());
        std::fs::create_dir_all(&pid_dir).expect("create fake /proc pid dir");
        let mut bytes = Vec::new();
        for arg in args {
            bytes.extend_from_slice(arg.as_bytes());
            bytes.push(0);
        }
        std::fs::write(pid_dir.join("cmdline"), bytes).expect("write fake cmdline");
    }

    fn write_rollout_fd(proc_root: &Path, pid: u32, fd_name: &str, rollout_path: &Path) {
        let fd_dir = proc_root.join(pid.to_string()).join("fd");
        std::fs::create_dir_all(&fd_dir).expect("create fake /proc fd dir");
        let link_path = fd_dir.join(fd_name);
        #[cfg(unix)]
        std::os::unix::fs::symlink(rollout_path, link_path).expect("create fake fd symlink");
    }

    fn insert_log_row(
        path: &Path,
        process_uuid: &str,
        thread_id: Option<&str>,
        ts: i64,
        ts_nanos: i64,
    ) {
        let conn = Connection::open(path).expect("open logs db");
        conn.execute(
            "INSERT INTO logs (ts, ts_nanos, level, target, thread_id, process_uuid)
             VALUES (?, ?, 'INFO', 'test', ?, ?)",
            rusqlite::params![ts, ts_nanos, thread_id, process_uuid],
        )
        .expect("insert log row");
    }

    fn insert_thread(path: &Path, id: &str, rollout: &str, updated_at_ms: i64) {
        let conn = Connection::open(path).expect("open state db");
        conn.execute(
            "INSERT INTO threads (id, rollout_path, cwd, updated_at_ms) VALUES (?, ?, '/tmp', ?)",
            rusqlite::params![id, rollout, updated_at_ms],
        )
        .expect("insert thread row");
    }

    fn ctx<'a>(cwd: &'a Path, pid: u32, pty_start: SystemTime) -> BindContext<'a> {
        BindContext {
            cwd,
            pid,
            pty_start,
        }
    }

    #[test]
    fn happy_path_logs_then_threads_round_trip() {
        let dir = tempfile::tempdir().expect("tempdir");
        let logs = dir.path().join("logs_1.sqlite");
        let state = dir.path().join("state_1.sqlite");
        build_logs_db(&logs);
        build_state_db(&state);

        let pty_start = SystemTime::now() - Duration::from_secs(60);
        let pty_secs = pty_start
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("pty_start after epoch")
            .as_secs() as i64;

        insert_log_row(&logs, "pid:12345:abc", Some("thread-A"), pty_secs + 5, 0);
        insert_thread(&state, "thread-A", "/tmp/rollout-A.jsonl", 1000);

        let locator = SqliteFirstLocator::new(dir.path().to_path_buf());
        let result = locator
            .resolve_rollout(&ctx(dir.path(), 12345, pty_start))
            .expect("sqlite bind succeeds");
        assert_eq!(result.thread_id, "thread-A");
        assert_eq!(result.rollout_path, PathBuf::from("/tmp/rollout-A.jsonl"));
        assert_eq!(result.state_updated_at_ms, 1000);
    }

    #[test]
    fn pty_start_filters_out_old_thread() {
        let dir = tempfile::tempdir().expect("tempdir");
        let logs = dir.path().join("logs_1.sqlite");
        let state = dir.path().join("state_1.sqlite");
        build_logs_db(&logs);
        build_state_db(&state);

        let pty_start = SystemTime::now();
        let pty_secs = pty_start
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("pty_start after epoch")
            .as_secs() as i64;

        insert_log_row(
            &logs,
            "pid:12345:old",
            Some("thread-OLD"),
            pty_secs - 3600,
            0,
        );
        insert_thread(&state, "thread-OLD", "/tmp/rollout-OLD.jsonl", 1);

        let locator = SqliteFirstLocator::new(dir.path().to_path_buf());
        let result = locator.resolve_rollout(&ctx(dir.path(), 12345, pty_start));
        assert!(matches!(result, Err(LocatorError::NotYetReady)));
    }

    #[test]
    fn missing_thread_row_is_not_yet_ready() {
        let dir = tempfile::tempdir().expect("tempdir");
        let logs = dir.path().join("logs_1.sqlite");
        let state = dir.path().join("state_1.sqlite");
        build_logs_db(&logs);
        build_state_db(&state);

        let pty_start = SystemTime::now();
        let pty_secs = pty_start
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("pty_start after epoch")
            .as_secs() as i64;

        insert_log_row(
            &logs,
            "pid:12345:abc",
            Some("thread-orphan"),
            pty_secs + 1,
            0,
        );

        let locator = SqliteFirstLocator::new(dir.path().to_path_buf());
        let result = locator.resolve_rollout(&ctx(dir.path(), 12345, pty_start));
        assert!(matches!(result, Err(LocatorError::NotYetReady)));
    }

    #[test]
    fn nanosecond_tuple_comparison_passes_within_same_second() {
        let dir = tempfile::tempdir().expect("tempdir");
        let logs = dir.path().join("logs_1.sqlite");
        let state = dir.path().join("state_1.sqlite");
        build_logs_db(&logs);
        build_state_db(&state);

        let pty_secs = 1_777_900_000_i64;
        let pty_nanos = 500_000_000_i64;
        let pty_start = SystemTime::UNIX_EPOCH + Duration::new(pty_secs as u64, pty_nanos as u32);

        insert_log_row(
            &logs,
            "pid:777:abc",
            Some("thread-NANOS"),
            pty_secs,
            600_000_000,
        );
        insert_thread(&state, "thread-NANOS", "/tmp/rollout-NANOS.jsonl", 1);

        let locator = SqliteFirstLocator::new(dir.path().to_path_buf());
        let result = locator
            .resolve_rollout(&ctx(dir.path(), 777, pty_start))
            .expect("same-second nanos should bind");
        assert_eq!(result.thread_id, "thread-NANOS");
    }

    #[test]
    fn schema_drift_returns_unresolved_for_caller_dispatch() {
        let dir = tempfile::tempdir().expect("tempdir");
        let state = dir.path().join("state_1.sqlite");
        build_state_db(&state);

        let locator = SqliteFirstLocator::new(dir.path().to_path_buf());
        let result = locator.resolve_rollout(&ctx(dir.path(), 1, SystemTime::now()));
        assert!(matches!(result, Err(LocatorError::Unresolved(_))));
    }

    #[test]
    fn resume_cmdline_fast_path_binds_without_logs_rows() {
        let dir = tempfile::tempdir().expect("tempdir");
        let state = dir.path().join("state_1.sqlite");
        build_state_db(&state);
        insert_thread(&state, "thread-resume", "/tmp/rollout-resume.jsonl", 44);

        let proc_root = fake_proc_root();
        write_cmdline(
            proc_root.path(),
            4242,
            &["/vendor/codex/codex", "resume", "thread-resume"],
        );

        let locator = SqliteFirstLocator::with_proc_root(
            dir.path().to_path_buf(),
            Some(proc_root.path().into()),
        );
        let result = locator
            .resolve_rollout(&ctx(dir.path(), 4242, SystemTime::now()))
            .expect("resume argv should bind");

        assert_eq!(result.thread_id, "thread-resume");
        assert_eq!(
            result.rollout_path,
            PathBuf::from("/tmp/rollout-resume.jsonl")
        );
    }

    #[test]
    fn proc_fd_fast_path_binds_without_logs_rows() {
        let dir = tempfile::tempdir().expect("tempdir");
        let state = dir.path().join("state_1.sqlite");
        build_state_db(&state);

        let rollout_path = dir
            .path()
            .join("sessions/2026/05/04/rollout-2026-05-04T00-00-00-thread-fd.jsonl");
        std::fs::create_dir_all(rollout_path.parent().expect("rollout parent"))
            .expect("create rollout dir");
        std::fs::write(&rollout_path, "").expect("seed rollout");
        insert_thread(&state, "thread-fd", &rollout_path.to_string_lossy(), 55);

        let proc_root = fake_proc_root();
        write_cmdline(proc_root.path(), 5151, &["/vendor/codex/codex"]);
        write_rollout_fd(proc_root.path(), 5151, "30", &rollout_path);

        let locator = SqliteFirstLocator::with_proc_root(
            dir.path().to_path_buf(),
            Some(proc_root.path().into()),
        );
        let result = locator
            .resolve_rollout(&ctx(dir.path(), 5151, SystemTime::now()))
            .expect("open rollout fd should bind");

        assert_eq!(result.thread_id, "thread-fd");
        assert_eq!(result.rollout_path, rollout_path);
    }

    #[test]
    fn proc_root_none_skips_proc_fast_paths_and_falls_through_to_logs() {
        // PR #302 Claude review F1 — non-Linux platforms (macOS / Windows)
        // pass `proc_root: None` so the proc-backed fast-paths
        // (`resume_thread_id_from_proc`, `open_rollout_paths_from_proc`)
        // skip themselves rather than probing nonexistent `/proc/<pid>/`
        // paths. Pin the contract: with `None`, the locator still binds
        // via the logs-table path.
        let dir = tempfile::tempdir().expect("tempdir");
        let logs = dir.path().join("logs_1.sqlite");
        let state = dir.path().join("state_1.sqlite");
        build_logs_db(&logs);
        build_state_db(&state);

        let pty_start = SystemTime::now() - Duration::from_secs(60);
        let pty_secs = pty_start
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("pty_start after epoch")
            .as_secs() as i64;

        insert_log_row(&logs, "pid:7777:abc", Some("thread-NL"), pty_secs + 5, 0);
        insert_thread(&state, "thread-NL", "/tmp/rollout-NL.jsonl", 1000);

        // Crucially: NO proc root. The proc fast-paths must not crash
        // even though `self.proc_root` is `None`.
        let locator = SqliteFirstLocator::with_proc_root(dir.path().to_path_buf(), None);
        let result = locator
            .resolve_rollout(&ctx(dir.path(), 7777, pty_start))
            .expect("logs path binds when proc fast-paths are skipped");
        assert_eq!(result.thread_id, "thread-NL");
        assert_eq!(result.rollout_path, PathBuf::from("/tmp/rollout-NL.jsonl"));
    }

    #[test]
    fn recent_state_heuristic_binds_single_candidate_when_logs_are_threadless() {
        let dir = tempfile::tempdir().expect("tempdir");
        let logs = dir.path().join("logs_1.sqlite");
        let state = dir.path().join("state_1.sqlite");
        build_logs_db(&logs);
        build_state_db(&state);

        let pty_start = SystemTime::now();
        let pty_secs = pty_start
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("pty_start after epoch")
            .as_secs() as i64;
        insert_log_row(&logs, "pid:9090:abc", None, pty_secs + 1, 0);
        insert_thread(
            &state,
            "thread-recent",
            "/tmp/rollout-recent.jsonl",
            pty_secs * 1000 + 1_500,
        );

        let proc_root = fake_proc_root();
        write_cmdline(proc_root.path(), 9090, &["/vendor/codex/codex"]);

        let locator = SqliteFirstLocator::with_proc_root(
            dir.path().to_path_buf(),
            Some(proc_root.path().into()),
        );
        let result = locator
            .resolve_rollout(&ctx(dir.path(), 9090, pty_start))
            .expect("recent thread row should bind when logs are threadless");

        assert_eq!(result.thread_id, "thread-recent");
        assert_eq!(
            result.rollout_path,
            PathBuf::from("/tmp/rollout-recent.jsonl")
        );
    }
}

#[cfg(test)]
mod fs_fallback_tests {
    use super::*;
    use std::time::Duration;

    fn write_rollout(dir: &Path, name: &str, cwd: &str, id: &str) -> PathBuf {
        std::fs::create_dir_all(dir).expect("create rollout dir");
        let path = dir.join(name);
        let line = format!(
            r#"{{"timestamp":"...","type":"session_meta","payload":{{"id":"{}","cwd":"{}","cli_version":"0.128.0"}}}}"#,
            id, cwd
        );
        std::fs::write(&path, format!("{}\n", line)).expect("write rollout");
        path
    }

    fn ctx<'a>(cwd: &'a Path, pty_start: SystemTime) -> BindContext<'a> {
        BindContext {
            cwd,
            pid: 0,
            pty_start,
        }
    }

    #[test]
    fn fs_zero_matches_returns_not_yet_ready() {
        let dir = tempfile::tempdir().expect("tempdir");
        let cwd = std::path::Path::new("/tmp/no-rollouts-here");
        let fallback = FsScanFallback::new(dir.path().to_path_buf());
        let result = fallback.resolve_rollout(&ctx(cwd, SystemTime::now()));
        assert!(matches!(result, Err(LocatorError::NotYetReady)));
    }

    #[test]
    fn fs_multi_match_returns_unresolved() {
        let dir = tempfile::tempdir().expect("tempdir");
        let date = Local::now().date_naive();
        let day_dir = dir
            .path()
            .join("sessions")
            .join(format!("{:04}", date.year()))
            .join(format!("{:02}", date.month()))
            .join(format!("{:02}", date.day()));

        let cwd_str = day_dir
            .parent()
            .expect("day dir parent")
            .to_str()
            .expect("utf8 cwd")
            .to_string();
        let cwd_path = std::path::Path::new(&cwd_str);
        let pty_start = SystemTime::now() - Duration::from_secs(10);

        write_rollout(&day_dir, "rollout-A.jsonl", cwd_str.as_str(), "id-A");
        write_rollout(&day_dir, "rollout-B.jsonl", cwd_str.as_str(), "id-B");

        let fallback = FsScanFallback::new(dir.path().to_path_buf());
        let result = fallback.resolve_rollout(&ctx(cwd_path, pty_start));
        assert!(matches!(result, Err(LocatorError::Unresolved(_))));
    }

    #[test]
    fn composite_dispatches_schema_drift_to_fs() {
        let dir = tempfile::tempdir().expect("tempdir");
        // Step B': `CompositeLocator::new` now also takes pid +
        // pty_start so the locator can own them (they used to live on
        // `CodexAdapter`). The dummy values below don't matter for
        // this test — `resolve_rollout` is called with an explicit
        // `BindContext` that supplies its own pid/pty_start.
        // PR #302 F1: `proc_root` is `Option<PathBuf>`. `Some("/proc")`
        // here matches the pre-F1 behavior even though this test never
        // exercises the proc fast-path (the FS scan fires on schema
        // drift).
        let composite = CompositeLocator::new(
            dir.path().to_path_buf(),
            0,
            SystemTime::UNIX_EPOCH,
            Some(PathBuf::from("/proc")),
        );
        let result =
            composite.resolve_rollout(&ctx(std::path::Path::new("/tmp"), SystemTime::now()));
        assert!(matches!(result, Err(LocatorError::NotYetReady)));
    }
}

#[cfg(test)]
mod retry_locator_tests {
    //! Step B': these tests moved here from `codex/mod.rs` alongside
    //! `retry_locator` itself, so the helper and its regression suite
    //! live together.

    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn retries_on_not_yet_ready_then_succeeds() {
        let calls = AtomicUsize::new(0);
        let result = retry_locator(|| {
            let n = calls.fetch_add(1, Ordering::SeqCst);
            if n < 3 {
                Err(LocatorError::NotYetReady)
            } else {
                Ok(RolloutLocation {
                    rollout_path: PathBuf::from("/tmp/rollout.jsonl"),
                    thread_id: "tid".to_string(),
                    state_updated_at_ms: 0,
                })
            }
        });

        assert!(
            result.is_ok(),
            "expected Ok after 4th attempt: {:?}",
            result
        );
        assert_eq!(calls.load(Ordering::SeqCst), 4);
    }

    #[test]
    fn returns_err_when_retry_budget_exhausted() {
        let calls = AtomicUsize::new(0);
        let result = retry_locator(|| {
            calls.fetch_add(1, Ordering::SeqCst);
            Err(LocatorError::NotYetReady)
        });

        assert!(result.is_err());
        assert!(
            result.as_ref().unwrap_err().contains("retry exhausted"),
            "expected 'retry exhausted' in: {:?}",
            result
        );
        assert_eq!(
            calls.load(Ordering::SeqCst),
            CODEX_BIND_RETRY_MAX_ATTEMPTS as usize,
        );
    }

    #[test]
    fn fatal_short_circuits_immediately() {
        let calls = AtomicUsize::new(0);
        let started = std::time::Instant::now();
        let result = retry_locator(|| {
            calls.fetch_add(1, Ordering::SeqCst);
            Err(LocatorError::Fatal("permission denied".to_string()))
        });

        assert!(result.is_err());
        assert!(result.as_ref().unwrap_err().contains("codex bind fatal"));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(
            started.elapsed() < std::time::Duration::from_millis(100),
            "fatal should short-circuit: elapsed {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn unresolved_short_circuits_immediately_with_ambiguous_prefix() {
        let calls = AtomicUsize::new(0);
        let result = retry_locator(|| {
            calls.fetch_add(1, Ordering::SeqCst);
            Err(LocatorError::Unresolved("ambiguous candidates".to_string()))
        });

        assert!(result.is_err());
        let err = result.as_ref().unwrap_err();
        // PR #261 cycle 2: distinct prefix so log triage can tell
        // ambiguous (no unique candidate) apart from fatal (FS / DB
        // broken). Was previously merged under "codex bind fatal".
        assert!(
            err.contains("codex bind ambiguous"),
            "expected ambiguous prefix, got: {}",
            err,
        );
        assert!(
            !err.contains("codex bind fatal"),
            "ambiguous error must NOT emit the fatal prefix, got: {}",
            err,
        );
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }
}
