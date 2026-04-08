import { describe, test, expect, beforeEach, vi } from 'vitest'
import { MockTerminalService, createTerminalService } from './terminalService'

describe('MockTerminalService', () => {
  let service: MockTerminalService

  beforeEach(() => {
    service = new MockTerminalService()
  })

  describe('spawn', () => {
    test('spawns a new PTY session', async () => {
      const result = await service.spawn({
        shell: '/bin/bash',
        cwd: '/home/user',
      })

      expect(result.sessionId).toMatch(/^mock-session-\d+$/)
      expect(result.pid).toBeGreaterThan(0)
    })

    test('assigns unique session IDs', async () => {
      const result1 = await service.spawn({
        shell: '/bin/bash',
        cwd: '/home/user',
      })

      const result2 = await service.spawn({
        shell: '/bin/bash',
        cwd: '/home/user',
      })

      expect(result1.sessionId).not.toBe(result2.sessionId)
    })

    test('assigns unique PIDs', async () => {
      const result1 = await service.spawn({
        shell: '/bin/bash',
        cwd: '/home/user',
      })

      const result2 = await service.spawn({
        shell: '/bin/bash',
        cwd: '/home/user',
      })

      expect(result1.pid).not.toBe(result2.pid)
    })

    test('emits initial prompt after spawn', async () => {
      const onData = vi.fn()
      service.onData(onData)

      const { sessionId } = await service.spawn({
        shell: '/bin/bash',
        cwd: '/home/user',
      })

      await new Promise((resolve) => setTimeout(resolve, 150))

      expect(onData).toHaveBeenCalledWith(sessionId, '$ ')
    })
  })

  describe('write', () => {
    test('echoes input back', async () => {
      const { sessionId } = await service.spawn({
        shell: '/bin/bash',
        cwd: '/home/user',
      })

      const onData = vi.fn()
      service.onData(onData)

      await service.write({ sessionId, data: 'hello' })

      expect(onData).toHaveBeenCalledWith(sessionId, 'hello')
    })

    test('simulates echo command output', async () => {
      const { sessionId } = await service.spawn({
        shell: '/bin/bash',
        cwd: '/home/user',
      })

      const onData = vi.fn()
      service.onData(onData)

      await service.write({ sessionId, data: 'echo hello' })

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(onData).toHaveBeenCalledWith(sessionId, 'echo hello')
      expect(onData).toHaveBeenCalledWith(sessionId, 'hello\r\n$ ')
    })

    test('simulates pwd command output', async () => {
      const { sessionId } = await service.spawn({
        shell: '/bin/bash',
        cwd: '/home/user',
      })

      const onData = vi.fn()
      service.onData(onData)

      await service.write({ sessionId, data: 'pwd' })

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(onData).toHaveBeenCalledWith(sessionId, 'pwd')
      expect(onData).toHaveBeenCalledWith(sessionId, '/home/user\r\n$ ')
    })

    test('throws error for non-existent session', async () => {
      await expect(
        service.write({ sessionId: 'invalid', data: 'test' })
      ).rejects.toThrow('Session invalid not found or not running')
    })

    test('throws error for killed session', async () => {
      const { sessionId } = await service.spawn({
        shell: '/bin/bash',
        cwd: '/home/user',
      })

      await service.kill({ sessionId })

      await expect(service.write({ sessionId, data: 'test' })).rejects.toThrow(
        `Session ${sessionId} not found or not running`
      )
    })
  })

  describe('resize', () => {
    test('resizes PTY without error', async () => {
      const { sessionId } = await service.spawn({
        shell: '/bin/bash',
        cwd: '/home/user',
      })

      await expect(
        service.resize({ sessionId, rows: 30, cols: 100 })
      ).resolves.toBeUndefined()
    })

    test('throws error for non-existent session', async () => {
      await expect(
        service.resize({ sessionId: 'invalid', rows: 30, cols: 100 })
      ).rejects.toThrow('Session invalid not found or not running')
    })
  })

  describe('kill', () => {
    test('kills PTY session', async () => {
      const { sessionId } = await service.spawn({
        shell: '/bin/bash',
        cwd: '/home/user',
      })

      await expect(service.kill({ sessionId })).resolves.toBeUndefined()
    })

    test('emits exit event on kill', async () => {
      const { sessionId } = await service.spawn({
        shell: '/bin/bash',
        cwd: '/home/user',
      })

      const onExit = vi.fn()
      service.onExit(onExit)

      await service.kill({ sessionId })

      expect(onExit).toHaveBeenCalledWith(sessionId, 0, undefined)
    })

    test('removes session from active sessions', async () => {
      const { sessionId } = await service.spawn({
        shell: '/bin/bash',
        cwd: '/home/user',
      })

      expect(service.getActiveSessions()).toContain(sessionId)

      await service.kill({ sessionId })

      expect(service.getActiveSessions()).not.toContain(sessionId)
    })

    test('throws error for non-existent session', async () => {
      await expect(service.kill({ sessionId: 'invalid' })).rejects.toThrow(
        'Session invalid not found'
      )
    })
  })

  describe('event subscriptions', () => {
    test('onData registers callback', async () => {
      const callback = vi.fn()
      const unsubscribe = service.onData(callback)

      const { sessionId } = await service.spawn({
        shell: '/bin/bash',
        cwd: '/home/user',
      })

      service.emitData(sessionId, 'test data')

      expect(callback).toHaveBeenCalledWith(sessionId, 'test data')

      unsubscribe()
    })

    test('onData unsubscribe removes callback', async () => {
      const callback = vi.fn()
      const unsubscribe = service.onData(callback)

      const { sessionId } = await service.spawn({
        shell: '/bin/bash',
        cwd: '/home/user',
      })

      unsubscribe()

      service.emitData(sessionId, 'test data')

      expect(callback).not.toHaveBeenCalled()
    })

    test('onExit registers callback', async () => {
      const callback = vi.fn()
      const unsubscribe = service.onExit(callback)

      const { sessionId } = await service.spawn({
        shell: '/bin/bash',
        cwd: '/home/user',
      })

      service.emitExit(sessionId, 0)

      expect(callback).toHaveBeenCalledWith(sessionId, 0, undefined)

      unsubscribe()
    })

    test('onExit with signal', async () => {
      const callback = vi.fn()
      service.onExit(callback)

      const { sessionId } = await service.spawn({
        shell: '/bin/bash',
        cwd: '/home/user',
      })

      service.emitExit(sessionId, 1, 'SIGTERM')

      expect(callback).toHaveBeenCalledWith(sessionId, 1, 'SIGTERM')
    })

    test('onError registers callback', async () => {
      const callback = vi.fn()
      const unsubscribe = service.onError(callback)

      const { sessionId } = await service.spawn({
        shell: '/bin/bash',
        cwd: '/home/user',
      })

      service.emitError(sessionId, 'Test error')

      expect(callback).toHaveBeenCalledWith(sessionId, 'Test error', undefined)

      unsubscribe()
    })

    test('onError with code', async () => {
      const callback = vi.fn()
      service.onError(callback)

      const { sessionId } = await service.spawn({
        shell: '/bin/bash',
        cwd: '/home/user',
      })

      service.emitError(sessionId, 'Permission denied', 'EACCES')

      expect(callback).toHaveBeenCalledWith(
        sessionId,
        'Permission denied',
        'EACCES'
      )
    })
  })

  describe('getActiveSessions', () => {
    test('returns empty array initially', () => {
      expect(service.getActiveSessions()).toEqual([])
    })

    test('returns active session IDs', async () => {
      const { sessionId: id1 } = await service.spawn({
        shell: '/bin/bash',
        cwd: '/home/user',
      })

      const { sessionId: id2 } = await service.spawn({
        shell: '/bin/bash',
        cwd: '/home/user',
      })

      const active = service.getActiveSessions()

      expect(active).toContain(id1)
      expect(active).toContain(id2)
      expect(active).toHaveLength(2)
    })
  })
})

describe('createTerminalService', () => {
  test('returns a terminal service instance', () => {
    const service = createTerminalService()

    expect(service).toBeDefined()
    expect(service.spawn).toBeInstanceOf(Function)
    expect(service.write).toBeInstanceOf(Function)
    expect(service.resize).toBeInstanceOf(Function)
    expect(service.kill).toBeInstanceOf(Function)
  })
})
