# Vimeflow CLI Agent Workspace — Roadmap

> Created: 2026-04-06
> Revised: 2026-04-07 — pivoted from chat manager to CLI agent workspace
> Design spec: docs/superpowers/specs/2026-04-06-cli-agent-workspace-design.md

## Overview

This roadmap transforms Vimeflow into a **CLI coding agent control plane** — a Tauri 2 desktop app that unifies terminal sessions (AI coding agents like Claude Code), file explorer, code editor, and git diff into one window.

Replaces the previous 6-phase chat-based roadmap. The core change: the primary workspace is now terminal panes running agent processes, not a chat message thread.

## Current State

| Component           | Status                                                           |
| ------------------- | ---------------------------------------------------------------- |
| Chat view           | UI shell + mock data — **deprecated, to be removed**             |
| Diff view           | Wired — real git ops via Vite API plugin (`/api/git/*`)          |
| Editor view         | Wired — file tree + content via Vite API plugin (`/api/files/*`) |
| Command Palette     | UI shell + mock commands                                         |
| Agent Workspace     | Design spec complete, Stitch mockup approved                     |
| Tauri backend       | Does not exist (`src-tauri/` missing)                            |
| Terminal (xterm.js) | Not yet implemented                                              |
| State management    | None — prop drilling + `useState` in `App.tsx`                   |
| CI                  | `tauri-build.yml` exists but blocked (no `src-tauri/`)           |

---

## Phase 1: Tauri Scaffold + CI Green

**Scope: Medium | Est: 3–5 days**

### Goal

Bootstrap `src-tauri/` so the app runs as a Tauri window. No IPC commands yet — just the shell.

### Steps

1. Run `npx tauri init` to scaffold `src-tauri/`
2. Configure `tauri.conf.json`: `devUrl` → `http://localhost:5173`, `frontendDist` → `../dist`
3. Add `tauri:dev` and `tauri:build` npm scripts
4. Create `src/lib/environment.ts` — `isTauri()` detection
5. Update CI `tauri-build.yml` — add Rust caching
6. Add `.gitignore` entries for `src-tauri/target/`, `src-tauri/gen/`

### Definition of Done

- [ ] `npm run tauri:dev` opens a native window showing the React app
- [ ] `npm run dev` still works as standalone Vite dev server
- [ ] CI passes on macOS, Windows, Linux
- [ ] All existing tests still pass

### Risks

- WSL2: No native window — need WSLg or Windows-side cargo
- Tauri 2 config: Use only official v2 docs

---

## Phase 2: Terminal Core

**Scope: Large | Est: 5–8 days | Blocked by: Phase 1**

### Goal

Integrate xterm.js with a Rust-side PTY via Tauri. Render a working terminal pane that can run shell commands and Claude Code.

### Steps

1. Add `portable-pty` Rust crate for cross-platform PTY spawning
2. Implement Rust commands: `pty_spawn`, `pty_write`, `pty_resize`, `pty_kill`
3. Wire PTY stdout → Tauri events → frontend
4. Wire frontend keyboard input → Tauri invoke → PTY stdin
5. Add `xterm.js` + `@xterm/addon-fit` + `@xterm/addon-webgl` to frontend
6. Create `TerminalPane` React component rendering xterm.js
7. Add terminal tab bar (agent tab + shell tabs + `+` button)
8. Configure Catppuccin Mocha theme for xterm.js

### Definition of Done

- [ ] Can spawn a shell process and interact with it in the terminal pane
- [ ] Can run `claude` (Claude Code) in a terminal pane
- [ ] Terminal resizes correctly when window resizes
- [ ] Multiple terminal tabs work (switch between them)
- [ ] PTY processes are cleaned up on tab close / app exit

### Risks

- `portable-pty` behavior on Windows vs macOS vs Linux — test all three
- xterm.js performance with large agent output — use WebGL renderer

---

## Phase 3: Session Management + State

**Scope: Medium | Est: 5–7 days | Blocked by: Phase 2**

### Goal

Introduce Zustand for global state. Build the project/session data model and sidebar session list.

### Store Structure

```
src/stores/
  appStore.ts        # activeProject, sidebarCollapsed, contextPanel
  sessionStore.ts    # sessions[], activeSession, session CRUD
  terminalStore.ts   # terminals[], activeTerminal, terminal state per session
  activityStore.ts   # fileChanges, toolCalls, testResults per session
```

### Steps

