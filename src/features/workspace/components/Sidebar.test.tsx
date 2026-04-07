import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from './Sidebar'
import type { Session } from '../types'

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

  test('renders with 256px width', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        onNewInstance={mockOnNewInstance}
      />
    )

    const sidebar = screen.getByTestId('sidebar')
    expect(sidebar).toBeInTheDocument()
    expect(sidebar).toHaveClass('w-64') // w-64 = 256px
  })

  test('renders "Active Sessions" header with add button', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
      />
    )

    expect(screen.getByText('Active Sessions')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Add session' })
    ).toBeInTheDocument()
  })

  test('add session button has rotate-90 hover animation', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
      />
    )

    const addButton = screen.getByRole('button', { name: 'Add session' })
    expect(addButton).toHaveClass('hover:rotate-90')
  })

  test('renders all sessions', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
      />
    )

    expect(screen.getByText('auth middleware')).toBeInTheDocument()
    expect(screen.getByText('fix: login bug')).toBeInTheDocument()
    expect(screen.getByText('refactor: api layer')).toBeInTheDocument()
  })

  test('active session has terminal icon', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
      />
    )

    const activeSession = screen.getByRole('button', {
      name: 'auth middleware',
    })
    expect(within(activeSession).getByText('terminal')).toBeInTheDocument()
  })

  test('inactive sessions have history icon', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
      />
    )

    const inactiveSession = screen.getByRole('button', {
      name: 'fix: login bug',
    })
    expect(within(inactiveSession).getByText('history')).toBeInTheDocument()
  })

  test('active session has bg-slate-800/80 text-primary-container styling', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
      />
    )

    const activeSession = screen.getByRole('button', {
      name: 'auth middleware',
    })
    expect(activeSession.className).toContain('bg-slate-800/80')
    expect(activeSession.className).toContain('text-primary-container')
  })

  test('inactive sessions have text-slate-500 styling', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
      />
    )

    const inactiveSession = screen.getByRole('button', {
      name: 'fix: login bug',
    })
    expect(inactiveSession.className).toContain('text-slate-500')
  })

  test('active session has LIVE badge (hidden by default, visible on hover)', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
      />
    )

    const activeSession = screen.getByRole('button', {
      name: 'auth middleware',
    })
    expect(within(activeSession).getByText('LIVE')).toBeInTheDocument()
  })

  test('calls onSessionClick with session id when session is clicked', async () => {
    const user = userEvent.setup()

    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
      />
    )

    const session = screen.getByRole('button', { name: 'fix: login bug' })
    await user.click(session)

    expect(mockOnSessionClick).toHaveBeenCalledWith('sess-2')
  })

  test('displays timestamps for sessions', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
      />
    )

    const timestamps = screen.getAllByTestId('session-timestamp')
    expect(timestamps).toHaveLength(3)
    expect(timestamps[0]).toHaveTextContent(/ago/)
  })

  test('uses design tokens for colors', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
      />
    )

    const sidebar = screen.getByTestId('sidebar')
    expect(sidebar).toHaveClass('bg-surface-container-low')
  })

  test('renders empty state when no sessions', () => {
    render(
      <Sidebar
        sessions={[]}
        activeSessionId={null}
        onSessionClick={mockOnSessionClick}
      />
    )

    expect(screen.getByText('No sessions')).toBeInTheDocument()
  })

  test('renders FileExplorer section', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
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
      />
    )

    // All sessions should render without active styling
    const sessions = screen
      .getAllByRole('button')
      .filter((btn) =>
        mockSessions.some((s) => btn.getAttribute('aria-label') === s.name)
      )

    expect(sessions).toHaveLength(3)
    sessions.forEach((session) => {
      expect(session.className).not.toContain('bg-slate-800/80')
      expect(session.className).not.toContain('text-primary-container')
    })
  })

  test('session list is scrollable', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
      />
    )

    const sessionList = screen.getByTestId('session-list')
    expect(sessionList).toHaveClass('overflow-y-auto')
  })
})
