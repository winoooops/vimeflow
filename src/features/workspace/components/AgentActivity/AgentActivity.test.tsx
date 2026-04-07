import { render, screen } from '@testing-library/react'
import { test, expect, describe } from 'vitest'
import AgentActivity from './AgentActivity'
import type { Session } from '../../types'

const mockSession: Session = {
  id: 'session-1',
  projectId: 'project-1',
  name: 'Auth Middleware',
  status: 'running',
  workingDirectory: '/home/user/project',
  agentType: 'claude-code',
  currentAction: 'Creating auth middleware...',
  createdAt: '2026-04-07T03:45:00Z',
  lastActivityAt: '2026-04-07T03:47:30Z',
  activity: {
    fileChanges: [
      {
        id: 'fc-1',
        path: 'src/auth/middleware.ts',
        type: 'new',
        linesAdded: 48,
        linesRemoved: 0,
        timestamp: '2026-04-07T03:46:15Z',
      },
      {
        id: 'fc-2',
        path: 'src/auth/types.ts',
        type: 'modified',
        linesAdded: 12,
        linesRemoved: 3,
        timestamp: '2026-04-07T03:47:02Z',
      },
    ],
    toolCalls: [
      {
        id: 'tc-1',
        tool: 'Read',
        args: 'src/auth/types.ts',
        status: 'done',
        timestamp: '2026-04-07T03:45:32Z',
        duration: 120,
      },
      {
        id: 'tc-2',
        tool: 'Write',
        args: 'src/auth/middleware.ts (48 lines)',
        status: 'running',
        timestamp: '2026-04-07T03:46:15Z',
      },
    ],
    testResults: [
      {
        id: 'tr-1',
        file: 'src/auth/middleware.test.ts',
        passed: 4,
        failed: 1,
        total: 5,
        failures: [
          {
            id: 'tf-1',
            name: 'should reject invalid tokens',
            file: 'src/auth/middleware.test.ts',
            line: 45,
            message: 'Expected 401 but received 500',
          },
        ],
        timestamp: '2026-04-07T03:47:30Z',
      },
    ],
    contextWindow: {
      used: 75000,
      total: 200000,
      percentage: 37,
      emoji: '😊',
    },
    usage: {
      sessionDuration: 154, // 2m 34s
      turnCount: 12,
      messages: { sent: 142, limit: 200 },
      tokens: { input: 45000, output: 30000, total: 75000 },
      cost: { amount: 0.45, currency: 'USD' },
    },
  },
}

