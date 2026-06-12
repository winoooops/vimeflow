---
id: ui-visual-regression
category: code-quality
created: 2026-06-11
last_updated: 2026-06-12
ref_count: 0
---

# UI Visual Regression

## Summary

UI color and styling choices must be verified against the full state matrix of
the component. A new gradient, border, or accent color can silently collide with
an existing state color and render two distinct segments indistinguishable.
Regressions are especially likely when:

- A named palette constant (e.g. Catppuccin Mocha hex) is reused for a new
  semantic purpose without checking existing usages.
- Tests exercise only the "healthy" or default state and omit edge states
  (cold, empty, error) where the collision occurs.

The fix shape: pick a visually distinct color from the palette, and add a
test case for the state that triggers the collision.

## Findings

### 1. Fresh-segment gradient collides with cold-state cached segment

- **Source:** github-claude | PR #419 round 1 | 2026-06-11
- **Severity:** MEDIUM
- **File:** `src/features/agent-status/components/TokenCache.tsx`
- **Finding:** `FRESH_STACK_GRADIENT` was changed to
  `linear-gradient(90deg, #ff94a5, #ffb4ab)`. The existing `cachedShareHex`
  function already returns `#ff94a5` for the cold-state cached segment
  (`sharePct < 40`). In a cold-cache scenario both the cached and fresh
  segments opened with the same pink, merging visually into one block.
  The new test only used a healthy-cache input (`makeUsage(7500, 1800, 700)`),
  so the collision was never exercised.
- **Fix:** Changed `FRESH_STACK_GRADIENT` to
  `linear-gradient(90deg, #fab387, #f9a87b)` (Catppuccin Peach), which does
  not overlap with any `cachedShareHex` output (`#7defa1`, `#cba6f7`,
  `#ff94a5`). Added a cold-cache test case asserting that cached and fresh
  stack styles differ.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 2. Browser pane focus halo referenced an undefined `--color-scrim` token

- **Source:** github-codex-connector | PR #424 round 1 | 2026-06-12
- **Severity:** P2 / MEDIUM
- **File:** `src/features/browser/components/BrowserPane.tsx`
- **Finding:** The focused browser pane `boxShadow` used `color-mix(in srgb, var(--color-scrim) 35%, transparent)`, but the theme token set did not define `--color-scrim`. The unresolved variable invalidated the `box-shadow` declaration, so the focus halo was lost instead of themed.
- **Fix:** Added `scrim` to `EFFECT_COLOR_TOKENS`, defined it in both Catppuccin (the default theme, slug `obsidian-lens`) and Flexoki themes, and synced `src/theme/theme.css` so `--color-scrim` resolves.
- **Commit:** same commit as this entry

### 3. Hard-coded context-menu height clips at high-DPI scaling

- **Source:** github-claude | PR #428 round 1 | 2026-06-12
- **Severity:** MEDIUM
- **File:** `src/features/editor/components/MarkdownReadingView.tsx`
- **Finding:** `CONTEXT_MENU_HEIGHT = 112` was used to clamp the context menu's Y coordinate before render. At 125–150% system DPI the effective rendered height exceeds the room reserved at the bottom edge, causing the menu to overflow the viewport. The fix shape is the same as other visual-regression issues: verify the component against the full display state matrix, not just the default 1x scale.
- **Fix:** Increased the clamp constant from 112 to 160 px, reserving enough bottom margin for common HiDPI scales. Added a regression test for the clipboard fallback path; future work could measure the actual `offsetHeight` from the menu ref after render for pixel-perfect clamping.
- **Commit:** same commit as this entry
