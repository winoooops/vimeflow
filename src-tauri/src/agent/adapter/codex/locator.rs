//! Codex session locator.

use crate::agent::adapter::types::BindContext;
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

        if !name.ends_with(".sqlite")
            || name.ends_with(".sqlite-wal")
            || name.ends_with(".sqlite-shm")
        {
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
    proc_root: PathBuf,
}

impl SqliteFirstLocator {
    pub fn new(codex_home: PathBuf) -> Self {
        Self::with_proc_root(codex_home, PathBuf::from("/proc"))
    }

    fn with_proc_root(codex_home: PathBuf, proc_root: PathBuf) -> Self {
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
        let Some(thread_id) = resume_thread_id_from_proc(&self.proc_root, ctx.pid) else {
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
        let rollout_paths =
            open_rollout_paths_from_proc(&self.proc_root, ctx.pid, &self.codex_home);
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
            return Err(LocatorError::Unresolved(
                "schema drift: threads table not found".to_string(),
            ));
        };

        if let Some(location) = self.resolve_from_resume_arg(&state_path, ctx)? {
            return Ok(location);
        }
        if let Some(location) = self.resolve_from_proc_fds(&state_path, ctx)? {
            return Ok(location);
        }

        let Some(logs_path) = logs_db else {
            return Err(LocatorError::Unresolved(
                "schema drift: logs table not found".to_string(),
            ));
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
}

impl CompositeLocator {
    pub fn new(codex_home: PathBuf) -> Self {
        Self {
            primary: SqliteFirstLocator::new(codex_home.clone()),
            fallback: FsScanFallback::new(codex_home),
        }
    }
}

impl CodexSessionLocator for CompositeLocator {
    fn resolve_rollout(&self, ctx: &BindContext<'_>) -> Result<RolloutLocation, LocatorError> {
        match self.primary.resolve_rollout(ctx) {
            Ok(location) => Ok(location),
            Err(LocatorError::Unresolved(reason)) if reason.contains("schema drift") => {
                self.fallback.resolve_rollout(ctx)
            }
            Err(other) => Err(other),
        }
    }
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
            session_id: "sid-test",
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

        let locator =
            SqliteFirstLocator::with_proc_root(dir.path().to_path_buf(), proc_root.path().into());
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

        let locator =
            SqliteFirstLocator::with_proc_root(dir.path().to_path_buf(), proc_root.path().into());
        let result = locator
            .resolve_rollout(&ctx(dir.path(), 5151, SystemTime::now()))
            .expect("open rollout fd should bind");

        assert_eq!(result.thread_id, "thread-fd");
        assert_eq!(result.rollout_path, rollout_path);
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

        let locator =
            SqliteFirstLocator::with_proc_root(dir.path().to_path_buf(), proc_root.path().into());
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
            session_id: "sid",
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
        let composite = CompositeLocator::new(dir.path().to_path_buf());
        let result =
            composite.resolve_rollout(&ctx(std::path::Path::new("/tmp"), SystemTime::now()));
        assert!(matches!(result, Err(LocatorError::NotYetReady)));
    }
}
