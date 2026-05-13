# Electron Shell With Preserved Rust Backend - One PR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Tauri desktop shell with Electron while preserving the current Rust backend behavior for PTY sessions, filesystem access, git status/diff/watch, and agent observability. The PR should land as one migration PR with the app launching through Electron, no direct frontend dependency on `@tauri-apps/api`, and the Rust backend running as an Electron-managed sidecar process.

**Architecture:** Electron becomes the desktop/window runtime. Rust becomes a long-lived sidecar process with a small JSON IPC protocol over stdio. The existing command/event shape remains stable:

- Commands: `spawn_pty`, `write_pty`, `resize_pty`, `kill_pty`, `list_sessions`, `set_active_session`, `reorder_sessions`, `update_session_cwd`, `detect_agent_in_session`, `start_agent_watcher`, `stop_agent_watcher`, `list_dir`, `read_file`, `write_file`, `git_status`, `git_branch`, `get_git_diff`, `start_git_watcher`, `stop_git_watcher`.
- Events: `pty-data`, `pty-exit`, `pty-error`, `agent-status`, `agent-tool-call`, `agent-turn`, `test-run`, `git-status-changed`.
- Renderer API: `window.vimeflow.invoke(command, args)` and `window.vimeflow.listen(event, callback)`.

**Tech Stack:** Electron, Vite, React 19, TypeScript, Rust, Tokio, serde/serde_json, portable-pty, notify, Vitest, WebdriverIO. Prefer no new frontend runtime dependencies beyond Electron packaging/build dependencies.

---

## Current Coupling Inventory

Direct Tauri coupling to remove or isolate:

- `package.json` - `tauri:dev`, `tauri:build`, `@tauri-apps/api`, `@tauri-apps/cli`
- `src/lib/environment.ts` - Tauri runtime detection via `window.__TAURI_INTERNALS__`
- `src/lib/e2e-bridge.ts` - Tauri `invoke`
- `src/features/terminal/services/tauriTerminalService.ts` - Tauri command/event bridge
- `src/features/files/services/fileSystemService.ts` - dynamic `@tauri-apps/api/core` imports
- `src/features/diff/services/gitService.ts` - Tauri git service
- `src/features/diff/hooks/useGitBranch.ts` - direct Tauri `invoke`
- `src/features/diff/hooks/useGitStatus.ts` - direct Tauri `invoke` and `listen`
- `src/features/agent-status/hooks/useAgentStatus.ts` - direct Tauri `invoke` and `listen`
- `tests/e2e/shared/tauri-driver.ts` and `tests/e2e/*/wdio.conf.ts` - Tauri driver launch
- `src-tauri/src/lib.rs` - Tauri app setup, managed state, command registration, app data path, shutdown hook
- Rust modules accepting `tauri::State`, `tauri::AppHandle`, or emitting via `tauri::Emitter`

---

## One PR Boundaries

### In Scope

- Add Electron main/preload runtime.
- Add a Rust sidecar binary while keeping the existing `src-tauri/` directory name for this PR to avoid mechanical churn.
- Replace Tauri command dispatch with a typed sidecar IPC router.
- Replace Tauri event emission with a runtime-neutral event sink.
- Replace frontend Tauri imports with a local backend bridge.
- Update unit and E2E test harnesses to run against Electron.
- Remove Tauri package scripts and frontend dependency once Electron path is fully wired.

### Out of Scope

- Renaming `src-tauri/` to a new backend directory.
- Reworking PTY, git, filesystem, or agent behavior beyond the IPC/runtime boundary.
- Adding app auto-update, signing, notarization, or release channels.
- Redesigning UI or changing the existing workspace flow.

---

## Target Process Model

```text
React renderer
  -> electron/preload.ts exposes window.vimeflow
  -> electron/main.ts handles ipcMain invoke/listen subscriptions
  -> Rust sidecar over newline-delimited JSON on stdio
  -> BackendContext owns current Rust state
  -> EventSink sends backend events to Electron main
  -> Electron main fans events out to renderer windows
```

### IPC Frames

Command request:

