---
id: keyboard-shortcut-guards
category: keyboard-shortcuts
created: 2026-05-18
last_updated: 2026-06-15
ref_count: 4
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
4. **Main-process / renderer guard parity** — when a shortcut is handled in BOTH
   the Electron main process (`before-input-event`) and the renderer (`keydown`),
   a guard added to only one path is silently bypassed in the packaged app:
   `event.preventDefault()` in the main process suppresses the renderer `keydown`,
   so a renderer-only guard (e.g. `event.repeat`) never runs. The main-process
   matcher must replicate the guard itself (filter `input.isAutoRepeat`).
5. **Optional guard defaults must be safe** — when a caller can omit a guard
   prop, the hook should default to _not_ claiming the keystroke. Treating
   `undefined` as "active" lets capture-phase shortcuts steal input from
   unfocused surfaces.
6. **Platform-specific display** — keymap hints, tooltips, and settings labels
   that show shortcuts must render the modifier that matches the runtime
   platform (`⌘` on macOS, `Ctrl` on Linux/Windows). Hardcoding `⌘` in the UI
   misleads non-Mac users and drifts from the behavior-side modifier choice.

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

### 12. onTerminalZoneFocus duplicated claimTerminal — divergence risk

- **Source:** github-claude | PR #218 | 2026-05-18
- **Severity:** MEDIUM
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** `onTerminalZoneFocus` was byte-for-byte identical to `claimTerminal`. If
  `claimTerminal` later gains extra logic (telemetry, dock-state persistence), the
  keyboard-reclaim path would silently diverge with no type error or failing test.
- **Fix:** Removed the redundant `onTerminalZoneFocus` callback and passed `claimTerminal`
  directly: `onTerminalZoneFocus: claimTerminal`.
- **Commit:** `fix(workspace): address round-7 Claude review findings on focus highlight PR`

### 13. Dialog guard in usePaneShortcuts only covered reclaim path, not pane-switch fallthrough

- **Source:** github-claude | PR #218 | 2026-05-18
- **Severity:** LOW
- **File:** `src/features/terminal/hooks/usePaneShortcuts.ts`
- **Finding:** `document.querySelector(DIALOG_SELECTOR)` was only checked inside the reclaim
  `if` block. Ctrl+2 with a dialog open and terminal active (pane 2 not active) would still
  call `setSessionActivePane` via the pre-existing pane-switch path.
- **Fix:** Hoisted the dialog guard to the top of the `digitMatch` block so it covers both
  reclaim and pane-switch paths symmetrically.
- **Commit:** `fix(workspace): address round-7 Claude review findings on focus highlight PR`

### 14. useCodeMirror RAF focus fires after useLayoutEffect with no hasFocus guard

- **Source:** github-claude | PR #218 | 2026-05-18
- **Severity:** MEDIUM
- **File:** `src/features/editor/hooks/useCodeMirror.ts`
- **Finding:** When `shouldAutoFocus` is true and both the RAF path (on mount) and the
  synchronous `useLayoutEffect` path (via `focusRequestSeq`) target the same editor,
  the RAF fires ~16ms later and can steal focus back from any panel that gained focus
  between React's commit phase and the animation frame.
- **Fix:** Added `!view.hasFocus` guard: `if (shouldAutoFocusRef.current && !view.hasFocus) { view.focus() }`.
  The RAF becomes a fallback rather than an unconditional override.
- **Commit:** `fix(workspace): address round-8 Claude review findings on focus highlight PR`

### 15. useCodeMirror defaults shouldAutoFocus ?? true, opposite of CodeEditor false default

- **Source:** github-claude | PR #218 | 2026-05-18
- **Severity:** LOW
- **File:** `src/features/editor/hooks/useCodeMirror.ts`
- **Finding:** `shouldAutoFocus ?? true` defaults to opt-in auto-focus when the prop is
  absent, but `CodeEditor` defaults `shouldAutoFocus = false`. Any future caller omitting
  the prop would silently steal keyboard focus.
- **Fix:** Changed both `?? true` to `?? false` so the hook's standalone behavior matches
  typical embedded usage.
- **Commit:** `fix(workspace): address round-8 Claude review findings on focus highlight PR`

### 16. WorkspaceView focus orchestration lacked integration test coverage

