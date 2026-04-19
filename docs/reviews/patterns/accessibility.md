---
id: accessibility
category: a11y
created: 2026-04-09
last_updated: 2026-04-10
ref_count: 1
---

# Accessibility

## Summary

Interactive components must have correct ARIA attributes and keyboard navigation.
`aria-activedescendant` must reference elements with the correct role, and keyboard
handlers must not trap focus without implementing the promised behavior.

## Findings

### 1. ARIA active descendant points to non-option element

- **Source:** github-codex | PR #14 | 2026-04-01
- **Severity:** MEDIUM
- **File:** `src/features/command-palette/components/CommandResults.tsx`
- **Finding:** `aria-activedescendant` set on listbox while focus remains in input, and referenced id is on `motion.div` wrapper rather than `role="option"` element
- **Fix:** Moved `aria-activedescendant` to focused input and ensured id is on the option element
- **Commit:** `e05cd3d feat: assemble complete Agent Activity panel (#14)`

### 2. ARIA active descendant target lacks role option

- **Source:** github-codex | PR #14 | 2026-04-01
- **Severity:** MEDIUM
- **File:** `src/features/command-palette/components/CommandResultItem.tsx`
- **Finding:** `role="option"` element lacks the id that `aria-activedescendant` points to
- **Fix:** Added id to the option element itself
- **Commit:** `e05cd3d feat: assemble complete Agent Activity panel (#14)`

### 3. Tab key globally trapped without behavior

- **Source:** github-codex | PR #21 | 2026-04-03
- **Severity:** LOW
- **File:** `src/features/diff/hooks/useDiffKeyboard.ts`
- **Finding:** Keyboard handler prevents default on Tab and calls a no-op handler, blocking focus navigation
- **Fix:** Removed Tab handler until feature is implemented
- **Commit:** `92eff2e feat: add lazygit-style git diff viewer (#21)`

### 4. Keyboard navigation order doesn't match sorted display

- **Source:** github-codex | PR #21 | 2026-04-03
- **Severity:** MEDIUM
- **File:** `src/features/diff/DiffView.tsx`
- **Finding:** `ChangedFilesList` sorts files by status for display but keyboard nav uses unsorted array indices
- **Fix:** Used same sorted list for both rendering and keyboard selection
- **Commit:** `92eff2e feat: add lazygit-style git diff viewer (#21)`

### 5. UnsavedChangesDialog lacks focus trap — keyboard users escape modal

- **Source:** github-claude | PR #38 round 6 | 2026-04-10
- **Severity:** LOW
- **File:** `src/features/editor/components/UnsavedChangesDialog.tsx`
- **Finding:** The dialog set `role="dialog"` and `aria-modal="true"` but had no JS focus trap. `aria-modal` is an assistive-tech hint, not a browser-enforced constraint — Tab cycled through all focusable elements in the DOM behind the overlay, letting keyboard users trigger another file selection and conflict with `pendingFilePath`.
- **Fix:** Add a JS focus trap that cycles Tab/Shift-Tab among the three action buttons while the dialog is open. Auto-focus Save on open via useEffect + ref. Add `aria-describedby` pointing at the body text.
- **Commit:** `36902f7 fix: address Claude review round 6 findings`

### 6. Shift+Tab always jumps to first button when entering dialog backwards

- **Source:** github-claude | PR #38 round 7 | 2026-04-10
- **Severity:** LOW
- **File:** `src/features/editor/components/UnsavedChangesDialog.tsx`
- **Finding:** When focus was not currently on a dialog button, the focus-trap handler always deposited focus on the FIRST button (Save) regardless of Tab/Shift-Tab direction. Standard ARIA modal navigation expects Shift+Tab to land on the LAST focusable element (Cancel — the safe exit), not the primary destructive action.
- **Fix:** Branch on `event.shiftKey` when `currentIndex === -1` — Shift+Tab → last button, Tab → first button.
- **Commit:** `1545491 fix: address Claude review round 7 findings`

### 7. Dialog `aria-label` shadows rendered `<h2>` heading

