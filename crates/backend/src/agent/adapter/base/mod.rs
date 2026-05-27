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
