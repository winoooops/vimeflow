#!/usr/bin/env bash
# PostToolUse hook: after git push, remind the agent to run /review-fix.
#
# Detects git push commands and outputs a directive that the agent
# sees in its context, prompting it to wait and then run /review-fix.
#
# Exit 0 always — PostToolUse hooks should never block.

set -euo pipefail

input=$(cat)

# Extract the bash command from the tool input
command=$(echo "$input" | grep -oP '"command"\s*:\s*"[^"]*"' | head -1 | sed 's/"command"\s*:\s*"//;s/"$//')

# Only trigger on git push
if ! echo "$command" | grep -qE '^\s*git\s+push'; then
  exit 0
fi

echo "ACTION REQUIRED: Code was just pushed. Wait ~90 seconds for Codex review to post findings, then run /review-fix to fetch and address any code review comments."

exit 0
