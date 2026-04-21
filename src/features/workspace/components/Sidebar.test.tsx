/* eslint-disable testing-library/no-node-access */
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
    status: 'awaiting',
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
      />
    )

    const sidebar = screen.getByTestId('sidebar')
    expect(sidebar).toBeInTheDocument()
    expect(sidebar).toHaveClass('w-full')
  })

  test('renders agent header with name and status', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
      />
    )

    expect(screen.getByText('Agent Alpha')).toBeInTheDocument()
    expect(screen.getByText('System Idle')).toBeInTheDocument()
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

  test('add session button changes color on hover', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
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
      />
    )

    const addButton = screen.getByRole('button', { name: 'Add session' })
    await user.click(addButton)

    expect(mockOnNewInstance).toHaveBeenCalledOnce()
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

  test('active session has smart_toy icon', () => {
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
    expect(within(activeSession).getByText('smart_toy')).toBeInTheDocument()
  })

  test('inactive sessions have schedule icon', () => {
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
    expect(within(inactiveSession).getByText('schedule')).toBeInTheDocument()
  })

  test('active session item has surface-container-high styling', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
      />
    )

    const activeButton = screen.getByRole('button', {
      name: 'auth middleware',
    })
    const listItem = activeButton.closest('li')!
    expect(listItem.className).toContain('bg-surface-container-high')
    expect(listItem.className).toContain('text-on-surface')
  })

  test('inactive session items have on-surface-variant styling', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
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
      />
    )

    const sessionList = screen.getByTestId('session-list')
    expect(sessionList).toHaveClass('overflow-y-auto')
  })
})
