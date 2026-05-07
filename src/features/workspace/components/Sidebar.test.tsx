import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from './Sidebar'
import type { Session } from '../types'
import type { AgentStatus } from '../../agent-status/types'

const inactiveAgentStatus: AgentStatus = {
  isActive: false,
  agentType: null,
  modelId: null,
  modelDisplayName: null,
  version: null,
  sessionId: null,
  agentSessionId: null,
  contextWindow: null,
  cost: null,
  rateLimits: null,
  numTurns: 0,
  toolCalls: { total: 0, byType: {}, active: null },
  recentToolCalls: [],
  testRun: null,
}

const mockSessions: Session[] = [
  {
    id: 'sess-1',
    projectId: 'proj-1',
    name: 'auth middleware',
    status: 'running',
    workingDirectory: '/home/user/projects/Vimeflow',
    agentType: 'claude-code',
    terminalPid: 12345,
    createdAt: '2026-04-07T03:45:00Z',
    lastActivityAt: '2026-04-06T17:47:34Z',
    activity: {
      fileChanges: [],
      toolCalls: [],
      testResults: [],
      contextWindow: {
        used: 5000,
        total: 200000,
        percentage: 2.5,
        emoji: '😊',
      },
      usage: {
        sessionDuration: 300,
        turnCount: 5,
        messages: { sent: 5, limit: 200 },
        tokens: { input: 2000, output: 3000, total: 5000 },
      },
    },
  },
  {
    id: 'sess-2',
    projectId: 'proj-1',
    name: 'fix: login bug',
    status: 'paused',
    workingDirectory: '/home/user/projects/Vimeflow',
    agentType: 'claude-code',
    terminalPid: 12346,
    createdAt: '2026-04-07T03:30:00Z',
    lastActivityAt: '2026-04-06T18:02:15Z',
    activity: {
      fileChanges: [],
      toolCalls: [],
      testResults: [],
      contextWindow: { used: 10000, total: 200000, percentage: 5, emoji: '😊' },
      usage: {
        sessionDuration: 135,
        turnCount: 3,
        messages: { sent: 3, limit: 200 },
        tokens: { input: 5000, output: 5000, total: 10000 },
      },
    },
  },
  {
    id: 'sess-3',
    projectId: 'proj-1',
    name: 'refactor: api layer',
    status: 'completed',
    workingDirectory: '/home/user/projects/Vimeflow',
    agentType: 'claude-code',
    createdAt: '2026-04-07T02:00:00Z',
    lastActivityAt: '2026-04-06T12:45:00Z',
    activity: {
      fileChanges: [],
      toolCalls: [],
      testResults: [],
      contextWindow: {
        used: 150000,
        total: 200000,
        percentage: 75,
        emoji: '😟',
      },
      usage: {
        sessionDuration: 2700,
        turnCount: 20,
        messages: { sent: 20, limit: 200 },
        tokens: { input: 75000, output: 75000, total: 150000 },
      },
    },
  },
]

describe('Sidebar', () => {
  const mockOnSessionClick = vi.fn()
  const mockOnNewInstance = vi.fn()

  beforeEach(() => {
    mockOnSessionClick.mockClear()
    mockOnNewInstance.mockClear()
  })

  test('renders with full width (sized by parent grid)', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        onNewInstance={mockOnNewInstance}
        agentStatus={inactiveAgentStatus}
      />
    )

    const sidebar = screen.getByTestId('sidebar')
    expect(sidebar).toBeInTheDocument()
    expect(sidebar).toHaveClass('w-full')
  })

  test('renders the sidebar status header in the top slot', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        agentStatus={inactiveAgentStatus}
      />
    )

    expect(screen.getByTestId('sidebar-status-header-idle')).toBeInTheDocument()
    expect(screen.queryByText('Agent Alpha')).not.toBeInTheDocument()
    expect(screen.queryByText('System Idle')).not.toBeInTheDocument()
  })

  test('uses design tokens for colors', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        agentStatus={inactiveAgentStatus}
      />
    )

    const sidebar = screen.getByTestId('sidebar')
    expect(sidebar).toHaveClass('bg-surface-container-low')
  })

  test('renders FileExplorer section', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        agentStatus={inactiveAgentStatus}
      />
    )

    expect(screen.getByTestId('file-explorer')).toBeInTheDocument()
    expect(screen.getByText('File Explorer')).toBeInTheDocument()
  })

  test('renders "New Instance" button at bottom', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        onNewInstance={mockOnNewInstance}
        agentStatus={inactiveAgentStatus}
      />
    )

    const newInstanceButton = screen.getByRole('button', {
      name: 'New Instance',
    })
    expect(newInstanceButton).toBeInTheDocument()
    expect(newInstanceButton).toHaveClass('bg-gradient-to-r')
    expect(newInstanceButton).toHaveClass('from-primary')
    expect(newInstanceButton).toHaveClass('to-secondary')
  })

  test('"New Instance" button has bolt icon', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        onNewInstance={mockOnNewInstance}
        agentStatus={inactiveAgentStatus}
      />
    )

    const newInstanceButton = screen.getByRole('button', {
      name: 'New Instance',
    })
    expect(within(newInstanceButton).getByText('bolt')).toBeInTheDocument()
  })

  test('calls onNewInstance when "New Instance" button is clicked', async () => {
    const user = userEvent.setup()

    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        onNewInstance={mockOnNewInstance}
        agentStatus={inactiveAgentStatus}
      />
    )

    const newInstanceButton = screen.getByRole('button', {
      name: 'New Instance',
    })
    await user.click(newInstanceButton)

    expect(mockOnNewInstance).toHaveBeenCalledTimes(1)
  })

  test('"New Instance" button has shadow effects', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        onNewInstance={mockOnNewInstance}
        agentStatus={inactiveAgentStatus}
      />
    )

    const newInstanceButton = screen.getByRole('button', {
      name: 'New Instance',
    })
    expect(newInstanceButton).toHaveClass('shadow-lg')
    expect(newInstanceButton).toHaveClass('shadow-primary/10')
  })
})