- **Source:** github-claude | PR #218 | 2026-05-18
- **Severity:** MEDIUM
- **File:** `src/features/workspace/WorkspaceView.integration.test.tsx`
- **Finding:** The `activeContainerId` state machine, `focusRequestSeq` queue,
  `openDock`/`claimTerminal`/`closeDock` helpers, and session-intent wrappers had no
  assertions at the `WorkspaceView` level.
- **Fix:** Added three integration tests: (1) initial state — terminal focused, no dock
  focus outline; (2) clicking dock claims dock focus (terminal dims); (3) closing dock
  returns container focus to terminal.
- **Commit:** `fix(workspace): address round-8 Claude review findings on focus highlight PR`

### 17. Auto-repeat not filtered in main-process command-palette shortcut matcher

- **Source:** github-codex-connector + github-claude | PR #277 round 1 | 2026-05-26
- **Severity:** P1 (Codex) / MEDIUM (Claude)
- **File:** `electron/command-palette-shortcut.ts`
- **Finding:** `ShortcutInput` omitted `isAutoRepeat`, so `isCommandPaletteShortcutInput`
  matched every auto-repeat `before-input-event` keydown. In packaged Electron builds the
  renderer-side `event.repeat` guard never runs — the main process calls
  `event.preventDefault()`, suppressing the renderer keydown — so holding `Ctrl+:` past the
  OS auto-repeat threshold leaked one IPC toggle every ~100 ms through the
  deduplication-rate-limited dispatcher, flickering the palette open/closed.
- **Fix:** Added `isAutoRepeat?: boolean` to `ShortcutInput` and gated the matcher with
  `&& !input.isAutoRepeat`, achieving parity with the renderer's `event.repeat` guard (Summary
  class 4). Added a predicate test and a `before-input-event` integration test asserting no
  toggle on auto-repeat.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 18. consumePaletteToggleEvent named for one of four call sites

- **Source:** github-claude | PR #277 round 1 | 2026-05-26
- **Severity:** LOW
- **File:** `src/features/command-palette/hooks/useCommandPalette.ts`
- **Finding:** `consumePaletteToggleEvent` (preventDefault + stopPropagation +
  stopImmediatePropagation) was called on Escape and leader follow-up keys too, not only the
  palette toggle shortcut. The name implied a narrower scope, risking a future dev narrowing
  or dropping `stopImmediatePropagation` for the non-toggle paths based on the name alone.
- **Fix:** Renamed the module-local helper to `fullyConsumeEvent` (def + 6 call sites) and added
  a contract comment documenting the full-consume behavior across all call sites. No logic change.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 19. SidebarToggle tooltip hardcodes ⌘B hint on all platforms

- **Source:** github-claude | PR #352 round 1 | 2026-06-06
- **Severity:** MEDIUM
- **File:** `src/features/workspace/components/SidebarToggle.tsx`
- **Finding:** The toggle button always rendered `'Show sidebar  ⌘B'` / `'Hide sidebar  ⌘B'` as the `title` tooltip, regardless of platform. On Linux and Windows the actual shortcut is `Ctrl+⇧B`, so hovering the button showed the wrong hint.
- **Fix:** Added an optional `shortcutHint?: string` prop to `SidebarToggleProps` (defaulting to `'⌘B'`) and threaded a platform-appropriate value (`preferModifier === 'meta' ? '⌘B' : 'Ctrl+⇧B'`) from `WorkspaceView` through `AgentStatusCard` and `IconRail`.
- **Commit:** same commit as this entry

### 20. Directional pane shortcut lacked the `isTerminalContainerActive` guard used by digit keys

- **Source:** github-claude | PR #460 round 1 | 2026-06-15
- **Severity:** HIGH
- **File:** `src/features/terminal/hooks/usePaneShortcuts.ts`
- **Finding:** The new `Cmd/Ctrl+Shift+Arrow` directional handler registered at the document capture phase with `stopPropagation()` but only checked `event.shiftKey` before acting. It did not reuse the existing `isTerminalContainerActive` guard that the digit-key handler already used, so the shortcut fired when CodeMirror (in the dock) had focus and silently stole `Cmd+Shift+Arrow` text-selection shortcuts whenever a neighbor pane existed.
- **Fix:** Added the same guard pattern used by the digit-key path: when `isTerminalContainerActive` is explicitly provided and `false`, return early before the `shiftKey` check so editor focus keeps the event.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 21. No-op directional shortcuts still propagated into the terminal

