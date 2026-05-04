//! Codex session locator.

use crate::agent::adapter::types::BindContext;
use chrono::{Datelike, Duration as ChronoDuration, Local};
use rusqlite::{named_params, Connection, OpenFlags};
use serde_json::Value;
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
}

impl SqliteFirstLocator {
    pub fn new(codex_home: PathBuf) -> Self {
        Self { codex_home }
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
}

impl CodexSessionLocator for SqliteFirstLocator {
    fn resolve_rollout(&self, ctx: &BindContext<'_>) -> Result<RolloutLocation, LocatorError> {
        let logs_db = discover_db(&self.codex_home, "logs").map_err(|e| {
            LocatorError::Fatal(format!("scan {}: {}", self.codex_home.display(), e))
        })?;
        let state_db = discover_db(&self.codex_home, "threads").map_err(|e| {
            LocatorError::Fatal(format!("scan {}: {}", self.codex_home.display(), e))
        })?;

        let (Some(logs_path), Some(state_path)) = (logs_db, state_db) else {
            return Err(LocatorError::Unresolved(
                "schema drift: logs or threads table not found".to_string(),
            ));
        };

        let (pty_secs, pty_nanos) = pty_start_to_secs_nanos(ctx.pty_start)?;
        let thread_id = self.query_logs_thread_id(&logs_path, ctx.pid, pty_secs, pty_nanos)?;
        self.query_thread_row(&state_path, &thread_id)
    }
}

fn pty_start_to_secs_nanos(t: SystemTime) -> Result<(i64, i64), LocatorError> {
    let duration = t
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_err(|e| LocatorError::Fatal(format!("pty_start before epoch: {}", e)))?;
    Ok((duration.as_secs() as i64, duration.subsec_nanos() as i64))
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
