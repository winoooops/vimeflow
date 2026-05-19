# Live HEAD/Branch Detection with Worktree Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pane Headers always show the correct branch for their cwd — including when the cwd is a linked worktree, when the agent switches branches, and when HEAD goes detached — within 300 ms of any HEAD-moving operation and with zero manual refresh.

**Architecture:** Watcher resolves `git rev-parse --path-format=absolute --git-dir` per pane alongside `--show-toplevel`; watches the gitdir non-recursively and filters notify events by full-path equality for `HEAD` / `index` / `packed-refs`; emits a new `git-head-changed` event on the same 300 ms debounce window as `git-status-changed`; the polling fallback compares cached `<git_dir>/HEAD` content independently from the status hash; `useGitBranch` mirrors `useGitStatus`'s `listen → start_git_watcher → refresh` lifecycle; `git_branch` IPC falls back to `git rev-parse --short HEAD` on detached HEAD without collapsing real errors; a refcount-aware `stop_git_watcher_inner` lands as a prerequisite.

**Tech Stack:** Rust 1.x (Electron sidecar, `notify` crate, `tokio`), TypeScript 5 / React 19, Vitest, Testing Library.

**Spec:** [`docs/superpowers/specs/2026-05-19-live-head-branch-worktree-design.md`](../specs/2026-05-19-live-head-branch-worktree-design.md)

---

## File Structure

Files modified or created in this plan:

| File                                           | Responsibility                                                                                          | Action                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `crates/backend/src/git/watcher.rs`            | Watcher core: subscription, FS watch, debounce, polling, event emission. All of §2, §3, the bulk of §5. | Modify (additions + refactor)                  |
| `crates/backend/src/git/mod.rs`                | `git_branch` IPC: branch-name fallback to short SHA. §4 contract change.                                | Modify (one function + tests)                  |
| `crates/backend/src/git/test_helpers.rs`       | Worktree fixture used by new unit tests.                                                                | Modify (add `create_main_repo_with_worktrees`) |
| `src/features/diff/hooks/useGitBranch.ts`      | Event subscription + watcher lifecycle in the hook. §4 in full.                                         | Modify (add second effect)                     |
| `src/features/diff/hooks/useGitBranch.test.ts` | Vitest hook tests for the event subscription. §6.                                                       | Modify (add tests)                             |
| `README.md`                                    | One-line note recommending `.claude/worktrees/` in `.gitignore`. §7 risks.                              | Modify (small docs note)                       |

`HeaderMetadata.tsx` is intentionally NOT in this list: it renders any non-null branch string with `text-on-surface-muted` (verified at `HeaderMetadata.tsx:27-30`). Short-SHA strings render identically to branch names — no component change, no new test needed. Existing `HeaderMetadata.test.tsx` already covers the "branch is any string" case.

The watcher.rs file is large (~1800 lines today) but its existing co-located test module is the right place for the new tests per `rules/rust/testing.md`. Do NOT split watcher.rs in this plan — the changes here are additive and the file's responsibility is unchanged.

---

## Tasks Overview

Task ordering is **prerequisite-first**. Each task is TDD: red → green → commit. Tasks 1 and 9 are deliberately structured as standalone commits because they're independently mergeable and useful.

| #   | Task                                                       | Touches                     | Why this order                                                                       |
| --- | ---------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------ |
| 1   | Refcount-aware `stop_git_watcher_inner`                    | watcher.rs                  | Prerequisite; latent bug surfaces once two consumers start watchers for the same cwd |
| 2   | Resolve `git_dir`; widen `cwd_to_toplevel` → `cwd_to_repo` | watcher.rs                  | Foundation for all per-worktree logic                                                |
| 3   | Watch `git_dir` non-recursively (parent-dir watch)         | watcher.rs                  | Replaces rename-fragile per-file watches                                             |
| 4   | `head_dirty` flag + full-path classification               | watcher.rs                  | Detects HEAD modifies without aliasing user files named HEAD                         |
| 5   | `GitHeadChangedPayload` + `emit_git_head_changed` helper   | watcher.rs                  | Wire format; no behavior yet                                                         |
| 6   | Wire `git-head-changed` into debounce trailing-edge        | watcher.rs                  | Live event emission on FS events                                                     |
| 7   | Initial emit on subscribe                                  | watcher.rs                  | Covers pre-repo → worktree upgrade                                                   |
| 8   | Independent HEAD-content compare in polling fallback       | watcher.rs                  | Catches clean `git switch` on NFS/FUSE                                               |
| 9   | `git_branch` IPC: short-SHA fallback (preserves Err)       | mod.rs                      | Standalone IPC contract change                                                       |
| 10  | `useGitBranch`: event subscription + watcher lifecycle     | useGitBranch.ts             | Frontend wiring                                                                      |
| 11  | Worktree-specific Rust tests + fixture                     | test_helpers.rs, watcher.rs | End-to-end coverage                                                                  |
| 12  | README `.gitignore` note for `.claude/worktrees/`          | README.md                   | Docs                                                                                 |

---

## Task 1: Refcount-aware `stop_git_watcher_inner`

**Files:**

- Modify: `crates/backend/src/git/watcher.rs:1154-1200`
- Test (existing test module): `crates/backend/src/git/watcher.rs` `#[cfg(test)] mod tests`

- [ ] **Step 1: Write the failing test**

Add to `mod tests` in `watcher.rs`:

```rust
#[tokio::test]
async fn test_stop_git_watcher_inner_handles_duplicate_starts() {
    let repo = create_temp_repo();
    let cwd = repo.path().to_string_lossy().to_string();
    let (state, recording, sink) = test_setup();

    // Two starts for the same cwd.
    start_git_watcher_inner(&cwd, sink.clone(), &state).expect("start 1");
    start_git_watcher_inner(&cwd, sink.clone(), &state).expect("start 2");

    // After first stop, bucket should STILL exist (counter is 1, not 0).
    stop_git_watcher_inner(cwd.clone(), state.clone()).expect("stop 1");
    {
        let toplevel = resolve_toplevel(std::path::Path::new(&cwd))
            .expect("resolve")
            .canonicalize()
            .expect("canon");
        let watchers = state.repo_watchers.lock().unwrap();
        assert!(
            watchers.contains_key(&toplevel),
            "bucket must survive first stop when refcount is still > 0"
        );
    }

    // After second stop, bucket should be gone.
    stop_git_watcher_inner(cwd.clone(), state.clone()).expect("stop 2");
    {
        let toplevel = resolve_toplevel(std::path::Path::new(&cwd))
            .expect("resolve")
            .canonicalize()
            .expect("canon");
        let watchers = state.repo_watchers.lock().unwrap();
        assert!(
            !watchers.contains_key(&toplevel),
            "bucket must be removed on the last stop"
        );
    }
}
```

`test_setup()` is a helper colocated with existing tests; if not present, add. **Important:** hold a concrete `Arc<RecordingEventSink>` clone alongside the `Arc<dyn EventSink>` — the trait has no `as_any` downcast, and `RecordingEventSink` (aliased as `FakeEventSink`) is the only sink with `recorded()` / `wait_for_count()` access.

```rust
use crate::runtime::test_event_sink::RecordingEventSink;

fn test_setup() -> (GitWatcherState, std::sync::Arc<RecordingEventSink>, std::sync::Arc<dyn EventSink>) {
    let state = GitWatcherState::new();
    let recording = std::sync::Arc::new(RecordingEventSink::new());
    let sink: std::sync::Arc<dyn EventSink> = recording.clone();
    (state, recording, sink)
}

/// Recorded payloads are `serde_json::Value`, not strings. Check membership
/// through the JSON shape rather than substring-matching the Debug repr.
fn payload_includes_cwd(payload: &serde_json::Value, cwd: &str) -> bool {
    payload["cwds"]
        .as_array()
        .map(|arr| arr.iter().any(|v| v.as_str() == Some(cwd)))
        .unwrap_or(false)
}
```

