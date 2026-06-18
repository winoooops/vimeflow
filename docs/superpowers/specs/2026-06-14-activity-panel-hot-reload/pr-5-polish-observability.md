# PR5 — Verification, Polish, And Observability

**Status:** implementation
**Scope:** body-level retained loading, final validation, and docs
**Depends on:** PR4

## Goal

Close VIM-127 by addressing the remaining recording issue after PR4: scroll position is stable, but pane switches can still visually jump when the right panel body swaps from a rich pane to a cold/empty target before refresh completes.

PR5 makes the body itself participate in the refresh phase. Header refresh remains the primary affordance, but the scroll/body region now retains the last stable rendered snapshot during a cold target refresh, exposes a subtle body-level sweep that is visible even when the header is cropped out of a recording, and uses fixed skeleton footprints only for genuine first-load cases with no retained content.

## Implementation Plan

- Add a local `fresh | fetching | loading` body phase inside `AgentStatusPanel`.
- Retain a bounded set of body snapshots keyed by `snapshotKey`; each snapshot carries status, cwd, cache history, and parent git status together so the below-header surface does not partially switch.
- During refresh, render the target pane's retained body if available; otherwise retain the previously rendered content body while the target is still cold/empty.
- Show fixed skeleton blocks only when refresh is active and there is no retained body content.
- Add a body-level refresh sweep that overlays the scroll region without changing layout height.
- Hold the hot-loading refresh flag for a short minimum duration so the phase is perceptible rather than a one-frame flash.
- Add focused regression tests for retained body rendering, release after refresh, cold-load skeletons, and minimum refresh visibility.
- Update the VIM-127 docs with final behavior, limitations, and follow-up ideas.

## Tests

- Component coverage for switching from a rich pane to a cold pane while refresh is pending.
- Component coverage that retained content releases after refresh settles.
- Component coverage for cold-load skeletons when no retained content exists.
- Hook coverage for minimum visible refresh duration.
- Existing coverage for scroll anchor restore, stale response drops, and bounded prefetch.
- Format, lint, type-check, and relevant Vitest suites.

## Acceptance Criteria

- Switching from a long-history pane to a cold/empty pane does not immediately flash the empty body during refresh.
- The body refresh affordance is visible inside the scroll/body region and does not alter layout height.
- Cold loading is distinct from warm fetching: skeletons appear only when there is no retained content.
- The hot-loading phase remains visible for a short minimum duration.
- The final branch passes the agreed checks or clearly isolates unrelated pre-existing failures.
- The final docs match the shipped behavior rather than the first-draft plan.
- Claude Code reviewer returns `overall_correctness: "patch is correct"`.
- Linear VIM-127 links to the final PR sequence and supporting document.

## PR Boundary Notes

At the start of PR5, treat this document as a checklist to reconcile the implementation with the original plan. If earlier PRs intentionally changed direction, update the docs to explain the final architecture.
