#!/usr/bin/env bash
# PreToolUse hook: block git commit/push on the main worktree.
#
# Returns exit 2 (block) if the agent is trying to commit or push
# from the main worktree, regardless of which branch is checked out.
# Returns exit 0 (allow) otherwise.
#
# Hook input (JSON on stdin) contains the tool parameters.
# We check the Bash command for git commit/push patterns.

set -euo pipefail

# Extract the bash command from the tool input (portable — no GNU grep -P)
command=$(jq -r '.command // empty' 2>/dev/null || echo "")
if [ -z "$command" ]; then
  exit 0
fi

# Extract the git subcommand, skipping flags and their values.
# Handles: git -C /path commit, git -c key=val push, git --git-dir=/x commit, etc.
# Known git flags that consume the next token as a value:
#   -C, -c, --git-dir, --work-tree, --namespace, --super-prefix
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

if [ "$subcmd" != "commit" ] && [ "$subcmd" != "push" ]; then
  exit 0
fi

# Check if we're in the main worktree (not a linked worktree).
# Block regardless of branch — the main worktree should never be committed to.
#
# git rev-parse --git-common-dir returns the shared .git dir
# git rev-parse --git-dir returns the per-worktree .git dir (or .git file for linked worktrees)
# In the main worktree, both resolve to the same path.
# In a linked worktree, --git-dir points to .git/worktrees/<name>.
git_dir=$(git rev-parse --git-dir 2>/dev/null || echo "")
git_common_dir=$(git rev-parse --git-common-dir 2>/dev/null || echo "")

resolved_git_dir=$(cd "$git_dir" 2>/dev/null && pwd)
resolved_common_dir=$(cd "$git_common_dir" 2>/dev/null && pwd)

if [ "$resolved_git_dir" = "$resolved_common_dir" ]; then
  echo "BLOCKED: Cannot commit/push from the main worktree. Create a worktree first: git worktree add .claude/worktrees/<branch-name> -b <branch-name>" >&2
  exit 2
fi

# We're in a linked worktree — allow
exit 0
