# E2E Testing Infrastructure — Design Spec

**Date**: 2026-04-14
**Status**: Draft
**Related issues**: #55 (HMR orphan PTY), #61 (centralized logging)

## Overview

Vimeflow's unit test suite (1399 tests, ~93% coverage) catches logic errors but cannot reach the bugs that matter most: IPC race conditions, PTY lifecycle issues, cross-component flows, canvas-rendered terminal content, and agent detection pipelines. These bugs are documented extensively in `docs/reviews/patterns/` — async race conditions, stale response ordering, flex layout measurement failures, CodeMirror lifecycle issues — all discovered manually because jsdom has no layout engine, no real IPC round-trips, and no canvas.

This spec defines a layered E2E testing infrastructure using tauri-driver + WebdriverIO for standard Tauri interactions, a dedicated terminal testing module for xterm.js (which renders to canvas and is opaque to WebDriver), an agent flow testing module for the detection-to-panel pipeline, and an interactive REPL harness that lets AI agents investigate bugs before formalizing them as regression tests.

## Goals

1. **Catch what unit tests can't** — IPC timing, PTY lifecycle, cross-component flows, canvas content, event pipelines
2. **Agent-usable testing** — AI agents can run E2E tests, investigate bugs interactively via REPL, and write regression tests
3. **Phased delivery** — smoke-level infrastructure first, grow coverage incrementally
4. **Dev-only overhead** — test bridges and logging are feature-gated, zero cost in production

## Non-Goals

- Playwright frontend-only tests (app is IPC-dependent, mocking it away defeats the purpose)
- Full Phase 3 coverage gate (smoke-level first, expand later)
- macOS E2E via tauri-driver (no WKWebView driver exists; requires alternative tooling)
- `@wdio/tauri-service` integration (manual tauri-driver is the baseline; service can be adopted later)
- HMR-mode testing in the E2E binary (requires separate `tauri dev` harness)

## Architecture

### Layered Test Modules

```
┌─────────────────────────────────────────────────────────────┐
│                    REPL Harness                              │
│  Interactive investigation → formalize as regression test    │
├──────────────┬──────────────────┬───────────────────────────┤
│  e2e-core    │  e2e-terminal    │  e2e-agent                │
│  WebdriverIO │  WebdriverIO +   │  WebdriverIO +            │
│  + tauri-drv │  a11y buffer +   │  Tauri event              │
│              │  test IPC bridge │  subscription             │
├──────────────┴──────────────────┴───────────────────────────┤
│                 Shared Utilities                             │
│  app-launcher, wait-utils, fixtures                         │
├─────────────────────────────────────────────────────────────┤
│           Tauri App (E2E build: --features e2e-test)        │
│  Production code + test-only IPC commands                   │
└─────────────────────────────────────────────────────────────┘
```

Each module targets a different testing challenge:

| Module           | Framework                                 | Domain                                                    |
| ---------------- | ----------------------------------------- | --------------------------------------------------------- |
| **e2e-core**     | tauri-driver + WebdriverIO                | App lifecycle, navigation, IPC round-trips, UI components |
| **e2e-terminal** | WebdriverIO + a11y buffer + Rust test IPC | PTY spawn/input/output, session lifecycle, resize         |
| **e2e-agent**    | WebdriverIO + Tauri event listeners       | Agent detection → transcript parsing → status panel       |
| **repl**         | Standalone (reuses shared helpers)        | Interactive bug investigation for agents and humans       |

### Why Not a Single Suite?

