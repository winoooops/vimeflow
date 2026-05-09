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
#   - Subagents / Lifeline runs work on a feature branch in a linked worktree.
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

# Read the bash command from the tool input.
# Claude Code passes the full hook context with tool params nested under tool_input.
command=$(jq -r '.tool_input.command // .command // empty' 2>/dev/null || echo "")
if [ -z "$command" ]; then
  exit 0
fi

# Parse the git command into an array of tokens (everything after the leading "git").
# Then locate the subcommand, any -C/--work-tree target, and keep the remaining
# tokens so we can later inspect push refspecs.
#
# Known git flags that consume the next token as a value:
#   -C, -c, --git-dir, --work-tree, --namespace, --super-prefix
read -r -a git_tokens <<<"$(echo "$command" | sed -n 's/^\s*git\s\+//p')"

subcmd=""
git_target_dir=""
subcmd_idx=-1
i=0
while [ $i -lt ${#git_tokens[@]} ]; do
  token="${git_tokens[$i]}"
  case "$token" in
    -C|--work-tree)
      i=$((i + 1))
      git_target_dir="${git_tokens[$i]:-}"
      ;;
    --work-tree=*)
      git_target_dir="${token#*=}"
      ;;
    -c|--git-dir|--namespace|--super-prefix)
      i=$((i + 1))
      ;;
    --git-dir=*|--namespace=*|--super-prefix=*)
      ;;
    -*)
      ;;
    *)
      subcmd="$token"
      subcmd_idx=$i
      break
      ;;
  esac
  i=$((i + 1))
done

if [ "$subcmd" != "commit" ] && [ "$subcmd" != "push" ]; then
  exit 0
fi

# For `git push`, block three bypass classes before falling through to the
# branch check:
#
#   1. `--all` / `--mirror` push every local branch/ref to the remote. If
#      the local `main` ever has commits ahead of origin, they land on
#      `origin/main` without passing through the refspec loop (both flags
#      start with '-' and would otherwise be skipped). Block unconditionally.
#   2. Every remaining non-flag token is treated as a potential refspec.
#      Refspec grammar: [+]<src>:<dst>, or [+]<ref> as shorthand for
#      <ref>:<ref>. Strip the optional leading '+' (force), take the
#      destination (after the last ':' if present, otherwise the whole
#      token), and block if it resolves to `main` or `refs/heads/main`.
#      Catches `git push origin HEAD:main`, `git push origin feat/x:main`,
#      `git push origin main`, etc.
#
# Known limitation: the loop does not distinguish the remote-name positional
# (e.g. `origin` in `git push origin feat/x`) from actual refspec arguments.
# A repository whose remote is literally named `main` (extremely unusual)
# would therefore false-block every push to that remote. We accept this
# trade-off to keep the parser simple — renaming such a remote is trivial
# and this framework uses conventional remote names (`origin`, `upstream`).
if [ "$subcmd" = "push" ]; then
  j=$((subcmd_idx + 1))
  while [ $j -lt ${#git_tokens[@]} ]; do
    arg="${git_tokens[$j]}"
    j=$((j + 1))
    case "$arg" in
      --all|--mirror)
        echo "BLOCKED: 'git push $arg' pushes every local branch/ref and may land commits on 'main'. Push a specific refspec instead." >&2
        exit 2
        ;;
      -*) continue ;;
    esac
    refspec="${arg#+}"
    case "$refspec" in
      *:*) dst="${refspec##*:}" ;;
      *)   dst="$refspec" ;;
    esac
    case "$dst" in
      main|refs/heads/main)
        echo "BLOCKED: 'git push' targets 'main' (refspec '$arg'). Open a PR instead." >&2
        exit 2
        ;;
    esac
  done
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
  echo "        (Subagents / Lifeline runs should create a worktree: git worktree add .claude/worktrees/<branch> -b <branch>)" >&2
  exit 2
fi

# On a feature branch, with no push refspec targeting main — allow.
exit 0