```json
{
  "kind": "request",
  "id": "1",
  "method": "spawn_pty",
  "params": { "request": { "sessionId": "..." } }
}
```

Command response:

```json
{
  "kind": "response",
  "id": "1",
  "ok": true,
  "result": { "id": "...", "pid": 123, "cwd": "/home/will/project" }
}
```

Command error:

```json
{
  "kind": "response",
  "id": "1",
  "ok": false,
  "error": "PTY session not found: ..."
}
```

Backend event:

```json
{
  "kind": "event",
  "event": "pty-data",
  "payload": {
    "sessionId": "...",
    "data": "...",
    "offsetStart": 0,
    "byteLen": 12
  }
}
```

---

## File Structure

### New

- `electron/main.ts` - Electron app lifecycle, BrowserWindow creation, sidecar process management, renderer IPC fan-out
- `electron/preload.ts` - `contextBridge` API for `window.vimeflow`
- `electron/tsconfig.json` - Electron TypeScript build target if needed
- `src/lib/backend.ts` - runtime-neutral frontend command/event client
- `src/lib/backend.test.ts` - client behavior tests and event unsubscribe coverage
- `src/types/vimeflow.d.ts` - global `window.vimeflow` typings
- `src-tauri/src/bin/vimeflow-backend.rs` - sidecar entry point
- `src-tauri/src/runtime/mod.rs` - `BackendContext`, `EventSink`, and sidecar runtime types
- `src-tauri/src/runtime/ipc.rs` - JSON frame parsing/serialization and command router
- `tests/e2e/shared/electron-app.ts` - Electron launch helper replacing `tauri-driver`

### Modified

- `package.json` - Electron scripts, dependency changes, E2E build command
- `vite.config.ts` - keep `base: './'`; adjust comments away from Tauri-specific wording
- `src/lib/environment.ts` and `.test.ts` - rename runtime checks from Tauri to desktop/backend
- `src/lib/e2e-bridge.ts` and `.test.ts` - use `backend.invoke`
- `src/features/terminal/services/terminalService.ts` - factory chooses `DesktopTerminalService`
- `src/features/terminal/services/tauriTerminalService.ts` - rename or replace with `desktopTerminalService.ts`
- `src/features/files/services/fileSystemService.ts` - use `backend.invoke`
- `src/features/diff/services/gitService.ts` - rename `TauriGitService` to `DesktopGitService`
- `src/features/diff/hooks/useGitBranch.ts` - use `backend.invoke`
- `src/features/diff/hooks/useGitStatus.ts` - use `backend.invoke` / `backend.listen`
- `src/features/agent-status/hooks/useAgentStatus.ts` - use `backend.invoke` / `backend.listen`
- `src-tauri/src/terminal/commands.rs` - expose runtime-neutral command functions behind thin wrappers
- `src-tauri/src/git/watcher.rs` - replace `tauri::AppHandle` event emission with `EventSink`
- `src-tauri/src/agent/adapter/**` - replace `tauri::AppHandle` / `tauri::Runtime` with runtime-neutral backend handle
- `src-tauri/src/lib.rs` - either keep as transitional Tauri wrapper until removal, or reduce to shared module exports
- `src-tauri/Cargo.toml` - add sidecar binary metadata; remove Tauri dependencies only after all Rust modules are decoupled
- `tests/e2e/*/wdio.conf.ts` - point capabilities at Electron/Chrome instead of Wry/Tauri driver

---

## Task 0: Baseline Verification

**Files:** none

- [ ] Record current branch and worktree state.

```bash
git status
git branch --show-current
```

- [ ] Record current test, lint, and type-check status.

```bash
npm run type-check
npm run lint
npm run test
cd src-tauri && cargo test
```

- [ ] Record current Tauri coupling count for the PR description.

```bash
rg -n "@tauri-apps/api|__TAURI_INTERNALS__|tauri::|AppHandle|State<'_|Emitter|tauri-driver|tauri:options|tauri:dev|tauri:build" \
  src src-tauri tests package.json vite.config.ts \
  --glob '!src-tauri/target/**' \
  --glob '!src-tauri/gen/**' \
  --glob '!src-tauri/bindings/**'
```

