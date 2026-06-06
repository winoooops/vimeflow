import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  cycleEnv,
  dispatchConfig,
  localDispatchPlan,
  remoteCycleCommand,
  runSsmDispatch,
  shellQuote,
  sshDispatchPlan,
  ssmSendCommandArgs,
  workerCycleScript,
} from './cloud-dispatch.js'

const cycle = {
  QA_PR: '348',
  QA_REASON: 'ci:check_run',
  QA_LABEL: 'auto-review',
  QA_LINEAR_DECISION_COMMENTS: '1',
  QA_LINEAR_CREATE_ISSUES: '0',
  QA_LINEAR_TEAM_KEY: 'VIM',
  QA_MAX_CI_RERUNS: '3',
  QA_FIX_CONTEXT: '{"kind":"review_adjudication"}',
  QA_LINEAR_PARENT_COMMENT_ID: 'linear-parent-comment',
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

  test('forwards worker refresh settings but not instance-id or token', () => {
    expect(
      cycleEnv({
        ...cycle,
        QA_WORKER_REFRESH_RUNNER: '1',
        QA_WORKER_REF: 'main',
        QA_RUNNER_REF: 'main',
        QA_APPROVE: '1',
        QA_WORKER_INSTANCE_ID: 'i-123',
        GH_TOKEN: 'secret',
      })
    ).toEqual({
      ...cycle,
      QA_WORKER_REFRESH_RUNNER: '1',
      QA_WORKER_REF: 'main',
      QA_RUNNER_REF: 'main',
    })
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

describe('dispatchConfig', () => {
  test('parses QA_WORKER_SSH_OPTIONS_JSON as a JSON array', () => {
    const config = dispatchConfig({
      QA_WORKER_SSH_OPTIONS_JSON: JSON.stringify(['-o', 'BatchMode=yes']),
    })

    expect(config.sshOptions).toEqual(['-o', 'BatchMode=yes'])
  })

  test('rejects non-array JSON for QA_WORKER_SSH_OPTIONS_JSON', () => {
    expect(() =>
      dispatchConfig({ QA_WORKER_SSH_OPTIONS_JSON: 'null' })
    ).toThrow('QA_WORKER_SSH_OPTIONS_JSON must be a JSON array')

    expect(() => dispatchConfig({ QA_WORKER_SSH_OPTIONS_JSON: '{}' })).toThrow(
      'QA_WORKER_SSH_OPTIONS_JSON must be a JSON array'
    )

    expect(() => dispatchConfig({ QA_WORKER_SSH_OPTIONS_JSON: '42' })).toThrow(
      'QA_WORKER_SSH_OPTIONS_JSON must be a JSON array'
    )
  })

  test('falls back to QA_WORKER_SSH_OPTIONS when JSON env is absent', () => {
    const config = dispatchConfig({
      QA_WORKER_SSH_OPTIONS: '-o BatchMode=yes -o ConnectTimeout=5',
    })

    expect(config.sshOptions).toEqual([
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=5',
    ])
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
    expect(params.commands[0]).toContain(
      'QA_FIX_CONTEXT=\'{"kind":"review_adjudication"}\''
    )

    expect(params.commands[0]).toContain(
      "QA_LINEAR_PARENT_COMMENT_ID='linear-parent-comment'"
    )
    expect(params.commands[0]).not.toContain('QA_APPROVE')
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

const makeMockSpawn = (responses) => {
  let callIndex = 0

  return vi.fn(() => {
    const response = responses[callIndex++] || {
      code: 1,
      stderr: 'unexpected call',
    }

    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    })
    setImmediate(() => {
      if (response.stdout) {
        child.stdout.emit('data', Buffer.from(response.stdout))
      }
      if (response.stderr) {
        child.stderr.emit('data', Buffer.from(response.stderr))
      }
      child.stdout.emit('end')
      child.stderr.emit('end')
      child.emit('close', response.code ?? 0, response.signal ?? null)
    })

    return child
  })
}

describe('runSsmDispatch', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test('retries transient InvocationDoesNotExist errors before succeeding', async () => {
    const mockSpawn = makeMockSpawn([
      {
        stdout: JSON.stringify({ Command: { CommandId: 'cmd-123' } }),
      },
      {
        code: 254,
        stderr:
          'An error occurred (InvocationDoesNotExist) when calling the GetCommandInvocation operation: Invocation does not exist',
      },
      {
        stdout: JSON.stringify({
          Status: 'Success',
          ResponseCode: 0,
          StandardOutputContent: 'done\n',
          StandardErrorContent: '',
        }),
      },
    ])
    const stdout = { write: vi.fn() }
    const stderr = { write: vi.fn() }

    const result = await runSsmDispatch({
      instanceId: 'i-123',
      region: 'us-west-2',
      repo: '/srv/vimeflow',
      env: { QA_PR: '349' },
      timeoutSeconds: 30,
      stdout,
      stderr,
      spawnImpl: mockSpawn,
      pollIntervalMs: 10,
    })

    expect(mockSpawn).toHaveBeenCalledTimes(3)
    expect(result).toEqual({ code: 0, signal: null })
  })

  test('retries transient InvalidCommandId errors before succeeding', async () => {
    const mockSpawn = makeMockSpawn([
      {
        stdout: JSON.stringify({ Command: { CommandId: 'cmd-456' } }),
      },
      {
        code: 254,
        stderr:
          'An error occurred (InvalidCommandId) when calling the GetCommandInvocation operation',
      },
      {
        stdout: JSON.stringify({
          Status: 'Success',
          ResponseCode: 42,
          StandardOutputContent: 'worker output\n',
          StandardErrorContent: '',
        }),
      },
    ])
    const stdout = { write: vi.fn() }
    const stderr = { write: vi.fn() }

    const result = await runSsmDispatch({
      instanceId: 'i-456',
      region: 'us-east-1',
      repo: '/srv/vimeflow',
      env: { QA_PR: '349' },
      timeoutSeconds: 30,
      stdout,
      stderr,
      spawnImpl: mockSpawn,
      pollIntervalMs: 10,
    })

    expect(mockSpawn).toHaveBeenCalledTimes(3)
    expect(result).toEqual({ code: 42, signal: null })
    expect(stdout.write).toHaveBeenCalledWith('worker output\n')
  })

  test('returns immediately on non-transient get-command-invocation errors', async () => {
    const mockSpawn = makeMockSpawn([
      {
        stdout: JSON.stringify({ Command: { CommandId: 'cmd-789' } }),
      },
      {
        code: 255,
        stderr:
          'An error occurred (AccessDeniedException) when calling the GetCommandInvocation operation',
      },
    ])
    const stdout = { write: vi.fn() }
    const stderr = { write: vi.fn() }

    const result = await runSsmDispatch({
      instanceId: 'i-789',
      region: 'us-west-2',
      repo: '/srv/vimeflow',
      env: { QA_PR: '349' },
      timeoutSeconds: 30,
      stdout,
      stderr,
      spawnImpl: mockSpawn,
    })

    expect(mockSpawn).toHaveBeenCalledTimes(2)
    expect(result.code).toBe(255)
    expect(stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('AccessDeniedException')
    )
  })
})
