# PTY Reattach on Reload — Design

**Status:** Draft for review
**Date:** 2026-04-25
**Issue:** [#55](https://github.com/winoooops/vimeflow/issues/55)
**Branch:** `fix/55-pty-reattach-on-reload`

## Problem

When a file change in the project triggers a Vite HMR full-page reload (e.g. saving a file with `vim :w`, or Claude Code writing tool-result files into `.vimeflow/`), the React app remounts. The frontend's in-memory session list, terminal cache, and PTY-session map are wiped. The Rust-side `PtyState` keeps the PTY processes alive, but no listener on the frontend is bound to them — so the React app spawns brand-new PTY sessions with default `cwd: "~"`, orphaning the originals.

Observed effect (from issue #55): five `spawn_pty` calls within ~23 seconds during a single Claude Code session, each attaching to a fresh shell, while the original `claude` process keeps running on a disconnected PTY.

## Goal

Make any frontend remount — HMR, manual refresh, error-boundary reset, future crash recovery — a harmless, near-invisible operation. After a reload, the user's terminals, cwd, and agent-detection state come back exactly as they were. The brief reload window does not drop terminal output (small replay buffer covers it). Historical scrollback beyond the replay buffer is acceptable to lose.

Tauri-process restart (a different scenario from frontend reload) is **out of scope** for v1; PTY processes die when their parent Rust process dies, so no amount of cache restoration brings them back. The cache will, however, surface them on next launch as `Exited` sessions the user can explicitly restart.

## Architecture

### Three layers, three owners

```
                              ┌──────────────────────────────────┐
                              │  Frontend (React webview)        │
                              │                                  │
                              │  localStorage:                   │
   On spawn / kill   ◄────────┤    'vimeflow:session-state-v1'   │
                              │    { sessionIds: string[],       │
                              │      activeSessionId: string }   │
                              └──────┬──────────┬────────────────┘
                                     │          │
                       restore_sessions    pty-data, spawn_pty, kill_pty,
                       update_session_cwd  resize_pty, write_pty (existing)
                                     │          │
                                     ▼          ▼
                              ┌──────────────────────────────────┐
                              │  Rust (Tauri main process)       │
                              │                                  │
                              │  PtyState (in-memory, existing): │
                              │    HashMap<id, ManagedSession>   │
                              │    + 64 KB ring buffer / session │
                              │                                  │
                              │  SessionCache (filesystem, new): │
                              │    app_data_dir/sessions.json    │
                              └──────────────────────────────────┘
```

| Layer                        | Owner    | Holds                                                                        |
| ---------------------------- | -------- | ---------------------------------------------------------------------------- |
| `localStorage`               | Frontend | Tab order (id list) and active selection. UI-only state.                     |
| `app_data_dir/sessions.json` | Rust     | Canonical session metadata: `cwd`, `created_at`, `exited`, `last_exit_code`. |
| `PtyState` (in-memory)       | Rust     | Live PTY processes + per-session ring buffer of recent output.               |

The cache file represents **intent** ("these sessions should exist"); `PtyState` represents **reality** ("these are alive"); `restore_sessions` reconciles the two and returns a merged view to the frontend.

💡 **IDEA — why this split**

- **I — Intent**: separate UI state (order/selection — no value to Rust) from session state (cwd/exit — needed by both Rust internals and the frontend), so each side persists what it owns.
- **D — Danger**: data duplication if not careful. We avoid it by never storing the same field in both places. localStorage knows ids; Rust knows everything else about each id.
- **E — Explain**: putting cwd in localStorage requires the frontend to round-trip every OSC 7 change through IPC anyway (so Rust's cache stays current); putting tab order in Rust would require IPC for every drag-reorder. Each lives where the writer lives.
- **A — Alternatives**: single source of truth in Rust (forces one IPC roundtrip per UI tweak — bad UX); single source of truth in localStorage (Rust can't drive a respawn without frontend telling it cwd — bad architecture). Hybrid wins.

## Data Model

### localStorage

```ts
// Key: 'vimeflow:session-state-v1'
interface PersistedSessionState {
  sessionIds: string[] // tab order
  activeSessionId: string | null // currently focused tab
}
```

The schema version lives in the key (`-v1`); a future migration writes to `-v2` and drops the old key.

### Filesystem cache

```jsonc
// app_data_dir/sessions.json — atomic write via tempfile + rename
{
  "version": 1,
  "sessions": {
    "550e8400-e29b-41d4-a716-446655440000": {
      "cwd": "/home/will/projects/vimeflow",
      "created_at": "2026-04-25T07:30:00Z",
      "exited": false,
      "last_exit_code": null,
    },
    "6ba7b810-9dad-11d1-80b4-00c04fd430c8": {
      "cwd": "/home/will/projects/foo",
      "created_at": "2026-04-25T07:35:00Z",
      "exited": true,
      "last_exit_code": null,
    },
  },
}
```

`last_exit_code` is `Option<i32>` and **always `None` in v1**. Capturing the actual exit code requires calling `child.try_wait()` from the read loop after EOF, which adds locking complexity to the existing reader; deferred to a follow-up. The frontend renders Exited sessions without an exit-code badge for now.

### Tab name derivation (deterministic, never persisted)

```ts
function tabName(cwd: string, index: number): string {
  if (cwd === '~' || cwd === os.homedir()) return `session ${index + 1}`
  return basename(cwd)
}
```

User renames are kept in `useSessionManager` in-memory state and are not persisted. They survive within a session but are lost on reload. This is a deliberate scope cut — see the IDEA block under "Out of Scope" below.

### Rust types (mirror to TS via `ts-rs`)

```rust
struct CachedSession {
    cwd: String,
    created_at: String,        // ISO-8601 UTC
    exited: bool,
    last_exit_code: Option<i32>,
}

struct SessionCache {
    version: u32,
    sessions: HashMap<String, CachedSession>,
}

#[serde(tag = "kind")]
enum SessionRestoreResult {
    Alive    { id: String, cwd: String, pid: u32, replay_data: String },
    Exited   { id: String, cwd: String, last_exit_code: Option<i32> },
    Missing  { id: String },
}
```

## IPC Contract

### New: `restore_sessions(ids: Vec<String>) -> Result<Vec<SessionRestoreResult>, String>`

For each id (cap: **64 per call**, returns outer `Err` if exceeded):

| Cache state               | `PtyState` state                      | Result                                               |
| ------------------------- | ------------------------------------- | ---------------------------------------------------- |
| not present               | —                                     | `Missing { id }` — frontend prunes from localStorage |
| present + `exited: false` | alive                                 | `Alive { id, cwd, pid, replay_data }`                |
| present + `exited: false` | absent (race: read-loop EOF mid-call) | `Exited { id, cwd, last_exit_code: None }`           |
| present + `exited: true`  | absent                                | `Exited { id, cwd, last_exit_code }`                 |

Each id is validated against the same allow-list as `spawn_pty` (UUID-shaped: alphanumeric, hyphens, underscores). Invalid ids return `Missing` rather than erroring the whole call — the frontend can prune them.

`replay_data` is the contents of the per-session ring buffer (64 KB max, lossy UTF-8 — same lossy decode as the existing `pty-data` event). It lets the frontend repaint the screen for the reload window before new bytes arrive.

The outer `Result` distinguishes "cache file is corrupt or unreadable" (treat as catastrophic, log + degrade) from "individual session has problems" (per-result variants).

### Modified: `spawn_pty`

**Contract change** — currently kills and replaces an existing session at `commands.rs:211-218`. New behavior:

```rust
if state.contains(&request.session_id) {
    return Err("session already exists".into())
}
```

Reattach goes through `restore_sessions`, never `spawn_pty`. The "kill on id reuse" path was a defensive measure that becomes a footgun once IDs are persisted: a stray spawn with a known id during reload would kill the very PTY we're trying to reattach to.

`spawn_pty` also writes a new `CachedSession` entry to the filesystem cache (atomic temp-file + rename) on successful spawn.

### Modified: `kill_pty`

**Contract change** — currently errors on missing sessions. New behavior: **idempotent**.

```rust
state.kill(&id).ok();          // no-op if not present
state.remove(&id);             // no-op if not present
cache.remove(&id);             // remove from filesystem cache
Ok(())
```

This subsumes the "explicit user closes a tab" and the "click Restart on an Exited session" flows. The Restart flow is: frontend calls `kill_pty(old_id)` (no-op cleanup) then `spawn_pty(new_uuid, cached_cwd)`.

### New: `update_session_cwd(id: String, cwd: String) -> Result<()>`

Called by the frontend whenever the OSC 7 handler in `TerminalPane.tsx` fires. Updates the cache entry's `cwd` so a subsequent restore replays the live cwd, not the spawn cwd.

Validates `id` (UUID shape) and `cwd` (must be an absolute path, must exist) before writing.

### Unchanged

`write_pty`, `resize_pty`, the `pty-data` / `pty-exit` / `pty-error` events — all keep their current contracts. The ring-buffer write happens transparently inside the read loop.

## Lifecycle

```
spawn_pty(id, cwd)
   ├─ insert into PtyState
   ├─ start read loop (PTY → ring buffer → pty-data event)
   └─ write CachedSession { cwd, created_at, exited: false } to cache file (atomic)

OSC 7 cwd change in xterm
   └─ frontend: update_session_cwd(id, new_cwd)
        └─ cache.sessions[id].cwd = new_cwd; flush

read-loop EOF (PTY process exited naturally)
   ├─ remove_if_generation in PtyState
   └─ mark cache: cache.sessions[id].exited = true; last_exit_code = Some(code); flush

kill_pty(id)  — explicit close (tab close, restart-flow cleanup)
   ├─ kill child (if alive)
   ├─ remove from PtyState (if present)
   └─ remove from cache; flush

restore_sessions(ids[])  — frontend reload
   ├─ load cache (in-memory mirror, single read at app start)
   ├─ for each id: validate, look up in cache, check PtyState liveness
   └─ return Vec<SessionRestoreResult>

Tauri app shutdown
   └─ no special handling. PTYs die → read-loops EOF → cache marks exited.
       Next launch: all sessions show as Exited; user can Restart or close.
```

## Replay Buffer

Each `ManagedSession` in `PtyState` gains a `VecDeque<u8>` ring buffer with a fixed capacity (default 65536 bytes / 64 KB).

The read loop in `commands.rs:316-360` writes every chunk to the buffer before emitting the `pty-data` event:

```rust
session_buffer.write(&buf[..n]);  // truncates from front when over capacity
app.emit("pty-data", PtyDataEvent { session_id, data })?;
```

`restore_sessions` snapshots the buffer (lossy-utf8) into `replay_data`. The frontend writes `replay_data` into xterm.js with `terminal.write(replayData)` _before_ re-attaching the `pty-data` listener — this prevents duplicate display of the same bytes if a new chunk arrives mid-restore (xterm processes writes serially).

Sizing rationale: 64 KB covers ~1000 lines at typical width (80 cols × 80 chars/line), which exceeds the visible terminal area for any reasonable reload window. Increasing memory cost is bounded: 64 KB × N sessions; with 10 sessions that's 640 KB, with 64 (cap) it's 4 MB. Acceptable.

## Frontend Integration

```
src/
├── features/
│   ├── workspace/hooks/
│   │   └── useSessionManager.ts        ← read localStorage on init, write
│   │                                     on every change; reconcile via
│   │                                     restore_sessions on mount
│   ├── terminal/
│   │   ├── components/TerminalPane.tsx ← restored-mode branch:
│   │   │                                 1. write replayData to xterm
│   │   │                                 2. register pty-data listener
│   │   │                                 3. send resize → triggers SIGWINCH
│   │   │                                    → TUI redraw
│   │   ├── hooks/useTerminal.ts        ← decouple unmount from kill;
│   │   │                                 attach path that doesn't call spawn
│   │   ├── services/
│   │   │   └── tauriTerminalService.ts ← restoreSessions(),
│   │   │                                 updateSessionCwd() methods
│   │   └── ptySessionMap.ts            ← repopulate from restore results
│   │                                     (currently lost on remount)
│   └── workspace/components/
│       └── TerminalZone.tsx            ← consume restore-results to mount
│                                         the right TerminalPanes
└── bindings/                            ← regenerated via
                                          `npm run generate:bindings`

src-tauri/src/terminal/
├── commands.rs           ← spawn_pty contract change; new restore_sessions /
│                           update_session_cwd / idempotent kill_pty;
│                           ring buffer write in read loop
├── state.rs              ← ManagedSession + ring buffer; promote
│                           active_ids() out of e2e-only cfg
├── cache.rs (new)        ← SessionCache: load/save with atomic rename,
│                           in-memory mirror, schema migration
└── types.rs              ← SessionRestoreResult, CachedSession,
                            UpdateSessionCwdRequest

vite.config.ts            ← Option A: server.watch.ignored (separate commit)
```

### TerminalPane unmount semantics

`useTerminal.ts:191` already gates the unmount-time kill behind `didSpawnSessionRef.current`, with try/catch lenient on errors. Today, that flag is set to `true` after a successful `spawn_pty` and never reset.

The change is: **the restore path never sets `didSpawnSessionRef.current = true`.** When `useTerminal` runs in restored mode (called via `attach`/`restore_sessions` rather than `spawn`), the ref stays `false`, so the existing cleanup branch is skipped and the PTY outlives the React component.

Explicit kill paths are unchanged — `removeSession()` in `useSessionManager` (triggered by user-driven tab close) calls `kill_pty` directly, bypassing the ref entirely. With the new idempotent `kill_pty`, the call succeeds even if the read loop already EOF'd and removed the session from `PtyState`.

The TerminalPane unmount cleanup retains: xterm.js dispose, `pty-data` listener removal, `ResizeObserver` disconnect.

## Failure Modes

| Failure                                           | Handling                                                                                                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cache file unparseable / corrupt                  | `restore_sessions` returns `Err("cache corrupt: <details>")`. Frontend logs, treats as empty cache, prunes localStorage. A `.bak` is kept on every write so a manual recovery is possible. |
| `app_data_dir` not writable                       | Cache writes log a warning but do not fail `spawn_pty`. Sessions work in-memory; restoration is a no-op.                                                                                   |
| localStorage quota exceeded                       | We store a few KB; not realistically reachable. Falls back to no-persistence on this load.                                                                                                 |
| Atomic write interrupted (Tauri crash mid-rename) | `tempfile::NamedTempFile::persist` either fully renames or doesn't — never leaves a torn file. Worst case we see the prior version.                                                        |
| ID in localStorage but not in cache               | `Missing { id }` → frontend prunes from localStorage.                                                                                                                                      |
| ID in cache but not in localStorage               | Orphan in cache. Not surfaced to user. Filed as a known minor leak; v2 GC pass on each restore could prune entries older than N days.                                                      |
| OSC 7 cwd update for an unknown id                | `update_session_cwd` returns `Err("unknown session")`. Frontend logs and ignores.                                                                                                          |
| `restore_sessions` called with > 64 ids           | Outer `Err("too many sessions: 75 > 64")`. Frontend truncates and retries with the most-recent 64, surfaces a "session limit" message for the rest.                                        |
| Cap exceeded on spawn                             | Defer — current `spawn_pty` has no cap; we don't add one in this PR.                                                                                                                       |

## Testing Strategy

### Rust (`src-tauri/src/terminal/`)

| Test                                                  | What it pins                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------- |
| `restore_sessions_returns_alive_for_running_pty`      | Happy path: alive variant + replay_data populated                   |
| `restore_sessions_returns_exited_for_dead_pty`        | Read-loop EOF marks cache; restore reflects it                      |
| `restore_sessions_returns_missing_for_unknown_id`     | localStorage drift handled                                          |
| `restore_sessions_replay_data_contains_recent_output` | Ring buffer write + restore round-trips bytes                       |
| `restore_sessions_replay_data_truncated_at_capacity`  | Long output respects 64 KB cap                                      |
| `restore_sessions_rejects_invalid_id_format`          | Security — no path injection via ids                                |
| `restore_sessions_caps_at_64_ids`                     | DoS guard on outer error                                            |
| `spawn_pty_returns_error_on_existing_session_id`      | Contract change: no more kill-and-replace                           |
| `kill_pty_is_idempotent_for_missing_session`          | Contract change: no more error on missing                           |
| `kill_pty_removes_cache_entry`                        | Lifecycle cleanup                                                   |
| `update_session_cwd_persists_to_cache`                | OSC 7 sync path                                                     |
| `update_session_cwd_rejects_invalid_path`             | Validation                                                          |
| `read_loop_eof_marks_cache_exited`                    | Lifecycle: natural exit                                             |
| `cache_atomic_write_survives_simulated_crash`         | Write to tmp, kill before rename, ensure old file intact            |
| `cache_corrupt_file_returns_error_not_panic`          | Outer `Err` path, no crash                                          |
| `cache_schema_v1_migration_to_v2`                     | Future-proofing if v1 ever shipped (not yet, but the path is wired) |

### Frontend (`src/features/{workspace,terminal}/`)

| Test                                                                      | What it pins                         |
| ------------------------------------------------------------------------- | ------------------------------------ |
| `useSessionManager_round_trips_through_localStorage`                      | Persist on change, load on init      |
| `useSessionManager_prunes_localStorage_on_missing_result`                 | Drift cleanup                        |
| `useSessionManager_renders_exited_sessions_with_restart_action`           | UX for Exited variant                |
| `TerminalPane_restored_mode_skips_spawn_calls_attach`                     | No new PTY spawn on reload           |
| `TerminalPane_restored_mode_writes_replay_data_to_xterm_before_listening` | Ordering: replay before live         |
| `TerminalPane_restored_mode_sends_resize_after_attach`                    | SIGWINCH nudge for TUIs              |
| `useTerminal_unmount_does_not_call_kill`                                  | Contract change: lifecycle decoupled |
| `removeSession_explicitly_calls_kill_pty`                                 | Explicit close path still works      |
| `osc7_cwd_change_calls_update_session_cwd`                                | Live cwd persistence                 |

### Manual smoke

1. `npm run tauri:dev`
2. Open terminal, `cd /tmp`, run `vim foo.txt`, type some text
3. Switch to source editor in the host system, edit `vite.config.ts` (something HMR-able)
4. Watch the Vimeflow window: terminal should reattach within ~300 ms; vim's editor view should be visible (replay data) and fully redraw on the next keystroke.
5. Run `claude` inside a terminal, interact with it, then trigger a reload by saving any project file. Claude session should continue uninterrupted.

## Out of Scope

The following are deliberately not in this PR:

- **Tab name persistence.** Renames live in-session and are lost on reload.
- **Tab name across Tauri restart.** Names regenerate from cwd on every fresh load.
- **Historical scrollback (beyond the 64 KB replay window).** Bash/zsh output produced more than ~1000 lines ago is gone after reload. A separate spec can address this with a larger or persisted buffer.
- **Tauri-restart session restoration UX polish.** The cache supports it, but we don't yet show a curated "restore previous sessions?" prompt.
- **Cache GC for orphaned entries.** If the cache somehow has entries the frontend doesn't know about (localStorage cleared independently), they stay there. Manual cleanup or v2 GC pass.

💡 **IDEA — why "no auto-respawn for Exited"**

- **I — Intent**: keep "session exited naturally" and "session was reloaded" as distinct user-visible states.
- **D — Danger**: auto-respawn would mask user mistakes (e.g., they typed `exit`, expected it to close, but the session keeps coming back). It also does the wrong thing when the cwd has been deleted between exit and respawn — silent failure or a confusing terminal state.
- **E — Explain**: explicit "Restart" gives the user a beat to decide whether they want this session back. The cost is a single click per Exited session on next launch.
- **A — Alternatives**: auto-respawn with opt-out flag (hidden, easy to forget); silent-prune on exit (user loses ability to reopen recent sessions). Explicit-action wins for clarity.

💡 **IDEA — why drop tab name persistence**

- **I — Intent**: minimize the surface area of "tab metadata" by keeping only what's reproducible from cwd.
- **D — Danger**: users who renamed tabs lose their custom names on reload. We accept this for v1.
- **E — Explain**: persisting names cascades into rename-during-restore races, name collision UX, and a third sync channel (frontend rename → IPC → cache → next-restore). Each adds two or three test cases. Cwd-derived names are deterministic, automatically reflect OSC 7 changes, and don't drift.
- **A — Alternatives**: store names in localStorage (frontend-only, no IPC); store in cache (full IPC contract). Both add edge cases without solving a real-world pain — most users don't rename terminal tabs.

## Commit Plan

Branch: `fix/55-pty-reattach-on-reload`

1. **`fix(vite): exclude .vimeflow/, target/, .codex*/ from HMR watch`** — ~5 lines in `vite.config.ts`. Reduces noise from tool-result writes.
2. **`feat(terminal): persist & reattach PTY sessions across reload`** — the architecture change. Backend cache module + ring buffer + new IPC commands; frontend localStorage + restore-mode TerminalPane; full test suite.

## References

- Issue: [#55](https://github.com/winoooops/vimeflow/issues/55)
- Per-finding/per-option reasoning shape: [`rules/common/idea-framework.md`](../../../rules/common/idea-framework.md)
- Existing PTY architecture: `src-tauri/src/terminal/{state.rs, commands.rs}`
- Tauri `app_data_dir` API: <https://docs.rs/tauri/latest/tauri/path/struct.PathResolver.html#method.app_data_dir>
- `tempfile::NamedTempFile::persist` for atomic writes: <https://docs.rs/tempfile/latest/tempfile/struct.NamedTempFile.html#method.persist>
