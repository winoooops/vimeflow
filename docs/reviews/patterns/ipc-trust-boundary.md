---
id: ipc-trust-boundary
category: security
created: 2026-06-12
last_updated: 2026-06-18
ref_count: 1
---

# IPC Trust Boundary

## Summary

The Electron main process must treat every renderer IPC payload as untrusted input. TypeScript types are erased at runtime, so an `ipcMain.handle` callback annotated with a domain type is not validation. Storing the whole renderer-controlled object as a typed domain model (for example, `AppSettings`) creates a trusted-looking main-process value that future code may read without re-checking. The safer shape is to extract and validate only the specific fields the main process needs, guarding each field with a runtime `typeof` check and keeping the stored state narrowly typed.

## Findings

### 1. IPC snapshot handler stores unvalidated renderer payload as AppSettings

- **Source:** github-claude | PR #432 round 3 | 2026-06-12
- **Severity:** MEDIUM
- **File:** `electron/main.ts` L489-494
- **Finding:** The `SETTINGS_SYNC_SNAPSHOT` handler accepted the renderer's payload typed as `AppSettings` and assigned it directly to a main-process variable. Because TypeScript types do not exist at runtime, any renderer-sent object would be stored as the authoritative settings snapshot, creating a trust-boundary violation and future-change risk if other main-process code reused the value.
- **Fix:** Changed the handler parameter to `unknown`, validated that the payload is a record and that `onLastWindowClosed` is a string, and stored only that validated string in a renamed `lastKnownOnLastWindowClosed` variable. The `window-all-closed` handler now reads the narrow string value instead of the full settings object.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 2. COMMAND_PALETTE_BINDING IPC handler accepts unbounded string payloads

- **Source:** github-claude | PR #523 round 1 | 2026-06-18
- **Severity:** MEDIUM
- **File:** `electron/main.ts` L491-513
- **Finding:** The `COMMAND_PALETTE_BINDING` handler accepted either a string binding or an object with `palette`/`leader` string fields and forwarded them to the shortcut setters without a length cap. Renderer-controlled IPC payloads should be bounded even after primitive type checks, because a compromised or buggy renderer could force the main process to parse and allocate very large strings.
- **Fix:** Added a `COMMAND_PALETTE_BINDING_MAX_LENGTH = 64` constant and guarded both the singular string binding and the two split binding fields before calling `setCommandPaletteShortcutBinding` / `setCommandPaletteShortcutBindings`.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
