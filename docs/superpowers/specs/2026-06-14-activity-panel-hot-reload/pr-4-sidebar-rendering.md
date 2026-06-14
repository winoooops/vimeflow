# PR4 — Sidebar Rendering Stability

**Status:** draft
**Scope:** activity/status sidebar UI rendering
**Depends on:** PR3

## Goal

Make the sidebar visually stable during pane switches and live status updates.

## Implementation Plan

- Render retained snapshot content while a refresh is in flight.
- Show loading or stale state as a subtle header affordance.
- Avoid full-list remounts by using stable keys and memoized row rendering where useful.
- Keep layout dimensions stable for header, toolbar, empty state, skeleton rows, and timeline rows.
- Evaluate virtualization only if real list sizes or profiling show row count as the dominant cost.
- Restore the per-pane scroll anchor after the new pane content is mounted.

## Visual Guidance

- Follow the Obsidian Lens design language: dark, tonal depth, glassmorphism, and no visible border-heavy treatment.
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
