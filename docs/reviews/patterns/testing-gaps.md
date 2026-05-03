---
id: testing-gaps
category: testing
created: 2026-04-09
last_updated: 2026-05-03
ref_count: 20
---

# Testing Gaps

## Summary

Every `.ts`/`.tsx` production file must have a co-located `.test.ts`/`.test.tsx`
sibling. New modules added without tests violate the project testing rule and
increase regression risk. Tests must also respect runtime constraints (e.g.,
filesystem scope restrictions).

## Findings

### 1. New core modules lack co-located tests

- **Source:** github-codex | PR #36 | 2026-04-09
- **Severity:** HIGH
- **File:** `src/features/workspace/hooks/useResizable.ts` (and 3 others)
- **Finding:** Four new production modules added without sibling test files: `useResizable.ts`, `useSessionManager.ts`, `fileSystemService.ts`, `useFileTree.ts`
- **Fix:** Added co-located test files for all new modules
- **Commit:** `435e217 feat: interactive sidebar sessions, resizable panels, and real file explorer (#36)`

### 2. `useResizable` tests only cover horizontal direction — BottomDrawer vertical resize inverted with no test catch

- **Source:** github-claude | PR #38 round 2 | 2026-04-10
- **Severity:** MEDIUM
- **File:** `src/features/workspace/hooks/useResizable.test.ts`
- **Finding:** Existing tests only exercised horizontal resize. BottomDrawer uses vertical resize with a top-edge handle on a bottom-anchored drawer, which requires inverting the delta (drag UP grows). The bug wasn't caught by any existing test — the `BottomDrawer.test.tsx` resize test only asserted that `mousedown` fired, never the resulting height after `mousemove`.
- **Fix:** Add unit tests covering both vertical+non-inverted and vertical+inverted directions, asserting size after simulated mousemove events.
- **Commit:** `077c87f fix: address Claude review round 2 findings`

### 3. Missing tests for vim `:w` keypress path — silent no-op shipped undetected

- **Source:** github-claude | PR #38 round 2 | 2026-04-10
- **Severity:** MEDIUM
- **File:** `src/features/editor/hooks/useCodeMirror.test.ts`
- **Finding:** Tests passed an `onSave` mock but never asserted it was called. Integration tests in `WorkspaceView.integration.test.tsx` mocked `useCodeMirror` entirely and directly called `mockOnSave()` — they never exercised the actual vim `:w` keypress path. The manual test plan item "Manual: `:w` saves the current file" was the only check, and the buggy `(view as any).cm.vim.defineEx` silent no-op shipped.
- **Fix:** No automated test added yet (CodeMirror + vim testing in jsdom is non-trivial) — relied on the `Vim.defineEx` static API fix and manual verification. Follow-up needed.
- **Commit:** `077c87f fix: address Claude review round 2 findings`

### 4. Missing loading state tests after adding async file open

- **Source:** github-claude | PR #38 round 2 | 2026-04-10
- **Severity:** MEDIUM
- **File:** `src/features/editor/components/CodeEditor.test.tsx`
- **Finding:** When `isLoading` state was added to `useEditorBuffer` to show a loading overlay during async file reads, no tests verified the overlay rendered when `isLoading=true` or was absent when `isLoading=false`.
- **Fix:** Add two tests covering both states, including `role="status"` and test-id assertions.
- **Commit:** `0c8f0ac fix: address Claude review round 12 findings`

### 5. Behavior test asserted a side-effect that happens regardless of the function under test

- **Source:** github-claude | PR #43 round 1 | 2026-04-11
- **Severity:** LOW
- **File:** `src/features/editor/hooks/useCodeMirror.test.ts`
- **Finding:** A test titled `attaches scrollIntoView effect to pure selection change (vim motion)` was intended to verify the `transactionExtender` attaches a `scrollIntoView` effect to selection-only transactions. The sole assertion was `expect(view.state.selection.main.head).toBe(20)`, which only confirms the selection was committed — a behavior that happens inside CodeMirror's core dispatch regardless of whether the extender ran or returned anything. A transactionExtender that unconditionally returned `null` would still pass this test. The inline comment even acknowledged "effects aren't queryable post-commit," but framed the assertion as proving the extender ran.
- **Fix:** Extract the extender body from an inline anonymous function inside `useCodeMirror.ts` into a module-level exported pure function `scrollCursorOnSelectionChange(tr)`. Unit-test that directly on synthetic transactions built via `EditorState.update({...})` and inspect the returned `TransactionSpec`. This is the only reliable approach in jsdom — it has no layout pass, so DOM-level scroll position is unobservable and post-dispatch effect inspection is unreliable. Assert `result !== null`, `effects.length > 0`, and `effects[0] instanceof StateEffect`.
- **Commit:** `a7aea76 test(editor): directly unit-test scrollCursorOnVimMotion extender`

### 6. Regression-guard test didn't actually verify the property it claimed to guard

- **Source:** github-claude | PR #43 round 2 | 2026-04-11
- **Severity:** MEDIUM
- **File:** `src/features/editor/hooks/useCodeMirror.test.ts`
- **Finding:** A test titled `uses the new main cursor head position, not the old one` was documented as a regression guard against anyone swapping `tr.newSelection.main.head` (correct) for `tr.startState.selection.main.head` (wrong). It set up a selection move from 0 → 20 and asserted `tr.newSelection.main.head === 20` and `tr.startState.selection.main.head === 0` as preconditions, but the only assertion on the function under test was `expect(result).not.toBeNull()`. A non-null result would occur for both the correct and the incorrect implementation, so the guard would NOT catch the regression it claimed to prevent. If someone reverted the extender to read the old head position, all tests would still pass and the editor would silently scroll to the wrong place.
- **Fix:** Inspect the scroll effect's target position directly. CodeMirror's `scrollIntoView` effect is a `StateEffect<ScrollTarget>` where `ScrollTarget` is an internal class with shape `{ range: SelectionRange, ... }`. The type isn't exported, so use a duck-type reader (`effect.value.range.head`) guarded by the CM6 version it was verified against. Assert `targetPos === 20`. Now the test fails if anyone reads the wrong selection reference.
- **Commit:** `3f8bf2c fix(editor): address Claude review round 2 — test guard, naming, symmetry`

