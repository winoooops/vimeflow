/* eslint-disable testing-library/no-node-access */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { List } from './List'
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

describe('List', () => {
  const mockOnSessionClick = vi.fn()
  const mockOnCreateSession = vi.fn()

  beforeEach(() => {
    mockOnSessionClick.mockClear()
    mockOnCreateSession.mockClear()
  })

  test('renders new session ghost button below the scroll area so it stays visible when sessions overflow', () => {
    render(
      <List
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        onCreateSession={mockOnCreateSession}
      />
    )

    expect(screen.getByTestId('session-group-active')).toHaveTextContent(
      'Active'
    )

    const scroll = screen.getByTestId('session-scroll')

    const newSessionButton = screen.getByRole('button', {
      name: 'new session',
    })

    expect(newSessionButton).toHaveAttribute(
      'data-testid',
      'sessions-list-new-session'
    )
    expect(newSessionButton).toHaveClass('w-full')
    expect(scroll).not.toContainElement(newSessionButton)
    expect(
      screen.queryByRole('button', { name: 'Add session' })
    ).not.toBeInTheDocument()
  })

  test('renders Recent header inside scroll container when completed sessions exist', () => {
    render(
      <List
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
      />
    )

    expect(screen.getByTestId('session-group-recent')).toHaveTextContent(
      'Recent'
    )
  })

  test('splits sessions: running/paused in Active, completed/errored in Recent', () => {
    render(
      <List
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
      />
    )

    const activeList = screen.getByTestId('session-list')
    expect(within(activeList).getByText('auth middleware')).toBeInTheDocument()
    expect(within(activeList).getByText('fix: login bug')).toBeInTheDocument()

    const recentList = screen.getByTestId('recent-list')
    expect(
      within(recentList).getByText('refactor: api layer')
    ).toBeInTheDocument()

    expect(
      within(activeList).queryByText('refactor: api layer')
    ).not.toBeInTheDocument()
  })

  test('renders empty state when no active sessions', () => {
    render(
      <List
        sessions={[]}
        activeSessionId={null}
        onSessionClick={mockOnSessionClick}
      />
    )

    expect(screen.getByTestId('active-empty')).toHaveTextContent(
      'No active sessions'
    )
  })

  test('calls onSessionClick when session card is clicked', async () => {
    const user = userEvent.setup()

    render(
      <List
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
      />
    )

    const session = screen.getByRole('button', { name: 'fix: login bug' })
    await user.click(session)

    expect(mockOnSessionClick).toHaveBeenCalledWith('sess-2')
  })

  test('calls onCreateSession when new session button is clicked', async () => {
    const user = userEvent.setup()

    render(
      <List
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        onCreateSession={mockOnCreateSession}
      />
    )

    const addButton = screen.getByRole('button', { name: 'new session' })
    await user.click(addButton)

    expect(mockOnCreateSession).toHaveBeenCalledOnce()
  })

  test('new session button is NOT rendered when onCreateSession is undefined', () => {
    // Regression guard: omit the creation affordance when no callback is
    // supplied so the button cannot render, accept focus, and silently no-op.
    render(
      <List
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        // intentionally NOT passing onCreateSession
      />
    )

    expect(
      screen.queryByRole('button', { name: 'new session' })
    ).not.toBeInTheDocument()
  })

  test('removing active session pre-selects next visible Active row', async () => {
    const onSessionClick = vi.fn()
    const onRemoveSession = vi.fn()
    const user = userEvent.setup()

    const sessions: Session[] = [
      { ...mockSessions[0], id: 'A', status: 'running', name: 'first-active' },
      mockSessions[2], // completed (recent)
      { ...mockSessions[1], id: 'B', status: 'running', name: 'second-active' },
    ]

    render(
      <List
        sessions={sessions}
        activeSessionId="A"
        onSessionClick={onSessionClick}
        onRemoveSession={onRemoveSession}
      />
    )

    const list = screen.getByTestId('session-list')
    const activeRow = within(list).getByText('first-active').closest('li')!

    const removeBtn = within(activeRow).getByRole('button', {
      name: 'Remove session',
    })

    await user.click(removeBtn)

    expect(onSessionClick).toHaveBeenCalledWith('B')
    expect(onRemoveSession).toHaveBeenCalledWith('A')
    // Lock the call order: handleRemoveSession in List.tsx fires
    // onRemoveSession(id) BEFORE onSessionClick(nextId) so the
    // flushSync inside useSessionManager.removeSession can apply its
    // setActiveSessionId without racing the explicit override here.
    // Mirrors the same invariant Tabs.test.tsx enforces for the strip.
    expect(onRemoveSession.mock.invocationCallOrder[0]).toBeLessThan(
      onSessionClick.mock.invocationCallOrder[0]
    )
  })

  test('without onRemoveSession, remove buttons are hidden', () => {
    render(
      <List
        sessions={mockSessions}
        activeSessionId="sess-3"
        onSessionClick={mockOnSessionClick}
      />
    )

    const recentList = screen.getByTestId('recent-list')
    expect(
      within(recentList).queryByRole('button', { name: 'Remove session' })
    ).toBeNull()
  })

  test('Active and Recent groups share single scroll region', () => {
    render(
      <List
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
      />
    )

    const scroll = screen.getByTestId('session-scroll')
    expect(scroll).toHaveClass('overflow-y-auto')
    // `overflow-x-clip` + `thin-scrollbar` are required to avoid the
    // WebKitGTK double-painted-track on the default scrollbar path.
    expect(scroll).toHaveClass('overflow-x-clip')
    expect(scroll).toHaveClass('thin-scrollbar')
    expect(scroll).toHaveClass('flex-1')
    expect(scroll).toHaveClass('min-h-0')

    expect(scroll).toContainElement(screen.getByTestId('session-list'))
    expect(scroll).toContainElement(screen.getByTestId('recent-list'))
  })
})
