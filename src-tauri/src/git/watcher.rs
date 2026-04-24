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

use std::collections::HashMap;
use std::path::PathBuf;
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

/// Handle to a running watcher for a git repository
struct RepoWatcher {
    /// Map from input cwd to refcount — multiple subscribers can watch the same repo
    /// from different subdirectories. Each subscription increments the count; each
    /// unsubscribe decrements it. When the map is empty, the watcher is torn down.
    subscribers: HashMap<PathBuf, u32>,

    /// The notify watcher instance
    _watcher: RecommendedWatcher,

    /// Signals the polling fallback thread to exit
    stop_flag: Arc<AtomicBool>,

    /// Last OID of HEAD for polling fallback. The active reader is the
    /// polling thread (via its own `Arc` clone); this field keeps the
    /// `Arc` rooted on the owning watcher so the thread can keep reading
    /// after `RepoWatcher` moves into the state map.
    _last_head_oid: Arc<Mutex<String>>,
}

/// Handle to a pre-repo watcher (watching a directory that is not yet a git repo)
struct PreRepoWatcher {
    /// Refcount — multiple subscribers can watch the same pre-repo dir
    refcount: u32,

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

/// Resolve the git toplevel for a given cwd
fn resolve_toplevel(cwd: &std::path::Path) -> Result<PathBuf, String> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(cwd)
        .arg("rev-parse")
        .arg("--show-toplevel")
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        return Err("Not a git repository".to_string());
    }

    let toplevel_str = String::from_utf8_lossy(&output.stdout);
    let toplevel = toplevel_str.trim();

    Ok(PathBuf::from(toplevel))
}

/// Get the current HEAD OID for a repo
fn get_head_oid(toplevel: &std::path::Path) -> Result<String, String> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(toplevel)
        .arg("rev-parse")
        .arg("HEAD")
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        return Err("Failed to get HEAD OID".to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
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
    // The underlying watcher setup is entirely synchronous (notify + std::thread),
    // so we delegate to a helper that works against the owned state. This also lets
    // `upgrade_to_repo_watcher` call the same code path without fabricating a
    // `tauri::State`, which cannot be constructed from an owned value.
    start_git_watcher_inner(&cwd, app_handle, state.inner())
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
            // Not a repo yet — start pre-repo watcher
            return start_pre_repo_watcher_inner(safe_cwd, app_handle, state);
        }
    };

    let mut repo_watchers = state.repo_watchers.lock()
        .map_err(|e| format!("Failed to lock repo_watchers: {}", e))?;

    if let Some(watcher) = repo_watchers.get_mut(&toplevel) {
        // Watcher exists — increment refcount
        *watcher.subscribers.entry(safe_cwd.clone()).or_insert(0) += 1;

        // Emit initial event for this subscriber
        emit_git_status_changed(&app_handle, vec![safe_cwd.to_string_lossy().to_string()]);

        return Ok(());
    }

    // Create new watcher
    let state_clone = state.clone();
    let last_head_oid = Arc::new(Mutex::new(
        get_head_oid(&toplevel).unwrap_or_default()
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

            // Only react to modifications or creations
            let relevant = matches!(
                event.kind,
                EventKind::Modify(_) | EventKind::Create(_)
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

    // Register watches for all non-ignored directories
    let dirs = enumerate_dirs(&toplevel);
    let mut watcher = notify_watcher;

    for dir in dirs {
        if let Err(e) = watcher.watch(&dir, RecursiveMode::NonRecursive) {
            log::warn!("Failed to watch {}: {}", dir.display(), e);
        }
    }

    // Also watch .git/index and .git/HEAD
    let git_index = toplevel.join(".git/index");
    if git_index.exists() {
        if let Err(e) = watcher.watch(&git_index, RecursiveMode::NonRecursive) {
            log::warn!("Failed to watch .git/index: {}", e);
        }
    }

    let git_head = toplevel.join(".git/HEAD");
    if git_head.exists() {
        if let Err(e) = watcher.watch(&git_head, RecursiveMode::NonRecursive) {
            log::warn!("Failed to watch .git/HEAD: {}", e);
        }
    }

    // Start polling fallback thread
    let poll_toplevel = toplevel.clone();
    let poll_app_handle = app_handle.clone();
    let poll_state = state_clone.clone();
    let poll_stop_flag = stop_flag.clone();
    let poll_last_head_oid = last_head_oid.clone();

    std::thread::spawn(move || {
        while !poll_stop_flag.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_secs(POLL_INTERVAL_SECS));

            if poll_stop_flag.load(Ordering::Relaxed) {
                break;
            }

            // Check if HEAD changed
            if let Ok(current_oid) = get_head_oid(&poll_toplevel) {
                let last = poll_last_head_oid.lock().expect("failed to lock last_head_oid");
                if *last != current_oid {
                    drop(last);
                    *poll_last_head_oid.lock().expect("failed to lock") = current_oid;
                    emit_for_all_subscribers(&poll_app_handle, &poll_state, &poll_toplevel);
                }
            }
        }
    });

    // Insert watcher with initial subscriber
    let mut subscribers = HashMap::new();
    subscribers.insert(safe_cwd.clone(), 1);

    let repo_watcher = RepoWatcher {
        subscribers,
        _watcher: watcher,
        stop_flag,
        _last_head_oid: last_head_oid,
    };

    repo_watchers.insert(toplevel, repo_watcher);

    // Emit initial event
    emit_git_status_changed(&app_handle, vec![safe_cwd.to_string_lossy().to_string()]);

    Ok(())
}

