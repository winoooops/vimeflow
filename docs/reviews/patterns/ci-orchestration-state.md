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

### 3. gh run rerun throw skips markRerunAttempt → infinite retry loop

- **Source:** github-claude | PR #331 round 4 | 2026-06-02
- **Severity:** HIGH
- **File:** `scripts/qa-runner/watch.js`
- **Finding:** `gh()` calls `execFileSync` which throws on non-zero exit. If GitHub rejects the rerun request, the exception escapes `rerunReviewCheck` before `markRerunAttempt` is reached. The rerun counter is never incremented, so the same runId is re-attempted on every tick and `maxCiReruns` is never reached.
- **Fix:** Swapped the order so `markRerunAttempt` is called before `gh(['run', 'rerun', ...])`. Pessimistic accounting ensures the cap is enforced even when the API call fails.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 4. Rerun attempt count in detail defeats Linear comment deduplication

- **Source:** github-claude | PR #331 round 4 | 2026-06-02
- **Severity:** MEDIUM
- **File:** `scripts/qa-runner/watch.js`
- **Finding:** `rerunReviewCheck` returned a `detail` string containing the attempt counter (`attempt ${status.nextAttempt}/${ctx.maxCiReruns}`). `decisionKey` includes `detail`, so each rerun tick produced a unique key and posted a new Linear comment. A single review check failure generated up to 3 comments instead of 1.
- **Fix:** Removed the attempt counter from `detail` (now stable: `reran ${checkLabel(check)}`). The `rerunAttempt` and `rerunLimit` fields already carry per-attempt metadata to `formatDecisionComment`, which renders them in a separate table row.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 5. Failed review check invisible when absent from reviewRerunChecks

- **Source:** github-claude | PR #331 round 4 | 2026-06-02
- **Severity:** MEDIUM
- **File:** `scripts/qa-runner/lib/ci-policy.js`
- **Finding:** `classifyChecks` produced `deterministicFailures` for non-review checks and `reviewRerunFailures` for failed review checks in `reviewRerunChecks`. A failed review check not in `reviewRerunChecks` fell through both lists, so `computeState` never saw it and the PR could reach `GOOD_SHAPE` despite the failure.
- **Fix:** Added a `reviewNonRerunFailures` list to `classifyChecks` and mapped it to `CI_RED` in `computeState` before the `reviewRerunFailures` branch.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