### 7. Uncovered guard branch: doc-change-plus-selection (vim mutation path)

- **Source:** github-claude | PR #43 round 3 | 2026-04-11
- **Severity:** LOW
- **File:** `src/features/editor/hooks/useCodeMirror.test.ts`
- **Finding:** The `scrollCursorOnSelectionChange` guard is `!tr.selection || tr.docChanged`. Tests covered the `!tr.selection` branch (effect-only transactions) and the `!tr.selection` path for insert-mode typing (`view.update({ changes: ... })` has `docChanged=true` but `tr.selection === undefined`, so the `!tr.selection` branch triggers first). But NO test exercised the OTHER branch — vim mutation commands like `dd`, `dw`, `cc`, `x`, `r` dispatch transactions that are BOTH a doc change AND an explicit selection change, and they hit the `|| tr.docChanged` branch. A future refactor that flipped `||` to `&&` would go undetected: insert mode would still be skipped via `!tr.selection`, but vim mutations would start firing the extender, double-scrolling on top of CM6's built-in doc-change scroll and causing jitter.
- **Fix:** Add a test that constructs a `docChanged + explicit selection` transaction (delete range + cursor move), asserts both `tr.docChanged === true` and `tr.selection !== undefined`, then asserts `scrollCursorOnSelectionChange(tr) === null`. Every guard branch now has direct coverage.
- **Commit:** `edef449 test(editor): address Claude review round 3 — vim mutation test + false-positive note`

### 8. Duck-type helper needed a false-positive gate, not just a truth-check

- **Source:** github-claude | PR #43 round 5 | 2026-04-11
- **Severity:** LOW
- **File:** `src/features/editor/hooks/useCodeMirror.test.ts`
- **Finding:** The `readScrollTargetPos` test helper duck-typed `effect.value.range.head` to read the scroll target. It was gated only on `instanceof StateEffect` at the call site — but `StateEffect` is the common base class of every CM6 effect, so any unrelated effect (compartment reconfiguration, language swap, future CM6 effects) whose `.value` accidentally had a `range.head: number` field would match. The regression test would then pass on the wrong effect. Also: the weak base-class check in the other test (`expect(effects[0]).toBeInstanceOf(StateEffect)`) would let any effect through, so a refactor that replaced `scrollIntoView(...)` with any other effect would leave both tests green.
- **Fix:** Derive a real `StateEffectType` reference by constructing a throwaway `EditorView.scrollIntoView(0)` at module load and reading its `.type` field. `.type` is a runtime field of `StateEffect` that CM6's public types don't surface, so cast through `unknown as { type: StateEffectType<unknown> }`. `readScrollTargetPos` now gates on `effect.is(scrollIntoViewType)` before accessing `.value.range.head`, so it rejects any effect that isn't genuinely a scrollIntoView. The basic "effect exists" test also calls `readScrollTargetPos` and asserts a number, so it fails if the extender is refactored to return a different effect type.
- **Commit:** `d38cf4b test(editor): tighten scrollIntoView effect detection in round-5 tests`

### 9. Extracted utility module shipped without a co-located test file

- **Source:** github-claude | PR #115 round 2 | 2026-04-30
- **Severity:** MEDIUM
- **File:** `src/features/agent-status/utils/format.ts`
- **Finding:** Round-1 review-fix promoted `formatTokens` from `BudgetMetrics.tsx` into a new `src/features/agent-status/utils/format.ts` to fix a module-boundary issue. The new file shipped **without** a sibling `format.test.ts`, even though the project rule (`CLAUDE.md`: "every .tsx/.ts file has a sibling .test.tsx/.test.ts file") is unconditional. The function was still exercised indirectly by `BudgetMetrics.test.tsx` (which kept a `describe('formatTokens', ...)` block that imported from the new path), but that test file is owned by a different module and can't be the canonical coverage owner for `format.ts`. If a later refactor of `BudgetMetrics` removed that import, `formatTokens` would silently lose all coverage with no compile-time signal.
- **Fix:** Created `src/features/agent-status/utils/format.test.ts` and **moved** the existing `describe('formatTokens', ...)` block out of `BudgetMetrics.test.tsx` into the new sibling. Avoids duplicating the cases (round-2 reviewer suggested the move, not a copy) and keeps `BudgetMetrics.test.tsx` focused on `BudgetMetrics` behaviour.
- **Commit:** `eadee9c fix(agent-status): address Claude review on TokenCache (PR #115 round 2)`

### 10. Diagnostic state machine inlined into a side-effecting function — no regression-guard tests

