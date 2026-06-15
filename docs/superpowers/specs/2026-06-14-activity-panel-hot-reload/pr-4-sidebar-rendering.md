# PR4 — Sidebar Rendering Stability

**Status:** implemented
**Scope:** activity/status sidebar UI rendering
**Depends on:** PR3

## Goal

Make the sidebar visually stable during pane switches and live status updates.

## Implementation Plan

- Render retained snapshot content while a refresh is in flight; fetching is expressed only in the header.
- Show refresh state as a compact header affordance: fixed header height, sync glyph, glyph breathing, and a comet sweep inside the existing bottom hairline.
- Avoid full-list remounts by keeping existing stable activity row keys and preserving the mounted panel across pane switches.
- Keep layout dimensions stable for the header, empty state, and timeline rows. Cold-load skeletons remain deferred until the data flow has an explicit no-snapshot signal.
- Do not introduce virtualization in PR4; the current feed already caps initial rows and no row-count bottleneck has been measured.
- Restore the per-pane scroll anchor only when the pane key changes, then preserve the visual anchor when new activity prepends above a scrolled history viewport.

## Implementation Notes

- `useAgentStatusHotLoading` now returns a boolean refresh phase while retaining its existing bounded prefetch behavior from PR3.
- `WorkspaceView` forwards that phase to `AgentStatusPanel`; no extra backend watcher or subscription path is added.
- `AgentStatusPanelHeader` keeps a fixed 44px footprint and renders the refresh affordance without adding banners, overlays, or body opacity changes.
- `AgentStatusPanel` no longer reapplies saved scroll anchors on every feed/git/status update. It restores on `snapshotKey` changes and adjusts scroll by `scrollHeight` deltas when new rows prepend while the user is reading older history.
- `src/index.css` owns the refresh comet and glyph-breathing keyframes, with reduced-motion disabling both animations.

## Visual Guidance

- Follow The Lens design language: dark, tonal depth, glassmorphism, and no visible border-heavy treatment.
- Do not use a large stale-data banner for normal refresh.
- Do not add explanatory in-app text about the feature.
- Keep the status affordance compact and scannable.

## Tests

- Sidebar keeps retained content during refresh.
- Switching panes restores the correct scroll position.
- Header refresh state does not resize the content area.
- New status rows append or update without remounting unrelated rows.
- Empty/loading/error states remain visually stable.

## Acceptance Criteria

- The recording scenario no longer shows aggressive jumping or flashing.
- The panel reads as calm during both fast pane switching and live updates.
- Rendering changes stay scoped to the status/activity sidebar.

## PR Boundary Notes

At the start of PR4, inspect the actual PR2/PR3 data flow before choosing between memoization and virtualization. Prefer the smallest rendering change that fixes the measured instability.
