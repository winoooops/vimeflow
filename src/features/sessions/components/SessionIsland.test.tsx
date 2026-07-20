import { describe, expect, test, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Session } from '../types'
import { SessionIsland } from './SessionIsland'

const session = (index: number, overrides: Partial<Session> = {}): Session => ({
  id: `session-${index}`,
  projectId: `project-${index}`,
  name: `Session ${index}`,
  open: true,
  status: 'running',
  workingDirectory: `/tmp/session-${index}`,
  agentType: 'generic',
  layout: 'single',
  activityPanelCollapsed: false,
  panes: [
    {
      id: 'p0',
      ptyId: `pty-${index}`,
      cwd: `/tmp/session-${index}`,
      agentType: 'generic',
      status: 'running',
      active: true,
    },
  ],
  createdAt: '2026-07-20T00:00:00Z',
  lastActivityAt: '2026-07-20T00:00:00Z',
  activity: {
    fileChanges: [],
    toolCalls: [],
    testResults: [],
    contextWindow: { used: 0, total: 1, percentage: 0, emoji: '😊' },
    usage: {
      sessionDuration: 0,
      turnCount: 0,
      messages: { sent: 0, limit: 1 },
      tokens: { input: 0, output: 0, total: 0 },
    },
  },
  ...overrides,
})

const sessions = (count: number): Session[] =>
  Array.from({ length: count }, (_, index) => session(index + 1))

const recentSession = (): Session =>
  session(99, {
    id: 'recent',
    name: 'Recent session',
    open: false,
    status: 'completed',
    panes: [
      {
        id: 'p0',
        ptyId: 'pty-recent',
        cwd: '/tmp/recent',
        agentType: 'generic',
        status: 'completed',
        active: true,
      },
    ],
  })

