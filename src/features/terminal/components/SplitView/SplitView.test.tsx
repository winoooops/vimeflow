// cspell:ignore vsplit hsplit vdiv hdiv
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { UseGitBranchReturn } from '../../../diff/hooks/useGitBranch'
import type { UseGitStatusReturn } from '../../../diff/hooks/useGitStatus'
import type { BodyHandle, BodyProps } from '../TerminalPane/Body'
import {
  SplitView,
  canClosePane,
  getSlotOrderedPaneIds,
  type SplitViewHandle,
} from './SplitView'
import type { LayoutId, Pane, Session } from '../../../sessions/types'
import type { ITerminalService } from '../../services/terminalService'
import { LAYOUTS } from '../../layout-registry'
import { resolvePanePlacement } from '../../../sessions/utils/panePlacements'

class MockResizeObserver {
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
}

vi.stubGlobal('ResizeObserver', MockResizeObserver)

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 1200,
    height: 800,
    top: 0,
    left: 0,
    right: 1200,
    bottom: 800,
    x: 0,
    y: 0,
    toJSON: (): undefined => undefined,
  } as DOMRect)
})

afterEach(() => {
  vi.restoreAllMocks()
})

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

// BrowserPane pulls in the native-surface overlay stack (OverlayStackProvider)
// and Electron browser bridge — neither is mounted in this harness. Stub it
// with a minimal element so the drag-into-slot accepts test can render a
// browser-kind pane. focusBrowserPane stays a no-op fn for the focus handle.
vi.mock('../../../browser', async () => {
  const React = await import('react')

  return {
    BrowserPane: ({
      shortcutHint = undefined,
    }: {
      shortcutHint?: string
    }): React.ReactElement =>
      React.createElement(
        'div',
        { 'data-testid': 'browser-pane-mock' },
        shortcutHint
          ? React.createElement(
              'span',
              { 'data-testid': 'pane-shortcut-hint' },
              shortcutHint
            )
          : null
      ),
    focusBrowserPane: vi.fn(() => Promise.resolve(undefined)),
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
  activityPanelCollapsed: false,
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
    Promise.resolve({
      sessionId: 'mock',
      pid: 0,
      cwd: '/tmp',
      shell: '/bin/zsh',
    })
  ),
  write: vi.fn(() => Promise.resolve(undefined)),
  resize: vi.fn(() => Promise.resolve(undefined)),
  kill: vi.fn(() => Promise.resolve(undefined)),
  onData: vi.fn(() => Promise.resolve((): void => undefined)),
  onExit: vi.fn(() => Promise.resolve((): void => undefined)),
  onError: vi.fn(() => Promise.resolve((): void => undefined)),
  onBurnerForeground: vi.fn(() => Promise.resolve((): void => undefined)),
  listSessions: vi.fn(() =>
    Promise.resolve({ sessions: [], activeSessionId: null })
  ),
  setActiveSession: vi.fn(() => Promise.resolve(undefined)),
  reorderSessions: vi.fn(() => Promise.resolve(undefined)),
  updateSessionCwd: vi.fn(() => Promise.resolve(undefined)),
  setSessionActivityPanelCollapsed: vi.fn(() => Promise.resolve(undefined)),
  killEphemeralPtys: vi.fn(),
  setWorkspaceSessions: vi.fn(() => Promise.resolve(undefined)),
})

