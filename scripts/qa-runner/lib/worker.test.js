import { describe, expect, test } from 'vitest'
import { isMissingPullRequestSnapshot, watchArgs } from './worker.js'

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
})
