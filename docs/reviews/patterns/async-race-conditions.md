---
id: async-race-conditions
category: react-patterns
created: 2026-04-09
last_updated: 2026-05-30
ref_count: 14
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

### 26. Polling fallback sleeps through watcher drop, blocking teardown for one full interval

- **Source:** github-claude | PR #152 post-merge review | 2026-05-03
- **Severity:** HIGH
- **File:** `src-tauri/src/agent/adapter/base/watcher_runtime.rs`
- **Finding:** `WatcherHandle::Drop` signalled the statusline polling fallback with an atomic flag, but the polling thread spent most of its life inside `sleep(Duration::from_secs(3))`. Drop then joined the thread, so teardown could block for almost the full polling interval even though the stop signal had already been set.
- **Fix:** Replaced the atomic sleep loop with `Arc<(Mutex<bool>, Condvar)>`. Drop sets the stop flag and wakes the condvar before joining, so the polling thread exits immediately instead of waiting for the timeout. The inline initial-read path now also updates the debounce timestamp so a notify event for the same status content does not immediately replay it.
- **Commit:** _(pending on this branch)_

### 27. Agent detection results can outlive their session

- **Source:** github-claude | PR #152 post-merge review | 2026-05-03
- **Severity:** MEDIUM
- **File:** `src/features/agent-status/hooks/useAgentStatus.ts`
- **Finding:** An in-flight `detect_agent_in_session` promise could resolve after `sessionId` changed and still mark the old result active on the new session. Cleanup also called `stop_agent_watcher` on unmount/session change even when `start_agent_watcher` had never succeeded, creating noisy stop calls against sessions with no watcher.
- **Fix:** Re-check `prevSessionIdRef.current` after the detection await and discard stale results. Gate cleanup on `watcherStartedRef.current`, reset that ref when cleanup runs, and keep the activation `setStatus` scoped to the same session id. Added hook regressions for stale detection, unknown backend agent types, and cleanup before/after watcher start.
- **Commit:** _(pending on this branch)_

---

### 28. Cleanup gated on local "started" ref ignores backend reality after a failed stop

