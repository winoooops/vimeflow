//! File watcher runtime for agent status sources.
//!
//! Watches adapter-provided status files for changes and emits backend events
//! when they update. Uses the `notify` crate plus a polling fallback for
//! environments where file-system notifications are unreliable.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;
use std::time::Instant;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use super::super::bindings::AgentBindings;
#[cfg(debug_assertions)]
use super::diagnostics::short_sid;
use super::diagnostics::{record_event_diag, EventTiming, PathHistory, TxOutcome};
use super::transcript_state::{TranscriptStartStatus, TranscriptState};
use crate::agent::types::AgentType;
// `TranscriptPathValidator` and `TranscriptStreamer` are referenced as
// `Arc<dyn ...>` in `maybe_start_transcript`'s signature, so both must be
// in scope. `StateDecoder` is consumed only via method dispatch on
// `Arc<dyn StateDecoder>` (vtable), so it does not need to appear here
// (PR #261 cycle 2 review F9). Step B'' added `TranscriptStreamer` here
// when `start_or_replace` migrated off `Arc<dyn AgentAdapter>`.
use super::super::traits::{TranscriptPathValidator, TranscriptStreamer};
use super::TrustedLocatedSource;
use crate::agent::adapter::types::{
    stamp_snapshot, LocatedStatusSource, RawPath, TranscriptPathSource, ValidateTranscriptError,
};
use crate::agent::events::emit_agent_status;
use crate::runtime::EventSink;
use crate::terminal::PtyState;

/// Step 0c: resolve the transcript path by asking the adapter's
/// `TranscriptPathSource` for a dynamic hint (Claude, fresh per
/// update) first, then falling back to the static hint (Codex, fixed
/// at attach time and stored on the [`LocatedStatusSource`]).
///
/// Replaces the former `parsed.transcript_path` side channel on
/// [`crate::agent::adapter::types::ParsedStatus`]. The shape is the
/// same `Option<RawPath>` the previous field carried; the difference
/// is that `TranscriptPathSource` is the single typed origin point
/// the watcher now consults.
fn resolve_transcript_path(
    transcript_paths: &Arc<dyn TranscriptPathSource>,
    raw: &str,
    located: &LocatedStatusSource,
) -> Option<RawPath> {
    transcript_paths
        .dynamic_hint(raw)
        .or_else(|| transcript_paths.static_hint(located))
}

/// Handle to a running watcher — dropping it stops the watcher and polling thread
pub struct WatcherHandle {
    _watcher: Option<RecommendedWatcher>,
    /// Signals the polling fallback thread to exit
    poll_stop: Arc<(Mutex<bool>, Condvar)>,
    /// Polling fallback thread. Stored so Drop can join after signalling
    /// stop, rather than leaving the thread briefly detached.
    join_handle: Option<std::thread::JoinHandle<()>>,
    /// Cloned handle to the runtime-managed `TranscriptState` — `Drop`
    /// calls `transcript_state.stop(&self.session_id)` to cascade
    /// transcript-tail teardown, replacing today's two-step
    /// frontend-driven stop courtesy.
    transcript_state: TranscriptState,
    /// Used by the `Drop` cascade AND the debug-build diagnostic log.
    /// (Earlier revisions had a separate `session_id_for_log: String`
    /// gated on `#[cfg(debug_assertions)]` — but the comment claiming
    /// this saved a `String::clone` in release builds was wrong, since
    /// `session_id` itself is always cloned into the struct. Removed
    /// in cycle 6 per Claude review F13.)
    session_id: String,
    /// Which agent runs in this pty session. Stored here so
    /// `AgentWatcherState::agent_type_for_pty` can resolve under the
    /// single `watchers` mutex, instead of a separate `agent_types`
    /// map that would expose an inconsistency window between insert /
    /// remove and the lookup (PR #302 Claude review F2 — the pre-fix
    /// split-mutex design let the rename / title-sync IPC see "agent
    /// type present, watcher absent" and the reverse during the gap
    /// between the two critical sections).
    agent_type: AgentType,
    /// Optional codex title-sync watcher stop flag. `Some` only for
    /// Codex sessions where the locator surfaced an `agent_session_id`;
    /// `None` for Claude / NoOp / Codex-without-thread-id. `Drop`
    /// signals stop before joining `session_index_join` so the
    /// poll-and-emit thread exits in bounded time (PR #302 codex
    /// review F5 — re-wires the title-sync path that the pre-fix
    /// refactor dropped).
    session_index_stop: Option<Arc<AtomicBool>>,
    /// Optional codex title-sync watcher join handle. Paired with
    /// `session_index_stop`; `Drop` joins after signalling stop so the
    /// thread is reaped instead of left detached (matches the existing
    /// `join_handle` pattern for the polling fallback).
    session_index_join: Option<std::thread::JoinHandle<()>>,
    /// True if this handle owns the per-session entry in
    /// `transcript_state` and should tear it down on Drop. Cleared to
    /// `false` by `AgentWatcherState::insert` when this handle is
    /// displaced by a NEW handle for the same session: the new handle's
    /// `start_watching` inline-init has already called
    /// `TranscriptState::start_or_replace` and, depending on the result,
    /// either inherited the existing entry (`AlreadyRunning`), replaced
    /// it with a new tail (`Replaced`), or started a fresh one
    /// (`Started`). In all three cases the NEW handle is the rightful
    /// owner of the per-session transcript-state entry, so the OLD
    /// handle's Drop must NOT call `transcript_state.stop` — otherwise
    /// it would tear down the tail the new handle just adopted, leaving
    /// the session with a status watcher but no transcript streaming
    /// (PR #302 codex review cycle 5 P1 — the bug existed for every
    /// restart, not just the `AlreadyRunning` shape codex flagged).
    owns_transcript: bool,
}

