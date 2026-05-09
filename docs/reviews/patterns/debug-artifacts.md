---
id: debug-artifacts
category: code-quality
created: 2026-04-09
last_updated: 2026-04-12
ref_count: 0
---

# Debug Artifacts

## Summary

Debug UI elements (red borders, status bars, overlay text) and `console.log`
statements must not ship to production. Gate debug visuals behind
`import.meta.env.DEV` or remove them before committing. The project enforces
`no-console: error` via ESLint, but inline debug UI bypasses this.

## Findings

### 1. Debug status bar rendered unconditionally in TerminalPane

- **Source:** github-codex | PR #34 | 2026-04-08
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/TerminalPane.tsx`
- **Finding:** Always-on debug status bar with internal state leaks to users and conflicts with Obsidian Lens design
- **Fix:** Removed debug UI or gated behind `import.meta.env.DEV`
- **Commit:** `2fc3fa2 feat: Xterm Terminal Core - TauriTerminalService IPC bridge (#34)`

### 2. Debug border and overlay in TerminalZone

- **Source:** github-codex | PR #34 | 2026-04-08
- **Severity:** LOW
- **File:** `src/features/workspace/components/TerminalZone.tsx`
- **Finding:** `border-2 border-red-500` wrapper and debug overlay shipped in production build
- **Fix:** Removed debug styling
- **Commit:** `2fc3fa2 feat: Xterm Terminal Core - TauriTerminalService IPC bridge (#34)`

### 3. Console logging shipped in default command stubs

- **Source:** github-codex | PR #14 | 2026-04-01
- **Severity:** LOW
- **File:** `src/features/command-palette/data/defaultCommands.ts`
- **Finding:** Command stubs use `console.info` with ESLint `no-console` disabled — debug logging ships to production
- **Fix:** Removed console.info calls and eslint-disable comments
- **Commit:** `e05cd3d feat: assemble complete Agent Activity panel (#14)`

### 4. Debug `document.title` mutation on every agent-status event

- **Source:** local-codex | feat/agent-status-sidebar | 2026-04-12
- **Severity:** P3
- **File:** `src/features/agent-status/hooks/useAgentStatus.ts`
- **Finding:** `document.title` was set to debug data (`ctx:4 cost:0.25 model:Opus`) on every `agent-status` event callback. This overwrites the app window title with raw metrics and flickers with each statusline update — a visible regression for all users. Added during debugging to verify event delivery, but never removed.
- **Fix:** Removed the `document.title = ...` line.
- **Commit:** (pending — agent-status-sidebar PR)

### 5. Yellow `bg-yellow-900` debug strip in TerminalZone gated only on `import.meta.env.DEV`

- **Source:** github-claude | PR #190 round 1 | 2026-05-09
- **Severity:** LOW
- **File:** `src/features/workspace/components/TerminalZone.tsx`
- **Finding:** A hard-coded yellow `DEBUG TerminalZone: N sessions | active=…` JSX block was rendered conditionally on `import.meta.env.DEV`. ESLint's `no-console` rule does not catch JSX nodes, so this slipped past lint. The strip occupies visible vertical space in dev mode (pushes xterm's viewport down), distracts every developer running `tauri:dev`, and is functionally redundant — the same data is observable via React DevTools or by inspecting `useSessionManager` state.
- **Fix:** Removed the JSX block entirely. If session-count inspection is still useful during active development, use `console.debug('[TerminalZone]', ...)` behind the same `import.meta.env.DEV` guard — that way ESLint's `no-console` rule can catch strays in future and the rendered layout is unaffected. Code-review heuristic: dev-only debug rendering belongs in DevTools or `console.debug`, never in JSX shipped to the production bundle (even when gated on `DEV`) — the visual cost is paid daily by every developer; the diagnostic value is paid once.
- **Commit:** _(see git log for the cycle-1 fix commit on PR #190)_