- **Source:** github-claude | PR #38 round 10 | 2026-04-10
- **Severity:** LOW
- **File:** `src/features/editor/components/UnsavedChangesDialog.tsx`
- **Finding:** The dialog used `aria-label="Unsaved changes dialog"` (static string), which shadows the visible `<h2>Unsaved Changes</h2>`. Per ARIA spec, when both are present, aria-label wins — screen readers announced the static string instead of the visible heading, and any future heading text change wouldn't propagate to the announced name.
- **Fix:** Remove `aria-label`, add `id` to the `h2`, and use `aria-labelledby={labelId}` on the dialog. Generate the id with `useId` for SSR-safety.
- **Commit:** `4f6972f fix: address Claude review round 10 findings`

### 8. BottomDrawer collapse button is a dead interactive control

- **Source:** github-claude | PR #38 round 8 | 2026-04-10
- **Severity:** HIGH
- **File:** `src/features/workspace/components/BottomDrawer.tsx`
- **Finding:** The "Collapse drawer" button had `aria-label` and `cursor-pointer` styling but no `onClick` handler and no `type` attribute — a WCAG 4.1.2 violation. Clicking produced no response.
- **Fix:** Wire to an `isCollapsed` state that shrinks the drawer to the tab bar height (48px). Swap the chevron icon, aria-label, and `aria-expanded` accordingly. Add `type="button"`.
- **Commit:** `3e0304f fix: address Claude review round 8 findings`

### 9. BottomDrawer resize handle is mouse-only — no keyboard support

- **Source:** github-claude | PR #38 round 7 | 2026-04-10
- **Severity:** LOW
- **File:** `src/features/workspace/components/BottomDrawer.tsx`
- **Finding:** The resize handle was a plain `<div>` with `onMouseDown` and `aria-label`, but no `role`, `tabIndex`, or keyboard event handler — `aria-label` on a non-interactive div is ignored by assistive tech, and keyboard/switch-access users couldn't adjust the drawer. WCAG 2.5.1 violation.
- **Fix:** Promote to `role="separator"` with `aria-orientation`, `aria-valuenow/min/max`, `tabIndex={0}`. Add Arrow up/down keyboard handlers (20px step, Shift = 100px) via a new `adjustBy(delta)` method on `useResizable`. Home/End jump to min/max.
- **Commit:** `1545491 fix: address Claude review round 7 findings`

### 10. Resize handle remains active while drawer collapsed — clobbers expanded height

- **Source:** github-claude | PR #38 round 11 | 2026-04-10
- **Severity:** LOW
- **File:** `src/features/workspace/components/BottomDrawer.tsx`
- **Finding:** A collapsed drawer visually pinned at 48px still received mouse drags and keyboard arrow events via the handle, silently mutating the underlying `useResizable.size` state. When the user re-expanded, the drawer snapped to the accidentally mutated size instead of the original expanded height.
- **Fix:** Gate all interactive behavior on `isCollapsed`: `onMouseDown` → undefined, `onKeyDown` → undefined, `tabIndex` → -1, `aria-disabled` → true, `pointer-events-none` class.
- **Commit:** `6681af0 fix: address Claude review round 11 findings`

### 11. UnsavedChangesDialog lacks focus restoration on close

- **Source:** github-claude | PR #38 round 13 | 2026-04-10
- **Severity:** MEDIUM
- **File:** `src/features/editor/components/UnsavedChangesDialog.tsx`
- **Finding:** The dialog moved focus to the Save button on open but never recorded or restored the previously focused element. On close (especially Cancel, where the user intended to keep editing), focus landed on `document.body`. The CodeMirror editor div is not natively focusable (it relies on `view.focus()`), so vim shortcuts silently no-oped until the user clicked back into the editor.
- **Fix:** Capture `document.activeElement` into `previousFocusRef` when the dialog opens, restore to it when it closes. On the CodeMirror path, the previously focused element is `.cm-content` (natively focusable), so restoration reactivates vim key handling.
- **Commit:** `3999b50 fix: address Claude review round 13 findings`