Expected: many hits. The final PR should leave only historical docs/comments or intentional temporary Rust compatibility if kept.

---

## Task 1: Add Electron Shell Without Switching Runtime Yet

**Files:**

- Create: `electron/main.ts`
- Create: `electron/preload.ts`
- Create: `electron/tsconfig.json` if needed
- Modify: `package.json`
- Modify: `vite.config.ts`

- [ ] Add Electron dev dependencies and build helpers.

Suggested dependencies:

```bash
npm install --save-dev electron electron-builder concurrently wait-on
```

Use the repo's package manager lockfile behavior as-is.

- [ ] Add scripts while leaving Tauri scripts temporarily intact:

```json
"electron:dev": "concurrently -k \"npm run dev\" \"wait-on http://localhost:5173 && npm run electron:start\"",
"electron:start": "electron .",
"electron:build": "npm run build && npm run backend:build && electron-builder",
"backend:build": "cd src-tauri && cargo build --bin vimeflow-backend"
```

- [ ] Implement `electron/main.ts` to create the BrowserWindow with:
  - `contextIsolation: true`
  - `nodeIntegration: false`
  - preload script enabled
  - Vite dev URL in development
  - `dist/index.html` in production

- [ ] Implement `electron/preload.ts` with a placeholder `window.vimeflow` API that throws a clear "backend not wired" error. This lets frontend typing and Electron startup be verified before the sidecar lands.

- [ ] Update `vite.config.ts` comments so `base: './'` is described as desktop-packager compatible, not Tauri-specific.

- [ ] Verify Electron opens the existing React shell.

```bash
npm run electron:dev
```

Expected: app window opens. Backend-dependent features may still fall back or fail until later tasks.

---

## Task 2: Introduce Frontend Backend Bridge

**Files:**

- Create: `src/lib/backend.ts`
- Create: `src/lib/backend.test.ts`
- Create: `src/types/vimeflow.d.ts`
- Modify: `src/lib/environment.ts`
- Modify: `src/lib/environment.test.ts`

- [ ] Define the renderer API:

```ts
export interface BackendApi {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
  listen<T>(event: string, callback: (payload: T) => void): Promise<() => void>
}
```

- [ ] Implement `backend.invoke` and `backend.listen` as thin wrappers over `window.vimeflow`.

- [ ] Fail closed when `window.vimeflow` is unavailable. The browser/test path should keep returning mocks where existing factories expect that behavior, but direct desktop hooks should report a meaningful error.

- [ ] Rename environment helpers:
  - `isTauri()` -> `isDesktop()`
  - `isBrowser()` remains valid as `!isDesktop()`
  - `getEnvironment()` returns `'desktop' | 'browser'`

- [ ] Keep compatibility aliases only if the compile blast radius is too large, but mark them as temporary and remove them by the end of the PR.

- [ ] Verify:

```bash
npx vitest run src/lib/backend.test.ts src/lib/environment.test.ts
npm run type-check
```

---

## Task 3: Add Rust Runtime-Neutral Backend Context

**Files:**

- Create: `src-tauri/src/runtime/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/terminal/mod.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] Add `BackendContext` containing the same state Tauri currently manages:
  - `PtyState`
  - `Arc<SessionCache>`
  - `AgentWatcherState`
  - `TranscriptState`
  - `GitWatcherState`
  - `Arc<dyn EventSink>`

- [ ] Add `EventSink`:

```rust
pub trait EventSink: Send + Sync + 'static {
    fn emit_json(&self, event: &str, payload: serde_json::Value) -> Result<(), String>;
}
```

Add a helper method for typed payloads:

```rust
fn emit<T: serde::Serialize>(&self, event: &str, payload: &T) -> Result<(), String>
```

- [ ] Move app-data cache initialization out of Tauri setup into a plain function:

```rust
BackendContext::new(app_data_dir: PathBuf, event_sink: Arc<dyn EventSink>) -> Self
```

- [ ] Preserve the existing E2E cache wipe behavior behind the `e2e-test` Cargo feature.

- [ ] Add a `shutdown()` method that clears the session cache on graceful exit, matching current `RunEvent::ExitRequested` behavior.

- [ ] Add a fake `EventSink` for Rust unit tests.

- [ ] Verify:

```bash
cd src-tauri && cargo test runtime
```

---

## Task 4: Add Sidecar IPC Protocol

**Files:**

- Create: `src-tauri/src/bin/vimeflow-backend.rs`
- Create: `src-tauri/src/runtime/ipc.rs`
- Modify: `src-tauri/src/runtime/mod.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] Add JSON frame types:
  - `RequestFrame { id, method, params }`
  - `ResponseFrame { id, ok, result, error }`
  - `EventFrame { event, payload }`

