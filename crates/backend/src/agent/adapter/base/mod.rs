//! Provider-neutral agent watcher orchestration.
//!
//! This module intentionally keeps a narrow external surface while splitting
//! the runtime internals into smaller files. Adapter implementations provide
//! provider-specific hooks; this layer owns watcher lifecycle, transcript
//! lifecycle, diagnostics, and path-trust enforcement.

mod diagnostics;
mod path_security;
mod transcript_state;
mod transcript_tail_service;
mod watcher_runtime;

use std::path::PathBuf;
use std::sync::Arc;

use super::bindings::AgentBindings;
use crate::runtime::EventSink;
use crate::terminal::PtyState;

pub use transcript_state::{TranscriptHandle, TranscriptStartStatus, TranscriptState};
pub(crate) use transcript_tail_service::{TranscriptDecoder, TranscriptTailService};
// `RecordingDecoder` stays module-private to `transcript_tail_service` (only its
// own tests use it); 2.3's Claude end-to-end test imports these two.
#[cfg(test)]
pub(crate) use transcript_tail_service::{ScriptedBufRead, Step};
pub use watcher_runtime::{AgentWatcherState, WatcherHandle};

/// Step B': `start_for` now takes the typed `AgentBindings` bundle
/// (one trait object per concern) instead of an `Arc<dyn AgentAdapter>`.
/// The migration was the second half of the 5-trait split — see
/// `bindings.rs` for the bundle's construction at `AgentBindings::for_attach`.
pub(crate) fn start_for(
    bindings: AgentBindings,
    events: Arc<dyn EventSink>,
    pty_state: PtyState,
    transcript_state: TranscriptState,
    session_id: String,
    cwd: PathBuf,
    state: AgentWatcherState,
) -> Result<(), String> {
    let located = bindings.locator.locate(&cwd, &session_id)?;
    path_security::ensure_status_source_under_trust_root(
        &located.status_path,
        &located.trust_root,
    )?;

    log::debug!(
        "Watcher startup detail: session={}, cwd={}, path={}",
        session_id,
        cwd.display(),
        located.status_path.display()
    );

    // Stop any existing watcher for this session before counting active
    // watchers. Restarting the same session would otherwise produce a false
    // leaked-watcher signal.
    state.remove(&session_id);

    log::info!(
        "Starting agent watcher: session={}, path={}, active_watchers={}",
        session_id,
        located.status_path.display(),
        state.active_count(),
    );

    let handle = watcher_runtime::start_watching(
        bindings,
        events,
        pty_state,
        transcript_state,
        session_id.clone(),
        located,
    )?;
    state.insert(session_id, handle);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::adapter::bindings::AgentBindings;
    use crate::agent::adapter::traits::StatusSourceLocator;
    use crate::agent::adapter::types::LocatedStatusSource;
    use crate::agent::adapter::AttachContext;
    use crate::agent::types::AgentType;
    use crate::runtime::FakeEventSink;
    use crate::terminal::PtyState;
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::time::SystemTime;
    use tempfile::TempDir;

    fn make_attach_ctx(cwd: &std::path::Path) -> AttachContext {
        AttachContext {
            session_id: "test-sess".to_string(),
            initial_cwd: cwd.to_path_buf(),
            shell_pid: 1,
            agent_pid: 2,
            pty_start: SystemTime::UNIX_EPOCH,
            agent_type: AgentType::ClaudeCode,
            provider_home: Some(PathBuf::from("/home/u/.claude")),
            proc_root: None,
        }
    }

    fn write_claude_status(cwd: &std::path::Path, sid: &str) {
        let dir = cwd.join(".vimeflow").join("sessions").join(sid);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("status.json"), r#"{"session_id":"sid","model":{}}"#).unwrap();
    }

    fn seeded_fixture(sid: &str) -> (TranscriptState, AgentWatcherState) {
        let sink = Arc::new(FakeEventSink::new());
        let tmp = tempfile::tempdir().expect("tempdir");
        let transcript_path = tmp.path().join("t.jsonl");
        std::fs::write(&transcript_path, "").expect("write");
        let transcript_state = TranscriptState::new();
        let adapter: Arc<dyn crate::agent::adapter::traits::TranscriptStreamer> =
            Arc::new(crate::agent::adapter::claude_code::ClaudeCodeAdapter);
        transcript_state
            .start_or_replace(
                adapter,
                sink,
                sid.to_string(),
                transcript_path,
                None,
            )
            .expect("seed transcript state");
        let watcher_state = AgentWatcherState::new();
        let seed = WatcherHandle::new_for_test(transcript_state.clone(), sid.to_string());
        watcher_state.insert(sid.to_string(), seed);
        (transcript_state, watcher_state)
    }

    #[test]
    fn t_lifecycle_1_start_for_happy_path_registers_session() {
        let tmp = TempDir::new().unwrap();
        let sid = "test-sess".to_string();
        write_claude_status(tmp.path(), &sid);

        let ctx = make_attach_ctx(tmp.path());
        let bindings = AgentBindings::for_attach(&ctx).unwrap();
        let events: Arc<dyn EventSink> = Arc::new(FakeEventSink::new());
        let pty_state = PtyState::new();
        let transcript_state = TranscriptState::new();
        let watcher_state = AgentWatcherState::new();

        start_for(
            bindings,
            events,
            pty_state,
            transcript_state,
            sid.clone(),
            tmp.path().to_path_buf(),
            watcher_state.clone(),
        )
        .expect("start_for happy path");
        assert!(watcher_state.contains(&sid), "session registered");

        watcher_state.remove(&sid);
    }

    #[cfg(test)]
    struct ErrLocator;

    impl StatusSourceLocator for ErrLocator {
        fn locate(
            &self,
            _cwd: &std::path::Path,
            _session_id: &str,
        ) -> Result<LocatedStatusSource, String> {
            Err("locate failed".to_string())
        }
    }

    #[test]
    fn t_lifecycle_2a_start_for_locate_err_preserves_existing_watcher() {
        let sid = "test-sess".to_string();
        let (transcript_state, watcher_state) = seeded_fixture(&sid);

        let adapter: Arc<crate::agent::adapter::claude_code::ClaudeCodeAdapter> =
            Arc::new(crate::agent::adapter::claude_code::ClaudeCodeAdapter);
        let bindings = AgentBindings {
            agent_type: AgentType::ClaudeCode,
            locator: Arc::new(ErrLocator),
            decoder: adapter.clone(),
            transcript_paths: adapter.clone(),
            validator: adapter.clone(),
            streamer: adapter,
        };
        let events: Arc<dyn EventSink> = Arc::new(FakeEventSink::new());
        let pty_state = PtyState::new();

        let result = start_for(
            bindings,
            events,
            pty_state,
            transcript_state.clone(),
            sid.clone(),
            PathBuf::from("/tmp"),
            watcher_state.clone(),
        );

        assert!(result.is_err(), "locate failure should return Err");
        assert!(
            watcher_state.contains(&sid),
            "existing watcher should be preserved"
        );
        assert!(
            transcript_state.contains(&sid),
            "transcript state entry should be preserved"
        );

        watcher_state.remove(&sid);
    }

    #[cfg(test)]
    struct OutsideTrustLocator;

    impl StatusSourceLocator for OutsideTrustLocator {
        fn locate(
            &self,
            cwd: &std::path::Path,
            _session_id: &str,
        ) -> Result<LocatedStatusSource, String> {
            let parent = cwd.parent().unwrap_or(cwd);
            Ok(LocatedStatusSource {
                status_path: parent.join("sibling.json"),
                trust_root: cwd.to_path_buf(),
                static_transcript_hint: None,
            })
        }
    }

    #[test]
    fn t_lifecycle_2b_start_for_trust_err_preserves_existing_watcher() {
        let sid = "test-sess".to_string();
        let (transcript_state, watcher_state) = seeded_fixture(&sid);

        let adapter: Arc<crate::agent::adapter::claude_code::ClaudeCodeAdapter> =
            Arc::new(crate::agent::adapter::claude_code::ClaudeCodeAdapter);
        let bindings = AgentBindings {
            agent_type: AgentType::ClaudeCode,
            locator: Arc::new(OutsideTrustLocator),
            decoder: adapter.clone(),
            transcript_paths: adapter.clone(),
            validator: adapter.clone(),
            streamer: adapter,
        };
        let events: Arc<dyn EventSink> = Arc::new(FakeEventSink::new());
        let pty_state = PtyState::new();

        let result = start_for(
            bindings,
            events,
            pty_state,
            transcript_state.clone(),
            sid.clone(),
            PathBuf::from("/tmp"),
            watcher_state.clone(),
        );

        assert!(result.is_err(), "trust failure should return Err");
        assert!(
            watcher_state.contains(&sid),
            "existing watcher should be preserved"
        );
        assert!(
            transcript_state.contains(&sid),
            "transcript state entry should be preserved"
        );

        watcher_state.remove(&sid);
    }
}
