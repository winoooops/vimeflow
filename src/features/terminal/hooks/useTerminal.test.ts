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
        shell: expect.any(String),
        cwd: '/home/user',
        env: expect.any(Object),
      })
      expect(result.current.status).toBe('running')
      expect(result.current.session).toBeDefined()
    })
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
        shell: expect.any(String),
        cwd: '/home/user',
        env: customEnv,
      })
    })
  })

  test('updates session when sessionId changes', async () => {
    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) =>
        useTerminal({
          terminal: mockTerminal,
          service: mockService,
          cwd: '/home/user',
          sessionId,
        }),
      { initialProps: { sessionId: 'session-1' } }
    )

    await waitFor(() => {
      expect(result.current.status).toBe('running')
    })

    const firstSessionId = result.current.session!.id

    // Kill the first session
    await mockService.kill({ sessionId: firstSessionId })

    // Change sessionId prop
    rerender({ sessionId: 'session-2' })

    await waitFor(() => {
      expect(mockService.spawn).toHaveBeenCalledTimes(2)
      expect(result.current.session!.id).not.toBe(firstSessionId)
    })
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
})
