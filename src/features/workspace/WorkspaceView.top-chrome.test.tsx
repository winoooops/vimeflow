import {
  render as rtlRender,
  screen,
  act,
  within,
} from '@testing-library/react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import type { ReactElement, ReactNode } from 'react'
import { WorkspaceView } from './WorkspaceView'
import type { SessionManager } from '../sessions/hooks/useSessionManager'
import type { AgentStatus } from '../agent-status/types'
import type { Session, SessionStatus, PaneLayoutId } from '../sessions/types'
import {
  BUILTIN_PANE_LAYOUT_REGISTRY,
  SINGLE_PANE_FOCUS_LABEL,
  SINGLE_PANE_FOCUS_LAYOUT_ID,
} from '../terminal/layout-registry'
import { SHOWN_LAYOUTS_STORAGE_KEY } from '../terminal/components/LayoutSwitcher/layoutDisplayPreferences'
import { setSidebarCollapsed } from './utils/sidebarCollapsedStore'
import { SettingsProvider } from '../settings/SettingsProvider'

// WorkspaceView consumes useSettings (keymap preset, VIM-104); the provider
// tolerates a missing window.vimeflow and falls back to DEFAULT_SETTINGS, so no
// settings IPC mock is needed here. Mirrors the wrapper used by the sibling
// WorkspaceView suites.
const render = (ui: ReactElement): ReturnType<typeof rtlRender> =>
  rtlRender(ui, { wrapper: SettingsProvider })

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

