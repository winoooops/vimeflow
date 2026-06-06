import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  adjudicationWorktreePlan,
  fetchRemoteBranchArgs,
  fixerWorktreePath,
  isSelfReviewConflict,
  remoteTrackingRef,
  worktreePlan,
} from './fixer-worktree.js'

describe('worktreePlan', () => {
  test('fetches a remote PR branch into an isolated live fixer worktree', () => {
    const plan = worktreePlan({
      repoRoot: '/srv/vimeflow',
      pr: 331,
      branch: 'feature/vim-20',
      live: true,
      heldPath: null,
    })

    expect(plan).toMatchObject({
      path: join('/srv/vimeflow', '.claude', 'worktrees', 'qa-pr-331'),
      ref: 'feature/vim-20',
      fetchArgs: ['fetch', 'origin', 'feature/vim-20', '-q'],
      addArgs: [
        'worktree',
        'add',
        '-B',
        'feature/vim-20',
        join('/srv/vimeflow', '.claude', 'worktrees', 'qa-pr-331'),
        'origin/feature/vim-20',
      ],
      checkoutArgs: [
        '-C',
        join('/srv/vimeflow', '.claude', 'worktrees', 'qa-pr-331'),
        'checkout',
        '-B',
        'feature/vim-20',
        'origin/feature/vim-20',
      ],
      blockedBy: null,
    })
  })

  test('keeps simultaneous PRs isolated by PR-numbered worktree paths', () => {
    const first = worktreePlan({
      repoRoot: '/srv/vimeflow',
      pr: 331,
      branch: 'feature/vim-20',
      live: true,
      heldPath: null,
    })

    const second = worktreePlan({
      repoRoot: '/srv/vimeflow',
      pr: 332,
      branch: 'feature/vim-21',
      live: true,
      heldPath: null,
    })

    expect(first.path).toBe(
      join('/srv/vimeflow', '.claude', 'worktrees', 'qa-pr-331')
    )

    expect(second.path).toBe(
      join('/srv/vimeflow', '.claude', 'worktrees', 'qa-pr-332')
    )
    expect(first.path).not.toBe(second.path)
    expect(first.ref).toBe('feature/vim-20')
    expect(second.ref).toBe('feature/vim-21')
  })

  test('blocks only when another worktree already holds the PR branch', () => {
    const fixerPath = fixerWorktreePath('/srv/vimeflow', 331)

    expect(
      isSelfReviewConflict({
        heldPath: '/srv/vimeflow/.claude/worktrees/vim-20-dev',
        fixerPath,
      })
    ).toBe(true)

    expect(
      isSelfReviewConflict({
        heldPath: fixerPath,
        fixerPath,
      })
    ).toBe(false)
  })

  test('plans exact-head review adjudication worktrees', () => {
    const plan = adjudicationWorktreePlan({
      repoRoot: '/srv/vimeflow',
      pr: 352,
      branch: 'feat/vim-66-sidebar-collapsible',
      headSha: 'abc123',
      baseBranch: 'wip/linear-wiring',
    })

    expect(fetchRemoteBranchArgs('feat/vim-66-sidebar-collapsible')).toEqual([
      'fetch',
      'origin',
      '+refs/heads/feat/vim-66-sidebar-collapsible:refs/remotes/origin/feat/vim-66-sidebar-collapsible',
      '-q',
    ])

    expect(remoteTrackingRef('wip/linear-wiring')).toBe(
      'refs/remotes/origin/wip/linear-wiring'
    )

    expect(plan).toMatchObject({
      path: join('/srv/vimeflow', '.claude', 'worktrees', 'qa-pr-352'),
      headRef: 'refs/remotes/origin/feat/vim-66-sidebar-collapsible',
      baseRef: 'refs/remotes/origin/wip/linear-wiring',
      addArgs: [
        'worktree',
        'add',
        '--detach',
        join('/srv/vimeflow', '.claude', 'worktrees', 'qa-pr-352'),
        'abc123',
      ],
      forceCheckoutArgs: [
        '-C',
        join('/srv/vimeflow', '.claude', 'worktrees', 'qa-pr-352'),
        'checkout',
        '-f',
        '--detach',
        'abc123',
      ],
      cleanArgs: [
        '-C',
        join('/srv/vimeflow', '.claude', 'worktrees', 'qa-pr-352'),
        'clean',
        '-ffd',
      ],
      diffArgs: [
        '-C',
        join('/srv/vimeflow', '.claude', 'worktrees', 'qa-pr-352'),
        'diff',
        '--patch',
        '--color=never',
        'refs/remotes/origin/wip/linear-wiring...HEAD',
      ],
    })
  })
})