impl Drop for WatcherHandle {
    fn drop(&mut self) {
        drop(self._watcher.take());
        let (lock, wake) = &*self.poll_stop;
        {
            let mut stopped = lock.lock().expect("failed to lock poll stop flag");
            *stopped = true;
            wake.notify_one();
        }
        if let Some(handle) = self.join_handle.take() {
            let _ = handle.join();
        }
        // Stop + join the codex title-sync watcher (if any). Bounded by
        // the watcher's own poll cadence (~500ms) — same shape as the
        // polling fallback teardown above (PR #302 codex review F5).
        // Always unconditional: `session_index::spawn_watch` is called
        // per-handle in `start_watching` (not via an idempotent
        // start-or-replace), so the new handle has its own thread and
        // the old thread is a redundant resource that must be reaped
        // (NOT inherited the way transcript-state is).
        if let Some(stop) = self.session_index_stop.take() {
            stop.store(true, std::sync::atomic::Ordering::Release);
        }
        if let Some(handle) = self.session_index_join.take() {
            let _ = handle.join();
        }
        // Only tear down the transcript-state entry if THIS handle
        // currently owns it. When a new handle for the same session
        // displaces this one via `AgentWatcherState::insert`, the new
        // handle's `start_watching` has already adopted / replaced /
        // started the per-session transcript entry, and `insert` cleared
        // this flag before letting the displaced handle drop — calling
        // `stop` here would otherwise tear down the new tail (PR #302
        // codex review cycle 5 P1). Clean stops via
        // `AgentWatcherState::remove` leave the flag set, so this
        // line runs and the tail is correctly stopped.
        if self.owns_transcript {
            let _ = self.transcript_state.stop(&self.session_id);
        }
        // `#[cfg(...)]` (attribute) on a statement, NOT `if cfg!(...)`
        // (runtime). The attribute physically removes the entire
        // `log::info!(...)` call in release builds, so even the
        // `short_sid` slice into `self.session_id` is compiled away.
        #[cfg(debug_assertions)]
        log::info!(
            "watcher.handle.dropped session={}",
            short_sid(&self.session_id)
        );
    }
}

/// Thread-safe state for managing active agent watchers per session.
///
/// PR #302 Claude review F2 collapsed the previous parallel `agent_types`
/// map into a field on `WatcherHandle`, so `agent_type_for_pty` and
/// `contains` / `active_count` now read from the SAME `watchers` mutex
/// — closing the inconsistency window where the rename / title-sync IPC
/// could observe an agent type without a live watcher (or vice versa)
/// during a concurrent insert / remove.
#[derive(Default, Clone)]
pub struct AgentWatcherState {
    watchers: Arc<Mutex<HashMap<String, WatcherHandle>>>,
}

