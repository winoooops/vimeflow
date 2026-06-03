import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  actionForDecision,
  decisionCommentId,
  decisionKey,
  formatDecisionComment,
  formatFixerCycleComment,
  hasMergeLinearPosted,
  markDecisionPosted,
  markMergeLinearPosted,
  readDecisionStore,
  shouldPostDecision,
} from './decision-comment.js'

const tempRoots = []

const makeStore = () => {
  const root = mkdtempSync(join(tmpdir(), 'decision-comment-'))
  tempRoots.push(root)

  return join(root, 'decision-comments.json')
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true })
  }
})

describe('actionForDecision', () => {
  test('selects fixer dispatch only when NEEDS_FIX and execute is armed', () => {
    expect(actionForDecision('NEEDS_FIX', { execute: true })).toBe(
      'dispatch fixer'
    )
    expect(actionForDecision('NEEDS_FIX', { execute: false })).toBe('none')
  })

  test('selects merge only when GOOD_SHAPE and approve is armed', () => {
    expect(actionForDecision('GOOD_SHAPE', { approve: true })).toBe(
      'approve/merge'
    )
    expect(actionForDecision('GOOD_SHAPE', { approve: false })).toBe('none')
  })
})

describe('formatDecisionComment', () => {
  test('formats a structured GOOD_SHAPE decision', () => {
    const body = formatDecisionComment({
      pr: 329,
      branch: 'codex/linear-bot-identity',
      state: 'GOOD_SHAPE',
      detail: '0 threads | Claude clean',
      sourceEvent: 'pr:ready_for_review',
      action: 'none',
      approve: false,
      execute: true,
      headSha: 'd892dded2b3faefb70ff87b19238cc82e58877fb',
      ci: 'green',
      claude: 'clean',
      threads: 0,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
    })

    expect(body).toContain('## QA runner decision: GOOD_SHAPE')
    expect(body).toContain('| PR | #329 |')
    expect(body).toContain('| Source event | `pr:ready_for_review` |')
    expect(body).toContain('| Detail | 0 threads \\| Claude clean |')
    expect(body).toContain('- CI: green')
    expect(body).toContain(
      'Reason: PR meets success criteria, but approve is not armed.'
    )
  })

  test('formats deterministic CI check context without raw logs', () => {
    const body = formatDecisionComment({
      pr: 330,
      branch: 'feature/vim-20',
      state: 'NEEDS_FIX',
      detail: 'deterministic CI failure: Code Quality Check',
      sourceEvent: 'ci:check_run',
      action: 'dispatch fixer',
      approve: true,
      execute: true,
      headSha: '3c0454fa261b50f7448730be95759845ece1f8bb',
      ci: 'fail',
      claude: 'clean',
      threads: null,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'UNSTABLE',
      ciClassification: 'deterministic failure',
      checkSummaries: [
        {
          name: 'Code Quality Check',
          workflow: 'CI Checks',
          bucket: 'fail',
          link: 'https://github.com/winoooops/vimeflow/actions/runs/123',
        },
      ],
    })

    expect(body).toContain('| CI classification | deterministic failure |')
    expect(body).toContain('Affected checks:')
    expect(body).toContain(
      '- Code Quality Check (CI Checks): fail — https://github.com/winoooops/vimeflow/actions/runs/123'
    )

    expect(body).toContain(
      'Reason: Review or deterministic CI findings require a fixer cycle and execute is armed.'
    )
  })

  test('formats rerun attempt metadata', () => {
    const body = formatDecisionComment({
      pr: 330,
      branch: 'feature/vim-20',
      state: 'WAITING',
      detail: 'reran Claude Code Review',
      sourceEvent: 'ci:check_run',
      action: 'rerun check',
      approve: false,
      execute: true,
      headSha: '3c0454fa261b50f7448730be95759845ece1f8bb',
      ci: 'green',
      claude: 'fail',
      threads: null,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'UNSTABLE',
      ciClassification: 'transient review failure',
      rerunAttempt: 1,
      rerunLimit: 3,
    })

    expect(body).toContain('| CI classification | transient review failure |')
    expect(body).toContain('| Rerun attempt | 1 / 3 |')
    expect(body).toContain(
      'Reason: A transient check was rerun and the runner is waiting for the new result.'
    )
  })
})

