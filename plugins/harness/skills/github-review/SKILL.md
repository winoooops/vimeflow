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

### Step 2B: Codex connector reviewer (PR review summary + inline comments)

The connector posts on two surfaces:

1. `/pulls/{pr}/reviews` — summary review with body `### 💡 Codex Review`
2. `/pulls/{pr}/comments` — inline file-level comments with `**P1/P2 Badge** Title` body

Inline comments are the actionable findings. Summary reviews are used only for the "is this run clean" verdict signal.

**Two-step poll:**

```bash
# Step 1: connector reviews (summary level).
NEW_REVIEWS_JSON=$(gh api "repos/$REPO/pulls/$PR_NUMBER/reviews" --paginate \
  --jq '[.[] | select(.user.login == "chatgpt-codex-connector[bot]")]')

# Subtract Processed-Codex-Reviews trailer set.
PROCESSED_REVIEWS_JSON=$(jq -R 'split(",") | map(select(length > 0) | tonumber)' <<< "$PROCESSED_CODEX_REVIEW_IDS")
UNPROCESSED_REVIEWS_JSON=$(jq --argjson done "$PROCESSED_REVIEWS_JSON" '
  [.[] | select(.id as $id | ($done | index($id) | not))]
' <<< "$NEW_REVIEWS_JSON")
UNPROCESSED_REVIEW_IDS_JSON=$(jq '[.[].id]' <<< "$UNPROCESSED_REVIEWS_JSON")
```

```bash
# Step 2: connector inline comments scoped to unprocessed review IDs,
# also subtracting Processed-Codex-Inline. Use string-membership index()
# to dodge jq's number-vs-string typing across REST endpoints.
#
# IMPORTANT: gh api's --jq accepts ONLY the filter expression, not other jq
# flags like --argjson. Pipe gh api raw output to a separate jq invocation.
PROCESSED_INLINE_JSON=$(jq -R 'split(",") | map(select(length > 0))' <<< "$PROCESSED_CODEX_INLINE_IDS")

NEW_INLINE_JSON=$(gh api "repos/$REPO/pulls/$PR_NUMBER/comments" --paginate \
  | jq --argjson rids "$UNPROCESSED_REVIEW_IDS_JSON" \
       --argjson done_inline "$PROCESSED_INLINE_JSON" '
    ($rids | map(tostring)) as $ridset |
    ($done_inline | map(tostring)) as $doneset |
    [.[] | select(
      .user.login == "chatgpt-codex-connector[bot]"
      and ((.pull_request_review_id // empty | tostring) as $rid | $ridset | index($rid))
      and ((.id | tostring) as $cid | $doneset | index($cid) | not)
    )]')
```

**Race retry — review summary appears before inline comments are queryable:**

Per unprocessed review, fetch its inline comments. If empty:

```python
def is_summary_clean(body: str) -> bool:
    CLEAN_PATTERNS = [
        r'(?im)^\s*(?:✅\s*)?No issues found\.?\s*$',
        r'(?im)^\s*\*\*Overall:\s*✅\s*patch is correct\*\*',
        r'(?im)^\s*Overall:\s*✅\s*patch is correct\b',
    ]
    return any(re.search(p, body) for p in CLEAN_PATTERNS)

# Per review:
if not inline_for_this_review:
    if is_summary_clean(review.body):
        # Summary explicitly clean — no inline expected. Skip retry.
        continue
    # Race: summary suggests findings but inline not yet visible.
    for attempt in range(1, 7):  # 6 attempts × 5s = 30s max
        time.sleep(5)
        re_fetch_inline()
        if non_empty:
            break
    else:
        raise SkillError(
          f"connector review {review.id} summary suggests findings but inline "
          "comments still empty after 6×5s retries — refusing to silently exit"
        )
```

