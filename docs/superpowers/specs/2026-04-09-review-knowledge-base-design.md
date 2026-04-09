# Review Knowledge Base — Design Spec

**Date**: 2026-04-09
**Status**: Draft

## Problem

Code reviews (local Codex and GitHub Codex) produce findings and fixes, but this
knowledge is ephemeral. Local reviews overwrite `.codex-reviews/latest.md` each run.
GitHub reviews live scattered across PR comments. The connection between "finding →
fix applied" is lost, and agents implementing new features cannot learn from past
review cycles.

## Solution

A persistent, repo-level knowledge base that collects review findings grouped by
recurring pattern. Each pattern file accumulates individual findings with their fixes
and git commit links. Agents consult it during implementation as an optional reference
— a project-specific "team wisdom" collection built from real reviews.

## Decisions

| Decision         | Choice                                         | Rationale                                                      |
| ---------------- | ---------------------------------------------- | -------------------------------------------------------------- |
| Primary consumer | Agents during implementation                   | Improve code quality by learning from past review findings     |
| Granularity      | Pattern-level grouping, finding-level entries  | Patterns emerge as top-level, individual findings are evidence |
| Location         | In the repo (`docs/reviews/`)                  | Shared across sessions, accessible to both Claude and Codex    |
| Discovery        | Passive — referenced in CLAUDE.md/AGENTS.md    | Optional, not mandatory; "good to have" team culture           |
| Usage tracking   | `ref_count` in frontmatter (honor-system bump) | Lightweight signal for whether agents actually consult it      |
| Writing          | Automatic after each review-fix cycle          | Agent records finding + fix at the point it has all the data   |
| Format           | One file per pattern + index                   | Scales well, agents read only what's relevant                  |
| Git traceability | Commit one-liner per finding                   | `git log --oneline -1` captured at ingestion time              |

## Directory Structure

```
docs/reviews/
├── CLAUDE.md                   # Pattern index table with ref counters
└── patterns/
    ├── error-boundaries.md
    ├── input-validation.md
    ├── async-error-handling.md
    └── ...
```

`CLAUDE.md` is the index file — named so it's auto-loaded when agents enter the
`docs/reviews/` directory context.

## Pattern File Format

```markdown
---
id: error-boundaries
category: react-patterns
created: 2026-04-09
last_updated: 2026-04-09
ref_count: 0
---

# Error Boundaries

## Summary

React components doing async work need error boundaries to prevent
white-screen crashes.

## Findings

### 1. Missing ErrorBoundary in FileTree async loader

- **Source:** local-codex | PR #34 | 2026-04-08
- **Severity:** HIGH
- **File:** `src/features/files/components/FileTree.tsx`
- **Finding:** Async file listing can throw but no error boundary catches it
- **Fix:** Wrapped FileTree in ErrorBoundary with fallback UI
- **Commit:** `a1b2c3d feat: add error boundary to FileTree component`
```

Each finding entry captures:

- Source (local-codex / github-codex)
- PR number (if applicable)
- Date
- Severity (CRITICAL / HIGH / MEDIUM / LOW)
- File path
- Finding description (one sentence)
- Fix description (one sentence)
- Commit one-liner (hash + message from `git log --oneline -1`)

## Index File Format (CLAUDE.md)

```markdown
# Review Knowledge Base

Patterns learned from code reviews. Agents: consult relevant patterns
before implementing. Bump `ref_count` in frontmatter when you use one.

| Pattern                                          | Category       | Findings | Refs | Last Updated |
| ------------------------------------------------ | -------------- | -------- | ---- | ------------ |
| [Error Boundaries](patterns/error-boundaries.md) | react-patterns | 2        | 0    | 2026-04-09   |
| [Input Validation](patterns/input-validation.md) | security       | 1        | 0    | 2026-04-09   |
```

## Ingestion Flow

After a review-fix cycle completes, the agent that performed the fix records it.

**Trigger points:**

1. Local review — after `npm run review` + fix cycle, before the agent stops
2. GitHub review — after fetching PR comment + fix cycle, before pushing
3. Harness inner loop — after each Coder+Reviewer iteration that produces fixes

**Steps:**

```
1. Agent has: finding text + severity + file path + fix description
2. Agent runs: git log --oneline -1 → captures commit hash + message
3. Agent reads: docs/reviews/CLAUDE.md → scans for matching pattern
4. Decision:
   a) Match found → append new finding entry to existing pattern file
   b) No match → create new pattern file + add row to CLAUDE.md index
5. Agent updates: last_updated in frontmatter, finding count in CLAUDE.md
```

**Classification heuristic:** The agent matches by reading the pattern's Summary
section and the finding description. A finding that could fit two patterns goes into
the more specific one. Patterns can be split or merged manually over time.

## Discovery & Reference Protocol

**Pointers added to:**

- Root `CLAUDE.md` index table → `docs/reviews/CLAUDE.md`
- `docs/CLAUDE.md` → new `reviews/` subsection
- `AGENTS.md` → reference to `docs/reviews/CLAUDE.md`

**Ref counting protocol:**

1. Agent reads a pattern file during implementation
2. Agent bumps `ref_count` in that file's frontmatter (+1)
3. Agent updates the Refs column in `docs/reviews/CLAUDE.md`

Honor-system — agents do it because the instructions say to. If ref counts stay at 0,
the knowledge base isn't being consulted and you can adjust the approach.

**What this does NOT do:**

- No mandatory pre-implementation check (optional reference)
- No prompt injection (passive discovery only)
- No blocking — agents can ignore it entirely

## Integration Points

| File                     | Change                                        |
| ------------------------ | --------------------------------------------- |
| `docs/reviews/CLAUDE.md` | Create — pattern index                        |
| `docs/reviews/patterns/` | Create — pattern files (populated over time)  |
| `CLAUDE.md` (root)       | Edit — add row to index table                 |
| `docs/CLAUDE.md`         | Edit — add `reviews/` subsection              |
| `AGENTS.md`              | Edit — add reference to review knowledge base |

## Seed from History

PRs #33, #34, and #36 have structured Codex review comments with consistent format
(severity badge, file path, confidence, description). As part of implementation,
retrospectively parse these comments and populate the initial pattern collection.

**Source PRs:**

| PR  | Title                                                  | Findings |
| --- | ------------------------------------------------------ | -------- |
| #36 | feat: interactive sidebar sessions, resizable panels   | ~5       |
| #34 | feat: Phase 3 Terminal Core - TauriTerminalService IPC | ~3       |
| #33 | fix: terminal rendering, WebGL, backspace              | ~3       |

**Process:**

1. Fetch review comments via `gh api repos/{owner}/{repo}/issues/{pr}/comments`
2. Filter for `github-actions[bot]` comments containing findings (skip "No issues found")
3. Parse each finding: severity, file path, description
4. Trace fix commits via `git log --oneline` on the PR's merge commit range
5. Group findings by pattern (agent classifies based on description similarity)
6. Write pattern files and index

If any PR's data is too noisy or the fix commits can't be traced cleanly, skip that
PR and move on. The goal is to seed useful patterns, not achieve completeness.

## Out of Scope (Future Iterations)

1. **Automated ingestion hook** — PostToolUse hook or harness plugin that auto-triggers
   recording. For now, agent-driven via prompt instructions.
2. **Pattern merging/splitting** — manual curation. Could add a `/review-curate` skill.
3. **Active prompt injection** — inject relevant patterns into coding prompts based on
   files being modified. Useful once the collection is large enough.
4. **Analytics** — ref_count trends, most-flagged categories, review quality over time.
5. **Severity weighting** — patterns with more CRITICAL/HIGH findings surface higher.
