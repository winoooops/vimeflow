#!/usr/bin/env bash
# PostToolUse hook: after git push, remind the agent to run /review-fix.
#
# Detects git push commands and outputs a directive that the agent
# sees in its context, prompting it to wait and then run /review-fix.
#
# Exit 0 always — PostToolUse hooks should never block.

set -euo pipefail

# Extract the bash command from the tool input (portable — no GNU grep -P)
command=$(jq -r '.command // empty' 2>/dev/null || echo "")
if [ -z "$command" ]; then
  exit 0
fi

# Extract the git subcommand, skipping flags and their values.
# Handles: git -C /path push, git -c key=val push, git --git-dir=/x push, etc.
subcmd=""
skip_next=false
for token in $(echo "$command" | sed -n 's/^\s*git\s\+//p'); do
  if $skip_next; then
    skip_next=false
    continue
  fi
  case "$token" in
    -C|-c|--git-dir|--work-tree|--namespace|--super-prefix)
      skip_next=true
      continue
      ;;
    --git-dir=*|--work-tree=*|--namespace=*|--super-prefix=*)
      continue
      ;;
    -*)
      continue
      ;;
    *)
      subcmd="$token"
      break
      ;;
  esac
done

if [ "$subcmd" != "push" ]; then
  exit 0
fi

echo "ACTION REQUIRED: Code was just pushed. Wait ~90 seconds for Codex review to post findings, then run /review-fix to fetch and address any code review comments."

exit 0
