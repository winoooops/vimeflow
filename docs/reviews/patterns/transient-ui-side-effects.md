---
id: transient-ui-side-effects
category: react-patterns
created: 2026-06-20
last_updated: 2026-06-20
ref_count: 0
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
