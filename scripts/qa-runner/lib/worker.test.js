import { describe, expect, test, vi } from 'vitest'
import { isMissingPullRequestSnapshot, runOne, watchArgs } from './worker.js'

const makeDeps = (overrides = {}) => ({
  config: { label: 'auto-review', maxNoops: 3 },
  state: {
    get: vi.fn(() => ({
      roundCount: 0,
      noopCount: 0,
      lastHeadSha: null,
      pausedAt: null,
    })),
    has: vi.fn(() => false),
    forget: vi.fn(),
    update: vi.fn(),
  },
  log: vi.fn(),
  events: { emit: vi.fn() },
  now: () => '2024-01-01T00:00:00.000Z',
  ...overrides,
})

const missingPrSnapshotExec = (pr) => () => {
  const err = new Error(`Command failed: gh pr view ${pr}`)
  err.stderr = Buffer.from(
    `GraphQL: Could not resolve to a PullRequest with the number of ${pr}.`
  )
  throw err
}

describe('isMissingPullRequestSnapshot', () => {
  test('identifies GitHub PR-not-found snapshot failures', () => {
    expect(
      isMissingPullRequestSnapshot({
        stderr: Buffer.from(
          'GraphQL: Could not resolve to a PullRequest with the number of 999999.'
        ),
      })
    ).toBe(true)
  })

  test('does not classify generic command failures as missing PRs', () => {
    expect(
      isMissingPullRequestSnapshot({
        stderr: Buffer.from('gh: network unavailable'),
        message: 'Command failed: gh pr view 123',
      })
    ).toBe(false)
  })
})

describe('watchArgs', () => {
  test('runs fix cycles without approve by default', () => {
    expect(watchArgs(123, { label: 'auto-review' })).toContain('--execute')
    expect(watchArgs(123, { label: 'auto-review' })).not.toContain('--approve')
  })

  test('adds approve only when armed', () => {
    expect(watchArgs(123, { label: 'auto-review', approve: true })).toContain(
      '--approve'
    )
  })

  test('adds Linear decision observability flags when configured', () => {
    expect(
      watchArgs(123, {
        label: 'auto-review',
        linearDecisionComments: true,
        reason: 'pr:ready_for_review',
      })
    ).toEqual([
      expect.stringContaining('watch.js'),
      'tick',
      '--pr',
      '123',
      '--execute',
      '--linear-decisions',
      '--reason',
      'pr:ready_for_review',
      '--label',
      'auto-review',
    ])
  })
})

describe('runOne', () => {
  test('skips untracked PR when snapshot reports missing', async () => {
    const deps = makeDeps({
      snapshotExec: missingPrSnapshotExec(999),
      state: {
        has: vi.fn(() => false),
        get: vi.fn(() => ({})),
        forget: vi.fn(),
        update: vi.fn(),
      },
    })
    const outcome = await runOne(999, 'comment', deps)

    expect(outcome).toBe('skip')
    expect(deps.log).toHaveBeenCalledWith('#999: PR not found — skip')
  })

  test('retries tracked PR when snapshot reports missing', async () => {
    const deps = makeDeps({
      snapshotExec: missingPrSnapshotExec(42),
      state: {
        has: vi.fn(() => true),
        get: vi.fn(() => ({
          roundCount: 1,
          noopCount: 0,
          lastHeadSha: 'abc',
          pausedAt: null,
        })),
        forget: vi.fn(),
        update: vi.fn(),
      },
    })
    const outcome = await runOne(42, 'comment', deps)

    expect(outcome).toBe('retry')
    expect(deps.log).toHaveBeenCalledWith(
      '#42: snapshot unavailable (transient) — retry, state preserved'
    )
  })
})
