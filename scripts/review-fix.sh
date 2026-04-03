#!/usr/bin/env bash
set -euo pipefail

MAX_LOOPS="${1:-2}"
REVIEW_DIR=".codex-reviews"

# Verify tools
for cmd in gh claude; do
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

  # Fetch latest Codex review comment
  REVIEW=$(gh api "repos/$REPO/issues/$PR_NUMBER/comments" \
    --jq '[.[] | select(.body | contains("## Codex Code Review"))] | last | .body' 2>/dev/null || echo "")

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
  PROMPT="You are fixing code review findings from Codex. Read the findings below, then:
1. For each finding, read the file and fix the issue with minimal changes
2. Skip false positives (explain why)
3. Run: npm run lint && npm run test
4. Commit all fixes: git commit -am 'fix: address Codex review findings'

FINDINGS:
$(cat "$REVIEW_DIR/findings.md")"

  echo "$PROMPT" | claude -p --allowedTools 'Read,Write,Edit,Bash,Grep,Glob'

  # Push fixes
  echo ""
  echo "Pushing fixes..."
  git push

  if [[ "$loop" -lt "$MAX_LOOPS" ]]; then
    echo ""
    echo "Waiting 120s for next Codex review..."
    sleep 120
  fi
done

echo ""
echo "Review-fix loop complete ($MAX_LOOPS loops)."