Terminal testing needs the xterm.js accessibility buffer (WebDriver can't read canvas). Agent testing needs Tauri event stream subscriptions. Forcing these into a generic WebdriverIO spec adds friction. Separate modules let each use the right tool while sharing infrastructure.

## Directory Structure

```
tests/
├── e2e/
│   ├── core/                    # Standard Tauri E2E
│   │   ├── wdio.conf.ts         # WebdriverIO config (tauri-driver, caps, xvfb)
│   │   ├── specs/
│   │   │   ├── app-launch.spec.ts
│   │   │   ├── navigation.spec.ts
│   │   │   └── ipc-roundtrip.spec.ts
│   │   └── helpers/
│   │       └── tauri.ts         # IPC invoke wrappers, wait-for-event utilities
│   │
│   ├── terminal/                # Terminal-specific E2E
│   │   ├── wdio.conf.ts         # Extends core config, longer timeouts
│   │   ├── specs/
│   │   │   ├── pty-spawn.spec.ts
│   │   │   ├── terminal-io.spec.ts
│   │   │   └── session-lifecycle.spec.ts
│   │   └── helpers/
│   │       ├── a11y-buffer.ts   # Read xterm.js accessibility tree via WebDriver
│   │       └── pty-assert.ts    # Assertions via test-only IPC commands
│   │
│   ├── agent/                   # Agent detection & status pipeline
│   │   ├── wdio.conf.ts         # Extends core config, event setup in beforeEach
│   │   ├── specs/
│   │   │   ├── agent-detect.spec.ts
│   │   │   └── status-panel.spec.ts
│   │   └── helpers/
│   │       └── event-stream.ts  # Subscribe to Tauri agent-* events, assert sequences
│   │
│   ├── repl/                    # Interactive REPL for agent debugging
│   │   ├── repl-server.ts       # App launch, WebDriver session, stdin/stdout loop
│   │   ├── commands/            # Command modules (click, type, read-terminal, etc.)
│   │   └── README.md
│   │
│   └── shared/                  # Cross-module utilities
│       ├── app-launcher.ts      # Build + launch Tauri app (shared across modules)
│       ├── wait-utils.ts        # Retry/polling helpers for async assertions
│       └── fixtures/            # Mock statusline JSON, agent transcripts, test repos
```

## Technology Stack

### Dependencies

| Package                 | Purpose                                                        |
| ----------------------- | -------------------------------------------------------------- |
| `@wdio/cli`             | WebdriverIO test runner                                        |
| `@wdio/local-runner`    | Local test execution                                           |
| `@wdio/mocha-framework` | Mocha test framework (`describe`/`it` style)                   |
| `@wdio/spec-reporter`   | Human-readable test output                                     |
| `tauri-driver`          | WebDriver bridge to native webview (cargo install)             |
| `tsx`                   | TypeScript execution for REPL server (devDependency, Phase 1b) |

Note: E2E tests use Mocha (`describe`/`it`) via WebdriverIO, while unit tests use Vitest (`test()`). This is a deliberate boundary — different context, different conventions.

**`@wdio/tauri-service` is NOT used.** The official Tauri WebdriverIO example uses manual `tauri-driver` management (spawn in `beforeSession`, teardown in `afterSession`). The `@wdio/tauri-service` / `tauri-plugin-wdio` path requires Rust plugin registration, build-script changes, capabilities config, and guest JS — none of which exist in the current codebase. The manual path is boring but documented and does not couple the production app to a test dependency. If `@wdio/tauri-service` matures and simplifies, it can be adopted later as a drop-in replacement.

### Base WebdriverIO Config

```typescript
// tests/e2e/core/wdio.conf.ts
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, type ChildProcess } from 'node:child_process'

let tauriDriver: ChildProcess

// Resolve relative to this config file's location — stable regardless of cwd
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appPath = path.resolve(
  __dirname,
  '../../../src-tauri/target/debug/vimeflow'
)

export const config: WebdriverIO.Config = {
  runner: 'local',
  framework: 'mocha',
  reporters: ['spec'],

  // Manual tauri-driver lifecycle (official Tauri docs pattern)
  beforeSession() {
    tauriDriver = spawn('tauri-driver', [], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    tauriDriver.on('error', (err) => {
      throw new Error(
        `tauri-driver failed to start: ${err.message}. Run: cargo install tauri-driver`
      )
    })
  },
  afterSession() {
    tauriDriver.kill()
  },

  capabilities: [
    {
      browserName: 'wry',
      'tauri:options': {
        application: appPath,
      },
    },
  ],
  waitforTimeout: 10_000,
  mochaOpts: { timeout: 30_000 },
}
```

Module-specific overrides:

- **terminal**: longer `waitforTimeout` (PTY spawn on WSL2), `before` hook waits for terminal ready
- **agent**: `beforeEach` places fixture files, `afterEach` cleans up fake agent processes

### Build Strategy: Debug, Not Release

E2E builds use **debug mode** (`cargo build`, not `cargo build --release`):

- `debug_assertions` stays enabled, so logging and diagnostic code is available
- The `e2e-test` feature flag gates test-only IPC commands
- Avoids release optimizations that mask timing-sensitive bugs
- Faster iteration (debug builds compile faster than release)

The HMR orphan PTY issue (#55) cannot be tested with a built binary — it requires `tauri dev` with Vite HMR. This needs a separate dev-mode harness and is deferred to Phase 2.

### Cargo Feature Definition

Add to `src-tauri/Cargo.toml`:

```toml
[features]
e2e-test = []
```

Then in `src-tauri/src/lib.rs`, conditionally register test commands:

```rust
let mut builder = tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
        // ... production commands ...
        #[cfg(feature = "e2e-test")]
        terminal::test_commands::list_active_pty_sessions,
    ]);
```

### Environment Requirements

- `tauri-driver` via `cargo install tauri-driver`
- `webkit2gtk-driver` package on Linux/WSL2
- `xvfb` for headless on WSL2 (`xvfb-run` wrapper)
- E2E app build: `VITE_E2E=1 npm run build && cd src-tauri && cargo build --features e2e-test`

### npm Scripts

```json
{
  "test:e2e:build": "VITE_E2E=1 npm run build && cd src-tauri && cargo build --features e2e-test",
  "test:e2e": "wdio tests/e2e/core/wdio.conf.ts",
  "test:e2e:terminal": "wdio tests/e2e/terminal/wdio.conf.ts",
  "test:e2e:agent": "wdio tests/e2e/agent/wdio.conf.ts",
  "test:e2e:all": "npm run test:e2e && npm run test:e2e:terminal && npm run test:e2e:agent",
  "test:e2e:repl": "tsx tests/e2e/repl/repl-server.ts"
}
```

## Test Bridges

Two bridges expose internal state for E2E assertions: a **frontend JS bridge** for terminal DOM reads, and **Rust feature-gated commands** for backend state.

### Frontend Bridge (`window.__VIMEFLOW_E2E__`)

Terminal content lives in the xterm.js accessibility DOM (`.xterm-accessibility` container with row divs), which WebDriver can't easily query via CSS selectors. The bridge exposes read helpers on a global object, gated behind the `VITE_E2E` env var so it is tree-shaken from production builds.

```typescript
// src/lib/e2e-bridge.ts — only loaded when import.meta.env.VITE_E2E is set
import { getAllPtySessionIds } from '../features/terminal/ptySessionMap'

if (import.meta.env.VITE_E2E) {
  window.__VIMEFLOW_E2E__ = {
    getTerminalBuffer(): string {
      // Read .xterm-accessibility rows from the active visible terminal pane
      // Finds the visible [data-testid="terminal-pane"], reads its
      // .xterm-accessibility child's row divs, joins as plain text
      // Phase 1a: reads the single visible terminal (no session ID needed)
      // Phase 2: accepts optional sessionId for multi-tab scenarios
    },
    getActiveSessionIds(): string[] {
      // Delegates to getAllPtySessionIds() from ptySessionMap.ts
      return getAllPtySessionIds()
    },
  }
}
```

**Implementation tasks for the bridge**:

1. Add `getAllPtySessionIds()` to `ptySessionMap.ts` — returns `Array.from(ptySessionMap.values()).map(v => v.ptySessionId)`. The map itself stays private.
2. Import `e2e-bridge.ts` from `main.tsx` — use a static import so the bridge's internal `if (import.meta.env.VITE_E2E)` guard handles the no-op case. Vite tree-shakes the module body when `VITE_E2E` is unset:
   ```typescript
   // src/main.tsx
   import './lib/e2e-bridge'
   ```
3. Add TypeScript `Window` interface augmentation — required since the project enforces strict TypeScript (`tsc -b`):
   ```typescript
   // src/types/e2e.d.ts
   declare global {
     interface Window {
       __VIMEFLOW_E2E__?: {
         getTerminalBuffer(): string
         getActiveSessionIds(): string[]
       }
     }
   }
   export {}
   ```
4. `getTerminalCursorPosition()` is **deferred to Phase 2**. The xterm `Terminal` instance is cached in module-private `terminalCache` (`TerminalPane.tsx:19`). Exposing it requires either an e2e-only accessor on the cache or a DOM-based cursor derivation. Not needed for Phase 1 smoke tests.

**Phase 1a simplification**: For the single-terminal smoke tests, `getTerminalBuffer()` reads the one visible terminal pane's `.xterm-accessibility` DOM — no session ID parameter needed. The `data-e2e-session-id` attribute and multi-session support are deferred to Phase 1b/2 when multi-tab tests land.

**Why not Rust `WebviewWindow::eval()`?** In Tauri 2.x, `eval()` returns `Result<()>`, not the JS return value. It executes JS but cannot read back results. The frontend bridge + WebDriver `browser.execute()` is the correct primitive for "read DOM and return data to the test."

### Rust Test Commands (Backend State)

Feature-gated Tauri commands for backend-only state that the frontend bridge can't access.

```rust
// src-tauri/src/terminal/test_commands.rs
#[cfg(feature = "e2e-test")]
#[tauri::command]
pub fn list_active_pty_sessions(state: State<PtyState>) -> Result<Vec<String>, String> {
    // Returns active PTY session IDs from Rust state
    // Useful for verifying cleanup after session close
}
```

### Design Constraints

- **Frontend bridge**: Gated by `VITE_E2E` env var — tree-shaken in production. Read-only.
- **Rust commands**: Gated by `#[cfg(feature = "e2e-test")]` — don't exist in production binary. Read-only.
- **No mutation**: Test bridges observe state but never mutate. Input/kill go through normal IPC.

### Session ID Discovery

The UI uses workspace session IDs, while PTY sessions have generated UUIDs (see `tauriTerminalService.ts`). Tests need a reliable way to find the PTY session ID for a given terminal tab.

Strategy: the frontend bridge's `getActiveSessionIds()` returns PTY IDs. For single-terminal smoke tests, this is sufficient (there's only one). For multi-tab tests (Phase 2), the terminal pane DOM should expose the PTY session ID via a `data-e2e-session-id` attribute (only when `VITE_E2E` is set).

### Stable Selectors

The spec's example selectors (`#new-terminal-btn`, `#terminal-pane`) do not exist in the current UI. Actual accessible names and test IDs from the codebase:

| Spec reference        | Actual selector                      | Source                    |
| --------------------- | ------------------------------------ | ------------------------- |
| "New terminal button" | `button[aria-label="New tab"]`       | `TerminalZone.tsx:77`     |
| "New instance button" | `button[aria-label="New Instance"]`  | `Sidebar.tsx:311`         |
| Terminal pane         | `[data-testid="terminal-pane"]`      | `TerminalPane.tsx:284`    |
| Terminal zone         | `[data-testid="terminal-zone"]`      | `TerminalZone.tsx:29`     |
| Agent status panel    | `[data-testid="agent-status-panel"]` | `AgentStatusPanel.tsx:27` |
| Agent status card     | `[data-testid="agent-status-card"]`  | `StatusCard.tsx:73`       |
| Workspace view        | `[data-testid="workspace-view"]`     | `WorkspaceView.tsx:243`   |
| Icon rail             | `[data-testid="icon-rail"]`          | `IconRail.tsx:18`         |
| Sidebar               | `[data-testid="sidebar"]`            | `Sidebar.tsx:220`         |
| Context switcher      | `[data-testid="context-switcher"]`   | `ContextSwitcher.tsx:25`  |
| File explorer         | `[data-testid="file-explorer"]`      | `FileExplorer.tsx:50`     |
| Editor panel          | `[data-testid="editor-panel"]`       | `EditorPanel.tsx:10`      |
| Diff panel            | `[data-testid="diff-panel"]`         | `DiffPanel.tsx:41`        |

Tests must use these real selectors. If a stable selector doesn't exist for a test target, add a `data-testid` to the component as part of the implementation task.

### Usage in Tests

```typescript
// tests/e2e/terminal/specs/pty-spawn.spec.ts
describe('PTY spawn', () => {
  it('renders terminal with non-empty accessible buffer', async () => {
    // useSessionManager starts with a default session, so a terminal pane
    // is already present on launch — no need to click "New tab"
    await $('[data-testid="terminal-pane"]').waitForDisplayed()

    // Wait for the PTY to produce output, then verify the a11y buffer is readable
    await browser.waitUntil(
      async () => {
        const content = await browser.execute(() =>
          window.__VIMEFLOW_E2E__.getTerminalBuffer()
        )
        return content.trim().length > 0
      },
      { timeout: 10_000, timeoutMsg: 'Terminal buffer stayed empty after 10s' }
    )
  })

  it('accepts input and echoes output', async () => {
    // Type a deterministic command — avoids brittle prompt-shape assertions
    // (prompt may be $, %, #, themed, or colored depending on shell config)
    const marker = '__VIMEFLOW_E2E_READY__'
    await browser.execute((m) => {
      // Write to the active terminal's xterm instance
      // (implementation delegates to the same write path as user keystrokes)
    }, marker)
    // Alternative: use WebDriver keyboard actions to type into the focused terminal

    const content = await browser.waitUntil(
      async () => {
        const buf = await browser.execute(() =>
          window.__VIMEFLOW_E2E__.getTerminalBuffer()
        )
        return buf.includes('__VIMEFLOW_E2E_READY__') ? buf : null
      },
      { timeout: 10_000 }
    )
    expect(content).toContain(marker)
  })
})
```

**Note on default session**: `useSessionManager` (`useSessionManager.ts:18`) initializes with a default session, so a terminal pane and PTY are already running on app launch. Clicking "New tab" would create a _second_ session. Phase 1a tests work with the default session. The `session-lifecycle` test in Phase 1b must account for this — it should close a _specific_ spawned tab and verify the PTY count decremented, not assert zero.

## REPL Harness

Interactive debugging tool for AI agents and humans. Launches the app, establishes a WebDriver session, and exposes a line-based command interface over stdin/stdout.

### Command Interface

```
$ npm run test:e2e:repl

vimeflow-repl> click button[aria-label="New tab"]
OK: clicked element button[aria-label="New tab"]

vimeflow-repl> wait-for [data-testid="terminal-pane"] visible 5000
OK: element visible after 1200ms

vimeflow-repl> read-terminal
$ _
(3 rows, cursor at 0:2, session=a1b2c3d4)

vimeflow-repl> type-terminal "echo hello"
OK: typed 10 chars to session a1b2c3d4

vimeflow-repl> read-terminal
$ echo hello
hello
$ _
(5 rows, cursor at 2:2, session=a1b2c3d4)

vimeflow-repl> execute window.__VIMEFLOW_E2E__.getTerminalBuffer()
"$ echo hello\nhello\n$ "
# Phase 2: getTerminalBuffer('a1b2c3d4') — session ID support deferred

vimeflow-repl> screenshot /tmp/debug-01.png
OK: saved 1280x720 screenshot

vimeflow-repl> help
Commands: click, type, wait-for, read-terminal, type-terminal,
          execute, screenshot, query, text, help, quit
```

Note: `read-terminal` auto-discovers the active PTY session ID via the frontend bridge. For multi-tab scenarios, pass an explicit session ID: `read-terminal a1b2c3d4`.

### Design Decisions

- **stdin/stdout text protocol** — agents drive it via shell. No HTTP, no WebSocket.
- **Commands map to test helpers** — `read-terminal` uses the same `a11y-buffer.ts` that specs use. Investigation and testing share code.
- **Stateful session** — app stays running between commands. Build up state incrementally.
- **`screenshot`** — agents can visually verify state when text assertions aren't enough.

### Agent Bug Reproduction Workflow

```
1. User reports bug
2. Agent runs: npm run test:e2e:repl
3. Agent investigates interactively (click, type, read, screenshot)
4. Agent identifies root cause from observations
5. Agent writes regression test as .spec.ts file
6. Agent fixes bug, test goes green
```

## Debug Logging (Phase 2)

Structured dev-mode logging that feeds into the REPL for full observability. Ties into issue #61 (centralized logger service).

### Log Categories

**Rust backend:**

| Category       | Examples                                                        |
| -------------- | --------------------------------------------------------------- |
| `[IPC]`        | `spawn_pty called: { shell: "/bin/bash", cwd: "..." }`          |
| `[PTY]`        | `session-1: reader thread started, generation=1`                |
| `[AGENT]`      | `session-1: process tree scan — found claude (pid=4530)`        |
| `[TRANSCRIPT]` | `session-1: parsed tool_call { name: "Read", duration_ms: 45 }` |
| `[FS]`         | `read_file: /path/to/file (2.1kb, 3ms)`                         |

**Frontend:**

| Category   | Examples                                                                 |
| ---------- | ------------------------------------------------------------------------ |
| `[EVENT]`  | `received: agent-status { sessionId: "session-1", agentType: "claude" }` |
| `[STORE]`  | `agentStatus updated: { detected: true, pid: 4530 }`                     |
| `[RENDER]` | `AgentStatusPanel: re-rendered with 1 active agent`                      |

### REPL Integration

```
vimeflow-repl> log-level verbose
OK: backend=DEBUG, frontend=DEBUG

vimeflow-repl> logs                # dump recent log buffer
vimeflow-repl> logs --filter PTY   # filter by category
vimeflow-repl> logs --last 20      # last N entries
```

### Constraints

- **Dev/E2E only** — gated by `cfg!(any(debug_assertions, feature = "e2e-test"))` on Rust side, and `VITE_E2E` or `import.meta.env.DEV` on frontend. This ensures logging is available in both dev mode and E2E debug builds. Zero production overhead.
- **Ring buffer** — REPL captures logs in a fixed-size buffer, not unbounded.

## Phased Delivery

### Phase 1: Infrastructure Foundation (First Deliverable)

Split into two milestones to reduce risk:

**Phase 1a: Prove the pipeline (3 tests, no REPL)**

| Module       | Test            | Verifies                                                                                                                                                                                |
| ------------ | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| e2e-core     | `app-launch`    | Tauri app starts, `[data-testid="workspace-view"]` renders, icon rail visible                                                                                                           |
| e2e-core     | `ipc-roundtrip` | Navigate to Files panel → `[data-testid="file-explorer"]` populates with entries (tests IPC via the real UI flow, not raw `invoke`)                                                     |
| e2e-terminal | `pty-spawn`     | Default session's `[data-testid="terminal-pane"]` visible → `window.__VIMEFLOW_E2E__.getTerminalBuffer()` returns non-empty content (no click needed — default session already running) |

This milestone validates: WebdriverIO + tauri-driver works, the Tauri binary launches, IPC works via a real UI flow, and the frontend bridge reads terminal content. Everything else builds on this foundation.

**Phase 1a implementation tasks** (beyond writing tests):

- Add `[features] e2e-test = []` to `src-tauri/Cargo.toml`
- Add `list_active_pty_sessions` test command in `src-tauri/src/terminal/test_commands.rs`
- Conditionally register test commands in `src-tauri/src/lib.rs`
- Create `src/lib/e2e-bridge.ts` with `window.__VIMEFLOW_E2E__` (gated by `VITE_E2E`)
- Create `src/types/e2e.d.ts` with `Window` interface augmentation (required for strict TypeScript)
- Add static `import './lib/e2e-bridge'` to `src/main.tsx`
- Add `getAllPtySessionIds()` export to `src/features/terminal/ptySessionMap.ts`
- Add `tsx` to devDependencies (needed for REPL in Phase 1b)

**Phase 1b: Expand smoke coverage + REPL (4 tests + REPL)**

| Module       | Test                | Verifies                                                                                                                                                                                                                    |
| ------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| e2e-core     | `navigation`        | Bottom drawer tab switching: click `button[aria-label="Editor"]` → `[data-testid="editor-panel"]` visible; click `button[aria-label="Diff Viewer"]` → `[data-testid="diff-panel"]` visible (per `BottomDrawer.tsx:132-165`) |
| e2e-terminal | `terminal-io`       | Type `echo hello` → output matches in accessibility buffer                                                                                                                                                                  |
| e2e-terminal | `session-lifecycle` | Click "New tab" → verify `list_active_pty_sessions` count incremented → close the new tab → verify count decremented back (default session still alive)                                                                     |

**e2e-agent (1 test):**

| Test                | Verifies                                                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-detect-fake` | Spawn fake-claude in terminal → polling detects process → `agent-status` event fires → `AgentStatusPanel` expands (`isActive && agentType`) → status card visible |

The agent test uses a **real fake agent process**, not mock state injection. A fixture script (`tests/e2e/fixtures/agents/fake-claude`) becomes a real descendant process with `argv[0] = claude`, writes statusline JSON, and sleeps:

```bash
#!/usr/bin/env bash
# tests/e2e/fixtures/agents/fake-claude
set -euo pipefail

# spawn_pty exports VIMEFLOW_STATUS_FILE pointing to
# <pty-cwd>/.vimeflow/sessions/<pty-id>/status.json
# (see bridge.rs:51 and commands.rs:163)
: "${VIMEFLOW_STATUS_FILE:?VIMEFLOW_STATUS_FILE not set — must run inside a Vimeflow PTY}"

mkdir -p "$(dirname "$VIMEFLOW_STATUS_FILE")"

cat > "$VIMEFLOW_STATUS_FILE" <<'JSON'
{
  "session_id": "fake-agent-1",
  "version": "e2e",
  "model": {
    "id": "claude-sonnet-4-20250514",
    "display_name": "Claude Sonnet 4"
  },
  "context_window": {
    "used_percentage": 12.5,
    "context_window_size": 200000,
    "total_input_tokens": 25000,
    "total_output_tokens": 1000
  }
}
JSON

exec -a claude sleep "${VIMEFLOW_FAKE_AGENT_SLEEP_SECONDS:-300}"
```

**Note on platform scope**: This fixture uses bash and `exec -a` (Linux `argv[0]` rename), and the agent detector reads `/proc` (see `detector.rs:40`). The agent E2E suite is **Linux-only** until Windows detection and fixtures are implemented in Phase 3.

The test uses an **absolute fixture path** generated by the WDIO config (not `$PWD`), because terminals start in `~` by default (see `useSessionManager.ts:23`):

```typescript
// In the agent spec's before hook:
const fixturePath = path.resolve(__dirname, '../../fixtures/agents')
// Then type into terminal:
await typeInTerminal(`${fixturePath}/fake-claude`)
```

This exercises:

1. Real process-tree polling (detects `claude` in `argv[0]`)
2. Real status file watcher (reads the JSON)
3. Real `agent-status` event emission (not `agent-detected` — detection is polling-only, per `useAgentStatus.ts:193`)
4. Real `AgentStatusPanel` rendering (requires both `isActive` and `agentType`, per `AgentStatusPanel.tsx:36`)

**REPL (tool, no tests):**

| Deliverable   | Scope                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| `repl-server` | App launch, WebDriver session, stdin/stdout command loop                                               |
| Commands      | `click`, `type`, `wait-for`, `read-terminal`, `type-terminal`, `execute`, `screenshot`, `help`, `quit` |

**Phase 1 total: 7 tests + REPL harness (3 in 1a, 4 in 1b).**

Phase 1a is the risk gate. If tauri-driver + WebdriverIO + frontend bridge works end-to-end, Phase 1b is straightforward expansion. If 1a reveals issues (e.g., WebKitWebDriver on WSL2 is flaky), we diagnose before investing in more tests.

### Phase 2: Logging & Expanded Coverage

- REPL `logs` command + structured logging integration (#61)
- Multi-tab terminal tests (spawn 2+, switch, verify isolation) with `data-e2e-session-id` attributes
- Agent transcript parsing with real JSONL fixtures
- Terminal resize tests
- Cross-component flows (file explorer → editor → unsaved changes)
- `read-agent-status`, `list-events` REPL commands
- **Separate dev-mode harness** for HMR orphan PTY test (#55) — requires `tauri dev` with Vite HMR, cannot be tested with a built binary

### Phase 3: CI & Multi-Platform

- GitHub Actions workflow (Linux runner + xvfb)
- E2E build caching (cargo binary + node_modules)
- Test result artifacts (screenshots, logs)
- Multi-platform matrix: **Linux + Windows only**. macOS is not viable with `tauri-driver` — Tauri's WebDriver docs confirm no WKWebView driver exists. macOS E2E would require `tauri-plugin-playwright` (watch list) or the community `tauri-webdriver` project (young, unproven). Re-evaluate when those mature.

## Framework Evaluation Record

Evaluated five options before settling on the hybrid approach:

| Option                         | Verdict           | Reason                                                                   |
| ------------------------------ | ----------------- | ------------------------------------------------------------------------ |
| **tauri-driver + WebdriverIO** | Adopted (core)    | Official, documented, CI examples. Handles standard Tauri E2E.           |
| **tauri-plugin-playwright**    | Watch list        | Best API but weeks old (March 2026), 0% docs. Re-evaluate in 2-3 months. |
| **Cypress**                    | Rejected          | Cannot connect to Tauri webview. Fundamentally incompatible.             |
| **tauri::test (Rust)**         | Adopted (backend) | Already configured. Excellent for IPC command testing. No frontend.      |
| **Playwright against Vite**    | Skipped           | Frontend-only E2E is overkill when the app is IPC-dependent.             |

## Known Platform Issues

### WSL2: WebKitGTK JS eval broken

Spiked on 2026-04-14. Both `tauri-driver` (WebKitWebDriver) and `tauri-plugin-pilot` (Unix socket + `webview.eval()`) fail on WSL2 + Ubuntu 24.04 + webkit2gtk 2.50.4. Symptoms:

- `tauri-driver`: session creates, then immediately dies — "session deleted because of page crash or hang"
- `tauri-pilot`: socket-level commands (`ping`, `windows`) work, ALL JS eval times out (even `1+1`)
- Root cause: WebKitGTK's `evaluate_javascript` API does not return results. Likely related to EGL/GPU permission errors (`/dev/dri/renderD128: Permission denied`) forcing software rendering fallback, which breaks the JS evaluation callback.

**Impact**: E2E tests cannot run locally on WSL2. Must use a real Linux environment (GitHub Actions, native Linux, or VM with GPU passthrough).

**Tracked in**: #65

### Windows: WebView2 viable but agent tests unsupported

Windows uses WebView2 (Chromium-based), so JS eval works and `tauri-driver` delegates to `msedgedriver` (reliable). However:

- Agent detection reads `/proc` (Linux-only) — needs Windows process enumeration
- Fake-claude fixture uses bash + `exec -a` — needs PowerShell equivalent
- `tauri-pilot` uses Unix sockets — not available on Windows

**e2e-core and e2e-terminal work on Windows. e2e-agent does not** until Windows detection is implemented.

### macOS: tauri-pilot viable, tauri-driver not

macOS has no WKWebView WebDriver. `tauri-pilot` works (Unix sockets + native WebKit JS eval). This is the best option for local macOS development.

## Alternatives Considered

### Single WebdriverIO suite (no module split)

Simpler config, but forces terminal accessibility buffer reads and agent event assertions into generic WebDriver patterns. The module split adds config overhead but lets each domain use the right tool.

### Playwright with mocked IPC

Would give the best test API (Playwright selectors, auto-waiting, codegen). Rejected because mocking all Tauri IPC defeats the purpose — the bugs we're catching are at the IPC boundary.

### Rust-first with minimal WebDriver

Maximize `tauri::test` for backend, minimal WebDriver smoke tests. Rejected because the review knowledge base shows most bugs are at the frontend ↔ backend boundary, not in isolated Rust logic.
