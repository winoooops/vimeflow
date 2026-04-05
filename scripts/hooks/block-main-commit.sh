#!/usr/bin/env bash
# PreToolUse hook: block git commit/push on the main worktree.
#
# Returns exit 2 (block) if the agent is trying to commit or push
# from the main worktree, regardless of which branch is checked out.
# Returns exit 0 (allow) otherwise.
#
# Hook input (JSON on stdin) contains the tool parameters.
# We check the Bash command for git commit/push patterns.
#
# Design constraint: agents must start git commands with "git" as the first
# token (see rules/common/worktrees.md principle 5). This hook does not parse
# compound shell expressions (&&, ||, ;) or env-prefixed commands (ENV=val git).
# This is intentional — this framework is for agents, not humans.

set -euo pipefail

# Extract the bash command from the tool input.
# Claude Code passes the full hook context with tool params nested under tool_input.
command=$(jq -r '.tool_input.command // .command // empty' 2>/dev/null || echo "")
if [ -z "$command" ]; then
  exit 0
fi

# Extract the git subcommand and any -C/--work-tree target, skipping flags and their values.
# Known git flags that consume the next token as a value:
#   -C, -c, --git-dir, --work-tree, --namespace, --super-prefix
subcmd=""
git_target_dir=""
next_is_target=false
skip_next=false
for token in $(echo "$command" | sed -n 's/^\s*git\s\+//p'); do
  if $next_is_target; then
    git_target_dir="$token"
    next_is_target=false
    continue
  fi
  if $skip_next; then
    skip_next=false
    continue
  fi
  case "$token" in
    -C|--work-tree)
      next_is_target=true
      continue
      ;;
    --work-tree=*)
      git_target_dir="${token#*=}"
      continue
      ;;
    -c|--git-dir|--namespace|--super-prefix)
      skip_next=true
      continue
      ;;
    --git-dir=*|--namespace=*|--super-prefix=*)
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
# If -C or --git-dir was used, run the check from that directory instead
# of the current working directory — this prevents false positives when
# agents use git -C .claude/worktrees/<branch> commit from the main worktree.
#
# git rev-parse --git-common-dir returns the shared .git dir
# git rev-parse --git-dir returns the per-worktree .git dir (or .git file for linked worktrees)
# In the main worktree, both resolve to the same path.
# In a linked worktree, --git-dir points to .git/worktrees/<name>.
if [ -n "$git_target_dir" ]; then
  git_dir=$(git -C "$git_target_dir" rev-parse --git-dir 2>/dev/null || echo "")
  git_common_dir=$(git -C "$git_target_dir" rev-parse --git-common-dir 2>/dev/null || echo "")
else
  git_dir=$(git rev-parse --git-dir 2>/dev/null || echo "")
  git_common_dir=$(git rev-parse --git-common-dir 2>/dev/null || echo "")
fi

# Guard against empty paths — if git rev-parse failed, allow the command
if [ -z "$git_dir" ] || [ -z "$git_common_dir" ]; then
  exit 0
fi

resolved_git_dir=$(cd "$git_dir" 2>/dev/null && pwd || echo "")
resolved_common_dir=$(cd "$git_common_dir" 2>/dev/null && pwd || echo "")

if [ "$resolved_git_dir" = "$resolved_common_dir" ]; then
  echo "BLOCKED: Cannot commit/push from the main worktree. Create a worktree first: git worktree add .claude/worktrees/<branch-name> -b <branch-name>" >&2
  exit 2
fi

# We're in a linked worktree — allow
exit 0
