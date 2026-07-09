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
  selectVisiblePanes,
  canClosePane,
  resolveLayoutRatios,
  getSlotOrderedPaneIds,
  type SplitViewHandle,
} from './SplitView'
import type {
  LayoutId,
  Pane,
  PaneKind,
  PanePlacement,
  Session,
} from '../../../sessions/types'
import type { ITerminalService } from '../../services/terminalService'
import {
  LAYOUTS,
  PaneLayoutRegistry,
  type PaneLayoutDefinition,
} from '../../layout-registry'
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

// Literal `isSessionVisible={false}` is stripped by the project's jsx-boolean-value
// autofix, which then breaks the required prop; a variable dodges the rule.
const inactive = false

describe('SplitView - single layout', () => {
  test('renders one slot with data attrs from the lone pane', () => {
    render(
      <SplitView
        session={makeSession('single', 1)}
        service={makeMockService()}
        isSessionVisible
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
        isSessionVisible
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
        isSessionVisible
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
        isSessionVisible
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
        isSessionVisible
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
        isSessionVisible
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
        isSessionVisible
      />
    )

    expect(screen.getByTestId('split-view')).toHaveStyle({
      gridTemplateAreas:
        '"p0 vdiv-c0-r0 p1" "hdiv-r0 hdiv-r0 hdiv-r0" "p2 vdiv-c0-r1 p3"',
    })
    expect(screen.getAllByTestId('split-view-slot')).toHaveLength(4)
  })

  test('grid3x2 renders 6 slots', () => {
    render(
      <SplitView
        session={makeSession('grid3x2', 6)}
        service={makeMockService()}
        isSessionVisible
      />
    )

    expect(screen.getByTestId('split-view')).toHaveStyle({
      gridTemplateAreas:
        '"p0 vdiv-c0-r0 p1 vdiv-c1-r0 p2" "hdiv-r0 hdiv-r0 hdiv-r0 hdiv-r0 hdiv-r0" "p3 vdiv-c0-r1 p4 vdiv-c1-r1 p5"',
    })
    expect(screen.getAllByTestId('split-view-slot')).toHaveLength(6)
    expect(screen.getAllByTestId('split-resize-handle')).toHaveLength(5)
  })

  test('single layout renders no dividers', () => {
    render(
      <SplitView
        session={makeSession('single', 1)}
        service={makeMockService()}
        isSessionVisible
      />
    )
    expect(screen.queryAllByTestId('split-resize-handle')).toHaveLength(0)
  })

  test('active vsplit renders a divider; inactive does not', () => {
    const session = makeSession('vsplit', 2)

    const { rerender } = render(
      <SplitView
        session={session}
        service={makeMockService()}
        isSessionVisible
      />
    )
    expect(screen.getAllByTestId('split-resize-handle')).toHaveLength(1)

    rerender(
      <SplitView
        session={session}
        service={makeMockService()}
        isSessionVisible={inactive}
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
        isSessionVisible
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
        isSessionVisible
      />
    )

    rerender(
      <SplitView
        session={makeSession('vsplit', 2)}
        service={makeMockService()}
        isSessionVisible
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
        isSessionVisible
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
        isSessionVisible={inactive}
      />
    )

    rerender(
      <SplitView
        session={makeSession('vsplit', 2)}
        service={makeMockService()}
        isSessionVisible
      />
    )
    expect(valueNow()).toBe(resized)
  })

  test('an untouched layout returns to its default ratios after another layout was resized', () => {
    const handleValues = (): string[] =>
      screen
        .getAllByTestId('split-resize-handle')
        .map((handle) => handle.getAttribute('aria-valuenow') ?? '')

    const view = render(
      <SplitView
        session={makeSession('grid3x2', 6)}
        service={makeMockService()}
        isSessionVisible
      />
    )
    const defaultGridValues = handleValues()
    view.unmount()

    const { rerender } = render(
      <SplitView
        session={makeSession('vsplit', 2)}
        service={makeMockService()}
        isSessionVisible
      />
    )

    fireEvent.keyDown(screen.getByTestId('split-resize-handle'), {
      key: 'ArrowRight',
    })

    rerender(
      <SplitView
        session={makeSession('grid3x2', 6)}
        service={makeMockService()}
        isSessionVisible
      />
    )

    expect(handleValues()).toEqual(defaultGridValues)
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
        isSessionVisible
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

    render(
      <SplitView
        session={session}
        service={makeMockService()}
        isSessionVisible
      />
    )

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
        isSessionVisible
      />
    )

    const slots = screen.getAllByTestId('split-view-slot')

    const inactiveWrapper = within(slots[0]).getByTestId(
      'terminal-pane-wrapper'
    )
    const activeWrapper = within(slots[1]).getByTestId('terminal-pane-wrapper')

    expect(inactiveWrapper).not.toHaveAttribute('data-focused')
    expect(inactiveWrapper).toHaveStyle({ opacity: '0.78' })
    expect(activeWrapper).not.toHaveAttribute('data-focused')
    expect(activeWrapper).toHaveStyle({ opacity: '1' })
  })

  test('inactive sessions expose no active shell slot', () => {
    render(
      <SplitView
        session={makeSession('vsplit', 2, 1)}
        service={makeMockService()}
        isSessionVisible={inactive}
      />
    )

    for (const slot of screen.getAllByTestId('split-view-slot')) {
      expect(slot).toHaveAttribute('data-pane-active', 'false')
    }
    for (const wrapper of screen.getAllByTestId('terminal-pane-wrapper')) {
      expect(wrapper).not.toHaveAttribute('data-pane-active')
    }
  })
})

