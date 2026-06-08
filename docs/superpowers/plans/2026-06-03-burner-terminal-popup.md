# Burner Terminal Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an ephemeral, throwaway per-pane "burner" terminal that opens as a centered popup (command-palette sibling), runs ad-hoc commands without hijacking a pane's agent PTY or consuming a layout slot, and is never persisted.

**Architecture:** A new `ephemeral` flag on the existing `spawn_pty` skips the `sessions.json` cache write and the agent-bridge dir; a per-`PtyState` ephemeral-id set + a `kill_ephemeral_ptys` reap IPC (called awaited on renderer boot) prevents reload-orphans. The frontend `useBurnerTerminals` hook owns burner PTY spawn/kill and renders the existing `<Body>` in **`attach` mode, kept mounted-hidden** so hide ≠ kill. Invoked by the `Mod+;` then `` ` `` chord.

**Tech Stack:** Rust (portable_pty, the `vimeflow-backend` Electron sidecar), React + TypeScript, xterm.js, Vitest, Rust `#[test]`.

**Spec:** `docs/superpowers/specs/2026-06-03-burner-terminal-popup-design.md` (committed + codex-reviewed). Section refs below (§N) point there.

**Scope of this plan:** PR1 is fully detailed (TDD, bite-sized). PR2 and PR3 are task-level outlines — their detailed, code-bearing plans are written after PR1 merges, once the real PR1 APIs exist and the spec's build-time questions (§5 OSC-7 wiring; §5 buffer-producer globality) are resolved. All three stack on the `feat/burner-terminal` integration branch; the final PR targets `main` (`Refs VIM-53` on child PRs, `Closes VIM-53` on the final).

---

## File Structure

**PR1 — backend (`crates/backend/`):**

- Modify `src/terminal/types.rs` — add `ephemeral: bool` to `SpawnPtyRequest` (`#[serde(default)]`).
- Modify `src/terminal/commands.rs` — gate the cache-write block (`:381-410`) and bridge-gen block (`:169-199`) on `!ephemeral`; add `kill_ephemeral_ptys_inner`.
- Modify `src/terminal/state.rs` (`PtyState`) — add an `ephemeral_ptys` id set, populated at spawn; method to drain+return it.
- Modify `src/terminal/mod.rs` — re-export / wire the new inner fn if the module pattern requires it.
- Modify `src/runtime/state.rs` — `BackendState::kill_ephemeral_ptys` method; extend `shutdown()` to call it.
- Modify `src/runtime/ipc.rs` — add the `"kill_ephemeral_ptys"` match arm.

**PR1 — frontend:**

- Modify `src/features/terminal/types/index.ts` — add `ephemeral?: boolean` to `PTYSpawnParams`.
- Modify `src/features/terminal/services/desktopTerminalService.ts` + `terminalService.ts` — default `ephemeral`, add `killEphemeralPtys()`.
- Modify `electron/backend-methods.ts` — allowlist `kill_ephemeral_ptys`.
- Create `src/features/terminal/hooks/useBurnerTerminals.ts` (+ `.test.ts`) — the state/lifecycle hook.
- Create `src/features/terminal/components/BurnerTerminalPopup/index.tsx` (+ `.test.tsx`) — the overlay + attach-mode `<Body>` host.
- Modify `src/features/workspace/WorkspaceView.tsx` — mount the popup's `renderNode`; call the awaited reap-on-boot.

**PR2/PR3:** enumerated in their outline sections below.

---

## PR1 — Backend ephemeral slice (land first), then per-session popup

> **Rust test conventions (read first).** The Cargo package is `vimeflow` (`crates/backend/Cargo.toml`); run backend tests with `cargo test --manifest-path crates/backend/Cargo.toml [name]`. Put each task's unit tests in a `#[cfg(test)] mod tests` block **in the source file it modifies** (`commands.rs`, `state.rs`, `ipc.rs` — all already have such blocks) — **not** in `terminal/test_commands.rs`, which is `#[cfg(feature = "e2e-test")]`-gated and won't run under default `cargo test`. After any change to a `#[derive(TS)]` Rust type (e.g. `SpawnPtyRequest`), run `npm run generate:bindings` (= `cargo test … export_bindings` + prettier) and commit the regenerated `src/bindings/*.ts`, or `npm run type-check` will fail when the new field is forwarded.

