// cspell:ignore vsplit hsplit
import { render, screen, within } from '@testing-library/react'
import { describe, test, expect, vi } from 'vitest'
import type { UseGitBranchReturn } from '../../../diff/hooks/useGitBranch'
import type { UseGitStatusReturn } from '../../../diff/hooks/useGitStatus'
import type { BodyHandle, BodyProps } from '../TerminalPane/Body'
import { SplitView, selectVisiblePanes } from './SplitView'
import type { LayoutId, Pane, Session } from '../../../sessions/types'
import type { ITerminalService } from '../../services/terminalService'

vi.mock('../TerminalPane/Body', async () => {
  const React = await import('react')

  const Body = React.forwardRef<BodyHandle, BodyProps>(
    function MockBody(props, ref): React.ReactElement {
      React.useImperativeHandle(ref, () => ({
        focusTerminal: (): void => undefined,
      }))

      return React.createElement('div', {
        'data-testid': 'body-mock',
        'data-defer-fit': props.deferFit ? 'true' : 'false',
      })
    }
  )

  return {
    Body,
    terminalCache: new Map<string, unknown>(),
    clearTerminalCache: (): void => undefined,
    disposeTerminalSession: (): void => undefined,
  }
})

vi.mock('../../../diff/hooks/useGitBranch', () => ({
  useGitBranch: (): UseGitBranchReturn => ({
    branch: 'main',
    loading: false,
    error: null,
    refresh: vi.fn(),
    idle: false,
  }),
}))

vi.mock('../../../diff/hooks/useGitStatus', () => ({
  useGitStatus: (): UseGitStatusReturn => ({
    files: [],
    filesCwd: '/tmp/fixture',
    loading: false,
    error: null,
    refresh: vi.fn(),
    idle: false,
  }),
}))

const makeSession = (
  layout: LayoutId,
  paneCount: number,
  activeIndex = 0
): Session => ({
  id: 'sess-fix',
  projectId: 'proj-fix',
  name: 'fixture session',
  status: 'running',
  workingDirectory: '/tmp/fixture',
  agentType: 'generic',
  layout,
  panes: Array.from(
    { length: paneCount },
    (_, i): Pane => ({
      id: `p${i}`,
      ptyId: `pty-${i}`,
      cwd: '/tmp/fixture',
      agentType: 'generic',
      status: 'running',
      active: i === activeIndex,
      pid: 1000 + i,
      restoreData: {
        sessionId: `pty-${i}`,
        cwd: '/tmp/fixture',
        pid: 1000 + i,
        replayData: '',
        replayEndOffset: 0,
        bufferedEvents: [],
      },
    })
  ),
  createdAt: '2026-05-11T00:00:00Z',
  lastActivityAt: '2026-05-11T00:00:00Z',
  activity: {
    fileChanges: [],
    toolCalls: [],
    testResults: [],
    contextWindow: { used: 0, total: 200_000, percentage: 0, emoji: '😊' },
    usage: {
      sessionDuration: 0,
      turnCount: 0,
      messages: { sent: 0, limit: 200 },
      tokens: { input: 0, output: 0, total: 0 },
    },
  },
})

const makeMockService = (): ITerminalService => ({
  spawn: vi.fn(() =>
    Promise.resolve({ sessionId: 'mock', pid: 0, cwd: '/tmp' })
  ),
  write: vi.fn(() => Promise.resolve(undefined)),
  resize: vi.fn(() => Promise.resolve(undefined)),
  kill: vi.fn(() => Promise.resolve(undefined)),
  onData: vi.fn(() => Promise.resolve((): void => undefined)),
  onExit: vi.fn((): (() => void) => (): void => undefined),
  onError: vi.fn((): (() => void) => (): void => undefined),
  listSessions: vi.fn(() =>
    Promise.resolve({ sessions: [], activeSessionId: null })
  ),
  setActiveSession: vi.fn(() => Promise.resolve(undefined)),
  reorderSessions: vi.fn(() => Promise.resolve(undefined)),
  updateSessionCwd: vi.fn(() => Promise.resolve(undefined)),
})

describe('SplitView - single layout', () => {
  test('renders one slot with data attrs from the lone pane', () => {
    render(
      <SplitView
        session={makeSession('single', 1)}
        service={makeMockService()}
        isActive
      />
    )

    const slots = screen.getAllByTestId('split-view-slot')

    expect(slots).toHaveLength(1)
    expect(slots[0]).toHaveAttribute('data-pane-id', 'p0')
    expect(slots[0]).toHaveAttribute('data-pty-id', 'pty-0')
    expect(slots[0]).toHaveAttribute('data-cwd', '/tmp/fixture')
    expect(slots[0]).toHaveAttribute('data-mode', 'attach')
  })

  test('outer container carries layout and session data attrs', () => {
    render(
      <SplitView
        session={makeSession('single', 1)}
        service={makeMockService()}
        isActive
      />
    )

    const container = screen.getByTestId('split-view')

    expect(container).toHaveAttribute('data-layout', 'single')
    expect(container).toHaveAttribute('data-session-id', 'sess-fix')
  })

  test('completed pane status takes precedence over restore data', () => {
    const session = makeSession('single', 1)

    render(
      <SplitView
        session={{
          ...session,
          panes: [{ ...session.panes[0], status: 'completed' }],
        }}
        service={makeMockService()}
        isActive
      />
    )

    expect(screen.getByTestId('split-view-slot')).toHaveAttribute(
      'data-mode',
      'awaiting-restart'
    )
  })
})

