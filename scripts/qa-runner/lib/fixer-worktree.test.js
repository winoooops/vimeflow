import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  fixerWorktreePath,
  isSelfReviewConflict,
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
})
