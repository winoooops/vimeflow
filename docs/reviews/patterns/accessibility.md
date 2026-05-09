---
id: accessibility
category: a11y
created: 2026-04-09
last_updated: 2026-05-08
ref_count: 6
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
