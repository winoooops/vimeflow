---
id: keyboard-shortcut-guards
category: keyboard-shortcuts
created: 2026-05-18
last_updated: 2026-05-18
ref_count: 0
---

# Keyboard Shortcut Guards

## Summary

Capture-phase keyboard listeners that implement global shortcuts must guard
against three classes of false-fire:

1. **Terminal-zone passthrough** — `Ctrl+e/g` (readline) and `Ctrl+b` (tmux)
   must not be stolen when xterm has focus. Guard with `if (inTerminalZone) return`
   before the relevant key branches.
2. **Hardcoded attribute selectors** — `closest('[data-container-id="dock"]')` should
   use the exported constant via a template literal to avoid silent breakage if the
   value is renamed.
3. **Duplicated guard constants** — `DIALOG_SELECTOR` and other shared predicates
   should be exported from a single source-of-truth module (e.g. `containerIds.ts`)
   and imported by each hook; duplication causes divergence when the guard needs
   updating.

## Findings

### 1. Ctrl+e/g intercept inside terminal zone steals readline shortcuts

- **Source:** github-claude | PR #218 | 2026-05-18
- **Severity:** MEDIUM
- **File:** `src/features/workspace/hooks/useDockShortcuts.ts`
- **Finding:** `Ctrl+e` (readline "end-of-line") and `Ctrl+g` (bash abort) were
  consumed by the capture-phase listener even when xterm's `<textarea>` had focus,
  because the existing `isTextEntry && !inTerminalZone` guard was written to _allow_
  terminal-zone shortcuts through, inadvertently also including the xterm hidden
  textarea. The same guard pattern is already used correctly in `usePaneShortcuts`'s
  reclaim path.
- **Fix:** Added `if ((key === 'e' || key === 'g') && inTerminalZone) return` before
  the dock-shortcut branches, matching the existing `.xterm-helper-textarea` guard
  pattern in `usePaneShortcuts`.
- **Commit:** `fix(workspace): address round-2 Claude review findings on focus highlight PR`

### 2. Hardcoded `'[data-container-id="dock"]'` selector instead of constant

- **Source:** github-claude | PR #218 | 2026-05-18
- **Severity:** LOW
- **File:** `src/features/terminal/hooks/usePaneShortcuts.ts`
- **Finding:** The dock-reclaim branch used the raw string `'[data-container-id="dock"]'`
  instead of the `DOCK_CONTAINER_ID` constant from `containerIds.ts`. If `DOCK_CONTAINER_ID`
  is renamed the selector silently stops matching with no type error and no failing test.
- **Fix:** Imported `DOCK_CONTAINER_ID` from `../../workspace/containerIds` and used a
  template literal: `` `[data-container-id="${DOCK_CONTAINER_ID}"]` ``.
- **Commit:** `fix(workspace): address round-2 Claude review findings on focus highlight PR`

### 4. Ctrl+e/g also stolen from CodeMirror vim mode

- **Source:** github-claude | PR #218 | 2026-05-18
- **Severity:** HIGH
- **File:** `src/features/workspace/hooks/useDockShortcuts.ts`
- **Finding:** After adding the `inTerminalZone` guard, `Ctrl+e` (vim scroll-viewport-down) and
  `Ctrl+g` (vim print file location) were still consumed by the capture-phase listener when
  CodeMirror had focus. `inCodeMirror` was explicitly exempted from the `isTextEntry` pass-through
  so that dock shortcuts could fire from other panels, but this also meant dock shortcuts fired
  _over_ CodeMirror vim bindings. The fix requires a symmetric guard for both surfaces.
- **Fix:** Extended the guard to `if ((key === 'e' || key === 'g') && (inTerminalZone || inCodeMirror)) { return }`.
  Added two unit tests covering the vim-mode collision path.
- **Commit:** `fix(workspace): address round-3 Claude review findings on focus highlight PR`

### 5. focusEditor() silently drops DOM focus when editorView returns false

- **Source:** github-claude | PR #218 | 2026-05-18
- **Severity:** MEDIUM
- **File:** `src/features/workspace/components/DockPanel.tsx`
- **Finding:** `DockPanel.focusEditor()` did not check the boolean return of
  `editorHandleRef.current.focus()`. When no file is loaded (`filePath=null`), the `CodeEditorHandle`
  returns `false` and focuses nothing, but the fallback `sectionRef.current?.focus()` branch
  was only reached when the handle itself was null — not when the handle existed but `focus()` failed.
  Result: visual focus ring appears (dock marked active) with no keyboard target.
- **Fix:** `const ok = editorHandleRef.current.focus(); if (!ok) { sectionRef.current?.focus(); } return ok`
- **Commit:** `fix(workspace): address round-3 Claude review findings on focus highlight PR`

### 6. borderClass contained redundant Tailwind side-specific color utilities

- **Source:** github-claude | PR #218 | 2026-05-18
- **Severity:** LOW
- **File:** `src/features/workspace/components/DockPanel.tsx`
- **Finding:** Each branch of the `borderClass` ternary applied both `border-[color]` (all sides)
  and `border-{side}-[color]` (side-specific override), producing dead redundant classes since only
  one border edge has non-zero width.
- **Fix:** Extracted `borderColor` constant and simplified each branch to `border-{edge} border-[${borderColor}]`.
- **Commit:** `fix(workspace): address round-3 Claude review findings on focus highlight PR`

