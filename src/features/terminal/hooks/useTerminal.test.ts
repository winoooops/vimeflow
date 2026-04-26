import { renderHook, waitFor } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import { useTerminal } from './useTerminal'
import { MockTerminalService } from '../services/terminalService'

// Mock xterm Terminal with test helpers
interface MockTerminal extends Terminal {
  _mockTriggerData: (data: string) => void
}

const createMockTerminal = (): MockTerminal => {
  const listeners = new Map<string, ((data: string) => void)[]>()

  return {
    onData: vi.fn((callback: (data: string) => void) => {
      const existing = listeners.get('data') ?? []
      listeners.set('data', [...existing, callback])

      return {
        dispose: vi.fn(() => {
          const current = listeners.get('data') ?? []
          listeners.set(
            'data',
            current.filter((cb) => cb !== callback)
          )
        }),
      }
    }),
    write: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn(),
    _mockTriggerData: (data: string) => {
      const callbacks = listeners.get('data') ?? []
      callbacks.forEach((cb) => cb(data))
    },
  } as unknown as MockTerminal
}

describe('useTerminal', () => {
  let mockService: MockTerminalService
  let mockTerminal: MockTerminal

  beforeEach(() => {
    mockService = new MockTerminalService()
    mockTerminal = createMockTerminal()

    // Spy on all mock service methods
    vi.spyOn(mockService, 'spawn')
    vi.spyOn(mockService, 'write')
    vi.spyOn(mockService, 'resize')
    vi.spyOn(mockService, 'kill')
    vi.spyOn(mockService, 'onData')
    vi.spyOn(mockService, 'onExit')
    vi.spyOn(mockService, 'onError')
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('spawns PTY on mount', async () => {
    const { result } = renderHook(() =>
      useTerminal({
        terminal: mockTerminal,
        service: mockService,
        cwd: '/home/user',
      })
    )

    await waitFor(() => {
      expect(mockService.spawn).toHaveBeenCalledOnce()
      expect(mockService.spawn).toHaveBeenCalledWith({
        shell: typeof process !== 'undefined' ? process.env.SHELL : undefined, // Uses process.env.SHELL if available, undefined otherwise
        cwd: '/home/user',
        env: expect.any(Object),
      })
      expect(result.current.status).toBe('running')
      expect(result.current.session).toBeDefined()
    })
  })

  // Reconnection feature removed - sessionId parameter no longer supported
  // This test is kept as documentation of future feature
  test.skip('reconnects to existing session when sessionId is provided', async () => {
    // TODO: Re-enable when backend supports persistent PTY sessions
    // Will require service.hasSession() method and reconnection logic
  })

  test('returns idle status initially', () => {
    const { result } = renderHook(() =>
      useTerminal({
        terminal: mockTerminal,
        service: mockService,
        cwd: '/home/user',
      })
    )

    expect(result.current.status).toBe('idle')
    expect(result.current.session).toBeNull()
  })

  test('writes PTY data to xterm terminal', async () => {
    const { result } = renderHook(() =>
      useTerminal({
        terminal: mockTerminal,
        service: mockService,
        cwd: '/home/user',
      })
    )

    await waitFor(() => {
      expect(result.current.status).toBe('running')
    })

    // Emit data from PTY
    mockService.emit('data', {
      sessionId: result.current.session!.id,
      data: 'Hello from PTY\r\n',
    })

    expect(mockTerminal.write).toHaveBeenCalledWith('Hello from PTY\r\n')
  })

  test('handles keyboard input from xterm', async () => {
    const { result } = renderHook(() =>
      useTerminal({
        terminal: mockTerminal,
        service: mockService,
        cwd: '/home/user',
      })
    )

    await waitFor(() => {
      expect(result.current.status).toBe('running')
    })

    const sessionId = result.current.session!.id

    // Simulate user typing in xterm
    mockTerminal._mockTriggerData('ls\r')

    await waitFor(() => {
      expect(mockService.write).toHaveBeenCalledWith({
        sessionId,
        data: 'ls\r',
      })
    })
  })

  test('handles PTY exit event', async () => {
    const { result } = renderHook(() =>
      useTerminal({
        terminal: mockTerminal,
        service: mockService,
        cwd: '/home/user',
      })
    )

    await waitFor(() => {
      expect(result.current.status).toBe('running')
    })

    const sessionId = result.current.session!.id

    // Emit exit event
    mockService.emit('exit', {
      sessionId,
      code: 0,
    })

    await waitFor(() => {
      expect(result.current.status).toBe('exited')
      expect(mockTerminal.write).toHaveBeenCalledWith(
        expect.stringContaining('Process exited with code 0')
      )
    })
  })

  test('handles PTY exit with non-zero code', async () => {
    const { result } = renderHook(() =>
      useTerminal({
        terminal: mockTerminal,
        service: mockService,
        cwd: '/home/user',
      })
    )

    await waitFor(() => {
      expect(result.current.status).toBe('running')
    })

    const sessionId = result.current.session!.id

    // Emit exit event with error code
    mockService.emit('exit', {
      sessionId,
      code: 1,
    })

    await waitFor(() => {
      expect(result.current.status).toBe('exited')
      expect(mockTerminal.write).toHaveBeenCalledWith(
        expect.stringContaining('Process exited with code 1')
      )
    })
  })

  test('handles PTY exit with missing exit code (EOF)', async () => {
    const { result } = renderHook(() =>
      useTerminal({
        terminal: mockTerminal,
        service: mockService,
        cwd: '/home/user',
      })
    )

    await waitFor(() => {
      expect(result.current.status).toBe('running')
    })

    const sessionId = result.current.session!.id

    // Emit exit event without code (backend sends code: None on EOF)
    mockService.emit('exit', {
      sessionId,
      code: undefined,
    })

    await waitFor(() => {
      expect(result.current.status).toBe('exited')
      // Should handle missing code gracefully (not print "code undefined")
      expect(mockTerminal.write).toHaveBeenCalledWith(
        expect.stringContaining('[Process exited]')
      )

      expect(mockTerminal.write).not.toHaveBeenCalledWith(
        expect.stringContaining('undefined')
      )
    })
  })

  test('handles PTY error event', async () => {
    const { result } = renderHook(() =>
      useTerminal({
        terminal: mockTerminal,
        service: mockService,
        cwd: '/home/user',
      })
    )

    await waitFor(() => {
      expect(result.current.status).toBe('running')
    })

    const sessionId = result.current.session!.id

    // Emit error event
    mockService.emit('error', {
      sessionId,
      message: 'Failed to write to PTY',
    })

    await waitFor(() => {
      expect(result.current.status).toBe('error')
      expect(result.current.error).toBe('Failed to write to PTY')
      expect(mockTerminal.write).toHaveBeenCalledWith(
        expect.stringContaining('Error: Failed to write to PTY')
      )
    })
  })

  test('guards input writes after PTY exit', async () => {
    const { result } = renderHook(() =>
      useTerminal({
        terminal: mockTerminal,
        service: mockService,
        cwd: '/home/user',
      })
    )

    await waitFor(() => {
      expect(result.current.status).toBe('running')
    })

    const sessionId = result.current.session!.id

    // Emit exit event
    mockService.emit('exit', {
      sessionId,
      code: 0,
    })

    await waitFor(() => {
      expect(result.current.status).toBe('exited')
    })

    // Clear write call count
    vi.mocked(mockService.write).mockClear()

    // Simulate user typing after exit
    mockTerminal._mockTriggerData('echo hello\n')

    // Write should NOT be called after exit
    expect(mockService.write).not.toHaveBeenCalled()
  })

  test('guards resize calls after PTY exit', async () => {
    const { result } = renderHook(() =>
      useTerminal({
        terminal: mockTerminal,
        service: mockService,
        cwd: '/home/user',
      })
    )

    await waitFor(() => {
      expect(result.current.status).toBe('running')
    })

    const sessionId = result.current.session!.id

    // Emit exit event
    mockService.emit('exit', {
      sessionId,
      code: 0,
    })

    await waitFor(() => {
      expect(result.current.status).toBe('exited')
    })

    // Clear resize call count
    vi.mocked(mockService.resize).mockClear()

    // Try to resize after exit
    result.current.resize(100, 30)

    // Resize should NOT be called after exit
    expect(mockService.resize).not.toHaveBeenCalled()
  })

  test('cleans up on unmount', async () => {
    const { result, unmount } = renderHook(() =>
      useTerminal({
        terminal: mockTerminal,
        service: mockService,
        cwd: '/home/user',
      })
    )

    await waitFor(() => {
      expect(result.current.status).toBe('running')
    })

    const sessionId = result.current.session!.id

    unmount()

    expect(mockService.kill).toHaveBeenCalledWith({ sessionId })
  })

  // Reconnection cleanup test removed - reconnection feature not implemented yet
  test.skip('does NOT kill reconnected session on unmount', async () => {
    // TODO: Re-enable when reconnection feature is implemented
  })

  test('does not spawn if terminal is null', () => {
    renderHook(() =>
      useTerminal({
        terminal: null,
        service: mockService,
        cwd: '/home/user',
      })
    )

    expect(mockService.spawn).not.toHaveBeenCalled()
  })

  test('passes undefined shell to let backend choose platform default', async () => {
    // Save original process.env
    const originalEnv = process.env

    // Mock process.env.SHELL as undefined
    delete (process.env as { SHELL?: string }).SHELL

    renderHook(() =>
      useTerminal({
        terminal: mockTerminal,
        service: mockService,
        cwd: '/home/user',
      })
    )

    await waitFor(() => {
      expect(mockService.spawn).toHaveBeenCalledWith({
        shell: undefined, // Should be undefined, not '/bin/bash'
        cwd: '/home/user',
        env: expect.any(Object),
      })
    })

    // Restore original env
    process.env = originalEnv
  })

  test('handles custom shell', async () => {
    renderHook(() =>
      useTerminal({
        terminal: mockTerminal,
        service: mockService,
        cwd: '/home/user',
        shell: '/bin/zsh',
      })
    )

    await waitFor(() => {
      expect(mockService.spawn).toHaveBeenCalledWith({
        shell: '/bin/zsh',
        cwd: '/home/user',
        env: expect.any(Object),
      })
    })
  })

  test('handles custom environment variables', async () => {
    const customEnv = { CUSTOM_VAR: 'value' }

    renderHook(() =>
      useTerminal({
        terminal: mockTerminal,
        service: mockService,
        cwd: '/home/user',
        env: customEnv,
      })
    )

    await waitFor(() => {
      expect(mockService.spawn).toHaveBeenCalledWith({
        shell: typeof process !== 'undefined' ? process.env.SHELL : undefined, // Uses process.env.SHELL if available
        cwd: '/home/user',
        env: customEnv,
      })
    })
  })

  // Reconnection with sessionId change removed - feature not implemented yet
  test.skip('updates session when sessionId changes', async () => {
    // TODO: Re-enable when reconnection feature is implemented
  })

  test('provides resize function', async () => {
    const { result } = renderHook(() =>
      useTerminal({
        terminal: mockTerminal,
        service: mockService,
        cwd: '/home/user',
      })
    )

    await waitFor(() => {
      expect(result.current.status).toBe('running')
    })

    const sessionId = result.current.session!.id

    result.current.resize(80, 24)

    expect(mockService.resize).toHaveBeenCalledWith({
      sessionId,
      cols: 80,
      rows: 24,
    })
  })

  test('returns error message on spawn failure', async () => {
    // Override spawn to reject
    mockService.spawn = vi
      .fn()
      .mockRejectedValue(new Error('Failed to spawn PTY'))

    const { result } = renderHook(() =>
      useTerminal({
        terminal: mockTerminal,
        service: mockService,
        cwd: '/home/user',
      })
    )

    await waitFor(() => {
      expect(result.current.status).toBe('error')
      expect(result.current.error).toBe('Failed to spawn PTY')
    })
  })

  test('does not write to terminal after unmount', async () => {
    const { result, unmount } = renderHook(() =>
      useTerminal({
        terminal: mockTerminal,
        service: mockService,
        cwd: '/home/user',
      })
    )

    await waitFor(() => {
      expect(result.current.status).toBe('running')
    })

    const sessionId = result.current.session!.id

    unmount()

    // Clear previous calls
    vi.clearAllMocks()

    // Emit data after unmount
    mockService.emit('data', {
      sessionId,
      data: 'Should not be written',
    })

    expect(mockTerminal.write).not.toHaveBeenCalled()
  })

  describe('Restored mode (replay + cursor dedupe)', () => {
    test('skips spawn when restoredFrom is provided', async () => {
      const { result } = renderHook(() =>
        useTerminal({
          terminal: mockTerminal,
          service: mockService,
          cwd: '/home/user',
          restoredFrom: {
            sessionId: 'restored-session-id',
            cwd: '/home/user',
            pid: 9999,
            replayData: 'Restored output\r\n',
            replayEndOffset: 100,
            bufferedEvents: [],
          },
        })
      )

      await waitFor(() => {
        expect(result.current.status).toBe('running')
        expect(result.current.session?.id).toBe('restored-session-id')
      })

      // Should NOT spawn a new PTY
      expect(mockService.spawn).not.toHaveBeenCalled()

      // Should write replay data to terminal
      expect(mockTerminal.write).toHaveBeenCalledWith('Restored output\r\n')
    })

    test('writes replay data before draining buffered events', async () => {
      const writes: string[] = []
      vi.mocked(mockTerminal.write).mockImplementation(
        (data: string | Uint8Array) => {
          writes.push(
            typeof data === 'string' ? data : new TextDecoder().decode(data)
          )
        }
      )

      renderHook(() =>
        useTerminal({
          terminal: mockTerminal,
          service: mockService,
          restoredFrom: {
            sessionId: 'session-1',
            cwd: '/tmp',
            pid: 1234,
            replayData: 'REPLAY',
            replayEndOffset: 50,
            bufferedEvents: [
              { sessionId: 'session-1', data: 'BUFFERED', offsetStart: 50 },
            ],
          },
        })
      )

      await waitFor(() => {
        expect(writes.length).toBeGreaterThanOrEqual(2)
      })

      // Replay data should be written first
      expect(writes[0]).toBe('REPLAY')
      // Then buffered events
      expect(writes[1]).toBe('BUFFERED')
    })

    test('flushes buffered events with cursor filter (offsetStart >= replayEndOffset)', async () => {
      const writes: string[] = []
      vi.mocked(mockTerminal.write).mockImplementation(
        (data: string | Uint8Array) => {
          writes.push(
            typeof data === 'string' ? data : new TextDecoder().decode(data)
          )
        }
      )

      renderHook(() =>
        useTerminal({
          terminal: mockTerminal,
          service: mockService,
          restoredFrom: {
            sessionId: 'session-1',
            cwd: '/tmp',
            pid: 1234,
            replayData: 'REPLAY',
            replayEndOffset: 100,
            bufferedEvents: [
              { sessionId: 'session-1', data: 'BELOW', offsetStart: 99 }, // Below cursor
              { sessionId: 'session-1', data: 'AT', offsetStart: 100 }, // At cursor
              { sessionId: 'session-1', data: 'ABOVE', offsetStart: 101 }, // Above cursor
            ],
          },
        })
      )

      await waitFor(() => {
        expect(writes.length).toBeGreaterThanOrEqual(2)
      })

      // Should NOT write event below cursor (offsetStart < replayEndOffset)
      expect(writes).not.toContain('BELOW')

      // Should write events at/above cursor (offsetStart >= replayEndOffset)
      expect(writes).toContain('AT')
      expect(writes).toContain('ABOVE')
    })

    test('does not kill session on unmount when restored', async () => {
      const { unmount } = renderHook(() =>
        useTerminal({
          terminal: mockTerminal,
          service: mockService,
          restoredFrom: {
            sessionId: 'restored-session-id',
            cwd: '/tmp',
            pid: 1234,
            replayData: 'test',
            replayEndOffset: 0,
            bufferedEvents: [],
          },
        })
      )

      await waitFor(() => {
        expect(mockTerminal.write).toHaveBeenCalled()
      })

      unmount()

      // Should NOT call kill for restored sessions
      expect(mockService.kill).not.toHaveBeenCalled()
    })

    test('live event below cursor is dropped', async () => {
      const { result } = renderHook(() =>
        useTerminal({
          terminal: mockTerminal,
          service: mockService,
          restoredFrom: {
            sessionId: 'session-1',
            cwd: '/tmp',
            pid: 1234,
            replayData: 'REPLAY',
            replayEndOffset: 100,
            bufferedEvents: [],
          },
        })
      )

      await waitFor(() => {
        expect(result.current.status).toBe('running')
      })

      vi.mocked(mockTerminal.write).mockClear()

      // Emit live event with offsetStart below cursor
      mockService.emit('data', {
        sessionId: 'session-1',
        data: 'BELOW_CURSOR',
        offsetStart: 99,
      })

      // Should NOT write to terminal (below cursor)
      expect(mockTerminal.write).not.toHaveBeenCalled()
    })

    test('live event at or above cursor is written', async () => {
      const { result } = renderHook(() =>
        useTerminal({
          terminal: mockTerminal,
          service: mockService,
          restoredFrom: {
            sessionId: 'session-1',
            cwd: '/tmp',
            pid: 1234,
            replayData: 'REPLAY',
            replayEndOffset: 100,
            bufferedEvents: [],
          },
        })
      )

      await waitFor(() => {
        expect(result.current.status).toBe('running')
      })

      vi.mocked(mockTerminal.write).mockClear()

      // Emit live event at cursor
      mockService.emit('data', {
        sessionId: 'session-1',
        data: 'AT_CURSOR',
        offsetStart: 100,
      })

      expect(mockTerminal.write).toHaveBeenCalledWith('AT_CURSOR')

      vi.mocked(mockTerminal.write).mockClear()

      // Emit live event above cursor
      mockService.emit('data', {
        sessionId: 'session-1',
        data: 'ABOVE_CURSOR',
        offsetStart: 150,
      })

      expect(mockTerminal.write).toHaveBeenCalledWith('ABOVE_CURSOR')
    })
  })
})
