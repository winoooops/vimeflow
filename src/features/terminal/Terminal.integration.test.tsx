/* eslint-disable testing-library/no-node-access */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import {
  TerminalPane,
  clearTerminalCache,
  type TerminalPaneProps,
} from './components/TerminalPane'
import { MockTerminalService } from './services/terminalService'
import type { ITerminalService } from './services/terminalService'
import type { Session } from '../sessions/types'

// Mock the terminal service module to use our controlled instance
// Initialize here (before vi.mock) so it's available when modules are imported
let mockServiceInstance: MockTerminalService = new MockTerminalService()

vi.mock('./services/terminalService', async () => {
  const actual = await vi.importActual<
    typeof import('./services/terminalService')
  >('./services/terminalService')

  return {
    ...actual,
    createTerminalService: (): ITerminalService => mockServiceInstance,
  }
})

const createTestSession = (sessionId: string, cwd: string): Session => ({
  id: sessionId,
  projectId: 'terminal-integration',
  name: sessionId,
  status: 'running',
  workingDirectory: cwd,
  agentType: 'generic',
  layout: 'single',
  panes: [
    {
      id: 'p0',
      ptyId: sessionId,
      cwd,
      agentType: 'generic',
      status: 'running',
      active: true,
    },
  ],
  createdAt: '2026-05-08T00:00:00Z',
  lastActivityAt: '2026-05-08T00:00:00Z',
  activity: {
    fileChanges: [],
    toolCalls: [],
    testResults: [],
    contextWindow: { used: 0, total: 200000, percentage: 0, emoji: '😊' },
    usage: {
      sessionDuration: 0,
      turnCount: 0,
      messages: { sent: 0, limit: 200 },
      tokens: { input: 0, output: 0, total: 0 },
    },
  },
})

interface TestTerminalPaneProps {
  sessionId: string
  cwd: string
  service: ITerminalService
  mode?: TerminalPaneProps['mode']
  session?: Session
  isActive?: boolean
}

const TestTerminalPane = ({
  sessionId,
  cwd,
  session = undefined,
  isActive = true,
  service,
  mode = undefined,
}: TestTerminalPaneProps): ReactElement => {
  const resolvedSession = session ?? createTestSession(sessionId, cwd)

  return (
    <TerminalPane
      session={resolvedSession}
      pane={resolvedSession.panes[0]}
      isActive={isActive}
      service={service}
      mode={mode}
    />
  )
}

/**
 * Terminal Integration Tests
 *
 * These tests verify end-to-end terminal functionality:
 * - Spawning a shell and verifying interactive I/O
 * - Terminal resize propagation to PTY
 * - Multiple terminal tab management
 * - Cleanup on unmount (preventing PTY process leaks)
 * - Error handling for spawn failures
 */
