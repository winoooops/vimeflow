# Parsing Rules — Step 2 (Claude + Codex Connector + Human)

This file is the implementation reference for **Step 2** of `../SKILL.md`. The
orchestrator polls three reviewer surfaces — Claude Code Review (aggregated
issue comments), the chatgpt-codex-connector (PR-level review summaries +
inline comments), and human reviewers (issue + inline comments) — then parses
their bodies into a unified `Finding` table for Step 3 to classify and Step 4
to fix.

Section headings here map to SKILL.md's Step 2 subsections.

## Step 2A — Claude reviewer (issue comments, aggregated, no threads)

The Claude Code Review GitHub Action emits a single aggregated `## Claude
Code Review` comment per run. Every fresh comment supersedes prior comments
for the same diff. Therefore: take the **latest unprocessed** comment, mark
older unprocessed comments as superseded.

### Poll

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

# Derive the scalar comment ID for the Step 6.6 commit-trailer template.
# Without this, GitHub-Review-Processed-Claude in the trailer is always blank,
# Step 1's extract_trailer returns empty, CLAUDE_HANDLED_IDS stays empty, and
# the next cycle re-processes the same already-fixed Claude comment as new.
LATEST_CLAUDE_ID=$(jq -r 'if . == null then "" else (.id | tostring) end' <<< "$LATEST_CLAUDE")

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

Note `startswith` (not `contains`) — avoids matching human comments that
quote the header.

### Body shape

Verified on PR #109:

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

Findings are split on `---` between the title section and the verdict
footer.

### Per-finding regex table

| Field        | Regex / extraction                                                                | Notes                                      |
| ------------ | --------------------------------------------------------------------------------- | ------------------------------------------ |
| `severity`   | `### .* \[(\w+)\]` → group 1                                                      | One of `CRITICAL`, `HIGH`, `MEDIUM`, `LOW` |
| `title`      | Same line, after `]`, trimmed to end-of-line                                      |                                            |
| `file`       | `` 📍 `([^`]+)` `` → group 1, then path-normalize (below)                         | Sandbox abs-path; resolve to repo-relative |
| `line_range` | `L(\d+)-(\d+)` → start, end                                                       |                                            |
| `body`       | Text between the `🎯 Confidence` line and `<details>` (or `---` if no IDEA block) |                                            |

### Path normalization

Claude reports paths as runner-sandbox absolutes (e.g.
`/home/runner/work/vimeflow/vimeflow/src/foo.tsx`). Resolve to repo-relative
deterministically. Loud-fail if no resolution exists — never silently
fall back to `parts[-1]`.

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

### Verdict regex (used for "review is clean" exit detection)

```python
CLAUDE_VERDICT_PATTERNS = [
    r'(?im)^\s*\*\*Overall:\s*✅\s*patch is correct\*\*',
    r'(?im)^\s*Overall:\s*✅\s*patch is correct\b',
]
def is_claude_clean(body: str) -> bool:
    return any(re.search(p, body) for p in CLAUDE_VERDICT_PATTERNS)
```

Anchored to start-of-line; refuses to match quoted/embedded references
inside finding bodies.

## Step 2B — Codex connector reviewer (PR review summary + inline comments)

The connector posts on two surfaces:

1. `/pulls/{pr}/reviews` — summary review with body `### 💡 Codex Review`
2. `/pulls/{pr}/comments` — inline file-level comments with `**P1/P2 Badge** Title` body

**Inline comments are the actionable findings.** Summary reviews are used
only for the "is this run clean" verdict signal.

### Two-step poll

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

### Race retry — review summary appears before inline comments are queryable

Per unprocessed review, fetch its inline comments. If empty, distinguish
"summary explicitly clean (no inline expected)" from "race in progress".

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

### Inline comment body shape

Verified on PR #109:

```
**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  <Title>**

<Description>

Useful? React with 👍 / 👎.
```

Top-level fields (no body parsing required for these): `id`, `path`,
`original_line`, `pull_request_review_id`.

### Body parse table

