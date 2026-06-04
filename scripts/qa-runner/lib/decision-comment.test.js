import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  actionForDecision,
  commentReplyTarget,
  decisionCommentId,
  decisionKey,
  decisionThreadTarget,
  fixCycleThreadTarget,
  formatDecisionComment,
  formatFixerCycleComment,
  fixCycleThreadParentId,
  hasMergeLinearPosted,
  markDecisionPosted,
  markFixCycleProgress,
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

  test('formats review adjudication evidence for operator observability', () => {
    const body = formatDecisionComment({
      pr: 347,
      branch: 'feat/vim-55-adjudication-observability',
      state: 'GOOD_SHAPE',
      detail: '0 threads · review adjudication clean · CI green · mergeable',
      sourceEvent: 'poll',
      action: 'none',
      approve: false,
      execute: true,
      headSha: '176fe271d43ca4cd45d8b9c21893077f382b62b8',
      ci: 'green',
      claude: 'adjudicated GOOD_SHAPE (cached)',
      threads: 0,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      reviewAdjudication: {
        decision: 'GOOD_SHAPE',
        summary:
          'The concrete blockers were fixed; remaining findings are operator cleanup.',
        confidenceScore: 0.9,
        cacheHit: true,
        cacheKey:
          '9f07b5ba338b232352b6773f163278a39b05a7de00625e3b356652d576e4888c',
        reviewedCommentIds: [4623675797, 4623923673],
        blockingFindings: [],
        nonBlockingFindings: [
          {
            severity: 'LOW',
            title: 'Artifact path duplicated',
            real_world_risk: 'low',
            fix_cost: 'low',
            confidence_score: 0.97,
            reason:
              'WAITING behavior is correct; the duplicated path is operator-visible noise only.',
          },
        ],
      },
    })

    expect(body).toContain('Review adjudication:')
    expect(body).toContain('| Decision | `GOOD_SHAPE` |')
    expect(body).toContain('| Cache | hit `9f07b5ba338b` |')
    expect(body).toContain(
      '| Reviewed comments | `4623675797`, `4623923673` |'
    )
    expect(body).toContain('| Blocking findings | 0 |')
    expect(body).toContain('| Non-blocking findings | 1 |')
    expect(body).toContain('Blocking findings:\n- none')
    expect(body).toContain(
      '- LOW: Artifact path duplicated (risk=low, fix=low, confidence=0.97)'
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

  test('dedupe key changes when review adjudication evidence changes', () => {
    const base = {
      pr: 329,
      state: 'GOOD_SHAPE',
      detail: 'clean',
      headSha: 'abc',
      action: 'none',
      approve: false,
      execute: true,
    }

    expect(
      decisionKey({
        ...base,
        reviewAdjudication: {
          cacheKey: 'first-cache',
          blockingFindings: [],
          nonBlockingFindings: [],
        },
      })
    ).not.toBe(
      decisionKey({
        ...base,
        reviewAdjudication: {
          cacheKey: 'second-cache',
          blockingFindings: [],
          nonBlockingFindings: [],
        },
      })
    )
  })

  test('keeps old string store entries compatible', () => {
    const store = { 329: 'legacy-key' }

    // Legacy entries are posted again once to backfill commentId for threading
    expect(shouldPostDecision(store, 329, 'legacy-key')).toBe(true)
    expect(shouldPostDecision(store, 329, 'new-key')).toBe(true)
  })

  test('re-posts when commentId is null or missing', () => {
    const store = { 329: { key: 'same-key', commentId: null } }

    expect(shouldPostDecision(store, 329, 'same-key')).toBe(true)
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

  test('keeps the active fix-cycle parent after post-fix decisions', () => {
    const file = makeStore()

    const needsFixKey = decisionKey({
      pr: 334,
      state: 'NEEDS_FIX',
      detail: '1 unresolved thread(s)',
      headSha: 'old-head',
      action: 'dispatch fixer',
      approve: true,
      execute: true,
    })

    const afterNeedsFix = markDecisionPosted({}, 334, needsFixKey, file, {
      commentId: 'needs-fix-comment',
      state: 'NEEDS_FIX',
      headSha: 'old-head',
      action: 'dispatch fixer',
    })

    expect(
      decisionThreadTarget(afterNeedsFix, 334, {
        state: 'WAITING',
        headSha: 'old-head',
      })
    ).toEqual({ mode: 'top_level', parentId: null })

    expect(
      decisionThreadTarget(afterNeedsFix, 334, { state: 'NEEDS_FIX' })
    ).toEqual({ mode: 'top_level', parentId: null })

    expect(
      fixCycleThreadParentId(afterNeedsFix, 334, { headSha: 'old-head' })
    ).toBe('needs-fix-comment')

    expect(
      fixCycleThreadTarget(afterNeedsFix, 334, { headSha: 'old-head' })
    ).toEqual({ mode: 'reply', parentId: 'needs-fix-comment' })

    expect(
      fixCycleThreadParentId(afterNeedsFix, 334, { headSha: 'new-head' })
    ).toBeNull()

    expect(
      fixCycleThreadTarget(afterNeedsFix, 334, { headSha: 'new-head' })
    ).toEqual({ mode: 'top_level', parentId: null })

    const afterProgress = markFixCycleProgress(afterNeedsFix, 334, file, {
      headSha: 'new-head',
    })
    expect(
      decisionThreadTarget(afterProgress, 334, {
        state: 'WAITING',
        headSha: 'new-head',
      })
    ).toEqual({ mode: 'reply', parentId: 'needs-fix-comment' })

    for (const state of ['RETRYING', 'GOOD_SHAPE']) {
      expect(
        decisionThreadTarget(afterProgress, 334, {
          state,
          headSha: 'new-head',
        })
      ).toEqual({ mode: 'reply', parentId: 'needs-fix-comment' })
    }

    expect(
      decisionThreadTarget(afterProgress, 334, {
        state: 'GOOD_SHAPE',
        headSha: 'other-head',
      })
    ).toEqual({ mode: 'top_level', parentId: null })

    const waitingKey = decisionKey({
      pr: 334,
      state: 'WAITING',
      detail: 'CI / Claude re-running',
      headSha: 'new-head',
      action: 'none',
      approve: true,
      execute: true,
    })

    const afterWaiting = markDecisionPosted(
      afterProgress,
      334,
      waitingKey,
      file,
      {
        commentId: 'waiting-comment',
        state: 'WAITING',
        headSha: 'new-head',
        action: 'none',
      }
    )

    expect(
      decisionThreadTarget(afterWaiting, 334, { state: 'GOOD_SHAPE' })
    ).toEqual({ mode: 'reply', parentId: 'needs-fix-comment' })

    expect(
      decisionCommentId(afterWaiting, 334, {
        state: 'WAITING',
        headSha: 'new-head',
        action: 'none',
      })
    ).toBe('waiting-comment')
  })

  test('keeps a later NEEDS_FIX decision top-level instead of replying to the previous fix cycle', () => {
    const file = makeStore()

    const first = markDecisionPosted({}, 334, 'first-key', file, {
      commentId: 'first-needs-fix-comment',
      state: 'NEEDS_FIX',
      headSha: 'first-head',
      action: 'dispatch fixer',
    })

    const afterProgress = markFixCycleProgress(first, 334, file, {
      headSha: 'first-fix-head',
    })

    expect(
      decisionThreadTarget(afterProgress, 334, {
        state: 'NEEDS_FIX',
        headSha: 'second-head',
      })
    ).toEqual({ mode: 'top_level', parentId: null })

    const second = markDecisionPosted(afterProgress, 334, 'second-key', file, {
      commentId: 'second-needs-fix-comment',
      state: 'NEEDS_FIX',
      headSha: 'second-head',
      action: 'dispatch fixer',
    })

    expect(
      fixCycleThreadParentId(second, 334, { headSha: 'second-head' })
    ).toBe('second-needs-fix-comment')

    expect(
      fixCycleThreadParentId(second, 334, { headSha: 'first-head' })
    ).toBeNull()
  })

  test('clears a stale fix-cycle parent when a NEEDS_FIX decision is not dispatched', () => {
    const file = makeStore()

    const active = markDecisionPosted({}, 334, 'old-key', file, {
      commentId: 'old-needs-fix-comment',
      state: 'NEEDS_FIX',
      headSha: 'old-head',
      action: 'dispatch fixer',
    })

    const noDispatch = markDecisionPosted(active, 334, 'new-key', file, {
      commentId: 'new-needs-fix-comment',
      state: 'NEEDS_FIX',
      headSha: 'new-head',
      action: 'none',
    })

    expect(decisionThreadTarget(noDispatch, 334, { state: 'WAITING' })).toEqual(
      { mode: 'top_level', parentId: null }
    )
  })

  test('builds a reply target for merge detail comments', () => {
    expect(commentReplyTarget('merged-root-comment')).toEqual({
      mode: 'reply',
      parentId: 'merged-root-comment',
    })

    expect(commentReplyTarget(null)).toEqual({
      mode: 'top_level',
      parentId: null,
    })
  })

  test('tracks when the approval path already posted the merged Linear thread', () => {
    const file = makeStore()
    const updated = markMergeLinearPosted({}, 331, file)

    expect(hasMergeLinearPosted(updated, 331)).toBe(true)
    expect(hasMergeLinearPosted(readDecisionStore(file), 331)).toBe(true)
  })
})
