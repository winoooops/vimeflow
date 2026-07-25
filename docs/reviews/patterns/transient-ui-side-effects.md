---
id: transient-ui-side-effects
category: react-patterns
created: 2026-06-20
last_updated: 2026-07-22
ref_count: 10
---

# Transient UI Side Effects

## Summary

Preview, hover, or highlight interactions that mutate observable UI state (e.g.
themes, layouts, or focus) must keep persistent state unchanged until the user
confirms the action. Capture the baseline state when the transient interaction
starts, apply the preview only to ephemeral rendering, and restore the baseline
if the user dismisses without confirming. Confirmed actions should then write
to persistent state through a separate, explicit path.

## Findings

### 1. Theme not restored when palette is dismissed without selecting

- **Source:** github-claude | PR #570 round 1 | 2026-06-20
- **Severity:** HIGH
- **File:** `src/features/command-palette/hooks/useCommandPalette.ts`
- **Finding:** `selectedCommand?.preview?.()` was called for every highlighted
  theme entry, but `close()` reset only palette UI state and had no mechanism to
  restore the theme that was active before the preview started. Pressing Escape
  after browsing themes left the app on the last highlighted theme.
- **Fix:** Captured `themeService.current().id` when the palette opens and
  restored it inside `close()` with `themeService.apply(originalThemeId)` before
  resetting state. The restore ref is cleared on execute so confirmed theme
  selections persist.
- **Commit:** same commit as this entry

### 2. Avoid persisting theme previews before confirmation

- **Source:** github-codex-connector | PR #570 round 1 | 2026-06-20
- **Severity:** P2 / MEDIUM
- **File:** `src/features/workspace/commands/buildWorkspaceCommands.ts`
- **Finding:** Theme leaf commands used `themeService.apply(theme.id)` in their
  `preview` callback, which wrote both the DOM and `localStorage`. Cancelling the
  palette left the previewed theme persisted.
- **Fix:** Added a DOM-only `themeService.preview(id)` method and changed theme
  leaf `preview` callbacks to use it while keeping `execute` as the only path
  that calls `themeService.apply`.
- **Commit:** same commit as this entry

### 3. Unconditional ref-null clears restore guard for non-theme commands

- **Source:** github-claude | PR #570 round 2 | 2026-06-20
- **Severity:** HIGH
- **File:** `src/features/command-palette/hooks/useCommandPalette.ts`
- **Finding:** `executeSelected` cleared `originalThemeIdRef.current`
  unconditionally after any command ran, so a non-theme command executed after a
  theme preview lost the restore guard and `close()` skipped restoring the
  original theme.
- **Fix:** Gated the ref clear on `selected.preview` so only commands that
  produced a visual preview clear the guard; non-theme commands leave the ref
  intact and `close()` restores the original theme.
- **Commit:** same commit as this entry

### 4. Notify theme subscribers during previews

- **Source:** github-codex-connector | PR #570 round 2 | 2026-06-20
- **Severity:** P2 / MEDIUM
- **File:** `src/theme/service.ts`
- **Finding:** `themeService.preview` wrote DOM CSS variables but did not notify
  subscribers, so terminal and editor panes that rely on the subscription path
  stayed on the old colors during theme previews.
- **Fix:** Updated `preview` to set the active theme, write the DOM, and notify
  listeners while keeping `localStorage` writes reserved for confirmed `apply`
  calls.
- **Commit:** same commit as this entry

### 5. Clipboard success indicator ignored the write result

- **Source:** github-claude | PR #575 round 1 | 2026-06-20
- **Severity:** LOW
- **File:** `src/features/terminal/components/TerminalPane/GitRefChip.tsx`
- **Finding:** Copy rows called `writeClipboardText(value)` without awaiting the
  returned boolean, then immediately showed the success check. If both the
  Clipboard API and fallback copy path failed, the UI still reported success
  while the clipboard remained unchanged.
- **Fix:** Awaited `writeClipboardText` and gated the transient check state plus
  reset timer on a true result. Added regression coverage for both successful
  async feedback and the failure path that keeps the copy glyph visible.
- **Commit:** same commit as this entry

### 6. Context menu opened before async clipboard-derived state settled

- **Source:** github-claude | PR #618 round 1 | 2026-06-24
- **Severity:** LOW
- **File:** `src/features/terminal/hooks/useTerminalClipboard.ts`
- **Finding:** The terminal context menu reset `canPasteImage` to false and opened immediately while the clipboard image-type read was still pending. Fast reads produced a visible disabled-to-enabled transition for the Paste Image row.
- **Fix:** Deferred menu open until a fast clipboard image check resolves, with a short fallback timer for slow or permission-gated reads. Cleanup now cancels pending fallback timers, and a regression test asserts the fast-read path opens with image state already settled.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 7. Width-derived pane collapse applied after first paint

