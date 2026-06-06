import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { adjudicationWorktreePlan } from './fixer-worktree.js'

const GIT_BUFFER_BYTES = 16 * 1024 * 1024

export const shortSha = (sha) => (sha ? sha.slice(0, 7) : 'unknown')

export const gitOutput = (args) =>
  execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: GIT_BUFFER_BYTES,
  }).trim()

export const prepareReviewWorktree = (
  { repoRoot, pr, view },
  { git = gitOutput, exists = existsSync, mkdir = mkdirSync } = {}
) => {
  const plan = adjudicationWorktreePlan({
    repoRoot,
    pr: pr.number,
    branch: pr.headRefName,
    headSha: view.headRefOid,
    baseBranch: view.baseRefName,
  })

  try {
    mkdir(dirname(plan.path), { recursive: true })
    git(plan.fetchHeadArgs)

    const remoteHead = git(['rev-parse', plan.headRef])
    if (remoteHead !== view.headRefOid) {
      return {
        ok: false,
        detail:
          `PR head moved while preparing review worktree ` +
          `(${shortSha(view.headRefOid)} -> ${shortSha(remoteHead)})`,
      }
    }

    if (plan.fetchBaseArgs) {
      git(plan.fetchBaseArgs)
    }

    if (exists(plan.path)) {
      git(plan.resetArgs)
      git(plan.checkoutArgs)
      git(plan.cleanArgs)
    } else {
      git(plan.addArgs)
    }

    const localHead = git(['-C', plan.path, 'rev-parse', 'HEAD'])
    if (localHead !== view.headRefOid) {
      return {
        ok: false,
        detail:
          `review worktree head mismatch ` +
          `(${shortSha(view.headRefOid)} expected, ${shortSha(localHead)} found)`,
      }
    }

    return {
      ok: true,
      path: plan.path,
      diffText: git(plan.diffArgs),
    }
  } catch (e) {
    return {
      ok: false,
      detail: `review worktree unavailable: ${e.message.split('\n')[0]}`,
    }
  }
}
