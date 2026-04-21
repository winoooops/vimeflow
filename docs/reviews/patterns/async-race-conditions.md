---
id: async-race-conditions
category: react-patterns
created: 2026-04-09
last_updated: 2026-04-20
ref_count: 3
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

### 12. Transcript watcher starts tailer while holding registry mutex

- **Source:** github-claude | PR #63 round 2 | 2026-04-14
- **Severity:** MEDIUM
- **File:** `src-tauri/src/agent/transcript.rs`
- **Finding:** `TranscriptState::start_or_replace` called `start_tailing` while holding the `watchers` mutex. Starting the tailer opens the transcript file and spawns a background thread, so concurrent statusline callbacks could block on unrelated filesystem or thread-creation work.
- **Fix:** Use a double-check flow: check the active path under lock, start the tailer outside the lock, then re-acquire the lock before inserting. If a concurrent caller already registered the same path, stop the redundant new handle; if replacing an old path, stop the old handle outside the lock.
- **Verification:** `cargo test --lib agent::transcript -j1`, `cargo test --lib agent:: -j1`, `cargo fmt --check`.
- **Commit:** (pending — agent-status-sidebar PR)

### 13. Subprocess stdout streaming deadlocks on full stderr pipe

- **Source:** claude-review | PR #73 | 2026-04-20 (round 1 P2)
- **Severity:** MEDIUM
- **File:** `harness/cli_client.py`
- **Finding:** `ClaudeCliSession.query()` streamed stdout in the main loop and only read stderr after `proc.wait()`. On Linux the stderr pipe buffer is ~64 KB — a `claude -p` verbose stack trace overruns it and the child blocks on its own stderr write while the reader is blocked waiting for stdout EOF. The harness hangs forever instead of surfacing the CLI error.
- **Fix:** Spawn an `asyncio.create_task` that drains stderr in 4 KB chunks into a list concurrently with the stdout iteration; join it after stdout EOF; on non-zero exit, collected stderr is decoded and surfaced in the RuntimeError. Regression test stubs `_build_args` to point at `python3 -c "sys.stderr.write('X'*200_000); …"` with a 10 s `asyncio.wait_for` safety net.
- **Commit:** `e003e37 fix(harness): drain claude -p stderr concurrently to prevent deadlock`

### 14. Synchronous subprocess.run blocked the async event loop

- **Source:** claude-review | PR #73 | 2026-04-20 (round 4)
- **Severity:** MEDIUM
- **File:** `harness/policy_judge.py`
- **Finding:** `_query_claude` used `subprocess.run`. In the SDK backend, `bash_security_hook` is awaited on the main harness event loop — under `HARNESS_POLICY_JUDGE=ask` a judge call would stall all async I/O for up to 60 s. The CLI backend was unaffected (fresh `asyncio.run` loops per hook_runner subprocess).
- **Fix:** Entire chain is async — `_query_claude` uses `asyncio.create_subprocess_exec` + `asyncio.wait_for`; `_consult_judge` and `decide` are `async def`; `security.py` awaits `_judge_decide`. The `subprocess.run` form stays banned from any code reachable from an `async def` security hook.
- **Commit:** `545b0b5 fix(harness): round-4 review — async judge, user-private cache, brace-safe prompt`

### 15. `_started` session flag survived cancellation / non-zero exit

- **Source:** claude-review | PR #73 | 2026-04-20 (rounds 3, 5, 7)
- **Severity:** LOW
- **File:** `harness/cli_client.py`
- **Finding:** `ClaudeCliSession.query()` set `self._started = True` before the subprocess's exit code was checked (and kept it True after `asyncio.CancelledError`). If the process spawned but exited non-zero — or was killed by an outer `asyncio.wait_for` — the flag stuck, and the next `query()` passed `--resume` against a session the CLI never persisted. Wasted one round-trip before self-healing via the non-zero-exit branch.
- **Fix:** Set `_started = True` only after a successful `create_subprocess_exec`. Roll back to `False` in both the non-zero-exit branch and the `finally` block when `proc.returncode is None` (cancel / kill). Now multi-turn retries always pick `--session-id` for the next attempt when the previous session didn't get persisted.
- **Commits:** `0f76df4` (move after spawn), `97454bb` (reset in finally)

### 16. Subprocess stdout read with no deadline hangs forever on stall

- **Source:** claude-review | PR #73 | 2026-04-20 (round 10)
- **Severity:** HIGH
- **File:** `harness/cli_client.py`
- **Finding:** `ClaudeCliSession.query()` read stdout with `async for raw_line in proc.stdout:` and no timeout. If `claude -p` stalls — network failure, auth expiry mid-stream, CLI internal deadlock — the harness blocks indefinitely. The SDK backend got implicit HTTP-level timeouts from httpx; the subprocess refactor lost them. The existing regression tests used `asyncio.wait_for(run(), timeout=10)` as a "safety net so the suite doesn't hang forever" — which was the clue that production code had no such net.
- **Fix:** Added `timeout: float = 600.0` to `ClaudeCliSession.__init__` (stored as `self.timeout`) and a per-call override on `query(prompt, *, timeout=None)`. Wrap the stdout read + wait in `asyncio.timeout(deadline)` (Python 3.11+ context manager form). On timeout the existing `finally` block kills the process and resets `_started = False` so the orchestrator can retry with a fresh `--session-id`. Regression test stubs `_build_args` to a Python one-liner that prints one JSON line then `time.sleep(30)`, with a 2 s session timeout and a 10 s outer `asyncio.wait_for` safety net.
- **Commit:** (round 10)
