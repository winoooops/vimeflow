---
name: review-fix
description: Fetch Codex review findings from the current PR and fix them. Polls gh for the latest Codex comment, parses findings, fixes each issue, runs tests, commits, and pushes. Automatically loops — polls for the next review after each push.
tools: Read, Write, Edit, Bash, Grep, Glob
---

# /review-fix — Fix Codex PR Review Findings (Self-Driving Loop)

Fetch the latest Codex code review from the current branch's PR, fix every finding, push, then poll for the next review and repeat — until the review comes back clean or the loop hits the max rounds limit.

## Loop Control

- **Max rounds**: 10 (hard cap to prevent runaway loops)
- **Poll interval**: 60 seconds between checks for a new review
- **Poll timeout**: 10 minutes per round (if no new review appears, stop)
- Track the **comment ID** of the last processed review to detect new ones

## Step 1: Get PR Number and Baseline

Run these commands once at the start of the loop:

```bash
# Get current branch's PR number
PR_NUMBER=$(gh pr view --json number --jq '.number' 2>/dev/null)

# Get the repo name
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
```

If no PR exists, tell the user and stop.

## Step 2: Fetch Latest Codex Review

```bash
# Fetch the latest Codex review comment ID and body
gh api "repos/$REPO/issues/$PR_NUMBER/comments" \
  --jq '[.[] | select(.body | contains("## Codex Code Review"))] | last | {id, body}'
```

- If no Codex review comment found, tell the user and stop.
- Store the **comment ID** so you can detect when a NEW review arrives after pushing.

## Step 3: Parse Findings

The Codex review comment has this structure:

```
## Codex Code Review

### [SEVERITY_ICON] [SEVERITY] Title

📍 `file_path` L{start}-{end}
🎯 Confidence: N%

Description of the issue and how to fix it.

---

**Overall: verdict** (confidence: N%)
> Summary
```

Extract each finding: severity, file path, line range, description.

If the review says "No issues found" or "patch is correct" — tell the user **the review is clean** and **exit the loop**.

## Step 4: Fix Each Finding

For each finding:

1. **Read the file** at the specified path and line range
2. **Understand the issue** in context
3. **Decide**:
   - **FIX** — make the minimal change to resolve the issue
   - **SKIP** — explain why (false positive, intentional pattern, out of scope)
4. If fixing: make the change, verify with `npm run lint` and `npm run test`

Rules:

- Fix ONLY what the review identified — no drive-by refactoring
- Never introduce new issues while fixing existing ones
- Run tests after ALL fixes, not after each one

## Step 5: Commit and Push

```bash
git add -A
git commit -m "fix: address Codex review round N findings

- [list what was fixed]
- [list what was skipped and why]"

git push
```

## Step 6: Report Round Results

Tell the user:

- Round number (e.g., "Round 1 of 10")
- Which findings were fixed
- Which were skipped (with reasons)

## Step 7: Poll for Next Review

After pushing, the Codex GitHub Action will run on the new commit. Poll for a NEW review comment (different comment ID than the one just processed):

```bash
# Poll every 60s, up to 10 minutes
# Look for a comment with a DIFFERENT id than the last processed one
gh api "repos/$REPO/issues/$PR_NUMBER/comments" \
  --jq '[.[] | select(.body | contains("## Codex Code Review"))] | last | {id, body}'
```

- If a new comment appears (different ID): go back to **Step 3**
- If no new comment after 10 minutes: tell the user the poll timed out, they can re-run `/review-fix` later
- If max rounds (10) reached: tell the user the loop hit its cap

## Exit Conditions

The loop exits when ANY of these is true:

1. **Clean review** — Codex says no issues found / patch is correct
2. **Poll timeout** — no new review appeared within 10 minutes after push
3. **Max rounds reached** — 10 fix-push-poll cycles completed
4. **No PR / no review** — nothing to process
5. **All findings skipped** — nothing was actually changed, no point pushing
