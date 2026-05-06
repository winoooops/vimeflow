/* eslint-disable testing-library/no-node-access */
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
    lastActivityAt: '2026-04-06T17:47:34Z', // 10h ago
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
    lastActivityAt: '2026-04-06T18:02:15Z', // 10h ago
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
    lastActivityAt: '2026-04-06T12:45:00Z', // 16h ago
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

  test('renders "Active" group header with add button', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        agentStatus={inactiveAgentStatus}
      />
    )

    // Handoff §4.2 sub-header: "ACTIVE" / "RECENT" in JetBrains Mono uppercase.
    expect(screen.getByTestId('session-group-active')).toHaveTextContent(
      'Active'
    )

    expect(
      screen.getByRole('button', { name: 'Add session' })
    ).toBeInTheDocument()
  })

  test('renders "Recent" group header when completed/errored sessions exist', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        agentStatus={inactiveAgentStatus}
      />
    )

    expect(screen.getByTestId('session-group-recent')).toHaveTextContent(
      'Recent'
    )
  })

  test('add session button changes color on hover', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        agentStatus={inactiveAgentStatus}
      />
    )

    const addButton = screen.getByRole('button', { name: 'Add session' })
    expect(addButton).toHaveClass('hover:text-primary')
  })

  test('calls onNewInstance when add session button is clicked', async () => {
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

    const addButton = screen.getByRole('button', { name: 'Add session' })
    await user.click(addButton)

    expect(mockOnNewInstance).toHaveBeenCalledOnce()
  })

  test('renders running/paused sessions in Active list, completed in Recent', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        agentStatus={inactiveAgentStatus}
      />
    )

    // Active group: sess-1 (running) + sess-2 (paused).
    const activeList = screen.getByTestId('session-list')
    expect(within(activeList).getByText('auth middleware')).toBeInTheDocument()
    expect(within(activeList).getByText('fix: login bug')).toBeInTheDocument()

    // Recent group: sess-3 (completed) lives here, NOT in the active list.
    const recentList = screen.getByTestId('recent-list')
    expect(
      within(recentList).getByText('refactor: api layer')
    ).toBeInTheDocument()

    expect(
      within(activeList).queryByText('refactor: api layer')
    ).not.toBeInTheDocument()
  })

  test('each session row carries a StatusDot reflecting its status', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        agentStatus={inactiveAgentStatus}
      />
    )

    const list = screen.getByTestId('session-list')

    const runningRow = within(list).getByText('auth middleware').closest('li')!
    expect(within(runningRow).getByTestId('status-dot')).toHaveAttribute(
      'data-status',
      'running'
    )

    const pausedRow = within(list).getByText('fix: login bug').closest('li')!
    expect(within(pausedRow).getByTestId('status-dot')).toHaveAttribute(
      'data-status',
      'paused'
    )
  })

  test('active row paints lavender-tinted background per handoff §4.2', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        agentStatus={inactiveAgentStatus}
      />
    )

    const list = screen.getByTestId('session-list')

    const activeRow = within(list).getByText('auth middleware').closest('li')!
    expect(activeRow.className).toContain('bg-primary/10')
    expect(activeRow.className).toContain('text-on-surface')
    const accent = activeRow.querySelector('[aria-hidden="true"]')
    expect(accent).not.toBeNull()
    expect(accent?.className).toContain('bg-primary-container')
  })

  test('inactive session items have on-surface-variant styling', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        agentStatus={inactiveAgentStatus}
      />
    )

    const inactiveButton = screen.getByRole('button', {
      name: 'fix: login bug',
    })
    const listItem = inactiveButton.closest('li')!
    expect(listItem.className).toContain('text-on-surface-variant')
  })

  test('calls onSessionClick with session id when session is clicked', async () => {
    const user = userEvent.setup()

    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        agentStatus={inactiveAgentStatus}
      />
    )

    const session = screen.getByRole('button', { name: 'fix: login bug' })
    await user.click(session)

    expect(mockOnSessionClick).toHaveBeenCalledWith('sess-2')
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

  test('renders empty state when no active sessions', () => {
    render(
      <Sidebar
        sessions={[]}
        activeSessionId={null}
        onSessionClick={mockOnSessionClick}
        agentStatus={inactiveAgentStatus}
      />
    )

    expect(screen.getByTestId('active-empty')).toHaveTextContent(
      'No active sessions'
    )
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

  test('handles null activeSessionId gracefully', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId={null}
        onSessionClick={mockOnSessionClick}
        agentStatus={inactiveAgentStatus}
      />
    )

    const sessionButtons = screen
      .getAllByRole('button')
      .filter((btn) =>
        mockSessions.some((s) => btn.getAttribute('aria-label') === s.name)
      )

    expect(sessionButtons).toHaveLength(3)
    sessionButtons.forEach((btn) => {
      const listItem = btn.closest('li')!
      expect(listItem.className).not.toContain('bg-surface-container-high')
    })
  })

  test('session list is scrollable', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        agentStatus={inactiveAgentStatus}
      />
    )

    const sessionList = screen.getByTestId('session-list')
    expect(sessionList).toHaveClass('overflow-y-auto')
  })
})
