---
id: async-race-conditions
category: react-patterns
created: 2026-04-09
last_updated: 2026-05-03
ref_count: 7
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
- **Fix:** Added `timeout: float = 600.0` to `ClaudeCliSession.__init__` (stored as `self.timeout`) and a per-call override on `query(prompt, *, timeout=None)`. Initial round-10 fix used `asyncio.timeout()` (3.11+ context manager), which the round-11 reviewer correctly flagged as silently breaking Python 3.10 — the harness has no version gate, and `AttributeError` on every query would cause every session to report `('error', ...)`. Round-11 fix replaces it with `asyncio.wait_for` + monotonic budget tracking (3.9+ compatible): each `readline()` + final `proc.wait()` gets `remaining = deadline - (time.monotonic() - start)` as its timeout. On timeout the existing `finally` block kills the process and resets `_started = False`.
- **Lesson:** Every time you add a subprocess deadline or other asyncio construct, check the Python version requirement of the API. `asyncio.timeout()` is 3.11+; `asyncio.wait_for()` is 3.4+. Prefer the broader-compat form unless a concrete dep actually requires 3.11+.
- **Commits:** (round 10 — asyncio.timeout attempt), (round 11 — wait_for rewrite)

### 17. Clean subprocess exit + ResultEvent(is_error=True) silently reported as success

- **Source:** claude-review | PR #73 | 2026-04-20 (round 11)
- **Severity:** MEDIUM
- **File:** `harness/agent.py`
- **Finding:** `run_agent_session` printed `[result: error]` when the terminal stream event carried `is_error=True` but still returned `('continue', response_text)`. Non-zero subprocess exit was already escalated via `RuntimeError`; clean-exit-but-session-errored (max-turns, rate-limit abort, transient tool failure) wasn't. Orchestrator would then run the reviewer against stalled output and burn a per-feature iteration.
- **Fix:** Track `result_errored = False` before the event loop; set it True in the `isinstance(event, ResultEvent) and event.is_error` branch; return `('error' if result_errored else 'continue', response_text)`. Added two regression tests with a `_FakeCliSession` subclass that scripts events (one error, one success).
- **Commit:** (round 11)

### 18. Listener-attach race in `useAgentStatus` — duplicate `handleDetection` fires `start_agent_watcher` before listeners are attached

