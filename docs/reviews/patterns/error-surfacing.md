---
id: error-surfacing
category: error-handling
created: 2026-04-10
last_updated: 2026-04-10
ref_count: 0
---

# Error Surfacing

## Summary

`void promise` is the silent error swallowing footgun of the codebase. Every
`void editorBuffer.openFile(...)` or `void someAsyncIpc()` discards both the
return value AND any rejection — the user sees zero feedback on Tauri IPC
failures (disk full, permission denied, file missing) and the editor silently
stays in a deceptive state. The fix is always the same shape: wrap in
try/catch, capture the error message, route it to a UI sink (banner, dialog,
toast), and — critically — make sure the UI state is consistent with the
caught error. "Save failed" must mean the buffer is still dirty; "Open
failed" must mean the editor shows the original file, not the requested one.

## Findings

### 1. Direct file open silently swallows Tauri IPC failures

- **Source:** github-claude | PR #38 round 3 | 2026-04-10
- **Severity:** HIGH
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** `handleFileSelect` called `void editorBuffer.openFile(filePath)` for the no-unsaved-changes path. Any `readFile` IPC failure (file deleted, permission denied, disk error) was silently dropped. The editor kept displaying the previous file's content with no error message. The PR's own comment explicitly called out this bug pattern as "fire and forget" — but only fixed it inside `handleDiscard`, leaving this call site unchanged.
- **Fix:** Extract `openFileSafely(filePath)` helper with try/catch that calls `setFileError` on failure. Add a dismissible inline error banner to `WorkspaceView` that surfaces the message.
- **Commit:** `d2a67ed fix: address Claude review round 3 findings`

### 2. Vim `:w` save path silently swallows write errors

- **Source:** github-claude | PR #38 round 3 | 2026-04-10
- **Severity:** HIGH
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** `onSave={() => void editorBuffer.saveFile()}` in the BottomDrawer chain: the `:w` command → `Vim.defineEx` handler → `useCodeMirror.onSave` ref → this callback. If `writeFile` IPC failed (disk full, permissions), the error was dropped. The user saw the editor still open with no error message and could reasonably believe the save succeeded — while their edits had not been persisted.
- **Fix:** Extract `handleVimSave()` async function with try/catch, route errors to `fileError` banner.
- **Commit:** `d2a67ed fix: address Claude review round 3 findings`

### 3. CodeEditor logs load errors to console with `eslint-disable` bypass

- **Source:** github-claude | PR #38 round 3 | 2026-04-10
- **Severity:** MEDIUM
- **File:** `src/features/editor/components/CodeEditor.tsx`
- **Finding:** The project's ESLint configuration enforces `no-console: error`. CodeEditor bypassed it with an inline `// eslint-disable-next-line no-console` to call `console.error('Failed to load file:', error)` on a `readFile` rejection. The error was logged to the browser console and swallowed — no UI feedback reached the user. The `eslint-disable` hid the rule violation from CI enforcement, so the bypass shipped silently.
- **Fix:** Remove the `eslint-disable` and propagate the error via an `onLoadError?: (message: string) => void` callback prop. WorkspaceView wires it to `setFileError` so the user sees a banner. Use a ref pattern for the callback identity so its change doesn't re-fire the load effect.
- **Commit:** `d2a67ed fix: address Claude review round 3 findings`

### 4. CodeEditor fallback save path silently swallows `writeFile` errors

- **Source:** github-claude | PR #38 round 4 | 2026-04-10
- **Severity:** MEDIUM
- **File:** `src/features/editor/components/CodeEditor.tsx`
- **Finding:** When the `onSave` prop was undefined, CodeEditor fell back to `void fileSystemService.writeFile(loadedFilePath, currentContent)`. The `void` discarded the rejection. In this codepath a `:w` would appear to succeed (no error, editor still open) while the file was never written. Same silent-swallow pattern as above, left behind in a "safety net" branch.
- **Fix:** Remove the fallback entirely. `onSave` is always provided by the only real call site (`BottomDrawer` → `WorkspaceView.handleVimSave`, which already has try/catch). The fallback was dead code that could only hurt.
- **Commit:** `967c25f fix: address Claude review round 4 findings`

### 5. `handleSave` / `handleDiscard` silently swallow errors via `void handleSave()`

- **Source:** github-claude | PR #38 round 2 | 2026-04-10
- **Severity:** MEDIUM
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** Both handlers were `async` functions, invoked from the dialog prop chain as `() => void handleSave()`. If `saveFile()` or `openFile()` threw, the rejection propagated out of the handler as an unhandled Promise rejection — no user feedback, no error display. `handleSave` also failed to close the dialog on error (the setState calls were after the await), leaving the user in a stuck state with no indication of what went wrong.
- **Fix:** Wrap both handlers in try/catch. Thread a `saveError` prop through `UnsavedChangesDialog` so errors display as an inline alert inside the dialog. On save failure, keep the dialog open for retry. On discard failure, also keep the dialog open (was previously closing prematurely).
- **Commit:** `077c87f fix: address Claude review round 2 findings`

### 6. UnsavedChangesDialog shows destination file as dirty, not the current file

- **Source:** github-claude | PR #38 round 4 | 2026-04-10
- **Severity:** HIGH
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** The dialog received `pendingFilePath` (the file the user was switching TO) as its `fileName` prop. The dialog body read "{pendingFilePath} has unsaved changes" — backwards from reality. A user could panic-discard the wrong file or dismiss the dialog as a glitch and lose work on the actually-dirty file. Classic misleading-error-UI pattern.
- **Fix:** Pass `editorBuffer.filePath` (the currently-open dirty file) instead.
- **Commit:** `967c25f fix: address Claude review round 4 findings`

### 7. Missing loading indicator for async file-open IPC

- **Source:** github-claude | PR #38 round 2 | 2026-04-10
- **Severity:** HIGH
- **File:** `src/features/editor/hooks/useEditorBuffer.ts`, `CodeEditor.tsx`
- **Finding:** `useEditorBuffer.openFile` fired an async Tauri IPC `readFile` call with no `isLoading` flag exposed. During the IPC round-trip the editor kept showing the previous file's content (or the "No file selected" placeholder) with zero indication that the click registered. On slow disks or permission-checked reads the UI looked unresponsive. Users might click again, firing duplicate `openFile` calls; the race-guard silently discarded stale responses but the user had no feedback at all.
- **Fix:** Add `isLoading: boolean` to the EditorBuffer interface. Set true before `readFile` await, clear in a `finally` block — but only if the current request is still the latest, so stale responses from earlier calls don't flip it back to false while a newer read is still in flight. Render a glassmorphism loading overlay in CodeEditor with `role="status"` and a spinning progress icon.
- **Commit:** `0c8f0ac fix: address Claude review round 12 findings`
