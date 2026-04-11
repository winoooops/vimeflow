---
id: testing-gaps
category: testing
created: 2026-04-09
last_updated: 2026-04-11
ref_count: 0
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
