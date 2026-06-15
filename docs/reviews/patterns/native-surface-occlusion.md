---
id: native-surface-occlusion
category: correctness
created: 2026-06-15
last_updated: 2026-06-15
ref_count: 0
---

# Native Surface Occlusion

## Summary

React overlays that drive Electron native WebContentsView visibility must register an occlusion signal for every pointer-blocking surface they create. If a drag or resize interaction starts in React but can move over a native browser pane, the pane must be occluded so the native view does not intercept document-level mouse events and stall the interaction. Each distinct drag source should map to its own overlay registration rather than reuse an unrelated overlay flag, preserving existing behavior tests and avoiding hidden coupling.

## Findings

### 1. Include dock drags in native occlusion

- **Source:** github-codex-connector | PR #474 round 1 | 2026-06-15
- **Severity:** P2 / MEDIUM
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** When resizing the dock (`verticalDockElastic.isDragging`/`horizontalDockElastic.isDragging`), `terminalFitDeferred` is true but this registration only opens the native-occluding drag overlay for sidebar drags (`isDragging`). In a workspace where the active pane is a BrowserPane, moving the dock resize cursor over the pane leaves the Electron `WebContentsView` visible, so it can sit above the React layer and intercept the document-level mousemove/mouseup handlers used by `useResizable`, causing dock resizing to stall or stick. The previous boolean hid browser panes for all `terminalFitDeferred` drags, so the overlay registration should include the dock drag states or register dock drag as its own global native occluder.
- **Fix:** Introduced a separate dock-drag overlay registration (dockDragOverlayOpen) so vertical/horizontal dock drags globally occlude native browser surfaces while keeping the sidebar drag overlay unchanged.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
