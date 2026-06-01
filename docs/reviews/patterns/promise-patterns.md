---
id: promise-patterns
category: code-quality
created: 2026-05-31
last_updated: 2026-05-31
ref_count: 0
---

# Promise Patterns

## Summary

When writing modern JavaScript/TypeScript, prefer top-level `await` with
`try/catch` over `.then()`/`.catch()` chains. The ESLint
`promise/prefer-await-to-then` rule (enabled in this repo) flags `.catch()`
as well as `.then()` and `.finally()`. Besides lint compliance, the
`await` form is usually easier to read, debug, and reason about — especially
when multiple sequential async operations are involved.

## Findings

### 1. Replace final catch before enabling lint

- **Source:** github-codex-connector | PR #322 round 1 | 2026-05-31
- **Severity:** P2 / MEDIUM
- **File:** `scripts/qa-runner/lib/linear-status.js`
- **Finding:** `main().catch(...)` at the top level kept `npm run lint` failing
  for the `scripts/qa-runner/**` files that the commit was bringing under
  ESLint coverage. The `promise/prefer-await-to-then` rule flags `.catch()`
  as well as `.then()`/`.finally()`.
- **Fix:** Replaced `main().catch(...)` with top-level
  `try { await main() } catch (...) { ... }`, matching the pattern already
  used in `watch.js`.
- **Commit:** same commit as this entry (see `git blame` / `git log`)
