//! Git repository watcher for file system changes
//!
//! Watches git repositories for file system changes and emits Tauri events
//! when the working tree is modified. Uses the `notify` crate for cross-platform
//! file system notifications and the `ignore` crate to respect `.gitignore` rules.
//!
//! Key features:
//! - Per-repository subscriber refcounting (multiple tabs can watch the same repo)
//! - Pre-repo handling (watching a directory that becomes a repo after `git init`)
//! - Auto-upgrade from pre-repo to repo state when `.git/` appears
//! - Event fan-out (all subscribers to a repo get notified on one change)
//! - 300ms debounce to avoid redundant processing
//! - 10s polling fallback for systems where inotify/FSEvents is unreliable

use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use ignore::WalkBuilder;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use super::validate_cwd;
#[cfg(not(test))]
use crate::runtime::BackendState;
use crate::runtime::EventSink;

/// Debounce interval — emit after filesystem events have been quiet for 300ms.
const DEBOUNCE_MS: u64 = 300;

/// Polling fallback interval — check for changes every 10 seconds
const POLL_INTERVAL_SECS: u64 = 10;

/// Outer-loop poll interval for the debounce thread — bounds the latency
/// from `stop_flag` being set to thread exit when idle (no burst in
/// flight). 100 ms is roughly one Linux scheduler quantum: tight enough
/// to feel instant, loose enough to avoid burning CPU on a thread that
/// only matters when filesystem events arrive.
const IDLE_CHECK_MS: u64 = 100;

/// Timeout for sync git subprocesses called from the polling thread.
/// Guards against hangs on NFS/FUSE, stale `.git/index.lock`, or corrupted
/// packs. `Command::output()` without this would block the polling thread
/// for the lifetime of the hung child; the stop signal is only checked at the
/// poll boundary, so a thread parked inside `output()` never reaches it and
/// leaks along with every `Arc` it holds.
const SYNC_GIT_TIMEOUT: Duration = Duration::from_secs(10);

/// Interruptible stop signal for polling threads.
struct WatcherStopSignal {
    stopped: AtomicBool,
    wait_lock: Mutex<()>,
    wait_condvar: Condvar,
}

impl WatcherStopSignal {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            stopped: AtomicBool::new(false),
            wait_lock: Mutex::new(()),
            wait_condvar: Condvar::new(),
        })
    }

    fn stop(&self) {
        {
            let _guard = self.wait_lock.lock().expect("failed to lock stop signal");
            self.stopped.store(true, Ordering::Release);
        }
        self.wait_condvar.notify_all();
    }

    fn wait_timeout(&self, timeout: Duration) -> bool {
        if self.stopped.load(Ordering::Acquire) {
            return true;
        }

        let guard = self.wait_lock.lock().expect("failed to lock stop signal");
        let _guard = self
            .wait_condvar
            .wait_timeout_while(guard, timeout, |_| !self.stopped.load(Ordering::Acquire))
            .expect("failed to wait on stop signal")
            .0;

        self.stopped.load(Ordering::Acquire)
    }

    #[cfg(test)]
    fn wait_timeout_for_test(&self, timeout: Duration, waiter_ready: &AtomicBool) -> bool {
        if self.stopped.load(Ordering::Acquire) {
            return true;
        }

        let guard = self.wait_lock.lock().expect("failed to lock stop signal");
        // Test-only readiness marker. It is set while `wait_lock` is held:
        // once the test observes it, `stop()` cannot set `stopped` until this
        // thread releases the lock into the condvar wait.
        waiter_ready.store(true, Ordering::Release);
        let _guard = self
            .wait_condvar
            .wait_timeout_while(guard, timeout, |_| !self.stopped.load(Ordering::Acquire))
            .expect("failed to wait on stop signal")
            .0;

        self.stopped.load(Ordering::Acquire)
    }
}

fn is_notify_not_found(error: &notify::Error) -> bool {
    matches!(error.kind, notify::ErrorKind::PathNotFound)
        || matches!(
            &error.kind,
            notify::ErrorKind::Io(e) if e.kind() == std::io::ErrorKind::NotFound
        )
}

/// Returns the burst-event Sender plus a completion flag that flips to
/// `true` exactly when the spawned thread exits (any path: stop_flag
/// outer break, stop_flag inner break, Disconnected, panic-via-DropGuard).
/// Production callers drop the flag and rely on `stop_flag` for shutdown;
/// tests use the flag to observe prompt-exit semantics directly, instead
/// of inferring exit timing from a side-channel like emit-suppression
/// (which is independently guaranteed by the Timeout arm and therefore
/// can't distinguish an Ok-arm regression from a Timeout-arm guard).
fn spawn_trailing_debounce_thread<F>(
    stop_flag: Arc<AtomicBool>,
    delay: Duration,
    mut emit: F,
) -> (std::sync::mpsc::Sender<()>, Arc<AtomicBool>)
where
    F: FnMut() + Send + 'static,
{
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    let completed = Arc::new(AtomicBool::new(false));
    let completed_for_thread = Arc::clone(&completed);

    std::thread::spawn(move || {
        // Drop guard fires on every exit path including panics, so the
        // completion flag tracks "thread really gone" rather than "thread
        // chose to exit cleanly". Tests reading the flag get the strict
        // contract; production callers ignoring it pay nothing extra.
        struct CompletionGuard(Arc<AtomicBool>);
        impl Drop for CompletionGuard {
            fn drop(&mut self) {
                self.0.store(true, Ordering::Release);
            }
        }
        let _completion_guard = CompletionGuard(completed_for_thread);

        while !stop_flag.load(Ordering::Relaxed) {
            match rx.recv_timeout(Duration::from_millis(IDLE_CHECK_MS)) {
                Ok(()) => loop {
                    match rx.recv_timeout(delay) {
                        Ok(()) => {
                            // Honor stop_flag inside the inner burst-drain
                            // loop too. Without this, a continuous event
                            // burst keeps the thread alive until either the
                            // burst ends OR every Sender clone drops — and
                            // the clone held by the notify-watcher closure
                            // (behind Arc<Mutex<RecommendedWatcher>>) only
                            // disconnects when the polling thread also
                            // exits, which can be up to POLL_INTERVAL_SECS
                            // (10s) later. Checking here lets the thread
                            // (and its captured Arcs) drop promptly.
                            if stop_flag.load(Ordering::Relaxed) {
                                return;
                            }
                            continue;
                        }
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                            if !stop_flag.load(Ordering::Relaxed) {
                                emit();
                            }
                            break;
                        }
                        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
                    }
                },
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
            }
        }
    });

    (tx, completed)
}

/// Run a `std::process::Command` synchronously with a deadline. On timeout,
/// kill the child and return an error. Used from the polling thread (which
/// lives in `std::thread::spawn`, NOT a tokio task, so `run_git_with_timeout`
/// from `mod.rs` — which is async — isn't directly callable here without
/// an owned runtime handle). The busy-wait loop polls every 50ms; at 10s
/// timeout that's ~200 polls max, cheap compared to the subprocess itself.
fn run_sync_with_timeout(
    mut cmd: std::process::Command,
    timeout: Duration,
) -> Result<std::process::Output, String> {
    use std::process::Stdio;

    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn failed: {}", e))?;

    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                // Exited — drain stdio and return the full Output.
                return child
                    .wait_with_output()
                    .map_err(|e| format!("wait_with_output failed: {}", e));
            }
            Ok(None) => {
                if start.elapsed() > timeout {
                    // Kill and reap so we don't leak a zombie.
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("git command timed out after {:?}", timeout));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => {
                // Mirror the timeout-arm cleanup: a `try_wait` error can
                // leave the child running (EINTR) or as a zombie. Without
                // this the subprocess + its piped stdout/stderr fds leak
                // until process exit, which accumulates under rapid
                // repo-switch workloads where the polling thread hits
                // this path repeatedly.
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("try_wait failed: {}", e));
            }
        }
    }
}

/// Handle to a running watcher for a git repository
struct RepoWatcher {
    /// Map from **input** cwd string (exactly what the frontend passed) to
    /// refcount. Multiple subscribers can watch the same repo from different
    /// subdirectories; each subscription increments its own entry's count.
    ///
    /// Keyed on the raw input string (not canonicalized) so the event payload
    /// the frontend receives matches the cwd it subscribed with. The
    /// canonical form is used only to find the correct `repo_watchers`
    /// bucket (the outer map) — dedup of "same repo via different strings"
    /// happens at the watcher level, not at the subscriber level.
    subscribers: HashMap<String, u32>,

