import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { TerminalPane, clearTerminalCache } from './TerminalPane'
import { useTerminal, type UseTerminalReturn } from '../hooks/useTerminal'

// Mock xterm modules
vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(),
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn(),
}))

// WebGL addon intentionally not loaded — broken in Tauri webview (PR #33)

// Mock useTerminal hook
vi.mock('../hooks/useTerminal', () => ({
  useTerminal: vi.fn(),
}))

describe('TerminalPane', () => {
  let mockTerminal: {
    open: ReturnType<typeof vi.fn>
    loadAddon: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
    onResize: ReturnType<typeof vi.fn>
    parser: { registerOscHandler: ReturnType<typeof vi.fn> }
    options: Record<string, unknown>
  }
  let mockFitAddon: { fit: ReturnType<typeof vi.fn> }
  let mockUseTerminal: UseTerminalReturn

  beforeEach(() => {
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
      debugInfo: 'test',
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
    render(<TerminalPane sessionId="test-session" cwd="/home/user" />)
    const container = screen.getByTestId('terminal-pane')
    expect(container).toBeInTheDocument()
  })

  test('initializes xterm terminal on mount', async () => {
    render(<TerminalPane sessionId="test-session" cwd="/home/user" />)

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
    render(<TerminalPane sessionId="test-session" cwd="/home/user" />)

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
    render(<TerminalPane sessionId="test-session" cwd="/home/user" />)

    await waitFor(() => {
      expect(FitAddon).toHaveBeenCalled()
      expect(mockTerminal.loadAddon).toHaveBeenCalledWith(mockFitAddon)
    })
  })

  // WebGL addon test removed — addon disabled due to broken WebGL2 in Tauri webview

  test('opens terminal in container', async () => {
    render(<TerminalPane sessionId="test-session" cwd="/home/user" />)

    await waitFor(() => {
      expect(mockTerminal.open).toHaveBeenCalledWith(expect.any(HTMLDivElement))
    })
  })

  test('fits terminal to container after opening', async () => {
    render(<TerminalPane sessionId="test-session" cwd="/home/user" />)

    await waitFor(() => {
      expect(mockFitAddon.fit).toHaveBeenCalled()
    })
  })

  test('handles terminal resize events', async () => {
    render(<TerminalPane sessionId="test-session" cwd="/home/user" />)

    await waitFor(() => {
      expect(mockTerminal.onResize).toHaveBeenCalled()
    })
  })

  test('disposes terminal from cache on unmount to prevent memory leaks', async () => {
    const { unmount } = render(
      <TerminalPane sessionId="test-session" cwd="/home/user" />
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
    render(<TerminalPane sessionId={sessionId} cwd="/home/user" />)

    const container = screen.getByTestId('terminal-pane')
    expect(container).toHaveAttribute('data-session-id', sessionId)
  })

  test('uses full width and height', () => {
    render(<TerminalPane sessionId="test-session" cwd="/home/user" />)

    const container = screen.getByTestId('terminal-pane')
    expect(container).toHaveClass('w-full')
    expect(container).toHaveClass('h-full')
  })

  describe('PTY Service Integration', () => {
    test('accepts cwd prop for terminal session', () => {
      const cwd = '/home/user/project'
      render(<TerminalPane sessionId="test-session" cwd={cwd} />)

      const container = screen.getByTestId('terminal-pane')
      expect(container).toBeInTheDocument()
    })

    test('spawns PTY session via useTerminal hook', async () => {
      // TODO: This test will verify that useTerminal is called
      // with correct parameters when component mounts
      render(<TerminalPane sessionId="test-session" cwd="/home/user" />)

      // Will add assertions once useTerminal is wired
      await waitFor(() => {
        expect(mockTerminal.open).toHaveBeenCalled()
      })
    })

    test('connects xterm data events to PTY write', async () => {
      // TODO: This test will verify that typing in terminal
      // sends data to PTY service
      render(<TerminalPane sessionId="test-session" cwd="/home/user" />)

      await waitFor(() => {
        expect(mockTerminal.open).toHaveBeenCalled()
      })

      // Will simulate xterm onData callback and verify service.write called
    })

    test('connects PTY data events to xterm write', async () => {
      // TODO: This test will verify that PTY output
      // is written to xterm terminal
      render(<TerminalPane sessionId="test-session" cwd="/home/user" />)

      await waitFor(() => {
        expect(mockTerminal.open).toHaveBeenCalled()
      })

      // Will emit mock PTY data and verify terminal.write called
    })

    test('handles terminal resize for PTY', async () => {
      // TODO: This test will verify that terminal resize events
      // trigger PTY resize via service
      render(<TerminalPane sessionId="test-session" cwd="/home/user" />)

      await waitFor(() => {
        expect(mockTerminal.onResize).toHaveBeenCalled()
      })

      // Will simulate resize and verify service.resize called
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

      render(<TerminalPane sessionId="test-session" cwd="/home/user" />)

      await waitFor(() => {
        expect(global.ResizeObserver).toHaveBeenCalled()
        expect(mockObserve).toHaveBeenCalled()
      })

      // Clear fit calls from initial render
      mockFitAddon.fit.mockClear()

      // Simulate container resize
      const container = screen.getByTestId('terminal-pane')

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

    test('P2: disposes old session terminal when switching to different sessionId', async () => {
      // Render with session A
      const { rerender } = render(
        <TerminalPane sessionId="session-a" cwd="/home/user" />
      )

      await waitFor(() => {
        expect(mockTerminal.open).toHaveBeenCalled()
      })

      const firstTerminal = mockTerminal

      // Clear mocks to detect new calls
      vi.mocked(Terminal).mockClear()
      vi.mocked(FitAddon).mockClear()

      // Switch to session B (cleanup effect disposes session A terminal)
      rerender(<TerminalPane sessionId="session-b" cwd="/home/user" />)

      // Wait for new terminal to be created
      await waitFor(() => {
        expect(Terminal).toHaveBeenCalled()
      })

      // First terminal should be disposed to prevent memory leaks
      expect(firstTerminal.dispose).toHaveBeenCalled()
    })
  })

  describe('Stability and Performance (Codex Review Findings)', () => {
    test('P2: keeps service instance stable across re-renders', async () => {
      // Render component without explicit service prop (uses default)
      const { rerender } = render(
        <TerminalPane sessionId="test-session" cwd="/home/user" />
      )

      await waitFor(() => {
        expect(useTerminal).toHaveBeenCalled()
      })

      const firstCallService =
        vi.mocked(useTerminal).mock.calls[0]?.[0]?.service

      // Clear mocks to count new calls
      vi.mocked(useTerminal).mockClear()

      // Trigger re-render with same props
      rerender(<TerminalPane sessionId="test-session" cwd="/home/user" />)

      await waitFor(() => {
        expect(useTerminal).toHaveBeenCalled()
      })

      const secondCallService =
        vi.mocked(useTerminal).mock.calls[0]?.[0]?.service

      // Service instance should be the same across re-renders
      expect(firstCallService).toBe(secondCallService)
    })

    test('P1: does not recreate terminal when resize callback changes', async () => {
      // Render component
      const { rerender } = render(
        <TerminalPane sessionId="test-session" cwd="/home/user" />
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
      rerender(<TerminalPane sessionId="test-session" cwd="/home/user" />)

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
        <TerminalPane sessionId="test-session" cwd="/home/user" />
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
      rerender(<TerminalPane sessionId="test-session" cwd="/home/user" />)

      // Resize should be called when status becomes 'running'
      await waitFor(() => {
        expect(initialMockUseTerminal.resize).toHaveBeenCalled()
      })
    })
  })
})