- **Source:** github-claude | PR #116 round 2 | 2026-04-30
- **Severity:** LOW
- **File:** `src-tauri/src/agent/watcher.rs`
- **Finding:** The `PathHistory` four-arm match (path-change, first observation, same path, no-path-reset) lived inline inside `record_event_diag`, which itself early-returns under `cfg!(debug_assertions)` and emits log side effects. There was no way to exercise the state machine in a unit test without a `Mutex`, a logger, and a `cfg!(debug_assertions)` build. The round-1 `(None, _)` reset arm — added because the original implementation counted streaks across no-path interludes — was caught by code review only, not by CI. If a later contributor "simplified" the wildcard arm thinking it was a no-op, the streak-across-interlude bug would silently regress: `repeat=N` values during a speculative-path investigation would lie, the diagnostic feature itself would mis-report, and there would be no test failure to flag it. `short_sid`, `short_path`, and `TxOutcome::label()` were also untested pure functions despite being on every diagnostic line's hot path.
- **Fix:** Extracted the state machine from `record_event_diag` into `PathHistory::observe(tx_path: Option<&str>) -> Option<String>` so each arm is unit-testable directly with no logging, no Mutex, no cfg gate. `record_event_diag` now calls `h.observe(tx_path)` and reads `h.same_path_repeat` afterwards (no behavior change). Added 11 unit tests covering: first observation, repeat increments, path-change-returns-old-and-resets-counter, **no-path-resets-streak-after-repeat (the explicit regression guard for the round-1 `(None, _)` bug)**, idempotent no-path-when-already-no-path, `short_sid` truncation / passthrough / UUID form, `short_path` basename / truncation / no-basename fallback, and `TxOutcome::label` exhaustively across all 9 variants. All 14 tests in `agent::watcher::tests` pass.
- **Commit:** _(see git log for the round-2 fix commit)_

### 11. Sleep-based synchronization in Rust integration test makes timing flaky on loaded CI

- **Source:** github-claude | PR #122 round 1 | 2026-05-01
- **Severity:** MEDIUM
- **File:** `src-tauri/tests/transcript_turns.rs`
- **Finding:** The test relied on `std::thread::sleep(Duration::from_millis(1500))` between `start_or_replace` and the assertion on `events.len()` to give the watcher's background thread time to open the transcript file, read 4 lines, and dispatch `agent-turn` events through the Tauri mock bus. On a loaded CI runner (memory pressure, slow disk, scheduler latency) the 1500 ms window can be missed — the assertion fails with `assertion failed: 2 == events.len()` non-deterministically, indistinguishable from a real regression. Same root cause as fixed-sleep waits anywhere: the deadline is implicit and cannot adapt.
- **Fix:** Replaced the sleep with a `std::sync::mpsc::channel::<()>()` signaled from the listener once `events.len() >= 2`, drained via `rx.recv_timeout(Duration::from_secs(5))`. The deadline is now explicit (5 s ceiling) and the test wakes the moment the second event lands rather than always waiting the full window. Drop the original `tx` so the channel closes if the listener is unwound before signaling.
- **Commit:** _(see git log for the round-1 fix commit)_

### 12. Boundary-shape coverage gap — mixed `tool_result + text` block-array missing from integration fixture

- **Source:** github-claude | PR #122 round 2 | 2026-05-01
- **Severity:** LOW
- **File:** `src-tauri/tests/transcript_turns.rs`
- **Finding:** The transcript-turns fixture covered three message shapes: plain-string user prompt, array-with-only-tool_result (no turn), and array-with-only-text (turn). It missed the fourth shape — `[{"type":"tool_result",...},{"type":"text","text":"follow-up"}]` — a real Claude Code pattern where the user message both drains an in-flight `tool_use` AND emits a follow-up prompt. The production code handled it correctly today, but a future refactor that short-circuited array iteration on the first non-`text` block (or split tool-result drain from turn-counting) would silently break the mixed-content path with no failing test. Same finding-class as #6 (regression-guard test that didn't actually verify the property it claimed to guard) — the test suite asserted the predicate space the author thought about, not the space the system actually inhabits.
- **Fix:** Added a 5th fixture line with `[{"type":"tool_result",...},{"type":"text","text":"follow-up"}]`, bumped the mpsc signal threshold from `len() >= 2` to `len() >= 3`, and added `assert!(events[2].contains(r#""numTurns":3"#))`. The fixture now exercises every meaningful boundary shape including the mixed case.
- **Commit:** _(see git log for the round-2 fix commit)_

### 13. Component-test gap on `numTurns=0` after refactor from conditional-render to always-render footer cell

- **Source:** github-claude | PR #122 round 3 | 2026-05-01
- **Severity:** MEDIUM
- **File:** `src/features/agent-status/components/ActivityFooter.test.tsx`
- **Finding:** The PR refactored `ActivityFooter` from a conditional-render pattern (no cell when `numTurns=0`) to an always-render pattern (`{n} turn|turns`). The pre-existing test `does not render a turns cell` was deleted and replaced with `renders singular turn label` (numTurns=1) plus a localized 1,234 case. No test exercised `numTurns=0` — the initial value of `createDefaultStatus().numTurns`, visible to users during the pre-activity window between agent detection and the first `agent-turn` replay event. Without a test, the contract was undocumented: a future contributor could re-add a `{numTurns > 0 && …}` guard thinking it's "what was meant" and silently regress the always-render intent.
- **Fix:** Added `renders 0 turns during the pre-activity window before the first agent-turn event` test that locks the always-render-with-zero contract. The test comment also documents the alternative path: if the design intent is to hide the cell pre-activity, both the test and the component must change together — not one without the other.
- **Commit:** _(see git log for the round-3 fix commit)_

### 14. Pure predicates covered only by an integration test — edge cases unpinned

