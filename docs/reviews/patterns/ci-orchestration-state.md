---
id: ci-orchestration-state
category: correctness
created: 2026-06-02
last_updated: 2026-06-04
ref_count: 5
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

### 14. Post-adjudication head check outside try/catch discards valid result on transient gh failure

- **Source:** github-claude | PR #361 round 2 | 2026-06-06
- **Severity:** MEDIUM
- **File:** `scripts/qa-runner/watch.js`
- **Finding:** `currentPrHeadSha(pr.number)` is called after the try/catch that guards `adjudicateReviews`. A transient `gh pr view` failure propagates unhandled, discarding the valid adjudication result and causing the tick to exit 2 (retry) instead of gracefully falling to WAITING. Before this PR, `prDiff(pr.number)` was evaluated inline inside the `adjudicateReviews()` argument list, so a `gh pr diff` failure was caught by the same try/catch and gracefully set state to WAITING.
- **Fix:** Wrapped the head-check in a try/catch that sets `[state, detail] = ['WAITING', 'head check unavailable (transient)']` on failure, mirroring the adjudication catch above. The downstream decision branches already gate on `state !== 'WAITING'`, so the catch naturally prevents NEEDS_FIX/REVOKE dispatch when the freshness check is unavailable.
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

### 8. Thread check before !claudeReady guard — premature NEEDS_FIX dispatch

- **Source:** github-claude | PR #331 round 6 | 2026-06-02
- **Severity:** HIGH
- **File:** `scripts/qa-runner/watch.js`
- **Finding:** The pre-PR `computeState` evaluated `!claudeReady || ci === 'pending'` before fetching unresolved threads, so a pending Claude check always short-circuited to WAITING. The refactoring inverted the order: `openThreads() > 0` was checked before `!claudeReady || ciResult.ci === 'pending'`. If a PR carried leftover threads while Claude's review was still running, `computeState` returned `NEEDS_FIX` and dispatched a fixer — whereas the old code returned WAITING and let Claude finish first.
- **Fix:** Swapped the `openThreads() > 0` branch with the `!claudeReady || ciResult.ci === 'pending'` branch so CI/Claude pending is checked first, restoring the original priority.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 9. REVIEW_RERUN_CHECKS aliases REVIEW_CHECKS — reviewNonRerunFailures always empty

- **Source:** github-claude | PR #331 round 6 | 2026-06-02
- **Severity:** MEDIUM
- **File:** `scripts/qa-runner/lib/ci-policy.js`
- **Finding:** `REVIEW_RERUN_CHECKS = REVIEW_CHECKS` was a reference alias — both names pointed to the same `Set`. Since every item in `review` satisfied `reviewRerunChecks.has(check.name)`, the `!reviewRerunChecks.has(...)` filter was always false: `reviewNonRerunFailures` was structurally always empty and the `else if (ciResult.reviewNonRerunFailures.length)` CI_RED branch in `computeState` was permanently dead code.
- **Fix:** Changed `REVIEW_RERUN_CHECKS` from a reference alias to a new `Set(['Claude Code Review', 'Codex Code Review'])`, activating the non-rerun failure path.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 6. markRerunAttempt before gh run rerun silently exhausts budget

- **Source:** github-claude | PR #331 round 5 | 2026-06-02
- **Severity:** MEDIUM
- **File:** `scripts/qa-runner/watch.js`
- **Finding:** `rerunReviewCheck` called `markRerunAttempt` before `gh(['run', 'rerun', runId, '--failed'])`. Because `gh()` uses `execFileSync` and throws on non-zero exit, a transient API failure (rate limit, deleted run) incremented the counter without a real rerun. Three consecutive failures exhausted the `maxCiReruns=3` budget and locked the PR in `CI_RED` permanently.
- **Fix:** Swapped the order so `gh(['run', 'rerun', ...])` runs first and `markRerunAttempt` is only called on success. A failed `gh` call propagates as a transient error (exit 2) without consuming budget. This reverses the round-4 fix for finding #3, which had moved `markRerunAttempt` before `gh` to prevent infinite loops — the round-5 analysis concluded that pessimistic accounting is worse than transient retries because it permanently disables rerun for a run ID that might succeed later.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 7. ciClassification 'rerun exhausted' even when check has no run ID

- **Source:** github-claude | PR #331 round 5 | 2026-06-02
- **Severity:** LOW
- **File:** `scripts/qa-runner/watch.js`
- **Finding:** `computeState` derived `ciClassification` from `state === 'CI_RED' ? 'rerun exhausted' : 'transient review failure'`. But `rerunReviewCheck` returns `CI_RED` for two reasons: (a) the rerun budget is exhausted, and (b) the selected check has no Actions run ID (`!runId`). Case (b) was falsely labeled "rerun exhausted", confusing operators who saw "0/3" attempts alongside that label.
- **Fix:** Added `ciClassification` fields to each `rerunReviewCheck` return object (`'no run id'` vs `'rerun exhausted'`), and changed `computeState` to use `rerun.ciClassification` with a fallback to `'transient review failure'`.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