1. Install Zustand, create store architecture
2. Create `appStore` — migrate global state from `App.tsx`
3. Create `sessionStore` — project/session data model, CRUD operations
4. Create `terminalStore` — manage PTY instances per session
5. Build sidebar session list component (Discord pattern from design spec)
6. Build icon rail with project avatars
7. Wire session switching: click session → update terminal zone + activity panel
8. Remove chat-related code: `ChatView`, `features/chat/`, chat types, mock messages

### Definition of Done

- [ ] Projects appear as avatars in icon rail
- [ ] Sessions listed in sidebar with name, status badge, timestamp
- [ ] Clicking a session switches the terminal and activity panel
- [ ] New session can be created (spawns Claude Code in a PTY)
- [ ] Chat view and all chat-related code removed
- [ ] All tests pass, zero prop drilling

---

## Phase 4: File Watcher + Agent Activity Panel

**Scope: Medium | Est: 5–7 days | Blocked by: Phase 3**

### Goal

Implement the Agent Activity sidebar with real-time file change tracking via Rust `notify` crate, and the always-visible usage metrics.

### Steps

1. Add `notify` Rust crate for filesystem watching
2. Implement Rust command: `watch_directory` (starts watcher), `unwatch_directory`
3. Emit file change events (created/modified/deleted) via Tauri events
4. Create `activityStore` — aggregate file changes per session
5. Build Agent Activity panel component with collapsible sections
6. Implement "Files Changed" section (live from file watcher)
7. Implement always-pinned section: status card, context window smiley, 5-hour usage bar
8. Implement collapsible "Tool Calls", "Tests", "Usage Details" sections (placeholder data for now)
9. Wire git diff integration: click a changed file → opens in Diff context panel

### Definition of Done

- [ ] File changes appear in real-time as the agent modifies files
- [ ] Context window smiley indicator displays correctly
- [ ] 5-hour usage bar shows progress
- [ ] Collapsible sections expand/collapse with chevron toggle
- [ ] Clicking a file in "Files Changed" opens it in the sidebar Diff panel
- [ ] File watcher scoped to active session's working directory

---

## Phase 5: Terminal Parser + Agent Adapters

**Scope: Medium | Est: 4–6 days | Blocked by: Phase 4**

### Goal

Parse Claude Code's terminal output to extract structured data: tool calls, test results, agent status. Feed this into the Agent Activity panel.

### Steps

1. Design `AgentAdapter` interface (parse terminal output → structured events)
2. Implement `ClaudeCodeAdapter` — parse Claude Code's stdout patterns:
   - Tool call detection (Read, Write, Edit, Bash, etc.)
   - Test result extraction (vitest/jest patterns)
   - Status changes (thinking, writing, waiting for input)
   - Context window usage (if parseable from output)
3. Implement `GenericAdapter` fallback (no parsing, file watcher only)
4. Wire adapter output to `activityStore`
5. Update "Tool Calls" section with real parsed data
6. Update "Tests" section with real parsed data
7. Auto-expand sections on relevant events

### Definition of Done

- [ ] Tool calls appear in real-time as Claude Code executes them
- [ ] Test results appear when Claude Code runs tests
- [ ] Agent status updates (running/thinking/waiting) reflected in status card
- [ ] Sections auto-expand when relevant events occur
- [ ] Generic adapter works for non-Claude-Code processes (just file watcher)

---

## Phase 6: Context Panel Integration

**Scope: Medium | Est: 4–6 days | Blocked by: Phase 3, builds on Phase 4**

### Goal

Wire the existing Files Explorer, Code Editor, and Git Diff views to work as context panels in the sidebar, scoped to the active session's working directory.

### Steps

1. Refactor IPC layer: Rust git/file commands (reuse from old Phase 2 plan)
2. Create `TauriGitService` and `TauriFileService` (service factory pattern)
3. Adapt Files Explorer to render in 260px sidebar width
4. Adapt Code Editor for sidebar (compact mode) + full-width overlay
5. Adapt Git Diff for sidebar (unified only) + full-width overlay (side-by-side)
6. Build context switcher tab row (Files/Editor/Diff) in sidebar
7. Scope all context panels to active session's working directory
8. Cross-panel navigation: click file in Files → opens in Editor; click modified file → opens Diff

### Definition of Done

- [ ] Files/Editor/Diff panels render correctly in sidebar
- [ ] Panels scoped to active session's working directory
- [ ] Full-width overlay works for Editor and Diff
- [ ] Cross-panel navigation works
- [ ] Vite API plugins remain functional as dev fallback

---