Use the `recording: Arc<RecordingEventSink>` handle for assertions and the `sink: Arc<dyn EventSink>` handle when passing into watcher code. `RecordingEventSink::wait_for_count(event, count, timeout)` is the right primitive when waiting for an event to arrive (no manual `clear()` — instead, snapshot the pre-action count and assert post-action count grew).

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p vimeflow test_stop_git_watcher_inner_handles_duplicate_starts -- --nocapture`
Expected: FAIL — second `stop_git_watcher_inner` is a silent no-op today (bucket remains).

- [ ] **Step 3: Replace `remove` with peek-then-conditional-remove in `stop_git_watcher_inner`**

In `watcher.rs:1154`, replace the body of the function:

```rust
fn stop_git_watcher_inner(cwd: String, state: GitWatcherState) -> Result<(), String> {
    // Peek instead of remove. We only clear the side-map when the cwd's
    // last subscriber is gone; otherwise the next stop for the SAME cwd
    // would not find its toplevel and would silently skip decrementing.
    let recorded_toplevel: Option<PathBuf> = {
        let map = state
            .cwd_to_toplevel
            .lock()
            .map_err(|e| format!("Failed to lock cwd_to_toplevel: {}", e))?;
        map.get(&cwd).cloned()
    };

    if let Some(canonical) = recorded_toplevel {
        let mut repo_watchers = state
            .repo_watchers
            .lock()
            .map_err(|e| format!("Failed to lock repo_watchers: {}", e))?;

        if let Some(watcher) = repo_watchers.get_mut(&canonical) {
            let mut last_subscriber_for_cwd = false;
            if let Some(count) = watcher.subscribers.get_mut(&cwd) {
                *count = count.saturating_sub(1);
                if *count == 0 {
                    watcher.subscribers.remove(&cwd);
                    last_subscriber_for_cwd = true;
                }
            }

            if watcher.subscribers.is_empty() {
                repo_watchers.remove(&canonical);
            }

            // Only remove from the side-map AFTER we've decremented and
            // confirmed this was the last subscriber for this cwd.
            if last_subscriber_for_cwd {
                state
                    .cwd_to_toplevel
                    .lock()
                    .map_err(|e| format!("Failed to lock cwd_to_toplevel: {}", e))?
                    .remove(&cwd);
            }

            return Ok(());
        }
        // Recorded mapping but no watcher — also clean the stale map entry.
        state
            .cwd_to_toplevel
            .lock()
            .map_err(|e| format!("Failed to lock cwd_to_toplevel: {}", e))?
            .remove(&cwd);
    }

    // Pre-repo branch — apply symmetric peek-then-conditional-remove.
    let recorded_pre_repo: Option<PathBuf> = {
        let map = state
            .cwd_to_safe_pre_repo
            .lock()
            .map_err(|e| format!("Failed to lock cwd_to_safe_pre_repo: {}", e))?;
        map.get(&cwd).cloned()
    };

    let safe_cwd = match recorded_pre_repo {
        Some(p) => p,
        None => {
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
        let mut last_for_cwd = false;
        if let Some(count) = watcher.subscribers.get_mut(&cwd) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                watcher.subscribers.remove(&cwd);
                last_for_cwd = true;
            }
        }
        if watcher.subscribers.is_empty() {
            pre_repo_watchers.remove(&safe_cwd);
        }
        if last_for_cwd {
            state
                .cwd_to_safe_pre_repo
                .lock()
                .map_err(|e| format!("Failed to lock cwd_to_safe_pre_repo: {}", e))?
                .remove(&cwd);
        }
    }

    Ok(())
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p vimeflow test_stop_git_watcher_inner_handles_duplicate_starts -- --nocapture`
Expected: PASS.

Also run the full watcher test suite to confirm no regressions:

Run: `cargo test -p vimeflow --lib git::watcher::tests`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/backend/src/git/watcher.rs
git commit -m "fix(git-watcher): refcount-aware stop for duplicate-start cwds"
```

---

## Task 2: Resolve `git_dir`; widen `cwd_to_toplevel` → `cwd_to_repo`

**Files:**

- Modify: `crates/backend/src/git/watcher.rs:357-378, 308-340, 470-580`
- Test (existing test module): `crates/backend/src/git/watcher.rs` `#[cfg(test)] mod tests`

- [ ] **Step 1: Write the failing tests**

Add to `mod tests`:

```rust
#[test]
fn test_resolve_git_dir_returns_dotgit_in_main_repo() {
    let repo = create_temp_repo();
    let git_dir = resolve_git_dir(repo.path()).expect("resolve");
    let expected = repo.path().join(".git").canonicalize().expect("canon");
    assert_eq!(git_dir, expected);
}

#[test]
fn test_resolve_git_dir_returns_worktree_subdir_in_linked_worktree() {
    let repo = create_temp_repo();
    // Commit one file so a worktree-add can find a parent.
    fs::write(repo.path().join("seed"), "seed").unwrap();
    Command::new("git").args(["add", "."]).current_dir(repo.path()).status().unwrap();
    Command::new("git").args(["commit", "-m", "seed"])
        .current_dir(repo.path()).status().unwrap();

    let worktree_dir = repo.path().parent().unwrap().join("wt-feat");
    Command::new("git")
        .args(["worktree", "add", "-b", "feat",
               worktree_dir.to_str().unwrap()])
        .current_dir(repo.path()).status().unwrap();

    let git_dir = resolve_git_dir(&worktree_dir).expect("resolve");
    let expected = repo.path()
        .join(".git/worktrees/wt-feat")
        .canonicalize()
        .expect("canon");
    assert_eq!(git_dir, expected);
}

#[test]
fn test_resolve_git_dir_errors_outside_a_repo() {
    let tmp = home_tempdir();
    let result = resolve_git_dir(tmp.path());
    assert!(result.is_err(), "expected Err for non-repo, got {:?}", result);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p vimeflow resolve_git_dir -- --nocapture`
Expected: FAIL with "function not found" or compile error.

- [ ] **Step 3: Add `resolve_git_dir` next to `resolve_toplevel` in `watcher.rs`**

Insert after `resolve_toplevel` (around `watcher.rs:378`):

```rust
/// Resolve the per-worktree gitdir for a given cwd.
///
/// Uses `--path-format=absolute --git-dir` so git emits an absolute path
/// before our caller touches it. Without `--path-format=absolute`,
/// `--git-dir` can return a path RELATIVE to the pane cwd (e.g. `.git`
/// in the main repo when invoked with `-C <toplevel>`), and a later
/// `canonicalize()` of that relative path resolves it against the
/// sidecar process cwd — a silently wrong repo or an error.
///
/// Returns:
///   - `<toplevel>/.git` in the main repo (canonicalized).
///   - `<main>/.git/worktrees/<name>` in a linked worktree (canonicalized).
fn resolve_git_dir(cwd: &std::path::Path) -> Result<PathBuf, String> {
    let mut cmd = std::process::Command::new("git");
    cmd.arg("-C")
        .arg(cwd)
        .arg("rev-parse")
        .arg("--path-format=absolute")
        .arg("--git-dir")
        .env("GIT_TERMINAL_PROMPT", "0");

    let output = run_sync_with_timeout(cmd, SYNC_GIT_TIMEOUT)?;

    if !output.status.success() {
        return Err("Not a git repository".to_string());
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    let trimmed = raw.trim();
    let path = PathBuf::from(trimmed);
    path.canonicalize().map_err(|e| format!("canonicalize git_dir: {}", e))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p vimeflow resolve_git_dir -- --nocapture`
Expected: PASS.

- [ ] **Step 5: Widen `cwd_to_toplevel` to carry the `(toplevel, gitdir)` tuple**

In `watcher.rs`, find the field declaration around `watcher.rs:327`:

```rust
cwd_to_toplevel: Arc<Mutex<HashMap<String, PathBuf>>>,
```

Rename and widen:

```rust
/// Side-map: frontend's original cwd string → (canonical toplevel, canonical gitdir).
/// Stop-time routing aid; populated at subscription start; removed only when
/// the bucket's subscriber count for this cwd reaches zero (see Task 1).
cwd_to_repo: Arc<Mutex<HashMap<String, (PathBuf, PathBuf)>>>,
```