### 3. DIALOG_SELECTOR duplicated verbatim across both shortcut hooks

- **Source:** github-claude | PR #218 | 2026-05-18
- **Severity:** LOW
- **File:** `src/features/workspace/hooks/useDockShortcuts.ts`,
  `src/features/terminal/hooks/usePaneShortcuts.ts`
- **Finding:** Both hooks defined an identical `const DIALOG_SELECTOR = '...'` locally.
  If dialog-guard logic changes (e.g. adding `[aria-modal="true"]`), both constants
  must be updated independently; divergence means one hook could fire inside a dialog
  while the other does not.
- **Fix:** Exported `DIALOG_SELECTOR` from `src/features/workspace/containerIds.ts` and
  imported it in both hooks, removing the local definitions.
- **Commit:** `fix(workspace): address round-2 Claude review findings on focus highlight PR`

### 7. Tailwind JIT cannot detect border color in dynamic template literal

- **Source:** github-claude | PR #218 | 2026-05-18
- **Severity:** HIGH
- **File:** `src/features/workspace/components/DockPanel.tsx`
- **Finding:** Refactoring `borderClass` to use `border-[${borderColor}]` with a variable
  meant Tailwind JIT's static scanner could not emit `border-[rgba(74,68,79,0.3)]` in the
  production CSS bundle, causing the unfocused junction border to disappear. Color values
  in Tailwind arbitrary-value classes must appear as complete literal strings.
- **Fix:** Extracted `borderEdge` (position-dependent, variable) and kept color literals
  static: `` `${borderEdge} border-[#cba6f7]` `` and `` `${borderEdge} border-[rgba(74,68,79,0.3)]` ``.
  Both color strings are literal substrings visible to the Tailwind JIT scanner.
- **Commit:** `fix(workspace): address round-4 Claude review findings on focus highlight PR`

### 8. paneRefSetters map accumulates stale closures on pane unmount

- **Source:** github-claude | PR #218 | 2026-05-18
- **Severity:** LOW
- **File:** `src/features/terminal/components/SplitView/SplitView.tsx`
- **Finding:** `getPaneRefSetter` cleaned up `paneHandleRefs` on `null` (unmount) but never
  deleted the corresponding setter from `paneRefSetters`, causing the factory map to grow
  without bound across pane create/destroy cycles.
- **Fix:** Added `paneRefSetters.current.delete(id)` alongside `paneHandleRefs.current.delete(id)`
  in the null branch of each setter.
- **Commit:** `fix(workspace): address round-4 Claude review findings on focus highlight PR`

### 9. forwardRef components require file-level eslint-disable for require-default-props

- **Source:** github-claude | PR #218 | 2026-05-18
- **Severity:** LOW
- **File:** `DockPanel.tsx`, `TerminalZone.tsx`, `SplitView.tsx`, `TerminalPane/index.tsx`
- **Finding:** `react/require-default-props { functions: 'defaultArguments' }` does not
  recognize inline destructuring defaults inside `forwardRef` wrappers — it sees the
  interface declaration but cannot trace through the `forwardRef()` call to find the
  inner function's defaults. File-level disables are necessary for `forwardRef` components.
- **Fix:** Restored file-level eslint-disable comments with an explanatory rationale
  (`-- forwardRef components: ESLint cannot see through forwardRef to find destructuring defaults`).
- **Commit:** `fix(workspace): address round-4 Claude review findings on focus highlight PR`

### 10. Ctrl+b from CodeMirror incorrectly fires claimTerminal

- **Source:** github-claude | PR #218 | 2026-05-18
- **Severity:** MEDIUM
- **File:** `src/features/workspace/hooks/useDockShortcuts.ts`
- **Finding:** The `Ctrl+b` handler's guard checked `activeContainerId === DOCK_CONTAINER_ID`
  and `closest('[data-container-id="dock"]')`, but not `!inCodeMirror`. Because CodeMirror
  lives inside the dock `<section>`, both checks pass when the editor has focus — causing
  `claimTerminal` to fire and yank focus to the terminal during vim/Emacs editing (vim: page-back,
  Emacs: backward-char).
- **Fix:** Added `!inCodeMirror &&` to the `key === 'b'` condition, mirroring the guard already
  applied to `e`/`g`. Added companion test verifying Ctrl+b does not fire from CodeMirror.
- **Commit:** `fix(workspace): address round-5 Claude review finding on focus highlight PR`

### 11. onContainerFocus double-invocation on pointer clicks

- **Source:** github-claude | PR #218 | 2026-05-18
- **Severity:** MEDIUM
- **File:** `src/features/workspace/components/DockPanel.tsx`,
  `src/features/workspace/components/TerminalZone.tsx`
- **Finding:** `handlePointerDown` called `onContainerFocus?.()` directly, then a child
  element got focus and the `onFocus` (bubbling) handler fired the same callback again.
  Today harmless (idempotent `setActiveContainerId`), but any future consumer with
  observable side-effects would see 2-3× invocations per click.
- **Fix:** Removed the direct `onContainerFocus?.()` call from `handlePointerDown` in both
  components; `onFocus` alone covers pointer and keyboard Tab paths.
- **Commit:** `fix(workspace): address round-6 Claude review findings on focus highlight PR`
