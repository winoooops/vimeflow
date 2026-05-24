//! Codex adapter implementation.

mod locator;
mod parser;
pub(crate) mod session_index;
mod transcript;
mod types;

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

use crate::agent::adapter::base::TranscriptHandle;
use crate::agent::adapter::types::{ParsedStatus, StatusSource, ValidateTranscriptError};
use crate::agent::adapter::AgentAdapter;
use crate::agent::types::AgentType;
use crate::runtime::EventSink;

use self::locator::{CodexSessionLocator, CompositeLocator, LocatorError, RolloutLocation};
use self::types::BindContext;

const CODEX_BIND_RETRY_INTERVAL_MS: u64 = 100;
const CODEX_BIND_RETRY_MAX_ATTEMPTS: u32 = 5;

pub struct CodexAdapter {
    pid: u32,
    pty_start: SystemTime,
    codex_home: PathBuf,
    locator_cache: OnceLock<CompositeLocator>,
    resolved_rollout_path: Mutex<Option<PathBuf>>,
}

impl CodexAdapter {
    pub fn new(pid: u32, pty_start: SystemTime) -> Self {
        Self {
            pid,
            pty_start,
            codex_home: default_codex_home(),
            locator_cache: OnceLock::new(),
            resolved_rollout_path: Mutex::new(None),
        }
    }

    #[cfg(test)]
    pub(crate) fn with_home(pid: u32, pty_start: SystemTime, codex_home: PathBuf) -> Self {
        Self {
            pid,
            pty_start,
            codex_home,
            locator_cache: OnceLock::new(),
            resolved_rollout_path: Mutex::new(None),
        }
    }

    fn locator(&self) -> &CompositeLocator {
        self.locator_cache.get_or_init(|| {
            log::info!(
                "codex adapter: locator cache initialized (codex_home={})",
                self.codex_home.display()
            );
            CompositeLocator::new(self.codex_home.clone())
        })
    }
}

fn default_codex_home() -> PathBuf {
    dirs::home_dir()
        .map(|home| home.join(".codex"))
        .unwrap_or_else(|| PathBuf::from(".codex"))
}

/// Extract the agent session UUID from a Codex rollout JSONL filename.
pub(crate) fn parse_rollout_filename_uuid(path: &Path) -> Option<String> {
    let file_name = path.file_name()?.to_str()?;
    let stem = file_name.strip_suffix(".jsonl")?;
    let after_prefix = stem.strip_prefix("rollout-")?;

    if after_prefix.len() < 37 {
        return None;
    }

    let uuid_start = after_prefix.len() - 36;
    if after_prefix.as_bytes().get(uuid_start.checked_sub(1)?) != Some(&b'-') {
        return None;
    }

    let uuid = &after_prefix[uuid_start..];
    let bytes = uuid.as_bytes();
    if bytes.len() != 36
        || bytes[8] != b'-'
        || bytes[13] != b'-'
        || bytes[18] != b'-'
        || bytes[23] != b'-'
    {
        return None;
    }

    if !bytes.iter().enumerate().all(|(idx, byte)| {
        matches!(idx, 8 | 13 | 18 | 23) || byte.is_ascii_hexdigit()
    }) {
        return None;
    }

    Some(uuid.to_string())
}

impl AgentAdapter for CodexAdapter {
    fn agent_type(&self) -> AgentType {
        AgentType::Codex
    }

    fn status_source(&self, cwd: &Path, _session_id: &str) -> Result<StatusSource, String> {
        let ctx = BindContext {
            cwd,
            pid: self.pid,
            pty_start: self.pty_start,
        };

        let location = retry_locator(|| self.locator().resolve_rollout(&ctx))?;

        if let Ok(mut slot) = self.resolved_rollout_path.lock() {
            *slot = Some(location.rollout_path.clone());
        }

        Ok(StatusSource {
            path: location.rollout_path,
            trust_root: self.codex_home.clone(),
        })
    }

    fn parse_status(&self, session_id: &str, raw: &str) -> Result<ParsedStatus, String> {
        let transcript_path = self
            .resolved_rollout_path
            .lock()
            .ok()
            .and_then(|slot| slot.as_ref().map(|path| path.to_string_lossy().to_string()));

        parser::parse_rollout(session_id, raw, transcript_path)
    }

    fn validate_transcript(&self, raw: &str) -> Result<PathBuf, ValidateTranscriptError> {
        transcript::validate_transcript_path(raw)
    }

