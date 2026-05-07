---
id: accessibility
category: a11y
created: 2026-04-09
last_updated: 2026-05-06
ref_count: 4
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

### 12. Stat-card label/value/hint trio rendered as `<span>`s — no semantic association for screen readers

- **Source:** github-claude | PR #115 round 1 | 2026-04-30
- **Severity:** LOW
- **File:** `src/features/agent-status/components/TokenCache.tsx`
- **Finding:** The `StatCell` sub-component stacked three `<span>` elements (label / value / hint) inside a `<div>`. Screen readers announced the three cells of the stat grid as one run of text — `"cached 7.5k free reuse wrote 1.8k uploaded fresh 700 new tokens"` — with no structural hint that `7.5k` was the value for `cached`. Violates WCAG 1.3.1 (Info and Relationships) and the project's a11y mandate in `rules/typescript/coding-style/CLAUDE.md`.
- **Fix:** Promote the outer grid container to `<dl>` and rewrite each cell as `<dt>` (term/label) + `<dd>` (value, retains the existing `data-testid` for tests) + `<dd>` (hint/description). Wrapping the per-cell `<dt>`/`<dd>` group in a `<div>` inside the `<dl>` is valid per the HTML living standard (added in 2015) and lets the existing card layout stay unchanged. Tailwind classes preserved → zero visual change.
- **Commit:** `570d225 fix(agent-status): address Claude review on TokenCache (PR #115 round 1)`

---

### 13. Persistent chrome bar shipped as a bare `<div>` — no landmark for screen-reader region navigation