    /// The notify watcher instance. Wrapped in `Arc<Mutex<_>>` so the
    /// polling thread can dynamically register newly-created directories
    /// as `NonRecursive` watches (non-recursive inotify does NOT extend
    /// into directories created after startup).
    _watcher: Arc<Mutex<RecommendedWatcher>>,

    /// Set of directories currently registered with the notify watcher.
    /// The polling thread diffs this against the current `ignore`-filtered
    /// walk and registers any additions. Shared with the polling thread.
    _watched_dirs: Arc<Mutex<HashSet<PathBuf>>>,

    /// Signals the trailing debounce thread to exit
    stop_flag: Arc<AtomicBool>,

    /// Wakes and signals the polling fallback thread to exit
    poll_stop_signal: Arc<WatcherStopSignal>,

    /// Hash of the last-seen `git status --porcelain=v1 -z` output.
    /// Changes on any staging/unstaging/edit/delete/add — everything that
    /// would cause a panel row to change. The HEAD-only comparison in the
    /// previous revision missed staging ops and plain file edits because
    /// HEAD only moves on commit/checkout. The active reader is the
    /// polling thread; this field roots the Arc.
    _last_status_hash: Arc<Mutex<Option<u64>>>,
}

/// Handle to a pre-repo watcher (watching a directory that is not yet a git repo)
struct PreRepoWatcher {
    /// Map from **original** frontend cwd string → refcount. Same
    /// shape as `RepoWatcher.subscribers` so the pre-repo → repo
    /// upgrade path can transfer identities without re-canonicalizing.
    /// Key is the exact string the frontend passed to
    /// `start_git_watcher` — that's what its event listener matches on.
    subscribers: HashMap<String, u32>,

    /// Signals the polling thread to exit
    stop_signal: Arc<WatcherStopSignal>,
}

impl Drop for RepoWatcher {
    fn drop(&mut self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        self.poll_stop_signal.stop();
    }
}

impl Drop for PreRepoWatcher {
    fn drop(&mut self) {
        self.stop_signal.stop();
    }
}

/// Thread-safe state for managing git watchers
#[derive(Default, Clone)]
pub struct GitWatcherState {
    /// Watchers for actual git repositories, keyed by canonical toplevel path
    repo_watchers: Arc<Mutex<HashMap<PathBuf, RepoWatcher>>>,

    /// Watchers for directories that are not yet repos (but might become one),
    /// keyed by canonical input cwd
    pre_repo_watchers: Arc<Mutex<HashMap<PathBuf, PreRepoWatcher>>>,

    /// Side-map: frontend's original cwd string → canonical repo toplevel.
    /// Populated on every successful `start_git_watcher_inner` repo-path
    /// insertion; consumed by `stop_git_watcher_inner` to find the right
    /// `repo_watchers` bucket without re-running `rev-parse --show-toplevel`
    /// at stop time.
    ///
    /// Without this map, a session that starts with `.git` present and stops
    /// after `.git` is removed (e.g. agent running `rm -rf .git`, force-reset,
    /// `git filter-repo` rewrite) would leak its RepoWatcher: the stop-time
    /// `resolve_toplevel` would fail, the repo-bucket lookup would be
    /// skipped, and the polling thread (kept alive by the un-removed
    /// RepoWatcher) would keep firing `hash_git_status` forever.
    cwd_to_toplevel: Arc<Mutex<HashMap<String, PathBuf>>>,

    /// Side-map: frontend's original cwd string → canonicalized PathBuf
    /// for **pre-repo** entries. Same role as `cwd_to_toplevel` but for
    /// the non-repo path: populated by `start_pre_repo_watcher_inner`,
    /// consumed by `stop_git_watcher_inner` to find the `pre_repo_watchers`
    /// bucket without re-running `validate_cwd`.
    ///
    /// Without this, a session watching a non-repo directory whose path
    /// is then deleted (agent runs `rm -rf` on its working dir) would leak
    /// its PreRepoWatcher: stop-time `validate_cwd` fails on `canonicalize`,
    /// the early-return fires, and the polling thread runs forever.
    cwd_to_safe_pre_repo: Arc<Mutex<HashMap<String, PathBuf>>>,
}

impl GitWatcherState {
    /// Create a new empty watcher state
    pub fn new() -> Self {
        Self::default()
    }
}

/// Payload emitted when git status changes
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitStatusChangedPayload {
    /// List of input cwds that should refresh
    pub(crate) cwds: Vec<String>,
}

/// Resolve the git toplevel for a given cwd. Uses `run_sync_with_timeout`
/// so a hung `git rev-parse` (NFS stall, `.git/index.lock` held by a
/// crashed process, etc.) can't park the polling thread forever.
fn resolve_toplevel(cwd: &std::path::Path) -> Result<PathBuf, String> {
    let mut cmd = std::process::Command::new("git");
    cmd.arg("-C")
        .arg(cwd)
        .arg("rev-parse")
        .arg("--show-toplevel")
        .env("GIT_TERMINAL_PROMPT", "0");

    let output = run_sync_with_timeout(cmd, SYNC_GIT_TIMEOUT)?;

    if !output.status.success() {
        return Err("Not a git repository".to_string());
    }

    let toplevel_str = String::from_utf8_lossy(&output.stdout);
    let toplevel = toplevel_str.trim();

    Ok(PathBuf::from(toplevel))
}

/// Hash the current `git status --porcelain=v1 -z --untracked-files=all`
/// output.
///
/// Used by the polling fallback as the change-detection signal. Unlike
/// HEAD-only comparison (which only moves on commit/checkout), this
/// captures every state that affects the Files Changed panel: staging,
/// unstaging, editing tracked files, creating/deleting untracked files,
/// etc. Returns the hash so the poller can cheaply detect "any change".
fn hash_git_status(toplevel: &Path) -> Result<u64, String> {
    let mut cmd = std::process::Command::new("git");
    cmd.arg("-C")
        .arg(toplevel)
        .arg("status")
        .arg("--porcelain=v1")
        .arg("--untracked-files=all")
        .arg("-z")
        .env("GIT_TERMINAL_PROMPT", "0");

    // Timed-out sync call — same reasoning as `resolve_toplevel`.
    let output = run_sync_with_timeout(cmd, SYNC_GIT_TIMEOUT)?;

    if !output.status.success() {
        return Err("git status failed".to_string());
    }

    let mut hasher = DefaultHasher::new();
    output.stdout.hash(&mut hasher);
    Ok(hasher.finish())
}

/// Enumerate non-ignored directories in a git repository using ignore::WalkBuilder.
///
/// Explicitly excludes the `.git/` directory and everything under it. The
/// `ignore` crate respects `.gitignore` patterns, but `.git/` is NOT a
/// gitignore entry — git itself treats it as opaque metadata. Without this
/// filter the walker descends into `.git/objects/`, `.git/refs/`, `.git/logs/`,
/// etc., and every directory there gets passed to `watcher.watch()`. That's
/// bad on two axes:
///   1. Every `git commit`, `git fetch`, `git rebase`, etc. updates
///      `.git/refs/` and `.git/logs/`, firing spurious `git-status-changed`
///      events through the debounce.
///   2. The 10s polling thread re-enumerates dirs and registers newly-
///      observed ones. As loose objects accumulate in `.git/objects/XX/`,
///      inotify watch descriptors accumulate until `max_user_watches` is
///      exhausted.
///
/// The explicit `.git/index` and `.git/HEAD` additions in
/// `start_git_watcher_inner` (which DO need to be watched so staging /
/// commits fire events) are the ONLY `.git/*` paths that should end up
/// registered with notify.
fn enumerate_dirs(toplevel: &std::path::Path) -> Vec<PathBuf> {
    use std::ffi::OsStr;

    let mut dirs = vec![];

    let walker = WalkBuilder::new(toplevel)
        .follow_links(false)
        .filter_entry(|e| e.file_name() != OsStr::new(".git"))
        .build();

    for entry in walker.flatten() {
        if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
            dirs.push(entry.path().to_path_buf());
        }
    }

    dirs
}

