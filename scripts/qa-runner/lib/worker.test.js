import { afterEach, describe, expect, test, vi } from 'vitest'
import { rmSync } from 'node:fs'
import {
  decisionKey,
  decisionStorePath,
  markDecisionPosted,
  markMergeLinearPosted,
} from './decision-comment.js'
import {
  DISPATCH_BLOCKED_EXIT,
  clearDispatchBlocker,
  writeDispatchBlocker,
} from './dispatch-blocker.js'
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

afterEach(() => {
  clearDispatchBlocker(42)
  rmSync(decisionStorePath(42), { force: true })
})

const missingPrSnapshotExec = (pr) => () => {
  const err = new Error(`Command failed: gh pr view ${pr}`)
  err.stderr = Buffer.from(
    `GraphQL: Could not resolve to a PullRequest with the number of ${pr}.`
  )
  throw err
}

const openPrSnapshotExec = ({
  headSha = 'abc123',
  body = 'Closes VIM-20',
  branch = 'feature/example',
} = {}) =>
  vi.fn(() =>
    JSON.stringify({
      headRefOid: headSha,
      state: 'OPEN',
      body,
      isDraft: false,
      labels: [{ name: 'auto-review' }],
      headRefName: branch,
    })
  )

const prSnapshot = ({
  headSha = 'abc123',
  state = 'OPEN',
  body = 'Closes VIM-20',
  branch = 'feature/example',
  labels = [{ name: 'auto-review' }],
  isDraft = false,
} = {}) =>
  JSON.stringify({
    headRefOid: headSha,
    state,
    body,
    isDraft,
    labels,
    headRefName: branch,
  })

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
        linearCreateIssues: true,
        linearTeamKey: 'VIM',
        maxCiReruns: 3,
        reason: 'pr:ready_for_review',
      })
    ).toEqual([
      expect.stringContaining('watch.js'),
      'tick',
      '--pr',
      '123',
      '--execute',
      '--linear-decisions',
      '--linear-create-issues',
      '--linear-team',
      'VIM',
      '--max-ci-reruns',
      '3',
      '--reason',
      'pr:ready_for_review',
      '--label',
      'auto-review',
    ])
  })

  test('preserves maxCiReruns=0 as an explicit option', () => {
    expect(
      watchArgs(123, {
        label: 'auto-review',
        maxCiReruns: 0,
      })
    ).toContain('0')
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

  test('pauses as dispatch-blocked without incrementing fixer failures', async () => {
    writeDispatchBlocker(42, {
      code: 4,
      reason:
        "refusing to review PR #42: branch 'feature/example' is checked out at /repo/dev (no self-review)",
      logPath: '/repo/scripts/qa-runner/logs/pr-42.log',
    })

    const deps = makeDeps({
      snapshotExec: openPrSnapshotExec(),
      tickRunner: vi.fn(async () => DISPATCH_BLOCKED_EXIT),
    })

    const outcome = await runOne(42, 'poll', deps)

    expect(outcome).toBe('blocked')
    expect(deps.state.update).toHaveBeenCalledWith(42, {
      lastHeadSha: 'abc123',
      noopCount: 0,
      pausedAt: '2024-01-01T00:00:00.000Z',
      pauseReason: 'dispatch_blocked',
    })

    expect(deps.events.emit).toHaveBeenCalledWith(
      {
        type: 'dispatch_blocked',
        pr: 42,
        detail: expect.stringContaining('refusing to review PR #42'),
      },
      'VIM-20'
    )

    clearDispatchBlocker(42)
  })

  test('skips routine polls while dispatch-blocked', async () => {
    const tickRunner = vi.fn(async () => 0)

    const deps = makeDeps({
      snapshotExec: openPrSnapshotExec(),
      tickRunner,
      state: {
        has: vi.fn(() => true),
        get: vi.fn(() => ({
          roundCount: 0,
          noopCount: 0,
          lastHeadSha: 'abc123',
          pausedAt: '2024-01-01T00:00:00.000Z',
          pauseReason: 'dispatch_blocked',
        })),
        forget: vi.fn(),
        update: vi.fn(),
      },
    })

    const outcome = await runOne(42, 'poll', deps)

    expect(outcome).toBe('paused')
    expect(tickRunner).not.toHaveBeenCalled()
    expect(deps.log).toHaveBeenCalledWith(
      '#42: paused (dispatch blocked) — poll skip'
    )
  })

  test('threads progress events under the triggering NEEDS_FIX decision', async () => {
    const key = decisionKey({
      pr: 42,
      state: 'NEEDS_FIX',
      detail: 'Claude verdict: patch has issues',
      headSha: 'old-head',
      action: 'dispatch fixer',
      approve: false,
      execute: true,
    })
    markDecisionPosted({}, 42, key, decisionStorePath(42), {
      commentId: 'needs-fix-comment',
      state: 'NEEDS_FIX',
      headSha: 'old-head',
      action: 'dispatch fixer',
    })

    const deps = makeDeps({
      snapshotExec: vi
        .fn()
        .mockReturnValueOnce(prSnapshot({ headSha: 'old-head' }))
        .mockReturnValueOnce(prSnapshot({ headSha: 'new-head' })),
      tickRunner: vi.fn(async () => 0),
    })

    const outcome = await runOne(42, 'poll', deps)

    expect(outcome).toBe('progress')
    expect(deps.events.emit).toHaveBeenCalledWith(
      {
        type: 'progress',
        pr: 42,
        round: 1,
        parentId: 'needs-fix-comment',
      },
      'VIM-20'
    )
  })

  test('does not post a duplicate merged Linear event after approval already posted it', async () => {
    markMergeLinearPosted({}, 42, decisionStorePath(42))

    const deps = makeDeps({
      snapshotExec: vi
        .fn()
        .mockReturnValueOnce(prSnapshot({ headSha: 'clean-head' }))
        .mockReturnValueOnce(
          prSnapshot({ headSha: 'clean-head', state: 'MERGED' })
        ),
      tickRunner: vi.fn(async () => 0),
    })

    const outcome = await runOne(42, 'approval', deps)

    expect(outcome).toBe('done')
    expect(deps.events.emit).toHaveBeenCalledWith(
      {
        type: 'merged',
        pr: 42,
        detail: 'MERGED',
      },
      undefined
    )
  })
})
