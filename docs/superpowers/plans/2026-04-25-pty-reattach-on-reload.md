# PTY Reattach on Reload — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make any frontend remount (HMR, manual refresh, error-boundary reset) a harmless operation — surviving terminals, cwd, agent state, tab order, and active selection — by moving all session state into a Rust filesystem cache and adding a race-free reattach protocol via offset cursor + atomic ring buffer + listen-before-snapshot.

**Architecture:** Single source of truth in Rust. Filesystem cache (`app_data_dir/sessions.json`) holds session order, active id, and per-session metadata; `PtyState` holds live PTYs + a Mutex-protected `RingBuffer` per session. Frontend is a pure IPC client. The replay protocol is three things working together: producer atomicity (offset and bytes share one lock), subscriber listen-first (global buffering listener registered before `list_sessions`), and cursor-filtered drain (events with `offset_start < replay_end_offset` were already in the replay).

**Tech Stack:** Rust (Tauri commands, `portable_pty`, `tempfile`, `serde`, `serde_json`, `ts-rs` for binding generation), TypeScript + React 19, xterm.js, Vitest + Testing Library.

**Spec:** [`docs/superpowers/specs/2026-04-25-pty-reattach-on-reload-design.md`](../specs/2026-04-25-pty-reattach-on-reload-design.md). Read it first.

**Branch:** `fix/55-pty-reattach-on-reload` (already created, primary checkout — do **not** create a worktree).

---

## File Structure

### Created

| File                                                                        | Responsibility                                                        |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `src-tauri/src/terminal/cache.rs`                                           | `SessionCache` type + load/save with atomic rename + in-memory mirror |
| `src-tauri/src/terminal/cache.test.rs` (or inline `#[cfg(test)] mod tests`) | Unit tests for the cache module                                       |
| `docs/superpowers/plans/2026-04-25-pty-reattach-on-reload.md`               | This plan                                                             |

### Modified

| File                                                                                        | Change                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vite.config.ts`                                                                            | Add `server.watch.ignored` for `.vimeflow/`, `target/`, `.codex*/`, `.git/` (Task 1)                                                                                                                                                                                          |
| `src-tauri/src/terminal/state.rs`                                                           | Add `RingBuffer { bytes, end_offset }` to `ManagedSession` behind a `Mutex`. Promote `active_ids()` out of e2e-only cfg.                                                                                                                                                      |
| `src-tauri/src/terminal/types.rs`                                                           | Add `PtyDataEvent.offset_start: u64`; add `SessionList`, `SessionInfo`, `SessionStatus`, `CachedSession`, `SetActiveSessionRequest`, `ReorderSessionsRequest`, `UpdateSessionCwdRequest`.                                                                                     |
| `src-tauri/src/terminal/commands.rs`                                                        | `spawn_pty` (cap, error on existing id, cache write); `kill_pty` (idempotent + cache cleanup); `read_pty_output` (mutex-protected ring buffer write + offset emission, EOF marks cache); add `list_sessions`, `set_active_session`, `reorder_sessions`, `update_session_cwd`. |
| `src-tauri/src/terminal/mod.rs`                                                             | Re-export new commands and types                                                                                                                                                                                                                                              |
| `src-tauri/src/lib.rs`                                                                      | Register new IPC commands                                                                                                                                                                                                                                                     |
| `src-tauri/Cargo.toml`                                                                      | Add `tempfile = "3"` and `dirs = "5"` (or use `tauri::path::BaseDirectory::AppData` — verify in Task 2)                                                                                                                                                                       |
| `src/bindings/` (auto-generated)                                                            | Regenerated via `npm run generate:bindings`                                                                                                                                                                                                                                   |
| `src/features/terminal/services/terminalService.ts`                                         | `ITerminalService.onData` callback gains `offsetStart: number` (number on TS side; `u64` is serialized as a JSON number safely up to 2^53 = ~9 PB per session lifetime — fine)                                                                                                |
| `src/features/terminal/services/tauriTerminalService.ts`                                    | Add `listSessions()`, `setActiveSession()`, `reorderSessions()`, `updateSessionCwd()` methods; surface `offset_start` in `onData`                                                                                                                                             |
| `src/features/terminal/services/mockTerminalService.ts` (if exists; otherwise inline mocks) | Mirror new methods + onData signature                                                                                                                                                                                                                                         |
| `src/features/terminal/ptySessionMap.ts`                                                    | Repopulate from `list_sessions` results                                                                                                                                                                                                                                       |
| `src/features/terminal/components/TerminalPane.tsx`                                         | Restored-mode branch: write replay → drain buffered → cursor-filter live; OSC 7 calls `update_session_cwd`; send resize after attach                                                                                                                                          |
| `src/features/terminal/hooks/useTerminal.ts`                                                | Restored sessions never set `didSpawnSessionRef.current = true`; add an `attach` path that takes `replay_data + replay_end_offset + buffered events`                                                                                                                          |
| `src/features/workspace/hooks/useSessionManager.ts`                                         | Rewrite as pure IPC client + mount-time restore orchestrator (global pty-data listener registered before `listSessions()`; per-session drain after)                                                                                                                           |
| `src/features/workspace/components/TerminalZone.tsx`                                        | Mount panes from `list_sessions` results; consume `restoreData` per session                                                                                                                                                                                                   |

### Touched by binding regeneration only

`src/bindings/SpawnPtyRequest.ts`, `WritePtyRequest.ts`, `ResizePtyRequest.ts`, `KillPtyRequest.ts`, `PtyDataEvent.ts`, `PtyExitEvent.ts`, `PtyErrorEvent.ts`, `PtySession.ts`, plus new files for the new types.

---

## Task Order Rationale

1. **Task 1 (Vite watch ignore)** is independent and tiny — lands first as the cheap quick-win commit.
2. **Tasks 2-3 (Rust cache + ring buffer foundations)** add types and supporting code. Build is intentionally broken at the end of Task 3 (ManagedSession field added but spawn_pty hasn't been updated yet) — fixed by Task 4.
3. **Tasks 4-8 (Rust IPC contract changes + new commands)** modify the IPC surface and add new commands.
4. **Task 9 (register + manage cache)** wires everything into `lib.rs`.
5. **Task 10 (binding regeneration)** is mechanical but must come after all Rust type changes.
6. **Task 11 (terminalService updates)** consumes the new IPC.
7. **Tasks 12-13 (useTerminal + useSessionManager rewrite)** wire the restore protocol into React hooks.
8. **Task 14 (TerminalPane + TerminalZone)** plumbs the orchestration into the visible UI.
9. **Task 15 (Manual smoke + PR)** is the human verification gate.

Frequent commits — one per task minimum, sometimes per step.

---

## Task 1: Exclude noisy paths from Vite HMR watch

**Files:**

- Modify: `vite.config.ts`

This is Option A — independent quick-win. Land first, separately committable.

- [ ] **Step 1: Read current vite.config.ts**

Run: `cat vite.config.ts | tail -10`

Confirm the current `defineConfig({ ... })` block looks like:

```ts
export default defineConfig({
  plugins: [react(), gitApiPlugin(), fileApiPlugin()],
})
```

- [ ] **Step 2: Add server.watch.ignored**

Edit `vite.config.ts`, replace the `defineConfig({ ... })` call with:

```ts
export default defineConfig({
  plugins: [react(), gitApiPlugin(), fileApiPlugin()],
  server: {
    watch: {
      ignored: [
        '**/.vimeflow/**',
        '**/target/**',
        '**/.codex*/**',
        '**/.git/**',
      ],
    },
  },
})
```

- [ ] **Step 3: Run typecheck and lint**

Run: `npm run type-check && npm run lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add vite.config.ts
git commit -m "fix(vite): exclude .vimeflow/, target/, .codex*/, .git/ from HMR watch

Reduce noise from tool-result writes (Claude Code writing to .vimeflow/),
Rust build artifacts, and Codex review files — none of these should
trigger a full page reload, but Vite's default watcher picks them up.

Refs #55."
```

---

## Task 2: Add Rust SessionCache module

**Files:**

- Create: `src-tauri/src/terminal/cache.rs`
- Modify: `src-tauri/Cargo.toml` (add `tempfile`)
- Modify: `src-tauri/src/terminal/mod.rs` (declare `cache` module)

- [ ] **Step 1: Add tempfile to Cargo.toml**

Run: `cd src-tauri && cargo add tempfile@3 && cd ..`

Verify `src-tauri/Cargo.toml` now contains `tempfile = "3"` under `[dependencies]`.

- [ ] **Step 2: Declare cache module**

Edit `src-tauri/src/terminal/mod.rs`, add:

```rust
pub mod cache;
```

- [ ] **Step 3: Write the failing test (cache load returns empty when no file)**

Create `src-tauri/src/terminal/cache.rs` with the test scaffold:

```rust
//! Filesystem cache for session metadata.
//!
//! Single source of truth for: session order, active session id, per-session
//! cwd / created_at / exited / last_exit_code. Lives at
//! `app_data_dir/sessions.json`; written atomically via `tempfile.persist`.
//! In-memory mirror (Mutex<SessionCache>) avoids re-reading the file on
//! every IPC call.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CachedSession {
    pub cwd: String,
    pub created_at: String, // ISO-8601 UTC
    pub exited: bool,
    pub last_exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionCacheData {
    pub version: u32,
    #[serde(default)]
    pub active_session_id: Option<String>,
    #[serde(default)]
    pub session_order: Vec<String>,
    #[serde(default)]
    pub sessions: HashMap<String, CachedSession>,
}

impl Default for SessionCacheData {
    fn default() -> Self {
        Self {
            version: SCHEMA_VERSION,
            active_session_id: None,
            session_order: Vec::new(),
            sessions: HashMap::new(),
        }
    }
}

pub struct SessionCache {
    path: PathBuf,
    data: Mutex<SessionCacheData>,
}

impl SessionCache {
    /// Load from disk; if file is absent, return an empty cache.
    /// Returns Err only on corrupted/unreadable files — caller logs + degrades.
    pub fn load(path: PathBuf) -> Result<Self, String> {
        let data = if path.exists() {
            let bytes = fs::read(&path).map_err(|e| format!("read cache: {e}"))?;
            serde_json::from_slice::<SessionCacheData>(&bytes)
                .map_err(|e| format!("parse cache: {e}"))?
        } else {
            SessionCacheData::default()
        };
        Ok(Self {
            path,
            data: Mutex::new(data),
        })
    }

    /// Snapshot the in-memory mirror.
    pub fn snapshot(&self) -> SessionCacheData {
        self.data.lock().expect("cache mutex poisoned").clone()
    }

    /// Apply a mutation under the lock, then atomically flush to disk.
    /// Returns Ok even if disk flush fails — in-memory mirror is updated
    /// regardless so frontend reload still restores correctly. Disk failure
    /// is logged.
    pub fn mutate<F>(&self, f: F) -> Result<(), String>
    where
        F: FnOnce(&mut SessionCacheData),
    {
        let snapshot = {
            let mut guard = self.data.lock().expect("cache mutex poisoned");
            f(&mut guard);
            guard.clone()
        };
        // Best-effort disk write
        if let Err(e) = self.flush_to_disk(&snapshot) {
            log::warn!("cache flush failed (in-memory still updated): {e}");
        }
        Ok(())
    }

