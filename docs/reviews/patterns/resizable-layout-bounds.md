---
id: resizable-layout-bounds
category: correctness
created: 2026-06-18
last_updated: 2026-06-18
ref_count: 0
---

# Resizable Layout Bounds

## Summary

Resizable grid or split layouts must enforce per-track minimum and maximum
sizes in the ratio model, not only at the drag handle. Relying solely on a
global drag clamp lets extreme ratios collapse adjacent tracks to zero width
or hide panes entirely. Clamp the computed track weights against the same
minimum and maximum percentages used by the elastic drag controller so the
model and the rendered grid stay consistent and no pane becomes inaccessible.

## Findings

### 1. Clamp adjacent grid tracks above zero

- **Source:** github-codex-connector | PR #527 round 1 | 2026-06-18
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/layout-registry/ratioModel.ts` L81
- **Finding:** `updateTrackBoundaryRatio` clamped the movable pair's left
  weight to `[0, pairTotal]`, which allowed an adjacent column to collapse to
  zero width. For `grid3x2` with tracks `[1, 1, 1]`, dragging the first divider
  to the max ratio produced `[2, 0, 1]`, hiding the middle column.
- **Fix:** Imported `SPLIT_ELASTIC_CONFIG.minPercent` and clamped the pair's
  left weight to `[minPercent * total, pairTotal - minPercent * total]`,
  guaranteeing every track stays above the configured minimum.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this
  line)

### 2. grid3x2 compatibility check accepts pane counts above its capacity

- **Source:** github-claude | PR #528 round 2 | 2026-06-18
- **Severity:** LOW
- **File:** `crates/backend/src/terminal/commands.rs` L649, `src/features/terminal/layout-registry/layoutRegistry.ts` L34
- **Finding:** Both the Rust kill-pty re-layout check and the frontend `autoShrinkLayoutFor` used an open lower bound (`count >= 5` / `nextPaneCount >= 5`) for `grid3x2` compatibility. `grid3x2` capacity is 6, so malformed or migrated snapshots with 7+ panes would be accepted as valid and `resolveGrid` would reference non-existent named pane areas (p6, p7, …).
- **Fix:** Tightened both checks to `count == 5 || count == 6` / `nextPaneCount === 5 || nextPaneCount === 6` so the compatibility test matches the layout's defined capacity.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
