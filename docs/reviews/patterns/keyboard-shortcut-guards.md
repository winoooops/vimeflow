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