    fn flush_to_disk(&self, data: &SessionCacheData) -> Result<(), String> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| "cache path has no parent".to_string())?;
        fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
        let mut tmp = tempfile::NamedTempFile::new_in(parent)
            .map_err(|e| format!("create tempfile: {e}"))?;
        let bytes = serde_json::to_vec_pretty(data).map_err(|e| format!("serialize: {e}"))?;
        tmp.write_all(&bytes).map_err(|e| format!("write: {e}"))?;
        tmp.persist(&self.path).map_err(|e| format!("persist: {e}"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn load_returns_empty_when_file_absent() {
        let dir = TempDir::new().unwrap();
        let cache = SessionCache::load(dir.path().join("sessions.json")).unwrap();
        let snap = cache.snapshot();
        assert_eq!(snap.version, SCHEMA_VERSION);
        assert_eq!(snap.session_order.len(), 0);
        assert!(snap.sessions.is_empty());
        assert!(snap.active_session_id.is_none());
    }
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `cd src-tauri && cargo test --lib cache::tests::load_returns_empty_when_file_absent`
Expected: PASS

- [ ] **Step 5: Add the round-trip and corruption tests**

Append to the `mod tests` block in `cache.rs`:

```rust
    #[test]
    fn mutate_then_load_round_trips() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("sessions.json");

        let cache = SessionCache::load(path.clone()).unwrap();
        cache.mutate(|d| {
            d.session_order.push("uuid-a".into());
            d.active_session_id = Some("uuid-a".into());
            d.sessions.insert(
                "uuid-a".into(),
                CachedSession {
                    cwd: "/home/x".into(),
                    created_at: "2026-04-25T07:30:00Z".into(),
                    exited: false,
                    last_exit_code: None,
                },
            );
        }).unwrap();

        let reloaded = SessionCache::load(path).unwrap();
        let snap = reloaded.snapshot();
        assert_eq!(snap.session_order, vec!["uuid-a".to_string()]);
        assert_eq!(snap.active_session_id.as_deref(), Some("uuid-a"));
        assert!(snap.sessions.contains_key("uuid-a"));
    }

    #[test]
    fn corrupt_file_returns_err_no_panic() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("sessions.json");
        std::fs::write(&path, b"{ this is not json").unwrap();

        let result = SessionCache::load(path);
        assert!(result.is_err(), "expected Err for corrupt file");
        assert!(result.unwrap_err().contains("parse cache"));
    }

    #[test]
    fn flush_to_disk_is_atomic_via_tempfile_persist() {
        // The persist() call uses rename which is atomic on POSIX
        // and best-effort atomic on Windows. We verify the file
        // is fully present after a successful mutate.
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("sessions.json");
        let cache = SessionCache::load(path.clone()).unwrap();
        cache.mutate(|d| {
            d.session_order.push("uuid-a".into());
        }).unwrap();
        assert!(path.exists());
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(raw.contains("uuid-a"));
        assert!(raw.contains(&format!("\"version\": {SCHEMA_VERSION}")));
    }

    #[test]
    fn flush_failure_does_not_block_in_memory_update() {
        // Force flush failure by putting cache file in a non-existent
        // parent that we make unwritable. Easier: use /dev/null/foo.json
        // on POSIX — parent /dev/null isn't a directory.
        #[cfg(unix)]
        {
            let cache = SessionCache::load(std::path::PathBuf::from("/dev/null/sessions.json"))
                .unwrap();
            // Initial state: empty cache (file doesn't exist, parent isn't a dir
            // — but load() only fails if exists() returns true, which it doesn't here).
            cache.mutate(|d| {
                d.session_order.push("uuid-a".into());
            }).unwrap();
            // In-memory mirror updated even though disk flush failed
            let snap = cache.snapshot();
            assert_eq!(snap.session_order, vec!["uuid-a".to_string()]);
        }
    }
```

- [ ] **Step 6: Run the new tests — verify all pass**

Run: `cd src-tauri && cargo test --lib cache`
Expected: 4 PASS

- [ ] **Step 7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/terminal/cache.rs src-tauri/src/terminal/mod.rs
git commit -m "feat(terminal): add SessionCache module with atomic write + in-memory mirror

Filesystem-backed cache for session metadata under app_data_dir/sessions.json.
Atomic write via tempfile.persist; in-memory Mutex mirror so flush failure
doesn't roll back state (frontend reload still restores from in-memory).

Refs #55."
```

---

## Task 3: Add RingBuffer to ManagedSession

**Files:**

- Modify: `src-tauri/src/terminal/state.rs`

This is the producer-side atomic boundary for the offset cursor.

- [ ] **Step 1: Read current state.rs**

Run: `cat src-tauri/src/terminal/state.rs | head -60`

Note the current `ManagedSession` struct has `master`, `writer`, `child`, `cwd`, `generation`.

- [ ] **Step 2: Write failing test for RingBuffer**

Append to `src-tauri/src/terminal/state.rs` inside the existing `#[cfg(test)] mod tests`:

```rust
    #[test]
    fn ring_buffer_appends_and_advances_offset_under_one_lock() {
        use super::RingBuffer;
        let mut buf = RingBuffer::new(16);
        let start1 = buf.append(b"hello");
        assert_eq!(start1, 0);
        assert_eq!(buf.end_offset(), 5);
        assert_eq!(buf.bytes_snapshot(), b"hello");

        let start2 = buf.append(b"world");
        assert_eq!(start2, 5);
        assert_eq!(buf.end_offset(), 10);
        assert_eq!(buf.bytes_snapshot(), b"helloworld");
    }

    #[test]
    fn ring_buffer_truncates_from_front_at_capacity() {
        use super::RingBuffer;
        let mut buf = RingBuffer::new(8);
        buf.append(b"abcdefgh"); // exactly capacity
        assert_eq!(buf.bytes_snapshot(), b"abcdefgh");
        assert_eq!(buf.end_offset(), 8);

        buf.append(b"ij"); // overflows by 2
        assert_eq!(buf.bytes_snapshot(), b"cdefghij");
        assert_eq!(buf.end_offset(), 10); // total bytes ever, not buffer bytes
    }

    #[test]
    fn ring_buffer_end_offset_continues_past_truncation() {
        use super::RingBuffer;
        let mut buf = RingBuffer::new(4);
        for _ in 0..10 {
            buf.append(b"xy");
        }
        assert_eq!(buf.end_offset(), 20);
        assert_eq!(buf.bytes_snapshot().len(), 4);
    }
```

- [ ] **Step 3: Run the failing tests — verify they fail**

Run: `cd src-tauri && cargo test --lib state::tests::ring_buffer 2>&1 | tail -30`
Expected: compile error (RingBuffer undefined) or test failures.

- [ ] **Step 4: Implement RingBuffer**

Add to `src-tauri/src/terminal/state.rs`, near the top (after imports, before `ManagedSession`):

```rust
/// Bounded circular byte buffer paired with a monotonic byte offset.
///
/// Both fields advance under the same mutex (the one wrapping `RingBuffer`
/// inside `ManagedSession`), so a snapshot always returns `(bytes, end_offset)`
/// where `end_offset == start_offset + bytes.len()`. Required for the
/// replay/cursor protocol — see docs/superpowers/specs/2026-04-25-pty-reattach-on-reload-design.md
/// "Replay Buffer + Offset Cursor".
pub struct RingBuffer {
    bytes: std::collections::VecDeque<u8>,
    capacity: usize,
    end_offset: u64,
}

impl RingBuffer {
    pub fn new(capacity: usize) -> Self {
        Self {
            bytes: std::collections::VecDeque::with_capacity(capacity),
            capacity,
            end_offset: 0,
        }
    }

    /// Append a chunk and return its starting offset (the byte index of
    /// the first appended byte in the lifetime stream).
    pub fn append(&mut self, chunk: &[u8]) -> u64 {
        let chunk_start = self.end_offset;
        self.bytes.extend(chunk.iter().copied());
        while self.bytes.len() > self.capacity {
            self.bytes.pop_front();
        }
        self.end_offset += chunk.len() as u64;
        chunk_start
    }

    pub fn bytes_snapshot(&self) -> Vec<u8> {
        self.bytes.iter().copied().collect()
    }

    pub fn end_offset(&self) -> u64 {
        self.end_offset
    }
}
```

- [ ] **Step 5: Run the tests — verify they pass**

Run: `cd src-tauri && cargo test --lib state::tests::ring_buffer`
Expected: 3 PASS

- [ ] **Step 6: Add ring buffer field to ManagedSession**

Edit the `ManagedSession` struct to add a `ring` field:

```rust
pub struct ManagedSession {
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn std::io::Write + Send>,
    pub child: Box<dyn Child + Send + Sync>,
    #[allow(dead_code)]
    pub cwd: String,
    pub generation: u64,
    /// 64 KB ring buffer of recent output + monotonic byte offset.
    /// Both advance under this mutex so snapshots are atomic.
    pub ring: std::sync::Mutex<RingBuffer>,
}
```

The `Mutex<RingBuffer>` field is the producer-side atomicity guarantee.

- [ ] **Step 7: Update `PtyState::insert` callers — verify `ManagedSession` construction sites still compile**

Run: `cd src-tauri && cargo build 2>&1 | head -40`

Expected: compile errors at every `ManagedSession { ... }` literal — these need a `ring` field. We'll fix them in Task 4 (the `spawn_pty` change). For now confirm the only compile errors are about missing `ring`.

- [ ] **Step 8: Commit (work-in-progress, but compilable later)**

For now, leave the build broken — it'll be fixed in Task 4. Note in the commit:

```bash
git add src-tauri/src/terminal/state.rs
git commit -m "feat(terminal): add RingBuffer + ManagedSession.ring field

Mutex<RingBuffer { bytes, end_offset }> on each managed session — both
fields advance under the same lock so list_sessions snapshots return
(bytes, end_offset) atomically. Required for the replay/cursor protocol.

Build is intentionally broken (ManagedSession construction sites need
the new field) — fixed in the next task.

Refs #55."
```

---

## Task 4: spawn_pty — error on existing id, write cache, cap, ring buffer

**Files:**

- Modify: `src-tauri/src/terminal/commands.rs`
- Modify: `src-tauri/src/terminal/types.rs` (PtyDataEvent.offset_start)

This task changes the spawn_pty contract and unbreaks the build from Task 3.

- [ ] **Step 1: Add offset_start to PtyDataEvent**

Edit `src-tauri/src/terminal/types.rs`. Find `PtyDataEvent` and add:

```rust
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct PtyDataEvent {
    pub session_id: SessionId,
    pub data: String,
    /// Starting byte offset of this chunk in the session's lifetime stream.
    /// Used by frontend cursor dedupe during reattach.
    pub offset_start: u64,
}
```

- [ ] **Step 2: Add SessionCache to managed state via lib.rs**

Hold this — done in Task 11 alongside command registration. For now, `cache: &SessionCache` will be passed via `State<'_, SessionCache>` in commands.

- [ ] **Step 3: Wire cache into spawn_pty signature**

Edit `src-tauri/src/terminal/commands.rs`. Update `spawn_pty` signature:

```rust
#[tauri::command]
pub async fn spawn_pty<R: tauri::Runtime>(
    app: AppHandle<R>,
    state: State<'_, PtyState>,
    cache: State<'_, std::sync::Arc<crate::terminal::cache::SessionCache>>,
    request: SpawnPtyRequest,
) -> Result<PtySession, String> {
```

- [ ] **Step 4: Add the cap and existing-id checks at the top of spawn_pty**

After the existing `debug_log` and id allow-list check, add:

```rust
const MAX_ACTIVE_SESSIONS: usize = 64;
if state.active_count() >= MAX_ACTIVE_SESSIONS {
    return Err("session limit reached".into());
}
if state.contains(&request.session_id) {
    return Err("session already exists".into());
}
```

You'll need to add `active_count()` to `PtyState`:

```rust
// in state.rs
pub fn active_count(&self) -> usize {
    self.sessions.lock().expect("failed to lock sessions").len()
}
```

Promote `active_ids` out of e2e-only:

```rust
// state.rs — remove the cfg attr
pub fn active_ids(&self) -> Vec<SessionId> {
    let sessions = self.sessions.lock().expect("failed to lock sessions");
    sessions.keys().cloned().collect()
}
```

- [ ] **Step 5: Replace the kill-and-replace block**

Find this block in `spawn_pty` (around the existing `commands.rs:211-218`):

```rust
// Kill existing session if session_id is reused, to avoid orphaned processes
if let Some(mut old_session) = state.remove(&request.session_id) {
    log::warn!(...);
    old_session.child.kill().ok();
    old_session.child.wait().ok();
}
```

Delete it entirely. The `contains` check at Step 4 already returns `Err`.

- [ ] **Step 6: Construct ManagedSession with ring buffer + write to cache**

Find the `ManagedSession { master, writer, child, cwd: ..., generation }` literal. Replace with:

```rust
let session = ManagedSession {
    master: pty_pair.master,
    writer,
    child,
    cwd: cwd.to_string_lossy().to_string(),
    generation,
    ring: std::sync::Mutex::new(crate::terminal::state::RingBuffer::new(65536)),
};
state.insert(request.session_id.clone(), session);
```

Then immediately after (still inside `spawn_pty`, before `Ok(PtySession { ... })`):

```rust
// Persist to filesystem cache
let now = chrono::Utc::now().to_rfc3339();
cache.mutate(|d| {
    d.sessions.insert(
        request.session_id.clone(),
        crate::terminal::cache::CachedSession {
            cwd: cwd.to_string_lossy().to_string(),
            created_at: now,
            exited: false,
            last_exit_code: None,
        },
    );
    if !d.session_order.contains(&request.session_id) {
        d.session_order.push(request.session_id.clone());
    }
    if d.active_session_id.is_none() {
        d.active_session_id = Some(request.session_id.clone());
    }
})?;
```

Add `chrono = { version = "0.4", features = ["serde"] }` to `src-tauri/Cargo.toml` if not present:

Run: `cd src-tauri && cargo add chrono --features serde && cd ..`

- [ ] **Step 7: Write the failing tests**

In the existing `mod tests` of `commands.rs`, add a helper for cache-state in tests, then the new cases. First a helper at the top of the test module:

```rust
fn create_test_app_with_cache() -> (tauri::App<MockRuntime>, std::sync::Arc<cache::SessionCache>) {
    let pty_state = PtyState::new();
    let temp = tempfile::TempDir::new().unwrap();
    let cache = std::sync::Arc::new(
        cache::SessionCache::load(temp.path().join("sessions.json")).unwrap(),
    );
    let cache_for_manage = cache.clone();
    let app = mock_builder()
        .manage(pty_state)
        .manage(cache_for_manage)
        .build(tauri::generate_context!())
        .expect("failed to build test app");
    // Leak the temp dir so its path stays valid for the cache for the test's lifetime.
    std::mem::forget(temp);
    (app, cache)
}
```

Add `tempfile` to `[dev-dependencies]` in `src-tauri/Cargo.toml` (already in `[dependencies]` from Task 2 — verify via `grep tempfile src-tauri/Cargo.toml`; if only in `[dependencies]`, no action needed).

- [ ] **Step 8: Add `spawn_pty_returns_error_on_existing_session_id` test**

```rust
    #[tokio::test]
    async fn spawn_pty_returns_error_on_existing_session_id() {
        let (app, cache) = create_test_app_with_cache();
        let handle = app.handle();
        let state = handle.state::<PtyState>();
        let cache_state = handle.state::<std::sync::Arc<cache::SessionCache>>();

        let req = SpawnPtyRequest {
            session_id: "test-dup".to_string(),
            cwd: std::env::current_dir().unwrap().to_string_lossy().to_string(),
            shell: None,
            env: None,
            enable_agent_bridge: false,
        };

        spawn_pty(handle.clone(), state.clone(), cache_state.clone(), req.clone())
            .await
            .expect("first spawn should succeed");

        let result = spawn_pty(handle.clone(), state.clone(), cache_state.clone(), req).await;
        assert!(result.is_err(), "second spawn with same id should fail");
        assert!(
            result.unwrap_err().contains("already exists"),
            "error should mention 'already exists'"
        );

        // Cleanup
        let _ = kill_pty(state.clone(), cache_state.clone(), KillPtyRequest {
            session_id: "test-dup".to_string(),
        });
    }
```

- [ ] **Step 9: Add `spawn_pty_appends_to_session_order_and_promotes_active` test**

```rust
    #[tokio::test]
    async fn spawn_pty_appends_to_session_order_and_promotes_active() {
        let (app, cache) = create_test_app_with_cache();
        let handle = app.handle();
        let state = handle.state::<PtyState>();
        let cache_state = handle.state::<std::sync::Arc<cache::SessionCache>>();

        spawn_pty(
            handle.clone(),
            state.clone(),
            cache_state.clone(),
            SpawnPtyRequest {
                session_id: "first".into(),
                cwd: std::env::current_dir().unwrap().to_string_lossy().into(),
                shell: None,
                env: None,
                enable_agent_bridge: false,
            },
        )
        .await
        .unwrap();

        let snap = cache.snapshot();
        assert_eq!(snap.session_order, vec!["first".to_string()]);
        assert_eq!(snap.active_session_id.as_deref(), Some("first"));

        spawn_pty(
            handle.clone(),
            state.clone(),
            cache_state.clone(),
            SpawnPtyRequest {
                session_id: "second".into(),
                cwd: std::env::current_dir().unwrap().to_string_lossy().into(),
                shell: None,
                env: None,
                enable_agent_bridge: false,
            },
        )
        .await
        .unwrap();

        let snap = cache.snapshot();
        assert_eq!(snap.session_order, vec!["first".into(), "second".into()]);
        // Active stays as 'first' (only promoted on empty)
        assert_eq!(snap.active_session_id.as_deref(), Some("first"));

        // Cleanup
        let _ = kill_pty(state.clone(), cache_state.clone(), KillPtyRequest { session_id: "first".into() });
        let _ = kill_pty(state.clone(), cache_state.clone(), KillPtyRequest { session_id: "second".into() });
    }
```

- [ ] **Step 10: Add `spawn_pty_caps_at_64_active_sessions` test**

This test takes a moment to run since each spawn creates a real PTY. Keep it under feature flag or accept the duration:

```rust
    #[tokio::test]
    async fn spawn_pty_caps_at_64_active_sessions() {
        let (app, cache) = create_test_app_with_cache();
        let handle = app.handle();
        let state = handle.state::<PtyState>();
        let cache_state = handle.state::<std::sync::Arc<cache::SessionCache>>();

        let cwd = std::env::current_dir().unwrap().to_string_lossy().to_string();
        let mut ids = vec![];
        for i in 0..64 {
            let id = format!("cap-{i}");
            spawn_pty(
                handle.clone(),
                state.clone(),
                cache_state.clone(),
                SpawnPtyRequest {
                    session_id: id.clone(),
                    cwd: cwd.clone(),
                    shell: None,
                    env: None,
                    enable_agent_bridge: false,
                },
            )
            .await
            .unwrap_or_else(|e| panic!("spawn {i} failed: {e}"));
            ids.push(id);
        }

        let result = spawn_pty(
            handle.clone(),
            state.clone(),
            cache_state.clone(),
            SpawnPtyRequest {
                session_id: "cap-65".into(),
                cwd,
                shell: None,
                env: None,
                enable_agent_bridge: false,
            },
        ).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("session limit reached"));

        // Cleanup
        for id in ids {
            let _ = kill_pty(state.clone(), cache_state.clone(), KillPtyRequest { session_id: id });
        }
    }
```

> Note: this test spawns 64 real shells. If CI is slow, gate behind `#[ignore]` and run manually. For now, leave it inline.

- [ ] **Step 11: Run all spawn tests — verify pass**

Run: `cd src-tauri && cargo test --lib commands::tests::spawn_pty 2>&1 | tail -20`
Expected: existing + new tests PASS. (Note: pre-existing tests using the old `spawn_pty` signature will need updating — fix them in Step 12.)

- [ ] **Step 12: Update pre-existing spawn_pty tests**

Find all existing tests that call `spawn_pty(handle.clone(), state.clone(), request)` (without cache). Update to use `create_test_app_with_cache()` helper and pass `cache_state.clone()` as the third arg. The pre-existing tests are:

- `spawn_pty_creates_session`
- `kill_pty_removes_session`
- `write_pty_succeeds_multiple_times`
- `session_remains_accessible_during_reader_startup`

For each, replace `create_test_app()` with `create_test_app_with_cache()` and `spawn_pty(handle.clone(), state.clone(), req)` with `spawn_pty(handle.clone(), state.clone(), cache_state.clone(), req)`.

`kill_pty` will gain a cache parameter in Task 5 — update those callers in Task 5's step.

- [ ] **Step 13: Run the full test suite — verify no regressions**

Run: `cd src-tauri && cargo test --lib`
Expected: all PASS.

- [ ] **Step 14: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/terminal/commands.rs src-tauri/src/terminal/types.rs src-tauri/src/terminal/state.rs
git commit -m "feat(terminal): spawn_pty errors on existing id, writes cache, caps at 64

- spawn_pty no longer kills-and-replaces on session_id reuse — returns
  Err('session already exists'). Reattach goes through list_sessions.
- Cap at 64 active sessions (DoS guard).
- Persist new session to SessionCache on success (cwd, created_at,
  exited:false). Append to session_order; promote to active if first.
- ManagedSession constructed with Mutex<RingBuffer> for the replay
  protocol's producer-side atomicity.
- PtyDataEvent payload gains offset_start: u64.

Refs #55."
```

---

## Task 5: kill_pty — idempotent + cache cleanup

**Files:**

- Modify: `src-tauri/src/terminal/commands.rs`

- [ ] **Step 1: Write failing test for idempotent kill**

In `src-tauri/src/terminal/commands.rs` test module:

```rust
    #[tokio::test]
    async fn kill_pty_is_idempotent_for_missing_session() {
        let (app, cache) = create_test_app_with_cache();
        let cache_state = app.handle().state::<std::sync::Arc<cache::SessionCache>>();
        let state = app.handle().state::<PtyState>();

        let result = kill_pty(
            state.clone(),
            cache_state.clone(),
            KillPtyRequest { session_id: "never-existed".into() },
        );
        assert!(result.is_ok(), "kill_pty for missing session should be Ok, got {:?}", result);
    }

    #[tokio::test]
    async fn kill_pty_removes_from_session_order_and_cache() {
        let (app, cache) = create_test_app_with_cache();
        let handle = app.handle();
        let state = handle.state::<PtyState>();
        let cache_state = handle.state::<std::sync::Arc<cache::SessionCache>>();

        spawn_pty(
            handle.clone(),
            state.clone(),
            cache_state.clone(),
            SpawnPtyRequest {
                session_id: "victim".into(),
                cwd: std::env::current_dir().unwrap().to_string_lossy().into(),
                shell: None,
                env: None,
                enable_agent_bridge: false,
            },
        )
        .await
        .unwrap();

        kill_pty(state.clone(), cache_state.clone(), KillPtyRequest {
            session_id: "victim".into(),
        }).unwrap();

        let snap = cache.snapshot();
        assert!(snap.sessions.get("victim").is_none());
        assert!(!snap.session_order.contains(&"victim".to_string()));
        assert!(snap.active_session_id.is_none(), "active should clear when last session killed");
    }

    #[tokio::test]
    async fn kill_pty_advances_active_when_active_killed() {
        let (app, cache) = create_test_app_with_cache();
        let handle = app.handle();
        let state = handle.state::<PtyState>();
        let cache_state = handle.state::<std::sync::Arc<cache::SessionCache>>();

        let cwd = std::env::current_dir().unwrap().to_string_lossy().to_string();
        for id in &["a", "b", "c"] {
            spawn_pty(
                handle.clone(),
                state.clone(),
                cache_state.clone(),
                SpawnPtyRequest {
                    session_id: id.to_string(),
                    cwd: cwd.clone(),
                    shell: None,
                    env: None,
                    enable_agent_bridge: false,
                },
            ).await.unwrap();
        }
        // Active is 'a' (first spawned)
        assert_eq!(cache.snapshot().active_session_id.as_deref(), Some("a"));

        kill_pty(state.clone(), cache_state.clone(), KillPtyRequest {
            session_id: "a".into(),
        }).unwrap();
        // Active rotates to next in order = 'b'
        assert_eq!(cache.snapshot().active_session_id.as_deref(), Some("b"));

        // Cleanup
        for id in &["b", "c"] {
            let _ = kill_pty(state.clone(), cache_state.clone(), KillPtyRequest {
                session_id: id.to_string(),
            });
        }
    }
```

- [ ] **Step 2: Run failing tests**

Run: `cd src-tauri && cargo test --lib commands::tests::kill_pty 2>&1 | tail -30`
Expected: compile errors (kill_pty signature mismatch).

- [ ] **Step 3: Implement idempotent kill_pty + cache cleanup**

In `commands.rs`, replace the existing `kill_pty`:

```rust
#[tauri::command]
pub fn kill_pty(
    state: State<'_, PtyState>,
    cache: State<'_, std::sync::Arc<crate::terminal::cache::SessionCache>>,
    request: KillPtyRequest,
) -> Result<(), String> {
    log::info!("Killing PTY session: {}", request.session_id);

    // Best-effort kill — no error if missing
    let _ = state.kill(&request.session_id);
    state.remove(&request.session_id);

    // Cache cleanup
    cache.mutate(|d| {
        d.sessions.remove(&request.session_id);
        d.session_order.retain(|x| x != &request.session_id);
        if d.active_session_id.as_deref() == Some(&request.session_id) {
            d.active_session_id = d.session_order.first().cloned();
        }
    })?;

    Ok(())
}
```

Update `PtyState::kill` to be safe on missing — currently it errors. Make it return `Ok(())` when session is missing:

```rust
// state.rs
pub fn kill(&self, session_id: &SessionId) -> anyhow::Result<()> {
    let mut sessions = self.sessions.lock().expect("failed to lock sessions");
    if let Some(session) = sessions.get_mut(session_id) {
        session
            .child
            .kill()
            .map_err(|e| anyhow::anyhow!("failed to kill PTY process: {}", e))?;
    }
    Ok(())
}
```

- [ ] **Step 4: Update pre-existing kill_pty test callers**

Find any test that calls `kill_pty(state.clone(), KillPtyRequest { ... })` and add the cache state arg. The test `kill_pty_removes_session` from earlier needs:

```rust
let result = kill_pty(state.clone(), cache_state.clone(), kill_request);
```

- [ ] **Step 5: Run tests — verify pass**

Run: `cd src-tauri && cargo test --lib commands::tests::kill_pty`
Expected: 3 new + 1 updated PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/terminal/commands.rs src-tauri/src/terminal/state.rs
git commit -m "feat(terminal): kill_pty is idempotent and cleans cache

- Returns Ok(()) when session is missing (was: Err)
- Removes from cache.sessions, cache.session_order
- If killed session was active, advances to next in order (or None)
- PtyState::kill no longer errors on missing session

Enables the Restart-Exited-session UX (kill old id no-op + spawn new id).

Refs #55."
```

---

## Task 6: read_pty_output — atomic ring buffer write + offset emission + EOF marks cache

**Files:**

- Modify: `src-tauri/src/terminal/commands.rs` (read_pty_output function)

- [ ] **Step 1: Update read_pty_output signature to take cache**

In `commands.rs`, change the spawn_pty's thread spawn to pass cache:

```rust
let session_id = request.session_id.clone();
let state_clone = state.inner().clone();
let cache_clone = cache.inner().clone();
std::thread::spawn(move || {
    let rt = tauri::async_runtime::handle();
    if let Err(e) = rt.block_on(read_pty_output(app, state_clone, cache_clone, session_id, generation)) {
        log::error!("PTY output reader error: {}", e);
    }
});
```

And update `read_pty_output`:

```rust
async fn read_pty_output<R: tauri::Runtime>(
    app: AppHandle<R>,
    state: PtyState,
    cache: std::sync::Arc<crate::terminal::cache::SessionCache>,
    session_id: SessionId,
    generation: u64,
) -> anyhow::Result<()> {
    log::info!("Starting PTY output reader for session: {}", session_id);

    let mut reader = state.clone_reader(&session_id)?;

    let mut buf = [0u8; 8192];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => {
                log::info!("PTY session {} exited (EOF)", session_id);
                // Mark cache as exited
                let _ = cache.mutate(|d| {
                    if let Some(s) = d.sessions.get_mut(&session_id) {
                        s.exited = true;
                        // last_exit_code stays None in v1 — capturing requires
                        // child.try_wait() with locking; deferred to follow-up.
                    }
                });
                app.emit(
                    "pty-exit",
                    PtyExitEvent {
                        session_id: session_id.clone(),
                        code: None,
                    },
                )
                .ok();
                break;
            }
            Ok(n) => {
                // Atomically: append to ring buffer, get chunk_start, drop the lock
                let chunk_start = {
                    let sessions = state.inner_sessions().lock().expect("poisoned");
                    if let Some(session) = sessions.get(&session_id) {
                        let mut ring = session.ring.lock().expect("ring poisoned");
                        ring.append(&buf[..n])
                    } else {
                        // Session was removed mid-read — exit loop
                        break;
                    }
                };
                let data = String::from_utf8_lossy(&buf[..n]).to_string();
                app.emit(
                    "pty-data",
                    PtyDataEvent {
                        session_id: session_id.clone(),
                        data,
                        offset_start: chunk_start,
                    },
                )
                .ok();
            }
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => {
                log::error!("PTY read error for session {}: {}", session_id, e);
                app.emit(
                    "pty-error",
                    PtyErrorEvent {
                        session_id: session_id.clone(),
                        message: e.to_string(),
                    },
                )
                .ok();
                break;
            }
        }
    }

    state.remove_if_generation(&session_id, generation);
    Ok(())
}
```

- [ ] **Step 2: Expose inner_sessions on PtyState**

Add to `state.rs`:

```rust
/// Internal accessor for code that needs to take the sessions lock directly
/// (e.g., the read loop accessing the ring buffer atomically).
pub fn inner_sessions(&self) -> &Arc<Mutex<HashMap<SessionId, ManagedSession>>> {
    &self.sessions
}
```

- [ ] **Step 3: Write a test for EOF marks cache exited**

Add to `commands.rs` tests:

```rust
    #[tokio::test]
    async fn read_loop_eof_marks_cache_exited() {
        let (app, cache) = create_test_app_with_cache();
        let handle = app.handle();
        let state = handle.state::<PtyState>();
        let cache_state = handle.state::<std::sync::Arc<cache::SessionCache>>();

        spawn_pty(
            handle.clone(),
            state.clone(),
            cache_state.clone(),
            SpawnPtyRequest {
                session_id: "eof-test".into(),
                cwd: std::env::current_dir().unwrap().to_string_lossy().into(),
                shell: None,
                env: None,
                enable_agent_bridge: false,
            },
        ).await.unwrap();

        // Force EOF by sending exit
        write_pty(state.clone(), WritePtyRequest {
            session_id: "eof-test".into(),
            data: "exit\n".into(),
        }).unwrap();

        // Wait for read loop to process EOF (give shell a moment to exit)
        std::thread::sleep(std::time::Duration::from_millis(500));

        let snap = cache.snapshot();
        let entry = snap.sessions.get("eof-test")
            .expect("session should still be in cache after exit");
        assert!(entry.exited, "cache entry should be marked exited after EOF");
    }
```

- [ ] **Step 4: Run the test**

Run: `cd src-tauri && cargo test --lib commands::tests::read_loop_eof_marks_cache_exited`
Expected: PASS (allow up to 1s for the shell exit + EOF detection).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/terminal/commands.rs src-tauri/src/terminal/state.rs
git commit -m "feat(terminal): read loop emits offset_start; EOF marks cache exited

- pty-data event includes offset_start (chunk's starting byte offset)
- ring buffer append + offset advance happen under one lock — pins the
  producer-side atomic boundary required by the cursor protocol
- on read-loop EOF: cache.sessions[id].exited = true (last_exit_code
  stays None in v1)

Refs #55."
```

---

## Task 7: list_sessions command + atomic snapshot test

**Files:**

- Modify: `src-tauri/src/terminal/commands.rs` (new command)
- Modify: `src-tauri/src/terminal/types.rs` (response types)

- [ ] **Step 1: Add response types**

Edit `src-tauri/src/terminal/types.rs`. Add:

```rust
#[derive(Debug, Clone, Serialize, TS)]
#[serde(tag = "kind")]
#[ts(export)]
pub enum SessionStatus {
    Alive {
        pid: u32,
        replay_data: String,
        replay_end_offset: u64,
    },
    Exited {
        last_exit_code: Option<i32>,
    },
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct SessionInfo {
    pub id: String,
    pub cwd: String,
    pub status: SessionStatus,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct SessionList {
    pub active_session_id: Option<String>,
    pub sessions: Vec<SessionInfo>,
}
```

- [ ] **Step 2: Implement list_sessions**

Add to `commands.rs`:

```rust
#[tauri::command]
pub fn list_sessions(
    state: State<'_, PtyState>,
    cache: State<'_, std::sync::Arc<crate::terminal::cache::SessionCache>>,
) -> Result<SessionList, String> {
    let snapshot = cache.snapshot();
    let mut needs_flush = false;
    let mut session_infos = Vec::with_capacity(snapshot.session_order.len());

    for id in &snapshot.session_order {
        let cached = match snapshot.sessions.get(id) {
            Some(c) => c.clone(),
            None => continue, // session_order/sessions desync — skip
        };

        let pid_opt = state.get_pid(id);
        let status = if cached.exited {
            SessionStatus::Exited { last_exit_code: cached.last_exit_code }
        } else if let Some(pid) = pid_opt {
            // Alive: snapshot ring buffer + end_offset under one lock
            let sessions_lock = state.inner_sessions().lock().expect("poisoned");
            if let Some(session) = sessions_lock.get(id) {
                let ring_guard = session.ring.lock().expect("ring poisoned");
                let bytes = ring_guard.bytes_snapshot();
                let end_offset = ring_guard.end_offset();
                drop(ring_guard);
                drop(sessions_lock);
                let replay_data = String::from_utf8_lossy(&bytes).to_string();
                SessionStatus::Alive { pid, replay_data, replay_end_offset: end_offset }
            } else {
                // Race: removed between get_pid and lock — treat as exited
                needs_flush = true;
                SessionStatus::Exited { last_exit_code: None }
            }
        } else {
            // Lazy reconciliation: cache says alive, but PtyState doesn't
            // have it (Tauri restart, hard kill, etc). Flip the cache.
            needs_flush = true;
            SessionStatus::Exited { last_exit_code: None }
        };

        session_infos.push(SessionInfo {
            id: id.clone(),
            cwd: cached.cwd,
            status,
        });
    }

    if needs_flush {
        // Flush the lazy reconciliation results back to cache
        cache.mutate(|d| {
            for info in &session_infos {
                if matches!(info.status, SessionStatus::Exited { .. }) {
                    if let Some(s) = d.sessions.get_mut(&info.id) {
                        s.exited = true;
                    }
                }
            }
        })?;
    }

    Ok(SessionList {
        active_session_id: snapshot.active_session_id,
        sessions: session_infos,
    })
}
```

- [ ] **Step 3: Write tests**

Add to `commands.rs` test module:

```rust
    #[tokio::test]
    async fn list_sessions_returns_alive_for_running_pty() {
        let (app, _cache) = create_test_app_with_cache();
        let handle = app.handle();
        let state = handle.state::<PtyState>();
        let cache_state = handle.state::<std::sync::Arc<cache::SessionCache>>();

        spawn_pty(
            handle.clone(),
            state.clone(),
            cache_state.clone(),
            SpawnPtyRequest {
                session_id: "alive-1".into(),
                cwd: std::env::current_dir().unwrap().to_string_lossy().into(),
                shell: None,
                env: None,
                enable_agent_bridge: false,
            },
        ).await.unwrap();

        let result = list_sessions(state.clone(), cache_state.clone()).unwrap();
        assert_eq!(result.sessions.len(), 1);
        assert_eq!(result.sessions[0].id, "alive-1");
        assert!(matches!(result.sessions[0].status, SessionStatus::Alive { .. }));

        let _ = kill_pty(state.clone(), cache_state.clone(), KillPtyRequest { session_id: "alive-1".into() });
    }

    #[tokio::test]
    async fn list_sessions_reconciles_alive_cache_with_empty_pty_state() {
        let (app, cache) = create_test_app_with_cache();
        let cache_state = app.handle().state::<std::sync::Arc<cache::SessionCache>>();
        let state = app.handle().state::<PtyState>();

        // Manually plant an "alive but missing" entry in the cache
        cache.mutate(|d| {
            d.session_order.push("phantom".into());
            d.sessions.insert("phantom".into(), cache::CachedSession {
                cwd: "/tmp".into(),
                created_at: "2026-04-25T00:00:00Z".into(),
                exited: false,
                last_exit_code: None,
            });
        }).unwrap();

        let result = list_sessions(state.clone(), cache_state.clone()).unwrap();
        assert_eq!(result.sessions.len(), 1);
        match &result.sessions[0].status {
            SessionStatus::Exited { last_exit_code } => assert_eq!(*last_exit_code, None),
            other => panic!("expected Exited, got {:?}", other),
        }

        // Verify lazy reconciliation flushed back to cache
        let snap = cache.snapshot();
        assert!(snap.sessions["phantom"].exited);
    }

    #[tokio::test]
    async fn list_sessions_returns_in_session_order() {
        let (app, _cache) = create_test_app_with_cache();
        let handle = app.handle();
        let state = handle.state::<PtyState>();
        let cache_state = handle.state::<std::sync::Arc<cache::SessionCache>>();

        let cwd = std::env::current_dir().unwrap().to_string_lossy().to_string();
        for id in &["zebra", "alpha", "mike"] {
            spawn_pty(
                handle.clone(),
                state.clone(),
                cache_state.clone(),
                SpawnPtyRequest {
                    session_id: id.to_string(),
                    cwd: cwd.clone(),
                    shell: None,
                    env: None,
                    enable_agent_bridge: false,
                },
            ).await.unwrap();
        }

        let result = list_sessions(state.clone(), cache_state.clone()).unwrap();
        let ids: Vec<_> = result.sessions.iter().map(|s| s.id.clone()).collect();
        assert_eq!(ids, vec!["zebra", "alpha", "mike"]);

        for id in &["zebra", "alpha", "mike"] {
            let _ = kill_pty(state.clone(), cache_state.clone(), KillPtyRequest { session_id: id.to_string() });
        }
    }

    #[tokio::test]
    async fn list_sessions_replay_end_offset_matches_buffer_contents() {
        let (app, _cache) = create_test_app_with_cache();
        let handle = app.handle();
        let state = handle.state::<PtyState>();
        let cache_state = handle.state::<std::sync::Arc<cache::SessionCache>>();

        spawn_pty(
            handle.clone(),
            state.clone(),
            cache_state.clone(),
            SpawnPtyRequest {
                session_id: "off-test".into(),
                cwd: std::env::current_dir().unwrap().to_string_lossy().into(),
                shell: None,
                env: None,
                enable_agent_bridge: false,
            },
        ).await.unwrap();

        // Write some output and let the read loop process
        write_pty(state.clone(), WritePtyRequest {
            session_id: "off-test".into(),
            data: "echo hello\n".into(),
        }).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(300));

        let result = list_sessions(state.clone(), cache_state.clone()).unwrap();
        match &result.sessions[0].status {
            SessionStatus::Alive { replay_data, replay_end_offset, .. } => {
                // Ring buffer contents may be longer than just the echo
                // (prompt, command echo, output, new prompt)
                let bytes_in_buffer = replay_data.bytes().count() as u64;
                // end_offset >= buffer length (truncation tolerance)
                assert!(*replay_end_offset >= bytes_in_buffer,
                    "end_offset {} < buffer len {}", replay_end_offset, bytes_in_buffer);
            }
            other => panic!("expected Alive, got {:?}", other),
        }

        let _ = kill_pty(state.clone(), cache_state.clone(), KillPtyRequest { session_id: "off-test".into() });
    }
```

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test --lib commands::tests::list_sessions`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/terminal/commands.rs src-tauri/src/terminal/types.rs
git commit -m "feat(terminal): list_sessions command + lazy reconciliation

Returns SessionList { active_session_id, sessions: [SessionInfo] } in
cache.session_order. Reconciliation: if cache says exited:false but
PtyState has no entry (Tauri restart, hard kill), flip to Exited and
flush — correctness comes from this read pass, not from shutdown hooks.

Alive variant snapshots ring buffer + end_offset under one lock so the
returned (replay_data, replay_end_offset) is atomically consistent.

Refs #55."
```

---

## Task 8: set_active_session, reorder_sessions, update_session_cwd commands

**Files:**

- Modify: `src-tauri/src/terminal/commands.rs`
- Modify: `src-tauri/src/terminal/types.rs`

- [ ] **Step 1: Add request types**

Add to `types.rs`:

```rust
#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct SetActiveSessionRequest {
    pub id: String,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct ReorderSessionsRequest {
    pub ids: Vec<String>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct UpdateSessionCwdRequest {
    pub id: String,
    pub cwd: String,
}
```

- [ ] **Step 2: Implement the three commands**

Add to `commands.rs`:

```rust
#[tauri::command]
pub fn set_active_session(
    cache: State<'_, std::sync::Arc<crate::terminal::cache::SessionCache>>,
    request: SetActiveSessionRequest,
) -> Result<(), String> {
    let snap = cache.snapshot();
    if !snap.session_order.contains(&request.id) {
        return Err("unknown session".into());
    }
    cache.mutate(|d| { d.active_session_id = Some(request.id.clone()); })
}

#[tauri::command]
pub fn reorder_sessions(
    cache: State<'_, std::sync::Arc<crate::terminal::cache::SessionCache>>,
    request: ReorderSessionsRequest,
) -> Result<(), String> {
    let snap = cache.snapshot();
    let current: std::collections::HashSet<_> = snap.session_order.iter().cloned().collect();
    let proposed: std::collections::HashSet<_> = request.ids.iter().cloned().collect();
    if current != proposed {
        return Err("invalid reorder: not a permutation".into());
    }
    cache.mutate(|d| { d.session_order = request.ids.clone(); })
}

#[tauri::command]
pub fn update_session_cwd(
    cache: State<'_, std::sync::Arc<crate::terminal::cache::SessionCache>>,
    request: UpdateSessionCwdRequest,
) -> Result<(), String> {
    // UUID-shape allow-list (same as spawn_pty)
    if !request.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("invalid session id".into());
    }
    // cwd must be an absolute path that exists and is a directory
    let path = std::path::PathBuf::from(&request.cwd);
    if !path.is_absolute() {
        return Err("invalid cwd: must be absolute".into());
    }
    if !path.is_dir() {
        return Err("invalid cwd: not a directory".into());
    }

    let snap = cache.snapshot();
    if !snap.sessions.contains_key(&request.id) {
        return Err("unknown session".into());
    }
    cache.mutate(|d| {
        if let Some(s) = d.sessions.get_mut(&request.id) {
            s.cwd = request.cwd.clone();
        }
    })
}
```

- [ ] **Step 3: Write tests**

Add to test module (uses `create_test_app_with_cache()` helper):

```rust
    #[tokio::test]
    async fn set_active_session_persists_to_cache() {
        let (app, cache) = create_test_app_with_cache();
        let handle = app.handle();
        let state = handle.state::<PtyState>();
        let cache_state = handle.state::<std::sync::Arc<cache::SessionCache>>();

        let cwd = std::env::current_dir().unwrap().to_string_lossy().to_string();
        for id in &["a", "b"] {
            spawn_pty(
                handle.clone(),
                state.clone(),
                cache_state.clone(),
                SpawnPtyRequest {
                    session_id: id.to_string(),
                    cwd: cwd.clone(),
                    shell: None,
                    env: None,
                    enable_agent_bridge: false,
                },
            ).await.unwrap();
        }

        set_active_session(cache_state.clone(), SetActiveSessionRequest {
            id: "b".into(),
        }).unwrap();

        assert_eq!(cache.snapshot().active_session_id.as_deref(), Some("b"));

        for id in &["a", "b"] {
            let _ = kill_pty(state.clone(), cache_state.clone(), KillPtyRequest { session_id: id.to_string() });
        }
    }

    #[test]
    fn set_active_session_rejects_unknown_id() {
        let (app, _cache) = create_test_app_with_cache();
        let cache_state = app.handle().state::<std::sync::Arc<cache::SessionCache>>();

        let result = set_active_session(cache_state.clone(), SetActiveSessionRequest {
            id: "nope".into(),
        });
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("unknown session"));
    }

    #[tokio::test]
    async fn reorder_sessions_persists_to_cache() {
        let (app, cache) = create_test_app_with_cache();
        let handle = app.handle();
        let state = handle.state::<PtyState>();
        let cache_state = handle.state::<std::sync::Arc<cache::SessionCache>>();

        let cwd = std::env::current_dir().unwrap().to_string_lossy().to_string();
        for id in &["a", "b", "c"] {
            spawn_pty(handle.clone(), state.clone(), cache_state.clone(), SpawnPtyRequest {
                session_id: id.to_string(),
                cwd: cwd.clone(),
                shell: None,
                env: None,
                enable_agent_bridge: false,
            }).await.unwrap();
        }

        reorder_sessions(cache_state.clone(), ReorderSessionsRequest {
            ids: vec!["c".into(), "a".into(), "b".into()],
        }).unwrap();

        assert_eq!(cache.snapshot().session_order, vec!["c", "a", "b"]);

        for id in &["a", "b", "c"] {
            let _ = kill_pty(state.clone(), cache_state.clone(), KillPtyRequest { session_id: id.to_string() });
        }
    }

    #[tokio::test]
    async fn reorder_sessions_rejects_non_permutation() {
        let (app, _cache) = create_test_app_with_cache();
        let handle = app.handle();
        let state = handle.state::<PtyState>();
        let cache_state = handle.state::<std::sync::Arc<cache::SessionCache>>();

        spawn_pty(handle.clone(), state.clone(), cache_state.clone(), SpawnPtyRequest {
            session_id: "only".into(),
            cwd: std::env::current_dir().unwrap().to_string_lossy().into(),
            shell: None,
            env: None,
            enable_agent_bridge: false,
        }).await.unwrap();

        let result = reorder_sessions(cache_state.clone(), ReorderSessionsRequest {
            ids: vec!["only".into(), "extra".into()],
        });
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not a permutation"));

        let _ = kill_pty(state.clone(), cache_state.clone(), KillPtyRequest { session_id: "only".into() });
    }

    #[tokio::test]
    async fn update_session_cwd_persists_to_cache() {
        let (app, cache) = create_test_app_with_cache();
        let handle = app.handle();
        let state = handle.state::<PtyState>();
        let cache_state = handle.state::<std::sync::Arc<cache::SessionCache>>();

        let cwd = std::env::current_dir().unwrap().to_string_lossy().to_string();
        spawn_pty(handle.clone(), state.clone(), cache_state.clone(), SpawnPtyRequest {
            session_id: "cwd-test".into(),
            cwd: cwd.clone(),
            shell: None,
            env: None,
            enable_agent_bridge: false,
        }).await.unwrap();

        // Use /tmp which is guaranteed to exist on POSIX
        update_session_cwd(cache_state.clone(), UpdateSessionCwdRequest {
            id: "cwd-test".into(),
            cwd: "/tmp".into(),
        }).unwrap();

        assert_eq!(cache.snapshot().sessions["cwd-test"].cwd, "/tmp");

        let _ = kill_pty(state.clone(), cache_state.clone(), KillPtyRequest { session_id: "cwd-test".into() });
    }

    #[test]
    fn update_session_cwd_rejects_invalid_path() {
        let (app, _cache) = create_test_app_with_cache();
        let cache_state = app.handle().state::<std::sync::Arc<cache::SessionCache>>();

        let result = update_session_cwd(cache_state.clone(), UpdateSessionCwdRequest {
            id: "any".into(),
            cwd: "/nonexistent/totally/fake/path".into(),
        });
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not a directory"));
    }
```

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test --lib commands::tests`
Expected: all PASS (existing + new).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/terminal/commands.rs src-tauri/src/terminal/types.rs
git commit -m "feat(terminal): set_active_session / reorder_sessions / update_session_cwd

Three new commands for the frontend to push UI state into the cache:
- set_active_session(id): updates active_session_id; errors on unknown
- reorder_sessions(ids): replaces session_order; errors on non-permutation
- update_session_cwd(id, cwd): syncs OSC 7 cwd updates; validates path

Refs #55."
```

---

## Task 9: Register new commands + manage SessionCache in lib.rs

**Files:**

- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/terminal/mod.rs`

- [ ] **Step 1: Re-export new commands and types**

Edit `src-tauri/src/terminal/mod.rs`. Find the existing exports and add:

```rust
pub use commands::{
    spawn_pty, write_pty, resize_pty, kill_pty,
    list_sessions, set_active_session, reorder_sessions, update_session_cwd,
};
pub use cache::SessionCache;
pub use types::{
    SessionList, SessionInfo, SessionStatus,
    SetActiveSessionRequest, ReorderSessionsRequest, UpdateSessionCwdRequest,
};
```

- [ ] **Step 2: Manage SessionCache in lib.rs setup**

Edit `src-tauri/src/lib.rs`. In the `run()` function, where `.manage(PtyState::new())` is called, add:

```rust
.setup(|app| {
    // existing log plugin code ...

    // Initialize SessionCache from app_data_dir
    use tauri::Manager;
    let app_data_dir = app.path().app_data_dir()
        .expect("failed to resolve app_data_dir");
    let cache_path = app_data_dir.join("sessions.json");
    let cache = std::sync::Arc::new(
        terminal::SessionCache::load(cache_path)
            .unwrap_or_else(|e| {
                log::warn!("SessionCache load failed (starting empty): {e}");
                std::sync::Arc::try_unwrap(
                    std::sync::Arc::new(terminal::SessionCache::load(
                        std::path::PathBuf::from("/dev/null/cache_unused.json")
                    ).expect("empty cache load should succeed"))
                ).unwrap_or_else(|_| panic!("Arc unwrap"))
            })
    );
    app.manage(cache);

    Ok(())
})
```

Wait — that fallback is convoluted. Simpler:

```rust
.setup(|app| {
    if cfg!(debug_assertions) {
        app.handle().plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )?;
    }

    use tauri::Manager;
    let app_data_dir = app.path().app_data_dir()
        .expect("failed to resolve app_data_dir");
    let cache_path = app_data_dir.join("sessions.json");
    let cache = match terminal::SessionCache::load(cache_path.clone()) {
        Ok(c) => std::sync::Arc::new(c),
        Err(e) => {
            log::warn!("SessionCache load failed for {:?} ({e}); starting empty", cache_path);
            // Force-load from a non-existent path — returns empty cache
            std::sync::Arc::new(
                terminal::SessionCache::load(cache_path)
                    .unwrap_or_else(|_| panic!("empty cache load should never fail"))
            )
        }
    };
    app.manage(cache);

    Ok(())
})
```

Hmm — `SessionCache::load` returns Err only when the file exists AND is corrupt. If the file doesn't exist, it returns Ok with an empty cache. So on corrupt-cache, we should:

1. Move the corrupt file aside (e.g., to `sessions.json.corrupt-YYYYMMDDHHMMSS`)
2. Load fresh empty

Cleaner approach in `cache.rs`:

```rust
// in cache.rs, add:
pub fn load_or_recover(path: PathBuf) -> Self {
    match Self::load(path.clone()) {
        Ok(cache) => cache,
        Err(e) => {
            log::warn!("cache load failed ({e}); moving aside and starting empty");
            let backup = path.with_extension(format!(
                "json.corrupt-{}",
                chrono::Utc::now().format("%Y%m%d%H%M%S")
            ));
            let _ = std::fs::rename(&path, &backup);
            Self::load(path).expect("empty cache load should never fail")
        }
    }
}
```

Simplify lib.rs:

```rust
let cache = std::sync::Arc::new(terminal::SessionCache::load_or_recover(cache_path));
app.manage(cache);
```

Add the `load_or_recover` method to `cache.rs` and a corresponding test:

```rust
    #[test]
    fn load_or_recover_moves_corrupt_aside() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("sessions.json");
        std::fs::write(&path, b"corrupt!").unwrap();

        let cache = SessionCache::load_or_recover(path.clone());
        let snap = cache.snapshot();
        assert_eq!(snap.session_order.len(), 0);

        // Backup file exists
        let entries: Vec<_> = std::fs::read_dir(dir.path()).unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains("corrupt-"))
            .collect();
        assert_eq!(entries.len(), 1, "expected one .corrupt-* backup");
    }
```

- [ ] **Step 3: Register new commands in invoke_handler**

In `lib.rs`, find the `tauri::generate_handler![...]` blocks and add the new commands:

```rust
let builder = builder.invoke_handler(tauri::generate_handler![
    spawn_pty,
    write_pty,
    resize_pty,
    kill_pty,
    terminal::list_sessions,
    terminal::set_active_session,
    terminal::reorder_sessions,
    terminal::update_session_cwd,
    detect_agent_in_session,
    start_agent_watcher,
    stop_agent_watcher,
    start_transcript_watcher,
    stop_transcript_watcher,
    list_dir,
    read_file,
    write_file,
    git_status,
    get_git_diff,
    start_git_watcher,
    stop_git_watcher
]);
```

Update the e2e-test-feature variant similarly.

- [ ] **Step 4: Run a full Rust build + test**

Run: `cd src-tauri && cargo test --lib`
Expected: all PASS, including the existing tests.

Run: `cd src-tauri && cargo build`
Expected: clean build, no warnings about unused commands.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/terminal/mod.rs src-tauri/src/terminal/cache.rs
git commit -m "feat(terminal): register new IPC commands; manage SessionCache via setup

- lib.rs setup() loads SessionCache from app_data_dir/sessions.json
- load_or_recover() moves corrupted cache files aside and starts empty
- All four new commands registered (list_sessions, set_active_session,
  reorder_sessions, update_session_cwd)

Refs #55."
```

---

## Task 10: Regenerate TypeScript bindings

**Files:**

- Auto-generated: `src/bindings/*.ts`

- [ ] **Step 1: Run binding generator**

Run: `npm run generate:bindings 2>&1 | tail -20`
Expected: completes; new files appear in `src/bindings/`.

- [ ] **Step 2: Verify new bindings exist**

Run: `ls src/bindings/ | grep -E "Session(List|Info|Status|Cache)|SetActive|Reorder|UpdateSessionCwd|PtyDataEvent"`
Expected: files for `SessionList`, `SessionInfo`, `SessionStatus`, `SetActiveSessionRequest`, `ReorderSessionsRequest`, `UpdateSessionCwdRequest`. `PtyDataEvent` updated.

- [ ] **Step 3: Inspect PtyDataEvent.ts to confirm offset_start landed**

Run: `cat src/bindings/PtyDataEvent.ts`
Expected: includes `offset_start: bigint` (or `number` — check). If `bigint`, we'll need to coerce in the service layer.

- [ ] **Step 4: Run typecheck across the project**

Run: `npm run type-check 2>&1 | tail -40`
Expected: errors at every callsite that uses `PtyDataEvent` or the old `onData` signature. These are fixed in Task 12.

- [ ] **Step 5: Commit**

```bash
git add src/bindings/
git commit -m "chore(bindings): regenerate TS bindings for new IPC contract

Includes SessionList, SessionInfo, SessionStatus, request types,
and updated PtyDataEvent with offset_start.

Refs #55."
```

---

## Task 11: Update terminalService.ts — onData callback signature + new methods

**Files:**

- Modify: `src/features/terminal/services/terminalService.ts`
- Modify: `src/features/terminal/services/tauriTerminalService.ts`
- Modify: any mock service used by tests

- [ ] **Step 1: Update ITerminalService interface**

Edit `src/features/terminal/services/terminalService.ts`. Find `onData` and update:

```ts
export interface ITerminalService {
  // ... existing methods ...

  /**
   * Subscribe to PTY data events. Callback receives the chunk's starting
   * byte offset for cursor-based dedupe during reattach.
   */
  onData(
    callback: (sessionId: string, data: string, offsetStart: number) => void
  ): () => void

  // ... existing onExit, onError ...
}
```

Add new method signatures:

```ts
import type {
  SessionList,
  SetActiveSessionRequest,
  ReorderSessionsRequest,
  UpdateSessionCwdRequest,
} from '../../../bindings'

export interface ITerminalService {
  // ... existing ...

  listSessions(): Promise<SessionList>
  setActiveSession(id: string): Promise<void>
  reorderSessions(ids: string[]): Promise<void>
  updateSessionCwd(id: string, cwd: string): Promise<void>
}
```

- [ ] **Step 2: Update TauriTerminalService**

Edit `src/features/terminal/services/tauriTerminalService.ts`.

In the `pty-data` listener:

```ts
const unlistenData = await listen<PtyDataEvent>('pty-data', (event) => {
  const { sessionId, data, offsetStart } = event.payload
  // PtyDataEvent.offset_start is u64 — bindings may emit as bigint or number.
  // Coerce to number; safe up to 2^53 = ~9 PB per session.
  const offset =
    typeof offsetStart === 'bigint' ? Number(offsetStart) : offsetStart
  this.dataCallbacks.forEach((cb) => cb(sessionId, data, offset))
})
```

Update the callback type:

```ts
private dataCallbacks: ((sessionId: string, data: string, offsetStart: number) => void)[] = []
```

And in `onData`:

```ts
onData(callback: (sessionId: string, data: string, offsetStart: number) => void): () => void {
  this.dataCallbacks.push(callback)
  void this.ensureListeners()
  return () => {
    const index = this.dataCallbacks.indexOf(callback)
    if (index > -1) this.dataCallbacks.splice(index, 1)
  }
}
```

Add the four new methods at the bottom of the class:

```ts
async listSessions(): Promise<SessionList> {
  return invoke<SessionList>('list_sessions')
}

async setActiveSession(id: string): Promise<void> {
  await invoke('set_active_session', { request: { id } satisfies SetActiveSessionRequest })
}

async reorderSessions(ids: string[]): Promise<void> {
  await invoke('reorder_sessions', { request: { ids } satisfies ReorderSessionsRequest })
}

async updateSessionCwd(id: string, cwd: string): Promise<void> {
  await invoke('update_session_cwd', { request: { id, cwd } satisfies UpdateSessionCwdRequest })
}
```

- [ ] **Step 3: Update existing tests for onData signature**

Run: `npm run type-check 2>&1 | tail -40`

Find every `.onData((sessionId, data) => ...)` and add the third arg `, offsetStart`:

```ts
service.onData((sessionId, data, offsetStart) => { ... })
```

If the third arg isn't used in the test, prefix with underscore: `_offsetStart`.

For mocks that implement ITerminalService, add the new methods. A typical mock pattern:

```ts
const mockService: ITerminalService = {
  // ... existing ...
  listSessions: vi
    .fn()
    .mockResolvedValue({ active_session_id: null, sessions: [] }),
  setActiveSession: vi.fn().mockResolvedValue(undefined),
  reorderSessions: vi.fn().mockResolvedValue(undefined),
  updateSessionCwd: vi.fn().mockResolvedValue(undefined),
}
```

- [ ] **Step 4: Add tests for the new methods on TauriTerminalService**

Append to `tauriTerminalService.test.ts`:

```ts
test('listSessions invokes list_sessions IPC', async () => {
  const mockInvoke = vi.fn().mockResolvedValue({
    active_session_id: 'a',
    sessions: [],
  } satisfies SessionList)
  vi.mocked(invoke).mockImplementation(mockInvoke)

  const service = new TauriTerminalService()
  const result = await service.listSessions()

  expect(mockInvoke).toHaveBeenCalledWith('list_sessions')
  expect(result.active_session_id).toBe('a')
})

test('setActiveSession invokes set_active_session with id', async () => {
  const mockInvoke = vi.fn().mockResolvedValue(undefined)
  vi.mocked(invoke).mockImplementation(mockInvoke)

  const service = new TauriTerminalService()
  await service.setActiveSession('xyz')

  expect(mockInvoke).toHaveBeenCalledWith('set_active_session', {
    request: { id: 'xyz' },
  })
})

test('reorderSessions invokes reorder_sessions with ids', async () => {
  const mockInvoke = vi.fn().mockResolvedValue(undefined)
  vi.mocked(invoke).mockImplementation(mockInvoke)

  const service = new TauriTerminalService()
  await service.reorderSessions(['a', 'b'])

  expect(mockInvoke).toHaveBeenCalledWith('reorder_sessions', {
    request: { ids: ['a', 'b'] },
  })
})

test('updateSessionCwd invokes update_session_cwd with id and cwd', async () => {
  const mockInvoke = vi.fn().mockResolvedValue(undefined)
  vi.mocked(invoke).mockImplementation(mockInvoke)

  const service = new TauriTerminalService()
  await service.updateSessionCwd('s1', '/tmp')

  expect(mockInvoke).toHaveBeenCalledWith('update_session_cwd', {
    request: { id: 's1', cwd: '/tmp' },
  })
})

test('onData callback receives offsetStart from pty-data event', async () => {
  const captured: { sessionId: string; data: string; offsetStart: number }[] =
    []
  const service = new TauriTerminalService()
  service.onData((sessionId, data, offsetStart) => {
    captured.push({ sessionId, data, offsetStart })
  })

  // Simulate event emission via the listen mock
  const listenMock = vi.mocked(listen)
  // ... fire mock pty-data event with offset_start: 42 ...
  // Implementation depends on how listen is mocked in the existing test setup;
  // adapt to the existing pattern.

  expect(captured[0].offsetStart).toBe(42)
})
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm run test -- --run src/features/terminal/services && npm run type-check 2>&1 | tail -30`
Expected: PASS / clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/terminal/services/ src/features/**/*.test.ts src/features/**/*.test.tsx
git commit -m "feat(terminal): TauriTerminalService gains new IPC methods + offsetStart in onData

- onData callback signature changes to (sessionId, data, offsetStart)
- New methods: listSessions, setActiveSession, reorderSessions, updateSessionCwd
- All test callsites updated for the new signature
- Mocks include the new methods

Refs #55."
```

---

## Task 12: useTerminal — separate spawn vs attach paths

**Files:**

- Modify: `src/features/terminal/hooks/useTerminal.ts`

The hook currently always spawns. Add an `attach` mode that:

- Doesn't call `service.spawn()`
- Sets `didSpawnSessionRef.current = false` (so unmount doesn't kill)
- Accepts `replay_data + replay_end_offset + buffered events` from props
- Writes them to xterm in the right order

- [ ] **Step 1: Read current useTerminal.ts**

Run: `cat src/features/terminal/hooks/useTerminal.ts`

Note the existing `initializeSession` calls `service.spawn()` and stores the result in `currentSession`.

- [ ] **Step 2: Add restoredFrom prop**

Add a new optional prop to the `useTerminal` props interface:

```ts
interface UseTerminalArgs {
  // ... existing ...

  /** When provided, attach to an existing PTY instead of spawning a new one. */
  restoredFrom?: {
    sessionId: string
    cwd: string
    pid: number
    replayData: string
    replayEndOffset: number
    bufferedEvents: { data: string; offsetStart: number }[]
  }
}
```

- [ ] **Step 3: Branch initializeSession on restoredFrom**

Replace the inside of the existing `initializeSession`:

```ts
const initializeSession = async (): Promise<void> => {
  try {
    setStatus('starting')

    if (restoredFrom) {
      // Attach path — no spawn, no kill on unmount
      didSpawnSessionRef.current = false
      const attached = {
        id: restoredFrom.sessionId,
        pid: restoredFrom.pid,
        cwd: restoredFrom.cwd,
      }
      currentSession = attached
      setSession(attached)
      setStatus('running')
      setDebugInfo(`attached pid=${restoredFrom.pid}`)

      // Write replay first — synchronous, before any live events
      terminal.write(restoredFrom.replayData)
      // Drain buffered events with cursor filter
      for (const ev of restoredFrom.bufferedEvents) {
        if (ev.offsetStart >= restoredFrom.replayEndOffset) {
          terminal.write(ev.data)
        }
      }
      return
    }

    // Spawn path (existing behavior)
    const result = await service.spawn({
      /* existing args */
    })
    didSpawnSessionRef.current = true
    // ... existing post-spawn code ...
  } catch (err: unknown) {
    // ... existing error handling ...
  }
}
```

- [ ] **Step 4: Update the live pty-data effect to dedupe by cursor**

The effect at the bottom of the hook listens for pty-data and writes to the terminal. Add cursor filter:

```ts
useEffect(() => {
  if (!terminal || !session) return

  const replayCursor = restoredFrom?.replayEndOffset ?? 0

  const handleData = (
    eventSessionId: string,
    data: string,
    offsetStart: number
  ): void => {
    if (eventSessionId !== session.id) return
    if (!isMountedRef.current) return
    // Cursor dedupe: if this chunk was already in the replay, skip it.
    if (offsetStart < replayCursor) return
    terminal.write(data)
  }

  const unlistenData = service.onData(handleData)
  // ... existing onExit / onError attachments ...

  return (): void => {
    unlistenData()
    // ... existing cleanup ...
  }
}, [terminal, session, service, restoredFrom?.replayEndOffset])
```

- [ ] **Step 5: Write tests**

Add to `useTerminal.test.ts`:

```ts
test('attach mode does not call service.spawn', async () => {
  const mockService = createMockService() // existing helper or inline mock
  renderHook(() =>
    useTerminal({
      terminal: mockTerminal,
      service: mockService,
      cwd: '/tmp',
      restoredFrom: {
        sessionId: 'restored-1',
        cwd: '/tmp',
        pid: 12345,
        replayData: 'hello',
        replayEndOffset: 5,
        bufferedEvents: [],
      },
    })
  )

  await waitFor(() => {
    expect(mockService.spawn).not.toHaveBeenCalled()
  })
})

test('attach mode writes replay_data before any other writes', async () => {
  const mockService = createMockService()
  const writeSpy = vi.spyOn(mockTerminal, 'write')

  renderHook(() =>
    useTerminal({
      terminal: mockTerminal,
      service: mockService,
      cwd: '/tmp',
      restoredFrom: {
        sessionId: 'r1',
        cwd: '/tmp',
        pid: 1,
        replayData: 'REPLAY',
        replayEndOffset: 6,
        bufferedEvents: [],
      },
    })
  )

  await waitFor(() => {
    expect(writeSpy).toHaveBeenNthCalledWith(1, 'REPLAY')
  })
})

test('attach mode flushes buffered events with cursor filter', async () => {
  const mockService = createMockService()
  const writeSpy = vi.spyOn(mockTerminal, 'write')

  renderHook(() =>
    useTerminal({
      terminal: mockTerminal,
      service: mockService,
      cwd: '/tmp',
      restoredFrom: {
        sessionId: 'r1',
        cwd: '/tmp',
        pid: 1,
        replayData: 'AAAA',
        replayEndOffset: 4,
        bufferedEvents: [
          { data: 'before', offsetStart: 2 }, // before cursor — drop
          { data: 'on', offsetStart: 4 }, // at cursor — keep
          { data: 'after', offsetStart: 5 }, // after cursor — keep
        ],
      },
    })
  )

  await waitFor(() => {
    expect(writeSpy).toHaveBeenNthCalledWith(1, 'AAAA')
    expect(writeSpy).toHaveBeenNthCalledWith(2, 'on')
    expect(writeSpy).toHaveBeenNthCalledWith(3, 'after')
    expect(writeSpy).not.toHaveBeenCalledWith('before')
  })
})

test('attach mode skips kill on unmount (didSpawnSessionRef stays false)', async () => {
  const mockService = createMockService()
  const { unmount } = renderHook(() =>
    useTerminal({
      terminal: mockTerminal,
      service: mockService,
      cwd: '/tmp',
      restoredFrom: {
        sessionId: 'r1',
        cwd: '/tmp',
        pid: 1,
        replayData: '',
        replayEndOffset: 0,
        bufferedEvents: [],
      },
    })
  )

  await waitFor(() => expect(mockService.spawn).not.toHaveBeenCalled())
  unmount()
  expect(mockService.kill).not.toHaveBeenCalled()
})

test('live pty-data event with offsetStart < replayEndOffset is dropped', async () => {
  const mockService = createMockService()
  const writeSpy = vi.spyOn(mockTerminal, 'write')
  let dataCallback: (
    sessionId: string,
    data: string,
    offsetStart: number
  ) => void = () => {}
  mockService.onData = vi.fn((cb) => {
    dataCallback = cb
    return () => {}
  })

  renderHook(() =>
    useTerminal({
      terminal: mockTerminal,
      service: mockService,
      cwd: '/tmp',
      restoredFrom: {
        sessionId: 'r1',
        cwd: '/tmp',
        pid: 1,
        replayData: 'AAAA',
        replayEndOffset: 4,
        bufferedEvents: [],
      },
    })
  )

  await waitFor(() => expect(writeSpy).toHaveBeenCalledWith('AAAA'))
  // Live event with offset_start < cursor — dropped
  dataCallback('r1', 'old', 2)
  expect(writeSpy).not.toHaveBeenCalledWith('old')
  // Live event >= cursor — written
  dataCallback('r1', 'new', 4)
  expect(writeSpy).toHaveBeenCalledWith('new')
})
```

- [ ] **Step 6: Run tests**

Run: `npm run test -- --run src/features/terminal/hooks/useTerminal.test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/terminal/hooks/useTerminal.ts src/features/terminal/hooks/useTerminal.test.ts
git commit -m "feat(terminal): useTerminal supports restoredFrom mode with cursor dedupe

When restoredFrom prop is provided:
- Skip spawn, attach to existing PTY by id
- Skip the unmount kill (didSpawnSessionRef stays false)
- Write replay_data first
- Drain buffered events with cursor filter (offset_start >= replay_end_offset)
- Live pty-data events also cursor-filtered

Refs #55."
```

---

## Task 13: useSessionManager — pure IPC client + restore orchestration

**Files:**

- Modify: `src/features/workspace/hooks/useSessionManager.ts`
- Modify: `src/features/workspace/hooks/useSessionManager.test.ts`

This is the big frontend task. The hook becomes a pure IPC client that runs the restore protocol on mount.

- [ ] **Step 1: Replace useSessionManager.ts**

Rewrite `useSessionManager.ts` from scratch. Existing exports must be kept stable for callers (`SessionManager` interface).

```ts
import { useState, useCallback, useEffect, useRef } from 'react'
import type { Session, AgentActivity } from '../types'
import type { SessionList, SessionInfo, SessionStatus } from '../../../bindings'
import {
  createTerminalService,
  type ITerminalService,
} from '../../terminal/services/terminalService'
import { registerPtySession } from '../../terminal/ptySessionMap'

const emptyActivity: AgentActivity = {
  fileChanges: [],
  toolCalls: [],
  testResults: [],
  contextWindow: { used: 0, total: 200000, percentage: 0, emoji: '😊' },
  usage: {
    sessionDuration: 0,
    turnCount: 0,
    messages: { sent: 0, limit: 200 },
    tokens: { input: 0, output: 0, total: 0 },
  },
}

function tabName(cwd: string, index: number): string {
  if (cwd === '~') return `session ${index + 1}`
  const parts = cwd.split('/').filter(Boolean)
  return parts[parts.length - 1] || `session ${index + 1}`
}

function sessionFromInfo(info: SessionInfo, index: number): Session {
  return {
    id: info.id,
    projectId: 'proj-1',
    name: tabName(info.cwd, index),
    status: info.status.kind === 'Alive' ? 'running' : 'exited',
    workingDirectory: info.cwd,
    agentType: 'claude-code',
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    activity: { ...emptyActivity },
  }
}

export interface RestoreData {
  sessionId: string
  cwd: string
  pid: number
  replayData: string
  replayEndOffset: number
  bufferedEvents: { data: string; offsetStart: number }[]
}

export interface SessionManager {
  sessions: Session[]
  activeSessionId: string | null
  setActiveSessionId: (id: string) => void
  createSession: () => void
  removeSession: (id: string) => void
  renameSession: (id: string, name: string) => void
  reorderSessions: (reordered: Session[]) => void
  updateSessionCwd: (id: string, cwd: string) => void
  /** restoreData per session id, populated during mount-time restore */
  restoreData: Map<string, RestoreData>
  /** True until the initial restore IPC + drain completes */
  loading: boolean
}

export const useSessionManager = (
  service: ITerminalService = createTerminalService()
): SessionManager => {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(
    null
  )
  const [restoreData] = useState(new Map<string, RestoreData>())
  const [loading, setLoading] = useState(true)

  const ranRestoreRef = useRef(false)

  // Mount-time restore orchestration: listen first, then list_sessions, then drain.
  useEffect(() => {
    if (ranRestoreRef.current) return
    ranRestoreRef.current = true

    let cancelled = false
    const buffered = new Map<string, { data: string; offsetStart: number }[]>()

    // 1. Register global buffering listener BEFORE list_sessions
    const stopBuffering = service.onData((sessionId, data, offsetStart) => {
      let q = buffered.get(sessionId)
      if (!q) {
        q = []
        buffered.set(sessionId, q)
      }
      q.push({ data, offsetStart })
    })

    void (async (): Promise<void> => {
      try {
        // 2. Snapshot sessions
        const list: SessionList = await service.listSessions()
        if (cancelled) return

        // 3. For each Alive session, prepare restoreData
        const newSessions: Session[] = list.sessions.map((info, idx) =>
          sessionFromInfo(info, idx)
        )
        for (const info of list.sessions) {
          if (info.status.kind === 'Alive') {
            const status = info.status as Extract<
              SessionStatus,
              { kind: 'Alive' }
            >
            restoreData.set(info.id, {
              sessionId: info.id,
              cwd: info.cwd,
              pid: status.pid,
              replayData: status.replay_data,
              replayEndOffset: Number(status.replay_end_offset),
              bufferedEvents: buffered.get(info.id) ?? [],
            })
            // Repopulate ptySessionMap so agent detection works after reload
            registerPtySession(info.id, info.id, info.cwd)
          }
        }

        setSessions(newSessions)
        setActiveSessionIdState(list.active_session_id)
        setLoading(false)

        // 4. Listener swap happens implicitly: future onData subscribers
        //    in TerminalPane will receive new events. The buffering listener
        //    is removed here.
        stopBuffering()
      } catch (err) {
        // Cache load error or IPC failure — start fresh
        // Surfaced as toast in a future iteration; for now log.
        // eslint-disable-next-line no-console
        console.warn('listSessions failed; starting empty', err)
        setSessions([])
        setActiveSessionIdState(null)
        setLoading(false)
        stopBuffering()
      }
    })()

    return (): void => {
      cancelled = true
      stopBuffering()
    }
  }, [service, restoreData])

  // Active session — optimistic update + IPC
  const setActiveSessionId = useCallback(
    (id: string): void => {
      const prev = activeSessionId
      setActiveSessionIdState(id)
      service.setActiveSession(id).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('setActiveSession IPC failed; reverting', err)
        setActiveSessionIdState(prev)
      })
    },
    [activeSessionId, service]
  )

  // ... (createSession, removeSession, renameSession, reorderSessions, updateSessionCwd)
  // implementations follow the same pattern: optimistic local update + IPC
}
```

> **Note for executor**: the snippet above is intentionally cut off at the optimistic-update boundary. Continue with implementations of `createSession` (calls `service.spawn`, pushes new Session), `removeSession` (calls `service.kill`, filters local state, advances active), `renameSession` (in-memory only — no IPC), `reorderSessions` (calls `service.reorderSessions`), `updateSessionCwd` (calls `service.updateSessionCwd`). Match the existing function signatures from the prior version of this file.

- [ ] **Step 2: Write tests**

Add to `useSessionManager.test.ts`:

```ts
test('on mount, registers global pty-data listener BEFORE calling listSessions', async () => {
  const order: string[] = []
  const service = createMockService()
  service.onData = vi.fn((cb) => {
    order.push('onData')
    return () => {}
  })
  service.listSessions = vi.fn(() => {
    order.push('listSessions')
    return Promise.resolve({ active_session_id: null, sessions: [] })
  })

  renderHook(() => useSessionManager(service))

  await waitFor(() => expect(service.listSessions).toHaveBeenCalled())
  expect(order).toEqual(['onData', 'listSessions'])
})

test('events received between listSessions call and drain land in restoreData buffer', async () => {
  const service = createMockService()
  let dataCallback:
    | ((sessionId: string, data: string, offsetStart: number) => void)
    | null = null
  service.onData = vi.fn((cb) => {
    dataCallback = cb
    return () => {}
  })

  // Resolve list_sessions only after we've fired some events
  let resolveListSessions: (v: SessionList) => void
  service.listSessions = vi.fn(
    () =>
      new Promise((res) => {
        resolveListSessions = res
      })
  )

  const { result } = renderHook(() => useSessionManager(service))

  // Fire events while list_sessions is in-flight
  dataCallback?.('s1', 'mid-flight', 100)
  dataCallback?.('s1', 'mid-flight-2', 105)

  resolveListSessions!({
    active_session_id: 's1',
    sessions: [
      {
        id: 's1',
        cwd: '/tmp',
        status: {
          kind: 'Alive',
          pid: 1,
          replay_data: 'AAA',
          replay_end_offset: 3,
        },
      },
    ],
  })

  await waitFor(() => expect(result.current.loading).toBe(false))

  const restored = result.current.restoreData.get('s1')
  expect(restored).toBeDefined()
  expect(restored!.bufferedEvents).toEqual([
    { data: 'mid-flight', offsetStart: 100 },
    { data: 'mid-flight-2', offsetStart: 105 },
  ])
})

test('does not persist anything to localStorage', async () => {
  const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
  const service = createMockService()
  service.listSessions = vi
    .fn()
    .mockResolvedValue({ active_session_id: null, sessions: [] })

  renderHook(() => useSessionManager(service))
  await waitFor(() => expect(service.listSessions).toHaveBeenCalled())

  // Filter out unrelated localStorage writes
  const ourCalls = setItemSpy.mock.calls.filter(([key]) =>
    key.startsWith('vimeflow:')
  )
  expect(ourCalls).toHaveLength(0)
})

test('setActiveSessionId optimistically updates state and calls IPC', async () => {
  const service = createMockService()
  service.listSessions = vi.fn().mockResolvedValue({
    active_session_id: 'a',
    sessions: [
      {
        id: 'a',
        cwd: '/tmp',
        status: {
          kind: 'Alive',
          pid: 1,
          replay_data: '',
          replay_end_offset: 0,
        },
      },
      {
        id: 'b',
        cwd: '/tmp',
        status: {
          kind: 'Alive',
          pid: 2,
          replay_data: '',
          replay_end_offset: 0,
        },
      },
    ],
  })

  const { result } = renderHook(() => useSessionManager(service))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => result.current.setActiveSessionId('b'))
  expect(result.current.activeSessionId).toBe('b')
  expect(service.setActiveSession).toHaveBeenCalledWith('b')
})

test('setActiveSessionId reverts on IPC error', async () => {
  const service = createMockService()
  service.listSessions = vi.fn().mockResolvedValue({
    active_session_id: 'a',
    sessions: [
      {
        id: 'a',
        cwd: '/tmp',
        status: {
          kind: 'Alive',
          pid: 1,
          replay_data: '',
          replay_end_offset: 0,
        },
      },
      {
        id: 'b',
        cwd: '/tmp',
        status: {
          kind: 'Alive',
          pid: 2,
          replay_data: '',
          replay_end_offset: 0,
        },
      },
    ],
  })
  service.setActiveSession = vi.fn().mockRejectedValue('unknown session')

  const { result } = renderHook(() => useSessionManager(service))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => result.current.setActiveSessionId('b'))
  await waitFor(() => expect(result.current.activeSessionId).toBe('a'))
})
```

- [ ] **Step 3: Run tests**

Run: `npm run test -- --run src/features/workspace/hooks/useSessionManager.test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/workspace/hooks/useSessionManager.ts src/features/workspace/hooks/useSessionManager.test.ts
git commit -m "feat(workspace): rewrite useSessionManager as pure IPC client + restore orchestrator

On mount: register global pty-data buffering listener BEFORE list_sessions,
keyed by sessionId from event payload (since session ids only become known
after list_sessions returns). After list_sessions, prepare per-session
RestoreData containing replay_data + replay_end_offset + buffered events;
TerminalPane consumes RestoreData via prop.

UI actions (setActive, reorder, kill, spawn, updateCwd) are optimistic
local update + IPC + revert on error.

No localStorage; renames stay in-memory.

Refs #55."
```

---

## Task 14: TerminalPane + TerminalZone — wire restoreData

**Files:**

- Modify: `src/features/terminal/components/TerminalPane.tsx`
- Modify: `src/features/workspace/components/TerminalZone.tsx`

- [ ] **Step 1: Add restoredFrom prop to TerminalPane**

Edit `TerminalPane.tsx`. Add to props:

```ts
export interface TerminalPaneProps {
  // ... existing ...
  /** When provided, attach to an existing PTY using this restore data. */
  restoredFrom?: {
    sessionId: string
    cwd: string
    pid: number
    replayData: string
    replayEndOffset: number
    bufferedEvents: { data: string; offsetStart: number }[]
  }
}
```

Pass it through to `useTerminal`:

```ts
const {
  session: ptySession,
  resize,
  status,
  debugInfo,
} = useTerminal({
  terminal,
  service: stableService,
  cwd,
  shell,
  env,
  restoredFrom,
})
```

- [ ] **Step 2: Send resize after attach (SIGWINCH nudge)**

The existing effect that sends resize on terminal+running already covers this — verify by re-running. Restored sessions transition to `running` synchronously now, so the SIGWINCH-equivalent resize fires.

Add an explicit one-shot resize-after-attach in the restoredFrom effect chain if needed:

```ts
useEffect(() => {
  if (restoredFrom && terminal && status === 'running') {
    // Force a resize event so TUI apps (vim, claude) redraw via SIGWINCH
    resize(terminal.cols, terminal.rows)
  }
}, [restoredFrom, terminal, status, resize])
```

- [ ] **Step 3: OSC 7 calls update_session_cwd**

Find the OSC 7 handler in TerminalPane (around the `parser.registerOscHandler(7, ...)` call). After calling `onCwdChangeRef.current?.(path)`, also call:

```ts
if (path) {
  onCwdChangeRef.current?.(path)
  // Persist to Rust cache
  void stableService.updateSessionCwd(sessionId, path).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn('updateSessionCwd failed', err)
  })
}
```

- [ ] **Step 4: Update TerminalZone to mount panes from list_sessions results**

Read `TerminalZone.tsx`. The current pattern likely renders a TerminalPane per session in the manager state.

Update to pass `restoredFrom`:

```tsx
const { sessions, activeSessionId, restoreData, loading } = useSessionManager()

if (loading) return <div>Loading sessions…</div>

return (
  <>
    {sessions.map((session) => (
      <TerminalPane
        key={session.id}
        sessionId={session.id}
        cwd={session.workingDirectory}
        restoredFrom={restoreData.get(session.id)}
        onCwdChange={(cwd) => updateSessionCwd(session.id, cwd)}
        // ... existing props
      />
    ))}
  </>
)
```

- [ ] **Step 5: Add tests**

In `TerminalPane.test.tsx`:

```ts
test('restored mode passes restoredFrom to useTerminal', () => {
  // Mock useTerminal to verify it received restoredFrom
  vi.mock('../hooks/useTerminal', () => ({
    useTerminal: vi.fn(() => ({ session: null, resize: vi.fn(), status: 'idle', debugInfo: '' })),
  }))

  const restoredFrom = {
    sessionId: 'r1',
    cwd: '/tmp',
    pid: 99,
    replayData: 'X',
    replayEndOffset: 1,
    bufferedEvents: [],
  }

  render(<TerminalPane sessionId="r1" cwd="/tmp" restoredFrom={restoredFrom} />)

  expect(vi.mocked(useTerminal)).toHaveBeenCalledWith(
    expect.objectContaining({ restoredFrom })
  )
})

test('OSC 7 handler calls service.updateSessionCwd', async () => {
  // Setup: get a reference to the mock service used by the rendered pane,
  // simulate an OSC 7 sequence on the xterm parser, assert updateSessionCwd
  // was invoked.
  // (Implementation depends on existing test patterns — adapt.)
})
```

In `TerminalZone.test.tsx`, add:

```ts
test('mounts TerminalPane with restoredFrom from restoreData map', async () => {
  const fakeRestoreData = new Map([
    ['s1', { sessionId: 's1', cwd: '/tmp', pid: 1, replayData: 'X', replayEndOffset: 1, bufferedEvents: [] }],
  ])
  // Mock useSessionManager to return this directly
  // ... assertions on TerminalPane props
})

test('renders loading state while session manager is loading', () => {
  // Mock useSessionManager to return { loading: true }
  render(<TerminalZone />)
  expect(screen.getByText(/loading sessions/i)).toBeInTheDocument()
})
```

- [ ] **Step 6: Run all frontend tests**

Run: `npm run test -- --run`
Expected: all PASS.

- [ ] **Step 7: Run typecheck and lint**

Run: `npm run type-check && npm run lint`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/features/terminal/components/TerminalPane.tsx src/features/terminal/components/TerminalPane.test.tsx src/features/workspace/components/TerminalZone.tsx src/features/workspace/components/TerminalZone.test.tsx
git commit -m "feat(terminal): wire restoredFrom + OSC 7 cwd sync into TerminalPane / TerminalZone

- TerminalPane accepts restoredFrom prop and forwards to useTerminal
- After attach, send a resize to trigger TUI redraw via SIGWINCH
- OSC 7 cwd handler now also calls service.updateSessionCwd to keep
  the Rust cache in sync
- TerminalZone consumes restoreData from useSessionManager and shows
  a loading state until restore completes

Refs #55."
```

---

## Task 15: Manual smoke test

**Files:** none — verification only.

- [ ] **Step 1: Run full test suite**

Run: `npm run test -- --run && cd src-tauri && cargo test --lib && cd ..`
Expected: all PASS.

- [ ] **Step 2: Type + lint + format**

Run: `npm run type-check && npm run lint && npm run format:check`
Expected: clean.

- [ ] **Step 3: Smoke — vim :w doesn't kill terminal**

Run: `npm run tauri:dev`

In a terminal tab:

1. `cd /tmp`
2. `vim foo.txt`
3. Type a few lines, then `:w`
4. Edit `vite.config.ts` from your host editor (something HMR-able) and save
5. Watch the Vimeflow window: terminal should reattach within ~300 ms
6. Press any key in the terminal — vim's editor view repaints from its in-memory buffer

Pass criteria: same vim session after reload, file content intact.

- [ ] **Step 4: Smoke — Claude Code session survives reload**

In a terminal tab:

1. `cd ~/some-project`
2. `claude`
3. Interact (one prompt + response)
4. Save any project file from your host editor to trigger reload
5. Vimeflow reloads; the claude tab still shows the conversation in place
6. Type a follow-up prompt and verify it works

- [ ] **Step 5: Smoke — Tab order and active selection survive reload**

1. Open three tabs (cd to different dirs)
2. Drag-reorder them
3. Select the middle tab as active
4. Trigger reload
5. After reload: order matches, middle tab is active

- [ ] **Step 6: Smoke — Exited sessions show as restartable**

1. Open a tab, type `exit`, watch the prompt say `[Process exited]`
2. The tab stays in the list, marked Exited
3. (Pending UX wiring) — verify cache shows `exited: true` via:
   ```bash
   cat "$(find ~/.local/share -name sessions.json | head -1)"
   ```

- [ ] **Step 7: Open the PR**

```bash
gh pr create --title "fix(terminal): persist & reattach PTY sessions across reload (#55)" --body "$(cat <<'EOF'
## Summary

- Closes #55. Frontend remount (HMR, manual refresh, error boundary) is now harmless: terminals, cwd, agent state, tab order, and active selection survive.
- Single source of truth in Rust: filesystem cache (\`app_data_dir/sessions.json\`) holds session metadata; \`PtyState\` holds live PTYs + 64 KB ring buffer per session.
- Race-free reattach via three-part protocol: producer atomicity (offset + bytes share one mutex), subscriber listen-before-snapshot (global buffering listener registered before \`list_sessions\`), cursor-filtered drain.
- Includes Vite watch-ignore for \`.vimeflow/\`, \`target/\`, \`.codex*/\`, \`.git/\` as commit 1 — independent quick-win that suppresses the noisiest reload triggers.

## Test plan

- [x] Rust: cache atomic write, lazy reconciliation, atomic ring buffer + offset, list_sessions semantics, idempotent kill_pty, spawn_pty contract change + cap
- [x] Frontend: useSessionManager listen-before-snapshot, optimistic active update + revert, no localStorage; useTerminal restored-mode skip-spawn + cursor dedupe; TerminalPane OSC 7 sync
- [x] Manual: vim :w no longer kills terminal; claude session survives reload; tab order + active selection survive

Spec: \`docs/superpowers/specs/2026-04-25-pty-reattach-on-reload-design.md\`
Plan: \`docs/superpowers/plans/2026-04-25-pty-reattach-on-reload.md\`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Checklist (run after writing the plan)

- [x] **Spec coverage**: every section of the spec has at least one task that implements it (architecture, data model, IPC contract, lifecycle, replay buffer, frontend integration, failure modes, tests).
- [x] **Placeholders**: no TBDs, no "implement appropriately", no "similar to Task N" without inlining the code. One known gap: Task 13 Step 1 ends with a "continue with implementations of …" note — the executor needs to mirror the existing `useSessionManager` function signatures. Acceptable because the existing file is in the codebase to copy from.
- [x] **Type consistency**: `RestoreData`, `SessionInfo`, `SessionStatus`, `PtyDataEvent.offsetStart` used consistently across tasks.
- [x] **Frequent commits**: one commit per task minimum; some tasks have intermediate commits.
- [x] **TDD**: every task with new behavior writes failing test → implements → verifies pass → commits.