describe('SessionIsland', () => {
  test('renders nothing when there are no open sessions', () => {
    render(
      <SessionIsland
        sessions={[recentSession()]}
        activeSessionId="recent"
        displayMode="dots"
        onSessionSelect={vi.fn()}
      />
    )

    expect(
      screen.queryByRole('navigation', { name: 'Open sessions' })
    ).not.toBeInTheDocument()
  })

  test('keeps sidebar order, excludes Recent, and delegates selection', async () => {
    const onSessionSelect = vi.fn()
    const ordered = [session(3), recentSession(), session(1), session(2)]
    render(
      <SessionIsland
        sessions={ordered}
        activeSessionId="session-1"
        displayMode="dots"
        onSessionSelect={onSessionSelect}
      />
    )

    const buttons = screen.getAllByRole('button')
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Switch to session 1: Session 3',
      'Switch to session 2: Session 1',
      'Switch to session 3: Session 2',
    ])

    await userEvent.click(buttons[2])
    expect(onSessionSelect).toHaveBeenCalledWith('session-2')
  })

  test('shows the ten-item batch containing the selected open session', () => {
    render(
      <SessionIsland
        sessions={sessions(23)}
        activeSessionId="session-11"
        displayMode="numbers"
        onSessionSelect={vi.fn()}
      />
    )

    expect(screen.queryByText('10')).not.toBeInTheDocument()
    expect(screen.getByText('11')).toBeInTheDocument()
    expect(screen.getByText('20')).toBeInTheDocument()
    expect(screen.queryByText('21')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(10)
  })

  test('swaps batches at a boundary and preserves keyed nodes within a batch', () => {
    const allSessions = sessions(20)

    const { rerender } = render(
      <SessionIsland
        sessions={allSessions}
        activeSessionId="session-10"
        displayMode="dots"
        onSessionSelect={vi.fn()}
      />
    )

    expect(
      screen.getByTestId('session-island-indicator-session-10')
    ).toHaveAttribute('aria-current', 'page')

    rerender(
      <SessionIsland
        sessions={allSessions}
        activeSessionId="session-11"
        displayMode="dots"
        onSessionSelect={vi.fn()}
      />
    )

    const session12 = screen.getByTestId('session-island-indicator-session-12')
    expect(
      screen.queryByTestId('session-island-indicator-session-10')
    ).not.toBeInTheDocument()

    rerender(
      <SessionIsland
        sessions={allSessions}
        activeSessionId="session-12"
        displayMode="dots"
        onSessionSelect={vi.fn()}
      />
    )

    expect(screen.getByTestId('session-island-indicator-session-12')).toBe(
      session12
    )
  })

  test('starts at the first batch for an initial Recent selection', () => {
    render(
      <SessionIsland
        sessions={[...sessions(15), recentSession()]}
        activeSessionId="recent"
        displayMode="numbers"
        onSessionSelect={vi.fn()}
      />
    )

    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.queryByText('11')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { current: 'page' })).toBeNull()
  })

  test('retains and clamps the last batch while a Recent session is selected', () => {
    const allSessions = sessions(15)

    const { rerender } = render(
      <SessionIsland
        sessions={[...allSessions, recentSession()]}
        activeSessionId="session-11"
        displayMode="numbers"
        onSessionSelect={vi.fn()}
      />
    )

    rerender(
      <SessionIsland
        sessions={[...allSessions, recentSession()]}
        activeSessionId="recent"
        displayMode="numbers"
        onSessionSelect={vi.fn()}
      />
    )

    expect(screen.getByText('11')).toBeInTheDocument()
    expect(screen.queryByRole('button', { current: 'page' })).toBeNull()

    rerender(
      <SessionIsland
        sessions={[...sessions(5), recentSession()]}
        activeSessionId="recent"
        displayMode="numbers"
        onSessionSelect={vi.fn()}
      />
    )

    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(5)
  })

  test('uses positional semantic colors around the active indicator', () => {
    render(
      <SessionIsland
        sessions={sessions(5)}
        activeSessionId="session-3"
        displayMode="dots"
        onSessionSelect={vi.fn()}
      />
    )

    expect(
      screen.getByTestId('session-island-indicator-session-2')
    ).toHaveClass('bg-secondary')

    expect(
      screen.getByTestId('session-island-indicator-session-3')
    ).toHaveClass('bg-primary', 'w-[48px]')

    expect(
      screen.getByTestId('session-island-indicator-session-4')
    ).toHaveClass('bg-secondary/55')
  })

  test('dims every indicator when the selected session is Recent', () => {
    render(
      <SessionIsland
        sessions={[...sessions(3), recentSession()]}
        activeSessionId="recent"
        displayMode="dots"
        onSessionSelect={vi.fn()}
      />
    )

    screen.getAllByRole('button').forEach((button) => {
      expect(button).toHaveClass('bg-secondary/55')
      expect(button).not.toHaveClass('w-12')
    })
  })

  test('shows only the active session name in active-label mode', () => {
    const long = session(2, {
      name: 'A very long session name that must be truncated in the island',
    })
    render(
      <SessionIsland
        sessions={[session(1), long, session(3)]}
        activeSessionId="session-2"
        displayMode="labels"
        onSessionSelect={vi.fn()}
      />
    )

    const active = screen.getByTestId('session-island-indicator-session-2')
    expect(active).toHaveTextContent(long.name)
    expect(active).toHaveStyle({ width: '160px' })
    expect(within(active).getByText(long.name)).toHaveClass('truncate')
    expect(
      screen.getByTestId('session-island-indicator-session-1')
    ).toHaveTextContent('')
  })

  test('uses the approved surface geometry and motion tokens', () => {
    render(
      <SessionIsland
        sessions={sessions(2)}
        activeSessionId="session-1"
        displayMode="dots"
        onSessionSelect={vi.fn()}
      />
    )

    expect(
      screen.getByRole('navigation', { name: 'Open sessions' })
    ).toHaveClass(
      'h-[28px]',
      'gap-[4px]',
      'rounded-[18px]',
      'shadow-none',
      'vf-app-no-drag'
    )

    expect(
      screen.getByTestId('session-island-indicator-session-1')
    ).toHaveClass(
      'h-[16px]',
      'w-[48px]',
      'duration-[222.222ms]',
      'ease-[cubic-bezier(.333333,1,.666667,1)]',
      'motion-reduce:duration-[1ms]'
    )
  })

  test('omits the quiet notification slot by default and renders it on request', () => {
    const props = {
      sessions: sessions(1),
      activeSessionId: 'session-1',
      displayMode: 'dots' as const,
      onSessionSelect: vi.fn(),
    }
    const { rerender } = render(<SessionIsland {...props} />)

    expect(screen.queryByTestId('session-island-notifications')).toBeNull()

    rerender(<SessionIsland {...props} showNotifications />)

    expect(screen.getByTestId('session-island-notifications')).toHaveClass(
      'material-symbols-outlined'
    )
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })
})
