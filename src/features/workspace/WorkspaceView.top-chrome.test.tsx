import {
  render,
  screen,
  act,
  waitFor,
  within,
  fireEvent,
} from '@testing-library/react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import type { ReactElement, ReactNode } from 'react'
import { WorkspaceView } from './WorkspaceView'
import type { SessionManager } from '../sessions/hooks/useSessionManager'
import type { AgentStatus } from '../agent-status/types'
import type { Session, SessionStatus, LayoutId } from '../sessions/types'
import {
  BUILTIN_PANE_LAYOUT_REGISTRY,
  PaneLayoutRegistry,
  type PaneLayoutDefinition,
} from '../terminal/layout-registry'
import {
  HIDDEN_CUSTOM_LAYOUTS_STORAGE_KEY,
  SHOWN_LAYOUTS_STORAGE_KEY,
} from '../terminal/components/LayoutSwitcher/layoutDisplayPreferences'
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
      createBrowserSession: vi.fn(),
      removeSession: vi.fn(),
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
      clearPaneCacheHistory: vi.fn(),
      updatePaneAgentType: vi.fn(),
      setSessionActivityPanelCollapsed: vi.fn(),
      updateSessionCwd: vi.fn(),
      updateSessionAgentType: vi.fn(),
      customPaneLayouts: [],
      layoutRegistry: BUILTIN_PANE_LAYOUT_REGISTRY,
      setCustomPaneLayouts: vi.fn(),
      restoreData: new Map(),
      loading: false,
      notifyPaneReady: vi.fn(),
      registerPending: vi.fn(),
      dropAllForPty: vi.fn(),
    }

    const { useSessionManager } =
      await import('../sessions/hooks/useSessionManager')
    vi.mocked(useSessionManager).mockReturnValue(mockSessionManager)
  }

  beforeEach(async () => {
    window.localStorage.removeItem(SHOWN_LAYOUTS_STORAGE_KEY)
    window.localStorage.removeItem(HIDDEN_CUSTOM_LAYOUTS_STORAGE_KEY)
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
      fileExists: vi.fn().mockResolvedValue(true),
      writeFile: vi.fn().mockResolvedValue(undefined),
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
    window.localStorage.removeItem(SHOWN_LAYOUTS_STORAGE_KEY)
    window.localStorage.removeItem(HIDDEN_CUSTOM_LAYOUTS_STORAGE_KEY)
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

  test('macOS top chrome click closes the layout display menu while it is open', async () => {
    const user = userEvent.setup()

    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    })

    await setupSessionManager(mockSessions, 'session-2')
    render(<WorkspaceView />)

    const chrome = screen.getByTestId('top-chrome')
    expect(chrome).toHaveClass('vf-app-drag-region')

    await user.click(
      screen.getByRole('button', { name: 'Configure displayed layouts' })
    )

    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(chrome).not.toHaveClass('vf-app-drag-region')

    await user.click(chrome)

    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull()
    })
    expect(chrome).toHaveClass('vf-app-drag-region')
  })

  test('closing the active session while the layout display menu is open restores the macOS drag region', async () => {
    const user = userEvent.setup()

    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    })

    await setupSessionManager(mockSessions, 'session-2')
    const { rerender } = render(<WorkspaceView />)

    const chrome = screen.getByTestId('top-chrome')
    expect(chrome).toHaveClass('vf-app-drag-region')

    await user.click(
      screen.getByRole('button', { name: 'Configure displayed layouts' })
    )

    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(chrome).not.toHaveClass('vf-app-drag-region')

    // Simulate the active session being removed without an explicit menu close.
    mockSessionManager.activeSessionId = null
    mockSessionManager.sessions = []
    rerender(<WorkspaceView />)

    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull()
    })
    expect(chrome).toHaveClass('vf-app-drag-region')
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
    window.localStorage.setItem(
      SHOWN_LAYOUTS_STORAGE_KEY,
      JSON.stringify(['single', 'quad', 'grid3x2'])
    )
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

  test('custom layout pick is ignored when the session has more panes than it supports', async () => {
    const user = userEvent.setup()

    const tinyCustomLayout: PaneLayoutDefinition = {
      schemaVersion: 1,
      id: 'custom:tiny',
      title: 'Tiny',
      source: 'workspace',
      tracks: {
        columns: [{ id: 'col-0', units: 24 }],
        rows: [{ id: 'row-0', units: 24 }],
      },
      slots: [
        {
          id: 'slot:p0',
          rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 },
        },
      ],
      addOrder: ['slot:p0'],
    }

    const baseSession = createMockSession('session-2', 'feature work', {
      layout: 'single',
    })

    const twoPaneSession: Session = {
      ...baseSession,
      panes: [
        { ...baseSession.panes[0], id: 'p0', active: true },
        {
          id: 'p1',
          ptyId: 'pty-session-2-1',
          cwd: '/home/user',
          agentType: 'claude-code',
          status: 'running',
          active: false,
        },
      ],
    }

    await setupSessionManager([twoPaneSession], 'session-2')
    mockSessionManager.layoutRegistry = new PaneLayoutRegistry([
      tinyCustomLayout,
    ])
    mockSessionManager.customPaneLayouts = [tinyCustomLayout]
    render(<WorkspaceView />)

    await user.click(
      screen.getByRole('button', { name: 'Configure displayed layouts' })
    )
    const menu = await screen.findByRole('menu')
    const tinyLabel = await within(menu).findByText('Tiny')
    await user.click(tinyLabel)

    expect(mockSessionManager.setSessionLayout).not.toHaveBeenCalled()
  })

  test('saving an undersized custom layout does not apply it to an over-capacity session', async () => {
    const user = userEvent.setup()

    const baseSession = createMockSession('session-2', 'feature work', {
      layout: 'vsplit',
    })

    const twoPaneSession: Session = {
      ...baseSession,
      panes: [
        { ...baseSession.panes[0], id: 'p0', active: true },
        {
          id: 'p1',
          ptyId: 'pty-session-2-1',
          cwd: '/home/user',
          agentType: 'claude-code',
          status: 'running',
          active: false,
        },
      ],
    }

    await setupSessionManager([twoPaneSession], 'session-2')
    render(<WorkspaceView />)

    await user.click(
      screen.getByRole('button', { name: 'Configure displayed layouts' })
    )

    await user.click(
      await screen.findByRole('menuitem', { name: 'Create custom layout' })
    )
    await user.click(screen.getByRole('button', { name: 'Code · JSON/YAML' }))
    fireEvent.change(screen.getAllByRole('textbox')[1], {
      target: {
        value: JSON.stringify({
          tracks: {
            columns: [{ id: 'col-0', units: 24 }],
            rows: [{ id: 'row-0', units: 24 }],
          },
          slots: [
            {
              id: 'slot:p0',
              rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 },
            },
          ],
        }),
      },
    })
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    await user.clear(screen.getByRole('textbox', { name: 'Layout name' }))
    await user.type(
      screen.getByRole('textbox', { name: 'Layout name' }),
      'Tiny'
    )
    await user.click(screen.getByRole('button', { name: 'Save & apply' }))

    expect(mockSessionManager.setCustomPaneLayouts).toHaveBeenCalledOnce()
    expect(mockSessionManager.setCustomPaneLayouts).toHaveBeenCalledWith(
      expect.any(Function),
      { skipPreservation: true }
    )
    expect(mockSessionManager.setSessionLayout).not.toHaveBeenCalled()
  })

  test('duplicating a custom layout clones it under a fresh custom id without changing the active session layout', async () => {
    const user = userEvent.setup()

    const sourceCustomLayout: PaneLayoutDefinition = {
      schemaVersion: 1,
      id: 'custom:main-bottom',
      title: 'Main + bottom',
      source: 'workspace',
      tracks: {
        columns: [
          { id: 'col-0', units: 8 },
          { id: 'col-1', units: 8 },
          { id: 'col-2', units: 8 },
        ],
        rows: [
          { id: 'row-0', units: 16 },
          { id: 'row-1', units: 8 },
        ],
      },
      slots: [
        { id: 'slot:p0', rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 } },
        {
          id: 'slot:p1',
          rect: { col: 0, row: 1, colSpan: 1, rowSpan: 1 },
          accepts: ['browser'],
        },
        { id: 'slot:p2', rect: { col: 1, row: 1, colSpan: 1, rowSpan: 1 } },
        { id: 'slot:p3', rect: { col: 2, row: 1, colSpan: 1, rowSpan: 1 } },
      ],
      addOrder: ['slot:p0', 'slot:p1', 'slot:p2', 'slot:p3'],
    }

    const singleSession = createMockSession('session-1', 'auth refactor', {
      layout: 'single',
    })

    await setupSessionManager([singleSession], 'session-1')
    mockSessionManager.layoutRegistry = new PaneLayoutRegistry([
      sourceCustomLayout,
    ])
    mockSessionManager.customPaneLayouts = [sourceCustomLayout]
    render(<WorkspaceView />)

    await user.click(
      screen.getByRole('button', { name: 'Configure displayed layouts' })
    )

    await user.click(
      await screen.findByRole('button', { name: 'Duplicate Main + bottom' })
    )

    expect(mockSessionManager.setCustomPaneLayouts).toHaveBeenCalledOnce()
    expect(mockSessionManager.setCustomPaneLayouts).toHaveBeenCalledWith(
      expect.any(Function),
      { skipPreservation: true }
    )
    // Duplicating must never re-point the active session at the clone.
    expect(mockSessionManager.setSessionLayout).not.toHaveBeenCalled()

    const updater = vi.mocked(mockSessionManager.setCustomPaneLayouts).mock
      .calls[0][0] as (
      prev: readonly PaneLayoutDefinition[]
    ) => readonly PaneLayoutDefinition[]
    const next = updater([sourceCustomLayout])

    expect(next).toHaveLength(2)
    expect(next[0]).toBe(sourceCustomLayout)

    const clone = next[1]
    expect(clone.id).not.toBe(sourceCustomLayout.id)
    expect(clone.id).toMatch(/^custom:/)
    expect(clone.title).toBe('Copy of Main + bottom')
    expect(clone.source).toBe('workspace')
    expect(clone.tracks).toEqual(sourceCustomLayout.tracks)
    expect(clone.slots).toEqual(sourceCustomLayout.slots)
    expect(clone.addOrder).toEqual(sourceCustomLayout.addOrder)
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
