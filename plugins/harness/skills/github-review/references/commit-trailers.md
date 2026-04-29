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
  # paginated_review_threads_query (defined in ../scripts/helpers.sh) returns
  # non-zero on GraphQL errors via _assert_graphql_response_ok (cycle 3
  # hardening). DO NOT silence stderr or swallow that failure with
  # `2>/dev/null || echo "[]"` — the silence would discard the diagnostic
  # that tells the operator why the loop later exits with `poll-timeout`,
  # AND would mask the very deadlock case reconciliation exists to catch
  # (trailer says "closed" but GitHub disagrees, stale IDs block re-fetch
  # on every subsequent cycle until poll exhausts indefinitely).
  #
  # Trade-off considered:
  #   (a) Let it propagate (no fallback) → set -euo pipefail aborts the
  #       cycle on a transient blip. Safest, but a one-off GitHub hiccup
  #       forces the user to re-run.
  #   (b) Catch + log loud + skip reconciliation for this cycle.
  #       Less safe (a real drift might be missed for one cycle) but more
  #       resilient to transient blips. The next cycle's reconciliation
  #       catches any lingering drift if the API is healthy then.
  # We pick (b): degrade to empty live state with an explicit, audible
  # warning to stderr so operators see WHY reconciliation was skipped.
  if ! LIVE_THREAD_STATE=$(paginated_review_threads_query); then
    echo "WARN: paginated_review_threads_query failed during reconciliation;" >&2
    echo "      skipping stale-thread reconciliation for this cycle." >&2
    echo "      _assert_graphql_response_ok diagnostics above explain the cause." >&2
    echo "      If the failure persists across cycles, manually verify trailer" >&2
    echo "      vs live state via:" >&2
    echo "        gh api graphql -f query='query(\$o:String!,\$n:String!,\$pr:Int!){repository(owner:\$o,name:\$n){pullRequest(number:\$pr){reviewThreads(first:100){nodes{id isResolved}}}}}' \\" >&2
    echo "          -F o=\"\$OWNER\" -F n=\"\$NAME\" -F pr=\"\$PR_NUMBER\"" >&2
    LIVE_THREAD_STATE="[]"
  fi

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

    # `Closes-Codex-Threads` is populated from `list_thread_ids_to_close`
    # (SKILL.md § Step 6.9), which includes BOTH connector (`source ==
    # "codex-connector"`) AND human-inline (`source == "human" and .file
    # != null`) findings. So `STALE_THREAD_IDS` may contain a mix of the
    # two. We split the stale comment IDs by author type — connector
    # comments are subtracted from `PROCESSED_CODEX_INLINE_IDS`, human
    # comments from `PROCESSED_HUMAN_INLINE_IDS`. Author type comes from
    # `LIVE_THREAD_STATE[i].comment_author_type` (`"Bot"` for the
    # connector via `__typename` mapping in helpers.sh,
    # `"User"` for humans).
    STALE_CONNECTOR_COMMENT_IDS=$(jq -r --argjson live "$LIVE_THREAD_STATE" --argjson stale "$STALE_THREAD_IDS" '
      [$live[] | select((.thread_id as $tid | $stale | index($tid))
                        and .comment_author_login == "chatgpt-codex-connector")
                | .comment_databaseId | tostring]
      | unique | join(",")
    ')
    STALE_HUMAN_COMMENT_IDS=$(jq -r --argjson live "$LIVE_THREAD_STATE" --argjson stale "$STALE_THREAD_IDS" '
      [$live[] | select((.thread_id as $tid | $stale | index($tid))
                        and .comment_author_type == "User")
                | .comment_databaseId | tostring]
      | unique | join(",")
    ')

    if [ -n "$STALE_CONNECTOR_COMMENT_IDS" ]; then
      # Subtract STALE_CONNECTOR_COMMENT_IDS from PROCESSED_CODEX_INLINE_IDS.
      # awk-based set-difference instead of `grep -vxFf` — `grep -v` exits 1
      # when ALL input lines match the filter (the primary case here: every
      # processed ID is stale), aborting under `set -euo pipefail`.
      PROCESSED_CODEX_INLINE_IDS=$(awk -v stale="$STALE_CONNECTOR_COMMENT_IDS" '
        BEGIN { n = split(stale, a, /,/); for (i = 1; i <= n; i++) if (a[i] != "") s[a[i]] = 1 }
        NF && !($0 in s) { print }
      ' < <(printf '%s\n' "$PROCESSED_CODEX_INLINE_IDS" | tr ',' '\n') \
        | sort -u | tr '\n' ',' | sed 's/,$//')
    fi

    if [ -n "$STALE_HUMAN_COMMENT_IDS" ]; then
      # Same shape as the connector subtraction above, applied to the human
      # surface. Without this, a failed human-inline reply/resolve leaves
      # the comment ID in PROCESSED_HUMAN_INLINE_IDS forever — Step 2D
      # excludes it on every subsequent cycle, Step 7.1 keeps seeing
      # UNRESOLVED_HUMAN_THREADS > 0, and the loop enters POLL_NEXT every
      # cycle until poll-timeout with no automated recovery path.
      # Human-inline findings have no parent review-ID surface (they're
      # not posted under a /pulls/{pr}/reviews wrapper from the operator's
      # perspective) so there's no human equivalent of
      # PROCESSED_CODEX_REVIEW_IDS — only the inline-ID subtraction.
      PROCESSED_HUMAN_INLINE_IDS=$(awk -v stale="$STALE_HUMAN_COMMENT_IDS" '
        BEGIN { n = split(stale, a, /,/); for (i = 1; i <= n; i++) if (a[i] != "") s[a[i]] = 1 }
        NF && !($0 in s) { print }
      ' < <(printf '%s\n' "$PROCESSED_HUMAN_INLINE_IDS" | tr ',' '\n') \
        | sort -u | tr '\n' ',' | sed 's/,$//')
    fi

    # Also reconcile PROCESSED_CODEX_REVIEW_IDS — the parent review IDs
    # of the stale inline comments need to come out of the processed-review
    # set, otherwise the Step 2B inline-comment poll's review-id filter
    # rejects the inline before our inline-id subtraction takes effect.
    # Scoped to connector entries: human-inline comments don't carry a
    # `pull_request_review_id` the skill processes, so the human surface
    # has no review-ID equivalent to reconcile.
    STALE_REVIEW_IDS=$(jq -r --argjson live "$LIVE_THREAD_STATE" --argjson stale "$STALE_THREAD_IDS" '
      [$live[] | select((.thread_id as $tid | $stale | index($tid))
                        and .comment_author_login == "chatgpt-codex-connector")
               | .pull_request_review_id // empty
               | tostring]
      | unique
      | join(",")
    ')

    if [ -n "$STALE_REVIEW_IDS" ]; then
      # awk-based set-difference (see PROCESSED_CODEX_INLINE_IDS comment).
      PROCESSED_CODEX_REVIEW_IDS=$(awk -v stale="$STALE_REVIEW_IDS" '
        BEGIN { n = split(stale, a, /,/); for (i = 1; i <= n; i++) if (a[i] != "") s[a[i]] = 1 }
        NF && !($0 in s) { print }
      ' < <(printf '%s\n' "$PROCESSED_CODEX_REVIEW_IDS" | tr ',' '\n') \
        | sort -u | tr '\n' ',' | sed 's/,$//')
    fi

    # Subtract stale thread IDs from CLOSED_CODEX_THREADS so Step 6's
    # eventual close-set rebuild doesn't double-count.
    # awk-based set-difference (see PROCESSED_CODEX_INLINE_IDS comment).
    STALE_THREAD_IDS_CSV=$(jq -r 'join(",")' <<< "$STALE_THREAD_IDS")
    CLOSED_CODEX_THREADS=$(awk -v stale="$STALE_THREAD_IDS_CSV" '
      BEGIN { n = split(stale, a, /,/); for (i = 1; i <= n; i++) if (a[i] != "") s[a[i]] = 1 }
      NF && !($0 in s) { print }
    ' < <(printf '%s\n' "$CLOSED_CODEX_THREADS" | tr ',' '\n') \
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

Body core (after the optional prefix). The `Fixed` body cites the
codex-verify status so the human reading the resolved thread sees the
fix was independently verified before resolution (see SKILL.md
"Codex-verified react + resolve chain"):

- **Fixed (verify pass):** `Fixed in <COMMIT_SHA> (codex-verify cycle <ROUND>: pass) — <FIX_SUMMARY>\n\n(github-review cycle <ROUND>, finding <CYCLE_ID>)`
- **Fixed (verify pass with deferred LOW):** `Fixed in <COMMIT_SHA> (codex-verify cycle <ROUND>: pass_with_deferred_LOW) — <FIX_SUMMARY>\n\n(github-review cycle <ROUND>, finding <CYCLE_ID>)`
- **Fixed (verify skipped via docs-only escape, §5F):** `Fixed in <COMMIT_SHA> (codex-verify skipped: docs-only) — <FIX_SUMMARY>\n\n(github-review cycle <ROUND>, finding <CYCLE_ID>)`
- **Skipped (no code change made):** `Skipped — <FIX_SUMMARY>\n\n(github-review cycle <ROUND>, finding <CYCLE_ID>)`

Skipped findings have no codex-verify citation because there's nothing
new to verify — the commit either contains no code change for that
finding (truly skipped) or addresses it via a prior commit's already-fixed
state (in which case `<FIX_SUMMARY>` cites that prior SHA).

Iterate via `while IFS= read -r finding; do ...; done < <(jq -c '...' <<<
"$FINDINGS_JSON")` (process substitution). The `for finding in $(jq -c
...)` form would word-split JSON objects containing spaces inside
titles/bodies and produce malformed input to `jq -r '.foo' <<<
"$finding"` calls.

**Reply/resolve atomicity.** Each `gh api -X POST` is guarded with `|| {
warn; continue; }`. On success, the finding's `cycle_id` is appended to
`REPLIED_FINDING_IDS`. Step 6.9 then **filters
`list_thread_ids_to_close` to only those findings whose reply
succeeded** — finding-id-keyed, not thread-id-keyed, so a thread-reply
branch with a missing-or-empty `thread_id` (a data-state anomaly that
shouldn't happen, but if it does) cannot leak past the filter and let
6.9 close a thread whose reply never landed. Without this guard a
transient network error during 6.8 would let 6.9 close the thread
silently — and Step 1's reconciliation only checks `isResolved`, so the
missing reply is undetectable to later cycles. (See SKILL.md § 6.9 for
the consumer-side filter.)

```bash
# Initialize the cross-step success list. Step 6.9 intersects
# list_thread_ids_to_close with this set so reply + resolve stay
# atomically coupled per finding (NOT per thread — keying on cycle_id
# means a missing/empty thread_id on a threaded branch can't sneak past
# the filter, since the absent finding row never gets added here).
REPLIED_FINDING_IDS=()

while IFS= read -r finding; do
  COMMENT_ID=$(jq -r '.source_comment_id' <<< "$finding")
  CYCLE_ID=$(jq -r '.cycle_id' <<< "$finding")
  STATUS=$(jq -r '.status' <<< "$finding")
  FIX_SUMMARY=$(jq -r '.fix_summary // ""' <<< "$finding")
  ORIG_BODY=$(jq -r '.body' <<< "$finding")
  SOURCE=$(jq -r '.source' <<< "$finding")
  FILE=$(jq -r '.file' <<< "$finding")
  THREAD_ID=$(jq -r '.thread_id // ""' <<< "$finding")

  # Threaded branches require a thread_id. Treat absent-or-empty as a data
  # anomaly: warn loudly and skip both reply AND resolve (no entry added to
  # REPLIED_FINDING_IDS, so Step 6.9's filter naturally excludes this row).
  # This catches the edge case codex flagged in cycle 6: a malformed finding
  # row missing thread_id on a threaded branch would otherwise reach 6.9 and
  # could resolve some other thread accidentally.
  if [ "$SOURCE" != "human" ] || [ "$FILE" != "null" ]; then
    if [ -z "$THREAD_ID" ] || [ "$THREAD_ID" = "null" ]; then
      echo "WARN: finding $CYCLE_ID (source=$SOURCE, comment $COMMENT_ID) has no thread_id;" >&2
      echo "      skipping reply + resolve — data anomaly, next cycle's reconciliation may catch." >&2
      continue
    fi
  fi

  # Build reply body.
  if [ "$SOURCE" = "human" ] && [ "$FILE" = "null" ]; then
    QUOTE_PREFIX=$(printf '> %s\n\n' "$(printf '%s' "$ORIG_BODY" | head -c 200)")
  else
    QUOTE_PREFIX=""
  fi
  if [ "$STATUS" = "fixed" ]; then
    # Cite the codex-verify status so the human sees the fix was verified.
    if [ "${VERIFY_SKIPPED:-0}" -eq 1 ]; then
      VERIFY_MARKER=" (codex-verify skipped: docs-only)"
    elif [ -n "${VERIFY_DEFERRED_LOW:-}" ]; then
      VERIFY_MARKER=" (codex-verify cycle ${ROUND}: pass_with_deferred_LOW)"
    else
      VERIFY_MARKER=" (codex-verify cycle ${ROUND}: pass)"
    fi
    BODY_CORE=$(printf 'Fixed in %s%s — %s\n\n(github-review cycle %s, finding %s)' \
      "$COMMIT_SHA" "$VERIFY_MARKER" "$FIX_SUMMARY" "$ROUND" "$CYCLE_ID")
  else
    BODY_CORE=$(printf 'Skipped — %s\n\n(github-review cycle %s, finding %s)' \
      "$FIX_SUMMARY" "$ROUND" "$CYCLE_ID")
  fi
  REPLY_BODY="${QUOTE_PREFIX}${BODY_CORE}"

  # Post via the right endpoint. On success, append CYCLE_ID to
  # REPLIED_FINDING_IDS so Step 6.9 will resolve this finding's thread.
  # On failure, `continue` without recording — Step 6.9's filter will
  # exclude this finding and the next cycle's reconciliation re-attempts
  # both reply and resolve (Step 1 sees the thread still unresolved).
  if [ "$SOURCE" = "human" ] && [ "$FILE" = "null" ]; then
    gh api -X POST "repos/$REPO/issues/$PR_NUMBER/comments" -f body="$REPLY_BODY" || {
      echo "WARN: issue-comment reply failed for finding $CYCLE_ID (comment $COMMENT_ID)" >&2
      echo "      Will be re-attempted on the next cycle (issue comments have no thread)." >&2
      continue
    }
  else
    gh api -X POST "repos/$REPO/pulls/$PR_NUMBER/comments/${COMMENT_ID}/replies" \
      -f body="$REPLY_BODY" || {
      echo "WARN: thread-reply failed for finding $CYCLE_ID (comment $COMMENT_ID, thread $THREAD_ID)" >&2
      echo "      Skipping Step 6.9 resolve so the next cycle can re-attempt both halves." >&2
      continue
    }
  fi

  REPLIED_FINDING_IDS+=("$CYCLE_ID")
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
