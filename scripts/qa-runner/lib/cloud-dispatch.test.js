import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  acquireWorkerLease,
  activeWorkerLeaseCount,
  cycleEnv,
  dispatchConfig,
  ensureWorkerInstanceRunning,
  localDispatchPlan,
  parseWorkerInstanceIds,
  remoteCycleCommand,
  runDispatch,
  runSsmDispatch,
  shellQuote,
  sshDispatchPlan,
  stopSsmWorkerBestEffort,
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
        QA_WORKER_KEEP_ALIVE: '1',
        QA_WORKER_MIN_FREE_PERCENT: '20',
        QA_RUNNER_REF: 'main',
        QA_APPROVE: '1',
        QA_WORKER_INSTANCE_ID: 'i-123',
        GH_TOKEN: 'secret',
      })
    ).toEqual({
      ...cycle,
      QA_WORKER_KEEP_ALIVE: '1',
      QA_WORKER_REFRESH_RUNNER: '1',
      QA_WORKER_REF: 'main',
      QA_WORKER_MIN_FREE_PERCENT: '20',
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

  test('parses burst worker lifecycle flags', () => {
    expect(
      dispatchConfig({
        QA_WORKER_BURST: '1',
        QA_WORKER_STOP_AFTER_RUN: 'true',
        QA_WORKER_KEEP_ALIVE: 'yes',
        QA_WORKER_READY_TIMEOUT_SECONDS: '900',
      })
    ).toMatchObject({
      burst: true,
      stopAfterRun: true,
      keepAlive: true,
      readyTimeoutSeconds: 900,
    })
  })

  test('parses a comma or whitespace separated SSM worker fleet', () => {
    expect(
      parseWorkerInstanceIds({
        QA_WORKER_INSTANCE_IDS: 'i-one, i-two\ni-three i-two',
      })
    ).toEqual(['i-one', 'i-two', 'i-three'])

    expect(
      dispatchConfig({
        QA_WORKER_MODE: 'ssm',
        QA_WORKER_INSTANCE_IDS: 'i-one,i-two',
      })
    ).toMatchObject({
      instanceId: 'i-one',
      instanceIds: ['i-one', 'i-two'],
      fleetLeaseEnabled: true,
      capacityPerInstance: 2,
    })
  })

  test('keeps single-instance dispatch backward compatible when no fleet env is set', () => {
    expect(
      dispatchConfig({
        QA_WORKER_MODE: 'ssm',
        QA_WORKER_INSTANCE_ID: 'i-single',
      })
    ).toMatchObject({
      instanceId: 'i-single',
      instanceIds: ['i-single'],
      fleetLeaseEnabled: false,
      capacityPerInstance: 1,
    })
  })

  test('rejects invalid worker fleet capacity', () => {
    expect(() =>
      dispatchConfig({
        QA_WORKER_INSTANCE_IDS: 'i-one,i-two',
        QA_WORKER_CAPACITY_PER_INSTANCE: '0',
      })
    ).toThrow('QA_WORKER_CAPACITY_PER_INSTANCE must be a positive integer')
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
    ).toThrow('QA_WORKER_INSTANCE_ID or QA_WORKER_INSTANCE_IDS is required')

    expect(() =>
      ssmSendCommandArgs({
        instanceId: 'i-123',
        repo: '/srv/vimeflow',
        env: cycle,
      })
    ).toThrow('QA_WORKER_REGION or AWS_REGION is required')
  })
})

