import { render, screen, waitFor, act, within } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { WorkspaceView } from './WorkspaceView'
import type { SessionManager } from '../sessions/hooks/useSessionManager'
import type { Session } from '../sessions/types'
import { AGENTS } from '../../agents/registry'
import type { TerminalZoneProps } from './components/TerminalZone'

const terminalZonePropsSpy = vi.hoisted(() => vi.fn())

// Mock all WorkspaceView dependencies
vi.mock('../sessions/hooks/useSessionManager')
vi.mock('../../hooks/useResizable')
vi.mock('./hooks/useNotifyInfo')
vi.mock('../agent-status/hooks/useAgentStatus')
vi.mock('../diff/hooks/useGitStatus')
vi.mock('../editor/hooks/useEditorBuffer')
vi.mock('../files/services/fileSystemService')
vi.mock('../terminal/services/terminalService')
vi.mock('../terminal/hooks/usePaneShortcuts')

// Mock child components to keep test focused on integration
vi.mock('./components/IconRail', () => ({
  IconRail: (): ReactElement => <div data-testid="icon-rail" />,
}))

vi.mock('../../components/sidebar/Sidebar', () => ({
  Sidebar: (): ReactElement => <div data-testid="sidebar" />,
}))

vi.mock('./components/TerminalZone', () => ({
  TerminalZone: (props: TerminalZoneProps): ReactElement => {
    terminalZonePropsSpy(props)

    return <div data-testid="terminal-zone" />
  },
}))

vi.mock('./components/BottomDrawer', () => ({
  default: (): ReactElement => <div data-testid="bottom-drawer" />,
}))

vi.mock('../agent-status/components/AgentStatusPanel', () => ({
  AgentStatusPanel: (): ReactElement => (
    <div data-testid="agent-status-panel" />
  ),
}))

vi.mock('../editor/components/UnsavedChangesDialog', () => ({
  UnsavedChangesDialog: (): ReactElement => <div />,
}))

const createMockSession = (id: string, name: string): Session => ({
  id,
  projectId: 'proj-1',
  name,
  status: 'running',
  workingDirectory: '/home/user',
  agentType: 'claude-code',
  layout: 'single',
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

describe('WorkspaceView - Command Palette Integration', () => {
  let mockSessionManager: SessionManager
  let mockSessions: Session[]

  beforeEach(async () => {
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
      removeSession: vi.fn(),
      setSessionLayout: vi.fn(),
      setSessionActivePane: vi.fn(),
      addPane: vi.fn(),
      removePane: vi.fn(),
      restartSession: vi.fn(),
      renameSession: vi.fn(),
      reorderSessions: vi.fn(),
      updatePaneCwd: vi.fn(),
      updatePaneAgentType: vi.fn(),
      updateSessionCwd: vi.fn(),
      updateSessionAgentType: vi.fn(),
      restoreData: new Map(),
      loading: false,
      notifyPaneReady: vi.fn(),
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
    vi.mocked(useAgentStatus).mockReturnValue({
      isActive: false,
      agentType: null,
      modelId: null,
      modelDisplayName: null,
      version: null,
      sessionId: 'pty-session-1',
      agentSessionId: null,
      contextWindow: null,
      cost: null,
      rateLimits: null,
      numTurns: 0,
      toolCalls: { total: 0, byType: {}, active: null },
      recentToolCalls: [],
      testRun: null,
    })

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
      listSessions: vi.fn().mockResolvedValue({
        activeSessionId: null,
        sessions: [],
      }),
      setActiveSession: vi.fn().mockResolvedValue(undefined),
      reorderSessions: vi.fn().mockResolvedValue(undefined),
      updateSessionCwd: vi.fn().mockResolvedValue(undefined),
    })
  })

  const openPalette = (): void => {
    act(() => {
      const event = new KeyboardEvent('keydown', {
        key: ':',
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
      agentType: 'codex',
      modelId: null,
      modelDisplayName: null,
      version: null,
      sessionId: 'pty-session-1',
      agentSessionId: null,
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
      agentType: 'claude-code',
      modelId: null,
      modelDisplayName: null,
      version: null,
      sessionId: 'pty-session-1',
      agentSessionId: null,
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

  test(':rename foo command renames active session', async () => {
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
    await user.type(input, ':rename foo')
    await user.keyboard('{Enter}')

    expect(mockSessionManager.renameSession).toHaveBeenCalledWith(
      'session-1',
      'foo'
    )

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
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
})
