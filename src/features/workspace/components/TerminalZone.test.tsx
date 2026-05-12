// cspell:ignore vsplit
import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { TerminalZone } from './TerminalZone'
import { mockSessions } from '../data/mockSessions'
import type { Session } from '../../sessions/types'
import type { TerminalPaneProps } from '../../terminal/components/TerminalPane'
import type { ITerminalService } from '../../terminal/services/terminalService'

// Round 4 Finding 1: TerminalZone now requires a `service` prop so it can
// forward it to every TerminalPane. The shared mock below is a no-op stub —
// individual tests don't exercise service behavior because TerminalPane is
// itself mocked.
const mockService: ITerminalService = {
  spawn: vi.fn().mockResolvedValue({ sessionId: 'mock', pid: 0 }),
  write: vi.fn().mockResolvedValue(undefined),
  resize: vi.fn().mockResolvedValue(undefined),
  kill: vi.fn().mockResolvedValue(undefined),
  onData: vi.fn(
    (): Promise<() => void> =>
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      Promise.resolve((): void => {})
  ),
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  onExit: vi.fn((): (() => void) => (): void => {}),
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  onError: vi.fn((): (() => void) => (): void => {}),
  listSessions: vi.fn().mockResolvedValue({
    activeSessionId: null,
    sessions: [],
  }),
  setActiveSession: vi.fn().mockResolvedValue(undefined),
  reorderSessions: vi.fn().mockResolvedValue(undefined),
  updateSessionCwd: vi.fn().mockResolvedValue(undefined),
}

// Mock TerminalPane to avoid xterm.js issues in tests
vi.mock('../../terminal/components/TerminalPane', () => ({
  TerminalPane: vi.fn(
    ({
      pane,
      mode,
      onCwdChange,
      deferFit,
      onRestart,
      session,
      isActive,
    }: TerminalPaneProps): ReactElement => (
      <div
        data-testid="terminal-pane-mock"
        data-session-id={session.id}
        data-pane-id={pane.id}
        data-pty-id={pane.ptyId}
        data-cwd={pane.cwd}
        data-restored={pane.restoreData ? 'true' : 'false'}
        data-mode={mode}
        data-defer-fit={deferFit ? 'true' : 'false'}
        data-session-name={session.name}
        data-is-active={isActive ? 'true' : 'false'}
        data-session-agent-type={session.agentType}
      >
        Mocked TerminalPane
        {/* Expose the onRestart wiring so tests can assert TerminalZone
          forwards onSessionRestart down to the pane. */}
        {onRestart && (
          <button
            type="button"
            data-testid={`mock-restart-${session.id}`}
            onClick={() => onRestart(session.id)}
          >
            mock-restart
          </button>
        )}
        {onCwdChange && (
          <button
            type="button"
            data-testid={`mock-cwd-${session.id}`}
            onClick={() => onCwdChange('/changed')}
          >
            mock-cwd
          </button>
        )}
      </div>
    )
  ),
}))

