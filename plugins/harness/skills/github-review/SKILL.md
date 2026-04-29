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
# --paginate returns one JSON array per page, so we slurp pages then filter.
CLAUDE_COMMENTS_JSON=$(gh api "repos/$REPO/issues/$PR_NUMBER/comments" --paginate \
  | jq -s 'add | [.[] | select(
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
# --paginate returns one JSON array per page, so we slurp pages then filter.
NEW_REVIEWS_JSON=$(gh api "repos/$REPO/pulls/$PR_NUMBER/reviews" --paginate \
  | jq -s 'add | [.[] | select(.user.login == "chatgpt-codex-connector[bot]")]')

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

# --paginate returns one JSON array per page, so we slurp pages then filter.
NEW_INLINE_JSON=$(gh api "repos/$REPO/pulls/$PR_NUMBER/comments" --paginate \
  | jq -s --argjson rids "$UNPROCESSED_REVIEW_IDS_JSON" \
       --argjson done_inline "$PROCESSED_INLINE_JSON" '
    ($rids | map(tostring)) as $ridset |
    ($done_inline | map(tostring)) as $doneset |
    add | [.[] | select(
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

    # Warn if any thread's comments page overflowed first page (50). This is
    # not fatal — connector original inline comments are typically the thread's
    # first comment and live in the first page. The loud-fail at lookup time
    # (after all pages exhausted) catches the rare case where a target inline
    # comment id ends up beyond the first 50 thread-comments.
    local overflow
    overflow=$(jq '[.data.repository.pullRequest.reviewThreads.nodes[]
                    | select(.comments.pageInfo.hasNextPage == true)
                    | .id]' <<< "$page_json")
    if [ "$(jq 'length' <<< "$overflow")" -gt 0 ]; then
      echo "WARNING: review thread(s) $overflow have more than 50 comments;" >&2
      echo "         per-thread pagination not implemented. If a target inline" >&2
      echo "         comment id is missing from the resulting map, the lookup" >&2
      echo "         loud-fail at Step 2B will catch it." >&2
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

After Step 4 stages all fixes (no commit yet), this step runs `codex exec` against the staged diff to verify:

1. Every upstream finding from this cycle is **addressed** by the diff.
2. The diff does **NOT** introduce new MEDIUM/HIGH/CRITICAL issues. New LOW issues are allowed and will be deferred.

If verify passes (or only finds new-LOW issues), Step 6 commits. If verify finds new MEDIUM/HIGH/CRITICAL issues OR any unaddressed upstream finding, the cycle re-enters Step 4 (retry budget ≤ 3). The matrix in Step 5D below is authoritative on which severity triggers what behavior.

### Step 5A: Setup — gitignored artifact directory

```bash
mkdir -p .harness-github-review

DIFF_PATCH=".harness-github-review/cycle-${ROUND}-diff.patch"
PROMPT_FILE=".harness-github-review/cycle-${ROUND}-verify-prompt.md"
RESULT_JSON=".harness-github-review/cycle-${ROUND}-verify-result.json"
EVENTS_LOG=".harness-github-review/cycle-${ROUND}-verify-events.log"
STDERR_LOG=".harness-github-review/cycle-${ROUND}-verify-stderr.log"
```

The directory is gitignored (Task 1's `.gitignore` change). Step 6's commit will explicitly enumerate files (no `git add -A`) so these artifacts can never accidentally land in a commit.

### Step 5B: Build the verify prompt

````bash
git diff --staged > "$DIFF_PATCH"
DIFF_LINES=$(wc -l < "$DIFF_PATCH")

# render_findings_table_with_F_ids: emit each finding as a markdown bullet
# referencing its cycle_id, source, severity, file, line_range, title, body.
render_findings_table() {
  jq -r '.[] | "
- **\(.cycle_id)** [\(.source) | \(.severity_label_original)] **\(.title)**
  - File: `\(.file)` L\(.line_range.start)-\(.line_range.end)
  - \(.body | gsub("\n"; "\n  "))
"' <<< "$FINDINGS_JSON"
}

cat > "$PROMPT_FILE" <<'EOF'
You are verifying a review-fix cycle. The agent has staged code changes intended to address the upstream findings listed below. Your job is to verify the staged diff resolves every upstream finding without introducing new MEDIUM/HIGH/CRITICAL issues. New LOW-severity issues may be reported and will be deferred (not blocking).

## Upstream findings addressed in this cycle

EOF

render_findings_table >> "$PROMPT_FILE"

cat >> "$PROMPT_FILE" <<EOF

## Staged diff to verify

EOF

if [ "$DIFF_LINES" -le 500 ]; then
  printf '\n```diff\n' >> "$PROMPT_FILE"
  cat "$DIFF_PATCH" >> "$PROMPT_FILE"
  printf '\n```\n' >> "$PROMPT_FILE"
else
  printf '\nThe full staged diff is at `%s`. Read that file. Do NOT run `git diff` — staged changes may diverge from HEAD until commit.\n' "$DIFF_PATCH" >> "$PROMPT_FILE"
fi

cat >> "$PROMPT_FILE" <<'EOF'

## Verification rules

1. For each upstream finding F1..FN, decide ADDRESSED or NOT_ADDRESSED.
   - If NOT_ADDRESSED: emit a finding with `title` PREFIXED `[UNADDRESSED Fk] <original title>` and `severity` matching the upstream's original severity.
2. Beyond upstream coverage, scan the diff for NEW issues introduced by the fix. Emit those normally (no [UNADDRESSED] prefix).
3. SCOPE BOUNDARY RULE — review ONLY lines in this staged diff. Do NOT cascade into untouched files.
4. Confidence-based filtering: only report >80% confidence issues.

Output JSON conforming to the codex-output-schema. An empty `findings` array means: every upstream finding ADDRESSED and no new issues found.
EOF
````

The 500-line threshold for inline-vs-file is heuristic. Larger diffs would inflate the prompt past codex's effective context window; the file-pointer fallback lets codex use its own read tool to ingest progressively.

### Step 5C: Call `codex exec` (verified CLI flags)

```bash
timeout 300 codex exec \
  --sandbox read-only \
  --output-schema .github/codex/codex-output-schema.json \
  --output-last-message "$RESULT_JSON" \
  -- "$(cat "$PROMPT_FILE")" \
  > "$EVENTS_LOG" \
  2> "$STDERR_LOG"

CODEX_EXIT=$?
```

Important flag notes:

- `--output-schema` (not `--output-schema-file` — that flag does not exist).
- `--output-last-message` writes the final structured JSON; stdout is event-stream noise (events log).
- **No `--model` flag.** Per auto-memory `feedback_codex_model_for_chatgpt_auth`: omitting lets `codex` pick the auth-mode-correct default (ChatGPT-account auth rejects explicit model selection).
- External GNU `timeout 300` — `codex exec` has no built-in timeout flag.
- `--sandbox read-only`: codex is verifying, not modifying. Read-only ensures it can't alter the staged diff during verification.
- If `timeout` is unavailable on the platform: omit it and rely on the harness/agent timeout (typically 5–10 min). Acceptable degradation; codex normally finishes in 30–90s on a small staged diff.

### Step 5D: Result classification matrix

```bash
HAS_UNADDRESSED=$(jq '[.findings[].title | select(startswith("[UNADDRESSED"))] | length' "$RESULT_JSON")
HIGHEST_NEW_SEV=$(jq -r '
  [.findings[] | select((.title // "") | startswith("[UNADDRESSED") | not) | .severity]
  | (if length==0 then "NONE"
     else (sort_by({"CRITICAL":4,"HIGH":3,"MEDIUM":2,"LOW":1}[.]) | last)
     end)
' "$RESULT_JSON")
VERDICT=$(jq -r '.overall_correctness' "$RESULT_JSON")
FINDINGS_COUNT=$(jq '.findings | length' "$RESULT_JSON")
```

| Condition                                                               | State                  | Action                                                                      |
| ----------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------- |
| `CODEX_EXIT == 124`                                                     | `verify_timeout`       | Abort cycle (Step 5G)                                                       |
| `CODEX_EXIT != 0` (and not 124)                                         | `verify_error`         | Abort cycle                                                                 |
| `FINDINGS_COUNT == 0 && VERDICT == "patch is correct"`                  | `pass`                 | Continue Step 6                                                             |
| `FINDINGS_COUNT == 0 && VERDICT == "patch has issues"`                  | `contradiction`        | **loud-fail**, abort cycle                                                  |
| `HAS_UNADDRESSED > 0` (any sev)                                         | `unaddressed_upstream` | Re-enter Step 4 with the unaddressed Fk findings re-added; retry counter +1 |
| `HIGHEST_NEW_SEV == "LOW"` AND `HAS_UNADDRESSED == 0`                   | `pass_with_deferred`   | Continue Step 6; commit message `Verify-Deferred-LOW:` lists each           |
| `HIGHEST_NEW_SEV == "MEDIUM"` AND `HAS_UNADDRESSED == 0`                | `new_medium`           | Re-enter Step 4 to fix; retry counter +1                                    |
| `HIGHEST_NEW_SEV == "HIGH"` OR `"CRITICAL"`, AND `HAS_UNADDRESSED == 0` | `new_high`             | Re-enter Step 4; retry counter +1; if counter reaches 3 → abort             |

`overall_correctness` enum is `"patch is correct" | "patch has issues"` per `.github/codex/codex-output-schema.json`. The matrix uses these exact strings.

### Step 5E: Verify retry budget

`VERIFY_RETRY_COUNTER` starts at 0 at cycle start. Each `unaddressed_upstream` / `new_medium` / `new_high` re-entry to Step 4 increments it.

```bash
if [ "$VERIFY_RETRY_COUNTER" -ge 3 ]; then
  echo "Verify retry budget exhausted (3 attempts) — aborting cycle." >&2
  goto_step_5g_abort
fi

VERIFY_RETRY_COUNTER=$((VERIFY_RETRY_COUNTER + 1))
goto_step_4
```

### Step 5F: Docs-only escape (narrow)

Verify is skipped only when **all three** are true:

1. Every Finding in the cycle is severity LOW
2. Every staged path matches `^docs/` OR `^[^/]*\.md$` OR `^[^/]*\.txt$`
3. **No** staged path matches `^\.github/`, `^package(-lock)?\.json$`, `^src-tauri/`, `^src/`, `^vite\.config\.`, `^tailwind\.config\.`, `^eslint\.config\.`, `^tsconfig\.`, `^\.husky/`

```bash
should_skip_verify_docs_only() {
  # Condition 1
  local non_low_count
  non_low_count=$(jq '[.[] | select(.severity_internal != "LOW")] | length' <<< "$FINDINGS_JSON")
  [ "$non_low_count" -eq 0 ] || return 1

  # Condition 2 + 3 (combined: any path that doesn't match the docs-only allowlist OR matches the forbidden list)
  local violations
  violations=$(git diff --staged --name-only \
    | awk '
      /^docs\// { next }
      /^[^\/]*\.md$/ { next }
      /^[^\/]*\.txt$/ { next }
      /^\.github\// { print "FORBIDDEN:" $0; next }
      /^package(-lock)?\.json$/ { print "FORBIDDEN:" $0; next }
      /^src-tauri\// { print "FORBIDDEN:" $0; next }
      /^src\// { print "FORBIDDEN:" $0; next }
      /^vite\.config\./ { print "FORBIDDEN:" $0; next }
      /^tailwind\.config\./ { print "FORBIDDEN:" $0; next }
      /^eslint\.config\./ { print "FORBIDDEN:" $0; next }
      /^tsconfig\./ { print "FORBIDDEN:" $0; next }
      /^\.husky\// { print "FORBIDDEN:" $0; next }
      { print "NOT_DOCS:" $0 }
    ')
  [ -z "$violations" ] || return 1

  return 0
}

if should_skip_verify_docs_only; then
  echo "Verify skipped: docs-only diff (all LOW findings, allowed paths)." >&2
  VERIFY_SKIPPED=1
  # Step 6 will add Verify-Skipped: docs-only to the commit message.
  goto_step_6
fi
```

### Step 5G: Abort

On `verify_timeout` / `verify_error` / `contradiction` / retry-exhausted:

```bash
ABORT_DIR=".harness-github-review/cycle-${ROUND}-aborted"
mkdir -p "$ABORT_DIR"

git diff --staged > "$ABORT_DIR/staged.patch"
git diff > "$ABORT_DIR/unstaged.patch"
git status --porcelain > "$ABORT_DIR/status.txt"
git ls-files --others --exclude-standard > "$ABORT_DIR/untracked.txt"

# Build incident report (per spec §3.7).
write_incident_report > "$ABORT_DIR/incident.md"
```

`incident.md` contains, in order:

1. Cycle metadata: round number, abort reason, retry counter at abort, started/aborted timestamps.
2. The cycle's full Finding table (the `$FINDINGS_JSON`), each finding's `status` and `fix_summary`.
3. For each verify attempt 1..N: the prompt sent, raw `findings[]` from the result JSON, which findings caused retry/abort.
4. The watermark trailers that **would have been** committed for this cycle (so the user can re-run after manual fixup without losing the watermark progression).
5. A "Recommended next steps" section enumerating the recovery paths from the Cleanup section (§6.3).

The skill **does not** auto-`git stash`. Working tree is left visible. The skill exits the entire loop (not just this cycle):

```bash
echo "Cycle ${ROUND} aborted in verify after ${VERIFY_RETRY_COUNTER} attempts."
echo "See $ABORT_DIR/."
echo ""
echo "Working tree contains the last attempted fix — inspect with 'git status' / 'git diff'."
echo "See § Cleanup → recovery paths for next steps."
exit 1
```

## Step 6: Write patterns → stage all → commit → push → reply + resolve threads

This step lands the cycle's work atomically. **Order matters** — pattern files must be written BEFORE the commit (so they're part of the same commit as the code fix), and reply + thread resolution must come AFTER push (so the cited commit SHA exists on origin).

### 6.1: Match each fixed finding to a pattern file

For each finding with `status == 'fixed'`, decide its target pattern file using the algorithm from spec §4.1:

```
1. Read docs/reviews/CLAUDE.md → get list of (pattern_file_path, category).
2. Pre-filter candidates by:
   - Finding's file path overlap with files already in the pattern.
   - Category vs finding's domain.
3. Read Summary section ONLY for the top 3-5 candidates from Step 2 to disambiguate.
4. Fallback rules:
   a. 2+ findings sharing a novel theme → create new pattern.
   b. Single novel security/data-loss/correctness finding → create new pattern (single-entry security patterns earn their cost).
   c. Other single novel findings → fit into closest existing with a 1-line note.
5. Never create a new category without user approval — abort with prompt.
```

Record decisions in a list for the commit-message trailer:

```
Pattern-Append-Decisions:

- F1 (alias recursion) → patterns/async-race-conditions.md (existing, theme: bounded recursion)
- F2 (Authorization regex) → patterns/credential-leakage.md (NEW pattern)
```

### 6.2: Append entries to existing patterns

For each finding routed to an existing pattern, compute the next entry number:

```python
def next_finding_number(pattern_file_path: str) -> int:
    text = read(pattern_file_path)
    if "## Findings" not in text:
        return 1
    findings_section = text.split("## Findings", 1)[1]
    findings_section = findings_section.split("\n## ", 1)[0]  # stop at next H2
    matches = re.findall(r'^### (\d+)\. ', findings_section, re.MULTILINE)
    return max(int(n) for n in matches) + 1 if matches else 1
```

Append each entry under `## Findings`, schema:

```markdown
### N. <Finding's title>

- **Source:** <github-claude | github-codex-connector | local-codex> | PR #<PR_NUMBER> round <ROUND> | <YYYY-MM-DD>
- **Severity:** <severity_label_original> # e.g. "HIGH" or "P1 / HIGH"
- **File:** `<repo-relative path>`
- **Finding:** <one to three sentences from the finding body>
- **Fix:** <one to three sentences describing what was changed>
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
```

Note: `Commit:` does NOT contain the SHA — pattern file is part of the same commit being created, so the SHA isn't yet known. Recoverable via `git blame` later.

Update frontmatter `last_updated:` to today's date. Do **NOT** bump `ref_count` on append — it's a consumer counter (per `docs/reviews/CLAUDE.md`).

### 6.3: Create new patterns when needed

For findings without a close fit, create a new pattern file at `docs/reviews/patterns/<kebab-slug>.md`:

```markdown
---
id: <kebab-slug-of-name>
category: <one of: security | react-patterns | testing | terminal | code-quality |
                   error-handling | files | review-process | a11y | cross-platform |
                   editor | backend | correctness | e2e-testing>
created: <today>
last_updated: <today>
ref_count: 0
---

# <Title Case Pattern Name>

## Summary

<One paragraph (3-5 sentences) describing the pattern's theme — failure mode + general fix shape — drafted from the finding bodies that triggered creation.>

## Findings

### 1. <First finding's title>

- **Source:** ...
  (continues per 6.2 schema)
```

Category MUST come from the existing closed list (see §4.3). New categories require user approval — abort if needed.

### 6.4: Update the pattern index

`docs/reviews/CLAUDE.md` has a markdown table:

| Pattern                                          | Category | Findings | Refs | Last Updated |
| ------------------------------------------------ | -------- | -------- | ---- | ------------ |
| [Filesystem Scope](patterns/filesystem-scope.md) | security | 20       | 2    | 2026-04-29   |

For each touched pattern, update the row's `Findings` count (re-derive from `### N.` count after this commit's appends), `Last Updated` to today. `Refs` unchanged.

For new pattern files, append a row in the same alphabetical order as existing rows (or end-of-table — verify by reading the file before adding).

### 6.5: Stage everything explicitly

**Do not** use `git add -A` — that would catch the gitignored `.harness-github-review/` if the gitignore failed somehow, and unrelated untracked files. List exact files:

```bash
# Build the staged file list:
STAGED_FILES=()

# Code-fix files (from Step 4 modifications):
while IFS= read -r f; do STAGED_FILES+=("$f"); done < <(git diff --name-only)

# Pattern files modified or created in this cycle:
for f in "${TOUCHED_PATTERN_FILES[@]}"; do STAGED_FILES+=("$f"); done

# Index file if any pattern was added/created:
if [ "${INDEX_TOUCHED:-0}" -eq 1 ]; then
  STAGED_FILES+=("docs/reviews/CLAUDE.md")
fi

git add "${STAGED_FILES[@]}"
git status --short  # sanity check — verify expected files staged, no surprises
```

### 6.6: Build the commit message and commit

```bash
COMMIT_MSG_FILE=".harness-github-review/cycle-${ROUND}-commit-msg.txt"

cat > "$COMMIT_MSG_FILE" <<EOF
fix(#${PR_NUMBER}): address review round ${ROUND} findings

$(render_per_finding_listing)

Reviewers: $(list_unique_sources)

GitHub-Review-Processed-Claude: ${LATEST_CLAUDE_ID:-}
GitHub-Review-Superseded-Claude: $(jq -r 'join(",")' <<< "$SUPERSEDED_THIS_CYCLE")
GitHub-Review-Processed-Codex-Reviews: $(jq -r 'join(",")' <<< "$UNPROCESSED_REVIEW_IDS_JSON")
GitHub-Review-Processed-Codex-Inline: $(list_inline_ids_processed_this_cycle)
Closes-Codex-Threads: $(list_thread_ids_to_close)
Pattern-Files-Touched: $(printf '%s, ' "${TOUCHED_PATTERN_FILES[@]}" | sed 's/, $//')
Pattern-Append-Decisions:
$(render_pattern_append_decisions)
EOF

# Conditional trailers (only if state applies):
if [ -n "${VERIFY_DEFERRED_LOW:-}" ]; then
  echo "Verify-Deferred-LOW: $VERIFY_DEFERRED_LOW" >> "$COMMIT_MSG_FILE"
fi
if [ "${VERIFY_SKIPPED:-0}" -eq 1 ]; then
  echo "Verify-Skipped: docs-only" >> "$COMMIT_MSG_FILE"
fi

git commit -F "$COMMIT_MSG_FILE"
COMMIT_SHA=$(git rev-parse HEAD)

echo "Committed cycle $ROUND as $COMMIT_SHA"
```

### 6.7: Push

```bash
git push
```

### 6.8: Reply to each connector inline finding

```bash
# Reply to every connector finding processed this cycle — both fixed and
# skipped. Skipped findings are intentional non-fixes (false positive, out
# of scope per SCOPE BOUNDARY RULE) and need a rationale on the thread before
# Step 6.9 resolves it; otherwise Step 7's unresolved-threads check would
# never reach exit-clean.
for finding in $(jq -c '.[] | select(.source == "codex-connector" and (.status == "fixed" or .status == "skipped"))' <<< "$FINDINGS_JSON"); do
  COMMENT_ID=$(jq -r '.source_comment_id' <<< "$finding")
  CYCLE_ID=$(jq -r '.cycle_id' <<< "$finding")
  TITLE=$(jq -r '.title' <<< "$finding")
  STATUS=$(jq -r '.status' <<< "$finding")
  FIX_SUMMARY=$(jq -r '.fix_summary // ""' <<< "$finding")

  if [ "$STATUS" = "fixed" ]; then
    REPLY_BODY=$(cat <<EOF
Fixed in $COMMIT_SHA — $FIX_SUMMARY

(github-review cycle ${ROUND}, finding ${CYCLE_ID})
EOF
)
  else
    # status == "skipped"
    REPLY_BODY=$(cat <<EOF
Skipped — $FIX_SUMMARY

(github-review cycle ${ROUND}, finding ${CYCLE_ID})
EOF
)
  fi

  gh api -X POST "repos/$REPO/pulls/$PR_NUMBER/comments/${COMMENT_ID}/replies" \
    -f body="$REPLY_BODY"
done
```

### 6.9: Resolve threads via GraphQL

```bash
# Resolve threads for both fixed AND skipped connector findings. Skipped
# threads got a rationale reply in Step 6.8; resolving them here closes the
# loop so Step 7's exit check sees no lingering unresolved threads.
for thread_id in $(list_thread_ids_to_close); do
  gh api graphql -f query='
    mutation($threadId:ID!) {
      resolveReviewThread(input:{threadId:$threadId}) {
        thread { id isResolved }
      }
    }' -F threadId="$thread_id" \
    --jq '.data.resolveReviewThread.thread'
done
```

After 6.8 + 6.9, every finding has been:

- Fixed in code (Step 4)
- Verified by codex (Step 5)
- Documented in the pattern KB (6.1–6.4)
- Committed atomically (6.5–6.6)
- Pushed (6.7)
- Replied to on the connector side (6.8)
- Marked resolved in GraphQL (6.9)

The cycle is now done. Proceed to Step 7.

## Step 7: Exit check + retro prompt

After Step 6 commits + pushes (or after Step 3 returns `EXIT_CLEAN` / `POLL_NEXT`), determine if the loop continues or exits.

### 7.1: Check connector unresolved threads via GraphQL

Reuse the `paginated_review_threads_query` helper defined in Step 2B (no separate inline GraphQL query — that would re-introduce the unpaginated-bounded-query bug):

```bash
UNRESOLVED_CONNECTOR_THREADS=$(paginated_review_threads_query \
  | jq '[.[] | select(.comment_author_login == "chatgpt-codex-connector[bot]"
                      and .isResolved == false)] | length')
```

If this number is > 0, the connector still has unresolved findings (either from this cycle's work that didn't fully resolve, or from a fresh review that just landed).

### 7.2: Check Claude verdict on the latest comment

After Step 6's push, the Claude reviewer will re-run on the new commit. The verdict on its NEW comment determines if Claude is satisfied. If we're at this step right after a fresh commit, the new Claude review hasn't run yet — that's the "poll-next" case.

### 7.3: Decide

- **All clean** = `UNRESOLVED_CONNECTOR_THREADS == 0` AND latest Claude comment verdict is `is_claude_clean` → **exit clean** (regardless of round number).
- **More expected** = either reviewer hasn't reported on the new commit yet → **poll next** (if `ROUND < MAX_ROUNDS`) or fall through to the next bullet.
- **Max rounds reached** = `ROUND == MAX_ROUNDS` AND clean condition NOT met → exit "max rounds" (abnormal — print warning).

### 7.4: Poll-next sub-flow

```bash
echo "Round $ROUND committed — polling for next review (60s × 10 rounds)."

for poll_attempt in $(seq 1 10); do
  sleep 60
  # Re-poll Claude and connector exactly as Step 2.
  # If new finding(s) appear (cases 2/3/4/5), break and either continue cycle or loud-fail.
  if step_2_yields_new_content; then
    ROUND=$((ROUND + 1))
    goto_step_2
  fi
done

echo "No new review after 10×60s — exiting loop."
goto_step_7_clean_exit_message
```

### 7.5: Clean exit message + retro prompt

```bash
cat <<EOF
✅ Review loop complete after $ROUND rounds.

  Findings processed: $TOTAL_FIXED (fixed) / $TOTAL_SKIPPED (skipped)
  Pattern files touched: $TOTAL_PATTERN_FILES
  Connector threads resolved: $TOTAL_THREADS_RESOLVED

Want a retrospective written for this cycle?

  • If your environment has a /write-retro skill: run \`/write-retro PR$PR_NUMBER\`
  • Otherwise: write manually at
      docs/reviews/retrospectives/$(date -I)-<your-topic>.md
    using the format from prior retros (e.g.
    docs/reviews/retrospectives/2026-04-29-tests-panel-bridge-session.md)

Skip if the cycle was uneventful.
EOF

# Run cleanup before exit (§6.1 success path).
cleanup_on_clean_exit
```

### 7.6: Abnormal exit message

For max-rounds, abort, or poll-timeout:

```bash
cat <<EOF >&2
⚠️ Loop exited at round $ROUND because $REASON.

  Incident report: $ABORT_DIR/incident.md
  Last verify result: .harness-github-review/cycle-${ROUND}-verify-result.json

Recommended next step: $(human_guidance_for_reason "$REASON")

Once the cycle is unstuck, consider /write-retro (if available) or a
manual retrospective — incident retros are highest-signal entries in
docs/reviews/retrospectives/.
EOF

# DO NOT auto-cleanup on abnormal exit — preserve forensics.
exit 1
```

The skill **does NOT auto-write retros**. Synthesis needs hindsight; mandatory low-value retros pollute the directory.

## Cleanup, recovery & failsafe

### Per-cycle artifact lifecycle

The skill writes `cycle-${ROUND}-*` files to `.harness-github-review/` (gitignored): `cycle-${ROUND}-diff.patch`, `cycle-${ROUND}-verify-prompt.md`, `cycle-${ROUND}-verify-result.json`, `cycle-${ROUND}-verify-events.log`, `cycle-${ROUND}-verify-stderr.log`. On abort, also `cycle-${ROUND}-aborted/`.

| Event                                                                                               | Action                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Round N commits OK, loop continuing to N+1                                                          | **Keep** N's artifacts. Next round may compare.                                                                                                                                                                                                                                                              |
| Round N aborts → loop exits                                                                         | **Preserve everything** in `.harness-github-review/`. Print recovery instructions (below).                                                                                                                                                                                                                   |
| Loop exits cleanly (final round verdict clean)                                                      | `cleanup_on_clean_exit`: wipe non-aborted `cycle-*-{diff,verify-prompt,verify-result,verify-events,verify-stderr}.{patch,md,json,log}` files. **Preserve any `cycle-*-aborted/` dirs** from earlier rounds in this run. Print "cleaned N artifact files from this run".                                      |
| New `/harness-plugin:github-review` invocation, `.harness-github-review/` already has prior content | **Scan first.** If any `cycle-*-aborted/` dirs found from prior loops → **prompt user**: list paths, suggest inspecting, do NOT auto-delete. Skill exits without starting a new loop. If only orphaned `cycle-*` files exist → wipe with one-line "cleaned N stale files from prior run" notice and proceed. |

The "scan-on-loop-start, prompt-don't-delete" rule for prior aborted dirs is the **load-bearing forensics guarantee**: aborted dirs are the evidence we need when the loop failed in a confusing way. Auto-deleting violates the loud-fail / preserve-forensics posture.

```bash
loop_start_scan() {
  if [ ! -d .harness-github-review ]; then return 0; fi

  local aborted_dirs
  aborted_dirs=$(find .harness-github-review -maxdepth 1 -type d -name 'cycle-*-aborted' 2>/dev/null)

  if [ -n "$aborted_dirs" ]; then
    echo "Found prior aborted cycle(s):" >&2
    echo "$aborted_dirs" | sed 's/^/  /' >&2
    echo "" >&2
    echo "Inspect each cycle-*-aborted/incident.md before continuing." >&2
    echo "Once resolved, remove them with: rm -rf .harness-github-review/cycle-*-aborted/" >&2
    echo "Then re-run /harness-plugin:github-review." >&2
    exit 1
  fi

  # Wipe orphan non-aborted artifacts.
  local orphans
  orphans=$(find .harness-github-review -maxdepth 1 -type f -name 'cycle-*' 2>/dev/null | wc -l)
  if [ "$orphans" -gt 0 ]; then
    find .harness-github-review -maxdepth 1 -type f -name 'cycle-*' -delete
    echo "Cleaned $orphans stale artifact files from prior run."
  fi
}

cleanup_on_clean_exit() {
  if [ ! -d .harness-github-review ]; then return 0; fi

  local count=0
  while IFS= read -r f; do
    rm -f "$f"
    count=$((count + 1))
  done < <(find .harness-github-review -maxdepth 1 -type f -name 'cycle-*')

  if [ "$count" -gt 0 ]; then
    echo "Cleaned $count artifact files from this run."
  fi

  # Aborted dirs (if any) are preserved.
}
```

`loop_start_scan` runs at the start of Step 1 (BEFORE input resolution). `cleanup_on_clean_exit` runs in Step 7.5.

### No `git stash`, by design

The skill does NOT auto-`git stash`. Reasons:

1. **Working-tree visibility.** Auto-hiding contradicts loud-fail discipline.
2. **Loop state lives elsewhere.** Persistent state is GitHub + commit trailers. Abort artifacts are `.harness-github-review/cycle-*-aborted/`. Stash would be a third surface.
3. **Stash is user-controlled.** A parking lot for the user's own workflow needs.

Stash is documented as one of three explicit user-driven recovery paths (below), not an automatic step.

### Three recovery paths on abort

The skill prints all three in §3.7's exit message:

```
Cycle ${ROUND} aborted in verify after ${RETRY_COUNT} attempts.
See ${ABORT_DIR}/.

Working tree contains the last attempted fix.

  # Inspect first:
  git status
  git diff
  git diff --staged

Choose ONE recovery path:

  # 1. Discard the attempt entirely
  git restore --staged .
  git restore .
  # Then remove only the untracked paths listed in:
  #   ${ABORT_DIR}/untracked.txt
  # Review that file before any rm — do NOT run a blanket `git clean -fd`.

  # 2. Keep & finish manually
  # (edit files, then `git add` and `git commit` yourself)

  # 3. Snapshot the attempt as a stash for later
  git stash push -u -m "github-review cycle ${ROUND} aborted attempt"
  # Restore later with: git stash pop
```

Notes on path 1:

- `git restore --staged . && git restore .` reverts both index and working-tree mods, including staged deletions (which `git checkout -- .` misses).
- Untracked-file removal is **per-path from `untracked.txt`**, not blanket `git clean -fd`. Blanket clean risks deleting unrelated work.

### Pattern-file rollback is N/A

Pattern appends only happen if the cycle's commit succeeds (§4 atomicity). On abort, attempted appends are still in working tree alongside the code fix — discarded by recovery path 1, kept by paths 2/3.

### Watermark trailers are durable

Trailers live in committed history; nothing to clean. If the entire fix commit needs to be undone (`git reset HEAD~1`), the trailers vanish with the commit and the next cycle re-derives a smaller processed set. Self-healing.

### Manual full reset

```bash
rm -rf .harness-github-review/
```

Safe because gitignored. Wipes all artifacts including aborted dirs. User invokes only after resolving aborted dirs.
