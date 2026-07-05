---
id: accessibility
category: a11y
created: 2026-04-09
last_updated: 2026-07-05
ref_count: 88
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

### 17. Roving-tabindex condition only handled the `null` activeSessionId case — stale non-null id after `flushSync` left the entire tablist with `tabIndex=-1` for one frame

- **Source:** github-claude | PR #174 round 17 | 2026-05-07
- **Severity:** MEDIUM
- **File:** `src/features/workspace/components/SessionTabs.tsx`
- **Finding:** `useSessionManager.removeSession` calls `flushSync` internally, producing an intermediate React commit where `sessions` has dropped the removed session but `activeSessionId` still holds its (now-stale) id. `getVisibleSessions` cannot include the removed id (no longer in `sessions`), so every visible tab evaluates `id === activeSessionId` as false — and the `activeSessionId === null` guard does not fire either because the id is non-null-but-stale. All visible tabs receive `tabIndex=-1`, the WAI-ARIA roving-focus invariant collapses, and the tablist becomes keyboard-unreachable for that render frame. The bug is invisible when React batches the close+select state updates into one render; only the `flushSync` path surfaces it. Same finding-class as #11 (focus restoration) — focus-management code paths must enforce their own invariants because the symptom (focus on `<body>`, no focusable tab) is invisible until a real keyboard user notices.
- **Fix:** Computed `hasFocusMatch = open.some(s => s.id === activeSessionId)` once at the SessionTabs body. Changed `isFocusEntryPoint` from `id === activeSessionId || (activeSessionId === null && idx === 0)` to `id === activeSessionId || (!hasFocusMatch && idx === 0)`. The new condition collapses three roving-focus cases (initial null, fresh-load no-active, stale flushSync) to a single first-tab fallback; exactly one tab always carries `tabIndex=0` when `open` is non-empty. Added a regression test asserting that a non-null but stale `activeSessionId` still leaves the first visible tab as the entry point. Code-review heuristic: roving-tabindex fallbacks must key on "no tab matches activeSessionId" (a _visible-set property_), NOT on "activeSessionId is null" (a _raw-state property_) — the former covers the latter and also covers the stale-id case that the latter misses.
- **Commit:** _(see git log for the cycle-17 fix commit on PR #174)_

### 18. Optional callback prop produces a focusable interactive button that no-ops when the callback is undefined

- **Source:** github-claude | PR #182 round 2 | 2026-05-08
- **Severity:** MEDIUM
- **File:** `src/features/workspace/sessions/components/List.tsx`
- **Finding:** `List` accepts `onNewInstance?: () => void` and unconditionally renders an `Add session` `<button onClick={onNewInstance}>` in the Active group's `headerAction` slot. When a consumer omits `onNewInstance` (it is typed optional), `onClick={undefined}` is set on a fully-visible, fully-focusable button — it renders, accepts focus, appears interactive, and silently no-ops on click and keyboard activation. Screen readers announce it as an interactive control. Same finding-class as #8 (BottomDrawer collapse button is a dead interactive control): when an interactive element survives a state where its underlying behavior is absent, the alternate state needs either programmatic suppression (don't render) or a programmatic disabled signal (`disabled` attribute, `aria-disabled` + visual treatment). Visible-focusable-noop is the worst of the three options: it claims an interactive role the user can never exercise.
- **Fix:** Gated the `headerAction` ternary on `onNewInstance` presence — `headerAction={onNewInstance ? <button onClick={onNewInstance} ...>add</button> : undefined}`. Matches the pattern already used elsewhere in the same file for `onRemoveSession` / `onRenameSession` callbacks. Added a regression test asserting `screen.queryByRole('button', { name: 'Add session' })` returns null when `onNewInstance` is omitted. Code-review heuristic: when a component prop is `optional callback`, every UI affordance whose behavior the callback supplies must be conditionally rendered on the callback's presence — `onClick={undefined}` is legal React and produces no type error, so the lint and type-check passes hide the API-contract bug.
- **Commit:** _(see git log for the cycle-2 fix commit on PR #182)_

### 19. WAI-ARIA splitter exposes range attributes but ships without `tabIndex` or keyboard handler — interactive role with no keyboard interaction

- **Source:** github-claude | PR #182 round 4 | 2026-05-08
- **Severity:** MEDIUM
- **File:** `src/components/sidebar/Sidebar.tsx`
- **Finding:** The Sidebar bottom-pane resize handle was given `role="separator"` plus `aria-valuenow`/`aria-valuemin`/`aria-valuemax` — the WAI-ARIA Splitter pattern, signalling an interactive widget AT can interrogate. But the element had no `tabIndex` (not in the tab order) and no `onKeyDown` handler. Screen readers announce "separator, 320 of 100 to 500" and then offer the user no mechanism to act on that range information. Keyboard-only users cannot resize the FileExplorer pane at all. The ARIA attributes create an expectation the element never fulfils — strictly worse than omitting the range attributes, because the user doesn't know to give up and reach for the mouse. Same finding-class as #8 (interactive role on element with no behavior): ARIA roles that name interactivity carry an implicit interaction contract; satisfying the visual / pointer half but not the keyboard half is an a11y regression.
- **Fix:** Added `tabIndex={0}` to the separator (focusable), `aria-label="Resize bottom pane"` (clearer announcement), and an `onKeyDown` handler delegating to `useResizable.adjustBy`: ArrowUp grows the pane (consistent with `invert: true` mouse semantics where dragging UP increases size), ArrowDown shrinks; PageUp/PageDown apply a 40px step; Home/End jump to min/max. Each branch calls `e.preventDefault()` so page-scroll defaults don't fire while the separator owns focus. Added focus-visible ring styling. Six new regression tests in `Sidebar.test.tsx`. Closed #180. Code-review heuristic: any element with `role="separator"` AND `aria-valuenow`/`-valuemin`/`-valuemax` is an _interactive_ splitter and MUST have `tabIndex={0}` + keyboard handler; either ship both halves of the contract or remove the range attributes (a non-interactive separator is `role="separator"` alone, no aria-value attrs).
- **Commit:** _(see git log for the cycle-4 fix commit on PR #182)_

### 20. `aria-keyshortcuts` MUST reference shortcuts that are currently active — pre-announcing planned shortcuts misleads AT

- **Source:** local-codex | PR #182 round 4 (verify pass) | 2026-05-08
- **Severity:** LOW
- **File:** `src/features/workspace/sessions/components/Tabs.tsx`
- **Finding:** During cycle-4 the upstream Claude review's IDEA "Alternatives" section suggested adding `aria-keyshortcuts="Control+Shift+] Meta+Shift+] ..."` to the tablist as an interim doc gesture for the planned-but-unimplemented next/prev session shortcut (#177). Codex verify caught this: per the WAI-ARIA spec, `aria-keyshortcuts` MUST name shortcuts that are currently active — "Authors MUST ensure that any keyboard shortcut listed in aria-keyshortcuts will, when triggered, perform the indicated action." Pre-announcing #177's planned binding before the global shortcut is wired would mislead screen-reader users into trying a non-functional key combination. Strictly worse than the original gap: the original gap is silent ("no nav shortcut"), the broken doc gesture is _audibly wrong_ ("you can press Cmd+Shift+]" → nothing happens). Same anti-pattern as #19 inverted: there #19 advertises an interactive role without delivering the interaction; here `aria-keyshortcuts` advertises a binding without delivering the action.
- **Fix:** Reverted the interim `aria-keyshortcuts` attempt; left an inline code comment on the tablist documenting (a) why arrow-key cycling cannot be hosted on the tablist itself (xterm.js focus-trap), (b) why the proper fix is the global #177 shortcut, and (c) why we explicitly DO NOT advertise the planned shortcut via `aria-keyshortcuts` ahead of time. The original [LOW] reviewer finding becomes a deferred architectural-constraint acknowledgement, not an unfixed bug. Code-review heuristic: when a code-review IDEA suggests an `aria-*` attribute as a "doc gesture" for not-yet-built behavior, check the WAI-ARIA spec wording for that attribute — many a11y attributes are imperative ("MUST"), not informative, and adding them speculatively is a regression.
- **Commit:** _(see git log for the cycle-4 fix commit on PR #182)_

### 21. Material Symbols icon span inside an `aria-label`-bearing button missed `aria-hidden="true"` — duplicate text exposure to screen readers

- **Source:** github-claude | PR #185 cycle 1 | 2026-05-08
- **Severity:** LOW
- **File:** `src/features/workspace/components/SessionsView.tsx`
- **Finding:** The "+ New Instance" gradient button in `SessionsView` carries `aria-label="New Instance"` (correct accessible name) but the inner `<span class="material-symbols-outlined">bolt</span>` had no `aria-hidden`. Project a11y rules (`rules/typescript/coding-style/a11y-components.md`) require `aria-hidden="true"` on Material Icon spans because the icon's text content (`"bolt"`) is read as a plain text node by some screen readers in addition to the button's `aria-label`, producing duplicated output like "bolt New Instance" on AT readers that walk children even when an explicit accessible name is set (NVDA, JAWS, VoiceOver disagree on this). Same pattern as #1 / #6 (icon-decoration AT exposure). The accent-bar `<span>` in `SidebarTabs.tsx` (added in the same PR) demonstrates the correct pattern (`aria-hidden` without value = `aria-hidden={true}` in JSX); `InfoBanner.tsx` also follows it. The new SessionsView introduction missed it.
- **Fix:** Added `aria-hidden="true"` to the icon span: `<span className="material-symbols-outlined text-lg" aria-hidden="true">bolt</span>`. **Code-review heuristic:** any `<span class="material-symbols-outlined">` rendered inside a focusable interactive element (button, link) MUST carry `aria-hidden="true"` — even when the parent has an `aria-label`. The `aria-label` only sets the accessible name; child text nodes can still be exposed by walked-tree AT implementations.
- **Commit:** _(see git log for the cycle-1 fix commit on PR #185)_

### 22. `aria-label` on an `aria-hidden="true"` button is silently ignored — misleads future maintainers

- **Source:** github-claude | PR #190 round 1 | 2026-05-09
- **Severity:** LOW
- **File:** `src/features/sessions/components/Tab.tsx`
- **Finding:** The Tab close button carried both `aria-hidden="true"` (intended — the button is decorative chrome only revealed on hover/focus-within; keyboard close uses `Delete`/`Backspace` on the focused tab) AND `aria-label={`Close ${session.name}`}`. `aria-hidden="true"` removes the element from the accessibility tree entirely; any `aria-label` on the same element (or its descendants) is never announced by assistive technology. The label was therefore dead — a leftover from a prior iteration where the button was AT-visible. Misleads code review and a11y audit tools, which will flag the inconsistency.
- **Fix:** Removed `aria-label` from the close button to match the stated intent. Added `data-testid="close-tab-button"` so vitest queries (which previously used `getByLabelText(/Close /i)`) can still find the button without an accessible name. Code-review heuristic: `aria-label` and `aria-hidden="true"` on the same node is always wrong — pick one. If the element should be in the AT tree, drop `aria-hidden`; if it shouldn't, drop `aria-label`.
- **Commit:** _(see git log for the cycle-1 fix commit on PR #190)_

### 23. `<div onClick>` registered for click-to-focus has no keyboard equivalent (WCAG 2.1.1)

- **Source:** github-claude | PR #190 cycle 3 | 2026-05-09
- **Severity:** LOW
- **File:** `src/features/terminal/components/TerminalPane/Footer.tsx`
- **Finding:** The Footer wrapper `<div data-testid="terminal-pane-footer">` registered an `onClick={onClickFocus}` handler to make clicking anywhere on the decorative input bar move keyboard focus into the terminal. The `<input>` inside was `readOnly`, `tabIndex={-1}`, and `aria-hidden="true"`. Net effect: keyboard-only users could not activate the focus affordance through standard tab navigation, and AT users saw no interactive element at all. WCAG 2.1.1 (Keyboard) requires every interactive control to be keyboard-operable; an `onClick` on a non-interactive element fails this criterion. Same anti-pattern applies anywhere a `<div onClick>` exists without `role`+`tabIndex`+`onKeyDown`.
- **Fix:** Wrapped the `>` glyph + readOnly input inside a real `<button type="button" aria-label="Focus terminal">` that calls `onClickFocus` on click. The outer `<div>` becomes presentational chrome with no `onClick`. The button gets keyboard activation for free (Enter/Space) plus AT discoverability via the explicit role + label. Added a Footer test that asserts the button responds to `userEvent.keyboard('{Enter}')`. Code-review heuristic: any `<div>` registering `onClick` should be either (a) wrapped around an inner `<button>` that is the actual interactive surface, or (b) explicitly given `role="button" + tabIndex={0} + onKeyDown` (with Enter/Space activation). The wrapper-button approach is preferred because it leverages the browser's built-in keyboard handling rather than re-implementing it.
- **Commit:** _(see git log for the cycle-3 fix commit on PR #190)_

### 24. `aria-hidden` on a discoverable interactive control hides it from screen-reader + mouse users

- **Source:** github-claude | PR #190 cycle 3 | 2026-05-09
- **Severity:** LOW
- **File:** `src/features/sessions/components/Tab.tsx`
- **Finding:** Cycle-1's fix removed `aria-label` from the Tab close button on the rationale that aria-label is silently ignored when `aria-hidden="true"` (#22). Cycle-3 review caught the deeper issue: setting `aria-hidden` on the close button was the wrong corrective. `aria-hidden` removes the element from the AT tree entirely, so screen-reader + mouse users (e.g. switch access, low-vision users using a pointer) cannot find or activate the × control. Visual opacity (`opacity-0`) is independent of AT visibility — hiding visually does NOT require hiding from AT. This is a different anti-pattern from #22: that finding caught a contradictory pair (`aria-label` + `aria-hidden`); this finding catches the choice to use `aria-hidden` for a control that should be visually-hidden-but-AT-visible.
- **Fix:** Dropped `aria-hidden="true"` from the close button. Restored `aria-label={`Close ${session.name}`}`. Kept the visual hover-reveal classes (`opacity-0` + `pointer-events-none` + `group-hover:opacity-100` + `group-focus-within:opacity-100`) — those control visual state without affecting AT visibility. Kept `tabIndex={-1}` per WAI-ARIA Tabs Pattern §3.27 (descendants of role=tab are reached via shortcut, not Tab key). Result: AT-visible label, mouse-hover-reveal, keyboard close still via Delete/Backspace on the focused tab. Code-review heuristic: when "hiding" an interactive control from sighted users until hover/focus, use CSS opacity + pointer-events; do NOT use `aria-hidden` — the latter blanket-removes the control from screen readers regardless of cursor type, breaking the screen-reader-with-mouse use case.
- **Commit:** _(see git log for the cycle-3 fix commit on PR #190)_

### 25. `<input>` (or any interactive descendant with tabindex) nested inside `<button>` violates the HTML interactive-content model

- **Source:** github-claude | PR #190 cycle 4 | 2026-05-09
- **Severity:** LOW
- **File:** `src/features/terminal/components/TerminalPane/Footer.tsx`
- **Finding:** Cycle-3's fix wrapped the `>` glyph + a decorative `readOnly tabIndex={-1} aria-hidden="true"` `<input>` inside a real `<button aria-label="Focus terminal">` to give the click-to-focus affordance a keyboard-discoverable surface. Per HTML5 §4.10.6, `<button>` content cannot include interactive content (`<input>` is interactive content), and per §4.10.6.1 `<button>` cannot contain any element carrying a `tabindex` attribute. Both rules are violated here. Modern browsers + jsdom handle the nesting correctly in practice (event bubbling works, `aria-hidden` suppresses AT exposure), but the markup fails HTML validators and accessibility-audit tools, and could break in stricter parsers or future browser versions. Class of bug: a "fake-input" rendered with a real `<input>` element to inherit the native placeholder pseudo-element.
- **Fix:** Replaced the `<input>` with a `<span>` displaying the placeholder text directly. The span has no a11y semantics, no tabindex, and no interactive role — purely text content inside the `<button>`, which is fully spec-compliant. Visual result is identical because the input's only visible state was its placeholder, which is the same string the span now renders. Code-review heuristic: when wrapping a row in a `<button>` for keyboard activation, audit every descendant for interactive content (input, select, textarea, anchor, another button) AND for `tabindex` — both rules are independent. Decorative "input-shaped" UI should be a `<span>` or `<div>`, not `<input>`.
- **Commit:** _(see git log for the cycle-4 fix commit on PR #190)_

### 26. aria-pressed={collapsed} inverted when paired with action label

- **Source:** github-claude | PR #352 round 1 | 2026-06-06
- **Severity:** MEDIUM
- **File:** `src/features/workspace/components/SidebarToggle.tsx`
- **Finding:** When `collapsed=true`, the button rendered `aria-label="Show sidebar"` and `aria-pressed="true"`. A screen reader announced "Show sidebar, toggle button, pressed" — "pressed" in ARIA means the toggle's _on_ state is active, which a listener interprets as "the show-sidebar action is currently engaged" (sidebar is visible). But the sidebar is actually hidden, directly contradicting the signal.
- **Fix:** Replaced `aria-pressed={collapsed}` with `aria-expanded={!collapsed}` — the WAI-ARIA-recommended attribute for controls that reveal/hide a panel. Updated co-located test assertions accordingly.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 27. Focus lost to body when in-card toggle collapses the sidebar

- **Source:** github-claude | PR #352 round 2 | 2026-06-06
- **Severity:** MEDIUM
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** When a keyboard or assistive-technology user activates the `SidebarToggle` inside `AgentStatusCard`, the button lives inside the sidebar subtree that is about to become `inert`. Browsers remove focus from elements in an inert subtree (Chromium drops it on `document.body`), and the replacement rail toggle does not receive focus automatically. The result is a confusing loss of focus context every time the sidebar is collapsed from the card.
- **Fix:** Forward a `railToggleRef` from `WorkspaceView` through `IconRail` to the rail `SidebarToggle`, set a `focusRailAfterCollapseRef` flag in the in-card toggle callback, and use a `useEffect` that focuses the rail toggle after `sidebarCollapsed` transitions to `true`. Keyboard shortcut and palette paths keep the original `toggleSidebar` so they do not steal focus from the terminal/editor.
- **Commit:** same commit as this entry

### 28. RateLimitBar lacks `role=progressbar` and `aria-value*` attributes

- **Source:** github-claude | PR #352 round 2 | 2026-06-06
- **Severity:** LOW
- **File:** `src/features/agent-status/components/RateLimitBar.tsx`
- **Finding:** The shared `RateLimitBar` component rendered a visual progress bar as two nested `<div>` elements with no ARIA role or value attributes. Screen readers could not interpret the fill width as a bounded value, so AT users only heard the adjacent label and percentage text without the programmatic range semantics.
- **Fix:** Added `role="progressbar"`, `aria-valuenow={Math.round(percentage)}`, `aria-valuemin={0}`, and `aria-valuemax={100}` to the outer track `<div>`, and added a co-located test asserting the role and value attributes.
- **Commit:** same commit as this entry

### 29. RateLimitBar progressbar lacks accessible name

- **Source:** github-claude | PR #352 round 3 | 2026-06-06
- **Severity:** HIGH
- **File:** `src/features/agent-status/components/RateLimitBar.tsx`
- **Finding:** The progressbar `<div>` had `role="progressbar"` and `aria-value*` attributes but no `aria-label` or `aria-labelledby`. The visible label lived in a preceding sibling `<span>` with no programmatic association. Screen readers announced a bare percentage with no context about what the bar measures, violating WCAG 2.1 SC 4.1.2 (Name, Role, Value).
- **Fix:** Added `aria-label={label}` to the progressbar `<div>` so the accessible name matches the visible label text. No test changes were needed beyond the existing `getByRole('progressbar')` query which now implicitly verifies the name.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 30. Production focus guard depends on `data-testid` selectors

- **Source:** github-claude | PR #364 round 1 | 2026-06-06
- **Severity:** MEDIUM
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** The post-toggle focus guard used `document.querySelector('[data-testid="sidebar-toggle-tabs"]')` / `sidebar-toggle-topbar` to restore focus after collapse or expand. Runtime a11y behavior was coupled to test-only string names, so a routine test-id rename could silently strand keyboard focus on `<body>` after every sidebar toggle. Same finding-class as #14 (focus restoration via raw CSS selector) — focus-management code paths must enforce their own invariants because the symptom (focus on `<body>`) is invisible until a real keyboard user notices.
- **Fix:** Replaced the `data-testid` DOM query with `useRef<HTMLButtonElement>` refs forwarded to the top-bar and tabs toggle instances, and focused the selected ref inside the deferred guard. `SidebarToggle` already forwarded refs via `forwardRef`, so the change was localized: two new refs in `WorkspaceView`, a new `toggleRef` prop on `SidebarTopBar` that forwards to its `SidebarToggle`, and the guard selects the appropriate ref instead of querying the DOM.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 31. Session actions menu toggle does not expose expanded/collapsed state

- **Source:** github-claude | PR #383 round 1 | 2026-06-07
- **Severity:** MEDIUM
- **File:** `src/features/sessions/components/Card.tsx`
- **Finding:** The PR added a new kebab menu toggle button whose visible state is controlled by `menuOpen`, but the button only had `aria-label="Session actions"` and did not expose `aria-expanded`. Screen-reader users could focus and activate the control but received no feedback about whether the action menu was open or closed, leaving assistive tech without the control's current value. WCAG 4.1.2 (Name, Role, Value) violation.
- **Fix:** Added `aria-expanded={menuOpen}` and `aria-haspopup="menu"` to the Session actions button. The `menuOpen` state already existed; wiring it into ARIA closes the gap with minimal regression risk.
- **Commit:** see `git blame` / `git log` on this line

### 32. Removed aria-hidden on visible title span reinstates double-announcement

- **Source:** github-claude | PR #383 round 1 | 2026-06-07
- **Severity:** LOW
- **File:** `src/features/sessions/components/Card.tsx`
- **Finding:** During a className refactor the `aria-hidden="true"` attribute was dropped from the session-name `<span>`. The sibling overlay activation `<button>` already carries `aria-label={session.name}`, so browse-mode screen readers now encounter the same text twice: once as the button's accessible name, once as the span's text content.
- **Fix:** Restored `aria-hidden="true"` on the title span with an updated comment explaining the rationale. Zero visual or interaction impact.
- **Commit:** same commit as finding #31

### 33. `aria-haspopup="menu"` declared without matching menu role semantics

- **Source:** github-claude | PR #383 round 2 | 2026-06-07
- **Severity:** HIGH
- **File:** `src/features/sessions/components/Card.tsx`
- **Finding:** The Session actions button carried `aria-haspopup="menu"`, promising assistive technology a menu widget. The popup was a plain `<div>` and `MenuRow` rendered plain `<button>` elements with no `role="menu"` or `role="menuitem"`. Screen readers announced a menu that did not exist, breaking the ARIA contract and potentially trapping users in an unexpected navigation mode.
- **Fix:** Removed `aria-haspopup="menu"` from the trigger button. The popup remains a simple disclosure-style button group; `aria-expanded` already communicates open/closed state. This avoids the cost of implementing the full APG menu keyboard contract (arrow keys, Home/End, focus management) for a two-item action list.
- **Commit:** see `git blame` / `git log` on this line

### 34. Kebab popup has no Escape dismissal path

- **Source:** github-claude | PR #383 round 2 | 2026-06-07
- **Severity:** MEDIUM
- **File:** `src/features/sessions/components/Card.tsx`
- **Finding:** The actions menu could be opened from the keyboard but had no Escape handler. Keyboard-only or AT users who opened the popover and decided not to choose an action were forced to Tab away or activate an unintended item. The existing `onBlur` close logic only fired when focus moved to another focusable element.
- **Fix:** Added a document-level `keydown` listener (scoped to `menuOpen === true`) that calls `setMenuOpen(false)` and returns focus to the trigger button via a `useRef`. The listener is cleaned up on unmount or when the menu closes. Co-located tests assert Escape dismissal and focus restoration.
- **Commit:** see `git blame` / `git log` on this line

### 35. Title-click activation leaves the kebab menu visually open

- **Source:** github-claude | PR #383 round 2 | 2026-06-07
- **Severity:** MEDIUM
- **File:** `src/features/sessions/components/Card.tsx`
- **Finding:** The session title `<span>` has its own `onClick` handler that forwards to `onClick(session.id)`. Because the span is not focusable, clicking it does not move focus and therefore does not trigger the kebab wrapper's `onBlur` close path. The result: the session activates while the actions popover remains visible, producing misleading stale UI.
- **Fix:** Prepended `setMenuOpen(false)` to the title span's `onClick` handler before forwarding to `onClick(session.id)`. A co-located test asserts that the menu closes and the session still activates.
- **Commit:** same commit as finding #33

### 36. Pane count hidden from assistive technology inside `aria-hidden` glyph wrapper

- **Source:** review-comment-4644952225 | PR #388 | 2026-06-08
- **Severity:** MEDIUM
- **File:** `src/features/sessions/components/Card.tsx`
- **Finding:** The newly added `session-pane-count` span was nested inside a parent `<span aria-hidden="true">` that wraps the decorative layout glyph. The sibling overlay activation `<button>` carried only `aria-label={session.name}`, so screen-reader users navigating session cards received the session name but not the newly added multi-pane count — meaningful workspace state that sighted users see.
- **Fix:** Computed an `ariaLabel` constant: when `showGlyph` is true, `${session.name} (${LAYOUTS[session.layout].capacity} panes)`; otherwise `session.name`. Wired `aria-label={ariaLabel}` into the activation button. Added co-located regression tests asserting both the multi-pane suffix and the single-pane absence.
- **Commit:** see `git blame` / `git log` on this line

### 37. Escape-close doesn't restore focus — keyboard users stranded on <body>

- **Source:** github-claude | PR #409 round 1 | 2026-06-10
- **Severity:** HIGH
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** When the compact sidebar is open and the user presses Escape to close it, `closeOnEscape` calls `setCompactSidebarOpen(false)` without setting `shouldRestoreSidebarToggleFocusRef.current = true`. The focus-guard effect then finds the flag false and returns early, leaving focus on `document.body` — a WCAG 2.4.3 violation.
- **Fix:** Added `shouldRestoreSidebarToggleFocusRef.current = true` immediately before `setCompactSidebarOpen(false)` inside `closeOnEscape` so the existing focus-guard RAF picks it up and refocuses the tabs-bar toggle.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 38. Test locates inert wrapper via `parentElement!` — fragile DOM traversal

- **Source:** github-claude | PR #409 round 1 | 2026-06-10
- **Severity:** LOW
- **File:** `src/features/workspace/WorkspaceView.test.tsx`
- **Finding:** The test found the main workspace div with `screen.getByTestId('dock-canvas-wrapper').parentElement!`. If any intermediate wrapper were inserted, the assertion would check the wrong element's `inert` / `aria-hidden` attributes.
- **Fix:** Added `data-testid="workspace-main"` to the main workspace div in `WorkspaceView.tsx` and updated the test to query `screen.getByTestId('workspace-main')` directly.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 39. Compact sidebar drawer lacks dialog semantics while behaving as a modal overlay

- **Source:** github-codex-connector | PR #409 round 2 | 2026-06-10
- **Severity:** HIGH
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** The changed compact sidebar path makes the main workspace inert/aria-hidden and displays a scrim, so the sidebar is presented as a modal overlay in real use whenever a compact viewport user opens it. Without `role="dialog"`, `aria-modal`, and an accessible label on the active drawer container, assistive technology users do not get a programmatic modal context.
- **Fix:** Added conditional dialog semantics to the sidebar wrapper when the compact drawer is open: `role={isCompactViewport && !isSidebarClosed ? 'dialog' : undefined}`, `aria-modal={isCompactViewport && !isSidebarClosed ? true : undefined}`, and `aria-label={isCompactViewport && !isSidebarClosed ? 'Sidebar' : undefined}`. The props are only applied on the compact open path; the non-compact sidebar path is unchanged.
- **Commit:** see `git blame` / `git log` on this line

### 40. Scrim close path does not opt into focus restoration

- **Source:** github-codex-connector | PR #409 round 2 | 2026-06-10
- **Severity:** MEDIUM
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** The scrim is a newly added dismissal path for the compact drawer. Its `onClick` closes the drawer without setting the existing `shouldRestoreSidebarToggleFocusRef` flag, unlike the Escape path, so focus can fall back to `document.body` after the clicked scrim unmounts. This affects mixed pointer/keyboard users.
- **Fix:** Set `shouldRestoreSidebarToggleFocusRef.current = true` before calling `setCompactSidebarOpen(false)` in the scrim `onClick` handler, aligning the scrim dismissal path with the existing Escape behavior and letting the post-toggle focus guard refocus the visible toggle.
- **Commit:** see `git blame` / `git log` on this line

### 41. Compact sidebar shortcut opens modal drawer without focus restoration

- **Source:** github-claude | PR #409 round 3 | 2026-06-10
- **Severity:** MEDIUM
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** `handleToggleSidebar` sets `shouldRestoreSidebarToggleFocusRef.current` only when the active element is one of the sidebar toggle buttons. `useSidebarShortcut` intentionally fires from terminal/editor focus, so on compact viewports the shortcut can open the dialog-style sidebar while the main workspace becomes `inert` and the focus guard returns early. This plausibly leaves keyboard users on `document.body` or otherwise outside the newly opened modal drawer, a WCAG focus-order regression in new compact-mode behavior.
- **Fix:** When compact mode is about to open the sidebar, set `shouldRestoreSidebarToggleFocusRef.current = true` regardless of which element was focused (based on action intent `!compactSidebarOpen` rather than prior active element). Keep the guard for non-compact and close paths. Add a regression test that mocks `requestAnimationFrame`, fires the shortcut from `document.body`, simulates browser inert-focus-eviction by refocusing body, flushes the guard frame, and asserts the topbar toggle receives focus.
- **Commit:** see `git blame` / `git log` on this line

### 42. Compact sidebar shortcut close from drawer content drops focus to body

- **Source:** github-codex-connector | PR #409 round 4 | 2026-06-10
- **Severity:** HIGH
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** In compact mode, `handleToggleSidebar` sets `shouldRestoreSidebarToggleFocusRef.current = isToggleButtonFocused || !compactSidebarOpen`. On the close path, `compactSidebarOpen` is true, so a keyboard user who has tabbed from the drawer toggle into sidebar content and then uses the sidebar shortcut will leave the flag false. Closing makes the drawer content inert/hidden, the focus guard exits early, and focus can land on `document.body` with no visible focus target. This is a deterministic new compact-mode WCAG focus-order regression.
- **Fix:** In the compact branch of `handleToggleSidebar`, unconditionally set `shouldRestoreSidebarToggleFocusRef.current = true` for all user-triggered compact toggles (both open and close). This aligns with the Escape and scrim dismissal paths. Also fixed `useSidebarShortcut` to not bail on the compact sidebar drawer itself (which carries `role="dialog"` for a11y) while preserving the existing bailout for real dialogs such as the command palette. Added a regression test that opens the drawer, focuses the Command Palette button inside it, fires the sidebar shortcut, and asserts focus lands back on the tabs toggle.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 43. Idle-but-live shell state removed from `aria-label` — assistive tech cannot distinguish "no shell" from "shell idle"

- **Source:** github-claude | PR #367 | 2026-06-06
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/HeaderActions.tsx`
- **Finding:** A PR renaming Scratch → Burner narrowed the visual running cue to foreground commands only (`burnerActive`) and simultaneously removed the separate accessible shell-exists state. The result: `aria-label` read identically for "no burner shell" and "burner shell alive but idle." In normal hide-not-kill use (e.g. after a shell returns to the prompt while background work continues), screen-reader users lost the pane-local cue that sighted users still get indirectly through visual/global status surfaces. The foreground-only amber tint is a reasonable visual design choice, but removing the separate accessible state conflates lifecycle and foreground activity for assistive technology.
- **Fix:** Added a new `burnerShellExists` boolean prop to `HeaderActions` (threaded through `Header` → `TerminalPane` → `SplitView` → `TerminalZone` → `WorkspaceView` from the existing `runningBurnerPaneKeys` set computed by `useBurnerTerminals`). The `aria-label` now has three honest states: `open burner terminal (running)` when active, `open burner terminal (live)` when the shell exists but is idle, and `open burner terminal` when no shell exists. Visual styling (amber tint vs. gray) remains driven solely by `burnerActive` — no visual change for the idle-but-live case. Added a regression test asserting the button resolves with the `(live)` accessible name when `burnerShellExists` is true and `burnerActive` is false.
- **Commit:** _(see git log for the cycle-1 fix commit on PR #367)_

### 44. Closing a modal dialog can leave DOM focus inside the hidden subtree

- **Source:** github-claude | PR #389 round 2 | 2026-06-08
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/BurnerTerminalPopup/index.tsx`
- **Finding:** The `useEffect([open])` called `focusTerminal()` when `open` became `true`, but had no symmetric branch for `open === false`. After dismissing the popup via Escape, the xterm `<textarea>` retained DOM focus while its ancestor was `display:none`. Subsequent global keyboard shortcuts (pane-navigation chords, command-palette trigger) fired in the context of the hidden element, requiring a mouse click on a visible pane to recover keyboard control.
- **Fix:** Added an `else` branch to the focus effect: `(document.activeElement as HTMLElement | null)?.blur()`. This removes focus from any element inside the hidden popup without needing a return-focus ref to the opener. Added a regression test asserting that after hiding, the previously-focused backdrop button no longer has focus.
- **Commit:** _(see git log for the cycle-2 fix commit on PR #389)_

### 45. `role="dialog"` container missing `aria-modal`

- **Source:** github-claude | PR #389 round 2 | 2026-06-08
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/BurnerTerminalPopup/index.tsx`
- **Finding:** The burner popup rendered `role="dialog"` and `aria-label="Burner terminal"` but omitted `aria-modal`. Without it, screen readers (NVDA, JAWS browse mode, VoiceOver) do not restrict virtual cursor navigation to the dialog, so a screen-reader user can Tab or arrow-key into background terminal panes while the popup appears open.
- **Fix:** Added `aria-modal={open}` to the outer `role="dialog"` div so the modal containment signal is present only while the popup is visible. Added a regression test asserting `aria-modal="true"` when open and `"false"` when hidden.
- **Commit:** _(see git log for the cycle-2 fix commit on PR #389)_

### 46. Full-screen backdrop dismiss button participates in sequential keyboard navigation

- **Source:** github-claude | PR #389 round 2 | 2026-06-08
- **Severity:** LOW
- **File:** `src/features/terminal/components/BurnerTerminalPopup/index.tsx`
- **Finding:** The overlay backdrop was implemented as an absolutely-positioned `<button>` spanning the full viewport with no explicit `tabIndex`. Because it precedes the panel content in DOM order, it becomes the first tab stop inside the dialog — an invisible element with no visible focus ring. This violates WCAG 2.1 SC 2.4.7 (Focus Visible) and confuses keyboard-only users.
- **Fix:** Added `tabIndex={-1}` to the backdrop button. Pointer users still dismiss by clicking the backdrop; keyboard users dismiss via the existing Escape capture listener. Added a regression test asserting `tabIndex="-1"`.
- **Commit:** _(see git log for the cycle-2 fix commit on PR #389)_

### 47. Modal dialog with aria-modal lacks Tab focus trap

- **Source:** github-codex-connector | PR #389 round 3 | 2026-06-08
- **Severity:** HIGH
- **File:** `src/features/terminal/components/BurnerTerminalPopup/index.tsx`
- **Finding:** The popup declared `role="dialog"` and `aria-modal={open}`, focused the terminal on open, and handled Escape, but it did not intercept Tab or Shift+Tab. From the align or hide buttons, keyboard focus could move to background workspace controls or terminal elements while the popup remained visually open.
- **Fix:** Extended the existing capture-phase `keydown` listener on `overlayRef` to handle `Tab` and `Shift+Tab`. When focus is inside the terminal body, Tab moves to the first header button and Shift+Tab moves to the last. When focus is on a button, Tab cycles forward and Shift+Tab cycles backward, wrapping from the last button back to the terminal via `bodyRef.current?.focusTerminal()`. The trap respects the optional align button (omitted when `onAlignCwd` is absent) and the disabled state (skipped when `alignBusy` is true). Added regression tests for forward/backward cycling with and without the align button.
- **Commit:** _(see git log for the cycle-3 fix commit on PR #389)_

### 48. Focus trap leaks focus when the focused element becomes disabled mid-focus

- **Source:** github-codex-connector | PR #389 round 5 | 2026-06-08
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/BurnerTerminalPopup/index.tsx`
- **Finding:** The Tab focus-trap handler computed `focusableElements` dynamically from the DOM, excluding the align button when `alignBusy` made it `disabled`. If keyboard focus was on that button at the moment it became disabled, the next `Tab` event computed `currentIndex === -1` and the handler returned early without `preventDefault()`, letting focus escape the `aria-modal` dialog into background workspace controls.
- **Fix:** In the `currentIndex === -1` branch, call `event.preventDefault()` and `event.stopPropagation()`, then move focus to the first focusable element (or the last when `shiftKey` is true). If no focusable elements remain, fall back to `bodyRef.current?.focusTerminal()`. Added regression tests for both `Tab` and `Shift+Tab` from a disabled align button.
- **Commit:** _(see git log for the cycle-5 fix commit on PR #389)_

### 49. Modal popup blur discards return focus — keyboard users lose their workspace focus after every close

- **Source:** github-claude | PR #389 round 7 | 2026-06-08
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/BurnerTerminalPopup/index.tsx`
- **Finding:** The popup's close path unconditionally called `(document.activeElement as HTMLElement | null)?.blur()` when `open` became `false`. In the common keyboard flow (user opens burner from a focused terminal, presses Escape), focus moved to `document.body`, so subsequent keystrokes were swallowed until the user manually refocused a pane. The prior cycle-2 fix (#27) removed focus from the hidden subtree, but a direct blur is the wrong tool for modal dialogs — it discards the return destination.
- **Fix:** Added `priorFocusRef` to capture `document.activeElement` on the `false→true` open transition, then call `.focus()` on that saved element during the `true→false` close transition and clear the ref. This is the standard modal focus-restore pattern already used in `UnsavedChangesDialog` (#11).
- **Commit:** _(see git log for the cycle-7 fix commit on PR #389)_

### 50. Tooltip-wrapped stat cell reverts prior dl/dt/dd fix to bare spans — a11y regression

- **Source:** github-claude | PR #395 round 1 | 2026-06-08
- **Severity:** LOW
- **File:** `src/features/agent-status/components/TokenCache.tsx`
- **Finding:** A PR refactor that introduced `Tooltip` around each `StatCell` replaced the previous `<dl>` / `<dt>` / `<dd>` structure (see §12) with `<div>` / `<span>` nodes. The visual layout remained identical, but assistive technologies lost the explicit name/value relationship for the cached/wrote/fresh metrics. Screen readers announced the three cells as flattened text fragments rather than structured term/value pairs, re-introducing the WCAG 1.3.1 violation that §12 had already fixed.
- **Fix:** Restored the outer metric grid as `<dl>` and changed each `StatCell` inner markup to `<dd>` (value) + `<dt>` (label) while keeping the `Tooltip` wrapper and all Tailwind classes unchanged. The `<div>` wrapper inside `<dl>` around each `<dd>`/`<dt>` pair remains valid HTML5 per the living standard (added in 2015) and preserves the existing grid layout. Zero visual change, full semantic restoration.
- **Commit:** _(PR #395 round 1)_

### 51. RateLimitBar aria-valuenow can exceed aria-valuemax

- **Source:** github-codex-connector | PR #421 round 1 | 2026-06-11
- **Severity:** MEDIUM
- **File:** `src/features/agent-status/components/RateLimitBar.tsx`
- **Finding:** RateLimitBar clamps the visual width to 100% but exposes `Math.round(percentage)` as `aria-valuenow` with `aria-valuemax` fixed at 100. If usage exceeds 100%, assistive technology receives an invalid progressbar range.
- **Fix:** Clamped `aria-valuenow` to the same 0-100 range as the visual fill using `Math.min(Math.max(Math.round(percentage), 0), 100)`, while leaving the visible text free to show the raw rounded percentage. Added co-located regression tests for overflow and negative values.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 52. aria-haspopup="menu" without role="menu" on popup — ARIA contract broken

- **Source:** github-claude | PR #421 round 2 | 2026-06-11
- **Severity:** MEDIUM
- **File:** `src/features/sessions/components/Card.tsx`
- **Finding:** The kebab trigger button declares `aria-haspopup="menu"`, which commits to an ARIA menu popup contract requiring the popup element to carry `role="menu"` and each item to carry `role="menuitem"`. The popup `<div>` and `MenuRow` buttons had neither role, breaking the screen-reader menu-navigation contract.
- **Fix:** Added `role="menu"` to the popup `<div>` and `role="menuitem"` to the `<button>` inside `MenuRow`.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 53. Menu roles without keyboard contract mislead assistive technology

- **Source:** github-claude | PR #421 round 3 | 2026-06-11
- **Severity:** MEDIUM
- **File:** `src/features/sessions/components/Card.tsx`
- **Finding:** A prior cycle added `role="menu"` and `role="menuitem"` to the kebab popup and its items, but the component did not implement the full APG menu keyboard contract (arrow-key navigation, initial focus into the menu, Home/End). Screen readers announced a menu widget that keyboard users could not operate with expected menu navigation, producing a broken ARIA contract.
- **Fix:** Downgraded to generic popup semantics by removing `role="menu"` and `role="menuitem"`, changing `aria-haspopup="menu"` to `aria-haspopup="true"`, and keeping `aria-expanded` for open/closed state disclosure. The popup remains a simple two-item button group.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 54. Popup menu stays open on pointer clicks outside the container

- **Source:** github-claude | PR #421 round 3 | 2026-06-11
- **Severity:** MEDIUM
- **File:** `src/features/sessions/components/Card.tsx`
- **Finding:** The actions popup closed on `onBlur` (when focus left the wrapper) and on Escape, but clicking a non-focusable area of the sidebar did not move focus and therefore did not trigger blur, leaving the popup visibly stuck open during normal pointer use.
- **Fix:** Added a document-level `mousedown` listener active while `menuOpen === true` that calls `setMenuOpen(false)` when the event target is outside the kebab/menu container. The listener is registered in a `useEffect` with cleanup on unmount or menu close.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 55. Inert layout config button remains focusable and hover-styled

- **Source:** github-claude | PR #433 round 1 | 2026-06-12
- **Severity:** MEDIUM
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** The layout-display config button in `LayoutSwitcher`'s trailing slot was fully styled as an interactive control (hover fill, focus styling, aria-label, title) but had no `onClick` handler, leaving keyboard and screen-reader users with a silent no-op activation path.
- **Fix:** Added `disabled`, `aria-disabled="true"`, and `tabIndex={-1}` and muted opacity so the element is clearly non-interactive until the feature lands.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 56. Root-anchored sidebar toggle rendered last in DOM — focus order regression

- **Source:** github-claude | PR #433 round 2 | 2026-06-12
- **Severity:** MEDIUM
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** The persistent `SidebarToggle` was absolutely positioned at the workspace root so it stayed visually fixed during sidebar collapse/expand animations, but it was rendered as the last child of the workspace root. Keyboard users therefore reached it only after tabbing through the main workspace, activity panel, overlays, and command palette — a WCAG focus-order regression relative to its visual position at the top-left boundary.
- **Fix:** Moved the same root-anchored, absolutely positioned toggle wrapper earlier in the DOM (right after the compact scrim and before the sidebar shell) so sequential focus order matches the visual layout. Preserved `z-40` and the existing left/top absolute coordinates. Updated co-located tests that asserted on `workspace.children[1]` to query `screen.getByTestId('workspace-main')` directly, since the DOM reordering changed sibling indices.
- **Commit:** _(see git blame / git log on this line)_

### 57. FileExplorer rename/delete uses native blocking dialogs

- **Source:** github-claude | PR #444 round 1 | 2026-06-13
- **Severity:** MEDIUM
- **File:** `src/features/workspace/components/panels/FileExplorer.tsx`
- **Finding:** `window.prompt` and `window.confirm` blocked the renderer thread, used unstyled OS chrome, and could not display formatted validation hints or be cancelled via Escape reliably.
- **Fix:** Replaced native dialogs with an inline rename input and a delete-confirmation strip styled with design tokens; kept actions non-blocking.
- **Commit:** see `git blame` / `git log` on this line

### 58. Pointer-leave handler schedules drift under reduced-motion and when already at rest

- **Source:** github-claude + github-codex-connector | PR #457 round 1 | 2026-06-15
- **Severity:** P2 / MEDIUM
- **File:** `src/features/agent-status/hooks/useReservoirFlow.ts`
- **Finding:** `onLeave` called `ensureLoop()` unconditionally, so it scheduled a rAF frame even when `prefers-reduced-motion: reduce` was active, the water refs were null, or the loop was already at rest. Under reduced motion this could re-apply a cached `translate(...)` transform after `onMqlChange` had explicitly cleared it.
- **Fix:** Mirrored the `onEnter` guard (`mql.matches || refsRef.current === null`) and added an at-rest guard (`rafId === null && intensity < REST_EPSILON`) before calling `ensureLoop()`.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 59. Meter reports unknown context usage as 0%

- **Source:** github-codex-connector | PR #462 round 1 | 2026-06-15
- **Severity:** P2 / MEDIUM
- **File:** `src/features/agent-status/components/ContextReservoirCard.tsx`
- **Finding:** When `usedPercentage` was `null` (context window not yet known), the card still derived `aria-valuenow` from `effectivePct` (`pct ?? 0`), exposing a 0% meter value while the visible UI and `aria-valuetext` announced the usage as unknown. Screen-reader users could confuse an initial/unknown state with a genuinely empty context window.
- **Fix:** Set `aria-valuenow` to `undefined` when `pct === null` so the attribute is omitted, while known percentages still report `Math.round(pct)`. Added a co-located regression test asserting the meter has no `aria-valuenow` in the unknown state.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 60. Disclosure button receives both `aria-pressed` and `aria-expanded`

- **Source:** github-claude | PR #454 round 2 | 2026-06-15
- **Severity:** HIGH
- **File:** `src/features/diff/components/toolbar/PriorityPlus.tsx`
- **Finding:** The overflow menu trigger passed `pressed={open}` to `IconButton` while also forwarding `aria-expanded={open}`. `BaseButton` emits `aria-pressed` from the `pressed` prop, so the button carried both ARIA states when open — screen readers announce a disclosure widget as a toggle button that is both pressed and expanded.
- **Fix:** Removed `pressed={open}`. The ghost variant's `aria-expanded:bg-primary/10` CSS already provides the same active tint from `aria-expanded` alone.
- **Commit:** same commit as this entry

### 61. SegmentedControl unmatched value is visually coerced to the first option

- **Source:** github-codex-connector | PR #461 round 2 | 2026-06-15
- **Severity:** LOW
- **File:** `src/components/SegmentedControl.tsx`
- **Finding:** `activeIndex` was computed with `Math.max(0, options.findIndex(...))` and used for both the sidebar active-thumb transform and roving `tabIndex`. When a controlled `value` did not match any option, the control showed the thumb under option 0 and made option 0 tabbable while all buttons exposed `aria-pressed=false`, producing a visual/assistive-state mismatch.
- **Fix:** Preserved the raw `findIndex` result as `activeIndex`, added a separate `focusIndex = Math.max(0, activeIndex)` used only for keyboard entry (`tabIndex`), and guarded thumb rendering with `activeIndex >= 0` so no thumb appears when no option is semantically selected. Added a regression test verifying the thumb is absent, the first option remains tabbable, and both options report `aria-pressed="false"` for an unmatched value.
- **Commit:** same commit as this entry

### 62. Reduced-motion media query leaves animated element visible at rest

- **Source:** github-claude | PR #464 round 1 | 2026-06-15
- **Severity:** MEDIUM
- **File:** `src/index.css`
- **Finding:** The `prefers-reduced-motion: reduce` block set `animation: none` on `.vf-activity-refresh-comet` but left the 45%-wide gradient `div` mounted at `translateX(0)`. Because keyframe positions are not applied when animation is disabled, users who opted out of motion saw a static semi-transparent bar in the header divider.
- **Fix:** Added `transform: translateX(-100%)` as a base style on `.vf-activity-refresh-comet` so the rest position is off-screen regardless of animation state.
- **Commit:** see `git blame` / `git log` on this line

### 63. `aria-live` region announces completion on every refresh cycle

- **Source:** github-claude | PR #464 round 1 | 2026-06-15
- **Severity:** LOW
- **File:** `src/features/agent-status/components/AgentStatusPanel/index.tsx`
- **Finding:** The live region alternated between `Fetching latest agent status` and `Agent status updated`. Screen readers queued both strings on every hot-load cycle, producing background chatter during rapid pane switches.
- **Fix:** Changed the idle branch to an empty string so only the refresh-start state is announced; the visual header affordance communicates completion.
- **Commit:** see `git blame` / `git log` on this line

### 64. Segmented ProgressBar exposes `role="progressbar"` without a value

- **Source:** github-codex-connector | PR #509 round 1 | 2026-06-17
- **Severity:** MEDIUM
- **File:** `src/components/ProgressBar.tsx`
- **Finding:** When `segments` was supplied and `decorative` was omitted, the component rendered proportional distribution segments but exposed `role="progressbar"` without `aria-valuenow`, which assistive technology treats as an indeterminate loading indicator. The co-located test also asserted the unsafe role, encoding the mismatch as the component's contract.
- **Fix:** Derived an effective decorative state whenever `segments` is present (`const isDecorative = decorative || segments !== undefined`) so segmented bars are always `aria-hidden` and never emit progressbar semantics. Added a `trackTestId` prop to let tests query the track directly, and rewrote the segmented-bar test to assert `aria-hidden="true"` and the absence of a `progressbar` role.
- **Commit:** same commit as this entry

### 65. Gruvbox Dark elevated surfaces fall below contrast threshold against text-on-surface

- **Source:** github-codex-connector | PR #532 round 2 | 2026-06-18
- **Severity:** P2 / MEDIUM
- **File:** `src/theme/themes/gruvbox/gruvbox-dark.ts`
- **Finding:** `surface-container-highest` mapped to `dark.bg4` (#7c6f64) and `surface-bright` mapped to `dark.fg4` (#a89984). Combined with `on-surface` (#ebdbb2) these produced ~3.4:1 and ~1.8:1 contrast ratios, below WCAG AA. Existing components (chips, command badges, file-tree hover rows) use those exact surface/text pairs, making labels hard to read.
- **Fix:** Moved both tokens down the darker `bg` ramp while preserving elevation order: `surface-container-highest` → `dark.bg2` (#504945, ~6.4:1) and `surface-bright` → `dark.bg3` (#665c54, ~4.75:1).
- **Commit:** same commit as this entry

### 66. Gruvbox Dark `surface-container-highest` inverted elevation hierarchy

- **Source:** github-claude | PR #532 round 3 | 2026-06-18
- **Severity:** MEDIUM
- **File:** `src/theme/themes/gruvbox/gruvbox-dark.ts`
- **Finding:** The round-2 contrast fix mapped `surface-container-highest` to `dark.bg2`, making it identical to `surface-container` and darker than `surface-container-high` (`dark.bg3`). In a dark theme, "highest" elevation must be the lightest step, so the elevation ramp was inverted for that tier and components relying on layered depth cues rendered with the wrong visual hierarchy.
- **Fix:** Restored monotonic elevation order by mapping `surface-container-highest` → `dark.bg4` (#7c6f64). The `surface-bright` token already moved to `dark.bg3` in round 2, so the bg0 < bg1 < bg2 < bg3 < bg4 ramp is preserved across all surface tiers.
- **Commit:** same commit as this entry

### 67. Layout display trigger is missing the required shared Tooltip hover label

- **Source:** github-codex-connector | PR #535 round 1 | 2026-06-18
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/LayoutSwitcher/LayoutDisplayMenu.tsx`
- **Finding:** The new `LayoutDisplayMenu` trigger was an icon-only button with an `aria-label` but no visible hover label. The prior stub in `WorkspaceView` had a `Tooltip` wrapper and the design system requires unified `Tooltip` usage for icon-only controls, so the new functional control was harder for sighted users to discover.
- **Fix:** Added `tooltip` and `tooltipPlacement` props to the `Menu` primitive so it can wrap its cloned trigger with the shared `Tooltip`. `LayoutDisplayMenu` now passes `tooltip="Configure displayed layouts"` to `Menu`; `Tooltip` composes its hover/focus handlers with `Menu`'s trigger reference props so keyboard and click behavior are preserved.
- **Commit:** same commit as this entry

### 68. Layout creator modal lacks focus trap and focus restoration

- **Source:** github-codex-connector (P2 / MEDIUM) | PR #569 round 1 | 2026-06-20
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/components/LayoutCreator/LayoutCreatorModal.tsx` L833-833
- **Finding:** The layout creator dialog declared `aria-modal="true"` but only handled Escape and ⌘Enter. It did not trap Tab focus or restore the previously focused element, so keyboard users could tab into the workspace behind the overlay and trigger unrelated controls while the modal was active.
- **Fix:** Added a `panelRef` and `previousFocusRef`, captured focus before open to focus the name input, restored focus on close, and added a document keydown handler that cycles Tab/Shift+Tab among the modal panel's focusable elements.
- **Commit:** same commit as this entry

### 69. Programmatic menu close unmounts the focused row

- **Source:** github-codex-connector | PR #569 round 4 | 2026-06-20
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/LayoutSwitcher/LayoutDisplayMenu.tsx` L79-294
- **Finding:** `LayoutDisplayMenu` closed custom-layout actions by changing the `Menu` key. The remount destroyed the focused row and trigger, so delete left focus on `document.body`, while create/edit opened the modal after the wrong focus restoration target had been captured.
- **Fix:** Added a `closeSignal` prop to the shared `Menu` primitive so callers can request an internal close without remounting the trigger. `LayoutDisplayMenu` focuses its trigger before sending the close signal, and custom pick/edit/delete/create actions all route through that path.
- **Commit:** same commit as this entry

### 70. Custom multi-action menu rows bypass roving keyboard navigation

- **Source:** github-claude | PR #569 round 5 | 2026-06-20
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/LayoutSwitcher/LayoutDisplayMenu.tsx` L196-280
- **Finding:** Custom layout rows were rendered as raw `<div>` and `<button>` elements inside `Menu`, so they never registered with the floating-ui list navigation model. Arrow-key navigation reached only the built-in layout checkboxes and skipped the custom section.
- **Fix:** Added a `Menu.Row` primitive that registers arbitrary row content with the shared menu roving-focus model. Custom layout rows now use `Menu.Row`, expose an explicit row label, and have regression coverage proving arrow keys can reach the custom section.
- **Commit:** same commit as this entry

### 71. Layout creator empty grid cells ignored keyboard activation

- **Source:** github-codex-connector | PR #569 round 6 | 2026-06-20
- **Severity:** HIGH
- **File:** `src/features/terminal/components/LayoutCreator/LayoutCreatorModal.tsx` L466-479
- **Finding:** Empty layout grid cells rendered as enabled buttons with aria labels and tab stops, but only handled pointerdown. Native keyboard activation dispatches click, so Enter/Space on the focused cell announced an actionable control that did nothing.
- **Fix:** Added a keyboard/synthetic click path for paintable cells that commits the same 1x1 slot as pointer single-cell painting, while ignoring pointer-generated clicks to avoid double-adds after pointerup. Added regression coverage for Enter on an empty grid cell.
- **Commit:** same commit as this entry

### 72. Nested action button arrow keys leaked into Menu.Row navigation

- **Source:** github-codex-connector | PR #569 round 6 | 2026-06-20
- **Severity:** MEDIUM
- **File:** `src/components/Menu.tsx` L499-522
- **Finding:** `Menu.Row` allowed ArrowUp/ArrowDown keydown events from focused descendant buttons to bubble into the menu's roving-focus handler, moving focus away from the nested action before the user completed that interaction.
- **Fix:** Stopped ArrowUp/ArrowDown propagation when the key event originates from a descendant rather than the row itself. Added regression coverage that a nested row button keeps focus on ArrowDown.
- **Commit:** same commit as this entry

### 73. Menu.Row intercepted nested button activation keys

- **Source:** github-claude | PR #569 round 7 | 2026-06-20
- **Severity:** HIGH
- **File:** `src/components/Menu.tsx` L502-518
- **Finding:** `Menu.Row` handled Enter/Space on bubbled keydown events from descendant buttons, preventing native button activation and firing the row's layout-pick action instead. Keyboard users could not activate nested edit/delete/toggle controls without triggering the wrong menu action.
- **Fix:** Returned early for descendant keydown events so only the focused row handles Enter/Space, stopped descendant ArrowUp/ArrowDown during capture before roving focus sees them, and ignored clicks that bubble from nested interactive controls. Added regression coverage for descendant Enter activation.
- **Commit:** same commit as this entry

### 74. Tokyo Night muted text falls below contrast threshold

- **Source:** github-codex-connector | PR #557 round 1 | 2026-06-19
- **Severity:** P2 / MEDIUM
- **File:** `src/theme/themes/tokyo-night.ts` L62
- **Finding:** `on-surface-muted` was mapped to the raw comment color `#565f89`, yielding only ~2.76:1 contrast against the theme surface `#1a1b26` and even less on `surface-container` backgrounds. Status-bar and agent-panel labels using this token became hard to read.
- **Fix:** Changed `on-surface-muted` to `#7f88b3`, raising contrast to ~4.94:1 on the theme surface while preserving the muted hierarchy below `on-surface-variant`.
- **Commit:** same commit as this entry

### 75. Dialog focus trap misses contenteditable elements

- **Source:** github-claude | PR #548 round 1 | 2026-06-19
- **Severity:** MEDIUM
- **File:** `src/components/Dialog.tsx` L59-66
- **Finding:** `FOCUSABLE_SELECTOR` omitted `[contenteditable]:not([contenteditable="false"])`, so CodeMirror or rich-text surfaces inside a Dialog were skipped by the manual Tab trap and focus could escape the modal.
- **Fix:** Added the contenteditable selector to `FOCUSABLE_SELECTOR` and updated `getFocusableElements` filter to treat contenteditable surfaces as focusable even when `tabIndex` is implicitly `-1`. Added a co-located test that tabs through a contenteditable element inside a Dialog and asserts focus stays trapped.
- **Commit:** same commit as this entry

### 76. Dialog focus collection includes CSS-hidden elements

- **Source:** github-codex-connector | PR #548 round 3 | 2026-06-19
- **Severity:** MEDIUM
- **File:** `src/components/Dialog.tsx` L69-79
- **Finding:** `getFocusableElements` filtered disabled, `aria-hidden`, and explicit `tabindex` state, but not `display: none`, `visibility: hidden`, or hidden ancestors. `focusInitialElement` also focused `initialFocusRef.current` without checking visibility. Conditionally hidden controls inside dialogs could receive invisible/no-op initial focus or be included in the Tab cycle, leaving keyboard users with no visible focus target or an apparent skipped focus step.
- **Fix:** Added `isVisibleFocusableElement`, which walks from the element up through its ancestors and checks `window.getComputedStyle` for `display: none` and `visibility: hidden`. Applied the guard to both `getFocusableElements` and the `initialFocusRef` branch in `focusInitialElement`. Added co-located tests asserting that `display:none`, `visibility:hidden`, and hidden-ancestor elements are skipped when choosing initial focus.
- **Commit:** same commit as this entry

### 77. Dialog visibility check excludes visible descendants of visibility:hidden ancestors

- **Source:** github-codex-connector | PR #548 round 4 | 2026-06-19
- **Severity:** MEDIUM
- **File:** `src/components/Dialog.tsx` L69-91
- **Finding:** `isVisibleFocusableElement` walked ancestors and rejected any ancestor with `visibility: hidden`. CSS `visibility` is inherited but can be overridden by a descendant with `visibility: visible`, so an element's own computed visibility is the authoritative check for that property. In that valid CSS layout, a visibly focusable control would be skipped by initial focus and the Tab trap.
- **Fix:** Checked `visibility` only on the focusable element itself and limited the ancestor walk to `display: none`. Added a co-located regression test asserting that a visible button inside a `visibility:hidden` ancestor receives initial focus.
- **Commit:** same commit as this entry

### 78. Interactive tooltip trigger rendered as a non-focusable chip

- **Source:** github-codex-connector | PR #575 round 1 | 2026-06-20
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/GitRefChip.tsx`
- **Finding:** The git-ref copy popover used an interactive Tooltip around a
  `Chip`, but the shared `Chip` primitive renders a non-focusable span. Hover
  users could open the copy controls, while keyboard users could not focus the
  trigger and therefore could not reach the popover buttons.
- **Fix:** Added a stable accessible label and `tabIndex={0}` to the chip
  trigger so the existing Tooltip focus interaction opens the dialog for
  keyboard navigation. Added a regression test that tabs to the chip and
  observes the copy buttons in the mounted dialog.
- **Commit:** same commit as this entry

### 79. Visual token count diverged from meter aria-valuetext

- **Source:** github-claude | PR #603 round 3 | 2026-06-22
- **Severity:** MEDIUM
- **File:** `src/features/agent-status/components/ContextReservoirCard.tsx`
- **Finding:** The unknown-window OpenCode context card used `formatTokenCount` in `aria-valuetext` but rendered the visible token count with `formatTokens`. Screen readers could announce a different token count than the value sighted users saw.
- **Fix:** Removed the second formatter path and rendered the visible unknown-window token count with `formatTokenCount`, matching the meter's accessible value. Updated the existing unknown-window regression test to assert the shared formatting.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 80. Draggable handle carried a label without an interactive role

- **Source:** github-claude | PR #610 round 3 | 2026-06-22
- **Severity:** LOW
- **File:** `src/features/terminal/components/SplitView/SplitView.tsx`
- **Finding:** The browser-pane drag handle rendered as a plain draggable `<div>` with an `aria-label`, but without an interactive role or focus entry point. Assistive technologies could ignore the label, leaving the pane-move affordance undiscoverable.
- **Fix:** Added `role="button"` and `tabIndex={0}` to make the labelled drag handle discoverable while keyboard-driven pane reorder remains a deferred follow-up.
- **Commit:** same commit as this entry

### 81. Draggable handle claimed button semantics without activation

- **Source:** github-codex-connector | PR #610 round 4 | 2026-06-22
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/components/SplitView/SplitView.tsx`
- **Finding:** The browser-pane drag handle was promoted to `role="button"` and `tabIndex={0}`, but still only implemented pointer drag handlers. Keyboard and screen-reader users could focus a control announced as a button, then press Enter or Space with no activation path.
- **Fix:** Removed the button role and tab stop from the browser-pane drag handle until keyboard-driven pane reorder exists. Added regression coverage that the handle remains draggable but is not exposed as a keyboard-focusable button.
- **Commit:** same commit as this entry

### 82. Native overlay menu opened without keyboard focus

- **Source:** github-codex-connector | PR #635 round 1 | 2026-06-30
- **Severity:** P2 / MEDIUM
- **File:** `electron/native-overlay.ts`
- **Finding:** The native overlay window was shown with `showInactive()` but neither the window nor its `webContents` received focus. Keyboard-opened menus rendered above the owner window while Escape, Arrow, and Enter stayed routed to the owner or terminal.
- **Fix:** Focused the overlay `webContents` immediately after showing the overlay window, preserving the existing owner-focus restoration in `closeSurface`. Electron controller tests now assert the overlay receives focus on open.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 83. Native overlay menu window was non-focusable

- **Source:** github-codex-connector | PR #638 round 1 | 2026-06-30
- **Severity:** P2 / MEDIUM
- **File:** `electron/native-overlay.ts`
- **Finding:** The native overlay `BrowserWindow` was created with `focusable: false`, so keyboard-opened menus could render above the owner window but could not receive Arrow or Enter events for row navigation and activation.
- **Fix:** Removed the non-focusable window option and focused the overlay `webContents` immediately after `showInactive()`, preserving owner-focus restoration on close. Electron controller tests now assert the overlay is not created with `focusable: false` and receives focus after being shown.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 84. Focus auto-open was disabled in local native-overlay fallback mode

- **Source:** github-claude | PR #638 round 2 | 2026-06-30
- **Severity:** HIGH
- **File:** `src/features/terminal/components/TerminalPane/GitRefChip.tsx` L313-316
- **Finding:** `GitRefChip` suppressed focus-triggered menu opening whenever the `nativeOverlay` prop was true, but the caller now passes that prop unconditionally while the actual native overlay transport remains feature-flagged and macOS-gated. Default local fallback builds therefore lost the prior Tab-to-chip keyboard auto-open behavior.
- **Fix:** Reused the floating transport selector for the focus guard so focus auto-open is suppressed only when the native overlay transport is actually active. Added a regression test covering `nativeOverlay={true}` with the default local fallback.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 85. Browser panes lost pane-focus shortcut discoverability

- **Source:** github-codex-connector | PR #646 round 1 | 2026-07-02
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/SplitView/SplitView.tsx`
- **Finding:** Removing the shared inactive-pane focus tooltip also removed the only visible `Mod+N` focus shortcut hint from browser panes, while the replacement compact badge was wired only through terminal-pane chrome.
- **Fix:** Threaded the same slot-ordered shortcut hint into `BrowserPane`, rendered the compact badge in browser tab chrome, and added regression coverage for both direct browser-pane rendering and `SplitView` browser-pane prop forwarding.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 86. Rename validation error was hidden from sighted users

- **Source:** github-claude | PR #646 round 2 | 2026-07-02
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/PaneRenameInput.tsx`
- **Finding:** Rename validation and backend error text rendered only inside `sr-only`, so sighted users received only color and border feedback when a pane rename failed.
- **Fix:** Rendered a compact visible `role="alert"` message in `text-error` while preserving `aria-describedby`; updated regression coverage to assert the alert is not `sr-only`.

### 87. Generic layout picker announced workspace-only focus action

- **Source:** github-codex-connector | PR #631 round 1 | 2026-06-28
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/components/LayoutSwitcher/LayoutSwitcher.tsx`
- **Finding:** `LayoutSwitcher` reused the “Focus active pane” accessible name and tooltip for every `single` layout option, including the New Session dialog where the control selects a “Single” template rather than focusing an active pane.
- **Fix:** Made the focus-action label and shortcut chip opt-in via `labelSingleAsFocusAction`, enabled it only in workspace chrome, and kept generic pickers on the plain “Single” label.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 88. Popover action buttons suppressed keyboard focus indication

- **Source:** github-codex-connector | PR #633 round 1 | 2026-06-29
- **Severity:** P2 / MEDIUM
- **File:** `src/features/diff/components/FinishFeedbackPopover.tsx`
- **Finding:** Finish-feedback Cancel and Confirm buttons removed the browser focus ring with `focus:outline-none focus-visible:outline-none` without replacing it, so keyboard users could not tell which action was focused before activating it.
- **Fix:** Added the shared button focus-ring treatment (`focus-visible:ring-1 focus-visible:ring-primary`) to the popover action class and updated co-located tests to assert the visible focus styles.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 89. Multi-agent send choices had no visible Tab focus

- **Source:** github-claude | PR #633 round 1 | 2026-06-29
- **Severity:** MEDIUM
- **File:** `src/features/diff/components/FinishFeedbackPopover.tsx`
- **Finding:** The multi-agent finish-feedback branch suppressed `focus-visible` outlines on each Send button even though those choices have no shortcut fallback, making Tab navigation through the agent list ambiguous.
- **Fix:** Routed the Send buttons through the same explicit popover action focus class and added a regression assertion that multi-agent Send buttons include the visible focus ring.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 90. Confirm popover buttons suppressed the shared focus ring

- **Source:** github-codex-connector + github-claude | PR #633 round 2 | 2026-06-29
- **Severity:** P2 / MEDIUM
- **File:** `src/features/diff/components/DiffPanelContent.tsx`
- **Finding:** The hunk/file keyboard-confirm popover passed `className="focus-visible:ring-0"` to both `Button` actions, overriding the shared primitive's only visible keyboard focus indicator.
- **Fix:** Removed the local ring suppression so the shared `Button` focus styles apply, and added co-located regression assertions for the `No (n)` and `Yes (y)` actions.
- **Commit:** same commit as this entry

### 91. Primary finish-feedback actions relied on brightness-only focus

- **Source:** github-claude | PR #633 round 3 | 2026-06-29
- **Severity:** MEDIUM
- **File:** `src/features/diff/components/FinishFeedbackPopover.tsx`
- **Finding:** Finish-feedback Confirm and multi-agent Send buttons suppressed
  outlines and rings while using only `focus-visible:brightness-110` as the
  keyboard focus cue. The saturated primary fill made that cue too weak for
  keyboard-only and low-vision users, especially in the multi-agent list where
  Tab is the selection path.
- **Fix:** Replaced the brightness-only primary focus class with a visible
  token-backed focus ring and updated co-located tests to reject the old
  brightness/ring-0 treatment.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 92. Focus-opened floating panel lacked focus-out dismissal

- **Source:** github-claude | PR #645 round 1 | 2026-07-02
- **Severity:** MEDIUM
- **File:** `src/features/diff/components/ChangedFilesList.tsx`
- **Finding:** The unpinned changed-files edge hint opened the floating panel on keyboard focus, but only mouse leave scheduled dismissal. Tabbing to the hint could leave the absolute panel mounted over the diff until the user manually toggled it or happened to hover and leave.
- **Fix:** Wrapped the unpinned hint and panel in a focus boundary that schedules hide when focus leaves the surface while preserving tab movement into the panel controls. Added regression coverage for tabbing through the hint, pin button, file row, file-comment button, and then out of the surface.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 93. Dracula highest surface fell below small-label contrast

- **Source:** github-codex-connector | PR #647 round 1 | 2026-07-03
- **Severity:** P2 / MEDIUM
- **File:** `src/theme/themes/dracula.ts`
- **Finding:** `surface-container-highest` and `surface-bright` were moved to Dracula's muted comment color, which paired with `on-surface-variant` at about 2.4:1 contrast. Existing compact labels and keycaps using `bg-surface-container-highest text-on-surface-variant` became hard to read.
- **Fix:** Mapped both elevated Dracula surface tokens to `#5f6588`, a darker surface step that preserves the highest/bright pairing while restoring small-label contrast, and added theme assertions for the reviewed tokens.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 94. Theme top-rung surfaces regressed compact-label contrast

- **Source:** github-claude | PR #647 round 2 | 2026-07-03
- **Severity:** HIGH
- **File:** `src/theme/themes/tokyo-night.ts`, `src/theme/themes/gruvbox/gruvbox-light.ts`, `src/theme/themes/gruvbox/gruvbox-dark.ts`
- **Finding:** The shifted `surface-container-highest` and `surface-bright` values in Tokyo Night and Gruvbox paired with `on-surface-variant` below the 4.5:1 AA threshold used by compact keycaps, badges, and neutral chips.
- **Fix:** Chose accessible top-rung surface values for the three affected themes and added a shared contrast regression test for `surface-container-highest`/`surface-bright` against `on-surface-variant`.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 95. Theme mid-tier surfaces regressed compact-label contrast

- **Source:** github-claude | PR #647 round 3 | 2026-07-03
- **Severity:** HIGH
- **File:** `src/theme/themes/gruvbox/gruvbox-dark.ts`, `src/theme/themes/tokyo-night.ts`
- **Finding:** The surface ladder shift also moved `surface-container` and `surface-container-high` to values that paired with `on-surface-variant` below the 4.5:1 AA threshold in Gruvbox Dark and Tokyo Night, affecting common panel, notification, changed-file, review, and test-result rows.
- **Fix:** Chose darker accessible mid-tier surface values for Gruvbox Dark and Tokyo Night, corrected the same compact-surface contrast gap exposed by the widened test in Gruvbox Light, and expanded the shared contrast regression test to cover `surface-container` and `surface-container-high` alongside the top rungs.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 96. Gruvbox surface ladders inverted elevation ordering

- **Source:** github-claude | PR #647 round 6 | 2026-07-03
- **Severity:** MEDIUM
- **File:** `src/theme/themes/gruvbox/gruvbox-dark.ts`, `src/theme/themes/gruvbox/gruvbox-light.ts`
- **Finding:** The final Gruvbox token choices preserved compact-label contrast but left the dark theme with `surface-container` and `surface-bright` duplicated, and both Gruvbox themes with elevated rungs that moved opposite the theme-kind elevation direction. Nested panels and hover states could therefore render flat or visually inverted.
- **Fix:** Re-picked nearby Gruvbox surface values so the dark ladder increases in luminance, the light ladder decreases in luminance, and all compact surface rungs still meet the existing AA contrast guard. Added a Gruvbox-specific regression test that checks the full surface ladder ordering by theme kind.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 97. Diff remount focus restore stole focus from editable descendants

- **Source:** github-codex-connector | PR #652 round 1 | 2026-07-04
- **Severity:** P2 / MEDIUM
- **File:** `src/features/diff/Panel.tsx`
- **Finding:** The render-key focus restoration for theme and line-style remounts treated any active element inside the diff root as safe to replace with root focus. Diff-owned text inputs such as search and review-comment editors could regain focus after a workspace theme command, then immediately lose it to the bare diff root.
- **Fix:** Added a shared diff native-focus predicate and skipped the render-key root restore when `document.activeElement` is an input, textarea, contenteditable element, or `role="textbox"`. Added a regression test that keeps the diff search textbox focused across a workspace theme change.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 98. Palette-close surface focus restore ignored follow-up dialogs

- **Source:** github-claude + github-codex-connector | PR #652 round 1 | 2026-07-04
- **Severity:** HIGH
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** The command-palette close effect always restored focus to the active terminal or dock surface, even when the command itself opened a follow-up modal such as `UnsavedChangesDialog`. That could move keyboard focus behind an active `aria-modal` dialog.
- **Fix:** Guarded the palette-close focus restore while `showUnsavedDialog` or `newSessionDialog.open` is true, preserving the follow-up dialog's focus ownership.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