/// Start watching a git repository
///
/// If `cwd` is a subdirectory of a repo, resolves to the toplevel and adds
/// the input cwd as a subscriber. Multiple calls with different subdirs of
/// the same repo increment the refcount.
#[cfg(not(test))]
#[tauri::command]
pub async fn start_git_watcher(
    cwd: String,
    state: tauri::State<'_, std::sync::Arc<BackendState>>,
) -> Result<(), String> {
    state.start_git_watcher(cwd).await
}

pub(crate) async fn start_git_watcher_backend(
    cwd: String,
    events: Arc<dyn EventSink>,
    state: GitWatcherState,
) -> Result<(), String> {
    // The inner helper runs blocking `std::process::Command` calls
    // (rev-parse, git status) and constructs `notify` watchers that do
    // their own filesystem I/O. Running that work directly on the async
    // runtime would tie up a Tokio worker thread for the full duration
    // of the setup — harmful on the bounded Tauri IPC pool. Hop onto the
    // blocking pool via `spawn_blocking` so the async thread returns
    // immediately and the sync inner can take as long as it needs.
    tokio::task::spawn_blocking(move || start_git_watcher_inner(&cwd, events, &state))
        .await
        .map_err(|e| format!("start_git_watcher task panicked: {}", e))?
}

/// Synchronous core of `start_git_watcher`. Called by both the Tauri command and
/// the pre-repo upgrade path — works against a cloneable `&GitWatcherState` so it
/// doesn't require a `tauri::State` handle.
fn start_git_watcher_inner(
    cwd: &str,
    events: Arc<dyn EventSink>,
    state: &GitWatcherState,
) -> Result<(), String> {
    let safe_cwd = validate_cwd(cwd)?;

    // Opportunistically clear any stale pre-repo side-map entry for this
    // cwd. If we're transitioning from pre-repo to repo (called via
    // `upgrade_to_repo_watcher`, or just a re-subscription after `git init`),
    // the old `cwd_to_safe_pre_repo` mapping is now obsolete. Leaving it
    // would just be a tiny memory leak — stop_git_watcher_inner consults
    // `cwd_to_toplevel` first so the stale entry can't cause incorrect
    // routing — but tidiness wins.
    // Capture the prior pre-repo mapping (if any) but do NOT clean up
    // `pre_repo_watchers` yet. The decision depends on which branch of
    // `resolve_toplevel` we take below:
    //   - repo-transition (Ok): also remove cwd from pre_repo_watchers,
    //     dropping the bucket if empty. This is the stranded-subscriber
    //     transition the round-3 finding asked about.
    //   - still-pre-repo (Err): leave the pre_repo_watchers entry alone
    //     so `start_pre_repo_watcher_inner` below can see and increment
    //     its existing refcount instead of clobbering it to 1.
    let prior_pre_repo_safe_cwd = {
        let mut pre_repo_map = state
            .cwd_to_safe_pre_repo
            .lock()
            .expect("failed to lock cwd_to_safe_pre_repo");
        pre_repo_map.remove(cwd)
    };

    // Try to resolve repo toplevel
    let toplevel = match resolve_toplevel(&safe_cwd) {
        Ok(tl) => {
            let canonical = validate_cwd(&tl.to_string_lossy())?;
            canonical
        }
        Err(_) => {
            // Not a repo yet — start pre-repo watcher.
            // Pass both the frontend's original cwd string AND the
            // canonicalized PathBuf: the string becomes the subscriber
            // identity (so events match the listener's exact-string
            // filter), the PathBuf is the map key (so two calls for
            // the same dir via different spellings share one poll
            // thread).
            return start_pre_repo_watcher_inner(cwd, safe_cwd, events, state);
        }
    };

    // Repo-transition path. Only NOW can we safely clean up the prior
    // `pre_repo_watchers` entry for this cwd: the subscriber is moving
    // from pre-repo to repo, so any leftover subscriber row under the
    // old safe_cwd would never be reached again (stop_git_watcher
    // routes via `cwd_to_toplevel` once we register below). Doing this
    // BEFORE `resolve_toplevel` would have been wrong for the still-
    // pre-repo re-subscription case, where `start_pre_repo_watcher_inner`
    // needs the existing refcount to bump rather than recreate from 1
    // (caught by codex verify in v1 of this round as a HIGH issue —
    // refcount loss on duplicate pre-repo subscriptions).
    if let Some(old_safe_cwd) = prior_pre_repo_safe_cwd {
        let mut pre_repo_watchers = state
            .pre_repo_watchers
            .lock()
            .expect("failed to lock pre_repo_watchers");
        if let Some(watcher) = pre_repo_watchers.get_mut(&old_safe_cwd) {
            watcher.subscribers.remove(cwd);
            if watcher.subscribers.is_empty() {
                pre_repo_watchers.remove(&old_safe_cwd);
            }
        }
    }

    // ── Phase 1: short check under lock A ─────────────────────────────
    //
    // Only check whether a watcher already exists for this toplevel. The
    // expensive setup work (`hash_git_status`, notify watcher creation,
    // `enumerate_dirs` filesystem walk, polling-thread spawn) used to run
    // while this lock was held — up to 10s under NFS/FUSE stalls or held
    // `.git/index.lock`s — blocking the notify callback's
    // `emit_for_all_subscribers` (which also locks `repo_watchers`) for
    // every other repo's events. Phase 2 below builds all that state
    // lock-free; phase 3 re-acquires A only for the final
    // check-then-insert.
    //
    // While holding A here, ALSO insert into `cwd_to_toplevel` (lock B).
    // `stop_git_watcher_inner` always releases B before acquiring A, so
    // start holding A→B simultaneously is deadlock-free. Without the A+B
    // overlap, a concurrent stop could slip in between A's release and
    // B's acquire and miss the watcher (TOCTOU leak).
    {
        let mut repo_watchers = state
            .repo_watchers
            .lock()
            .map_err(|e| format!("Failed to lock repo_watchers: {}", e))?;

        if let Some(watcher) = repo_watchers.get_mut(&toplevel) {
            *watcher.subscribers.entry(cwd.to_string()).or_insert(0) += 1;
            state
                .cwd_to_toplevel
                .lock()
                .expect("failed to lock cwd_to_toplevel")
                .insert(cwd.to_string(), toplevel.clone());
            drop(repo_watchers);
            emit_git_status_changed(&events, vec![cwd.to_string()]);
            return Ok(());
        }
    }

    // ── Phase 2: build watcher state OUTSIDE locks ────────────────────
    let state_clone = state.clone();
    let last_status_hash = Arc::new(Mutex::new(hash_git_status(&toplevel).ok()));
    let stop_flag = Arc::new(AtomicBool::new(false));
    let poll_stop_signal = WatcherStopSignal::new();
    let debounce_tx = {
        let events = events.clone();
        let state = state_clone.clone();
        let toplevel = toplevel.clone();
        let stop_flag = stop_flag.clone();

        // Production callers ignore the completion flag — `stop_flag` plus
        // the Drop semantics of the captured Arcs are enough for shutdown.
        // The flag exists to give tests a way to observe prompt exit
        // without inferring it from emit-suppression side-channels.
        let (tx, _completed) = spawn_trailing_debounce_thread(
            stop_flag,
            Duration::from_millis(DEBOUNCE_MS),
            move || emit_for_all_subscribers(&events, &state, &toplevel),
        );
        tx
    };

    // Create notify watcher
    let notify_watcher = {
        let toplevel = toplevel.clone();
        let debounce_tx = debounce_tx.clone();

        notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
            let event = match res {
                Ok(ev) => ev,
                Err(e) => {
                    log::error!("Watcher error for {}: {}", toplevel.display(), e);
                    return;
                }
            };

            // Accept Modify, Create, AND Remove. Deletes and untracked-file
            // removals change git status too; filtering them out stranded
            // those workflows on the 10s polling fallback even when notify
            // was otherwise healthy.
            let relevant = matches!(
                event.kind,
                EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)
            );
            if !relevant {
                return;
            }

            if debounce_tx.send(()).is_err() {
                log::debug!(
                    "Git watcher debounce thread stopped for {}",
                    toplevel.display()
                );
            }
        })
        .map_err(|e| format!("Failed to create watcher: {}", e))?
    };

    // Wrap the watcher in Arc<Mutex<_>> so the polling thread can
    // dynamically register newly-created directories. NonRecursive inotify
    // does NOT extend into subdirs created after startup, so without this
    // a new feature folder would become invisible to notify.
    let watcher_arc = Arc::new(Mutex::new(notify_watcher));
    let watched_dirs: Arc<Mutex<HashSet<PathBuf>>> = Arc::new(Mutex::new(HashSet::new()));

    // Register initial watches for all non-ignored directories, tracking
    // them in `watched_dirs` so the poller's dir-diff knows what's new.
    {
        let mut watcher_guard = watcher_arc.lock().expect("failed to lock watcher");
        let mut dirs_guard = watched_dirs.lock().expect("failed to lock watched_dirs");

        for dir in enumerate_dirs(&toplevel) {
            if let Err(e) = watcher_guard.watch(&dir, RecursiveMode::NonRecursive) {
                log::warn!("Failed to watch {}: {}", dir.display(), e);
                continue;
            }
            dirs_guard.insert(dir);
        }

        // Also watch .git/index and .git/HEAD (non-recursive — never recurse
        // into .git/ because .git/objects/ would explode the watch count).
        let git_index = toplevel.join(".git/index");
        if git_index.exists() {
            if let Err(e) = watcher_guard.watch(&git_index, RecursiveMode::NonRecursive) {
                log::warn!("Failed to watch .git/index: {}", e);
            }
        }

        let git_head = toplevel.join(".git/HEAD");
        if git_head.exists() {
            if let Err(e) = watcher_guard.watch(&git_head, RecursiveMode::NonRecursive) {
                log::warn!("Failed to watch .git/HEAD: {}", e);
            }
        }
    }

    // Start polling fallback thread with two jobs on the same 10s tick:
    //   (1) Change detection — hashes `git status --porcelain=v1 -z`
    //       output. Unlike HEAD-only comparison, this catches every
    //       panel-visible change: staging, unstaging, editing tracked
    //       files, creating/deleting untracked files.
    //   (2) Dynamic dir registration — re-enumerates non-ignored dirs and
    //       registers any not yet watched. Compensates for non-recursive
    //       inotify's inability to extend into post-startup directories.
    let poll_toplevel = toplevel.clone();
    let poll_events = events.clone();
    let poll_state = state_clone.clone();
    let poll_thread_stop_signal = poll_stop_signal.clone();
    let poll_last_status_hash = last_status_hash.clone();
    let poll_watcher = watcher_arc.clone();
    let poll_watched_dirs = watched_dirs.clone();

    std::thread::spawn(move || {
        loop {
            if poll_thread_stop_signal.wait_timeout(Duration::from_secs(POLL_INTERVAL_SECS)) {
                break;
            }

            // (1) Change detection via status hash.
            if let Ok(current_hash) = hash_git_status(&poll_toplevel) {
                let changed = {
                    let mut last = poll_last_status_hash
                        .lock()
                        .expect("failed to lock last_status_hash");
                    let changed = last.map_or(true, |h| h != current_hash);
                    if changed {
                        *last = Some(current_hash);
                    }
                    changed
                };
                if changed {
                    emit_for_all_subscribers(&poll_events, &poll_state, &poll_toplevel);
                }
            }

            // (2) Register any newly-created non-ignored directories.
            let new_dirs: Vec<PathBuf> = {
                let current = enumerate_dirs(&poll_toplevel);
                let watched = poll_watched_dirs
                    .lock()
                    .expect("failed to lock watched_dirs");
                current
                    .into_iter()
                    .filter(|d| !watched.contains(d))
                    .collect()
            };

            if !new_dirs.is_empty() {
                let mut watcher_guard = poll_watcher.lock().expect("failed to lock watcher");
                let mut dirs_guard = poll_watched_dirs
                    .lock()
                    .expect("failed to lock watched_dirs");
                for dir in new_dirs {
                    match watcher_guard.watch(&dir, RecursiveMode::NonRecursive) {
                        Ok(()) => {
                            dirs_guard.insert(dir);
                        }
                        Err(e) if is_notify_not_found(&e) => {
                            log::debug!(
                                "New git watcher dir vanished before registration: {}",
                                dir.display()
                            );
                        }
                        Err(e) => {
                            log::warn!("Failed to watch new dir {}: {}", dir.display(), e);
                        }
                    }
                }
            }
        }
    });

    // Build the locally-owned RepoWatcher with its initial subscriber.
    let mut subscribers = HashMap::new();
    subscribers.insert(cwd.to_string(), 1);

    let repo_watcher = RepoWatcher {
        subscribers,
        _watcher: watcher_arc,
        _watched_dirs: watched_dirs,
        stop_flag,
        poll_stop_signal,
        _last_status_hash: last_status_hash,
    };

    // ── Phase 3: re-check and insert under lock A ─────────────────────
    //
    // Re-acquire `repo_watchers` to publish the new watcher. The brief
    // hold here covers two cases:
    //   (a) Another thread inserted a watcher for the same toplevel
    //       between phase 1 and now (TOCTOU race). We discard our
    //       locally-built `repo_watcher` — its `Drop` stops the debounce
    //       thread and wakes our just-spawned polling thread so it exits
    //       cleanly. Then we bump the existing watcher's
    //       refcount as if we were a phase-1 hit.
    //   (b) Common case: no race; insert the new watcher.
    //
    // `cwd_to_toplevel.insert` happens while lock A is still held, same
    // reasoning as phase 1 — closes the TOCTOU window where a concurrent
    // stop could read empty B, then read empty A, and silently leak the
    // watcher.
    {
        let mut repo_watchers = state
            .repo_watchers
            .lock()
            .map_err(|e| format!("Failed to lock repo_watchers: {}", e))?;

        if let Some(existing) = repo_watchers.get_mut(&toplevel) {
            // Race: someone else won. Bump THEIR subscribers; our local
            // `repo_watcher` will be dropped when this scope ends,
            // which stops its debounce and polling threads.
            *existing.subscribers.entry(cwd.to_string()).or_insert(0) += 1;
            state
                .cwd_to_toplevel
                .lock()
                .expect("failed to lock cwd_to_toplevel")
                .insert(cwd.to_string(), toplevel.clone());
            drop(repo_watchers);
            // `repo_watcher` (local) drops here.
            emit_git_status_changed(&events, vec![cwd.to_string()]);
            return Ok(());
        }

        repo_watchers.insert(toplevel.clone(), repo_watcher);
        state
            .cwd_to_toplevel
            .lock()
            .expect("failed to lock cwd_to_toplevel")
            .insert(cwd.to_string(), toplevel);
        drop(repo_watchers);
    }

    // Emit initial event using the frontend's original cwd string.
    emit_git_status_changed(&events, vec![cwd.to_string()]);

    Ok(())
}