- **Source:** local-handed-back during sub-agent task | PR #109 round 7 (Task 7) | 2026-04-29
- **Severity:** HIGH (load-bearing for v1's no-cache design)
- **File:** `src/features/agent-status/hooks/useAgentStatus.ts`
- **Finding:** The hook had two `useEffect`s that both fired `handleDetection(sessionId)` on mount — one in the polling effect's "Run immediately on mount" line, and one in the subscribe effect's IIFE after `await subscribe()`. The polling-side call raced with subscribe and could fire `invoke('start_agent_watcher', …)` BEFORE `listen('test-run', …)` had attached. With v1 having no backend snapshot cache, the latest-of-replay batched emit fires once at the transcript watcher's first EOF and is gone — losing it to the race meant the panel stayed at `no runs yet` until the next live test run.
- **Fix:** Removed the duplicate `void handleDetection(sessionId)` from the polling `useEffect`. The subscribe `useEffect` already fires the initial detection after listeners are attached (and a comment in the file explicitly documented that intent). The `attaches test-run listener BEFORE invoking start_agent_watcher` regression test (added in the same task) caught the race on its first run with `expected 4 to be less than 2` — exactly the assertion shape it was designed to enforce.
- **Lesson:** in a "subscribe + then trigger the publisher" flow, having TWO triggers from independent effects is structurally fragile, even if one is "polling" and the other is "init". Pick a single trigger source. Also: the load-bearing regression test was the right shape — it asserted the call ORDER recorded by mocks, not the eventual outcome.
- **Commit:** `d7df1e5 feat(agent-status): test-run listener + ordering regression test`

### 19. Inner burst-drain loop missed `stop_flag`, delaying thread shutdown by up to a polling cycle (10s)

- **Source:** github-claude | PR #124 round 1 | 2026-05-02
- **Severity:** MEDIUM
- **File:** `src-tauri/src/git/watcher.rs`
- **Finding:** `spawn_trailing_debounce_thread`'s inner `Ok(()) => continue` arm (which drains a rapid filesystem-event burst before resetting the quiet timer) never inspected `stop_flag`. After `RepoWatcher` was dropped, the thread's only escapes from the inner loop were a 60ms quiet period (correctly skipping the emit) or `Disconnected`. `Disconnected` only fires when EVERY `Sender` clone drops — but the clone living inside the `RecommendedWatcher` notify-callback closure is held behind `Arc<Mutex<RecommendedWatcher>>`, shared with the polling thread. That Arc lives until the polling thread sees its own `stop_flag` check (up to `POLL_INTERVAL_SECS = 10s` later). Net effect: a continuous filesystem burst at watcher teardown could pin the debounce thread (and its captured `app_handle` / `state` / `toplevel` Arcs) for up to 10 seconds. No incorrect emits — `stop_flag` already guarded the emit path — but resource cleanup was substantially delayed and the thread's lingering Arcs blocked observable shutdown ordering.
- **Fix:** Added `if stop_flag.load(Ordering::Relaxed) { return; }` to the `Ok(()) => continue` branch (renamed to a block to host the check). One-line semantic addition; the inner loop now exits within one `recv_timeout(delay)` of the flag flipping, regardless of the polling-thread cleanup cadence. Same finding-class as #16 (subprocess stdout read with no deadline hangs forever) — both are "shutdown signal that doesn't propagate through every loop branch".
- **Commit:** _(see git log for the round-1 fix commit)_

### 20. Restore-after-failure path spawns a poll thread that immediately re-fires the same failure, looping forever

- **Source:** github-claude | PR #126 round 1 | 2026-05-02
- **Severity:** MEDIUM
- **File:** `src-tauri/src/git/watcher.rs`
- **Finding:** `restore_pre_repo_subscribers` is called after `upgrade_to_repo_watcher` succeeds for at least one subscriber on `safe_cwd` — meaning `safe_cwd` is, by construction, already a git repository at the moment of the restore. The original implementation unconditionally spawned a `spawn_pre_repo_poll_thread` whose loop body wakes every `POLL_INTERVAL_SECS` (10 s), checks `resolve_toplevel(&safe_cwd).is_ok()`, and re-runs `upgrade_to_repo_watcher` if so. Result: the poll thread always sees the parent path as a repo, always re-fires the upgrade, always fails for the same permanently-invalid subscriber paths, calls `restore_pre_repo_subscribers` again, and spawns the next thread. At steady state: one thread create/destroy + one `git rev-parse` subprocess + one `log::error!` per 10 s, indefinitely, per stranded subscriber. No state corruption, but unbounded log churn and CPU waste in long-running sessions. Same finding-class as #16 (subprocess stdout read with no deadline hangs forever) — a loop whose termination condition cannot be reached because the precondition is mis-modeled.
- **Fix:** Before calling `spawn_pre_repo_poll_thread` in the restore path, check `resolve_toplevel(&safe_cwd).is_ok()`. If yes, the parent is already a repo and the failed subscribers cannot become valid via the "directory becomes a repo" pathway — log a one-shot `log::warn!` documenting the terminal-stranded state and skip the spawn. The pre-repo entry remains so refcount accounting stays consistent; only the futile poll thread is suppressed. Lesson: any retry loop needs a termination condition that genuinely could fail at retry time, not one whose precondition was already true at spawn time.
- **Commit:** _(see git log for the round-1 fix commit)_

### 21. Notify+poll race in `TranscriptState::start_or_replace` spawns duplicate tail threads

- **Source:** github-claude | PR #152 round 1 | 2026-05-03
- **Severity:** MEDIUM
- **File:** `src-tauri/src/agent/adapter/base/transcript_state.rs`
- **Finding:** `start_or_replace`'s first `AlreadyRunning` guard was read-only and released the watchers lock BEFORE calling `adapter.tail_transcript()`. The Claude statusline watcher has two parallel triggers — the `notify::recommended_watcher` callback and a 3-second polling-fallback thread — that can both observe a new transcript path within the same status-file content batch. Both pass the first guard, both spawn a tail thread via `tail_transcript`, and both start reading the JSONL from byte 0 and emitting `agent-tool-call`/`agent-turn` events during the tens-of-ms thread-spawn window before the loser's handle is stopped at the second-lock insert step. Visible symptom: duplicate Activity Feed rows with identical Anthropic `tool_use_id` keys; React reconciles them as collisions and silently drops one row, producing an inaccurate per-tool count in the chip summary. Reproducing requires the 3s poll cycle to coincide with a notify event within milliseconds — rare but structurally guaranteed.
- **Fix:** Added a per-session `start_gates: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>` to `TranscriptState`. `start_or_replace` looks up (or lazily creates) the per-session `Arc<Mutex<()>>`, holds its lock across the AlreadyRunning check + `tail_transcript` spawn + watchers-map insert as one critical section. Different sessions still spawn concurrently because each session has its own gate. **Critical follow-up caught by codex verify:** initially `stop()` removed the gate from the map for cleanup, which reopened the race during concurrent shutdown/restart — a notify callback already inside `start_or_replace` would still hold a clone of the OLD gate's `Arc`, while a fresh start in the next moment would lookup the empty map slot, create a NEW gate, and enter `tail_transcript` concurrently with the in-flight start. Resolution: do NOT remove the gate in `stop()`. Gates are ~56 bytes (`String` key + `Arc<Mutex<()>>` value); leaving them for the session_id's lifetime is small enough that periodic cleanup isn't worth the lock-ordering complexity.
- **Lesson:** Same finding-class as #18 (subscribe-then-trigger race) and #19 (shutdown signal not propagated through every loop branch) — concurrent operations that need to be serialized at the producer boundary (here: tail-thread spawn) cannot rely on a check-then-act pattern that releases the lock between check and act. The cleanup-on-stop pattern looked obviously correct but reopened the same race the gate was added to prevent; codex verify caught it before commit. Rule: when adding a per-session gate map, document why it doesn't get cleaned up — or prove the cleanup path can't race with starts.
- **Commit:** _(see git log for the cycle-2 fix commit on PR #152)_

### 22. Gate-aware producer doesn't serialize against the consumer — zombie tailer from concurrent stop/start

- **Source:** github-claude | PR #152 round 2 | 2026-05-03
- **Severity:** MEDIUM
- **File:** `src-tauri/src/agent/adapter/base/transcript_state.rs`
- **Finding:** Follow-on to #21. The per-session `start_gates` mutex serialized concurrent `start_or_replace` calls, but `stop()` did NOT acquire the gate. Race: a notify callback enters `start_or_replace`, holds the gate, drops the watchers lock between the AlreadyRunning check and the `tail_transcript` spawn. During that window `stop()` runs (typically from `WatcherHandle::Drop` cascading after `state.remove(sid)` in `start_for`'s remove-then-insert flow), acquires the watchers lock, removes the existing entry, releases. `start_or_replace` then spawns T1, re-acquires the watchers lock, sees no entry, inserts T1 as `Started`. The `WatcherHandle` whose Drop called us has already been dropped — so no future `WatcherHandle::Drop` will stop T1. T1 is a zombie: holds a JSONL file handle, polls every 500ms, and leaves a live entry in `TranscriptState` that the frontend believes is stopped. Same finding-class as #21 (the producer's gate doesn't prevent races against operations that bypass the gate).
- **Fix:** `stop()` now acquires the per-session gate via the same lookup-or-create path as `start_or_replace` BEFORE touching `watchers`. Lock order is gate → watchers, matching `start_or_replace`. With both producer and consumer gated on the same `Arc<Mutex<()>>`, `stop()` blocks until any in-flight start finishes; the entry it removes is exactly the entry the start just inserted, so there is no zombie. Side benefit: the second post-spawn `(transcript_path, cwd)` identity check inside `start_or_replace` (and its paired spare-handle cleanup) is now provably unreachable — gate prevents concurrent starts, gated `stop()` doesn't insert — so the dead-code branch was removed (Claude review F5, same cycle).
- **Lesson:** Adding a producer-side mutex is half a fix. The other half is identifying every consumer-side path that mutates the same shared state and gating it on the same mutex with consistent lock ordering. The dead-code identity check that became unreachable is a useful sanity signal: when a "defensive" check inside a critical section is no longer reachable, that's a green light that the serialization is now complete. Conversely, if such a check would still trigger after the fix, the serialization isn't actually serializing.
- **Commit:** _(see git log for the cycle-3 fix commit on PR #152)_

### 23. Blocking `Drop` runs inside a `MutexGuard` scope, holding the mutex across thread joins

- **Source:** github-claude | PR #152 round 3 | 2026-05-03
- **Severity:** MEDIUM
- **File:** `src-tauri/src/agent/adapter/base/watcher_runtime.rs`
- **Finding:** `AgentWatcherState::remove` returned `watchers.remove(session_id).is_some()` as a tail expression. Per Rust's drop order, temporaries created in a tail expression drop in reverse creation order at the end of the block — BEFORE local variables. So the `Option<WatcherHandle>` returned by `HashMap::remove` dropped while the enclosing `MutexGuard` (the `watchers` lock) was still live. `WatcherHandle::Drop` calls `handle.join()` on the polling thread, which sleeps up to 3 seconds (one `POLL_INTERVAL`) — meaning the watchers mutex stayed locked for up to 3 seconds, blocking any concurrent `insert` / `remove` / `active_count`. Identical latent bug in `insert`: `HashMap::insert` returns the displaced `Option<WatcherHandle>` which dropped at the statement's semicolon while the guard was still in scope. Visible symptom: rapid session cycling or starting a second terminal while the first tears down would hang the UI for ~3 s.
- **Fix:** Scope the lock to a nested block in both methods. `let handle = { let mut watchers = …lock; watchers.remove(session_id) };` returns the `Option<WatcherHandle>` and the guard goes out of scope at the closing brace. The `WatcherHandle::Drop` then runs in the function body without holding the mutex. Same pattern as `TranscriptState::stop` in this same PR (which already had it).
- **Lesson:** When a type's `Drop` impl does blocking work (thread join, file flush, network shutdown, etc.) AND values of that type are removed/replaced inside locks, the lock scope must end before the `Drop` runs. Two typical Rust expressions hide this: (a) tail-expression `map.remove(k).is_some()` — the `Option` drops at end-of-block in reverse-creation order, AFTER the guard would otherwise drop; (b) `map.insert(k, v);` (statement) — the displaced `Option` drops at the semicolon, still inside the guard's scope. Fix: bind the removed/displaced value to a `let` outside the inner block. Rule of thumb: when `Drop` is blocking, treat the lock as a critical-section budget — one mutex acquisition per blocking Drop is fine, but a Drop chain (e.g. `WatcherHandle` containing `TranscriptHandle`) under the lock blocks every reader for the cumulative join time.
- **Commit:** _(see git log for the cycle-4 fix commit on PR #152)_

### 24. One ref overloaded to gate two distinct semantics — exit-collapse stuck when IPC failed

- **Source:** github-codex-connector | PR #152 round 5 (re-flagged from round 1 P2 to P1) | 2026-05-03
- **Severity:** P1 (originally P2; reviewer escalated after a skip-with-rationale)
- **File:** `src/features/agent-status/hooks/useAgentStatus.ts`
- **Finding:** A single `watcherStartedRef` ref was used to gate TWO distinct semantics: (a) "should we re-invoke `start_agent_watcher` on the next detection poll" — true if the watcher already started, false otherwise; (b) "should we run the exit-collapse path when the agent disappears" — early-return if the watcher never started. The two semantics are coupled only when start_agent_watcher always succeeds. When it can fail (transient `/proc` race in the backend's re-detection at `start_agent_watcher`), the ref stays false even though the agent was clearly observed (the prior `detect_agent_in_session` poll succeeded and `isActive` was set to true). The exit-collapse path then early-returns when the agent later exits, leaving the panel stuck in `isActive: true` forever. Codex initially flagged this as P2; my skip-with-rationale (arguing the clean fix needed frontend state changes that I considered out of Stage 1's "no-frontend-behavioral-changes" non-goal) was rejected as wrong on re-review (the non-goal was about IPC contracts, not internal state refs), and the finding was re-flagged P1 on round 5.
- **Fix:** Split the overloaded ref into two with distinct semantics: `agentEverDetectedRef` ("did detection ever succeed for this session") gates the exit-collapse path; `watcherStartedRef` ("did `start_agent_watcher` succeed") gates duplicate-start prevention and `stopWatchers` cleanup. The collapse path now runs whenever the agent was previously detected and is now gone, regardless of IPC failure. Backend re-detection in `start_agent_watcher` stays untouched — it can still fail and the frontend simply retries on the next 2s poll. Added a regression test that injects an `invoke('start_agent_watcher')` failure and asserts the panel still collapses after `EXIT_HOLD_MS`.
- **Lesson:** When a state-tracking ref ends up gating MORE than one semantic, that's a structural smell — the ref is doing the work of two refs, and the bug surface is the union of the cases where the two semantics disagree. Code-review heuristic: any `if (!ref.current) return` early-return inside an event handler should map to one specific question (e.g. "did this side-effect succeed"), not bundle two ("did anything happen yet AND did the side-effect succeed"). When unbundling, name each ref after the question it answers — `agentEverDetectedRef` and `watcherStartedRef` are clearly different questions; `watcherStartedRef` alone was carrying the load of both. Bonus heuristic on review-skip discipline: when a reviewer escalates a finding's priority (P2 → P1) after a skip-with-rationale, treat that as an explicit signal that the rationale was wrong — re-evaluate from scratch rather than re-arguing the skip.
- **Commit:** _(see git log for the cycle-6 fix commit on PR #152)_

---

### 25. Replace-on-cwd-change activates new tail thread before old one stops — duplicate events on the overlap

- **Source:** github-claude | PR #152 round 8 (cycle 10) | 2026-05-03
- **Severity:** MEDIUM
- **File:** `src-tauri/src/agent/adapter/base/transcript_state.rs`
- **Finding:** `start_or_replace`'s order was (spawn new tail → lock-insert (capturing old) → release lock → stop old). The "stop old outside the lock" pattern was correct for the no-lock-across-blocking-join invariant, but the new tail thread was already live (and emitting from byte 0) for ~POLL_INTERVAL (500 ms) before the old tail thread joined. On the cwd-change Replaced path (same `transcript_path`, different `cwd`) both threads tail the same JSONL file; `agent-tool-call` and `agent-turn` events fire twice (once from new's replay-from-byte-0, once from old's still-draining read buffer). The frontend has no `toolUseId`-level dedup on `recentToolCalls`, so users see duplicate entries and aggregate counters (`toolCalls.total`, `byType`) inflate. Same finding-class as #22 (gate-aware producer not serialised against consumer): a side effect that's safe in isolation creates an overlap window when paired with another side effect that operates on the same resource.
- **Fix:** Reordered the critical section to (lock-extract-old → release lock → stop-old (joining the thread) → spawn-new → lock-insert-new → release lock). Per-session gate already serialises `start_or_replace` and `stop` per session, so the gap between extract and re-insert is invisible to other callers (#22 ensured `stop` acquires the gate). Added a regression test (`replace_on_cwd_change_stops_old_before_spawning_new`) using a custom mock adapter that records the order of `tail_transcript` calls AND the order of stop-flag flips on returned handles; asserts `stop(A)` precedes `spawn(B)` in the recorded event log. Documented the trade-off: a `tail_transcript` failure now leaves the session with no watcher (regression vs. previous behaviour where old survived) — intentional for the cwd-change case (the old cwd is no longer the correct routing context, so a failed swap should fail loudly rather than silently keep a stale-cwd tailer alive).
- **Lesson:** The "no lock held across blocking join" invariant is necessary but not sufficient — it prevents lock-vs-Drop deadlocks, but doesn't prevent activation-before-teardown overlap. When replacing one long-lived background thread with another, ALSO ensure the old thread is fully joined before the new one starts emitting events for the same logical resource. The key question to ask while designing the lock-release order: "during the unlocked window, is anything observable to readers?" If the unlocked window contains a SPAWN (which immediately starts emitting) AND a STOP (which is in-flight), readers see both threads' output during the overlap. The fix is to put the stop entirely before the spawn — even if it costs an extra lock acquisition for the insert. Code-review heuristic: any "extract-or-insert + outside-lock cleanup" pattern should be examined for whether the new resource is observable before the old resource is fully torn down.
- **Commit:** _(see git log for the cycle-10 fix commit on PR #152)_