- **Source:** github-claude | PR #122 round 4 | 2026-05-02
- **Severity:** LOW
- **File:** `src-tauri/src/agent/transcript.rs`
- **Finding:** `is_user_prompt` and `is_non_empty_user_block` had no in-module unit tests. Their behavior was exercised only by the integration test in `tests/transcript_turns.rs` (4–5 message shapes through a real Tauri mock app + watcher). Several edge cases were unverified by any test: whitespace-only string, empty string, empty array, all-tool_result array, mixed `tool_result + text`, unknown block type fallthrough, `text` block missing the `text` field, `text` block with non-string `text` value, block with no `type` field, block with non-string/null `type` field. Reliance on the heavy integration harness alone meant an edge-case regression would only surface when the Tauri mock app could be stood up — not in fast in-module test loops.
- **Fix:** Added 11 unit tests directly in the existing `#[cfg(test)] mod tests`: 3 string-path tests (whitespace, empty, non-whitespace), 4 array-path tests (empty, only-tool_result, whitespace-only-text, mixed), 1 non-string-content shape, 1 unknown-block-type fallthrough, 1 text-block-missing-text-field, 1 missing/non-string/null `type` fallthrough. All 11 pass; total `agent::transcript::tests` now 38. Verify-cycle-3 caught a subgap (the `type`-field tests originally only covered explicit text-typed blocks); round-4 closes it with the explicit non-string/null type tests.
- **Commit:** _(see git log for the round-4 fix commit, plus its codex-verify retry that closed the type-field subgap)_

### 16. Round-1 safety fix shipped without a regression test for its specific code path