### Task 1: `ephemeral` flag skips the cache write

**Files:**

- Modify: `crates/backend/src/terminal/types.rs` (`SpawnPtyRequest`)
- Modify: `crates/backend/src/terminal/commands.rs` (`spawn_pty_inner`, cache block `:381-410`)
- Test: a `#[cfg(test)] mod tests` block in `crates/backend/src/terminal/commands.rs` (per the Rust test conventions above — not the e2e-gated `test_commands.rs`)

- [ ] **Step 1: Write the failing test — ephemeral spawn does not persist**

```rust
#[test]
fn ephemeral_spawn_is_absent_from_cache_and_list() {
    let (state, _tmp) = test_backend(); // existing helper that builds BackendState with a temp app_data_dir
    let req = SpawnPtyRequest {
        session_id: "burner-1".into(),
        cwd: tmp_cwd(),
        shell: None,
        env: None,
        enable_agent_bridge: false,
        ephemeral: true,
    };
    let res = state.spawn_pty(req).expect("spawn");
    // cache (sessions.json data) has no entry, and list_sessions omits it
    assert!(state.sessions.snapshot().sessions.get(&res.id).is_none());
    assert!(!state.sessions.snapshot().session_order.contains(&res.id));
    assert!(state.list_sessions().expect("list").iter().all(|s| s.id != res.id));
    // PTY is live: a write succeeds
    state.write_pty(&res.id, b"echo hi\n").expect("write");
}
```

- [ ] **Step 2: Run it, verify it fails to compile (no `ephemeral` field)**

Run: `cargo test --manifest-path crates/backend/Cargo.toml ephemeral_spawn_is_absent -- --nocapture`
Expected: compile error — `SpawnPtyRequest` has no field `ephemeral`.

- [ ] **Step 3: Add the field + gate the cache write**

In `types.rs`, add to `SpawnPtyRequest`:

```rust
#[serde(default)]
pub ephemeral: bool,
```

In `commands.rs` `spawn_pty_inner`, wrap the existing cache-write block (`:381-410`) so it is skipped when ephemeral:

```rust
if !request.ephemeral {
    // ... existing cache.mutate(...) insert + session_order.push + active_session_id block, unchanged ...
}
```

Then regenerate the TS binding for the changed `#[derive(TS)]` type:

```bash
npm run generate:bindings   # updates src/bindings/SpawnPtyRequest.ts (+ prettier)
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cargo test --manifest-path crates/backend/Cargo.toml ephemeral_spawn_is_absent -- --nocapture`
Expected: PASS.

- [ ] **Step 5: Add the regression guard — default still persists**

```rust
#[test]
fn non_ephemeral_spawn_still_persists() {
    let (state, _tmp) = test_backend();
    let res = state.spawn_pty(spawn_req("keep-1", /* ephemeral */ false)).unwrap();
    assert!(state.sessions.snapshot().sessions.get(&res.id).is_some());
}
```

Run: `cargo test --manifest-path crates/backend/Cargo.toml _spawn -- --nocapture` → both PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/backend/src/terminal/types.rs crates/backend/src/terminal/commands.rs src/bindings/SpawnPtyRequest.ts
git commit -m "feat(terminal): add ephemeral spawn flag that skips session cache"
```

> Note: adapt `test_backend()` / `spawn_req()` to the existing test helpers in the PTY test module (read `test_commands.rs` first; reuse its harness rather than inventing one). `snapshot()` = whatever read accessor the cache exposes; if none exists, assert via `list_sessions()` only.

### Task 2: `ephemeral` also forces no agent-bridge dir

**Files:**

- Modify: `crates/backend/src/terminal/commands.rs` (bridge block `:169-199`)
- Test: same test module

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn ephemeral_spawn_creates_no_bridge_dir_even_if_bridge_requested() {
    let (state, tmp) = test_backend();
    let mut req = spawn_req("burner-nb", true); // ephemeral
    req.enable_agent_bridge = true;              // deliberately conflicting
    let res = state.spawn_pty(req).unwrap();
    let bridge = tmp.path().join(".vimeflow").join("sessions").join(&res.id);
    assert!(!bridge.exists(), "ephemeral must not create a bridge dir");
}
```

