---
id: responsive-control-affordances
category: a11y
created: 2026-07-20
last_updated: 2026-07-22
ref_count: 2
---

# Responsive Control Affordances

## Summary

Responsive UI compaction must preserve the control's primary action, not only
its visual identity. Replacing a full control with a passive readout can be
acceptable only when another visible pointer-accessible path owns the same
state transition. Compact surfaces also need to reserve space for neighboring
controls; centered overlays and status islands should reduce content before
they intercept pointer events over right- or left-aligned controls.

## Findings

### 1. Compact layout readout removed pointer layout switching

- **Source:** github-claude | PR #714 round 1 | 2026-07-20
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/LayoutSwitcher/LayoutSwitcher.tsx`
- **Finding:** The compact layout pillar replaced clickable built-in layout
  buttons with a passive current-layout readout, while the retained display
  menu only toggled which buttons would appear after the pillar widened again.
  Pointer users had no compact-mode path to switch built-in layouts.
- **Fix:** Added a compact selection mode to the docked layout display menu so
  built-in rows select layouts through `onPickLayout` in compact mode.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 2. Compact built-in menu rows were visibility-only

- **Source:** github-codex-connector | PR #714 round 1 | 2026-07-20
- **Severity:** P1 / HIGH
- **File:** `src/features/terminal/components/LayoutSwitcher/LayoutSwitcher.tsx`
- **Finding:** Below the 700px main-column threshold, all built-in layout
  buttons disappeared and `LayoutDisplayMenu` wired `onPickLayout` only to
  custom layout rows. Built-in rows could not switch layouts, so compact mode
  lost the main picker action.
- **Fix:** Let built-in layout menu items receive `onPickLayout` and
  `compactSelectionMode`, pick enabled built-in layouts, allow the locked
  `Single` row to be selected when inactive, and keep blocked layouts disabled.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 3. Centered session island overlapped compact right-side controls

- **Source:** github-codex-connector | PR #714 round 1 | 2026-07-20
- **Severity:** P1 / HIGH
- **File:** `src/features/sessions/components/SessionIsland.tsx`
- **Finding:** With both side panels expanded, a narrow main column could leave
  only about 360px for top chrome. A ten-item active-label session island could
  span almost the whole column and intercept pointer events over the compact
  layout configuration trigger.
- **Fix:** Added a `maxVisibleSessions` prop and capped the island to a
  five-session batch while the layout pillar is compact, reducing the centered
  island footprint for the narrow main-column case.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 4. Native overlay E2E asserted a state path hidden by compaction

- **Source:** local-codex | PR #714 round 1 | 2026-07-20
- **Severity:** HIGH
- **File:** `tests/e2e/core/specs/native-overlay-layering.spec.ts`
- **Finding:** The macOS Ghostty smoke test clicked a NativeOverlay layout
  checkbox and waited for React to show or hide a layout button. Compact mode
  removed that button surface, so the checkbox action no longer produced the
  observable state transition the test depended on.
- **Fix:** Reused the same compact menu change as the product fix: built-in
  checkbox rows now call the layout picker in compact mode, restoring a
  React-observable selection path for the native overlay action.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 5. Compact agent chrome dropped budget telemetry

- **Source:** github-codex-connector | PR #728 round 1 | 2026-07-22
- **Severity:** P2 / MEDIUM
- **File:** `src/components/StatusBar.tsx`
- **Finding:** Removing the status-bar context and cache segments also removed
  the only visible context-window and cache-hit readings on compact viewports,
  where the right-side status panel and rail are not mounted.
- **Fix:** Added compact context and cache pills to `AgentStatusCard`, wired
  the existing `WorkspaceView` agent-status readings into the card, and covered
  both the card rendering and lifted-prop wiring with regression tests.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
