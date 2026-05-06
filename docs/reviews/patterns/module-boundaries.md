---
id: module-boundaries
category: code-quality
created: 2026-04-30
last_updated: 2026-05-06
ref_count: 0
---

# Module Boundaries

## Summary

Reusable utilities (formatters, helpers, pure functions) belong in dedicated
`utils/` modules — not in component files that happen to export them. When a
component file becomes a de-facto host for a utility, refactoring that
component (rename, split, extract sub-component) silently breaks every
external importer with no type-system warning until runtime.

The fix is preventive: when a second component needs a utility currently
defined in a sibling component file, **promote** the utility to a sibling
`utils/<name>.ts` and update the original component to import from there.
Don't widen the coupling by adding a second importer.

## Findings

### 1. `formatTokens` imported across components from a sibling component file

- **Source:** github-claude | PR #115 round 1 | 2026-04-30
- **Severity:** MEDIUM
- **File:** `src/features/agent-status/components/TokenCache.tsx`
- **Finding:** `TokenCache.tsx:9` imported `formatTokens` from `./BudgetMetrics`, a sibling presentational component file that happens to export the helper at line 11. This coupled two unrelated components at the module level — refactoring `BudgetMetrics.tsx` (splitting, renaming, extracting `MetricCell`) would have silently broken `TokenCache` with no compiler warning. The PR had already created `src/features/agent-status/utils/cacheRate.ts` for the cache-specific math; the natural home for a generic display formatter was a sibling `utils/format.ts`.
- **Fix:** Created `src/features/agent-status/utils/format.ts` with a single `formatTokens` export. Updated `BudgetMetrics.tsx`, `BudgetMetrics.test.tsx`, and `TokenCache.tsx` to import from the new module. Left `ContextBucket.tsx`'s own M-aware `formatTokens` (different implementation) alone — consolidating those two formatters would change ContextBucket's display behavior and is out of scope for the review-fix cycle.
- **Commit:** `570d225 fix(agent-status): address Claude review on TokenCache (PR #115 round 1)`

---

### 2. Dual-form module exports (named + default) drift from sibling components' convention

- **Source:** github-claude | PR #173 round 1 | 2026-05-06
- **Severity:** LOW
- **File:** `src/features/workspace/components/StatusBar.tsx`
- **Finding:** New `StatusBar.tsx` shipped with both `export const StatusBar` and `export default StatusBar` — the latter was dead code (the sole consumer `WorkspaceView.tsx` uses the named import) and inconsistent with sibling components in the same directory: `IconRail` and `Sidebar` are named-only, while `BottomDrawer` is default-only. Adding both forms invites future contributors to follow either convention, multiplying the inconsistency over time. Some bundler tree-shaking paths also treat re-exported defaults differently, so the dual form has a small additional cost. Note (1-line stretch): this fits the broader "module boundaries" theme — what a file exports is part of its module shape, and shape inconsistency across siblings is a coupling smell similar to #1's cross-component utility import.
- **Fix:** Dropped `export default StatusBar`. Pattern is now: workspace-level chrome (`IconRail`, `Sidebar`, `StatusBar`) ships named-only; legacy components like `BottomDrawer` keep their default export until a future migration normalises. Code-review heuristic: when a new file lands in a directory, scan sibling files for export shape and match — not "support both forms defensively."
- **Commit:** _(see git log for the cycle-1 fix commit on PR #173)_