    fn tail_transcript(
        &self,
        events: std::sync::Arc<dyn EventSink>,
        session_id: String,
        cwd: Option<PathBuf>,
        transcript_path: PathBuf,
    ) -> Result<TranscriptHandle, String> {
        let mut handle = transcript::start_tailing(
            std::sync::Arc::clone(&events),
            session_id.clone(),
            transcript_path.clone(),
            cwd,
        )?;

        match parse_rollout_filename_uuid(&transcript_path) {
            Some(agent_session_id) => {
                let aux_stop =
                    std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
                let title_join = session_index::spawn_watch(
                    self.codex_home.join("session_index.jsonl"),
                    agent_session_id,
                    session_id,
                    std::sync::Arc::clone(&events),
                    std::sync::Arc::clone(&aux_stop),
                );
                match title_join {
                    Ok(title_join) => handle.attach_aux_join(aux_stop, title_join),
                    Err(err) => log::warn!(
                        "codex title sync disabled for this session: watcher spawn failed: {}",
                        err
                    ),
                }
            }
            None => {
                log::warn!(
                    "codex title sync disabled for this session: rollout filename {:?} \
                     does not match expected `rollout-<ISO-ts>-<uuid>.jsonl`",
                    transcript_path.file_name()
                );
            }
        }

        Ok(handle)
    }
}

