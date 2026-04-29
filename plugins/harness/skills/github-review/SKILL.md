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

The skill supports both current-branch operation and explicit PR targeting. **Explicit PR targeting only changes which PR is _read_ from — write operations (commit, push) still happen on the current `git` checkout.** This step enforces that the current branch matches the PR's head ref so fixes can never accidentally land on the wrong branch.

```bash
# If the user supplied a PR number (env var or first argument), use it.
# Otherwise resolve the current branch's PR.
USER_SUPPLIED_PR_NUMBER="${USER_SUPPLIED_PR_NUMBER:-${1:-}}"

if [ -n "$USER_SUPPLIED_PR_NUMBER" ]; then
  PR_NUMBER="$USER_SUPPLIED_PR_NUMBER"
else
  PR_NUMBER=$(gh pr view --json number --jq .number 2>/dev/null)
fi

if [ -z "${PR_NUMBER:-}" ]; then
  echo "ERROR: No PR found. Either:" >&2
  echo "  1) Run from a branch that has an open PR, or" >&2
  echo "  2) Set USER_SUPPLIED_PR_NUMBER=<number> AND check out the PR's head branch" >&2
  echo "     (or use a worktree on that branch)." >&2
  exit 1
fi

REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
OWNER=${REPO%%/*}
NAME=${REPO#*/}
BASE_REF=$(gh pr view "$PR_NUMBER" --json baseRefName --jq .baseRefName)
HEAD_REF=$(gh pr view "$PR_NUMBER" --json headRefName --jq .headRefName)

# Safety guard — current branch MUST match the PR's head ref.
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "$HEAD_REF" ]; then
  echo "ERROR: Current branch is '$CURRENT_BRANCH' but PR #$PR_NUMBER head is '$HEAD_REF'." >&2
  echo "Fixes would commit + push to the wrong branch." >&2
  echo "Either:" >&2
  echo "  1) git switch '$HEAD_REF' (if no other in-progress work blocks it), or" >&2
  echo "  2) Create a worktree on the PR branch:" >&2
  echo "       git worktree add .claude/worktrees/$HEAD_REF '$HEAD_REF'" >&2
  echo "       cd .claude/worktrees/$HEAD_REF" >&2
  echo "     and re-run the skill from there." >&2
  exit 1
fi

echo "Working on PR #$PR_NUMBER (repo: $REPO, base: $BASE_REF, head: $HEAD_REF)"
```

## Step 1: Resolve `PR_BASE` and derive processed-set watermarks from commit trailers

