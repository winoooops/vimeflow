---
id: motion-layout-projection
category: react-patterns
created: 2026-06-10
last_updated: 2026-06-10
ref_count: 0
---

# Motion Layout Projection

## Summary

Framer Motion reorder interactions rely on continuous layout projection state.
Do not toggle `Reorder.Item` layout projection on after a gesture has already
started to suppress unrelated non-drag layout animations. Preserve the native
reorder loop for drag smoothness, and solve non-drag layout animation at the
container/visibility/transition boundary instead.

## Findings

### 1. Drag-intent layout gating broke session row reorder smoothness

- **Source:** local-codex | local investigation | 2026-06-10
- **Severity:** HIGH
- **File:** `src/features/sessions/components/Card.tsx`, `src/features/sessions/components/List.tsx`
- **Finding:** A prior sidebar stabilization changed session rows from always-on `layout="position"` to `layout={dragging ? 'position' : false}` with a 4px pointer-intent threshold. This suppressed a non-drag vertical animation seen when switching sidebar tabs, but it made Framer start measuring layout projection mid-gesture. Dragging the 3rd row toward the 2nd could jump to the 1st slot because Framer had no continuous pre-drag position cache.
- **Fix:** Restore the native Framer reorder path: keep `Reorder.Item layout="position"` always enabled and let `Reorder.Group.onReorder` immediately commit the reordered Active subset with the current Recent suffix. Confirm competing strategies in a dev-only side-by-side demo before changing production behavior. If tab switching creates unwanted non-drag row motion, fix that by stabilizing container geometry or suppressing non-drag transitions, not by disabling reorder layout projection.
- **Commit:** _(pending current change)_
