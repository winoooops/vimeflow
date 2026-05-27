//! Codex adapter implementation.

mod locator;
mod parser;
mod transcript;
mod transcript_dto;
mod types;

use std::path::{Path, PathBuf};
use std::sync::Arc;
#[cfg(test)]
use std::time::SystemTime;

use crate::agent::adapter::base::TranscriptHandle;
use crate::agent::adapter::traits::{StateDecoder, TranscriptPathValidator, TranscriptStreamer};
use crate::agent::adapter::types::{
    stamp_snapshot, LocatedStatusSource, ParsedStatus, RawPath, StatusSnapshot,
    TranscriptPathSource, ValidateTranscriptError,
};
use crate::agent::adapter::AgentAdapter;
use crate::agent::types::AgentType;
use crate::runtime::EventSink;

pub(super) use self::locator::CompositeLocator;
use crate::agent::adapter::traits::StatusSourceLocator as _;

pub struct CodexAdapter {
    /// Shared `Arc<CompositeLocator>` (PR #261 cycle 11 F31 — was
    /// previously an owned `CompositeLocator`, which forced
    /// `AgentBindings::for_attach` to construct TWO independent
    /// locator instances per Codex attach: one for `bindings.locator`
    /// and one inside `with_home`. The reviewer flagged this five
    /// times across cycles 4/5/7/9/10/11; the structural fix —
    /// share the same `Arc` between both — closes the loop. The
    /// inner-locator latent retry-double risk goes away today
    /// instead of waiting for B'' to remove
    /// `adapter_for_transcript_state` entirely).
    locator: Arc<CompositeLocator>,
    // Step B' removed the former `resolved_rollout_path: Mutex<Option<PathBuf>>`
    // field. 0c deprecated it; B' deletes it. The rollout path now
    // flows exclusively through
    // `LocatedStatusSource.static_transcript_hint` →
    // `TranscriptPathSource::static_hint`.
}

impl CodexAdapter {
    /// Test-only convenience constructor. Production callers go
    /// through `AgentBindings::for_attach` → `CodexAdapter::with_locator`
    /// (which shares the outer `Arc<CompositeLocator>`). Hardcoding
    /// `/proc` here is safe ONLY because the `#[cfg(test)]` gate
    /// prevents accidental production use that would bypass
    /// `AttachContext.proc_root` injection (PR #261 cycle 10 review
    /// F29 — symmetric with the test-only
    /// `SqliteFirstLocator::new`).
    #[cfg(test)]
    pub fn new(pid: u32, pty_start: SystemTime) -> Self {
        Self::with_locator(Arc::new(CompositeLocator::new(
            default_codex_home(),
            pid,
            pty_start,
            PathBuf::from("/proc"),
        )))
    }

    /// Construct a `CodexAdapter` that shares the supplied
    /// `Arc<CompositeLocator>` with the caller. Used by
    /// `AgentBindings::for_attach` so `bindings.locator` and
    /// `bindings.streamer`'s internal locator reference the same
    /// `Arc<CompositeLocator>` instance — eliminating the prior
    /// double-construction + inner-locator latent retry-double risk
    /// (PR #261 cycle 11 F31).
    pub(crate) fn with_locator(locator: Arc<CompositeLocator>) -> Self {
        Self { locator }
    }

    fn locator(&self) -> &CompositeLocator {
        &self.locator
    }

    /// Test-only: thin data pointer of the internal
    /// `Arc<CompositeLocator>`. Lets `with_locator_shares_passed_locator_allocation`
    /// assert that `with_locator` stores the exact `Arc` it was handed
    /// (the cycle-11 F31 single-allocation invariant), now that the
    /// B'-era bindings-level shared-`Arc` test was retired in B''
    /// alongside `adapter_for_transcript_state`.
    #[cfg(test)]
    pub(crate) fn locator_data_ptr(&self) -> *const () {
        Arc::as_ptr(&self.locator) as *const ()
    }
}

