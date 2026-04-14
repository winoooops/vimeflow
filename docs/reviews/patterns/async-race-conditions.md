---
id: async-race-conditions
category: react-patterns
created: 2026-04-09
last_updated: 2026-04-14
ref_count: 1
---

# Async Race Conditions

## Summary

Async operations (file fetches, syntax highlighting) can resolve out of order
when inputs change rapidly (tab switching, fast navigation). Always track the
current request and discard stale responses. Clear state on new requests to
prevent showing previous data.

## Findings

### 1. Stale file content renders when switching tabs quickly

- **Source:** github-codex | PR #23 | 2026-04-04
- **Severity:** HIGH
- **File:** `src/features/editor/hooks/useFileContent.ts`
- **Finding:** `useFileContent` keeps previous content while new fetch is in-flight and doesn't guard against out-of-order responses
- **Fix:** Track requested path via ref, ignore stale responses, clear content on new fetch
- **Commit:** `397353a feat: add IDE-style Editor view with file explorer and syntax highlighting (#23)`

### 2. Async syntax highlighting applies stale results

- **Source:** github-codex | PR #23 | 2026-04-04
- **Severity:** MEDIUM
- **File:** `src/features/editor/components/CodeEditor.tsx`
- **Finding:** Async `highlightCode` in useEffect has no cancellation — slower prior highlight can overwrite current
- **Fix:** Added cancellation flag in effect cleanup
- **Commit:** `397353a feat: add IDE-style Editor view with file explorer and syntax highlighting (#23)`

### 3. Selected file index out of range after refresh

- **Source:** github-codex | PR #21 | 2026-04-03
- **Severity:** MEDIUM
- **File:** `src/features/diff/DiffView.tsx`
- **Finding:** After staging/discarding, `refreshStatus()` shrinks `changedFiles` but index is never clamped
- **Fix:** Clamped `selectedFileIndex` when `changedFiles` updates
- **Commit:** `92eff2e feat: add lazygit-style git diff viewer (#21)`

### 4. CodeEditor `loadFile` has no stale-response guard

- **Source:** github-claude | PR #38 round 1 | 2026-04-10
- **Severity:** HIGH
- **File:** `src/features/editor/components/CodeEditor.tsx`
- **Finding:** CodeEditor's `loadFile` effect awaits `fileSystemService.readFile(filePath)` with no cancellation. Rapid A→B file switches could race: if A's read resolved after B's, the effect would overwrite B's content with A's — displaying the wrong file and risking `:w` writes to the wrong path.
- **Fix:** Add a `cancelled` flag guard in the effect. The cleanup function flips the flag so stale completions become no-ops.
- **Commit:** `dd4fc02 fix: address Codex review round 1 findings`

### 5. `useEditorBuffer.openFile` last-write-wins missing

- **Source:** github-claude | PR #38 round 11 | 2026-04-10
- **Severity:** MEDIUM
- **File:** `src/features/editor/hooks/useEditorBuffer.ts`
- **Finding:** Two rapid file clicks within the IPC round-trip window could race: if file2's read resolved before file1's, state briefly showed file2, then file1's delayed response overwrote it — leaving the editor displaying file1 while filePath pointed at file2, causing `:w` to write one file's contents to another file's path.
- **Fix:** Add a monotonically-increasing `openRequestIdRef` counter. Each invocation captures its own id before the await and compares it against the ref after — stale responses are silently discarded. Last call wins.
- **Commit:** `6681af0 fix: address Claude review round 11 findings`

### 6. Single try/catch conflates save-failure and open-failure messages

- **Source:** github-claude | PR #38 round 5 | 2026-04-10
- **Severity:** HIGH
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** `handleSave` wrapped both `saveFile()` and `openFile(pendingFile)` in a single try/catch. A successful save followed by a failed pending-open reported as "Failed to save: ..." — misleading users into thinking their edits were lost when the file was actually on disk. `isDirty` was simultaneously false (save succeeded) while the dialog showed a save error — a deceptive state.
- **Fix:** Split into two phases. Save in its own try/catch — on failure, set saveError and keep the dialog open. After success, close the dialog and open the pending file in a second try/catch; surface open failures via the workspace-level fileError banner with an accurate message.
- **Commit:** `28027a5 fix: address Claude review round 5 findings`

### 7. `handleDiscard` React 18 scheduler race — wrong filename flashes in dialog

