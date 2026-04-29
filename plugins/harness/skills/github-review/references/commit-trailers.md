# Commit Trailers — Step 6.6 + Step 1 Reconciliation

This file is the implementation reference for **Step 6.6** (commit-message
template) of `../SKILL.md` and the trailer-driven watermark schema that
Step 1 reads back via `extract_trailer` (in `../scripts/helpers.sh`).

State persistence for the loop lives in **commit-message trailers** — there
is no `.json` state file. Each cycle's commit carries the trailer keys
listed below; the next cycle reads them out of `git log "$PR_BASE..HEAD"`
to know which findings have already been processed.

**Key invariant (asserted in SKILL.md):** state persistence is via
commit-message trailers — no `.json` state file. If the entire fix commit
needs to be undone (`git reset HEAD~1`), the trailers vanish with the
commit and the next cycle re-derives a smaller processed set. Self-healing.

## Trailer schema

| Trailer key                             | Value shape            | Written by                            | Read by                                                                |
| --------------------------------------- | ---------------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| `GitHub-Review-Processed-Claude`        | int (single comment)   | Step 6.6                              | Step 1 → `PROCESSED_CLAUDE_IDS`                                        |
| `GitHub-Review-Superseded-Claude`       | comma-separated ints   | Step 6.6                              | Step 1 → `SUPERSEDED_CLAUDE_IDS`                                       |
| `GitHub-Review-Processed-Codex-Reviews` | comma-separated ints   | Step 6.6                              | Step 1 → `PROCESSED_CODEX_REVIEW_IDS`                                  |
| `GitHub-Review-Processed-Codex-Inline`  | comma-separated ints   | Step 6.6                              | Step 1 → `PROCESSED_CODEX_INLINE_IDS`                                  |
| `GitHub-Review-Processed-Human-Issue`   | comma-separated ints   | Step 6.6                              | Step 1 → `PROCESSED_HUMAN_ISSUE_IDS`                                   |
| `GitHub-Review-Processed-Human-Inline`  | comma-separated ints   | Step 6.6                              | Step 1 → `PROCESSED_HUMAN_INLINE_IDS`                                  |
| `Closes-Codex-Threads`                  | comma-separated PRRT\_ | Step 6.6 (BEFORE 6.8/6.9 run)         | Step 1 → `CLOSED_CODEX_THREADS`; reconciled against live GraphQL state |
| `Pattern-Files-Touched`                 | multi-line, indented   | Step 6.6                              | Step 1 (informational); used by retros                                 |
| `Pattern-Append-Decisions:` (block)     | multi-line list        | Step 6.6                              | Step 1 (informational)                                                 |
| `Verify-Deferred-LOW`                   | comma-separated str    | Step 6.6 (only if pass_with_deferred) | Step 1 (informational); deferred LOW issues to address later           |
| `Verify-Skipped`                        | "docs-only"            | Step 6.6 (only if VERIFY_SKIPPED=1)   | Step 1 (informational); marker for docs-only escape                    |

## Step 1 — Reading trailers back via `extract_trailer`

```bash
PROCESSED_CLAUDE_IDS=$(extract_trailer "GitHub-Review-Processed-Claude")
SUPERSEDED_CLAUDE_IDS=$(extract_trailer "GitHub-Review-Superseded-Claude")
PROCESSED_CODEX_REVIEW_IDS=$(extract_trailer "GitHub-Review-Processed-Codex-Reviews")
PROCESSED_CODEX_INLINE_IDS=$(extract_trailer "GitHub-Review-Processed-Codex-Inline")
CLOSED_CODEX_THREADS=$(extract_trailer "Closes-Codex-Threads")
PROCESSED_HUMAN_ISSUE_IDS=$(extract_trailer "GitHub-Review-Processed-Human-Issue")
PROCESSED_HUMAN_INLINE_IDS=$(extract_trailer "GitHub-Review-Processed-Human-Inline")

# Claude side: union of processed and superseded.
CLAUDE_HANDLED_IDS=$(printf '%s,%s' "$PROCESSED_CLAUDE_IDS" "$SUPERSEDED_CLAUDE_IDS" | tr ',' '\n' | awk 'NF' | sort -u | tr '\n' ',' | sed 's/,$//')
```

