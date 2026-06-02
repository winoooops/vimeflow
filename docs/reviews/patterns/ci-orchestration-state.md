---
id: ci-orchestration-state
category: correctness
created: 2026-06-02
last_updated: 2026-06-02
ref_count: 0
---

# CI Orchestration State

## Summary

Findings in the CI orchestration / QA runner pipeline where state is either lost during refactoring or keyed incorrectly for deduplication and capping. The runner maintains mutable state (thread counts, rerun counters) across asynchronous polls and conditional branches; refactorings that flatten control flow or reuse identity helpers without considering their stability guarantees silently break observability and safety invariants.

## Findings

### 1. Rerun cap ineffective: check identity includes run ID which resets each cycle

- **Source:** github-claude | PR #331 round 1 | 2026-06-02
- **Severity:** HIGH
- **File:** `scripts/qa-runner/lib/rerun-state.js`
- **Finding:** `rerunKey` delegated to `checkIdentity`, which includes the GitHub Actions run ID extracted from `check.link`. Every rerun gets a new run ID, so the cap key changes on every attempt and the counter never accumulates past zero. The advertised safety guarantee (capped at 3 reruns) never trips.
- **Fix:** Added `stableCheckIdentity` to `ci-policy.js` that keys by check name and workflow only (no run ID). Updated `rerun-state.js` to use the stable identity for cap keys while preserving `checkIdentity` for deduplication use cases.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 2. threads: null in outer return is a regression — NEEDS_FIX thread count lost

- **Source:** github-claude | PR #331 round 1 | 2026-06-02
- **Severity:** MEDIUM
- **File:** `scripts/qa-runner/watch.js`
- **Finding:** A refactor extracted the `openThreads() > 0` branch into a peer `else-if`, causing it to fall through to the outer return that hardcoded `threads: null`. The lazy-set `threads` variable held the actual count, but the returned state object discarded it, so `formatDecisionComment` rendered "Unresolved threads: unknown".
- **Fix:** Changed the outer return from `threads: null` to `threads` so all early-exit paths share the cached value (still null for paths that never call `openThreads()`).
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