describe('worker fleet leases', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('fills per-instance slots before leasing the next worker', async () => {
    const leaseDir = mkdtempSync(join(tmpdir(), 'qa-worker-leases-'))
    try {
      const first = await acquireWorkerLease({
        instanceIds: ['i-one', 'i-two'],
        capacityPerInstance: 2,
        leaseDir,
        pollIntervalMs: 1,
        stdout: { write: vi.fn() },
      })

      const second = await acquireWorkerLease({
        instanceIds: ['i-one', 'i-two'],
        capacityPerInstance: 2,
        leaseDir,
        pollIntervalMs: 1,
        stdout: { write: vi.fn() },
      })

      const third = await acquireWorkerLease({
        instanceIds: ['i-one', 'i-two'],
        capacityPerInstance: 2,
        leaseDir,
        pollIntervalMs: 1,
        stdout: { write: vi.fn() },
      })

      expect(first).toMatchObject({ instanceId: 'i-one', slot: 0 })
      expect(second).toMatchObject({ instanceId: 'i-one', slot: 1 })
      expect(third).toMatchObject({ instanceId: 'i-two', slot: 0 })

      first.release()
      second.release()
      third.release()
    } finally {
      rmSync(leaseDir, { recursive: true, force: true })
    }
  })

  test('removes stale leases whose owning process is gone', async () => {
    const leaseDir = mkdtempSync(join(tmpdir(), 'qa-worker-leases-'))
    try {
      writeFileSync(
        join(leaseDir, 'i-one.0.lock'),
        JSON.stringify({
          instanceId: 'i-one',
          slot: 0,
          pid: 99999999,
          createdAt: new Date().toISOString(),
        })
      )

      const lease = await acquireWorkerLease({
        instanceIds: ['i-one'],
        capacityPerInstance: 1,
        leaseDir,
        pollIntervalMs: 1,
        stdout: { write: vi.fn() },
      })

      expect(lease).toMatchObject({ instanceId: 'i-one', slot: 0 })
      expect(activeWorkerLeaseCount({ leaseDir, instanceId: 'i-one' })).toBe(1)
      lease.release()
    } finally {
      rmSync(leaseDir, { recursive: true, force: true })
    }
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

describe('runDispatch', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test('leases the next SSM worker when earlier fleet slots are full', async () => {
    const leaseDir = mkdtempSync(join(tmpdir(), 'qa-worker-leases-'))
    try {
      for (const slot of [0, 1]) {
        writeFileSync(
          join(leaseDir, `i-one.${slot}.lock`),
          JSON.stringify({
            instanceId: 'i-one',
            slot,
            pid: process.pid,
            createdAt: new Date().toISOString(),
          })
        )
      }

      const mockSpawn = makeMockSpawn([
        {
          stdout: JSON.stringify({ Command: { CommandId: 'cmd-fleet' } }),
        },
        {
          stdout: JSON.stringify({
            Status: 'Success',
            ResponseCode: 0,
            StandardOutputContent: 'fleet done\n',
            StandardErrorContent: '',
          }),
        },
      ])
      const stdout = { write: vi.fn() }

      const result = await runDispatch({
        config: {
          mode: 'ssm',
          repo: '/srv/vimeflow',
          instanceId: 'i-one',
          instanceIds: ['i-one', 'i-two'],
          fleetLeaseEnabled: true,
          capacityPerInstance: 2,
          leaseDir,
          leaseWaitSeconds: 1,
          leasePollIntervalMs: 1,
          leaseStaleSeconds: 86400,
          region: 'us-west-1',
          timeoutSeconds: 30,
          burst: false,
          stopAfterRun: false,
          keepAlive: false,
          readyTimeoutSeconds: 30,
        },
        env: { QA_PR: '401' },
        stdout,
        stderr: { write: vi.fn() },
        spawnImpl: mockSpawn,
        pollIntervalMs: 1,
      })

      expect(result).toEqual({ code: 0, signal: null })
      expect(stdout.write).toHaveBeenCalledWith(
        'worker fleet: leased i-two slot 1/2\n'
      )

      expect(mockSpawn.mock.calls[0][1]).toEqual(
        expect.arrayContaining(['--instance-ids', 'i-two'])
      )
    } finally {
      rmSync(leaseDir, { recursive: true, force: true })
    }
  })
})

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

  test('prints an explicit signal when SSM fails with no command output', async () => {
    const mockSpawn = makeMockSpawn([
      {
        stdout: JSON.stringify({ Command: { CommandId: 'cmd-empty' } }),
      },
      {
        stdout: JSON.stringify({
          CommandId: 'cmd-empty',
          Status: 'Failed',
          ResponseCode: 1,
          StandardOutputContent: '',
          StandardErrorContent: '',
        }),
      },
    ])
    const stderr = { write: vi.fn() }

    const result = await runSsmDispatch({
      instanceId: 'i-empty',
      region: 'us-west-1',
      repo: '/srv/vimeflow',
      env: { QA_PR: '457' },
      timeoutSeconds: 30,
      stdout: { write: vi.fn() },
      stderr,
      spawnImpl: mockSpawn,
      pollIntervalMs: 1,
    })

    expect(result).toEqual({ code: 1, signal: null })
    expect(stderr.write).toHaveBeenCalledWith(
      'SSM command cmd-empty Failed (response 1) produced no output\n'
    )
  })

  test('keeps AWS CLI env separate from forwarded PR cycle env', async () => {
    const awsEnv = { AWS_PROFILE: 'qa-control', PATH: '/usr/bin' }

    const mockSpawn = makeMockSpawn([
      {
        stdout: JSON.stringify({ Command: { CommandId: 'cmd-env' } }),
      },
      {
        stdout: JSON.stringify({
          Status: 'Success',
          ResponseCode: 0,
          StandardOutputContent: '',
          StandardErrorContent: '',
        }),
      },
    ])

    const result = await runSsmDispatch({
      instanceId: 'i-env',
      region: 'us-west-1',
      repo: '/srv/vimeflow',
      env: { QA_PR: '362' },
      awsEnv,
      timeoutSeconds: 30,
      stdout: { write: vi.fn() },
      stderr: { write: vi.fn() },
      spawnImpl: mockSpawn,
      pollIntervalMs: 1,
    })

    expect(result).toEqual({ code: 0, signal: null })
    expect(
      mockSpawn.mock.calls.every(([, , opts]) => opts.env === awsEnv)
    ).toBe(true)

    const sendArgs = mockSpawn.mock.calls[0][1]
    const params = JSON.parse(sendArgs[sendArgs.indexOf('--parameters') + 1])

    expect(params.commands[0]).toContain("QA_PR='362'")
    expect(params.commands[0]).not.toContain('AWS_PROFILE')
  })

  test('starts a stopped burst worker before SSM dispatch and stops it after success', async () => {
    const mockSpawn = makeMockSpawn([
      {
        stdout: JSON.stringify({
          Reservations: [{ Instances: [{ State: { Name: 'stopped' } }] }],
        }),
      },
      { stdout: JSON.stringify({ StartingInstances: [] }) },
      {
        stdout: JSON.stringify({
          Reservations: [{ Instances: [{ State: { Name: 'pending' } }] }],
        }),
      },
      {
        stdout: JSON.stringify({
          Reservations: [{ Instances: [{ State: { Name: 'running' } }] }],
        }),
      },
      { code: 254, stderr: 'InvalidInstanceId: not in a valid state' },
      {
        stdout: JSON.stringify({ Command: { CommandId: 'cmd-burst' } }),
      },
      {
        stdout: JSON.stringify({
          Status: 'Success',
          ResponseCode: 0,
          StandardOutputContent: 'fixed\n',
          StandardErrorContent: '',
        }),
      },
      { stdout: JSON.stringify({ StoppingInstances: [] }) },
    ])
    const stdout = { write: vi.fn() }
    const stderr = { write: vi.fn() }

    const result = await runSsmDispatch({
      instanceId: 'i-burst',
      region: 'us-west-1',
      repo: '/srv/vimeflow',
      env: { QA_PR: '361' },
      timeoutSeconds: 30,
      burst: true,
      stopAfterRun: true,
      readyTimeoutSeconds: 60,
      stdout,
      stderr,
      spawnImpl: mockSpawn,
      pollIntervalMs: 1,
    })

    expect(result).toEqual({ code: 0, signal: null })
    expect(mockSpawn.mock.calls.map(([, args]) => args.slice(0, 2))).toEqual([
      ['ec2', 'describe-instances'],
      ['ec2', 'start-instances'],
      ['ec2', 'describe-instances'],
      ['ec2', 'describe-instances'],
      ['ssm', 'send-command'],
      ['ssm', 'send-command'],
      ['ssm', 'get-command-invocation'],
      ['ec2', 'stop-instances'],
    ])

    expect(stdout.write).toHaveBeenCalledWith(
      'worker i-burst: starting stopped instance\n'
    )

    expect(stdout.write).toHaveBeenCalledWith('worker i-burst: EC2 running\n')

    expect(stdout.write).toHaveBeenCalledWith(
      'worker i-burst: waiting for SSM command target\n'
    )
    expect(stdout.write).toHaveBeenCalledWith('fixed\n')
  })

  test('preserves worker exit code when best-effort stop fails', async () => {
    const mockSpawn = makeMockSpawn([
      {
        stdout: JSON.stringify({
          Reservations: [{ Instances: [{ State: { Name: 'running' } }] }],
        }),
      },
      {
        stdout: JSON.stringify({ Command: { CommandId: 'cmd-burst' } }),
      },
      {
        stdout: JSON.stringify({
          Status: 'Failed',
          ResponseCode: 9,
          StandardOutputContent: '',
          StandardErrorContent: 'worker failed\n',
        }),
      },
      {
        code: 255,
        stderr: 'stop denied',
      },
    ])
    const stdout = { write: vi.fn() }
    const stderr = { write: vi.fn() }

    const result = await runSsmDispatch({
      instanceId: 'i-burst',
      region: 'us-west-1',
      repo: '/srv/vimeflow',
      env: { QA_PR: '361' },
      timeoutSeconds: 30,
      burst: true,
      stopAfterRun: true,
      stdout,
      stderr,
      spawnImpl: mockSpawn,
      pollIntervalMs: 1,
    })

    expect(result).toEqual({ code: 9, signal: null })
    expect(stderr.write).toHaveBeenCalledWith('worker failed\n')
    expect(stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('warning: failed to stop worker i-burst')
    )
  })

  test('keeps a burst worker running when keep-alive is requested', async () => {
    const mockSpawn = makeMockSpawn([
      {
        stdout: JSON.stringify({
          Reservations: [{ Instances: [{ State: { Name: 'running' } }] }],
        }),
      },
      {
        stdout: JSON.stringify({ Command: { CommandId: 'cmd-burst' } }),
      },
      {
        stdout: JSON.stringify({
          Status: 'Success',
          ResponseCode: 0,
          StandardOutputContent: 'fixed\n',
          StandardErrorContent: '',
        }),
      },
    ])
    const stdout = { write: vi.fn() }

    const result = await runSsmDispatch({
      instanceId: 'i-burst',
      region: 'us-west-1',
      repo: '/srv/vimeflow',
      env: { QA_PR: '361' },
      timeoutSeconds: 30,
      burst: true,
      stopAfterRun: true,
      keepAlive: true,
      stdout,
      stderr: { write: vi.fn() },
      spawnImpl: mockSpawn,
      pollIntervalMs: 1,
    })

    expect(result).toEqual({ code: 0, signal: null })
    expect(mockSpawn.mock.calls.map(([, args]) => args.slice(0, 2))).toEqual([
      ['ec2', 'describe-instances'],
      ['ssm', 'send-command'],
      ['ssm', 'get-command-invocation'],
    ])

    expect(stdout.write).toHaveBeenCalledWith(
      'worker i-burst: keep alive requested; skip stop\n'
    )
  })

  test('stops a burst worker that times out after being started', async () => {
    const mockSpawn = makeMockSpawn([
      {
        stdout: JSON.stringify({
          Reservations: [{ Instances: [{ State: { Name: 'stopped' } }] }],
        }),
      },
      { stdout: JSON.stringify({ StartingInstances: [] }) },
      { stdout: JSON.stringify({ StoppingInstances: [] }) },
    ])

    await expect(
      runSsmDispatch({
        instanceId: 'i-timeout',
        region: 'us-west-1',
        repo: '/srv/vimeflow',
        env: { QA_PR: '362' },
        timeoutSeconds: 30,
        burst: true,
        stopAfterRun: true,
        readyTimeoutSeconds: 0,
        stdout: { write: vi.fn() },
        stderr: { write: vi.fn() },
        spawnImpl: mockSpawn,
        pollIntervalMs: 1,
      })
    ).rejects.toThrow('worker i-timeout did not become EC2 running')

    expect(mockSpawn.mock.calls.map(([, args]) => args.slice(0, 2))).toEqual([
      ['ec2', 'describe-instances'],
      ['ec2', 'start-instances'],
      ['ec2', 'stop-instances'],
    ])
  })
})

