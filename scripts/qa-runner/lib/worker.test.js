import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  decisionKey,
  decisionStorePath,
  decisionThreadTarget,
  markDecisionPosted,
  markMergeLinearPosted,
  readDecisionStore,
} from './decision-comment.js'
import {
  DISPATCH_BLOCKED_EXIT,
  clearDispatchBlocker,
  writeDispatchBlocker,
} from './dispatch-blocker.js'
import {
  approveForLabels,
  isMissingPullRequestSnapshot,
  runOne,
  watchArgs,
  workerInfraFailure,
} from './worker.js'

const makeDeps = (overrides = {}) => ({
  config: { label: 'auto-review', approveLabel: 'auto-approve', maxNoops: 3 },
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
  labels = [{ name: 'auto-review' }],
} = {}) =>
  vi.fn(() =>
    JSON.stringify({
      headRefOid: headSha,
      state: 'OPEN',
      body,
      isDraft: false,
      labels,
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

  test('passes burst-worker keep-alive intent into watch args', () => {
    expect(
      watchArgs(123, {
        label: 'auto-review',
        workerKeepAlive: true,
      })
    ).toContain('--worker-keep-alive')
  })
})

describe('approveForLabels', () => {
  test('requires the configured approve label', () => {
    expect(
      approveForLabels({ approveLabel: 'auto-approve' }, [
        'auto-review',
        'auto-approve',
      ])
    ).toBe(true)

    expect(
      approveForLabels({ approveLabel: 'auto-approve' }, ['auto-review'])
    ).toBe(false)
  })

  test('can be disabled by clearing the approve label', () => {
    expect(approveForLabels({ approveLabel: '' }, ['auto-approve'])).toBe(false)
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

  test('runs without approval when only auto-review is present', async () => {
    const tickRunner = vi.fn(async () => 0)

    const deps = makeDeps({
      config: {
        label: 'auto-review',
        approveLabel: 'auto-approve',
        approve: true,
        maxNoops: 3,
      },
      snapshotExec: openPrSnapshotExec(),
      tickRunner,
    })

    const outcome = await runOne(42, 'poll', deps)

    expect(outcome).toBe('waiting')
    expect(tickRunner).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        label: 'auto-review',
        approveLabel: 'auto-approve',
        approve: false,
      }),
      'poll'
    )
  })

  test('arms approval for an auto-review PR with auto-approve', async () => {
    const tickRunner = vi.fn(async () => 0)

    const deps = makeDeps({
      snapshotExec: openPrSnapshotExec({
        labels: [{ name: 'auto-review' }, { name: 'auto-approve' }],
      }),
      tickRunner,
    })

    const outcome = await runOne(42, 'poll', deps)

    expect(outcome).toBe('waiting')
    expect(tickRunner).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        approve: true,
      }),
      'poll'
    )
  })

  test('forwards daemon queue keep-alive state into the tick config', async () => {
    const tickRunner = vi.fn(async () => 0)

    const deps = makeDeps({
      config: {
        label: 'auto-review',
        approveLabel: 'auto-approve',
        maxNoops: 3,
        workerKeepAlive: true,
      },
      snapshotExec: openPrSnapshotExec(),
      tickRunner,
    })

    const outcome = await runOne(42, 'poll', deps)

    expect(outcome).toBe('waiting')
    expect(tickRunner).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        workerKeepAlive: true,
      }),
      'poll'
    )
  })

  test('does not process auto-approve without auto-review', async () => {
    const tickRunner = vi.fn(async () => 0)

    const deps = makeDeps({
      snapshotExec: openPrSnapshotExec({
        labels: [{ name: 'auto-approve' }],
      }),
      tickRunner,
    })

    const outcome = await runOne(42, 'poll', deps)

    expect(outcome).toBe('skip')
    expect(tickRunner).not.toHaveBeenCalled()
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

    const store = readDecisionStore(decisionStorePath(42))
    for (const state of ['WAITING', 'RETRYING', 'GOOD_SHAPE']) {
      expect(
        decisionThreadTarget(store, 42, {
          state,
          headSha: 'new-head',
        })
      ).toEqual({ mode: 'reply', parentId: 'needs-fix-comment' })
    }
  })

  test('does not post a duplicate merged Linear event after approval already posted it', async () => {
    markMergeLinearPosted({}, 42, decisionStorePath(42))
    const cleanupWorktree = vi.fn()

    const deps = makeDeps({
      snapshotExec: vi
        .fn()
        .mockReturnValueOnce(prSnapshot({ headSha: 'clean-head' }))
        .mockReturnValueOnce(
          prSnapshot({ headSha: 'clean-head', state: 'MERGED' })
        ),
      tickRunner: vi.fn(async () => 0),
      cleanupWorktree,
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
    expect(cleanupWorktree).toHaveBeenCalledWith(42)
  })

  test('does not clean the managed worktree for ordinary waiting cycles', async () => {
    const cleanupWorktree = vi.fn()

    const deps = makeDeps({
      snapshotExec: openPrSnapshotExec(),
      tickRunner: vi.fn(async () => 0),
      cleanupWorktree,
    })

    const outcome = await runOne(42, 'poll', deps)

    expect(outcome).toBe('waiting')
    expect(cleanupWorktree).not.toHaveBeenCalled()
  })

  test('records retryable watch exits with reason and log metadata', async () => {
    const deps = makeDeps({
      snapshotExec: openPrSnapshotExec(),
      tickRunner: vi.fn(async () => ({
        code: -1,
        signal: 'SIGTERM',
        exitReason: 'watch.js terminated by SIGTERM',
        logPath: '/repo/scripts/qa-runner/logs/pr-42.log',
      })),
    })

    const outcome = await runOne(42, 'poll', deps)

    expect(outcome).toBe('retry')
    expect(deps.state.update).not.toHaveBeenCalled()
    expect(deps.events.emit).toHaveBeenCalledWith(
      {
        type: 'error',
        pr: 42,
        sourceEvent: 'poll',
        category: 'transient',
        detail: 'watch.js transient (exit -1)',
        exitCode: -1,
        signal: 'SIGTERM',
        exitReason: 'watch.js terminated by SIGTERM',
        logPath: '/repo/scripts/qa-runner/logs/pr-42.log',
        retryMode: 'next poll tick',
        terminal: false,
      },
      'VIM-20'
    )
  })

  test('signals worker infrastructure failure without incrementing fixer stalls', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qa-worker-failure-'))
    const logPath = join(dir, 'pr-42.log')
    writeFileSync(
      logPath,
      "fatal: cannot create directory at 'agents': No space left on device\n"
    )

    try {
      const deps = makeDeps({
        snapshotExec: openPrSnapshotExec(),
        tickRunner: vi.fn(async () => ({
          code: 1,
          signal: null,
          exitReason: `FIXER_EXIT #42: worker failed (exit 1; log: ${logPath})`,
          logPath: null,
        })),
        state: {
          has: vi.fn(() => true),
          get: vi.fn(() => ({
            roundCount: 1,
            noopCount: 2,
            lastHeadSha: 'abc123',
            pausedAt: null,
            pauseReason: null,
          })),
          forget: vi.fn(),
          update: vi.fn(),
        },
      })

      const outcome = await runOne(42, 'poll', deps)

      expect(outcome).toBe('retry')
      expect(deps.state.update).not.toHaveBeenCalled()
      expect(deps.events.emit).toHaveBeenCalledWith(
        {
          type: 'worker_infra_unhealthy',
          pr: 42,
          sourceEvent: 'poll',
          category: 'worker_disk_full',
          detail: 'worker disk full',
          exitCode: 1,
          signal: null,
          exitReason: `FIXER_EXIT #42: worker failed (exit 1; log: ${logPath})`,
          logPath,
          retryMode: 'next poll tick',
          terminal: false,
        },
        'VIM-20'
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('pauses repeated fixer stalls with explicit exit context', async () => {
    const deps = makeDeps({
      snapshotExec: openPrSnapshotExec(),
      tickRunner: vi.fn(async () => ({
        code: 1,
        signal: null,
        exitReason: 'kimi produced no commit - findings left unaddressed',
        logPath: '/repo/scripts/qa-runner/logs/pr-42.log',
      })),
      state: {
        has: vi.fn(() => true),
        get: vi.fn(() => ({
          roundCount: 1,
          noopCount: 2,
          lastHeadSha: 'abc123',
          pausedAt: null,
          pauseReason: null,
        })),
        forget: vi.fn(),
        update: vi.fn(),
      },
    })

    const outcome = await runOne(42, 'poll', deps)

    expect(outcome).toBe('paused')
    expect(deps.state.update).toHaveBeenCalledWith(42, {
      lastHeadSha: 'abc123',
      noopCount: 3,
      pausedAt: '2024-01-01T00:00:00.000Z',
      pauseReason: 'fixer_stall',
    })

    expect(deps.events.emit).toHaveBeenCalledWith(
      {
        type: 'paused',
        pr: 42,
        sourceEvent: 'poll',
        noopCount: 3,
        maxNoops: 3,
        category: 'fixer_stall',
        detail: 'fixer stall (watch.js exit 1)',
        exitCode: 1,
        signal: null,
        exitReason: 'kimi produced no commit - findings left unaddressed',
        logPath: '/repo/scripts/qa-runner/logs/pr-42.log',
        terminal: true,
      },
      'VIM-20'
    )
  })
})

describe('workerInfraFailure', () => {
  test('classifies post-cleanup low disk as worker infrastructure', () => {
    expect(
      workerInfraFailure({
        exitReason:
          'FIXER_EXIT #42: QA_WORKER_DISK_LOW free=10% used=90% minFree=15% path=/repo (exit 2; log: /repo/scripts/qa-runner/logs/pr-42.log)',
        logPath: null,
      })
    ).toEqual({
      category: 'worker_disk_low',
      detail: 'worker disk free space below cleanup threshold',
    })
  })

  test('classifies blank SSM failures as worker infrastructure failures', () => {
    expect(
      workerInfraFailure({
        exitReason:
          'SSM command cmd-123 Failed (response 1) produced no output',
        logPath: null,
      })
    ).toEqual({
      category: 'worker_ssm_unhealthy',
      detail: 'worker SSM command failed before fixer output',
    })
  })
})
