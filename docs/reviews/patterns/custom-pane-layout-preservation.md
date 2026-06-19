---
id: custom-pane-layout-preservation
category: correctness
created: 2026-06-19
last_updated: 2026-06-19
ref_count: 0
---

# Custom Pane Layout Preservation

## Summary

Custom pane layouts can define capacities larger than any builtin layout. When a custom layout is removed, rejected, or replaced with a smaller definition while sessions still depend on it, blindly shrinking those sessions to a builtin layout can silently drop panes on the next durable save/reload. The frontend must preserve the depended-on definition until every session using it can fit within the remaining allowed layouts, or explicitly resolve the excess panes instead of persisting an over-capacity builtin layout.

## Findings

### 1. Removing a large custom layout drops panes beyond builtin capacity

- **Source:** github-codex-connector (P1 / HIGH) | PR #546 round 1 | 2026-06-19
- **Severity:** P1 / HIGH
- **File:** `src/features/terminal/layout-registry/layoutRegistry.ts` L104-106
- **Finding:** `autoShrinkLayoutFor` fell back to `grid3x2` when the current custom layout was no longer registered and `nextPaneCount > 6`. The renderer kept all panes in memory, but the backend durable repair caps non-custom layouts at six panes, so the next save/reload silently dropped panes beyond the sixth.
- **Fix:** In `setCustomPaneLayouts`, validate the incoming definitions first, then preserve any existing custom layout whose id is still used by a session with more panes than `MAX_BUILTIN_PANE_COUNT` and that is absent or under-capacity in the candidate registry. The preserved definition overrides rejected or insufficient replacements, preventing the over-capacity builtin fallback.
- **Commit:** same commit as this entry