/// Codex `codex_home` fallback. `dirs::home_dir()` returns `Some(~)` on
/// typical desktop/CLI runs but `None` in headless / service sessions
/// (no `HOME` env, no `/etc/passwd` entry). Mirrors the pre-B' behavior
/// of `CodexAdapter::new`: `~/.codex` when home is known, relative
/// `.codex` otherwise (PR #261 codex review F3 — keep Codex attach
/// working when `provider_home` is `None`).
pub(crate) fn default_codex_home() -> PathBuf {
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

// ---------------- Step B' trait splits ----------------

impl StateDecoder for CodexAdapter {
    /// `session_id` is threaded into `parse_rollout_snapshot` for its
    /// per-line malformed-rollout warn site — Codex parses JSONL
    /// line-by-line, and the pre-B' parser logged `for sid={}` so
    /// multi-session debugging could correlate the warning to the
    /// affected PTY session. The session id is NOT incorporated into
    /// the returned `StatusSnapshot` (R2.2 — output is identity-free).
    fn decode(
        &self,
        session_id: Option<&str>,
        raw: &str,
    ) -> Result<StatusSnapshot, String> {
        parser::parse_rollout_snapshot(session_id, raw)
    }
}

impl TranscriptPathValidator for CodexAdapter {
    fn validate(&self, raw: &str) -> Result<PathBuf, ValidateTranscriptError> {
        transcript::validate_transcript_path(raw)
    }
}

impl TranscriptStreamer for CodexAdapter {
    fn tail(
        &self,
        events: Arc<dyn EventSink>,
        session_id: String,
        cwd: Option<PathBuf>,
        transcript_path: PathBuf,
    ) -> Result<TranscriptHandle, String> {
        transcript::start_tailing(events, session_id, transcript_path, cwd)
    }
}

// Step B': `AgentAdapter` is the transitional façade. Each method
// delegates to either the matching split-trait impl above or to the
// `StatusSourceLocator` impl on the owned `CompositeLocator` (per
// frozen constraint #2: retry lives inside the locator).
impl AgentAdapter for CodexAdapter {
    fn agent_type(&self) -> AgentType {
        AgentType::Codex
    }

    fn located_status_source(
        &self,
        cwd: &Path,
        session_id: &str,
    ) -> Result<LocatedStatusSource, String> {
        self.locator().locate(cwd, session_id)
    }

    fn parse_status(&self, session_id: &str, raw: &str) -> Result<ParsedStatus, String> {
        let snapshot = <Self as StateDecoder>::decode(self, Some(session_id), raw)?;
        Ok(ParsedStatus {
            event: stamp_snapshot(session_id, snapshot),
        })
    }

    fn validate_transcript(&self, raw: &str) -> Result<PathBuf, ValidateTranscriptError> {
        <Self as TranscriptPathValidator>::validate(self, raw)
    }

    fn tail_transcript(
        &self,
        events: Arc<dyn EventSink>,
        session_id: String,
        cwd: Option<PathBuf>,
        transcript_path: PathBuf,
    ) -> Result<TranscriptHandle, String> {
        <Self as TranscriptStreamer>::tail(self, events, session_id, cwd, transcript_path)
    }
}

#[cfg(test)]
mod adapter_tests {
    use super::*;
    use std::time::SystemTime;

    /// Cycle-11 F31 single-allocation invariant, pinned at its source.
    /// `with_locator` must STORE the `Arc<CompositeLocator>` it is
    /// handed — not rebuild one — so `AgentBindings::for_attach` can
    /// share a single locator between `bindings.locator` and
    /// `bindings.streamer`. B'' relocated this guard here from the
    /// bindings-level shared-`Arc` test that was retired alongside
    /// `adapter_for_transcript_state`.
    #[test]
    fn with_locator_shares_passed_locator_allocation() {
        let locator = Arc::new(CompositeLocator::new(
            default_codex_home(),
            12345,
            SystemTime::UNIX_EPOCH,
            PathBuf::from("/proc"),
        ));
        let expected_ptr = Arc::as_ptr(&locator) as *const ();
        let adapter = CodexAdapter::with_locator(locator);
        assert_eq!(
            adapter.locator_data_ptr(),
            expected_ptr,
            "with_locator must store the passed Arc<CompositeLocator>, not rebuild one \
             (cycle 11 F31 single-allocation invariant)",
        );
    }

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

    // Step B': the former `parse_status_includes_resolved_rollout_path_when_available`
    // regression test was removed alongside the `resolved_rollout_path`
    // mutex it pinned. The rollout path now flows exclusively through
    // `LocatedStatusSource.static_transcript_hint` →
    // `TranscriptPathSource::static_hint`; the
    // `static_hint_returns_static_transcript_hint_from_located` test
    // (below) is the live regression for the new path.

    /// Step 0c: the new transcript-path-resolution path goes through
    /// `TranscriptPathSource::static_hint(&LocatedStatusSource)`.
    /// Pin both directions of the contract: when the located source
    /// carries `Some(_)`, Codex's static_hint surfaces it verbatim;
    /// when it carries `None`, static_hint returns `None`.
    #[test]
    fn static_hint_returns_static_transcript_hint_from_located() {
        let adapter = CodexAdapter::new(12345, SystemTime::UNIX_EPOCH);
        // Step B' (round 1 codex fix): the former
        // `AgentAdapter::transcript_path_source` accessor was
        // removed; tests reach the trait directly via a
        // `&dyn TranscriptPathSource` coercion of the adapter.
        let tps: &dyn TranscriptPathSource = &adapter;

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
        // Step B' (round 1 codex fix): the former
        // `AgentAdapter::transcript_path_source` accessor was
        // removed; tests reach the trait directly via a
        // `&dyn TranscriptPathSource` coercion of the adapter.
        let tps: &dyn TranscriptPathSource = &adapter;
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

// Step B': the former `retry_locator_tests` module moved alongside
// `retry_locator` itself into `codex/locator.rs` (where the function
// now lives). The tests are unchanged; only their location is.

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

        let adapter = CodexAdapter::with_locator(Arc::new(CompositeLocator::new(
            codex_home.path().to_path_buf(),
            999,
            pty_start,
            PathBuf::from("/proc"),
        )));
        let cwd = codex_home.path().to_path_buf();

        let src = <CodexAdapter as AgentAdapter>::located_status_source(&adapter, &cwd, "sid")
            .expect("located_status_source should resolve");

        assert_eq!(src.status_path, rollout_path);
        assert_eq!(src.trust_root, codex_home.path());
        // Step B': the rollout path flows ONLY through
        // `static_transcript_hint` now (the deprecated
        // `resolved_rollout_path` mutex that 0c kept around for
        // back-compat was removed in B'). This single assertion is
        // the regression pin for "located_status_source surfaces the
        // rollout path on the new typed field".
        assert_eq!(
            src.static_transcript_hint.as_deref(),
            Some(rollout_path.to_string_lossy().as_ref()),
        );
    }

    #[test]
    fn located_status_source_returns_err_on_retry_exhausted() {
        let codex_home = tempfile::tempdir().expect("tempdir");
        let adapter = CodexAdapter::with_locator(Arc::new(CompositeLocator::new(
            codex_home.path().to_path_buf(),
            999,
            SystemTime::now(),
            PathBuf::from("/proc"),
        )));
        let cwd = codex_home.path().to_path_buf();

        let err = <CodexAdapter as AgentAdapter>::located_status_source(&adapter, &cwd, "sid")
            .expect_err("empty codex_home should exhaust retry");
        assert!(err.contains("retry exhausted"), "got: {}", err);
    }
}