impl AgentWatcherState {
    /// Create a new empty watcher state
    pub fn new() -> Self {
        Self {
            watchers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Insert a watcher for a session, stopping any existing watcher.
    ///
    /// Stamps the handle's `agent_type` from the caller-supplied value
    /// so the watchers map is the single source of truth for both the
    /// watcher presence AND the agent type — no split-mutex
    /// inconsistency window (PR #302 Claude review F2).
    ///
    /// Scope the lock guard to a nested block so the evicted
    /// `WatcherHandle` (if any) drops AFTER the watchers mutex is
    /// released. `WatcherHandle::Drop` joins the polling thread, which
    /// can sleep up to 3 seconds — holding the mutex across that wait
    /// would block any concurrent `insert` / `remove` / `active_count`
    /// for the same duration. Same fix that was already in
    /// `TranscriptState::stop` (Claude review on PR #152, F7).
    pub fn insert(&self, session_id: String, mut handle: WatcherHandle, agent_type: AgentType) {
        handle.agent_type = agent_type;
        let mut displaced = {
            let mut watchers = self.watchers.lock().expect("failed to lock watchers");
            watchers.insert(session_id, handle)
        };
        // If we displaced a prior handle for the same session, transfer
        // ownership of the per-session transcript-state entry to the
        // NEW handle: clear the OLD handle's `owns_transcript` flag so
        // its Drop won't call `transcript_state.stop` and tear down the
        // tail the new handle just adopted via `start_or_replace`. See
        // `WatcherHandle.owns_transcript` for the full rationale (PR
        // #302 codex review cycle 5 P1).
        if let Some(d) = displaced.as_mut() {
            d.owns_transcript = false;
        }
        // `displaced: Option<WatcherHandle>` drops here, after the
        // guard above is gone. If non-None, its `Drop` joins the poll
        // thread (and the codex session-index thread, if any) without
        // holding the mutex AND without stopping the transcript tail
        // the new handle now owns.
    }

    /// Remove and stop a watcher for a session.
    ///
    /// Same lock-vs-Drop concern as `insert` — scope the guard so the
    /// removed `WatcherHandle` drops outside the mutex (Claude review
    /// on PR #152, F7).
    pub fn remove(&self, session_id: &str) -> bool {
        let handle = {
            let mut watchers = self.watchers.lock().expect("failed to lock watchers");
            watchers.remove(session_id)
        };
        handle.is_some()
        // `handle: Option<WatcherHandle>` drops at end of function,
        // after the lock guard above has already gone out of scope.
    }

    /// Check if a session has an active watcher
    #[allow(dead_code)]
    pub fn contains(&self, session_id: &str) -> bool {
        let watchers = self.watchers.lock().expect("failed to lock watchers");
        watchers.contains_key(session_id)
    }

    /// Number of active watchers across all sessions. Used for the
    /// diagnostic "active_watchers=N" log line — surfaces leaked
    /// watchers from prior sessions that are still polling old
    /// status.json files in the background.
    pub(crate) fn active_count(&self) -> usize {
        let watchers = self.watchers.lock().expect("failed to lock watchers");
        watchers.len()
    }

    /// Resolve which agent runs in a given pty/session — used by the rename /
    /// title-sync IPC (main #265). Reads from the same `watchers` mutex
    /// that gates `contains` / `active_count`, so callers observe
    /// agent-type and watcher-presence atomically (PR #302 Claude review
    /// F2 collapsed the previous separate `agent_types` map).
    pub fn agent_type_for_pty(&self, pty_id: &str) -> Option<AgentType> {
        let watchers = self.watchers.lock().expect("failed to lock watchers");
        watchers.get(pty_id).map(|handle| handle.agent_type)
    }

    /// Test-only seam to set a pty's agent type without going through a
    /// real watcher startup. Builds a stub `WatcherHandle::new_for_test`
    /// with a fresh `TranscriptState` (whose `stop` is a no-op for an
    /// unknown session id, matching the production handle Drop
    /// cascade), then inserts via the public `insert` API so the
    /// single-mutex invariant is preserved (PR #302 Claude review F2).
    #[cfg(test)]
    pub(crate) fn insert_agent_type_for_test(&self, pty_id: String, agent_type: AgentType) {
        let stub = WatcherHandle::new_for_test(TranscriptState::new(), pty_id.clone());
        self.insert(pty_id, stub, agent_type);
    }
}

/// Try to start transcript tailing, switching files if Claude reports a new path.
///
/// `cwd` is queried fresh from PtyState at every call rather than captured
/// by the outer `start_watching` closures. The user can `cd` mid-session
/// without restarting the agent watcher; we want the test-runner parser to
/// pick up the new workspace immediately. Combined with
/// `TranscriptState::start_or_replace`'s (transcript_path, cwd) identity
/// check, a cwd change triggers a Replace of the tail thread.
fn maybe_start_transcript(
    validator: &Arc<dyn TranscriptPathValidator>,
    streamer: &Arc<dyn TranscriptStreamer>,
    events: Arc<dyn EventSink>,
    pty_state: &PtyState,
    transcript_state: &TranscriptState,
    session_id: &str,
    transcript_path: &str,
) -> TxOutcome {
    let canonical = match validator.validate(transcript_path) {
        Ok(path) => path,
        Err(e) => {
            log::warn!(
                "Skipping transcript tailing for session {}: {}",
                session_id,
                e
            );
            return match e {
                ValidateTranscriptError::NotFound(_) => TxOutcome::Missing,
                ValidateTranscriptError::OutsideRoot { .. } => TxOutcome::OutsidePath,
                // `InvalidPath` is potentially-adversarial input
                // (currently null-byte injection), so it must NOT be
                // collapsed into `NotFile`. `NotFile` covers the
                // residual category of validation failures where the
                // path is structurally well-formed but the resolved
                // file isn't usable: `NotAFile` (canonical path is a
                // directory or special file) and `Other` (e.g., the
                // home-directory probe failed, or the path resolved to
                // something we couldn't classify). Operators grepping
                // logs for `tx_status=invalid_path` (see the
                // diagnostics emitter format string) get the
                // null-byte signal directly. Claude review on PR #153.
                ValidateTranscriptError::InvalidPath(_) => TxOutcome::InvalidPath,
                ValidateTranscriptError::NotAFile(_) | ValidateTranscriptError::Other(_) => {
                    TxOutcome::NotFile
                }
            };
        }
    };

    let cwd = pty_state
        .get_cwd(&session_id.to_string())
        .map(PathBuf::from);

    // Step B'': `TranscriptState::start_or_replace` now takes
    // `Arc<dyn TranscriptStreamer>` directly (was `Arc<dyn AgentAdapter>`
    // through B'). `bindings.streamer` is the concrete adapter's
    // streamer view — for Codex it shares the same `Arc<CompositeLocator>`
    // the watcher's locator uses (B' cycle 11), so there's no second
    // locator allocation.
    match transcript_state.start_or_replace(
        streamer.clone(),
        events,
        session_id.to_string(),
        canonical.clone(),
        cwd,
    ) {
        Ok(TranscriptStartStatus::Started) => {
            log::info!(
                "Started transcript tailing for session {}: {}",
                session_id,
                canonical.display()
            );
            TxOutcome::Started
        }
        Ok(TranscriptStartStatus::Replaced) => {
            log::info!(
                "Switched transcript tailing for session {}: {}",
                session_id,
                canonical.display()
            );
            TxOutcome::Replaced
        }
        Ok(TranscriptStartStatus::AlreadyRunning) => TxOutcome::AlreadyRunning,
        Err(e) => {
            log::warn!(
                "Failed to start transcript tailing for session {}: {}",
                session_id,
                e
            );
            TxOutcome::StartFailed
        }
    }
}

/// Start watching a statusline file for changes.
///
/// Watches the parent directory and filters for events on the target file.
/// Debounces at 100ms to avoid redundant processing.
///
/// CWD is intentionally NOT captured here. `maybe_start_transcript` queries
/// PtyState fresh on every invocation so a `cd` mid-session updates the
/// workspace seen by the test-runner parser.
///
/// Step 0c: the parameter shape changed from a bare
/// `status_file_path: PathBuf` to the full
/// [`LocatedStatusSource`] so the per-update transcript-path lookup
/// (which now goes through `TranscriptPathSource`)
/// can consult `static_transcript_hint` for Codex. The file watched
/// is still `located.status_path`; the rest of the struct is cloned
/// into each callback so they can resolve transcript paths via the
/// new trait without re-reading from the adapter.
pub(crate) fn start_watching(
    bindings: AgentBindings,
    events: Arc<dyn EventSink>,
    pty_state: PtyState,
    transcript_state: TranscriptState,
    session_id: String,
    located: TrustedLocatedSource,
) -> Result<WatcherHandle, String> {
    let located = located.into_inner();
    let status_file_path = located.status_path.clone();
    let target_path = status_file_path.clone();
    let sid = session_id.clone();
    let last_processed = Arc::new(Mutex::new(Instant::now()));
    let poll_stop = Arc::new((Mutex::new(false), Condvar::new()));
    let transcript_state_for_handle = transcript_state.clone();

    // Diagnostic state — per-source timing for sources that fire
    // repeatedly (notify, poll), and a SHARED path history so the
    // speculative→resolved transcript-path flip is detected even when
    // it spans sources (e.g. inline saw the speculative path, notify
    // sees the resolved one). The inline-init source has NO timing
    // mutex: it's one-shot and `dt` would be structurally zero —
    // record_event_diag accepts `Option<&Mutex<EventTiming>>` and
    // logs `dt=n/a` when None.
    let notify_timing = Arc::new(Mutex::new(EventTiming::default()));
    let poll_timing = Arc::new(Mutex::new(EventTiming::default()));
    let path_history = Arc::new(Mutex::new(PathHistory::default()));

    // Step B': pull the trait views out of bindings up front. Each
    // is `Arc<dyn ...>` — cheap to clone into closures and threads.
    //
    // Two `AgentBindings` fields are intentionally NOT destructured
    // here and drop with the function-local move:
    //
    // - `bindings.locator` — already used by `start_for` before this
    //   function runs (it borrowed `&bindings.locator` to call
    //   `locate(...)` and produce the `LocatedStatusSource` passed in
    //   as `located`). The `Arc` itself wasn't consumed there — it
    //   stayed alive on `bindings` and drops with this function-local
    //   move now (PR #261 cycle 11 review F32). The watcher itself
    //   doesn't need the locator again.
    // - `bindings.agent_type` — now CONSUMED here too: stamped onto
    //   the returned `WatcherHandle.agent_type` so
    //   `AgentWatcherState::agent_type_for_pty` can resolve under the
    //   same mutex as `contains` / `active_count`, and used below to
    //   gate the codex `session_index.jsonl` title-sync spawn (PR #302
    //   Claude review F2 + codex review F5).
    //
    // Step B'' (this PR): `bindings.streamer` is now CONSUMED here and
    // threaded into `TranscriptState::start_or_replace` (which migrated
    // off `Arc<dyn AgentAdapter>` onto `Arc<dyn TranscriptStreamer>`).
    // The former transitional `bindings.adapter_for_transcript_state`
    // field was removed in this step — the cycle-11 shared-`Arc`
    // guarantee now lives entirely in `bindings.streamer` (for Codex it
    // is the `Arc<CodexAdapter>` that shares the same
    // `Arc<CompositeLocator>` the locator uses).
    let agent_type = bindings.agent_type;
    let decoder = bindings.decoder;
    let validator = bindings.validator;
    let transcript_paths = bindings.transcript_paths;
    let streamer = bindings.streamer;

    let notify_timing_for_cb = notify_timing.clone();
    let path_history_for_cb = path_history.clone();
    let decoder_for_cb = decoder.clone();
    let validator_for_cb = validator.clone();
    let transcript_paths_for_cb = transcript_paths.clone();
    let streamer_for_cb = streamer.clone();
    let last_processed_for_cb = last_processed.clone();
    let events_for_cb = events.clone();
    let pty_state_for_cb = pty_state.clone();
    let transcript_state_for_cb = transcript_state.clone();
    // Step 0c: each watcher callback (notify / inline-init / poll)
    // needs the full `LocatedStatusSource` so it can ask the adapter's
    // `TranscriptPathSource::static_hint` for Codex's attach-time
    // rollout path. Cheap — it's two `PathBuf`s + `Option<String>`.
    let located_for_cb = located.clone();
    // The notify closure consumes `sid` directly. Cycle 3 introduced a
    // redundant `sid = sid.clone()` for the new
    // `decoder.decode(Some(&sid), ...)` argument while the
    // legacy log/record_event_diag sites still used bare `sid`, leaving
    // two captures of the same value inside one closure (PR #261 cycle
    // 6 review F19). The closure now uses `sid` uniformly.

    // Debounce interval — ignore events within 100ms of the last processed one
    let debounce_ms = 100;

    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        let event = match res {
            Ok(ev) => ev,
            Err(e) => {
                log::error!("Watcher error for session {}: {}", sid, e);
                return;
            }
        };

        // Only react to data modifications or file creation
        let dominated = matches!(
            event.kind,
            EventKind::Modify(notify::event::ModifyKind::Data(_))
                | EventKind::Create(notify::event::CreateKind::File)
        );
        if !dominated {
            return;
        }

        // Filter: only process events for the target status file
        let is_target = event.paths.iter().any(|p| p == &target_path);
        if !is_target {
            return;
        }

        // Debounce: skip if processed too recently
        {
            let mut last = last_processed_for_cb
                .lock()
                .expect("failed to lock debounce");
            let now = Instant::now();
            if now.duration_since(*last).as_millis() < debounce_ms {
                return;
            }
            *last = now;
        }

        let started = Instant::now();

        // Read and parse the status file
        let contents = match std::fs::read_to_string(&target_path) {
            Ok(c) => c,
            Err(e) => {
                log::warn!("Failed to read statusline file for session {}: {}", sid, e);
                return;
            }
        };

        if contents.trim().is_empty() {
            return;
        }

        // Step B': decode → session-id-stamped event. The decoder is
        // session-id-free per R2.2; the runtime composes the event
        // here (this was the v4-frozen plan's "runtime stamps the
        // session id" move).
        let (outcome, tx_path) = match decoder_for_cb.decode(Some(&sid), &contents) {
            Ok(snapshot) => {
                let event = stamp_snapshot(&sid, snapshot);
                if let Err(e) = emit_agent_status(events_for_cb.as_ref(), &event) {
                    log::error!("Failed to emit agent-status event: {}", e);
                }

                match resolve_transcript_path(&transcript_paths_for_cb, &contents, &located_for_cb)
                {
                    Some(path) => {
                        let outcome = maybe_start_transcript(
                            &validator_for_cb,
                            &streamer_for_cb,
                            events_for_cb.clone(),
                            &pty_state_for_cb,
                            &transcript_state_for_cb,
                            &sid,
                            &path,
                        );
                        (outcome, Some(path))
                    }
                    None => (TxOutcome::NoPath, None),
                }
            }
            Err(e) => {
                log::warn!(
                    "Failed to parse statusline for session {}: {}",
                    sid,
                    e
                );
                (TxOutcome::ParseError, None)
            }
        };

        record_event_diag(
            Some(&notify_timing_for_cb),
            &path_history_for_cb,
            "notify",
            &sid,
            started.elapsed(),
            outcome,
            tx_path.as_deref(),
        );
    })
    .map_err(|e| format!("failed to create watcher: {}", e))?;
    // Watch the parent directory (notify watches directories, not individual
    // files). The directory is guaranteed to exist and to have passed the
    // canonicalize-and-verify trust-root check by `path_security::
    // ensure_status_source_under_trust_root`, the only path that reaches
    // this function (Claude review on PR #152, F3 — removed a redundant
    // create_dir_all that re-did path_security's work). If `start_watching`
    // is ever promoted to `pub` and gains a caller that bypasses
    // `start_for`, that caller is responsible for invoking
    // `ensure_status_source_under_trust_root` first; do NOT add a defensive
    // create_dir_all here, because it would create the directory without
    // the post-create symlink-race re-canonicalize check that
    // `path_security` performs.
    let parent_dir = status_file_path
        .parent()
        .ok_or_else(|| "status file path has no parent directory".to_string())?;

