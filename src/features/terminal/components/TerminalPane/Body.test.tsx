import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import {
  Body,
  clearTerminalCache,
  terminalCache,
  type BodyHandle,
} from './Body'
import { useTerminal, type UseTerminalReturn } from '../../hooks/useTerminal'
import type { ITerminalService } from '../../services/terminalService'

// Shared mock service for tests that don't exercise service-specific behavior.
// Round 4 Finding 1 made `service` a required prop on Body (the
// previous fallback to `createTerminalService()` produced disjoint mocks
// in the browser/Vite/test workflow). Tests now pass an explicit service.
const createDefaultMockService = (): ITerminalService =>
  ({
    spawn: vi.fn().mockResolvedValue({ sessionId: 'mock', pid: 0 }),
    write: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
    onData: vi.fn(
      (): Promise<() => void> =>
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        Promise.resolve((): void => {})
    ),
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    onExit: vi.fn((): (() => void) => (): void => {}),
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    onError: vi.fn((): (() => void) => (): void => {}),
    listSessions: vi.fn().mockResolvedValue({
      activeSessionId: null,
      sessions: [],
    }),
    setActiveSession: vi.fn().mockResolvedValue(undefined),
    reorderSessions: vi.fn().mockResolvedValue(undefined),
    updateSessionCwd: vi.fn().mockResolvedValue(undefined),
  }) as ITerminalService

// Mock xterm modules
vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(),
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn(),
}))

// WebGL addon intentionally not loaded — broken in Tauri webview (PR #33)

// Mock useTerminal hook
vi.mock('../../hooks/useTerminal', () => ({
  useTerminal: vi.fn(),
}))

