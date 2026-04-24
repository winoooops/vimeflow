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
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use ignore::WalkBuilder;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::Emitter;

use super::validate_cwd;

/// Debounce interval — ignore events within 300ms of the last processed one
const DEBOUNCE_MS: u64 = 300;

/// Polling fallback interval — check for changes every 10 seconds
const POLL_INTERVAL_SECS: u64 = 10;

/// Timeout for sync git subprocesses called from the polling thread.
/// Guards against hangs on NFS/FUSE, stale `.git/index.lock`, or corrupted
/// packs. `Command::output()` without this would block the polling thread
/// for the lifetime of the hung child; the stop_flag is only read at the
/// loop head, so a thread parked inside `output()` never reaches it and
/// leaks along with every `Arc` it holds.
const SYNC_GIT_TIMEOUT: Duration = Duration::from_secs(10);

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
            Err(e) => return Err(format!("try_wait failed: {}", e)),
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

    /// Signals the polling fallback thread to exit
    stop_flag: Arc<AtomicBool>,

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
    stop_flag: Arc<AtomicBool>,
}

impl Drop for RepoWatcher {
    fn drop(&mut self) {
        self.stop_flag.store(true, Ordering::Relaxed);
    }
}

impl Drop for PreRepoWatcher {
    fn drop(&mut self) {
        self.stop_flag.store(true, Ordering::Relaxed);
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
struct GitStatusChangedPayload {
    /// List of input cwds that should refresh
    cwds: Vec<String>,
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

/// Hash the current `git status --porcelain=v1 -z` output.
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

/// Enumerate non-ignored directories in a git repository using ignore::WalkBuilder
fn enumerate_dirs(toplevel: &std::path::Path) -> Vec<PathBuf> {
    let mut dirs = vec![];

    let walker = WalkBuilder::new(toplevel)
        .follow_links(false)
        .build();

    for entry in walker {
        if let Ok(entry) = entry {
            if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                dirs.push(entry.path().to_path_buf());
            }
        }
    }

    dirs
}

/// Start watching a git repository
///
/// If `cwd` is a subdirectory of a repo, resolves to the toplevel and adds
/// the input cwd as a subscriber. Multiple calls with different subdirs of
/// the same repo increment the refcount.
#[tauri::command]
pub async fn start_git_watcher(
    cwd: String,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, GitWatcherState>,
) -> Result<(), String> {
    // The inner helper runs blocking `std::process::Command` calls
    // (rev-parse, git status) and constructs `notify` watchers that do
    // their own filesystem I/O. Running that work directly on the async
    // runtime would tie up a Tokio worker thread for the full duration
    // of the setup — harmful on the bounded Tauri IPC pool. Hop onto the
    // blocking pool via `spawn_blocking` so the async thread returns
    // immediately and the sync inner can take as long as it needs.
    let owned_state = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        start_git_watcher_inner(&cwd, app_handle, &owned_state)
    })
    .await
    .map_err(|e| format!("start_git_watcher task panicked: {}", e))?
}