    watcher
        .watch(parent_dir, RecursiveMode::NonRecursive)
        .map_err(|e| format!("failed to start watching: {}", e))?;

    // Read the file immediately in case it was already written before
    // the watcher started (common race: status.json written by statusline.sh
    // before the frontend calls start_agent_watcher).
    {
        let initial_sid = session_id.clone();
        let initial_path = status_file_path.clone();
        let initial_decoder = decoder.clone();
        let initial_validator = validator.clone();
        let initial_transcript_paths = transcript_paths.clone();
        let initial_streamer = streamer.clone();
        let initial_events = events.clone();
        let initial_pty_state = pty_state.clone();
        let initial_transcript_state = transcript_state.clone();
        let initial_located = located.clone();
        let started = Instant::now();
        let mut outcome = TxOutcome::NoPath;
        let mut inline_tx_path: Option<String> = None;
        if let Ok(contents) = std::fs::read_to_string(&initial_path) {
            if !contents.trim().is_empty() {
                *last_processed.lock().expect("failed to lock debounce") = Instant::now();
                match initial_decoder.decode(Some(&initial_sid), &contents) {
                    Ok(snapshot) => {
                        let event = stamp_snapshot(&initial_sid, snapshot);
                        let _ = emit_agent_status(initial_events.as_ref(), &event);
                        if let Some(path) = resolve_transcript_path(
                            &initial_transcript_paths,
                            &contents,
                            &initial_located,
                        ) {
                            outcome = maybe_start_transcript(
                                &initial_validator,
                                &initial_streamer,
                                initial_events.clone(),
                                &initial_pty_state,
                                &initial_transcript_state,
                                &initial_sid,
                                &path,
                            );
                            inline_tx_path = Some(path);
                        }
                    }
                    Err(e) => {
                        log::warn!(
                            "Failed to parse statusline for session {} \
                             (inline-init): {}",
                            initial_sid,
                            e
                        );
                        outcome = TxOutcome::ParseError;
                    }
                }
                record_event_diag(
                    None,
                    &path_history,
                    "inline",
                    &initial_sid,
                    started.elapsed(),
                    outcome,
                    inline_tx_path.as_deref(),
                );
            }
        }
    }