`extract_trailer` is defined in `../scripts/helpers.sh`. It supports the
multi-line continuation form documented below for `Pattern-Files-Touched:`
— continuation lines indented under a trailer key are concatenated as
additional values for that key.

## Step 1 — Reconciliation against live GitHub state

Step 6 writes the `Processed-Codex-Inline` + `Closes-Codex-Threads`
trailers BEFORE Step 6.8 (reply) and 6.9 (`resolveReviewThread`) run. If
push succeeds but reply/resolve fails (transient network glitch, GitHub
API hiccup), the trailer says "closed" but GitHub disagrees — the next
cycle would skip the comment as processed yet Step 7 would see the thread
still unresolved, looping forever.

**Lazy reconciliation:** cross-check the trailer against live GraphQL state
and drop stale entries from the processed set so the cycle re-attempts
them. (Per the auto-memory **lazy reconciliation over shutdown hooks**
rule: don't rely on a Step 6 shutdown ordering to keep the trailer in sync;
reconcile on the next read instead.)

```bash
if [ -n "$CLOSED_CODEX_THREADS" ]; then
  # paginated_review_threads_query is defined in ../scripts/helpers.sh.
  LIVE_THREAD_STATE=$(paginated_review_threads_query 2>/dev/null || echo "[]")

  # Find thread IDs in trailer that are still unresolved on GitHub.
  STALE_THREAD_IDS=$(jq -n \
    --argjson live "$LIVE_THREAD_STATE" \
    --arg trailer "$CLOSED_CODEX_THREADS" '
    ($trailer | split(",") | map(select(length > 0))) as $claimed_closed
    | [$live[] | select(.isResolved == false and (.thread_id as $tid | $claimed_closed | index($tid)))]
    | [.[] | .thread_id]
    | unique
  ')

  if [ "$(jq 'length' <<< "$STALE_THREAD_IDS")" -gt 0 ]; then
    echo "Reconciliation: $(jq 'length' <<< "$STALE_THREAD_IDS") threads in Closes-Codex-Threads trailer are still unresolved on GitHub." >&2
    echo "Treating them as un-processed; this cycle will re-attempt reply + resolve." >&2

    # Find inline comment IDs whose thread is in STALE_THREAD_IDS, so we can
    # remove them from PROCESSED_CODEX_INLINE_IDS.
    STALE_COMMENT_IDS=$(jq -r --argjson live "$LIVE_THREAD_STATE" --argjson stale "$STALE_THREAD_IDS" '
      [$live[] | select(.thread_id as $tid | $stale | index($tid)) | .comment_databaseId | tostring] | join(",")
    ')

    if [ -n "$STALE_COMMENT_IDS" ]; then
      # Subtract STALE_COMMENT_IDS from PROCESSED_CODEX_INLINE_IDS.
      PROCESSED_CODEX_INLINE_IDS=$(printf '%s\n%s\n' "$PROCESSED_CODEX_INLINE_IDS" "$STALE_COMMENT_IDS" \
        | tr ',' '\n' | awk 'NF' | sort -u \
        | grep -vxFf <(echo "$STALE_COMMENT_IDS" | tr ',' '\n' | awk 'NF') \
        | tr '\n' ',' | sed 's/,$//')
    fi

    # Also reconcile PROCESSED_CODEX_REVIEW_IDS — the parent review IDs
    # of the stale inline comments need to come out of the processed-review
    # set, otherwise the Step 2B inline-comment poll's review-id filter
    # rejects the inline before our inline-id subtraction takes effect.
    STALE_REVIEW_IDS=$(jq -r --argjson live "$LIVE_THREAD_STATE" --argjson stale "$STALE_THREAD_IDS" '
      [$live[] | select(.thread_id as $tid | $stale | index($tid))
               | .pull_request_review_id // empty
               | tostring]
      | unique
      | join(",")
    ')

    if [ -n "$STALE_REVIEW_IDS" ]; then
      PROCESSED_CODEX_REVIEW_IDS=$(printf '%s\n%s\n' "$PROCESSED_CODEX_REVIEW_IDS" "$STALE_REVIEW_IDS" \
        | tr ',' '\n' | awk 'NF' | sort -u \
        | grep -vxFf <(echo "$STALE_REVIEW_IDS" | tr ',' '\n') \
        | tr '\n' ',' | sed 's/,$//')
    fi

    # Subtract stale thread IDs from CLOSED_CODEX_THREADS so Step 6's
    # eventual close-set rebuild doesn't double-count.
    CLOSED_CODEX_THREADS=$(printf '%s\n' "$CLOSED_CODEX_THREADS" \
      | tr ',' '\n' | awk 'NF' \
      | grep -vxFf <(jq -r '.[]' <<< "$STALE_THREAD_IDS") \
      | tr '\n' ',' | sed 's/,$//')
  fi
fi
```