- **Source:** github-claude | PR #627 round 1 | 2026-06-26
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/usePaneWidth.ts`
- **Finding:** `usePaneWidth` measured the pane in `useEffect`, so panes that
  mounted below the auto-collapse threshold first painted expanded chrome before
  width state updated and collapsed the pane.
- **Fix:** Switched the measurement and ResizeObserver setup to
  `useLayoutEffect`, keeping the same width logic while applying the
  layout-derived state before the browser paints.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 8. Status collapse toggle stayed active while status bar was suppressed

- **Source:** github-codex-connector | PR #627 round 1 | 2026-06-26
- **Severity:** LOW
- **File:** `src/features/terminal/components/TerminalPane/index.tsx`
- **Finding:** `PaneStatusBar` was suppressed in awaiting-restart mode, but
  the header collapse toggle stayed interactive in wide panes. Clicking it
  mutated retained collapse state for a surface that was not rendered, making
  the action appear inert and carrying surprising state across restart.
- **Fix:** Computed `hideCollapseToggle` from the same terminal-pane state that
  suppresses the status bar and threaded it through `Header` to `HeaderActions`.
  Added regression coverage for the awaiting-restart pane and header forwarding
  behavior.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 9. Native overlay host retained stale theme variables

- **Source:** github-claude | PR #638 round 1 | 2026-06-30
- **Severity:** MEDIUM
- **File:** `src/components/NativeOverlayHost.tsx`
- **Finding:** `applyThemeSnapshot` returned immediately when a native overlay
  render request omitted `theme`, leaving any prior CSS variables, `data-theme`,
  and `colorScheme` on the persistent overlay document.
- **Fix:** Reset theme-owned `--color-*` and `--shadow-*` inline properties plus
  theme metadata before each render, then apply the new snapshot only when one
  is present. Added regression coverage for a themed request followed by an
  unthemed request in the same host window.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 10. Split diff row navigation scrolled on no-op movement

- **Source:** github-codex-connector | PR #633 round 1 | 2026-06-29
- **Severity:** MEDIUM
- **File:** `src/features/diff/components/DiffPanelContent.tsx`
- **Finding:** Split-mode `j` navigation skipped paired deletion/addition
  targets by row, but a single-row replacement diff could resolve the next
  target back to the current deletion target. The selection did not move, yet
  the scroll side effect still ran with a downward movement delta.
- **Fix:** Added an early return when resolved keyboard navigation is a no-op,
  before focus and scroll side effects run. Added a regression test covering a
  single-row split replacement from the deletion side.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 11. Split side navigation reused vertical scroll positioning

- **Source:** github-claude | PR #633 round 3 | 2026-06-29
- **Severity:** MEDIUM
- **File:** `src/features/diff/components/DiffPanelContent.tsx`
- **Finding:** Split-mode `h`/`l` side navigation passed `delta=0` through
  scroll positioning written for `j`/`k`. The helper treated non-positive
  deltas as upward navigation, so lateral moves on the only, first, or last
  visual row could snap the viewport even though the user did not move
  vertically.
- **Fix:** Added an explicit `delta === 0` path that uses nearest-block
  scrolling and sticky-header reveal without previous-row reservation. Added a
  regression assertion for lateral movement on a single split replacement row.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 12. Closing a review draft retained the prior category

- **Source:** github-codex-connector | PR #657 round 1 | 2026-07-04
- **Severity:** P2 / MEDIUM
- **File:** `src/features/diff/hooks/useReviewCommentDraft.ts`
- **Finding:** Closing a draft cleared the annotation target and text, but the
  selected review category ref stayed on the previous value. The next new
  comment could open as Question/Bug/Suggestion and dispatch the wrong intent.
- **Fix:** Reset the category to the default from `closeCommentDraft`, and add a
  hook regression test that closes a non-default draft before opening a new one.
- **Commit:** same commit as this entry

### 13. No-op native dock shortcuts left focus on the renderer proxy

- **Source:** github-claude | PR #666 round 1 | 2026-07-05
- **Severity:** HIGH
- **File:** `electron/ghostty-native-parent.ts`
- **Finding:** Native Ghostty shortcut forwarding used a static refocus
  allowlist that excluded dock-opening shortcuts such as Cmd+G, Cmd+E, Cmd+N,
  and Cmd+0. When React handled one of those chords as a no-op and left focus
  on the hidden renderer proxy, the active Ghostty pane did not regain
  keyboard focus.
- **Fix:** Changed the post-dispatch probe to return both same-pane activity and
  whether focus moved into the dock. Ghostty is refocused only when the same
  pane remains active and the dock did not take focus, so no-op dock shortcuts
  recover terminal focus without stealing it from successful dock opens.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 14. Native dialog fallback visibility lagged first paint

- **Source:** github-claude | PR #667 round 2 | 2026-07-05
- **Severity:** HIGH
- **File:** `src/components/Dialog.tsx`
- **Finding:** Native-overlay dialogs hid the local DOM fallback only after the
  async native attempt state changed from `idle`, letting the DOM dialog flash
  for one paint before the native surface took over.
- **Fix:** Derived local hiding synchronously from `canAttemptNative` unless the
  native attempt has failed, preserving fallback while eliminating first-paint
  flicker.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 15. Context-menu native payload updates shared close cleanup

- **Source:** github-claude | PR #667 round 2 | 2026-07-05
- **Severity:** HIGH
- **File:** `src/components/Menu.tsx`
- **Finding:** `MenuContextMenu` tied payload and position refreshes to an
  effect whose cleanup always closed the native overlay, so live content
  updates tore down and recreated the native window.
- **Fix:** Split native context-menu lifetime cleanup from payload refreshes and
  close the surface only when the menu can no longer use the native transport.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 16. Inactive native terminal panes accepted imperative focus

- **Source:** local-codex | PR #667 round 4 | 2026-07-05
- **Severity:** HIGH
- **File:** `src/features/terminal/components/TerminalPane/TerminalBody.tsx`
- **Finding:** `TerminalBody.focusTerminal()` reused the xterm-era imperative
  focus contract for native Ghostty without checking the pane `active` prop.
  Browser focus on hidden xterm DOM was harmless, but native focus IPC can move
  OS focus into a background pane the user cannot see.
- **Fix:** Gated the native focus branch on `active` while preserving xterm's
  existing fallback behavior. Added a regression test proving inactive native
  panes do not call `focusNativeGhostty`.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 17. Local dialog controls followed requested native transport, not active transport

- **Source:** local-codex | PR #667 round 4 | 2026-07-05
- **Severity:** HIGH
- **File:** `src/components/Dialog.tsx`,
  `src/features/sessions/components/NewSessionDialog/NewSessionDialog.tsx`
- **Finding:** New Session disabled the local Browse button whenever
  `nativeOverlay` was requested, even if the native dialog was unsupported or
  rejected and the DOM fallback was visible. The read-only path crumb then left
  users with no working-directory edit action.
- **Fix:** Exposed Dialog's actual accepted native-active state and disabled
  Browse only while that state is active. Added a regression that rejects the
  native dialog open and expects the local Browse button to stay enabled.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 18. Native tooltip shortcut arrays retriggered overlay lifetime effects

- **Source:** github-claude | PR #671 round 1 | 2026-07-07
- **Severity:** HIGH
- **File:** `src/components/Tooltip.tsx`
- **Finding:** Native tooltip requests depended on the raw `shortcut` prop.
  Callers that passed inline chord arrays allocated a new array on each render,
  so an unchanged shortcut could still recreate the native request callback and
  make the open/close effect tear down and reopen the visible overlay.
- **Fix:** Formatted shortcuts once into a primitive string and used that value
  in the native payload and effect dependencies. Added regression coverage that
  rerenders an open native tooltip with a fresh inline shortcut array without
  closing or reopening the overlay.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 19. Mount-time selection key suppressed later return navigation

- **Source:** github-claude | PR #713 round 1 | 2026-07-20
- **Severity:** MEDIUM
- **File:** `src/features/diff/components/ChangedFilesList.tsx`
- **Finding:** The changed-files list compared every selected row against the
  key captured when the list mounted. Navigating away and then back to that
  original file therefore skipped the scroll side effect as if it were still
  the first render.
- **Fix:** Replaced the identity comparison with a one-time boolean skip for
  the initial selected effect pass. Added regression coverage for moving back
  to the file that was selected on mount.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 20. Overlay remount reset the selected-row scroll guard

- **Source:** github-claude | PR #713 round 2 | 2026-07-20
- **Severity:** HIGH
- **File:** `src/features/diff/components/ChangedFilesList.tsx`
- **Finding:** The unpinned changed-files overlay unmounted the list while
  hidden, so a keyboard-selected file chosen while hidden became the fresh
  mount's initial selection. Revealing the default overlay then skipped the
  selected-row scroll instead of showing the current file.
- **Fix:** Moved the initial-scroll suppression state to
  `ChangedFilesListSurface`, preserving it across overlay reveal remounts while
  keeping standalone list behavior unchanged. Added regression coverage for
  hidden n/p selection followed by overlay reveal.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 21. Palette close focus restore ignored settings dialog ownership

- **Source:** github-codex-connector | PR #725 round 1 | 2026-07-22
- **Severity:** P2 / MEDIUM
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** The command palette close effect restored focus to the active
  terminal or dock after any palette command, but the renderer settings fallback
  can open a modal in the same batch as palette close. That allowed the parent
  focus restore to move keyboard focus behind the settings dialog.
- **Fix:** Added `settingsDialog.isOpen` to the close-effect guard and dependency
  list so settings owns focus while its dialog is visible.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
