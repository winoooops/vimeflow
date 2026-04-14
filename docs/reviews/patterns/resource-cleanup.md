---
id: resource-cleanup
category: react-patterns
created: 2026-04-09
last_updated: 2026-04-09
ref_count: 1
---

# Resource Cleanup

## Summary

Services that register global event listeners (especially Tauri IPC listeners)
must be disposed on unmount. Creating a new service instance per component
mount without cleanup causes listener accumulation and duplicate event handling.

## Findings

### 1. Tauri event listeners leak across terminal panes

- **Source:** github-codex | PR #34 | 2026-04-08
- **Severity:** MEDIUM
- **File:** `src/features/terminal/services/terminalService.ts`
- **Finding:** Each `createTerminalService()` call registers global Tauri listeners with no `dispose()` on unmount — listeners accumulate as panes mount/unmount
- **Fix:** Made Tauri service a singleton or added dispose call in cleanup
- **Commit:** `2fc3fa2 feat: Xterm Terminal Core - TauriTerminalService IPC bridge (#34)`
