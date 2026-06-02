import { join } from 'node:path'

export const fixerWorktreePath = (repoRoot, pr) =>
  join(repoRoot, '.claude', 'worktrees', `qa-pr-${pr}`)

export const worktreeRef = ({ pr, branch, live }) =>
  live ? branch : `qa/dryrun-${pr}`

export const isSelfReviewConflict = ({ heldPath, fixerPath }) =>
  Boolean(heldPath) && heldPath !== fixerPath

export const worktreePlan = ({ repoRoot, pr, branch, live, heldPath }) => {
  const fixerPath = fixerWorktreePath(repoRoot, pr)

  return {
    path: fixerPath,
    ref: worktreeRef({ pr, branch, live }),
    fetchArgs: ['fetch', 'origin', branch, '-q'],
    addArgs: [
      'worktree',
      'add',
      '-B',
      worktreeRef({ pr, branch, live }),
      fixerPath,
      `origin/${branch}`,
    ],
    checkoutArgs: [
      '-C',
      fixerPath,
      'checkout',
      '-B',
      worktreeRef({ pr, branch, live }),
      `origin/${branch}`,
    ],
    blockedBy: isSelfReviewConflict({ heldPath, fixerPath }) ? heldPath : null,
  }
}