The four `*_IDS` variables become inputs to Step 2's poll filtering. They
feed `jq --argjson` calls as JSON arrays — convert via `jq -R 'split(",")
| map(select(length > 0))' <<< "$VAR"` at the call site.

## Step 6.6 — Commit-message template

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
GitHub-Review-Processed-Human-Issue: $(list_human_issue_ids_processed_this_cycle)
GitHub-Review-Processed-Human-Inline: $(list_human_inline_ids_processed_this_cycle)
Closes-Codex-Threads: $(list_thread_ids_to_close)
Pattern-Files-Touched:
$(render_pattern_files_touched_indented)
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

## Cycle-1 commitlint fixes

Two frictions surfaced by cycle 1 of the dogfood (commit `ebd7eff`) are
folded into the template above:

### 1. `Pattern-Files-Touched:` line length

When 3+ patterns are touched, the single-line comma-separated form
frequently exceeds commitlint's 100-char body-line limit:

```
Pattern-Files-Touched: docs/reviews/patterns/foo.md, docs/reviews/patterns/bar.md, docs/reviews/patterns/baz.md
```

**Fix: emit one path per indented continuation line** under the trailer
key:

```
Pattern-Files-Touched:
  docs/reviews/patterns/foo.md
  docs/reviews/patterns/bar.md
  docs/reviews/patterns/baz.md
```

`render_pattern_files_touched_indented` should emit each path with a
leading two-space indent (one path per line). `extract_trailer` in
`../scripts/helpers.sh` handles the multi-line continuation: lines
indented beneath a trailer key (no colon-after-key, not blank) are
concatenated under the same trailer key.

Multi-line full paths are clearer for humans than basenames-only; the
trade-off (parsing complexity) is absorbed by the helper.

### 2. `footer-leading-blank` warning

Conventional commits expects a blank line between the body and the trailer
block. The cycle-1 template put `Reviewers: ...` directly above the
`GitHub-Review-*` block, which commitlint's `footer-leading-blank` rule
flagged.

**Fix:** ensure a blank line precedes the trailer block. Concretely: the
HEREDOC above places `Reviewers: ...` (which is the body's last paragraph
boundary), then **one blank line**, then the `GitHub-Review-*` keys begin.
The HEREDOC syntax in the template above produces this correctly because
the `$(render_per_finding_listing)` output ends with a newline and is
followed by `\n\nReviewers: ...\n\nGitHub-Review-Processed-Claude: ...`.

When tweaking the template, verify with `git log -1 --format='%B' | tail
-30` that the visible structure is:

```
<body paragraph>

Reviewers: <list>

GitHub-Review-Processed-Claude: <id>
...
```

(Blank line before the first trailer key.)

## Step 6.8 — Reply (full implementation)

After the commit lands and is pushed (so the cited `COMMIT_SHA` exists on
origin), reply to every fixed AND skipped finding so reviewers see the
disposition before Step 6.9 resolves threads. Both fixed and skipped
findings get a reply — skipped findings need a rationale on the thread
before 6.9 resolves it; otherwise Step 7's unresolved-threads check would
never reach exit-clean.

