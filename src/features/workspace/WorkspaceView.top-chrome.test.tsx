/* eslint-disable testing-library/no-node-access -- gutter/spacer placement asserts structural DOM geometry the queries API cannot reach */
import { render, screen, act, within } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import type { ReactElement, ReactNode } from 'react'
import { WorkspaceView } from './WorkspaceView'
import type { SessionManager } from '../sessions/hooks/useSessionManager'
import type { AgentStatus } from '../agent-status/types'
import type { Session, SessionStatus, LayoutId } from '../sessions/types'
import { setSidebarCollapsed } from './utils/sidebarCollapsedStore'

// Mock all WorkspaceView dependencies
vi.mock('../sessions/hooks/useSessionManager')
vi.mock('../../lib/backend', () => ({
  renameAgentSession: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn(() =>
    Promise.resolve(() => {
      /* no-op unlisten */
    })
  ),
  invoke: vi.fn().mockResolvedValue(null),
  listenCommandPaletteToggle: vi.fn(() => (): void => {
    /* no-op unlisten */
  }),
}))
vi.mock('../../hooks/useResizable')
vi.mock('../../hooks/useElasticContainer', () => ({
  useElasticContainer: vi.fn(() => ({
    size: 400,
    isDragging: false,
    handleMouseDown: vi.fn(),
    adjustBy: vi.fn(),
    resetToSize: vi.fn(),
    sizeRef: { current: 400 },
    pixelMin: 40,
    pixelMax: 640,
  })),
}))
vi.mock('./hooks/useNotifyInfo')
vi.mock('../agent-status/hooks/useAgentStatus')
vi.mock('../diff/hooks/useGitStatus')
vi.mock('../editor/hooks/useEditorBuffer')
vi.mock('../files/services/fileSystemService')
vi.mock('../terminal/services/terminalService')
vi.mock('../terminal/hooks/usePaneShortcuts')

vi.mock('../../components/sidebar/Sidebar', () => ({
  Sidebar: ({ topBar = undefined }: { topBar?: ReactNode }): ReactElement => (
    <div data-testid="sidebar">{topBar}</div>
  ),
}))

vi.mock('./components/TerminalZone', () => ({
  TerminalZone: (): ReactElement => <div data-testid="terminal-zone" />,
}))

vi.mock('./components/DockPanel', () => ({
  default: (): ReactElement => <div data-testid="dock-panel" />,
}))

vi.mock('../agent-status/components/AgentStatusPanel', () => ({
  AgentStatusPanel: (): ReactElement => (
    <div data-testid="agent-status-panel" />
  ),
  PANEL_WIDTH_PX: 280,
}))

vi.mock('../editor/components/UnsavedChangesDialog', () => ({
  UnsavedChangesDialog: (): null => null,
}))

interface MockSessionOptions {
  layout?: LayoutId
  status?: SessionStatus
  agentType?: Session['agentType']
}

const createMockSession = (
  id: string,
  name: string,
  {
    layout = 'single',
    status = 'running',
    agentType = 'claude-code',
  }: MockSessionOptions = {}
): Session => ({
  id,
  projectId: 'proj-1',
  name,
  status,
  workingDirectory: '/home/user',
  agentType,
  layout,
  activityPanelCollapsed: false,
  panes: [
    {
      id: 'p0',
      ptyId: `pty-${id}`,
      cwd: '/home/user',
      agentType,
      status,
      active: true,
    },
  ],
  createdAt: '2024-01-01T00:00:00Z',
  lastActivityAt: '2024-01-01T00:00:00Z',
  activity: {
    fileChanges: [],
    toolCalls: [],
    testResults: [],
    contextWindow: {
      used: 0,
      total: 200000,
      percentage: 0,
      emoji: '😊',
    },
    usage: {
      sessionDuration: 0,
      turnCount: 0,
      messages: { sent: 0, limit: 200 },
      tokens: { input: 0, output: 0, total: 0 },
    },
  },
})

const createAgentStatus = (
  overrides: Partial<AgentStatus> = {}
): AgentStatus => ({
  isActive: false,
  agentExited: false,
  agentType: null,
  modelId: null,
  modelDisplayName: null,
  version: null,
  sessionId: null,
  agentSessionId: null,
  cwd: null,
  contextWindow: null,
  cost: null,
  rateLimits: null,
  numTurns: 0,
  toolCalls: { total: 0, byType: {}, active: null },
  recentToolCalls: [],
  testRun: null,
  ...overrides,
})