Update the `Default` impl for `GitWatcherState` to use the new field name.

Update all references in `watcher.rs`:

- `start_git_watcher_inner` (around `watcher.rs:572-575`): change `state.cwd_to_toplevel` to `state.cwd_to_repo`. The insert becomes `repo_map.insert(cwd.to_string(), (toplevel.clone(), git_dir.clone()))` — `git_dir` is resolved earlier in the function (see Step 6 below).
- The Phase-2 init block (around `watcher.rs:795-810`): same insert with the tuple.
- `stop_git_watcher_inner` (the function you just edited in Task 1): change `cwd_to_toplevel` → `cwd_to_repo`, and destructure on lookup: `let (canonical_toplevel, _gitdir) = recorded;`.
- Any test that constructs a `GitWatcherState` directly: same field rename.

- [ ] **Step 6: Add `git_dir` resolution to `start_git_watcher_inner`**

In `watcher.rs:506`, after `resolve_toplevel` succeeds:

```rust
let toplevel = match resolve_toplevel(&safe_cwd) {
    Ok(tl) => {
        let canonical = validate_cwd(&tl.to_string_lossy())?;
        canonical
    }
    Err(_) => {
        return start_pre_repo_watcher_inner(cwd, safe_cwd, events, state);
    }
};

// NEW: resolve git_dir alongside toplevel. Validate it under $HOME (same
// scope rule). In a linked worktree, git_dir lives under <main>/.git/worktrees/<name>/,
// which is still under $HOME because the main repo is. Symlinks inside .git/
// are followed by canonicalize() before validation.
let git_dir = resolve_git_dir(&safe_cwd)
    .and_then(|p| validate_cwd(&p.to_string_lossy()))?;
```

Pass `git_dir.clone()` into the `cwd_to_repo` insert.

Also store `git_dir` in the `RepoWatcher` struct. Find the struct definition (search for `struct RepoWatcher`) and add:

```rust
struct RepoWatcher {
    // ... existing fields ...
    git_dir: PathBuf,
}
```

Initialize it in the Phase-2 construction site (around `watcher.rs:830-870`).

- [ ] **Step 7: Run all watcher tests + the new ones**

Run: `cargo test -p vimeflow --lib git::watcher::tests`
Expected: all PASS, including `test_resolve_git_dir_*`.

If the test for `test_stop_git_watcher_inner_handles_duplicate_starts` (Task 1) fails because of the rename, update it to use `cwd_to_repo` and destructure `(toplevel, _gitdir)`.

- [ ] **Step 8: Commit**

```bash
git add crates/backend/src/git/watcher.rs
git commit -m "feat(git-watcher): resolve per-worktree git_dir at subscription"
```

---

## Task 3: Watch `git_dir` non-recursively (parent-dir watch)

**Files:**

- Modify: `crates/backend/src/git/watcher.rs:662-676`

- [ ] **Step 1: Write the failing test**

Add to `mod tests`:

```rust
#[tokio::test]
async fn test_head_watch_survives_atomic_rename_replace() {
    let repo = create_temp_repo();
    fs::write(repo.path().join("seed"), "seed").unwrap();
    Command::new("git").args(["add", "."]).current_dir(repo.path()).status().unwrap();
    Command::new("git").args(["commit", "-m", "seed"])
        .current_dir(repo.path()).status().unwrap();

    let cwd = repo.path().to_string_lossy().to_string();
    let (state, recording, sink) = test_setup();
    start_git_watcher_inner(&cwd, sink.clone(), &state).expect("start");

    // First HEAD movement.
    let baseline1 = recording.count("git-head-changed");
    Command::new("git").args(["switch", "-c", "feat-a"])
        .current_dir(repo.path()).status().unwrap();
    wait_for_next_event(&recording, "git-head-changed", baseline1, 2_000).expect("first emit");

    // SECOND HEAD movement — would fail on direct-file-watch implementations
    // because git's rename-replace invalidates the file's inode watch.
    let baseline2 = recording.count("git-head-changed");
    Command::new("git").args(["switch", "-c", "feat-b"])
        .current_dir(repo.path()).status().unwrap();
    wait_for_next_event(&recording, "git-head-changed", baseline2, 2_000)
        .expect("second emit (rename-replace must not break the watch)");
}
```

`wait_for_next_event` wraps `RecordingEventSink::wait_for_count` to express the test pattern "I expect ONE MORE event after the current baseline." Add next to other test helpers:

```rust
fn wait_for_next_event(
    sink: &RecordingEventSink,
    event_name: &str,
    baseline: usize,
    timeout_ms: u64,
) -> Result<(), String> {
    if sink.wait_for_count(event_name, baseline + 1, std::time::Duration::from_millis(timeout_ms)) {
        Ok(())
    } else {
        Err(format!("did not see {event_name} #{} within {timeout_ms}ms", baseline + 1))
    }
}
```

Test pattern: snapshot `recording.count(event)` BEFORE the action, then call `wait_for_next_event(&recording, event, baseline, timeout)`. Avoids a `clear()` method we don't have.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p vimeflow test_head_watch_survives_atomic_rename_replace -- --nocapture`
Expected: FAIL (today's per-file watch goes stale after the first rename; second `git switch` doesn't emit).

- [ ] **Step 3: Change watch registration to watch the gitdir non-recursively**

In `watcher.rs`, replace lines 662–676:

```rust
// Watch <git_dir> non-recursively so the inode being watched is stable
// across git's atomic rename-replace updates of HEAD, index, packed-refs.
// (Watching HEAD directly goes stale on Linux inotify after the first
// rename, because `notify` registers an inode watch and git swaps the
// inode.)
//
// NonRecursive means we get events for top-level files inside git_dir
// (HEAD, index, packed-refs, config, COMMIT_EDITMSG, …) but NOT for
// `objects/`, `refs/`, `logs/`, `worktrees/`, or `hooks/`. That keeps
// the watch budget bounded — the same reason the old code refused to
// recurse into .git/.
if git_dir.exists() {
    if let Err(e) = watcher_guard.watch(&git_dir, RecursiveMode::NonRecursive) {
        log::warn!("Failed to watch {}: {}", git_dir.display(), e);
    }
}
```

Remove the previous `git_index = toplevel.join(".git/index")` and `git_head = toplevel.join(".git/HEAD")` blocks — both are now covered by the gitdir watch.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p vimeflow test_head_watch_survives_atomic_rename_replace -- --nocapture`
Expected: PASS.

It will likely fail until Task 4 (classification + emit) and Task 6 (debounce wiring) are done. **In that case**, skip ahead — write the test, leave it as `#[ignore]` with a comment `TODO: enable after Task 6`, commit Task 3 with the watch change only, then un-ignore after Task 6.

- [ ] **Step 5: Commit**

```bash
git add crates/backend/src/git/watcher.rs
git commit -m "refactor(git-watcher): watch git_dir non-recursively (survives atomic rename)"
```

---

## Task 4: `head_dirty` flag + full-path classification

**Files:**

- Modify: `crates/backend/src/git/watcher.rs` `RepoWatcher` struct + notify callback

- [ ] **Step 1: Write the failing test**

Add to `mod tests`:

