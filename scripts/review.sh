#!/usr/bin/env bash
set -euo pipefail

REVIEW_DIR=".codex-reviews"
OUTPUT_FILE="$REVIEW_DIR/latest.md"
PROMPT_FILE=".github/codex/prompts/review.md"
SCHEMA_FILE=".github/codex/codex-output-schema.json"

# Verify Codex CLI is installed
if ! command -v codex &> /dev/null; then
  echo "Error: codex CLI not found. Install with: npm i -g @openai/codex"
  exit 1
fi

# Verify prompt and schema exist
if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "Error: Review prompt not found at $PROMPT_FILE"
  exit 1
fi

if [[ ! -f "$SCHEMA_FILE" ]]; then
  echo "Error: Output schema not found at $SCHEMA_FILE"
  exit 1
fi

mkdir -p "$REVIEW_DIR"

echo "Running Codex code review..."
echo ""

codex exec \
  --prompt-file "$PROMPT_FILE" \
  --output-schema "$SCHEMA_FILE" \
  --sandbox read-only \
  --model gpt-5.2-codex \
  | tee "$OUTPUT_FILE"

echo ""
echo "Review saved to $OUTPUT_FILE"