- **Source:** github-claude | PR #331 round 4 | 2026-06-02
- **Severity:** MEDIUM
- **File:** `scripts/qa-runner/lib/ci-policy.js`
- **Finding:** `classifyChecks` produced `deterministicFailures` for non-review checks and `reviewRerunFailures` for failed review checks in `reviewRerunChecks`. A failed review check not in `reviewRerunChecks` fell through both lists, so `computeState` never saw it and the PR could reach `GOOD_SHAPE` despite the failure.
- **Fix:** Added a `reviewNonRerunFailures` list to `classifyChecks` and mapped it to `CI_RED` in `computeState` before the `reviewRerunFailures` branch.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 10. Legacy decision store entries never backfill commentId

- **Source:** github-codex-connector | PR #332 round 1 | 2026-06-02
- **Severity:** P2 / MEDIUM
- **File:** `scripts/qa-runner/lib/decision-comment.js`
- **Finding:** When a PR had a legacy decision store (`{ "<pr>": "<key>" }`), `decisionEntry` converted it to `{ key }` and `shouldPostDecision` treated an unchanged decision as already posted. No `commentId`, `state`, or `headSha` was ever captured, so threading paths kept falling back to top-level Linear comments.
- **Fix:** Updated `shouldPostDecision` to return `true` when the entry lacks a `commentId` property, forcing a one-time repost that backfills the metadata.
- **Commit:** same commit as this entry

### 11. Null commentId poisons store and stale IDs survive across reposts

- **Source:** github-codex-connector | PR #332 round 2 | 2026-06-02
- **Severity:** P2 / MEDIUM
- **File:** `scripts/qa-runner/lib/decision-comment.js`
- **Finding:** Round-1 changed `shouldPostDecision` to use `!('commentId' in entry)`, which correctly triggered reposts for legacy string entries missing the property. But it did not handle two related cases: (a) an entry whose `commentId` was explicitly `null` (e.g., Linear API returned success with no comment ID) was treated as already-posted because `'commentId' in entry` is `true`; and (b) `markDecisionPosted` conditionally spread `...(commentId != null && { commentId })`, so when a new post returned `null` after an earlier post had returned a real ID, the old ID survived in the store.
- **Fix:** Changed `shouldPostDecision` to `!entry.commentId` so any falsy/missing/null `commentId` triggers a repost. Changed `markDecisionPosted` to explicitly write `commentId: null` when the caller passes `commentId: null`, ensuring stale IDs are cleared rather than silently retained.
- **Commit:** same commit as this entry

### 12. `error` events mapped to Linear comments for all categories create unbounded spam on transient failures

- **Source:** github-codex-connector | PR #334 round 1 | 2026-06-03
- **Severity:** P2 / MEDIUM
- **File:** `scripts/qa-runner/lib/events.js`
- **Finding:** `LINEAR_COMMENT` mapped every `type: 'error'` event to `formatCycleExitComment`, including `category: 'fixer_stall'` non-terminal exits. Each incremental fixer stall below `maxNoops` posted a new Linear "RETRY" comment, and transient errors (gh/GraphQL blips, exit 2) were unbounded in frequency. The pre-PR design intentionally kept types absent from `LINEAR_COMMENT` as pool-only to avoid spam.
- **Fix:** Changed `LINEAR_COMMENT.error` to a gated formatter: `e.category === 'transient' ? formatCycleExitComment(e) : null`. Non-terminal fixer stalls are now pool-only; terminal stalls still surface via the `paused` type. Updated the test to assert `null` for fixer-stall errors.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 13. SSM waiter ceiling silently shorter than configured worker timeout, causing false failures

- **Source:** github-claude | PR #349 round 1 | 2026-06-04
- **Severity:** HIGH
- **File:** `scripts/qa-runner/lib/cloud-dispatch.js`
- **Finding:** `aws ssm wait command-executed` has a built-in client-side max-attempts ceiling far below the documented `QA_WORKER_TIMEOUT_SECONDS=5400` (90 min). Once the waiter exceeds its ceiling, it exits non-zero while the SSM invocation is still `InProgress`. The dispatcher then falls back to the waiter exit code, returning a false failure to the control daemon even though the worker later succeeds. This blocks merge automation and creates misleading failure records.
- **Fix:** Replaced the one-shot waiter with a bounded polling loop that calls `get-command-invocation` on a 15-second sleep interval, stopping on any terminal SSM status (`Success`, `Failed`, `TimedOut`, `Cancelled`, etc.) or when the explicitly configured `timeoutSeconds` elapses. The worker's actual `ResponseCode` is returned when available.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