/// Synchronous core of `start_git_watcher`. Called by both the Tauri command and
/// the pre-repo upgrade path — works against a cloneable `&GitWatcherState` so it
/// doesn't require a `tauri::State` handle.
fn start_git_watcher_inner(
    cwd: &str,
    app_handle: tauri::AppHandle,
    state: &GitWatcherState,
) -> Result<(), String> {
    let safe_cwd = validate_cwd(cwd)?;

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
            return start_pre_repo_watcher_inner(cwd, safe_cwd, app_handle, state);
        }
    };

    let mut repo_watchers = state.repo_watchers.lock()
        .map_err(|e| format!("Failed to lock repo_watchers: {}", e))?;

    if let Some(watcher) = repo_watchers.get_mut(&toplevel) {
        // Watcher exists — increment refcount keyed on the ORIGINAL cwd
        // string (NOT the canonical form) so later event fan-out emits
        // the exact string the frontend subscribed with. Two frontend
        // strings that canonicalize to the same path still get separate
        // subscriber entries — they share the notify watcher but each
        // receives events matching its own input.
        *watcher.subscribers.entry(cwd.to_string()).or_insert(0) += 1;

        // Record the cwd → toplevel mapping so stop_git_watcher_inner can
        // find this bucket without re-running `rev-parse` at stop time.
        state
            .cwd_to_toplevel
            .lock()
            .expect("failed to lock cwd_to_toplevel")
            .insert(cwd.to_string(), toplevel.clone());

        // Emit initial event using the frontend's original cwd string.
        emit_git_status_changed(&app_handle, vec![cwd.to_string()]);

        return Ok(());
    }

    // Create new watcher
    let state_clone = state.clone();
    let last_status_hash = Arc::new(Mutex::new(
        hash_git_status(&toplevel).ok(),
    ));
    let last_processed = Arc::new(Mutex::new(Instant::now()));
    let stop_flag = Arc::new(AtomicBool::new(false));

    // Create notify watcher
    let notify_watcher = {
        let toplevel = toplevel.clone();
        let app_handle = app_handle.clone();
        let state = state_clone.clone();
        let last_processed = last_processed.clone();

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

            // Debounce
            {
                let mut last = last_processed.lock().expect("failed to lock last_processed");
                let now = Instant::now();
                if now.duration_since(*last) < Duration::from_millis(DEBOUNCE_MS) {
                    return;
                }
                *last = now;
            }

            // Emit event for all subscribers
            emit_for_all_subscribers(&app_handle, &state, &toplevel);
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
    let poll_app_handle = app_handle.clone();
    let poll_state = state_clone.clone();
    let poll_stop_flag = stop_flag.clone();
    let poll_last_status_hash = last_status_hash.clone();
    let poll_watcher = watcher_arc.clone();
    let poll_watched_dirs = watched_dirs.clone();

    std::thread::spawn(move || {
        while !poll_stop_flag.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_secs(POLL_INTERVAL_SECS));

            if poll_stop_flag.load(Ordering::Relaxed) {
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
                    emit_for_all_subscribers(&poll_app_handle, &poll_state, &poll_toplevel);
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
                    if let Err(e) = watcher_guard.watch(&dir, RecursiveMode::NonRecursive) {
                        log::warn!("Failed to watch new dir {}: {}", dir.display(), e);
                        continue;
                    }
                    dirs_guard.insert(dir);
                }
            }
        }
    });

    // Insert watcher with initial subscriber (keyed on original cwd string)
    let mut subscribers = HashMap::new();
    subscribers.insert(cwd.to_string(), 1);

    let repo_watcher = RepoWatcher {
        subscribers,
        _watcher: watcher_arc,
        _watched_dirs: watched_dirs,
        stop_flag,
        _last_status_hash: last_status_hash,
    };

    repo_watchers.insert(toplevel.clone(), repo_watcher);

    // Record cwd → toplevel mapping (see cwd_to_toplevel doc comment).
    // Drop the repo_watchers guard before acquiring the side-map lock to
    // avoid needlessly widening the lock scope.
    drop(repo_watchers);
    state
        .cwd_to_toplevel
        .lock()
        .expect("failed to lock cwd_to_toplevel")
        .insert(cwd.to_string(), toplevel);

    // Emit initial event using the frontend's original cwd string
    emit_git_status_changed(&app_handle, vec![cwd.to_string()]);

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
    app_handle: tauri::AppHandle,
    state: &GitWatcherState,
) -> Result<(), String> {
    let mut pre_repo_watchers = state.pre_repo_watchers.lock()
        .map_err(|e| format!("Failed to lock pre_repo_watchers: {}", e))?;

    if let Some(watcher) = pre_repo_watchers.get_mut(&safe_cwd) {
        // Pre-repo watcher exists — add this subscription. Same cwd
        // string bumps its refcount; a new cwd string (e.g. a different
        // symlink spelling of the same canonical path) becomes a new
        // subscriber entry. Either way, this subscriber receives events
        // under its own original string.
        *watcher.subscribers.entry(cwd.to_string()).or_insert(0) += 1;

        emit_git_status_changed(&app_handle, vec![cwd.to_string()]);

        return Ok(());
    }

    // Create new pre-repo watcher with polling
    let stop_flag = Arc::new(AtomicBool::new(false));
    let poll_safe_cwd = safe_cwd.clone();
    let poll_app_handle = app_handle.clone();
    let poll_state = state.clone();
    let poll_stop_flag = stop_flag.clone();

    std::thread::spawn(move || {
        while !poll_stop_flag.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_secs(POLL_INTERVAL_SECS));

            if poll_stop_flag.load(Ordering::Relaxed) {
                break;
            }

            // Check if this became a repo
            if resolve_toplevel(&poll_safe_cwd).is_ok() {
                // Upgrade to repo watcher — transfers the subscriber map
                // (with original cwd strings intact) into repo_watchers.
                if let Err(e) = upgrade_to_repo_watcher(
                    poll_safe_cwd.clone(),
                    poll_app_handle.clone(),
                    poll_state.clone(),
                ) {
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

    let mut subscribers = HashMap::new();
    subscribers.insert(cwd.to_string(), 1);

    let pre_repo_watcher = PreRepoWatcher {
        subscribers,
        stop_flag,
    };

    pre_repo_watchers.insert(safe_cwd, pre_repo_watcher);

    // Emit initial event with the frontend's original cwd string
    emit_git_status_changed(&app_handle, vec![cwd.to_string()]);

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
    app_handle: tauri::AppHandle,
    state: GitWatcherState,
) -> Result<(), String> {
    // Collect the subscribers (original-cwd → refcount) from the pre-repo
    // entry and drop it.
    let subscribers: HashMap<String, u32> = {
        let mut pre_repo_watchers = state.pre_repo_watchers.lock()
            .map_err(|e| format!("Failed to lock pre_repo_watchers: {}", e))?;

        if let Some(mut watcher) = pre_repo_watchers.remove(&safe_cwd) {
            // `PreRepoWatcher` impls `Drop` (sets stop_flag), so we can't
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
    for (original_cwd, refcount) in subscribers {
        for _ in 0..refcount {
            start_git_watcher_inner(&original_cwd, app_handle.clone(), &state)?;
        }
    }

    Ok(())
}

/// Stop watching a git repository
#[tauri::command]
pub async fn stop_git_watcher(
    cwd: String,
    state: tauri::State<'_, GitWatcherState>,
) -> Result<(), String> {
    // Same rationale as `start_git_watcher`: `validate_cwd` and
    // `resolve_toplevel` both spawn sync subprocess calls; hop to the
    // blocking pool so the async runtime isn't pinned while they run.
    let owned_state = state.inner().clone();
    tokio::task::spawn_blocking(move || stop_git_watcher_inner(cwd, owned_state))
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
            // the stop_flag, which the polling thread observes on its
            // next wake).
            if watcher.subscribers.is_empty() {
                repo_watchers.remove(&canonical);
            }

            return Ok(());
        }
        // Recorded mapping but no watcher — fall through (possible if
        // upgrade/teardown race removed the watcher but not the map
        // entry; the map-removal above already cleaned up).
    }

    // No recorded toplevel → pre-repo watcher path. We still need the
    // canonical `safe_cwd` PathBuf to look up the pre-repo map.
    // `validate_cwd` may itself fail if the cwd has been deleted, in
    // which case there's nothing we can clean up from here and
    // idempotent-stop is the right answer.
    let Ok(safe_cwd) = validate_cwd(&cwd) else {
        return Ok(());
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
    app_handle: &tauri::AppHandle,
    state: &GitWatcherState,
    toplevel: &std::path::Path,
) {
    let cwds: Vec<String> = {
        let repo_watchers = state.repo_watchers.lock().expect("failed to lock repo_watchers");

        if let Some(watcher) = repo_watchers.get(toplevel) {
            // Subscriber keys are the frontend's original cwd strings — emit
            // them as-is so listener's `event.cwds.includes(myCwd)` matches.
            watcher.subscribers.keys().cloned().collect()
        } else {
            vec![]
        }
    };

    if !cwds.is_empty() {
        emit_git_status_changed(app_handle, cwds);
    }
}

/// Emit a git-status-changed event
fn emit_git_status_changed(app_handle: &tauri::AppHandle, cwds: Vec<String>) {
    let payload = GitStatusChangedPayload { cwds };

    if let Err(e) = app_handle.emit("git-status-changed", payload) {
        log::error!("Failed to emit git-status-changed: {}", e);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;
    use tempfile::TempDir;

    /// Create a temp git repo for testing
    fn create_temp_repo() -> TempDir {
        let temp = TempDir::new().expect("failed to create temp dir");

        Command::new("git")
            .args(["init"])
            .current_dir(temp.path())
            .output()
            .expect("failed to run git init");

        Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(temp.path())
            .output()
            .expect("failed to configure git");

        Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(temp.path())
            .output()
            .expect("failed to configure git");

        temp
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
        fs::write(temp.path().join(".gitignore"), "ignored/\n").expect("failed to write .gitignore");
        fs::create_dir(temp.path().join("ignored")).expect("failed to create ignored");

        let dirs = enumerate_dirs(temp.path());

        // Should include root, src, src/components, tests, but NOT ignored
        let dir_names: Vec<_> = dirs.iter()
            .map(|p| p.file_name().and_then(|n| n.to_str()).unwrap_or(""))
            .collect();

        assert!(dirs.iter().any(|p| p == temp.path()), "should include root");
        assert!(dir_names.contains(&"src"), "should include src");
        assert!(dir_names.contains(&"components"), "should include components");
        assert!(dir_names.contains(&"tests"), "should include tests");
        assert!(!dir_names.contains(&"ignored"), "should NOT include ignored");
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
        assert_ne!(
            h1, h0,
            "hash must change when untracked file is created"
        );

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
}