describe('TerminalZone', () => {
  const defaultProps = {
    sessions: mockSessions.slice(0, 2), // First two sessions
    activeSessionId: 'sess-1',
    service: mockService,
  }

  test('renders terminal content area with TerminalPane', () => {
    render(<TerminalZone {...defaultProps} />)

    const terminalContent = screen.getByTestId('terminal-content')

    expect(terminalContent).toBeInTheDocument()
    // Dark background matching design spec (#121221)
    expect(terminalContent).toHaveClass('bg-surface')
    expect(screen.getAllByTestId('split-view')).toHaveLength(2)
    // Should have TerminalPanes (mocked) - one for each session
    expect(screen.getAllByTestId('terminal-pane-mock')).toHaveLength(2)
  })

  test('renders flex-1 for terminal content to fill available space', () => {
    render(<TerminalZone {...defaultProps} />)

    const terminalContent = screen.getByTestId('terminal-content')

    expect(terminalContent).toHaveClass('flex-1')
  })

  test('component has flex column layout', () => {
    render(<TerminalZone {...defaultProps} />)

    const rootElement = screen.getByTestId('terminal-zone')

    expect(rootElement).toHaveClass('flex')
    expect(rootElement).toHaveClass('flex-col')
    expect(rootElement).toHaveClass('flex-1')
    expect(rootElement).toHaveClass('min-h-0')
  })

  // TerminalPane integration tests (Feature #30)
  test('renders TerminalPane when active session exists', () => {
    render(<TerminalZone {...defaultProps} />)

    // TerminalPane wrappers should be rendered for all sessions
    const terminalPanes = screen.getAllByTestId('terminal-pane')
    expect(terminalPanes).toHaveLength(2)

    // Mocked TerminalPane components should be present
    expect(screen.getAllByTestId('terminal-pane-mock')).toHaveLength(2)
  })

  test('passes active session id to TerminalPane', () => {
    render(<TerminalZone {...defaultProps} />)

    const terminalPanes = screen.getAllByTestId('terminal-pane')

    // Find the active session's pane
    const activePane = terminalPanes.find(
      (pane) => pane.getAttribute('data-session-id') === 'sess-1'
    )

    expect(activePane).toBeInTheDocument()
    expect(activePane).toHaveAttribute('data-session-id', 'sess-1')

    // Mocked component should also have the correct sessionId
    const mockPanes = screen.getAllByTestId('terminal-pane-mock')

    const activeMockPane = mockPanes.find(
      (pane) => pane.getAttribute('data-session-id') === 'sess-1'
    )
    expect(activeMockPane).toHaveAttribute('data-session-id', 'sess-1')
  })

  test('passes active session working directory to TerminalPane', () => {
    render(<TerminalZone {...defaultProps} />)

    const slots = screen.getAllByTestId('split-view-slot')

    // Find the active session's pane slot
    const activeSlot = slots.find(
      (slot) => slot.getAttribute('data-pty-id') === 'sess-1'
    )

    expect(activeSlot).toHaveAttribute('data-cwd', '~')

    // Mocked component should also receive it
    const mockPanes = screen.getAllByTestId('terminal-pane-mock')

    const activeMockPane = mockPanes.find(
      (pane) => pane.getAttribute('data-session-id') === 'sess-1'
    )
    expect(activeMockPane).toHaveAttribute('data-cwd', '~')
  })

  test('passes the active pane to each TerminalPane', () => {
    render(<TerminalZone {...defaultProps} />)

    const slots = screen.getAllByTestId('split-view-slot')
    const mockPanes = screen.getAllByTestId('terminal-pane-mock')

    expect(slots[0]).toHaveAttribute('data-pane-id', 'p0')
    expect(slots[0]).toHaveAttribute('data-cwd', '~')
    expect(mockPanes[0]).toHaveAttribute('data-pane-id', 'p0')
    expect(mockPanes[0]).toHaveAttribute('data-pty-id', 'sess-1')
  })

  test('forwards cwd changes with session id and pane id', async () => {
    const user = userEvent.setup()
    const onSessionCwdChange = vi.fn()

    render(
      <TerminalZone {...defaultProps} onSessionCwdChange={onSessionCwdChange} />
    )

    await user.click(screen.getByTestId('mock-cwd-sess-1'))

    expect(onSessionCwdChange).toHaveBeenCalledWith('sess-1', 'p0', '/changed')
  })

  test('forwards deferred terminal fit state to TerminalPane', () => {
    render(<TerminalZone {...defaultProps} deferTerminalFit />)

    const mockPanes = screen.getAllByTestId('terminal-pane-mock')

    mockPanes.forEach((pane) => {
      expect(pane).toHaveAttribute('data-defer-fit', 'true')
    })
  })

  test('passes session.agentType through to each TerminalPane', () => {
    // Bridge in WorkspaceView writes detection results into
    // Session.agentType; TerminalZone forwards the session as-is.
    // No more activeAgentType override path.
    const sessionsWithAgents = defaultProps.sessions.map((session, idx) => ({
      ...session,
      agentType: idx === 0 ? ('codex' as const) : ('generic' as const),
    }))
    render(<TerminalZone {...defaultProps} sessions={sessionsWithAgents} />)

    const mockPanes = screen.getAllByTestId('terminal-pane-mock')

    const activeMockPane = mockPanes.find(
      (pane) => pane.getAttribute('data-session-id') === 'sess-1'
    )

    const inactiveMockPane = mockPanes.find(
      (pane) => pane.getAttribute('data-session-id') === 'sess-2'
    )

    expect(activeMockPane).toHaveAttribute('data-session-agent-type', 'codex')
    expect(inactiveMockPane).toHaveAttribute(
      'data-session-agent-type',
      'generic'
    )
  })

  test('does not render TerminalPane when no sessions exist', () => {
    render(
      <TerminalZone {...defaultProps} sessions={[]} activeSessionId={null} />
    )

    // TerminalPane should not be rendered when there are no sessions
    expect(screen.queryByTestId('terminal-pane')).not.toBeInTheDocument()
    expect(screen.queryByTestId('terminal-pane-mock')).not.toBeInTheDocument()

    // Should show placeholder instead
    expect(
      screen.getByText(/no active session.*click \+ in the session tab bar/i)
    ).toBeInTheDocument()
  })

  test('updates TerminalPane when active session changes', () => {
    const { rerender } = render(<TerminalZone {...defaultProps} />)

    // Both sessions are rendered, but only sess-1 is visible initially
    let terminalPanes = screen.getAllByTestId('terminal-pane')
    expect(terminalPanes).toHaveLength(2)

    const session1Pane = terminalPanes.find(
      (pane) => pane.getAttribute('data-session-id') === 'sess-1'
    )

    const session2Pane = terminalPanes.find(
      (pane) => pane.getAttribute('data-session-id') === 'sess-2'
    )

    expect(session1Pane).toHaveAttribute('data-session-id', 'sess-1')
    expect(session2Pane).toHaveAttribute('data-session-id', 'sess-2')

    // Change to second session
    rerender(<TerminalZone {...defaultProps} activeSessionId="sess-2" />)

    // Both should still be rendered
    terminalPanes = screen.getAllByTestId('terminal-pane')
    expect(terminalPanes).toHaveLength(2)

    // Verify session 2 pane has correct attributes
    const updatedSession2Pane = terminalPanes.find(
      (pane) => pane.getAttribute('data-session-id') === 'sess-2'
    )
    expect(updatedSession2Pane).toHaveAttribute('data-session-id', 'sess-2')

    const updatedSlots = screen.getAllByTestId('split-view-slot')

    const updatedSession2Slot = updatedSlots.find(
      (slot) => slot.getAttribute('data-pty-id') === 'sess-2'
    )
    expect(updatedSession2Slot).toHaveAttribute('data-cwd', '~')
  })

  // P2 Codex Finding: Keep terminal sessions alive when switching tabs
  test('keeps all terminal sessions mounted when switching tabs', () => {
    const { rerender } = render(<TerminalZone {...defaultProps} />)

    // Both sessions should have TerminalPanes rendered
    const terminalPanes = screen.getAllByTestId('terminal-pane')
    expect(terminalPanes).toHaveLength(2)

    // First session should be visible (active)
    const session1Pane = terminalPanes.find(
      (pane) => pane.getAttribute('data-session-id') === 'sess-1'
    )

    const session2Pane = terminalPanes.find(
      (pane) => pane.getAttribute('data-session-id') === 'sess-2'
    )

    expect(session1Pane).toBeInTheDocument()
    expect(session2Pane).toBeInTheDocument()

    // Active session should be visible, inactive should be hidden
    expect(session1Pane).not.toHaveClass('hidden')
    expect(session2Pane).toHaveClass('hidden')

    // Switch to second session
    rerender(<TerminalZone {...defaultProps} activeSessionId="sess-2" />)

    // Both TerminalPanes should still be mounted (not unmounted)
    const updatedPanes = screen.getAllByTestId('terminal-pane')
    expect(updatedPanes).toHaveLength(2)

    // Visibility should swap
    const updatedSession1Pane = updatedPanes.find(
      (pane) => pane.getAttribute('data-session-id') === 'sess-1'
    )

    const updatedSession2Pane = updatedPanes.find(
      (pane) => pane.getAttribute('data-session-id') === 'sess-2'
    )

    expect(updatedSession1Pane).toHaveClass('hidden')
    expect(updatedSession2Pane).not.toHaveClass('hidden')
  })

  // Feature #14: Restore protocol tests
  test('shows loading state when loading=true', () => {
    render(<TerminalZone {...defaultProps} loading />)

    expect(screen.getByText(/restoring sessions/i)).toBeInTheDocument()
    expect(screen.queryByTestId('split-view')).not.toBeInTheDocument()
    expect(screen.queryByTestId('terminal-pane-mock')).not.toBeInTheDocument()
  })

  test('vsplit session renders both panes via SplitView', () => {
    const session: Session = {
      ...mockSessions[0],
      id: 'sess-vsplit',
      name: 'multi-pane',
      workingDirectory: '/tmp/a',
      agentType: 'generic',
      layout: 'vsplit',
      panes: [
        {
          id: 'p0',
          ptyId: 'pty-a',
          cwd: '/tmp/a',
          agentType: 'generic',
          status: 'running',
          active: true,
          pid: 1001,
          restoreData: {
            sessionId: 'pty-a',
            cwd: '/tmp/a',
            pid: 1001,
            replayData: '',
            replayEndOffset: 0,
            bufferedEvents: [],
          },
        },
        {
          id: 'p1',
          ptyId: 'pty-b',
          cwd: '/tmp/b',
          agentType: 'generic',
          status: 'running',
          active: false,
          pid: 1002,
          restoreData: {
            sessionId: 'pty-b',
            cwd: '/tmp/b',
            pid: 1002,
            replayData: '',
            replayEndOffset: 0,
            bufferedEvents: [],
          },
        },
      ],
    }

    render(
      <TerminalZone
        sessions={[session]}
        activeSessionId="sess-vsplit"
        service={mockService}
      />
    )

    const slots = screen.getAllByTestId('split-view-slot')

    expect(slots).toHaveLength(2)
    expect(slots[0]).toHaveAttribute('data-pane-id', 'p0')
    expect(slots[0]).toHaveAttribute('data-pty-id', 'pty-a')
    expect(slots[1]).toHaveAttribute('data-pane-id', 'p1')
    expect(slots[1]).toHaveAttribute('data-pty-id', 'pty-b')
  })

  test('passes pane.restoreData to TerminalPane for each session', () => {
    const sessions = defaultProps.sessions.map((session) =>
      session.id === 'sess-1'
        ? {
            ...session,
            panes: [
              {
                ...session.panes[0],
                restoreData: {
                  sessionId: 'sess-1',
                  cwd: '/tmp',
                  pid: 123,
                  replayData: 'AAA',
                  replayEndOffset: 3,
                  bufferedEvents: [],
                },
              },
            ],
          }
        : session
    )

    render(<TerminalZone {...defaultProps} sessions={sessions} />)

    const mockPanes = screen.getAllByTestId('terminal-pane-mock')

    const restoredPane = mockPanes.find(
      (pane) => pane.getAttribute('data-session-id') === 'sess-1'
    )

    const normalPane = mockPanes.find(
      (pane) => pane.getAttribute('data-session-id') === 'sess-2'
    )

    expect(restoredPane).toHaveAttribute('data-restored', 'true')
    expect(normalPane).toHaveAttribute('data-restored', 'false')
  })

  test('does not pass restoreData when not provided', () => {
    render(<TerminalZone {...defaultProps} />)

    const mockPanes = screen.getAllByTestId('terminal-pane-mock')

    mockPanes.forEach((pane) => {
      expect(pane).toHaveAttribute('data-restored', 'false')
    })
  })

  // F3 regression: Exited (status='completed') sessions must NOT trigger
  // a spawn — they go to awaiting-restart so the user explicitly opts in.
  // Previously TerminalPane inferred from `restoredFrom===undefined` and
  // resurrected dead sessions on the next reload.
  test('F3 regression: Exited session renders in awaiting-restart mode', () => {
    const aliveAndExited = [
      // Use the mockSessions shape from the test file but override status
      {
        ...mockSessions[0],
        id: 'alive',
        status: 'running' as const,
        panes: [
          {
            ...mockSessions[0].panes[0],
            ptyId: 'alive',
            status: 'running' as const,
            restoreData: {
              sessionId: 'alive',
              cwd: '/tmp',
              pid: 1,
              replayData: '',
              replayEndOffset: 0,
              bufferedEvents: [],
            },
          },
        ],
      },
      {
        ...mockSessions[0],
        id: 'exited',
        status: 'completed' as const,
        panes: [
          {
            ...mockSessions[0].panes[0],
            ptyId: 'exited',
            status: 'completed' as const,
          },
        ],
      },
    ]

    render(
      <TerminalZone
        {...defaultProps}
        sessions={aliveAndExited}
        activeSessionId="alive"
      />
    )

    const mockPanes = screen.getAllByTestId('terminal-pane-mock')

    const alivePane = mockPanes.find(
      (p) => p.getAttribute('data-session-id') === 'alive'
    )

    const exitedPane = mockPanes.find(
      (p) => p.getAttribute('data-session-id') === 'exited'
    )

    expect(alivePane).toHaveAttribute('data-mode', 'attach')
    // Exited session must NOT be in spawn or attach mode — would resurrect
    // the PTY. Awaiting-restart waits for explicit user opt-in.
    expect(exitedPane).toHaveAttribute('data-mode', 'awaiting-restart')
  })

  // Round 3 Finding 3 (codex P2): mode resolution must put status BEFORE
  // restoreData. Round-2 F1 made restoreData get seeded for every session
  // (so per-session buffering works for newly-created tabs) and nothing
  // clears it when the PTY later exits. With the old `restore ?
  // 'attach' : ...` precedence, a session that exits AFTER mount stayed
  // in 'attach' mode forever — the Restart button was unreachable until
  // a full reload rebuilt state from listSessions().
  test('F-r3-3: completed status takes precedence over lingering restoreData', () => {
    const exitedAfterMount = [
      // Simulates the "live exit" case: status flipped to completed (e.g.
      // from a pty-exit event) while restoreData still has the entry that
      // was seeded at mount time and is now stale.
      {
        ...mockSessions[0],
        id: 'just-exited',
        status: 'completed' as const,
        panes: [
          {
            ...mockSessions[0].panes[0],
            ptyId: 'just-exited',
            status: 'completed' as const,
            restoreData: {
              sessionId: 'just-exited',
              cwd: '/tmp',
              pid: 1,
              replayData: '',
              replayEndOffset: 0,
              bufferedEvents: [],
            },
          },
        ],
      },
    ]

    render(
      <TerminalZone
        {...defaultProps}
        sessions={exitedAfterMount}
        activeSessionId="just-exited"
      />
    )

    const pane = screen.getAllByTestId('terminal-pane-mock')[0]
    // Status wins — the user can reach the Restart UX without a reload.
    expect(pane).toHaveAttribute('data-mode', 'awaiting-restart')
  })

  // F5 (round 2): the Restart click on an Exited (awaiting-restart) pane
  // must propagate through TerminalZone → TerminalPane.onRestart with the
  // session id. Previously WorkspaceView never passed onSessionRestart, so
  // the Restart button was a silent no-op.
  test('F5 (round 2): forwards onSessionRestart to TerminalPane onRestart', async () => {
    const user = userEvent.setup()
    const onSessionRestart = vi.fn()

    render(
      <TerminalZone {...defaultProps} onSessionRestart={onSessionRestart} />
    )

    const button = screen.getByTestId('mock-restart-sess-1')
    await user.click(button)

    expect(onSessionRestart).toHaveBeenCalledWith('sess-1')
    expect(onSessionRestart).toHaveBeenCalledTimes(1)
  })

  test('F3: alive session with restoreData renders in attach mode (no spawn)', () => {
    const sessions = defaultProps.sessions.map((session, index) => ({
      ...session,
      panes: [
        {
          ...session.panes[0],
          restoreData: {
            sessionId: session.id,
            cwd: '/tmp',
            pid: index + 1,
            replayData: '',
            replayEndOffset: 0,
            bufferedEvents: [],
          },
        },
      ],
    }))

    render(<TerminalZone {...defaultProps} sessions={sessions} />)

    const mockPanes = screen.getAllByTestId('terminal-pane-mock')

    expect(mockPanes).toHaveLength(2)
    mockPanes.forEach((pane) => {
      expect(pane).toHaveAttribute('data-mode', 'attach')
    })
  })
})