- [ ] Implement a newline-delimited JSON loop:
  - read requests from stdin
  - dispatch commands through `BackendContext`
  - write responses to stdout
  - write backend events to stdout as event frames

- [ ] Serialize all writes through one output channel to avoid interleaving command responses and events.

- [ ] Use stderr for logs only. Stdout is reserved for IPC frames.

- [ ] Add a `--app-data-dir` CLI argument. Electron main will pass `app.getPath('userData')`.

- [ ] Add basic protocol tests for:
  - malformed JSON returns an error frame or logs and continues
  - unknown method returns an error response
  - event sink writes an event frame

- [ ] Verify:

```bash
cd src-tauri && cargo build --bin vimeflow-backend
```

---

## Task 5: Route Rust Commands Through BackendContext

**Files:**

- Modify: `src-tauri/src/terminal/commands.rs`
- Modify: `src-tauri/src/filesystem/list.rs`
- Modify: `src-tauri/src/filesystem/read.rs`
- Modify: `src-tauri/src/filesystem/write.rs`
- Modify: `src-tauri/src/git/mod.rs`
- Modify: `src-tauri/src/git/watcher.rs`
- Modify: `src-tauri/src/agent/commands.rs`
- Modify: `src-tauri/src/agent/adapter/mod.rs`
- Modify: `src-tauri/src/runtime/ipc.rs`

- [ ] Keep public command names and payload shapes unchanged.

- [ ] Extract each Tauri command body into a plain function that takes explicit state from `BackendContext`.

Examples:

```rust
pub async fn spawn_pty_backend(
    ctx: Arc<BackendContext>,
    request: SpawnPtyRequest,
) -> Result<PtySession, String>
```

```rust
pub fn write_pty_backend(
    ctx: &BackendContext,
    request: WritePtyRequest,
) -> Result<(), String>
```

- [ ] Keep thin Tauri wrappers temporarily only if needed for existing Rust tests. The final app path must not depend on those wrappers.

- [ ] Route these methods through `runtime/ipc.rs`.

- [ ] Verify with focused Rust tests after each module conversion:

```bash
cd src-tauri && cargo test terminal
cd src-tauri && cargo test filesystem
cd src-tauri && cargo test git
```

---

## Task 6: Replace Rust Tauri Event Emission With EventSink

**Files:**

- Modify: `src-tauri/src/terminal/commands.rs`
- Modify: `src-tauri/src/git/watcher.rs`
- Modify: `src-tauri/src/agent/adapter/base/watcher_runtime.rs`
- Modify: `src-tauri/src/agent/adapter/base/transcript_state.rs`
- Modify: `src-tauri/src/agent/adapter/claude_code/transcript.rs`
- Modify: `src-tauri/src/agent/adapter/codex/transcript.rs`
- Modify: `src-tauri/src/agent/adapter/claude_code/test_runners/emitter.rs`
- Modify: `src-tauri/src/agent/adapter/mod.rs`
- Modify: `src-tauri/src/agent/adapter/claude_code/mod.rs`
- Modify: `src-tauri/src/agent/adapter/codex/mod.rs`

- [ ] Replace `tauri::AppHandle` event usage with an `Arc<BackendHandle>` or equivalent that exposes:
  - `emit(event, payload)`
  - `pty_state()`
  - `transcript_state()`

- [ ] Remove `AgentAdapter<R: tauri::Runtime>` and replace it with a non-generic trait.

- [ ] Update transcript tailers and test-run emitter to use the backend event handle.