describe('SplitView - multi-pane layouts', () => {
  test('vsplit renders 2 slots with the vsplit grid template', () => {
    render(
      <SplitView
        session={makeSession('vsplit', 2)}
        service={makeMockService()}
        isActive
      />
    )

    const slots = screen.getAllByTestId('split-view-slot')

    expect(slots).toHaveLength(2)
    expect(slots.map((slot) => slot.getAttribute('data-pane-id'))).toEqual([
      'p0',
      'p1',
    ])

    expect(screen.getByTestId('split-view')).toHaveStyle({
      gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)',
      gridTemplateRows: 'minmax(0,1fr)',
      gridTemplateAreas: '"p0 p1"',
    })
  })

  test('hsplit renders 2 slots stacked vertically', () => {
    render(
      <SplitView
        session={makeSession('hsplit', 2)}
        service={makeMockService()}
        isActive
      />
    )

    expect(screen.getByTestId('split-view')).toHaveStyle({
      gridTemplateAreas: '"p0" "p1"',
    })
    expect(screen.getAllByTestId('split-view-slot')).toHaveLength(2)
  })

  test('threeRight renders 3 slots with the main plus 2-stack template', () => {
    render(
      <SplitView
        session={makeSession('threeRight', 3)}
        service={makeMockService()}
        isActive
      />
    )

    expect(screen.getByTestId('split-view')).toHaveStyle({
      gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)',
      gridTemplateRows: 'minmax(0,1fr) minmax(0,1fr)',
      gridTemplateAreas: '"p0 p1" "p0 p2"',
    })
    expect(screen.getAllByTestId('split-view-slot')).toHaveLength(3)
  })

  test('quad renders 4 slots', () => {
    render(
      <SplitView
        session={makeSession('quad', 4)}
        service={makeMockService()}
        isActive
      />
    )

    expect(screen.getByTestId('split-view')).toHaveStyle({
      gridTemplateAreas: '"p0 p1" "p2 p3"',
    })
    expect(screen.getAllByTestId('split-view-slot')).toHaveLength(4)
  })

  test('each slot gets gridArea by index regardless of pane.id naming', () => {
    const session = makeSession('quad', 4)

    render(
      <SplitView
        session={{
          ...session,
          panes: session.panes.map((pane, i) => ({
            ...pane,
            id: `oddName-${i}`,
          })),
        }}
        service={makeMockService()}
        isActive
      />
    )

    const slots = screen.getAllByTestId('split-view-slot')

    expect(slots[0]).toHaveStyle({ gridArea: 'p0' })
    expect(slots[3]).toHaveStyle({ gridArea: 'p3' })
  })

  test('focus marker follows pane.active and inactive panes are dimmed', () => {
    render(
      <SplitView
        session={makeSession('vsplit', 2, 1)}
        service={makeMockService()}
        isActive
      />
    )

    const slots = screen.getAllByTestId('split-view-slot')

    const inactiveWrapper = within(slots[0]).getByTestId(
      'terminal-pane-wrapper'
    )
    const activeWrapper = within(slots[1]).getByTestId('terminal-pane-wrapper')

    expect(inactiveWrapper).not.toHaveAttribute('data-focused')
    expect(inactiveWrapper).toHaveStyle({ opacity: '0.78' })
    expect(activeWrapper).toHaveAttribute('data-focused', 'true')
    expect(activeWrapper).toHaveStyle({ opacity: '1' })
  })
})

describe('SplitView - under-capacity', () => {
  test('quad layout with 2 panes renders 2 slots', () => {
    render(
      <SplitView
        session={makeSession('quad', 2)}
        service={makeMockService()}
        isActive
      />
    )

    const slots = screen.getAllByTestId('split-view-slot')

    expect(slots).toHaveLength(2)
    expect(slots.map((slot) => slot.getAttribute('data-pane-id'))).toEqual([
      'p0',
      'p1',
    ])

    expect(screen.getByTestId('split-view')).toHaveAttribute(
      'data-layout',
      'quad'
    )

    expect(screen.getByTestId('split-view')).toHaveStyle({
      gridTemplateAreas: '"p0 p1" "p2 p3"',
    })
  })

  test('threeRight layout with 1 pane renders 1 slot', () => {
    render(
      <SplitView
        session={makeSession('threeRight', 1)}
        service={makeMockService()}
        isActive
      />
    )

    expect(screen.getAllByTestId('split-view-slot')).toHaveLength(1)
  })
})

describe('SplitView - over-capacity invariant', () => {
  test('throws in DEV when panes.length exceeds layout capacity', () => {
    const session = makeSession('single', 2)

    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    try {
      expect(() =>
        render(
          <SplitView session={session} service={makeMockService()} isActive />
        )
      ).toThrow(/SplitView invariant violation/)
    } finally {
      consoleSpy.mockRestore()
    }
  })
})

