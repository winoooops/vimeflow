#!/usr/bin/env bash
# PreToolUse hook: block git commit/push when the main branch is checked out.
#
# Returns exit 2 (block) if the agent is trying to commit or push while
# the current HEAD is on `main`, regardless of whether this is the primary
# checkout or a linked worktree.
# Returns exit 0 (allow) otherwise — feature branches are fine anywhere.
#
# Policy (see rules/common/worktrees.md):
#   - Main agent works on a feature branch in the primary checkout.
#   - Subagents / harness work on a feature branch in a linked worktree.
#   - Nobody commits to `main`, ever.
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

# Check the currently checked-out branch. Block iff it is `main`.
#
# If -C or --work-tree was used, run the check against that directory instead
# of the current working directory — this prevents false positives when
# agents use git -C .claude/worktrees/<branch> commit from the primary checkout.
if [ -n "$git_target_dir" ]; then
  current_branch=$(git -C "$git_target_dir" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
else
  current_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
fi

# Guard against empty output — if git rev-parse failed, allow the command
if [ -z "$current_branch" ]; then
  exit 0
fi

if [ "$current_branch" = "main" ]; then
  echo "BLOCKED: Cannot commit/push while on 'main'. Check out a feature branch first: git checkout -b feat/<name>" >&2
  echo "        (Subagents / harness should create a worktree: git worktree add .claude/worktrees/<branch> -b <branch>)" >&2
  exit 2
fi

# On a feature branch — allow (in primary checkout or any linked worktree)
exit 0