describe('SplitView - under-capacity', () => {
  test('quad layout with 2 panes renders 2 slots', () => {
    render(
      <SplitView
        session={makeSession('quad', 2)}
        service={makeMockService()}
        isSessionVisible
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

  test('grid3x2 with 5 panes renders one empty slot when add handler exists', () => {
    render(
      <SplitView
        session={makeSession('grid3x2', 5)}
        service={makeMockService()}
        isSessionVisible
        onAddPane={vi.fn()}
      />
    )

    const emptySlots = screen.getAllByTestId('split-view-empty-slot')

    expect(emptySlots).toHaveLength(1)
    expect(emptySlots[0]).toHaveAttribute('data-slot-index', '5')
  })

  test('threeRight layout with 1 pane renders 1 slot', () => {
    render(
      <SplitView
        session={makeSession('threeRight', 1)}
        service={makeMockService()}
        isSessionVisible
      />
    )

    expect(screen.getAllByTestId('split-view-slot')).toHaveLength(1)
  })

  test('vsplit with 1 pane renders one empty slot when add handler exists', () => {
    render(
      <SplitView
        session={makeSession('vsplit', 1)}
        service={makeMockService()}
        isSessionVisible
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
        isSessionVisible
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
        isSessionVisible
      />
    )

    expect(
      screen.queryByTestId('split-view-empty-slot')
    ).not.toBeInTheDocument()

    expect(
      screen.queryByRole('button', { name: 'add shell pane' })
    ).not.toBeInTheDocument()
  })

  test('clicking empty slot add button calls onAddPane with session id and empty slot', async () => {
    const user = userEvent.setup()
    const onAddPane = vi.fn()

    render(
      <SplitView
        session={makeSession('vsplit', 1)}
        service={makeMockService()}
        isSessionVisible
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

    render(
      <SplitView
        session={session}
        service={makeMockService()}
        isSessionVisible
      />
    )

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
      <SplitView
        session={makeSession('quad', 4)}
        service={service}
        isSessionVisible
      />
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
        isSessionVisible
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
        isSessionVisible
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
        isSessionVisible
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
        isSessionVisible
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
        isSessionVisible
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
        isSessionVisible
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

    render(
      <SplitView
        session={session}
        service={makeMockService()}
        isSessionVisible
      />
    )

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
        isSessionVisible
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
        isSessionVisible
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
        isSessionVisible
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

describe('resolveLayoutRatios', () => {
  test('keeps saved ratios when track counts still match the layout', () => {
    const saved = { cols: [1, 2, 3], rows: [4, 5] }

    expect(resolveLayoutRatios(LAYOUTS.grid3x2, saved)).toBe(saved)
  })

  test('falls back to default ratios when a layout definition changes track counts', () => {
    const staleSaved = { cols: [1, 1], rows: [1, 1] }

    expect(resolveLayoutRatios(LAYOUTS.grid3x2, staleSaved)).toBe(
      LAYOUTS.grid3x2.defaultRatios
    )
  })
})

describe('SplitView - over-capacity rescued active render', () => {
  test('rescued active pane lands in the last grid slot (gridArea: p${capacity-1})', () => {
    const session = makeSession('vsplit', 3, 2)
    // 3 panes, vsplit capacity = 2, active at index 2 → must land at p1.

    render(
      <SplitView
        session={session}
        service={makeMockService()}
        isSessionVisible
      />
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
  })
})

describe('SplitView - drag panes into slots (VIM-167)', () => {
  // Minimal DataTransfer stub: jsdom does not implement it, so fireEvent's
  // synthetic drag events need one supplied for setData/getData to round-trip.
  const makeDataTransfer = (): DataTransfer => {
    const store = new Map<string, string>()

    return {
      setData: (format: string, value: string): void => {
        store.set(format, value)
      },
      getData: (format: string): string => store.get(format) ?? '',
      setDragImage: (): void => undefined,
      dropEffect: 'none',
      effectAllowed: 'all',
    } as unknown as DataTransfer
  }

  const slotByPaneId = (paneId: string): HTMLElement => {
    const slot = screen
      .getAllByTestId('split-view-slot')
      .find((node) => node.getAttribute('data-pane-id') === paneId)
    if (!slot) {
      throw new Error(`no slot for pane ${paneId}`)
    }

    return slot
  }

  const headerInSlot = (slot: HTMLElement): HTMLElement => {
    // eslint-disable-next-line testing-library/no-node-access -- drag handle is the header element inside the slot
    const header = slot.querySelector('[data-testid="terminal-pane-header"]')
    if (!(header instanceof HTMLElement)) {
      throw new Error('no terminal-pane-header in slot')
    }

    return header
  }

  test('terminal pane header is draggable but the body is not', () => {
    render(
      <SplitView
        session={makeSession('vsplit', 2)}
        service={makeMockService()}
        isSessionVisible
        onPanePlacementsChange={vi.fn()}
      />
    )

    expect(headerInSlot(slotByPaneId('p0'))).toHaveAttribute(
      'draggable',
      'true'
    )

    // The xterm body must NOT be draggable — dragging it would steal the
    // pointer from terminal text selection.
    const bodies = screen.getAllByTestId('body-mock')
    for (const body of bodies) {
      expect(body).not.toHaveAttribute('draggable', 'true')
    }
  })

  test('browser pane drag handle is not exposed as a keyboard button', () => {
    const session = makeSession('vsplit', 2)

    const browserSession: Session = {
      ...session,
      panes: [
        session.panes[0],
        { ...session.panes[1], kind: 'browser' as PaneKind },
      ],
    }

    render(
      <SplitView
        session={browserSession}
        service={makeMockService()}
        isSessionVisible
        onPanePlacementsChange={vi.fn()}
      />
    )

    const handle = screen.getByTestId('split-view-browser-drag-handle')

    expect(handle).toHaveAttribute('draggable', 'true')
    expect(handle).not.toHaveAttribute('role', 'button')
    expect(handle).not.toHaveAttribute('tabindex')
    expect(
      screen.queryByRole('button', { name: /drag to move pane/i })
    ).not.toBeInTheDocument()
  })

  test('dropping pane A header onto pane B swaps their slots', () => {
    const onPanePlacementsChange = vi.fn()

    render(
      <SplitView
        session={makeSession('vsplit', 2)}
        service={makeMockService()}
        isSessionVisible
        onPanePlacementsChange={onPanePlacementsChange}
      />
    )

    const dataTransfer = makeDataTransfer()
    fireEvent.dragStart(headerInSlot(slotByPaneId('p0')), { dataTransfer })

    const target = slotByPaneId('p1')
    fireEvent.dragOver(target, { dataTransfer })
    fireEvent.drop(target, { dataTransfer })

    expect(onPanePlacementsChange).toHaveBeenCalledOnce()
    const [sessionId, placements] = onPanePlacementsChange.mock.calls[0]
    expect(sessionId).toBe('sess-fix')
    // Guard against duplicate / ghost placements: a 2-pane swap yields exactly
    // two placement entries, never a stale extra.
    expect(placements).toHaveLength(2)
    expect(placements).toEqual(
      expect.arrayContaining([
        { paneId: 'p0', slotId: 'slot:p1' },
        { paneId: 'p1', slotId: 'slot:p0' },
      ])
    )
  })

  test('dropping a pane header onto an empty slot moves it there', () => {
    const onPanePlacementsChange = vi.fn()

    render(
      <SplitView
        session={makeSession('quad', 2)}
        service={makeMockService()}
        isSessionVisible
        onAddPane={vi.fn()}
        onPanePlacementsChange={onPanePlacementsChange}
      />
    )

    const dataTransfer = makeDataTransfer()
    fireEvent.dragStart(headerInSlot(slotByPaneId('p0')), { dataTransfer })

    const emptySlot = screen
      .getAllByTestId('split-view-empty-slot')
      .find((node) => node.getAttribute('data-slot-id') === 'slot:p2')
    if (!emptySlot) {
      throw new Error('no empty slot:p2')
    }

    fireEvent.dragOver(emptySlot, { dataTransfer })
    fireEvent.drop(emptySlot, { dataTransfer })

    expect(onPanePlacementsChange).toHaveBeenCalledOnce()

    const placements: PanePlacement[] = onPanePlacementsChange.mock.calls[0][1]
    // Guard against duplicate / ghost placements: moving one of two panes still
    // yields exactly two placement entries.
    expect(placements).toHaveLength(2)
    expect(placements).toEqual(
      expect.arrayContaining([
        { paneId: 'p0', slotId: 'slot:p2' },
        { paneId: 'p1', slotId: 'slot:p1' },
      ])
    )

    // p0's old slot is freed.
    expect(placements.some((placement) => placement.slotId === 'slot:p0')).toBe(
      false
    )
  })

  test('a swap that violates slot.accepts is a no-op', () => {
    // Custom layout: slot:p0 accepts only shell; slot:p1 accepts both
    // shell and browser. Pane p1 is a browser pane occupying slot:p1.
    // Dropping the browser pane onto slot:p0 (shell-only) would land a
    // browser where it is not accepted, so the swap must be rejected — the
    // rejection comes from the shell-only TARGET, not from slot:p1.
    const definition: PaneLayoutDefinition = {
      schemaVersion: 1,
      id: 'custom:accepts-fixture',
      title: 'Accepts fixture',
      source: 'workspace',
      tracks: {
        columns: [
          { id: 'c0', units: 1 },
          { id: 'c1', units: 1 },
        ],
        rows: [{ id: 'r0', units: 1 }],
      },
      slots: [
        {
          id: 'slot:p0',
          rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 },
          accepts: ['shell'],
        },
        {
          id: 'slot:p1',
          rect: { col: 1, row: 0, colSpan: 1, rowSpan: 1 },
          accepts: ['shell', 'browser'],
        },
      ],
      addOrder: ['slot:p0', 'slot:p1'],
    }
    const registry = new PaneLayoutRegistry([definition])

    const session = makeSession('vsplit', 2)

    const browserSession: Session = {
      ...session,
      layout: 'custom:accepts-fixture',
      panes: [
        session.panes[0],
        { ...session.panes[1], kind: 'browser' as PaneKind },
      ],
    }

    const onPanePlacementsChange = vi.fn()

    render(
      <SplitView
        session={browserSession}
        service={makeMockService()}
        isSessionVisible
        layoutRegistry={registry}
        onPanePlacementsChange={onPanePlacementsChange}
      />
    )

    const dataTransfer = makeDataTransfer()

    // Drag the browser pane (p1, in slot:p1) onto slot:p0 (shell-only) via its
    // dedicated drag handle.
    fireEvent.dragStart(screen.getByTestId('split-view-browser-drag-handle'), {
      dataTransfer,
    })

    const target = slotByPaneId('p0')
    fireEvent.dragOver(target, { dataTransfer })
    // Invalid target must not be highlighted.
    expect(target).not.toHaveAttribute('data-drop-active', 'true')

    fireEvent.drop(target, { dataTransfer })

    expect(onPanePlacementsChange).not.toHaveBeenCalled()
  })

  test('a valid drop target is highlighted on dragover; invalid is not', () => {
    render(
      <SplitView
        session={makeSession('vsplit', 2)}
        service={makeMockService()}
        isSessionVisible
        onPanePlacementsChange={vi.fn()}
      />
    )

    const dataTransfer = makeDataTransfer()
    fireEvent.dragStart(headerInSlot(slotByPaneId('p0')), { dataTransfer })

    const target = slotByPaneId('p1')
    fireEvent.dragOver(target, { dataTransfer })
    expect(target).toHaveAttribute('data-drop-active', 'true')

    fireEvent.dragLeave(target, { dataTransfer })
    expect(target).not.toHaveAttribute('data-drop-active', 'true')
  })

  test('dragging a pane onto itself does not fire a placement change', () => {
    const onPanePlacementsChange = vi.fn()

    render(
      <SplitView
        session={makeSession('vsplit', 2)}
        service={makeMockService()}
        isSessionVisible
        onPanePlacementsChange={onPanePlacementsChange}
      />
    )

    const dataTransfer = makeDataTransfer()
    const slot = slotByPaneId('p0')
    fireEvent.dragStart(headerInSlot(slot), { dataTransfer })
    fireEvent.dragOver(slot, { dataTransfer })
    fireEvent.drop(slot, { dataTransfer })

    expect(onPanePlacementsChange).not.toHaveBeenCalled()
  })

  test('without onPanePlacementsChange the header is not draggable', () => {
    render(
      <SplitView
        session={makeSession('vsplit', 2)}
        service={makeMockService()}
        isSessionVisible
      />
    )

    expect(headerInSlot(slotByPaneId('p0'))).not.toHaveAttribute(
      'draggable',
      'true'
    )
  })

  test('moving a browser pane onto a shell-only empty slot is a no-op', () => {
    // Custom 2-slot layout: slot:p0 unrestricted, slot:p1 accepts only shell.
    // The session has a single browser pane in slot:p0, leaving slot:p1 empty.
    // Dragging the browser onto the shell-only empty slot must be rejected
    // (move-path accepts gate, canDropOnSlot empty-target branch).
    const definition: PaneLayoutDefinition = {
      schemaVersion: 1,
      id: 'custom:shell-only-empty',
      title: 'Shell-only empty',
      source: 'workspace',
      tracks: {
        columns: [
          { id: 'c0', units: 1 },
          { id: 'c1', units: 1 },
        ],
        rows: [{ id: 'r0', units: 1 }],
      },
      slots: [
        { id: 'slot:p0', rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 } },
        {
          id: 'slot:p1',
          rect: { col: 1, row: 0, colSpan: 1, rowSpan: 1 },
          accepts: ['shell'],
        },
      ],
      addOrder: ['slot:p0', 'slot:p1'],
    }
    const registry = new PaneLayoutRegistry([definition])

    const base = makeSession('vsplit', 1)

    const session: Session = {
      ...base,
      layout: 'custom:shell-only-empty',
      panes: [{ ...base.panes[0], kind: 'browser' as PaneKind }],
    }

    const onPanePlacementsChange = vi.fn()

    render(
      <SplitView
        session={session}
        service={makeMockService()}
        isSessionVisible
        onAddPane={vi.fn()}
        layoutRegistry={registry}
        onPanePlacementsChange={onPanePlacementsChange}
      />
    )

    const dataTransfer = makeDataTransfer()
    fireEvent.dragStart(screen.getByTestId('split-view-browser-drag-handle'), {
      dataTransfer,
    })

    const emptySlot = screen
      .getAllByTestId('split-view-empty-slot')
      .find((node) => node.getAttribute('data-slot-id') === 'slot:p1')
    if (!emptySlot) {
      throw new Error('no empty slot:p1')
    }

    fireEvent.dragOver(emptySlot, { dataTransfer })
    // Invalid (shell-only) empty target must never be highlighted.
    expect(emptySlot).not.toHaveAttribute('data-drop-active', 'true')

    fireEvent.drop(emptySlot, { dataTransfer })

    expect(onPanePlacementsChange).not.toHaveBeenCalled()
  })

  test('a reverse-direction swap that violates the source slot is a no-op', () => {
    // Custom 2-slot layout: slot:p0 accepts only shell and holds a shell pane;
    // slot:p1 is unrestricted and holds a browser pane. Dragging the shell pane
    // onto slot:p1 would swap the browser back into the shell-only slot:p0, so
    // the swap must be rejected — this exercises the SECOND operand of the swap
    // gate (the dragging slot must accept the displaced occupant).
    const definition: PaneLayoutDefinition = {
      schemaVersion: 1,
      id: 'custom:reverse-swap',
      title: 'Reverse swap',
      source: 'workspace',
      tracks: {
        columns: [
          { id: 'c0', units: 1 },
          { id: 'c1', units: 1 },
        ],
        rows: [{ id: 'r0', units: 1 }],
      },
      slots: [
        {
          id: 'slot:p0',
          rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 },
          accepts: ['shell'],
        },
        { id: 'slot:p1', rect: { col: 1, row: 0, colSpan: 1, rowSpan: 1 } },
      ],
      addOrder: ['slot:p0', 'slot:p1'],
    }
    const registry = new PaneLayoutRegistry([definition])

    const base = makeSession('vsplit', 2)

    const session: Session = {
      ...base,
      layout: 'custom:reverse-swap',
      panes: [base.panes[0], { ...base.panes[1], kind: 'browser' as PaneKind }],
    }

    const onPanePlacementsChange = vi.fn()

    render(
      <SplitView
        session={session}
        service={makeMockService()}
        isSessionVisible
        layoutRegistry={registry}
        onPanePlacementsChange={onPanePlacementsChange}
      />
    )

    const dataTransfer = makeDataTransfer()
    // Drag the shell pane (p0, in shell-only slot:p0) onto slot:p1.
    fireEvent.dragStart(headerInSlot(slotByPaneId('p0')), { dataTransfer })

    const target = slotByPaneId('p1')
    fireEvent.dragOver(target, { dataTransfer })
    // The swap would send the browser into the shell-only source, so the
    // target must not be highlighted.
    expect(target).not.toHaveAttribute('data-drop-active', 'true')

    fireEvent.drop(target, { dataTransfer })

    expect(onPanePlacementsChange).not.toHaveBeenCalled()
  })

  test('a browser-only empty slot hides the Shell add-button', () => {
    // Custom 2-slot layout with a browser-only empty slot and one fewer pane
    // than slots. acceptsForSlotId must flow the restriction into EmptySlot so
    // the Shell add-button is absent for that slot (end-to-end pass-through).
    const definition: PaneLayoutDefinition = {
      schemaVersion: 1,
      id: 'custom:browser-only-empty',
      title: 'Browser-only empty',
      source: 'workspace',
      tracks: {
        columns: [
          { id: 'c0', units: 1 },
          { id: 'c1', units: 1 },
        ],
        rows: [{ id: 'r0', units: 1 }],
      },
      slots: [
        { id: 'slot:p0', rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 } },
        {
          id: 'slot:p1',
          rect: { col: 1, row: 0, colSpan: 1, rowSpan: 1 },
          accepts: ['browser'],
        },
      ],
      addOrder: ['slot:p0', 'slot:p1'],
    }
    const registry = new PaneLayoutRegistry([definition])

    const base = makeSession('vsplit', 1)

    const session: Session = {
      ...base,
      layout: 'custom:browser-only-empty',
    }

    render(
      <SplitView
        session={session}
        service={makeMockService()}
        isSessionVisible
        onAddPane={vi.fn()}
        layoutRegistry={registry}
        onPanePlacementsChange={vi.fn()}
      />
    )

    const emptySlot = screen
      .getAllByTestId('split-view-empty-slot')
      .find((node) => node.getAttribute('data-slot-id') === 'slot:p1')
    if (!emptySlot) {
      throw new Error('no empty slot:p1')
    }

    expect(
      within(emptySlot).queryByRole('button', { name: 'add shell pane' })
    ).toBeNull()

    expect(
      within(emptySlot).getByRole('button', { name: 'add browser pane' })
    ).toBeInTheDocument()
  })
})