describe('SplitView - no PTY lifecycle IPC', () => {
  test('quad render does not invoke service.spawn or service.kill', () => {
    const service = makeMockService()

    render(
      <SplitView session={makeSession('quad', 4)} service={service} isActive />
    )

    expect(service.spawn).not.toHaveBeenCalled()
    expect(service.kill).not.toHaveBeenCalled()
  })

  test('single-pane render does not invoke spawn', () => {
    const service = makeMockService()

    render(
      <SplitView
        session={makeSession('single', 1)}
        service={service}
        isActive
      />
    )

    expect(service.spawn).not.toHaveBeenCalled()
  })
})

describe('selectVisiblePanes', () => {
  const makePane = (id: string, active = false): Pane => ({
    id,
    ptyId: `pty-${id}`,
    cwd: '/tmp/fixture',
    agentType: 'generic',
    status: 'running',
    active,
    pid: 1,
  })

  test('returns the prefix slice when panes.length <= capacity', () => {
    const panes = [makePane('p0', true), makePane('p1')]
    expect(selectVisiblePanes(panes, 4)).toEqual(panes)
  })

  test('returns the prefix slice when active pane is already inside it', () => {
    const panes = [
      makePane('p0', true),
      makePane('p1'),
      makePane('p2'),
      makePane('p3'),
      makePane('p4'),
    ]
    // capacity=2 → first 2 panes; active (idx 0) is already inside.
    expect(selectVisiblePanes(panes, 2)).toEqual([panes[0], panes[1]])
  })

  test('replaces the LAST visible slot with the active pane when it is beyond capacity', () => {
    // panes.length (5) > capacity (3); active at idx 4 would be sliced off
    // by a naive prefix slice. selectVisiblePanes must keep the active
    // pane reachable.
    const panes = [
      makePane('p0'),
      makePane('p1'),
      makePane('p2'),
      makePane('p3'),
      makePane('p4', true),
    ]
    const visible = selectVisiblePanes(panes, 3)
    expect(visible).toHaveLength(3)
    expect(visible[0]).toBe(panes[0])
    expect(visible[1]).toBe(panes[1])
    // panes[2] (the original capacity-1 slot) is replaced by the active
    // pane at idx 4.
    expect(visible[2]).toBe(panes[4])
    // The displaced panes[2] and pane[3] are NOT in the visible set —
    // they are the cost of preserving active visibility.
    expect(visible).not.toContain(panes[2])
    expect(visible).not.toContain(panes[3])
  })

  test('preserves the active pane when active is exactly at capacity (idx === capacity)', () => {
    const panes = [makePane('p0'), makePane('p1'), makePane('p2', true)]
    const visible = selectVisiblePanes(panes, 2)
    expect(visible).toHaveLength(2)
    expect(visible[0]).toBe(panes[0])
    expect(visible[1]).toBe(panes[2])
  })

  test('falls back to the prefix slice when no pane is active (invariant violation)', () => {
    // Defensive: the 5a invariant says exactly-one-active per session;
    // if every pane has active=false (a write-site bug), the helper
    // returns the prefix slice rather than throwing.
    const panes = [
      makePane('p0'),
      makePane('p1'),
      makePane('p2'),
      makePane('p3'),
      makePane('p4'),
    ]
    const visible = selectVisiblePanes(panes, 2)
    expect(visible).toEqual([panes[0], panes[1]])
  })

  // Note: capacity=0 isn't a real input — `LayoutShape.capacity` is typed
  // `1 | 2 | 3 | 4` — so no test for it. The helper's behavior in that
  // degenerate case isn't load-bearing.
})

describe('SplitView - over-capacity production render', () => {
  test('rescued active pane lands in the last grid slot (gridArea: p${capacity-1})', () => {
    // `vi.stubEnv('DEV', false)` swaps `import.meta.env.DEV` at runtime so
    // the DEV throw path is disabled and the production fallback
    // (selectVisiblePanes) is exercised end-to-end through the render
    // chain. This verifies the rescued active pane is mapped to
    // `gridArea: 'p${capacity-1}'` — a chain that selectVisiblePanes'
    // pure unit tests do not exercise.
    vi.stubEnv('DEV', false)

    try {
      const session = makeSession('vsplit', 3, 2)
      // 3 panes, vsplit capacity = 2, active at index 2 → must land at p1.

      render(
        <SplitView session={session} service={makeMockService()} isActive />
      )

      const slots = screen.getAllByTestId('split-view-slot')

      expect(slots).toHaveLength(2)
      // Slot 0 keeps the first pane in original order.
      expect(slots[0]).toHaveAttribute('data-pane-id', 'p0')
      expect(slots[0]).toHaveStyle({ gridArea: 'p0' })
      // Slot 1 (the LAST visible slot) gets the rescued active pane,
      // not panes[1] (which would be the naive prefix slice).
      expect(slots[1]).toHaveAttribute('data-pane-id', 'p2')
      expect(slots[1]).toHaveStyle({ gridArea: 'p1' })
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
