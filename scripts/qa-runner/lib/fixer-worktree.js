import { join } from 'node:path'

export const fixerWorktreePath = (repoRoot, pr) =>
  join(repoRoot, '.claude', 'worktrees', `qa-pr-${pr}`)

export const remoteTrackingRef = (branch) => `refs/remotes/origin/${branch}`

export const fetchRemoteBranchArgs = (branch) => [
  'fetch',
  'origin',
  `+refs/heads/${branch}:${remoteTrackingRef(branch)}`,
  '-q',
]

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

export const adjudicationWorktreePlan = ({
  repoRoot,
  pr,
  branch,
  headSha,
  baseBranch,
}) => {
  const path = fixerWorktreePath(repoRoot, pr)
  const baseRef = baseBranch ? remoteTrackingRef(baseBranch) : null

  return {
    path,
    headRef: remoteTrackingRef(branch),
    baseRef,
    fetchHeadArgs: fetchRemoteBranchArgs(branch),
    fetchBaseArgs: baseBranch ? fetchRemoteBranchArgs(baseBranch) : null,
    addArgs: ['worktree', 'add', '--detach', path, headSha],
    forceCheckoutArgs: ['-C', path, 'checkout', '-f', '--detach', headSha],
    cleanArgs: ['-C', path, 'clean', '-ffd'],
    diffArgs: [
      '-C',
      path,
      'diff',
      '--patch',
      '--color=never',
      baseRef ? `${baseRef}...HEAD` : `${headSha}^!`,
    ],
  }
}
