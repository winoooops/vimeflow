---
id: debug-artifacts
category: code-quality
created: 2026-04-09
last_updated: 2026-04-09
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
