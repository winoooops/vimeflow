import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { TerminalPane } from './TerminalPane'

// Mock xterm modules
vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(),
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn(),
}))

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn(),
}))

describe('TerminalPane', () => {
  let mockTerminal: {
    open: ReturnType<typeof vi.fn>
    loadAddon: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
    onResize: ReturnType<typeof vi.fn>
    options: Record<string, unknown>
  }
  let mockFitAddon: { fit: ReturnType<typeof vi.fn> }
  let mockWebglAddon: object

  beforeEach(() => {
    // Mock terminal instance
    mockTerminal = {
      open: vi.fn(),
      loadAddon: vi.fn(),
      dispose: vi.fn(),
      onResize: vi.fn(() => ({ dispose: vi.fn() })),
      options: {},
    }

    // Mock fit addon
    mockFitAddon = {
      fit: vi.fn(),
    }

    // Mock WebGL addon
    mockWebglAddon = {}

    // Setup mocks
    vi.mocked(Terminal).mockImplementation(() => mockTerminal as never)
    vi.mocked(FitAddon).mockImplementation(() => mockFitAddon as never)
    vi.mocked(WebglAddon).mockImplementation(() => mockWebglAddon as never)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('renders terminal container', () => {
    render(<TerminalPane sessionId="test-session" />)
    const container = screen.getByTestId('terminal-pane')
    expect(container).toBeInTheDocument()
  })

  test('initializes xterm terminal on mount', async () => {
    render(<TerminalPane sessionId="test-session" />)

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
    render(<TerminalPane sessionId="test-session" />)

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
    render(<TerminalPane sessionId="test-session" />)

    await waitFor(() => {
      expect(FitAddon).toHaveBeenCalled()
      expect(mockTerminal.loadAddon).toHaveBeenCalledWith(mockFitAddon)
    })
  })

  test('loads WebGL addon', async () => {
    render(<TerminalPane sessionId="test-session" />)

    await waitFor(() => {
      expect(WebglAddon).toHaveBeenCalled()
      expect(mockTerminal.loadAddon).toHaveBeenCalledWith(mockWebglAddon)
    })
  })

  test('opens terminal in container', async () => {
    render(<TerminalPane sessionId="test-session" />)

    await waitFor(() => {
      expect(mockTerminal.open).toHaveBeenCalledWith(expect.any(HTMLDivElement))
    })
  })

  test('fits terminal to container after opening', async () => {
    render(<TerminalPane sessionId="test-session" />)

    await waitFor(() => {
      expect(mockFitAddon.fit).toHaveBeenCalled()
    })
  })

  test('handles terminal resize events', async () => {
    render(<TerminalPane sessionId="test-session" />)

    await waitFor(() => {
      expect(mockTerminal.onResize).toHaveBeenCalled()
    })
  })

  test('disposes terminal on unmount', async () => {
    const { unmount } = render(<TerminalPane sessionId="test-session" />)

    // Wait for terminal to initialize
    await waitFor(() => {
      expect(mockTerminal.open).toHaveBeenCalled()
    })

    // Unmount component
    unmount()

    // Verify cleanup
    expect(mockTerminal.dispose).toHaveBeenCalled()
  })

  test('passes sessionId prop correctly', () => {
    const sessionId = 'custom-session-123'
    render(<TerminalPane sessionId={sessionId} />)

    const container = screen.getByTestId('terminal-pane')
    expect(container).toHaveAttribute('data-session-id', sessionId)
  })

  test('uses full width and height', () => {
    render(<TerminalPane sessionId="test-session" />)

    const container = screen.getByTestId('terminal-pane')
    expect(container).toHaveClass('w-full')
    expect(container).toHaveClass('h-full')
  })

  test('handles missing WebGL gracefully', async () => {
    // Mock WebGL addon to throw error
    vi.mocked(WebglAddon).mockImplementation(() => {
      throw new Error('WebGL not supported')
    })

    // Should not crash
    render(<TerminalPane sessionId="test-session" />)

    await waitFor(() => {
      expect(mockTerminal.open).toHaveBeenCalled()
    })
  })
})