- **Source:** github-claude | PR #38 round 9 | 2026-04-10
- **Severity:** MEDIUM
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** `handleDiscard` awaited `openFile(pendingFilePath)` BEFORE calling `setShowUnsavedDialog(false)`. React 18's scheduler can flush `openFile`'s state updates (setFilePath / setCurrentContent) as a separate render before the dialog-close batch, briefly rendering the dialog as "{newFile} has unsaved changes" while the new file is already loaded. A user who hit Save in that flicker would overwrite the freshly-read disk content with content they just chose to discard.
- **Fix:** Close the dialog synchronously at the top of the handler, then run the async open. Pending-file open errors surface via the workspace-level banner.
- **Commit:** `3aa2c5d fix: address Claude review round 9 findings`

### 8. `handleSave` reads stale `pendingFilePath` closure after await

- **Source:** github-claude | PR #38 round 10 | 2026-04-10
- **Severity:** MEDIUM
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** `handleSave` read `pendingFilePath` from its `useCallback` closure after `await editorBuffer.saveFile()`. If the user clicked the backdrop (handleCancel) while the save was in flight, `pendingFilePath` state was cleared to null, but the running handler's closure kept the old non-null value and opened the cancelled pending file.
- **Fix (partial):** Round 10 captured `const pendingPath = pendingFilePath` at the top. Round 11 pointed out this was the same stale-closure pattern. Final fix: mirror `pendingFilePath` into `pendingFilePathRef` and read from the ref AFTER the save completes.
- **Commit:** `4f6972f fix: address Claude review round 10 findings` then `6681af0 fix: address Claude review round 11 findings`

### 9. `pendingFilePathRef` updated via useEffect — microtask race

- **Source:** github-claude | PR #38 round 14 | 2026-04-10
- **Severity:** MEDIUM
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** The `pendingFilePathRef` mirror was synced via `useEffect(() => { pendingFilePathRef.current = pendingFilePath }, [pendingFilePath])`. `useEffect` is a paint-time callback that runs AFTER the microtask queue drains. When `handleCancel` scheduled a state update and the save IPC promise resolved as a microtask, `handleSave` resumed BEFORE the useEffect ran — so the ref was still non-null and the cancelled pending file opened anyway.
- **Fix:** Add `setPendingFilePathSynced(value)` helper that writes the ref directly AND calls setState. Use it from all handlers that clear `pendingFilePath`. The useEffect mirror stays as an initial-value safety net but is no longer load-bearing.
- **Commit:** `fa933d6 fix: address Claude review round 14 findings`

### 10. Uncancelled collapse timeout hides active agent panel

- **Source:** local-codex | feat/agent-status-sidebar | 2026-04-12
- **Severity:** P2
- **File:** `src/features/agent-status/hooks/useAgentStatus.ts`
- **Finding:** The `setTimeout` in the exit detection path schedules `isActive` to flip to false after 5s, but there is no cancellation when the agent is detected again in that window. If the detection poll briefly misses the agent or it restarts quickly, the pending timeout fires and collapses the panel while the agent is still running.
- **Fix:** Store the timeout ID in `collapseTimeoutRef` and clear it on subsequent detections or session change.
- **Commit:** (pending — agent-status-sidebar PR)

### 11. Transcript watcher ignores updated transcript paths

- **Source:** local-codex | feat/agent-status-sidebar | 2026-04-14
- **Severity:** HIGH
- **File:** `src-tauri/src/agent/transcript.rs`
- **Finding:** `TranscriptState` keyed active transcript tailers only by PTY session ID. Once a watcher started for a session, later statusline updates with a different `transcript_path` were ignored, leaving the backend tailing a stale Claude transcript while the active task wrote tool calls to a new JSONL file.
- **Fix:** Track the active transcript path alongside each watcher. When statusline reports a different path for the same session, start tailing the new file and stop the old handle.
- **Runtime evidence:** Active PTY session `bac78089-299d-431d-b0d0-89c2c19bc610` first tailed `f4c8dc90-0091-4943-8fca-5fc397fd59ef.jsonl`, but the current statusline later pointed at `13faa90a-65ec-4e5f-9bf2-481d9f0313a6.jsonl`, which contained the missing `Skill`, `Bash`, and long-running `Agent` tool calls.
- **Verification:** Added `transcript_state_replaces_changed_path` regression coverage; manual retest confirmed tool calls reappeared after restarting the app.
- **Commit:** (pending — agent-status-sidebar PR)