```rust
#[test]
fn test_path_is_git_head_matches_full_path_only() {
    // A working-tree file whose name happens to be "HEAD" must NOT be
    // misclassified as a git HEAD change.
    let git_dir = PathBuf::from("/tmp/foo/.git");
    let user_head = PathBuf::from("/tmp/foo/some-dir/HEAD");
    let real_head = git_dir.join("HEAD");

    assert!(!path_is_git_head(&user_head, &git_dir),
        "user file named HEAD must not match");
    assert!(path_is_git_head(&real_head, &git_dir),
        "actual <git_dir>/HEAD must match");
}

#[test]
fn test_path_is_git_head_does_not_match_packed_refs() {
    let git_dir = PathBuf::from("/tmp/foo/.git");
    let packed_refs = git_dir.join("packed-refs");
    assert!(!path_is_git_head(&packed_refs, &git_dir));
}

#[test]
fn test_path_is_inside_git_dir_filters_gitdir_noise() {
    let git_dir = PathBuf::from("/tmp/foo/.git");
    assert!(path_is_inside_git_dir(&git_dir.join("config"), &git_dir));
    assert!(path_is_inside_git_dir(&git_dir.join("packed-refs"), &git_dir));
    // Working-tree paths are NOT inside git_dir.
    assert!(!path_is_inside_git_dir(
        &PathBuf::from("/tmp/foo/src/lib.rs"), &git_dir));
    // Subdirs of git_dir (e.g. hooks/, refs/heads/) have `parent() == git_dir/<sub>`,
    // not git_dir itself — they correctly DON'T match. NonRecursive watch on
    // git_dir never surfaces those paths anyway.
    assert!(!path_is_inside_git_dir(
        &git_dir.join("hooks").join("pre-commit"), &git_dir));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p vimeflow path_is_git -- --nocapture`
Expected: FAIL — `path_is_git_head` and friends don't exist.

- [ ] **Step 3: Add the classifier and the `head_dirty` flag**

In the `RepoWatcher` struct (near `watcher.rs:280`), add:

```rust
struct RepoWatcher {
    // ... existing fields ...
    git_dir: PathBuf,
    /// Set to true by the notify callback when it sees a modify on
    /// <git_dir>/HEAD; consumed (and reset) by the debounce trailing-edge.
    head_dirty: Arc<AtomicBool>,
}
```

Add the classification helpers near other private helpers. There are THREE relevant categories of path the notify callback may receive (because the single `RecommendedWatcher` serves both the recursive working-tree watch on `<toplevel>` and the non-recursive gitdir watch on `<git_dir>`):

```rust
/// `<git_dir>/HEAD` exactly.
fn path_is_git_head(path: &std::path::Path, git_dir: &std::path::Path) -> bool {
    path == git_dir.join("HEAD")
}

/// `<git_dir>/index` exactly.
fn path_is_git_index(path: &std::path::Path, git_dir: &std::path::Path) -> bool {
    path == git_dir.join("index")
}

/// Any path inside `git_dir` (top level only — `NonRecursive` watch doesn't
/// surface deeper paths, but we still gate). Used to recognize gitdir-side
/// noise (config, packed-refs, COMMIT_EDITMSG, hooks/, …) that should be
/// dropped instead of forwarded to the debounce thread.
fn path_is_inside_git_dir(path: &std::path::Path, git_dir: &std::path::Path) -> bool {
    path.parent() == Some(git_dir)
}
```

In the notify callback inside `start_git_watcher_inner` (find it by searching for the closure that calls `debounce_tx.send(())`), classify by full-path equality AND gate the forward so gitdir-side noise doesn't reach the debounce thread:

```rust
let git_dir_for_callback = git_dir.clone();
let head_dirty_for_callback = head_dirty.clone();

// inside the closure — replaces the existing unconditional forward:
if let Ok(event) = result {
    let mut should_forward = false;
    for p in &event.paths {
        if path_is_git_head(p, &git_dir_for_callback) {
            head_dirty_for_callback.store(true, Ordering::Release);
            should_forward = true;
        } else if path_is_git_index(p, &git_dir_for_callback) {
            should_forward = true;
        } else if path_is_inside_git_dir(p, &git_dir_for_callback) {
            // config / packed-refs / COMMIT_EDITMSG / hooks/ etc. — drop.
            // Branch name unchanged, working-tree state unchanged: no event needed.
        } else {
            // Outside git_dir → working-tree event from the recursive watch.
            should_forward = true;
        }
    }
    if should_forward {
        let _ = debounce_tx.send(());
    }
}
```

`head_dirty` is initialized in the Phase-2 builder:

```rust
let head_dirty = Arc::new(AtomicBool::new(false));
```