- **Source:** github-claude | PR #460 round 2 | 2026-06-15
- **Severity:** MEDIUM
- **File:** `src/features/terminal/hooks/usePaneShortcuts.ts`
- **Finding:** After the container-active and dialog guards passed, the directional arrow handler returned without claiming the key when `resolveDirectionalPane` found no neighbor. Because the listener runs at the document capture phase, the unclaimed `keydown` reached xterm.js and forwarded a modified-arrow escape sequence to the PTY on Linux/Windows, making an advertised pane-navigation chord affect the running shell/editor at layout edges or in single-pane sessions.
- **Fix:** Called `event.preventDefault()` and `event.stopPropagation()` before returning from the `target === null` branch, while keeping the editor/dock guard intact. Updated the regression test to expect the shortcut is claimed at edges.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 22. Directional arrow shortcut claims keys when container-active guard is omitted

- **Source:** github-claude | PR #460 round 3 | 2026-06-15
- **Severity:** MEDIUM
- **File:** `src/features/terminal/hooks/usePaneShortcuts.ts`
- **Finding:** The `Cmd/Ctrl+Shift+Arrow` handler checked `isTerminalContainerActive !== undefined && !isTerminalContainerActive` before returning. When the prop was omitted (default `undefined`), the guard was skipped and the capture-phase listener claimed the modified-arrow keystroke even though no caller had vouched that the terminal container owned focus.
- **Fix:** Changed the guard to `if (!isTerminalContainerActive) return`, treating an omitted guard as inactive. Updated all directional-focus regression tests to pass `isTerminalContainerActive: true` and added a new test asserting the shortcut passes through when the guard is omitted.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 23. Keymap pane hardcodes ⌘ modifier on all platforms

- **Source:** github-codex-connector | PR #460 round 3 | 2026-06-15
- **Severity:** P2 / MEDIUM
- **File:** `src/features/settings/sections.ts`, `src/features/settings/components/panes/KeymapPane.tsx`
- **Finding:** The Keymap settings pane stored pre-rendered `⌘`-prefixed strings in `KEYMAP_GROUPS` and `VIM_KEYMAP_GROUPS`. On Linux/Windows the actual shortcuts use `Ctrl`, so the authoritative read-only keymap list advertised the wrong modifier on every non-Mac platform.
- **Fix:** Migrated the keymap data to `ShortcutInput` tokens (`Mod`, `Ctrl`, `Shift`, arrow glyphs, etc.) and rendered each binding through the existing `formatShortcut` utility, which maps `Mod` to `⌘` on macOS and `Ctrl` elsewhere. Added a `KeymapKeys` type that can be a static list or a function `(isMac) => ShortcutInput[]` so chords that require Shift only on Ctrl platforms (sidebar `Ctrl+Shift+B`, terminal copy `Ctrl+Shift+C`) render correctly on every OS. Also formatted the Vim zone labels and footer text through `formatShortcut` so palette references stay platform-correct. Added regression tests asserting `⌘B`/`⌘C` on Mac and `Ctrl+Shift+B`/`Ctrl+Shift+C` on Linux/Windows.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 24. Sidebar-tab shortcut bailed on the sidebar drawer itself

- **Source:** github-codex-connector | PR #460 round 5 | 2026-06-15
- **Severity:** P2 / MEDIUM
- **File:** `src/features/workspace/hooks/useSidebarTabShortcut.ts` L59-61
- **Finding:** The shortcut hook used a blanket `document.querySelector(DIALOG_SELECTOR)` guard to defer to open modals. On compact viewports the sidebar shell is rendered as `role="dialog"` for a11y, so after opening Sessions with Ctrl/Cmd+Shift+S the guard treated the sidebar itself as a modal and suppressed Ctrl/Cmd+Shift+F/S, preventing keyboard switching between Sessions and Files while the drawer was open.
- **Fix:** Replaced the single-selector bail-out with the same exception used by `useSidebarShortcut`: enumerate `openDialogs`, detect when the event target is inside `[role="dialog"][aria-label="Sidebar"]`, and only return early when a dialog is open AND the focus is not inside the sidebar drawer.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 25. Sidebar-tab shortcut required focus inside the drawer after opening it from elsewhere