- [ ] **Step 2: Run it, verify FAIL** (bridge dir is created today)

Run: `cargo test --manifest-path crates/backend/Cargo.toml ephemeral_spawn_creates_no_bridge -- --nocapture`
Expected: FAIL — the directory exists.

- [ ] **Step 3: Gate the bridge block on `!ephemeral`**

In `commands.rs`, the bridge-file generation (`:169-199`) becomes:

```rust
let (bridge_files, bridge_cleanup_dir) = if request.ephemeral || !request.enable_agent_bridge {
    (None, None)
} else {
    // ... existing bridge generation ...
};
```

- [ ] **Step 4: Run the test, verify PASS**

Run: `cargo test --manifest-path crates/backend/Cargo.toml ephemeral_spawn_creates_no_bridge -- --nocapture`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/backend/src/terminal/commands.rs crates/backend/src/terminal/test_commands.rs
git commit -m "feat(terminal): ephemeral spawn skips agent-bridge generation"
```

### Task 3: ephemeral-id set in `PtyState` + `kill_ephemeral_ptys_inner`

**Files:**

- Modify: `crates/backend/src/terminal/state.rs` (`PtyState`)
- Modify: `crates/backend/src/terminal/commands.rs` (record id at spawn; add `kill_ephemeral_ptys_inner`)
- Test: same test module

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn kill_ephemeral_ptys_kills_only_ephemeral() {
    let (state, _tmp) = test_backend();
    let keep = state.spawn_pty(spawn_req("keep", false)).unwrap();
    let burner = state.spawn_pty(spawn_req("burner", true)).unwrap();
    let killed = state.kill_ephemeral_ptys().unwrap();
    assert_eq!(killed, vec![burner.id.clone()]);
    assert!(state.write_pty(&burner.id, b"x").is_err(), "burner PTY gone");
    assert!(state.write_pty(&keep.id, b"x").is_ok(), "non-ephemeral untouched");
}
```

- [ ] **Step 2: Run it, verify it fails to compile** (`kill_ephemeral_ptys` missing)

Run: `cargo test --manifest-path crates/backend/Cargo.toml kill_ephemeral_ptys_kills_only -- --nocapture`
Expected: compile error.

- [ ] **Step 3: Add the set + recording + inner fn**

In `state.rs` `PtyState`, add a field (alongside the session map):

```rust
ephemeral_ptys: Mutex<HashSet<String>>,
```

In `commands.rs` `spawn_pty_inner`, right after the session is inserted into the live `PtyState` map and when `request.ephemeral`, record the id:

```rust
if request.ephemeral {
    state.ephemeral_ptys.lock().unwrap().insert(request.session_id.clone());
}
```

Add `kill_ephemeral_ptys_inner(state) -> Vec<String>`: drain the set, and for each id call the same kill path `kill_pty_inner` uses (kill child + remove from live map), returning the ids killed. Removing an already-absent id is a no-op.

- [ ] **Step 4: Run the test, verify PASS**

