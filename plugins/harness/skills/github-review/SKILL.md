---
name: github-review
description: Fetch review findings from the current PR (Claude Code Review aggregated comments + chatgpt-codex-connector inline comments) and fix them in atomic per-cycle batches. Each cycle polls both reviewers, fixes findings, runs codex verify on the staged diff, commits with watermark trailers, pushes, replies + resolves connector threads, then polls for the next review. Mandates pattern-file appends in the same commit as the fix.
tools: Read, Write, Edit, Bash, Grep, Glob
---

# /harness-plugin:github-review — Fix PR Review Findings (Connector-Aware Self-Driving Loop)

Fetch the latest reviews from the current branch's PR (or a user-specified PR), fix every finding, push, then poll for the next review and repeat — until both reviewers come back clean or the loop hits the max-rounds cap.

This skill consumes two reviewers:

1. **Claude Code Review** — `github-actions[bot]` issue comments with `## Claude Code Review` header. Aggregated, no threads.
2. **chatgpt-codex-connector** — `chatgpt-codex-connector[bot]` PR-level review summaries (`### 💡 Codex Review`) + inline file-level comments (`**P1/P2 Badge** Title`). Inline comments are the actionable units; threads resolved via GraphQL `resolveReviewThread`.

The old aggregated `openai/codex-action@v1` workflow (`.github/workflows/codex-review.yml`) was disabled in the same PR that introduced this rewrite (issue #111).

## Loop Control

- **Max rounds:** 10 (hard cap to prevent runaway loops)
- **Per-round verify retry budget:** 3 (codex-verify re-entries to fix; exceed → cycle abort)
- **Inter-round poll interval:** 60 seconds
- **Inter-round poll timeout:** 10 minutes per round
- **State persistence:** Git commit-message trailers (no `.json` state file). Cycle start derives processed sets via `git log "$PR_BASE..HEAD"`.
- **Per-cycle artifacts:** under `.harness-github-review/` (gitignored). See § Cleanup.

## Step 0: Input resolution

(Filled in Task 4.)

## Step 1: Get PR + repo context

(Filled in Task 4.)

## Step 1.5: Check non-review CI status

(Filled in Task 4.)

## Step 2: Poll both reviewers + parse findings

(Filled in Tasks 5–6.)

## Step 3: Empty-state classification

(Filled in Task 7.)

## Step 4: Fix all findings

(Filled in Task 8.)

## Step 5: Codex verify on staged diff

(Filled in Tasks 9–10.)

## Step 6: Write patterns → stage all → commit → push → reply + resolve threads

(Filled in Task 11.)

## Step 7: Exit check + retro prompt

(Filled in Task 12.)

## Cleanup, recovery & failsafe

(Filled in Task 12.)