vi.mock('@/components/sidebar/Sidebar', () => ({
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
  layout?: PaneLayoutId
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
      mruSessionIds: [],
      setActiveSessionId: vi.fn(),
      createSession: vi.fn(),
      createBrowserSession: vi.fn(),
      removeSession: vi.fn(),
      customPaneLayouts: [],
      layoutRegistry: BUILTIN_PANE_LAYOUT_REGISTRY,
      setCustomPaneLayouts: vi.fn(),
      setSessionLayout: vi.fn(),
      setSessionPlacements: vi.fn(),
      setSessionActivePane: vi.fn(),
      addPane: vi.fn(),
      removePane: vi.fn(),
      restartSession: vi.fn(),
      renameSession: vi.fn(),
      setPaneUserLabel: vi.fn(),
      reorderSessions: vi.fn(),
      updatePaneCwd: vi.fn(),
      appendPaneCacheReading: vi.fn(),
      updatePaneAgentType: vi.fn(),
      recordPaneAgentLauncher: vi.fn(),
      invalidatePaneAgentSession: vi.fn(),
      setSessionActivityPanelCollapsed: vi.fn(),
      updateSessionCwd: vi.fn(),
      updateSessionAgentType: vi.fn(),
      restoreData: new Map(),
      loading: false,
      notifyPaneReady: vi.fn(),
      registerPending: vi.fn(),
      dropAllForPty: vi.fn(),
      clearPaneCacheHistory: vi.fn(),
    }

    const { useSessionManager } =
      await import('../sessions/hooks/useSessionManager')
    vi.mocked(useSessionManager).mockReturnValue(mockSessionManager)
  }

  beforeEach(async () => {
    Object.defineProperty(navigator, 'platform', {
      value: '',
      configurable: true,
    })
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
      fileExists: vi.fn().mockResolvedValue(true),
      renamePath: vi.fn().mockResolvedValue(undefined),
      deletePath: vi.fn().mockResolvedValue(undefined),
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
      onBurnerForeground: vi.fn().mockReturnValue(vi.fn()),
      killEphemeralPtys: vi.fn(),
      setWorkspaceSessions: vi.fn().mockResolvedValue(undefined),
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

  test('top chrome is an always-visible in-flow bar (no auto-hide, no pin)', () => {
    render(<WorkspaceView />)

    // The auto-hide overlay + hover zone and the pin toggle were removed.
    expect(screen.queryByTestId('top-hover-zone')).toBeNull()
    expect(
      screen.queryByRole('button', { name: /keep top banner visible/i })
    ).toBeNull()

    const chrome = screen.getByTestId('top-chrome')
    const chromeClasses = chrome.className.split(/\s+/)
    // In-flow 44px bar (panes sit below it): relative, shrink-0, canvas
    // surface, hairline bottom rule. Not the old frosted/auto-hide overlay.
    expect(chromeClasses).toContain('relative')
    expect(chromeClasses).toContain('h-[44px]')
    expect(chromeClasses).toContain('shrink-0')
    expect(chromeClasses).toContain('bg-surface')
    expect(chromeClasses).toContain('border-b')
    expect(chromeClasses).toContain('border-outline-variant/25')
    expect(chromeClasses).not.toContain('glass-panel')
    expect(chromeClasses).not.toContain('opacity-0')
    expect(chromeClasses).not.toContain('absolute')
  })

  test('macOS top chrome is draggable with the layout pillar cut out', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    })

    render(<WorkspaceView />)

    expect(screen.getByTestId('top-chrome')).toHaveClass('vf-app-drag-region')

    expect(screen.getByTestId('layout-switcher')).toHaveClass('vf-app-no-drag')

    expect(screen.getByTestId('sidebar-toggle-fixed')).toHaveClass(
      'vf-app-no-drag'
    )
  })

  test('macOS collapsed activity rail keeps only its expand control clickable', async () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    })

    await setupSessionManager(
      [
        {
          ...mockSessions[0],
          activityPanelCollapsed: true,
        },
      ],
      'session-1'
    )

    render(<WorkspaceView />)

    expect(screen.getByTestId('top-chrome')).toHaveClass('vf-app-drag-region')

    expect(screen.getByTestId('layout-switcher')).toHaveClass('vf-app-no-drag')

    expect(screen.getByTestId('agent-status-rail')).toHaveClass(
      'vf-app-drag-region'
    )

    expect(
      screen.getByRole('button', { name: /expand activity panel/i })
    ).toHaveClass('vf-app-no-drag')
  })

  test('macOS collapsed left-sidebar toggle is cut out of the draggable top chrome', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    })

    render(<WorkspaceView />)

    expect(
      screen.queryByTestId('top-chrome-sidebar-toggle-clearance')
    ).toBeNull()

    act(() => {
      setSidebarCollapsed(true)
    })

    expect(screen.getByTestId('top-chrome')).toHaveClass('vf-app-drag-region')
    expect(screen.getByTestId('sidebar-toggle-fixed-shell')).toHaveClass(
      'vf-app-no-drag'
    )

    const clearance = screen.getByTestId('top-chrome-sidebar-toggle-clearance')
    expect(clearance).toHaveClass('vf-app-no-drag')
    expect(clearance).toHaveClass('pointer-events-none')
    expect(clearance).toHaveStyle({
      left: '82px',
      top: '7px',
      width: '28px',
      height: '28px',
    })
  })

  test('split layout: label-free pills right-aligned; config docked in the pillar (J3)', async () => {
    await setupSessionManager(mockSessions, 'session-2')
    render(<WorkspaceView />)

    const chrome = screen.getByTestId('top-chrome')
    const switcher = within(chrome).getByTestId('layout-switcher')

    // Right-aligned: a flex-1 spacer sits immediately before the pillar.
    // eslint-disable-next-line testing-library/no-node-access -- geometry test: assert the flex-1 spacer exists structurally
    const switcherSpacer = switcher.previousElementSibling
    expect(switcherSpacer?.className).toContain('flex-1')
    expect(within(chrome).queryByText('Layout')).toBeNull()

    // Config button docks INSIDE the pill pillar, right after a divider.
    // (It sits inside a tooltip-trigger span, so compare via containment
    // rather than a direct sibling check.)
    const config = within(switcher).getByRole('button', {
      name: 'Configure displayed layouts',
    })
    const divider = within(switcher).getByTestId('layout-switcher-divider')
    // eslint-disable-next-line testing-library/no-node-access -- geometry test: assert the config wrapper is the divider's next sibling
    const configWrapper = divider.nextElementSibling
    expect(configWrapper?.contains(config)).toBe(true)

    // No bordered action-group wrapper and no pin button (auto-hide removed).
    expect(within(chrome).queryByTestId('top-action-group')).toBeNull()
    expect(
      within(chrome).queryByRole('button', {
        name: /keep top banner visible/i,
      })
    ).toBeNull()

    // The config control stays transparent (hover fill only).
    const staticBg = config.className
      .split(/\s+/)
      .filter((cls) => cls.startsWith('bg-'))
    expect(staticBg).toEqual([])
  })

  test('layout picks forward to setSessionLayout without touching pane semantics (J6)', async () => {
    const user = userEvent.setup()
    await setupSessionManager(mockSessions, 'session-2')
    render(<WorkspaceView />)

    await user.click(screen.getByRole('button', { name: '3x2 grid' }))

    expect(mockSessionManager.setSessionLayout).toHaveBeenCalledWith(
      'session-2',
      'grid3x2'
    )
    expect(mockSessionManager.addPane).not.toHaveBeenCalled()
    expect(mockSessionManager.removePane).not.toHaveBeenCalled()
    expect(mockSessionManager.setSessionActivePane).not.toHaveBeenCalled()
  })

  test('single layout: same chrome as the splits — config docked in the pillar', () => {
    render(<WorkspaceView />)

    // The session-title identity was removed: a readout that exists in one
    // layout and vanishes in the others is inconsistent chrome (user call).
    expect(screen.queryByTestId('top-identity')).toBeNull()

    // The pill pillar survives single layout — it is the affordance back
    // into the split layouts (user call, supersedes the demo's hidden pills).
    const switcher = screen.getByTestId('layout-switcher')

    // The layout-display config control docks in the pillar here too, and is
    // never mislabelled as a split command.
    const config = within(switcher).getByRole('button', {
      name: 'Configure displayed layouts',
    })
    expect(config).not.toHaveAccessibleName(/split/i)

    // No bordered action group and no pin button (auto-hide removed).
    expect(screen.queryByTestId('top-action-group')).toBeNull()
    expect(
      screen.queryByRole('button', { name: /keep top banner visible/i })
    ).toBeNull()
  })

  test('an over-capacity checked layout renders as a disabled pill instead of vanishing', async () => {
    const user = userEvent.setup()

    const baseSession = createMockSession('session-1', 'auth refactor', {
      layout: 'grid3x2',
    })

    // Five panes exceed Quad's capacity (4) but fit 3x2 grid (6): Quad is
    // blocked, grid3x2 is not.
    const fivePaneSession: Session = {
      ...baseSession,
      panes: [0, 1, 2, 3, 4].map((index) => ({
        id: `p${index}`,
        ptyId: `pty-session-1-${index}`,
        cwd: '/home/user',
        agentType: 'claude-code',
        status: 'running',
        active: index === 0,
      })),
    }

    await setupSessionManager([fivePaneSession], 'session-1')
    window.localStorage.setItem(
      SHOWN_LAYOUTS_STORAGE_KEY,
      JSON.stringify([SINGLE_PANE_FOCUS_LAYOUT_ID, 'quad', 'grid3x2'])
    )
    render(<WorkspaceView />)

    const switcher = screen.getByTestId('layout-switcher')

    // Quad still renders (visibility is decoupled from capacity) but is
    // disabled with a reduce-panes explanation.
    const quad = within(switcher).getByRole('button', {
      name: 'Reduce panes to switch to Quad',
    })
    expect(quad).toHaveAttribute('aria-disabled', 'true')

    const single = within(switcher).getByRole('button', {
      name: SINGLE_PANE_FOCUS_LABEL,
    })
    expect(single).not.toHaveAttribute('aria-disabled', 'true')

    // A layout that DOES fit the pane count stays enabled.
    expect(
      within(switcher).getByRole('button', { name: '3x2 grid' })
    ).not.toHaveAttribute('aria-disabled', 'true')

    await user.click(single)
    expect(mockSessionManager.setSessionLayout).toHaveBeenCalledWith(
      'session-1',
      SINGLE_PANE_FOCUS_LAYOUT_ID
    )
  })

  test('the layout display menu can hide a non-active layout pill from the pillar', async () => {
    const user = userEvent.setup()

    await setupSessionManager(mockSessions, 'session-2')
    window.localStorage.setItem(
      SHOWN_LAYOUTS_STORAGE_KEY,
      JSON.stringify(['single', 'hsplit', 'grid3x2'])
    )
    render(<WorkspaceView />)

    const switcher = screen.getByTestId('layout-switcher')
    expect(
      within(switcher).getByRole('button', { name: 'Horizontal split' })
    ).toBeInTheDocument()

    await user.click(
      within(switcher).getByRole('button', {
        name: 'Configure displayed layouts',
      })
    )

    await user.click(
      await screen.findByRole('menuitemcheckbox', { name: 'Horizontal split' })
    )

    expect(
      within(screen.getByTestId('layout-switcher')).queryByRole('button', {
        name: 'Horizontal split',
      })
    ).toBeNull()

    expect(
      within(screen.getByTestId('layout-switcher')).getByRole('button', {
        name: '3x2 grid',
      })
    ).toBeInTheDocument()
  })

  test('the sidebar toggle is one persistent root control — it never relocates on collapse (J4)', () => {
    render(<WorkspaceView />)

    const chrome = screen.getByTestId('top-chrome')

    // Open: a single toggle, anchored to the workspace root — NOT inside the
    // chrome, and there is no separate in-shell anchor element anymore.
    const toggleShell = screen.getByTestId('sidebar-toggle-fixed-shell')
    const toggleOpen = screen.getByTestId('sidebar-toggle-fixed')
    expect(toggleOpen).toBeInTheDocument()
    expect(toggleShell).toHaveClass('vf-app-no-drag')
    expect(chrome).not.toContainElement(toggleOpen)
    expect(screen.queryByTestId('sidebar-toggle-anchor')).toBeNull()

    act(() => {
      setSidebarCollapsed(true)
    })

    // Collapsed: it is the SAME DOM node (never unmounted/remounted), still
    // outside the chrome. Because it does not relocate, it cannot jump as the
    // shell and main columns animate.
    const toggleCollapsed = screen.getByTestId('sidebar-toggle-fixed')
    expect(toggleCollapsed).toBe(toggleOpen)
    expect(toggleShell).toHaveClass('vf-app-no-drag')
    expect(chrome).not.toContainElement(toggleCollapsed)

    act(() => {
      setSidebarCollapsed(false)
    })

    expect(screen.getByTestId('sidebar-toggle-fixed')).toBe(toggleOpen)
    expect(screen.queryByTestId('sidebar-toggle-anchor')).toBeNull()
  })
})