- **Source:** github-codex-connector | PR #153 round 1 | 2026-05-03
- **Severity:** P2
- **File:** `src/features/agent-status/hooks/useAgentStatus.ts`
- **Finding:** All three cleanup paths in `useAgentStatus` (session-change `useEffect`, detection-loop's "agent gone" branch, and the unmount cleanup) gated `stop_agent_watcher` invocation on `watcherStartedRef.current`. That ref reflects only the LAST local start outcome — it is set to `true` on a successful `start_agent_watcher` IPC, set to `false` on session change / unmount, and (by the same handler) set to `false` BEFORE awaiting the stop call. If the stop IPC then fails (transient ID lookup miss, IPC-channel hiccup), `stopWatchers` swallows the error and the ref stays `false` while the BACKEND watcher is still alive. The next session-change or unmount cleanup path re-evaluates `watcherStartedRef.current === false` and skips the stop entirely — leaking the backend watcher for the previous session. Same finding-class as #24 (one ref overloaded to gate distinct semantics). The ref now answers "did the local start succeed and stay successful through any cleanup", which is NOT the same as "is the backend watcher alive for this session".
- **Fix:** Removed the `watcherStartedRef.current` guard from all three cleanup paths. `stopWatchers` already swallows errors via `try { ... } catch {}`, so an IPC against a never-started watcher is a harmless no-op (it errors with "no active watcher", which gets dropped). Always invoking stop ensures retry-on-the-next-cleanup-path even when a prior stop failed. The ref is still set to `false` in cleanup so duplicate-start prevention in the detection loop works correctly. Updated two existing tests (`does not stop watcher on unmount if watcher never started` and `does not stop watchers when sessionId changes before watcher starts`) — both inverted to assert the new contract that stop is always called.
- **Lesson:** A local "started" or "active" ref tells you what your code DID, not what the SYSTEM IS. When the cleanup contract requires "ensure the backend resource is freed," gating cleanup on a local ref that mirrors only the last local action will leak whenever the backend state diverges. Two heuristics: (1) for cleanup IPC that is idempotent and error-suppressing (the "fire and forget on best effort" pattern), drop the local-state gate entirely — the IPC's idempotence is the contract. (2) If the IPC isn't idempotent, the ref must be updated AFTER the IPC completes, not before — otherwise a failure leaves the ref out of sync with reality. Compare to #24 (ref overloaded to gate two unrelated semantics) — same root cause family: a single ref cannot capture both "what the code attempted" and "what the system reflects after that attempt."
- **Commit:** _(see git log for the cycle-1 fix commit on PR #153)_

---

### 29. Two-syscall TOCTOU window in error-variant classification — fallback fired for all kinds, not just ambiguous ones

- **Source:** github-claude | PR #153 round 2 | 2026-05-03
- **Severity:** LOW
- **File:** `src-tauri/src/agent/adapter/claude_code/transcript.rs`
- **Finding:** `validate_transcript_path` called `fs::canonicalize(&path)`, and on failure used `path.try_exists()` to choose between `NotFound` and `Other`. The `try_exists` call is a SECOND syscall — between the failed canonicalize and the existence probe, a file at `path` could be created (race produces false `Other` from the canonicalize error message even though the file now exists) or deleted (race produces false `NotFound` for an unrelated permissions failure that happened to coincide with a delete). The validation result (path is rejected) is unchanged; only the diagnostic-classification variant changes, which downstream tools key off (`Missing` → "not appeared yet" pulse vs. `Other` → "validation rejection"). Same finding-class as classic TOCTOU but on the error-classification axis rather than the access-decision axis. The first attempt at the fix (cycle-2 retry 0) prepended `e.kind() == NotFound` correctly but kept the unconditional `try_exists()` fallback for ALL other error kinds — codex flagged this as PARTIAL since the race window was narrowed but not eliminated for kinds like `Interrupted`, `InvalidData`, etc.
- **Fix:** Tightened classification to read `e.kind()` first and ONLY fall back to `try_exists()` for the genuinely-ambiguous `PermissionDenied` case (Windows can return it for missing-but-unreadable parents, where `try_exists()` is the authoritative classifier). All other kinds map directly to `Other` from the original error — no second syscall, no race window. The `NotFound` kind maps directly to `NotFound` variant. The lesson: when classifying an error from a syscall failure, the `ErrorKind` from the SAME failure is your authoritative source — additional syscalls open TOCTOU windows. Only use a second syscall when the first kind is genuinely ambiguous, and document explicitly which kinds qualify (and on which platforms) so future maintainers don't re-broaden the fallback. A "narrow the window" fix is not the same as a "close the window" fix; verify-loop discipline matters here.
- **Commit:** _(see git log for the cycle-2 fix commit on PR #153)_

---

### 30. Microtask vs macrotask race: ref written in `useEffect` is stale when promise continuation runs

- **Source:** github-claude | PR #153 round 7 | 2026-05-03
- **Severity:** MEDIUM
- **File:** `src/features/agent-status/hooks/useAgentStatus.ts`
- **Finding:** The stale-detection guard in `handleDetection` compared `prevSessionIdRef.current !== sid` after each IPC await, where `prevSessionIdRef` was written inside the session-change `useEffect`. JavaScript event-loop semantics: after a sync block, the microtask queue drains BEFORE the next macrotask. React commit-phase (where useEffect bodies run) is scheduled as a macrotask. So when `sessionId` changes during an in-flight `detect_agent_in_session` IPC, the IPC's promise resolution microtask runs BEFORE the session-change `useEffect` macrotask — `prevSessionIdRef.current` is still the OLD value, the guard does NOT fire, and stale state (`isActive: true`, `agentEverDetectedRef = true`, a spurious `start_agent_watcher` IPC) gets applied for the old session. The bug is self-correcting once the effect fires (next render cleans up), but the stale render is visible and the extra IPC is wasteful. `act()` in React Testing Library synchronously flushes effects, collapsing the macrotask gap and hiding the race in tests — which is why this slipped through the cycle-0 stale-detection fix.
- **Fix:** Introduced `currentSessionIdRef`, written SYNCHRONOUSLY at the top of the component body (during render), so its value is always the most recently rendered `sessionId`. Replaced the two `prevSessionIdRef.current !== sid` checks in `handleDetection` (post-detect and post-start) with `currentSessionIdRef.current !== sid`. Writing during render is synchronous: by the time any IPC continuation runs, the ref reflects the latest `sessionId` regardless of whether the session-change effect has fired. `prevSessionIdRef` is preserved for other code paths that need session-boundary detection. The lesson: refs written in `useEffect` are subject to React's scheduler timing — they're written in the commit-phase macrotask, NOT synchronously when the underlying state changes. Promise continuations queued during render or before commit will see the stale ref value. For race-sensitive guards across async boundaries, write the ref DURING RENDER (top-of-component-body assignment) so it always reflects the latest props/state synchronously. Code-review heuristic: any `if (someRef.current !== capturedValue)` guard placed AFTER an `await` should be checked for "where is `someRef` written?" — if it's written in a `useEffect`, the guard is potentially defeated by microtask ordering.
- **Commit:** _(see git log for the cycle-7 fix commit on PR #153)_

---

### 31. Stale watcher stop targets wrong session ID when workspace→PTY mapping is unregistered mid-flight

- **Source:** github-codex-connector | PR #153 round 7 | 2026-05-03
- **Severity:** P1
- **File:** `src/features/agent-status/hooks/useAgentStatus.ts`
- **Finding:** In the stale-start cleanup branch of `handleDetection`, after `start_agent_watcher` resolves and the post-start guard fires, the code called `stopWatchers(sid)`. `stopWatchers` resolved the PTY ID via `getPtySessionId(workspaceSessionId) ?? workspaceSessionId` — falling back to the workspace ID if the mapping was unregistered. During a session switch / close race, the workspace→PTY mapping CAN be unregistered between the `getPtySessionId` call at the top of `handleDetection` (where the watcher was started) and the post-start cleanup branch firing. The stop IPC then targets the workspace ID, which the backend doesn't recognise as a watcher key — so `stop_agent_watcher` errors out (silently, since `stopWatchers` swallows errors) and the newly-started backend watcher KEEPS running. That watcher then continues emitting stale status events for the old session, polluting the new session's UI state.
- **Fix:** `stopWatchers` now accepts an optional `knownPtyId` second parameter that bypasses `getPtySessionId` lookup when provided. The stale-start cleanup site captures the `ptySessionId` at the top of `handleDetection` (which is the SAME value `start_agent_watcher` was called with) and passes it through to the stop call. Other `stopWatchers` callers (session-change `useEffect`, detection-loop "agent gone" branch, unmount cleanup) don't have a captured PTY ID at hand, so they continue to use the lookup-based form — that's correct because those paths run when the workspace→PTY mapping is still authoritative for the session being torn down. The lesson: when an async operation returns a resource handle (here: a backend watcher keyed by PTY ID), the cleanup MUST use the SAME handle the operation produced, not re-derive it from a side-channel that may have changed. Code-review heuristic: any `start_X(idA)` followed by error-path `stop_X(getId(idB))` is suspect — the cleanup ID derivation lookup is a different source of truth from the start-time ID, and async windows let them diverge. Capture-and-reuse is the correct discipline.
- **Commit:** _(see git log for the cycle-7 fix commit on PR #153)_

---

### 32. Capture-and-reuse extended: same race exists for unmount/session-change cleanup, AND clearing the captured key before the fire-and-forget stop completes loses the retry handle

- **Source:** github-claude (F16) + github-codex-internal-verify (HIGH on first attempt) | PR #153 round 9 | 2026-05-03
- **Severity:** LOW (original finding) escalated to HIGH during verify retry-1 by codex
- **File:** `src/features/agent-status/hooks/useAgentStatus.ts`
- **Finding:** Cycle-7's #31 fix added `knownPtyId` to `stopWatchers` and used it ONLY at the stale-start cleanup site. Cycle-9's Claude review (F16) flagged that the OTHER three cleanup paths (session-change, detection-loop "agent gone", unmount) have the IDENTICAL race: if the PTY closes before the React component runs cleanup, `getPtySessionId` returns `undefined`, the lookup falls back to the workspace ID, and the backend watcher leaks. Adding `knownPtyIdRef = useRef<string | undefined>` written when watcher starts AND passing it from each cleanup path solves the user-visible problem — but the FIRST attempt cleared the ref synchronously after the fire-and-forget `stopWatchers` dispatch. Codex verify retry-1 flagged this as HIGH: `stopWatchers` swallows errors, so a transient failure leaves the watcher alive AND drops the captured key — a follow-up cleanup path (e.g., session-change firing after a failed detection-loop-exit stop) would then have no PTY id and re-trigger the original leak. The retry-1 implementation simultaneously CLOSED the original race AND opened a different race in the cleanup-state machine.
- **Fix:** Cycle-9 retry-2 preserves the ref across cleanup paths that have a follow-up retry path: detection-loop-exit reads `knownPtyIdRef.current` but does NOT clear it (session-change cleanup is the natural retry, and it WILL clear after the new session takes over). Session-change cleanup reads the ref, then clears (no further path will ever target the OLD session — polling interval is cleared synchronously, in-flight detection promises bail via the F11 stale-detection guard). Unmount reads the ref, then clears (no follow-up retry exists; hook is unmounting). The lesson: when extending a "capture-and-reuse" pattern across multiple cleanup paths, model the cleanup state machine explicitly — for each cleanup path, ask "does another path provide a retry?" If yes, DO NOT clear the captured key here; let the retry path clear it. If no (terminal state like unmount), clear is fine. Code-review heuristic: clearing a retry handle BEFORE the operation it gates has succeeded turns "best-effort idempotent retry" into "best-effort one-shot — and we lost the handle." Either await the operation before clearing OR don't clear in non-terminal cleanup paths.
- **Commit:** _(see git log for the cycle-9 fix commit on PR #153)_

---

### 33. Render-time-written ref protects session-change race but NOT post-unmount race; mount-flag must reset on StrictMode remount

- **Source:** github-claude (F19) + github-codex-internal-verify (NEW HIGH on retry-0) | PR #153 round 10 | 2026-05-03
- **Severity:** HIGH (Claude's original finding) + HIGH (codex-flagged StrictMode regression on first repair attempt)
- **File:** `src/features/agent-status/hooks/useAgentStatus.ts`
- **Finding:** Cycle-7's #30 fix introduced `currentSessionIdRef` written synchronously during render to defeat the microtask/macro-task gap that let post-detect IPC continuations apply stale state across session changes. Cycle-10's Claude review (F19) flagged that this fix has a critical scope limitation: `currentSessionIdRef` is updated only DURING render. Unmount does NOT trigger a render, so after unmount cleanup runs, `currentSessionIdRef.current` still holds the last-rendered `sessionId`. An in-flight `detect_agent_in_session` that resolves with `sid === currentSessionIdRef.current` (still the unmounted session) passes both stale guards, finds `watcherStartedRef.current === false` (cleared by unmount cleanup), and invokes `start_agent_watcher` — leaking a backend watcher with no React-side cleanup path. The first repair attempt added `isMountedRef = useRef(true)` flipped to `false` in unmount cleanup. Codex verify retry-0 immediately flagged a NEW HIGH: `useRef(true)` is initialized once per hook instance, not per mount. React StrictMode's dev mount→cleanup→remount cycle runs cleanup once on initial mount; without resetting the ref, every subsequent detection in dev permanently bails. The first fix introduced a second bug while closing the first.
- **Fix:** Cycle-10 retry-1 owns `isMountedRef` from a dedicated `useEffect(() => { isMountedRef.current = true; return () => { isMountedRef.current = false } }, [])`. Setup runs on mount AND on StrictMode remount; cleanup runs on real unmount AND on StrictMode's mid-cycle teardown. Both detection guards now check `!isMountedRef.current || currentSessionIdRef.current !== sid`. Added regression test that holds the detect promise pending, unmounts, then resolves positive — asserts `start_agent_watcher` is never invoked. The lesson: render-time-written refs ARE race-free against microtask/macrotask gaps for session-change races, but they cannot protect unmount races because unmount doesn't re-render. Mount-tracking refs need their own dedicated `useEffect([])` whose setup AND cleanup form a balanced pair — anything else fails StrictMode's "is it idempotent?" check. Code-review heuristic: when a hook references `componentWillUnmount`-style cleanup state (`isMounted`, `cancelled`, `aborted`), prefer the dedicated-effect pattern over inlining the flip into another effect's cleanup. The dedicated effect makes the StrictMode-correctness invariant local and visible.
- **Commit:** _(see git log for the cycle-10 fix commit on PR #153)_

---

### 34. Stale `start_agent_watcher` resolution tore down newer same-sid watcher

- **Source:** github-codex-connector | PR #154 round 1 | 2026-05-04
- **Severity:** P1
- **File:** `src/features/agent-status/hooks/useAgentStatus.ts`
- **Finding:** When `start_agent_watcher` was invoked twice for the same sid (e.g. an exit/re-detect cycle where the agent briefly disappears and re-spawns), the older invocation's await could resolve AFTER the newer one had already registered a backend watcher. The stale-guard branch unconditionally called `stopWatchers(sid, ptySessionId)`. Because `stop_agent_watcher` is keyed only by session ID on the backend, that stop tore down the _current_ (newer) watcher — silencing status / tool-call events until the next detection poll restarted it.
- **Fix:** Gate the stop on `!newerSameSidSucceeded` where `newerSameSidSucceeded = (currentSessionIdRef.current === sid) && (watcherStartGenerationRef.current !== startGeneration) && watcherStartedRef.current`. The three conjuncts identify "newer same-sid registrant succeeded" and only that case. On every other bail path (sid switch, unmount, agent exit, our own bumped-gen with no successor) the stop must still fire — sid-switch and unmount cleanups can't help when `knownPtyIdRef` is still unset, so the stale-resolution branch is the only place that has the captured `ptySessionId`. The lesson: when a backend resource is keyed by a coarse-grained ID (sid) but the frontend can have multiple parallel registrants for that same ID over time, the stale-cleanup path must distinguish "newer registrant for SAME ID exists" (skip stop) from "different ID" (always stop) — using a ref triple `(id-match, generation-bumped, success-flag-set)` rather than any one of them alone.
- **Commit:** _(see git log for the round-1 fix commit on PR #154)_

### 35. SessionTab fired redundant `setActiveSession` IPC on already-active tab click — interfered with `useSessionManager` request-supersession rollback

- **Source:** github-codex-connector | PR #174 round 19 | 2026-05-07
- **Severity:** P2
- **File:** `src/features/workspace/components/SessionTabs.tsx`
- **Finding:** `SessionTab` dispatched `onSelect(session.id)` on EVERY pointer click and Enter/Space keypress, regardless of whether the tab was already the active tab. `WorkspaceView` bridges `onSelect` to `setActiveSessionId`, which always issues `service.setActiveSession(...)` — so each idle click on the active tab became a redundant Tauri IPC round-trip. Worse: `useSessionManager` uses the request-supersession pattern (a later request supersedes an earlier in-flight one for transient-failure rollback). A no-op same-id "switch" would supersede a real prior switch attempt, and if the real one transiently failed, the rollback machinery would skip it — leaving the displayed selection out of sync with the backend. Hard to repro without simulated transient IPC failure, but the fix is one guard.
- **Fix:** Added `if (!isActive)` guard before `onSelect(session.id)` in BOTH activation paths (`onClick` and `handleKeyDown` for Enter/Space). Inactive-tab activation still dispatches normally; close-fallback selection from `SessionTabs.handleClose` is unaffected because it calls the parent `onSelect(nextId)` directly, bypassing the per-tab activation handlers. Comments at both call sites cite the IPC bridge AND the request-supersession rationale so future maintainers don't strip the guard for "clarity". Added regression test asserting click + Enter + Space on the already-active tab all leave `onSelect` un-called. Code-review heuristic: any UI activation gesture that dispatches an IPC must check whether the gesture changes state — the cost of "always dispatch and let downstream debounce" is invisible in steady-state but compounds with retry/supersession patterns under failure.
- **Commit:** _(see git log for the cycle-19 fix commit on PR #174)_

### 36. `setSessionActivePane` fired Rust `setActiveSession` while a concurrent `removePane` for the same pane had `kill` in flight

- **Source:** github-claude | PR #204 round 1 | 2026-05-13
- **Severity:** MEDIUM
- **File:** `src/features/sessions/hooks/useSessionManager.ts`
- **Finding:** Step 5c-2 added `service.setActiveSession(target.ptyId)` to `setSessionActivePane` to close 5c-1 Decision #10. The new `pendingPaneOps` ref already serialises `addPane` / `removePane` against each other, but `setSessionActivePane` predates the serialisation system and was never wired into the same guard. A user clicking an inactive pane while a concurrent `removePane` is in flight (kill IPC pending) hits a race window where `service.setActiveSession(target.ptyId)` can arrive at Rust either before or after the `kill` — when it arrives after, Rust briefly sets the active session to a PTY that's being killed. Any keyboard input delivered during the ~10–50 ms IPC round-trip is routed to the dying PTY and silently dropped. `removePane`'s own `setActiveSession(newActivePtyId)` self-corrects the state, but the dropped input is unrecoverable.
- **Fix:** Added `if (pendingPaneOps.current.has(sessionId)) return` at the TOP of `setSessionActivePane`'s body — the whole mutation (React state + IPC) is a no-op while a lifecycle op is pending. Skipping the React state mutation too (not just the IPC, as Claude originally suggested) closes a second sub-case: the targeted pane may evaporate when the remove commits, so flipping its `active=true` is futile. Test: synthesised the race by leaving `service.kill` pending via `mockImplementationOnce(new Promise)`, called `setSessionActivePane` during the window, asserted active flag + Rust IPC stay unchanged. Code-review heuristic: any newly-added IPC inside a mutation that ALREADY participates in a serialisation system must extend the gate, not bypass it.
- **Commit:** _(see git log for the cycle-1 fix commit on PR #204)_

### 37. Memoized listener initialization kept a failed promise and leaked partially attached listeners

- **Source:** github-claude | PR #211 round 1 | 2026-05-16
- **Severity:** MEDIUM
- **File:** `src/features/terminal/services/desktopTerminalService.ts`
- **Finding:** `DesktopTerminalService.ensureListeners()` memoized its initialization promise, but if `listen('pty-data')` succeeded and a later `listen()` call failed, the rejected promise stayed in `initPromise` forever while the already-attached listener was never cleaned up. Every future `spawn()` / `onData()` reused the rejected promise and the service could not recover without a page reload; the stray partial listener also continued to dispatch into the singleton's callback arrays. Same class as async singleton startup races: a failed initialization must not become the terminal cached state, and partially-created resources must not escape a failed transaction.
- **Fix:** Stage `UnlistenFn`s in a local array until all backend listeners attach. On any failure, reset `initPromise` to `null`, call each staged unlisten in a guarded cleanup loop, and rethrow so awaited callers still see the failure. Only publish staged unlisteners to `this.unlistenFns` after the full listener set is attached. Added regression coverage for partial-listener cleanup and successful retry after failure.
- **Commit:** _(see git log for the PR #211 round-1 fix commit)_

### 38. Dispose can invalidate an async singleton init while the init is still publishing resources

- **Source:** github-claude | PR #211 round 2 | 2026-05-16
- **Severity:** MEDIUM
- **File:** `src/features/terminal/services/desktopTerminalService.ts`
- **Finding:** After #37 staged terminal listener unlisteners locally, `dispose()` could still race with an in-flight initialization. `dispose()` cleared `this.unlistenFns` and nulled `initPromise`, but the async IIFE could later finish all three `listen()` calls and push the staged unlisteners into the newly-empty array after disposal had already returned. Those backend subscriptions would then stay open until process exit because no later dispose pass would see them. Same family as async singleton init races: shutdown must invalidate in-flight startup work before that work publishes resources.
- **Fix:** Added a listener-init generation counter. `dispose()` increments the generation before cleaning current unlisteners. Each `ensureListeners()` attempt captures the generation; if it changes before the attempt finishes, the attempt immediately calls every staged unlistener and returns without publishing them. Failure handling only clears `initPromise` when the failed attempt still belongs to the current generation, so an old post-dispose failure cannot clobber a newer retry. Added regression coverage that disposes while the first `listen()` promise is stalled, then verifies all late-resolved listeners are unlistened.
- **Commit:** _(see git log for the PR #211 round-2 fix commit)_

### 39. Optimistic-update chain rolled back to A's speculative value (not pre-A truth) when two queued IPCs both failed; nullish-coalescing also collapsed legitimate `null` baselines

- **Source:** github-claude | PR #238 round 1 | 2026-05-21
- **Severity:** MEDIUM
- **File:** `src/features/sessions/hooks/useSessionManager.ts`
- **Finding:** `setPaneActivityPanelCollapsed` queues persists through a chain ref so multiple toggles applied back-to-back serialise. The original rollback path read `previous = pane.activityPanelCollapsed` AT CALL TIME — by the time call B is issued, that read already reflects A's optimistic update, so a double-IPC-failure (A=true, B=false both reject) restored UI to A's speculative `true` while the backend was still at the pre-chain `null`. The fix carries the pre-chain value forward inside the chain entry itself; codex verify cycles 1 and 2 then surfaced two follow-on bugs: (a) the chain-stored baseline must ADVANCE after each successful persist so a mixed-success/failure pair (A succeeds, B fails) rolls back to A's value rather than past it, and (b) `existing?.originalValue ?? fallback` collapses a legitimate `null` baseline into the fallback path (`??` treats `null` as "missing"), causing the same UI/backend desync when B is issued after A's render commits but before any IPC succeeds.
- **Fix:** Chain ref value type became `{ tail: Promise<void>; originalValue: boolean | null }`. On each call, `originalValue` is captured ONCE per chain run via explicit existence check (`existing !== undefined ? existing.originalValue : fallback`) so `null` survives. After `await next` succeeds, the chain entry is mutated in place — `current.originalValue = collapsed` — so queued siblings see the advancing baseline. The catch path snapshots `liveBaseline` BEFORE the setSessions updater (the `finally` deletes the chain entry before React processes the updater) using the same explicit-existence check, then rolls back to the captured value when the guard says we still own the latest optimistic write. Three regression tests cover: (1) double-fail rolls to pre-chain null; (2) mixed success/fail rolls to the successful sibling's value; (3) double-fail with B issued AFTER A's render-commit still rolls to null.
- **Commit:** _(see git log for the PR #238 upsource-review cycle commit)_

### 40. Same-direction concurrent optimistic-toggle calls value-matched the rollback guard and clobbered the newer queued write; collapsed rail pulse ignored `prefers-reduced-motion`

- **Source:** github-claude (F4, F5) + github-codex-connector (C3) | PR #238 round 2 | 2026-05-21
- **Severity:** MEDIUM (F4, C3) + LOW (F5)
- **File:** `src/features/sessions/hooks/useSessionManager.ts` + `src/features/agent-status/components/AgentStatusRail.tsx` + `src/features/terminal/services/terminalService.ts`
- **Finding:** The catch-block guard in `setPaneActivityPanelCollapsed` compared `pane.activityPanelCollapsed !== collapsed` to decide whether to roll back. For two same-direction concurrent calls (A=true, C=true), that value comparison cannot distinguish A from C — A's failure mis-matched as "we own the latest optimistic state" and reverted C's true to the chain's pre-A null, even though C is still in flight and the backend would eventually persist true. C's success then advanced `originalValue` but never restored the pane value, so the UI showed un-collapsed while the backend stored collapsed — no self-healing until session reload. Separately, the collapsed rail's running indicator used `animate-pulse` unconditionally, ignoring `prefers-reduced-motion: reduce` while sibling bucket animations correctly respected the preference; and `MockTerminalService.setSessionActivityPanelCollapsed` suppressed unused-arg lint via `void _request` instead of the project-standard `// eslint-disable-next-line` comment used by every neighbouring mock method.
- **Fix:** Replaced the value-equality rollback guard with chain-head identity ownership: `const isHead = collapseChainRef.current.get(chainKey)?.tail === tail` captured at catch time (before `finally` deletes the entry) gates the setSessions call. Same-direction A/C races now correctly defer to whichever call is at the head of the chain, regardless of value coincidence. Tailwind `motion-safe:animate-pulse` replaces the bare `animate-pulse` on the rail's running dot so reduced-motion users get a static dot consistent with the bucket-wave behaviour. Mock method aligned with the project pattern via per-arg `// eslint-disable-next-line @typescript-eslint/no-unused-vars` (the directive sits on the parameter line because the multi-line signature forced by prettier-wrap puts the param on its own line). Regression test added for the same-direction race.
- **Commit:** _(see git log for the PR #238 upsource-review cycle 4 fix commit)_

### 41. `useMemo` dep pinned to full object reference defeated the memo for hooks that return a new object every tick

- **Source:** github-claude | PR #238 round 3 | 2026-05-21
- **Severity:** MEDIUM
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** `activityPanelStatus = useMemo(() => agentStatusToSessionStatus(agentStatus), [agentStatus])` listed the full `agentStatus` object in its dep array, even though `agentStatusToSessionStatus` only reads `.isActive` (a boolean primitive). `useAgentStatus` re-emits a fresh object reference on every stream tick (status events, tool calls, context-window updates), so the memo cache always missed and re-ran the computation per render — the memo provided no caching benefit. Not a correctness bug, but dead optimization that misleads future readers.
- **Fix:** Narrow the dep to `[agentStatus.isActive]` with a `// eslint-disable-next-line react-hooks/exhaustive-deps` comment. The lint rule wants the whole object since the callback closes over `agentStatus`; the suppression is justified because the callback only reads `.isActive` (verified by inspecting `agentStatusToSessionStatus`) and the wider dep would silently re-run the memo. Rule of thumb: when a memo's body invokes a function that takes an object but only reads one primitive, depend on the primitive (with a documented eslint suppression) — pinning the object reference defeats the memo whenever the producer re-creates the object.
- **Commit:** _(see git log for the PR #238 upsource-review cycle 5 fix commit)_

### 42. Chain-rollback re-threw past the ownership guard + chain key on reusable React id contaminated replacement panes

- **Source:** github-claude (F9, F10) + github-codex-connector (C4) | PR #238 round 4 | 2026-05-21
- **Severity:** MEDIUM (F9, C4) + LOW (F10)
- **File:** `src/features/sessions/hooks/useSessionManager.ts` + `src/features/workspace/WorkspaceView.tsx`
- **Finding:** Cycle 4 added an `isHead` guard around the rollback setSessions call but left `throw err` unconditional. A superseded call still propagated its rejection up to `handleActivityPanelCollapsed -> notifyInfo`, so the user saw an error toast for a rapid collapse-then-expand when the collapse IPC happened to fail — even though the expand had already succeeded and the UI was correct. Separately, the chain key was `${sessionId}:${paneId}`, but `nextFreePaneId` reuses freed React pane ids, so a stale persist/failure for a removed pane could either join the new pane's queue (chain key collision) or have its rollback setSessions mutate the replacement pane (paneId-match in the catch predicate). Cycle 5 partially fixed C4 by switching the chain key to `pane.ptyId` but kept paneId-based matching in setSessions; codex flagged that as still vulnerable to cross-pane contamination via the React id reuse on the state-write path.
- **Fix:** Move `throw err` INSIDE the `if (isHead)` block so superseded calls resolve silently (matching the "silently defer" comment). Capture `const panePtyId = pane.ptyId` once at call entry and use it everywhere — chain key, optimistic setSessions predicate, and rollback setSessions predicate all compare against `panePtyId` (a per-spawn backend identifier that never recycles). The optimistic update runs in the call's sync prefix so it cannot race with pane lifecycle; the rollback runs after at least one IPC round-trip and is the path the codex finding exercised. If the original pane is gone entirely when rollback fires, both updates become no-ops. Inlined `activityPanelStatus = agentStatus.isActive ? 'running' : 'paused'` instead of useMemo + partial-dep eslint suppression — a ternary on a primitive can't stale and removes the fragility class.
- **Commit:** _(see git log for the PR #238 upsource-review cycle 6 fix commit)_

### 43. Pane rename trusted stale frontend agent classification and skipped backend sync

- **Source:** github-codex-connector | PR #265 | 2026-05-24
- **Severity:** P2
- **File:** `src/features/workspace/commands/buildWorkspaceCommands.ts` + `src/features/command-palette/hooks/usePaneRenameChord.ts`
- **Finding:** `:rename-pane` and the pane-rename chord decided whether to send `/rename` from frontend pane `agentType` snapshots. New Claude/Codex panes can report `generic` until detection state reaches React, so user renames in that window updated only the local `userLabel`; a later agent-title event could overwrite the local label because the agent transcript never received the rename.
- **Fix:** `:rename-pane` now always asks the backend to sync the title and lets the backend live-agent registry reject true shell / unsupported panes. The chord re-resolves the focused pane at submit time before deciding whether to round-trip, so an open-time `generic` snapshot no longer blocks a newly-classified Claude/Codex pane. Regression tests cover both paths.
- **Commit:** _(see git log for the PR #265 review-fix commit)_

### 44. Fire-and-forget async theme sync remounted a consumer before shared state settled

- **Source:** github-claude | PR #263 follow-up | 2026-05-25
- **Severity:** MEDIUM
- **File:** `src/features/diff/components/DiffPanelContent.tsx`
- **Finding:** DiffPanelContent changed `theme` and remounted `<MultiFileDiff key={theme}>` in the same render where it launched `workerPool.setRenderOptions({ theme })` as a fire-and-forget effect. The remounted Pierre component could request tokenization before the worker pool had accepted the new theme, producing a first render with the previous pool theme.
- **Fix:** Track `syncedTheme` separately from the toolbar's selected `theme`. MultiFileDiff keeps rendering with the last synced theme and only remounts after `setRenderOptions` resolves for the newest theme. Added a regression test with a deferred worker-pool promise to verify the diff stays on the previous theme until sync completes.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 45. AgentWatcherState split-mutex created an observable inconsistency window between `agent_type_for_pty` and `contains` / `active_count`

- **Source:** github-claude | PR #302 round 1 | 2026-05-29
- **Severity:** MEDIUM
- **File:** `crates/backend/src/agent/adapter/base/watcher_runtime.rs` L131-163
- **Finding:** `AgentWatcherState` held `watchers: Arc<Mutex<HashMap<_, WatcherHandle>>>` and `agent_types: Arc<Mutex<HashMap<_, AgentType>>>` separately. `insert` acquired-released the `agent_types` lock, then separately acquired-released `watchers`; `remove` had the symmetric two-step ordering. Between the two critical sections, a concurrent reader could observe `agent_type_for_pty == Some(_)` while `contains == false` (mid-insert), or the reverse (mid-remove). The rename / title-sync IPC reads `agent_type_for_pty` to gate `/rename` writes and Codex pending-rename registration — so a concurrent start / stop in that window could silently misroute or skip a rename event without any error surface. The original split was motivated by a real concern (never hold a mutex across `WatcherHandle::Drop`, which joins the 3-second polling thread), but the split atomicity loss was a hidden cost.
- **Fix:** Collapse `agent_types` into a field on `WatcherHandle` (`agent_type: AgentType`, `Copy`-cheap). `AgentWatcherState::insert(sid, mut handle, agent_type)` stamps `handle.agent_type = agent_type` before inserting, so a single `watchers` mutex now gates both presence and agent-type lookups. The Drop-vs-lock concern stays solved by the existing nested-block scoping (the evicted `Option<WatcherHandle>` is bound to a name that drops AFTER the guard goes out of scope, so `WatcherHandle::Drop`'s 3-second join never holds the mutex). `insert_agent_type_for_test` now builds a stub `WatcherHandle::new_for_test` and routes through the public `insert` API, so the test seam preserves the single-mutex invariant. Added regression test `insert_makes_agent_type_and_presence_atomic_under_single_lock` pinning the round-trip. Code-review heuristic: when splitting a mutex to dodge a long-held-lock concern (Drop joins, expensive I/O), verify that no observable invariant required the two sets of data to be queried under one lock — multi-field reads across separate mutexes break atomicity even when each individual lock is correctly scoped; the lower-cost fix is usually to push the expensive teardown OUT of the mutex (Drop ordering tricks) rather than to split the data.
- **Commit:** _(PR #302 upsource cycle 1 fix commit)_

### 46. Destructive-before-fallible ordering: `evict_old` ran before `spawn_watch`, so a spawn failure left the session permanently unwatched with no rollback

- **Source:** github-claude | PR #302 round 2 | 2026-05-30
- **Severity:** MEDIUM
- **File:** `crates/backend/src/agent/adapter/session_lifecycle.rs` L616-628
- **Finding:** `SessionLifecycle::run_watch_sequence` called `evict_old(&session_id)` unconditionally to drop the existing `WatcherHandle`, then called `spawn_watch(...)` with `?`. If `spawn_watch` returned `Err` (inotify fd exhaustion, low-fd container, racy restart, missing parent dir for the watched file), the closure exited via `?` BEFORE reaching `register` — but `evict_old` had already dropped the old handle, which cascaded `WatcherHandle::Drop` → transcript-tail teardown → Codex title-sync teardown. Net result: session permanently unwatched, no status polling, no transcript streaming, no `agent-cwd` events, no automatic recovery — the frontend would need to manually trigger a re-attach. Sibling of #45: both are about a multi-step state mutation that observers (or future callers) can land in mid-flight, but where #45's window was concurrent reads, this one's "window" is a failure-mode rollback gap.
- **Fix:** Swap to spawn-first ordering. `spawn_watch` runs FIRST; on `Err`, `?` short-circuits before any state mutation, the old watcher is untouched, the session continues observing. On `Ok` the new handle is in hand BEFORE `evict_old` drops the old one, so `evict_old → register` are back-to-back with zero observable window (matches the IDEA-block recommendation from the reviewer). Existing `t_lifecycle_2a` / `t_lifecycle_2b` tests already pin the "locate/trust failure → old watcher preserved" invariant; the new ordering extends that property to "spawn failure → old watcher preserved" without requiring a new test (the spawn-failure path is environment-dependent — inotify fd limits etc. — and hard to simulate deterministically in the unit harness). Code-review heuristic: any verb sequence `A; B?; C` where `A` is destructive and `B` is fallible has a rollback gap if `B` errors — even if the pre-refactor code had the same ordering. Reorder to `B?; A; C` so the fallible step's `?` short-circuits before the destructive step. Same heuristic applies to file-replacement sequences (write tmp + rename; never delete-then-recreate), database migrations (online schema-add + backfill + cutover; never drop-then-recreate), and Drop-cascade tear-downs that gate a recreate.
- **Commit:** _(PR #302 upsource cycle 2 fix commit)_
- **Follow-up:** see #47 — the cycle-2 swap was structurally correct for the spawn-rollback property but introduced a separate atomicity bug because `evict_old` joined a thread inside the lock release ordering. Cycle 3's refinement deletes the `evict_old` call entirely; the structural insight from this entry stands but the "spawn → evict → register" three-step expansion was wrong-shape.

### 47. Refinement of #46: even after swap-to-spawn-first, a SEPARATE `evict_old` verb between spawn and register opens a ~3.5s session-absent window because `remove` joins inside its function body

- **Source:** github-claude | PR #302 round 3 | 2026-05-30
- **Severity:** MEDIUM
- **File:** `crates/backend/src/agent/adapter/session_lifecycle.rs` L646-650 (post-cycle-2 lines)
- **Finding:** Cycle 2's #46 fix (swap to `spawn_watch?; evict_old; register`) was structurally correct for the spawn-failure-leaves-old-watcher property, but it didn't notice a SECOND atomicity bug introduced by the F.4 named-verb decomposition. `evict_old` calls `AgentWatcherState::remove`, which removes the entry from the watchers map (under the lock) and then drops the displaced `Option<WatcherHandle>` at end-of-function — and the Drop joins the polling thread (≤3s Condvar wait) plus the Codex session-index thread (≤500ms) BEFORE `remove` returns. The map is already empty by the time the join runs, so for the entire ~3.5s join phase: `agent_type_for_pty()` returns `None`, `contains()` returns `false`, `active_count()` is low by one. The rename/title-sync IPC (#45's consumer) silently no-ops; the diagnostic log under-counts. The pre-F.4 code used `AgentWatcherState::insert` directly on restart, which atomically swaps old→new under one lock and drops the displaced handle OUTSIDE the lock — so the session was always visible. F.4's "extract `evict_old` and `register` as separate verbs" inadvertently re-fragmented the atomic swap.
- **Fix:** Delete the `lc.evict_old(&session_id)` call from `run_watch_sequence`. `register` is implemented as `watcher_state.insert(sid, handle, agent_type)`, which already has the atomic-replace semantics — acquires the watchers lock, calls `watchers.insert(sid, new_handle)` (returning the displaced `Option<old_handle>`), releases the lock at end of nested block, and drops `_displaced` OUTSIDE the lock. The spawn-failure-rollback property from #46 is preserved by the spawn-before-register ordering alone (if `spawn_watch?` errors, `?` short-circuits before `register` runs, so the old watcher is never displaced). The `evict_old` verb method itself stays as part of the F.4 named interface (`#[allow(dead_code)]` + docstring explaining the rationale) so the spec at `docs/superpowers/specs/2026-05-25-transcript-dtos-and-engine-design.md` and the `t_verb_evict_old` test continue to compile and pass. Code-review heuristic: when refactoring a method that already encapsulates an atomic sequence into "named sub-verbs", verify that the decomposition doesn't accidentally expose intermediate states. The original `insert`'s contract was "remove old + insert new, atomic from observers' POV"; splitting into `evict_old; register` exposed the intermediate state. The fix isn't always "compose the verbs differently" — sometimes the right move is to recognize one verb was incidental to another and DELETE it from the named-interface call path while keeping the standalone method available for the rare use case where eviction-without-replace is genuinely wanted.
- **Commit:** _(PR #302 upsource cycle 3 fix commit)_
- **Follow-up:** see #48 — switching to insert-based atomic-replace surfaced a Drop-time ownership bug. On restart, the OLD displaced WatcherHandle's Drop was still calling `transcript_state.stop` and tearing down the per-session transcript-tail entry the NEW handle had just inherited via `start_or_replace`. The fix in #48 closes the bug by adding an explicit ownership flag the displacing insert clears.

### 48. Drop-time ownership transfer: on restart, the displaced handle's Drop must NOT tear down the per-session transcript-tail entry the new handle just adopted

- **Source:** github-codex-connector | PR #302 round 5 | 2026-05-30
- **Severity:** HIGH (P1)
- **File:** `crates/backend/src/agent/adapter/base/watcher_runtime.rs` (WatcherHandle + AgentWatcherState::insert)
- **Finding:** Cycle 3's #47 fix (delete `evict_old`, rely on `insert`'s atomic-replace) closed the session-absent-window bug — but exposed a different bug at Drop time. When restarting an existing session, `spawn_watch` runs `start_watching` BEFORE `register` displaces the old handle. `start_watching`'s inline-init calls `TranscriptState::start_or_replace`, which returns one of `AlreadyRunning` (same path+cwd → existing entry kept), `Replaced` (different path or cwd → new tail inserted under same session_id), or `Started` (no prior entry). In the first two cases, the NEW handle has just "claimed" the per-session transcript-state entry — either by sharing it or by being the rightful new owner. Then `register`'s `insert` displaces the OLD handle, which drops outside the lock — and the OLD `WatcherHandle::Drop` unconditionally called `transcript_state.stop(&self.session_id)`, tearing down the entry the NEW handle just adopted. Net effect: status watcher running for the new handle, but no transcript tail attached — tool/turn events written before the next status update could be lost. Codex flagged this for the `AlreadyRunning` shape specifically; the actual scope is broader (any restart, all three start_or_replace outcomes, because the per-session key is the same).
- **Fix:** Make Drop-time transcript teardown conditional on a per-handle ownership flag. Added `owns_transcript: bool` to `WatcherHandle`, default `true`. `WatcherHandle::Drop` gates `transcript_state.stop(&self.session_id)` on `if self.owns_transcript`. The other Drop steps (notify watcher, polling fallback thread, codex session_index thread) stay UNCONDITIONAL — they are per-handle resources that the new handle never inherits, and leaving them alive would leak. `AgentWatcherState::insert` binds the displaced handle to `mut displaced` and sets `displaced.owns_transcript = false` BEFORE letting `displaced` drop outside the lock — transferring ownership to the new handle. `AgentWatcherState::remove` continues to drop the handle with `owns_transcript = true`, so a clean stop tears the tail down as before. The matched-pair invariant is: ownership of the transcript-state entry moves to whichever WatcherHandle is currently registered in the watchers map; only that handle's Drop should call stop. New regression test `insert_transfers_transcript_ownership_to_displacing_handle` pins the handoff: seed a transcript entry, insert handle A → assert tracked, insert handle B (displacing A) → assert STILL tracked after A drops, then remove → assert finally cleared. Code-review heuristic: when a value lives in two places (a per-handle Drop-cascade list AND a separately-keyed registry like `TranscriptState`), the per-handle Drop must distinguish "I created this entry" (should clean up) from "I inherited it from a prior handle and the next handle inherited it from me" (should not). The ownership flag is the standard idiom; the alternative ("Drop reads the registry to check if it still owns the entry") fights the borrow checker and adds lock acquisition to Drop, which is exactly the kind of long-held-lock concern #45 was trying to avoid.
- **Commit:** _(PR #302 upsource cycle 5 fix commit)_
- **Follow-up:** see #49 — #48's unconditional ownership-transfer is too broad. When the NEW handle's `start_watching` inline-init never engaged with `transcript_state` (status file unreadable / empty / parse-failed / validation-failed / NoPath AND no pre-register notify callback fired in time), there's nothing for the new handle to "own", and the OLD handle's Drop should stop the orphaned old tail. #49 narrows the transfer-trigger via an `Arc<AtomicBool>` claim flag shared with both inline-init and the pre-register notify callback. A residual TOCTOU race remains (notify callback inside `start_or_replace` when insert snapshots the flag) — documented in the field's docstring; closing fully requires sharing TranscriptState's per-session gate with AgentWatcherState (architectural change out of PR scope).

### 49. Pre-register claim tracking: ownership-transfer signal must cover both inline-init AND pre-register notify-callback paths

- **Source:** github-codex-connector | PR #302 round 8 | 2026-05-30 (with two local codex-verify retries narrowing the gate)
- **Severity:** MEDIUM (P2)
- **File:** `crates/backend/src/agent/adapter/base/watcher_runtime.rs` (WatcherHandle.claimed_transcript + start_watching's two write sites + AgentWatcherState::insert's read site)
- **Finding:** #48's `insert` cleared the displaced handle's `owns_transcript = false` unconditionally on displacement, assuming the new handle had engaged with `transcript_state` via inline-init. But `start_watching` has multiple paths where inline-init does NOT call `maybe_start_transcript`: (1) status file unreadable, (2) status file empty, (3) decoder parse error, (4) `resolve_transcript_path` returns None, (5) `maybe_start_transcript` validation early-exit (`Missing` / `OutsidePath` / `InvalidPath` / `NotFile`). In any of these "Case B" paths, the new handle has nothing to "own" in `transcript_state`; clearing the displaced handle's ownership orphans the old entry indefinitely (until the new handle is removed or a later status update happens to replace it). Codex-verify additionally caught that the inline-only flag missed the pre-register notify-callback race: `watcher.watch(...)` activates the notify backend BEFORE `start_watching` returns, so a file event can fire the notify callback and reach `start_or_replace` before `AgentWatcherState::insert` runs.
- **Fix:** Replace the bare `bool` flag with a shared `Arc<AtomicBool>` (`claimed_transcript`) that's written by BOTH the inline-init path AND the notify-callback closure inside `start_watching`. Both sites write `store(true, Release)` only when `maybe_start_transcript`'s outcome is in `{Started, Replaced, AlreadyRunning, StartFailed}` — i.e., when `TranscriptState::start_or_replace` was actually reached (excludes validation early-exits). `WatcherHandle` stores the Arc; `AgentWatcherState::insert` reads via `load(Acquire)` and only clears `displaced.owns_transcript = false` when the new handle has actually claimed. Test seam `set_claimed_for_test(v: bool)` lets tests simulate either restart shape. Two regression tests: `insert_transfers_transcript_ownership_when_new_handle_claimed` (Case A — flag explicitly set, ownership transfers, transcript tail survives A's Drop) and `insert_keeps_displaced_ownership_when_new_handle_did_not_claim` (Case B — flag stays false, A's Drop stops the orphaned old tail).
- **Cycle-8 residual (closed in #50):** Documented a residual TOCTOU window where a notify callback could be in-flight inside `start_or_replace` when `insert` snapshotted `claimed_transcript` as `false`, then the callback would complete the mutation, and the old handle's Drop would tear down the entry. Cycle 9 closed it via #50 (gate-held claim write + gate-held insert + under-gate teardown + drop-notify-watcher-first).
- **Commit:** _(PR #302 upsource cycle 8 fix commit; codex-verify retries #1 added the validation-early-exit gate, retry #2 widened to the shared Arc for the notify-callback race)_

### 52. Two-step under-gate teardown: signal-stop under the gate, defer the thread-join until after gate release

- **Source:** github-claude | PR #302 round 11 | 2026-05-30
- **Severity:** MEDIUM
- **File:** `crates/backend/src/agent/adapter/base/transcript_state.rs` (`stop_with_held_gate` + new `TranscriptHandle::signal_stop`) + `crates/backend/src/agent/adapter/base/watcher_runtime.rs` (`AgentWatcherState::insert`'s removed_transcript binding)
- **Finding:** #50's cycle-9-retry-1 `stop_with_held_gate` removed the watcher entry under the per-session gate AND let the displaced `TranscriptHandle` drop within the gate's scope — the drop's tail-thread join (~500ms POLL_INTERVAL) extended the gate-hold for that duration. Any concurrent `start_or_replace` / `stop` on the same session blocked on the gate for ~500ms, stalling the IPC handler on `spawn_blocking` for that long. For rapid-restart workflows, this serialized as observable IPC latency.
- **Fix:** Split the stop into "signal under gate, join outside gate." Added `pub(crate) fn TranscriptHandle::signal_stop(&self)` that stores true to `stop_flag` (and `aux_stop` if present) without joining. Changed `stop_with_held_gate(&str)` return type from `bool` to `Option<TranscriptHandle>`: it now removes the watcher from the map under the gate, calls `handle.signal_stop()` under the gate (so the tail thread starts winding down immediately), and returns the handle. `AgentWatcherState::insert` captures the returned handle in an OUTER-scope binding (`removed_transcript: Option<TranscriptHandle>`) so its Drop happens at end-of-function — OUTSIDE the gate's inner scope. Gate-hold time collapsed from ~500ms to ~µs.
- **Trade-off (documented in stop_with_held_gate docstring):** Between gate release and the OLD tail actually observing stop_flag (at most one POLL_INTERVAL ≈ 500ms later), a concurrent `start_or_replace` can acquire the gate and spawn a fresh tail for the same session. Briefly there are two threads emitting events; the OLD thread exits at its next stop-flag check (within ≤ one poll iteration, typically ≤2 duplicate events). Frontend has no per-tool-call dedup; brief duplicates are an acceptable cost vs holding the gate for the full join. Code-review heuristic: when teardown involves both "stop the work" and "wait for the work to finish" steps, identify whether the gate needs to be held across BOTH or only the "stop" step. The "stop" usually only needs serialization with other state mutations; the "wait" can usually happen outside any lock as long as the to-be-joined work doesn't itself touch the state being protected. This pattern recurs: signal-under-lock + join-outside-lock is the right shape for most teardown-with-join scenarios.
- **Commit:** _(PR #302 upsource cycle 11 fix commit)_

### 51. Closing the in-flight-dispatch race with a per-handle `alive` token checked under the gate inside `start_or_replace`

- **Source:** github-codex-connector | PR #302 round 10 | 2026-05-30
- **Severity:** MEDIUM (P2)
- **File:** `crates/backend/src/agent/adapter/base/watcher_runtime.rs` (WatcherHandle.alive + start_watching's two callback closures + AgentWatcherState::insert) + `crates/backend/src/agent/adapter/base/transcript_state.rs` (start_or_replace alive parameter + under-gate check)
- **Finding:** #50 closed the gate-serialization race but a narrower in-flight-dispatch race remained: an already-dispatched displaced notify callback can be mid-execution when `_watcher.take()` runs, then acquire the gate AFTER insert releases it, see `transcript_state` empty (post-teardown), call `start_or_replace(Started)`, and re-create a stale entry. Drop-notify-first only stops FRESH dispatches from the OS backend, not already-dispatched in-flight callbacks waiting on the gate.
- **Fix:** Per-handle `alive: Arc<AtomicBool>` token (default true). Notify and poll callback closures capture clones (`alive_for_cb`, `poll_alive`); inline-init synchronously can't be displaced so passes `None`. `WatcherHandle` stores the Arc. `AgentWatcherState::insert` sets `displaced.alive.store(false, Release)` UNDER the per-session gate, BEFORE dropping `_watcher` (so callbacks already blocked on the gate see false when they unblock) AND before any teardown. `TranscriptState::start_or_replace` gains an `alive: Option<Arc<AtomicBool>>` parameter; checks `!alive.load(Acquire)` UNDER the gate BEFORE any mutation; returns `Err("watcher displaced — start_or_replace short-circuited")` early on `false`. No mutation, claim_flag not set, callback returns harmlessly. Code-review heuristic: when closing a multi-step TOCTOU stack where each fix exposes a narrower race, identify every callback source (notify backend, poll thread, sidecar threads) that can have an in-flight invocation past the "fast-path check" but before the "critical-section acquire". The check must be RE-DONE under the critical section, not just at the entry — otherwise a callback that started before the displacement signal can still mutate state after the displacement is "complete". The `Option<Arc<AtomicBool>>` parameter pattern is the standard shape because it (a) costs nothing for synchronous callers that pass None, (b) preserves the function signature for non-handle callers, (c) places the check INSIDE the same gate that guards the mutation — eliminating any TOCTOU window between the check and the mutation.
- **Commit:** _(PR #302 upsource cycle 10 fix commit)_

### 50. Closing the cycle-8 residual TOCTOU via gate-serialized claim-write + gate-serialized insert + under-gate orphan-teardown + drop-notify-watcher-first

- **Source:** github-claude | PR #302 round 9 | 2026-05-30 (with two local codex-verify retries narrowing the gate further)
- **Severity:** MEDIUM
- **File:** `crates/backend/src/agent/adapter/base/transcript_state.rs` (start_or_replace + session_gate + stop_with_held_gate) + `crates/backend/src/agent/adapter/base/watcher_runtime.rs` (AgentWatcherState::insert)
- **Finding:** #49 accepted a residual TOCTOU race documented in code. Cycle 9's external Claude review (with two local codex-verify retries) pushed the fix to architectural completion by sharing `TranscriptState`'s per-session start gate with `AgentWatcherState::insert`. The race had THREE distinct sub-windows that needed closing:
  1. **Cycle-8 race (initial)** — claim flag stored AFTER `maybe_start_transcript` returned, outside the gate. A pre-register notify callback's in-flight `start_or_replace` could complete the mutation but its post-return atomic store could land AFTER insert's flag read.
  2. **Cycle-9 retry-1 race** — even with the flag write moved inside the gate, insert released the gate before the displaced handle's Drop ran stop. A notify callback that fired BETWEEN insert's gate-release and Drop's stop could acquire the gate, successfully `start_or_replace`, and then displaced's Drop would tear down the adopted entry.
  3. **Cycle-9 retry-2 race** — even with under-gate orphan-teardown when `new_claimed == false`, the OLD displaced watcher's notify callback could fire AFTER insert's teardown but BEFORE displaced.Drop dropped `_watcher` (RecommendedWatcher), recreating the entry with stale data.
- **Fix (the full stack):**
  1. `TranscriptState::start_or_replace` gains an `Option<Arc<AtomicBool>>` `claim_flag` parameter. A `mark_claimed` closure stores `true` to the flag INSIDE the gate at each success path (AlreadyRunning early-return + function-tail Started/Replaced). Failure paths do not set the flag.
  2. `TranscriptState::session_gate(&str) -> Arc<Mutex<()>>` is exposed (pub(crate)) so callers can lock the same per-session gate.
  3. `TranscriptState::stop_with_held_gate(&str) -> bool` is added (pub(crate)) — same as `stop` but assumes the caller already holds the gate. Used by insert to tear down an orphaned old entry under its own gate-acquisition without deadlocking on a re-acquisition.
  4. `AgentWatcherState::insert` acquires the per-session gate around the entire critical section. Under the gate, in order: reads `new_claimed`, inserts new handle into watchers map, drops displaced's `_watcher` (RecommendedWatcher) FIRST to disconnect the OS-level notify backend so no new callbacks dispatch from the displaced watcher, conditionally calls `stop_with_held_gate` when `new_claimed == false` to tear down the orphaned entry, sets `displaced.owns_transcript = false` always so its Drop is a no-op for transcript_state.
  5. `maybe_start_transcript` threads the claim_flag through to `start_or_replace`. Inline-init AND notify-callback closure both pass `Some(claimed_transcript.clone())`. The poll thread passes `None` (sleeps 3s before first iteration, doesn't race with insert).
- **Code-review heuristic:** Multi-step TOCTOU race-closing requires identifying every state-mutation window the read-decision depends on AND every callback source that can fire during those windows. For a per-session ownership-transfer decision in a setup where the displaced watcher has multiple OS-level callback sources (notify watcher + poll thread + sidecar threads), the fix needs: (a) shared gate between the deciding read and any state mutation, (b) gate-held write of the signal the read snapshots, (c) under-gate cleanup of any orphaned state, (d) early termination of callback sources from the displaced watcher BEFORE the cleanup. Skipping any of these leaves a different sub-race. The cost is API surface (`session_gate` and `stop_with_held_gate` are new public-crate methods); the benefit is structural correctness rather than a documented residual race. Codex verify found each successive sub-race in turn — iterative narrowing of a TOCTOU is a strong signal that the architecture (rather than the implementation) needs to coordinate the two state stores.
- **Commit:** _(PR #302 upsource cycle 9 fix commit; codex-verify retries #1 added under-gate orphan-teardown, retry #2 added drop-notify-watcher-first under the gate)_

### 53. Compile-time TOCTOU witnesses must bind BOTH the lock-type AND the owner-identity, not just "some Mutex held"

- **Source:** github-claude + local-codex | PR #302 round 15 | 2026-05-30
- **Severity:** MEDIUM
- **File:** `crates/backend/src/agent/adapter/base/transcript_state.rs` (SessionGate + SessionGateGuard + stop_with_held_gate)
- **Finding:** Cycle 13 F3 added `_gate: &MutexGuard<'_, ()>` to `stop_with_held_gate` as a compile-time witness that "the caller holds the per-session gate". Claude's post-cycle-13 review pointed out the type only proves SOME `Mutex<()>` is held — a future contributor could pass any unrelated `MutexGuard<()>` (wrong subsystem, wrong session, wrong state instance) and bypass the intended serialization guarantee. Local codex verify on the cycle-15 fix further narrowed this: even a `SessionGateGuard` newtype that carries the `session_id` is insufficient if it doesn't also bind the issuing `TranscriptState` instance — `other_state.session_gate(sid).lock()` would pass both the type check AND the session_id assert while holding `other_state`'s lock, not `self`'s.
- **Fix (two-axis binding):**
  1. **Lock-type axis (compile-time)**: `SessionGate` / `SessionGateGuard` newtypes with private constructors. Only `TranscriptState::session_gate(sid)` can build a `SessionGate`; only `SessionGate::lock()` can build a `SessionGateGuard` (constructor + fields module-private). Future contributors physically cannot pass a `Mutex<()>` from another subsystem.
  2. **Session-identity axis (debug-runtime)**: `SessionGateGuard` carries the `session_id` it was issued for; `stop_with_held_gate` `debug_assert_eq!`s `gate.session_id() == session_id`.
  3. **State-identity axis (debug-runtime)**: `SessionGate` / `SessionGateGuard` also carry an `Arc<Mutex<HashMap<...>>>` clone of the issuing `TranscriptState`'s `start_gates` field (cheap atomic refcount; never dereferenced through this clone). `stop_with_held_gate` `debug_assert!`s `Arc::ptr_eq(&gate.start_gates, &self.start_gates)` BEFORE the session_id check.
  - Release builds incur no runtime overhead beyond the underlying `MutexGuard`; the asserts compile out.
  - Two regression tests pin debug-runtime behavior: `stop_with_held_gate_panics_on_wrong_session_in_debug` (right state, wrong sid) and `stop_with_held_gate_panics_on_wrong_state_in_debug` (right sid, wrong state instance).
- **Code-review heuristic:** When using a typed witness to enforce a TOCTOU invariant at the API boundary, identify EVERY axis the invariant is parameterized on — not just the most obvious one (the lock kind). A per-session lock is parameterized on (lock-type, session-id, state-instance). A witness that only proves the first axis is a partial enforcement; codex / external review will reliably find each unbound axis. The compile-time-vs-runtime split is acceptable: bind what the type system can express (constructor visibility + private fields + lifetimes), and `debug_assert!` what it can't (Arc identity, string equality). The pattern of "cheap `Arc::ptr_eq` for owner identity" generalizes wherever a token-issuing API needs to verify the token came from the right issuer instance (registry, pool, factory).
- **Commit:** _(PR #302 upsource cycle 15 fix commit)_

### 54. Quiesce displaced watcher BEFORE inline-init via a fallible-setup-success hook, with watcher Drop outside the gate

- **Source:** github-codex-connector | PR #302 cycle 16 P2 | 2026-05-30
- **Severity:** MEDIUM (P2)
- **File:** `crates/backend/src/agent/adapter/base/watcher_runtime.rs` (AgentWatcherState::quiesce_existing + start_watching pre_inline_init hook) + `crates/backend/src/agent/adapter/session_lifecycle.rs` (spawn_watch closure)
- **Finding:** Cycles 9–11 closed the gate-protected ownership-transfer races in `AgentWatcherState::insert`, but a residual window remained between NEW handle's inline-init (claims transcript via `start_or_replace` and sets `NEW.claimed_transcript = true`) and `register`'s `insert` (sets `OLD.alive = false`). During that window the OLD handle's notify or poll callback can fire, pass its still-true alive check, take the per-session gate, and overwrite the just-claimed transcript with the OLD path/cwd. `register` later sees `new_claimed == true` and skips orphan-teardown, leaving a stale OLD-path tail attached under the NEW handle.
- **Fix (three-step ordering proof):**
  1. **Quiesce the OLD handle BEFORE inline-init runs.** New `AgentWatcherState::quiesce_existing(&str, &TranscriptState)` acquires the per-session gate, sets `handle.alive.store(false, Release)` on the existing entry (no-op if absent), and moves `handle._watcher.take()` into a local. After quiesce, any in-flight OLD callback that later reaches `start_or_replace`'s alive check observes `false` and short-circuits with `StartError::Displaced`; no mutation happens.
  2. **Preserve cycle-2 F3 spawn-failure rollback.** `quiesce_existing` is invoked via a `pre_inline_init: impl FnOnce()` parameter added to `start_watching`. The hook fires AFTER all fallible notify setup (`recommended_watcher` + `watcher.watch(parent_dir)`) succeeds and BEFORE the inline-init block reads the status file. If any earlier fallible step returns `Err`, the hook never fires — OLD watcher untouched.
  3. **Avoid the FsEventWatcher deadlock (codex retry-1 HIGH 0.89).** Drop the moved-out `RecommendedWatcher` OUTSIDE the gate. On macOS, `RecommendedWatcher = FsEventWatcher`, whose `Drop` stops and joins the FSEvents runloop — if an in-flight OLD callback is blocked on the per-session gate, dropping the watcher under the gate deadlocks (gate-holder waits for runloop drain; runloop waits for in-flight callback to complete; callback waits for gate). The `alive=false` store under the gate is the load-bearing race-fix; the watcher-drop is defensive belt-and-suspenders.
- **Code-review heuristic:** When a multi-phase setup includes both (a) fallible setup steps that must roll back on failure and (b) irreversible mutations needed for race-safety, the right architectural shape is a **post-setup-success hook**, NOT a caller-side pre-setup mutation. `pre_inline_init: impl FnOnce()` is a one-liner trait bound that lets the caller inject the irreversible step at the correct ordering point inside the setup function. This generalizes: any "do X only if Y succeeds" sequence where X and Y live in different modules is cleaner via a closure parameter than via two-call patterns where the caller has to remember the ordering. **Drop-outside-the-lock corollary:** when a lock protects an in-flight callback chain AND the callback's `Drop` synchronously joins the callback runloop, the Drop must happen outside the lock. The pattern recurs for any OS-level event source (FSEvents on macOS, inotify watchers, kqueue, mio registrations) whose teardown synchronizes with the dispatch thread.
- **Commit:** _(PR #302 upsource cycle 16 fix commit; codex-verify retry-1 added the drop-outside-gate fix and the post-setup-success hook restructure)_
