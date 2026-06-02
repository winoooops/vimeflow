import { describe, expect, test } from 'vitest'
import {
  checkIdentity,
  classifyChecks,
  runIdFromCheck,
  stableCheckIdentity,
  summarizeChecks,
} from './ci-policy.js'

describe('classifyChecks', () => {
  test('classifies non-review failures as deterministic CI failures', () => {
    const result = classifyChecks([
      { name: 'Code Quality Check', bucket: 'fail', workflow: 'CI Checks' },
      { name: 'Claude Code Review', bucket: 'pass' },
    ])

    expect(result.ci).toBe('fail')
    expect(result.deterministicFailures).toHaveLength(1)
    expect(result.reviewRerunFailures).toHaveLength(0)
  })

  test('classifies failed reviewer jobs as transient review failures', () => {
    const result = classifyChecks([
      { name: 'Unit Tests', bucket: 'pass' },
      {
        name: 'Claude Code Review',
        bucket: 'fail',
        workflow: 'Claude PR Review',
      },
    ])

    expect(result.ci).toBe('green')
    expect(result.deterministicFailures).toHaveLength(0)
    expect(result.reviewRerunFailures).toHaveLength(1)
  })

  test('excludes checks absent from reviewRerunChecks from rerun set', () => {
    const result = classifyChecks(
      [
        { name: 'Unit Tests', bucket: 'pass' },
        { name: 'Claude Code Review', bucket: 'fail' },
        { name: 'Post Review Comment', bucket: 'fail' },
      ],
      {
        reviewRerunChecks: new Set(['Claude Code Review', 'Codex Code Review']),
      }
    )

    expect(result.reviewRerunFailures).toHaveLength(1)
    expect(result.reviewRerunFailures[0].name).toBe('Claude Code Review')
  })

  test('classifies failed review checks not in reviewRerunChecks as non-rerun failures', () => {
    const result = classifyChecks(
      [
        { name: 'Unit Tests', bucket: 'pass' },
        { name: 'Claude Code Review', bucket: 'fail' },
        { name: 'Post Review Comment', bucket: 'fail' },
      ],
      {
        reviewRerunChecks: new Set(['Claude Code Review']),
      }
    )

    expect(result.reviewRerunFailures).toHaveLength(1)
    expect(result.reviewRerunFailures[0].name).toBe('Claude Code Review')
    expect(result.reviewNonRerunFailures).toHaveLength(1)
    expect(result.reviewNonRerunFailures[0].name).toBe('Post Review Comment')
    expect(result.ci).toBe('green')
  })
})

describe('check metadata helpers', () => {
  test('extracts a GitHub Actions run id from a check URL', () => {
    expect(
      runIdFromCheck({
        link: 'https://github.com/winoooops/vimeflow/actions/runs/123/jobs/456',
      })
    ).toBe('123')
  })

  test('builds stable check identities and safe summaries', () => {
    const check = {
      name: 'Claude Code Review',
      bucket: 'cancel',
      workflow: 'Claude PR Review',
      link: 'https://github.com/winoooops/vimeflow/actions/runs/123',
    }

    expect(checkIdentity(check)).toBe('Claude Code Review|Claude PR Review|123')

    expect(stableCheckIdentity(check)).toBe(
      'Claude Code Review|Claude PR Review'
    )

    expect(summarizeChecks([check])).toEqual([
      {
        name: 'Claude Code Review',
        workflow: 'Claude PR Review',
        bucket: 'cancel',
        link: 'https://github.com/winoooops/vimeflow/actions/runs/123',
        runId: '123',
      },
    ])
  })
})