    // Polling fallback — WSL2's inotify can miss events and Claude Code
    // may use atomic writes (rename). The stop_flag is set when the
    // WatcherHandle is dropped, causing the thread to exit cleanly.
    let poll_join_handle = {
        let poll_sid = session_id.clone();
        let poll_path = status_file_path.clone();
        let poll_events = events.clone();
        let poll_pty_state = pty_state.clone();
        let poll_transcript_state = transcript_state.clone();
        let poll_stop = poll_stop.clone();
        let poll_timing_for_thread = poll_timing.clone();
        let path_history_for_poll = path_history.clone();
        let poll_decoder = decoder.clone();
        let poll_validator = validator.clone();
        let poll_transcript_paths = transcript_paths.clone();
        let poll_streamer = streamer.clone();
        // Step 0c: poll thread also routes transcript-path lookups
        // through `TranscriptPathSource` and so needs its own clone of
        // the `LocatedStatusSource`.
        let poll_located = located.clone();
        Some(std::thread::spawn(move || {
            // `poll_last` is the per-thread dedup buffer. Originally
            // wrapped in `Arc<Mutex<String>>` by analogy with the other
            // `Arc`-shared state in the spawn closure, but it is only
            // touched here and never escapes the thread (Claude review
            // on PR #152, F11). Plain `String` removes the heap
            // allocation and per-poll-cycle atomic refcount traffic.
            let mut poll_last = String::new();

            loop {
                let (lock, wake) = &*poll_stop;
                // pre_wait_guard is consumed by wait_timeout_while; stop_guard must drop before file I/O.
                let pre_wait_guard = lock.lock().expect("failed to lock poll stop flag");
                let (stop_guard, _) = wake
                    .wait_timeout_while(pre_wait_guard, Duration::from_secs(3), |flag| !*flag)
                    .expect("failed to wait on poll stop flag");
                if *stop_guard {
                    break;
                }
                drop(stop_guard);

                // Capture `started` BEFORE the read so `total` covers file
                // I/O the same way the notify and inline sources do —
                // otherwise WSL2/virtio-fs read latency is silently
                // excluded from poll's number, making cross-source
                // comparison unsound and biasing the freeze diagnosis
                // toward notify. Dedup-skip `continue` paths run before
                // `record_event_diag`, so unchanged-content polls never
                // log a number — no noise.
                let started = Instant::now();

                let contents = match std::fs::read_to_string(&poll_path) {
                    Ok(c) if !c.trim().is_empty() => c,
                    _ => continue,
                };

                if poll_last == contents {
                    continue;
                }
                poll_last = contents.clone();

                let (outcome, tx_path) = match poll_decoder.decode(Some(&poll_sid), &contents) {
                    Ok(snapshot) => {
                        let event = stamp_snapshot(&poll_sid, snapshot);
                        let _ = emit_agent_status(poll_events.as_ref(), &event);
                        // Step 0c: same `TranscriptPathSource` flow as
                        // the notify and inline callbacks.
                        match resolve_transcript_path(
                            &poll_transcript_paths,
                            &contents,
                            &poll_located,
                        ) {
                            Some(path) => {
                                let outcome = maybe_start_transcript(
                                    &poll_validator,
                                    &poll_streamer,
                                    poll_events.clone(),
                                    &poll_pty_state,
                                    &poll_transcript_state,
                                    &poll_sid,
                                    &path,
                                );
                                (outcome, Some(path))
                            }
                            None => (TxOutcome::NoPath, None),
                        }
                    }
                    Err(e) => {
                        log::warn!(
                            "Failed to parse statusline for session {} (poll): {}",
                            poll_sid,
                            e
                        );
                        (TxOutcome::ParseError, None)
                    }
                };

                record_event_diag(
                    Some(&poll_timing_for_thread),
                    &path_history_for_poll,
                    "poll",
                    &poll_sid,
                    started.elapsed(),
                    outcome,
                    tx_path.as_deref(),
                );
            }
        }))
    };