/// Start a pre-repo watcher (for directories that are not yet git repos).
///
/// Takes an owned `&GitWatcherState` (cheap: the state is `Arc`-backed) so it
/// can be called both from the Tauri command path and from the upgrade path.
fn start_pre_repo_watcher_inner(
    cwd: PathBuf,
    app_handle: tauri::AppHandle,
    state: &GitWatcherState,
) -> Result<(), String> {
    let mut pre_repo_watchers = state.pre_repo_watchers.lock()
        .map_err(|e| format!("Failed to lock pre_repo_watchers: {}", e))?;

    if let Some(watcher) = pre_repo_watchers.get_mut(&cwd) {
        // Pre-repo watcher exists — increment refcount
        watcher.refcount += 1;

        // Emit initial event
        emit_git_status_changed(&app_handle, vec![cwd.to_string_lossy().to_string()]);

        return Ok(());
    }

    // Create new pre-repo watcher with polling
    let stop_flag = Arc::new(AtomicBool::new(false));
    let poll_cwd = cwd.clone();
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
            if resolve_toplevel(&poll_cwd).is_ok() {
                // Upgrade to repo watcher
                if let Err(e) = upgrade_to_repo_watcher(poll_cwd.clone(), poll_app_handle.clone(), poll_state.clone()) {
                    log::error!("Failed to upgrade to repo watcher: {}", e);
                }
                break;
            }

            // Still not a repo — emit event anyway (git_status will return empty)
            emit_git_status_changed(&poll_app_handle, vec![poll_cwd.to_string_lossy().to_string()]);
        }
    });

    let pre_repo_watcher = PreRepoWatcher {
        refcount: 1,
        stop_flag,
    };

    pre_repo_watchers.insert(cwd.clone(), pre_repo_watcher);

    // Emit initial event
    emit_git_status_changed(&app_handle, vec![cwd.to_string_lossy().to_string()]);

    Ok(())
}

/// Upgrade a pre-repo watcher to a full repo watcher.
///
/// Removes the pre-repo entry and re-invokes the repo-watcher bootstrap the
/// same number of times as the prior refcount so subscribers keep their grip.
/// Calls the synchronous inner helper directly — no `tauri::State` fabrication
/// and no blocking executor needed.
fn upgrade_to_repo_watcher(
    cwd: PathBuf,
    app_handle: tauri::AppHandle,
    state: GitWatcherState,
) -> Result<(), String> {
    let refcount = {
        let mut pre_repo_watchers = state.pre_repo_watchers.lock()
            .map_err(|e| format!("Failed to lock pre_repo_watchers: {}", e))?;

        if let Some(watcher) = pre_repo_watchers.remove(&cwd) {
            watcher.refcount
        } else {
            return Err("Pre-repo watcher not found".to_string());
        }
    };

    // Start a proper repo watcher (this will handle the refcount internally)
    let cwd_str = cwd.to_string_lossy().to_string();
    for _ in 0..refcount {
        start_git_watcher_inner(&cwd_str, app_handle.clone(), &state)?;
    }

    Ok(())
}

/// Stop watching a git repository
#[tauri::command]
pub async fn stop_git_watcher(
    cwd: String,
    state: tauri::State<'_, GitWatcherState>,
) -> Result<(), String> {
    let safe_cwd = validate_cwd(&cwd)?;

    // Try repo watchers first
    let toplevel = resolve_toplevel(&safe_cwd).ok();

    if let Some(toplevel) = toplevel {
        let canonical = validate_cwd(&toplevel.to_string_lossy())?;

        let mut repo_watchers = state.repo_watchers.lock()
            .map_err(|e| format!("Failed to lock repo_watchers: {}", e))?;

        if let Some(watcher) = repo_watchers.get_mut(&canonical) {
            if let Some(count) = watcher.subscribers.get_mut(&safe_cwd) {
                *count = count.saturating_sub(1);

                if *count == 0 {
                    watcher.subscribers.remove(&safe_cwd);
                }
            }

            // If no more subscribers, remove the watcher
            if watcher.subscribers.is_empty() {
                repo_watchers.remove(&canonical);
            }

            return Ok(());
        }
    }

    // Try pre-repo watchers
    let mut pre_repo_watchers = state.pre_repo_watchers.lock()
        .map_err(|e| format!("Failed to lock pre_repo_watchers: {}", e))?;

    if let Some(watcher) = pre_repo_watchers.get_mut(&safe_cwd) {
        watcher.refcount = watcher.refcount.saturating_sub(1);

        if watcher.refcount == 0 {
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
    let cwds = {
        let repo_watchers = state.repo_watchers.lock().expect("failed to lock repo_watchers");

        if let Some(watcher) = repo_watchers.get(toplevel) {
            watcher.subscribers.keys()
                .map(|p| p.to_string_lossy().to_string())
                .collect()
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
}