// Literal `isActive={false}` is stripped by the project's jsx-boolean-value
// autofix, which then breaks the required prop; a variable dodges the rule.
const inactive = false

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
      gridTemplateAreas: '"p0 vdiv-c0 p1"',
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
      gridTemplateAreas: '"p0" "hdiv-r0" "p1"',
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
      gridTemplateAreas:
        '"p0 vdiv-c0 p1" "p0 vdiv-c0 hdiv-r0-c1" "p0 vdiv-c0 p2"',
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
      gridTemplateAreas:
        '"p0 vdiv-c0-r0 p1" "hdiv-r0 hdiv-r0 hdiv-r0" "p2 vdiv-c0-r1 p3"',
    })
    expect(screen.getAllByTestId('split-view-slot')).toHaveLength(4)
  })

  test('single layout renders no dividers', () => {
    render(
      <SplitView
        session={makeSession('single', 1)}
        service={makeMockService()}
        isActive
      />
    )
    expect(screen.queryAllByTestId('split-resize-handle')).toHaveLength(0)
  })

  test('active vsplit renders a divider; inactive does not', () => {
    const session = makeSession('vsplit', 2)

    const { rerender } = render(
      <SplitView session={session} service={makeMockService()} isActive />
    )
    expect(screen.getAllByTestId('split-resize-handle')).toHaveLength(1)

    rerender(
      <SplitView
        session={session}
        service={makeMockService()}
        isActive={inactive}
      />
    )
    expect(screen.queryAllByTestId('split-resize-handle')).toHaveLength(0)
  })

  test('remembers the split ratio across a layout cycle (D4)', () => {
    const valueNow = (): string | null =>
      screen.getByTestId('split-resize-handle').getAttribute('aria-valuenow')

    const { rerender } = render(
      <SplitView
        session={makeSession('vsplit', 2)}
        service={makeMockService()}
        isActive
      />
    )
    const pristine = valueNow()
    fireEvent.keyDown(screen.getByTestId('split-resize-handle'), {
      key: 'ArrowRight',
    })
    const resized = valueNow()
    expect(resized).not.toBe(pristine)

    rerender(
      <SplitView
        session={makeSession('single', 1)}
        service={makeMockService()}
        isActive
      />
    )

    rerender(
      <SplitView
        session={makeSession('vsplit', 2)}
        service={makeMockService()}
        isActive
      />
    )
    expect(valueNow()).toBe(resized)
  })

  test('remembers the split ratio across a tab switch (D2)', () => {
    const valueNow = (): string | null =>
      screen.getByTestId('split-resize-handle').getAttribute('aria-valuenow')

    const { rerender } = render(
      <SplitView
        session={makeSession('vsplit', 2)}
        service={makeMockService()}
        isActive
      />
    )
    fireEvent.keyDown(screen.getByTestId('split-resize-handle'), {
      key: 'ArrowRight',
    })
    const resized = valueNow()

    rerender(
      <SplitView
        session={makeSession('vsplit', 2)}
        service={makeMockService()}
        isActive={inactive}
      />
    )

    rerender(
      <SplitView
        session={makeSession('vsplit', 2)}
        service={makeMockService()}
        isActive
      />
    )
    expect(valueNow()).toBe(resized)
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

  test('explicit placements choose grid areas independently of pane order', () => {
    const session = {
      ...makeSession('quad', 2),
      placements: [
        { paneId: 'p0', slotId: 'slot:p3' },
        { paneId: 'p1', slotId: 'slot:p0' },
      ],
    } satisfies Session

    render(<SplitView session={session} service={makeMockService()} isActive />)

    const slots = screen.getAllByTestId('split-view-slot')

    expect(slots[0]).toHaveAttribute('data-pane-id', 'p0')
    expect(slots[0]).toHaveStyle({ gridArea: 'p3' })
    expect(slots[1]).toHaveAttribute('data-pane-id', 'p1')
    expect(slots[1]).toHaveStyle({ gridArea: 'p0' })
  })

  test('shortcut pane ids follow slot order when placements reorder panes', () => {
    const session = {
      ...makeSession('quad', 2),
      placements: [
        { paneId: 'p0', slotId: 'slot:p3' },
        { paneId: 'p1', slotId: 'slot:p0' },
      ],
    } satisfies Session

    const resolution = resolvePanePlacement(
      session.panes,
      LAYOUTS.quad,
      session.placements
    )

    expect(getSlotOrderedPaneIds(resolution.assignments, LAYOUTS.quad)).toEqual(
      ['p1', 'p0']
    )
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
      gridTemplateAreas:
        '"p0 vdiv-c0-r0 p1" "hdiv-r0 hdiv-r0 hdiv-r0" "p2 vdiv-c0-r1 p3"',
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

  test('vsplit with 1 pane renders one empty slot when add handler exists', () => {
    render(
      <SplitView
        session={makeSession('vsplit', 1)}
        service={makeMockService()}
        isActive
        onAddPane={vi.fn()}
      />
    )

    expect(screen.getAllByTestId('split-view-slot')).toHaveLength(1)
    expect(screen.getAllByTestId('split-view-empty-slot')).toHaveLength(1)
    expect(
      screen.getByRole('button', { name: 'add shell pane' })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: 'add browser pane' })
    ).toBeInTheDocument()
  })

  test('quad with 2 panes renders two empty slots when add handler exists', () => {
    render(
      <SplitView
        session={makeSession('quad', 2)}
        service={makeMockService()}
        isActive
        onAddPane={vi.fn()}
      />
    )

    const emptySlots = screen.getAllByTestId('split-view-empty-slot')

    expect(emptySlots).toHaveLength(2)
    expect(emptySlots[0]).toHaveAttribute('data-slot-index', '2')
    expect(emptySlots[1]).toHaveAttribute('data-slot-index', '3')
  })

  test('omitting onAddPane leaves empty tracks inert', () => {
    render(
      <SplitView
        session={makeSession('quad', 2)}
        service={makeMockService()}
        isActive
      />
    )

    expect(
      screen.queryByTestId('split-view-empty-slot')
    ).not.toBeInTheDocument()

    expect(
      screen.queryByRole('button', { name: 'add shell pane' })
    ).not.toBeInTheDocument()
  })

  test('clicking empty slot add button calls onAddPane with session id', async () => {
    const user = userEvent.setup()
    const onAddPane = vi.fn()

    render(
      <SplitView
        session={makeSession('vsplit', 1)}
        service={makeMockService()}
        isActive
        onAddPane={onAddPane}
      />
    )

    await user.click(screen.getByRole('button', { name: 'add shell pane' }))

    expect(onAddPane).toHaveBeenCalledOnce()
    expect(onAddPane).toHaveBeenCalledWith('sess-fix', 'shell', 'slot:p1')
  })
})

