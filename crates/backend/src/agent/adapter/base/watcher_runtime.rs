//! File watcher runtime for agent status sources.
//!
//! Watches adapter-provided status files for changes and emits backend events
//! when they update. Uses the `notify` crate plus a polling fallback for
//! environments where file-system notifications are unreliable.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;
use std::time::Instant;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use super::super::bindings::AgentBindings;
#[cfg(debug_assertions)]
use super::diagnostics::short_sid;
use super::diagnostics::{record_event_diag, EventTiming, PathHistory, TxOutcome};
use super::transcript_state::{TranscriptStartStatus, TranscriptState};
// `TranscriptPathValidator` is referenced as `Arc<dyn TranscriptPathValidator>`
// in `maybe_start_transcript`'s signature, so it must be in scope. `StateDecoder`
// is consumed only via method dispatch on `Arc<dyn StateDecoder>` (vtable), so
// it does not need to appear here. PR #261 cycle 2 review F9 — clarified
// that the previous blanket `#[allow(unused_imports)]` on both traits was
// only load-bearing for one (validator).
use super::super::traits::TranscriptPathValidator;
use crate::agent::adapter::types::{
    stamp_snapshot, LocatedStatusSource, RawPath, TranscriptPathSource, ValidateTranscriptError,
};
use crate::agent::adapter::AgentAdapter;
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
        let _ = self.transcript_state.stop(&self.session_id);
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

/// Thread-safe state for managing active agent watchers per session
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
    /// Scope the lock guard to a nested block so the evicted
    /// `WatcherHandle` (if any) drops AFTER the watchers mutex is
    /// released. `WatcherHandle::Drop` joins the polling thread, which
    /// can sleep up to 3 seconds — holding the mutex across that wait
    /// would block any concurrent `insert` / `remove` / `active_count`
    /// for the same duration. Same fix that was already in
    /// `TranscriptState::stop` (Claude review on PR #152, F7).
    pub fn insert(&self, session_id: String, handle: WatcherHandle) {
        let _displaced = {
            let mut watchers = self.watchers.lock().expect("failed to lock watchers");
            watchers.insert(session_id, handle)
        };
        // `_displaced: Option<WatcherHandle>` drops here, after the
        // guard above is gone. If non-None, its `Drop` joins the poll
        // thread without holding the mutex.
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
    pub(super) fn active_count(&self) -> usize {
        let watchers = self.watchers.lock().expect("failed to lock watchers");
        watchers.len()
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
    adapter_for_transcript_state: &Arc<dyn AgentAdapter>,
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

    // Step B': `TranscriptState::start_or_replace` still takes an
    // `Arc<dyn AgentAdapter>` until B'' migrates it onto
    // `Arc<dyn TranscriptStreamer>`. We hand over the same façade
    // adapter the bindings carry — the two paths agree by
    // construction (`AgentBindings::for_attach` builds both views
    // from the same underlying struct).
    match transcript_state.start_or_replace(
        adapter_for_transcript_state.clone(),
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
pub(super) fn start_watching(
    bindings: AgentBindings,
    events: Arc<dyn EventSink>,
    pty_state: PtyState,
    transcript_state: TranscriptState,
    session_id: String,
    located: LocatedStatusSource,
) -> Result<WatcherHandle, String> {
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
    // Three `AgentBindings` fields are intentionally NOT destructured
    // here and drop with the function-local move (PR #261 cycle 8
    // review F24 — `#[allow(dead_code)]` silences these, so the
    // omission is intentional and listed explicitly so the B''
    // reviewer can audit the migration without re-deriving why):
    //
    // - `bindings.locator` — already used by `start_for` before this
    //   function runs (it borrowed `&bindings.locator` to call
    //   `locate(...)` and produce the `LocatedStatusSource` passed in
    //   as `located`). The `Arc` itself wasn't consumed there — it
    //   stayed alive on `bindings` and drops with this function-local
    //   move now (PR #261 cycle 11 review F32 — earlier comment
    //   said "consumed" but the locator was only borrowed). The
    //   watcher itself doesn't need the locator again.
    // - `bindings.streamer` — reserved for B'' which migrates
    //   `TranscriptState::start_or_replace` onto
    //   `Arc<dyn TranscriptStreamer>`. B'' MUST consume
    //   `bindings.streamer` directly (not construct a fresh
    //   `Arc<dyn TranscriptStreamer>` at the call site), because for
    //   the Codex arm `bindings.streamer` and
    //   `bindings.adapter_for_transcript_state` are clones of the
    //   SAME `Arc<CodexAdapter>` — which holds the shared
    //   `Arc<CompositeLocator>` from cycle 11 F31. Constructing a
    //   fresh adapter at the B'' call site would re-introduce the
    //   double-locator hazard cycle 11 closed. B'' will extract this
    //   field AND remove `adapter_for_transcript_state` in the same
    //   step. The compiler currently can't catch a B'' that forgets
    //   to extract `streamer` because the field is silenced;
    //   compensate by keeping this comment as the human-readable
    //   migration checkpoint (PR #261 cycle 13 review F36).
    // - `bindings.agent_type` — diagnostics-only; the watcher
    //   doesn't branch on it (each adapter's split-trait impls
    //   carry their own behavior).
    let decoder = bindings.decoder;
    let validator = bindings.validator;
    let transcript_paths = bindings.transcript_paths;
    let adapter_for_transcript_state = bindings.adapter_for_transcript_state;

    let notify_timing_for_cb = notify_timing.clone();
    let path_history_for_cb = path_history.clone();
    let decoder_for_cb = decoder.clone();
    let validator_for_cb = validator.clone();
    let transcript_paths_for_cb = transcript_paths.clone();
    let adapter_for_transcript_state_cb = adapter_for_transcript_state.clone();
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
                            &adapter_for_transcript_state_cb,
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
        let initial_adapter_for_transcript_state = adapter_for_transcript_state.clone();
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
                                &initial_adapter_for_transcript_state,
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
        let poll_adapter_for_transcript_state = adapter_for_transcript_state.clone();
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
                                    &poll_adapter_for_transcript_state,
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
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
