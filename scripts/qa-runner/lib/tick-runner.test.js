import { EventEmitter } from 'node:events'
import { describe, expect, test, vi } from 'vitest'
import { createCommandTickRunner, createTickRunner } from './tick-runner.js'

const childProcess = () => ({
  child: Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  }),
})

const config = {
  label: 'auto-review',
  approve: true,
  linearDecisionComments: true,
  linearCreateIssues: false,
  linearTeamKey: 'VIM',
  maxCiReruns: 3,
}

describe('createTickRunner', () => {
  test('keeps local mode on the existing worker.js tick path', () => {
    expect(createTickRunner({ tickRunner: 'local' }, vi.fn())).toBeNull()
  })

  test('requires a command for command mode', () => {
    expect(() =>
      createTickRunner({ tickRunner: 'command', tickCommand: '' }, vi.fn())
    ).toThrow('QA_TICK_COMMAND is required')
  })

  test('rejects unknown modes at daemon startup', () => {
    expect(() =>
      createTickRunner({ tickRunner: 'lambda' }, vi.fn())
    ).toThrow("unsupported QA_TICK_RUNNER 'lambda'")
  })
})

describe('createCommandTickRunner', () => {
  test('dispatches with the PR cycle contract in environment variables', async () => {
    const { child } = childProcess()
    const spawnImpl = vi.fn(() => child)
    const log = vi.fn()
    const stdout = { write: vi.fn() }
    const stderr = { write: vi.fn() }

    const runner = createCommandTickRunner({
      command: '/usr/local/sbin/vimeflow-dispatch-worker',
      log,
      spawnImpl,
      stdout,
      stderr,
    })

    const result = runner(340, config, 'pr:labeled')
    child.stdout.emit('data', Buffer.from('worker started\n'))
    child.stderr.emit(
      'data',
      Buffer.from('worker complete (log: /var/log/vimeflow/pr-340.log)\n')
    )
    child.stdout.emit('end')
    child.stderr.emit('end')
    child.emit('close', 0, null)

    await expect(result).resolves.toEqual({
      code: 0,
      signal: null,
      exitReason: 'worker complete (log: /var/log/vimeflow/pr-340.log)',
      logPath: '/var/log/vimeflow/pr-340.log',
    })

    expect(log).toHaveBeenCalledWith(
      'tick runner: command dispatch for #340 (pr:labeled)'
    )
    expect(stdout.write).toHaveBeenCalledWith(Buffer.from('worker started\n'))
    expect(stderr.write).toHaveBeenCalledWith(
      Buffer.from('worker complete (log: /var/log/vimeflow/pr-340.log)\n')
    )

    expect(spawnImpl).toHaveBeenCalledWith(
      '/usr/local/sbin/vimeflow-dispatch-worker',
      expect.objectContaining({
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: expect.objectContaining({
          QA_PR: '340',
          QA_REASON: 'pr:labeled',
          QA_LABEL: 'auto-review',
          QA_APPROVE: '1',
          QA_LINEAR_DECISION_COMMENTS: '1',
          QA_LINEAR_CREATE_ISSUES: '0',
          QA_LINEAR_TEAM_KEY: 'VIM',
          QA_MAX_CI_RERUNS: '3',
        }),
      })
    )
  })

  test('reports spawn failures as transient worker exits', async () => {
    const { child } = childProcess()

    const runner = createCommandTickRunner({
      command: 'dispatch-worker',
      spawnImpl: vi.fn(() => child),
    })

    const result = runner(340, config, 'poll')
    child.emit('error', new Error('missing executable'))

    await expect(result).resolves.toEqual({
      code: -1,
      signal: null,
      exitReason: 'command tick runner spawn error: missing executable',
      logPath: null,
    })
  })
})
