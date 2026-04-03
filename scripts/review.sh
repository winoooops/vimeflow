#!/usr/bin/env bash
set -euo pipefail

REVIEW_DIR=".codex-reviews"
OUTPUT_FILE="$REVIEW_DIR/latest.md"

# Verify Codex CLI is installed
if ! command -v codex &> /dev/null; then
  echo "Error: codex CLI not found. Install with: npm i -g @openai/codex"
  exit 1
fi

mkdir -p "$REVIEW_DIR"

# Determine base branch (default: main)
BASE="${1:-main}"

echo "Running Codex code review (base: $BASE)..."
echo ""

# Codex reads AGENTS.md automatically for project context.
# Output goes to stderr (progress) and stdout (result).
# Capture both to file while showing in terminal.
codex exec review \
  --base "$BASE" \
  --model gpt-5.2-codex \
  --full-auto \
  2>&1 | tee "$OUTPUT_FILE"

echo ""
echo "Review saved to $OUTPUT_FILE"
