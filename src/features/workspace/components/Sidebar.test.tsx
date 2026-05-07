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

  test('removing the active session pre-selects the next visible Active row', async () => {
    // Mirrors SessionTabs.handleClose: useSessionManager's full-sessions
    // index fallback can land on a Recent (completed/errored) session
    // sandwiched between two running ones. Pre-selecting from the
    // visible Active group keeps selection on a tab the user can see.
    const onSessionClick = vi.fn()
    const onRemoveSession = vi.fn()
    const user = userEvent.setup()

    const sessions: Session[] = [
      { ...mockSessions[0], id: 'A', status: 'running', name: 'first-active' },
      // sess-3 in mockSessions is `completed` — between two actives in array
      // order — so the manager's full-index fallback would land on it.
      mockSessions[2],
      { ...mockSessions[1], id: 'B', status: 'running', name: 'second-active' },
    ]

    render(
      <Sidebar
        sessions={sessions}
        activeSessionId="A"
        onSessionClick={onSessionClick}
        onRemoveSession={onRemoveSession}
        agentStatus={inactiveAgentStatus}
      />
    )

    const list = screen.getByTestId('session-list')
    const activeRow = within(list).getByText('first-active').closest('li')!

    const removeBtn = within(activeRow).getByRole('button', {
      name: 'Remove session',
    })

    await user.click(removeBtn)

    // Pre-selected the next VISIBLE active (B), not the in-between Recent.
    expect(onSessionClick).toHaveBeenCalledWith('B')
    expect(onRemoveSession).toHaveBeenCalledWith('A')
  })

  test('without onRemoveSession, the remove button is hidden on Recent rows', () => {
    // RecentSessionRow gates the remove button on `onRemove` truthiness;
    // when Sidebar receives no onRemoveSession, handleRemoveSession is
    // undefined too — so neither selection nor removal can fire.
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-3"
        onSessionClick={mockOnSessionClick}
        agentStatus={inactiveAgentStatus}
      />
    )
    const recentList = screen.getByTestId('recent-list')
    expect(
      within(recentList).queryByRole('button', { name: 'Remove session' })
    ).toBeNull()
  })

  test('Active + Recent groups share a single scroll region', () => {
    // Sharing a scroll region means a long Recent group can't push
    // FileExplorer / New Instance below the fixed sidebar height.
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        agentStatus={inactiveAgentStatus}
      />
    )

    const scroll = screen.getByTestId('session-scroll')
    expect(scroll).toHaveClass('overflow-y-auto')
    expect(scroll).toHaveClass('flex-1')
    expect(scroll).toHaveClass('min-h-0')

    expect(scroll).toContainElement(screen.getByTestId('session-list'))
    expect(scroll).toContainElement(screen.getByTestId('recent-list'))
  })

  test('subtitle renders the last 2 segments of the cwd, normalizing Windows backslashes', () => {
    // Tauri can hand back native path separators; on Windows that means
    // `C:\Users\alice\my-repo`. After normalizing `\` → `/`, we want the
    // last TWO segments joined by `/` — so `C:\Users\alice\my-repo` reads
    // as `alice/my-repo`. The 2-segment rule also handles the shallow
    // case `/home/will` (renders `home/will` rather than collapsing
    // aggressively to `will`).
    const winSession: Session = {
      ...mockSessions[0],
      id: 'sess-win',
      name: 'win path',
      currentAction: undefined,
      workingDirectory: 'C:\\Users\\alice\\my-repo',
    }
    render(
      <Sidebar
        sessions={[winSession]}
        activeSessionId="sess-win"
        onSessionClick={mockOnSessionClick}
        agentStatus={inactiveAgentStatus}
      />
    )
    expect(screen.getByText('alice/my-repo')).toBeInTheDocument()
    expect(screen.queryByText(winSession.workingDirectory)).toBeNull()
  })

  test('subtitle renders 2-segment POSIX cwd as parent/basename (shallow path)', () => {
    // Per user direction: `/home/will` should show `home/will`, not just
    // `will`. The basename-only collapse loses too much context.
    const posixSession: Session = {
      ...mockSessions[0],
      id: 'sess-posix',
      name: 'posix shallow',
      currentAction: undefined,
      workingDirectory: '/home/will',
    }
    render(
      <Sidebar
        sessions={[posixSession]}
        activeSessionId="sess-posix"
        onSessionClick={mockOnSessionClick}
        agentStatus={inactiveAgentStatus}
      />
    )
    expect(screen.getByText('home/will')).toBeInTheDocument()
  })

  test('subtitle falls back to "~" when workingDirectory is empty (race-window safety)', () => {
    // During the brief window after session creation but before the first
    // OSC 7 cwd report from Tauri, `workingDirectory` may be seeded as
    // empty string. The fallback comment promises "never empty"; without
    // the `|| '~'` guard the raw empty string would render an invisible
    // subtitle div and a visible gap in the row. `~` is the conventional
    // shell display for an unknown/home cwd.
    const emptyCwdSession: Session = {
      ...mockSessions[0],
      id: 'sess-empty',
      name: 'empty cwd',
      currentAction: undefined,
      workingDirectory: '',
    }
    render(
      <Sidebar
        sessions={[emptyCwdSession]}
        activeSessionId="sess-empty"
        onSessionClick={mockOnSessionClick}
        agentStatus={inactiveAgentStatus}
      />
    )
    // `~` also appears in the SidebarStatusHeader's activeCwd display
    // (default prop). Scope the assertion to the actual session row to
    // confirm the subtitle line — not the header — rendered the fallback.
    const row = screen.getByTestId('session-row')
    expect(within(row).getByText('~')).toBeInTheDocument()
  })
})
