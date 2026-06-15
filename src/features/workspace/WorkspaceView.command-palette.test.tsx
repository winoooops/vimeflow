import {
  render as rtlRender,
  screen,
  waitFor,
  act,
  within,
} from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { useState, type ReactElement, type ReactNode } from 'react'
import { WorkspaceView } from './WorkspaceView'
import { SettingsProvider, SettingsContext } from '../settings/SettingsProvider'
import { DEFAULT_SETTINGS } from '../settings/store/settingsDefaults'
import type { AppSettings } from '../../bindings/AppSettings'
import type { SessionManager } from '../sessions/hooks/useSessionManager'
import type { AgentStatus } from '../agent-status/types'
import type { Session } from '../sessions/types'
import { AGENTS } from '../../agents/registry'
import type { TerminalZoneProps } from './components/TerminalZone'

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

// Mock all WorkspaceView dependencies
vi.mock('../sessions/hooks/useSessionManager')
vi.mock('../../lib/backend', () => ({
  renameAgentSession: vi.fn().mockResolvedValue(undefined),
  // Stubs for any other backend functions imported by the workspace tree.
  // listen/invoke return inert no-ops so the WorkspaceView mount under
  // jsdom doesn't try to reach a real bridge.
  listen: vi.fn(() =>
    Promise.resolve(() => {
      /* no-op unlisten */
    })
  ),
  invoke: vi.fn().mockResolvedValue(null),
  // useCommandPalette subscribes to the Electron main-process palette toggle
  // override on mount; return a synchronous no-op unlisten so the
  // WorkspaceView tree mounts without reaching a real bridge.
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

// Mock child components to keep test focused on command dispatch while still
// rendering sidebar chrome needed by WorkspaceView.
vi.mock('../../components/sidebar/Sidebar', () => ({
  Sidebar: ({ topBar = undefined }: { topBar?: ReactNode }): ReactElement => (
    <div data-testid="sidebar">{topBar}</div>
  ),
}))

vi.mock('./components/TerminalZone', () => ({
  TerminalZone: (props: TerminalZoneProps): ReactElement => {
    terminalZonePropsSpy(props)

    return <div data-testid="terminal-zone" />
  },
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
  UnsavedChangesDialog: ({
    isOpen,
  }: {
    isOpen: boolean
  }): ReactElement | null =>
    isOpen ? <div data-testid="unsaved-changes-dialog" /> : null,
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
      setSessionLayout: vi.fn(),
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
      setSessionActivityPanelCollapsed: vi.fn(),
      updateSessionCwd: vi.fn(),
      updateSessionAgentType: vi.fn(),
      restoreData: new Map(),
      loading: false,
      notifyPaneReady: vi.fn(),
      registerPending: vi.fn(),
      dropAllForPty: vi.fn(),
    }

    // Mock useSessionManager
    const { useSessionManager } =
      await import('../sessions/hooks/useSessionManager')
    vi.mocked(useSessionManager).mockReturnValue(mockSessionManager)

    // Mock useResizable
    const { useResizable } = await import('../../hooks/useResizable')
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
      await import('../agent-status/hooks/useAgentStatus')
    vi.mocked(useAgentStatus).mockReturnValue(
      createAgentStatus({ sessionId: 'pty-session-1' })
    )

    // Mock useGitStatus
    const { useGitStatus } = await import('../diff/hooks/useGitStatus')
    vi.mocked(useGitStatus).mockReturnValue({
      files: [],
      filesCwd: null,
      loading: false,
      error: null,
      refresh: vi.fn(),
      idle: true,
    })

    // Mock useEditorBuffer
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

    // Mock fileSystemService
    const { createFileSystemService } =
      await import('../files/services/fileSystemService')
    vi.mocked(createFileSystemService).mockReturnValue({
      listDir: vi.fn().mockResolvedValue([]),
      readFile: vi.fn().mockResolvedValue(''),
      writeFile: vi.fn().mockResolvedValue(undefined),
    })

    // Mock terminalService
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
  })

  const openPalette = (): void => {
    act(() => {
      const event = new KeyboardEvent('keydown', {
        key: ';',
        ctrlKey: true,
        bubbles: true,
      })
      document.dispatchEvent(event)
    })
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

  test('forwards pane lifecycle handlers to TerminalZone', () => {
    render(<WorkspaceView />)

    expect(terminalZonePropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        addPane: mockSessionManager.addPane,
        removePane: mockSessionManager.removePane,
      })
    )
  })

  test('records detected agent type on the active session', async () => {
    const { useAgentStatus } =
      await import('../agent-status/hooks/useAgentStatus')
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
      await import('../agent-status/hooks/useAgentStatus')
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

  test('does not apply stale agent status from another session to the active shell tab', async () => {
    mockSessions[1] = {
      ...mockSessions[1],
      agentType: 'generic',
    }
    mockSessionManager.activeSessionId = 'session-2'

    const { useAgentStatus } =
      await import('../agent-status/hooks/useAgentStatus')
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

    const activeTab = screen.getByRole('tab', { name: 'feature' })
    expect(within(activeTab).getByText(AGENTS.shell.glyph)).toBeInTheDocument()
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
      await import('../agent-status/hooks/useAgentStatus')
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
      await import('../agent-status/hooks/useAgentStatus')
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
      await import('../agent-status/hooks/useAgentStatus')
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
      await import('../agent-status/hooks/useAgentStatus')
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
    const { useEditorBuffer } = await import('../editor/hooks/useEditorBuffer')

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
    const { useEditorBuffer } = await import('../editor/hooks/useEditorBuffer')

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

  test('does not open the palette while the unsaved dialog is active', async () => {
    const user = userEvent.setup()
    const hasUnsavedChanges = vi.fn(() => true)
    const { useEditorBuffer } = await import('../editor/hooks/useEditorBuffer')

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
      await import('../agent-status/hooks/useAgentStatus')
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
      await import('../agent-status/hooks/useAgentStatus')
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