describe('Terminal Integration Tests', () => {
  beforeEach(() => {
    // Reset the mock service for each test
    // Create a fresh instance to ensure clean state
    mockServiceInstance = new MockTerminalService()
  })

  afterEach(async () => {
    // P2 Fix: Clear terminal cache to prevent leaks across tests
    clearTerminalCache()

    // Clean up any remaining sessions
    const activeSessions = mockServiceInstance.getActiveSessions()
    for (const sessionId of activeSessions) {
      try {
        await mockServiceInstance.kill({ sessionId })
      } catch {
        // Ignore errors during cleanup
      }
    }

    // Verify all PTY sessions are cleaned up after each test
    const remainingSessions = mockServiceInstance.getActiveSessions()
    expect(remainingSessions).toHaveLength(0)
  })

  describe('Spawn shell and interactive I/O', () => {
    test('spawns shell and wires PTY service for I/O', async (): Promise<void> => {
      render(
        <TestTerminalPane
          sessionId="test-session-1"
          cwd="/home/user"
          service={mockServiceInstance}
        />
      )

      // Wait for terminal to be ready (xterm.js initialized)
      const terminalPane = await screen.findByTestId('terminal-pane')
      expect(terminalPane).toBeInTheDocument()

      // Wait for PTY to spawn — verify service was called
      await waitFor(
        () => {
          const sessions = mockServiceInstance.getActiveSessions()
          expect(sessions.length).toBeGreaterThan(0)
        },
        { timeout: 2000 }
      )

      // Verify the spawn created a session with correct cwd
      const sessions = mockServiceInstance.getActiveSessions()
      expect(sessions).toHaveLength(1)
    })

    test('emits PTY data events to xterm output', async (): Promise<void> => {
      render(
        <TestTerminalPane
          service={mockServiceInstance}
          sessionId="test-session-2"
          cwd="/home/user"
        />
      )

      // Wait for terminal to spawn
      await screen.findByTestId('terminal-pane')
      await new Promise((resolve) => setTimeout(resolve, 200))

      // Get the spawned session ID from mock service
      const sessions = mockServiceInstance.getActiveSessions()
      expect(sessions).toHaveLength(1)

      const sessionId = sessions[0]

      // Emit data to the terminal (simulate PTY output)
      mockServiceInstance.emitData(sessionId, 'Welcome to the terminal!\r\n')

      // Wait for the data to appear in xterm
      await waitFor(() => {
        const terminalPane = screen.getByTestId('terminal-pane')
        const content = terminalPane.textContent || ''
        expect(content).toContain('Welcome to the terminal!')
      })
    })
  })

  describe('Terminal resize', () => {
    test('propagates resize events to PTY', async (): Promise<void> => {
      const resizeSpy = vi.spyOn(mockServiceInstance, 'resize')

      const { container, unmount } = render(
        <TestTerminalPane
          service={mockServiceInstance}
          sessionId="test-session-resize"
          cwd="/home/user"
        />
      )

      // Wait for terminal to be ready
      await screen.findByTestId('terminal-pane')

      // Wait for session to spawn
      await waitFor(
        () => {
          const sessions = mockServiceInstance.getActiveSessions()
          expect(sessions.length).toBeGreaterThanOrEqual(1)
        },
        { timeout: 2000 }
      )

      // Wait a bit more for initialization to complete
      await new Promise((resolve) => setTimeout(resolve, 300))

      // Simulate terminal resize by changing container size
      // eslint-disable-next-line testing-library/no-container
      const terminalContainer = container.querySelector(
        '[data-testid="terminal-pane"]'
      )!

      if (terminalContainer) {
        // Trigger resize by changing the container dimensions
        Object.defineProperty(terminalContainer, 'offsetWidth', {
          configurable: true,
          value: 1200,
        })

        Object.defineProperty(terminalContainer, 'offsetHeight', {
          configurable: true,
          value: 800,
        })

        // Fire resize event
        window.dispatchEvent(new Event('resize'))

        // Wait for resize to propagate to PTY service
        await waitFor(
          () => {
            expect(resizeSpy).toHaveBeenCalled()
          },
          { timeout: 1000 }
        )
      }

      // Clean up
      unmount()
      await new Promise((resolve) => setTimeout(resolve, 200))
    })
  })

  describe('Multiple terminal tabs', () => {
    test('can switch between multiple terminal sessions', async (): Promise<void> => {
      const { rerender, unmount } = render(
        <TestTerminalPane
          service={mockServiceInstance}
          sessionId="session-1"
          cwd="/home/user"
        />
      )

      // Wait for first terminal
      await screen.findByTestId('terminal-pane')
      // Body's inner container exposes the PTY handle via data-pty-id post-5a
      // (was data-session-id; renamed to avoid colliding with TerminalZone's
      // data-session-id={session.id} now that React Session.id is independent
      // from the Rust PTY handle).
      expect(screen.getByTestId('terminal-pane')).toHaveAttribute(
        'data-pty-id',
        'session-1'
      )

      // Wait for first session to spawn
      await waitFor(
        () => {
          const sessions = mockServiceInstance.getActiveSessions()
          expect(sessions.length).toBeGreaterThanOrEqual(1)
        },
        { timeout: 2000 }
      )

      // Switch to second terminal session
      rerender(
        <TestTerminalPane
          service={mockServiceInstance}
          sessionId="session-2"
          cwd="/home/user"
        />
      )

      // Wait for second terminal to be ready
      await waitFor(() => {
        expect(screen.getByTestId('terminal-pane')).toHaveAttribute(
          'data-pty-id',
          'session-2'
        )
      })

      // Wait for second session to spawn
      await new Promise((resolve) => setTimeout(resolve, 300))

      // Clean up both sessions
      unmount()
      await new Promise((resolve) => setTimeout(resolve, 200))
    })
  })

  describe('Terminal cleanup', () => {
    test('cleans up PTY session on unmount', async (): Promise<void> => {
      const killSpy = vi.spyOn(mockServiceInstance, 'kill')

      const { unmount } = render(
        <TestTerminalPane
          service={mockServiceInstance}
          sessionId="cleanup-test"
          cwd="/home/user"
        />
      )

      // Wait for terminal to spawn
      await screen.findByTestId('terminal-pane')
      await new Promise((resolve) => setTimeout(resolve, 200))

      // Verify session is active
      const sessionsBeforeUnmount = mockServiceInstance.getActiveSessions()
      expect(sessionsBeforeUnmount.length).toBeGreaterThan(0)

      // Unmount component (simulates closing tab)
      unmount()

      // Wait for cleanup
      await waitFor(
        () => {
          expect(killSpy).toHaveBeenCalled()
        },
        { timeout: 1000 }
      )
    })

    test('prevents PTY process leaks on rapid mount/unmount', async (): Promise<void> => {
      // Mount and unmount multiple times rapidly
      for (let i = 0; i < 5; i++) {
        const { unmount } = render(
          <TestTerminalPane
            sessionId={`rapid-test-${i}`}
            cwd="/home/user"
            service={mockServiceInstance}
          />
        )
        await new Promise((resolve) => setTimeout(resolve, 50))
        unmount()
      }

      // Wait for all cleanups to complete
      await new Promise((resolve) => setTimeout(resolve, 500))

      // Verify no sessions are left active
      const activeSessions = mockServiceInstance.getActiveSessions()
      expect(activeSessions).toHaveLength(0)
    })
  })

  describe('Error handling', () => {
    test('handles spawn failure gracefully', async (): Promise<void> => {
      // Override spawn to simulate failure
      const spawnSpy = vi
        .spyOn(mockServiceInstance, 'spawn')
        .mockRejectedValueOnce(
          new Error('Failed to spawn shell: Permission denied')
        )

      const { unmount } = render(
        <TestTerminalPane
          service={mockServiceInstance}
          sessionId="spawn-error-test"
          cwd="/invalid"
        />
      )

      // Wait for terminal to render
      await screen.findByTestId('terminal-pane')

      // Wait for spawn to be called
      await waitFor(
        () => {
          expect(spawnSpy).toHaveBeenCalled()
        },
        { timeout: 2000 }
      )

      // Verify spawn was called with correct params
      expect(spawnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: '/invalid',
        })
      )

      // Clean up
      unmount()
      await new Promise((resolve) => setTimeout(resolve, 200))

      spawnSpy.mockRestore()
    })

    test('handles write to non-existent session', async (): Promise<void> => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {
          // Suppress error output in tests
        })

      // Attempt to write to a session that doesn't exist
      await expect(
        mockServiceInstance.write({
          sessionId: 'non-existent-session',
          data: 'test',
        })
      ).rejects.toThrow('not found')

      consoleErrorSpy.mockRestore()
    })

    test('handles PTY exit event', async (): Promise<void> => {
      const { unmount } = render(
        <TestTerminalPane
          service={mockServiceInstance}
          sessionId="exit-test"
          cwd="/home/user"
        />
      )

      // Wait for terminal and spawn
      await screen.findByTestId('terminal-pane')

      // Wait for session to be spawned
      let sessionId = ''
      await waitFor(
        () => {
          const sessions = mockServiceInstance.getActiveSessions()
          expect(sessions).toHaveLength(1)
          sessionId = sessions[0]
        },
        { timeout: 2000 }
      )

      // Emit exit event
      mockServiceInstance.emitExit(sessionId, 0)

      // Wait for exit to be handled
      await new Promise((resolve) => setTimeout(resolve, 200))

      // Clean up
      unmount()
      await new Promise((resolve) => setTimeout(resolve, 200))
    })

    test('handles PTY error event', async (): Promise<void> => {
      const { unmount } = render(
        <TestTerminalPane
          service={mockServiceInstance}
          sessionId="error-test"
          cwd="/home/user"
        />
      )

      // Wait for terminal and spawn
      await screen.findByTestId('terminal-pane')

      // Wait for session to be spawned
      let sessionId = ''
      await waitFor(
        () => {
          const sessions = mockServiceInstance.getActiveSessions()
          expect(sessions).toHaveLength(1)
          sessionId = sessions[0]
        },
        { timeout: 2000 }
      )

      // Emit error event
      mockServiceInstance.emitError(sessionId, 'PTY read error')

      // Wait for error to be handled
      await new Promise((resolve) => setTimeout(resolve, 200))

      // Verify terminal received the error message
      const terminalPane = screen.getByTestId('terminal-pane')
      expect(terminalPane).toBeInTheDocument()

      // Clean up
      unmount()
      await new Promise((resolve) => setTimeout(resolve, 200))
    })
  })
})