- **Source:** github-claude | PR #124 round 2 | 2026-05-02
- **Severity:** MEDIUM
- **File:** `src-tauri/src/git/watcher.rs`
- **Finding:** Round-1 (PR #124) added a `stop_flag.load(...)` check inside the inner burst-drain loop's `Ok(()) => continue` arm — the load-bearing fix for finding #19 in async-race-conditions.md (thread pinned for ≤10s during continuous bursts at teardown). The only test added in round-1 was the happy-path `trailing_debounce_emits_once_after_final_burst_event`, which exercises the Timeout arm but never the Ok+stop_flag arm. A future refactor that accidentally reverted the check would not surface in CI: production callers don't observe the resource leak directly (just delayed shutdown), and the existing test wouldn't fail. Same finding-class as #6 (regression-guard test that didn't actually verify the property it claimed to guard) — the fix is in production but the contract proving it works isn't pinned by a test.
- **Fix:** Added `trailing_debounce_inner_loop_breaks_on_stop_flag_during_active_burst` test that flips `stop_flag` mid-burst and asserts no emit fires for a full debounce window. If the inner-loop check regresses, the burst's continuous events keep the inner loop alive past the assertion deadline → emit fires → `recv_timeout(200ms).is_err()` flips to `Ok(())` and the assertion fails. The lesson going forward: every safety fix should ship with the test that would catch its specific regression, not just the test for the original happy path.
- **Commit:** _(see git log for the round-2 fix commit)_

### 15. Real-time test sleeps with sub-2× margin against the system-under-test's debounce window are CI-fragile

- **Source:** github-claude | PR #124 round 1 | 2026-05-02
- **Severity:** LOW
- **File:** `src-tauri/src/git/watcher.rs`
- **Finding:** The `trailing_debounce_emits_once_after_final_burst_event` test sent three events with `sleep(20ms)` gaps against a 60ms debounce window — 35ms of scheduler-jitter margin. On a saturated CI runner `sleep(20ms)` realistically overshoots to 50–100ms. Any single sleep exceeding 60ms splits the burst into independent debounce windows, triggering an early emit and tripping the `recv_timeout(25ms).is_err()` assertion on line 1169. Both sleeps overshooting also breaks the "exactly one emit" assertion at line 1177. The 20/60/35 ratio sat at roughly one Linux scheduler quantum, where typical CI noise routinely violates assumptions. Same finding-class as #11 (sleep-based synchronization in Rust integration test makes timing flaky) — both are absolute-time assertions against the SUT without enough margin to absorb scheduler jitter.
- **Fix:** Doubled timing budgets: 120ms debounce window, 30ms inter-event sleeps, 50ms negative-window receive, 400ms positive-window receive. Now ~60ms scheduler margin (2× sleep) on the burst-quietness assertion. Adds ~60ms to test runtime in exchange for resilience against typical CI jitter; cheap compared to the alternative of a full event-driven synchronization mechanism.
- **Commit:** _(see git log for the round-1 fix commit)_

### 17. Regression-guard test verified an indirectly-guarded property, not the property the fix added

- **Source:** github-claude | PR #124 round 3 | 2026-05-02
- **Severity:** LOW
- **File:** `src-tauri/src/git/watcher.rs`
- **Finding:** Round-2's regression test for the inner-loop stop_flag check (added in round-1 to fix a 10s thread-pin) asserted "no spurious emit fires when stop_flag is set mid-burst." But emit() in `spawn_trailing_debounce_thread` is reached only via the Timeout arm, which already independently guards against stop_flag. So an Ok-arm regression — the very thing the round-1 fix introduced — couldn't change the emit-side observation: the Timeout arm's own guard would still suppress the emit. The test verified a real property (no spurious teardown emit) but couldn't catch the regression it was named after. The actual production risk (resource pinning ≤300ms after teardown until the burst dries up) was unobservable from the channel side. Same finding-class as #6 (regression-guard test that didn't actually verify the property it claimed to guard) — round-3 is the second instance in this codebase where assertion-on-side-effect failed to catch the regression on the guarded path.
- **Fix:** Restructured `spawn_trailing_debounce_thread` to return `(Sender<()>, Arc<AtomicBool>)`, where the bool is set from a `Drop` guard inside the spawn closure. The completion flag flips on every exit path (any return + panic), giving tests a direct observation of "thread really gone." Production caller ignores the flag (`let (tx, _completed) = ...`). The regression test now observes the flag with a `IDLE_CHECK_MS + 200ms` deadline; under the regressed path, the inner loop stays in `recv_timeout(delay)` per burst event and the deadline expires before the flag flips. Lesson: when a fix lives in branch X of a multi-branch decision, the regression test must observe a property that branch X uniquely affects — not a downstream side-effect that other branches independently produce.
- **Commit:** _(see git log for the round-3 fix commit)_

### 18. Idle-shaped hook mock + missing arg assertion masks `enabled: false` regression on lifted-state contract

- **Source:** github-claude | PR #125 round 1 | 2026-05-02
- **Severity:** LOW
- **File:** `src/features/workspace/WorkspaceView.subscription.test.tsx`
- **Finding:** The subscription test mocked `useGitStatus` to return a constant `{ idle: true, ... }` shape regardless of the options object the parent passed. With `agentStatus.isActive = true` the production code computes `enabled: true` and starts a watcher; the mock returned the same idle-state object whether `enabled` was true or false. Worse: the test never called `expect(useGitStatusMock).toHaveBeenCalledWith(..., expect.objectContaining({ enabled: true }))`. A regression that passed `enabled: false` (e.g. an accidental flip of the activation OR-condition, or a misread of `agentStatus.isActive`) would still satisfy the existing reference-equality assertions on the captured props (panel + bottom drawer would each receive the same idle object). Watcher would never start in production; UI would show a permanent empty state. Same finding-class as #6 (regression-guard test that didn't actually verify the property it claimed to guard) — a reference-equality assertion is not a substitute for asserting the input that drives the mechanism.
- **Fix:** Mock factory now reads `options.enabled` and returns `idle: !enabled`, mirroring the real hook's contract (idle iff disabled). Added a new test `WorkspaceView calls useGitStatus with enabled: true when an agent is active` that asserts `expect(useGitStatus).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ watch: true, enabled: true }))`. The pre-existing reference-equality test stays — they cover orthogonal contracts (one hook call vs. correct args).
- **Commit:** _(see git log for the round-1 fix commit)_

### 19. Lifted-state contract: child-test missing arg assertion + parent-test missing alternate-arm coverage

- **Source:** github-claude | PR #125 round 2 | 2026-05-02
- **Severity:** MEDIUM
- **File:** `src/features/agent-status/components/AgentStatusPanel.test.tsx`, `src/features/workspace/WorkspaceView.subscription.test.tsx`
- **Finding:** Round-1 fixed the parent's `enabled: true` assertion (#18) but two related gaps remained: (a) `AgentStatusPanel.test.tsx`'s "uses shared git status when provided by the parent" test verified UI output but never asserted that the internal `useGitStatus` was called with `enabled: false` — the load-bearing watcher-deduplication invariant of the lifted-state refactor. The sibling `DiffPanelContent.test.tsx` already used `vi.spyOn(useGitStatusModule, 'useGitStatus')` correctly; AgentStatusPanel's mock was a plain factory with no spy reference. A regression that dropped `gitStatus === undefined &&` from the internal enabled condition would silently start two simultaneous watchers per cwd while every test stayed green. (b) The parent's round-1 `enabled: true` test only covered the `isActive` arm of the OR-condition (`agentStatus.isActive || bottomDrawerTab === 'diff'`); since `useAgentStatus` always returned `isActive: true`, the diff-tab arm was structurally impossible to exercise. Removing `|| bottomDrawerTab === 'diff'` would still satisfy the assertion. Both gaps follow the same theme as #18 (a lifted-state assertion that doesn't actually constrain the contract it's named after).
- **Fix:** (a) Restructured `AgentStatusPanel.test.tsx` to import `* as useGitStatusModule` and call `vi.spyOn` on the test-by-test, asserting `expect(useGitStatusSpy).toHaveBeenCalledWith('/tmp/repo', expect.objectContaining({ enabled: false }))`. (b) Extended the BottomDrawer mock in `WorkspaceView.subscription.test.tsx` with a test-only "switch to diff" button bound to `onTabChange`, and added a sibling test using `vi.mocked(useAgentStatus).mockImplementation(() => idleAgentStatus)` so the agent stays idle across the tab-switch re-render. Codex verify v1 caught a `mockReturnValueOnce` bug here: the override only applied to the first render, letting the re-render fall back to the active default and passing the assertion via the wrong branch. v2 uses `mockImplementation` + `getMockImplementation` save-and-restore in a `finally` block.
- **Commit:** _(see git log for the round-2 fix commit; v1→v2 codex-verify retry documented in `.harness-github-review/cycle-2-verify-result-v{1,2}.json`)_

### 20. Inline `vi.spyOn` without `try/finally` leaks on assertion failure, polluting subsequent tests

- **Source:** github-claude | PR #125 round 3 | 2026-05-02
- **Severity:** LOW
- **File:** `src/features/agent-status/components/AgentStatusPanel.test.tsx`
- **Finding:** Round-2 added an inline `const useGitStatusSpy = vi.spyOn(useGitStatusModule, 'useGitStatus')` to assert `enabled: false` was passed to the internal hook. The matching `useGitStatusSpy.mockRestore()` lived at the bottom of the test, with no try/finally guard. If `render()` or any `expect(...)` between the spy creation and the restore throws, `mockRestore()` is skipped and the spy permanently wraps the module export for the rest of the test file. The next test (`'renders ToolCallSummary and ActivityFeed inside the scrollable region'`) calls the same hook through the leaked spy, so call counts accumulate on a spy that nothing tracks. Worst case for `toHaveBeenCalled`-shape assertions later in the file: inflated totals → false positives. The module-level mock is a plain factory (not vi.fn), so the leaked spy can't be inspected or cleared without manual intervention. Same finding-class as #18+#19 (lifted-state assertions that don't constrain what they claim) only at the test-hygiene level: the cleanup invariant is named ("restore the spy") but not enforced by structure.
- **Fix:** Wrapped the test body in `try { render + asserts } finally { useGitStatusSpy.mockRestore() }`. Cleanup now fires even if any assertion throws. Alternative considered: enable `restoreMocks: true` globally in `vitest.config.ts` — rejected for this PR because it would change behavior across the whole suite (every spy auto-restores), which is a separate refactor with its own review cycle.
- **Commit:** _(see git log for the round-3 fix commit)_

