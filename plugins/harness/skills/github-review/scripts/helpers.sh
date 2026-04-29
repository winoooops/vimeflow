#!/usr/bin/env bash
# Shared helpers for the github-review skill.
#
# Source this file at the start of the skill bootstrap so any later step can
# call the functions defined here:
#
#   source "$(dirname "$0")/scripts/helpers.sh"
#
# Required env vars (set by Step 0 of SKILL.md):
#   OWNER      — repo owner
#   NAME       — repo name
#   PR_NUMBER  — PR number (integer)
#
# Required external commands: gh (with GraphQL access), jq, awk, sed, tr.
#
# Strict-mode guard: set -euo pipefail is applied only when this file is
# executed directly. Sourcing should not silently mutate the caller's shell
# (helpers like grep/diff legitimately exit non-zero, and the caller may not
# expect strict mode). Helper functions below use explicit `|| return 1` on
# their internal `gh api` calls so failures still propagate to callers.

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  set -euo pipefail
fi

# ----------------------------------------------------------------------------
# _assert_graphql_response_ok
# ----------------------------------------------------------------------------
# Validate a `gh api graphql` response body. `gh api graphql` exits 0 on HTTP
# 200, but GitHub signals application-level failures (auth issue, rate-limit
# exhaustion, malformed query, stale node ID) by returning HTTP 200 with
# `{"errors": [...], "data": null}`. Subprocess-exit guards (`|| return 1`)
# never fire in that path — `page_json` contains the error envelope and
# downstream `jq` traversals silently produce empty results, leading to
# false-clean exits and corrupted state.
#
# This helper checks two invariants on every GraphQL response:
#   1. The `errors` array, if present, must be empty.
#   2. The expected data path (passed by caller) must exist and be non-null.
#
# Args:
#   $1  response_json  — the body returned by `gh api graphql`
#   $2  expected_path  — jq path the caller intends to consume (e.g.
#                        `.data.repository.pullRequest.reviewThreads`)
#   $3  context_label  — short label included in stderr messages (e.g.
#                        `paginated_review_threads_query (cursor)`)
#
# Returns 0 if the response is well-formed; 1 otherwise (with diagnostics on
# stderr). Callers should `|| return 1` (or `|| exit 1` from a script).
_assert_graphql_response_ok() {
  local response_json="$1"
  local expected_path="$2"
  local context_label="$3"

  if jq -e 'has("errors") and (.errors | length > 0)' <<< "$response_json" >/dev/null 2>&1; then
    echo "ERROR: GraphQL response in $context_label contains errors:" >&2
    jq -r '.errors[] | "  - \(.message // "unknown") (type: \(.type // "unknown"))"' \
      <<< "$response_json" >&2
    return 1
  fi

  if ! jq -e "$expected_path" <<< "$response_json" >/dev/null 2>&1; then
    echo "ERROR: GraphQL response in $context_label missing expected path '$expected_path'." >&2
    local head
    head=$(jq -c '{data: (.data // null), errors: (.errors // null)}' <<< "$response_json" 2>/dev/null \
      || printf '%s' "$response_json" | head -c 500)
    echo "  Response head: $head" >&2
    return 1
  fi

  return 0
}

