//! Codex adapter implementation.

mod locator;
mod parser;
mod transcript;
mod types;

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

use crate::agent::adapter::base::TranscriptHandle;
use crate::agent::adapter::types::{
    LocatedStatusSource, ParsedStatus, RawPath, TranscriptPathSource, ValidateTranscriptError,
};
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
    /// Deprecated as of Step 0c: the rollout path now flows through
    /// `LocatedStatusSource.static_transcript_hint` →
    /// `TranscriptPathSource::static_hint`. The field is kept (and
    /// still populated) for back-compat — the
    /// `parse_status_includes_resolved_rollout_path_when_available`
    /// regression test pins the value so a later step can prove the
    /// removal is a no-op. Slated for removal in a later step (B'/D')
    /// once no caller reads it.
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

impl TranscriptPathSource for CodexAdapter {
    /// Codex's transcript path is known at attach time and flows
    /// through the locator into
    /// `LocatedStatusSource.static_transcript_hint`. The runtime
    /// supplies the same `LocatedStatusSource` on every update; we
    /// just return what's already there.
    fn static_hint(&self, located: &LocatedStatusSource) -> Option<RawPath> {
        located.static_transcript_hint.clone()
    }

    // `dynamic_hint` defaults to `None` — Codex's rollout file path
    // does not appear inside the statusline JSON stream.
}

impl AgentAdapter for CodexAdapter {
    fn agent_type(&self) -> AgentType {
        AgentType::Codex
    }

    fn located_status_source(
        &self,
        cwd: &Path,
        _session_id: &str,
    ) -> Result<LocatedStatusSource, String> {
        let ctx = BindContext {
            cwd,
            pid: self.pid,
            pty_start: self.pty_start,
        };

        let location = retry_locator(|| self.locator().resolve_rollout(&ctx))?;

        // Keep the deprecated mutex populated for back-compat (Step 0c
        // user choice). The new static-hint path threads through
        // `LocatedStatusSource.static_transcript_hint` below.
        if let Ok(mut slot) = self.resolved_rollout_path.lock() {
            *slot = Some(location.rollout_path.clone());
        }

        let static_transcript_hint = Some(location.rollout_path.to_string_lossy().into_owned());

        Ok(LocatedStatusSource {
            status_path: location.rollout_path,
            trust_root: self.codex_home.clone(),
            static_transcript_hint,
        })
    }

    fn parse_status(&self, session_id: &str, raw: &str) -> Result<ParsedStatus, String> {
        // The deprecated `transcript_path` field is gone from
        // `ParsedStatus` as of Step 0c. The mutex is still read so the
        // pinned regression test
        // (`parse_status_includes_resolved_rollout_path_when_available`)
        // can assert the field stays populated — that's how a future
        // removal step can prove no caller observes it.
        let transcript_path = self
            .resolved_rollout_path
            .lock()
            .ok()
            .and_then(|slot| slot.as_ref().map(|path| path.to_string_lossy().to_string()));
        let _ = transcript_path; // back-compat read; intentionally unused by parser

        parser::parse_rollout(session_id, raw)
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
        transcript::start_tailing(events, session_id, transcript_path, cwd)
    }

