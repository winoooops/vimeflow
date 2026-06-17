---
id: editor-file-existence-probe
category: files
created: 2026-06-17
last_updated: 2026-06-17
ref_count: 0
---

# Editor File Existence Probe

## Summary

UI indicators that reflect whether an open editor file still exists on disk
need an existence signal that is both cheap and timely. Reading the full file
content just to learn whether the path exists wastes IPC bandwidth and
renderer CPU for large files, and depending only on git-state changes misses
files that never appear in `git status` (ignored artifacts, paths outside a
repo). Use a metadata-only filesystem probe, and keep polling when git status
cannot provide change notifications.

## Findings

### 1. `readFile` used as existence probe — full file content transferred for yes/no

- **Source:** github-claude | PR #510 round 6 | 2026-06-17
- **Severity:** MEDIUM
- **File:** `src/features/workspace/WorkspaceView.tsx` L1447-1461
- **Finding:** `checkSelectedFile` called `fileSystemService.readFile(editorBuffer.filePath)` and discarded the returned content; the only signal used was whether the call threw an ENOENT-shaped error. For large files this transferred the entire file over Rust-to-renderer IPC on every `selectedFileGitKey` change.
- **Fix:** Added a metadata-only `file_exists` IPC command to the Rust sidecar (`crates/backend/src/filesystem/exists.rs`) and exposed `fileExists(path)` on `IFileSystemService`. The probe now returns a boolean without reading content.
- **Commit:** same commit as this entry

### 2. Keep probing status-less editor files

- **Source:** github-codex-connector | PR #510 round 6 | 2026-06-17
- **Severity:** P2 / MEDIUM
- **File:** `src/features/workspace/WorkspaceView.tsx` L1472
- **Finding:** When the open file never appeared in `git status`, `selectedFileGitKey` stayed at the same `:none` value after the initial successful read. Deleting the file externally therefore did not re-run the existence probe, so `selectedEditorFileExists` remained `true` and the crumb never moved to `DELETED`.
- **Fix:** When `selectedFileGitKey.endsWith(':none')`, set a 2-second interval that re-runs the `fileExists` probe so status-less paths are still monitored for deletion. The interval is cleared when the effect cleans up.
- **Commit:** same commit as this entry