Run: `cargo test --manifest-path crates/backend/Cargo.toml kill_ephemeral_ptys_kills_only -- --nocapture`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/backend/src/terminal/state.rs crates/backend/src/terminal/commands.rs crates/backend/src/terminal/test_commands.rs
git commit -m "feat(terminal): track ephemeral ptyIds and add kill_ephemeral_ptys"
```

### Task 4: wire `kill_ephemeral_ptys` through the IPC router (all 4 layers)

**Files:**

- Modify: `crates/backend/src/terminal/mod.rs` (re-export if needed)
- Modify: `crates/backend/src/runtime/state.rs` (`BackendState::kill_ephemeral_ptys`)
- Modify: `crates/backend/src/runtime/ipc.rs` (match arm)
- Modify: `electron/backend-methods.ts` (allowlist)
- Test: an IPC-router-level test (drives the `"kill_ephemeral_ptys"` command string, NOT just the inner fn — per spec §10)

- [ ] **Step 1: Write the failing IPC-router test**

```rust
#[test]
fn ipc_kill_ephemeral_ptys_routes_to_inner() {
    let (state, _tmp) = test_backend();
    let burner = state.spawn_pty(spawn_req("burner", true)).unwrap();
    // drive through the same router the wire uses:
    let resp = dispatch_ipc(&state, "kill_ephemeral_ptys", json!({})); // existing router test helper
    assert!(resp.is_ok());
    assert!(state.write_pty(&burner.id, b"x").is_err());
}
```

- [ ] **Step 2: Run it, verify FAIL** (unknown command)

Run: `cargo test --manifest-path crates/backend/Cargo.toml ipc_kill_ephemeral_ptys_routes -- --nocapture`
Expected: FAIL — router returns unknown-method error.

- [ ] **Step 3: Add the method + match arm + allowlist**

`runtime/state.rs`:

```rust
pub fn kill_ephemeral_ptys(&self) -> Result<Vec<String>, BackendError> {
    terminal::commands::kill_ephemeral_ptys_inner(&self.pty_state)
}
```

`runtime/ipc.rs` — alongside the `"kill_pty"` arm:

```rust
"kill_ephemeral_ptys" => {
    let killed = state.kill_ephemeral_ptys()?;
    Ok(to_value(killed)?)
}
```

`electron/backend-methods.ts` — add `'kill_ephemeral_ptys'` to the allowed-methods set.

- [ ] **Step 4: Run the test, verify PASS**

Run: `cargo test --manifest-path crates/backend/Cargo.toml ipc_kill_ephemeral_ptys_routes -- --nocapture`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/backend/src/terminal/mod.rs crates/backend/src/runtime/state.rs crates/backend/src/runtime/ipc.rs electron/backend-methods.ts crates/backend/src/terminal/test_commands.rs
git commit -m "feat(terminal): expose kill_ephemeral_ptys over IPC"
```

> Reuse the existing `dispatch_ipc` / router test helper if one exists (grep the test module for how `kill_pty` is tested at the router level). If none exists, the minimal helper is whatever `ipc.rs` exposes as its command entrypoint.

### Task 5: `shutdown()` kills ephemerals (best-effort)

**Files:**

- Modify: `crates/backend/src/runtime/state.rs` (`shutdown`)
- Test: same router test module

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn shutdown_kills_ephemeral_ptys() {
    let (state, _tmp) = test_backend();
    let burner = state.spawn_pty(spawn_req("burner", true)).unwrap();
    state.shutdown();
    assert!(state.write_pty(&burner.id, b"x").is_err());
}
```

- [ ] **Step 2: Run it, verify FAIL** (`shutdown` only clears cache today)

Run: `cargo test --manifest-path crates/backend/Cargo.toml shutdown_kills_ephemeral -- --nocapture`
Expected: FAIL.

- [ ] **Step 3: Extend `shutdown()`**

```rust
pub fn shutdown(&self) {
    let _ = self.kill_ephemeral_ptys(); // best-effort; reap-on-boot is authoritative
    if let Err(err) = self.sessions.clear_all() {
        log::warn!("BackendState::shutdown: cache clear failed: {err}");
    }
}
```

- [ ] **Step 4: Run it, verify PASS**; then run the whole backend suite.

Run: `cargo test --manifest-path crates/backend/Cargo.toml -- --nocapture`
Expected: all PASS (watch the known pre-existing parallel flake `read_loop_eof_marks_cache_exited` — re-run single-threaded if it trips).

- [ ] **Step 5: Commit**

```bash
git add crates/backend/src/runtime/state.rs crates/backend/src/terminal/test_commands.rs
git commit -m "feat(terminal): kill ephemeral ptys on backend shutdown"
```

### Task 6: TS service — `ephemeral` param + `killEphemeralPtys()`

**Files:**

- Modify: `src/features/terminal/types/index.ts` (`PTYSpawnParams`)
- Modify: `src/features/terminal/services/terminalService.ts` (`ITerminalService`)
- Modify: `src/features/terminal/services/desktopTerminalService.ts`
- Test: `src/features/terminal/services/desktopTerminalService.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect, vi } from 'vitest'

