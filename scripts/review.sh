#!/usr/bin/env bash
set -euo pipefail

REVIEW_DIR=".codex-reviews"
OUTPUT_FILE="$REVIEW_DIR/latest.md"
PROMPT_FILE=".github/codex/prompts/review.md"

# Verify Codex CLI is installed
if ! command -v codex &> /dev/null; then
  echo "Error: codex CLI not found. Install with: npm i -g @openai/codex"
  exit 1
fi

# Verify prompt exists
if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "Error: Review prompt not found at $PROMPT_FILE"
  exit 1
fi

mkdir -p "$REVIEW_DIR"

# Determine base branch (default: main)
BASE="${1:-main}"

echo "Running Codex code review (base: $BASE)..."
echo ""

codex exec review \
  --base "$BASE" \
  --model gpt-5.2-codex \
  --full-auto \
  -o "$OUTPUT_FILE" \
  "$(cat "$PROMPT_FILE")"

echo ""
echo "Review saved to $OUTPUT_FILE"