Three branches share the body shape and differ only in source filter,
endpoint, and whether the original body is quoted. Branch 3 uses a NEW
issue-level comment (not a thread-reply) — there is no thread-reply
endpoint for issue comments. The quote prefix gives reviewers context
since the comment is detached from the original thread:

| Branch | Filter                                 | Endpoint                                                   | Body prefix                                |
| ------ | -------------------------------------- | ---------------------------------------------------------- | ------------------------------------------ |
| 1      | `.source == "codex-connector"`         | `POST /repos/$REPO/pulls/$PR/comments/$COMMENT_ID/replies` | none                                       |
| 2      | `.source == "human" and .file != null` | same as branch 1 (thread-reply on `/pulls/comments`)       | none                                       |
| 3      | `.source == "human" and .file == null` | `POST /repos/$REPO/issues/$PR/comments` (new issue-level)  | `> <first 200 chars of original body>\n\n` |

Body core (after the optional prefix):

- Fixed: `Fixed in <COMMIT_SHA> — <FIX_SUMMARY>\n\n(github-review cycle <ROUND>, finding <CYCLE_ID>)`
- Skipped: `Skipped — <FIX_SUMMARY>\n\n(github-review cycle <ROUND>, finding <CYCLE_ID>)`

Iterate via `while IFS= read -r finding; do ...; done < <(jq -c '...' <<<
"$FINDINGS_JSON")` (process substitution). The `for finding in $(jq -c
...)` form would word-split JSON objects containing spaces inside
titles/bodies and produce malformed input to `jq -r '.foo' <<<
"$finding"` calls.

```bash
while IFS= read -r finding; do
  COMMENT_ID=$(jq -r '.source_comment_id' <<< "$finding")
  CYCLE_ID=$(jq -r '.cycle_id' <<< "$finding")
  STATUS=$(jq -r '.status' <<< "$finding")
  FIX_SUMMARY=$(jq -r '.fix_summary // ""' <<< "$finding")
  ORIG_BODY=$(jq -r '.body' <<< "$finding")
  SOURCE=$(jq -r '.source' <<< "$finding")
  FILE=$(jq -r '.file' <<< "$finding")

  # Build reply body.
  if [ "$SOURCE" = "human" ] && [ "$FILE" = "null" ]; then
    QUOTE_PREFIX=$(printf '> %s\n\n' "$(printf '%s' "$ORIG_BODY" | head -c 200)")
  else
    QUOTE_PREFIX=""
  fi
  if [ "$STATUS" = "fixed" ]; then
    BODY_CORE=$(printf 'Fixed in %s — %s\n\n(github-review cycle %s, finding %s)' \
      "$COMMIT_SHA" "$FIX_SUMMARY" "$ROUND" "$CYCLE_ID")
  else
    BODY_CORE=$(printf 'Skipped — %s\n\n(github-review cycle %s, finding %s)' \
      "$FIX_SUMMARY" "$ROUND" "$CYCLE_ID")
  fi
  REPLY_BODY="${QUOTE_PREFIX}${BODY_CORE}"

  # Post via the right endpoint.
  if [ "$SOURCE" = "human" ] && [ "$FILE" = "null" ]; then
    gh api -X POST "repos/$REPO/issues/$PR_NUMBER/comments" -f body="$REPLY_BODY"
  else
    gh api -X POST "repos/$REPO/pulls/$PR_NUMBER/comments/${COMMENT_ID}/replies" \
      -f body="$REPLY_BODY"
  fi
done < <(jq -c '.[] | select(
  ((.source == "codex-connector") or (.source == "human"))
  and (.status == "fixed" or .status == "skipped")
)' <<< "$FINDINGS_JSON")
```

## Cross-references

- **Helpers** — see `../scripts/helpers.sh` (defines `extract_trailer`
  with multi-line continuation support and
  `paginated_review_threads_query`).
- **Step 6.1–6.4 pattern KB integration** — see `pattern-kb.md` (defines
  what gets recorded in `Pattern-Append-Decisions:` and
  `Pattern-Files-Touched:`).
- **Step 5 verify outputs** — see `verify-prompt.md` (defines
  `VERIFY_DEFERRED_LOW` and `VERIFY_SKIPPED`).