and stored in `RepoWatcher`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p vimeflow path_is_git -- --nocapture`
Expected: PASS (all three classifier tests).

- [ ] **Step 5: Commit**

```bash
git add crates/backend/src/git/watcher.rs
git commit -m "feat(git-watcher): head_dirty flag with full-path classifier"
```

---

## Task 5: `GitHeadChangedPayload` + `emit_git_head_changed` helper

**Files:**

- Modify: `crates/backend/src/git/watcher.rs` (near the existing payload definitions)

- [ ] **Step 1: Write the failing test**

Add to `mod tests`:

```rust
#[test]
fn test_git_head_changed_payload_serializes_camel_case_cwds() {
    let payload = GitHeadChangedPayload {
        cwds: vec!["/home/u/repo".to_string()],
    };
    let json = serde_json::to_string(&payload).expect("serialize");
    assert_eq!(json, r#"{"cwds":["/home/u/repo"]}"#);
}

#[test]
fn test_emit_git_head_changed_writes_to_sink() {
    let (_state, sink) = test_setup();

    emit_git_head_changed(&sink, vec!["/home/u/repo".to_string()]);

    let recorded = recording.recorded();
    assert_eq!(recorded.len(), 1);
    assert_eq!(recorded[0].0, "git-head-changed");
    assert!(recorded[0].1.contains("/home/u/repo"));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p vimeflow git_head_changed -- --nocapture`
Expected: FAIL — `GitHeadChangedPayload` / `emit_git_head_changed` don't exist.

- [ ] **Step 3: Add the payload and helper next to their `git-status-changed` siblings**

In `watcher.rs`, near `GitStatusChangedPayload` (around line 349):

```rust
/// Payload emitted when <git_dir>/HEAD content may have changed.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct GitHeadChangedPayload {
    cwds: Vec<String>,
}
```

Near `emit_git_status_changed` (around line 1284):

```rust
/// Emit a git-head-changed event for the provided cwds.
fn emit_git_head_changed(events: &Arc<dyn EventSink>, cwds: Vec<String>) {
    let payload = GitHeadChangedPayload { cwds };
    let result = serialize_event(&payload)
        .and_then(|payload| events.emit_json("git-head-changed", payload));

    if let Err(e) = result {
        log::error!("Failed to emit git-head-changed: {}", e);
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p vimeflow git_head_changed -- --nocapture`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/backend/src/git/watcher.rs
git commit -m "feat(git-watcher): add git-head-changed payload + emit helper"
```

---

## Task 6: Wire `git-head-changed` into the debounce trailing-edge

**Files:**

- Modify: `crates/backend/src/git/watcher.rs` (the debounce thread's emit site and the bucket fan-out)

- [ ] **Step 1: Write the failing test**

If you ignored the Task 3 integration test, un-ignore it now. Add a more targeted test:

```rust
#[tokio::test]
async fn test_head_change_in_main_emits_git_head_changed() {
    let repo = create_temp_repo();
    fs::write(repo.path().join("seed"), "seed").unwrap();
    Command::new("git").args(["add", "."]).current_dir(repo.path()).status().unwrap();
    Command::new("git").args(["commit", "-m", "seed"])
        .current_dir(repo.path()).status().unwrap();

    let cwd = repo.path().to_string_lossy().to_string();
    let (state, recording, sink) = test_setup();
    start_git_watcher_inner(&cwd, sink.clone(), &state).expect("start");

    let baseline = recording.count("git-head-changed");
    Command::new("git").args(["switch", "-c", "feat"])
        .current_dir(repo.path()).status().unwrap();

    wait_for_next_event(&recording, "git-head-changed", baseline, 2_000).expect("head event");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p vimeflow test_head_change_in_main_emits_git_head_changed -- --nocapture`
Expected: FAIL — no emit path yet.

- [ ] **Step 3: Extend the fan-out helper and the debounce emit**

Find `emit_for_all_subscribers` (around `watcher.rs:1258`) and change it to accept a `head_dirty` consumed-flag:

```rust
fn emit_for_all_subscribers(
    events: &Arc<dyn EventSink>,
    state: &GitWatcherState,
    toplevel: &std::path::Path,
    head_was_dirty: bool,
) {
    let cwds: Vec<String> = {
        let repo_watchers = state.repo_watchers.lock().expect("...");
        if let Some(watcher) = repo_watchers.get(toplevel) {
            watcher.subscribers.keys().cloned().collect()
        } else {
            vec![]
        }
    };

    if !cwds.is_empty() {
        if head_was_dirty {
            emit_git_head_changed(events, cwds.clone());
        }
        emit_git_status_changed(events, cwds);
    }
}
```

Update every call site of `emit_for_all_subscribers` to pass `head_was_dirty`. The trailing-edge emit inside the debounce thread (search for the `emit()` closure passed to `spawn_trailing_debounce_thread`) reads-and-resets `head_dirty`:

```rust
let head_was_dirty =
    head_dirty.swap(false, Ordering::AcqRel);
emit_for_all_subscribers(&events, &state, &toplevel, head_was_dirty);
```

(Use `swap(false, …)` so concurrent FS events arriving DURING the emit are reflected on the NEXT debounce window, not lost.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p vimeflow git::watcher::tests --lib`
Expected: all PASS, including `test_head_change_in_main_emits_git_head_changed` and the un-ignored `test_head_watch_survives_atomic_rename_replace`.

- [ ] **Step 5: Commit**

```bash
git add crates/backend/src/git/watcher.rs
git commit -m "feat(git-watcher): emit git-head-changed on HEAD moves"
```

---

## Task 7: Initial emit on subscribe

**Files:**

- Modify: `crates/backend/src/git/watcher.rs` (the six call sites of `emit_git_status_changed` for single-cwd initial emits)

- [ ] **Step 1: Write the failing test**

Add to `mod tests`:

```rust
#[tokio::test]
async fn test_start_git_watcher_emits_initial_git_head_changed() {
    let repo = create_temp_repo();
    fs::write(repo.path().join("seed"), "seed").unwrap();
    Command::new("git").args(["add", "."]).current_dir(repo.path()).status().unwrap();
    Command::new("git").args(["commit", "-m", "seed"])
        .current_dir(repo.path()).status().unwrap();

    let cwd = repo.path().to_string_lossy().to_string();
    let (state, recording, sink) = test_setup();

    start_git_watcher_inner(&cwd, sink.clone(), &state).expect("start");

    let recorded = recording.recorded();
    assert!(recorded.iter().any(|(n, p)| n == "git-head-changed" && p.contains(&cwd)),
        "expected initial git-head-changed for the new subscriber, got {:?}",
        recorded.iter().map(|(n, _)| n).collect::<Vec<_>>());
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p vimeflow test_start_git_watcher_emits_initial_git_head_changed -- --nocapture`
Expected: FAIL — only `git-status-changed` is emitted today.

- [ ] **Step 3: Pair every single-cwd `emit_git_status_changed` with `emit_git_head_changed`**

Search `watcher.rs` for `emit_git_status_changed(&events, vec![cwd.to_string()])`. Six call sites. For each, add a sibling line:

```rust
emit_git_head_changed(&events, vec![cwd.to_string()]);
emit_git_status_changed(&events, vec![cwd.to_string()]);
```

Order: head first, status second. (The frontend will see both events; the hook only cares about the one it listens to. Order doesn't affect correctness but keeps the wire stream predictable for log scraping.)

The `emit_for_all_subscribers` path (multi-cwd, triggered by FS events) is NOT touched here — that path is already conditional on `head_was_dirty` from Task 6.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p vimeflow test_start_git_watcher_emits_initial_git_head_changed -- --nocapture`
Expected: PASS.

Also confirm: the existing `test_start_git_watcher_emits_initial_git_status_changed`-style test (if one exists) still passes.

- [ ] **Step 5: Commit**

```bash
git add crates/backend/src/git/watcher.rs
git commit -m "feat(git-watcher): emit initial git-head-changed on subscribe"
```

---

## Task 8: Independent HEAD-content compare in the polling fallback

**Files:**

- Modify: `crates/backend/src/git/watcher.rs:684-745` (the polling thread block)

**The hard part:** in a real watcher process, the notify thread AND the polling thread both call `emit_git_head_changed` on HEAD movement. An end-to-end test where you `git switch` and assert the event fires CAN'T distinguish "notify caught it" from "polling caught it." Codex flagged this in plan review: testing the polling fallback end-to-end requires either disabling notify (no clean way in `notify` crate) or testing the comparator directly.

Extract the HEAD-content comparison into a free function and unit-test it directly. The polling thread then becomes a thin caller.

- [ ] **Step 1: Write the failing tests for the comparator**

Add to `mod tests`:

```rust
#[test]
fn test_detect_head_change_returns_true_on_first_read() {
    // Initial state: no cached content yet → first read is a "change".
    let mut last: Option<String> = None;
    let changed = detect_head_change_with(&mut last, || {
        Ok::<_, std::io::Error>("ref: refs/heads/main\n".to_string())
    });
    assert!(changed);
    assert_eq!(last.as_deref(), Some("ref: refs/heads/main\n"));
}

#[test]
fn test_detect_head_change_returns_false_when_content_identical() {
    let mut last: Option<String> = Some("ref: refs/heads/main\n".to_string());
    let changed = detect_head_change_with(&mut last, || {
        Ok::<_, std::io::Error>("ref: refs/heads/main\n".to_string())
    });
    assert!(!changed);
}

#[test]
fn test_detect_head_change_returns_true_when_ref_differs() {
    let mut last: Option<String> = Some("ref: refs/heads/main\n".to_string());
    let changed = detect_head_change_with(&mut last, || {
        Ok::<_, std::io::Error>("ref: refs/heads/feat\n".to_string())
    });
    assert!(changed);
    assert_eq!(last.as_deref(), Some("ref: refs/heads/feat\n"));
}

#[test]
fn test_detect_head_change_returns_false_when_read_errs() {
    // Worktree removed, permissions, etc. — last_content stays as-is.
    let mut last: Option<String> = Some("ref: refs/heads/main\n".to_string());
    let changed = detect_head_change_with::<_, std::io::Error>(&mut last, || {
        Err(std::io::Error::new(std::io::ErrorKind::NotFound, "gone"))
    });
    assert!(!changed);
    assert_eq!(last.as_deref(), Some("ref: refs/heads/main\n"));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p vimeflow detect_head_change -- --nocapture`
Expected: FAIL — `detect_head_change_with` doesn't exist.

- [ ] **Step 3: Add the comparator and integrate into the polling thread**

Add near `hash_git_status` in `watcher.rs`:

```rust
/// True iff reading HEAD via `reader` produces content different from
/// `last_content`. Always updates `last_content` on success. Returns false
/// on first read with no cached content (the caller should treat the first
/// successful read as the baseline, NOT as a change — flipping the polarity
/// would emit a spurious `git-head-changed` immediately on subscribe; that
/// initial emit is already covered by Task 7's start-of-subscription path).
fn detect_head_change_with<R, E>(
    last_content: &mut Option<String>,
    reader: R,
) -> bool
where
    R: FnOnce() -> Result<String, E>,
{
    match reader() {
        Ok(current) => {
            let differs = last_content.as_deref() != Some(current.as_str());
            *last_content = Some(current);
            // First-read case: differs is true because `None != Some(_)`. The
            // initial emit on subscribe (Task 7) covers this separately; we
            // return false here to avoid double-emit.
            if last_content.is_some() && differs {
                let was_first = matches!(last_content, Some(_)) && last_content.as_ref().map(|s| s.is_empty()).unwrap_or(false);
                let _ = was_first;
                differs
            } else {
                differs
            }
        }
        Err(_) => false,
    }
}
```

Wait — the "first read isn't a change" logic is fiddly. Cleaner: only return `true` when `last_content` was `Some(prev)` and `prev != current`:

```rust
fn detect_head_change_with<R, E>(
    last_content: &mut Option<String>,
    reader: R,
) -> bool
where
    R: FnOnce() -> Result<String, E>,
{
    let current = match reader() {
        Ok(c) => c,
        Err(_) => return false,
    };
    let differs = match last_content.as_deref() {
        Some(prev) => prev != current,
        None => false, // First successful read seeds the cache without emitting.
    };
    *last_content = Some(current);
    differs
}
```

Update the first test accordingly: `test_detect_head_change_returns_true_on_first_read` becomes `test_detect_head_change_returns_false_on_first_read_but_seeds_cache`:

```rust
#[test]
fn test_detect_head_change_returns_false_on_first_read_but_seeds_cache() {
    let mut last: Option<String> = None;
    let changed = detect_head_change_with(&mut last, || {
        Ok::<_, std::io::Error>("ref: refs/heads/main\n".to_string())
    });
    assert!(!changed, "first read seeds the cache without emitting");
    assert_eq!(last.as_deref(), Some("ref: refs/heads/main\n"));
}
```

The polling thread then becomes a thin caller around this helper:

```rust
// Inside the polling-thread closure, alongside the existing status-hash compare:
let head_changed = {
    let mut last = poll_last_head_content.lock().unwrap();
    detect_head_change_with(&mut last, || {
        std::fs::read_to_string(poll_git_dir.join("HEAD"))
    })
};
if head_changed {
    let cwds = collect_subscriber_cwds(&poll_state, &poll_toplevel);
    if !cwds.is_empty() {
        emit_git_head_changed(&poll_events, cwds);
    }
}
```

Seed the cache at `RepoWatcher` construction (Phase 2 builder):

```rust
let initial_head = std::fs::read_to_string(git_dir.join("HEAD")).ok();
let last_head_content = Arc::new(Mutex::new(initial_head));
```

Note: the initial seed bypasses `detect_head_change_with` (no comparator runs); first poll-cycle read will compare against the seeded content.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p vimeflow detect_head_change -- --nocapture`
Expected: PASS (all four comparator tests).

Optional end-to-end check (slow, depends on POLL_INTERVAL_SECS=10): add a separate `#[tokio::test] #[ignore] async fn` that performs the live `git switch` and waits ~12 s. Marked `#[ignore]` so it doesn't slow normal CI runs; run with `cargo test -- --ignored` for manual verification.

Extract a small helper for the subscriber-list collection if the body repeats too much:

```rust
fn collect_subscriber_cwds(state: &GitWatcherState, toplevel: &std::path::Path) -> Vec<String> {
    let repo_watchers = state.repo_watchers.lock().expect("lock repo_watchers");
    repo_watchers
        .get(toplevel)
        .map(|w| w.subscribers.keys().cloned().collect())
        .unwrap_or_default()
}
```

Add `last_head_content` to `RepoWatcher`:

```rust
struct RepoWatcher {
    // ...
    last_head_content: Arc<Mutex<Option<String>>>,
}
```

- [ ] **Step 5: Commit**

```bash
git add crates/backend/src/git/watcher.rs
git commit -m "feat(git-watcher): polling fallback compares HEAD content independently"
```

---

## Task 9: `git_branch` IPC: short-SHA fallback (preserves Err)

**Files:**

- Modify: `crates/backend/src/git/mod.rs:1009-1042`
- Test (existing test module): `crates/backend/src/git/mod.rs` `#[cfg(test)] mod tests`

- [ ] **Step 1: Update the failing test (existing)**

Find `test_git_branch_returns_empty_for_detached_head` at `mod.rs:1757`. The test today asserts `Ok("")` for detached HEAD; after this task it must assert `Ok(<7-char SHA>)`. Rename and rewrite:

```rust
#[tokio::test]
async fn test_git_branch_detached_head_returns_short_sha() {
    let repo = home_tempdir();
    configure_test_git(repo.path());
    Command::new("git").args(["init"]).current_dir(repo.path()).status().unwrap();
    fs::write(repo.path().join("seed"), "seed").unwrap();
    Command::new("git").args(["add", "."]).current_dir(repo.path()).status().unwrap();
    Command::new("git").args(["commit", "-m", "seed"])
        .current_dir(repo.path()).status().unwrap();

    // Capture full SHA, then detach to it.
    let out = Command::new("git").args(["rev-parse", "HEAD"])
        .current_dir(repo.path()).output().unwrap();
    let full_sha = String::from_utf8(out.stdout).unwrap().trim().to_string();
    Command::new("git").args(["switch", "--detach", &full_sha])
        .current_dir(repo.path()).status().unwrap();

    let path = repo.path().to_string_lossy().to_string();
    let branch = git_branch(path).await.expect("git_branch");
    assert_eq!(branch.len(), 7, "short SHA should be exactly 7 chars: {:?}", branch);
    assert!(full_sha.starts_with(&branch),
        "short SHA must be a prefix of the full SHA: short={branch} full={full_sha}");
}
```

Also confirm `test_git_branch_returns_error_for_non_repo_cwd` (around `mod.rs:1804`) still expects `Err` — it does, and we must keep that contract.

- [ ] **Step 2: Run tests to verify the detached test now fails**

Run: `cargo test -p vimeflow test_git_branch_detached_head_returns_short_sha -- --nocapture`
Expected: FAIL — current impl returns `""`.

Also run: `cargo test -p vimeflow test_git_branch_returns_error_for_non_repo_cwd -- --nocapture`
Expected: PASS (we want it to keep passing after the change).

- [ ] **Step 3: Implement the short-SHA fallback in `git_branch_inner`**

Replace the body of `git_branch_inner` (around `mod.rs:1013`) with:

```rust
pub(crate) async fn git_branch_inner(cwd: String) -> Result<String, String> {
    let safe_cwd = validate_cwd(&cwd)?;

    // Step 1: try symbolic-ref. -q makes stderr empty for the detached-HEAD
    // case (which is what we use to distinguish "no symref" from real errors).
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(&safe_cwd)
        .arg("symbolic-ref")
        .arg("-q")
        .arg("--short")
        .arg("HEAD")
        .env("GIT_TERMINAL_PROMPT", "0");
    let output = run_git_with_timeout(cmd).await?;

    if output.status.success() {
        let branch = String::from_utf8(output.stdout)
            .map_err(|e| format!("git_branch utf8: {}", e))?
            .trim()
            .to_string();
        return Ok(branch);
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    if !stderr.trim().is_empty() {
        // Real error (not a repo, permission, etc.) — preserve Err contract.
        return Err(format!("git_branch: {stderr}"));
    }

    // Step 2: detached HEAD. Fall back to short SHA.
    let mut rev = Command::new("git");
    rev.arg("-C")
        .arg(&safe_cwd)
        .arg("rev-parse")
        .arg("--short=7")
        .arg("--verify")
        .arg("HEAD")
        .env("GIT_TERMINAL_PROMPT", "0");
    let rev_out = run_git_with_timeout(rev).await?;

    if rev_out.status.success() {
        let sha = String::from_utf8(rev_out.stdout)
            .map_err(|e| format!("git_branch rev-parse utf8: {}", e))?
            .trim()
            .to_string();
        return Ok(sha);
    }

    // Broken / unborn HEAD — match the existing no-symref empty-string behavior.
    Ok(String::new())
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p vimeflow test_git_branch_ -- --nocapture`
Expected: all `test_git_branch_*` PASS, including:

- `test_git_branch_returns_default_branch_for_unborn_repo`
- `test_git_branch_detached_head_returns_short_sha` (new behavior)
- `test_git_branch_returns_error_for_non_repo_cwd` (still Err)
- `test_git_branch_returns_error_for_non_detached_git_failure` (still Err)
- `test_git_branch_rejects_out_of_scope_cwd` (still Err)

- [ ] **Step 5: Commit**

```bash
git add crates/backend/src/git/mod.rs
git commit -m "feat(git-branch): short-SHA fallback for detached HEAD"
```

---

## Task 10: `useGitBranch` — event subscription + watcher lifecycle

**Files:**

- Modify: `src/features/diff/hooks/useGitBranch.ts`
- Modify: `src/features/diff/hooks/useGitBranch.test.ts`

- [ ] **Step 1: Write the failing tests**

Update `useGitBranch.test.ts`. Add a top-level mock for `listen`:

```typescript
import { invoke, listen } from '../../../lib/backend'

vi.mock('../../../lib/backend', () => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}))
```

Add tests:

```typescript
test('attaches git-head-changed listener BEFORE invoking start_git_watcher', async () => {
  const callOrder: string[] = []
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    callOrder.push(`invoke:${cmd}`)
    return cmd === 'git_branch' ? 'main' : undefined
  })
  vi.mocked(listen).mockImplementation(async () => {
    callOrder.push('listen')
    return () => {}
  })

  renderHook(() => useGitBranch('/home/test/repo'))

  await waitFor(() => {
    expect(callOrder.indexOf('listen')).toBeLessThan(
      callOrder.indexOf('invoke:start_git_watcher')
    )
  })
})

test('refetches branch when git-head-changed event includes our cwd', async () => {
  let captured: ((payload: { cwds: string[] }) => void) | null = null
  vi.mocked(listen).mockImplementation(async (_event, cb) => {
    captured = cb as (payload: { cwds: string[] }) => void
    return () => {}
  })
  vi.mocked(invoke)
    .mockResolvedValueOnce('main') // initial fetch
    .mockResolvedValueOnce(undefined) // start_git_watcher
    .mockResolvedValueOnce('feat/x') // refresh-triggered fetch

  const { result } = renderHook(() => useGitBranch('/home/test/repo'))
  await waitFor(() => expect(result.current.branch).toBe('main'))

  act(() => captured!({ cwds: ['/home/test/repo'] }))
  await waitFor(() => expect(result.current.branch).toBe('feat/x'))
})

test('ignores git-head-changed event when cwds do not match', async () => {
  let captured: ((payload: { cwds: string[] }) => void) | null = null
  vi.mocked(listen).mockImplementation(async (_event, cb) => {
    captured = cb as (payload: { cwds: string[] }) => void
    return () => {}
  })
  vi.mocked(invoke)
    .mockResolvedValueOnce('main')
    .mockResolvedValueOnce(undefined)

  const { result } = renderHook(() => useGitBranch('/home/test/repo'))
  await waitFor(() => expect(result.current.branch).toBe('main'))

  vi.mocked(invoke).mockClear()
  act(() => captured!({ cwds: ['/home/other'] }))
  // Nothing to await for — assert no refetch.
  expect(invoke).not.toHaveBeenCalled()
})

test('cleanup unlistens before stopping watcher and stops only after start completes', async () => {
  const order: string[] = []
  vi.mocked(listen).mockImplementation(async () => {
    order.push('listen')
    return () => order.push('unlisten')
  })
  let resolveStart: () => void = () => {}
  const startPromise = new Promise<void>((resolve) => {
    resolveStart = resolve
  })
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    order.push(`invoke:${cmd}`)
    if (cmd === 'start_git_watcher') return startPromise
    if (cmd === 'git_branch') return 'main'
    return undefined
  })

  const { unmount } = renderHook(() => useGitBranch('/home/test/repo'))
  await waitFor(() => expect(order).toContain('listen'))
  unmount()
  // Resolve the start AFTER unmount, then assert order.
  resolveStart()
  await waitFor(() => expect(order).toContain('invoke:stop_git_watcher'))
  expect(order.indexOf('unlisten')).toBeLessThan(
    order.indexOf('invoke:stop_git_watcher')
  )
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/diff/hooks/useGitBranch.test.ts`
Expected: FAIL — hook doesn't subscribe to events yet.

- [ ] **Step 3: Add the second effect to `useGitBranch.ts`**

Append a new effect, after the existing fetch effect, before the `return { … }` block:

```typescript
const unlistenRef = useRef<(() => void) | null>(null)

useEffect((): (() => void) | undefined => {
  if (!enabled || !isValidCwd(cwd)) return undefined

  let mounted = true
  let listenerAttached = false
  let watcherStarted = false

  const setup = async (): Promise<void> => {
    try {
      const unlisten = await listen<{ cwds: string[] }>(
        'git-head-changed',
        (payload) => {
          if (payload.cwds.includes(cwd)) {
            setRefreshKey((k) => k + 1)
          }
        }
      )
      if (!mounted) {
        unlisten()
        return
      }
      unlistenRef.current = unlisten
      listenerAttached = true

      await invoke('start_git_watcher', { cwd })
      watcherStarted = true

      if (mounted) {
        setRefreshKey((k) => k + 1)
      }
    } catch (err) {
      if (mounted) {
        setError(err instanceof Error ? err : new Error(String(err)))
      }
    }
  }

  const setupPromise = setup()

  return (): void => {
    mounted = false
    void (async () => {
      if (listenerAttached && unlistenRef.current) {
        unlistenRef.current()
        unlistenRef.current = null
      }
      await setupPromise.catch(() => {})
      if (watcherStarted) {
        await invoke('stop_git_watcher', { cwd }).catch(() => {})
      }
    })()
  }
}, [cwd, enabled])
```

Add imports at the top of the file:

```typescript
import { invoke, listen } from '../../../lib/backend'
import { useCallback, useEffect, useRef, useState } from 'react'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/diff/hooks/useGitBranch.test.ts`
Expected: all PASS, including the four new tests above.

Also run the existing test file end-to-end:

Run: `npm run lint -- src/features/diff/hooks/useGitBranch.ts src/features/diff/hooks/useGitBranch.test.ts`
Expected: clean (no semicolons, single quotes, explicit return types).

- [ ] **Step 5: Commit**

```bash
git add src/features/diff/hooks/useGitBranch.ts src/features/diff/hooks/useGitBranch.test.ts
git commit -m "feat(useGitBranch): subscribe to git-head-changed for live updates"
```

---

## Task 11: Worktree-specific Rust tests + fixture

**Files:**

- Modify: `crates/backend/src/git/test_helpers.rs`
- Modify: `crates/backend/src/git/watcher.rs` `#[cfg(test)] mod tests`

- [ ] **Step 1: Add the fixture**

In `test_helpers.rs`:

```rust
/// Create a main repo + N linked worktrees in a tempdir under $HOME.
/// Commits a seed file to the main repo first so worktree branches
/// have a parent. Worktree dirs are SIBLINGS of the main repo dir
/// (not nested inside it) to avoid the .claude/worktrees/-style
/// "untracked inside main working tree" concern in tests.
pub(crate) fn create_main_repo_with_worktrees(
    branches: &[&str],
) -> (TempDir, PathBuf, Vec<PathBuf>) {
    let tmp = home_tempdir();
    let main = tmp.path().join("main");
    std::fs::create_dir(&main).unwrap();

    std::process::Command::new("git")
        .args(["init"])
        .current_dir(&main)
        .status()
        .unwrap();
    configure_test_git(&main);
    std::fs::write(main.join("seed"), "seed").unwrap();
    std::process::Command::new("git")
        .args(["add", "."])
        .current_dir(&main)
        .status()
        .unwrap();
    std::process::Command::new("git")
        .args(["commit", "-m", "seed"])
        .current_dir(&main)
        .status()
        .unwrap();

    let mut worktrees = Vec::with_capacity(branches.len());
    for (i, branch) in branches.iter().enumerate() {
        let wt = tmp.path().join(format!("wt-{i}"));
        std::process::Command::new("git")
            .args([
                "worktree", "add", "-b", branch, wt.to_str().unwrap(),
            ])
            .current_dir(&main)
            .status()
            .unwrap();
        worktrees.push(wt);
    }

    (tmp, main, worktrees)
}
```

- [ ] **Step 2: Add the tests**

In `watcher.rs#[cfg(test)] mod tests`:

```rust
#[tokio::test]
async fn test_head_change_in_worktree_emits_for_worktree_only() {
    let (_tmp, main, wts) =
        create_main_repo_with_worktrees(&["feat"]);
    let main_cwd = main.to_string_lossy().to_string();
    let wt_cwd = wts[0].to_string_lossy().to_string();
    let (state, recording, sink) = test_setup();

    start_git_watcher_inner(&main_cwd, sink.clone(), &state).expect("start main");
    start_git_watcher_inner(&wt_cwd, sink.clone(), &state).expect("start wt");
    let baseline = recording.count("git-head-changed");

    Command::new("git").args(["switch", "-c", "feat2"])
        .current_dir(&wts[0]).status().unwrap();

    wait_for_next_event(&recording, "git-head-changed", baseline, 2_000)
        .expect("head event for worktree");
    // The wt event must list ONLY the worktree cwd.
    let recorded = recording.recorded();
    let head_events: Vec<_> = recorded
        .iter()
        .filter(|(n, _)| n == "git-head-changed")
        .collect();
    assert!(head_events.iter().any(|(_, p)| p.contains(&wt_cwd) && !p.contains(&main_cwd)),
        "git-head-changed must list only the worktree cwd, got: {:?}", head_events);
}

#[tokio::test]
async fn test_pre_repo_upgrades_to_linked_worktree_and_emits_initial_head_event() {
    let tmp = home_tempdir();
    let main = tmp.path().join("main");
    std::fs::create_dir(&main).unwrap();
    Command::new("git").args(["init"]).current_dir(&main).status().unwrap();
    configure_test_git(&main);
    std::fs::write(main.join("seed"), "seed").unwrap();
    Command::new("git").args(["add", "."]).current_dir(&main).status().unwrap();
    Command::new("git").args(["commit", "-m", "seed"]).current_dir(&main).status().unwrap();

    let wt = tmp.path().join("wt-pending");
    // Subscribe BEFORE the worktree exists — pre-repo path.
    let wt_cwd = wt.to_string_lossy().to_string();
    std::fs::create_dir(&wt).unwrap();
    let (state, recording, sink) = test_setup();
    start_git_watcher_inner(&wt_cwd, sink.clone(), &state).expect("subscribe pre-repo");

    // Now create the worktree.
    Command::new("git").args(["worktree", "add", "-b", "feat",
        wt.to_str().unwrap()]).current_dir(&main).status().unwrap();

    // Re-subscribe to trigger the pre-repo → repo upgrade. (In production,
    // the upgrade fires on the next subscription start for the same cwd.)
    // Trigger the production upgrade path directly. The pre-repo polling
    // thread calls upgrade_to_repo_watcher every POLL_INTERVAL_SECS; calling
    // it here makes the test deterministic and exercises the same function
    // the polling thread calls.
    let baseline = recording.count("git-head-changed");
    upgrade_to_repo_watcher(
        validate_cwd(&wt_cwd).unwrap(),
        sink.clone(),
        state.clone(),
    );

    wait_for_next_event(&recording, "git-head-changed", baseline, 2_000)
        .expect("initial git-head-changed on upgrade");
}

#[tokio::test]
async fn test_two_worktrees_independent_head_events() {
    let (_tmp, main, wts) =
        create_main_repo_with_worktrees(&["feat-a", "feat-b"]);
    let (state, recording, sink) = test_setup();

    let main_cwd = main.to_string_lossy().to_string();
    let wt_a_cwd = wts[0].to_string_lossy().to_string();
    let wt_b_cwd = wts[1].to_string_lossy().to_string();

    start_git_watcher_inner(&main_cwd, sink.clone(), &state).unwrap();
    start_git_watcher_inner(&wt_a_cwd, sink.clone(), &state).unwrap();
    start_git_watcher_inner(&wt_b_cwd, sink.clone(), &state).unwrap();
    let baseline = recording.count("git-head-changed");

    Command::new("git").args(["switch", "-c", "feat-a-2"])
        .current_dir(&wts[0]).status().unwrap();
    wait_for_next_event(&recording, "git-head-changed", baseline, 2_000).unwrap();

    let recorded = recording.recorded();
    let payloads_with_wt_b: Vec<_> = recorded.iter()
        .filter(|(n, p)| n == "git-head-changed" && p.contains(&wt_b_cwd))
        .collect();
    assert!(payloads_with_wt_b.is_empty(),
        "wt-b must NOT receive git-head-changed for an event in wt-a, got: {:?}",
        payloads_with_wt_b);
}

#[tokio::test]
async fn test_worktree_removal_drops_branch() {
    let (_tmp, main, wts) =
        create_main_repo_with_worktrees(&["feat"]);
    let wt_cwd = wts[0].to_string_lossy().to_string();
    let (state, recording, sink) = test_setup();
    start_git_watcher_inner(&wt_cwd, sink.clone(), &state).unwrap();

    Command::new("git").args(["worktree", "remove", "--force",
        wts[0].to_str().unwrap()]).current_dir(&main).status().unwrap();

    // After removal, git_branch_inner against the now-gone cwd must Err
    // (NOT silently return Ok("")).
    let result = crate::git::git_branch_inner(wt_cwd).await;
    assert!(result.is_err(),
        "git_branch must Err after worktree removed, got {:?}", result);
}
```

- [ ] **Step 3: Run the new tests**

Run: `cargo test -p vimeflow git::watcher::tests::test_head_change_in_worktree -- --nocapture`
Run: `cargo test -p vimeflow git::watcher::tests::test_pre_repo_upgrades -- --nocapture`
Run: `cargo test -p vimeflow git::watcher::tests::test_two_worktrees_independent -- --nocapture`
Run: `cargo test -p vimeflow git::watcher::tests::test_worktree_removal_drops_branch -- --nocapture`

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add crates/backend/src/git/test_helpers.rs crates/backend/src/git/watcher.rs
git commit -m "test(git-watcher): worktree fixtures + cross-worktree isolation"
```

---

## Task 12: README `.gitignore` note for `.claude/worktrees/`

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Find the right section in the README**

Search for an existing "Tips" / "Notes" / "Shell Setup" section. If a Git-related subsection exists, place the note there; otherwise add a short new section.

- [ ] **Step 2: Add the note**

Add this content (adjust heading depth to match surrounding structure):

```markdown
### Linked worktrees inside the repo

If you create linked worktrees inside the project (e.g. `git worktree add .claude/worktrees/feat-x …`), add `.claude/worktrees/` to `.gitignore`. The directory will otherwise appear as untracked in `git status` from the main repo, and the watcher will fire extra `git-status-changed` events for FS activity inside the worktree (branch label and diff panel still correct — just chattier than necessary).
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): recommend gitignore for nested linked worktrees"
```

---

## Self-Review (Run This Before Calling The Plan Complete)

1. **Spec coverage** — every section's requirements have a task:
   - §1 (scope, success criteria) — covered by Tasks 1–11 in aggregate.
   - §2 (per-pane gitdir, refcount stop) — Tasks 1, 2.
   - §3 (event design, classification, polling) — Tasks 3, 4, 5, 6, 7, 8.
   - §4 (frontend hook, IPC contract) — Tasks 9, 10.
   - §5 (edge cases — pre-repo upgrade, removal, empty repo) — Tasks 7, 11; Task 9 covers detached HEAD + non-repo Err contract.
   - §6 (testing) — Tasks 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11.
   - §7 (out-of-scope, risks, migration) — Task 12 (the .gitignore note); the rest are non-code.
2. **Placeholder scan** — no TBD/TODO/FIXME; every step has either code or an exact command.
3. **Type consistency** — `GitHeadChangedPayload` shape matches across §3 and Task 5; `cwd_to_repo` value type `(PathBuf, PathBuf)` matches Tasks 1 (after edit) and 2; `path_is_git_head(path, git_dir)` signature consistent in Task 4 and the notify callback.

---

## Plan Complete

Plan committed. **STOP HERE** — control returns to `/lifeline:planner` for codex plan-complete review. Do NOT chain to `executing-plans` or `subagent-driven-development`. The implementation phase begins after codex review (Step 9.C of the planner skill) finishes and any findings are applied.

<!-- codex-reviewed: 2026-05-19T09:12:26Z -->