- **Source:** github-codex-connector | PR #460 round 6 | 2026-06-15
- **Severity:** P2 / MEDIUM
- **File:** `src/features/workspace/hooks/useSidebarTabShortcut.ts` L73-75
- **Finding:** The cycle-5 fix allowed the tab shortcut only when focus was inside `[role="dialog"][aria-label="Sidebar"]`. On compact viewports `revealSidebar` opens the drawer without moving focus into it, so a user opening Sessions with Ctrl/Cmd+Shift+S from the terminal/main area still had `document.activeElement` outside the drawer. The next S/F chord therefore failed the `inSidebarDialog` check and was suppressed, forcing keyboard-only users to click or tab into the drawer before switching to Files.
- **Fix:** Dropped the target-dependent `inSidebarDialog` check. The guard now asks: "is any non-sidebar dialog open?" using `document.querySelectorAll(DIALOG_SELECTOR)` and a reference comparison against the sidebar dialog node. If the only open dialog is the sidebar drawer, the shortcut fires regardless of where focus lives.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 26. Directional pane shortcut intercepted bare Ctrl+Arrow on Linux/Windows

- **Source:** github-codex-connector | PR #460 round 7 | 2026-06-15
- **Severity:** P1 / HIGH
- **File:** `src/features/terminal/hooks/usePaneShortcuts.ts` L224-242
- **Finding:** The directional arrow handler was shift-agnostic, so on Linux/Windows (where `preferModifier` is `ctrl`) it claimed bare `Ctrl+Arrow` keystrokes before xterm could forward them to the PTY. `Ctrl+Left/Right` is common terminal input for word movement in shells, readline, vim, tmux, and other TUI programs, causing visible terminal input regressions. The PR's own design doc (`docs/superpowers/specs/2026-06-14-keymap-presets-vim-mode-design.md` §5.2) specified `⌘+Shift`+arrow.
- **Fix:** Added `if (!event.shiftKey) return` after the container-active and dialog guards in the arrow branch, restoring the Shift requirement on all platforms. Updated the regression test that previously asserted shiftless navigation to instead assert that bare `Ctrl+Arrow` and bare `Cmd+Arrow` pass through, and updated the Keymap settings labels to advertise `Mod+Shift+Arrow`.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 27. Sidebar-tab shortcut matched logical `event.key`, breaking non-Latin layouts

- **Source:** github-claude | PR #460 round 9 | 2026-06-15
- **Severity:** MEDIUM
- **File:** `src/features/workspace/hooks/useSidebarTabShortcut.ts` L43-45
- **Finding:** The shortcut detected S/F via `event.key.toLowerCase()`. On non-Latin IME layouts (Cyrillic, Arabic, Hebrew, CJK), the physical S/F keys produce non-Latin characters in `event.key`, so the guard never matched and ⌘⇧S / Ctrl+⇧S silently did nothing. Other keyboard hooks in the same PR already used `event.code` for physical-key matching.
- **Fix:** Replaced the `event.key` check with `event.code !== 'KeyS' && event.code !== 'KeyF'` and derived the dispatch key from `event.code`. Updated the unit-test helper to set `KeyboardEvent.code` by default and added a regression test with a Cyrillic `event.key`.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 28. Session-navigation shortcut did not reclaim terminal focus after switching

- **Source:** github-codex-connector | PR #460 round 9 | 2026-06-15
- **Severity:** P2 / MEDIUM
- **File:** `src/features/workspace/WorkspaceView.tsx` L1500-1512
- **Finding:** When Ctrl/Cmd+[ or ] changed `activeSessionId`, `TerminalZone` kept inactive sessions mounted hidden and the newly shown session's active pane did not get a focus rising edge. DOM focus could stay on the old hidden xterm textarea or fall to `body`, so subsequent typing went nowhere until the user clicked.
- **Fix:** Called `claimTerminal()` immediately after `setActiveSessionId(nextSession.id)` in `switchRelativeSession`, reusing the existing terminal-focus request path so the new active session's pane receives focus.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