test('spawn forwards ephemeral and defaults it to false', async () => {
  const invoke = vi.fn().mockResolvedValue({ id: 'p', pid: 1, cwd: '/x' })
  const svc = new DesktopTerminalService(invoke)
  await svc.spawn({ cwd: '/x', ephemeral: true })
  expect(invoke).toHaveBeenCalledWith('spawn_pty', {
    request: expect.objectContaining({ ephemeral: true }),
  })
  await svc.spawn({ cwd: '/x' })
  expect(invoke).toHaveBeenLastCalledWith('spawn_pty', {
    request: expect.objectContaining({ ephemeral: false }),
  })
})

test('killEphemeralPtys invokes the IPC', async () => {
  const invoke = vi.fn().mockResolvedValue([])
  await new DesktopTerminalService(invoke).killEphemeralPtys()
  expect(invoke).toHaveBeenCalledWith('kill_ephemeral_ptys', {})
})
```

- [ ] **Step 2: Run it, verify FAIL**

Run: `npx vitest run src/features/terminal/services/desktopTerminalService.test.ts`
Expected: FAIL — `ephemeral` not forwarded / `killEphemeralPtys` missing. (Adapt the constructor/invoke-injection to how the existing test instantiates the service.)

- [ ] **Step 3: Implement**

- `types/index.ts`: add `ephemeral?: boolean` to `PTYSpawnParams`.
- `desktopTerminalService.ts` `spawn`: include `ephemeral: params.ephemeral ?? false` in the request (next to `enableAgentBridge`); add `killEphemeralPtys(): Promise<string[]>` → `invoke('kill_ephemeral_ptys', {})`.
- `terminalService.ts`: add `killEphemeralPtys(): Promise<string[]>` to `ITerminalService`.

- [ ] **Step 4: Run it, verify PASS**

Run: `npx vitest run src/features/terminal/services/desktopTerminalService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/terminal/types/index.ts src/features/terminal/services/terminalService.ts src/features/terminal/services/desktopTerminalService.ts src/features/terminal/services/desktopTerminalService.test.ts
git commit -m "feat(terminal): service support for ephemeral spawn + killEphemeralPtys"
```

### Task 7: `useBurnerTerminals` — spawn (ephemeral) + ref map + runningByPane

**Files:**

- Create: `src/features/terminal/hooks/useBurnerTerminals.ts`
- Test: `src/features/terminal/hooks/useBurnerTerminals.test.ts`

- [ ] **Step 1: Write the failing test (spawn params + lifecycle ownership)**

```ts
import { test, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBurnerTerminals } from './useBurnerTerminals'

test('open spawns an ephemeral, no-bridge shell at the session workingDirectory', async () => {
  const service = makeFakeService() // spawn → { sessionId: 'burner-pty', pid: 1, cwd: '/repo' }
  const focused = {
    session: { id: 's1', workingDirectory: '/repo' },
    pane: { id: 'p0', ptyId: 'main', cwd: '/repo' },
  }
  const { result } = renderHook(() =>
    useBurnerTerminals({
      service,
      resolveFocusedPane: () => focused,
      sessions: [focused.session],
    })
  )
  await act(async () => {
    await result.current.toggle()
  })
  expect(service.spawn).toHaveBeenCalledWith(
    expect.objectContaining({
      cwd: '/repo',
      ephemeral: true,
      enableAgentBridge: false,
    })
  )
  expect([...result.current.running.keys()]).toEqual(['s1']) // PR1 keys by session; PR2 generalizes to `${sessionId}:${paneId}`
})

test('hide does NOT kill', async () => {
  const service = makeFakeService()
  const { result } = renderHook(() =>
    useBurnerTerminals({
      service,
      resolveFocusedPane: () => focused(),
      sessions: [sess()],
    })
  )
  await act(async () => {
    await result.current.toggle()
  }) // open
  await act(async () => {
    await result.current.toggle()
  }) // hide
  expect(service.kill).not.toHaveBeenCalled()
})