- [ ] Preserve event names and payload serde shapes exactly.

- [ ] Pay special attention to ordering-sensitive paths:
  - PTY data listener registration before spawn/list replay
  - `test-run` listener before `start_agent_watcher`
  - git watcher listener before `start_git_watcher`

- [ ] Verify:

```bash
cd src-tauri && cargo test transcript
cd src-tauri && cargo test agent
cd src-tauri && cargo test watcher
```

---

## Task 7: Wire Electron Main to the Rust Sidecar

**Files:**

- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `package.json`

- [ ] Spawn the Rust sidecar from Electron main.
  - Dev path: `src-tauri/target/debug/vimeflow-backend`
  - Production path: packaged extra resource path

- [ ] Maintain a pending request map keyed by request id.

- [ ] `ipcMain.handle('backend:invoke', ...)` sends request frames and resolves/rejects on response frames.

- [ ] Events from sidecar are fanned out to renderer windows via `webContents.send('backend:event', event, payload)`.

- [ ] `preload.ts` implements:
  - `window.vimeflow.invoke`
  - `window.vimeflow.listen`

- [ ] Implement cleanup:
  - reject pending requests if sidecar exits
  - kill sidecar on app quit
  - call backend shutdown command before process termination if possible

- [ ] Verify manually with a temporary `list_sessions` call from devtools or the E2E bridge.

---

## Task 8: Convert Frontend Services and Hooks

**Files:**

- Modify: `src/features/terminal/services/tauriTerminalService.ts`
- Modify: `src/features/terminal/services/terminalService.ts`
- Modify: `src/features/files/services/fileSystemService.ts`
- Modify: `src/features/diff/services/gitService.ts`
- Modify: `src/features/diff/hooks/useGitBranch.ts`
- Modify: `src/features/diff/hooks/useGitStatus.ts`
- Modify: `src/features/agent-status/hooks/useAgentStatus.ts`
- Modify tests for each file above

- [ ] Rename `TauriTerminalService` to `DesktopTerminalService` or create a new file and delete the old one at the end of the PR.

- [ ] Replace all imports from:

```ts
@tauri-apps/api/core
@tauri-apps/api/event
```

with:

```ts
import { invoke, listen } from '../../../lib/backend'
```

or the correct relative path.

- [ ] Preserve existing service interfaces and callback timing contracts.

- [ ] Keep the terminal listener memoization behavior. `onData()` must still await underlying listener attachment before callers proceed.

- [ ] Update tests to mock `src/lib/backend` instead of `@tauri-apps/api`.

- [ ] Verify no frontend Tauri imports remain:

```bash
rg -n "@tauri-apps/api|__TAURI_INTERNALS__" src tests
```

Expected: no production hits. Test comments may be updated or removed.

- [ ] Verify:

```bash
npm run type-check
npm run test
```

---

## Task 9: Update E2E Harness From Tauri Driver to Electron

**Files:**

- Create: `tests/e2e/shared/electron-app.ts`
- Modify: `tests/e2e/core/wdio.conf.ts`
- Modify: `tests/e2e/terminal/wdio.conf.ts`
- Modify: `tests/e2e/agent/wdio.conf.ts`
- Modify: `src/lib/e2e-bridge.ts`
- Modify: `package.json`

- [ ] Replace `tests/e2e/shared/tauri-driver.ts` usage with an Electron launch helper.

- [ ] Prefer WDIO's Chromium/Electron-compatible mode. If direct Electron support is awkward, launch Electron with a remote debugging port and point WDIO at that Chromium session.

- [ ] Update capabilities away from:

```ts
browserName: 'wry'
'tauri:options': { application: appBinary }
```

- [ ] Keep the existing E2E specs unchanged where possible. Most tests operate through DOM and `window.__VIMEFLOW_E2E__`.

- [ ] Convert `listActivePtySessions` in `src/lib/e2e-bridge.ts` to `backend.invoke('list_active_pty_sessions')`.

- [ ] Update `test:e2e:build` to build:
  - renderer with `VITE_E2E=1`
  - Electron main/preload
  - Rust sidecar with `--features e2e-test`

