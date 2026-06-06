import { dirname, join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { prepareReviewWorktree, shortSha } from './review-worktree.js'

const pr = {
  number: 352,
  headRefName: 'feat/vim-66-sidebar-collapsible',
}

const view = {
  headRefOid: 'abc123456789',
  baseRefName: 'wip/linear-wiring',
}

const expectedPath = join('/srv/vimeflow', '.claude', 'worktrees', 'qa-pr-352')

const gitFor = (responses = {}) =>
  vi.fn((args) => {
    const key = args.join(' ')

    if (
      key === 'rev-parse refs/remotes/origin/feat/vim-66-sidebar-collapsible'
    ) {
      return responses.remoteHead || view.headRefOid
    }
    if (key === `-C ${expectedPath} rev-parse HEAD`) {
      return responses.localHead || view.headRefOid
    }
    if (
      key ===
      `-C ${expectedPath} diff --patch --color=never refs/remotes/origin/wip/linear-wiring...HEAD`
    ) {
      return responses.diffText || 'diff --git a/file b/file'
    }

    return ''
  })

describe('prepareReviewWorktree', () => {
  test('creates an exact-head worktree and returns a local diff', () => {
    const git = gitFor()
    const mkdir = vi.fn()

    const result = prepareReviewWorktree(
      { repoRoot: '/srv/vimeflow', pr, view },
      { git, exists: () => false, mkdir }
    )

    expect(result).toEqual({
      ok: true,
      path: expectedPath,
      diffText: 'diff --git a/file b/file',
    })

    expect(mkdir).toHaveBeenCalledWith(dirname(expectedPath), {
      recursive: true,
    })

    expect(git).toHaveBeenCalledWith([
      'fetch',
      'origin',
      '+refs/heads/feat/vim-66-sidebar-collapsible:refs/remotes/origin/feat/vim-66-sidebar-collapsible',
      '-q',
    ])

    expect(git).toHaveBeenCalledWith([
      'fetch',
      'origin',
      '+refs/heads/wip/linear-wiring:refs/remotes/origin/wip/linear-wiring',
      '-q',
    ])

    expect(git).toHaveBeenCalledWith([
      'worktree',
      'add',
      '--detach',
      expectedPath,
      view.headRefOid,
    ])
  })

  test('resets an existing worktree to the exact PR head', () => {
    const git = gitFor()

    const result = prepareReviewWorktree(
      { repoRoot: '/srv/vimeflow', pr, view },
      { git, exists: () => true, mkdir: vi.fn() }
    )

    expect(result.ok).toBe(true)
    expect(git).toHaveBeenNthCalledWith(4, [
      '-C',
      expectedPath,
      'reset',
      '--hard',
      view.headRefOid,
    ])
    expect(git).toHaveBeenNthCalledWith(5, [
      '-C',
      expectedPath,
      'checkout',
      '--detach',
      view.headRefOid,
    ])
    expect(git).toHaveBeenNthCalledWith(6, [
      '-C',
      expectedPath,
      'clean',
      '-ffd',
    ])
  })

  test('recovers a dirty worktree by resetting before checkout', () => {
    const git = gitFor()

    const result = prepareReviewWorktree(
      { repoRoot: '/srv/vimeflow', pr, view },
      { git, exists: () => true, mkdir: vi.fn() }
    )

    expect(result.ok).toBe(true)
    const resetIndex = git.mock.calls.findIndex(
      (args) =>
        args[0][0] === '-C' && args[0].includes('reset') && args[0].includes('--hard')
    )
    const checkoutIndex = git.mock.calls.findIndex(
      (args) =>
        args[0][0] === '-C' && args[0].includes('checkout') && args[0].includes('--detach')
    )
    expect(resetIndex).toBeGreaterThan(-1)
    expect(checkoutIndex).toBeGreaterThan(-1)
    expect(resetIndex).toBeLessThan(checkoutIndex)
  })

  test('refuses stale review evidence when the remote branch moved', () => {
    const result = prepareReviewWorktree(
      { repoRoot: '/srv/vimeflow', pr, view },
      {
        git: gitFor({ remoteHead: 'def987654321' }),
        exists: () => false,
        mkdir: vi.fn(),
      }
    )

    expect(result).toEqual({
      ok: false,
      detail:
        'PR head moved while preparing review worktree (abc1234 -> def9876)',
    })
  })

  test('shortens missing shas safely', () => {
    expect(shortSha(null)).toBe('unknown')
  })
})