test('renderNode stays mounted (non-null) when hidden while a shell is alive', async () => {
  const service = makeFakeService()
  const { result } = renderHook(() =>
    useBurnerTerminals({
      service,
      resolveFocusedPane: () => focused(),
      sessions: [sess()],
    })
  )
  await act(async () => {
    await result.current.toggle()
  }) // open → spawns
  await act(async () => {
    await result.current.toggle()
  }) // hide
  expect(result.current.renderNode).not.toBeNull() // keep-mounted (spec §5): hide != unmount
})
```

- [ ] **Step 2: Run it, verify FAIL** (module missing)

Run: `npx vitest run src/features/terminal/hooks/useBurnerTerminals.test.ts`
Expected: FAIL — cannot find `useBurnerTerminals`.

- [ ] **Step 3: Implement the hook skeleton**

PR1 is **session-scoped** (spec §9): one burner shell per session, keyed by `sessionId` (PR2 generalizes the key to `${sessionId}:${paneId}` and renames the projection to `runningByPane`, spec §4/§6). `toggle()` lazily `service.spawn({ cwd: session.workingDirectory, ephemeral: true, enableAgentBridge: false })`, stores `{ burnerPtyId, pid, status: 'running', cwd }` in a `useRef<Map<string, BurnerEntry>>`, and flips popup visibility; `running` is a `useState`-mirrored projection; `renderNode` returns the popup (Task 8) and is **null only when no shell is alive** (otherwise kept mounted-hidden, spec §5). Hide flips visibility only — no `service.kill`.

- [ ] **Step 4: Run it, verify PASS**

Run: `npx vitest run src/features/terminal/hooks/useBurnerTerminals.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/terminal/hooks/useBurnerTerminals.ts src/features/terminal/hooks/useBurnerTerminals.test.ts
git commit -m "feat(terminal): useBurnerTerminals hook (ephemeral spawn, hide != kill)"
```

### Task 8: `BurnerTerminalPopup` — attach-mode `<Body>`, kept mounted-hidden

**Files:**

- Create: `src/features/terminal/components/BurnerTerminalPopup/index.tsx`
- Test: `src/features/terminal/components/BurnerTerminalPopup/index.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
import { test, expect } from 'vitest'
import { render } from '@testing-library/react'
import { BurnerTerminalPopup } from './index'

test('renders Body in attach mode for the burner ptyId', () => {
  const { getByTestId } = render(
    <BurnerTerminalPopup open burnerPtyId="burner-pty" /* ...props */ />
  )
  expect(getByTestId('burner-body')).toHaveAttribute('data-mode', 'attach')
})

test('stays mounted (hidden) when dismissed — not unmounted', () => {
  const { getByTestId, rerender } = render(
    <BurnerTerminalPopup open burnerPtyId="burner-pty" />
  )
  const node = getByTestId('burner-body')
  rerender(<BurnerTerminalPopup open={false} burnerPtyId="burner-pty" />)
  expect(getByTestId('burner-body')).toBe(node) // same node, still mounted
  expect(getByTestId('burner-popup')).toHaveAttribute('aria-hidden', 'true')
})
```

- [ ] **Step 2: Run it, verify FAIL**

Run: `npx vitest run src/features/terminal/components/BurnerTerminalPopup/index.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement the popup**

Per spec §5 + the handoff (`docs/design/burner-terminal-popup/burner-terminal-handoff/`): a `fixed inset-0` overlay with the Lens-Blur backdrop, a 760×600 glass panel, header (BURNER chip / cwd / hide ✕), the `<Body mode="attach" sessionId={burnerPtyId} restoredFrom={emptySnapshot} ...>` host, footer hints. Dismiss toggles `aria-hidden` / `display`, never unmounts. Lift exact tokens/structure from `Burner Terminal Popup.html`. Use Material Symbols only; pull colors from `docs/design/tokens.css` (amber `#f0c674`, mint `--success`).

- [ ] **Step 4: Run it, verify PASS**; render it in a browser to confirm the `terminal` Material Symbol ligature shows (per spec §10 ligature trap).