- **Source:** github-claude | PR #173 round 2 | 2026-05-06
- **Severity:** LOW
- **File:** `src/features/workspace/components/StatusBar.tsx`
- **Finding:** The new `StatusBar` placeholder rendered its container as a `<div>` with no ARIA landmark. Persistent bottom chrome is the canonical use case for `role="contentinfo"` (or the implicit landmark on `<footer>`); without it, VoiceOver/NVDA users navigating by landmark cannot reach or skip over the bar, and screen-reader users have no programmatic anchor to identify the region. A "placeholder until step 9" rationale was wrong — the container element is what step 9 inherits, and removing landmarks gives downstream developers a div-only baseline that they then have to retrofit. Same finding-class as #5 (button-styled spans), #6 (drag handle missing role), #11 (focus restoration) — structural a11y omissions on otherwise-correct interactive scaffolding.
- **Fix:** Swapped the outer `<div>` for `<footer>` with `aria-label="App status"`. `<footer>` directly inside the workspace root (not nested in `<section>`/`<article>`) carries the implicit `role="contentinfo"`, so the bar now appears in landmark navigation. Added a sibling test asserting `getByRole('contentinfo')` resolves with the explicit accessible name. Code-review heuristic: any persistent layout strip — top bar, bottom bar, side rail — should ship with its semantic landmark on day one, not deferred to a "polish" pass; the landmark is part of the scaffolding, not styling.
- **Commit:** _(see git log for the cycle-2 fix commit on PR #173)_

---

### 14. Focus restoration via raw template-literal CSS attribute selector — silent break or `SyntaxError` on hostile session ids

- **Source:** github-claude | PR #174 round 15 | 2026-05-06
- **Severity:** MEDIUM
- **File:** `src/features/workspace/components/Sidebar.tsx`
- **Finding:** `Sidebar.handleRemoveSession` queued a `queueMicrotask` that called `document.querySelector(`[data-session-id="${nextId}"] [data-role="activate"]`)` to restore keyboard focus after closing a session. `nextId` was interpolated raw into a CSS attribute-selector string. The current session-id schema is UUID-only, so no real input today corrupts the selector — but the invariant lived implicitly in the caller, not enforced by the focus-restoration code. A future schema change (e.g. accepting a user-chosen alias as the session id) that allows `"` or `]` would either silently no-op (`querySelector` returns `null` → focus lands on `<body>`) or throw `SyntaxError` from inside the microtask, which is uncaught and observably breaks keyboard nav. Same finding-class as #11 (focus restoration) — focus-management code paths must enforce their own invariants because the symptom (focus on `<body>`) is invisible until a real keyboard user notices.
- **Fix:** Mirrored the `SessionTabs` pattern (`document.getElementById(`session-tab-${nextId}`)`). Both `SessionRow` and `RecentSessionRow` now render their absolute-overlay activation `<button>` with an explicit `id={`sidebar-activate-${session.id}`}`, and `handleRemoveSession` switched to `document.getElementById(`sidebar-activate-${nextId}`)`. `getElementById` treats its argument as a plain DOMString — no parsing, no escaping, no dependency on session-id character class. The two parallel focus-restoration paths in the workspace now use the same lookup mechanism (consistency that's easier to maintain than two mechanisms). Code-review heuristic: when interpolating any non-static value into a `querySelector` argument, prefer `getElementById` (or wrap with `CSS.escape`) — the security/correctness flavor of "untrusted-string-into-parser" applies to DOM selectors the same way it applies to SQL/shell, even when the current input class is "safe" by accident.
- **Commit:** _(see git log for the cycle-15 fix commit on PR #174)_

### 15. E2E helper still used raw `${id}` CSS attribute selector after the same cycle fixed it in production code

- **Source:** github-claude | PR #174 round 16 | 2026-05-06
- **Severity:** LOW
- **File:** `tests/e2e/terminal/specs/multi-tab-isolation.spec.ts`
- **Finding:** Cycle 15 fixed `Sidebar.handleRemoveSession`'s raw attribute-selector interpolation by switching to `getElementById` (finding #14 above). The directly analogous helper `getLatestSessionTabId` in the e2e spec — `document.querySelector(`[data-testid="terminal-pane"][data-session-id="${id}"]`)` — was not updated in the same pass. Same correctness invariant: a session id containing `"` or `]` corrupts the selector and either silently returns null OR throws `SyntaxError` from inside `browser.execute` (producing a cryptic test-infrastructure failure rather than an assertion failure). The risk is theoretical today (UUIDs only) but the asymmetry — production is hardened, test infra isn't — is itself a code-smell.
- **Fix:** Switched to `document.getElementById(`session-panel-${id}`)`. `TerminalZone` already renders every panel wrapper as `id="session-panel-${session.id}"`(added in earlier cycles for`aria-labelledby`linkage), so no production-side change was required. Code-review heuristic: when a production fix moves untrusted-string-into-parser to a safer alternative, scan the WHOLE codebase (especially`tests/`) for the same pattern in the same cycle — review-fix scope is per-finding, but pattern propagation is per-file-class.
- **Commit:** _(see git log for the cycle-16 fix commit on PR #174)_

### 16. SessionTab `aria-label` did not reflect status change when active session exited (silent on running→completed/errored)

- **Source:** github-claude | PR #174 round 16 | 2026-05-06
- **Severity:** LOW
- **File:** `src/features/workspace/components/SessionTabs.tsx`
- **Finding:** When an active running session exits, its tab stays visible per the "exited active keeps its tab" contract (so the Restart pane in the tabpanel below remains reachable), but the live-status pip is intentionally hidden — and the tab's `aria-label={session.name}` is unchanged. Sighted users see the pip vanish silently with no replacement glyph. Screen-reader users navigating the tablist hear `'auth, tab'` before AND after the session exited and would never know the session needs restart until they Tab into the panel — violating WCAG 2.1 SC 4.1.3 (Status Messages, AA), which requires programmatic exposure of status changes.
- **Fix:** `aria-label` is now `${session.name} (ended)` for completed and errored statuses; running and paused remain `session.name` only. Zero visual change (the pip-hidden behavior is preserved as the visual heartbeat-only-for-live-sessions pattern). Added a regression test asserting both completed and errored variants of an active tab produce the suffixed accessible name. Code-review heuristic: when an interactive element survives a state transition that hides its only feedback affordance, the alternate state needs a programmatic substitute (`aria-label` suffix, `aria-live` region, etc.) — "silent retention" is an accessibility regression even when the element technically still exists.
- **Commit:** _(see git log for the cycle-16 fix commit on PR #174)_
