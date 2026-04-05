#!/usr/bin/env bash
# PostToolUse hook: after git push or gh pr create, trigger /harness:github-review.
#
# Detects git push and gh pr create commands and outputs a directive
# that the agent sees in its context, prompting it to invoke the
# /harness:github-review skill automatically.
#
# Exit 0 always — PostToolUse hooks should never block.

set -euo pipefail

# Extract the bash command from the tool input (portable — no GNU grep -P)
command=$(jq -r '.command // empty' 2>/dev/null || echo "")
if [ -z "$command" ]; then
  exit 0
fi

# Check for gh pr create
if echo "$command" | grep -qE '^\s*gh\s+pr\s+create'; then
  echo "ACTION REQUIRED: A pull request was just created. Wait ~90 seconds for the Codex GitHub Action to post its review, then invoke /harness:github-review to fetch and address any code review findings."
  exit 0
fi

# Check for git push
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

echo "ACTION REQUIRED: Code was just pushed. Wait ~90 seconds for the Codex GitHub Action to post its review, then invoke /harness:github-review to fetch and address any code review findings."

exit 0
