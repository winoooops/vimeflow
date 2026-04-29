# Input Resolution — Step 0

This file is the implementation reference for **Step 0** of `../SKILL.md`.
The orchestrator either uses the current branch's PR (default) or an
explicitly-supplied PR number — but in both cases the current `git`
checkout MUST match the PR's head ref before any write op runs. This step
enforces that invariant.

**Key invariant (asserted in SKILL.md):** `git branch --show-current ==
HEAD_REF` before any write op. Step 0 aborts with non-zero exit if the
current branch does not match.

## Why explicit PR targeting still requires a matching checkout

`USER_SUPPLIED_PR_NUMBER=N` only changes which PR is **read from**. The
write operations later in the pipeline (commit, push, reply, resolve)
still happen on the current `git` checkout — so the checkout MUST match
the PR's head ref or fixes land on the wrong branch.

The recommended pattern when the local checkout is on a different feature:

```bash
# Worktree on the PR branch, isolated from the in-progress work.
git worktree add .claude/worktrees/<head-ref> '<head-ref>'
cd .claude/worktrees/<head-ref>
USER_SUPPLIED_PR_NUMBER=<pr-number> /harness-plugin:github-review
```

## Implementation

```bash
USER_SUPPLIED_PR_NUMBER="${USER_SUPPLIED_PR_NUMBER:-${1:-}}"

if [ -n "$USER_SUPPLIED_PR_NUMBER" ]; then
  PR_NUMBER="$USER_SUPPLIED_PR_NUMBER"
else
  PR_NUMBER=$(gh pr view --json number --jq .number 2>/dev/null)
fi

if [ -z "${PR_NUMBER:-}" ]; then
  echo "ERROR: No PR found. Either:" >&2
  echo "  1) Run from a branch that has an open PR, or" >&2
  echo "  2) Set USER_SUPPLIED_PR_NUMBER=<number> AND check out the PR's head branch" >&2
  echo "     (or use a worktree on that branch)." >&2
  exit 1
fi

REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
OWNER=${REPO%%/*}
NAME=${REPO#*/}
BASE_REF=$(gh pr view "$PR_NUMBER" --json baseRefName --jq .baseRefName)
HEAD_REF=$(gh pr view "$PR_NUMBER" --json headRefName --jq .headRefName)

# Safety guard — current branch MUST match the PR's head ref.
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "$HEAD_REF" ]; then
  echo "ERROR: Current branch is '$CURRENT_BRANCH' but PR #$PR_NUMBER head is '$HEAD_REF'." >&2
  echo "Fixes would commit + push to the wrong branch." >&2
  echo "Either:" >&2
  echo "  1) git switch '$HEAD_REF' (if no other in-progress work blocks it), or" >&2
  echo "  2) Create a worktree on the PR branch:" >&2
  echo "       git worktree add .claude/worktrees/$HEAD_REF '$HEAD_REF'" >&2
  echo "       cd .claude/worktrees/$HEAD_REF" >&2
  echo "     and re-run the skill from there." >&2
  exit 1
fi

echo "Working on PR #$PR_NUMBER (repo: $REPO, base: $BASE_REF, head: $HEAD_REF)"
```

## Output env vars (consumed by later steps)

After Step 0, the following env vars are set (read by every later step):

| Var         | Source                              |
| ----------- | ----------------------------------- |
| `PR_NUMBER` | resolved from current branch or arg |
| `REPO`      | `gh repo view --json nameWithOwner` |
| `OWNER`     | first half of `REPO`                |
| `NAME`      | second half of `REPO`               |
| `BASE_REF`  | `gh pr view --json baseRefName`     |
| `HEAD_REF`  | `gh pr view --json headRefName`     |

`OWNER` / `NAME` / `PR_NUMBER` are required by `paginated_review_threads_query`
in `../scripts/helpers.sh`. `BASE_REF` is consumed by Step 1's
`PR_BASE=$(git merge-base HEAD "origin/$BASE_REF")`.

## Cross-references

- **Step 1 PR_BASE derivation** — see `commit-trailers.md` § Step 1
  (consumes `BASE_REF`).
- **Branch-safety rationale** — see `../SKILL.md` § Key invariants ("Branch
  guard").
