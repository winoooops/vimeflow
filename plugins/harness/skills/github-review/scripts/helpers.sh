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

set -euo pipefail

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
#     comment_author_login: <string>,
#     comment_author_type: "Bot" | "User",
#     isResolved: <bool>,
#     pull_request_review_id: <int|null>
#   }
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
    result=$(jq -s '.[0] + .[1]' \
      <(echo "$result") \
      <(jq '[.data.repository.pullRequest.reviewThreads.nodes
              | .[] as $thread
              | .comments.nodes[]
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
    | tr '\n' ',' \
    | sed 's/,$//'
}
