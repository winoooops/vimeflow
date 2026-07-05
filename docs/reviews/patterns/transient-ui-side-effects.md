---
id: transient-ui-side-effects
category: react-patterns
created: 2026-06-20
last_updated: 2026-07-04
ref_count: 6
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

### 9. Split diff row navigation scrolled on no-op movement

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

### 10. Split side navigation reused vertical scroll positioning

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

### 11. Closing a review draft retained the prior category

- **Source:** github-codex-connector | PR #657 round 1 | 2026-07-04
- **Severity:** P2 / MEDIUM
- **File:** `src/features/diff/hooks/useReviewCommentDraft.ts`
- **Finding:** Closing a draft cleared the annotation target and text, but the
  selected review category ref stayed on the previous value. The next new
  comment could open as Question/Bug/Suggestion and dispatch the wrong intent.
- **Fix:** Reset the category to the default from `closeCommentDraft`, and add a
  hook regression test that closes a non-default draft before opening a new one.
- **Commit:** same commit as this entry
