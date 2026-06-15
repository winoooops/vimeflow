---
id: modulo-correctness
category: correctness
created: 2026-06-15
last_updated: 2026-06-15
ref_count: 0
---

# Modulo Correctness

## Summary

JavaScript's `%` operator is a remainder operator (the result carries the sign of the dividend), not a true mathematical modulo. Expressions such as `(index + delta + length) % length` only stay non-negative when `delta >= -length`; for larger negative deltas the result can be negative and indexing with it returns `undefined`. TypeScript's unchecked indexed access makes this a silent runtime failure rather than a compile-time error. Normalize the result with the double-modulo form `((index + delta) % length + length) % length`, or use a dedicated wrap helper, and add regression tests for over-wrap deltas.

## Findings

### 1. cycleSession: modulo returns negative index for large negative deltas

- **Source:** github-claude | PR #460 round 10 | 2026-06-15
- **Severity:** MEDIUM
- **File:** `src/features/sessions/utils/cycleSession.ts` L22-27
- **Finding:** `(index + delta + items.length) % items.length` can return a negative number when `delta < -(index + items.length)`. Because `items[number]` is typed as `T` without `noUncheckedIndexedAccess`, callers receive `undefined` where they expect `T | null`. All current callers used `±1`, which is safe, but the `delta: number` signature made the bug a latent footgun for future callers.
- **Fix:** Replaced the expression with `(((index + delta) % items.length) + items.length) % items.length`, which yields a non-negative index for any integer `delta`.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