    // Codex title-sync watcher (PR #302 codex review F5). Re-wires the
    // `session_index.jsonl` watcher that the pre-fix refactor dropped:
    // when the locator surfaced an `agent_session_id` (Codex's
    // `thread_id`), spawn a watcher that emits `agent-session-title`
    // events as `thread_name` updates land in
    // `<codex_home>/session_index.jsonl`. The `WatcherHandle::Drop`
    // cascade signals stop + joins the thread so the title-sync
    // lifecycle is bound 1:1 to the statusline watcher's lifetime.
    //
    // Gated on (a) `agent_type == Codex` and (b) the locator actually
    // surfaced an agent_session_id — both must hold. Claude / NoOp /
    // Codex-without-thread-id leave the handle's title-sync fields as
    // `None` and Drop becomes a no-op for those branches.
    let (session_index_stop, session_index_join) =
        if matches!(agent_type, AgentType::Codex) && located.agent_session_id.is_some() {
            // PR #302 cycle 2 F4: `located.trust_root` can be the relative
            // `.codex` path when `dirs::home_dir()` returns `None` (headless
            // / container environments). `default_codex_home()` keeps the
            // relative fallback so codex attach itself doesn't hard-fail —
            // but joining `session_index.jsonl` onto a relative trust_root
            // and handing the result to `spawn_watch` would open the wrong
            // file (relative to the sidecar's cwd, NOT the user's home).
            // Status-path flow tolerates this because
            // `ensure_status_source_under_trust_root` canonicalizes early;
            // the title-sync path bypasses that gate, so we add an explicit
            // absoluteness check here. Non-absolute → skip the title-sync
            // spawn and log a warn so operators can correlate "Codex titles
            // not updating" with a missing HOME env.
            if !located.trust_root.is_absolute() {
                log::warn!(
                    "codex title-sync: skipping spawn — trust_root is not absolute (path={}); \
                     check HOME / dirs::home_dir() in this environment",
                    located.trust_root.display(),
                );
                (None, None)
            } else {
                let agent_session_id = located
                    .agent_session_id
                    .clone()
                    .expect("checked is_some above");
                let session_index_path = located.trust_root.join("session_index.jsonl");
                let stop = Arc::new(AtomicBool::new(false));
                let join = super::super::codex::session_index::spawn_watch(
                    session_index_path,
                    agent_session_id,
                    session_id.clone(),
                    events.clone(),
                    stop.clone(),
                );
                (Some(stop), Some(join))
            }
        } else {
            (None, None)
        };