describe('formatFixerCycleComment', () => {
  test('formats a structured fixer completion comment', () => {
    const body = formatFixerCycleComment({
      pr: 328,
      url: 'https://github.com/winoooops/vimeflow/pull/328',
      branch: 'feature/vim-18',
      headSha: '1b5cb1a2b3faefb70ff87b19238cc82e58877fb',
      result: 'fix pushed | review pending',
      kimiExit: 'signal SIGTERM',
      stopMode: 'single-pass stop',
      worktreeClean: true,
    })

    expect(body).toContain('## QA fixer cycle: complete')
    expect(body).toContain('| PR | #328 |')
    expect(body).toContain(
      '| URL | https://github.com/winoooops/vimeflow/pull/328 |'
    )
    expect(body).toContain('| Branch | `feature/vim-18` |')
    expect(body).toContain('| Result | fix pushed \\| review pending |')
    expect(body).toContain('| Head | `1b5cb1a` |')
    expect(body).toContain('| Kimi exit | `signal SIGTERM` |')
    expect(body).toContain('| Stop mode | single-pass stop |')
    expect(body).toContain('| Worktree | clean |')
    expect(body).toContain('re-review is pending')
  })
})

describe('decision store', () => {
  test('dedupes repeated decisions for a PR', () => {
    const file = makeStore()

    const key = decisionKey({
      pr: 329,
      state: 'GOOD_SHAPE',
      detail: 'clean',
      headSha: 'abc',
      action: 'none',
      approve: false,
      execute: true,
    })
    const empty = readDecisionStore(file)

    expect(shouldPostDecision(empty, 329, key)).toBe(true)

    const updated = markDecisionPosted(empty, 329, key, file, {
      commentId: 'test-comment-id',
      state: 'GOOD_SHAPE',
      headSha: 'abc',
      action: 'none',
    })

    expect(shouldPostDecision(updated, 329, key)).toBe(false)
    expect(shouldPostDecision(readDecisionStore(file), 329, key)).toBe(false)
  })

  test('keeps old string store entries compatible', () => {
    const store = { 329: 'legacy-key' }

    // Legacy entries are posted again once to backfill commentId for threading
    expect(shouldPostDecision(store, 329, 'legacy-key')).toBe(true)
    expect(shouldPostDecision(store, 329, 'new-key')).toBe(true)
  })

  test('records the decision comment id for threaded follow-up comments', () => {
    const file = makeStore()

    const key = decisionKey({
      pr: 331,
      state: 'NEEDS_FIX',
      detail: 'Claude verdict: patch has issues',
      headSha: '8cd325f2efe5f0af0147257343cadfadc06b987c',
      action: 'dispatch fixer',
      approve: false,
      execute: true,
    })

    const updated = markDecisionPosted({}, 331, key, file, {
      commentId: 'linear-comment-id',
      state: 'NEEDS_FIX',
      headSha: '8cd325f2efe5f0af0147257343cadfadc06b987c',
      action: 'dispatch fixer',
    })

    expect(
      decisionCommentId(updated, 331, {
        state: 'NEEDS_FIX',
        headSha: '8cd325f2efe5f0af0147257343cadfadc06b987c',
        action: 'dispatch fixer',
      })
    ).toBe('linear-comment-id')

    expect(
      decisionCommentId(updated, 331, {
        state: 'GOOD_SHAPE',
      })
    ).toBeNull()
  })

  test('tracks when the approval path already posted the merged Linear thread', () => {
    const file = makeStore()
    const updated = markMergeLinearPosted({}, 331, file)

    expect(hasMergeLinearPosted(updated, 331)).toBe(true)
    expect(hasMergeLinearPosted(readDecisionStore(file), 331)).toBe(true)
  })
})
