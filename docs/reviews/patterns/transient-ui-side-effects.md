---
id: transient-ui-side-effects
category: react-patterns
created: 2026-06-20
last_updated: 2026-06-26
ref_count: 2
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
