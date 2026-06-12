---
id: identifier-prefix-matching
category: correctness
created: 2026-06-12
last_updated: 2026-06-12
ref_count: 0
---

# Identifier Prefix Matching

## Summary

When matching records by a numeric identifier through a substring or
`contains` search, a shorter number can falsely match a longer one that
starts with the same digits (e.g. `31` matching `317`). Always include an
unambiguous delimiter in the search term — such as the colon after a title
prefix or a newline after a URL — and add a post-fetch guard that verifies
the returned record really refers to the intended entity before reusing it.

## Findings

### 1. findIssueForPr: 'contains' filter falsely matches numerically-related PR issues

- **Source:** github-claude | PR #434 round 1 | 2026-06-12
- **Severity:** HIGH
- **File:** `scripts/qa-runner/lib/linear-client.mjs` L90-97
- **Finding:** `findIssueForPr` searched Linear issues with an `or` filter
  using `description:{contains:prUrl}` and `title:{contains:titlePrefix}`.
  Because Linear's `contains` is a substring match, `/pull/31` matches
  `/pull/317` and `PR #31` matches `PR #317: ...`. `nodes[0]` then returned
  the wrong issue, causing a lower-numbered PR to be patched with a higher-
  numbered PR's Linear identifier.
- **Fix:** Changed the URL search term to `${prUrl}\n` and the title prefix
  to `PR #${prNumber}:`, then added a post-fetch guard that requires either
  an exact title prefix or the expected `PR: <url>\n` line in the issue
  description before returning a candidate.
- **Commit:** same commit as this entry (see `git blame` / `git log` on
  this line)

### 2. Avoid matching PR titles by numeric prefix

- **Source:** github-codex-connector | PR #434 round 1 | 2026-06-12
- **Severity:** P2 / MEDIUM
- **File:** `scripts/qa-runner/lib/linear-client.mjs` L94
- **Finding:** When no exact URL match existed, the title-prefix query
  `title contains "PR #43"` could return an automatically-created issue
  for PR #433 because `PR #433: ...` contains `PR #43`. Accepting
  `nodes[0]` linked the wrong PR to the existing Linear issue.
- **Fix:** Same as finding 1: search with the created-title delimiter
  `PR #${prNumber}:` and verify the returned issue before reuse.
- **Commit:** same commit as this entry (see `git blame` / `git log` on
  this line)
