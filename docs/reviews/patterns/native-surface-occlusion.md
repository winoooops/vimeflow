---
id: native-surface-occlusion
category: correctness
created: 2026-06-15
last_updated: 2026-08-04
ref_count: 10
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

### 5. Keep edge reveal controls out of diff gutters

- **Source:** github-claude | PR #645 round 1 | 2026-07-02
- **Severity:** HIGH
- **File:** `src/features/diff/components/ChangedFilesList.tsx`
- **Finding:** The collapsed changed-files sidebar rendered an invisible full-height `left: 0` hot-zone above the diff body. In the default unpinned state it occupied the same left gutter used by diff line selection and comment affordances, so clicks and drags near line numbers were intercepted by the sidebar reveal control.
- **Fix:** Replaced the full-height invisible hot-zone with the small visible edge hint button. The hint still supports hover, focus, and click reveal, while the rest of the diff gutter remains available to the underlying diff surface.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 6. Edge reveal activation must not undo preview reveal

- **Source:** github-codex-connector | PR #645 round 1 | 2026-07-02
- **Severity:** P2 / MEDIUM
- **File:** `src/features/diff/components/ChangedFilesList.tsx`
- **Finding:** The collapsed changed-files edge hint reused focus and hover to preview-open the panel, then handled click activation by toggling the now-revealed state. Direct mouse, touch, Space, or Enter activation could therefore flash the panel open and immediately close it.
- **Fix:** Tracked focus/hover preview reveals locally and made the first activation after that preview idempotently reveal the panel instead of toggling it closed. Added a regression test that clicks the hidden edge hint and verifies the toggle callback is not invoked.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 7. Theme browser chrome must not reuse terminal canvas colors

- **Source:** github-codex-connector | PR #647 round 10 | 2026-07-03
- **Severity:** HIGH
- **File:** `src/theme/themes/gruvbox/gruvbox-dark.ts`
- **Finding:** Gruvbox Dark set `ui['browser-bar']` to the same hex value as `terminal.background`. When browser/tab chrome borders a terminal or other native canvas surface, identical pixels can erase the boundary the surface separation work is meant to preserve.
- **Fix:** Moved Gruvbox Dark browser chrome to a distinct bg0-soft value and broadened the background separation test so `browser-bar` is included in the terminal-background collision guard.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 8. Active browser tabs must not reuse terminal canvas colors

- **Source:** github-claude | PR #647 round 12 | 2026-07-03
- **Severity:** HIGH
- **File:** `src/theme/themes/background-separation.test.ts`,
  `src/theme/themes/flexoki.ts`, `src/theme/themes/gruvbox/gruvbox-light.ts`
- **Finding:** The terminal-background collision guard covered the surface
  ladder and `browser-bar` but omitted `browser-tab-active`, leaving Flexoki
  and Gruvbox Light active browser tabs pixel-identical to
  `terminal.background`.
- **Fix:** Added `browser-tab-active` to the shared terminal-background
  collision guard and moved the Flexoki and Gruvbox Light active-tab colors
  to distinct off-ladder values.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 9. Native burner panes assumed primary Ghostty bridge meant secondary support

