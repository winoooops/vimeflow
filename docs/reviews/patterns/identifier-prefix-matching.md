---
id: identifier-prefix-matching
category: correctness
created: 2026-06-12
last_updated: 2026-06-17
ref_count: 2
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

### 3. findIssueForPr: post-fetch guard only checked on `nodes[0]`

- **Source:** github-claude | PR #434 round 2 | 2026-06-12
- **Severity:** MEDIUM
- **File:** `scripts/qa-runner/lib/linear-client.mjs` L96-103
- **Finding:** After round 1 added a post-fetch guard, the helper still
  assigned only `d.issues.nodes[0]` to `candidate` and returned `null` when
  that single node failed the guard. Because the GraphQL query requests
  `first:10`, a false-positive node at position 0 could hide the real
  auto-created issue at `nodes[1+]` and cause `ensureLinearLink` to create
  a duplicate Linear issue.
- **Fix:** Compute `expectedPrLine` once, then use `d.issues.nodes.find(...)`
  to return the first node whose title starts with `PR #${prNumber}:` or
  whose description contains the exact `PR: <url>\n` line, falling back to
  `null` when none match.
- **Commit:** same commit as this entry (see `git blame` / `git log` on
  this line)

### 4. `isNotFoundError`: unbounded `os error 2` substring matches POSIX errno 20–29

- **Source:** github-claude | PR #510 round 1 | 2026-06-17
- **Severity:** MEDIUM
- **File:** `src/features/workspace/utils/editorFileLifecycleStatus.ts` L127-148
- **Finding:** `NOT_FOUND_PATTERNS` included the bare string `'os error 2'`, and `isNotFoundError` matched it with `String.prototype.includes`. Because `'os error 21'.includes('os error 2')` is `true`, any Rust-sidecar POSIX error whose code starts with 2 — such as `EISDIR (os error 21)` or `EINVAL (os error 22)` — was classified as not-found. This set `selectedEditorFileExists(false)` and drove the editor into a false `DELETED`/read-only lifecycle.
- **Fix:** Replaced the loose string with the word-bounded regex `/\bos error 2\b/` and updated the matcher to test strings with `includes` and regexes with `RegExp.prototype.test`, so only errno 2 (ENOENT) triggers the not-found path.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
