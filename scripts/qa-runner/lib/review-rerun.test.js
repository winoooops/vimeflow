import { describe, expect, test } from 'vitest'
import { pickReviewRerunCheck } from './review-rerun.js'

const check = (name, runId) => ({
  name,
  workflow: 'Claude PR Review',
  bucket: 'fail',
  link: runId
    ? `https://github.com/winoooops/vimeflow/actions/runs/${runId}/job/1`
    : null,
})

const statusFor =
  (statuses) =>
  ({ check: reviewCheck }) =>
    statuses[reviewCheck.name] || { count: 0, nextAttempt: 1, exhausted: false }

describe('pickReviewRerunCheck', () => {
  test('selects a later failing reviewer when the first is exhausted', () => {
    const claude = check('Claude Code Review', '100')
    const codex = check('Codex Code Review', '200')

    expect(
      pickReviewRerunCheck({
        pr: 331,
        checks: [claude, codex],
        headSha: 'abc123',
        maxCiReruns: 3,
        statusForCheck: statusFor({
          'Claude Code Review': {
            count: 3,
            nextAttempt: 4,
            exhausted: true,
          },
        }),
      })
    ).toBe(codex)
  })

  test('prefers a runnable check over an open check without an Actions run id', () => {
    const postComment = check('Post Review Comment', null)
    const codex = check('Codex Code Review', '200')

    expect(
      pickReviewRerunCheck({
        pr: 331,
        checks: [postComment, codex],
        headSha: 'abc123',
        maxCiReruns: 3,
        statusForCheck: statusFor({}),
      })
    ).toBe(codex)
  })

  test('returns the first check when all rerun budgets are exhausted', () => {
    const claude = check('Claude Code Review', '100')
    const codex = check('Codex Code Review', '200')

    expect(
      pickReviewRerunCheck({
        pr: 331,
        checks: [claude, codex],
        headSha: 'abc123',
        maxCiReruns: 0,
        statusForCheck: statusFor({
          'Claude Code Review': {
            count: 0,
            nextAttempt: 1,
            exhausted: true,
          },
          'Codex Code Review': {
            count: 0,
            nextAttempt: 1,
            exhausted: true,
          },
        }),
      })
    ).toBe(claude)
  })
})
