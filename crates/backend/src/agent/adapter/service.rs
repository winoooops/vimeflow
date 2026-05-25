//! `AgentWatcherService` — the registry facade for agent-watcher
//! lifecycle.
//!
//! Step D' of the v4-frozen refactor plan (#246). Owns clones of the
//! four runtime collaborators (`PtyState`, `AgentWatcherState`,
//! `TranscriptState`, `Arc<dyn EventSink>`) and exposes the two
//! lifecycle verbs the IPC layer needs:
//!
//! - `start(session_id)` — resolve the [`AttachContext`] from live
//!   `PtyState`, build the typed [`AgentBindings`], and hand off to
//!   `base::start_for` on the blocking pool.
//! - `stop(session_id)` — remove the session's watcher from
//!   `AgentWatcherState` (its `Drop` cascades the transcript-tail
//!   teardown).
//!
//! **`AttachError` → `String` boundary.** Per #246's D' acceptance and
//! frozen constraint #4, the typed `AttachError` from
//! `AgentBindings::for_attach` is collapsed to `String` *here* — the
//! `base::start_for` layer and everything below it speaks `String`
//! errors. This is the single mapping seam; `start_agent_watcher_inner`
//! delegates to this method rather than mapping independently.

use std::sync::Arc;

use super::bindings::AgentBindings;
use super::{base, resolve_bind_inputs};
use crate::agent::detector::detect_agent;
use crate::runtime::EventSink;
use crate::terminal::PtyState;
use base::{AgentWatcherState, TranscriptState};

/// Registry facade owning clones of the four runtime collaborators.
///
/// Constructed per IPC call from `BackendState`'s long-lived
/// originals (all four are cheap `Arc`-backed clones). `stop` only
/// reads `watcher_state`, but the service carries all four so the
/// facade shape is uniform and a future eager-prevalidation `stop`
/// (or a `restart`) has the inputs it needs without a signature
/// change.
pub(crate) struct AgentWatcherService {
    pty_state: PtyState,
    watcher_state: AgentWatcherState,
    transcript_state: TranscriptState,
    events: Arc<dyn EventSink>,
}

impl AgentWatcherService {
    pub(crate) fn new(
        pty_state: PtyState,
        watcher_state: AgentWatcherState,
        transcript_state: TranscriptState,
        events: Arc<dyn EventSink>,
    ) -> Self {
        Self {
            pty_state,
            watcher_state,
            transcript_state,
            events,
        }
    }

    /// Start (or restart) the agent watcher for `session_id`.
    ///
    /// Resolves the attach inputs from live `PtyState`, builds the
    /// `AgentBindings`, and runs `base::start_for` on the blocking
    /// pool. `AttachError` is mapped to `String` at this boundary.
    pub(crate) async fn start(&self, session_id: String) -> Result<(), String> {
        let attach = resolve_bind_inputs(&self.pty_state, &session_id, detect_agent)?;

        // `AttachError` → `String` mapping seam (frozen constraint #4 /
        // #246 D'). Everything from `base::start_for` down speaks
        // `String`; the typed error stops here.
        let bindings =
            AgentBindings::for_attach(&attach).map_err(|e| format!("agent bindings: {}", e))?;
        let cwd_path = attach.initial_cwd.clone();

        // Clone the owned collaborators into the blocking task.
        // `base::start_for(bindings, ...)` calls
        // `bindings.locator.locate(...)`; for codex sessions the
        // locator runs a bounded retry (5 × 100 ms inter-attempt
        // sleeps) inside its `StatusSourceLocator::locate` impl, and
        // `path_security::ensure_status_source_under_trust_root` does
        // synchronous `canonicalize` I/O. Running either on a tokio
        // worker thread starves co-scheduled futures, so hop onto the
        // blocking pool (mirrors `src/git/watcher.rs`).
        let events = self.events.clone();
        let pty_state = self.pty_state.clone();
        let transcript_state = self.transcript_state.clone();
        let watcher_state = self.watcher_state.clone();
        tokio::task::spawn_blocking(move || {
            base::start_for(
                bindings,
                events,
                pty_state,
                transcript_state,
                session_id,
                cwd_path,
                watcher_state,
            )
        })
        .await
        .map_err(|e| format!("start_agent_watcher task panicked: {}", e))?
    }

    /// Stop the agent watcher for `session_id`. Removing the
    /// `WatcherHandle` from `AgentWatcherState` runs its `Drop`, which
    /// cascades the transcript-tail teardown.
    pub(crate) async fn stop(&self, session_id: String) -> Result<(), String> {
        if self.watcher_state.remove(&session_id) {
            log::info!("Stopped watching statusline for session {}", session_id);
            Ok(())
        } else {
            Err(format!("No active watcher for session: {}", session_id))
        }
    }
}