- [ ] Verify:

```bash
npm run test:e2e:build
npm run test:e2e
npm run test:e2e:terminal
npm run test:e2e:agent
```

---

## Task 10: Remove Tauri Runtime Surface

**Files:**

- Modify: `package.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/build.rs`
- Modify/delete: `src-tauri/src/main.rs`
- Modify/delete: `src-tauri/src/lib.rs`
- Delete if obsolete: `src-tauri/tauri.conf.json`
- Delete if obsolete: `src-tauri/capabilities/default.json`
- Delete if obsolete: `tests/e2e/shared/tauri-driver.ts`

- [ ] Remove `@tauri-apps/api` and `@tauri-apps/cli` after all frontend imports are gone.

- [ ] Remove Tauri Rust dependencies after all Rust references to `tauri::` are gone.

- [ ] Remove or neutralize `tauri-build` from `build.rs`.

- [ ] Keep `src-tauri/bindings` and `src/bindings` generation flow if `ts-rs` still uses the existing tests. Rename later in a follow-up PR.

- [ ] Run:

```bash
rg -n "@tauri-apps|tauri::|tauri-driver|tauri:options|tauri:dev|tauri:build|__TAURI_INTERNALS__" \
  src src-tauri tests package.json vite.config.ts \
  --glob '!src-tauri/target/**' \
  --glob '!src-tauri/gen/**' \
  --glob '!src-tauri/bindings/**'
```

Expected: no active runtime references. Historical docs may still mention Tauri.

---

## Task 11: Packaging Smoke

**Files:**

- Modify: `package.json`
- Modify: Electron builder config location chosen in Task 1

- [ ] Configure packaged sidecar as an extra resource.

- [ ] Resolve sidecar path in Electron main for both dev and production:
  - dev: repo-local Cargo target
  - prod: `process.resourcesPath`

- [ ] Build packaged app:

```bash
npm run electron:build
```

- [ ] Launch packaged app manually and verify:
  - app window opens
  - default terminal spawns
  - typing into terminal echoes output
  - file tree can list and open files
  - git status panel can fetch branch/status
  - agent detection fake E2E path still works

---

## Final Verification Gate

Run all of the following before opening the PR:

```bash
npm run format:check
npm run lint
npm run type-check
npm run test
cd src-tauri && cargo test
npm run test:e2e:build
npm run test:e2e:all
npm run electron:build
```

Manual smoke:

- [ ] Start with `npm run electron:dev`.
- [ ] Confirm one default session appears.
- [ ] Run `pwd` in the terminal and confirm output.
- [ ] Open a file from the file explorer.
- [ ] Open diff panel and confirm git branch/status.
- [ ] Start a second terminal pane/session, then close it.
- [ ] Quit and relaunch. Confirm session cache behavior matches current Tauri behavior.

---

## PR Description Checklist

- [ ] State that Electron replaced Tauri as the desktop shell.
- [ ] State that Rust backend behavior is preserved and now runs as a sidecar.
- [ ] List command/event compatibility kept stable.
- [ ] Call out high-risk areas tested: PTY event ordering, git watcher lifecycle, agent transcript/test-run events, session cache shutdown.
- [ ] Include verification command output summary.
- [ ] Note deferred follow-ups:
  - rename `src-tauri/` to a backend-neutral directory
  - add release signing/notarization
  - refine sidecar crash recovery UX
  - consider protocol versioning for future backend changes

---

## Risk Notes

- **Agent status is the highest-risk area.** It currently carries the deepest Tauri coupling through `AppHandle`, `Runtime`, managed state, and event emission.
- **PTY event ordering must not regress.** Preserve listen-before-spawn/list behavior and cursor-filtered replay.
- **Sidecar stdout is protocol-owned.** Any accidental logging to stdout can corrupt IPC. Use stderr for logs.
- **Shutdown semantics matter.** Current Tauri graceful exit clears session cache; Electron must call an equivalent shutdown path.
- **Security boundary moves to preload/main.** Renderer must not receive raw Node access. Keep a minimal allowlisted API through `contextBridge`.
