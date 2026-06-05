import { describe, expect, test } from 'vitest'
import { workerConfigFromEnv, workerWatchArgs } from './worker-cycle.js'

describe('workerConfigFromEnv', () => {
  test('maps daemon cycle environment into worker config', () => {
    expect(
      workerConfigFromEnv({
        QA_LABEL: 'auto-review',
        QA_APPROVE: '1',
        QA_LINEAR_DECISION_COMMENTS: '1',
        QA_LINEAR_CREATE_ISSUES: '0',
        QA_LINEAR_TEAM_KEY: 'VIM',
        QA_MAX_CI_RERUNS: '3',
        QA_REASON: 'ci:check_run',
      })
    ).toEqual({
      label: 'auto-review',
      approve: true,
      linearDecisionComments: true,
      linearCreateIssues: false,
      linearTeamKey: 'VIM',
      maxCiReruns: '3',
      reason: 'ci:check_run',
    })
  })
})

describe('workerWatchArgs', () => {
  test('builds the expected one-cycle watch.js command', () => {
    expect(
      workerWatchArgs({
        QA_PR: '348',
        QA_LABEL: 'auto-review',
        QA_APPROVE: '1',
        QA_LINEAR_DECISION_COMMENTS: '1',
        QA_LINEAR_CREATE_ISSUES: '1',
        QA_LINEAR_TEAM_KEY: 'VIM',
        QA_MAX_CI_RERUNS: '3',
        QA_REASON: 'poll',
      })
    ).toEqual([
      expect.stringContaining('scripts/qa-runner/watch.js'),
      'tick',
      '--pr',
      '348',
      '--execute',
      '--approve',
      '--linear-decisions',
      '--linear-create-issues',
      '--linear-team',
      'VIM',
      '--max-ci-reruns',
      '3',
      '--reason',
      'poll',
      '--label',
      'auto-review',
    ])
  })

  test('does not arm approval unless QA_APPROVE is true', () => {
    expect(
      workerWatchArgs({
        QA_PR: '348',
        QA_APPROVE: '0',
      })
    ).not.toContain('--approve')
  })

  test('requires the PR number', () => {
    expect(() => workerWatchArgs({})).toThrow('QA_PR is required')
  })
})
