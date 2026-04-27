# PTY Reattach on Reload — Design

**Status:** Draft for review (revised)
**Date:** 2026-04-25
**Issue:** [#55](https://github.com/winoooops/vimeflow/issues/55)
**Branch:** `fix/55-pty-reattach-on-reload`

## Problem

When a file change in the project triggers a Vite HMR full-page reload (e.g. saving a file with `vim :w`, or Claude Code writing tool-result files into `.vimeflow/`), the React app remounts. The frontend's in-memory session list, terminal cache, and PTY-session map are wiped. The Rust-side `PtyState` keeps the PTY processes alive, but no listener on the frontend is bound to them — so the React app spawns brand-new PTY sessions with default `cwd: "~"`, orphaning the originals.

Observed effect (from issue #55): five `spawn_pty` calls within ~23 seconds during a single Claude Code session, each attaching to a fresh shell, while the original `claude` process keeps running on a disconnected PTY.

## Goal

Make any frontend remount — HMR, manual refresh, error-boundary reset, future crash recovery — a harmless, near-invisible operation. After a reload, the user's terminals, cwd, agent-detection state, tab order, and active-tab selection come back exactly as they were. The brief reload window does not drop terminal output (small replay buffer covers it). Historical scrollback beyond the replay buffer is acceptable to lose.

Tauri-process restart is **out of scope** for v1; PTY processes die when their parent Rust process dies, so no amount of cache restoration brings them back. The cache will surface them on next launch as `Exited` sessions the user can explicitly restart.

## Architecture

### Single source of truth in Rust

```
                      ┌────────────────────────────────────┐
                      │  Frontend (React webview)          │
                      │                                    │
                      │  Pure renderer:                    │
                      │   • on mount → list_sessions()     │
                      │   • UI tweak → IPC → re-render     │
                      │   • holds NO persistent state      │
                      └─────────────────┬──────────────────┘
                                        │
              list_sessions / spawn_pty / kill_pty /
              set_active_session / reorder_sessions /
              update_session_cwd / write_pty / resize_pty
                                        │
                                        ▼
                      ┌────────────────────────────────────┐
                      │  Rust (Tauri main process)         │
                      │                                    │
                      │  PtyState (in-memory, existing):   │
                      │    HashMap<id, ManagedSession>     │
                      │    + 64 KB ring buffer / session   │
                      │                                    │
                      │  SessionCache (filesystem, new):   │
                      │    app_data_dir/sessions.json      │
                      │      • session_order: Vec<id>      │
                      │      • active_session_id           │
                      │      • per-session metadata        │
                      └────────────────────────────────────┘
```

| Layer                        | Owner | Holds                                                                                                                    |
| ---------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------ |
| `app_data_dir/sessions.json` | Rust  | **Everything** that survives reload: tab order, active tab, per-session `cwd`, `created_at`, `exited`, `last_exit_code`. |
| `PtyState` (in-memory)       | Rust  | Live PTY processes + per-session ring buffer of recent output.                                                           |

The cache file represents **intent** ("these sessions should exist, in this order, with this one active"); `PtyState` represents **reality** ("these are alive right now"); `list_sessions` returns the merged view.

💡 **IDEA — why single source of truth in Rust, not a hybrid**

- **I — Intent**: avoid the entire class of "two stores that must agree" sync bugs. The frontend becomes a pure renderer of `list_sessions()` output.
- **D — Danger**: every state-changing UI action now requires an IPC roundtrip (~10-30 ms). First render needs IPC before showing real content (skeleton state for ~30 ms). For local IPC and modest session counts, well below user-perceptible.
- **E — Explain**: an earlier draft of this spec split state between `localStorage` (tab order + active id) and the Rust cache (per-session metadata). Once we worked through the contract — every rename, OSC 7 cwd update, reorder, and tab switch had to round-trip through IPC anyway to keep the cache consistent — the frontend layer was buying nothing but a synchronization surface. Single store, single writer, single read on mount.
- **A — Alternatives**: hybrid Rust+localStorage (rejected as above); frontend-only (rejected — Rust needs metadata for restore + survives webview profile resets); JSON file mirrored to both sides (rejected — duplicates the file write story without solving sync).

## Data Model

### Filesystem cache (single store)

```jsonc
// app_data_dir/sessions.json — atomic write via tempfile + rename
{
  "version": 1,
  "active_session_id": "550e8400-e29b-41d4-a716-446655440000",
  "session_order": [
    "550e8400-e29b-41d4-a716-446655440000",
    "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  ],
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

Three top-level fields:

- `active_session_id`: which tab is currently focused. `null` if no sessions or none focused.
- `session_order`: ordered list of session ids — the source of truth for tab arrangement.
- `sessions`: id → metadata. Includes Exited sessions until the user explicitly closes them.

`last_exit_code` is `Option<i32>` and **always `None` in v1**. Capturing the actual exit code requires calling `child.try_wait()` from the read loop after EOF, which adds locking complexity to the existing reader; deferred to a follow-up. The frontend renders Exited sessions without an exit-code badge for now.

### Tab name derivation (deterministic, never persisted)

```ts
function tabName(cwd: string, index: number): string {
  if (cwd === '~' || cwd === os.homedir()) return `session ${index + 1}`
  return basename(cwd)
}
```

User renames are **kept in `useSessionManager` in-memory state** for the duration of a session and are not persisted. Renames survive within a session but are lost on reload. This is a deliberate scope cut — see the IDEA block under "Out of Scope" below.

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
    active_session_id: Option<String>,
    session_order: Vec<String>,
    sessions: HashMap<String, CachedSession>,
}

#[serde(tag = "kind")]
enum SessionStatus {
    Alive  { pid: u32, replay_data: String, replay_end_offset: u64 },
    Exited { last_exit_code: Option<i32> },
}

struct SessionInfo {
    id: String,
    cwd: String,
    status: SessionStatus,
}

struct SessionList {
    active_session_id: Option<String>,
    sessions: Vec<SessionInfo>,    // ordered per cache.session_order
}
```

## IPC Contract

### New: `list_sessions() -> Result<SessionList, String>`

The single read on mount. Returns the merged view: cache contents reconciled with `PtyState` aliveness, ordered per `session_order`.

For each session in `session_order`:

| Cache `exited` | `PtyState` membership                                                                                                                                 | `SessionStatus`                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `false`        | alive                                                                                                                                                 | `Alive { pid, replay_data, replay_end_offset }`                                                          |
| `false`        | **absent** — most commonly because the prior Tauri process was hard-killed (SIGKILL / OOM / OS shutdown / panic) and the read-loop EOF path never ran | **`list_sessions` flips cache to `exited: true` and flushes**, returns `Exited { last_exit_code: None }` |
| `true`         | absent                                                                                                                                                | `Exited { last_exit_code }`                                                                              |

`replay_data` is the snapshot of the per-session ring buffer (lossy UTF-8). It lets the frontend repaint the screen for the reload window before new bytes arrive.

The outer `Result` distinguishes "cache file is corrupt or unreadable" (catastrophic) from per-session status (in-band).

💡 **IDEA — why `list_sessions` reconciles instead of trusting the cache flag**

- **I — Intent**: surface previously-running sessions as restartable on next launch, regardless of how the prior process died.
- **D — Danger**: depending on a shutdown hook to mark sessions exited produces stale `alive` cache entries any time the process is hard-killed (SIGKILL, OOM, OS shutdown, panic) — which is exactly when users most need the cache to be honest. Lying about liveness leads to UIs that show fake-alive tabs that can't actually be attached.
- **E — Explain**: the read-loop EOF path is best-effort and runs only on graceful PTY exit while Rust is still alive. Tauri-process termination is a different lifecycle that bypasses it entirely. Reconciliation on next read is the only correctness-by-construction option.
- **A — Alternatives**: rely on shutdown hooks (rejected — not guaranteed to run); keep stale entries and disable attach (rejected — UX gets worse over time as orphans accumulate); periodic background sweep (rejected — adds a thread + complexity for the same effect lazy reconciliation provides for free at the only point that matters).

### New: `set_active_session(id: String) -> Result<()>`

Updates `cache.active_session_id`. Validates `id` is in `session_order`; returns `Err("unknown session")` otherwise. Frontend calls this on tab switch.

### New: `reorder_sessions(ids: Vec<String>) -> Result<()>`

Replaces `cache.session_order` with the provided list. Validates that the input is a permutation of the current session set (no add/remove). Frontend calls this on drag-reorder.

### New: `update_session_cwd(id: String, cwd: String) -> Result<()>`

Updates the cached `cwd` for a session. Called by the frontend when the OSC 7 handler in `TerminalPane.tsx` fires. Validates `id` (UUID-shaped) and `cwd` (absolute path, must exist).

### Modified: `spawn_pty`

**Contract change** — currently kills and replaces an existing session at `commands.rs:211-218`. New behavior:

```rust
if state.contains(&request.session_id) {
    return Err("session already exists".into())
}
```

`spawn_pty` also writes a new `CachedSession` entry, appends the id to `session_order`, and (if `active_session_id` was `None`) promotes the new session to active.

Reattach goes through `list_sessions`, never `spawn_pty`. The "kill on id reuse" path was a defensive measure that becomes a footgun once IDs are persisted: a stray spawn with a known id during reload would kill the very PTY we're trying to reattach to.

### Modified: `kill_pty`

**Contract change** — currently errors on missing sessions. New behavior: **idempotent**.

```rust
state.kill(&id).ok();          // no-op if not present in PtyState
state.remove(&id);             // no-op if not present
cache.remove(&id);             // remove from sessions map
cache.session_order.retain(|x| x != id);
if cache.active_session_id == Some(id.clone()) {
    cache.active_session_id = cache.session_order.first().cloned();
}
flush_cache();
Ok(())
```

This handles both "user closes tab" and "user clicks Restart on Exited session" (the Restart flow: `kill_pty(old_id)` cleanup → `spawn_pty(new_uuid, cached_cwd)`).

### Modified: `pty-data` event

**Contract change** — payload gains `offset_start: u64` (chunk's starting byte offset in the session's lifetime stream). Required by the replay protocol's cursor dedupe — see "Replay Buffer + Offset Cursor" below.

Touchpoints when this lands:

- `src-tauri/src/terminal/types.rs` — `PtyDataEvent` struct gains the field.
- `src/bindings/` — regenerated via `npm run generate:bindings`.
- `src/features/terminal/services/terminalService.ts` — `ITerminalService.onData` callback signature changes to `(sessionId, data, offsetStart)`.
- `src/features/terminal/services/tauriTerminalService.ts` and any mock service — surface the new field.
- All existing tests that construct or assert on `pty-data` payloads — add `offset_start` (default `0` for tests that don't exercise replay).

### Unchanged

`write_pty`, `resize_pty`, the `pty-exit` / `pty-error` events — all keep their current contracts.

## Lifecycle

```
spawn_pty(id, cwd)
   ├─ insert into PtyState
   ├─ start read loop (PTY → ring buffer → pty-data event)
   └─ cache.sessions[id] = { cwd, created_at, exited: false, last_exit_code: None }
      cache.session_order.push(id)
      if cache.active_session_id is None: cache.active_session_id = id
      atomic-flush cache

OSC 7 cwd change in xterm
   └─ frontend → update_session_cwd(id, new_cwd)
        └─ cache.sessions[id].cwd = new_cwd; atomic-flush

read-loop EOF (PTY process exited naturally)
   ├─ remove_if_generation in PtyState
   └─ cache.sessions[id].exited = true; atomic-flush
       (entry retained so user sees it as restartable)

kill_pty(id) — idempotent, used by tab close and Restart flow
   ├─ kill child (no-op if already gone)
   ├─ remove from PtyState (no-op if not present)
   └─ cache.sessions.remove(id)
      cache.session_order retain
      cache.active_session_id rotates to next if needed
      atomic-flush

set_active_session(id) → cache.active_session_id = id; atomic-flush
reorder_sessions(ids) → cache.session_order = ids; atomic-flush

list_sessions() — frontend mount, single read
   ├─ load cache (in-memory mirror, single read at app start, refreshed lazily)
   ├─ for each id in cache.session_order: build SessionInfo with PtyState aliveness
   └─ return SessionList

Tauri app shutdown
   └─ no shutdown hook. Read-loop EOF will *try* to mark exited, but
       SIGKILL / OOM / OS shutdown / panic all skip that path. The cache
       can therefore lie about liveness across a hard restart.

       Correctness comes from list_sessions reconciliation (see IDEA
       below): on next launch the cache is read, every entry whose
       `exited: false` is checked against PtyState, and any with no
       PtyState entry is flipped to exited and flushed.

       Result: next launch shows previously-running sessions as Exited
       regardless of how the prior process died. User can Restart or close.
```

## Replay Buffer + Offset Cursor

The cursor is necessary but not sufficient. Race-free reattach requires three things working together: (1) producer keeps the offset and the buffer in one critical section, (2) subscriber listens before snapshotting and buffers events received during the restore window, (3) cursor-filtered drain reconciles them. Any one missing reintroduces a lost-byte or doubled-byte race.

### 1. Producer: atomic ring buffer + offset (one lock)

Each `ManagedSession` in `PtyState` gains a single mutex-protected struct, **not** a separate atomic counter and a separate buffer:

```rust
struct RingBuffer {
    bytes: VecDeque<u8>,   // fixed capacity 65536 / 64 KB; truncates from front
    end_offset: u64,       // total bytes ever produced; monotonically increasing
}

struct ManagedSession {
    // ... existing fields
    ring: Mutex<RingBuffer>,
}
```

The read loop appends bytes and advances `end_offset` **inside one critical section**, then emits the event after the lock drops:

```rust
let chunk_start = {
    let mut buf_guard = session.ring.lock();
    let start = buf_guard.end_offset;
    buf_guard.bytes.write(&buf[..n]);   // truncates from front when over capacity
    buf_guard.end_offset += n as u64;
    start
};
app.emit("pty-data", PtyDataEvent { session_id, data, offset_start: chunk_start })?;
```

`list_sessions` snapshots `(bytes.clone(), end_offset)` under the same lock. This guarantees the returned `replay_end_offset` exactly matches the bytes in `replay_data` — never an offset that has advanced past bytes the snapshot doesn't contain.

`PtyDataEvent` gains a single `offset_start: u64` field. Backwards-incompatible change, but the event is internal — only consumed by `useTerminal`.

> ⚠️ **Why not `AtomicU64`?** A separate `AtomicU64` for `next_offset` and a separate `Mutex<VecDeque>` for the buffer creates a window where a `list_sessions` snapshot can land between `fetch_add` and `buffer.write`. The snapshot then returns `replay_end_offset` that already accounts for the new chunk, but `replay_data` doesn't include it. The follow-up live event has `offset_start < replay_end_offset` and gets dropped — actual data loss. One mutex, one struct, one atomic snapshot. Don't split state that must be consistent at any observable moment.

### 2. Subscriber: ONE global listener BEFORE list_sessions, buffer-by-id during restore

Critical sequencing constraint: at the moment we need to start buffering, **the frontend doesn't know any session ids yet** — those live in Rust and arrive only with the `list_sessions` response. So the buffering listener must be **global** (one listener, not per-session) and key its buffer by `sessionId` from the event payload.

The protocol fires once per page mount, before any TerminalPane component renders:

1. **Register one global buffering listener** on `pty-data`. It pushes every event into a `Map<sessionId, PtyDataEvent[]>` keyed by `event.sessionId`. This captures all events emitted before the frontend has session metadata.
2. **Call `list_sessions`** — receive ordered `[SessionInfo]` with status per session.
3. **For each `Alive { replay_data, replay_end_offset }` session**:
   - Write `replay_data` to that session's xterm instance.
   - Drain `buffered.get(sessionId)` with cursor filter: write every event whose `offset_start >= replay_end_offset`; drop the rest (they were in the replay).
4. **Swap the global buffering listener to a global direct-write listener** that routes each event to the corresponding xterm by sessionId. Discard any remaining buffered entries for sessions not present in `list_sessions` (Missing / Exited).

```ts
// frontend pseudocode (orchestrated once per mount, ahead of TerminalPane render)
const buffered = new Map<string, PtyDataEvent[]>()
const stopBuffering = service.onData((sessionId, data, offsetStart) => {
  let q = buffered.get(sessionId)
  if (!q) {
    q = []
    buffered.set(sessionId, q)
  }
  q.push({ sessionId, data, offsetStart })
})

const result = await service.listSessions()

for (const session of result.sessions) {
  const alive = session.status
  if (alive.kind !== 'Alive') continue
  const xterm = terminalForSession(session.id) // mount the pane, get its xterm
  xterm.write(alive.replay_data)

  for (const e of buffered.get(session.id) ?? []) {
    if (e.offsetStart >= alive.replay_end_offset) xterm.write(e.data)
  }

  stopBuffering()
  service.onData((sessionId, data) => {
    if (sessionId === ourSessionId) xterm.write(data)
  })
}
```

> The previous draft of this spec said "write replay before subscribing." That's wrong. Events emitted between snapshot and subscribe go to nobody — the cursor can't recover bytes the listener never received. **Subscribe first.**

### 3. Why all three together

| Missing piece              | Failure mode                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| (1) atomic producer        | Live event may carry an `offset_start` that the cursor incorrectly classifies as "already replayed" — drops real data. |
| (2) listen-before-snapshot | Events emitted between snapshot return and listener registration go to nobody — irrecoverable lost bytes.              |
| (3) cursor filter on drain | No dedupe — buffered events that overlap the replay get written twice — doubled bytes on screen.                       |

Chunks are atomic — one read, one event — so partial-overlap doesn't happen. Lossy-UTF-8 in `replay_data` doesn't affect cursor math; the cursor counts raw input bytes, not decoded characters.

### Sizing

64 KB covers ~1000 lines at typical width (80 cols × 80 chars/line), which exceeds the visible terminal area for any reasonable reload window. Memory cost: 64 KB × N sessions; with 10 sessions that's 640 KB, with 64 (cap on `spawn_pty`) it's 4 MB. Acceptable.

The frontend's per-session `buffered: PtyDataEvent[]` is bounded by the time between `listSessions` IPC fire and its return — typically <50 ms even on a busy machine. At a worst-case sustained 1 MB/s of PTY output, that's ~50 KB of buffered events per session. Trivial.

## Frontend Integration

```
src/
├── features/
│   ├── workspace/hooks/
│   │   └── useSessionManager.ts        ← rewrite: pure IPC client +
│   │                                     mount-time restore orchestrator:
│   │                                       1. register global pty-data
│   │                                          buffering listener (Map<id, []>)
│   │                                       2. await list_sessions()
│   │                                       3. for each Alive session: write
│   │                                          replay_data + drain buffer
│   │                                          (cursor filter)
│   │                                       4. swap to direct-write listener
│   │                                     UI actions call
│   │                                     set_active / reorder / kill / spawn
│   ├── terminal/
│   │   ├── components/TerminalPane.tsx ← restored-mode branch consumes
│   │   │                                 the per-session replay payload
│   │   │                                 (replay_data, replay_end_offset,
│   │   │                                 buffered events) prepared by the
│   │   │                                 mount-time orchestrator. Sequence:
│   │   │                                 1. write replay_data to xterm
│   │   │                                 2. flush cursor-filtered buffered
│   │   │                                    events
│   │   │                                 3. send resize → SIGWINCH → TUI redraw
│   │   │                                 (See "Replay Buffer + Offset Cursor"
│   │   │                                 §2 for the global-listener-first
│   │   │                                 orchestration that owns steps 0-1.)
│   │   ├── hooks/useTerminal.ts        ← restored sessions never set
│   │   │                                 didSpawnSessionRef.current = true,
│   │   │                                 so existing cleanup gate already
│   │   │                                 skips kill on unmount
│   │   ├── services/
│   │   │   └── tauriTerminalService.ts ← listSessions(), setActiveSession(),
│   │   │                                 reorderSessions(), updateSessionCwd()
│   │   └── ptySessionMap.ts            ← repopulate from list_sessions
│   │                                     results (currently lost on remount)
│   └── workspace/components/
│       └── TerminalZone.tsx            ← consume list_sessions to mount
│                                         the right TerminalPanes
└── bindings/                            ← regenerated via
                                          `npm run generate:bindings`

src-tauri/src/terminal/
├── commands.rs           ← spawn_pty contract change; new list_sessions /
│                           set_active_session / reorder_sessions /
│                           update_session_cwd / idempotent kill_pty;
│                           ring buffer write in read loop
├── state.rs              ← ManagedSession + ring buffer; promote
│                           active_ids() out of e2e-only cfg
├── cache.rs (new)        ← SessionCache: load/save with atomic rename,
│                           in-memory mirror, schema migration
└── types.rs              ← SessionList, SessionInfo, SessionStatus,
                            CachedSession, request structs

vite.config.ts            ← Option A: server.watch.ignored (separate commit)
```

### Optimistic UI updates

`set_active_session` and `reorder_sessions` are eligible for optimistic updates: the frontend applies the change to its rendered tree immediately, then fires the IPC; on `Err` it reverts. This keeps tab switching and drag-reorder feeling instant while still flushing through Rust as the canonical store.

`spawn_pty` and `kill_pty` are not optimistic — they have side effects (PTY process create/destroy) that the frontend can't simulate.

### TerminalPane unmount semantics (no contract change)

`useTerminal.ts:191` already gates the unmount-time kill behind `didSpawnSessionRef.current`, with try/catch lenient on errors. Today, that flag is set to `true` after a successful `spawn_pty` and never reset.

The change is: **the restore path never sets `didSpawnSessionRef.current = true`.** When `useTerminal` runs in restored mode (called via `attach`/`list_sessions` rather than `spawn`), the ref stays `false`, so the existing cleanup branch is skipped and the PTY outlives the React component.

Explicit kill paths are unchanged — `removeSession()` in `useSessionManager` (triggered by user-driven tab close) calls `kill_pty` directly. With the new idempotent `kill_pty`, the call succeeds even if the read loop already EOF'd and removed the session from `PtyState`.

The TerminalPane unmount cleanup retains: xterm.js dispose, `pty-data` listener removal, `ResizeObserver` disconnect.

## Failure Modes

| Failure                                           | Handling                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cache file unparseable / corrupt                  | `list_sessions` returns `Err("cache corrupt: <details>")`. Frontend logs, renders an empty session list, offers a "start fresh" prompt. A `.bak` is kept on every successful write so manual recovery is possible.                                                                           |
| `app_data_dir` not writable                       | Cache writes log a warning but do not fail `spawn_pty`, and **do not roll back the in-memory `SessionCache` mirror**. Frontend reload still restores correctly from in-memory cache + `PtyState`. Only Tauri restart loses the persisted state (the in-memory mirror dies with the process). |
| Atomic write interrupted (Tauri crash mid-rename) | `tempfile::NamedTempFile::persist` either fully renames or doesn't — never leaves a torn file. Worst case the prior version is read on next mount.                                                                                                                                           |
| `set_active_session` with unknown id              | `Err("unknown session")`. Frontend reverts the optimistic active-tab change.                                                                                                                                                                                                                 |
| `reorder_sessions` with non-permutation           | `Err("invalid reorder: not a permutation")`. Frontend reverts.                                                                                                                                                                                                                               |
| `update_session_cwd` for an unknown id            | `Err("unknown session")`. Frontend logs and ignores (probably an OSC 7 racing kill).                                                                                                                                                                                                         |
| `update_session_cwd` with non-existent path       | `Err("invalid cwd: not a directory")`. Frontend logs and ignores; the cache keeps the previous cwd.                                                                                                                                                                                          |
| Cap exceeded on `spawn_pty` (more than 64 active) | `Err("session limit reached")`. UI surfaces a toast.                                                                                                                                                                                                                                         |
| Read-loop EOF race vs `set_active_session`        | Cache writes are serialized by the cache mutex; either order is consistent. UI may briefly show an active id whose session just exited — next list_sessions call corrects.                                                                                                                   |

## Testing Strategy

### Rust (`src-tauri/src/terminal/`)

| Test                                                        | What it pins                                                                                                                                                                                   |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_sessions_returns_alive_for_running_pty`               | Happy path: alive variant + replay_data populated                                                                                                                                              |
| `list_sessions_returns_exited_for_dead_pty`                 | Read-loop EOF marks cache; restore reflects it                                                                                                                                                 |
| `list_sessions_reconciles_alive_cache_with_empty_pty_state` | Simulate hard kill (cache says `alive`, PtyState empty); list_sessions flips to Exited and flushes — pins lazy reconciliation correctness                                                      |
| `list_sessions_returns_in_session_order`                    | Order matches `session_order`, not HashMap iteration                                                                                                                                           |
| `list_sessions_includes_active_session_id`                  | Active id round-trips                                                                                                                                                                          |
| `list_sessions_replay_data_contains_recent_output`          | Ring buffer write + restore round-trips bytes                                                                                                                                                  |
| `list_sessions_replay_data_truncated_at_capacity`           | Long output respects 64 KB cap                                                                                                                                                                 |
| `list_sessions_replay_end_offset_matches_buffer_contents`   | Under one mutex: snapshot returns `(bytes, end_offset)` where `end_offset == buffer_start + bytes.len()`. Pins atomic producer.                                                                |
| `read_loop_advances_offset_and_buffer_atomically`           | Spawn many concurrent `list_sessions` calls while bytes stream; assert no snapshot ever returns `replay_end_offset > buffer_byte_count`. Pins no-window-for-drift between fetch_add and write. |
| `pty_data_event_includes_monotonic_offset_start`            | Every emitted chunk's `offset_start` equals the buffer's `end_offset` immediately before the write. Pins the producer side of the cursor.                                                      |
| `end_offset_continues_past_buffer_truncation`               | When the ring buffer truncates from the front, `end_offset` keeps incrementing — total bytes ever, not buffer bytes                                                                            |
| `cache_flush_failure_does_not_roll_back_in_memory_mirror`   | When `app_data_dir` is unwritable, the in-memory `SessionCache` still updates so frontend reload (same Tauri process) restores correctly                                                       |
| `set_active_session_persists_to_cache`                      | Active id written                                                                                                                                                                              |
| `set_active_session_rejects_unknown_id`                     | Validation                                                                                                                                                                                     |
| `reorder_sessions_persists_to_cache`                        | Order written                                                                                                                                                                                  |
| `reorder_sessions_rejects_non_permutation`                  | Validation (no add/remove)                                                                                                                                                                     |
| `spawn_pty_appends_to_session_order`                        | Lifecycle: spawn updates order                                                                                                                                                                 |
| `spawn_pty_promotes_first_session_to_active`                | Lifecycle: empty → first active                                                                                                                                                                |
| `spawn_pty_returns_error_on_existing_session_id`            | Contract change: no more kill-and-replace                                                                                                                                                      |
| `spawn_pty_caps_at_64_active_sessions`                      | DoS guard                                                                                                                                                                                      |
| `kill_pty_is_idempotent_for_missing_session`                | Contract change: no more error on missing                                                                                                                                                      |
| `kill_pty_removes_from_session_order_and_cache`             | Lifecycle cleanup                                                                                                                                                                              |
| `kill_pty_advances_active_when_active_killed`               | Active session rotation                                                                                                                                                                        |
| `update_session_cwd_persists_to_cache`                      | OSC 7 sync path                                                                                                                                                                                |
| `update_session_cwd_rejects_invalid_path`                   | Validation                                                                                                                                                                                     |
| `read_loop_eof_marks_cache_exited`                          | Lifecycle: natural exit                                                                                                                                                                        |
| `cache_atomic_write_survives_simulated_crash`               | Write to tmp, kill before rename, ensure old file intact                                                                                                                                       |
| `cache_corrupt_file_returns_error_not_panic`                | Outer `Err` path, no crash                                                                                                                                                                     |

### Frontend (`src/features/{workspace,terminal}/`)

| Test                                                                      | What it pins                                                                                                                            |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `useSessionManager_calls_list_sessions_on_mount`                          | Single canonical read                                                                                                                   |
| `useSessionManager_does_not_persist_to_localStorage`                      | Pure IPC client, no local writes                                                                                                        |
| `useSessionManager_optimistically_updates_active_then_calls_ipc`          | Tab switch UX                                                                                                                           |
| `useSessionManager_reverts_optimistic_update_on_ipc_error`                | Error recovery                                                                                                                          |
| `useSessionManager_renders_exited_sessions_with_restart_action`           | UX for Exited variant                                                                                                                   |
| `TerminalPane_restored_mode_skips_spawn_calls_attach`                     | No new PTY spawn on reload                                                                                                              |
| `restore_orchestrator_registers_global_listener_before_list_sessions`     | Pins listen-before-snapshot ordering at the orchestrator level (one global listener, before any `listSessions()` IPC)                   |
| `restore_orchestrator_buffers_pty_data_keyed_by_session_id`               | Events received between `listSessions()` call and per-session drain land in `Map<sessionId, PtyDataEvent[]>`                            |
| `restore_orchestrator_drains_buffer_with_cursor_filter_per_alive_session` | For each Alive session: write `replay_data`, then drain buffer entries with `offset_start >= replay_end_offset`                         |
| `restore_orchestrator_swaps_to_direct_listener_after_drain`               | Pins listener handoff: after all alive sessions are drained, the buffering listener is detached and a direct-write listener is attached |
| `restore_orchestrator_discards_buffered_events_for_missing_or_exited`     | Buffered entries for sessions absent from `list_sessions` (or in `Exited` state) are dropped, not written                               |
| `TerminalPane_restored_mode_drops_pty_data_event_below_replay_cursor`     | Cursor dedupe (live phase): events with `offset_start < replay_end_offset` are skipped                                                  |
| `TerminalPane_restored_mode_writes_pty_data_event_at_or_above_cursor`     | Cursor dedupe (live phase): events with `offset_start >= replay_end_offset` are kept                                                    |
| `TerminalPane_restored_mode_sends_resize_after_attach`                    | SIGWINCH nudge for TUIs                                                                                                                 |
| `useTerminal_unmount_does_not_call_kill_in_restored_mode`                 | Lifecycle: ref stays false on restore                                                                                                   |
| `removeSession_explicitly_calls_kill_pty`                                 | Explicit close path                                                                                                                     |
| `osc7_cwd_change_calls_update_session_cwd`                                | Live cwd persistence                                                                                                                    |

### Manual smoke

1. `npm run tauri:dev`
2. Open terminal, `cd /tmp`, run `vim foo.txt`, type some text
3. Switch to source editor in the host system, edit `vite.config.ts` (something HMR-able)
4. Watch the Vimeflow window: terminal should reattach within ~300 ms; vim's editor view should be visible (replay data) and fully redraw on the next keystroke.
5. Run `claude` inside a terminal, interact with it, then trigger a reload by saving any project file. Claude session should continue uninterrupted.
6. Switch tabs, drag-reorder tabs, reload — order and active selection survive.

## Out of Scope

- **Tab name persistence.** Renames live in-session and are lost on reload.
- **Tab name across Tauri restart.** Names regenerate from cwd on every fresh load.
- **Historical scrollback (beyond the 64 KB replay window).** Bash/zsh output produced more than ~1000 lines ago is gone after reload. Separate spec for larger or persisted buffer.
- **Tauri-restart session restoration UX polish.** The cache supports it, but we don't yet show a curated "restore previous sessions?" prompt.
- **Cache GC for orphaned entries.** Defer to v2.
- **Capturing real `last_exit_code`.** Read loop currently emits `None`; populating requires `child.try_wait()` after EOF — follow-up.

💡 **IDEA — why "no auto-respawn for Exited"**

- **I — Intent**: keep "session exited naturally" and "session was reloaded" as distinct user-visible states.
- **D — Danger**: auto-respawn would mask user mistakes (they typed `exit`, expected the session to close, but it keeps coming back). It also does the wrong thing when the cwd has been deleted between exit and respawn.
- **E — Explain**: explicit "Restart" gives the user a beat to decide. The cost is a single click per Exited session on next launch.
- **A — Alternatives**: auto-respawn with opt-out flag (hidden, easy to forget); silent-prune on exit (user loses ability to reopen recent sessions). Explicit-action wins for clarity.

💡 **IDEA — why drop tab name persistence**

- **I — Intent**: minimize the "tab metadata" surface to what's reproducible from cwd.
- **D — Danger**: users who renamed tabs lose their custom names on reload. Accepted for v1.
- **E — Explain**: persisting names cascades into rename-during-restore races, name-collision UX, and another sync channel (rename → IPC → cache → next-list_sessions). Each adds two or three test cases. Cwd-derived names are deterministic, automatically reflect OSC 7 changes, and don't drift.
- **A — Alternatives**: store names in cache (full IPC contract). Adds edge cases without solving a real-world pain — most users don't rename terminal tabs.

## Commit Plan

Branch: `fix/55-pty-reattach-on-reload`

1. **`fix(vite): exclude .vimeflow/, target/, .codex*/ from HMR watch`** — ~5 lines in `vite.config.ts`.
2. **`feat(terminal): persist & reattach PTY sessions across reload`** — the architecture change. Backend cache module + ring buffer + new IPC commands; frontend pure-IPC `useSessionManager` + restore-mode TerminalPane; full test suite.

## References

- Issue: [#55](https://github.com/winoooops/vimeflow/issues/55)
- Per-finding/per-option reasoning shape: [`rules/common/idea-framework.md`](../../../rules/common/idea-framework.md)
- Existing PTY architecture: `src-tauri/src/terminal/{state.rs, commands.rs}`
- Tauri `app_data_dir` API: <https://docs.rs/tauri/latest/tauri/path/struct.PathResolver.html#method.app_data_dir>
- `tempfile::NamedTempFile::persist` for atomic writes: <https://docs.rs/tempfile/latest/tempfile/struct.NamedTempFile.html#method.persist>
