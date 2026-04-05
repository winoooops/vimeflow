---
name: harness:review
description: Run local Codex code review via npm run review, parse findings from .codex-reviews/latest.md, and fix issues. Single pass — no polling loop.
tools: Read, Write, Edit, Bash, Grep, Glob
---

# /harness:review — Local Codex Code Review

Run a local Codex code review against the current branch's diff from `main`, parse the findings, and fix each issue. This is a single-pass review — no PR required, no polling loop.

## When to Use

- Before creating a PR — get quick feedback locally
- After writing code — catch issues before pushing
- As a lighter alternative to `/harness:github-review` when you don't need cloud review

## Step 1: Run the Review

```bash
npm run review
```

This runs `codex exec review --base main` via `scripts/review.sh`. It saves the review output to `.codex-reviews/latest.md`.

Wait for the command to complete (may take 1-3 minutes).

## Step 2: Read the Review Output

```bash
cat .codex-reviews/latest.md
```

The review output follows this format:

```
Review comment:

- [SEVERITY] Description — file_path:line_range
  Explanation of the issue and how to fix it.
```

If the review says "No issues found" or the patch is correct — tell the user **the review is clean** and stop.

## Step 3: Parse and Fix Findings

For each finding:

1. **Read the file** at the specified path and line range
2. **Understand the issue** in context
3. **Decide**:
   - **FIX** — make the minimal change to resolve the issue
   - **SKIP** — explain why (false positive, intentional pattern, out of scope)
4. If fixing: make the change

Rules:

- Fix ONLY what the review identified — no drive-by refactoring
- Never introduce new issues while fixing existing ones

## Step 4: Verify

After all fixes:

```bash
npm run lint
npm run test
```

Both must pass before reporting results.

## Step 5: Report Results

Tell the user:

- Which findings were fixed
- Which were skipped (with reasons)
- Whether lint and tests pass

Do NOT commit or push — leave that to the user or to the next step in their workflow.

## Exit Conditions

1. **Clean review** — no issues found
2. **All findings processed** — each one fixed or skipped with explanation
3. **Review command failed** — tell the user and stop (likely missing `OPENAI_API_KEY` or `codex` CLI)