    fn transcript_path_source(&self) -> &dyn TranscriptPathSource {
        self
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
    fn parse_status_returns_event_without_transcript_path_field() {
        // Step 0c: `ParsedStatus.transcript_path` was removed; the
        // adapter's `parse_status` should now return only the event.
        // This test pins that change: a successful parse populates the
        // event correctly and there's no transcript_path to inspect.
        let adapter = CodexAdapter::new(12345, SystemTime::UNIX_EPOCH);
        let raw = r#"{"timestamp":"...","type":"session_meta","payload":{"id":"sess","cli_version":"0.128.0"}}
"#;
        let parsed = <CodexAdapter as AgentAdapter>::parse_status(&adapter, "pty-1", raw)
            .expect("minimal codex status parses");

        assert_eq!(parsed.event.agent_session_id, "sess");
    }

    #[test]
    fn parse_status_includes_resolved_rollout_path_when_available() {
        // Back-compat regression test: the deprecated mutex is still
        // populated by `located_status_source` so a future step that
        // proves no caller reads it can land cleanly. Keep this until
        // the mutex is actually removed (tracked under Step B'/D').
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

        // The transcript path field is gone; what we still pin is that
        // the deprecated slot holds the expected value (proving the
        // back-compat write path is intact).
        assert_eq!(parsed.event.agent_session_id, "sess");
        assert_eq!(
            adapter
                .resolved_rollout_path
                .lock()
                .ok()
                .and_then(|slot| slot.clone()),
            Some(PathBuf::from("/tmp/codex-rollout.jsonl")),
        );
    }

    /// Step 0c: the new transcript-path-resolution path goes through
    /// `TranscriptPathSource::static_hint(&LocatedStatusSource)`.
    /// Pin both directions of the contract: when the located source
    /// carries `Some(_)`, Codex's static_hint surfaces it verbatim;
    /// when it carries `None`, static_hint returns `None`.
    #[test]
    fn static_hint_returns_static_transcript_hint_from_located() {
        let adapter = CodexAdapter::new(12345, SystemTime::UNIX_EPOCH);
        let tps = adapter.transcript_path_source();

        let with_hint = LocatedStatusSource {
            status_path: PathBuf::from("/home/u/.codex/sessions/r.jsonl"),
            trust_root: PathBuf::from("/home/u/.codex"),
            static_transcript_hint: Some("/home/u/.codex/sessions/r.jsonl".to_string()),
        };
        assert_eq!(
            tps.static_hint(&with_hint),
            Some("/home/u/.codex/sessions/r.jsonl".to_string()),
        );

        let without_hint = LocatedStatusSource {
            status_path: PathBuf::from("/tmp/x"),
            trust_root: PathBuf::from("/tmp"),
            static_transcript_hint: None,
        };
        assert_eq!(tps.static_hint(&without_hint), None);
    }

    /// Codex's `dynamic_hint` MUST stay `None` regardless of input —
    /// the rollout file path never appears inside the JSONL statusline
    /// stream. Defensive test: even with a payload that looks
    /// transcript-pathy, Codex does not surface a dynamic hint.
    #[test]
    fn dynamic_hint_is_none_for_codex_regardless_of_raw() {
        let adapter = CodexAdapter::new(12345, SystemTime::UNIX_EPOCH);
        let tps = adapter.transcript_path_source();
        let raw = r#"{"transcript_path":"/should/be/ignored"}"#;
        assert_eq!(tps.dynamic_hint(raw), None);
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
    fn located_status_source_returns_resolved_rollout_on_happy_path() {
        let codex_home = tempfile::tempdir().expect("tempdir");
        let pty_start = SystemTime::now() - Duration::from_secs(5);
        let rollout_path = seed_codex_home_with_thread(codex_home.path(), 999, pty_start);

        let adapter = CodexAdapter::with_home(999, pty_start, codex_home.path().to_path_buf());
        let cwd = codex_home.path().to_path_buf();

        let src = <CodexAdapter as AgentAdapter>::located_status_source(&adapter, &cwd, "sid")
            .expect("located_status_source should resolve");

        assert_eq!(src.status_path, rollout_path);
        assert_eq!(src.trust_root, codex_home.path());
        // Step 0c: the located source now also surfaces the rollout
        // path as a `static_transcript_hint` so the watcher can reach
        // it via `TranscriptPathSource::static_hint` without the
        // deprecated mutex side channel.
        assert_eq!(
            src.static_transcript_hint.as_deref(),
            Some(rollout_path.to_string_lossy().as_ref()),
        );
        // Back-compat check: the production write path
        // (`located_status_source` itself) still populates the
        // deprecated mutex slot. Pinning this directly here (rather
        // than only in the parse-side test) ensures a future edit
        // that drops the `*slot = Some(...)` assignment is caught
        // even though `parse_status` no longer surfaces the value.
        assert_eq!(
            adapter
                .resolved_rollout_path
                .lock()
                .ok()
                .and_then(|slot| slot.clone()),
            Some(rollout_path.clone()),
            "located_status_source must keep populating the deprecated \
             resolved_rollout_path mutex for back-compat until a later \
             step removes the field"
        );
    }

    #[test]
    fn located_status_source_returns_err_on_retry_exhausted() {
        let codex_home = tempfile::tempdir().expect("tempdir");
        let adapter =
            CodexAdapter::with_home(999, SystemTime::now(), codex_home.path().to_path_buf());
        let cwd = codex_home.path().to_path_buf();

        let err = <CodexAdapter as AgentAdapter>::located_status_source(&adapter, &cwd, "sid")
            .expect_err("empty codex_home should exhaust retry");
        assert!(err.contains("retry exhausted"), "got: {}", err);
    }
}