describe('burst worker helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('fails readiness when the worker reaches a terminal instance state', async () => {
    const mockSpawn = makeMockSpawn([
      {
        stdout: JSON.stringify({
          Reservations: [{ Instances: [{ State: { Name: 'terminated' } }] }],
        }),
      },
    ])

    await expect(
      ensureWorkerInstanceRunning({
        instanceId: 'i-gone',
        region: 'us-west-1',
        timeoutSeconds: 1,
        pollIntervalMs: 1,
        stdout: { write: vi.fn() },
        spawnImpl: mockSpawn,
      })
    ).rejects.toThrow('worker i-gone cannot be started')
  })

  test('starts a worker that transitions from stopping to stopped while polling', async () => {
    const mockSpawn = makeMockSpawn([
      {
        stdout: JSON.stringify({
          Reservations: [{ Instances: [{ State: { Name: 'stopping' } }] }],
        }),
      },
      {
        stdout: JSON.stringify({
          Reservations: [{ Instances: [{ State: { Name: 'stopped' } }] }],
        }),
      },
      { stdout: JSON.stringify({ StartingInstances: [] }) },
      {
        stdout: JSON.stringify({
          Reservations: [{ Instances: [{ State: { Name: 'pending' } }] }],
        }),
      },
      {
        stdout: JSON.stringify({
          Reservations: [{ Instances: [{ State: { Name: 'running' } }] }],
        }),
      },
    ])
    const stdout = { write: vi.fn() }
    const onStarted = vi.fn()

    const result = await ensureWorkerInstanceRunning({
      instanceId: 'i-stop-then-start',
      region: 'us-west-1',
      timeoutSeconds: 5,
      pollIntervalMs: 1,
      stdout,
      spawnImpl: mockSpawn,
      onStarted,
    })

    expect(result).toEqual({ started: true, state: 'running' })
    expect(onStarted).toHaveBeenCalledTimes(1)
    expect(stdout.write).toHaveBeenCalledWith(
      'worker i-stop-then-start: starting stopped instance\n'
    )

    expect(stdout.write).toHaveBeenCalledWith(
      'worker i-stop-then-start: EC2 running\n'
    )
  })

  test('returns the stop-instances result for direct best-effort calls', async () => {
    const mockSpawn = makeMockSpawn([
      { stdout: JSON.stringify({ StoppingInstances: [] }) },
    ])

    await expect(
      stopSsmWorkerBestEffort({
        instanceId: 'i-burst',
        region: 'us-west-1',
        stderr: { write: vi.fn() },
        spawnImpl: mockSpawn,
      })
    ).resolves.toMatchObject({ code: 0 })
  })
})