describe('SplitView - over-capacity layout render', () => {
  test('single layout keeps an active second pane visible without throwing', () => {
    const session = makeSession('single', 2, 1)

    render(<SplitView session={session} service={makeMockService()} isActive />)

    const slots = screen.getAllByTestId('split-view-slot')

    expect(slots).toHaveLength(1)
    expect(slots[0]).toHaveAttribute('data-pane-id', 'p1')
    expect(slots[0]).toHaveStyle({ gridArea: 'p0' })
    expect(
      screen.queryByTestId('split-view-empty-slot')
    ).not.toBeInTheDocument()
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

describe('SplitView - imperative focus handle', () => {
  test('focusActivePane returns true when active pane body is ready', () => {
    const ref = createRef<SplitViewHandle>()

    render(
      <SplitView
        ref={ref}
        session={makeSession('single', 1)}
        service={makeMockService()}
        isActive
      />
    )

    expect(ref.current).not.toBeNull()
    expect(ref.current!.focusActivePane()).toBe(true)
  })

  test('focusActivePane returns false when no active pane exists', () => {
    const ref = createRef<SplitViewHandle>()
    const session = makeSession('single', 1)

    render(
      <SplitView
        ref={ref}
        session={{
          ...session,
          panes: session.panes.map((pane) => ({ ...pane, active: false })),
        }}
        service={makeMockService()}
        isActive
      />
    )

    expect(ref.current).not.toBeNull()
    expect(ref.current!.focusActivePane()).toBe(false)
  })
})

describe('SplitView - click-to-focus', () => {
  test('clicking a slot calls onSetActivePane with session id and pane id', async () => {
    const user = userEvent.setup()
    const onSetActivePane = vi.fn()
    const session = makeSession('vsplit', 2)

    render(
      <SplitView
        session={session}
        service={makeMockService()}
        isActive
        onSetActivePane={onSetActivePane}
      />
    )

    await user.click(screen.getAllByTestId('split-view-slot')[1])

    expect(onSetActivePane).toHaveBeenCalledOnce()
    expect(onSetActivePane).toHaveBeenCalledWith(session.id, 'p1')
  })

  test('omitting onSetActivePane makes slot clicks a no-op', async () => {
    const user = userEvent.setup()

    render(
      <SplitView
        session={makeSession('vsplit', 2)}
        service={makeMockService()}
        isActive
      />
    )

    await user.click(screen.getAllByTestId('split-view-slot')[1])

    expect(screen.getAllByTestId('split-view-slot')).toHaveLength(2)
  })

  test('renders visible pane shortcut hints instead of focus tooltips', async () => {
    render(
      <SplitView
        session={makeSession('vsplit', 2)}
        service={makeMockService()}
        isActive
      />
    )

    expect(screen.getAllByTestId('pane-shortcut-hint')).toHaveLength(2)
    expect(screen.getAllByTestId('pane-shortcut-hint')[0]).toHaveTextContent(
      '1'
    )

    expect(screen.getAllByTestId('pane-shortcut-hint')[1]).toHaveTextContent(
      '2'
    )

    const user = userEvent.setup()
    const inners = screen.getAllByTestId('split-view-slot-inner')
    await user.hover(inners[1])

    await new Promise((resolve) => {
      setTimeout(resolve, 300)
    })

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  test('passes visible pane shortcut hints to browser panes', () => {
    const session = {
      ...makeSession('vsplit', 2),
      panes: [
        { ...makeSession('vsplit', 2).panes[0], active: false },
        {
          ...makeSession('vsplit', 2).panes[1],
          kind: 'browser',
          active: true,
          browserUrl: 'https://example.com/',
        },
      ],
    } satisfies Session

    render(<SplitView session={session} service={makeMockService()} isActive />)

    expect(screen.getByTestId('browser-pane-mock')).toBeInTheDocument()
    expect(screen.getAllByTestId('pane-shortcut-hint')[1]).toHaveTextContent(
      '2'
    )
  })

  test('hovering the active pane does not show a focus tooltip', async () => {
    const user = userEvent.setup()

    render(
      <SplitView
        session={makeSession('vsplit', 2)}
        service={makeMockService()}
        isActive
      />
    )

    const inners = screen.getAllByTestId('split-view-slot-inner')
    await user.hover(inners[0])

    // Wait past the Tooltip's 250 ms hover delay before asserting
    // absence. Without this wait the assertion runs before any
    // tooltip could appear and would still pass even if
    // `disabled={pane.active}` regressed — making the negative
    // assertion meaningless. See testing-gaps #50 for the heuristic.
    await new Promise((resolve) => {
      setTimeout(resolve, 300)
    })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})

describe('SplitView - close pane', () => {
  test('multi-pane sessions pass close through with session id and pane id', async () => {
    const user = userEvent.setup()
    const onClosePane = vi.fn()

    render(
      <SplitView
        session={makeSession('vsplit', 2)}
        service={makeMockService()}
        isActive
        onClosePane={onClosePane}
      />
    )

    await user.click(screen.getAllByRole('button', { name: 'close pane' })[1])

    expect(onClosePane).toHaveBeenCalledOnce()
    expect(onClosePane).toHaveBeenCalledWith('sess-fix', 'p1')
  })

  test('single-pane sessions do not render pane close controls', () => {
    render(
      <SplitView
        session={makeSession('single', 1)}
        service={makeMockService()}
        isActive
        onClosePane={vi.fn()}
      />
    )

    expect(
      screen.queryByRole('button', { name: 'close pane' })
    ).not.toBeInTheDocument()
  })
})

describe('canClosePane', () => {
  const shellPane = (id: string): Pane => ({
    id,
    ptyId: `pty-${id}`,
    cwd: '/tmp/fixture',
    agentType: 'generic',
    status: 'running',
    active: false,
    pid: 1,
  })

  const browserPane = (id: string): Pane => ({
    ...shellPane(id),
    kind: 'browser',
    ptyId: `browser:${id}`,
  })

  const sessionWith = (panes: Pane[]): Session => ({
    ...makeSession('single', 1),
    panes,
  })

  test('a sole shell pane cannot close so the session keeps a pane', () => {
    const session = sessionWith([shellPane('p0')])
    expect(canClosePane(session)).toBe(false)
  })

  test('a sole browser pane cannot close so the session keeps a pane', () => {
    const session = sessionWith([browserPane('p0')])
    expect(canClosePane(session)).toBe(false)
  })

  test('the last shell pane is closable when a browser pane remains', () => {
    const session = sessionWith([shellPane('p0'), browserPane('p1')])
    expect(canClosePane(session)).toBe(true)
  })

  test('a browser pane is closable when a shell pane remains', () => {
    const session = sessionWith([shellPane('p0'), browserPane('p1')])
    expect(canClosePane(session)).toBe(true)
  })

  test('either shell is closable when two shells remain', () => {
    const session = sessionWith([shellPane('p0'), shellPane('p1')])
    expect(canClosePane(session)).toBe(true)
    expect(canClosePane(session)).toBe(true)
  })
})

describe('SplitView - over-capacity rescued active render', () => {
  test('rescued active pane lands in the last grid slot (gridArea: p${capacity-1})', () => {
    const session = makeSession('vsplit', 3, 2)
    // 3 panes, vsplit capacity = 2, active at index 2 → must land at p1.

    render(<SplitView session={session} service={makeMockService()} isActive />)

    const slots = screen.getAllByTestId('split-view-slot')

    expect(slots).toHaveLength(2)
    // Slot 0 keeps the first pane in original order.
    expect(slots[0]).toHaveAttribute('data-pane-id', 'p0')
    expect(slots[0]).toHaveStyle({ gridArea: 'p0' })
    // Slot 1 (the LAST visible slot) gets the rescued active pane,
    // not panes[1] (which would be the naive prefix slice).
    expect(slots[1]).toHaveAttribute('data-pane-id', 'p2')
    expect(slots[1]).toHaveStyle({ gridArea: 'p1' })
  })
})
