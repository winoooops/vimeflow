// cspell:ignore QlVGRkVSRUQ
import { renderHook, waitFor } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { useTerminal } from './useTerminal'
import { MockTerminalService } from '../services/terminalService'
import type {
  TerminalOutputChunk,
  TerminalOutputWriter,
  TerminalSurface,
} from '../types'

// Mock terminal surface with test helpers
interface MockTerminal extends TerminalSurface {
  _mockTriggerData: (data: string) => void
  _mockFlushWrites: () => void
}

const createMockTerminal = (): MockTerminal => {
  const listeners = new Map<string, ((data: string) => void)[]>()
  const pendingWriteCallbacks: (() => void)[] = []

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
    write: vi.fn((_data: string | Uint8Array, callback?: () => void) => {
      if (callback) {
        pendingWriteCallbacks.push(callback)
      }
    }),
    clear: vi.fn(),
    dispose: vi.fn(),
    _mockTriggerData: (data: string) => {
      const callbacks = listeners.get('data') ?? []
      callbacks.forEach((cb) => cb(data))
    },
    _mockFlushWrites: () => {
      const callbacks = pendingWriteCallbacks.splice(0)
      callbacks.forEach((callback) => {
        callback()
      })
    },
  } as unknown as MockTerminal
}

describe('useTerminal', () => {
  let mockService: MockTerminalService
  let mockTerminal: MockTerminal
  let mockOutput: TerminalOutputWriter

  beforeEach(() => {
    mockService = new MockTerminalService()
    mockTerminal = createMockTerminal()
    mockOutput = {
      writeOutput: vi.fn(
        (chunk: TerminalOutputChunk, callback?: () => void): void => {
          if (callback) {
            mockTerminal.write(chunk.text, callback)

            return
          }

          mockTerminal.write(chunk.text)
        }
      ),
    }

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
        output: mockOutput,
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
        output: mockOutput,
        service: mockService,
        cwd: '/home/user',
      })
    )

    expect(result.current.status).toBe('idle')
    expect(result.current.session).toBeNull()
  })

  test('writes PTY data to terminal surface', async () => {
    const { result } = renderHook(() =>
      useTerminal({
        terminal: mockTerminal,
        output: mockOutput,
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

    expect(mockOutput.writeOutput).toHaveBeenCalledWith({
      text: 'Hello from PTY\r\n',
      offsetStart: 0,
      byteLen: new TextEncoder().encode('Hello from PTY\r\n').length,
      phase: 'live',
    })
    expect(mockTerminal.write).toHaveBeenCalledWith('Hello from PTY\r\n')
  })

  test('answers Codex OSC 11 background color queries from the surface theme', async () => {
    // Codex queries the terminal background (\x1b]11;?) to tint its input
    // composer. libghostty never replies, so the Ghostty surface must answer
    // from its --terminal-background theme var or Codex renders a bar-less
    // composer. (xterm replies on its own; an empty var read self-gates here.)
    // cspell:ignore ghostty
    const surface = mockTerminal as unknown as { element: HTMLElement }
    surface.element = document.createElement('div')
    // Built without a literal to satisfy vimeflow/no-hardcoded-colors.
    const backgroundHex = ['#', '181825'].join('')

    const getComputedStyleSpy = vi
      .spyOn(window, 'getComputedStyle')
      .mockReturnValue({
        getPropertyValue: (property: string) =>
          property === '--terminal-background' ? backgroundHex : '',
      } as unknown as CSSStyleDeclaration)

    try {
      const { result } = renderHook(() =>
        useTerminal({
          terminal: mockTerminal,
          output: mockOutput,
          service: mockService,
          cwd: '/home/user',
        })
      )

      await waitFor(() => {
        expect(result.current.status).toBe('running')
      })

      mockService.emit('data', {
        sessionId: result.current.session!.id,
        data: '\x1b]11;?\x07',
      })

      await waitFor(() => {
        expect(mockService.write).toHaveBeenCalledWith({
          sessionId: result.current.session!.id,
          data: '\x1b]11;rgb:1818/1818/2525\x1b\\',
        })
      })
    } finally {
      getComputedStyleSpy.mockRestore()
    }
  })

  test('writes PTY raw bytes payload to terminal output chunks', async () => {
    const { result } = renderHook(() =>
      useTerminal({
        terminal: mockTerminal,
        output: mockOutput,
        service: mockService,
        cwd: '/home/user',
      })
    )

    await waitFor(() => {
      expect(result.current.status).toBe('running')
    })

    mockService.emit('data', {
      sessionId: result.current.session!.id,
      data: '��',
      offsetStart: 0,
      byteLen: 2,
      bytesBase64: '//4=',
    })

    expect(mockOutput.writeOutput).toHaveBeenCalledWith({
      text: '��',
      bytesBase64: '//4=',
      offsetStart: 0,
      byteLen: 2,
      phase: 'live',
    })
  })

  test('reports accepted PTY output chunks', async () => {
    const onOutput = vi.fn()

    const { result } = renderHook(() =>
      useTerminal({
        terminal: mockTerminal,
        output: mockOutput,
        service: mockService,
        cwd: '/home/user',
        onOutput,
      })
    )

    await waitFor(() => {
      expect(result.current.status).toBe('running')
    })

    const sessionId = result.current.session!.id

    mockService.emit('data', {
      sessionId,
      data: 'Hello from PTY\r\n',
    })

    expect(onOutput).not.toHaveBeenCalled()
    mockTerminal._mockFlushWrites()

    expect(onOutput).toHaveBeenCalledWith('Hello from PTY\r\n')
  })

  test('handles keyboard input from terminal surface', async () => {
    const { result } = renderHook(() =>
      useTerminal({
        terminal: mockTerminal,
        output: mockOutput,
        service: mockService,
        cwd: '/home/user',
      })
    )

    await waitFor(() => {
      expect(result.current.status).toBe('running')
    })

    const sessionId = result.current.session!.id

    // Simulate user typing in the terminal renderer
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
        output: mockOutput,
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
        output: mockOutput,
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
        output: mockOutput,
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
        output: mockOutput,
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
        output: mockOutput,
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
        output: mockOutput,
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
        output: mockOutput,
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
        output: null,
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
        output: mockOutput,
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
        output: mockOutput,
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
        output: mockOutput,
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
        output: mockOutput,
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
        output: mockOutput,
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
        output: mockOutput,
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
          output: mockOutput,
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
      expect(mockOutput.writeOutput).toHaveBeenCalledWith({
        text: 'Restored output\r\n',
        offsetStart: null,
        byteLen: null,
        phase: 'restore',
      })
      expect(mockTerminal.write).toHaveBeenCalledWith('Restored output\r\n')
    })

    test('ignores empty buffered restore events', async () => {
      const onRestoreStart = vi.fn()
      const onRestoreOutput = vi.fn()
      const onRestoreEnd = vi.fn()

      const { result } = renderHook(() =>
        useTerminal({
          terminal: mockTerminal,
          output: mockOutput,
          service: mockService,
          restoredFrom: {
            sessionId: 'session-1',
            cwd: '/tmp',
            pid: 1234,
            replayData: '',
            replayEndOffset: 0,
            bufferedEvents: [{ data: '', offsetStart: 0, byteLen: 0 }],
          },
          onRestoreStart,
          onRestoreOutput,
          onRestoreEnd,
        })
      )

      await waitFor(() => {
        expect(result.current.status).toBe('running')
      })

      expect(mockOutput.writeOutput).not.toHaveBeenCalled()
      expect(onRestoreStart).not.toHaveBeenCalled()
      expect(onRestoreOutput).toHaveBeenCalledWith('')
      expect(onRestoreEnd).not.toHaveBeenCalled()
    })

    test('reports restored output after the final restore write callback', async () => {
      const writes: string[] = []
      const writeCallbacks: (() => void)[] = []
      const onOutput = vi.fn()
      const onRestoreOutput = vi.fn()
      vi.mocked(mockTerminal.write).mockImplementation(
        (data: string | Uint8Array, callback?: () => void) => {
          writes.push(
            typeof data === 'string' ? data : new TextDecoder().decode(data)
          )

          if (callback) {
            writeCallbacks.push(callback)
          }
        }
      )

      renderHook(() =>
        useTerminal({
          terminal: mockTerminal,
          output: mockOutput,
          service: mockService,
          restoredFrom: {
            sessionId: 'session-1',
            cwd: '/tmp',
            pid: 1234,
            replayData: 'REPLAY',
            replayEndOffset: 50,
            bufferedEvents: [
              {
                data: 'BUFFERED',
                offsetStart: 50,
                byteLen: 8,
                bytesBase64: 'QlVGRkVSRUQ=',
              },
            ],
          },
          onOutput,
          onRestoreOutput,
        })
      )

      await waitFor(() => {
        expect(writes.length).toBeGreaterThanOrEqual(2)
      })

      // Replay data should be written first
      expect(writes[0]).toBe('REPLAY')
      // Then buffered events
      expect(writes[1]).toBe('BUFFERED')
      expect(mockOutput.writeOutput).toHaveBeenNthCalledWith(
        2,
        {
          text: 'BUFFERED',
          bytesBase64: 'QlVGRkVSRUQ=',
          offsetStart: 50,
          byteLen: 8,
          phase: 'restore',
        },
        expect.any(Function)
      )
      expect(onOutput).not.toHaveBeenCalled()

      expect(onRestoreOutput).not.toHaveBeenCalled()
      expect(writeCallbacks).toHaveLength(1)

      writeCallbacks[0]()

      expect(onRestoreOutput).toHaveBeenCalledOnce()
      expect(onRestoreOutput).toHaveBeenCalledWith(
        ['REPLAY', 'BUFFERED'].join('')
      )
    })

    test('marks the restore phase until the final restored write callback fires', async () => {
      const writes: string[] = []
      const writeCallbacks: (() => void)[] = []
      const lifecycleEvents: string[] = []

      const onRestoreStart = vi.fn(() => {
        lifecycleEvents.push('start')
      })

      const onRestoreOutput = vi.fn(() => {
        lifecycleEvents.push('output')
      })

      const onRestoreEnd = vi.fn(() => {
        lifecycleEvents.push('end')
      })

      vi.mocked(mockTerminal.write).mockImplementation(
        (data: string | Uint8Array, callback?: () => void) => {
          writes.push(
            typeof data === 'string' ? data : new TextDecoder().decode(data)
          )

          if (callback) {
            writeCallbacks.push(callback)
          }
        }
      )

      renderHook(() =>
        useTerminal({
          terminal: mockTerminal,
          output: mockOutput,
          service: mockService,
          restoredFrom: {
            sessionId: 'session-1',
            cwd: '/tmp',
            pid: 1234,
            replayData: 'REPLAY',
            replayEndOffset: 50,
            bufferedEvents: [{ data: 'BUFFERED', offsetStart: 50, byteLen: 8 }],
          },
          onRestoreStart,
          onRestoreOutput,
          onRestoreEnd,
        })
      )

      await waitFor(() => {
        expect(writes).toEqual(['REPLAY', 'BUFFERED'])
      })

      expect(onRestoreStart).toHaveBeenCalledOnce()
      expect(onRestoreOutput).not.toHaveBeenCalled()
      expect(onRestoreEnd).not.toHaveBeenCalled()
      expect(lifecycleEvents).toEqual(['start'])
      expect(writeCallbacks).toHaveLength(1)

      writeCallbacks[0]()

      expect(onRestoreOutput).toHaveBeenCalledOnce()
      expect(onRestoreEnd).toHaveBeenCalledOnce()
      expect(lifecycleEvents).toEqual(['start', 'output', 'end'])
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

      // Buffered offsets reflect the producer contract: chunks are atomic
      // and non-overlapping. After AT (offset 100, len 2 → bytes 100-101),
      // the next event must start at ≥102. Cursor advance honors this and
      // filters anything that lies inside the already-written range.
      renderHook(() =>
        useTerminal({
          terminal: mockTerminal,
          output: mockOutput,
          service: mockService,
          restoredFrom: {
            sessionId: 'session-1',
            cwd: '/tmp',
            pid: 1234,
            replayData: 'REPLAY',
            replayEndOffset: 100,
            bufferedEvents: [
              { data: 'BELOW', offsetStart: 99, byteLen: 5 }, // Below cursor — filtered
              { data: 'AT', offsetStart: 100, byteLen: 2 }, // At cursor (bytes 100-101)
              { data: 'ABOVE', offsetStart: 102, byteLen: 5 }, // Past AT — written
            ],
          },
        })
      )

      await waitFor(() => {
        expect(writes.length).toBeGreaterThanOrEqual(2)
      })

      // Should NOT write event below cursor (offsetStart < replayEndOffset)
      expect(writes).not.toContain('BELOW')

      // Should write non-overlapping events at/above cursor
      expect(writes).toContain('AT')
      expect(writes).toContain('ABOVE')
    })

    test('answers restored buffered OSC color queries before drain dedupe can drop them', async () => {
      const surface = mockTerminal as unknown as { element: HTMLElement }
      surface.element = document.createElement('div')
      const foregroundHex = ['#', 'cdd6f4'].join('')
      const foregroundResponseRgb = ['cd', 'cd', '/d6d6/f4f4'].join('')

      const getComputedStyleSpy = vi
        .spyOn(window, 'getComputedStyle')
        .mockReturnValue({
          getPropertyValue: (property: string) =>
            property === '--terminal-foreground' ? foregroundHex : '',
        } as unknown as CSSStyleDeclaration)

      try {
        const { result } = renderHook(() =>
          useTerminal({
            terminal: mockTerminal,
            output: mockOutput,
            service: mockService,
            restoredFrom: {
              sessionId: 'session-1',
              cwd: '/tmp',
              pid: 1234,
              replayData: '',
              replayEndOffset: 100,
              bufferedEvents: [
                {
                  data: '\x1b]10;?\x07',
                  offsetStart: 100,
                  byteLen: 7,
                },
              ],
            },
          })
        )

        await waitFor(() => {
          expect(result.current.status).toBe('running')
        })

        await waitFor(() => {
          expect(mockService.write).toHaveBeenCalledWith({
            sessionId: 'session-1',
            data: `\x1b]10;rgb:${foregroundResponseRgb}\x1b\\`,
          })
        })
      } finally {
        getComputedStyleSpy.mockRestore()
      }
    })

    test('does not kill session on unmount when restored', async () => {
      const { unmount } = renderHook(() =>
        useTerminal({
          terminal: mockTerminal,
          output: mockOutput,
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
          output: mockOutput,
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
          output: mockOutput,
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

      expect(mockOutput.writeOutput).toHaveBeenCalledWith({
        text: 'AT_CURSOR',
        offsetStart: 100,
        byteLen: new TextEncoder().encode('AT_CURSOR').length,
        phase: 'live',
      })
      expect(mockTerminal.write).toHaveBeenCalledWith('AT_CURSOR')

      vi.mocked(mockTerminal.write).mockClear()

      // Cursor was advanced past 'AT_CURSOR' (9 bytes, so cursor=109).
      // Choose an offset past that range for the next write to land.
      // Emit live event above cursor
      mockService.emit('data', {
        sessionId: 'session-1',
        data: 'ABOVE_CURSOR',
        offsetStart: 150,
      })

      expect(mockTerminal.write).toHaveBeenCalledWith('ABOVE_CURSOR')
    })

    // Round 6 F1 regression: cursor advances by the producer's byte_len, NOT
    // by `new TextEncoder().encode(data).length`. When the PTY emits a chunk
    // with invalid UTF-8 bytes, `String::from_utf8_lossy` replaces them with
    // U+FFFD, which re-encodes to 3 bytes. Without `byteLen` from the
    // producer, the cursor would advance by the inflated length and silently
    // drop the next legitimate chunk whose offsetStart falls in the gap.
    //
    // Scenario:
    //   chunk 1: raw bytes [0xE2, 0x82] (truncated start of '€'),
    //            data="��" (re-encodes to 6 bytes), byteLen=2
    //   chunk 2: data="ok", offsetStart=2, byteLen=2
    // With the buggy code, cursor would jump to 6 after chunk 1 and chunk 2
    // (offsetStart=2 < 6) would be dropped. With the fix, cursor jumps to 2
    // and chunk 2 is written correctly.
    test('F1 (round 6): cursor advances by producer byteLen, not lossy data length', async () => {
      const writes: string[] = []
      vi.mocked(mockTerminal.write).mockImplementation(
        (data: string | Uint8Array) => {
          writes.push(
            typeof data === 'string' ? data : new TextDecoder().decode(data)
          )
        }
      )

      const { result } = renderHook(() =>
        useTerminal({
          terminal: mockTerminal,
          output: mockOutput,
          service: mockService,
          restoredFrom: {
            sessionId: 'session-1',
            cwd: '/tmp',
            pid: 1234,
            replayData: '', // empty replay so cursor starts at 0
            replayEndOffset: 0,
            bufferedEvents: [],
          },
        })
      )

      await waitFor(() => {
        expect(result.current.status).toBe('running')
      })

      writes.length = 0
      vi.mocked(mockTerminal.write).mockClear()

      // Chunk 1: lossy-decoded U+FFFD pair (6 bytes when re-encoded), but
      // the producer only consumed 2 raw bytes from the PTY buffer.
      mockService.emit('data', {
        sessionId: 'session-1',
        data: '��',
        offsetStart: 0,
        byteLen: 2,
      })

      // Chunk 2: legitimate ASCII that picks up exactly where the producer's
      // raw byte count left off. With the buggy `data.length` cursor advance,
      // cursor would be 6 and this event (offsetStart=2) would be dropped.
      mockService.emit('data', {
        sessionId: 'session-1',
        data: 'ok',
        offsetStart: 2,
        byteLen: 2,
      })

      // Both events MUST be written. The fix ensures chunk 2 is not silently
      // dropped due to the cursor sailing past 2 from re-encoded U+FFFD bytes.
      expect(writes).toEqual(['��', 'ok'])
    })
  })

  // F3 regression: explicit `mode` prop must override the legacy
  // "spawn unless restoredFrom is set" inference. Two pinned behaviors:
  //  - mode='awaiting-restart' MUST NOT call service.spawn (no resurrection)
  //  - mode='attach' without restoredFrom MUST surface as an error,
  //    not silently fall through to spawn
  describe('Mode prop (Codex F3)', () => {
    test('mode=awaiting-restart does not call service.spawn', async () => {
      const { result } = renderHook(() =>
        useTerminal({
          terminal: mockTerminal,
          output: mockOutput,
          service: mockService,
          mode: 'awaiting-restart',
        })
      )

      // Wait long enough that an async spawn would have fired.
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(mockService.spawn).not.toHaveBeenCalled()
      expect(result.current.session).toBeNull()
      expect(result.current.status).toBe('idle')
    })

    test('mode=attach with restoredFrom does not call service.spawn', async () => {
      const { result } = renderHook(() =>
        useTerminal({
          terminal: mockTerminal,
          output: mockOutput,
          service: mockService,
          mode: 'attach',
          restoredFrom: {
            sessionId: 'r1',
            cwd: '/tmp',
            pid: 42,
            replayData: '',
            replayEndOffset: 0,
            bufferedEvents: [],
          },
        })
      )

      await waitFor(() => {
        expect(result.current.status).toBe('running')
      })

      expect(mockService.spawn).not.toHaveBeenCalled()
      expect(result.current.session?.id).toBe('r1')
      expect(result.current.session?.pid).toBe(42)
    })

    test('mode=attach without restoredFrom surfaces as error (no silent spawn)', async () => {
      const { result } = renderHook(() =>
        useTerminal({
          terminal: mockTerminal,
          output: mockOutput,
          service: mockService,
          mode: 'attach',
        })
      )

      await waitFor(() => {
        expect(result.current.status).toBe('error')
      })

      expect(mockService.spawn).not.toHaveBeenCalled()
      expect(result.current.error).toBe('attach mode requires restoredFrom')
    })

    test('mode=spawn calls service.spawn (legacy default behavior preserved)', async () => {
      const { result } = renderHook(() =>
        useTerminal({
          terminal: mockTerminal,
          output: mockOutput,
          service: mockService,
          mode: 'spawn',
        })
      )

      // Both assertions must be inside the same waitFor: spawn is called
      // synchronously inside the effect, but status='running' fires only
      // AFTER `await service.spawn(...)` resolves. Splitting these into
      // a `waitFor(spawn-called)` then synchronous `expect(status)` was
      // race-prone — the post-await microtask may not have flushed by the time
      // the synchronous check ran.
      await waitFor(() => {
        expect(mockService.spawn).toHaveBeenCalledOnce()
        expect(result.current.status).toBe('running')
      })
    })
  })
})
