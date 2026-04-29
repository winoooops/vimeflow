#!/usr/bin/env bash
# Verify-gate wrapper for the github-review skill.
#
# Invokes `codex exec` against the staged diff and the prompt built in
# Step 5B of SKILL.md. See references/verify-prompt.md for the prompt
# template + result-classification matrix + retry budget.
#
# Usage:
#   ./scripts/verify.sh <prompt-file> <result-json> [<events-log> [<stderr-log>]]
#
# Arguments:
#   prompt-file  — path to the prompt markdown built by Step 5B.
#   result-json  — path where codex writes the structured JSON result
#                  (passed to codex via --output-last-message).
#   events-log   — optional; path for codex's stdout event-stream noise.
#                  Default: <prompt-file dir>/verify-events.log.
#   stderr-log   — optional; path for codex's stderr.
#                  Default: <prompt-file dir>/verify-stderr.log.
#
# Exit codes:
#   0    — codex exec succeeded; caller reads result-json for verdict.
#   124  — GNU `timeout` fired (5 min cap). Caller routes to Step 5G abort.
#   *    — any other non-zero. Caller routes to Step 5G abort.
#
# Important flag notes:
#   - --output-schema (NOT --output-schema-file — that flag does not exist).
#   - --output-last-message writes the final structured JSON; stdout is
#     event-stream noise (events log).
#   - No --model flag. Per auto-memory feedback_codex_model_for_chatgpt_auth:
#     omitting lets codex pick the auth-mode-correct default (ChatGPT-account
#     auth rejects explicit model selection).
#   - External GNU `timeout 300` — `codex exec` has no built-in timeout flag.
#   - --sandbox read-only: codex is verifying, not modifying. Read-only
#     ensures it can't alter the staged diff during verification.
#
# Platform note: if `timeout` is unavailable, this script falls back to
# invoking codex directly without a timeout (relies on harness/agent
# timeout, typically 5–10 min). Acceptable degradation; codex normally
# finishes in 30–90s on a small staged diff.

set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: $0 <prompt-file> <result-json> [<events-log> [<stderr-log>]]" >&2
  exit 2
fi

PROMPT_FILE="$1"
RESULT_JSON="$2"
EVENTS_LOG="${3:-$(dirname "$PROMPT_FILE")/verify-events.log}"
STDERR_LOG="${4:-$(dirname "$PROMPT_FILE")/verify-stderr.log}"

SCHEMA_PATH=".github/codex/codex-output-schema.json"

if [ ! -f "$PROMPT_FILE" ]; then
  echo "ERROR: prompt file not found: $PROMPT_FILE" >&2
  exit 2
fi
if [ ! -f "$SCHEMA_PATH" ]; then
  echo "ERROR: codex output schema not found: $SCHEMA_PATH" >&2
  exit 2
fi

PROMPT_BODY=$(cat "$PROMPT_FILE")

if command -v timeout >/dev/null 2>&1; then
  set +e
  timeout 300 codex exec \
    --sandbox read-only \
    --output-schema "$SCHEMA_PATH" \
    --output-last-message "$RESULT_JSON" \
    -- "$PROMPT_BODY" \
    > "$EVENTS_LOG" \
    2> "$STDERR_LOG"
  CODEX_EXIT=$?
  set -e
else
  echo "WARNING: 'timeout' not available — running codex without external cap." >&2
  set +e
  codex exec \
    --sandbox read-only \
    --output-schema "$SCHEMA_PATH" \
    --output-last-message "$RESULT_JSON" \
    -- "$PROMPT_BODY" \
    > "$EVENTS_LOG" \
    2> "$STDERR_LOG"
  CODEX_EXIT=$?
  set -e
fi

# Guard against the codex-exits-0-without-output edge case. Disk-full,
# codex bug, or a `--output-last-message` path issue can let codex return
# 0 without writing $RESULT_JSON. Without this guard, the caller's Step
# 5D classification calls `jq ... "$RESULT_JSON"` on a nonexistent file,
# crashes with an opaque jq error, and bypasses the structured Step 5G
# abort path (no incident.md, no preserved artifacts). Re-route exit-0-
# without-output to a non-zero exit so the caller routes through Step 5G.
# `-s` (non-empty) also catches the zero-byte output case.
if [ "$CODEX_EXIT" -eq 0 ] && [ ! -s "$RESULT_JSON" ]; then
  echo "ERROR: codex exited 0 but $RESULT_JSON was not written or is empty" >&2
  echo "  See $STDERR_LOG and $EVENTS_LOG for codex output." >&2
  CODEX_EXIT=2
fi

exit "$CODEX_EXIT"
