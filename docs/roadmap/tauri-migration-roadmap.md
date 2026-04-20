# Vimeflow CLI Agent Workspace — Roadmap

> Created: 2026-04-06
> Revised: 2026-04-07 — pivoted from chat manager to CLI agent workspace
> Design spec: docs/superpowers/specs/2026-04-06-cli-agent-workspace-design.md
> Change log: CHANGELOG.md / CHANGELOG.zh-CN.md (linear timeline, paired with docs/reviews/)

## Overview

This roadmap transforms Vimeflow into a **CLI coding agent control plane** — a Tauri 2 desktop app that unifies terminal sessions (AI coding agents like Claude Code), file explorer, code editor, and git diff into one window.

Replaces the previous 6-phase chat-based roadmap. The core change: the primary workspace is now terminal panes running agent processes, not a chat message thread.

## Current State

| Component           | Status                                                           |
| ------------------- | ---------------------------------------------------------------- |
| Tauri scaffold      | **Done** — `src-tauri/` bootstrapped, CI green (PR #27)          |
| Chat view           | UI shell + mock data — **deprecated, to be removed**             |
| Diff view           | Wired — real git ops via Vite API plugin (`/api/git/*`)          |
| Editor view         | Wired — file tree + content via Vite API plugin (`/api/files/*`) |
| Command Palette     | UI shell + mock commands                                         |
| Agent Workspace     | Design spec complete, Stitch mockup approved (PR #29)            |
| Terminal (xterm.js) | Not yet implemented                                              |
| State management    | None — prop drilling + `useState` in `App.tsx`                   |

---

## Phase 1: Tauri Scaffold + CI Green ✅

**Status: Done** — PR #27, commit `9ce4d61`

Bootstrapped `src-tauri/` with Tauri v2 configuration, npm scripts, environment detection, and CI pipeline.

---

## Phase 2: Workspace Layout Shell

**Scope: Medium | Est: 4–6 days | Blocked by: Phase 1 ✅**

### Goal

Implement the 4-zone workspace layout from the Stitch mockup as a static frontend shell. Replace the chat-based layout with the new Discord-pattern architecture. Uses mock/placeholder data — no PTY or backend wiring yet.

### Steps

1. Remove chat-related code: `ChatView`, `features/chat/`, chat types, mock messages
2. Refactor `App.tsx` from chat-first to workspace layout (4-zone grid)
3. Build new Icon Rail component — project avatars, `+` new project, `⚙` settings
4. Build new Sidebar component — session list (mock data) + context switcher tabs (Files/Editor/Diff)
5. Build Terminal Zone placeholder — tab bar + mock terminal content area
6. Build Agent Activity panel — status card, context smiley, 5-hour usage bar, collapsible sections (all mock data)
7. Wire context switcher tabs to show existing Files Explorer / Editor / Diff in sidebar
8. Apply Obsidian Lens design tokens — match Stitch `code.html` reference (with authoritative color overrides)
9. Update Tailwind config with new semantic tokens (`success`, `tertiary`, `primary-dim`, etc.)
10. Update tests for new layout components

### Definition of Done

- [ ] 4-zone layout renders: icon rail, sidebar, terminal zone, agent activity
- [ ] Icon rail shows project avatars with active highlight
- [ ] Sidebar shows mock session list with status badges
- [ ] Context switcher tabs (Files/Editor/Diff) work in sidebar
- [ ] Agent Activity panel shows all sections (mock data)
- [ ] Chat view and all chat code removed
- [ ] All new components match Stitch mockup (`docs/design/agent_workspace/screen.png`)
- [ ] All tests pass, Prettier + ESLint clean

### Risks

- Large layout refactor touches many files — migrate incrementally, one zone at a time
- Existing Files/Editor/Diff components may need width adaptations for 260px sidebar

---

## Phase 3: Terminal Core

**Scope: Large | Est: 5–8 days | Blocked by: Phase 2**

### Goal

Integrate xterm.js with a Rust-side PTY via Tauri. Replace the terminal zone placeholder with a real working terminal.

### Steps

1. Add `portable-pty` Rust crate for cross-platform PTY spawning
2. Implement Rust commands: `pty_spawn`, `pty_write`, `pty_resize`, `pty_kill`
3. Wire PTY stdout → Tauri events → frontend
4. Wire frontend keyboard input → Tauri invoke → PTY stdin
5. Add `xterm.js` + `@xterm/addon-fit` + `@xterm/addon-webgl` to frontend
6. Create `TerminalPane` React component rendering xterm.js
7. Replace terminal zone placeholder with real `TerminalPane`
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

## Phase 4: Session Management + State

**Scope: Medium | Est: 5–7 days | Blocked by: Phase 3**

### Goal

Introduce Zustand for global state. Wire the session list from Phase 2 to real data. Connect session switching to terminal panes.

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
5. Wire sidebar session list to `sessionStore` (replace mock data)
6. Wire icon rail project avatars to real project data
7. Wire session switching: click session → update terminal + activity panel
8. Persist sessions across app restarts (SQLite or JSON in app data dir)

### Definition of Done

- [ ] Sessions backed by Zustand store, not mock data
- [ ] Clicking a session switches the terminal and activity panel
- [ ] New session can be created (spawns Claude Code in a PTY)
- [ ] Session state persists across app restarts
- [ ] All tests pass, zero prop drilling

---

## Phase 5: File Watcher + Agent Activity Panel

**Scope: Medium | Est: 5–7 days | Blocked by: Phase 4**

### Goal

Wire the Agent Activity sidebar (built as static shell in Phase 2) to real data via Rust `notify` file watcher.

### Steps

1. Add `notify` Rust crate for filesystem watching
2. Implement Rust commands: `watch_directory`, `unwatch_directory`
3. Emit file change events (created/modified/deleted) via Tauri events
4. Create `activityStore` — aggregate file changes per session
5. Wire "Files Changed" section to live file watcher data
6. Wire pinned section to real session data (status, context estimate, usage)
7. Wire git diff integration: click a changed file → opens in Diff context panel
8. Keep "Tool Calls", "Tests", "Usage Details" sections with placeholder data (wired in Phase 6)

### Definition of Done

- [ ] File changes appear in real-time as the agent modifies files
- [ ] Context window smiley indicator displays correctly
- [ ] 5-hour usage bar shows progress
- [ ] Collapsible sections expand/collapse with chevron toggle
- [ ] Clicking a file in "Files Changed" opens it in the sidebar Diff panel
- [ ] File watcher scoped to active session's working directory

---

## Phase 6: Terminal Parser + Agent Adapters

**Scope: Medium | Est: 4–6 days | Blocked by: Phase 5**

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
- [ ] Collapsible sections auto-expand when relevant events occur (e.g., Tests expands on test run)
- [ ] Generic adapter works for non-Claude-Code processes (just file watcher)

---

## Phase 7: Context Panel Integration

**Scope: Medium | Est: 4–6 days | Blocked by: Phase 4**

### Goal

Wire the existing Files Explorer, Code Editor, and Git Diff views to Tauri IPC, scoped to the active session's working directory.

### Steps

1. Implement Rust git/file IPC commands (git2, walkdir, tokio::fs)
2. Create `TauriGitService` and `TauriFileService` (service factory pattern)
3. Adapt Files Explorer to render in 260px sidebar width
4. Adapt Code Editor for sidebar (compact mode) + full-width overlay
5. Adapt Git Diff for sidebar (unified only) + full-width overlay (side-by-side)
6. Scope all context panels to active session's working directory
7. Cross-panel navigation: click file in Files → opens in Editor; click modified file → opens Diff

### Definition of Done

- [ ] Files/Editor/Diff panels render correctly in sidebar
- [ ] Panels scoped to active session's working directory
- [ ] Full-width overlay works for Editor and Diff
- [ ] Cross-panel navigation works
- [ ] Vite API plugins remain functional as dev fallback

---

## Phase 8: Usage Metrics

**Scope: Small | Est: 2–3 days | Blocked by: Phase 6**

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

## Phase 9: Desktop Polish

**Scope: Medium | Est: 4–6 days | Parallel with Phase 8**

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
Phase 1: Tauri Scaffold ✅
    │
    ▼
Phase 2: Workspace Layout Shell ← NEXT
    │
    ▼
Phase 3: Terminal Core
    │
    ▼
Phase 4: Session Management + State ───────┐
    │                                       │
    ▼                                       ▼
Phase 5: File Watcher + Activity    Phase 7: Context Panels
    │
    ▼
Phase 6: Terminal Parser
    │
    ├────────┬──────────┐
    ▼        ▼          ▼
Phase 8  Phase 9    (parallel)
```

---

## Key Architectural Decisions

| Decision        | Recommendation                          | Rationale                                                       |
| --------------- | --------------------------------------- | --------------------------------------------------------------- |
| Layout first    | Static shell before backend wiring      | Validate design, get visual feedback early, unblock parallel UI |
| Terminal        | xterm.js + portable-pty                 | De facto standard; matches Termio's stack                       |
| PTY management  | One PTY per terminal tab                | Simple lifecycle; Rust owns spawn/kill                          |
| State mgmt      | Zustand in Phase 4                      | After terminal works but before complex UI                      |
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

| Phase                         | Scope  | Est. Days | Status   | Key Deliverable                       |
| ----------------------------- | ------ | --------- | -------- | ------------------------------------- |
| 1. Tauri Scaffold             | Medium | 3–5       | **Done** | Native window + CI green              |
| 2. Workspace Layout Shell     | Medium | 4–6       | Next     | 4-zone layout, mock data              |
| 3. Terminal Core              | Large  | 5–8       | Pending  | xterm.js + PTY working                |
| 4. Session Management + State | Medium | 5–7       | Pending  | Projects, sessions, Zustand           |
| 5. File Watcher + Activity    | Medium | 5–7       | Pending  | Agent Activity panel, real-time files |
| 6. Terminal Parser            | Medium | 4–6       | Pending  | Claude Code output → structured data  |
| 7. Context Panels             | Medium | 4–6       | Pending  | Files/Editor/Diff wired to sessions   |
| 8. Usage Metrics              | Small  | 2–3       | Pending  | Context window, billing data          |
| 9. Desktop Polish             | Medium | 4–6       | Pending  | Tray, menus, auto-update, fonts       |

**Total: ~36–54 days** (critical path ~28–40 days with Phase 7–9 parallel work)