/// Start a pre-repo watcher (for directories that are not yet git repos).
///
/// Takes both the frontend's original `cwd` string (subscriber identity,
/// used in event payloads) and the canonicalized `safe_cwd` PathBuf (map
/// key, used for dedup when multiple callers watch the same dir via
/// different spellings).
fn start_pre_repo_watcher_inner(
    cwd: &str,
    safe_cwd: PathBuf,
    events: Arc<dyn EventSink>,
    state: &GitWatcherState,
) -> Result<(), String> {
    let mut pre_repo_watchers = state
        .pre_repo_watchers
        .lock()
        .map_err(|e| format!("Failed to lock pre_repo_watchers: {}", e))?;

    if let Some(watcher) = pre_repo_watchers.get_mut(&safe_cwd) {
        // Pre-repo watcher exists — add this subscription. Same cwd
        // string bumps its refcount; a new cwd string (e.g. a different
        // symlink spelling of the same canonical path) becomes a new
        // subscriber entry. Either way, this subscriber receives events
        // under its own original string.
        *watcher.subscribers.entry(cwd.to_string()).or_insert(0) += 1;

        // Record cwd → safe_cwd in the side-map so stop_git_watcher_inner
        // can find this bucket without re-running validate_cwd at stop time
        // (which fails if the directory has since been deleted).
        state
            .cwd_to_safe_pre_repo
            .lock()
            .expect("failed to lock cwd_to_safe_pre_repo")
            .insert(cwd.to_string(), safe_cwd.clone());

        emit_git_status_changed(&events, vec![cwd.to_string()]);

        return Ok(());
    }

    // Create new pre-repo watcher with polling
    let stop_signal = WatcherStopSignal::new();
    spawn_pre_repo_poll_thread(
        safe_cwd.clone(),
        events.clone(),
        state.clone(),
        stop_signal.clone(),
    );

    let mut subscribers = HashMap::new();
    subscribers.insert(cwd.to_string(), 1);

    let pre_repo_watcher = PreRepoWatcher {
        subscribers,
        stop_signal,
    };

    pre_repo_watchers.insert(safe_cwd.clone(), pre_repo_watcher);

    // Record cwd → safe_cwd in the side-map (see field doc on
    // GitWatcherState.cwd_to_safe_pre_repo).
    state
        .cwd_to_safe_pre_repo
        .lock()
        .expect("failed to lock cwd_to_safe_pre_repo")
        .insert(cwd.to_string(), safe_cwd);

    // Emit initial event with the frontend's original cwd string
    emit_git_status_changed(&events, vec![cwd.to_string()]);

    Ok(())
}