| Field      | Regex / extraction                                            | Notes                                                                                                                                           |
| ---------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `severity` | `!\[(P\d) Badge\]` → group 1                                  | `P1` → internal `HIGH`; `P2` → internal `MEDIUM`. Original label preserved in pattern entry's `Severity:` field as `P1 / HIGH` / `P2 / MEDIUM`. |
| `title`    | `\*\*<sub>.*?</sub>\s+(.+?)\*\*` → group 1, trimmed           |                                                                                                                                                 |
| `body`     | Text between the title line and `Useful? React with 👍 / 👎.` |                                                                                                                                                 |

### Thread ID lookup

REST does not return thread IDs, so we query GraphQL. Implementation **must
be page-aware** via `paginated_review_threads_query` (defined in
`../scripts/helpers.sh`):

```bash
# Step 2 usage: build inline-comment-id → thread-id map.
# Loud-fail on GraphQL failure — silent empty-array would silently miss every
# thread mapping and either trigger a downstream loud-fail at lookup or, worse,
# pass through with an empty INLINE_TO_THREAD_MAP. Better to surface the
# transient GraphQL error here.
ALL_THREAD_COMMENTS=$(paginated_review_threads_query) || {
  echo "ERROR: paginated_review_threads_query failed in Step 2B." >&2
  exit 1
}
# GraphQL strips the `[bot]` suffix from author logins (REST keeps it). Match
# on the bare login `chatgpt-codex-connector`. comment_author_type ("Bot" |
# "User") is also available from the helper for filtering when the login is
# unknown ahead of time.
INLINE_TO_THREAD_MAP=$(jq '[.[] | select(.comment_author_login == "chatgpt-codex-connector")
                            | {thread_id, comment_id: .comment_databaseId, isResolved}]' \
                          <<< "$ALL_THREAD_COMMENTS")
```

After all pages exhausted: any connector inline-comment ID not present in
`INLINE_TO_THREAD_MAP` is a loud error (`"connector inline comment {id} not
found in any review thread — data state anomaly"`).

The mapping table is consumed in Step 6 (reply + resolve threads). Step 7.1
reuses `paginated_review_threads_query` for the unresolved-thread exit
check.

## Step 2D — Human reviewers (issue comments + inline review comments)

Humans (project maintainers, contributors, the PR author themselves) leave
unstructured prose comments on PRs. The skill treats any non-bot author as a
human reviewer and processes their comments as findings. Two endpoints:

1. `/issues/{pr}/comments` — top-level PR-conversation comments (no file context).
2. `/pulls/{pr}/comments` — inline review comments (have `path` and `original_line`).

(The `/pulls/{pr}/reviews` endpoint also accepts human reviews, but the
bodies are typically empty wrappers around the inline comments. The
actionable content lives in the inline-comments endpoint, which we already
poll. Skip the reviews endpoint to avoid duplicates.)

### Poll human issue comments

