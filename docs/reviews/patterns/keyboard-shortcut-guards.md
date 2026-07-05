---
id: keyboard-shortcut-guards
category: keyboard-shortcuts
created: 2026-05-18
last_updated: 2026-07-05
ref_count: 6
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

### 3. Ctrl+e/g also stolen from CodeMirror vim mode

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

### 4. focusEditor() silently drops DOM focus when editorView returns false

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

### 5. borderClass contained redundant Tailwind side-specific color utilities

- **Source:** github-claude | PR #218 | 2026-05-18
- **Severity:** LOW
- **File:** `src/features/workspace/components/DockPanel.tsx`
- **Finding:** Each branch of the `borderClass` ternary applied both `border-[color]` (all sides)
  and `border-{side}-[color]` (side-specific override), producing dead redundant classes since only
  one border edge has non-zero width.
- **Fix:** Extracted `borderColor` constant and simplified each branch to `border-{edge} border-[${borderColor}]`.
- **Commit:** `fix(workspace): address round-3 Claude review findings on focus highlight PR`

### 6. DIALOG_SELECTOR duplicated verbatim across both shortcut hooks

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
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 20. Wire shortcuts for all six grid panes

- **Source:** github-codex-connector | PR #527 round 1 | 2026-06-18
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/hooks/usePaneShortcuts.ts`
- **Finding:** `usePaneShortcuts` matched only `Digit1` through `Digit4`, but
  the new `grid3x2` layout has six panes and the per-pane tooltips advertise
  `Mod+5` / `Mod+6`. Those shortcuts never fired, leaving the bottom middle and
  right panes unreachable by keyboard.
- **Fix:** Extended the regex from `^Digit([1-4])$` to `^Digit([1-6])$` and
  added a test covering `Ctrl+5` / `Ctrl+6` focus in a `grid3x2` session.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 21. Image paste shortcut stole shifted macOS text paste

- **Source:** github-codex-connector | PR #618 round 1 | 2026-06-24
- **Severity:** P2
- **File:** `src/features/terminal/hooks/useTerminalClipboard.ts`
- **Finding:** The macOS image-paste shortcut matched `Cmd+Shift+V` because it did not require `!event.shiftKey`. In agent panes with image paste enabled, this branch ran before the normal text-paste shortcut and regressed the shifted terminal paste chord.
- **Fix:** Required `!event.shiftKey` for the macOS image-paste shortcut so `Cmd+Shift+V` continues through the normal text paste path. Added a regression test with image paste enabled and an image-capable clipboard.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 22. Duplicate macOS shortcut chips for semantically different paste rows

- **Source:** github-claude | PR #618 round 1 | 2026-06-24
- **Severity:** LOW
- **File:** `src/features/terminal/components/TerminalContextMenu.tsx`
- **Finding:** On macOS, both the Paste and Paste Image context-menu rows rendered the same shortcut chip, making the menu look contradictory even though the image path has priority only when the clipboard contains an image.
- **Fix:** Made the Paste Image shortcut chip platform-aware and omitted it on macOS while keeping the distinct `Ctrl+V` chip on non-mac platforms. Added a macOS module-load regression test for the rendered row.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 23. Command palette shortcut stayed active inside New Session modal

- **Source:** github-codex-connector | PR #624 round 1 | 2026-06-26
- **Severity:** P2 / MEDIUM
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** The command palette remained enabled while the New Session dialog was open,
  so the capture-phase palette shortcut could open a second modal over the active modal.
- **Fix:** Include `newSessionDialog.open` in the palette `enabled` guard.
- **Commit:** same commit as this entry

### 24. Nested controls inside menu rows lost their own keyboard activation

- **Source:** CI | PR #624 unit test failure | 2026-06-26
- **Severity:** MEDIUM
- **File:** `src/components/Menu.tsx`
- **Finding:** `Menu.Row` let nested button Enter key events reach menu navigation
  plumbing, so the nested control did not receive its expected activation.
- **Fix:** Stop propagation for keyboard events that originate from nested focusable
  controls while preserving the row's own Enter/Space activation.
- **Commit:** same commit as this entry

### 25. Native Cmd+digit shortcut used layout-sensitive characters

- **Source:** github-claude | PR #642 round 1 | 2026-07-01
- **Severity:** MEDIUM
- **File:** `native/ghostty-helper/Sources/GhosttyElectronBridge/GhosttyElectronBridge.swift`
- **Finding:** The native Ghostty keydown monitor matched Cmd+digit shortcuts from
  `event.charactersIgnoringModifiers`, so non-US layouts could produce punctuation
  for the physical digit row while the renderer shortcut path continued to use
  layout-independent `KeyboardEvent.code` values.
- **Fix:** Map AppKit `NSEvent.keyCode` values for physical ANSI digit-row keys 1
  through 9 to the forwarded `DigitN` payload, preserving the existing
  allowed-digit filter.
- **Commit:** same commit as this entry

### 26. Mod+Z focus toggle captured terminal and editor undo controls

- **Source:** github-codex-connector | PR #631 round 1 | 2026-06-28
- **Severity:** P1 / HIGH
- **File:** `src/features/terminal/hooks/usePaneShortcuts.ts`
- **Finding:** The new document-level `Mod+Z` layout toggle consumed the event before focused controls could handle it, stealing terminal `Ctrl+Z` job suspension and editor/dock undo behavior.
- **Fix:** Guarded the shortcut so it passes through when the terminal container is inactive or focus is inside editable/xterm input. Added regression coverage for focused dock and xterm helper textarea cases.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 27. Mod+Z focus toggle lacked terminal-container ownership guard

- **Source:** github-claude | PR #631 round 1 | 2026-06-28
- **Severity:** HIGH
- **File:** `src/features/terminal/hooks/usePaneShortcuts.ts`
- **Finding:** The `KeyZ` branch did not mirror the digit-shortcut container guard, so `Ctrl+Z` / `Cmd+Z` from the focused editor dock toggled the terminal layout instead of reaching the dock.
- **Fix:** Added an `isTerminalContainerActiveRef.current === false` pass-through before the branch can prevent default, with regression coverage for dock focus.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 28. Manual layout cycle left stale Mod+Z restore state

- **Source:** github-claude | PR #631 round 2 | 2026-06-28
- **Severity:** MEDIUM
- **File:** `src/features/terminal/hooks/usePaneShortcuts.ts`
- **Finding:** The per-session Mod+Z restore map was cleared on restore and failed-restore
  paths, but not when `Mod+\` manually changed the same session's layout. A user could
  enter single-pane focus with `Mod+Z`, cycle away with `Mod+\`, later return to single,
  and have the next `Mod+Z` consume the stale restore entry.
- **Fix:** Clear the active session's restore entry in the `Backslash` layout-cycle branch
  before applying the next layout. Added regression coverage for the cycle-away-then-single
  path so `Mod+Z` returns to the single-layout no-op behavior.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 29. Unified diff navigation reused split-row skipping

- **Source:** github-codex-connector | PR #633 round 2 | 2026-06-29
- **Severity:** P2 / MEDIUM
- **File:** `src/features/diff/components/DiffPanelContent.tsx`
- **Finding:** The `j`/`k` line shortcuts always skipped sibling targets with the same split-row index, even when the active renderer was unified and `h`/`l` side navigation was disabled.
- **Fix:** Kept same-row skipping and same-side preservation only for split mode; unified mode now steps target-by-target and uses per-line scroll indexing. Added a regression that reaches the added side of a replacement hunk in unified view.
- **Commit:** same commit as this entry

### 30. Remounted changed-files pin button dropped diff keyboard scope

- **Source:** github-claude | PR #645 round 4 | 2026-07-02
- **Severity:** HIGH
- **File:** `src/features/diff/Panel.tsx`
- **Finding:** The changed-files pin/unpin button flipped the pinned state while the button itself lived inside the subtree that changes shape between pinned and floating modes. Removing the focused button left focus on `body`, so the diff panel's keyboard-scope guard ignored subsequent `j`/`k`/`e` shortcuts until the user clicked back into the diff.
- **Fix:** Move focus to the stable diff root before toggling the pinned state, matching other handlers that close or remount diff side surfaces. Added a regression test that clicks both pin and unpin and asserts focus remains on `diff-populated-state`.
- **Commit:** same commit as this entry

### 31. Plain changed-files toggle dropped diff keyboard scope

- **Source:** github-claude | PR #645 round 5 | 2026-07-02
- **Severity:** HIGH
- **File:** `src/features/diff/Panel.tsx`
- **Finding:** The plain `e` changed-files toggle could close or unpin the changed-files
  surface while focus was inside that surface. Removing the focused row or button left
  focus on `body`, so later diff keyboard shortcuts were ignored until the user clicked
  back into the diff panel.
- **Fix:** Move focus to the stable diff root at the start of `toggleFilesList`, mirroring
  the pinned-toggle handoff before any changed-files subtree is hidden or remounted.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