fn spawn_pre_repo_poll_thread(
    safe_cwd: PathBuf,
    events: Arc<dyn EventSink>,
    state: GitWatcherState,
    stop_signal: Arc<WatcherStopSignal>,
) {
    std::thread::spawn(move || {
        loop {
            if stop_signal.wait_timeout(Duration::from_secs(POLL_INTERVAL_SECS)) {
                break;
            }

            // Check if this became a repo
            if resolve_toplevel(&safe_cwd).is_ok() {
                // Upgrade to repo watcher — transfers the subscriber map
                // (with original cwd strings intact) into repo_watchers.
                if let Err(e) =
                    upgrade_to_repo_watcher(safe_cwd.clone(), events.clone(), state.clone())
                {
                    log::error!("Failed to upgrade to repo watcher: {}", e);
                }
                break;
            }

            // Still not a repo — intentionally NO emit on this tick.
            // The previous revision fired `git-status-changed` on every
            // 10-second tick for every pre-repo subscriber, which caused
            // the frontend to run a useless `git_status` round-trip that
            // always returns []. Subscribers already hold the correct
            // empty state from their initial fetch; nothing to refresh
            // until the dir becomes a repo (upgrade path emits its own
            // initial event).
        }
    });
}

fn restore_pre_repo_subscribers(
    safe_cwd: PathBuf,
    subscribers: HashMap<String, u32>,
    events: Arc<dyn EventSink>,
    state: &GitWatcherState,
) -> Result<(), String> {
    if subscribers.is_empty() {
        return Ok(());
    }

    let subscriber_cwds: Vec<String> = subscribers.keys().cloned().collect();
    // Allocated lazily — only the no-existing-watcher branch needs a
    // fresh stop signal. Hoisting before the lock would silently drop
    // an Arc on the existing-watcher branch, leaving a dead allocation
    // that confuses readers auditing the watcher lifecycle (which
    // stop signal governs which thread?).
    let mut new_watcher_stop_signal: Option<Arc<WatcherStopSignal>> = None;

    {
        let mut pre_repo_watchers = state
            .pre_repo_watchers
            .lock()
            .map_err(|e| format!("Failed to lock pre_repo_watchers: {}", e))?;

        if let Some(watcher) = pre_repo_watchers.get_mut(&safe_cwd) {
            for (cwd, refcount) in subscribers {
                *watcher.subscribers.entry(cwd).or_insert(0) += refcount;
            }
        } else {
            let stop_signal = WatcherStopSignal::new();
            pre_repo_watchers.insert(
                safe_cwd.clone(),
                PreRepoWatcher {
                    subscribers,
                    stop_signal: stop_signal.clone(),
                },
            );
            new_watcher_stop_signal = Some(stop_signal);
        }
    }

    {
        let mut map = state
            .cwd_to_safe_pre_repo
            .lock()
            .map_err(|e| format!("Failed to lock cwd_to_safe_pre_repo: {}", e))?;
        for cwd in &subscriber_cwds {
            map.insert(cwd.clone(), safe_cwd.clone());
        }
    }

    if let Some(stop_signal) = new_watcher_stop_signal {
        // Guard against a known infinite-retry trap: `restore_pre_repo_subscribers`
        // is called *after* `upgrade_to_repo_watcher` succeeded for at least one
        // subscriber on `safe_cwd`, which means `safe_cwd` is already a git
        // repository. Spawning a poll thread that re-runs `resolve_toplevel(&safe_cwd)`
        // every 10 s would immediately succeed, re-fire `upgrade_to_repo_watcher`,
        // fail again for the same permanently-invalid subscriber paths, restore
        // again, and loop forever. Detect the case here and treat the failed
        // subscribers as terminally stranded — keep their pre-repo entry as a
        // record (so refcount accounting stays consistent) but don't poll.
        if resolve_toplevel(&safe_cwd).is_ok() {
            log::warn!(
                "git watcher: subscribers {:?} could not upgrade against repo {:?}; \
                 paths are not reachable inside the repo and will not be polled \
                 (the parent path is already a repo, so a poll thread would \
                 re-fire the failed upgrade indefinitely).",
                subscriber_cwds,
                safe_cwd,
            );
        } else {
            spawn_pre_repo_poll_thread(safe_cwd, events.clone(), state.clone(), stop_signal);
        }
    }

    emit_git_status_changed(&events, subscriber_cwds);

    Ok(())
}

/// Upgrade a pre-repo watcher to a full repo watcher.
///
/// Removes the pre-repo entry, then re-invokes the repo-watcher bootstrap
/// for each of its subscribers using their ORIGINAL cwd string so the
/// subscriber-identity (and thus event-matching) is preserved across
/// the upgrade. Previously this used `cwd.to_string_lossy()` (the
/// canonical form), stranding any frontend that had subscribed with a
/// symlinked or non-canonical path.
fn upgrade_to_repo_watcher(
    safe_cwd: PathBuf,
    events: Arc<dyn EventSink>,
    state: GitWatcherState,
) -> Result<(), String> {
    // Collect the subscribers (original-cwd → refcount) from the pre-repo
    // entry and drop it.
    let subscribers: HashMap<String, u32> = {
        let mut pre_repo_watchers = state
            .pre_repo_watchers
            .lock()
            .map_err(|e| format!("Failed to lock pre_repo_watchers: {}", e))?;

        if let Some(mut watcher) = pre_repo_watchers.remove(&safe_cwd) {
            // `PreRepoWatcher` impls `Drop` (sets stop_signal), so we can't
            // move `subscribers` out by field. `mem::take` swaps it with
            // HashMap::default() (empty map), which is fine because the
            // watcher is about to be dropped anyway.
            std::mem::take(&mut watcher.subscribers)
        } else {
            return Err("Pre-repo watcher not found".to_string());
        }
    };

    // Start a proper repo watcher once per subscribed original-cwd string,
    // bumping the refcount the same number of times it had in the pre-repo
    // entry. This keeps every subscriber's identity intact across the
    // upgrade — the Files Changed panel continues receiving events on the
    // exact string it subscribed with, so its exact-string filter matches.
    //
    // Collect errors instead of bailing on the first failure. The previous
    // revision used `?`, which meant one bad subscriber (e.g. cwd deleted
    // between pre-repo registration and upgrade) stranded every subsequent
    // subscriber: the pre-repo entry was already removed, so subsequent
    // stops would silent-no-op and the frontend panel would go permanently
    // stale with no surfaced error. Per-subscriber errors are now
    // accumulated; each surviving subscriber still gets its repo watcher,
    // and failed subscribers are restored to a pre-repo watcher so they keep
    // a backend subscription and retry path.
    let mut errors: Vec<String> = Vec::new();
    // Counts only per-subscriber upgrade failures from the loop below —
    // distinct from `errors.len()`, which may also accumulate restore-path
    // failures (state-machine-level lock poisoning) that are NOT
    // subscriber failures. The error-format string uses this counter so
    // the human-facing "N subscriber(s) failed to upgrade" message
    // reflects subscriber failures only.
    let mut subscriber_failures: usize = 0;
    let mut failed_subscribers: HashMap<String, u32> = HashMap::new();
    for (original_cwd, refcount) in subscribers {
        if refcount == 0 {
            continue;
        }

        if let Err(e) = start_git_watcher_inner(&original_cwd, events.clone(), &state) {
            errors.push(format!("{}: {}", original_cwd, e));
            failed_subscribers.insert(original_cwd, refcount);
            subscriber_failures += 1;
            continue;
        }

        // `start_git_watcher_inner` emits an initial refresh event on every
        // call. During a pre-repo -> repo upgrade, a refcount > 1 means
        // duplicate subscriptions for the SAME original cwd, not distinct
        // listeners that need separate bootstrap events. Start once, then
        // restore the remaining count directly under the repo watcher so
        // the frontend receives one initial event instead of N.
        if refcount > 1 {
            let toplevel = state
                .cwd_to_toplevel
                .lock()
                .map_err(|e| format!("Failed to lock cwd_to_toplevel: {}", e))?
                .get(&original_cwd)
                .cloned();

            match toplevel {
                Some(toplevel) => {
                    let mut repo_watchers = state
                        .repo_watchers
                        .lock()
                        .map_err(|e| format!("Failed to lock repo_watchers: {}", e))?;
                    if let Some(watcher) = repo_watchers.get_mut(&toplevel) {
                        *watcher.subscribers.entry(original_cwd.clone()).or_insert(0) +=
                            refcount - 1;
                    } else {
                        errors.push(format!(
                            "{}: repo watcher missing after successful upgrade",
                            original_cwd
                        ));
                    }
                }
                None => errors.push(format!(
                    "{}: toplevel mapping missing after successful upgrade",
                    original_cwd
                )),
            }
        }
    }

    if let Err(e) =
        restore_pre_repo_subscribers(safe_cwd, failed_subscribers, events.clone(), &state)
    {
        errors.push(format!("failed to restore failed subscribers: {}", e));
    }

    if errors.is_empty() {
        Ok(())
    } else {
        // Use the dedicated counter for the headline so the message
        // matches reality: only `subscriber_failures` are upgrade
        // failures whose subscribers need a retry. Other items in
        // `errors` (post-upgrade state inconsistencies, restore-path
        // failures) are surfaced in the trailing `errors.join("; ")`
        // body but don't inflate the headline count.
        Err(format!(
            "upgrade_to_repo_watcher: {} subscriber(s) failed to upgrade ({} total error(s)): {}",
            subscriber_failures,
            errors.len(),
            errors.join("; ")
        ))
    }
}

