# PR5 — Verification, Polish, And Observability

**Status:** draft
**Scope:** final validation, metrics, and docs
**Depends on:** PR4

## Goal

Close VIM-127 with focused regression coverage, lightweight observability, and final documentation that reflects what was actually implemented.

## Implementation Plan

- Add or extend tests around the complete pane-switch workflow.
- Capture lightweight development diagnostics for snapshot hit/miss, refresh duration, stale-result drops, and prefetch count.
- Update the VIM-127 docs with final behavior, limitations, and follow-up ideas.
- Run a manual verification pass against the original recording scenario: long status history, multiple panes, and quick switching.
- Remove any temporary debugging affordances introduced during implementation.

## Tests

- End-to-end or integration-level coverage for switching panes with long histories.
- Unit coverage for scroll anchor restore, stale response drops, and bounded prefetch.
- Regression coverage for retained content while refresh is pending.
- Format, lint, type-check, and relevant Vitest suites.

## Acceptance Criteria

- The final branch passes the agreed checks or clearly isolates unrelated pre-existing failures.
- The final docs match the shipped behavior rather than the first-draft plan.
- Claude Code reviewer returns `overall_correctness: "patch is correct"`.
- Linear VIM-127 links to the final PR sequence and supporting document.

## PR Boundary Notes

At the start of PR5, treat this document as a checklist to reconcile the implementation with the original plan. If earlier PRs intentionally changed direction, update the docs to explain the final architecture.
