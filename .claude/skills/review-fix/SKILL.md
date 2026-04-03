---
name: review-fix
description: Fetch Codex review findings from the current PR and fix them. Polls gh for the latest Codex comment, parses findings, fixes each issue, runs tests, commits, and pushes.
tools: Read, Write, Edit, Bash, Grep, Glob
---

# /review-fix — Fix Codex PR Review Findings

Fetch the latest Codex code review from the current branch's PR and fix every finding.

## Step 1: Get PR Number and Latest Review

Run these commands to find the PR and its Codex review comment:

```bash
# Get current branch's PR number
PR_NUMBER=$(gh pr view --json number --jq '.number' 2>/dev/null)

# Get the repo name
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')

# Fetch the latest Codex review comment (look for "## Codex Code Review")
gh api "repos/$REPO/issues/$PR_NUMBER/comments" --jq '[.[] | select(.body | contains("## Codex Code Review"))] | last | .body'
```

If no PR exists or no Codex review comment found, tell the user and stop.

## Step 2: Parse Findings

Read the Codex review comment. It has this structure:

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

If the review says "No issues found" or "patch is correct" — tell the user the review is clean and stop.

## Step 3: Fix Each Finding

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

## Step 4: Commit and Push

```bash
git add -A
git commit -m "fix: address Codex review findings

- [list what was fixed]
- [list what was skipped and why]"

git push
```

## Step 5: Report

Tell the user:

- Which findings were fixed
- Which were skipped (with reasons)
- That the push will trigger a new Codex review on the PR
- They can run `/review-fix` again after the next review arrives
