// cspell:ignore Ghostty ghostty
import {
  render as rtlRender,
  screen,
  waitFor,
  act,
} from '@testing-library/react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { WorkspaceView } from './WorkspaceView'
import {
  SettingsProvider,
  SettingsContext,
} from '@/features/settings/SettingsProvider'
import { DEFAULT_SETTINGS } from '@/features/settings/store/settingsDefaults'
import type { AppSettings } from '@/bindings/AppSettings'
import type { SessionManager } from '@/features/sessions/hooks/useSessionManager'
import type { AgentStatus } from '@/features/agent-status/types'
import type { Session } from '@/features/sessions/types'
import type {
  TerminalZoneHandle,
  TerminalZoneProps,
} from './components/TerminalZone'
import type { WorkspaceOverlayRegistrationsProps } from './overlays/WorkspaceOverlayRegistrations'
import { BUILTIN_PANE_LAYOUT_REGISTRY } from '@/features/terminal/layout-registry'

const render = (ui: ReactElement): ReturnType<typeof rtlRender> =>
  rtlRender(ui, { wrapper: SettingsProvider })

const VimKeymapProvider = ({
  children,
}: {
  children: ReactNode
}): ReactElement => {
  const [settings, setSettings] = useState<AppSettings>({
    ...DEFAULT_SETTINGS,
    keymapPreset: 'vim',
  })

  return (
    <SettingsContext.Provider
      value={{
        settings,
        saveError: null,
        update: (patch): void => {
          setSettings((prev) => ({ ...prev, ...patch }))
        },
      }}
    >
      {children}
    </SettingsContext.Provider>
  )
}

const terminalZonePropsSpy = vi.hoisted(() => vi.fn())
const overlayRegistrationPropsSpy = vi.hoisted(() => vi.fn())
const terminalFocusActivePaneSpy = vi.hoisted(() => vi.fn())

const backendListeners = vi.hoisted(
  () => new Map<string, (payload: unknown) => void>()
)

