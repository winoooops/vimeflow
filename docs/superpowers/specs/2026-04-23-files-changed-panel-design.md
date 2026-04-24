# Files Changed Panel — Design Spec

**Date**: 2026-04-23
**Status**: Draft (awaiting user review)
**Audience**: Both humans (top half, reader's overview) and implementation agents (bottom half, technical reference). Both halves are authoritative — if they disagree, it's a bug in the spec; please flag it.

**Depends on**:

- `src-tauri/src/git/mod.rs` — existing `git_status` / `get_git_diff` Tauri commands
- `src/features/diff/` — existing `ChangedFile` type, `TauriGitService`, `useGitStatus`, `useFileDiff`, `DiffPanelContent`, `DiffViewer`
- `src-tauri/src/agent/watcher.rs` — reference pattern for `notify`-based watchers with polling fallback

---

# Part 1 — Reader's Overview

## In one paragraph

The right-hand agent sidebar has a **FILES CHANGED** section that always says `0` because nothing feeds it. This feature lights it up by reading the real output of `git status`, showing one row per modified file with its `+N / -N` line counts, and refreshing automatically whenever any process (an agent in this tab, an agent in another tab, or the user's own editor) changes the working tree. Clicking a row opens that file in the diff viewer that already lives in the bottom drawer.

## What you see today vs. what you'll see after

```
TODAY                                 AFTER
─────                                 ─────
▼ FILES CHANGED  0                    ▾ FILES CHANGED  4
                                        ~ src/features/diff/FilesChanged.tsx    +8 / -1  STAGED EDIT
▶ TESTS 0/0                             ~ src/features/diff/FilesChanged.tsx    +4 / -2  EDIT
                                        ~ src/features/workspace/WorkspaceView.tsx +4 / -4 EDIT
                                        + src/hooks/useGitStatusRefresh.ts      +47 / -0 NEW

0m     0 turns     +0 / -0            ▸ TESTS 0/0                 ← unchanged (out of scope)

                                      0m     0 turns     +0 / -0  ← unchanged (agent-sourced)
```

(The two `FilesChanged.tsx` rows illustrate the MM dual-entry pattern — the file is staged with 8 lines added, then edited further in the working tree with 4 more added. Each row routes to the correct half of the diff when clicked.)

Clicking any row opens the bottom drawer's **Diff** tab with that file selected.

## The four key choices

Each was a fork — we could have gone the other way. The reasoning is recorded here so future-us (or a reviewer) doesn't re-litigate it.

### 1. Show real git, not agent-reported, changes

The agent reports `totalLinesAdded / totalLinesRemoved` as part of its cost metrics. We don't use those, because:

- The user will ultimately `git commit` — and `git` is what `git commit` sees. If an agent silently reverts its own work, the agent still counts the churn; git shows zero.
- The user also edits files outside the agent (vim, VS Code, manual `rm`). Those never reach the agent's tool-call stream.

**Side effect worth knowing:** the footer `+N / -N` stays agent-sourced on purpose. The list answers _"what's in my working tree"_; the footer answers _"what did this chat do."_ When they disagree, you learn something (agent reverted, user edited, etc.).

### 2. Watch the filesystem; don't refresh on agent events

The natural first instinct is "the agent just finished a Write — refresh." That breaks the moment a second agent is running. Vimeflow's value prop is being a **control plane for multiple coding agents**, so any design that only works with one agent is a trap.

The watcher also catches edits made outside any agent — fixing a typo in vim updates the panel without anyone asking.

**Cost:** some Rust plumbing and one new Cargo dependency (`ignore`, the same crate `ripgrep` uses to honor `.gitignore`). Worth it — adding a watcher later would be a bigger refactor than baking it in now.

### 3. Only show the panel when an agent is active (for now)

We considered "always show uncommitted changes, even with no agent." Rejected — it requires moving `FilesChanged` out of `AgentStatusPanel` into a higher layout slot. That's a meaningful refactor and not what the user asked for. The backend watcher is panel-agnostic, so this can be revisited later without backend changes.

### 4. Per-file `+N / -N` badges are worth one extra git call

Each refresh now runs three git subprocesses instead of one: `git status --porcelain=v1 -z`, `git diff --numstat`, and `git diff --cached --numstat`. Git is fast on a warm cache (tens of milliseconds), and the numbers turn a plain list into something useful at a glance. Binary files report `-` in `--numstat`; those rows omit the badge.

## Architecture in plain English

```
                 ┌──────────────────────┐
                 │   React components    │
                 │  (sidebar panel,      │
                 │   bottom-drawer diff  │
                 │   viewer)             │
                 └──────────┬────────────┘
                            │ useGitStatus(cwd, { watch: true })
                            ▼
                 ┌──────────────────────┐
                 │  Tauri invoke layer   │
                 └──────────┬────────────┘
                            │
       ┌────────────────────┼────────────────────┐
       ▼                    ▼                    ▼
┌────────────┐      ┌────────────┐      ┌────────────────┐
│ git_status │      │ start_git_ │      │ stop_git_      │
│  (extended │      │  watcher   │      │  watcher       │
│  with      │      │ (new)      │      │ (new)          │
│  numstat)  │      │            │      │                │
└────────────┘      └──────┬─────┘      └────────────────┘
                           │
                           ▼
                 ┌──────────────────────┐
                 │  notify (NonRecursive │
                 │  per non-ignored dir) │
                 │  + ignore-filtered    │
                 │  walker               │
                 │  + polling fallback   │
                 │  keyed by repo        │
                 │  toplevel (refcount)  │
                 └──────────┬────────────┘
                            │ emits
                            ▼
              `git-status-changed { cwds: string[] }`
                            │
                            ▼ (frontend listener matches if its
                              input cwd ∈ cwds, calls refresh)
                    → another git_status round
                    → <~100ms total → UI updates
```

### Why the watcher keys on repo toplevel, with per-cwd refcounts inside

Two things are refcounted, and they operate on different axes:

1. **Outer key: repo toplevel.** Terminal cwd (via OSC 7) can be any subdirectory of a repo. If we keyed the watcher map on raw cwd, two tabs at `/repo/src/a` and `/repo/src/b` would each spin up their own full notify registration on the same repo — wasteful, doubles the inotify budget, and makes the non-repo check false-positive when `.git/` is two levels up from the cwd. Resolving `git rev-parse --show-toplevel` first means both tabs map to `/repo` and share one notify handle.
2. **Inner refcount: per input cwd.** Inside a single toplevel watcher, each input cwd has its own refcount. Why: the sidebar and the bottom-drawer diff viewer both subscribe `useGitStatus(activeSessionCwd, { watch: true })` on the same cwd. Two hooks, one cwd, two refcount increments — unmounting the drawer drops the refcount to 1, the watcher stays live for the sidebar; unmounting the sidebar drops it to 0, the watcher tears down. A simple set-of-cwds would collapse both hooks to one entry and the first unmount would break the other.

A tab whose cwd is outside any repo takes the pre-repo path: its own refcount (no toplevel yet), polling thread that upgrades the entry to a real repo watcher as soon as `git init` happens.

### Why we honor `.gitignore`

A recursive watch on a typical JS/Rust repo would try to subscribe to every file under `node_modules/` and `target/`. Linux's default `fs.inotify.max_user_watches` is around 8192 on most distros; a single medium-sized `node_modules` can blow right past that. Importantly, a _recursive_ inotify watch on the repo root registers all of those subdirectories regardless of any walker we ran first — recursive means the kernel does it for us. So we don't use a recursive watch: the `ignore` crate walks the tree itself, and we register each non-ignored directory individually as a non-recursive watch. Ignored subtrees never consume a watch slot.

### Why the polling fallback exists

On WSL2, SMB, and NFS, `inotify` sometimes misses events — especially when an editor saves via "write temp → rename" (an atomic swap). The polling fallback re-reads `HEAD` and `index` OIDs every 10 seconds and fires a synthetic event if anything moved. It's a safety net, not the main mechanism.

## User flows

### Flow A — Agent edits three files

1. Agent runs `Write` on file A, `Edit` on file B, `Bash: rm file-C`.
2. `notify` fires a burst of events; the watcher's 300ms debounce coalesces them into one.
3. Backend emits `git-status-changed { cwds: [currentSubscribedCwdsOnThisToplevel] }`.
4. Every mounted `useGitStatus` hook whose input cwd appears in `cwds` calls `refresh()`.
5. `git_status` runs; `FilesChanged` re-renders with three rows.
6. Typical time from last write to UI update: under 400ms.

### Flow B — Two agents on the same repo, different subdirs

1. Agent A in tab 1 (cwd `/repo/src/a`) writes file X. Agent B in tab 2 (cwd `/repo/src/b`) writes file Y.
2. Both cwds resolved to the same toplevel `/repo` by `start_git_watcher`, so both subscriptions share one repo watcher — per-cwd refcounts in the `subscribers` map.
3. A write to either file triggers the shared notify handle. One debounced event fires with `cwds: ["/repo/src/a", "/repo/src/b"]`; both hooks match and refresh.
4. Each tab's sidebar shows both changes (sorted by path). Two tabs on the **same** cwd work identically — both subscriptions are independent refcounts on the same key.

### Flow C — User edits in VS Code while an agent is running

1. User saves a file in VS Code; it does a temp-write + rename.
2. On Linux, `notify` sees the rename. On WSL2, it might miss it — in which case the 10s polling fallback catches the OID change.
3. `git-status-changed` fires; list updates.

### Flow D — Clicking a file

1. User clicks a row in `FilesChanged`.
2. `onSelect(file)` bubbles up the full `ChangedFile` through `AgentStatusPanel.onOpenDiff` to `WorkspaceView.handleOpenDiff`.
3. `WorkspaceView` sets three pieces of state at once: `bottomDrawerTab = 'diff'`, `selectedDiffFile = { path, staged, cwd }` (tagged with the current cwd so a later session switch can be detected at render time), `isBottomDrawerCollapsed = false`.
4. `BottomDrawer` (controlled) switches tabs and uncollapses; `DiffPanelContent` (controlled) checks `selectedDiffFile.cwd === cwd` at render time, passes the `staged` flag to `useFileDiff`, and shows the correct half of an MM/AM pair.

## What's staying and what's moving

| Thing                                                    | Status                                                                                                     | Where it lives                                        |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `src-tauri/src/git/mod.rs` `git_status` + `get_git_diff` | Extended — numstat merged in                                                                               | Same file                                             |
| `src-tauri/src/git/watcher.rs`                           | **New**                                                                                                    | New file, modeled on `src-tauri/src/agent/watcher.rs` |
| `ChangedFile` Rust struct                                | Extended — adds `insertions`/`deletions` fields                                                            | Same file                                             |
| `src/features/diff/types/ChangedFile` TS type            | Unchanged — optional fields already there                                                                  | Same file                                             |
| `src/features/diff/hooks/useGitStatus`                   | Extended — optional `watch: true` mode                                                                     | Same file                                             |
| `src/features/diff/services/gitService.ts`               | Unchanged                                                                                                  | —                                                     |
| `src/features/diff/components/DiffPanelContent`          | Accepts controlled `selectedFile` as `SelectedDiffFile` (`{ path, staged, cwd }`); opts into `watch: true` | Same file                                             |
| `src/features/workspace/components/BottomDrawer`         | Accepts controlled `activeTab` / `selectedDiffFile` / `isCollapsed`                                        | Same file                                             |
| `src/features/workspace/WorkspaceView`                   | Lifts tab + selected-file state; wires `onOpenDiff`                                                        | Same file                                             |
| `src/features/agent-status/components/FilesChanged`      | Refactored to consume `ChangedFile[]`; adds `onSelect`; renders `+N/-N`                                    | Same file                                             |
| `src/features/agent-status/components/AgentStatusPanel`  | Replaces placeholder with real hook; forwards `onOpenDiff`                                                 | Same file                                             |
| `src/features/agent-status/components/ActivityFooter`    | Unchanged                                                                                                  | —                                                     |
| `src/features/agent-status/components/TestResults`       | Unchanged — wiring is a separate feature                                                                   | —                                                     |

---

# Part 2 — Technical Reference

## Backend changes

### `src-tauri/Cargo.toml`

Add one new crate: `ignore = "0.4"`. It is a **different crate** from `notify = "6"` (which is already in `Cargo.toml` and stays as-is); the version numbers `"0.4"` and `"6"` belong to each crate independently and are unrelated.

The two crates collaborate with distinct jobs:

| Crate                                                | Role in this feature                                                                                                                                                                                |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `notify = "6"` _(existing)_                          | Subscribes to kernel filesystem events (inotify on Linux, FSEvents on macOS, ReadDirectoryChangesW on Windows) and tells us "the file at this path just changed." Does not know anything about git. |
| `ignore = "0.4"` _(new — same crate `ripgrep` uses)_ | Parses `.gitignore`, `.git/info/exclude`, and nested gitignores and filters the path list before we hand it to `notify`. Does not watch anything.                                                   |

Without `ignore`, a recursive watch on a typical repo would try to subscribe to every file under `node_modules/`, `target/`, and `.git/objects/`. Linux's default `fs.inotify.max_user_watches` (~8192) can't cover that; the watcher silently stops catching events once exhausted. With `ignore`, we walk the tree, drop any path excluded by a `.gitignore`, and hand `notify` only the "real source" paths.

### `src-tauri/src/git/mod.rs`

**Extend `ChangedFile`:**

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub status: ChangedFileStatus,
    pub staged: bool,
    pub insertions: Option<u32>,   // NEW — None for binary files and untracked
    pub deletions: Option<u32>,    // NEW
}
```

**Add a `parse_numstat` helper (NUL-terminated format):**

```rust
/// Parse `git diff --numstat -z` output into a path → (added, removed) map.
///
/// Format (NUL-separated, LF-stripped inside records):
///   non-rename: "<added>\t<deleted>\t<path>\0"
///   rename:     "<added>\t<deleted>\t\0<src-path>\0<dst-path>\0"
///
/// Binary files report "-\t-\t..." and are omitted from the map.
/// Renames are keyed on the **dst** path (matches ChangedFile.path, which
/// porcelain -z also sets to the dst). The `-z` form is mandatory — the
/// default text form uses brace-compressed renames like
/// `src/{Foo.tsx => Bar.tsx}` that would not match ChangedFile.path and
/// would drop +N/-N badges on every renamed row.
fn parse_numstat(output: &[u8]) -> HashMap<String, (u32, u32)>
```

**Extend `git_status`:**

0. **Resolve the repo root (NEW).** Run `git -C <cwd> rev-parse --show-toplevel`. If this exits non-zero (typical error: `fatal: not a git repository`), the cwd is outside any repo — return `Ok(vec![])` and skip all subsequent subprocess calls. On success, use the canonicalized toplevel as the working directory for every following git call in this command. Rationale: `session.workingDirectory` is the terminal's live OSC-7 cwd, which can be any subdirectory (`cd src/foo`); running `git status` from there still works, but `<cwd>/.git` would miss and our old pre-check would incorrectly flag it as a non-repo. Resolving to toplevel fixes both the non-repo check and the watcher keying below.
1. Run `git status --porcelain=v1 -z` **from the toplevel** — authoritative list and staging state.
2. Run `git diff --numstat -z` and `git diff --cached --numstat -z` **from the toplevel** (NEW) — in parallel via `tokio::join!`, both wrapped in the existing `run_git_with_timeout`.
3. For each `ChangedFile`, look up the numstat entry in the matching map (staged entries → cached map; unstaged entries → working-tree map). Leave `None` for untracked or missing entries.

**MM / AM dual-entry behavior (NEW — replaces single-entry default).** The existing `parse_git_status` collapses MM (modified in both index and worktree) and AM (added in index, modified in worktree) into a single `ChangedFile` with `staged: false`, silently hiding the staged half. In this feature, emit **two** entries per MM/AM path:

```
MM  foo.ts    →   { path: foo.ts, status: Modified, staged: true,  insertions/deletions from cached numstat }
                  { path: foo.ts, status: Modified, staged: false, insertions/deletions from working-tree numstat }

AM  bar.ts    →   { path: bar.ts, status: Added,    staged: true,  insertions/deletions from cached numstat }
                  { path: bar.ts, status: Modified, staged: false, insertions/deletions from working-tree numstat }
```

Each half renders as its own row in `FilesChanged` (the staged row shows a `STAGED` badge variant — see Frontend changes below). Clicking either row opens the correct half in `DiffPanelContent` because `useFileDiff(path, staged, cwd)` already accepts the staged flag. This intentionally trades a little visual duplication for correct representation — the alternative (single-flag with one half silently hidden) is a user-observable data loss, not a formatting choice.

This does **not** require the dual-flag `ChangedFile` model in [`2026-04-11-mm-staged-unstaged-design.md`](./2026-04-11-mm-staged-unstaged-design.md); the single-flag shape is preserved. That larger rewrite is still the right long-term move (it would eliminate the row duplication), but it can land separately.

**Timeout policy:** if any of the three subprocesses (status, diff-numstat, diff-cached-numstat) times out, the whole `git_status` call fails and the frontend shows its error state with a Retry button. The 30s budget is already very loose; a real timeout signals something is seriously wrong (hung filesystem, pathological repo state), and quietly returning partial data would mask that. The `rev-parse` call in step 0 is fast enough to share the same budget.

**Extend `get_git_diff` with the same toplevel resolution.** `ChangedFile.path` is toplevel-relative (porcelain `-z` emits it that way), but `get_git_diff(cwd, file, staged)` currently runs `git -C <cwd> diff -- <file>`. For a session whose cwd is `/repo/src/foo`, running `git -C /repo/src/foo diff -- src/components/Bar.tsx` looks for the file relative to `/repo/src/foo` and returns an empty diff — the click-to-open flow would show blank content for every row in a subdir session. Mirror the `git_status` fix:

0. Run `git -C <cwd> rev-parse --show-toplevel`. If it fails, return a `FileDiff` with empty `hunks` (the frontend already handles this as "nothing to show"). On success, use the canonicalized toplevel as the working directory for the subsequent `git diff` call.
1. `git -C <toplevel> diff [--cached] -- <file>` (unchanged beyond the working-dir swap).

Same `validate_cwd` protection on both the input `cwd` and the resolved toplevel. Existing `validate_file_path` stays — `ChangedFile.path` is repo-relative and must remain so.

### `src-tauri/src/git/watcher.rs` (new module)

Model on `src-tauri/src/agent/watcher.rs`. Key properties:

- **Two state maps, one lifecycle.** State has two fields:
  ```rust
  pub struct GitWatcherState {
      repo_watchers: Mutex<HashMap<Toplevel, RepoWatcher>>,
      //                            ↓
      //    RepoWatcher {
      //        subscribers: HashMap<InputCwd, u32>,   // cwd → refcount (NOT a HashSet — see below)
      //        notify_handles: …,
      //        poll_stop: Arc<AtomicBool>,
      //    }
      pre_repo_watchers: Mutex<HashMap<InputCwd, PreRepoWatcher>>,
      //                            ↓
      //    PreRepoWatcher {
      //        refcount: u32,
      //        poll_stop: Arc<AtomicBool>,
      //    }
  }
  ```
  Every `start_git_watcher(cwd)` call lands in exactly one map entry based on whether `git rev-parse --show-toplevel` succeeds for that cwd.
- **Subscribers are refcounted per cwd, not deduped.** `subscribers: HashMap<InputCwd, u32>` — each `start_git_watcher(cwd)` call **increments** the counter for that cwd; each `stop_git_watcher(cwd)` **decrements**. A key is removed from the map only when its counter hits 0; the watcher's notify handles are dropped only when the whole map is empty. This matters because multiple live hooks on the **same** cwd is a normal state: `AgentStatusPanel` subscribes on the active session's cwd while `DiffPanelContent` (inside the bottom drawer's diff tab) also subscribes on that same cwd. If subscribers were a `HashSet<InputCwd>`, both hooks would collapse to one entry, and the first unmount (user switches the drawer tab from diff to editor) would tear down the watcher while the sidebar is still using it. The refcount preserves the mapping "N live subscribers → 1 shared notify handle, unsubscribe drops refcount by 1" across all common subscription patterns.
- **Repo path (toplevel resolved).** Get or insert `repo_watchers[toplevel]`; bump `subscribers[cwd]` counter by 1. If the entry was new, build its notify handles and polling thread.
- **Pre-repo path (not in a repo yet).** Get or insert `pre_repo_watchers[cwd]`; bump its `refcount` by 1 (so sidebar + drawer both watching a non-repo cwd share the pre-repo handle correctly). If the entry was new, spawn its polling thread. The entry has **no notify watches** (there's nothing to watch yet and we don't want to guess). The polling thread runs `rev-parse --show-toplevel` every 10s. On transition (user runs `git init`): take the pre-repo entry (carrying its refcount), insert/bump `repo_watchers[new_toplevel].subscribers[cwd]` by that refcount, build or reuse the repo watcher's notify handles, drop the pre-repo entry, and emit `git-status-changed { cwds: [cwd] }`. This is the "auto-upgrade" path — subscribers get the refresh they expect without any frontend action.
- **Non-recursive notify watches built from a filtered walk.** For every repo watcher, we do **not** use `RecursiveMode::Recursive` on the toplevel, because on Linux inotify a recursive watch auto-registers every subdirectory — including `node_modules/`, `target/`, and `.git/objects/` — regardless of any walker we ran first. The `ignore` crate only helps if we drive registration ourselves:
  1. Use `ignore::WalkBuilder::new(toplevel).follow_links(false).build()` to enumerate the tree with `.gitignore` / `.git/info/exclude` / nested gitignores honored.
  2. For each enumerated **directory**, call `watcher.watch(dir, RecursiveMode::NonRecursive)` — one inotify slot per directory, ignored subtrees never registered.
  3. When a `Create(Folder)` event fires on a watched dir, consult `ignore::gitignore::Gitignore` for the new path; if not ignored, register it `NonRecursive` so newly-created source directories are covered automatically. No runtime add needed for ignored dirs.
  4. Also register `<toplevel>/.git/index` and `<toplevel>/.git/HEAD` individually with `NonRecursive` so staging ops and commits fire events. Do not recursively watch `.git/` — `.git/objects/` alone can explode the watch count.
- **Event payload fans out subscribers.** The Tauri event is `git-status-changed { cwds: string[] }` — `cwds` is `subscribers.keys().collect()` for the triggering watcher (unique input cwds, refcount ignored for payload purposes — the frontend just needs to know "did my cwd get refreshed?"), or `[input_cwd]` for a pre-repo upgrade. Frontend listener matches if its input cwd appears in `event.cwds` and calls `refresh()`. This is what makes a shared repo watcher correctly fan out to every subscribed tab; without it, a single event payload couldn't serve both `/repo/src/a` and `/repo/src/b` simultaneously.
- **Debounce at 300ms** — coalesces a flood of writes from `npm install` or a large `Edit` call into one event. Snapshot the subscribers set at emission time so a subscriber who unsubscribes during the debounce window isn't included.
- **Polling fallback at 10s.** For repo watchers: re-stats `HEAD` / `index` OIDs and working-tree `mtime` max; fires a synthetic `git-status-changed { cwds: <current subscribers> }` if anything differs. For pre-repo watchers: re-runs `rev-parse --show-toplevel`; on success, triggers the upgrade path described above. Same stop-flag pattern the agent watcher uses.
- **Validate cwd under home** — reuse `validate_cwd` from `git/mod.rs`. Apply it to the input `cwd` **and** to the resolved toplevel (a malicious symlink inside the project could otherwise point `rev-parse --show-toplevel` outside `$HOME`).
- **Initial-fire on start** — emit one `git-status-changed { cwds: [input_cwd] }` immediately after `start_git_watcher` returns so the frontend's first fetch happens without waiting for a real event. Using a singleton `cwds` array keeps the event shape consistent between initial-fire, real-event, and upgrade paths.
- **Unsubscribe semantics.** `stop_git_watcher(cwd)` decrements the refcount for `cwd` in whichever map has it. For repo watchers: if `subscribers[cwd]` hits 0, the key is removed; if the whole `subscribers` map is then empty, drop the notify handles and stop the polling thread. For pre-repo watchers: if the entry's refcount hits 0, drop the entry (stopping its polling thread). A stray `stop_git_watcher` for a cwd not in either map is a warning-logged no-op — it's harmless and probably means the frontend fired cleanup twice during a teardown race.

**Tauri commands:**

```rust
#[tauri::command]
pub async fn start_git_watcher(
    cwd: String,
    state: tauri::State<'_, GitWatcherState>,
    app: tauri::AppHandle,
) -> Result<(), String>

#[tauri::command]
pub async fn stop_git_watcher(
    cwd: String,
    state: tauri::State<'_, GitWatcherState>,
) -> Result<(), String>
```

Register `GitWatcherState::default()` and both commands in `src-tauri/src/lib.rs`.

## Frontend changes

### `src/features/diff/hooks/useGitStatus.ts`

Signature becomes `useGitStatus(cwd: string, options?: { watch?: boolean; enabled?: boolean })`. Both options default to `true` only together — i.e. `enabled` defaults to `true` to preserve behavior for current callers; `watch` defaults to `false`.

**Return shape adds `filesCwd: string | null`.** This is the cwd for which the current `files` array was last successfully fetched. It's `null` before the first successful fetch, and changes ONLY on successful fetch completion (never on fetch start, so during a cwd change `filesCwd` keeps pointing at the old cwd while `files` still holds the old list — until the new fetch lands). Consumers use it as a freshness predicate: `const filesAreFresh = filesCwd === cwd`. Without this, an auto-select effect that fires during a cwd change would see the **old** `files` array, pick its first entry, tag it with the **new** cwd, and hand `useFileDiff` a broken `(oldPath, newCwd)` pair — which is exactly the regression the reviewer flagged after the `{ path, staged, cwd }` guard was added.

- **`enabled: false`** — the hook returns `{ files: [], filesCwd: null, loading: false, error: null, refresh: () => void }` and performs **no** IPC, no event subscription, and no watcher lifecycle call. Existing consumers pass no `enabled` and are unaffected.
- **`watch: true` (requires `enabled: true` to take effect)** — lifecycle ordered to close the listen-attach race (see Async Race Conditions pattern at `docs/reviews/patterns/async-race-conditions.md`). On mount (and on `cwd` change):
  1. `const unlisten = await listen<{ cwds: string[] }>('git-status-changed', handler)` — **attach listener first**. Handler matches if `event.payload.cwds.includes(myCwd)` and calls `refresh()`.
  2. `await invoke('start_git_watcher', { cwd })` — watcher startup. The backend's initial-fire emits the first `git-status-changed` event during this call; the listener is already attached and catches it.
  3. `refresh()` — explicit belt-and-suspenders fetch AFTER both above. This covers any filesystem change that landed between listener-attach (step 1) and watcher startup (step 2) without being witnessed by either, and is idempotent with the listener-triggered refresh from step 2's initial-fire. Reversing the listener/start order is what turns "we might miss the initial fire" into "we can't miss it."
  4. Return the hook state; future events route through the listener.

  On unmount (or `enabled` flipping false, or `cwd` changing):
  1. `unlisten()` — detach listener first so a late in-flight event can't call `refresh()` on a torn-down hook.
  2. `await invoke('stop_git_watcher', { cwd })` — decrement backend refcount.

  The `cwds` array is what lets a single event fan out to multiple subscribers sharing the same underlying repo watcher — two hooks on `/repo/src/a` and `/repo/src/b` both match the same event because both cwds appear in its payload.

- The non-watched path stays unchanged so existing consumers (and their tests) keep working.

The `enabled` gate exists so `AgentStatusPanel` — which is always mounted — can keep the watcher idle for inactive agent sessions without conditionally-mounting a child component (which would churn watcher start/stop on every `status.isActive` flap).

### `src/features/agent-status/components/FilesChanged.tsx`

- Delete the local `FileChangeItem` type. Import `ChangedFile` from `src/features/diff/types`.
- New props:
  ```ts
  interface FilesChangedProps {
    files: ChangedFile[]
    loading: boolean
    error: Error | null
    onRetry: () => void
    onSelect: (file: ChangedFile) => void
  }
  ```
  `loading` / `error` / `onRetry` come straight from `useGitStatus`'s return shape via `AgentStatusPanel`. Without them in the contract, the loading-and-error rows in the UI states table have no path into the component that renders the `CollapsibleSection` body.
- `onSelect` receives the whole `ChangedFile` (not just the path) so the caller can route on the `staged` flag — that's what distinguishes the two halves of an MM/AM pair.
- Body rendering rules inside the `CollapsibleSection`, split by whether we have rows:
  - **`files.length === 0` (no rows to fall back on)**
    - `loading` → `<div>Loading…</div>` in `text-on-surface-variant` (neutral text, not a spinner).
    - `error && !loading` → error message in `text-error` + a `Retry` `<button>` that calls `onRetry`. Both share a single `role="alert"` container.
    - `!loading && !error` → "No uncommitted changes" in `text-on-surface-variant`.
  - **`files.length > 0` (rows available)** — always render the populated row list (see below), preserving stale rows across refreshes to avoid a "blinking empty state." On top of the rows:
    - `loading` → no visual change (stale rows stay; no spinner).
    - `error` → a compact inline banner **above the row list**: `Refresh failed: {error.message}` in `text-error` with a small `Retry` `<button>` that calls `onRetry`. The banner uses `role="alert"`. Visibility tracks the hook's `error` field directly: `useGitStatus` clears `error` at the start of every retry (see `useGitStatus.ts:41`), so the banner disappears when the retry begins; if the retry succeeds, the banner stays gone; if the retry fails, the banner reappears with the new error. This produces a brief loading flash where the banner disappears while the retry is in flight — that's the intended signal that the retry is happening, and matches how every other component in the app reads `useGitStatus().error`. Without this banner, a second-fetch failure (e.g. a transient timeout) would silently leave the list stale with no affordance to retry.
- Row becomes a `<button>` so keyboard nav works; `onClick → onSelect(file)`. Row key is `${file.path}:${file.staged}` to give React stable identity across the two halves of an MM/AM pair.
- Status → prefix/badge map: `modified → ~ / EDIT`, `added → + / NEW`, `deleted → - / DEL`, `renamed → → / MOVE`, `untracked → ? / UNT`.
- Staged vs unstaged visual: staged rows append a subtle `STAGED` label (same typographic treatment as the existing status badge, different color — `text-secondary` rather than `text-outline`) so the two MM/AM rows for the same path are instantly distinguishable. Unstaged rows carry no extra label.
- Row order: staged-group first, then unstaged-group (handled by the backend; the component renders in the order received).
- When both `insertions` and `deletions` are numbers, render `+{insertions} / -{deletions}` (dimmed if both zero; omitted entirely if either is `undefined`, which covers binary and untracked).

The `CollapsibleSection` header `count` reflects `files.length` (not "changed while loading" — the count follows what's actually rendered). Empty / loading / error states still render the section header so the user can expand/collapse consistently.

**Default expanded.** Pass `defaultExpanded={true}` to `CollapsibleSection`. The base component defaults to collapsed (`defaultExpanded = false` at `CollapsibleSection.tsx:13`), which would hide the rows behind a user-click — incompatible with both the AFTER mockup (shown as `▾` expanded) and the row-click flow documented in Flow D. Users can still collapse/expand via the header button if they want; this only sets the initial state.

### `src/features/agent-status/components/AgentStatusPanel.tsx`

- Remove `placeholderFiles`. Leave `placeholderTests` and its `TODO: derive from tool calls…` comment untouched — wiring `TESTS` is out of scope.
- New props: `cwd: string`, `onOpenDiff: (file: ChangedFile) => void`. The whole `ChangedFile` goes up so the MM/AM `staged` flag is preserved through the click handler.
- Call `useGitStatus(cwd, { watch: true, enabled: status.isActive })` — the `enabled` gate is what keeps idle sessions from starting watchers. Derive freshness and feed `FilesChanged` values that always belong to the current cwd, while keeping a current-cwd fetch **failure** visible instead of hiding it behind a permanent loading state:

  ```tsx
  const { files, filesCwd, loading, error, refresh } = useGitStatus(cwd, {...})
  const filesAreFresh = filesCwd === cwd
  const effectiveFiles = filesAreFresh ? files : []

  // `filesCwd` is a last-SUCCESS marker, not a request-settled marker.
  // On a failed fetch (initial or after cwd change), filesCwd stays at
  // its prior value (or null), so `!filesAreFresh` would remain true
  // indefinitely. Only use freshness to synthesize a loading state when
  // there's no error to report — otherwise a real failure would render
  // as "Loading…" forever instead of reaching the error + Retry state.
  const effectiveLoading = loading || (!filesAreFresh && error === null)
  ```

  Forward `files: effectiveFiles`, `loading: effectiveLoading`, `error`, `onRetry: refresh`, `onSelect: onOpenDiff` to `FilesChanged` (inside the existing `status.isActive && status.agentType` branch, which stays). Behavior summary:
  - Cwd change, new fetch in flight, no error → `effectiveLoading: true`, `effectiveFiles: []` → Loading body (hides old-repo rows).
  - Cwd change, new fetch failed → `loading: false`, `!filesAreFresh: true`, `error: Error` → `effectiveLoading: false`, `effectiveFiles: []` → error + Retry (the failure is visible).
  - Initial fetch failed (filesCwd still null) → same as above.
  - Same cwd, refresh succeeded → `filesAreFresh: true`, rows render normally.
  - Same cwd, refresh failed → `filesAreFresh: true`, `effectiveFiles: files` (stale), `effectiveLoading: false`, error set → stale-rows-with-error-banner (unchanged from earlier spec).

- Do not add any `useEffect([status.toolCalls.total])` refresh hook — the watcher owns refresh.

### `src/features/workspace/WorkspaceView.tsx`

- Selection carries its owning cwd so a stale selection from a different repo can be detected at **render time**, not just in a post-commit effect. Add local state:

  ```tsx
  type SelectedDiffFile = { path: string; staged: boolean; cwd: string }

  const [bottomDrawerTab, setBottomDrawerTab] = useState<'editor' | 'diff'>(
    'editor'
  )
  const [selectedDiffFile, setSelectedDiffFile] =
    useState<SelectedDiffFile | null>(null)
  const [isBottomDrawerCollapsed, setIsBottomDrawerCollapsed] = useState(false)

  const cwd = activeSession?.workingDirectory ?? '.'
  ```

  Tagging with `cwd` is what lets `DiffPanelContent` throw the selection away synchronously on cwd change (see its section below). Without the tag, the only defense would be a post-commit `useEffect`, and the reviewer's finding holds: the render BETWEEN cwd change and the effect would still drive `useFileDiff` with the stale `(oldPath, newCwd)` pair. `{ path, staged, cwd }` turns the guard into a pure `raw.cwd === cwd` check during render.

- `handleOpenDiff = useCallback((file: ChangedFile) => { setSelectedDiffFile({ path: file.path, staged: file.staged, cwd }); setBottomDrawerTab('diff'); setIsBottomDrawerCollapsed(false) }, [cwd])` — tag the new selection with the current cwd; also uncollapse the drawer.
- **Belt-and-suspenders effect-based cleanup.** The render-time guard in `DiffPanelContent` is the correctness fix; this effect exists only to prevent stale selection from lingering as GC-visible state if the user never clicks again:
  ```tsx
  useEffect(() => {
    setSelectedDiffFile(null)
  }, [cwd])
  ```
  Don't clear `bottomDrawerTab` or `isBottomDrawerCollapsed` — those are user-facing layout preferences that should persist across session switches; only the pinned file gets invalidated.
- Pass `cwd={cwd}` + `onOpenDiff={handleOpenDiff}` to `<AgentStatusPanel>`.
- Pass `cwd={cwd}`, `activeTab={bottomDrawerTab}`, `onTabChange={setBottomDrawerTab}`, `selectedDiffFile={selectedDiffFile}`, `onSelectedDiffFileChange={setSelectedDiffFile}`, `isCollapsed={isBottomDrawerCollapsed}`, `onCollapsedChange={setIsBottomDrawerCollapsed}` to `<BottomDrawer>`.

### `src/features/workspace/components/BottomDrawer.tsx` + `src/features/diff/components/DiffPanelContent.tsx`

Both accept optional controlled props:

- `BottomDrawer`: `activeTab` / `onTabChange`, `isCollapsed` / `onCollapsedChange`, and (forwarded to `DiffPanelContent`) `selectedDiffFile` / `onSelectedDiffFileChange`.
- `DiffPanelContent`: `selectedFile` / `onSelectedFileChange` — carries the full `SelectedDiffFile` shape `{ path, staged, cwd }` (not just `{ path, staged }` — the `cwd` tag is what powers the render-time staleness guard; stripping it in the prop contract would silently defeat the guard). Opening the staged half of an MM/AM pair shows the staged diff; the cwd tag ensures a lingering selection from a previous repo doesn't fire against the new one.

When the controlled prop is provided, use it; otherwise fall back to existing local state so standalone/test usage still works. The existing in-drawer collapse/expand button wires to `onCollapsedChange(!isCollapsed)`.

**Stale-selection invalidation (DiffPanelContent).** Two layers:

1. **Render-time cwd guard (synchronous, primary fix).** The selection shape is `{ path, staged, cwd }`; a selection from a different cwd is ignored during render before it can reach `useFileDiff`. `useEffect` runs post-commit and can't protect the render that already called the hook — the render-time filter closes the window that effect-only invalidation leaves open.
2. **Effect-driven auto-select / re-select after refresh (secondary).** Same as before: when the effective selection disappears from `files` after a refresh, pick first-valid or clear.

```tsx
// Same shape as WorkspaceView's SelectedDiffFile type — imported
// or re-declared; the important thing is consistency with the
// controlled prop contract.
type SelectedDiffFile = { path: string; staged: boolean; cwd: string }

const isControlled = onSelectedFileChange !== undefined
const [localSelectedFile, setLocalSelectedFile] =
  useState<SelectedDiffFile | null>(null)
const rawSelection = isControlled ? (selectedFile ?? null) : localSelectedFile

// Render-time guard. If the selection was tagged for a different cwd
// (session/repo switch in flight), treat it as absent NOW, not after
// the next commit. This is what prevents useFileDiff from firing with
// (oldPath, newCwd) on the first render under the new cwd.
const effectiveSelectedFile =
  rawSelection !== null && rawSelection.cwd === cwd ? rawSelection : null

const commitSelection = useCallback(
  (next: { path: string; staged: boolean } | null): void => {
    // Always tag with the CURRENT cwd at the moment of the click.
    const tagged = next === null ? null : { ...next, cwd }
    if (isControlled) {
      onSelectedFileChange?.(tagged)
    } else {
      setLocalSelectedFile(tagged)
    }
  },
  [isControlled, onSelectedFileChange, cwd]
)

// Auto-select-first + stale-selection invalidation after refresh.
// Runs on `effectiveFiles`, which is already [] when filesCwd !== cwd,
// so the freshness gate is automatic. statusLoading still guards against
// committing during an in-flight fetch for the same cwd.
useEffect(() => {
  if (statusLoading) return
  const selectionValid =
    effectiveSelectedFile !== null &&
    effectiveFiles.some(
      (f) =>
        f.path === effectiveSelectedFile.path &&
        f.staged === effectiveSelectedFile.staged
    )
  if (effectiveFiles.length > 0 && !selectionValid) {
    const next = effectiveFiles[0]
    commitSelection({ path: next.path, staged: next.staged })
  } else if (effectiveFiles.length === 0 && effectiveSelectedFile !== null) {
    commitSelection(null)
  }
}, [effectiveFiles, effectiveSelectedFile, statusLoading, commitSelection])
```

The three-gate invariant — render-time cwd guard on the selection + `effectiveFiles` freshness filter on the rendered rows / lookup / auto-select + `selectedFileEntry`-based fetch gating — is what closes the stale-IPC window across every path. The selection can't reach `useFileDiff` from a different cwd, the auto-select effect can't resurrect a fresh-looking selection from stale files, and a manual click on a stale row can't happen because there ARE no stale rows to click.

No separate `useEffect(() => setLocalSelectedFile(null), [cwd])` is needed — the render-time guard already makes the stale selection invisible to `useFileDiff` and to the selection-valid check.

Two behaviors this covers:

- User commits or reverts the selected file → next refresh drops it from `files` → effect picks `files[0]` (or clears to null if the list is empty) → controlled parent's state is updated via `onSelectedFileChange` → drawer shows the correct next file.
- Selection `staged` doesn't match any entry (edge case: user staged or unstaged the file out-of-band) → same "pick first" behavior.

Selection match key is `(path, staged)` — matching on path alone would treat the two halves of an MM/AM pair as interchangeable, which they are not.

**Freshness derivation (same pattern AgentStatusPanel uses).** Before any lookup, render, or fetch path, derive `effectiveFiles` from the freshness check so the rest of the component never sees old-repo rows during a cwd transition:

```tsx
const {
  files,
  filesCwd,
  loading: statusLoading,
  error: statusError,
  refresh,
} = useGitStatus(cwd, { watch: true })

const filesAreFresh = filesCwd === cwd
const effectiveFiles = filesAreFresh ? files : []
const effectiveStatusLoading =
  statusLoading || (!filesAreFresh && statusError === null)
```

`effectiveFiles` — not `files` — feeds **every** downstream consumer inside `DiffPanelContent`: the `ChangedFilesList` it renders, the `selectedFileEntry` lookup, the empty/loading/error state branches, and the auto-select effect. Without this, the drawer would keep showing old-repo rows during a cwd switch; a manual click on any of them would call `commitSelection` with a stale `ChangedFile`, the render-time guard would pass (new cwd tag), `selectedFileEntry` would still find it in the raw stale `files`, and `useFileDiff` would fire `(oldPath, newCwd)` — re-creating the exact bug the top-level guard was designed to prevent. Empty rows during the brief stale window is correct behavior; the Loading body covers it.

**`selectedFileEntry` lookup (keeps untracked handling and gates the diff fetch).** `effectiveSelectedFile` is `SelectedDiffFile` (`{ path, staged, cwd }`); it still doesn't carry the full `ChangedFile.status`, which `DiffPanelContent` needs to keep rendering the existing "New file — not yet tracked" placeholder for `untracked` rows (see `DiffPanelContent.tsx:52-55,124-132` — a pre-existing UX that my earlier draft dropped by accident). Resolve the full entry from `effectiveFiles` and use it for three purposes:

```tsx
// Resolve the selected entry from the CURRENT-cwd files list. Looking
// it up in `effectiveFiles` (not raw `files`) is what makes the stale
// window self-healing: during a cwd change, effectiveFiles === [],
// selectedFileEntry === null, useFileDiff receives null. Three jobs:
//   1. untracked detection (keeps the "New file — not yet tracked" view)
//   2. gates the diff fetch — when the selection doesn't match any row
//      (cwd change in-flight, committed/reverted, or stale window),
//      useFileDiff receives null and skips the IPC
//   3. status metadata the SelectedDiffFile shape doesn't carry
const selectedFileEntry =
  effectiveSelectedFile !== null
    ? (effectiveFiles.find(
        (f) =>
          f.path === effectiveSelectedFile.path &&
          f.staged === effectiveSelectedFile.staged
      ) ?? null)
    : null

const selectedFileIsUntracked = selectedFileEntry?.status === 'untracked'

const {
  diff,
  loading: diffLoading,
  error: diffError,
} = useFileDiff(
  selectedFileEntry?.path ?? null, // null on stale selection → useFileDiff no-ops
  effectiveSelectedFile?.staged ?? false,
  cwd
)
```

The fetch-gating via `selectedFileEntry?.path ?? null` — combined with the `effectiveFiles` filter above — closes the cwd-change transient on **both** the auto-select and manual-click paths. During the window between "new cwd prop" and "useGitStatus returns new files", `effectiveFiles === []`, no selection can be resolved, the hook receives `null`, and no IPC fires against `(oldPath, newCwd)`.

Click handlers that update selection still go through `commitSelection`, keeping the controlled/uncontrolled branch in exactly one place.

**No separate cwd-reset effect needed.** The render-time cwd guard on `effectiveSelectedFile` covers both controlled and uncontrolled modes synchronously. The controlled parent's `useEffect([cwd])` cleanup is purely to prevent stale selection from sitting in `WorkspaceView` state; it's not a correctness requirement for `DiffPanelContent`.

### `src/features/diff/components/ChangedFilesList.tsx`

The new `{ path, staged }` selection model has to flow all the way through the drawer's file-list component, not stop at `DiffPanelContent`. Today `ChangedFilesList` has a path-only contract — `selectedPath: string | null`, `onSelectFile: (path: string) => void`, `isActive = file.path === selectedPath`, row key `file.path` — which for an MM/AM pair would highlight both rows as selected simultaneously and lose the `staged` bit on click. Three changes:

- Props:
  ```ts
  interface ChangedFilesListProps {
    files: ChangedFile[]
    selectedFile: { path: string; staged: boolean } | null
    onSelectFile: (file: ChangedFile) => void
  }
  ```
- `isActive = selectedFile?.path === file.path && selectedFile?.staged === file.staged` — both conditions required so the two halves of an MM/AM pair never both highlight.
- Row `key={\`${file.path}:${file.staged}\`}`to give React stable identity across the pair (matches the sidebar`FilesChanged` keying so the two components stay consistent).
- `onClick={(): void => onSelectFile(file)}` — pass the whole `ChangedFile` up so the staged flag makes it into `DiffPanelContent.commitSelection`.

`DiffPanelContent` calls `<ChangedFilesList files={effectiveFiles} selectedFile={effectiveSelectedFile} onSelectFile={commitSelection} />`. Passing `effectiveFiles` (not raw `files`) is what prevents stale old-repo rows from being rendered or clickable during a cwd switch — a manual click on a stale row was the last path that could slip through the render-time selection guard. Existing `ChangedFilesList.test.tsx` cases need updates to pass the new prop shape and assert MM/AM disambiguation (see Tests).

`DiffPanelContent` already uses `useGitStatus(cwd)` internally; flip its call to `useGitStatus(cwd, { watch: true })` so the drawer view also stays live. The per-cwd refcount in the backend watcher means the sidebar and the drawer both subscribing on the same active-session cwd produces two independent refcount increments on the same key — one notify handle shared, clean teardown when either unmounts.

## UI states

| State                                          | Rendering                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Agent inactive                                 | Panel collapses to 0px width (existing behavior). `useGitStatus` is mounted with `enabled: false` so no watcher starts, no IPC fires, no background work happens.                                                                                                                                            |
| Agent active, first fetch in flight            | Section body shows "Loading…" (neutral text, not a spinner — xterm already has motion in the terminal zone).                                                                                                                                                                                                 |
| Agent active, cwd has no `.git/` yet           | `git_status` returns `Ok(vec![])` via the non-repo pre-check → panel shows the zero-changes empty state, not the error state. Watcher is already running; once `git init` creates `.git/`, the next event triggers a refresh.                                                                                |
| Agent active, fetch error, no rows yet         | Section body shows the error message in `text-error` with a Retry button wired to `useGitStatus().refresh()`.                                                                                                                                                                                                |
| Agent active, fetch error, rows already loaded | Row list stays (stale); a compact `role="alert"` banner appears **above** the rows showing `Refresh failed: {message}` with a Retry button. Banner visibility follows `useGitStatus().error` — clears when the next retry starts (brief flash during the loading window), and reappears if that retry fails. |
| Agent active, zero changes                     | Header reads `FILES CHANGED 0`. Expanded body shows "No uncommitted changes" in `text-on-surface-variant`.                                                                                                                                                                                                   |
| Agent active, N changes                        | Rows as in the After mockup: prefix glyph · truncated path · `+N / -N` badge · status badge. Order: staged first, then unstaged; stable sort by path within each group.                                                                                                                                      |

## Tests

Co-located `.test.tsx` / `.test.ts` beside each file, per project convention. TDD-style — failing test first for each unit.

### Backend (`cargo test`)

- `git/mod.rs`
  - `parse_numstat` — `-z` format parser: non-rename record (`<ins>\t<del>\t<path>\0`), rename record (`<ins>\t<del>\t\0<src>\0<dst>\0` → keyed on dst), binary record (`-\t-\t...` → skipped), multiple records in one buffer, empty input
  - `parse_numstat` brace-format regression — the parser is fed a plain (non-`-z`) output containing `src/{A.tsx => B.tsx}` and asserts we do NOT silently match the wrong path (the parser assumes `-z` input; the assertion documents the contract)
  - `parse_git_status` MM/AM dual-entry — input `"MM foo.ts\0"` produces two entries with the same `path` and opposite `staged` flags; same for `AM bar.ts\0`
  - `git_status` integration — end-to-end test on a `tempdir` git repo with staged + unstaged + binary files + an MM file + a rename, asserting the MM file appears as two entries each with their own numstat from the matching map
  - `git_status` resolves repo root — tempdir layout `repo/.git/ + repo/sub/foo.ts (modified)`; calling `git_status(cwd = repo/sub)` returns the modified file just like `cwd = repo` would; calling `git_status(cwd = /tmp/not-a-repo)` returns `Ok(vec![])`
  - `git_status` non-repo — cwd outside any repo returns `Ok(vec![])` (not an error)
  - `git_status` timeout — one subprocess times out → whole call returns error (no partial data)
  - `get_git_diff` resolves repo root — same tempdir layout as above; calling `get_git_diff(cwd = repo/sub, file = "sub/foo.ts", staged = false)` returns a populated `FileDiff.hunks` (not empty), matching what `cwd = repo` would return
  - `get_git_diff` non-repo — `cwd` outside any repo returns a `FileDiff` with empty `hunks` (not an error)
- `git/watcher.rs`
  - `GitWatcherState` subscribers per toplevel, keyed by cwd with a **refcount** — calling `start_git_watcher` with `cwd=repo/src/a` and again with `cwd=repo/src/b` stores both cwds as separate keys each with refcount 1; `stop_git_watcher(repo/src/a)` removes that key but leaves the watcher live with the `/repo/src/b` subscriber; a second stop drops the entry.
  - **Same-cwd refcount (the sidebar + drawer case)**: calling `start_git_watcher("/repo")` twice stores one key with refcount 2; `stop_git_watcher("/repo")` decrements to 1 — watcher stays live (the sidebar is still mounted); a second stop drops to 0, the key is removed, the empty subscribers map triggers teardown of notify handles. This is the regression test for the HashSet-dedup bug that would have torn the watcher down on the first unmount.
  - **Same-cwd refcount for pre-repo entries**: calling `start_git_watcher("/tmp/scaffold")` twice (non-repo) bumps `pre_repo_watchers["/tmp/scaffold"].refcount` to 2; a single `stop` decrements to 1, entry stays; second `stop` drops.
  - Event fan-out — when the watcher fires (notify event or polling), the emitted `git-status-changed` payload has `cwds: ["repo/src/a", "repo/src/b"]` containing every current subscriber, not just one. Unsubscribing mid-debounce removes the cwd from the next snapshot.
  - Debounce: 10 rapid writes produce ≤ 2 emitted events within a 1s window
  - Initial fire: `start_git_watcher` emits one event before returning, with the input cwd in the singleton `cwds` array
  - Pre-repo handle: `start_git_watcher` on a non-repo dir succeeds and stores a `pre_repo_watchers[cwd]` entry whose only live component is the 10s polling thread. No notify watches are registered yet.
  - Auto-upgrade on `git init`: starting from the pre-repo state above, running `git init` in the dir is detected by the poller on its next 10s tick. The entry moves from `pre_repo_watchers` to `repo_watchers[toplevel].subscribers`, the notify registrations come up (filtered walk + `.git/index` + `.git/HEAD`), and a `git-status-changed { cwds: [input_cwd] }` event fires.
  - Ignored subtrees are not watched — a tempdir with `.gitignore` excluding `ignored/` should register zero watch slots under `ignored/`, even if the directory has many files (probe via `notify::Watcher::watch()` being called only with non-ignored paths — mock out the notify crate for this)
  - Dynamic directory registration — a `mkdir src/new_subdir` under the watched tree triggers a new `NonRecursive` registration for that path (observable via the mocked watcher)
  - Polling fallback: with the notify watcher stubbed out, a manual OID change still produces an event within 15s

### Frontend (Vitest + Testing Library)

- `FilesChanged.test.tsx`
  - **Default expanded**: with one or more files, the body is visible on initial mount without a user click (`defaultExpanded={true}` passthrough). Compare against `CollapsibleSection`'s isolated default to guard against the default ever flipping back.
  - Empty state (loading=false, error=null, files=[]) → "No uncommitted changes" rendered
  - **Loading with empty files** (loading=true, files=[]) → "Loading…" body rendered, no Retry button
  - **Loading with populated files** (loading=true, files=[A, B]) → rows A and B still render (stale list preserved across refreshes); no Loading body
  - **Error with no rows** (error=Error, files=[]) → error message rendered with Retry button; clicking Retry calls `onRetry`
  - **Error with stale rows** (error=Error, files=[A, B]) → rows A and B still render; a `role="alert"` banner appears above the row list with the error message and a Retry button; clicking Retry calls `onRetry`. When the prop flips (error=null, files=[A, B]) the banner disappears while the rows remain. When the prop flips again (error=Error, files=[A, B]) the banner reappears. This mirrors how `useGitStatus` resets `error` at retry-start.
  - Populated → each `ChangedFile` renders prefix, path, status badge
  - `insertions` / `deletions` present → `+N / -N` rendered; absent → badge omitted
  - Click a row → `onSelect(file)` fires with the full `ChangedFile` (not just the path)
  - MM/AM pair → two entries with the same `path` and opposite `staged` render as two distinct rows, the staged row carries the `STAGED` label, the unstaged row does not, and each click routes with the correct `staged` value
- `useGitStatus.test.ts`
  - Non-watch mode: existing tests still pass
  - Watch mode: mount calls `start_git_watcher` invoke; incoming event with `cwds` including myCwd triggers refresh; incoming event whose `cwds` does NOT include myCwd is ignored; unmount calls `stop_git_watcher`
  - **Mount ordering (race-free)**: `listen('git-status-changed', ...)` resolves BEFORE `invoke('start_git_watcher', ...)` is called; after both complete, an explicit third `refresh()` fires. Verified via mock call-order assertions on listen/invoke; a mid-sequence synthetic event (fired after listen attach but before start_git_watcher returns) is caught by the handler.
  - **Unmount ordering**: `unlisten()` is called before `invoke('stop_git_watcher', ...)` so a late in-flight event can't call refresh on a torn-down hook.
  - Shared-watcher fan-out: two hooks at `/repo/src/a` and `/repo/src/b` both refresh when a single event with `cwds: ["/repo/src/a", "/repo/src/b"]` arrives
  - **`filesCwd` freshness tracking**: mount with `cwd="/a"` → before first fetch resolves, `filesCwd` is `null`; after resolve, `filesCwd === "/a"`. Change `cwd` to `/b` → during the in-flight fetch for `/b`, `filesCwd` is still `"/a"` (the last successful cwd); after `/b`'s fetch resolves, `filesCwd === "/b"`. If `/b`'s fetch fails, `filesCwd` remains `"/a"` (only success updates it).
  - `enabled: false` — hook returns `{ files: [], filesCwd: null, loading: false, error: null, refresh }` with no invoke and no listener attach; flipping `enabled` to `true` starts the watcher; flipping back to `false` tears it down
- `ChangedFilesList.test.tsx` (update existing cases for new prop shape)
  - Existing selection tests: swap `selectedPath: "foo.ts"` for `selectedFile: { path: "foo.ts", staged: false }`; `onSelectFile` receives the full `ChangedFile`
  - **MM/AM disambiguation**: with `files = [{ path: "foo.ts", staged: true, ... }, { path: "foo.ts", staged: false, ... }]` and `selectedFile = { path: "foo.ts", staged: true }` → only the staged row has the active style; clicking the unstaged row fires `onSelectFile` with its `staged: false` file
  - **Row keys are unique across MM/AM pairs**: rendering an MM pair produces two distinct React keys (no duplicate-key warning in the test console)
- `AgentStatusPanel.test.tsx`
  - With `sessionId` and `cwd`, renders `FilesChanged` with files from the mocked `useGitStatus`
  - Click a file bubbles to `onOpenDiff` with the full `ChangedFile` (path, status, and `staged` flag preserved so the MM/AM routing works)
  - When `sessionId` is null, renders nothing (preserve collapsed-width existing behavior)
  - When `status.isActive === false`, `useGitStatus` is mounted with `enabled: false` (assert via the mocked hook receiving the option)
  - **Stale filesCwd renders loading, not old rows**: mock `useGitStatus` returns `{ files: [A, B], filesCwd: '/old', loading: false, error: null }` while the component's `cwd` prop is `/new` → `FilesChanged` is passed `loading: true` and `files: []` (not the stale rows). Once the mock flips to `filesCwd: '/new'`, the real rows flow through.
  - **Cwd-change fetch failure still reaches error state**: mock `useGitStatus` returns `{ files: [], filesCwd: '/old', loading: false, error: Error('boom') }` while the component's `cwd` prop is `/new` → `FilesChanged` is passed `loading: false`, `files: []`, and the error; the error + Retry body renders (not the Loading body). Guards against the `filesCwd`-is-last-success-marker footgun where a failed initial fetch or failed post-cwd-change fetch would otherwise be hidden behind a permanent loading state.
- `WorkspaceView.integration.test.tsx`
  - Clicking a file in the sidebar panel switches `BottomDrawer` to the diff tab AND `DiffPanelContent` shows that file
  - Clicking a file while the drawer is collapsed also **uncollapses** it (drawer height > 48px after the click)
  - Clicking the **staged** half of an MM/AM pair opens `DiffPanelContent` with `staged=true` (verified via the mocked `useFileDiff` receiving `staged: true` in its args); clicking the unstaged half opens it with `staged: false`
  - **Session-switch selection reset**: open a file, then switch active session (cwd changes) → `selectedDiffFile` is cleared (belt-and-suspenders effect in `WorkspaceView`); `bottomDrawerTab` and `isBottomDrawerCollapsed` are **not** cleared (layout prefs persist)
  - **Render-time cwd guard (primary fix for stale diff request)**: set up `DiffPanelContent` with `selectedFile = { path: 'a/foo.ts', staged: false, cwd: '/repo/a' }`, re-render with a new `cwd = '/repo/b'` prop (and the stale selection still passed in for this render — simulating the single render between a cwd change and the parent's cleanup effect). Assert that on that render, the mocked `useFileDiff` is called with `filePath: null`, not `'a/foo.ts'`. This is the core assertion closing the HIGH finding on render-time staleness.
  - **Auto-select gated on `filesCwd === cwd` (follow-up fix)**: configure the `useGitStatus` mock to return `{ files: [A, B], filesCwd: '/repo/a', loading: false }` while the component's `cwd` prop is `/repo/b` (simulating "cwd already changed, old files still in place, no loading flag yet"). Assert that the auto-select effect does **not** call `onSelectedFileChange` during this render. Then advance the mock to `{ files: [C, D], filesCwd: '/repo/b', loading: false }` and assert auto-select now commits `{ path: C.path, staged: C.staged, cwd: '/repo/b' }`. This is the test the reviewer specifically asked for — switching cwd while old rows are still present and loading is false.
  - **Stale rows are not rendered or clickable (manual-click regression)**: same setup as above (`filesCwd: '/repo/a'`, `cwd: '/repo/b'`, `loading: false`). Assert `ChangedFilesList` is rendered with `files={[]}` — no row for `A` or `B` is in the DOM, so the user cannot click one. Then simulate a `fireEvent.click` against a hypothetical stale-row selector and assert nothing changes (no call to `onSelectedFileChange`, no IPC fires via the mocked `useFileDiff`). Guards the path the reviewer flagged: even if the user were fast enough to click mid-transition, there are no stale rows to click.
  - **Auto-select after refresh**: with a stale selection ignored (because cwd mismatch), the auto-select-first effect should fire once `useGitStatus` returns `files` for the new cwd; `DiffPanelContent` calls `onSelectedFileChange` with `{ path, staged, cwd: newCwd }` (tagged with the new cwd).
  - **commitSelection tags with current cwd**: click a file inside `DiffPanelContent` while `cwd = '/repo/b'` → `onSelectedFileChange` receives `{ path, staged, cwd: '/repo/b' }`, not a plain `{ path, staged }`.
  - **Stale-selection invalidation via refresh (commit/revert)**: with selection pinned and tagged for the current cwd, simulate a `useGitStatus` refresh whose new `files` no longer contains that selection → `DiffPanelContent` calls `onSelectedFileChange` with the first remaining file (or `null` if empty). This is the same-cwd analogue of the cwd-guard test.
  - **Uncontrolled fallback**: mount `DiffPanelContent` without `selectedFile`/`onSelectedFileChange` props → auto-select-first still happens (via local state, with local selection tagged with the current cwd); committing a selected file out of `files` still triggers a re-select via local setter.
  - **Uncontrolled cwd guard**: in uncontrolled mode, click a file at `cwd = '/repo/a'`; change the `cwd` prop to `/repo/b`. On the render under the new cwd, `useFileDiff` observed to be called with `filePath: null` (render-time guard hides the old selection); the subsequent auto-select-first effect re-selects against `/repo/b`'s `files` once they arrive.
  - **Untracked file regression guard**: with `files = [{ path: "new.ts", status: "untracked", ... }]` and the row selected, `DiffPanelContent` renders the existing "New file — not yet tracked" placeholder (not `DiffViewer`, not an error). `useFileDiff` is called with `filePath: "new.ts"` per the existing pattern, but the render branch on `selectedFileIsUntracked` short-circuits to the placeholder. Matches `DiffPanelContent.tsx:124-132`'s current behavior.

## Dependencies added

- Rust: `ignore = "0.4"` (new Cargo dep)
- npm: none

## Out of scope

- **`ChangedFile` dual-flag rewrite** — this spec emits two `ChangedFile` entries for MM/AM paths to represent both halves without changing the type. A richer single-record representation (e.g. `{ staged: { ins, del }, unstaged: { ins, del } }` on one entry, eliminating the row duplication) is the subject of [`2026-04-11-mm-staged-unstaged-design.md`](./2026-04-11-mm-staged-unstaged-design.md) and can land separately. The dual-entry approach here is correct but visually duplicates the path for MM/AM rows; the future rewrite would collapse them into one row with both numstats on it.
- Staging / unstaging from the panel — needs `stage_file` / `unstage_file` Tauri commands
- Per-session "base SHA" filter ("since session start") — user picked full uncommitted state
- Changing the footer `+N / -N` to git-sourced numbers (stays agent-sourced on purpose)
- Cross-cwd aggregation (watcher is per-cwd; no "all repos" view)
- Honoring `.ignore` (ripgrep-specific) — v1 honors `.gitignore` + `.git/info/exclude` + nested gitignores via the `ignore` crate's defaults
- Diff line highlighting / word-level diff — `DiffViewer` already does what it does
- Surfacing a "new commit" notification when `.git/HEAD` changes — the watcher fires `git-status-changed`, the refresh clears the list, done
- `TestResults` wiring — placeholder stays placeholder; separate feature