### 21. `toHaveBeenCalledWith` against accumulated mock history is vacuous unless `mockClear()` resets per-test

- **Source:** github-claude | PR #125 round 4 | 2026-05-02
- **Severity:** MEDIUM
- **File:** `src/features/workspace/WorkspaceView.subscription.test.tsx`
- **Finding:** `vi.fn()` mocks accumulate call history across tests by default. The round-1 assertion `expect(useGitStatus).toHaveBeenCalledWith(..., { enabled: true })` was structurally correct for the test's goal — but `tests 1+2 already triggered `useGitStatus({ enabled: true })`calls during their own renders. By the time the assertion executed, the mock's history already contained satisfying calls regardless of what the round-3 test's own render computed. A regression that flipped`enabled`to`false`in WorkspaceView's computation would leave the assertion green, defeating the round-1 fix entirely. Pairs with the prior round's test 4 which DID use mid-test`mockClear()` correctly — the discipline was named but not applied at the start of every test.
- **Fix:** Added `vi.mocked(useGitStatus).mockClear()` to the test suite's `beforeEach` block alongside the existing prop-bag resets. Every test now starts with a fresh history, and `toHaveBeenCalledWith` assertions can only pass via the current test's render path.
- **Commit:** _(see git log for the round-4 fix commit)_

### 22. Pass-through prop forwarding: each render-site branch needs its own coverage

- **Source:** github-claude | PR #125 round 4 | 2026-05-02
- **Severity:** LOW
- **File:** `src/features/workspace/components/BottomDrawer.test.tsx`
- **Finding:** BottomDrawer accepts `gitStatus?` and forwards it to TWO `<DiffPanelContent>` render sites (controlled-with-selectedDiffFile branch and unselected-fallback branch). Round-1 added a single test covering the unselected branch. The selected-file branch — reachable when a user has opened a specific diff file — was not covered by any test in `BottomDrawer.test.tsx`, so a regression that dropped `gitStatus={gitStatus}` from that branch (e.g. during a selectedDiffFile ternary refactor) would silently re-introduce the duplicate-watcher IPC. Codex verify caught this in v1 of round 4. Same finding-class as #7 (uncovered guard branch on doc-change-plus-selection): a multi-branch decision needs coverage for each branch the regression-class can hit, not just the one the author thought about.
- **Fix:** Split the round-1 test into two siblings — one rendering BottomDrawer without `selectedDiffFile` (unselected branch), one with a synthetic `selectedDiffFile` (controlled branch). Both assert `useGitStatus` was called with `enabled: false`. A regression dropping `gitStatus={gitStatus}` from EITHER `<DiffPanelContent>` render site is now caught.
- **Commit:** _(see git log for the round-4 fix commit, plus the v1→v2 codex-verify retry that closed the second-branch gap)_

### 23. State-invariants test omits assertion on the side-effect that drives the UI

- **Source:** github-claude | PR #126 round 1 | 2026-05-02
- **Severity:** LOW
- **File:** `src-tauri/src/git/watcher.rs` (`upgrade_to_repo_watcher_restores_failed_subscribers_for_retry`)
- **Finding:** The new test verified the in-memory state invariants of the restore path (subscriber refcounts, side-map entries, repo-watcher composition) but never registered a `git-status-changed` listener and never asserted the emit. `restore_pre_repo_subscribers` always calls `emit_git_status_changed(&app_handle, subscriber_cwds)`; if that call were accidentally removed or scoped to the wrong slice during a future refactor, the frontend's panel for the restored subscriber would stay stale (correct internal state but no initial-state refresh) and this test would still pass green. The sibling test `upgrade_to_repo_watcher_emits_once_for_duplicate_original_cwd` already demonstrated the listener-plus-sleep pattern; the new test simply didn't replicate it. Same finding-class as #6/#17 (regression-guard tests that didn't actually verify the property they claimed to guard) — internal-state coverage is necessary but not sufficient for a contract whose UI consumer is event-driven.
- **Fix:** Registered an `app.handle().listen("git-status-changed", ...)` collector mirroring the sibling test's pattern, slept 100 ms after the upgrade call, then asserted that at least one collected payload contains `missing_cwd`. Used `events.iter().any(...)` rather than `events.len() == 1` because the upgrade phase emits independently before the restore phase, so the restored subscriber's emit may be the second of multiple events on the channel.
- **Commit:** _(see git log for the round-1 fix commit)_

### 24. Fixed-window `sleep + assert collected events` pattern is inherently racy for Tauri listener dispatch

- **Source:** github-claude | PR #126 round 4 | 2026-05-02
- **Severity:** LOW
- **File:** `src-tauri/src/git/watcher.rs` test `upgrade_to_repo_watcher_restores_failed_subscribers_for_retry`
- **Finding:** The round-1 test added a `git-status-changed` listener that pushed payloads into a `Vec`, then slept 100 ms, then asserted that the vec contained an entry referencing `missing_cwd`. Tauri's mock runtime dispatches event listeners on a separate thread; 100 ms is not a guaranteed bound on dispatch latency. On a saturated CI host (high CPU, GC pauses, slow filesystem) the dispatch thread may not have run within the window, producing a false-negative "missing emit" failure that's hard to reproduce locally. Same finding-class as #11 (sleep-based synchronization in transcript-turns test) — every fixed-deadline assertion against asynchronous dispatch eventually flakes when the runner gets loaded enough.
- **Fix:** Replaced the `Arc<Mutex<Vec<String>>> + sleep` collector with an `mpsc::channel::<String>()` whose Sender is captured by the listener closure. The test runs an explicit drain loop with `events_rx.recv_timeout(remaining)` and a 1-second deadline. The first event whose payload contains `missing_cwd` flips a `found` flag and breaks the loop early; both `Timeout` and `Disconnected` end the drain. The assertion message names the deadline so a slow CI failure has clear diagnostic value. Pattern matches the existing #11 mpsc-channel fix in `transcript_turns.rs`.
- **Commit:** _(see git log for the round-4 fix commit)_