// Mock all WorkspaceView dependencies
vi.mock('@/features/sessions/hooks/useSessionManager')
vi.mock('@/lib/backend', () => ({
  renameAgentSession: vi.fn().mockResolvedValue(undefined),
  // Stubs for any other backend functions imported by the workspace tree.
  // listen/invoke return inert no-ops so the WorkspaceView mount under
  // jsdom doesn't try to reach a real bridge.
  listen: vi.fn((event: string, callback: (payload: unknown) => void) => {
    backendListeners.set(event, callback)

    return Promise.resolve(() => {
      backendListeners.delete(event)
    })
  }),
  invoke: vi.fn().mockResolvedValue(null),
  // useCommandPalette subscribes to the Electron main-process palette toggle
  // override on mount; return a synchronous no-op unlisten so the
  // WorkspaceView tree mounts without reaching a real bridge.
  listenCommandPaletteToggle: vi.fn(() => (): void => {
    /* no-op unlisten */
  }),
}))
vi.mock('@/hooks/useResizable')
vi.mock('@/hooks/useElasticContainer', () => ({
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
vi.mock('@/features/agent-status/hooks/useAgentStatus')
vi.mock('@/features/diff/hooks/useGitStatus')
vi.mock('@/features/editor/hooks/useEditorBuffer')
vi.mock('@/features/files/services/fileSystemService')
vi.mock('@/features/terminal/services/terminalService')
vi.mock('@/features/terminal/hooks/usePaneShortcuts')
vi.mock('@/features/terminal/hooks/useBurnerTerminals', () => ({
  useBurnerTerminals: vi.fn(),
}))

// Mock child components to keep test focused on command dispatch while still
// rendering sidebar chrome needed by WorkspaceView.
vi.mock('@/components/sidebar/Sidebar', () => ({
  Sidebar: ({
    topBar = undefined,
    content = undefined,
  }: {
    topBar?: ReactNode
    content?: ReactNode
  }): ReactElement => (
    <div data-testid="sidebar">
      {topBar}
      {content}
    </div>
  ),
}))

vi.mock('./components/TerminalZone', () => ({
  TerminalZone: forwardRef<TerminalZoneHandle, TerminalZoneProps>(
    function MockTerminalZone(props, ref): ReactElement {
      const nodeRef = useRef<HTMLDivElement>(null)

      useImperativeHandle(
        ref,
        () => ({
          focusActivePane: (): boolean => {
            terminalFocusActivePaneSpy()
            nodeRef.current?.focus()

            return nodeRef.current !== null
          },
        }),
        []
      )

      terminalZonePropsSpy(props)

      return <div ref={nodeRef} data-testid="terminal-zone" tabIndex={-1} />
    }
  ),
}))

vi.mock('./overlays/WorkspaceOverlayRegistrations', () => ({
  WorkspaceOverlayRegistrations: (
    props: WorkspaceOverlayRegistrationsProps
  ): null => {
    overlayRegistrationPropsSpy(props)

    return null
  },
}))

vi.mock('./components/DockPanel', () => ({
  default: ({ tab }: { tab: string }): ReactElement => (
    <div data-testid="dock-panel" data-tab={tab} />
  ),
}))

vi.mock('@/features/agent-status/components/AgentStatusPanel', () => ({
  AgentStatusPanel: (): ReactElement => (
    <div data-testid="agent-status-panel" />
  ),
  PANEL_WIDTH_PX: 280,
}))

vi.mock('@/features/editor/components/UnsavedChangesDialog', () => ({
  UnsavedChangesDialog: ({
    isOpen,
    onSave,
    onDiscard,
    onCancel,
  }: {
    isOpen: boolean
    onSave: () => void
    onDiscard: () => void
    onCancel: () => void
  }): ReactElement | null => {
    const saveRef = useRef<HTMLButtonElement>(null)

    useEffect(() => {
      if (isOpen) {
        saveRef.current?.focus()
      }
    }, [isOpen])

    return isOpen ? (
      <div data-testid="unsaved-changes-dialog" role="dialog">
        <button ref={saveRef} type="button" onClick={onSave}>
          Save
        </button>
        <button type="button" onClick={onDiscard}>
          Discard
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    ) : null
  },
}))

const createMockSession = (id: string, name: string): Session => ({
  id,
  projectId: 'proj-1',
  name,
  status: 'running',
  workingDirectory: '/home/user',
  agentType: 'claude-code',
  layout: 'single',
  activityPanelCollapsed: false,
  panes: [
    {
      id: 'p0',
      ptyId: `pty-${id}`,
      cwd: '/home/user',
      agentType: 'claude-code',
      status: 'running',
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

describe('WorkspaceView - Command Palette Integration', () => {
  let mockSessionManager: SessionManager
  let mockSessions: Session[]

  beforeEach(async () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Linux x86_64',
      configurable: true,
    })
    // Reset all mocks
    vi.clearAllMocks()
    terminalZonePropsSpy.mockClear()
    overlayRegistrationPropsSpy.mockClear()
    backendListeners.clear()
    window.vimeflow = {} as typeof window.vimeflow

    // Create mock sessions
    mockSessions = [
      createMockSession('session-1', 'main'),
      createMockSession('session-2', 'feature'),
      createMockSession('session-3', 'bugfix'),
    ]

    // Create mock session manager
    mockSessionManager = {
      sessions: mockSessions,
      activeSessionId: 'session-1',
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

    // Mock useSessionManager
    const { useSessionManager } =
      await import('@/features/sessions/hooks/useSessionManager')
    vi.mocked(useSessionManager).mockReturnValue(mockSessionManager)

    // Mock useResizable
    const { useResizable } = await import('@/hooks/useResizable')
    vi.mocked(useResizable).mockReturnValue({
      size: 272,
      isDragging: false,
      handleMouseDown: vi.fn(),
      adjustBy: vi.fn(),
      resetToSize: vi.fn(),
      sizeRef: { current: 272 },
    })

    // Mock useNotifyInfo
    const { useNotifyInfo } = await import('./hooks/useNotifyInfo')
    vi.mocked(useNotifyInfo).mockReturnValue({
      message: null,
      notifyInfo: vi.fn(),
      dismiss: vi.fn(),
    })

    // Mock useAgentStatus
    const { useAgentStatus } =
      await import('@/features/agent-status/hooks/useAgentStatus')
    vi.mocked(useAgentStatus).mockReturnValue(
      createAgentStatus({ sessionId: 'pty-session-1' })
    )

    // Mock useGitStatus
    const { useGitStatus } = await import('@/features/diff/hooks/useGitStatus')
    vi.mocked(useGitStatus).mockReturnValue({
      files: [],
      filesCwd: null,
      loading: false,
      error: null,
      refresh: vi.fn(),
      idle: true,
    })

    // Mock useEditorBuffer
    const { useEditorBuffer } =
      await import('@/features/editor/hooks/useEditorBuffer')
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

    // Mock fileSystemService
    const { createFileSystemService } =
      await import('@/features/files/services/fileSystemService')
    vi.mocked(createFileSystemService).mockReturnValue({
      listDir: vi.fn().mockResolvedValue([]),
      readFile: vi.fn().mockResolvedValue(''),
      writeFile: vi.fn().mockResolvedValue(undefined),
      fileExists: vi.fn().mockResolvedValue(true),
      renamePath: vi.fn().mockResolvedValue(undefined),
      deletePath: vi.fn().mockResolvedValue(undefined),
    })

    // Mock terminalService
    const { createTerminalService } =
      await import('@/features/terminal/services/terminalService')
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
      listSessions: vi.fn().mockResolvedValue({
        activeSessionId: null,
        sessions: [],
      }),
      setActiveSession: vi.fn().mockResolvedValue(undefined),
      reorderSessions: vi.fn().mockResolvedValue(undefined),
      updateSessionCwd: vi.fn().mockResolvedValue(undefined),
      setSessionActivityPanelCollapsed: vi.fn().mockResolvedValue(undefined),
      killEphemeralPtys: vi.fn(),
      setWorkspaceSessions: vi.fn().mockResolvedValue(undefined),
    })

    const { useBurnerTerminals } =
      await import('@/features/terminal/hooks/useBurnerTerminals')
    vi.mocked(useBurnerTerminals).mockReturnValue({
      renderNode: null,
      toggle: vi.fn().mockResolvedValue(undefined),
      syncToPaneCwd: vi.fn(),
      cyclePlacement: vi.fn(),
      placementByPane: new Map(),
      runningByPane: new Map(),
      activeByPane: new Map(),
      outOfSyncByPane: new Map(),
      hasVisibleBurner: false,
      visibleBurnerPaneKey: null,
    })
  })

  afterEach(() => {
    delete window.vimeflow
  })

  const openPalette = (): void => {
    act(() => {
      const event = new KeyboardEvent('keydown', {
        key: ';',
        code: 'Semicolon',
        ctrlKey: true,
        bubbles: true,
      })
      document.dispatchEvent(event)
    })
  }

  const latestOverlayRegistrationProps =
    (): WorkspaceOverlayRegistrationsProps => {
      const call = overlayRegistrationPropsSpy.mock.calls[
        overlayRegistrationPropsSpy.mock.calls.length - 1
      ] as [WorkspaceOverlayRegistrationsProps] | undefined
      if (!call) {
        throw new Error('WorkspaceOverlayRegistrations was not rendered')
      }

      return call[0]
    }

  const latestTerminalZoneProps = (): TerminalZoneProps => {
    const call = terminalZonePropsSpy.mock.calls[
      terminalZonePropsSpy.mock.calls.length - 1
    ] as [TerminalZoneProps] | undefined
    if (!call) {
      throw new Error('TerminalZone was not rendered')
    }

    return call[0]
  }

  test(':new command creates a new session', async () => {
    const user = userEvent.setup()
    render(<WorkspaceView />)

    // Open palette
    openPalette()

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    // Type :new
    const input = screen.getByRole('combobox', {
      name: 'Command palette search',
    })
    await user.clear(input)
    await user.type(input, ':new')

    // Press Enter
    await user.keyboard('{Enter}')

    // Assert createSession was called
    expect(mockSessionManager.createSession).toHaveBeenCalledOnce()

    // Assert palette closed
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  test('sidebar new-session button opens the dialog without instant-creating', async () => {
    const user = userEvent.setup()
    render(<WorkspaceView />)

    expect(
      screen.queryByRole('dialog', { name: /new session/i })
    ).not.toBeInTheDocument()

    await user.click(screen.getByTestId('sidebar-new-session'))

    await waitFor(() => {
      expect(
        screen.getByRole('dialog', { name: /new session/i })
      ).toBeInTheDocument()
    })
    // Opening the dialog must NOT create a session — that only happens on Create.
    expect(mockSessionManager.createSession).not.toHaveBeenCalled()
  })

  test('the new-session chord opens the dialog without instant-creating', async () => {
    // The harness sets navigator.platform to Linux, so preferModifier is
    // 'ctrl' and the reserved chord is Ctrl+⇧N.
    const user = userEvent.setup()
    render(<WorkspaceView />)

    expect(
      screen.queryByRole('dialog', { name: /new session/i })
    ).not.toBeInTheDocument()

    await user.keyboard('{Control>}{Shift>}n{/Shift}{/Control}')

    await waitFor(() => {
      expect(
        screen.getByRole('dialog', { name: /new session/i })
      ).toBeInTheDocument()
    })
    expect(mockSessionManager.createSession).not.toHaveBeenCalled()
  })

  test('forwards pane lifecycle handlers to TerminalZone', () => {
    render(<WorkspaceView />)

    expect(terminalZonePropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        addPane: mockSessionManager.addPane,
        removePane: mockSessionManager.removePane,
      })
    )
  })

  test('occludes browser panes while the command palette is open', async () => {
    render(<WorkspaceView />)

    expect(latestOverlayRegistrationProps().commandPaletteOpen).toBe(false)

    openPalette()

    await waitFor(() => {
      expect(latestOverlayRegistrationProps().commandPaletteOpen).toBe(true)
    })
  })

  test('occludes browser panes while a burner terminal popup is visible', async () => {
    const { useBurnerTerminals } =
      await import('@/features/terminal/hooks/useBurnerTerminals')
    vi.mocked(useBurnerTerminals).mockReturnValue({
      renderNode: <div data-testid="burner-terminal-popup" />,
      toggle: vi.fn().mockResolvedValue(undefined),
      syncToPaneCwd: vi.fn(),
      cyclePlacement: vi.fn(),
      placementByPane: new Map(),
      runningByPane: new Map(),
      activeByPane: new Map(),
      outOfSyncByPane: new Map(),
      hasVisibleBurner: true,
      visibleBurnerPaneKey: 'session-1:p0',
    })

    render(<WorkspaceView />)

    expect(latestOverlayRegistrationProps().burnerTerminalOpen).toBe(true)
  })

  test('records detected agent type on the active session', async () => {
    const { useAgentStatus } =
      await import('@/features/agent-status/hooks/useAgentStatus')
    vi.mocked(useAgentStatus).mockReturnValue({
      isActive: true,
      agentExited: false,
      agentType: 'codex',
      modelId: null,
      modelDisplayName: null,
      version: null,
      sessionId: 'pty-session-1',
      agentSessionId: null,
      cwd: null,
      contextWindow: null,
      cost: null,
      rateLimits: null,
      numTurns: 0,
      toolCalls: { total: 0, byType: {}, active: null },
      recentToolCalls: [],
      testRun: null,
    })

    render(<WorkspaceView />)

    await waitFor(() =>
      expect(mockSessionManager.updatePaneAgentType).toHaveBeenCalledWith(
        'session-1',
        'p0',
        'codex'
      )
    )
  })

  test('invalidates the active Codex identity only for context switches', async () => {
    const { useAgentStatus } =
      await import('@/features/agent-status/hooks/useAgentStatus')
    vi.mocked(useAgentStatus).mockReturnValue(
      createAgentStatus({
        isActive: true,
        agentType: 'codex',
        sessionId: 'pty-session-1',
        agentSessionId: 'codex-session-1',
        contextWindow: {
          usedPercentage: 10,
          contextWindowSize: 200000,
          totalInputTokens: 1200,
          totalOutputTokens: 300,
          currentUsage: null,
        },
      })
    )

    render(<WorkspaceView />)

    act(() => {
      latestTerminalZoneProps().onCommandSubmit?.('pty-session-1', '/resume')
    })

    expect(mockSessionManager.invalidatePaneAgentSession).toHaveBeenCalledWith(
      'session-1',
      'p0',
      'codex-session-1',
      1500
    )

    vi.mocked(mockSessionManager.invalidatePaneAgentSession).mockClear()
    act(() => {
      latestTerminalZoneProps().onCommandSubmit?.('pty-session-1', 'status')
    })

    expect(mockSessionManager.invalidatePaneAgentSession).not.toHaveBeenCalled()
  })

  test('resets active pane chrome to shell after a detected agent exits', async () => {
    const activeSession = mockSessions[0]
    mockSessions[0] = {
      ...activeSession,
      agentType: 'codex',
      panes: activeSession.panes.map((pane) => ({
        ...pane,
        agentType: 'codex',
      })),
    }

    const { useAgentStatus } =
      await import('@/features/agent-status/hooks/useAgentStatus')
    vi.mocked(useAgentStatus).mockReturnValue({
      isActive: true,
      agentExited: true,
      agentType: 'codex',
      modelId: null,
      modelDisplayName: null,
      version: null,
      sessionId: 'pty-session-1',
      agentSessionId: null,
      cwd: null,
      contextWindow: null,
      cost: null,
      rateLimits: null,
      numTurns: 0,
      toolCalls: { total: 0, byType: {}, active: null },
      recentToolCalls: [],
      testRun: null,
    })

    render(<WorkspaceView />)

    await waitFor(() =>
      expect(mockSessionManager.updatePaneAgentType).toHaveBeenCalledWith(
        'session-1',
        'p0',
        'generic'
      )
    )
  })

  test('does not reset pane chrome before detection reports an agent', () => {
    render(<WorkspaceView />)

    expect(mockSessionManager.updatePaneAgentType).not.toHaveBeenCalled()
  })

  test('does not apply stale agent status from another session to the active shell session', async () => {
    mockSessions[1] = {
      ...mockSessions[1],
      agentType: 'generic',
    }
    mockSessionManager.activeSessionId = 'session-2'

    const { useAgentStatus } =
      await import('@/features/agent-status/hooks/useAgentStatus')
    vi.mocked(useAgentStatus).mockReturnValue({
      isActive: true,
      agentExited: false,
      agentType: 'claude-code',
      modelId: null,
      modelDisplayName: null,
      version: null,
      sessionId: 'pty-session-1',
      agentSessionId: null,
      cwd: null,
      contextWindow: null,
      cost: null,
      rateLimits: null,
      numTurns: 0,
      toolCalls: { total: 0, byType: {}, active: null },
      recentToolCalls: [],
      testRun: null,
    })

    render(<WorkspaceView />)

    // The main session-tab strip is gone, so there is no per-tab agent glyph
    // to inspect. The guard under test is purely that the stale claude-code
    // status never re-stamps the active generic pane.
    expect(mockSessionManager.updatePaneAgentType).not.toHaveBeenCalled()
  })

  test('hides status bar context and turns when selected pane has no active agent', () => {
    render(<WorkspaceView />)

    expect(screen.queryByTestId('status-bar-context')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-bar-turns')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-bar-cache')).not.toBeInTheDocument()
    expect(screen.getByTestId('status-bar-palette')).toBeInTheDocument()
  })

  test('shows status bar context and turns for the selected pane active agent', async () => {
    const { useAgentStatus } =
      await import('@/features/agent-status/hooks/useAgentStatus')
    vi.mocked(useAgentStatus).mockReturnValue(
      createAgentStatus({
        isActive: true,
        agentExited: false,
        agentType: 'claude-code',
        sessionId: 'pty-session-1',
        contextWindow: {
          usedPercentage: 66,
          contextWindowSize: 200000,
          totalInputTokens: 120000,
          totalOutputTokens: 12000,
          currentUsage: {
            inputTokens: 2500,
            outputTokens: 500,
            cacheCreationInputTokens: 1000,
            cacheReadInputTokens: 7000,
          },
        },
        cost: {
          totalCostUsd: null,
          totalDurationMs: 4 * 60 * 60 * 1000,
          totalApiDurationMs: 0,
          totalLinesAdded: 0,
          totalLinesRemoved: 0,
        },
        numTurns: 28,
      })
    )

    render(<WorkspaceView />)

    expect(screen.getByTestId('status-bar-context')).toHaveTextContent('66%')
    expect(screen.getByTestId('status-bar-turns')).toHaveTextContent('28 turns')
  })

  test('hides status bar context and turns for active agent status from another pane', async () => {
    const { useAgentStatus } =
      await import('@/features/agent-status/hooks/useAgentStatus')
    vi.mocked(useAgentStatus).mockReturnValue(
      createAgentStatus({
        isActive: true,
        agentExited: false,
        agentType: 'claude-code',
        sessionId: 'pty-session-2',
        contextWindow: {
          usedPercentage: 92,
          contextWindowSize: 200000,
          totalInputTokens: 180000,
          totalOutputTokens: 4000,
          currentUsage: null,
        },
        numTurns: 99,
      })
    )

    render(<WorkspaceView />)

    expect(screen.queryByTestId('status-bar-context')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-bar-turns')).not.toBeInTheDocument()
  })

  test('hides the status bar context before the first contextWindow payload', async () => {
    const { useAgentStatus } =
      await import('@/features/agent-status/hooks/useAgentStatus')
    vi.mocked(useAgentStatus).mockReturnValue(
      createAgentStatus({
        isActive: true,
        agentExited: false,
        agentType: 'claude-code',
        sessionId: 'pty-session-1',
        // Agent has started but has not reported a context window yet.
        contextWindow: null,
        numTurns: 12,
      })
    )

    render(<WorkspaceView />)

    // Turns render (agent active on the selected pane) but the context segment
    // is omitted rather than shown as a misleading 😊0%.
    expect(screen.getByTestId('status-bar-turns')).toHaveTextContent('12 turns')
    expect(screen.queryByTestId('status-bar-context')).not.toBeInTheDocument()
  })

  test('shows a <1m duration for a sub-minute agent session', async () => {
    const { useAgentStatus } =
      await import('@/features/agent-status/hooks/useAgentStatus')
    vi.mocked(useAgentStatus).mockReturnValue(
      createAgentStatus({
        isActive: true,
        agentExited: false,
        agentType: 'claude-code',
        sessionId: 'pty-session-1',
        cost: {
          totalCostUsd: null,
          totalDurationMs: 30_000,
          totalApiDurationMs: 0,
          totalLinesAdded: 0,
          totalLinesRemoved: 0,
        },
        numTurns: 1,
      })
    )

    render(<WorkspaceView />)

    // A freshly started agent (30s elapsed) shows <1m instead of a blank bar.
    expect(screen.getByTestId('status-bar-duration')).toHaveTextContent('<1m')
  })

  test(':close command removes active session', async () => {
    const user = userEvent.setup()
    render(<WorkspaceView />)

    openPalette()

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    const input = screen.getByRole('combobox', {
      name: 'Command palette search',
    })
    await user.clear(input)
    await user.type(input, ':close')
    await user.keyboard('{Enter}')

    expect(mockSessionManager.removeSession).toHaveBeenCalledWith('session-1')

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  test(':close command respects dirty-session guard', async () => {
    const user = userEvent.setup()
    const hasUnsavedChanges = vi.fn(() => true)

    const { useEditorBuffer } =
      await import('@/features/editor/hooks/useEditorBuffer')

    vi.mocked(useEditorBuffer).mockReturnValue({
      filePath: 'src/current.ts',
      originalContent: 'original',
      currentContent: 'edits',
      isDirty: true,
      isLoading: false,
      openFile: vi.fn(),
      saveFile: vi.fn(),
      updateContent: vi.fn(),
      hasUnsavedChanges,
      getFilePathForScope: vi.fn(() => null),
      releaseScope: vi.fn(),
    })

    render(<WorkspaceView />)

    openPalette()

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    const input = screen.getByRole('combobox', {
      name: 'Command palette search',
    })
    await user.clear(input)
    await user.type(input, ':close')
    await user.keyboard('{Enter}')

    expect(hasUnsavedChanges).toHaveBeenCalledWith('session-1')
    expect(mockSessionManager.removeSession).not.toHaveBeenCalled()
  })

  test(':edit command respects dirty buffer guard', async () => {
    const user = userEvent.setup()
    const openFile = vi.fn()

    const { useEditorBuffer } =
      await import('@/features/editor/hooks/useEditorBuffer')

    vi.mocked(useEditorBuffer).mockReturnValue({
      filePath: 'src/current.ts',
      originalContent: 'original',
      currentContent: 'edits',
      isDirty: true,
      isLoading: false,
      openFile,
      saveFile: vi.fn(),
      updateContent: vi.fn(),
      hasUnsavedChanges: vi.fn(() => true),
      getFilePathForScope: vi.fn(() => null),
      releaseScope: vi.fn(),
    })

    rtlRender(<WorkspaceView />, { wrapper: VimKeymapProvider })

    openPalette()

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    const input = screen.getByRole('combobox', {
      name: 'Command palette search',
    })
    await user.clear(input)
    await user.type(input, ':edit src/other.ts')
    await user.keyboard('{Enter}')

    expect(openFile).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.getByTestId('unsaved-changes-dialog')).toBeInTheDocument()
    })
  })

  test(':open-file respects the dirty-buffer guard', async () => {
    const user = userEvent.setup()
    const openFile = vi.fn()

    const { useEditorBuffer } =
      await import('@/features/editor/hooks/useEditorBuffer')

    vi.mocked(useEditorBuffer).mockReturnValue({
      filePath: 'src/current.ts',
      originalContent: 'original',
      currentContent: 'edits',
      isDirty: true,
      isLoading: false,
      openFile,
      saveFile: vi.fn(),
      updateContent: vi.fn(),
      hasUnsavedChanges: vi.fn(() => true),
      getFilePathForScope: vi.fn(() => null),
      releaseScope: vi.fn(),
    })

    render(<WorkspaceView />)

    openPalette()

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    const input = screen.getByRole('combobox', {
      name: 'Command palette search',
    })
    terminalFocusActivePaneSpy.mockClear()
    await user.clear(input)
    await user.type(input, ':open-file /tmp/notes.md')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.getByTestId('unsaved-changes-dialog')).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Command palette' })
      ).toBeNull()
    })
    expect(terminalFocusActivePaneSpy).not.toHaveBeenCalled()
    expect(openFile).not.toHaveBeenCalled()
  })

  test(':open-file surfaces the editor after dirty-buffer save', async () => {
    const user = userEvent.setup()
    const openFile = vi.fn()

    const { useEditorBuffer } =
      await import('@/features/editor/hooks/useEditorBuffer')

    vi.mocked(useEditorBuffer).mockReturnValue({
      filePath: 'src/current.ts',
      originalContent: 'original',
      currentContent: 'edits',
      isDirty: true,
      isLoading: false,
      openFile,
      saveFile: vi.fn(),
      updateContent: vi.fn(),
      hasUnsavedChanges: vi.fn(() => true),
      getFilePathForScope: vi.fn(() => null),
      releaseScope: vi.fn(),
    })

    render(<WorkspaceView />)

    openPalette()

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    const input = screen.getByRole('combobox', {
      name: 'Command palette search',
    })
    await user.clear(input)
    await user.type(input, ':open-file /tmp/notes.md')
    await user.keyboard('{Enter}')

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(openFile).toHaveBeenCalledWith('/tmp/notes.md')
    })

    expect(screen.getByTestId('dock-panel')).toHaveAttribute(
      'data-tab',
      'editor'
    )
  })

  test('does not open the palette while the unsaved dialog is active', async () => {
    const user = userEvent.setup()
    const hasUnsavedChanges = vi.fn(() => true)

    const { useEditorBuffer } =
      await import('@/features/editor/hooks/useEditorBuffer')

    vi.mocked(useEditorBuffer).mockReturnValue({
      filePath: 'src/current.ts',
      originalContent: 'original',
      currentContent: 'edits',
      isDirty: true,
      isLoading: false,
      openFile: vi.fn(),
      saveFile: vi.fn(),
      updateContent: vi.fn(),
      hasUnsavedChanges,
      getFilePathForScope: vi.fn(() => null),
      releaseScope: vi.fn(),
    })

    render(<WorkspaceView />)

    openPalette()

    await waitFor(() => {
      expect(
        screen.getByRole('dialog', { name: 'Command palette' })
      ).toBeInTheDocument()
    })

    const input = screen.getByRole('combobox', {
      name: 'Command palette search',
    })
    await user.clear(input)
    await user.type(input, ':close')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.getByTestId('unsaved-changes-dialog')).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Command palette' })
      ).not.toBeInTheDocument()
    })

    openPalette()
    expect(
      screen.queryByRole('dialog', { name: 'Command palette' })
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: /open command palette/i })
    )

    expect(
      screen.queryByRole('dialog', { name: 'Command palette' })
    ).not.toBeInTheDocument()
    expect(mockSessionManager.setActiveSessionId).not.toHaveBeenCalled()
  })

  test(':rename-session foo command renames active session', async () => {
    const user = userEvent.setup()
    render(<WorkspaceView />)

    openPalette()

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    const input = screen.getByRole('combobox', {
      name: 'Command palette search',
    })
    await user.clear(input)
    await user.type(input, ':rename-session foo')
    await user.keyboard('{Enter}')

    expect(mockSessionManager.renameSession).toHaveBeenCalledWith(
      'session-1',
      'foo'
    )

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  test(':rename-pane left labels only the active pane', async () => {
    const user = userEvent.setup()
    render(<WorkspaceView />)

    openPalette()

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    const input = screen.getByRole('combobox', {
      name: 'Command palette search',
    })
    await user.clear(input)
    await user.type(input, ':rename-pane left')
    await user.keyboard('{Enter}')

    expect(mockSessionManager.setPaneUserLabel).toHaveBeenCalled()
    expect(mockSessionManager.renameSession).not.toHaveBeenCalled()
  })

  test('native Ghostty rename event opens the pane rename editor', async () => {
    render(<WorkspaceView />)

    await waitFor(() => {
      expect(backendListeners.has('ghostty-native-rename-pane')).toBe(true)
    })

    act(() => {
      backendListeners.get('ghostty-native-rename-pane')?.({
        sessionId: 'pty-session-1',
        paneId: 'p0',
      })
    })

    expect(mockSessionManager.setActiveSessionId).toHaveBeenCalledWith(
      'session-1'
    )

    expect(mockSessionManager.setSessionActivePane).toHaveBeenCalledWith(
      'session-1',
      'p0'
    )

    expect(screen.getByRole('textbox', { name: 'Pane name' })).toHaveValue(
      'main'
    )
  })

  test(':next command switches to next session', async () => {
    const user = userEvent.setup()
    render(<WorkspaceView />)

    openPalette()

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    const input = screen.getByRole('combobox', {
      name: 'Command palette search',
    })
    await user.clear(input)
    await user.type(input, ':next')
    await user.keyboard('{Enter}')

    expect(mockSessionManager.setActiveSessionId).toHaveBeenCalledWith(
      'session-2'
    )

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  test(':previous command switches to previous session', async () => {
    const user = userEvent.setup()
    render(<WorkspaceView />)

    openPalette()

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    const input = screen.getByRole('combobox', {
      name: 'Command palette search',
    })
    await user.clear(input)
    await user.type(input, ':previous')
    await user.keyboard('{Enter}')

    // From session-1, previous wraps to session-3 (last)
    expect(mockSessionManager.setActiveSessionId).toHaveBeenCalledWith(
      'session-3'
    )

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  test(':goto 2 command switches to session at index 2', async () => {
    const user = userEvent.setup()
    render(<WorkspaceView />)

    openPalette()

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    const input = screen.getByRole('combobox', {
      name: 'Command palette search',
    })
    await user.clear(input)
    await user.type(input, ':goto 2')
    await user.keyboard('{Enter}')

    // :goto uses 1-based indexing, so 2 → sessions[1]
    expect(mockSessionManager.setActiveSessionId).toHaveBeenCalledWith(
      'session-2'
    )

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  test(':show-sessions opens the sidebar drawer on a compact viewport', async () => {
    const user = userEvent.setup()
    const originalMatchMedia = window.matchMedia
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addListener: (): void => {
          // No-op
        },
        removeListener: (): void => {
          // No-op
        },
        addEventListener: (): void => {
          // No-op
        },
        removeEventListener: (): void => {
          // No-op
        },
        dispatchEvent: (): boolean => false,
      }),
    })

    try {
      render(<WorkspaceView />)

      await waitFor(() => {
        expect(
          screen.queryByRole('dialog', { name: 'Sidebar' })
        ).not.toBeInTheDocument()
      })

      openPalette()

      await waitFor(() => {
        expect(
          screen.getByRole('dialog', { name: 'Command palette' })
        ).toBeInTheDocument()
      })

      const input = screen.getByRole('combobox', {
        name: 'Command palette search',
      })
      await user.clear(input)
      await user.type(input, ':show-sessions')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(
          screen.getByRole('dialog', { name: 'Sidebar' })
        ).toBeInTheDocument()
      })
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: originalMatchMedia,
      })
    }
  })

  test('status-bar command button opens the palette', async () => {
    const user = userEvent.setup()
    render(<WorkspaceView />)

    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull()

    await user.click(
      screen.getByRole('button', { name: /open command palette/i })
    )

    expect(
      screen.getByRole('dialog', { name: 'Command palette' })
    ).toBeInTheDocument()
  })

  test('does not append a stale pane reading when agentStatus.sessionId mismatches the active pane', async () => {
    const { useAgentStatus } =
      await import('@/features/agent-status/hooks/useAgentStatus')
    vi.mocked(useAgentStatus).mockReturnValue(
      createAgentStatus({
        sessionId: 'pty-stale',
        contextWindow: {
          usedPercentage: 10,
          contextWindowSize: 200000,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          currentUsage: {
            inputTokens: 700,
            outputTokens: 0,
            cacheCreationInputTokens: 1800,
            cacheReadInputTokens: 7500,
          },
        },
      })
    )

    render(<WorkspaceView />)

    expect(await screen.findByTestId('terminal-zone')).toBeInTheDocument()
    expect(mockSessionManager.appendPaneCacheReading).not.toHaveBeenCalled()
  })

  test('appends the reading when agentStatus.sessionId matches the active pane', async () => {
    const { useAgentStatus } =
      await import('@/features/agent-status/hooks/useAgentStatus')
    vi.mocked(useAgentStatus).mockReturnValue(
      createAgentStatus({
        sessionId: 'pty-session-1',
        contextWindow: {
          usedPercentage: 10,
          contextWindowSize: 200000,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          currentUsage: {
            inputTokens: 700,
            outputTokens: 0,
            cacheCreationInputTokens: 1800,
            cacheReadInputTokens: 7500,
          },
        },
      })
    )

    render(<WorkspaceView />)

    await waitFor(() =>
      expect(mockSessionManager.appendPaneCacheReading).toHaveBeenCalledWith(
        'session-1',
        'p0',
        75
      )
    )
  })
})