/// Stop watching a git repository
#[cfg(not(test))]
#[tauri::command]
pub async fn stop_git_watcher(
    cwd: String,
    state: tauri::State<'_, std::sync::Arc<BackendState>>,
) -> Result<(), String> {
    state.stop_git_watcher(cwd).await
}

pub(crate) async fn stop_git_watcher_backend(
    cwd: String,
    state: GitWatcherState,
) -> Result<(), String> {
    // Same rationale as `start_git_watcher`: `validate_cwd` and
    // `resolve_toplevel` both spawn sync subprocess calls; hop to the
    // blocking pool so the async runtime isn't pinned while they run.
    tokio::task::spawn_blocking(move || stop_git_watcher_inner(cwd, state))
        .await
        .map_err(|e| format!("stop_git_watcher task panicked: {}", e))?
}

/// Synchronous core of `stop_git_watcher`. Owns its state clone so it can
/// be called from the blocking pool.
fn stop_git_watcher_inner(cwd: String, state: GitWatcherState) -> Result<(), String> {
    // First: look up the repo-toplevel from the side-map populated by
    // `start_git_watcher_inner`. This is critical — re-running
    // `resolve_toplevel(&safe_cwd)` at stop time would fail if `.git`
    // was removed mid-session (agent ran `rm -rf .git`, force-reset,
    // `git filter-repo` etc.), silently skipping the repo-watcher
    // removal and leaking the polling thread. Using the recorded
    // mapping is correct even when the repo no longer resolves.
    let recorded_toplevel: Option<PathBuf> = {
        let mut map = state
            .cwd_to_toplevel
            .lock()
            .map_err(|e| format!("Failed to lock cwd_to_toplevel: {}", e))?;
        // `remove` here is optimistic: if the later repo-watcher lookup
        // finds nothing, we've also cleaned up the side-map so a future
        // idempotent stop is a pure no-op. If we stopped the watcher
        // successfully, the map entry is no longer needed either.
        map.remove(&cwd)
    };

    if let Some(canonical) = recorded_toplevel {
        let mut repo_watchers = state
            .repo_watchers
            .lock()
            .map_err(|e| format!("Failed to lock repo_watchers: {}", e))?;

        if let Some(watcher) = repo_watchers.get_mut(&canonical) {
            if let Some(count) = watcher.subscribers.get_mut(&cwd) {
                *count = count.saturating_sub(1);

                if *count == 0 {
                    watcher.subscribers.remove(&cwd);
                }
            }

            // If no more subscribers, remove the watcher (its Drop fires
            // the stop_signal, which wakes the polling thread).
            if watcher.subscribers.is_empty() {
                repo_watchers.remove(&canonical);
            }

            return Ok(());
        }
        // Recorded mapping but no watcher — fall through (possible if
        // upgrade/teardown race removed the watcher but not the map
        // entry; the map-removal above already cleaned up).
    }

    // No recorded toplevel → pre-repo watcher path. Look up the canonical
    // PathBuf from the pre-repo side-map first. Falls back to live
    // `validate_cwd` only if the side-map has no record (defensive — covers
    // pre-existing watchers from before this side-map existed in long-
    // running sessions, though there shouldn't be any in practice).
    //
    // The side-map removal here is symmetric with `cwd_to_toplevel.remove`
    // above: it cleans up the map regardless of whether we successfully
    // stop the watcher, so a future idempotent stop is a pure no-op.
    let recorded_pre_repo: Option<PathBuf> = {
        let mut map = state
            .cwd_to_safe_pre_repo
            .lock()
            .map_err(|e| format!("Failed to lock cwd_to_safe_pre_repo: {}", e))?;
        map.remove(&cwd)
    };

    let safe_cwd = match recorded_pre_repo {
        Some(p) => p,
        None => {
            // No recorded mapping. Try live validation as a last resort;
            // if even that fails (cwd no longer exists), there's truly
            // nothing we can do from here and idempotent-stop is correct.
            let Ok(p) = validate_cwd(&cwd) else {
                return Ok(());
            };
            p
        }
    };

    let mut pre_repo_watchers = state
        .pre_repo_watchers
        .lock()
        .map_err(|e| format!("Failed to lock pre_repo_watchers: {}", e))?;

    if let Some(watcher) = pre_repo_watchers.get_mut(&safe_cwd) {
        if let Some(count) = watcher.subscribers.get_mut(&cwd) {
            *count = count.saturating_sub(1);

            if *count == 0 {
                watcher.subscribers.remove(&cwd);
            }
        }

        if watcher.subscribers.is_empty() {
            pre_repo_watchers.remove(&safe_cwd);
        }

        return Ok(());
    }

    // Watcher not found — this is ok (idempotent stop)
    Ok(())
}

/// Emit git-status-changed event for all subscribers of a repo
fn emit_for_all_subscribers(
    events: &Arc<dyn EventSink>,
    state: &GitWatcherState,
    toplevel: &std::path::Path,
) {
    let cwds: Vec<String> = {
        let repo_watchers = state
            .repo_watchers
            .lock()
            .expect("failed to lock repo_watchers");

        if let Some(watcher) = repo_watchers.get(toplevel) {
            // Subscriber keys are the frontend's original cwd strings — emit
            // them as-is so listener's `event.cwds.includes(myCwd)` matches.
            watcher.subscribers.keys().cloned().collect()
        } else {
            vec![]
        }
    };

    if !cwds.is_empty() {
        emit_git_status_changed(events, cwds);
    }
}