Run: `npx vitest run src/features/terminal/components/BurnerTerminalPopup/index.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/terminal/components/BurnerTerminalPopup/
git commit -m "feat(terminal): burner terminal popup (attach-mode, keep-mounted)"
```

### Task 9: spawn→attach buffer-drain (no lost prompt)

**Files:**

- Modify: `src/features/terminal/hooks/useBurnerTerminals.ts` (+ test)

- [ ] **Step 1: First resolve the build-time check (spec §5):** read `usePtyBufferDrain.ts` + its producer wiring; determine whether the `service.onData → bufferEvent` producer is global to all ptyIds. Record the answer in a code comment.
- [ ] **Step 2: Write the failing test** — assert `registerPending(burnerPtyId)` is called after `spawn()` and before the `<Body>` mounts, and that an early `pty-data` event is replayed via `notifyPaneReady` (mock the drain APIs).
- [ ] **Step 3: Implement** — if the producer is NOT global, attach a burner-owned `service.onData → bufferEvent` listener at spawn; call `registerPending` post-spawn; pass `notifyPaneReady` as the popup `<Body>`'s `onPaneReady`; `dropAllForPty` on kill.
- [ ] **Step 4: Run the test, verify PASS.**
- [ ] **Step 5: Commit** — `feat(terminal): buffer burner output across spawn→attach`.

### Task 10: `Mod+;` then `` ` `` chord (toggle)

**Files:**

- Modify: `src/features/terminal/hooks/useBurnerTerminals.ts` (register chord) (+ test)

- [ ] **Step 1: Write the failing test** — `registerChord` is called with key ``'`'``; firing the handler calls `toggle()` (mock `chordRegistry`).

```ts
test('registers the backtick chord and toggles on fire', () => {
  const reg = vi.spyOn(chordRegistry, 'registerChord')
  const { result } = renderHook(() => useBurnerTerminals(props()))
  const [key, handler] = reg.mock.calls[0]
  expect(key).toBe('`')
  const toggleSpy = vi.spyOn(result.current, 'toggle')
  act(() => {
    handler(new KeyboardEvent('keydown', { key: '`' }))
  })
  expect(toggleSpy).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run it, verify FAIL.**
- [ ] **Step 3: Implement** — `useEffect(() => registerChord('`', () => { toggle(); return true }), [])`, mirroring `usePaneRenameChord`. No palette suppression (spec §7).
- [ ] **Step 4: Run it, verify PASS.**
- [ ] **Step 5: Commit** — `feat(terminal): Mod+; backtick chord opens the burner popup`.

### Task 11: mount in WorkspaceView + awaited reap-on-boot + kill-on-session-close

**Files:**

- Modify: `src/features/workspace/WorkspaceView.tsx` (mount `renderNode`; await `killEphemeralPtys()` on init, gating first spawn)
- Modify: `src/features/terminal/hooks/useBurnerTerminals.ts` (kill on session close — minimal reconcile for PR1) (+ tests)

- [ ] **Step 1: Write the failing tests** — (a) `WorkspaceView` awaits `service.killEphemeralPtys()` on mount before the hook will spawn (gate flag); (b) closing the session calls `service.kill(burnerPtyId)` + `dropAllForPty`.
- [ ] **Step 2: Run them, verify FAIL.**
- [ ] **Step 3: Implement** — app-init effect `await service.killEphemeralPtys()` setting a `reapDone` flag the hook checks before spawning; on session-close, kill+drop the session's burner entry. Keep `WorkspaceView` lean — the hook returns a single `renderNode` (it's already over the 800-LOC cap, spec §risks).
- [ ] **Step 4: Run them, verify PASS;** then `npm run test`, `npm run lint`, `npm run type-check`.
- [ ] **Step 5: Commit** — `feat(workspace): mount burner popup + reap ephemeral ptys on boot`.

### Task 12: PR1 wrap-up

- [ ] Run the full gate: `npm run build && npm run test && npm run lint && cargo test --manifest-path crates/backend/Cargo.toml`.
- [ ] Manual (spec §10): start `npm run dev` in the burner popup → hide → confirm it keeps running → reopen sees output; `Cmd+R` reload → no orphan, no ghost tab.
- [ ] Open PR1 against `feat/burner-terminal` with `Refs VIM-53`; run codex verify; address findings via `/lifeline:upsource-review`.