describe('Body', () => {
  let mockTerminal: {
    open: ReturnType<typeof vi.fn>
    loadAddon: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
    focus: ReturnType<typeof vi.fn>
    onResize: ReturnType<typeof vi.fn>
    parser: { registerOscHandler: ReturnType<typeof vi.fn> }
    options: Record<string, unknown>
  }
  let mockFitAddon: { fit: ReturnType<typeof vi.fn> }
  let mockUseTerminal: UseTerminalReturn
  let defaultMockService: ITerminalService

  beforeEach(() => {
    defaultMockService = createDefaultMockService()
    // Mock ResizeObserver
    global.ResizeObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }))

    // Mock terminal instance
    mockTerminal = {
      open: vi.fn(),
      loadAddon: vi.fn(),
      dispose: vi.fn(),
      focus: vi.fn(),
      onResize: vi.fn(() => ({ dispose: vi.fn() })),
      parser: {
        registerOscHandler: vi.fn(() => ({ dispose: vi.fn() })),
      },
      options: {},
    }

    // Mock fit addon
    mockFitAddon = {
      fit: vi.fn(),
    }

    // Mock useTerminal hook return value
    mockUseTerminal = {
      session: {
        id: 'test-session',
        pid: 1234,
        name: 'Test Session',
        cwd: '/home/user',
        shell: '/bin/bash',
        status: 'running',
        createdAt: new Date(),
        env: {},
        lastActivityAt: new Date(),
      },
      status: 'running',
      error: null,
      resize: vi.fn(),
    }

    // Setup mocks
    vi.mocked(Terminal).mockImplementation(() => mockTerminal as never)
    vi.mocked(FitAddon).mockImplementation(() => mockFitAddon as never)
    vi.mocked(useTerminal).mockReturnValue(mockUseTerminal)
  })

  afterEach(() => {
    vi.clearAllMocks()
    // Clear terminal cache to ensure test isolation
    clearTerminalCache()
  })

  test('renders terminal container', () => {
    render(
      <Body
        sessionId="test-session"
        cwd="/home/user"
        service={defaultMockService}
      />
    )
    const container = screen.getByTestId('terminal-pane')
    expect(container).toBeInTheDocument()
  })

  test('initializes xterm terminal on mount', async () => {
    render(
      <Body
        sessionId="test-session"
        cwd="/home/user"
        service={defaultMockService}
      />
    )

    await waitFor(() => {
      expect(Terminal).toHaveBeenCalledWith(
        expect.objectContaining({
          cursorBlink: true,
          fontSize: 14,
          fontFamily: expect.stringContaining('JetBrains Mono'),
        })
      )
    })
  })

  test('applies Catppuccin Mocha theme', async () => {
    render(
      <Body
        sessionId="test-session"
        cwd="/home/user"
        service={defaultMockService}
      />
    )

    await waitFor(() => {
      expect(Terminal).toHaveBeenCalledWith(
        expect.objectContaining({
          theme: expect.objectContaining({
            background: '#1e1e2e',
            foreground: '#cdd6f4',
            cursor: '#f5e0dc',
          }),
        })
      )
    })
  })

  test('loads fit addon', async () => {
    render(
      <Body
        sessionId="test-session"
        cwd="/home/user"
        service={defaultMockService}
      />
    )

    await waitFor(() => {
      expect(FitAddon).toHaveBeenCalled()
      expect(mockTerminal.loadAddon).toHaveBeenCalledWith(mockFitAddon)
    })
  })

  // WebGL addon test removed — addon disabled due to broken WebGL2 in Tauri webview

  test('opens terminal in container', async () => {
    render(
      <Body
        sessionId="test-session"
        cwd="/home/user"
        service={defaultMockService}
      />
    )

    await waitFor(() => {
      expect(mockTerminal.open).toHaveBeenCalledWith(expect.any(HTMLDivElement))
    })
  })

  test('fits terminal to container after opening', async () => {
    const offsetSpy = vi
      .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
      .mockReturnValue(800)

    render(
      <Body
        sessionId="test-session"
        cwd="/home/user"
        service={defaultMockService}
      />
    )

    await waitFor(() => {
      expect(mockFitAddon.fit).toHaveBeenCalled()
    })

    offsetSpy.mockRestore()
  })

  test('handles terminal resize events', async () => {
    render(
      <Body
        sessionId="test-session"
        cwd="/home/user"
        service={defaultMockService}
      />
    )

    await waitFor(() => {
      expect(mockTerminal.onResize).toHaveBeenCalled()
    })
  })

  test('disposes terminal from cache on unmount to prevent memory leaks', async () => {
    const { unmount } = render(
      <Body
        sessionId="test-session"
        cwd="/home/user"
        service={defaultMockService}
      />
    )

    // Wait for terminal to initialize
    await waitFor(() => {
      expect(mockTerminal.open).toHaveBeenCalled()
    })

    const terminalInstance = mockTerminal

    // Unmount component (session is closed)
    unmount()

    // Terminal should be disposed on unmount to prevent memory leaks
    expect(terminalInstance.dispose).toHaveBeenCalled()
  })

  test('passes sessionId prop correctly', () => {
    const sessionId = 'custom-session-123'
    render(
      <Body
        sessionId={sessionId}
        cwd="/home/user"
        service={defaultMockService}
      />
    )

    const container = screen.getByTestId('terminal-pane')
    expect(container).toHaveAttribute('data-session-id', sessionId)
  })

  test('uses full width and height', () => {
    render(
      <Body
        sessionId="test-session"
        cwd="/home/user"
        service={defaultMockService}
      />
    )

    const container = screen.getByTestId('terminal-pane')
    expect(container).toHaveClass('w-full')
    expect(container).toHaveClass('h-full')
  })

  test('emits onPtyStatusChange when PTY status changes', async () => {
    const onPtyStatusChange = vi.fn()

    const { rerender } = render(
      <Body
        sessionId="test-session"
        cwd="/home/user"
        service={defaultMockService}
        onPtyStatusChange={onPtyStatusChange}
      />
    )

    await waitFor(() => {
      expect(onPtyStatusChange).toHaveBeenCalledWith('running')
    })

    vi.mocked(onPtyStatusChange).mockClear()
    vi.mocked(useTerminal).mockReturnValue({
      ...mockUseTerminal,
      status: 'error',
    })

    rerender(
      <Body
        sessionId="test-session"
        cwd="/home/user"
        service={defaultMockService}
        onPtyStatusChange={onPtyStatusChange}
      />
    )

    await waitFor(() => {
      expect(onPtyStatusChange).toHaveBeenCalledWith('error')
    })
  })

  test('useImperativeHandle exposes focusTerminal that focuses cached xterm', async () => {
    const ref = createRef<BodyHandle>()

    render(
      <Body
        ref={ref}
        sessionId="test-session"
        cwd="/home/user"
        service={defaultMockService}
      />
    )

    await waitFor(() => {
      expect(terminalCache.has('test-session')).toBe(true)
    })

    ref.current?.focusTerminal()

    expect(mockTerminal.focus).toHaveBeenCalledTimes(1)
  })

  test('emits onFocusChange when terminal container gains and loses focus', async () => {
    const onFocusChange = vi.fn()

    render(
      <Body
        sessionId="test-session"
        cwd="/home/user"
        service={defaultMockService}
        onFocusChange={onFocusChange}
      />
    )

    await waitFor(() => {
      expect(mockTerminal.open).toHaveBeenCalled()
    })

    const container = screen.getByTestId('terminal-pane')
    fireEvent.focusIn(container)
    fireEvent.focusOut(container)

    expect(onFocusChange).toHaveBeenCalledWith(true)
    expect(onFocusChange).toHaveBeenCalledWith(false)
  })

  describe('PTY Service Integration', () => {
    test('accepts cwd prop for terminal session', () => {
      const cwd = '/home/user/project'
      render(
        <Body sessionId="test-session" cwd={cwd} service={defaultMockService} />
      )

      const container = screen.getByTestId('terminal-pane')
      expect(container).toBeInTheDocument()
    })

    test('spawns PTY session via useTerminal hook', async () => {
      render(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      await waitFor(() => {
        expect(mockTerminal.open).toHaveBeenCalled()
      })
    })

    test('connects xterm data events to PTY write', async () => {
      render(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      await waitFor(() => {
        expect(mockTerminal.open).toHaveBeenCalled()
      })
    })

    test('connects PTY data events to xterm write', async () => {
      render(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      await waitFor(() => {
        expect(mockTerminal.open).toHaveBeenCalled()
      })
    })

    test('handles terminal resize for PTY', async () => {
      render(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      await waitFor(() => {
        expect(mockTerminal.onResize).toHaveBeenCalled()
      })
    })
  })

  describe('Resize and Session Management (Codex Review Findings)', () => {
    test('P2: handles container resize with ResizeObserver', async () => {
      // Mock ResizeObserver
      let resizeCallback: ResizeObserverCallback | undefined
      const mockObserve = vi.fn()
      const mockDisconnect = vi.fn()

      global.ResizeObserver = vi
        .fn()
        .mockImplementation((callback: ResizeObserverCallback) => {
          resizeCallback = callback

          return {
            observe: mockObserve,
            unobserve: vi.fn(),
            disconnect: mockDisconnect,
          }
        })

      render(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      await waitFor(() => {
        expect(global.ResizeObserver).toHaveBeenCalled()
        expect(mockObserve).toHaveBeenCalled()
      })

      // Clear fit calls from initial render
      mockFitAddon.fit.mockClear()

      // Simulate container resize
      const container = screen.getByTestId('terminal-pane')

      // Give container a real width so the guard passes
      Object.defineProperty(container, 'offsetWidth', {
        value: 800,
        configurable: true,
      })

      const mockEntry = {
        target: container,
        contentRect: {
          width: 800,
          height: 600,
          top: 0,
          left: 0,
          bottom: 600,
          right: 800,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        },
        borderBoxSize: [],
        contentBoxSize: [],
        devicePixelContentBoxSize: [],
      } as unknown as ResizeObserverEntry

      if (resizeCallback) {
        resizeCallback([mockEntry], {} as ResizeObserver)
      }

      // fitAddon.fit() should be called when container resizes
      await waitFor(() => {
        expect(mockFitAddon.fit).toHaveBeenCalled()
      })
    })

    test('regression #81: ResizeObserver skips fit when container is hidden (width=0)', async () => {
      let resizeCallback: ResizeObserverCallback | undefined
      const mockObserve = vi.fn()
      const mockDisconnect = vi.fn()

      global.ResizeObserver = vi
        .fn()
        .mockImplementation((callback: ResizeObserverCallback) => {
          resizeCallback = callback

          return {
            observe: mockObserve,
            unobserve: vi.fn(),
            disconnect: mockDisconnect,
          }
        })

      render(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      await waitFor(() => {
        expect(global.ResizeObserver).toHaveBeenCalled()
        expect(mockObserve).toHaveBeenCalled()
      })

      // Clear fit calls from initial render
      mockFitAddon.fit.mockClear()

      const container = screen.getByTestId('terminal-pane')

      // Simulate hidden tab: offsetWidth === 0 (display:none collapses container)
      Object.defineProperty(container, 'offsetWidth', {
        value: 0,
        configurable: true,
      })

      if (resizeCallback) {
        resizeCallback([], {} as ResizeObserver)
      }

      // fitAddon must NOT fire — this is the exact bug path that squashes scrollback
      expect(mockFitAddon.fit).not.toHaveBeenCalled()

      // Simulate tab becoming visible again: offsetWidth > 0
      Object.defineProperty(container, 'offsetWidth', {
        value: 800,
        configurable: true,
      })

      if (resizeCallback) {
        resizeCallback([], {} as ResizeObserver)
      }

      // fitAddon SHOULD fire now that the container has real dimensions
      expect(mockFitAddon.fit).toHaveBeenCalledTimes(1)
    })

    test('regression #81: cached terminal reuse skips fit in zero-width container', async () => {
      // Seed the module-level cache to force the reuse branch
      const cachedFitAddon = { fit: vi.fn() }

      const cachedTerminal = {
        open: vi.fn(),
        dispose: vi.fn(),
        focus: vi.fn(),
        cols: 80,
        rows: 24,
        onResize: vi.fn(() => ({ dispose: vi.fn() })),
        parser: { registerOscHandler: vi.fn(() => ({ dispose: vi.fn() })) },
      }

      terminalCache.set('cached-session', {
        terminal: cachedTerminal as unknown as Terminal,
        fitAddon: cachedFitAddon as unknown as FitAddon,
      })

      // Simulate hidden container (display:none → offsetWidth = 0)
      const offsetSpy = vi
        .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
        .mockReturnValue(0)

      try {
        render(
          <Body
            sessionId="cached-session"
            cwd="/home/user"
            service={defaultMockService}
          />
        )

        await waitFor(() => {
          expect(cachedTerminal.open).toHaveBeenCalled()
        })

        // fitAddon.fit must be suppressed on the reuse path when width is 0
        expect(cachedFitAddon.fit).not.toHaveBeenCalled()
      } finally {
        offsetSpy.mockRestore()
        terminalCache.delete('cached-session')
      }
    })

    test('regression #81: onResize does not forward tiny dimensions to PTY when container is hidden', async () => {
      render(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      await waitFor(() => {
        expect(mockTerminal.onResize).toHaveBeenCalled()
      })

      // Clear mocks from initial render
      mockFitAddon.fit.mockClear()
      vi.mocked(mockUseTerminal.resize).mockClear()

      const container = screen.getByTestId('terminal-pane')

      const onResizeCallback = mockTerminal.onResize.mock
        .calls[0][0] as (size: { cols: number; rows: number }) => void

      // Hidden tab path: container width === 0
      Object.defineProperty(container, 'offsetWidth', {
        value: 0,
        configurable: true,
      })

      onResizeCallback({ cols: 1, rows: 24 })

      // Neither fit() nor PTY resize should run at zero width
      expect(mockFitAddon.fit).not.toHaveBeenCalled()
      expect(mockUseTerminal.resize).not.toHaveBeenCalled()

      // Visible tab path: container width > 0
      Object.defineProperty(container, 'offsetWidth', {
        value: 800,
        configurable: true,
      })

      onResizeCallback({ cols: 80, rows: 24 })

      // Both should fire now
      expect(mockFitAddon.fit).toHaveBeenCalledTimes(1)
      expect(mockUseTerminal.resize).toHaveBeenCalledTimes(1)
    })

    test('P2: disposes old session terminal when switching to different sessionId', async () => {
      // Render with session A
      const { rerender } = render(
        <Body
          sessionId="session-a"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      await waitFor(() => {
        expect(mockTerminal.open).toHaveBeenCalled()
      })

      const firstTerminal = mockTerminal

      // Clear mocks to detect new calls
      vi.mocked(Terminal).mockClear()
      vi.mocked(FitAddon).mockClear()

      // Switch to session B (cleanup effect disposes session A terminal)
      rerender(
        <Body
          sessionId="session-b"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      // Wait for new terminal to be created
      await waitFor(() => {
        expect(Terminal).toHaveBeenCalled()
      })

      // First terminal should be disposed to prevent memory leaks
      expect(firstTerminal.dispose).toHaveBeenCalled()
    })
  })

  describe('Stability and Performance (Codex Review Findings)', () => {
    test('P2: forwards stable service prop to useTerminal across re-renders', async () => {
      // Round 4 Finding 1: Body no longer memoizes a fallback
      // service internally — callers MUST pass a stable instance. This test
      // now verifies the contract holds: a stable service prop reaches
      // useTerminal unchanged across renders. The parent (WorkspaceView)
      // owns the memoization via useMemo.
      const { rerender } = render(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      await waitFor(() => {
        expect(useTerminal).toHaveBeenCalled()
      })

      const firstCallService =
        vi.mocked(useTerminal).mock.calls[0]?.[0]?.service

      // Clear mocks to count new calls
      vi.mocked(useTerminal).mockClear()

      // Trigger re-render with same service prop
      rerender(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      await waitFor(() => {
        expect(useTerminal).toHaveBeenCalled()
      })

      const secondCallService =
        vi.mocked(useTerminal).mock.calls[0]?.[0]?.service

      // Same prop reference reaches useTerminal both times.
      expect(firstCallService).toBe(secondCallService)
      expect(firstCallService).toBe(defaultMockService)
    })

    test('P1: does not recreate terminal when resize callback changes', async () => {
      // Render component
      const { rerender } = render(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      await waitFor(() => {
        expect(Terminal).toHaveBeenCalledTimes(1)
      })

      // Update mockUseTerminal to return a new resize callback (simulating session change)
      mockUseTerminal = {
        ...mockUseTerminal,
        resize: vi.fn(), // New function reference
      }
      vi.mocked(useTerminal).mockReturnValue(mockUseTerminal)

      // Clear Terminal mock to count new calls
      vi.mocked(Terminal).mockClear()

      // Trigger re-render (this would happen when resize callback changes)
      rerender(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      // Wait a bit to ensure effect would run if it was going to
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Terminal should NOT be recreated
      expect(Terminal).not.toHaveBeenCalled()
    })

    test('P2: re-sends PTY resize after session becomes running', async () => {
      // Start with idle status (session not yet spawned)
      const initialMockUseTerminal: UseTerminalReturn = {
        ...mockUseTerminal,
        status: 'idle',
        resize: vi.fn(),
      }
      vi.mocked(useTerminal).mockReturnValue(initialMockUseTerminal)

      // Render component
      const { rerender } = render(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      await waitFor(() => {
        expect(mockTerminal.open).toHaveBeenCalled()
      })

      // Clear resize mock to count only subsequent calls
      vi.mocked(initialMockUseTerminal.resize).mockClear()

      // Simulate session becoming running (status transition)
      const runningMockUseTerminal: UseTerminalReturn = {
        ...mockUseTerminal,
        status: 'running',
        resize: initialMockUseTerminal.resize, // Same resize function
      }
      vi.mocked(useTerminal).mockReturnValue(runningMockUseTerminal)

      // Trigger re-render (this simulates the status change)
      rerender(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={defaultMockService}
        />
      )

      // Resize should be called when status becomes 'running'
      await waitFor(() => {
        expect(initialMockUseTerminal.resize).toHaveBeenCalled()
      })
    })
  })

  // Feature #14: Restore protocol tests
  describe('Restored mode', () => {
    test('passes restoredFrom prop to useTerminal', () => {
      const restoredFrom = {
        sessionId: 'r1',
        cwd: '/tmp',
        pid: 99,
        replayData: 'X',
        replayEndOffset: 1,
        bufferedEvents: [],
      }

      render(
        <Body
          sessionId="r1"
          cwd="/tmp"
          service={defaultMockService}
          restoredFrom={restoredFrom}
        />
      )

      expect(vi.mocked(useTerminal)).toHaveBeenCalledWith(
        expect.objectContaining({ restoredFrom })
      )
    })
  })

  // Feature #14: OSC 7 cwd sync tests.
  // The pane reports cwd changes via onCwdChange; the parent (useSessionManager)
  // is the sole writer that issues the updateSessionCwd IPC. The pane MUST NOT
  // call service.updateSessionCwd directly — doubling the IPC was the round-12
  // MEDIUM finding, and the second call silently swallows errors when the
  // session is concurrently killed.
  describe('OSC 7 handler', () => {
    test('forwards file:// URL path to onCwdChange', async () => {
      const mockService = {
        spawn: vi.fn().mockResolvedValue({ sessionId: 'pty-1', pid: 123 }),
        write: vi.fn().mockResolvedValue(undefined),
        resize: vi.fn().mockResolvedValue(undefined),
        kill: vi.fn().mockResolvedValue(undefined),
        updateSessionCwd: vi.fn().mockResolvedValue(undefined),
        onData: vi.fn(() =>
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          Promise.resolve((): void => {})
        ),
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        onExit: vi.fn(() => (): void => {}),
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        onError: vi.fn(() => (): void => {}),
        listSessions: vi.fn().mockResolvedValue({
          activeSessionId: null,
          sessions: [],
        }),
        setActiveSession: vi.fn().mockResolvedValue(undefined),
        reorderSessions: vi.fn().mockResolvedValue(undefined),
      }

      const onCwdChange = vi.fn()

      render(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={mockService}
          onCwdChange={onCwdChange}
        />
      )

      await waitFor(() => {
        expect(mockTerminal.parser.registerOscHandler).toHaveBeenCalledWith(
          7,
          expect.any(Function)
        )
      })

      const oscHandler = vi.mocked(mockTerminal.parser.registerOscHandler).mock
        .calls[0]?.[1]

      ;(oscHandler as ((data: string) => void) | undefined)?.(
        'file://localhost/home/user/projects'
      )

      await waitFor(() => {
        expect(onCwdChange).toHaveBeenCalledWith('/home/user/projects')
      })

      expect(mockService.updateSessionCwd).not.toHaveBeenCalled()
    })

    test('forwards plain absolute path to onCwdChange', async () => {
      const mockService = {
        spawn: vi.fn().mockResolvedValue({ sessionId: 'pty-1', pid: 123 }),
        write: vi.fn().mockResolvedValue(undefined),
        resize: vi.fn().mockResolvedValue(undefined),
        kill: vi.fn().mockResolvedValue(undefined),
        updateSessionCwd: vi.fn().mockResolvedValue(undefined),
        onData: vi.fn(() =>
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          Promise.resolve((): void => {})
        ),
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        onExit: vi.fn(() => (): void => {}),
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        onError: vi.fn(() => (): void => {}),
        listSessions: vi.fn().mockResolvedValue({
          activeSessionId: null,
          sessions: [],
        }),
        setActiveSession: vi.fn().mockResolvedValue(undefined),
        reorderSessions: vi.fn().mockResolvedValue(undefined),
      }

      const onCwdChange = vi.fn()

      render(
        <Body
          sessionId="test-session"
          cwd="/home/user"
          service={mockService}
          onCwdChange={onCwdChange}
        />
      )

      await waitFor(() => {
        expect(mockTerminal.parser.registerOscHandler).toHaveBeenCalled()
      })

      const oscHandler = vi.mocked(mockTerminal.parser.registerOscHandler).mock
        .calls[0]?.[1]

      ;(oscHandler as ((data: string) => void) | undefined)?.('/tmp')

      await waitFor(() => {
        expect(onCwdChange).toHaveBeenCalledWith('/tmp')
      })

      expect(mockService.updateSessionCwd).not.toHaveBeenCalled()
    })
  })
})
