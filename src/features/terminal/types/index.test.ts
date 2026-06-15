import { describe, test, expect } from 'vitest'
import type {
  TerminalSession,
  TerminalTab,
  TerminalStatus,
  PTYSpawnParams,
  PTYSpawnResult,
  PTYWriteParams,
  PTYResizeParams,
  PTYKillParams,
  PTYDataEvent,
  PTYExitEvent,
  PTYErrorEvent,
} from './index'

describe('Terminal Types', () => {
  describe('TerminalStatus', () => {
    test('accepts valid status values', () => {
      const statuses: TerminalStatus[] = [
        'idle',
        'spawning',
        'running',
        'exited',
        'error',
      ]

      statuses.forEach((status) => {
        expect(status).toBeDefined()
      })
    })
  })

  describe('TerminalSession', () => {
    test('creates valid session object', () => {
      const session: TerminalSession = {
        id: 'session-1',
        name: 'Main Shell',
        pid: 12345,
        cwd: '/home/user',
        shell: '/bin/bash',
        env: { TERM: 'xterm-256color' },
        status: 'running',
        createdAt: new Date(),
        lastActivityAt: new Date(),
      }

      expect(session.id).toBe('session-1')
      expect(session.pid).toBe(12345)
      expect(session.status).toBe('running')
    })

    test('allows null pid for non-spawned sessions', () => {
      const session: TerminalSession = {
        id: 'session-2',
        name: 'Pending',
        pid: null,
        cwd: '/home/user',
        shell: '/bin/bash',
        env: {},
        status: 'idle',
        createdAt: new Date(),
        lastActivityAt: new Date(),
      }

      expect(session.pid).toBeNull()
    })
  })

  describe('TerminalTab', () => {
    test('creates valid tab object', () => {
      const tab: TerminalTab = {
        sessionId: 'session-1',
        title: 'Main Shell',
        isActive: true,
        icon: '🐚',
      }

      expect(tab.sessionId).toBe('session-1')
      expect(tab.isActive).toBe(true)
      expect(tab.icon).toBe('🐚')
    })
  })

  describe('PTY Command Parameters', () => {
    test('PTYSpawnParams with all fields', () => {
      const params: PTYSpawnParams = {
        shell: '/bin/bash',
        cwd: '/home/user',
        env: { TERM: 'xterm-256color' },
        cols: 80,
        rows: 24,
      }

      expect(params.shell).toBe('/bin/bash')
      expect(params.cols).toBe(80)
    })

    test('PTYSpawnParams with minimal fields', () => {
      const params: PTYSpawnParams = {
        shell: '/bin/bash',
        cwd: '/home/user',
      }

      expect(params.shell).toBe('/bin/bash')
      expect(params.env).toBeUndefined()
    })

    test('PTYSpawnResult structure', () => {
      const result: PTYSpawnResult = {
        sessionId: 'session-1',
        pid: 12345,
        cwd: '/home/user',
        shell: '/bin/bash',
      }

      expect(result.sessionId).toBe('session-1')
      expect(result.pid).toBe(12345)
      expect(result.cwd).toBe('/home/user')
      expect(result.shell).toBe('/bin/bash')
    })

    test('PTYWriteParams structure', () => {
      const params: PTYWriteParams = {
        sessionId: 'session-1',
        data: 'echo hello\n',
      }

      expect(params.data).toBe('echo hello\n')
    })

    test('PTYResizeParams structure', () => {
      const params: PTYResizeParams = {
        sessionId: 'session-1',
        rows: 30,
        cols: 100,
      }

      expect(params.rows).toBe(30)
      expect(params.cols).toBe(100)
    })

    test('PTYKillParams structure', () => {
      const params: PTYKillParams = {
        sessionId: 'session-1',
      }

      expect(params.sessionId).toBe('session-1')
    })
  })

  describe('PTY Event Payloads', () => {
    test('PTYDataEvent structure', () => {
      const event: PTYDataEvent = {
        sessionId: 'session-1',
        data: 'hello world\n',
        offsetStart: 0n,
        byteLen: 12n,
      }

      expect(event.sessionId).toBe('session-1')
      expect(event.data).toBe('hello world\n')
      expect(event.offsetStart).toBe(0n)
      expect(event.byteLen).toBe(12n)
    })

    test('PTYExitEvent with exit code', () => {
      const event: PTYExitEvent = {
        sessionId: 'session-1',
        code: 0,
      }

      expect(event.code).toBe(0)
    })

    test('PTYExitEvent with null code', () => {
      const event: PTYExitEvent = {
        sessionId: 'session-1',
        code: null,
      }

      expect(event.code).toBeNull()
    })

    test('PTYErrorEvent with message', () => {
      const event: PTYErrorEvent = {
        sessionId: 'session-1',
        message: 'Failed to spawn shell',
      }

      expect(event.message).toBe('Failed to spawn shell')
    })
  })

  // Terminal palette value assertions moved to src/theme/themes/obsidian-lens.test.ts
})