/// Retry a codex locator resolution up to the bind budget.
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
            Err(LocatorError::Unresolved(reason)) | Err(LocatorError::Fatal(reason)) => {
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
mod adapter_tests {
    use super::*;
    use std::time::SystemTime;

    #[test]
    fn parse_status_delegates_to_parser_with_transcript_path_none() {
        let adapter = CodexAdapter::new(12345, SystemTime::UNIX_EPOCH);
        let raw = r#"{"timestamp":"...","type":"session_meta","payload":{"id":"sess","cli_version":"0.128.0"}}
"#;
        let parsed = <CodexAdapter as AgentAdapter>::parse_status(&adapter, "pty-1", raw)
            .expect("minimal codex status parses");

        assert_eq!(parsed.event.agent_session_id, "sess");
        assert!(parsed.transcript_path.is_none());
    }

    #[test]
    fn parse_status_includes_resolved_rollout_path_when_available() {
        let adapter = CodexAdapter::new(12345, SystemTime::UNIX_EPOCH);
        {
            let mut slot = adapter
                .resolved_rollout_path
                .lock()
                .expect("resolved rollout path lock");
            *slot = Some(PathBuf::from("/tmp/codex-rollout.jsonl"));
        }
        let raw = r#"{"timestamp":"...","type":"session_meta","payload":{"id":"sess","cli_version":"0.128.0"}}
"#;

        let parsed = <CodexAdapter as AgentAdapter>::parse_status(&adapter, "pty-1", raw)
            .expect("minimal codex status parses");

        assert_eq!(
            parsed.transcript_path.as_deref(),
            Some("/tmp/codex-rollout.jsonl")
        );
    }

    #[test]
    fn validate_transcript_rejects_outside_codex_root() {
        let adapter = CodexAdapter::new(12345, SystemTime::UNIX_EPOCH);
        assert!(
            <CodexAdapter as AgentAdapter>::validate_transcript(&adapter, "/tmp/t").is_err(),
            "path outside ~/.codex should be rejected"
        );
    }
}

#[cfg(test)]
mod retry_locator_tests {
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
    fn unresolved_short_circuits_immediately() {
        let calls = AtomicUsize::new(0);
        let result = retry_locator(|| {
            calls.fetch_add(1, Ordering::SeqCst);
            Err(LocatorError::Unresolved("ambiguous candidates".to_string()))
        });

        assert!(result.is_err());
        assert!(result.as_ref().unwrap_err().contains("codex bind fatal"));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }
}

#[cfg(test)]
mod parse_rollout_uuid_tests {
    use super::*;

    #[test]
    fn parse_rollout_uuid_valid() {
        let path = std::path::Path::new(
            "/home/me/.codex/sessions/2026/04/17/rollout-2026-04-17T00-48-54-019d9a6a-0d43-7e20-acdf-315ef0f7136c.jsonl",
        );

        assert_eq!(
            parse_rollout_filename_uuid(path),
            Some("019d9a6a-0d43-7e20-acdf-315ef0f7136c".to_string())
        );
    }

    #[test]
    fn parse_rollout_uuid_no_match_returns_none() {
        let path = std::path::Path::new("/tmp/random-file.jsonl");

        assert_eq!(parse_rollout_filename_uuid(path), None);
    }

    #[test]
    fn parse_rollout_uuid_wrong_extension_returns_none() {
        let path = std::path::Path::new(
            "/tmp/rollout-2026-04-17T00-48-54-019d9a6a-0d43-7e20-acdf-315ef0f7136c.txt",
        );

        assert_eq!(parse_rollout_filename_uuid(path), None);
    }

    #[test]
    fn parse_rollout_uuid_truncated_uuid_returns_none() {
        let path = std::path::Path::new(
            "/tmp/rollout-2026-04-17T00-48-54-019d9a6a-truncated.jsonl",
        );

        assert_eq!(parse_rollout_filename_uuid(path), None);
    }
}

#[cfg(test)]
mod status_source_tests {
    use super::*;
    use rusqlite::{params, Connection};
    use std::time::{Duration, SystemTime};

    fn seed_codex_home_with_thread(codex_home: &Path, pid: u32, pty_start: SystemTime) -> PathBuf {
        let rollout_path = codex_home
            .join("sessions")
            .join("2026")
            .join("05")
            .join("05")
            .join(format!("rollout-{}.jsonl", pid));
        std::fs::create_dir_all(rollout_path.parent().expect("parent")).expect("mkdir");
        std::fs::write(&rollout_path, b"").expect("seed empty rollout");

        let since_epoch = pty_start
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("pty_start after epoch");
        let secs = since_epoch.as_secs() as i64;
        let nanos = since_epoch.subsec_nanos() as i64;

        let logs = Connection::open(codex_home.join("logs.sqlite")).expect("open logs db");
        logs.execute_batch(
            "CREATE TABLE logs (
                id INTEGER PRIMARY KEY,
                ts INTEGER NOT NULL,
                ts_nanos INTEGER NOT NULL,
                level TEXT,
                target TEXT,
                process_uuid TEXT NOT NULL,
                thread_id TEXT
            );
            CREATE INDEX idx_logs_ts ON logs(ts DESC, ts_nanos DESC, id DESC);",
        )
        .expect("logs schema");
        logs.execute(
            "INSERT INTO logs (ts, ts_nanos, level, target, process_uuid, thread_id)
             VALUES (?1, ?2, 'INFO', 'test', ?3, ?4)",
            params![secs + 1, nanos, format!("pid:{}:abc", pid), "tid-test"],
        )
        .expect("insert log row");

        let state = Connection::open(codex_home.join("state.sqlite")).expect("open state db");
        state
            .execute_batch(
                "CREATE TABLE threads (
                    id TEXT PRIMARY KEY,
                    rollout_path TEXT NOT NULL,
                    cwd TEXT,
                    updated_at_ms INTEGER NOT NULL
                );",
            )
            .expect("threads schema");
        state
            .execute(
                "INSERT INTO threads (id, rollout_path, cwd, updated_at_ms)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    "tid-test",
                    rollout_path.to_str().expect("utf-8 path"),
                    codex_home.to_str().expect("utf-8 home"),
                    secs * 1000 + nanos / 1_000_000,
                ],
            )
            .expect("insert thread row");

        rollout_path
    }

    #[test]
    fn status_source_returns_resolved_rollout_on_happy_path() {
        let codex_home = tempfile::tempdir().expect("tempdir");
        let pty_start = SystemTime::now() - Duration::from_secs(5);
        let rollout_path = seed_codex_home_with_thread(codex_home.path(), 999, pty_start);

        let adapter = CodexAdapter::with_home(999, pty_start, codex_home.path().to_path_buf());
        let cwd = codex_home.path().to_path_buf();

        let src = <CodexAdapter as AgentAdapter>::status_source(&adapter, &cwd, "sid")
            .expect("status_source should resolve");

        assert_eq!(src.path, rollout_path);
        assert_eq!(src.trust_root, codex_home.path());
    }

    #[test]
    fn status_source_returns_err_on_retry_exhausted() {
        let codex_home = tempfile::tempdir().expect("tempdir");
        let adapter =
            CodexAdapter::with_home(999, SystemTime::now(), codex_home.path().to_path_buf());
        let cwd = codex_home.path().to_path_buf();

        let err = <CodexAdapter as AgentAdapter>::status_source(&adapter, &cwd, "sid")
            .expect_err("empty codex_home should exhaust retry");
        assert!(err.contains("retry exhausted"), "got: {}", err);
    }
}