The skill itself authenticates as a human GitHub user (the gh CLI's auth) and
posts replies in Step 6.8. Those replies show up as user-authored comments on
later cycles, so the poll must EXCLUDE skill-authored bodies. The reliable
marker is the `(github-review cycle <N>, finding F<K>)` footer that every
Step 6.8 reply emits — a stable signature this skill always writes.

```bash
PROCESSED_HUMAN_ISSUE_JSON=$(jq -R 'split(",") | map(select(length > 0) | tonumber)' <<< "$PROCESSED_HUMAN_ISSUE_IDS")

NEW_HUMAN_ISSUE_JSON=$(gh api "repos/$REPO/issues/$PR_NUMBER/comments" --paginate \
  | jq -s --argjson done "$PROCESSED_HUMAN_ISSUE_JSON" '
    add | [.[] | select(
      (.user.type // "User") == "User"
      and (.id as $id | $done | index($id) | not)
      and ((.body // "") | contains("(github-review cycle ") | not)
    )]')
```

### Poll human inline comments

```bash
PROCESSED_HUMAN_INLINE_JSON=$(jq -R 'split(",") | map(select(length > 0) | tonumber)' <<< "$PROCESSED_HUMAN_INLINE_IDS")

NEW_HUMAN_INLINE_JSON=$(gh api "repos/$REPO/pulls/$PR_NUMBER/comments" --paginate \
  | jq -s --argjson done "$PROCESSED_HUMAN_INLINE_JSON" '
    add | [.[] | select(
      (.user.type // "User") == "User"
      and (.id as $id | $done | index($id) | not)
      and ((.body // "") | contains("(github-review cycle ") | not)
    )]')
```

The `contains("(github-review cycle ")` check is a string-prefix match, robust
to the rest of the marker varying (e.g. cycle number / finding ID changes).
The marker is asserted in `commit-trailers.md` § Step 6.8 — every fixed and
skipped reply carries it.

Note: human inline comments don't go through the unprocessed-review-id
filter (humans submit them directly, often without a review wrapper). The
connector inline poll filters by `pull_request_review_id IN
$unprocessed_review_ids`; humans get a simpler "unprocessed comment id"
filter.

### Parse — unstructured

Humans don't follow the `### [HIGH] Title` format. Treat each comment as a
single finding:

- `severity_internal`: **MEDIUM** by default (humans don't tag severity;
  assume actionable unless body explicitly says LOW/nit/wontfix).
- `severity_label_original`: `"HUMAN"` (preserved for pattern entry).
- `title`: first sentence of body (regex `^(.{1,80}?)(?:[.!?\n]|$)`),
  truncated to 80 chars max.
- `file`: top-level `path` field for inline; `null` for issue comments.
- `line_range`: `{start: original_line, end: original_line}` for inline;
  `{start: 1, end: 1}` for issue (placeholder).
- `body`: raw comment text (markdown preserved).
- `source`: `'human'`.
- `source_comment_id`: comment `id`.
- `thread_id`: for inline only — looked up via
  `paginated_review_threads_query` (same helper as connector). Issue
  comments have no thread.

### Heuristic severity overrides

Optional, applied after default MEDIUM. If the body matches one of these,
downgrade or upgrade:

- Body starts with `nit:`, `style:`, `optional:` (case-insensitive) → LOW
- Body contains `WONTFIX`, `wontfix`, `won't fix` → SKIP candidate (record
  `severity_internal: LOW` and let Step 4 default to skipped)
- Body explicitly says `[CRITICAL]`, `[HIGH]`, `[MEDIUM]`, `[LOW]` (e.g.
  when humans copy the format) → use that

### Empty-state classification additions

Human findings are case 2 if any non-empty parsed finding exists. Cases 4/5
don't apply to human comments — humans aren't required to follow a parser
format, so an "unparseable" human comment is just "treat the body verbatim
as MEDIUM". See `empty-state-classification.md` for the case table.

## Step 2C — Finding-table aggregation

After Steps 2A + 2B + 2D, build the per-cycle finding table. The table is
**transient** (in-memory only — not persisted; see SKILL.md key invariants).
Human findings receive `severity_internal: 'MEDIUM'` by default; the skill
applies heuristic overrides per Step 2D.

```typescript
type Finding = {
  cycle_id: string // "F1", "F2", ... — stable for this cycle, used in verify prompt
  source: 'claude' | 'codex-connector' | 'human'
  source_comment_id: number // Claude: comment ID. Connector: inline comment ID. Human: issue or inline comment ID.
  source_review_id: number | null // Connector only
  thread_id: string | null // Connector + human inline only (PRRT_xxx form); null for human issue comments
  severity_internal: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  severity_label_original: string // e.g. "HIGH" or "P1 / HIGH" or "HUMAN" (preserved for pattern entry)
  title: string
  file: string | null // repo-relative; null for human issue comments (no file context)
  line_range: { start: number; end: number }
  body: string
  status: 'pending' | 'fixed' | 'skipped' | 'verify_failed'
  fix_summary: string | null // populated after Step 4
}
```

Build the table by iterating Claude findings (if `LATEST_CLAUDE` is non-null
and parsing succeeded), connector inline findings (everything in the
post-race-retry inline set), and human findings (issue comments + inline
comments from Step 2D), assigning sequential `cycle_id` strings (`F1`, `F2`,
...).

The table is consumed by:

- Step 3 — classification (see `empty-state-classification.md`)
- Step 4 — fix loop (SKILL.md)
- Step 5 — verify prompt (see `verify-prompt.md`)
- Step 6 — commit message + pattern routing (see `pattern-kb.md`,
  `commit-trailers.md`)
