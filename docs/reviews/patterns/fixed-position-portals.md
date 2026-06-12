---
id: fixed-position-portals
category: react-patterns
created: 2026-06-12
last_updated: 2026-06-12
ref_count: 0
---

# Fixed-Position Portals

## Summary

Always render `position: fixed` overlays, context menus, and popovers through a React portal to `document.body` (or another stable root outside the triggering component's layout subtree). CSS containment created by `container-type`, `contain: layout`, transforms, or `will-change` can make a fixed-position descendant resolve against a containing block other than the viewport, causing viewport-relative `clientX`/`clientY` coordinates to misalign and `overflow: hidden` ancestors to clip the overlay.

## Findings

### 1. ContextMenu inside `[container-type:inline-size]` wrapper used viewport coordinates

- **Source:** github-claude | PR #428 | 2026-06-12
- **Severity:** HIGH
- **File:** `src/features/editor/components/MarkdownReadingView.tsx`, `src/features/editor/components/ContextMenu.tsx`
- **Finding:** `MarkdownReadingView` wraps its rendered `ContextMenu` inside an element with `[container-type:inline-size]`, which engages `contain: layout` and makes that element the containing block for fixed-position descendants. The menu stored viewport-relative `event.clientX/Y` coordinates but rendered with `position: fixed`, so in docked or split layouts the menu would be displaced by the container's viewport offset and could be clipped by the wrapper's `overflow: hidden`.
- **Fix:** Rendered the editor `ContextMenu` through `createPortal(..., document.body)` so its fixed coordinates resolve against the viewport and it escapes the containment/overflow boundary.
- **Commit:** _(see git log for the cycle-1 fix commit on PR #428)_
