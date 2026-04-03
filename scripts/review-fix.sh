#!/usr/bin/env bash
set -euo pipefail

MAX_LOOPS="${1:-2}"
REVIEW_DIR=".codex-reviews"

# Verify tools
for cmd in gh claude jq; do
  if ! command -v "$cmd" &> /dev/null; then
    echo "Error: $cmd not found in PATH"
    exit 1
  fi
done

# Get current PR number
PR_NUMBER=$(gh pr view --json number --jq '.number' 2>/dev/null || echo "")
if [[ -z "$PR_NUMBER" ]]; then
  echo "Error: No PR found for current branch. Create a PR first."
  exit 1
fi

REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
echo "PR #$PR_NUMBER on $REPO"
echo ""

mkdir -p "$REVIEW_DIR"

for loop in $(seq 1 "$MAX_LOOPS"); do
  echo "=== Review-fix loop $loop/$MAX_LOOPS ==="
  echo ""

  # Fetch latest Codex review comment (track ID for poll detection)
  REVIEW_JSON=$(gh api "repos/$REPO/issues/$PR_NUMBER/comments?per_page=100&sort=created&direction=desc" \
    --jq '[.[] | select(.body | contains("## Codex Code Review"))] | first | {id, body}' 2>/dev/null || echo "{}")
  REVIEW=$(echo "$REVIEW_JSON" | jq -r '.body // empty')
  REVIEW_ID=$(echo "$REVIEW_JSON" | jq -r '.id // empty')

  if [[ -z "$REVIEW" ]] || [[ "$REVIEW" == "null" ]]; then
    echo "No Codex review comment found. Waiting..."
    echo "Run this again after Codex posts its review."
    exit 0
  fi

  # Check if review is clean
  if echo "$REVIEW" | grep -q "No issues found"; then
    echo "Codex review is clean. Nothing to fix."
    exit 0
  fi

  if echo "$REVIEW" | grep -qi "patch is correct"; then
    echo "Codex review: patch is correct. Nothing to fix."
    exit 0
  fi

  # Save findings
  echo "$REVIEW" > "$REVIEW_DIR/findings.md"
  echo "Findings saved to $REVIEW_DIR/findings.md"
  echo ""

  # Feed to Claude Code for fixing
  echo "Spawning Claude Code to fix findings..."
  PROMPT="## YOUR ROLE - REVIEW FIX AGENT

You are fixing code review findings from an automated cross-vendor review (OpenAI Codex).
This is a FRESH context — you have no memory of previous sessions.

### STEP 1: GET YOUR BEARINGS
Read CLAUDE.md, then run: git log --oneline -10

### STEP 2: REVIEW FINDINGS
For each finding below:
1. Read the file at the specified path and line range
2. Understand the issue in context (read surrounding code)
3. Decide: FIX (minimal change), SKIP (explain why), or ESCALATE (needs redesign)

### FINDINGS:
$(cat "$REVIEW_DIR/findings.md")

### STEP 3: FIX ISSUES
For each finding you decided to FIX:
1. Make the minimal change — no drive-by refactoring
2. Never introduce new issues while fixing existing ones
3. If unsure, SKIP with explanation rather than guessing

### STEP 4: VERIFY AND COMMIT
Run: npm run lint && npm run test
If all pass: git add the changed files and git commit -m 'fix: address Codex review findings'"

  echo "$PROMPT" | claude -p --allowedTools 'Read,Write,Edit,Bash,Grep,Glob'

  # Push fixes
  echo ""
  echo "Pushing fixes..."
  git push

  if [[ "$loop" -lt "$MAX_LOOPS" ]]; then
    echo ""
    echo "Waiting for next Codex review (polling up to 10 min)..."
    POLL_ELAPSED=0
    POLL_MAX=600
    while [[ "$POLL_ELAPSED" -lt "$POLL_MAX" ]]; do
      sleep 30
      POLL_ELAPSED=$((POLL_ELAPSED + 30))
      NEW_ID=$(gh api "repos/$REPO/issues/$PR_NUMBER/comments?per_page=100&sort=created&direction=desc" \
        --jq '[.[] | select(.body | contains("## Codex Code Review"))] | first | .id' 2>/dev/null || echo "")
      if [[ -n "$NEW_ID" ]] && [[ "$NEW_ID" != "null" ]] && [[ "$NEW_ID" != "$REVIEW_ID" ]]; then
        echo "New review detected (comment ID: $NEW_ID)."
        break
      fi
      echo "  Still waiting... (${POLL_ELAPSED}s / ${POLL_MAX}s)"
    done

    if [[ "$POLL_ELAPSED" -ge "$POLL_MAX" ]]; then
      echo "Poll timed out after ${POLL_MAX}s. No new review detected. Stopping."
      break
    fi
  fi
done

echo ""
echo "Review-fix loop complete ($MAX_LOOPS loops)."
