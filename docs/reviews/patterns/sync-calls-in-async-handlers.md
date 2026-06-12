---
id: sync-calls-in-async-handlers
category: code-quality
created: 2026-06-12
last_updated: 2026-06-12
ref_count: 0
---

# Synchronous Calls in Async Electron Handlers

## Summary

`ipcMain.handle` callbacks run on Electron's main-process event loop. Synchronous filesystem or I/O APIs (e.g., `fs.existsSync`, `fs.readFileSync`) inside an async handler block that loop for the duration of the call. Even local file stats are usually microseconds, but a network-mounted `userData` path or an unexpectedly slow filesystem can stall other IPC, timers, and window events. Treat async handlers as non-blocking: prefer `node:fs/promises` equivalents and `.await` them.

## Findings

### 1. `fs.existsSync` used inside async `ipcMain.handle` callback

- **Source:** github-claude | PR #430 round 3 | 2026-06-12
- **Severity:** LOW
- **File:** `electron/main.ts` L457-457
- **Finding:** `fs.existsSync(settingsPath)` was called inside an `async` `ipcMain.handle` callback for `SETTINGS_OPEN_FILE`. The handler already awaited sidecar IPC and `shell.openPath`, so the sync stat was stylistically inconsistent and unnecessarily blocked the main-process event loop.
- **Fix:** Replaced `fs.existsSync(settingsPath)` with `await access(settingsPath).then(() => true).catch(() => false)` using `node:fs/promises`. The `fs` import was removed in favor of `{ access }` from `node:fs/promises`.
- **Commit:** same commit as this entry