/// Emit a git-status-changed event
fn emit_git_status_changed(events: &Arc<dyn EventSink>, cwds: Vec<String>) {
    if let Err(e) = events.emit_git_status_changed(cwds) {
        log::error!("Failed to emit git-status-changed: {}", e);
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_helpers::{configure_test_git, home_tempdir};
    use super::*;
    use crate::runtime::FakeEventSink;
    use std::fs;
    use std::process::Command;
    use std::sync::{mpsc, Arc};
    use tempfile::TempDir;

    /// Create a temp git repo for testing
    fn create_temp_repo() -> TempDir {
        let temp = home_tempdir();

        Command::new("git")
            .args(["init"])
            .current_dir(temp.path())
            .output()
            .expect("failed to run git init");

        configure_test_git(temp.path());

        temp
    }

    #[test]
    fn watcher_stop_signal_wakes_timeout_waiter() {
        let signal = WatcherStopSignal::new();
        let waiter_signal = signal.clone();
        let waiter_ready = Arc::new(AtomicBool::new(false));
        let waiter_ready_for_thread = waiter_ready.clone();
        let waiter = std::thread::spawn(move || {
            waiter_signal.wait_timeout_for_test(Duration::from_secs(2), &waiter_ready_for_thread)
        });

        let wait_deadline = Instant::now() + Duration::from_secs(1);
        while !waiter_ready.load(Ordering::Acquire) {
            assert!(
                Instant::now() < wait_deadline,
                "waiter should enter the condvar wait"
            );
            std::thread::yield_now();
        }
        let wait_started_at = Instant::now();
        signal.stop();

        assert!(waiter.join().expect("waiter thread should not panic"));
        assert!(
            wait_started_at.elapsed() < Duration::from_secs(1),
            "stop should wake waiter before the timeout elapses"
        );
    }

    #[test]
    fn upgrade_to_repo_watcher_emits_once_for_duplicate_original_cwd() {
        let sink = FakeEventSink::new();

        let temp = create_temp_repo();
        let cwd = temp.path().to_string_lossy().to_string();
        let safe_cwd = validate_cwd(&cwd).expect("cwd should validate");
        let state = GitWatcherState::new();
        let mut subscribers = HashMap::new();

        subscribers.insert(cwd.clone(), 3);
        state
            .pre_repo_watchers
            .lock()
            .expect("failed to lock pre_repo_watchers")
            .insert(
                safe_cwd.clone(),
                PreRepoWatcher {
                    subscribers,
                    stop_signal: WatcherStopSignal::new(),
                },
            );

        let result = upgrade_to_repo_watcher(safe_cwd, sink.clone(), state.clone());

        assert!(result.is_ok(), "upgrade should succeed: {:?}", result.err());

        let toplevel = resolve_toplevel(temp.path()).expect("repo should resolve");
        let toplevel_key =
            validate_cwd(&toplevel.to_string_lossy()).expect("toplevel should validate");
        let repo_watchers = state
            .repo_watchers
            .lock()
            .expect("failed to lock repo_watchers");
        let watcher = repo_watchers
            .get(&toplevel_key)
            .expect("repo watcher should exist");

        assert_eq!(watcher.subscribers.get(&cwd), Some(&3));
        drop(repo_watchers);

        let events = sink.recorded();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0, "git-status-changed");
        assert_eq!(
            events[0].1["cwds"].as_array().expect("cwds array")[0].as_str(),
            Some(cwd.as_str())
        );
    }

    #[test]
    fn upgrade_to_repo_watcher_restores_failed_subscribers_for_retry() {
        let sink = FakeEventSink::new();

        let temp = create_temp_repo();
        let cwd = temp.path().to_string_lossy().to_string();
        let missing_cwd = temp.path().join("missing").to_string_lossy().to_string();
        let safe_cwd = validate_cwd(&cwd).expect("cwd should validate");
        let state = GitWatcherState::new();
        let mut subscribers = HashMap::new();

        subscribers.insert(missing_cwd.clone(), 1);
        subscribers.insert(cwd.clone(), 2);
        state
            .pre_repo_watchers
            .lock()
            .expect("failed to lock pre_repo_watchers")
            .insert(
                safe_cwd.clone(),
                PreRepoWatcher {
                    subscribers,
                    stop_signal: WatcherStopSignal::new(),
                },
            );

        let result = upgrade_to_repo_watcher(safe_cwd.clone(), sink.clone(), state.clone());

        assert!(result.is_err(), "missing subscriber should fail upgrade");

        let toplevel = resolve_toplevel(temp.path()).expect("repo should resolve");
        let toplevel_key =
            validate_cwd(&toplevel.to_string_lossy()).expect("toplevel should validate");
        let repo_watchers = state
            .repo_watchers
            .lock()
            .expect("failed to lock repo_watchers");
        let watcher = repo_watchers
            .get(&toplevel_key)
            .expect("valid subscriber should upgrade to repo watcher");

        assert_eq!(watcher.subscribers.get(&cwd), Some(&2));
        drop(repo_watchers);

        let pre_repo_watchers = state
            .pre_repo_watchers
            .lock()
            .expect("failed to lock pre_repo_watchers");
        let restored = pre_repo_watchers
            .get(&safe_cwd)
            .expect("failed subscriber should be restored to pre-repo watcher");

        assert_eq!(restored.subscribers.get(&missing_cwd), Some(&1));
        assert!(!restored.subscribers.contains_key(&cwd));
        drop(pre_repo_watchers);

        let safe_pre_repo = state
            .cwd_to_safe_pre_repo
            .lock()
            .expect("failed to lock cwd_to_safe_pre_repo");

        assert_eq!(safe_pre_repo.get(&missing_cwd), Some(&safe_cwd));
        drop(safe_pre_repo);

        let found = sink.recorded().iter().any(|(event, payload)| {
            event == "git-status-changed" && payload["cwds"].to_string().contains(&missing_cwd)
        });
        assert!(
            found,
            "expected git-status-changed emit for restored subscriber {missing_cwd:?}"
        );
    }

    #[test]
    fn notify_not_found_classifier_matches_path_not_found() {
        let error = notify::Error::path_not_found();

        assert!(is_notify_not_found(&error));
    }

    #[test]
    fn notify_not_found_classifier_matches_io_not_found() {
        let error = notify::Error::io(std::io::Error::new(std::io::ErrorKind::NotFound, "gone"));

        assert!(is_notify_not_found(&error));
    }

    #[test]
    fn notify_not_found_classifier_rejects_other_errors() {
        let error = notify::Error::new(notify::ErrorKind::MaxFilesWatch);

        assert!(!is_notify_not_found(&error));
    }

    #[test]
    fn trailing_debounce_emits_once_after_final_burst_event() {
        // Margins doubled (debounce 60→120ms, sleep 20→30ms) so the test
        // tolerates ~60ms scheduler jitter on loaded CI runners. The 60ms
        // / 35ms previous margin sat at roughly one Linux scheduler quantum
        // and produced spurious failures when sleep(20ms) overshot 60ms,
        // splitting the burst into separate windows.
        let stop_flag = Arc::new(AtomicBool::new(false));
        let (emitted_tx, emitted_rx) = mpsc::channel::<()>();
        let (debounce_tx, _completed) = spawn_trailing_debounce_thread(
            stop_flag.clone(),
            Duration::from_millis(120),
            move || {
                // Swallow send errors: if the receiver was dropped first
                // (test cleanup ordering), .expect would panic in the
                // detached thread and silently swallow the panic. The
                // positive `recv_timeout(...).expect("debounce should emit")`
                // assertion below is the canonical failure signal.
                let _ = emitted_tx.send(());
            },
        );

        debounce_tx.send(()).expect("failed to send first event");
        std::thread::sleep(Duration::from_millis(30));
        debounce_tx.send(()).expect("failed to send second event");
        std::thread::sleep(Duration::from_millis(30));
        debounce_tx.send(()).expect("failed to send third event");

        assert!(
            emitted_rx.recv_timeout(Duration::from_millis(50)).is_err(),
            "debounce emitted before the burst went quiet"
        );

        emitted_rx
            .recv_timeout(Duration::from_millis(400))
            .expect("debounce should emit after quiet period");
        assert!(
            emitted_rx.recv_timeout(Duration::from_millis(150)).is_err(),
            "burst should produce exactly one trailing emit"
        );

        stop_flag.store(true, Ordering::Relaxed);
        drop(debounce_tx);
    }

    #[test]
    fn trailing_debounce_inner_loop_breaks_on_stop_flag_during_active_burst() {
        // Round-3 rewrite. The round-2 version asserted "no emit fires"
        // — but emit suppression is independently guaranteed by the
        // Timeout arm's own stop_flag guard, so the test couldn't
        // distinguish an Ok-arm regression from the Timeout-arm guard.
        // Round-3 observes the contract directly: the spawn function
        // exposes a `completed` Arc<AtomicBool> set in a Drop guard at
        // thread exit; the test asserts it flips within
        // `IDLE_CHECK_MS + delay + margin` of stop_flag being raised
        // while a burst is still being fed. If the Ok-arm check
        // regresses, the inner loop drives the thread past every
        // `recv_timeout(delay)` of the burst, and `completed` doesn't
        // flip until the burst dries up — which the assertion catches.
        let stop_flag = Arc::new(AtomicBool::new(false));
        let (emitted_tx, _emitted_rx) = mpsc::channel::<()>();
        let (debounce_tx, completed) = spawn_trailing_debounce_thread(
            stop_flag.clone(),
            // Use a longer delay (250ms) so the difference between
            // "Ok-arm bails immediately" and "Ok-arm regressed and waits
            // for inner timeout / Disconnected" is observable: a 250ms
            // delay × 5 events × scheduler jitter would push a regressed
            // thread past 1s, well outside the 200ms assertion window.
            Duration::from_millis(250),
            move || {
                let _ = emitted_tx.send(());
            },
        );

        // Kick off the burst — first event enters the inner Ok() loop.
        debounce_tx.send(()).expect("failed to send burst event 1");
        std::thread::sleep(Duration::from_millis(20));
        // Mid-burst flip.
        stop_flag.store(true, Ordering::Relaxed);
        // Keep feeding events so the inner loop keeps re-entering Ok().
        // Each iteration MUST observe stop_flag and `return`; otherwise
        // the inner `recv_timeout(250ms)` waits the full delay between
        // events, postponing thread exit far beyond our assertion window.
        for _ in 0..5 {
            // Sender side: ignore errors — the thread may exit between
            // sends, dropping its rx, in which case send() returns Err.
            let _ = debounce_tx.send(());
            std::thread::sleep(Duration::from_millis(20));
        }

        // Wait briefly for the thread to exit. If the Ok-arm stop_flag
        // check is in place, the thread returns within IDLE_CHECK_MS
        // of stop_flag being raised. We add a generous margin (200ms)
        // to absorb scheduler jitter, well below the regressed-path's
        // expected lower bound (5×20ms send pacing + 250ms delay = ~350ms
        // minimum to exhaust the burst, longer under load).
        let deadline = std::time::Instant::now() + Duration::from_millis(200);
        while std::time::Instant::now() < deadline {
            if completed.load(Ordering::Acquire) {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }

        assert!(
            completed.load(Ordering::Acquire),
            "thread must exit promptly via the Ok-arm stop_flag check; \
             still alive after IDLE_CHECK_MS + 200ms margin (the \
             regressed-path lower bound is delay×N events ≈ 350ms+)"
        );

        drop(debounce_tx);
    }

    #[test]
    fn test_resolve_toplevel() {
        let temp = create_temp_repo();
        let toplevel = resolve_toplevel(temp.path()).expect("failed to resolve toplevel");

        // Normalize paths for comparison
        let expected = fs::canonicalize(temp.path()).expect("failed to canonicalize");
        let actual = fs::canonicalize(&toplevel).expect("failed to canonicalize");

        assert_eq!(actual, expected);
    }

    #[test]
    fn test_resolve_toplevel_subdir() {
        let temp = create_temp_repo();
        let subdir = temp.path().join("src");
        fs::create_dir(&subdir).expect("failed to create subdir");

        let toplevel = resolve_toplevel(&subdir).expect("failed to resolve toplevel");

        let expected = fs::canonicalize(temp.path()).expect("failed to canonicalize");
        let actual = fs::canonicalize(&toplevel).expect("failed to canonicalize");

        assert_eq!(actual, expected);
    }

    #[test]
    fn test_resolve_toplevel_non_repo() {
        let temp = TempDir::new().expect("failed to create temp dir");
        let result = resolve_toplevel(temp.path());

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Not a git repository"));
    }

    #[test]
    fn test_enumerate_dirs() {
        let temp = create_temp_repo();

        // Create some directories
        fs::create_dir(temp.path().join("src")).expect("failed to create src");
        fs::create_dir(temp.path().join("src/components")).expect("failed to create components");
        fs::create_dir(temp.path().join("tests")).expect("failed to create tests");

        // Create .gitignore to ignore a directory
        fs::write(temp.path().join(".gitignore"), "ignored/\n")
            .expect("failed to write .gitignore");
        fs::create_dir(temp.path().join("ignored")).expect("failed to create ignored");

        let dirs = enumerate_dirs(temp.path());

        // Should include root, src, src/components, tests, but NOT ignored
        let dir_names: Vec<_> = dirs
            .iter()
            .map(|p| p.file_name().and_then(|n| n.to_str()).unwrap_or(""))
            .collect();

        assert!(dirs.iter().any(|p| p == temp.path()), "should include root");
        assert!(dir_names.contains(&"src"), "should include src");
        assert!(
            dir_names.contains(&"components"),
            "should include components"
        );
        assert!(dir_names.contains(&"tests"), "should include tests");
        assert!(
            !dir_names.contains(&"ignored"),
            "should NOT include ignored"
        );
        // Regression guard for the .git/ exclusion — without `.filter_entry`
        // on the WalkBuilder, enumerate_dirs would recurse into `.git/`
        // and its subdirs (objects/, refs/, logs/ etc.), causing spurious
        // notify events and steady inotify FD growth.
        assert!(
            !dir_names.contains(&".git"),
            "should NOT include .git directory"
        );
        assert!(
            !dirs
                .iter()
                .any(|p| p.components().any(|c| c.as_os_str() == ".git")),
            "should NOT include any path under .git/"
        );
    }

    #[test]
    fn test_hash_git_status_detects_changes() {
        // Regression test for F1 (HIGH): the polling fallback must detect
        // any change that affects `git status`, not just HEAD movement.
        // Hash must differ after staging, after editing tracked files,
        // and after creating untracked files.
        let temp = create_temp_repo();
        let repo = temp.path();

        // Empty repo: hash is stable across two consecutive calls
        let h0 = hash_git_status(repo).expect("h0 failed");
        let h0_again = hash_git_status(repo).expect("h0_again failed");
        assert_eq!(h0, h0_again, "idempotent when nothing changed");

        // Create an untracked file — hash must change (HEAD didn't move)
        fs::write(repo.join("untracked.txt"), "hello\n").expect("write failed");
        let h1 = hash_git_status(repo).expect("h1 failed");
        assert_ne!(h1, h0, "hash must change when untracked file is created");

        // Stage the file — hash must change again (HEAD still didn't move)
        Command::new("git")
            .args(["add", "untracked.txt"])
            .current_dir(repo)
            .output()
            .expect("git add failed");
        let h2 = hash_git_status(repo).expect("h2 failed");
        assert_ne!(
            h2, h1,
            "hash must change when file is staged (previous HEAD-only poll missed this)"
        );

        // Commit — HEAD moves, working tree becomes clean
        Command::new("git")
            .args(["commit", "-m", "initial"])
            .current_dir(repo)
            .output()
            .expect("git commit failed");
        let h3 = hash_git_status(repo).expect("h3 failed");
        assert_ne!(h3, h2, "hash must change after commit (clean status now)");

        // Modify the committed file — hash must change
        fs::write(repo.join("untracked.txt"), "hello\nworld\n").expect("write failed");
        let h4 = hash_git_status(repo).expect("h4 failed");
        assert_ne!(
            h4, h3,
            "hash must change when a tracked file is edited (previous HEAD-only poll missed this)"
        );
    }

    #[test]
    fn test_hash_git_status_detects_second_file_inside_existing_untracked_directory() {
        // Regression test: without `--untracked-files=all`, Git collapses an
        // untracked directory to `?? dir/`, so adding another file under that
        // same directory does NOT change the status output hash.
        let temp = create_temp_repo();
        let repo = temp.path();

        let dir = repo.join(".vimeflow").join("sessions").join("abc");
        fs::create_dir_all(&dir).expect("mkdir failed");
        fs::write(dir.join("bashrc"), "hello\n").expect("write failed");
        let h1 = hash_git_status(repo).expect("h1 failed");

        fs::write(dir.join("init.sh"), "#!/usr/bin/env bash\n").expect("write failed");
        let h2 = hash_git_status(repo).expect("h2 failed");

        assert_ne!(
            h2, h1,
            "hash must change when another untracked file appears inside an existing untracked directory"
        );
    }
}
