import { describe, expect, test } from 'vitest'
import {
  cycleEnv,
  localDispatchPlan,
  remoteCycleCommand,
  shellQuote,
  sshDispatchPlan,
  ssmSendCommandArgs,
  workerCycleScript,
} from './cloud-dispatch.js'

const cycle = {
  QA_PR: '348',
  QA_REASON: 'ci:check_run',
  QA_LABEL: 'auto-review',
  QA_APPROVE: '1',
  QA_LINEAR_DECISION_COMMENTS: '1',
  QA_LINEAR_CREATE_ISSUES: '0',
  QA_LINEAR_TEAM_KEY: 'VIM',
  QA_MAX_CI_RERUNS: '3',
}

describe('cycleEnv', () => {
  test('keeps only the daemon PR-cycle contract', () => {
    expect(
      cycleEnv({
        ...cycle,
        GH_TOKEN: 'secret',
        LINEAR_CLIENT_SECRET: 'secret',
      })
    ).toEqual(cycle)
  })
})

describe('worker dispatch plans', () => {
  test('quotes shell values for remote command execution', () => {
    expect(shellQuote("feature/user's-branch")).toBe(
      "'feature/user'\\''s-branch'"
    )
  })

  test('builds the worker cycle script path from the worker repo', () => {
    expect(workerCycleScript('/srv/vimeflow/')).toBe(
      '/srv/vimeflow/scripts/qa-runner/worker-cycle.js'
    )
  })

  test('builds a local dispatcher plan for dry smoke tests', () => {
    expect(localDispatchPlan({ repo: '/srv/vimeflow', env: cycle })).toEqual(
      expect.objectContaining({
        command: 'node',
        args: ['/srv/vimeflow/scripts/qa-runner/worker-cycle.js'],
        cwd: '/srv/vimeflow',
        env: expect.objectContaining(cycle),
      })
    )
  })

  test('builds an ssh dispatcher plan with cycle env assignments', () => {
    expect(
      sshDispatchPlan({
        host: 'worker.internal',
        user: 'qa',
        repo: '/srv/vimeflow',
        env: cycle,
        sshOptions: ['-o', 'BatchMode=yes'],
      })
    ).toEqual({
      command: 'ssh',
      args: [
        '-o',
        'BatchMode=yes',
        'qa@worker.internal',
        remoteCycleCommand({ repo: '/srv/vimeflow', env: cycle }),
      ],
    })
  })

  test('requires a host for ssh mode', () => {
    expect(() =>
      sshDispatchPlan({ repo: '/srv/vimeflow', env: cycle })
    ).toThrow('QA_WORKER_HOST is required')
  })
})

describe('ssmSendCommandArgs', () => {
  test('builds AWS-RunShellScript arguments for a blocking worker cycle', () => {
    const args = ssmSendCommandArgs({
      instanceId: 'i-123',
      region: 'us-west-1',
      repo: '/srv/vimeflow',
      env: cycle,
      timeoutSeconds: 7200,
    })
    const params = JSON.parse(args[args.indexOf('--parameters') + 1])

    expect(args).toEqual(
      expect.arrayContaining([
        'ssm',
        'send-command',
        '--region',
        'us-west-1',
        '--document-name',
        'AWS-RunShellScript',
        '--instance-ids',
        'i-123',
      ])
    )
    expect(params.executionTimeout).toEqual(['7200'])
    expect(params.commands).toEqual([
      remoteCycleCommand({ repo: '/srv/vimeflow', env: cycle }),
    ])
    expect(params.commands[0]).toContain("QA_PR='348'")
    expect(params.commands[0]).not.toContain('GH_TOKEN')
  })

  test('requires an instance id and region for ssm mode', () => {
    expect(() =>
      ssmSendCommandArgs({
        region: 'us-west-1',
        repo: '/srv/vimeflow',
        env: cycle,
      })
    ).toThrow('QA_WORKER_INSTANCE_ID is required')

    expect(() =>
      ssmSendCommandArgs({
        instanceId: 'i-123',
        repo: '/srv/vimeflow',
        env: cycle,
      })
    ).toThrow('QA_WORKER_REGION or AWS_REGION is required')
  })
})