    log::info!(
        "Started watching statusline for session {}: {}",
        session_id,
        status_file_path.display()
    );

    Ok(WatcherHandle {
        _watcher: Some(watcher),
        poll_stop,
        join_handle: poll_join_handle,
        transcript_state: transcript_state_for_handle,
        session_id: session_id.clone(),
        agent_type,
        session_index_stop,
        session_index_join,
        // Default `true` — this handle owns the transcript-state entry
        // it just established via inline-init. `AgentWatcherState::insert`
        // clears this to `false` if a NEW handle later displaces this
        // one for the same session (transferring ownership to the new
        // handle). See `WatcherHandle.owns_transcript` for rationale.
        owns_transcript: true,
    })
}

#[cfg(test)]
impl WatcherHandle {
    pub(crate) fn new_for_test(
        transcript_state: TranscriptState,
        session_id: String,
    ) -> Self {
        // `agent_type` defaults to `ClaudeCode`. Tests that care about
        // the agent type pass the real value through
        // `AgentWatcherState::insert(sid, handle, agent_type)`, which
        // overwrites this field — so the default only matters for
        // tests that never call `agent_type_for_pty` on the stub.
        WatcherHandle {
            _watcher: None,
            poll_stop: Arc::new((Mutex::new(false), Condvar::new())),
            join_handle: None,
            transcript_state,
            session_id,
            agent_type: AgentType::ClaudeCode,
            session_index_stop: None,
            session_index_join: None,
            owns_transcript: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::FakeEventSink;

    #[test]
    fn creates_empty_watcher_state() {
        let state = AgentWatcherState::new();
        assert!(!state.contains("test-session"));
    }

    #[test]
    fn remove_returns_false_for_missing_session() {
        let state = AgentWatcherState::new();
        assert!(!state.remove("nonexistent"));
    }

    #[test]
    fn insert_makes_agent_type_and_presence_atomic_under_single_lock() {
        // PR #302 Claude review F2 — `agent_type_for_pty` and `contains`
        // / `active_count` must agree on every snapshot. Before the fix,
        // `agent_types` and `watchers` were separate mutexes and a
        // concurrent reader could see (Some(type), contains=false) or
        // (None, contains=true) between insert's two critical sections.
        // After the fix, the agent type lives on `WatcherHandle` and is
        // resolved from the same map `contains` queries — so the
        // round-trip below is structurally atomic.
        let state = AgentWatcherState::new();
        let sid = "atomic-sid".to_string();
        assert_eq!(state.agent_type_for_pty(&sid), None);
        assert!(!state.contains(&sid));

        let handle = WatcherHandle::new_for_test(TranscriptState::new(), sid.clone());
        state.insert(sid.clone(), handle, AgentType::Codex);

        // Both reads under the same `watchers` mutex — must agree.
        assert_eq!(state.agent_type_for_pty(&sid), Some(AgentType::Codex));
        assert!(state.contains(&sid));

        state.remove(&sid);
        assert_eq!(state.agent_type_for_pty(&sid), None);
        assert!(!state.contains(&sid));
    }

    /// PR #302 codex review cycle 5 P1 — when a NEW handle for the same
    /// session displaces an OLD handle via `insert`, the new handle has
    /// already adopted/replaced/started the per-session transcript-state
    /// entry. The displaced OLD handle's Drop must NOT stop that entry —
    /// otherwise the session ends up with a status watcher but no
    /// transcript tail. This test pins the handoff: insert A (registers
    /// tail), insert B for same session, then assert the tail is still
    /// tracked AFTER A's drop. Without the `owns_transcript` flag, the
    /// displaced A's Drop would call `transcript_state.stop`, leaving
    /// the assert failing.
    #[test]
    fn insert_transfers_transcript_ownership_to_displacing_handle() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let transcript_path = tmp.path().join("t.jsonl");
        std::fs::write(&transcript_path, "").expect("write");

        let transcript_state = TranscriptState::new();
        let sid = "restart-sid".to_string();
        let adapter: Arc<dyn TranscriptStreamer> =
            Arc::new(crate::agent::adapter::claude_code::ClaudeCodeAdapter);
        let sink = Arc::new(FakeEventSink::new());

        // Seed transcript_state with an entry for `sid` (as if the OLD
        // handle's `start_watching` had done so via start_or_replace).
        let status = transcript_state
            .start_or_replace(
                adapter,
                sink,
                sid.clone(),
                transcript_path.clone(),
                None,
            )
            .expect("seed transcript");
        assert_eq!(status, TranscriptStartStatus::Started);

        // OLD handle A — owns the seeded transcript entry.
        let handle_a = WatcherHandle::new_for_test(transcript_state.clone(), sid.clone());
        let state = AgentWatcherState::new();
        state.insert(sid.clone(), handle_a, AgentType::ClaudeCode);
        assert!(transcript_state.contains(&sid));

        // NEW handle B — same session. (In production, B would inherit
        // the per-session entry via start_or_replace returning
        // AlreadyRunning during start_watching's inline-init; the test
        // stub skips start_watching and just simulates the displacement.)
        let handle_b = WatcherHandle::new_for_test(transcript_state.clone(), sid.clone());
        state.insert(sid.clone(), handle_b, AgentType::ClaudeCode);

        // Critical assertion: A has been displaced and dropped, but the
        // transcript entry must STILL be tracked because B inherited
        // ownership (the `owns_transcript = false` clearing in
        // `insert`). Pre-fix: A's Drop would have called
        // transcript_state.stop and this assertion would fail.
        assert!(
            transcript_state.contains(&sid),
            "transcript tail must survive A's displacement — B owns it now",
        );

        // Clean removal of B drops with owns_transcript = true, so the
        // tail is finally stopped. This pins the "owns_transcript stays
        // true on the surviving handle" half of the invariant.
        state.remove(&sid);
        assert!(
            !transcript_state.contains(&sid),
            "transcript tail must stop when the final handle is removed",
        );
    }

    #[test]
    fn t_lifecycle_3_watcher_handle_drop_cascades_transcript_stop() {
        let tmp = tempfile::tempdir().expect("failed to create temp dir");
        let transcript_path = tmp.path().join("t.jsonl");
        std::fs::write(&transcript_path, "").expect("failed to write transcript");

        let transcript_state = TranscriptState::new();
        let sid = "test-sid".to_string();
        let adapter: Arc<dyn TranscriptStreamer> =
            Arc::new(crate::agent::adapter::claude_code::ClaudeCodeAdapter);
        let sink = Arc::new(FakeEventSink::new());

        let status = transcript_state
            .start_or_replace(adapter, sink, sid.clone(), transcript_path, None)
            .expect("failed to start transcript watcher");
        assert_eq!(status, TranscriptStartStatus::Started);

        let handle = WatcherHandle::new_for_test(transcript_state.clone(), sid.clone());
        let watcher_state = AgentWatcherState::new();
        watcher_state.insert(sid.clone(), handle, AgentType::ClaudeCode);

        assert!(
            transcript_state.contains(&sid),
            "transcript should be tracked before remove"
        );

        watcher_state.remove(&sid);

        assert!(
            !transcript_state.contains(&sid),
            "transcript should be stopped after handle drop"
        );
    }
}