The processed-set watermarks live in commit-message trailers on prior fix commits in this PR. We need `PR_BASE` (the commit where this PR's branch diverged from `BASE_REF`) so we can scope `git log` correctly across base-branch renames and stacked PRs.

```bash
# Fetch the base ref so origin/$BASE_REF exists locally.
git fetch origin "$BASE_REF" --no-tags

# Use merge-base so we count only commits unique to this branch — robust
# against upstream advancing while the PR is open.
PR_BASE=$(git merge-base HEAD "origin/$BASE_REF")

# Extract trailer values for each watermark key. Each var holds a comma-separated
# list of integer or string IDs (empty if no prior fix commits).
extract_trailer() {
  local key="$1"
  git log "$PR_BASE..HEAD" --pretty=%B \
    | awk -v k="^${key}:" '$0 ~ k { sub(k, ""); gsub(/^ +| +$/, ""); print }' \
    | tr ',' '\n' \
    | awk 'NF' \
    | tr '\n' ',' \
    | sed 's/,$//'
}

PROCESSED_CLAUDE_IDS=$(extract_trailer "GitHub-Review-Processed-Claude")
SUPERSEDED_CLAUDE_IDS=$(extract_trailer "GitHub-Review-Superseded-Claude")
PROCESSED_CODEX_REVIEW_IDS=$(extract_trailer "GitHub-Review-Processed-Codex-Reviews")
PROCESSED_CODEX_INLINE_IDS=$(extract_trailer "GitHub-Review-Processed-Codex-Inline")
CLOSED_CODEX_THREADS=$(extract_trailer "Closes-Codex-Threads")

# Claude side: union of processed and superseded.
CLAUDE_HANDLED_IDS=$(printf '%s,%s' "$PROCESSED_CLAUDE_IDS" "$SUPERSEDED_CLAUDE_IDS" | tr ',' '\n' | awk 'NF' | sort -u | tr '\n' ',' | sed 's/,$//')

echo "PR_BASE=$PR_BASE"
echo "Claude handled count:    $(echo "$CLAUDE_HANDLED_IDS" | tr ',' '\n' | awk 'NF' | wc -l)"
echo "Codex review handled:    $(echo "$PROCESSED_CODEX_REVIEW_IDS" | tr ',' '\n' | awk 'NF' | wc -l)"
echo "Codex inline handled:    $(echo "$PROCESSED_CODEX_INLINE_IDS" | tr ',' '\n' | awk 'NF' | wc -l)"
echo "Closed Codex threads:    $(echo "$CLOSED_CODEX_THREADS" | tr ',' '\n' | awk 'NF' | wc -l)"
```

The four `*_IDS` variables become inputs to Step 2's poll filtering. They feed `jq --argjson` calls as JSON arrays — convert via `jq -R 'split(",") | map(select(length > 0))' <<< "$VAR"` at the call site.

## Step 1.5: Check non-review CI status

Before looking at review comments, ensure the PR's non-review CI checks are green. Failing review-side checks (the disabled `Codex Code Review` job, or the Claude review job mid-flight) are NOT blockers; we don't gate on them.

```bash
gh pr checks "$PR_NUMBER"
```

If any checks **other than `Codex Code Review` and `Claude Code Review`** are failing (e.g., Code Quality Check, Unit Tests, Tauri Build):

1. Read the failing check's log: `gh run view <run_id> --log-failed`
2. Fix the issue (formatting, lint, type errors, test failures)
3. Commit and push the fix in a separate non-review-fix commit (does NOT use the trailer schema)
4. Re-run `gh pr checks` until non-review CI is green

Common CI failure recipes:

- **Code Quality Check (Prettier):** `npx prettier --write <flagged files>`
- **Code Quality Check (ESLint):** `npm run lint:fix`
- **Unit Tests:** `npm run test` to reproduce, then fix
- **Type-check:** `npm run type-check` to reproduce

Only proceed to Step 2 once all non-review CI is passing.

## Step 2: Poll both reviewers + parse findings

This step polls both reviewers, parses their findings, and prepares the per-cycle finding table that Step 3 will classify and Step 4 will fix.

### Step 2A: Claude reviewer (issue comments, aggregated, no threads)

**Poll:**

```bash
CLAUDE_COMMENTS_JSON=$(gh api "repos/$REPO/issues/$PR_NUMBER/comments" --paginate \
  --jq '[.[] | select(
           .user.login == "github-actions[bot]"
           and (.body | startswith("## Claude Code Review"))
         )]')

# Convert handled IDs to a jq-compatible JSON array.
CLAUDE_HANDLED_JSON=$(jq -R 'split(",") | map(select(length > 0) | tonumber)' <<< "$CLAUDE_HANDLED_IDS")

# Filter out already-handled comments. Take the latest by created_at — Claude
# reviews are aggregated current-state, so older unprocessed comments are
# stale-by-construction and should be marked superseded (Step 6 trailer).
LATEST_CLAUDE=$(jq --argjson handled "$CLAUDE_HANDLED_JSON" '
  [.[] | select(.id as $id | ($handled | index($id) | not))]
  | sort_by(.created_at)
  | last
  | if . then . else null end
' <<< "$CLAUDE_COMMENTS_JSON")

# Compute superseded set: any unhandled Claude comment with created_at strictly
# less than LATEST_CLAUDE.created_at. These will be added to the
# GitHub-Review-Superseded-Claude trailer in Step 6.
SUPERSEDED_THIS_CYCLE=$(jq --argjson handled "$CLAUDE_HANDLED_JSON" \
  --argjson latest "$LATEST_CLAUDE" '
  if $latest == null then []
  else
    [.[] | select(.id as $id | ($handled | index($id) | not))
         | select(.created_at < $latest.created_at)
         | .id]
  end
' <<< "$CLAUDE_COMMENTS_JSON")
```

Note `startswith` (not `contains`) — avoids matching human comments that quote the header.

**Parse format** (verified on PR #109):

```
## Claude Code Review

### 🟠 [HIGH] match_command recurses infinitely on cyclic npm script aliases

📍 `/home/runner/work/vimeflow/vimeflow/src-tauri/src/agent/test_runners/matcher.rs` L103-108
🎯 Confidence: 93%

<finding body, possibly multi-paragraph, may include code blocks>

<details><summary>💡 IDEA</summary>
- **I — Intent:** ...
- **D — Danger:** ...
- **E — Explain:** ...
- **A — Alternatives:** ...
</details>

---
```

Per finding, extracted from the body split on `---`:

- `severity`: regex `### .* \[(\w+)\]` → group 1
- `title`: same line, after `]`, trimmed to end-of-line
- `file`: regex `` 📍 `([^`]+)` `` → resolve via path normalization (below)
- `line_range`: regex `L(\d+)-(\d+)` (start, end)
- `body`: text between the `🎯 Confidence` line and `<details>` (or `---` if no IDEA block)

**Path normalization** must be deterministic and verify file existence:

```python
def resolve_claude_path(reported: str, repo_root: Path) -> str:
    # Case 1: relative path that exists at repo_root
    if not reported.startswith('/'):
        if (repo_root / reported).exists():
            return reported
        # fall through to suffix-search

    # Case 2 & 3: absolute path — try progressively shorter suffixes
    parts = reported.lstrip('/').split('/')
    for i in range(len(parts)):
        suffix = '/'.join(parts[i:])
        if (repo_root / suffix).exists():
            return suffix

    raise SkillError(f"path normalization failed: {reported!r} not found in {repo_root}")
```

Any unresolvable path = loud error. The skill must NOT silently fall back to e.g. `parts[-1]`.

**Verdict regex** (at end of body, used for "review is clean" exit detection):

```python
CLAUDE_VERDICT_PATTERNS = [
    r'(?im)^\s*\*\*Overall:\s*✅\s*patch is correct\*\*',
    r'(?im)^\s*Overall:\s*✅\s*patch is correct\b',
]
def is_claude_clean(body: str) -> bool:
    return any(re.search(p, body) for p in CLAUDE_VERDICT_PATTERNS)
```

Anchored to start-of-line; refuses to match quoted/embedded references inside finding bodies.

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
