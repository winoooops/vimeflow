---
id: testing-gaps
category: testing
created: 2026-04-09
last_updated: 2026-04-10
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