**Inline comment parse** — body shape (verified on PR #109):

```
**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  <Title>**

<Description>

Useful? React with 👍 / 👎.
```

Top-level fields (no body parsing required for these): `id`, `path`, `original_line`, `pull_request_review_id`.

Body parsing:

- `severity`: regex `!\[(P\d) Badge\]` → P1 maps to internal HIGH, P2 to internal MEDIUM. Original `P1` / `P2` label preserved in pattern entry's `Severity:` field as `P1 / HIGH` / `P2 / MEDIUM`.
- `title`: regex `\*\*<sub>.*?</sub>\s+(.+?)\*\*` → group 1, trimmed
- `body`: text between the title line and `Useful? React with 👍 / 👎.`

**Thread ID lookup** for connector inline comments — REST does not return thread IDs, so we query GraphQL. Implementation **must be page-aware**. Define a single named helper, `paginated_review_threads_query`, that handles pagination once. Both Step 2 (thread-id lookup) and Step 7.1 (unresolved-thread exit check) reuse it:

```bash
# Returns a flat JSON array of {thread_id, comment_databaseId,
# comment_author_login, isResolved} entries across ALL review threads and
# ALL comments per thread. Caller filters by author / by ID set as needed.
paginated_review_threads_query() {
  local cursor=""
  local result="[]"

  while :; do
    local page_json
    if [ -z "$cursor" ]; then
      page_json=$(gh api graphql -f query='
        query($owner:String!, $name:String!, $pr:Int!) {
          repository(owner:$owner, name:$name) {
            pullRequest(number:$pr) {
              reviewThreads(first:100) {
                pageInfo { hasNextPage endCursor }
                nodes {
                  id
                  isResolved
                  comments(first:50) {
                    pageInfo { hasNextPage endCursor }
                    nodes { databaseId author { login } }
                  }
                }
              }
            }
          }' -F owner="$OWNER" -F name="$NAME" -F pr="$PR_NUMBER")
    else
      page_json=$(gh api graphql -f query='
        query($owner:String!, $name:String!, $pr:Int!, $cursor:String!) {
          repository(owner:$owner, name:$name) {
            pullRequest(number:$pr) {
              reviewThreads(first:100, after:$cursor) {
                pageInfo { hasNextPage endCursor }
                nodes {
                  id
                  isResolved
                  comments(first:50) {
                    pageInfo { hasNextPage endCursor }
                    nodes { databaseId author { login } }
                  }
                }
              }
            }
          }' -F owner="$OWNER" -F name="$NAME" -F pr="$PR_NUMBER" -F cursor="$cursor")
    fi

    # Detect any thread whose comments page itself overflowed.
    local overflow
    overflow=$(jq '[.data.repository.pullRequest.reviewThreads.nodes[]
                    | select(.comments.pageInfo.hasNextPage == true)
                    | .id]' <<< "$page_json")
    if [ "$(jq 'length' <<< "$overflow")" -gt 0 ]; then
      echo "ERROR: review thread(s) $overflow exceed 50-comment first page; per-thread pagination required but not yet implemented." >&2
      return 1
    fi

    # Append flattened entries from this page.
    result=$(jq -s '.[0] + .[1]' \
      <(echo "$result") \
      <(jq '[.data.repository.pullRequest.reviewThreads.nodes
              | .[] as $thread
              | .comments.nodes[]
              | {thread_id: $thread.id, comment_databaseId: .databaseId,
                 comment_author_login: .author.login, isResolved: $thread.isResolved}]' \
            <<< "$page_json"))

    # Advance cursor or exit.
    local has_next
    has_next=$(jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage' <<< "$page_json")
    if [ "$has_next" != "true" ]; then break; fi
    cursor=$(jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor' <<< "$page_json")
  done

  echo "$result"
}

# Step 2 usage: build inline-comment-id → thread-id map.
ALL_THREAD_COMMENTS=$(paginated_review_threads_query)
INLINE_TO_THREAD_MAP=$(jq '[.[] | select(.comment_author_login == "chatgpt-codex-connector[bot]")
                            | {thread_id, comment_id: .comment_databaseId, isResolved}]' \
                          <<< "$ALL_THREAD_COMMENTS")
```

After all pages exhausted: any connector inline-comment ID not present in `INLINE_TO_THREAD_MAP` is a loud error (`"connector inline comment {id} not found in any review thread — data state anomaly"`).

The mapping table is consumed in Step 6 (reply + resolve threads). Step 7.1 reuses `paginated_review_threads_query` for the unresolved-thread exit check.

### Step 2C: Finding-table aggregation

After Steps 2A + 2B, build the per-cycle finding table. The table is **transient** (in-memory only — not persisted; spec §1).

```typescript
type Finding = {
  cycle_id: string // "F1", "F2", ... — stable for this cycle, used in verify prompt
  source: 'claude' | 'codex-connector'
  source_comment_id: number // Claude: comment ID. Connector: inline comment ID.
  source_review_id: number | null // Connector only
  thread_id: string | null // Connector only (PRRT_xxx form)
  severity_internal: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  severity_label_original: string // e.g. "HIGH" or "P1 / HIGH" (preserved for pattern entry)
  title: string
  file: string // repo-relative
  line_range: { start: number; end: number }
  body: string
  status: 'pending' | 'fixed' | 'skipped' | 'verify_failed'
  fix_summary: string | null // populated after Step 4
}
```

Build the table by iterating Claude findings (if `LATEST_CLAUDE` is non-null and parsing succeeded) and connector inline findings (everything in the post-race-retry inline set), assigning sequential `cycle_id` strings (`F1`, `F2`, ...). The table is consumed by Step 3 (classification), Step 4 (fix loop), Step 5 (verify prompt), and Step 6 (commit message + pattern routing).

## Step 3: Empty-state classification

After Step 2 polls and parses, classify the per-cycle finding state into exactly one of five cases. **No silent-empty path** — every empty result is either explicitly clean (case 3) or a loud-fail (case 4/5).

| Case | Claude side                                                                 | Codex side                                                                       | Action                                                  |
| ---- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1    | No new comment in unprocessed set                                           | No new review in unprocessed set; no unresolved threads                          | **Step 7 poll-next**                                    |
| 2    | New comment with ≥1 successfully-parsed finding **OR** unchanged            | New review with ≥1 inline finding, all parseable **OR** unchanged                | **Step 4 fix**                                          |
| 3    | New comment, 0 findings, verdict explicitly clean (per `is_claude_clean`)   | No new unresolved findings (all reviews `is_summary_clean` or already processed) | **Loop exit (clean)**                                   |
| 4    | New comment, parser failed (no `### [SEV]` blocks AND no parseable verdict) | New review, after race-retry inline still empty AND summary not explicitly clean | **loud-fail**, dump raw body to user                    |
| 5    | New comment, verdict says ⚠️ but 0 findings parseable                       | (case-4-equivalent on Codex side)                                                | **loud-fail** (reviewer claims problems but lists none) |

If at least one reviewer is case 2, the cycle proceeds with whatever findings were parsed from that reviewer (the other may be case 1 — that's fine; we just have nothing new from that side). Cases 4 and 5 abort the cycle BEFORE any code changes.

```bash
# Pseudocode for the case selection. Implement as a function in the skill.
classify_cycle() {
  local claude_state codex_state

  # Determine claude_state from Step 2A outputs:
  if [ "$LATEST_CLAUDE" = "null" ]; then
    claude_state="case_1"
  elif claude_parse_succeeded && [ "$CLAUDE_FINDINGS_COUNT" -gt 0 ]; then
    claude_state="case_2"
  elif claude_parse_succeeded && [ "$CLAUDE_FINDINGS_COUNT" -eq 0 ] && is_claude_clean; then
    claude_state="case_3"
  elif claude_parse_succeeded && [ "$CLAUDE_FINDINGS_COUNT" -eq 0 ] && claude_verdict_says_dirty; then
    claude_state="case_5"
  else
    claude_state="case_4"
  fi

  # Determine codex_state from Step 2B outputs (similar logic).
  # ...

  # Combined disposition:
  if [ "$claude_state" = "case_4" ] || [ "$claude_state" = "case_5" ] \
     || [ "$codex_state" = "case_4" ] || [ "$codex_state" = "case_5" ]; then
    echo "LOUD_FAIL"
    return 1
  fi

  if [ "$claude_state" = "case_2" ] || [ "$codex_state" = "case_2" ]; then
    echo "FIX"
    return 0
  fi

  if [ "$claude_state" = "case_3" ] && [ "$codex_state" = "case_3" ]; then
    echo "EXIT_CLEAN"
    return 0
  fi

  # Mixed case 1 / case 3 → still nothing actionable from either side.
  echo "POLL_NEXT"
  return 0
}
```

On `LOUD_FAIL`: write the offending raw body to `.harness-github-review/cycle-${ROUND}-loud-fail-<source>.txt` and `exit 1`. Do NOT proceed to fix or commit.

On `EXIT_CLEAN`: continue to Step 7 (loop exit + retro prompt).

On `FIX`: proceed to Step 4.

On `POLL_NEXT`: continue to Step 7 (poll-next sub-flow).

## Step 4: Fix all findings

For each finding in the cycle's finding table, in order:

1. **Read the file** at the specified `file` path and `line_range`. Use the `Read` tool with `offset` and `limit` parameters.
2. **Understand the issue** — the finding's `body` describes what's wrong and (often) suggests a fix. Cross-reference with the IDEA block if present (Claude reviewer always includes it; connector typically does not).
3. **Decide:**
   - **FIX** — make the minimal change to resolve the issue. Use `Edit` for surgical changes; `Write` only for whole-file replacements.
   - **SKIP** — explain why in the finding's `fix_summary` field. Valid reasons: false positive, intentional pattern with rationale, out of scope (the finding flagged adjacent untouched code in violation of the SCOPE BOUNDARY RULE).
4. After the change, set `finding.status = 'fixed'` (or `'skipped'`) and `finding.fix_summary = <one-sentence description>`.

**Rules** (preserved from the old skill, still apply):

- Fix **only** what the review identified. No drive-by refactoring.
- Never introduce new issues while fixing existing ones — Step 5's codex verify catches this if it slips through, but the discipline is to think about new-issue risk at fix time.
- Run quick local validation as you go (`npm run lint -- <file>`, `cargo check`, etc.) — but **do not** run the full test suite per finding. The full validation runs in Step 5.
- For each finding, also consult `docs/reviews/patterns/<matching-pattern>.md` BEFORE fixing if the pattern is relevant — it may carry prior fixes for the same finding class. If you read a pattern file, bump its `ref_count` in frontmatter by 1 (this is the consumer-bumps-on-read protocol from `docs/reviews/CLAUDE.md`).

**Do NOT commit yet.** Stage all changes (`git add`) but defer commit until after Step 5 (codex verify) passes.

After the loop, every finding has `status` ∈ {`fixed`, `skipped`}. Findings still `pending` after the loop = a bug in the loop logic; loud-fail.

## Step 5: Codex verify on staged diff

(Filled in Tasks 9–10.)

## Step 6: Write patterns → stage all → commit → push → reply + resolve threads

(Filled in Task 11.)

## Step 7: Exit check + retro prompt

(Filled in Task 12.)

## Cleanup, recovery & failsafe

(Filled in Task 12.)
