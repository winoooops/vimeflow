//! Provider-neutral agent watcher orchestration.
//!
//! This module intentionally keeps a narrow external surface while splitting
//! the runtime internals into smaller files. Adapter implementations provide
//! provider-specific hooks; this layer owns watcher lifecycle, transcript
//! lifecycle, diagnostics, and path-trust enforcement.

mod diagnostics;
mod path_security;
mod transcript_state;
mod watcher_runtime;

use std::path::PathBuf;
use std::sync::Arc;

use crate::agent::adapter::AgentAdapter;
use crate::runtime::EventSink;
use crate::terminal::PtyState;

pub use transcript_state::{TranscriptHandle, TranscriptStartStatus, TranscriptState};
pub use watcher_runtime::{AgentWatcherState, WatcherHandle};

pub(crate) fn start_for(
    adapter: Arc<dyn AgentAdapter>,
    events: Arc<dyn EventSink>,
    pty_state: PtyState,
    transcript_state: TranscriptState,
    session_id: String,
    cwd: PathBuf,
    state: AgentWatcherState,
) -> Result<(), String> {
    let source = adapter.status_source(&cwd, &session_id)?;
    path_security::ensure_status_source_under_trust_root(&source.path, &source.trust_root)?;

    log::debug!(
        "Watcher startup detail: session={}, cwd={}, path={}",
        session_id,
        cwd.display(),
        source.path.display()
    );

    // Stop any existing watcher for this session before counting active
    // watchers. Restarting the same session would otherwise produce a false
    // leaked-watcher signal.
    state.remove(&session_id);

    log::info!(
        "Starting agent watcher: session={}, path={}, active_watchers={}",
        session_id,
        source.path.display(),
        state.active_count(),
    );

    let handle = watcher_runtime::start_watching(
        adapter,
        events,
        pty_state,
        transcript_state,
        session_id.clone(),
        source.path,
    )?;
    state.insert(session_id, handle);

    Ok(())
}