### 25. Documented `exec claude` invariant (root PID itself is the agent) had no test

- **Source:** github-claude | PR #128 round 1 | 2026-05-02
- **Severity:** LOW
- **File:** `src-tauri/src/agent/detector.rs`
- **Finding:** PR #128 explicitly motivated `collect_process_tree` including the root PID to handle `exec claude` (where the user replaces a shell with the agent binary in-place — the PTY's own root PID becomes `claude` with no shell intermediary). The implementation was correct; the comment documented the contract; both new tests (`detects_only_agent_inside_pty_process_tree`, `ignores_agent_outside_pty_process_tree`) exercised in-tree-descendant scenarios but never the root-IS-agent scenario. A future refactor that restored the old skip-root behavior would silently regress the PR's primary motivating use case while passing every existing test. Same finding-class as #6/#16/#17 — a contract documented in code/comments but not pinned by an assertion that fails when the contract breaks.
- **Fix:** Added `detects_agent_at_pty_root_via_exec` test using a `MockProcessSource` whose root PID 12 maps directly to `claude` cmdlines with no `children` entry. Asserts `detect_agent_with_source(12, &source) == Some((AgentType::ClaudeCode, 12))`. If a future refactor reverts to skip-root, the descendant lookup returns no candidates and the assertion fails on `None`.
- **Commit:** _(see git log for the round-1 fix commit)_

### 26. Mutually-exclusive option combination not pinned by a test, leaving precedence undocumented

- **Source:** github-claude | PR #130 round 2 | 2026-05-02
- **Severity:** LOW
- **File:** `src/features/diff/services/gitPatch.test.ts`
- **Finding:** `buildGitDiffArgs` accepts both `staged: boolean` and `baseBranch?: string`. The implementation returns the staged form (`['--cached', ...]`) unconditionally when `staged` is true, regardless of whether `baseBranch` is also set — but no test exercised the combination, so the precedence was undocumented. A future maintainer asked to "support staged comparisons against a branch" could plausibly merge the two and would have no failing test to flag the behavior change. Same finding-class as #7 (uncovered guard branch) — multi-input decisions need explicit per-combination coverage, not just per-input.
- **Fix:** Added a pinning test `staged: true takes precedence over baseBranch (no merge of the two)` asserting the staged form is returned even when both flags are set. Comment in the test documents that they're treated as mutually exclusive call shapes today; combining them would require updating this test, which makes the design choice explicit.
- **Commit:** _(see git log for the round-2 fix commit)_

### 27. Index-0 boundary on a shift-then-index helper untested while a mid-array index is

