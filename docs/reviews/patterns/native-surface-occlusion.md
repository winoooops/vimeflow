---
id: native-surface-occlusion
category: correctness
created: 2026-06-15
last_updated: 2026-06-30
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

### 2. useOverlayRegistration: equality guard vacuously true for live-ref descriptors

- **Source:** github-claude | PR #474 round 1 | 2026-06-15
- **Severity:** LOW
- **File:** `src/features/workspace/overlays/useOverlayRegistration.ts`
- **Finding:** `areOverlayDescriptorsEqual` compares `left.isOpen === right.isOpen` and `left.nativeOcclusion === right.nativeOcclusion`. When `left` is a previously-registered live-ref descriptor, both sides read from the same `latestDescriptorRef.current` at access time, so the comparisons are always equal regardless of prior values.
- **Fix:** Added a comment on `areOverlayDescriptorsEqual` noting that live-ref descriptors make the `isOpen`/`nativeOcclusion` comparisons vacuously true and that the guard still catches id/plane/getRect changes.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 3. Notify native surfaces when overlays toggle

- **Source:** github-codex-connector | PR #474 round 1 | 2026-06-15
- **Severity:** P2 / MEDIUM
- **File:** `src/features/workspace/overlays/useOverlayRegistration.ts`
- **Finding:** When a consumer owns `isOpen` locally inside the overlay component, toggling it only updates `latestDescriptorRef`; the registration effect does not re-run and the provider map/context identity does not change, so already-mounted `useNativeSurface` consumers in sibling panes are not re-rendered. A newly opened global/intersecting overlay can leave an Electron `WebContentsView` visible above it until some unrelated workspace render happens.
- **Fix:** Added `isOpen` to the `useOverlayRegistration` effect dependency array so toggles re-register the descriptor, invalidate provider state, and re-render native-surface subscribers. The descriptor getter continues to read the live ref for the current value.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 4. Serialize checkbox rows for native overlay menus

- **Source:** github-codex-connector | PR #635 round 1 | 2026-06-30
- **Severity:** HIGH
- **File:** `src/components/Menu.tsx`
- **Finding:** `LayoutDisplayMenu` opted into NativeOverlay but always rendered `Menu.Checkbox` rows, and the menu serializer treated checkboxes as unsupported content. The layout-display trigger therefore fell back to the local DOM menu, so the native overlay smoke path and its `menuitemcheckbox` E2E expectation could not exercise the BrowserWindow overlay above Ghostty.
- **Fix:** Added checkbox serialization to the shared Menu native payload path and introduced retained native action handlers so checkbox toggles stay open and resync state while normal menu actions keep the existing at-most-once close behavior.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
