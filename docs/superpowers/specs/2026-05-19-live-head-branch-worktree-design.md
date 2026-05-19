# Live HEAD/Branch Detection with Worktree Support — Design Spec

**Date:** 2026-05-19
**Issue:** [#189 — feat(terminal): live-detect branch changes in pane Header](https://github.com/winoooops/vimeflow/issues/189)
**Status:** draft

---

## 1. Overview & Scope

**Background.** Today, every `TerminalPane`'s `Header` shows a static branch label fetched once via the `git_branch` IPC on mount (and re-fetched on `cwd` change or manual `refresh()`). The watcher at `crates/backend/src/git/watcher.rs:671` already watches `<toplevel>/.git/HEAD`, but FS events on that path are folded into the broader `git-status-changed` event — there is no dedicated `git-head-changed` channel, and `useGitBranch` does not subscribe to any backend events. Two regressions follow:

1. **Stale label on branch switch.** When an agent runs `git switch <branch>` inside a pane, the Header keeps showing the old branch until the user manually refreshes (or changes `cwd`).
2. **Broken inside linked worktrees.** When a pane's `cwd` is a linked worktree (e.g. `~/repo/.claude/worktrees/feat-x`), `<toplevel>/.git` is a **file** containing `gitdir: <main>/.git/worktrees/feat-x`, not a directory. The path `<toplevel>/.git/HEAD` does not exist, so the watcher silently fails to register the HEAD watch for that pane — and even if a `git-head-changed` event were added against the main repo's `.git/HEAD`, it would never fire for HEAD movements that happen _inside_ the linked worktree's per-worktree `HEAD` file.

**User story.** Agents (Claude Code, Codex) routinely run flows that span the main repo and one or more linked worktrees — `git worktree add .claude/worktrees/feat-x -b feat/x`, then `cd` into the worktree and iterate. Each pane's Header must always reflect the branch currently checked out in _that pane's `cwd`_, including when the agent switches branches or moves between worktrees mid-session.

### In scope

| Behavior                                                                                   | Where it shows up                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live HEAD-change detection in the **main repo**                                            | `git switch`, `git checkout`, `git commit` (HEAD moves when branchless), interactive rebase, bisect                                                                                                                                                                                   |
| Live HEAD-change detection in **linked worktrees**                                         | Same actions, run from a `cwd` whose `.git` is a file pointing into `<main>/.git/worktrees/<name>/`                                                                                                                                                                                   |
| **Per-pane resolution** — pane in main, pane in worktree, two panes in different worktrees | Each pane resolves its own gitdir; subscriptions are bucketed per `--show-toplevel` (already true today; just needs the gitdir path)                                                                                                                                                  |
| **Detached HEAD label**                                                                    | Header shows abbreviated SHA (same styling as a branch name, mono font) when `git symbolic-ref HEAD` fails. `git_branch` IPC contract extended to fall back to `git rev-parse --short HEAD` instead of returning `""`; see §4 for the contract change and the `useGitBranch` mapping. |
| **Pane `cwd` changes mid-session** (`cd ../worktree-x`)                                    | OSC 7 backfill triggers `useGitBranch` `cwd`-effect; old subscription is torn down, new one is set up                                                                                                                                                                                 |

### Out of scope

- Cross-pane / cross-worktree fan-out **for HEAD/branch events** (`git-head-changed` for Pane B in `feat-x` does not also notify Pane A in main; each pane is bucketed by its own `--show-toplevel`). Note: when a linked worktree directory sits _inside_ the main repo's working tree (`.claude/worktrees/feat-x/`) and is **not** in `.gitignore`, the main repo's recursive working-tree watch and its `git status --untracked-files=all` will observe changes inside that nested worktree and emit `git-status-changed` for the main pane. That is accepted noise on the _status_ channel — not a contradiction of `git-head-changed`'s per-bucket independence. We mitigate it by recommending `.claude/worktrees/` in `.gitignore` (see §7).
- Bare repos and submodules. The gitdir resolver (`git rev-parse --git-dir`) returns the right thing in both cases, but neither is exercised today and we won't add fixtures for them.
- Refs-only updates (`git fetch` updating `refs/heads/feature` without HEAD moving). HEAD itself is unchanged; the branch _name_ is unchanged; nothing to re-render.
- A "list of worktrees" sidebar view. Out of #189's scope; will get its own issue.
- A `.gitignore` rule for `.claude/worktrees/`. Worth a separate README/docs note (linked worktrees inside the main working tree appear as untracked in the main repo's `git status`); not the watcher's problem.

### Success criteria

A pane in the main repo and a pane in a linked worktree both display the correct branch within the 300 ms watcher debounce of any HEAD-moving operation, with zero manual `refresh()` calls. Closing and reopening the pane is not required.

---

## 2. Architecture: Per-Pane Gitdir Resolution

The structural change is small in code surface but precise about which path is which.

### What we resolve, per pane

`crates/backend/src/git/watcher.rs` currently resolves a single path per subscribing pane: `--show-toplevel`, canonicalized and validated to be under `$HOME`. We add a **second** resolution:

```
toplevel  = canonical(git -C <cwd> rev-parse --show-toplevel)
git_dir   = canonical(git -C <cwd> rev-parse --path-format=absolute --git-dir)
            then validate it's under $HOME (same scope rule as toplevel)
```

The `--path-format=absolute` flag is load-bearing. Without it, `git rev-parse --git-dir` can return a path **relative to `<cwd>`** (e.g. `.git` in the main repo when invoked with `-C <toplevel>`). A subsequent `canonicalize()` of a relative path resolves it against the _sidecar process cwd_, not the pane cwd — a silently wrong repo, or an error. `--path-format=absolute` makes git emit an absolute path before we ever touch it.

`--git-dir` returns:

- `<toplevel>/.git` in the main repo (a directory)
- `<main>/.git/worktrees/<name>` in a linked worktree (a directory under the main `.git/`)
- A bare-repo path in a bare repo (out of scope, but resolver still returns something sane)

Both are resolved once at **subscription time** (the same path that currently calls `resolve_toplevel`), passed alongside `toplevel` into the `RepoWatcher` struct, and reused for the lifetime of the bucket. We don't re-resolve on every event.

### Bucket model — unchanged

The watcher keeps its existing `repo_watchers: HashMap<PathBuf /* canonical toplevel */, RepoWatcher>` map. Two panes in the same linked worktree share a bucket; two panes in _different_ worktrees of the same main repo get **different** buckets, because `--show-toplevel` returns different paths. This is already the right semantic — no change needed.

The `cwd_to_toplevel` side-map (the cwd-string → canonical-toplevel map that today serves as a **stop-time routing aid**, not a start-time `rev-parse` memoization) gets the `gitdir` added to its value. Cleanest form is to widen the existing entry: `cwd_to_toplevel: HashMap<String, (PathBuf /* toplevel */, PathBuf /* gitdir */)>` (renamed `cwd_to_repo` to reflect the new shape). Populated at subscription start.

**Refcount-aware stop is a prerequisite.** Today (`watcher.rs:1162–1172`), `stop_git_watcher_inner` unconditionally `cwd_to_toplevel.remove(&cwd)` on the FIRST stop. With only `useGitStatus` calling `start_git_watcher` today, this is fine — there's one start per cwd, one stop per cwd. As soon as `useGitBranch` _also_ calls `start_git_watcher` for the same cwd (this spec, §4), we have two starts and two stops. The current unconditional removal turns the second `stop_git_watcher` into a silent no-op (recorded_toplevel becomes `None`, falls into the pre-repo branch, returns `Ok(())` without touching the bucket). The bucket's `subscribers[cwd]` counter stays at 1 forever → polling thread leaks.

Fix in `stop_git_watcher_inner` (small, surgical):

```rust
// peek instead of remove. (Field name is cwd_to_repo after the rename; the
// value is the (toplevel, gitdir) tuple — we destructure to recover the
// canonical toplevel that `repo_watchers` is keyed by.)
let recorded = state.cwd_to_repo.lock()?.get(&cwd).cloned();
if let Some((canonical_toplevel, _gitdir)) = recorded {
    let mut repo_watchers = state.repo_watchers.lock()?;
    if let Some(watcher) = repo_watchers.get_mut(&canonical_toplevel) {
        if let Some(count) = watcher.subscribers.get_mut(&cwd) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                watcher.subscribers.remove(&cwd);
                // NOW (only when this cwd's last subscriber is gone) remove
                // from the side-map. Future stops for this cwd become a no-op.
                state.cwd_to_repo.lock()?.remove(&cwd);
            }
        }
        if watcher.subscribers.is_empty() { repo_watchers.remove(&canonical_toplevel); }
        return Ok(());
    }
}
```

This is purely additive correctness — same observable behavior for the current single-consumer case, correct refcounting for our new dual-consumer case. The pre-repo branch needs the symmetric fix in `cwd_to_safe_pre_repo` (same peek-then-conditional-remove pattern).

### Watch registration — the concrete delta

Today (`watcher.rs:664-676`) watches the **HEAD and index files directly**:

```rust
let git_index = toplevel.join(".git/index");
if git_index.exists() { /* watcher.watch(&git_index, NonRecursive) */ }

let git_head = toplevel.join(".git/HEAD");
if git_head.exists() { /* watcher.watch(&git_head, NonRecursive) */ }
```

This is **doubly wrong** for our needs. First, the path is wrong in a linked worktree (resolved above). Second — and equally important — git updates `HEAD` and `index` by writing `<file>.lock` and `rename`-ing it over the target. On inotify-style backends (Linux), a watch on a file's _inode_ goes stale once the inode is replaced. The first branch switch may fire an event; subsequent switches silently fail.

After:

```rust
// `git_dir` is the per-worktree gitdir resolved at subscription time.
// Watch the directory non-recursively, NOT the individual files. The
// directory's inode is stable across git's atomic rename-to-replace
// updates of HEAD, index, and packed-refs.
if git_dir.exists() {
    let _ = watcher.watch(&git_dir, RecursiveMode::NonRecursive);
}
```

Then, inside the notify event callback, **filter by full path** (NOT by filename — the recursive-on-toplevel working-tree watch can produce events for user files named `HEAD` anywhere in the tree, and we must not flip `head_dirty` for those):

```rust
let head_path = git_dir.join("HEAD");
let index_path = git_dir.join("index");
let packed_refs_path = git_dir.join("packed-refs");
for path in event.paths {
    if path == head_path {
        bucket.head_dirty = true;
    } else if path == index_path {
        // existing status-changed path
    } else if path == packed_refs_path {
        // ignore — see §7 "Refs-only updates"
    }
    // otherwise: working-tree event or unrelated .git/ top-level file (config, hooks/, etc.) — ignore
}
```

NonRecursive on the gitdir does NOT recurse into `objects/`, `refs/`, `logs/`, `worktrees/`, or `hooks/`, so the watch-budget concern that motivated avoiding `.git/` recursion in the first place is satisfied: we get top-level file events only. The recursive-on-toplevel working-tree watch is unchanged. Full-path equality is the load-bearing rule that keeps the two watches' events disambiguated.

### `validate_cwd` covers `git_dir` too

In a linked worktree, `git_dir` lives under `<main>/.git/worktrees/<name>/`. The existing `validate_cwd` rule ("path is under `$HOME`") applies cleanly: the main repo is under `$HOME`, so its `.git/worktrees/…` is too. Symbolic links inside `.git/` (which git itself may create, e.g. for `commondir`) are followed by `canonicalize()` before validation. No new security primitive needed.

### Resolution cost

One extra `git rev-parse --path-format=absolute --git-dir` per **subscription start**. The current watcher pays one `--show-toplevel` per `start_git_watcher_inner` call (`watcher.rs:506`); we are adding one more shell-out on the same code path. Both run before the Phase-1 `repo_watchers` lookup, so subsequent subscriptions for the same `cwd` (e.g. a tab re-mount) re-pay the cost — there is **no start-side caching** today, and this spec does not add one. `cwd_to_toplevel` / the proposed `cwd_to_repo` map is a stop-time routing aid (used to find the right bucket on unsubscribe), not a memoization of `rev-parse`. `rev-parse` is sub-10 ms locally; +1 shell-out per subscription start is acceptable.

If we ever need this to be cheaper, the right move is a separate optimization PR that introduces a start-time lookup against `cwd_to_repo` _before_ shelling out, with an explicit invalidation rule (e.g. cwd-string stays stable, but the underlying repo could be `mv`'d; invalidate on any subscription-start failure). Out of scope here.

---

## 3. Event Design: `git-head-changed`

### Wire format

Mirror the existing `git-status-changed` event exactly so the frontend's existing dispatch plumbing applies:

```rust
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct GitHeadChangedPayload {
    /// List of input cwds (frontend's original keys) whose HEAD just moved.
    cwds: Vec<String>,
}
```

Event name on the wire: `"git-head-changed"`. Emit with the same helper shape:

```rust
fn emit_git_head_changed(events: &Arc<dyn EventSink>, cwds: Vec<String>) {
    let payload = GitHeadChangedPayload { cwds };
    let result = serialize_event(&payload)
        .and_then(|payload| events.emit_json("git-head-changed", payload));
    if let Err(e) = result {
        log::error!("Failed to emit git-head-changed: {}", e);
    }
}
```

The frontend matches via `event.cwds.includes(myCwd)`, identical to `git-status-changed`. No new IPC primitive, no new dispatcher.

### Where it's emitted

The `notify` watcher closure already receives a `notify::Event` for every filesystem mutation it sees. Today, every event flows into the 300 ms debounce thread (`spawn_trailing_debounce_thread`) and on the trailing-edge emit calls `emit_for_all_subscribers` → `emit_git_status_changed`. We add a **classification step**:

```
on FS event in the notify callback:
  paths = event.paths
  if any(p == git_dir/HEAD for p in paths):
      set bucket.head_dirty = true
  forward the unit signal to the debounce channel (unchanged)

on debounce trailing-edge:
  if bucket.head_dirty:
      emit_git_head_changed(bucket.subscribers)
      bucket.head_dirty = false
  emit_git_status_changed(bucket.subscribers)  // unchanged
```

The `head_dirty` flag lives inside the bucket's `RepoWatcher` struct, mutated under the bucket's existing lock. Two emit calls per debounce window when HEAD was touched, one when it wasn't.

**Why classify in the notify closure, not in the debounce thread?** The debounce thread doesn't receive the event payload — it gets a unit signal (`Sender<()>`). The path information disappears once we cross that boundary. So the only place we know "this burst included a HEAD modify" is the notify callback. The `head_dirty` flag persists across the burst until the trailing-edge emit consumes it.

### Polling-fallback path

The 10 s polling fallback (`watcher.rs:695–745`) runs `hash_git_status` and emits `git-status-changed` when the hash changes. **`hash_git_status` does NOT cover HEAD moves on its own.** `git status --porcelain=v1 -z --untracked-files=all` lists only paths with changes; it does not include the current branch name or HEAD ref. A clean `git switch <branch>` against an unmodified working tree leaves the porcelain output unchanged → status hash unchanged → no `git-status-changed`, and (today) no `git-head-changed`.

So the polling thread runs a **second, independent comparison**: read `<git_dir>/HEAD` (cached per bucket, alongside the status hash). When the file contents (one line — either `ref: refs/heads/<name>` or a 40-char SHA) differ from the cached value, emit `git-head-changed` for this bucket's subscribers — regardless of whether the status hash also changed. The two comparisons fire independently; either may emit, neither blocks the other. Cost: one extra `fs::read_to_string` (≤60 bytes) per 10 s poll per bucket. Cache key is the same `git_dir` resolved at subscription time.

This independence matters because the dominant agent flow we care about — `git switch <existing-branch>` on a clean tree — moves HEAD without producing a status diff. Without the independent comparison, that case would only be caught by the notify watcher, and any inotify-stale window (NFS, FUSE) would lose it for up to a session.

### Debounce semantics

`git-head-changed` shares the 300 ms debounce window with `git-status-changed`. Rationale: a single `git switch <branch>` mutates `<git_dir>/HEAD` _and_ rewrites working-tree files (the checkout) _and_ updates `<git_dir>/index` in rapid succession. Emitting `git-head-changed` immediately on the first HEAD touch would race the index/worktree settle; debouncing them together delivers one cohesive update.

(Note: a normal `git commit` on an attached branch does NOT mutate `<git_dir>/HEAD` — it updates the branch ref under `<git_dir>/refs/heads/`, and `HEAD` remains a `ref:` line pointing at it. HEAD-file mutations happen on switch / checkout / detached-state commit / rebase / bisect. The classification step in §3 is correct for those cases.)

### No replay / no cursor protocol

This is a notification ("HEAD may have moved — re-fetch via `git_branch` IPC"), not a state stream. We do not need the offset/cursor protocol used for PTY output. The frontend, on receiving the event, always invokes `git_branch` — which gets the current authoritative value. A dropped event manifests as up-to-300 ms of staleness until the next FS poke (or the user can `refresh()`), not data loss.

### Fan-out scope

Per-bucket, identical to `git-status-changed`: the event's `cwds` list contains only the subscribers of _this_ bucket (this `toplevel`). Pane A in main and Pane B in linked worktree `feat-x` are in different buckets, so a HEAD move in `feat-x` produces one event whose `cwds` includes only Pane B's cwd — Pane A is untouched.

### Initial emit on subscribe (covers pre-repo upgrade)

The existing watcher emits `git-status-changed` for a single cwd at the end of `start_git_watcher_inner` (`watcher.rs:577, 802, 816, 855, 888, 1004`) so a freshly-subscribed pane refreshes its status immediately, even before any FS event arrives. We add a symmetric `emit_git_head_changed(events, vec![cwd])` at the same call sites.

This covers the pre-repo → linked-worktree upgrade case (§5): when `start_pre_repo_watcher_inner` later transitions to `start_git_watcher_inner` (because `git worktree add` made the directory a repo), the new initial `git-head-changed` emit causes `useGitBranch` to re-fetch and pick up the now-resolvable branch name. Without this emit, the hook would stay at `null` until the user manually refreshed OR the agent moved HEAD again.

Worktree removal is **not** symmetric — there is no transition emit on teardown. Instead, the recursive working-tree watch sees the `Remove` event for `<git_dir>/HEAD` (now-deleted), which the §3 path classifier matches (`p == git_dir.join("HEAD")`) and flips `head_dirty`. The debounced fan-out emits `git-head-changed` to the bucket's remaining subscribers, the hook re-fetches, `git_branch` returns `Err`, the chip drops. The existing path classification covers this without a special teardown emit.

---

## 4. Frontend Integration: `useGitBranch` Subscription

### What changes in the hook

Today, `src/features/diff/hooks/useGitBranch.ts` runs one fetch effect, keyed on `[cwd, enabled, refreshKey]`, that calls `invoke('git_branch', { cwd })` and writes the result to local state. There is **no event subscription and no watcher subscription** — the hook is a pure on-demand fetcher.

After this change, the hook gains a **second effect** that mirrors `useGitStatus`'s watch lifecycle (`useGitStatus.ts:121–199`): attach the listener, start the backend watcher, and tear both down on cleanup. The fetch effect stays as-is.

```ts
// Pseudocode — actual file uses arrow components, explicit return types,
// no semicolons, and follows project ESLint config.
// New effect, added alongside the existing fetch effect.
useEffect(() => {
  if (!enabled || !isValidCwd(cwd)) return

  let mounted = true
  let listenerAttached = false
  let watcherStarted = false

  const setup = async (): Promise<void> => {
    try {
      // Step 1: attach the listener BEFORE invoking start_git_watcher.
      // `listen` resolves only after the transport is attached, so the
      // start_git_watcher call below cannot fire events that we'd miss.
      const unlisten = await listen<GitHeadChangedPayload>(
        'git-head-changed',
        (payload) => {
          if (payload.cwds.includes(cwd)) {
            refresh()
          }
        }
      )
      if (!mounted) {
        unlisten()
        return
      }
      unlistenRef.current = unlisten
      listenerAttached = true

      // Step 2: refcount-add this cwd to the backend watcher bucket. Safe
      // to call when useGitStatus has already started a watcher for the
      // same cwd — the backend refcounts subscribers per cwd.
      await invoke('start_git_watcher', { cwd })
      watcherStarted = true

      // Step 3: explicit refresh, guarded by `mounted`. Covers the
      // listen-attached / watcher-started race window.
      if (mounted) refresh()
    } catch (err) {
      if (mounted) setError(err instanceof Error ? err : new Error(String(err)))
    }
  }

  const setupPromise = setup()

  return (): void => {
    mounted = false
    void (async () => {
      // Step A: unlisten FIRST (synchronous) so a late in-flight event
      // can't call refresh on the torn-down hook. Matches
      // useGitStatus.ts:192-198 exactly.
      if (listenerAttached && unlistenRef.current) {
        unlistenRef.current()
        unlistenRef.current = null
      }
      // Step B: await setupPromise so the start_git_watcher invoke can
      // settle (matches useGitStatus.ts:200-205). Without this, cleanup
      // firing between "listener attached" and "invoke resolved" would
      // skip the stop call (watcherStarted still false), leaking an
      // orphan backend subscription.
      await setupPromise.catch(() => {})
      // Step C: only stop if start actually completed.
      if (watcherStarted) {
        await invoke('stop_git_watcher', { cwd }).catch(() => {})
      }
    })()
  }
}, [cwd, enabled])
```

### Watcher ownership

The hook calls `start_git_watcher` / `stop_git_watcher` directly. This makes `useGitBranch` self-contained — a pane that mounts `useGitBranch` without `useGitStatus` (e.g. a future "branch chip in the project rail" view) still gets live updates. When both hooks run in the same pane (as in today's `TerminalPane/index.tsx`), they both refcount the same backend bucket; the backend's existing subscriber-refcounting logic (`watcher.rs:570`) handles this transparently — start adds 1, stop subtracts 1, the bucket only tears down when the count reaches zero.

We deliberately do **not** introduce a shared "pane git watcher owner" hook. Two reasons: the refcount path already gives us the deduplication we'd want, and coupling `useGitBranch` to `useGitStatus` would make it impossible to use the branch chip in contexts where the file list isn't rendered.

### Matching on `cwd`, not `toplevel`

The event's `cwds: string[]` field carries **the frontend's own cwd strings** (the keys the backend's subscription tables are keyed by). The hook compares its `cwd` prop against `event.cwds` and matches by string equality. This is identical to how `useGitStatus` already filters `git-status-changed`. No `--show-toplevel` resolution is needed on the frontend.

### Subscription lifecycle

The new effect's deps are `[cwd, enabled]` (intentionally NOT `refreshKey` — re-attaching the listener and the watcher on every manual `refresh()` would be wasteful churn):

- **Mount**: attach listener → start watcher → refresh.
- **`cwd` changes** (OSC 7 backfill, manual `cd`): cleanup unlistens and stops the old-cwd watcher; new run does the full setup against the new `cwd`.
- **`enabled` flips to `false`**: cleanup runs; no listener / no watcher until re-enabled.
- **Unmount**: cleanup runs.

The fetch effect retains its `refreshKey` dep so manual `refresh()` calls re-fetch without re-subscribing.

### `git_branch` IPC contract change (detached HEAD)

Today (`git/mod.rs:1013–1042`) the contract distinguishes three exit-code/stderr combinations:

- `symbolic-ref` exits 0 → `Ok(branch)`.
- `symbolic-ref` exits non-zero with **empty stderr** → `Ok("")` (detached HEAD; the `-q` flag suppresses stderr in that case).
- `symbolic-ref` exits non-zero with **non-empty stderr** → `Err` (real failure: not a repo, permission, broken HEAD, etc.).

After this change, the detached-HEAD branch (middle case) gains a fallback. Real errors still surface as `Err`:

1. `git symbolic-ref -q --short HEAD`.
   - Exit 0 → `Ok(name)`.
   - Exit non-zero with **non-empty stderr** → `Err` (unchanged behavior; preserves not-a-repo / permission / etc.).
   - Exit non-zero with **empty stderr** (detached HEAD) → fall through to step 2.
2. `git rev-parse --short=7 --verify HEAD`.
   - Exit 0 → `Ok(short-sha)`.
   - Exit non-zero → `Ok("")` (broken/unborn HEAD — matches today's no-symbol-ref empty-string behavior).

This is **backward-compatible**: every prior `Err` is still an `Err`; every prior `Ok("")` is now `Ok(short-sha)` _or_ still `Ok("")`. The visible behavior change is "the chip now shows a 7-char SHA in detached state instead of disappearing." The hook treats branch names and SHAs identically — the same `trim → null-or-string` mapping — and the Header renders them with the same `text-on-surface-muted` styling (Option 1).

### Empty repository

A freshly `git init`'d repo has no HEAD ref yet. `git symbolic-ref --short HEAD` returns the **unborn branch name** (the value of `init.defaultBranch`, e.g. `main` or `master`, depending on the user's git config) without consulting any object. We honor whatever it returns; the Header reads e.g. `main` even before the first commit. This is consistent with what `git status` shows.

### Test surface

The existing `useGitBranch.test.ts` covers the fetch path. We add three event-driven tests:

- Event with matching `cwd` → branch re-fetched (mock a second IPC return; assert two `invoke` calls).
- Event with non-matching `cwd` → no re-fetch, branch unchanged.
- Unmount → no leaked subscription (capture the handler ref, fire the mock event after unmount, assert no IPC call).

The mock for `listen` follows the pattern already used in `useGitStatus.test.ts:113–119` (capture the registered callback off the `listen` mock, fire it manually, assert call ordering: `listen` resolves _before_ `start_git_watcher` is invoked).

---

## 5. Edge Cases

### Pre-repo → linked-worktree upgrade

The watcher's `PreRepoWatcher` (`watcher.rs:280`) handles "cwd is not yet a repo, then later becomes one." For the **main repo** case, the upgrade trigger is `.git/` appearing as a directory. For the **linked worktree** case, the moment the agent runs `git worktree add <cwd> -b <branch>`, `<cwd>/.git` appears as a **regular file** (`gitdir: …`), not a directory.

We rely on the existing `resolve_toplevel` re-try path: `start_git_watcher_inner` calls `resolve_toplevel` on every (re-)subscription, and `git rev-parse --show-toplevel` works identically against `.git` (dir) and `.git` (file). No code change is needed for upgrade _detection_. The only additive work is that the upgrade path must also resolve the new `git_dir` (via the §2 mechanism) and populate `cwd_to_repo` with the (toplevel, gitdir) pair before registering the file watches. The polling cadence (10 s) is unchanged.

### Worktree removal

`git worktree remove <path>` deletes the linked worktree's checkout directory entirely. From the watcher's perspective:

- The recursive `toplevel` watch sees `Remove` events for everything inside.
- The non-recursive `git_dir` watch sees the gitdir disappear.
- `notify::Watcher` registrations to deleted paths fail quietly with `Failed to watch …` warnings (already handled today).
- The notify-based burst-debounce flushes `git-status-changed` for the bucket; `git_branch` IPC on the now-missing cwd fails and the hook resolves `branch` to `null`. The Header drops the chip.

We do **not** auto-tear-down the bucket on disappearance. The pane stays open, its cwd just becomes invalid. The frontend cleans up the bucket via `stop_git_watcher` when the user closes the pane.

### OSC 7 unreliable / not configured

When `session.workingDirectory === '~'` (or any non-absolute placeholder), `useGitBranch` short-circuits to idle until OSC 7 backfills the absolute path. Per `README.md → Shell Setup (OSC 7)`, OSC 7 requires a shell-side hook. If the user hasn't installed the hook, the cwd never backfills and the Header never shows a branch.

This spec does **not** add a fallback for missing OSC 7 — that's a separate ergonomics concern (out of scope per §7). For panes that _do_ receive OSC 7, the live-update path works end-to-end. The implementation plan should include a smoke-test step that verifies OSC 7 is firing in the user's shell config before reporting the feature complete.

### `git_dir` vanishes after subscription

Edge: agent runs `git worktree remove` while a pane in that worktree is still open. The cached `git_dir` now points at a deleted directory. The watcher logs the failed registration and the polling fallback's HEAD-content read returns an error (handled — cached HEAD value just stays stale, no emit). The next `git_branch` IPC call returns `Err` (not `""`), which the hook surfaces as `error` state and the Header drops the chip. No crash.

### HEAD points at a packed ref that gets updated

`<git_dir>/HEAD = "ref: refs/heads/feature"`. Then a remote fetch packs `refs/heads/feature` into `<git_dir>/packed-refs` with a new SHA. HEAD itself is unchanged → no `git-head-changed`. The branch _name_ is also unchanged. The chip stays at `feature`. This is correct — the spec is about branch-name updates, not branch-SHA updates.

(The classification step in §3 explicitly ignores `packed-refs` modifications. The `git-status-changed` channel will fire as expected if the working tree's status against the new SHA differs.)

### Worktree with no commits yet

`git worktree add -b new ../new <new-orphan-ref>` is rare but legal. The new worktree's HEAD points at an unborn ref. `git symbolic-ref --short HEAD` returns the branch name; we honor it (same as §4's "Empty repository" sub-section). No special handling.

---

## 6. Testing Strategy

### Rust unit tests (in `watcher.rs`'s `#[cfg(test)] mod tests`)

Test naming follows `test_<function>_<scenario>_<expected>` (per `rules/rust/testing.md`):

1. `test_head_classification_matches_full_path_only` — feed the notify-callback classifier a `notify::Event` whose path is `<toplevel>/some-dir/HEAD` (working-tree file named HEAD), assert `head_dirty` stays false. Then feed `<git_dir>/HEAD`, assert it flips to true.
2. `test_head_classification_ignores_packed_refs` — feed `<git_dir>/packed-refs`, assert `head_dirty` stays false (per §7 "Refs-only updates").
3. `test_polling_emits_head_changed_on_clean_branch_switch_with_unchanged_status_hash` — fixture where `hash_git_status` returns the same value before and after `git switch`, but `<git_dir>/HEAD` contents differ; assert the polling thread emits `git-head-changed` (and NOT a redundant `git-status-changed`).
4. `test_stop_git_watcher_inner_handles_duplicate_starts` — call `start_git_watcher_inner(cwd)` twice, then `stop_git_watcher_inner(cwd)` twice. After the first stop, the bucket still exists. After the second stop, the bucket is gone. (Direct test of the refcount fix in §2.)

### Rust unit tests for worktree integration scenarios

The original draft routed these through `crates/backend/tests/`, but `test_helpers.rs` and `git_branch_inner` are `pub(crate)` — not visible from external integration-test crates. Per `rules/rust/testing.md`, these belong as **unit tests** in the existing `#[cfg(test)] mod tests` blocks at the bottom of `watcher.rs` and `mod.rs`. The same module access is what current watcher tests use (`watcher.rs:1294`), so no new test-only `pub` exports are needed.

Fixtures live in `crates/backend/src/git/test_helpers.rs` — extend with:

```rust
/// Create a main repo + N linked worktrees in a tempdir under $HOME.
/// Caller commits one file in the main repo first so worktree branches
/// have a parent commit. Returns (TempDir, main_path, worktree_paths).
pub(crate) fn create_main_repo_with_worktrees(branches: &[&str])
    -> (TempDir, PathBuf, Vec<PathBuf>) { … }
```

Tests in `watcher.rs#[cfg(test)] mod tests` (each `#[tokio::test]`):

1. `test_head_change_in_main_emits_for_main_only` — subscribe to main and a linked worktree, run `git -C <main> switch -c <new>`, assert one `git-head-changed` with `cwds: [main]` and zero events for the worktree's cwd.
2. `test_head_change_in_worktree_emits_for_worktree_only` — symmetric.
3. `test_pre_repo_upgrades_to_linked_worktree_and_emits_initial_head_event` — subscribe to a path that isn't yet a repo, run `git worktree add` from outside to create it, wait for the next poll cycle, assert subscription transitions and the **initial** `git-head-changed` emit (from §3 "Initial emit on subscribe") fires immediately on upgrade.
4. `test_two_worktrees_independent_head_events` — three subscribers across main + two linked worktrees, switch branches in one worktree, assert only that subscriber sees `git-head-changed`.
5. `test_worktree_removal_emits_head_changed_for_disappearing_worktree` — subscribe to a linked worktree, `git worktree remove` it, assert `git-head-changed` fires (path classifier matches the `Remove` event on `<git_dir>/HEAD`) and the next `git_branch_inner` call returns `Err`.

Tests in `mod.rs#[cfg(test)] mod tests` (`#[tokio::test]`):

6. `test_git_branch_detached_head_in_worktree_returns_short_sha` — extends the existing `test_git_branch_returns_empty_for_detached_head` at `mod.rs:1757`. After this spec, the expected return changes from `""` to the abbreviated SHA. Update the existing test name + assertion in the same commit.
7. `test_git_branch_non_repo_cwd_still_returns_err` — call `git_branch_inner` against a `$HOME`-rooted path that is NOT a repo, assert `Err` (not `Ok("")`). Protects against the regression codex flagged in §4. Mirrors the existing `test_git_branch_returns_error_for_non_repo_cwd` at `mod.rs:1804`.

All tests use `FakeEventSink` (`runtime::FakeEventSink` — publicly re-exported at `runtime/mod.rs:13`) and inspect emitted events via the same helpers existing watcher tests use.

### React hook tests (Vitest + Testing Library)

Extend `src/features/diff/hooks/useGitBranch.test.ts` (per `rules/typescript/testing/CLAUDE.md` — inline test data, `test()` not `it()`):

1. `mount attaches listener BEFORE start_git_watcher` — capture call order on the `listen` and `invoke` mocks, assert `listen` resolves first (same pattern as `useGitStatus.test.ts:143–170`).
2. `event with matching cwd triggers refetch` — fire the captured `git-head-changed` callback with `cwds: ['/home/test/repo']`, assert a second `invoke('git_branch', …)` is observed.
3. `event with non-matching cwd does not refetch` — fire with `cwds: ['/other']`, assert no extra invoke.
4. `unmount unlistens before stopping watcher` — unmount the hook, assert `unlisten` is called before `stop_git_watcher` is invoked.
5. `unmount during in-flight start awaits setup then stops` — block the `start_git_watcher` invoke promise, unmount before it resolves, then let it resolve; assert `stop_git_watcher` is eventually called.

### Header rendering tests

Extend `HeaderMetadata.test.tsx`:

- `branch="feature/x"` → renders `feature/x` in normal styling.
- `branch="a1b2c3d"` → renders `a1b2c3d` in normal styling (Option 1 — no special treatment for SHA-shaped strings).
- `branch=null` → no branch chip.

### Manual smoke test

Recorded as a checklist in the implementation plan (NOT in this spec): open two panes — one in the main repo, one in a freshly-`git worktree add`-ed linked worktree. In each pane, run `git switch <existing-branch>` and `git switch -c <new-branch>` and `git switch --detach HEAD~1`. Confirm both Headers update within ~300 ms without manual refresh, and that a detached HEAD shows the short SHA.

---

## 7. Out-of-Scope & Risks

### Hard out-of-scope

- **Bare repositories** — no working tree, so the recursive `toplevel` watch has no meaning. `git rev-parse --show-toplevel` returns empty for bare repos; `resolve_toplevel` already treats that as "not a repo." We don't add fixtures.
- **Submodules** — submodule gitdirs live under `<parent>/.git/modules/<name>/`. `git rev-parse --git-dir` returns the right path, but our `validate_cwd($HOME)` rule and the bucket model haven't been exercised against submodule worktrees. Out of scope; explicitly noted so a follow-up issue can pick it up.
- **Worktrees outside `$HOME`** — `validate_cwd` rejects them. Linked worktrees created in `/tmp`, `/var/…`, or other non-`$HOME` paths will silently fail to subscribe. We accept this — it matches existing `git_status` / `git_diff` behavior.
- **Cross-pane "list worktrees" view** — a future sidebar feature. This spec does not add a `worktrees` IPC or any new state in the watcher tracking the set-of-worktrees per main repo.
- **Refs-only updates** (`git fetch` updating `refs/heads/feature` without HEAD moving) — branch name unchanged, no re-render needed. The classification step in §3 explicitly ignores `packed-refs` modifications for this reason. The `git-status-changed` channel still fires if the working tree's status differs against the new SHA.
- **OSC 7 fallback** — for panes whose shell isn't emitting OSC 7, the cwd never backfills and `useGitBranch` stays idle. A separate ergonomics issue should track this; this spec does not address it.

### Risks

- **`.claude/worktrees/` inside the main working tree, not gitignored.** As called out in §1: the main repo's recursive watcher and `git status --untracked-files=all` will pick up changes inside the nested worktree dir. That fires `git-status-changed` (the _status_ channel, not the branch channel) on the main pane more often than necessary. We mitigate by recommending `.claude/worktrees/` in the README's `.gitignore` guidance. If the recommendation isn't followed, the cost is extra `git-status-changed` fires; the branch label remains correct.
- **`notify` reliability inside `.git/worktrees/`.** Some filesystems (NFS, FUSE, certain SMB mounts) deliver inotify events inconsistently. The polling fallback at 10 s covers this — §3 explicitly adds HEAD-content caching so a missed notify event surfaces on the next poll, _independently_ of the status hash.
- **`rev-parse --path-format=absolute` portability.** This flag was added in git 2.31 (2021-03). Ubuntu 22.04 ships git 2.34; macOS Xcode CLT and Homebrew git are both well newer. Safe for our supported platforms. If we ever need to support older git, the alternative is to absolutize the (possibly relative) `--git-dir` output against `cwd` ourselves before canonicalizing.
- **Spurious `git-head-changed` on `.git/HEAD` write-without-change.** Some tools rewrite HEAD with identical content. Our notify-based detection will fire `git-head-changed`; the frontend will re-invoke `git_branch`; the result is identical; React's state-equality short-circuits the re-render. Wasted IPC, not a bug.
- **Bucket-lock contention from the new `head_dirty` flag.** Mutated under the existing per-bucket lock; one bool flip per FS event. The current code already takes the same lock for `repo_watchers` fan-out access; the additional contention is negligible.

### Migration notes for the implementation plan

- **Additive.** No existing test should fail. The `.git/HEAD` watch path conceptually moves from `toplevel.join(".git/HEAD")` to `git_dir.join("HEAD")`, but in the main-repo case those are bit-identical. The shape change is "watch the parent dir non-recursively and filter by full path," which existing main-repo tests don't probe.
- **Frontend `git_branch` IPC contract change** (`Ok("")` → `Ok(short-sha)` for detached HEAD) is observable but backward-compatible: the hook treats both as non-empty strings; `Err` cases are unchanged. The visible behavior change is "the chip now appears in detached state instead of disappearing."
- **`stop_git_watcher_inner` refcount fix** (described in §2) is a prerequisite. Land it first as its own commit so the worktree work doesn't compound an existing latent bug into a regression for the no-op case.

<!-- codex-reviewed: 2026-05-19T08:55:18Z -->