- **Source:** github-codex-connector | PR #656 round 1 | 2026-07-04
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/hooks/useBurnerTerminals.ts`
- **Finding:** The burner hook rendered native secondary panes whenever the primary macOS Ghostty bridge existed. Legacy helper mode exposes only primary update/data/focus/destroy IPC, so the native secondary attach path failed and killed a newly spawned burner instead of falling back to the xterm popup.
- **Fix:** Added an explicit `canUseNativeGhosttySecondary()` capability check that requires every secondary IPC method, and used it to select native burner rendering. Legacy helper mode now keeps the primary native pane path while burner panes use the xterm popup.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 10. Hidden local Browse button bypassed native overlay suspension

- **Source:** github-codex-connector | PR #660 round 1 | 2026-07-05
- **Severity:** P2 / MEDIUM
- **File:** `src/features/sessions/components/NewSessionDialog/NewSessionDialog.tsx`
- **Finding:** Native-overlay mode kept the local dialog tree mounted and focusable
  while visually hidden, so keyboard users could activate the local Browse button.
  That path opened the regular directory picker without suspending the native
  overlay, letting the overlay remain above the AppKit sheet.
- **Fix:** Added a `browseDisabled` prop to `WorkingDirectoryField` and disabled
  the local Browse button while native-overlay mode is active, leaving the native
  serialized Browse action as the only picker path. Added unit coverage for the
  disabled local path.
- **Commit:** same commit as this entry

### 11. Native burner visibility still occludes browser panes

- **Source:** github-claude | PR #667 round 1 | 2026-07-05
- **Severity:** HIGH
- **File:** `src/features/terminal/hooks/useBurnerTerminals.ts`
- **Finding:** `hasVisibleBurner` excluded native secondary burners by checking
  for `hostPtyId`, but `WorkspaceView` uses that boolean to occlude native
  browser panes under the burner popup. Native burners therefore left browser
  WebContentsViews visible above the open burner surface.
- **Fix:** Restored `hasVisibleBurner` to mean any visible burner, regardless of
  whether it renders via local xterm or native Ghostty secondary.
- **Commit:** same commit as this entry

### 12. Focus guard suppresses native overlay cleanup on owner hide/minimize

- **Source:** github-claude | PR #756 round 1 | 2026-07-29
- **Severity:** HIGH
- **File:** `electron/native-overlay.ts`
- **Finding:** The native overlay owner-deactivation handler used the overlay
  window's `isFocused()` state to ignore parent blur events, but the same
  guarded handler was also registered for parent hide and minimize events. A
  focused layout-creator overlay could therefore remain always-on-top after the
  owner window was hidden or minimized.
- **Fix:** Split the parent blur handler from the force-close path. Parent blur
  still ignores focus transitions into the overlay, while parent hide/minimize
  and overlay-window blur always run cleanup. Added regression coverage for
  hiding and minimizing a focused layout-creator dialog.
- **Commit:** same commit as this entry

### 13. Raise native overlay menus after renderer acknowledgement

- **Source:** local-codex | PR #756 CI fix | 2026-07-30
- **Severity:** HIGH
- **File:** `electron/native-overlay.ts`
- **Finding:** The native overlay menu layer was moved to the top before the
  renderer received and painted the menu payload. On macOS CI, the non-focusable
  menu smoke could render in the overlay webContents but still fail the screen
  paint check above Ghostty's AppKit NSView, while focus-owned dialogs passed
  because their path refocused the overlay after render readiness.
- **Fix:** Move the interactive overlay window to the top again after the
  renderer acknowledges the surface, while preserving the suspended-surface
  guard used during native modal hand-offs. Updated the controller unit test to
  assert the visible menu path raises before and after renderer readiness.
- **Commit:** same commit as this entry

### 14. Focus-owned native dialogs must close on app deactivation

- **Source:** github-codex-connector | PR #756 round 2 | 2026-07-30
- **Severity:** HIGH
- **File:** `electron/native-overlay.ts`
- **Finding:** The layout-creator dialog blur guard suppressed cleanup for both
  owner blur and overlay-window blur based only on the surface type. Switching
  to another application could therefore leave the focusable always-on-top
  native overlay visible above unrelated apps.
- **Fix:** Kept the layout-creator blur exemption only while Electron reports
  the Vimeflow app is still active, so internal parent/overlay focus handoff is
  preserved but true app deactivation closes the surface. Added regression
  coverage for owner blur and overlay-window blur with `app.isActive()` false.
- **Commit:** same commit as this entry

### 15. Tooltip sidecars destabilized native dialog controls

- **Source:** local-codex | PR #761 CI fix | 2026-07-30
- **Severity:** HIGH
- **File:** `src/features/terminal/components/LayoutCreator/LayoutCreatorModal.tsx`
- **Finding:** The Layout Creator's compact track stepper icon buttons kept
  their shared tooltip wrappers inside the focus-owned native overlay dialog.
  The macOS Ghostty smoke clicked those controls in the overlay window and then
  observed the track-count hooks disappear, reading `cols` and `rows` as null.
- **Fix:** Disabled tooltips on the modal's add/remove track stepper buttons.
  The controls keep their accessible labels, but no longer spawn transient
  tooltip overlay sidecars while the native dialog is being exercised.
- **Commit:** same commit as this entry

### 16. Native dialog smoke treated an absent parent-local dialog as occlusion

- **Source:** local-codex | PR #761 CI fix | 2026-07-30
- **Severity:** HIGH
- **File:** `tests/e2e/core/specs/native-overlay-layering.spec.ts`
- **Finding:** The macOS Ghostty smoke waited for the real Layout Creator
  overlay to render, then required a parent-renderer local dialog node to exist
  with native-overlay hiding attributes. When the dialog lived only in the
  overlay webContents, the absent local node failed the occlusion assertion even
  though no parent-local dialog could cover the native surface.
- **Fix:** Kept the smoke strict for visible parent-local dialogs but treated a
  missing parent-local dialog as hidden once the overlay dialog is visible.
- **Commit:** same commit as this entry

### 17. Layout creator handoff left stale native menu state active

- **Source:** github-claude | PR #765 round 1 | 2026-07-31
- **Severity:** HIGH
- **File:** `src/features/terminal/components/LayoutSwitcher/LayoutDisplayMenu.tsx`, `src/features/workspace/WorkspaceView.tsx`
- **Finding:** A merge kept the layout-menu cleanup that removed explicit close
  calls, but dropped the compensating native-overlay retain flag. The packaged
  macOS path could therefore close or refresh the non-focusable menu surface
  while the focus-owned Layout Creator dialog was opening, leaving the overlay
  webContents rendered but the BrowserWindow hidden or non-focusable above the
  Ghostty NSView.
- **Fix:** Kept the Create Custom Layout action in the retained native-overlay
  path with `nativeOverlayCloseOnSelect={false}`, so the menu callback remains
  registered until the focus-owned Layout Creator dialog replaces the menu
  surface above Ghostty.
- **Commit:** same commit as this entry

### 18. Retained native menu handoffs must stay visible until replacement

- **Source:** local-codex | PR #765 CI fix | 2026-07-31
- **Severity:** HIGH
- **File:** `src/features/terminal/components/LayoutSwitcher/LayoutDisplayMenu.tsx`
- **Finding:** The layout creator handoff retained the native menu callback path
  but also marked the selected menu item as `suspendOnSelect`. Electron hid and
  deactivated the overlay window before the owner renderer opened the Layout
  Creator, so the macOS Ghostty smoke could not observe the replacement dialog
  in the overlay window.
- **Fix:** Removed `nativeOverlaySuspendOnSelect` from the Create Custom Layout
  item while keeping `nativeOverlayCloseOnSelect={false}`. The retained menu
  session now stays available for the owner callback and is replaced naturally
  by the focus-owned Layout Creator dialog.
- **Commit:** same commit as this entry

### 19. Retained native menu handoffs may need explicit suspension

- **Source:** local-codex | PR #765 CI fix | 2026-07-31
- **Severity:** HIGH
- **File:** `src/features/terminal/components/LayoutSwitcher/LayoutDisplayMenu.tsx`
- **Finding:** The deterministic macOS Ghostty E2E smoke selected Create Custom
  Layout from the retained native layout menu, then timed out waiting for the
  Layout Creator dialog to render in the overlay webContents. Keeping the menu
  retained but fully active left the old menu surface competing with the
  focus-owned dialog handoff on the packaged native-overlay path.
- **Fix:** Kept `nativeOverlayCloseOnSelect={false}` so the owner callback
  remains registered, and added `nativeOverlaySuspendOnSelect` so Electron
  temporarily hides/deactivates the menu surface while the Layout Creator dialog
  opens and promotes the replacement overlay.
- **Commit:** same commit as this entry

### 20. Retained native menu handoffs must close stale menu state

- **Source:** local-codex | PR #765 CI fix | 2026-07-31
- **Severity:** HIGH
- **File:** `src/features/terminal/components/LayoutSwitcher/LayoutDisplayMenu.tsx`
- **Finding:** Retaining the Create Custom Layout native menu action while
  suspending the menu surface still left the owner-side menu state open during
  the Layout Creator handoff. The stale menu surface could occupy the shared
  overlay window long enough for the packaged macOS Ghostty smoke to time out
  waiting for the dialog payload to render.
- **Fix:** Kept `nativeOverlayCloseOnSelect={false}` so the native action
  callback remains registered, but explicitly closed the layout menu state from
  the Create Custom Layout handler and removed the suspend flag. The old menu
  surface now clears before the focus-owned Layout Creator dialog opens as the
  replacement overlay.
- **Commit:** same commit as this entry

### 21. Native overlay smoke helpers must ignore stale hidden overlay hosts

- **Source:** local-codex | PR #769 CI fix | 2026-08-01
- **Severity:** HIGH
- **File:** `tests/e2e/core/specs/native-overlay-layering.spec.ts`
- **Finding:** The macOS Ghostty native-overlay smoke found Layout Creator DOM
  in any native overlay webContents, then asserted the owning BrowserWindow was
  visible and always on top. A reused or hidden overlay host with stale dialog
  DOM could win that lookup even when the active replacement overlay was the
  one the smoke needed to validate.
- **Fix:** Prefer the Layout Creator overlay host whose BrowserWindow is both
  visible and always-on-top, keeping a fallback only for diagnostics while the
  wait loop is still converging.
- **Commit:** same commit as this entry

### 22. Focus-owned native dialogs must only suppress transient handoff blur

- **Source:** github-codex-connector | PR #778 round 1 | 2026-08-04
- **Severity:** HIGH
- **File:** `electron/native-overlay.ts`
- **Finding:** Layout Creator and notification center dialogs skipped every
  owner or overlay blur after becoming focus-owned. Switching to another app
  could leave the always-on-top native overlay visible instead of dismissing it.
- **Fix:** Restored the bounded handoff guard so focus-owned dialogs only
  ignore blur while their `internalFocusHandoffSurfaceIds` grace window is
  active, then close normally on later owner or overlay blur.
- **Commit:** same commit as this entry