# ----------------------------------------------------------------------------
# paginated_review_threads_query
# ----------------------------------------------------------------------------
# Walks every reviewThreads page (100 per page) for the PR and flattens each
# thread's first-page comments (50 per page) into a single JSON array. Each
# entry has shape:
#
#   {
#     thread_id: <PRRT_xxx>,
#     comment_databaseId: <int>,
#     comment_author_login: <string>,    # GraphQL form: NO `[bot]` suffix
#     comment_author_type: "Bot" | "User",
#     isResolved: <bool>,
#     pull_request_review_id: <int|null>
#   }
#
# IMPORTANT — author-login form differs between REST and GraphQL:
#   - REST  /pulls/{pr}/comments + /issues/{pr}/comments → "chatgpt-codex-connector[bot]"
#   - GraphQL (this helper)                              → "chatgpt-codex-connector"
# Filters consuming this helper's output match WITHOUT the `[bot]` suffix
# (or use comment_author_type == "Bot" for type-only filtering).
#
# Caller filters by author / by ID set as needed.
#
# Used by:
#   - Step 1 (Closes-Codex-Threads reconciliation)
#   - Step 2B (connector inline-comment thread-id lookup)
#   - Step 7.1 (unresolved-thread exit check)
#
# pull_request_review_id exists so Step 1 reconciliation can subtract stale
# review IDs from PROCESSED_CODEX_REVIEW_IDS (otherwise Step 2B's review-id
# filter would reject the inline before our inline-id subtraction takes
# effect).
#
# comment_author_type is derived from GraphQL author.__typename (Actor union
# discriminator) so Step 7.1's human-thread check can filter cleanly without
# enumerating bot logins.
#
# Per-thread comment pagination is NOT implemented — connector original inline
# comments are typically a thread's first comment and live in the first page.
# Overflow emits a warning to stderr; the loud-fail at lookup time (after all
# pages exhausted) catches the rare case where a target inline comment ID
# ends up beyond the first 50 thread-comments.
#
# GraphQL response invariant: every `gh api graphql` call MUST be validated
# for `errors` array AND the expected `.data...reviewThreads` path before its
# output is consumed. `gh api graphql` exits 0 on HTTP 200, even when the
# body is `{"errors": [...], "data": null}` — auth issue, rate limit
# exhaustion, malformed query, or stale node ID. Without the `errors` check
# the helper silently traverses null paths, accumulates an empty array,
# breaks the pagination loop on `"null" != "true"`, and returns 0 with `[]`.
# Step 7.1's `UNRESOLVED_*_THREADS == 0` check would then satisfy the
# all-clean exit while real unresolved threads exist on GitHub. Use
# `_assert_graphql_response_ok` after each call to fail-loud instead.
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
                    nodes {
                      databaseId
                      author { login __typename }
                      pullRequestReview { databaseId }
                    }
                  }
                }
              }
            }
          }
        }' -F owner="$OWNER" -F name="$NAME" -F pr="$PR_NUMBER") || return 1
      _assert_graphql_response_ok "$page_json" \
        '.data.repository.pullRequest.reviewThreads' \
        'paginated_review_threads_query (no-cursor)' \
        || return 1
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
                    nodes {
                      databaseId
                      author { login __typename }
                      pullRequestReview { databaseId }
                    }
                  }
                }
              }
            }
          }
        }' -F owner="$OWNER" -F name="$NAME" -F pr="$PR_NUMBER" -F cursor="$cursor") || return 1
      _assert_graphql_response_ok "$page_json" \
        '.data.repository.pullRequest.reviewThreads' \
        'paginated_review_threads_query (cursor)' \
        || return 1
    fi

    # Warn if any thread's comments page overflowed first page (50). Not fatal:
    # caller's lookup loud-fail catches missing IDs.
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
    # NOTE: jq `EXPR as $name | REST` preserves `.` from before EXPR; iterating
    # via `.[] as $thread` does NOT rebind `.` to the thread. Use `$thread`
    # explicitly to descend into the per-thread comments array.
    result=$(jq -s '.[0] + .[1]' \
      <(echo "$result") \
      <(jq '[.data.repository.pullRequest.reviewThreads.nodes[] as $thread
              | $thread.comments.nodes[]
              | {thread_id: $thread.id, comment_databaseId: .databaseId,
                 comment_author_login: .author.login,
                 comment_author_type: (if .author.__typename == "Bot" then "Bot" else "User" end),
                 isResolved: $thread.isResolved,
                 pull_request_review_id: (.pullRequestReview.databaseId // null)}]' \
            <<< "$page_json"))

    # Advance cursor or exit.
    local has_next
    has_next=$(jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage' <<< "$page_json")
    if [ "$has_next" != "true" ]; then break; fi
    cursor=$(jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor' <<< "$page_json")
  done

  echo "$result"
}

# ----------------------------------------------------------------------------
# extract_trailer
# ----------------------------------------------------------------------------
# Read a trailer key out of every commit message between PR_BASE..HEAD and
# emit a comma-separated list of values (deduplicated by line, blanks
# stripped). Multi-line continuation form is supported: lines indented
# beneath a trailer key (no colon) are concatenated under the same key. This
# matches the multi-line "Pattern-Files-Touched:" form documented in
# references/commit-trailers.md.
#
# Required env vars:
#   PR_BASE   — merge-base SHA (set by Step 1)
#
# Usage:
#   PROCESSED_CLAUDE_IDS=$(extract_trailer "GitHub-Review-Processed-Claude")
#   PATTERN_FILES_TOUCHED=$(extract_trailer "Pattern-Files-Touched")
#
# Output: comma-separated list, no trailing comma, no blanks. Empty if no
# matching trailer found in any commit.
extract_trailer() {
  local key="$1"
  git log "$PR_BASE..HEAD" --pretty=%B \
    | awk -v k="^${key}:" '
        # Match the trailer key line. Capture its inline value (if any).
        $0 ~ k {
          inkey = 1
          line = $0
          sub(k, "", line)
          gsub(/^ +| +$/, "", line)
          if (length(line) > 0) print line
          next
        }
        # Continuation lines: indented (start with 2+ spaces or tab), no
        # colon-after-key pattern. Stop on blank line or any line that looks
        # like a new trailer key.
        inkey == 1 {
          if ($0 ~ /^[A-Za-z][A-Za-z0-9-]*:/) { inkey = 0; next }
          if ($0 ~ /^[[:space:]]*$/)        { inkey = 0; next }
          if ($0 ~ /^[[:space:]]+/) {
            line = $0
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
            if (length(line) > 0) print line
            next
          }
          inkey = 0
        }
      ' \
    | tr ',' '\n' \
    | awk 'NF' \
    | sort -u \
    | tr '\n' ',' \
    | sed 's/,$//'
}

# ----------------------------------------------------------------------------
# loop_start_scan
# ----------------------------------------------------------------------------
# Scan `.harness-github-review/` for prior-cycle artifacts before a new run
# starts. Aborted cycles preserve a `cycle-*-aborted/` directory; the skill
# refuses to start a new loop while any such directory exists (forensics
# guarantee — the abort evidence is what we need to debug a confusing
# failure). Orphan non-aborted artifacts (`cycle-*-{diff,verify-*}.{patch,log,...}`)
# from a prior run with no abort are wiped silently with a one-line notice.
#
# This function is called from SKILL.md's Bootstrap section, BEFORE Step 0
# (input resolution). It must execute before any step reads or writes PR
# state. The body is mirrored verbatim in references/cleanup-recovery.md as
# illustrative copy; THIS implementation is canonical.
#
# Returns 0 normally; calls `exit 1` directly when prior aborted dirs
# require user attention (the skill must not proceed silently in that case).
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

# ----------------------------------------------------------------------------
# cleanup_on_clean_exit
# ----------------------------------------------------------------------------
# Wipe transient cycle artifacts (diff patches, verify prompts, verify
# results, event logs, stderr logs) on a clean loop exit. Aborted-cycle
# directories from earlier rounds in the same run are PRESERVED — they are
# the forensics record we promised to keep. Called from Step 7.5
# (clean-exit message) only; never called on abnormal exit per
# `references/cleanup-recovery.md` § Step 7.6.
#
# The body is mirrored verbatim in references/cleanup-recovery.md as
# illustrative copy; THIS implementation is canonical.
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