- **Source:** github-claude | PR #130 round 3 | 2026-05-02
- **Severity:** LOW
- **File:** `src/features/diff/services/gitPatch.test.ts`
- **Finding:** `extractHunkPatch` calls `hunks.shift()` to drop the pre-`@@` header block, then returns `hunks[index]`. The positive test exercised index 1 (a mid-array hunk) and several null-return cases. Index 0 — the most sensitive boundary, where an off-by-one in `shift()` would surface — was not tested. A future refactor that removed the shift (or changed the split shape) would silently return the file-header block as the patch on index-0 calls; `git apply` would either fail or apply garbage. The mid-array test would still pass because `hunks[1]` (now the first real hunk in the regressed layout) would satisfy the existing assertions. Same finding-class as #7 — uncovered branch in a multi-step transform; a positive test for the index-0 path is the small explicit regression guard.
- **Fix:** Added `extracts the first hunk (index 0) — the boundary case after shift()` test asserting the index-0 patch contains `@@ -1,2 +1,2 @@` and `+added first` (and excludes the second hunk's markers). No new fixture needed — the existing `diffText` already has two hunks. The comment documents WHY the index-0 case is the critical boundary so a future maintainer can't dismiss the test as redundant with the index-1 test.
- **Commit:** _(see git log for the round-3 fix commit)_

### 28. Symmetric branch added without parallel test fixture

- **Source:** github-claude | PR #131 round 1 | 2026-05-02
- **Severity:** LOW
- **File:** `src-tauri/src/git/mod.rs`
- **Finding:** PR #131 added rename-metadata parsing (`rename from`/`rename to` header pair) AND symmetric copy-metadata parsing (`copy from`/`copy to`) in the same `or_else` arm. The new test only exercised the rename fixture; the structurally-identical copy branch had no parallel fixture, so an edge-case regression in copy-header parsing (e.g. casing, whitespace, future git format change) would silently produce `old_path: None` / `new_path: None` with no failing assertion. Same finding-class as #7 (uncovered guard branch) — adding a sibling case to a multi-branch decision needs sibling test coverage.
- **Fix:** Added `test_parse_git_diff_copy_metadata` that mirrors the rename test exactly except for the header verbs (`copy from`/`copy to`) and fixture file names (`template.txt` → `copy.txt`). Same assertions on `old_path`, `new_path`, hunk count, and stable hunk id.
- **Commit:** _(see git log for the round-1 fix commit)_

---

### 29. Test asserts byte length where function contract is char count: false assurance for multi-byte UTF-8

- **Source:** github-claude | PR #152 round 7 (cycle 9) | 2026-05-03
- **Severity:** LOW
- **File:** `src-tauri/src/agent/adapter/claude_code/transcript.rs`
- **Finding:** `truncate_string` enforces the invariant `output.chars().count() <= max_len` (it uses `chars().count()` for the length check and `char_indices().nth(...)` for the cut point — UTF-8 char-boundary safe). The existing test `truncate_string_long` asserted `result.len() <= MAX_ARGS_LEN`, which measures bytes. For all-ASCII inputs the two assertions agree, so the test passed; but for multi-byte UTF-8 input (CJK paths, emoji file names) the byte length of the truncated string can significantly exceed `MAX_ARGS_LEN` (97 three-byte CJK chars + `"..."` = 294 bytes for `max_len = 100`) while the function still correctly enforces its char-count contract. No functional breakage today, but the test gives false assurance that a byte budget is respected — a future caller assuming a byte cap (storage limit, log-line cap) would be silently misled by a green CI.
- **Fix:** Changed the assertion to `result.chars().count() == 100` (still passes for ASCII because `len()` and `chars().count()` agree there) and added `truncate_string_long_cjk_respects_char_boundary` that drives `truncate_string` with a 200-CJK-char input, asserts `chars().count() == 100`, and explicitly proves byte length exceeds the char cap (`assert!(result.len() > 100, ...)`) so future regressions to byte-based logic are caught. The lesson: when a function's contract is expressed in one unit (chars), the test must measure in that unit; a "natural" `len()` on the result silently picks the wrong unit and shipping it gives false assurance.
- **Commit:** _(see git log for the cycle-9 fix commit)_

---

### 30. Hand-rolled calendar algorithm with shape-only test: no regression signal for off-by-one in leap-year accounting

- **Source:** github-claude | PR #152 round 7 (cycle 9) | 2026-05-03
- **Severity:** LOW
- **File:** `src-tauri/src/agent/adapter/claude_code/transcript.rs`
- **Finding:** `now_iso8601()` formats UTC timestamps via a bespoke `days_to_date` algorithm (the Hinnant civil-calendar formula) rather than depending on `chrono`/`time`. The function is invoked as a fallback when a transcript JSONL line has no `timestamp` field, and its output flows directly into `AgentToolCallEvent.timestamp` and the UI activity feed. The existing `now_iso8601_format` test validated only the output shape — length 20, `Z` suffix, separator positions — but asserted no specific calendar dates. An off-by-one in the leap-year accounting (`year % 400 == 0` vs. `year % 100 == 0` vs. `year % 4 == 0`) or the March-epoch offset would produce silently wrong timestamps with no regression signal. The Hinnant algorithm is mathematically sound, but hand-rolled calendar math warrants pinned-date assertions that future edits cannot regress.
- **Fix:** Added `days_to_date_pinned_dates` test with 9 cases covering the boundary conditions where leap-year accounting most often drifts: Unix epoch (`1970-01-01`), 1972's first leap day (`789 → 1972-02-29`) and the day after, year-2000 leap day (`11016 → 2000-02-29` — divisible by 400 ⇒ leap) plus the day after, year-2100 non-leap (`47540 → 2100-02-28`, `47541 → 2100-03-01` — divisible by 100 but not 400 ⇒ not leap), a post-2038 sanity check (`25339 → 2039-05-18`), and a millennium turnover (`10957 → 2000-01-01`). Expected values were cross-checked against Python's `datetime.date(1970,1,1) + timedelta(days=N)`. The first attempt at this test had two off-by-one expected values (`11017 → 2000-02-29` instead of `11016`, and `25324 → 2039-05-18` instead of `25339`); the cross-check caught both before commit. The lesson: shape-only tests for hand-rolled calendar/date math are insufficient — pin specific dates (epoch, leap days, century non-leap, post-2038), AND cross-check expected values against an authoritative library before asserting them, because a wrong-but-self-consistent expected value gives a confident green that masks a wrong implementation.
- **Commit:** _(see git log for the cycle-9 fix commit)_

---

### 31. Mock implementation reads its own `mock.calls` to gate stateful behaviour — relies on Vitest's call-recording-before-impl ordering

- **Source:** github-claude | PR #152 round 8 (cycle 10) | 2026-05-03
- **Severity:** LOW
- **File:** `src/features/agent-status/hooks/useAgentStatus.test.ts`
- **Finding:** The F1 regression test built a stateful Vitest mock (first `detect_agent_in_session` call returns an agent; subsequent calls return null) by reading `invokeMock.mock.calls.filter(...)` INSIDE its own implementation to determine which call number it was on. This works today because Vitest records the `(args)` pair into `mock.calls` BEFORE invoking the user-supplied implementation. That ordering is an implementation detail of Vitest's spy wrapper, not a documented contract. A future Vitest version that records calls AFTER invoking the implementation would silently break this regression test: `detectCalls` inside the first call would be 0 (the call hasn't been recorded yet), the agent-result branch would never fire, `isActive` would never flip, the F1 fix would silently stop being verified.
- **Fix:** Replaced `invokeMock.mock.calls.filter(...)` with a closure-captured `let detectCallCount = 0` counter incremented inside the `detect_agent_in_session` branch. Same observable behaviour (first call returns agent, subsequent calls return null) without depending on Vitest's spy-wrapper ordering. The lesson: when a mock needs stateful behaviour across calls, NEVER introspect the framework's internal recording state from inside the implementation — use a closure-captured variable, `mockResolvedValueOnce(...).mockResolvedValue(...)`, or a counter in module scope. The framework's recording state is observable but not contractual.
- **Commit:** _(see git log for the cycle-10 fix commit)_