describe('AgentActivity', () => {
  describe('Rendering', () => {
    test('renders the agent activity panel', () => {
      render(<AgentActivity session={mockSession} />)

      expect(screen.getByTestId('agent-activity')).toBeInTheDocument()
    })

    test('renders the StatusCard component', () => {
      render(<AgentActivity session={mockSession} />)

      expect(screen.getByTestId('status-card')).toBeInTheDocument()
    })

    test('renders the PinnedMetrics component', () => {
      render(<AgentActivity session={mockSession} />)

      expect(screen.getByTestId('pinned-metrics')).toBeInTheDocument()
    })

    test('renders the FilesChanged section', () => {
      render(<AgentActivity session={mockSession} />)

      expect(screen.getByText('Files Changed')).toBeInTheDocument()
    })

    test('renders the ToolCalls section', () => {
      render(<AgentActivity session={mockSession} />)

      expect(screen.getByText('Tool Calls')).toBeInTheDocument()
    })

    test('renders the Tests section', () => {
      render(<AgentActivity session={mockSession} />)

      expect(screen.getByText('Tests')).toBeInTheDocument()
    })

    test('renders the ActivityFooter component', () => {
      render(<AgentActivity session={mockSession} />)

      expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    })
  })

  describe('Layout and Styling', () => {
    test('applies 280px width', () => {
      render(<AgentActivity session={mockSession} />)
      const panel = screen.getByTestId('agent-activity')

      expect(panel).toHaveClass('w-[280px]')
    })

    test('applies surface-container-low background color', () => {
      render(<AgentActivity session={mockSession} />)
      const panel = screen.getByTestId('agent-activity')

      // Check for bg-surface-container-low class (Level 1 - sidebar, activity panel)
      expect(panel).toHaveClass('bg-surface-container-low')
    })

    test('applies flex column layout', () => {
      render(<AgentActivity session={mockSession} />)
      const panel = screen.getByTestId('agent-activity')

      expect(panel).toHaveClass('flex')
      expect(panel).toHaveClass('flex-col')
    })

    test('applies vertical gap between sections', () => {
      render(<AgentActivity session={mockSession} />)
      const panel = screen.getByTestId('agent-activity')

      // Should have gap-4 or gap-6 for spacing between sections
      expect(panel.className).toMatch(/gap-/)
    })

    test('applies padding to the panel', () => {
      render(<AgentActivity session={mockSession} />)
      const panel = screen.getByTestId('agent-activity')

      // Should have padding (p-4, p-6, etc.)
      expect(panel.className).toMatch(/p-/)
    })
  })

  describe('Data Wiring', () => {
    test('passes session data to StatusCard', () => {
      render(<AgentActivity session={mockSession} />)

      // StatusCard should show agent name and status
      expect(screen.getByText('Claude Code')).toBeInTheDocument()
      expect(screen.getByText(/running/i)).toBeInTheDocument()
    })

    test('passes activity data to PinnedMetrics', () => {
      render(<AgentActivity session={mockSession} />)

      // PinnedMetrics should show context window emoji
      expect(screen.getByText('😊')).toBeInTheDocument()
    })

    test('passes fileChanges to FilesChanged', () => {
      render(<AgentActivity session={mockSession} />)

      // Should show file count in section header
      expect(screen.getByText('Files Changed')).toBeInTheDocument()
      // Multiple sections may have "(2)", so use getAllByText
      const counts = screen.getAllByText('(2)')

      expect(counts.length).toBeGreaterThanOrEqual(1)
    })

    test('passes toolCalls to ToolCalls', () => {
      render(<AgentActivity session={mockSession} />)

      // Should show tool call count in section header
      expect(screen.getByText('Tool Calls')).toBeInTheDocument()
      // Multiple sections may have "(2)", so use getAllByText
      const counts = screen.getAllByText('(2)')

      expect(counts.length).toBeGreaterThanOrEqual(1)
    })

    test('passes testResults to Tests', () => {
      render(<AgentActivity session={mockSession} />)

      // Should show test ratio in section header
      expect(screen.getByText('Tests')).toBeInTheDocument()
      expect(screen.getByText('(4/5)')).toBeInTheDocument()
    })

    test('passes activity data to ActivityFooter', () => {
      render(<AgentActivity session={mockSession} />)

      // ActivityFooter should show duration and turn count
      expect(screen.getByText(/2m 34s/)).toBeInTheDocument()
      expect(screen.getByText(/12 turns/)).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    test('handles session with no file changes', () => {
      const sessionNoFiles: Session = {
        ...mockSession,
        activity: {
          ...mockSession.activity,
          fileChanges: [],
        },
      }

      render(<AgentActivity session={sessionNoFiles} />)

      expect(screen.getByText('Files Changed')).toBeInTheDocument()
      // FilesChanged component should still render but show (0) or hide count
    })

    test('handles session with no tool calls', () => {
      const sessionNoTools: Session = {
        ...mockSession,
        activity: {
          ...mockSession.activity,
          toolCalls: [],
        },
      }

      render(<AgentActivity session={sessionNoTools} />)

      expect(screen.getByText('Tool Calls')).toBeInTheDocument()
    })

    test('handles session with no test results', () => {
      const sessionNoTests: Session = {
        ...mockSession,
        activity: {
          ...mockSession.activity,
          testResults: [],
        },
      }

      render(<AgentActivity session={sessionNoTests} />)

      expect(screen.getByText('Tests')).toBeInTheDocument()
    })

    test('handles completed session', () => {
      const completedSession: Session = {
        ...mockSession,
        status: 'completed',
      }

      render(<AgentActivity session={completedSession} />)

      expect(screen.getByText(/completed/i)).toBeInTheDocument()
    })

    test('handles errored session', () => {
      const erroredSession: Session = {
        ...mockSession,
        status: 'errored',
      }

      render(<AgentActivity session={erroredSession} />)

      expect(screen.getByText(/errored/i)).toBeInTheDocument()
    })
  })

  describe('Component Composition', () => {
    test('renders all components: StatusCard, PinnedMetrics, sections, footer', () => {
      render(<AgentActivity session={mockSession} />)

      // All major components should be present
      expect(screen.getByTestId('status-card')).toBeInTheDocument()
      expect(screen.getByTestId('pinned-metrics')).toBeInTheDocument()
      expect(screen.getByText('Files Changed')).toBeInTheDocument()
      expect(screen.getByText('Tool Calls')).toBeInTheDocument()
      expect(screen.getByText('Tests')).toBeInTheDocument()
      expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    })

    test('maintains visual hierarchy with proper spacing', () => {
      render(<AgentActivity session={mockSession} />)
      const panel = screen.getByTestId('agent-activity')

      // Should have flex-col and gap for vertical spacing
      expect(panel).toHaveClass('flex-col')
      expect(panel.className).toMatch(/gap-/)
    })
  })

  describe('Design System Compliance', () => {
    test('uses semantic token bg-surface-container-low', () => {
      render(<AgentActivity session={mockSession} />)
      const panel = screen.getByTestId('agent-activity')

      // Agent Activity panel should use Level 1 surface hierarchy
      expect(panel).toHaveClass('bg-surface-container-low')
    })

    test('uses fixed width of 280px', () => {
      render(<AgentActivity session={mockSession} />)
      const panel = screen.getByTestId('agent-activity')

      expect(panel).toHaveClass('w-[280px]')
    })

    test('uses full height', () => {
      render(<AgentActivity session={mockSession} />)
      const panel = screen.getByTestId('agent-activity')

      expect(panel).toHaveClass('h-full')
    })

    test('has overflow-y-auto for scrolling', () => {
      render(<AgentActivity session={mockSession} />)
      const panel = screen.getByTestId('agent-activity')

      expect(panel).toHaveClass('overflow-y-auto')
    })
  })
})