## Phase 7: Usage Metrics

**Scope: Small | Est: 2–3 days | Blocked by: Phase 5**

### Goal

Wire real usage data into the Agent Activity panel.

### Steps

1. Research Claude Code's usage data exposure (billing API, local logs, terminal output)
2. Implement context window tracking (parse from terminal or estimate from adapter)
3. Implement 5-hour window usage counter
4. Build "Usage Details" collapsible section: weekly, monthly, cost breakdown
5. Persist usage data locally (SQLite or JSON in app data dir)

### Definition of Done

- [ ] Context window smiley reflects actual usage
- [ ] 5-hour usage counter updates in real-time
- [ ] Usage Details section shows weekly/monthly breakdown
- [ ] Usage persists across app restarts

---

## Phase 8: Desktop Polish

**Scope: Medium | Est: 4–6 days | Parallel with Phase 7**

- Window state persistence (`tauri-plugin-window-state`)
- Native menu bar (platform-specific)
- System tray with show/hide and quit
- Global keyboard shortcuts (`tauri-plugin-global-shortcut`)
- Auto-updater (`tauri-plugin-updater` + GitHub releases)
- Platform-specific title bar (macOS traffic lights, Windows controls)
- Bundle fonts (Manrope, Inter, JetBrains Mono) — no CDN dependency

---

## Dependency Graph

```
Phase 1: Tauri Scaffold
    │
    ▼
Phase 2: Terminal Core
    │
    ▼
Phase 3: Session Management + State ───────┐
    │                                       │
    ▼                                       ▼
Phase 4: File Watcher + Activity    Phase 6: Context Panels
    │
    ▼
Phase 5: Terminal Parser
    │
    ├────────┬──────────┐
    ▼        ▼          ▼
Phase 7  Phase 8    (parallel)
```

---

## Key Architectural Decisions

| Decision        | Recommendation                          | Rationale                                                       |
| --------------- | --------------------------------------- | --------------------------------------------------------------- |
| Terminal        | xterm.js + portable-pty                 | De facto standard; matches Termio's stack                       |
| PTY management  | One PTY per terminal tab                | Simple lifecycle; Rust owns spawn/kill                          |
| State mgmt      | Zustand in Phase 3                      | After terminal works but before complex UI                      |
| Agent parsing   | Adapter pattern per agent CLI           | Claude Code first; extensible to Codex, Aider                   |
| File watching   | Rust `notify` → Tauri events            | Agent-agnostic; works regardless of which process changes files |
| Context panels  | Sidebar (260px) + full-width overlay    | Compact view in sidebar; expand for detailed work               |
| Session model   | Project → Sessions → Terminals          | Discord-like hierarchy; familiar mental model                   |
| Dev coexistence | `window.__TAURI_INTERNALS__` in factory | `npm run dev` (web) and `npm run tauri:dev` both work           |

---

## Security Considerations

| Concern            | Approach                                                           |
| ------------------ | ------------------------------------------------------------------ |
| PTY process mgmt   | Track all spawned processes; kill on session close / app exit      |
| Path traversal     | `std::fs::canonicalize` + root boundary check for file operations  |
| IPC security       | Typed Rust structs (serde) — no unbounded inputs                   |
| CSP                | `script-src 'self'`; no `unsafe-eval`                              |
| Tauri capabilities | Minimum permissions: scoped `fs`, `shell:allow-spawn` for PTY only |
| File watcher scope | Restricted to session working directory, no upward traversal       |

---

## Timeline Summary

| Phase                         | Scope  | Est. Days | Key Deliverable                       |
| ----------------------------- | ------ | --------- | ------------------------------------- |
| 1. Tauri Scaffold             | Medium | 3–5       | Native window + CI green              |
| 2. Terminal Core              | Large  | 5–8       | xterm.js + PTY working                |
| 3. Session Management + State | Medium | 5–7       | Projects, sessions, sidebar, Zustand  |
| 4. File Watcher + Activity    | Medium | 5–7       | Agent Activity panel, real-time files |
| 5. Terminal Parser            | Medium | 4–6       | Claude Code output → structured data  |
| 6. Context Panels             | Medium | 4–6       | Files/Editor/Diff wired to sessions   |
| 7. Usage Metrics              | Small  | 2–3       | Context window, billing data          |
| 8. Desktop Polish             | Medium | 4–6       | Tray, menus, auto-update, fonts       |

**Total: ~32–48 days** (critical path ~24–34 days with Phase 6–8 parallel work)