---

## PR2 — one burner shell per pane (deferred follow-up plan)

**NOT executable from this document.** Its detailed, code-bearing TDD steps are authored after PR1 merges — gated on PR1's real APIs and the spec §5 build-time questions (OSC-7 wiring location; buffer-producer globality). Scope:

1. **Per-pane keying** — generalize the map key to `${sessionId}:${paneId}` for real (PR1 used the session); `toggle({ sessionId, paneId })` target (spec §4/§6). Tests: switch focused pane → different shell; ≤4 per session.
2. **Spawn at `Pane.cwd`** — change the spawn cwd from `session.workingDirectory` to the host `Pane.cwd` (spec §6). Test: spawn cwd = focused pane's cwd.
3. **cwd isolation** — ensure the burner `<Body>` does NOT wire `OSC 7 → updatePaneCwd` (resolve the spec §5 open question first: flag on `<Body>` vs wiring living in `TerminalPane`). Test: a `cd` in the burner shell does not call `updatePaneCwd`.
4. **Pane-switcher pills** — header pills listing the active session's panes with live dots from `runningByPane`; selecting one reveals that pane's mounted `<Body>` (spec §6). Tests: pill live-dot reflects running; selecting switches the shown shell.
5. **Live-but-hidden cues** (spec §8) — pane-header ghost button (`TerminalPane/Header.tsx` + `HeaderActions.tsx`) with amber tint + mint live-dot; tooltip via the shared `Tooltip`; status-bar `● burner ×N` (all-sessions count). Tests per cue; browser-render the icon (ligature trap).
6. **PR2 wrap-up** — full gate, manual cwd-isolation check, PR against `feat/burner-terminal` (`Refs VIM-53`).

## PR3 — pane-bound lifecycle via lazy reconciliation (deferred follow-up plan)

**NOT executable from this document.** Detailed steps authored after PR2 merges. Scope:

1. **Lazy reconciliation effect** in `useBurnerTerminals` (spec §4): given the live sessions/panes, kill + drop (`service.kill` + `dropAllForPty`) any burner entry whose `${sessionId}:${paneId}` no longer maps to a live pane. Tests: pane close → its burner killed+dropped; session close → all its burner killed.
2. **Restart keeps** — assert a pane restart (ptyId rotation, same paneId) does NOT kill the burner entry (stable key). Test with a simulated restart.
3. **Self-exit reconcile** — a burner child that exits on its own flips to `exited` (via `onExit`) and is dropped on the next reconcile/open. Test the exit→drop path.
4. **PR3 wrap-up** — full gate; manual: close a pane with a running burner → process gone; final PR `feat/burner-terminal` → `main` with `Closes VIM-53`.

---

## Self-Review

**Spec coverage:** §3 backend (Tasks 1-5) · §4 hook/state + teardown (Tasks 7, 11; PR3.1) · §5 attach/keep-mounted + buffer-drain (Tasks 8-9) · §6 cwd + per-pane + switcher (PR2.1-4) · §7 chord (Task 10) · §8 cues (PR2.5) · §9 PR breakdown (this structure) · §10 testing (TDD throughout + the IPC-router test in Task 4 + ligature browser-check in Task 8). All sections map to a task.

**Placeholder scan:** PR1 steps carry concrete test code + impl deltas + exact commands. PR2/PR3 are explicitly outlines (deferred detailed plans), not placeholder-laden steps — gated on PR1's real APIs and the two §5 build-time questions.

**Type consistency:** `ephemeral` (Rust `SpawnPtyRequest` + TS `PTYSpawnParams`), `kill_ephemeral_ptys` (inner / `BackendState` / IPC string / `killEphemeralPtys` TS), `burnerPtyId`, `runningByPane` keyed `${sessionId}:${paneId}`, `toggle(target?)` — names consistent across tasks and with the spec.

<!-- codex-reviewed: 2026-06-03T14:48:06Z -->