describe('WorkspaceView – top chrome (main-stage handoff J2–J6)', () => {
  let mockSessionManager: SessionManager
  let mockSessions: Session[]

  const setupSessionManager = async (
    sessions: Session[],
    activeSessionId: string
  ): Promise<void> => {
    mockSessionManager = {
      sessions,
      activeSessionId,
      setActiveSessionId: vi.fn(),
      createSession: vi.fn(),
      removeSession: vi.fn(),
      setSessionLayout: vi.fn(),
      setSessionActivePane: vi.fn(),
      addPane: vi.fn(),
      removePane: vi.fn(),
      restartSession: vi.fn(),
      renameSession: vi.fn(),
      setPaneUserLabel: vi.fn(),
      reorderSessions: vi.fn(),
      updatePaneCwd: vi.fn(),
      updatePaneAgentType: vi.fn(),
      setSessionActivityPanelCollapsed: vi.fn(),
      updateSessionCwd: vi.fn(),
      updateSessionAgentType: vi.fn(),
      restoreData: new Map(),
      loading: false,
      notifyPaneReady: vi.fn(),
    }

    const { useSessionManager } =
      await import('../sessions/hooks/useSessionManager')
    vi.mocked(useSessionManager).mockReturnValue(mockSessionManager)
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    act(() => {
      setSidebarCollapsed(false)
    })

    mockSessions = [
      createMockSession('session-1', 'auth middleware refactor'),
      createMockSession('session-2', 'feature work', { layout: 'vsplit' }),
    ]

    await setupSessionManager(mockSessions, 'session-1')

    const { useResizable } = await import('../../hooks/useResizable')
    vi.mocked(useResizable).mockReturnValue({
      size: 272,
      isDragging: false,
      handleMouseDown: vi.fn(),
      adjustBy: vi.fn(),
      resetToSize: vi.fn(),
      sizeRef: { current: 272 },
    })

    const { useNotifyInfo } = await import('./hooks/useNotifyInfo')
    vi.mocked(useNotifyInfo).mockReturnValue({
      message: null,
      notifyInfo: vi.fn(),
      dismiss: vi.fn(),
    })

    const { useAgentStatus } =
      await import('../agent-status/hooks/useAgentStatus')
    vi.mocked(useAgentStatus).mockReturnValue(
      createAgentStatus({ sessionId: 'pty-session-1' })
    )

    const { useGitStatus } = await import('../diff/hooks/useGitStatus')
    vi.mocked(useGitStatus).mockReturnValue({
      files: [],
      filesCwd: null,
      loading: false,
      error: null,
      refresh: vi.fn(),
      idle: true,
    })

    const { useEditorBuffer } = await import('../editor/hooks/useEditorBuffer')
    vi.mocked(useEditorBuffer).mockReturnValue({
      filePath: null,
      originalContent: '',
      currentContent: '',
      isDirty: false,
      isLoading: false,
      openFile: vi.fn(),
      saveFile: vi.fn(),
      updateContent: vi.fn(),
      hasUnsavedChanges: vi.fn(() => false),
      getFilePathForScope: vi.fn(() => null),
      releaseScope: vi.fn(),
    })

    const { createFileSystemService } =
      await import('../files/services/fileSystemService')
    vi.mocked(createFileSystemService).mockReturnValue({
      listDir: vi.fn().mockResolvedValue([]),
      readFile: vi.fn().mockResolvedValue(''),
      writeFile: vi.fn().mockResolvedValue(undefined),
    })

    const { createTerminalService } =
      await import('../terminal/services/terminalService')
    vi.mocked(createTerminalService).mockReturnValue({
      spawn: vi.fn().mockResolvedValue({
        sessionId: 'new-id',
        pid: 123,
        cwd: '/home/user',
      }),
      write: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn().mockResolvedValue(undefined),
      kill: vi.fn().mockResolvedValue(undefined),
      onData: vi.fn().mockResolvedValue(vi.fn()),
      onExit: vi.fn().mockReturnValue(vi.fn()),
      onError: vi.fn().mockReturnValue(vi.fn()),
      listSessions: vi.fn().mockResolvedValue({
        activeSessionId: null,
        sessions: [],
      }),
      setActiveSession: vi.fn().mockResolvedValue(undefined),
      reorderSessions: vi.fn().mockResolvedValue(undefined),
      updateSessionCwd: vi.fn().mockResolvedValue(undefined),
      setSessionActivityPanelCollapsed: vi.fn().mockResolvedValue(undefined),
    })
  })

  afterEach(() => {
    act(() => {
      setSidebarCollapsed(false)
    })
  })

  test('renders no session-tab strip — session switching stays sidebar-owned (J2)', () => {
    render(<WorkspaceView />)

    expect(screen.queryByTestId('session-tabs')).toBeNull()
    expect(screen.queryByRole('tablist', { name: 'Open sessions' })).toBeNull()
  })

  test('hover-reveal overlay: 44px zone over the workspace, chrome hidden until hover/focus (J3a)', () => {
    render(<WorkspaceView />)

    const zone = screen.getByTestId('top-hover-zone')
    const zoneClasses = zone.className.split(/\s+/)
    expect(zoneClasses).toContain('absolute')
    expect(zoneClasses).toContain('h-[44px]')
    expect(zoneClasses).toContain('z-40')
    expect(zoneClasses).toContain('group')
    expect(zoneClasses).toContain('focus:outline-none')
    expect(zone).toHaveAttribute('tabindex', '0')
    expect(zone).toHaveAttribute('aria-label', 'Reveal workspace controls')

    const chrome = screen.getByTestId('top-chrome')
    const chromeClasses = chrome.className.split(/\s+/)
    expect(chromeClasses).toContain('h-[44px]')
    // Auto-hide overlay is frosted glass: translucent lowest-surface tint
    // plus the app's glass-panel blur so content ghosts through underneath.
    expect(chromeClasses).toContain('bg-[rgba(13,13,28,0.65)]')
    expect(chromeClasses).toContain('glass-panel')
    expect(chromeClasses).not.toContain('bg-surface-container-lowest')
    expect(chromeClasses).toContain('border-b')
    expect(chromeClasses).toContain('border-[rgba(74,68,79,0.25)]')
    expect(chromeClasses).toContain('opacity-0')
    expect(chromeClasses).toContain('-translate-y-[5px]')
    expect(chromeClasses).toContain('group-hover:opacity-100')
    // Keyboard focus keeps the bar revealed, but a mouse click on the pin
    // must not pin it open — focus-visible, not plain focus-within.
    expect(chromeClasses).toContain('group-focus-visible:opacity-100')
    expect(chromeClasses).toContain('group-has-[:focus-visible]:opacity-100')
    expect(chromeClasses).not.toContain('group-focus-within:opacity-100')
    // Hiding starts the moment the cursor leaves; both directions stay smooth.
    expect(chromeClasses).toContain(
      '[transition:opacity_260ms_cubic-bezier(0.4,0,0.2,1),transform_260ms_cubic-bezier(0.4,0,0.2,1),padding-left_180ms_cubic-bezier(0.4,0,0.2,1)]'
    )

    expect(chromeClasses).toContain(
      'group-hover:[transition:opacity_200ms_ease-out,transform_200ms_ease-out,padding-left_180ms_cubic-bezier(0.4,0,0.2,1)]'
    )
  })

  test('sticky pin reserves a real 44px row and keeps the chrome revealed (J3a)', async () => {
    const user = userEvent.setup()
    render(<WorkspaceView />)

    const pin = screen.getByRole('button', { name: 'Keep top banner visible' })
    expect(pin).toHaveAttribute('aria-pressed', 'false')

    await user.click(pin)

    expect(pin).toHaveAttribute('aria-pressed', 'true')
    expect(pin).toHaveAccessibleName('Auto-hide top banner')
    expect(pin.className.split(/\s+/)).toContain('text-primary')

    const zone = screen.getByTestId('top-hover-zone')
    const zoneClasses = zone.className.split(/\s+/)
    expect(zoneClasses).toContain('relative')
    expect(zoneClasses).toContain('shrink-0')
    expect(zoneClasses).not.toContain('absolute')

    const chromeClasses = screen
      .getByTestId('top-chrome')
      .className.split(/\s+/)
    expect(chromeClasses).toContain('opacity-100')
    expect(chromeClasses).not.toContain('opacity-0')
    // Pinned reserves a real row — nothing renders underneath, so the bar
    // returns to the solid handoff surface instead of frosted glass.
    expect(chromeClasses).toContain('bg-surface-container-lowest')
    expect(chromeClasses).not.toContain('glass-panel')

    await user.click(pin)

    expect(pin).toHaveAttribute('aria-pressed', 'false')
    expect(zone.className.split(/\s+/)).toContain('absolute')
  })

  test('split layout: label-free pills right-aligned plus a two-button action group with one wrapping border (J3)', async () => {
    await setupSessionManager(mockSessions, 'session-2')
    render(<WorkspaceView />)

    const chrome = screen.getByTestId('top-chrome')
    const switcher = within(chrome).getByTestId('layout-switcher')

    // Right-aligned: a flex-1 spacer sits immediately before the pills.
    expect(switcher.previousElementSibling?.className).toContain('flex-1')
    expect(within(chrome).queryByText('Layout')).toBeNull()

    const group = within(chrome).getByTestId('top-action-group')
    const groupClasses = group.className.split(/\s+/)
    expect(groupClasses).toContain('border')
    expect(groupClasses).toContain('border-[rgba(74,68,79,0.42)]')
    expect(groupClasses).toContain('rounded-[8px]')

    const buttons = within(group).getAllByRole('button')
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toHaveAccessibleName('Configure displayed layouts')
    expect(buttons[1]).toHaveAccessibleName('Keep top banner visible')

    // Child buttons are transparent (hover fill only): no static bg utility.
    for (const button of buttons) {
      const staticBg = button.className
        .split(/\s+/)
        .filter((cls) => cls.startsWith('bg-'))
      expect(staticBg).toEqual([])
    }
  })

  test('layout picks forward to setSessionLayout without touching pane semantics (J6)', async () => {
    const user = userEvent.setup()
    await setupSessionManager(mockSessions, 'session-2')
    render(<WorkspaceView />)

    await user.click(screen.getByRole('button', { name: 'Quad' }))

    expect(mockSessionManager.setSessionLayout).toHaveBeenCalledWith(
      'session-2',
      'quad'
    )
    expect(mockSessionManager.addPane).not.toHaveBeenCalled()
    expect(mockSessionManager.removePane).not.toHaveBeenCalled()
    expect(mockSessionManager.setSessionActivePane).not.toHaveBeenCalled()
  })

  test('single layout: same chrome as the splits — pills and actions, no identity row', () => {
    render(<WorkspaceView />)

    // The session-title identity was removed: a readout that exists in one
    // layout and vanishes in the others is inconsistent chrome (user call).
    expect(screen.queryByTestId('top-identity')).toBeNull()

    // The pill group survives single layout — it is the affordance back
    // into the split layouts (user call, supersedes the demo's hidden pills).
    expect(screen.getByTestId('layout-switcher')).toBeInTheDocument()

    // The action group survives in single mode, and the layout-display
    // configuration control is never mislabelled as a split command.
    const group = screen.getByTestId('top-action-group')
    expect(
      within(group).getByRole('button', { name: 'Configure displayed layouts' })
    ).toBeInTheDocument()
    expect(within(group).queryByRole('button', { name: /split/i })).toBeNull()
  })

  test('collapsed sidebar opens the 50px gutter and floats the toggle at left 12 / top 8 (J4)', () => {
    render(<WorkspaceView />)

    const chrome = screen.getByTestId('top-chrome')
    expect(chrome.className.split(/\s+/)).toContain('pl-[14px]')
    expect(screen.queryByTestId('sidebar-toggle-chrome')).toBeNull()

    act(() => {
      setSidebarCollapsed(true)
    })

    const collapsedClasses = chrome.className.split(/\s+/)
    expect(collapsedClasses).toContain('pl-[50px]')
    expect(collapsedClasses).not.toContain('pl-[14px]')

    const toggle = screen.getByTestId('sidebar-toggle-chrome')
    const gutter = toggle.closest('div.absolute')
    expect(gutter).not.toBeNull()
    const gutterClasses = gutter!.className.split(/\s+/)
    expect(gutterClasses).toContain('left-[12px]')
    expect(gutterClasses).toContain('top-[8px]')
    expect(gutterClasses).toContain('z-30')

    act(() => {
      setSidebarCollapsed(false)
    })

    expect(chrome.className.split(/\s+/)).toContain('pl-[14px]')
    expect(screen.queryByTestId('sidebar-toggle-chrome')).toBeNull()
  })
})
