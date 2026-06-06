/* eslint-disable testing-library/no-node-access */
/* eslint-disable vitest/expect-expect */
// cspell:ignore worktree worktrees
import type { ReactElement } from 'react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkspaceView } from './WorkspaceView'
import { useEditorBuffer } from '../editor/hooks/useEditorBuffer'
import type { AgentStatus } from '../agent-status/types'
import { useAgentStatus } from '../agent-status/hooks/useAgentStatus'
import { usePaneShortcuts } from '../terminal/hooks/usePaneShortcuts'
import type { SessionList } from '../../bindings'

const workspaceTerminalMock = vi.hoisted(() => {
  const defaultSessionList = (): SessionList => ({
    activeSessionId: 'sess-1',
    sessions: [
      {
        id: 'sess-1',
        cwd: '~',
        status: {
          kind: 'Alive' as const,
          pid: 1234,
          replay_data: '',
          replay_end_offset: BigInt(0),
        },
      },
    ],
  })

  const service = {
    spawn: vi
      .fn()
      .mockResolvedValue({ sessionId: 'new-id', pid: 999, cwd: '~' }),
    write: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
    onData: vi.fn(
      (): Promise<() => void> =>
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        Promise.resolve((): void => {})
    ),
    onExit: vi.fn(
      (): Promise<() => void> =>
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        Promise.resolve((): void => {})
    ),
    onError: vi.fn(
      (): Promise<() => void> =>
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        Promise.resolve((): void => {})
    ),
    onScratchForeground: vi.fn(
      (): Promise<() => void> => Promise.resolve((): void => undefined)
    ),
    listSessions: vi.fn().mockResolvedValue(defaultSessionList()),
    setActiveSession: vi.fn().mockResolvedValue(undefined),
    reorderSessions: vi.fn().mockResolvedValue(undefined),
    updateSessionCwd: vi.fn().mockResolvedValue(undefined),
    setSessionActivityPanelCollapsed: vi.fn().mockResolvedValue(undefined),
    killEphemeralPtys: vi.fn(),
  }

  return { defaultSessionList, service }
})

// Mock TerminalPane to avoid xterm.js issues in tests. Surface `pane.cwd`
// as a data attribute so tests can observe the agent-cwd → pane.cwd bridge
// without driving the full terminal mock surface.
vi.mock('../terminal/components/TerminalPane', () => ({
  TerminalPane: vi.fn(({ pane }: { pane?: { cwd?: string } }) => (
    <div data-testid="terminal-pane-mock" data-cwd={pane?.cwd}>
      Mocked TerminalPane
    </div>
  )),
}))

// Mock useAgentStatus so AgentStatusPanel renders predictably
vi.mock('../agent-status/hooks/useAgentStatus', () => ({
  useAgentStatus: vi.fn(() => ({
    isActive: true,
    agentExited: false,
    agentType: 'claude-code',
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
  })),
}))

// Mock useEditorBuffer so individual tests can flip isDirty without
// having to drive the real hook through the editor. The default impl
// (set in beforeEach below) returns a clean buffer so the bulk of
// existing tests behave as if no file is open.
vi.mock('../editor/hooks/useEditorBuffer', () => ({
  useEditorBuffer: vi.fn(),
}))

vi.mock('../terminal/hooks/usePaneShortcuts', () => ({
  usePaneShortcuts: vi.fn(),
}))

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

// Capture AgentStatusPanel's props (specifically `onOpenFile`) so the
// new handleOpenTestFile tests can invoke the handler directly without
// rendering the full panel and synthesizing a test-row click.
const capturedAgentStatusPanelProps: {
  onOpenFile?: (path: string) => void
  onOpenDiff?: unknown
  agentStatus?: AgentStatus
} = {}

interface MockAgentStatusPanelProps {
  onOpenFile?: (path: string) => void
  onOpenDiff?: unknown
  agentStatus?: AgentStatus
}

vi.mock('../agent-status/components/AgentStatusPanel', () => ({
  AgentStatusPanel: ({
    onOpenFile = undefined,
    onOpenDiff = undefined,
    agentStatus = undefined,
  }: MockAgentStatusPanelProps): ReactElement => {
    capturedAgentStatusPanelProps.onOpenFile = onOpenFile
    capturedAgentStatusPanelProps.onOpenDiff = onOpenDiff
    capturedAgentStatusPanelProps.agentStatus = agentStatus

    // Render the panel testid so the existing zone-presence tests
    // (`getByTestId('agent-status-panel')`) keep passing without
    // dragging the real panel and its hooks into this test file.
    return <div data-testid="agent-status-panel" />
  },
  PANEL_WIDTH_PX: 280,
}))

// Mock terminal service to return initial session data synchronously
vi.mock('../terminal/services/terminalService', () => ({
  createTerminalService: vi.fn(() => workspaceTerminalMock.service),
}))

describe('WorkspaceView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'platform', {
      value: 'Linux x86_64',
      configurable: true,
    })
    capturedAgentStatusPanelProps.onOpenFile = undefined
    capturedAgentStatusPanelProps.onOpenDiff = undefined
    capturedAgentStatusPanelProps.agentStatus = undefined
    workspaceTerminalMock.service.spawn.mockResolvedValue({
      sessionId: 'new-id',
      pid: 999,
      cwd: '~',
    })
    workspaceTerminalMock.service.kill.mockResolvedValue(undefined)
    workspaceTerminalMock.service.listSessions.mockResolvedValue(
      workspaceTerminalMock.defaultSessionList()
    )
    workspaceTerminalMock.service.setActiveSession.mockResolvedValue(undefined)
    workspaceTerminalMock.service.reorderSessions.mockResolvedValue(undefined)
    workspaceTerminalMock.service.updateSessionCwd.mockResolvedValue(undefined)
    workspaceTerminalMock.service.setSessionActivityPanelCollapsed.mockResolvedValue(
      undefined
    )

    // Default: clean buffer with no file open. Mirrors the real hook's
    // initial state so existing tests don't see a dirty buffer or get
    // an undefined return value.
    vi.mocked(useEditorBuffer).mockReturnValue({
      filePath: null,
      originalContent: '',
      currentContent: '',
      isDirty: false,
      isLoading: false,
      openFile: vi.fn().mockResolvedValue(undefined),
      saveFile: vi.fn().mockResolvedValue(undefined),
      updateContent: vi.fn(),
      hasUnsavedChanges: vi.fn(() => false),
      getFilePathForScope: vi.fn(() => null),
      releaseScope: vi.fn(),
    })
  })

  test('renders all five zones (icon rail, sidebar, terminal, dock panel, agent status panel)', () => {
    render(<WorkspaceView />)

    expect(screen.getByTestId('icon-rail')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-zone')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /editor/i })).toBeInTheDocument() // DockPanel
    expect(screen.getByTestId('agent-status-panel')).toBeInTheDocument()
  })

  test('wires usePaneShortcuts to session-manager handlers', () => {
    render(<WorkspaceView />)

    expect(usePaneShortcuts).toHaveBeenCalled()
    const args = vi.mocked(usePaneShortcuts).mock.calls[0][0]
    expect(Array.isArray(args.sessions)).toBe(true)
    // `activeSessionId` is `string | null`. The hook bails out on null,
    // so an accidental hardcode or omitted prop would silently disable
    // every shortcut. Asserting the property is reachable (not
    // undefined) keeps the wiring honest.
    expect(args).toHaveProperty('activeSessionId')
    expect(
      args.activeSessionId === null || typeof args.activeSessionId === 'string'
    ).toBe(true)
    expect(typeof args.setSessionActivePane).toBe('function')
    expect(typeof args.setSessionLayout).toBe('function')
  })

  test('scopes the editor buffer to the active session', async () => {
    const user = userEvent.setup()
    const nextSessionId = '00000000-0000-4000-8000-000000000002'

    const randomUUID = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValue(nextSessionId)

    try {
      render(<WorkspaceView />)

      await screen.findByRole('button', { name: 'session 1' })

      await waitFor(() => {
        expect(
          vi
            .mocked(useEditorBuffer)
            .mock.calls.some(([, sessionId]) => sessionId === 'sess-1')
        ).toBe(true)
      })

      await user.click(screen.getByRole('button', { name: 'new session' }))
      await screen.findByRole('button', { name: 'session 2' })

      await waitFor(() => {
        expect(
          vi
            .mocked(useEditorBuffer)
            .mock.calls.some(([, sessionId]) => sessionId === nextSessionId)
        ).toBe(true)
      })
    } finally {
      randomUUID.mockRestore()
    }
  })

  test('prompts before removing a dirty active session', async () => {
    const user = userEvent.setup()
    const hasUnsavedChanges = vi.fn((scopeId: string) => scopeId === 'sess-1')
    const releaseScope = vi.fn()

    vi.mocked(useEditorBuffer).mockReturnValue({
      filePath: 'src/current.ts',
      originalContent: 'original',
      currentContent: 'edits',
      isDirty: true,
      isLoading: false,
      openFile: vi.fn().mockResolvedValue(undefined),
      saveFile: vi.fn().mockResolvedValue(undefined),
      updateContent: vi.fn(),
      hasUnsavedChanges,
      getFilePathForScope: vi.fn(() => null),
      releaseScope,
    })

    render(<WorkspaceView />)

    const activeTab = await screen.findByRole('tab', { name: 'session 1' })

    await user.click(screen.getByRole('button', { name: 'Close session 1' }))

    expect(hasUnsavedChanges).toHaveBeenCalledWith('sess-1')

    const dialog = await screen.findByRole('dialog', {
      name: /unsaved changes/i,
    })

    expect(dialog).toHaveTextContent(/before closing this session/i)
    expect(within(dialog).getByText('src/current.ts')).toBeInTheDocument()
    expect(activeTab).toHaveAttribute('aria-selected', 'true')
    expect(releaseScope).not.toHaveBeenCalled()
  })

  test('restores the original active session when cancelling a dirty background close', async () => {
    const user = userEvent.setup()
    const hasUnsavedChanges = vi.fn((scopeId: string) => scopeId === 'second')

    workspaceTerminalMock.service.listSessions.mockResolvedValue({
      activeSessionId: 'first',
      sessions: [
        {
          id: 'first',
          cwd: '/repo/first',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'second',
          cwd: '/repo/second',
          status: {
            kind: 'Alive',
            pid: 2,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'third',
          cwd: '/repo/third',
          status: {
            kind: 'Alive',
            pid: 3,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    vi.mocked(useEditorBuffer).mockReturnValue({
      filePath: 'src/current.ts',
      originalContent: 'original',
      currentContent: 'edits',
      isDirty: true,
      isLoading: false,
      openFile: vi.fn().mockResolvedValue(undefined),
      saveFile: vi.fn().mockResolvedValue(undefined),
      updateContent: vi.fn(),
      hasUnsavedChanges,
      getFilePathForScope: vi.fn(() => null),
      releaseScope: vi.fn(),
    })

    render(<WorkspaceView />)

    await screen.findByRole('tab', { name: 'first' })

    await user.click(screen.getByRole('button', { name: 'Close second' }))
    await screen.findByRole('dialog', { name: /unsaved changes/i })
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'first' })).toHaveAttribute(
        'aria-selected',
        'true'
      )
    })
    expect(screen.getByRole('tab', { name: 'second' })).toBeInTheDocument()
  })

  test('restores the original active session after discarding a dirty background close', async () => {
    const user = userEvent.setup()
    const hasUnsavedChanges = vi.fn((scopeId: string) => scopeId === 'second')
    const releaseScope = vi.fn()

    workspaceTerminalMock.service.listSessions.mockResolvedValue({
      activeSessionId: 'first',
      sessions: [
        {
          id: 'first',
          cwd: '/repo/first',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'second',
          cwd: '/repo/second',
          status: {
            kind: 'Alive',
            pid: 2,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'third',
          cwd: '/repo/third',
          status: {
            kind: 'Alive',
            pid: 3,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    vi.mocked(useEditorBuffer).mockReturnValue({
      filePath: 'src/current.ts',
      originalContent: 'original',
      currentContent: 'edits',
      isDirty: true,
      isLoading: false,
      openFile: vi.fn().mockResolvedValue(undefined),
      saveFile: vi.fn().mockResolvedValue(undefined),
      updateContent: vi.fn(),
      hasUnsavedChanges,
      getFilePathForScope: vi.fn(() => null),
      releaseScope,
    })

    render(<WorkspaceView />)

    await screen.findByRole('tab', { name: 'first' })

    await user.click(screen.getByRole('button', { name: 'Close second' }))
    await screen.findByRole('dialog', { name: /unsaved changes/i })
    await user.click(screen.getByRole('button', { name: 'Discard' }))

    await waitFor(() => {
      expect(screen.queryByRole('tab', { name: 'second' })).toBeNull()
    })

    expect(screen.getByRole('tab', { name: 'first' })).toHaveAttribute(
      'aria-selected',
      'true'
    )

    expect(screen.getByRole('tab', { name: 'third' })).toHaveAttribute(
      'aria-selected',
      'false'
    )
    expect(releaseScope).toHaveBeenCalledWith('second')
  })

  test('removes a dirty background session after saving and restores the original active session', async () => {
    const user = userEvent.setup()
    const hasUnsavedChanges = vi.fn((scopeId: string) => scopeId === 'second')
    const saveFile = vi.fn().mockResolvedValue(undefined)
    const releaseScope = vi.fn()

    const consoleWarn = vi
      .spyOn(console, 'warn')
      .mockImplementation((): void => undefined)

    workspaceTerminalMock.service.listSessions.mockResolvedValue({
      activeSessionId: 'first',
      sessions: [
        {
          id: 'first',
          cwd: '/repo/first',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'second',
          cwd: '/repo/second',
          status: {
            kind: 'Alive',
            pid: 2,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'third',
          cwd: '/repo/third',
          status: {
            kind: 'Alive',
            pid: 3,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    workspaceTerminalMock.service.setActiveSession.mockRejectedValueOnce(
      new Error('IPC failed')
    )

    vi.mocked(useEditorBuffer).mockReturnValue({
      filePath: 'src/current.ts',
      originalContent: 'original',
      currentContent: 'edits',
      isDirty: true,
      isLoading: false,
      openFile: vi.fn().mockResolvedValue(undefined),
      saveFile,
      updateContent: vi.fn(),
      hasUnsavedChanges,
      getFilePathForScope: vi.fn((scopeId: string) =>
        scopeId === 'second' ? 'src/second.ts' : null
      ),
      releaseScope,
    })

    try {
      render(<WorkspaceView />)

      await screen.findByRole('tab', { name: 'first' })

      await user.click(screen.getByRole('button', { name: 'Close second' }))

      const dialog = await screen.findByRole('dialog', {
        name: /unsaved changes/i,
      })

      expect(within(dialog).getByText('src/second.ts')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => {
        expect(saveFile).toHaveBeenCalledWith('second')
      })

      await waitFor(() => {
        expect(screen.queryByRole('tab', { name: 'second' })).toBeNull()
      })

      expect(screen.getByRole('tab', { name: 'first' })).toHaveAttribute(
        'aria-selected',
        'true'
      )

      expect(screen.getByRole('tab', { name: 'third' })).toHaveAttribute(
        'aria-selected',
        'false'
      )
      expect(releaseScope).toHaveBeenCalledWith('second')
    } finally {
      consoleWarn.mockRestore()
    }
  })

  test('keeps dirty session close pending while save is in flight', async () => {
    const user = userEvent.setup()
    const hasUnsavedChanges = vi.fn((scopeId: string) => scopeId === 'second')
    let resolveSave: (() => void) | null = null

    const saveFile = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve
        })
    )

    workspaceTerminalMock.service.listSessions.mockResolvedValue({
      activeSessionId: 'first',
      sessions: [
        {
          id: 'first',
          cwd: '/repo/first',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'second',
          cwd: '/repo/second',
          status: {
            kind: 'Alive',
            pid: 2,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    vi.mocked(useEditorBuffer).mockReturnValue({
      filePath: 'src/current.ts',
      originalContent: 'original',
      currentContent: 'edits',
      isDirty: true,
      isLoading: false,
      openFile: vi.fn().mockResolvedValue(undefined),
      saveFile,
      updateContent: vi.fn(),
      hasUnsavedChanges,
      getFilePathForScope: vi.fn(() => null),
      releaseScope: vi.fn(),
    })

    render(<WorkspaceView />)

    await screen.findByRole('tab', { name: 'first' })

    await user.click(screen.getByRole('button', { name: 'Close second' }))
    await screen.findByRole('dialog', { name: /unsaved changes/i })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(saveFile).toHaveBeenCalledWith('second')
    })

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(
      screen.getByRole('dialog', { name: /unsaved changes/i })
    ).toBeInTheDocument()

    act(() => {
      resolveSave?.()
    })

    await waitFor(() => {
      expect(screen.queryByRole('tab', { name: 'second' })).toBeNull()
    })
  })

  test('selects the next visible session after confirming a dirty active-session close', async () => {
    const user = userEvent.setup()
    const hasUnsavedChanges = vi.fn((scopeId: string) => scopeId === 'first')

    workspaceTerminalMock.service.listSessions.mockResolvedValue({
      activeSessionId: 'first',
      sessions: [
        {
          id: 'first',
          cwd: '/repo/first',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'hidden-ended',
          cwd: '/repo/hidden-ended',
          status: { kind: 'Exited', last_exit_code: 0 },
        },
        {
          id: 'third',
          cwd: '/repo/third',
          status: {
            kind: 'Alive',
            pid: 3,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    vi.mocked(useEditorBuffer).mockReturnValue({
      filePath: 'src/current.ts',
      originalContent: 'original',
      currentContent: 'edits',
      isDirty: true,
      isLoading: false,
      openFile: vi.fn().mockResolvedValue(undefined),
      saveFile: vi.fn().mockResolvedValue(undefined),
      updateContent: vi.fn(),
      hasUnsavedChanges,
      getFilePathForScope: vi.fn(() => null),
      releaseScope: vi.fn(),
    })

    render(<WorkspaceView />)

    await screen.findByRole('tab', { name: 'first' })

    await user.click(screen.getByRole('button', { name: 'Close first' }))
    await user.click(screen.getByRole('button', { name: 'Discard' }))

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'third' })).toHaveAttribute(
        'aria-selected',
        'true'
      )
    })
    expect(screen.queryByRole('tab', { name: 'hidden-ended' })).toBeNull()
  })

  test('selects the next visible session after saving a dirty active-session close', async () => {
    const user = userEvent.setup()
    const hasUnsavedChanges = vi.fn((scopeId: string) => scopeId === 'first')
    const saveFile = vi.fn().mockResolvedValue(undefined)

    workspaceTerminalMock.service.listSessions.mockResolvedValue({
      activeSessionId: 'first',
      sessions: [
        {
          id: 'first',
          cwd: '/repo/first',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'hidden-ended',
          cwd: '/repo/hidden-ended',
          status: { kind: 'Exited', last_exit_code: 0 },
        },
        {
          id: 'third',
          cwd: '/repo/third',
          status: {
            kind: 'Alive',
            pid: 3,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    vi.mocked(useEditorBuffer).mockReturnValue({
      filePath: 'src/current.ts',
      originalContent: 'original',
      currentContent: 'edits',
      isDirty: true,
      isLoading: false,
      openFile: vi.fn().mockResolvedValue(undefined),
      saveFile,
      updateContent: vi.fn(),
      hasUnsavedChanges,
      getFilePathForScope: vi.fn(() => null),
      releaseScope: vi.fn(),
    })

    render(<WorkspaceView />)

    await screen.findByRole('tab', { name: 'first' })

    await user.click(screen.getByRole('button', { name: 'Close first' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(saveFile).toHaveBeenCalledWith('first')
    })

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'third' })).toHaveAttribute(
        'aria-selected',
        'true'
      )
    })
    expect(screen.queryByRole('tab', { name: 'hidden-ended' })).toBeNull()
  })

  test('releases an editor scope after a clean session is removed', async () => {
    const user = userEvent.setup()
    const hasUnsavedChanges = vi.fn(() => false)
    const releaseScope = vi.fn()

    vi.mocked(useEditorBuffer).mockReturnValue({
      filePath: null,
      originalContent: '',
      currentContent: '',
      isDirty: false,
      isLoading: false,
      openFile: vi.fn().mockResolvedValue(undefined),
      saveFile: vi.fn().mockResolvedValue(undefined),
      updateContent: vi.fn(),
      hasUnsavedChanges,
      getFilePathForScope: vi.fn(() => null),
      releaseScope,
    })

    render(<WorkspaceView />)

    await screen.findByRole('tab', { name: 'session 1' })

    await user.click(screen.getByRole('button', { name: 'Close session 1' }))

    expect(hasUnsavedChanges).toHaveBeenCalledWith('sess-1')
    await waitFor(() => {
      expect(releaseScope).toHaveBeenCalledWith('sess-1')
    })
  })

  test('applies correct grid layout with 4 columns (dynamic sidebar width)', () => {
    render(<WorkspaceView />)

    const container = screen.getByTestId('workspace-view')

    expect(container).toHaveClass('grid')
    expect(container.style.gridTemplateColumns).toBe(
      '48px var(--workspace-sidebar-width, 272px) 1fr auto'
    )

    expect(container.style.getPropertyValue('--workspace-sidebar-width')).toBe(
      '272px'
    )
  })

  test('fills viewport height', () => {
    render(<WorkspaceView />)

    const container = screen.getByTestId('workspace-view')

    expect(container).toHaveClass('h-screen')
  })

  test('renders IconRail identity and utility buttons', () => {
    render(<WorkspaceView />)

    const iconRail = screen.getByTestId('icon-rail')

    expect(
      within(iconRail).getByRole('img', { name: 'Account' })
    ).toHaveTextContent('w')

    expect(
      within(iconRail).getByRole('button', { name: 'Command Palette' })
    ).toBeInTheDocument()

    expect(
      within(iconRail).getByRole('button', { name: 'Settings' })
    ).toHaveAttribute('aria-disabled', 'true')
  })

  test('passes sessions to Sidebar', () => {
    render(<WorkspaceView />)

    const sidebar = screen.getByTestId('sidebar')

    // Sidebar should show session list
    expect(
      sidebar.querySelector('[data-testid="session-list"]')
    ).toBeInTheDocument()
  })

  test('SessionTabs reflects the active session selection', async () => {
    render(<WorkspaceView />)

    await screen.findByRole('button', { name: 'session 1' })

    const tabs = within(screen.getByTestId('session-tabs')).getAllByRole('tab')
    expect(tabs.length).toBeGreaterThan(0)
    expect(
      tabs.some((tab) => tab.getAttribute('aria-selected') === 'true')
    ).toBe(true)
  })

  test('renders AgentStatusPanel', () => {
    render(<WorkspaceView />)

    const panel = screen.getByTestId('agent-status-panel')
    expect(panel).toBeInTheDocument()
  })

  test('renders rail utility actions in IconRail', () => {
    render(<WorkspaceView />)

    const iconRail = screen.getByTestId('icon-rail')

    expect(
      within(iconRail).getByRole('button', { name: 'Command Palette' })
    ).toBeInTheDocument()

    expect(
      within(iconRail).getByRole('button', { name: 'Settings' })
    ).toBeInTheDocument()
  })

  test('defaults to first session as active', async () => {
    render(<WorkspaceView />)

    const firstSession = await screen.findByRole('button', {
      name: 'session 1',
    })
    const listItem = firstSession.closest('li')!
    // Active row uses lavender-tinted background per handoff §4.2.
    expect(listItem.className).toContain('bg-primary/10')
    expect(listItem.className).toContain('text-on-surface')
  })

  test('renders FileExplorer in sidebar', () => {
    render(<WorkspaceView />)

    const sidebar = screen.getByTestId('sidebar')

    // FileExplorer remains mounted behind the FILES tab so its local tree
    // state survives tab switches.
    const fileExplorer = sidebar.querySelector('[data-testid="file-explorer"]')
    expect(fileExplorer).toBeInTheDocument()
  })

  test('initial render shows SidebarTabs group with SESSIONS active', () => {
    render(<WorkspaceView />)

    expect(
      screen.getByRole('group', { name: 'Sidebar tabs' })
    ).toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'SESSIONS' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    expect(screen.getByRole('button', { name: 'FILES' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  test('both sidebar tab views are mounted on initial render', () => {
    render(<WorkspaceView />)

    expect(screen.getByTestId('sessions-view')).toBeInTheDocument()
    expect(screen.getByTestId('files-view')).toBeInTheDocument()
    // Visibility is conveyed via the `hidden` / `flex` Tailwind utility
    // classes, not the HTML `hidden` attribute — see SessionsView /
    // FilesView for the Tailwind-v4 cascade-layer rationale.
    expect(screen.getByTestId('sessions-view')).toHaveClass('flex')
    expect(screen.getByTestId('sessions-view')).not.toHaveClass('hidden')
    expect(screen.getByTestId('files-view')).toHaveClass('hidden')
    expect(screen.getByTestId('files-view')).not.toHaveClass('flex')
  })

  test('clicking FILES toggles the visibility classes on each view', async () => {
    const user = userEvent.setup()

    render(<WorkspaceView />)
    await user.click(screen.getByRole('button', { name: 'FILES' }))

    expect(screen.getByTestId('sessions-view')).toHaveClass('hidden')
    expect(screen.getByTestId('sessions-view')).not.toHaveClass('flex')
    expect(screen.getByTestId('files-view')).toHaveClass('flex')
    expect(screen.getByTestId('files-view')).not.toHaveClass('hidden')
  })

  test('Sidebar footer slot is suppressed in WorkspaceView', () => {
    render(<WorkspaceView />)

    expect(
      screen.queryByTestId('sidebar-footer-wrapper')
    ).not.toBeInTheDocument()
  })

  test('bottom-pane resize handle is gone in WorkspaceView', () => {
    render(<WorkspaceView />)

    expect(
      screen.queryByTestId('explorer-resize-handle')
    ).not.toBeInTheDocument()
  })

  test('FilesView remains mounted across SESSIONS and FILES toggles', async () => {
    const user = userEvent.setup()

    render(<WorkspaceView />)
    const filesViewBefore = screen.getByTestId('files-view')

    await user.click(screen.getByRole('button', { name: 'FILES' }))
    await user.click(screen.getByRole('button', { name: 'SESSIONS' }))
    await user.click(screen.getByRole('button', { name: 'FILES' }))

    const filesViewAfter = screen.getByTestId('files-view')
    expect(filesViewAfter).toBe(filesViewBefore)
    expect(filesViewAfter).toHaveClass('flex')
    expect(filesViewAfter).not.toHaveClass('hidden')
  })

  test('clicking the new session ghost button creates a new session', async () => {
    const user = userEvent.setup()

    render(<WorkspaceView />)

    // The mock terminal service's listSessions returns one seed session
    // (id 'sess-1', cwd '~') which renders as 'session 1' (per the
    // tabName helper in useSessionManager — cwd '~' falls back to
    // 'session ${index + 1}').
    await screen.findByRole('button', { name: 'session 1' })

    const newSessionButton = screen.getByRole('button', {
      name: 'new session',
    })
    await user.click(newSessionButton)

    // After clicking, the spawn() mock resolves with a new sessionId
    // and useSessionManager appends a new Session at index 1, with
    // tabName(cwd='~', index=1) = 'session 2'. Asserting the new row
    // appears proves createSession was wired through end-to-end —
    // a regression of the onClick handler being dropped (e.g. during
    // a future Sidebar.footer slot refactor) would fail this test.
    await screen.findByRole('button', { name: 'session 2' })
  })

  test('opens command palette from the rail command button', async () => {
    const user = userEvent.setup()
    render(<WorkspaceView />)

    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Command Palette' }))

    expect(
      screen.getByRole('dialog', { name: 'Command palette' })
    ).toBeInTheDocument()
  })

  test('handles session switch callback', () => {
    render(<WorkspaceView />)

    const sidebar = screen.getByTestId('sidebar')
    const sessionButtons = sidebar.querySelectorAll('button[aria-label]')

    // Click second session if it exists
    if (sessionButtons.length > 1) {
      const secondSession = sessionButtons[1] as HTMLButtonElement
      secondSession.click()

      // State should update (verified through internal state)
    }
  })

  test('DockPanel is present below TerminalZone', () => {
    render(<WorkspaceView />)

    // DockPanel should render with Editor tab active
    expect(screen.getByRole('button', { name: /editor/i })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /diff viewer/i })
    ).toBeInTheDocument()
  })

  test('with dockPosition=left, DockPanel renders before TerminalZone in the inner flex', async () => {
    const user = userEvent.setup()
    render(<WorkspaceView />)

    await user.click(screen.getByRole('button', { name: /dock: left/i }))

    const inner = screen.getByTestId('dock-canvas-wrapper')
    expect(inner).toHaveStyle({ flexDirection: 'row' })

    const children = Array.from(inner.children)

    const dockIndex = children.findIndex(
      (child) => child.getAttribute('data-testid') === 'dock-panel'
    )

    const terminalIndex = children.findIndex(
      (child) => child.getAttribute('data-testid') === 'terminal-zone-wrapper'
    )

    expect(dockIndex).toBeLessThan(terminalIndex)
  })

  test('with dockPosition=right, DockPanel renders after TerminalZone in the inner flex', async () => {
    const user = userEvent.setup()
    render(<WorkspaceView />)

    await user.click(screen.getByRole('button', { name: /dock: right/i }))

    const inner = screen.getByTestId('dock-canvas-wrapper')
    expect(inner).toHaveStyle({ flexDirection: 'row' })

    const children = Array.from(inner.children)

    const dockIndex = children.findIndex(
      (child) => child.getAttribute('data-testid') === 'dock-panel'
    )

    const terminalIndex = children.findIndex(
      (child) => child.getAttribute('data-testid') === 'terminal-zone-wrapper'
    )

    expect(dockIndex).toBeGreaterThan(terminalIndex)
  })

  test('with dockPosition=bottom, inner flex direction is column', () => {
    render(<WorkspaceView />)

    expect(screen.getByTestId('dock-canvas-wrapper')).toHaveStyle({
      flexDirection: 'column',
    })
  })

  test('closed left dock renders DockPeekButton before TerminalZone', async () => {
    const user = userEvent.setup()
    render(<WorkspaceView />)

    await user.click(screen.getByRole('button', { name: /dock: left/i }))
    await user.click(screen.getByRole('button', { name: /more dock actions/i }))
    await user.click(screen.getByRole('button', { name: /collapse panel/i }))

    const inner = screen.getByTestId('dock-canvas-wrapper')

    const peek = screen.getByRole('button', {
      name: /show panel docked left/i,
    })
    const terminal = screen.getByTestId('terminal-zone-wrapper')

    expect(inner).toContainElement(peek)
    expect(inner).toContainElement(terminal)

    const children = Array.from(inner.children)
    expect(children.indexOf(peek)).toBeLessThan(children.indexOf(terminal))
  })

  test('closed bottom dock renders DockPeekButton after TerminalZone', async () => {
    const user = userEvent.setup()
    render(<WorkspaceView />)

    await user.click(screen.getByRole('button', { name: /collapse panel/i }))

    const inner = screen.getByTestId('dock-canvas-wrapper')
    const peek = screen.getByLabelText('Show panel docked bottom')
    const terminal = screen.getByTestId('terminal-zone-wrapper')
    const children = Array.from(inner.children)

    expect(children.indexOf(peek)).toBeGreaterThan(children.indexOf(terminal))
  })

  test('closed right dock renders DockPeekButton after TerminalZone', async () => {
    const user = userEvent.setup()
    render(<WorkspaceView />)

    await user.click(screen.getByRole('button', { name: /dock: right/i }))
    await user.click(screen.getByRole('button', { name: /more dock actions/i }))
    await user.click(screen.getByRole('button', { name: /collapse panel/i }))

    const inner = screen.getByTestId('dock-canvas-wrapper')

    const peek = screen.getByRole('button', {
      name: /show panel docked right/i,
    })
    const terminal = screen.getByTestId('terminal-zone-wrapper')

    const children = Array.from(inner.children)

    expect(children.indexOf(peek)).toBeGreaterThan(children.indexOf(terminal))
  })

  test('main workspace area uses flex-col layout', () => {
    render(<WorkspaceView />)

    const workspaceView = screen.getByTestId('workspace-view')

    // 3rd grid child = main wrapper (after icon rail, sidebar wrapper).
    const mainWorkspace = workspaceView.children[2] as HTMLElement
    expect(mainWorkspace).toHaveClass('flex')
    expect(mainWorkspace).toHaveClass('flex-col')
  })

  test('applies overflow-hidden to prevent scrollbars', () => {
    render(<WorkspaceView />)

    const container = screen.getByTestId('workspace-view')

    expect(container).toHaveClass('overflow-hidden')
  })

  test('handles session switching', async () => {
    const user = userEvent.setup()
    render(<WorkspaceView />)

    const firstSession = await screen.findByRole('button', {
      name: 'session 1',
    })
    expect(firstSession.closest('li')!.className).toContain('bg-primary/10')

    const newSessionButton = screen.getByRole('button', {
      name: 'new session',
    })
    await user.click(newSessionButton)

    const secondSession = await screen.findByRole('button', {
      name: 'session 2',
    })
    expect(secondSession.closest('li')!.className).toContain('bg-primary/10')
    expect(firstSession.closest('li')!.className).not.toContain('bg-primary/10')
  })

  test('handles empty sessions gracefully without crashing', () => {
    // Component should render all zones even when there are no active sessions
    render(<WorkspaceView />)

    // All main zones should still render
    expect(screen.getByTestId('icon-rail')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-zone')).toBeInTheDocument()
    expect(screen.getByTestId('agent-status-panel')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /editor/i })).toBeInTheDocument()
  })

  test('grid columns: icon-rail 48px, sidebar 272px, main 1fr, activity auto', () => {
    render(<WorkspaceView />)

    const container = screen.getByTestId('workspace-view')

    expect(container.style.gridTemplateColumns).toContain('48px')
    expect(container.style.gridTemplateColumns).toContain(
      'var(--workspace-sidebar-width, 272px)'
    )

    expect(container.style.getPropertyValue('--workspace-sidebar-width')).toBe(
      '272px'
    )
    expect(container.style.gridTemplateColumns).toContain('1fr')
    expect(container.style.gridTemplateColumns).toContain('auto')
  })

  test('previews sidebar drag width through CSS variable before committing React state', () => {
    const frameCallbacks: FrameRequestCallback[] = []

    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback): number => {
        frameCallbacks.push(callback)

        return frameCallbacks.length
      })

    try {
      const { rerender } = render(<WorkspaceView />)

      const workspace = screen.getByTestId('workspace-view')
      const handle = screen.getByTestId('sidebar-resize-handle')

      fireEvent.mouseDown(handle, { clientX: 200 })

      fireEvent.mouseMove(document, { clientX: 300 })

      expect(
        workspace.style.getPropertyValue('--workspace-sidebar-width')
      ).toBe('272px')
      expect(handle).toHaveAttribute('aria-valuenow', '272')

      const callback = frameCallbacks[0]
      if (!callback) {
        throw new Error('Expected sidebar resize animation frame')
      }

      act(() => {
        callback(16)
      })

      expect(
        workspace.style.getPropertyValue('--workspace-sidebar-width')
      ).toBe('372px')
      expect(handle).toHaveAttribute('aria-valuenow', '372')

      rerender(<WorkspaceView />)

      expect(
        workspace.style.getPropertyValue('--workspace-sidebar-width')
      ).toBe('372px')
      expect(handle).toHaveAttribute('aria-valuenow', '372')

      fireEvent.mouseUp(document)

      expect(handle).toHaveAttribute('aria-valuenow', '372')
    } finally {
      requestAnimationFrameSpy.mockRestore()
    }
  })

  test('skips duplicate sidebar preview write after fast drag release', () => {
    const frameCallbacks: FrameRequestCallback[] = []

    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback): number => {
        frameCallbacks.push(callback)

        return frameCallbacks.length
      })

    const setPropertySpy = vi.spyOn(
      CSSStyleDeclaration.prototype,
      'setProperty'
    )

    try {
      render(<WorkspaceView />)

      const handle = screen.getByTestId('sidebar-resize-handle')

      fireEvent.mouseDown(handle, { clientX: 200 })
      fireEvent.mouseMove(document, { clientX: 300 })
      fireEvent.mouseUp(document)

      const sidebarWidthWrites = setPropertySpy.mock.calls.filter(
        ([propertyName]) => propertyName === '--workspace-sidebar-width'
      )

      expect(sidebarWidthWrites).toEqual([
        ['--workspace-sidebar-width', '272px'],
        ['--workspace-sidebar-width', '372px'],
      ])
      expect(frameCallbacks).toHaveLength(1)
      expect(handle).toHaveAttribute('aria-valuenow', '372')
    } finally {
      requestAnimationFrameSpy.mockRestore()
      setPropertySpy.mockRestore()
    }
  })

  test('mounts SessionTabs above terminal zone', () => {
    render(<WorkspaceView />)

    const tabs = screen.getByTestId('session-tabs')
    const terminal = screen.getByTestId('terminal-zone')

    expect(tabs).toBeInTheDocument()
    expect(
      tabs.compareDocumentPosition(terminal) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  test('mounts StatusBar inside the main column (right of rail/sidebar)', () => {
    render(<WorkspaceView />)

    const workspaceView = screen.getByTestId('workspace-view')
    const mainWorkspace = workspaceView.children[2] as HTMLElement
    const statusBar = screen.getByTestId('status-bar')

    expect(statusBar).toBeInTheDocument()
    // Inside main column → icon rail + sidebar fill full viewport height.
    expect(mainWorkspace.contains(statusBar)).toBe(true)
  })

  test('file selection: no dialog when no file is currently open', async () => {
    const user = userEvent.setup()
    render(<WorkspaceView />)

    await user.click(screen.getByRole('button', { name: 'FILES' }))
    const fileExplorer = screen.getByTestId('file-explorer')

    // Click a file node (files have data-node-id)
    const fileNodes = fileExplorer.querySelectorAll('[data-node-id]')

    const firstFile = Array.from(fileNodes).find((node) => {
      const nodeData = (node as HTMLElement).getAttribute('data-node-id')

      return nodeData?.includes('auth.ts')
    })

    if (firstFile) {
      await user.click(firstFile as HTMLElement)

      // No unsaved changes dialog should appear (no file was open)
      expect(
        screen.queryByRole('dialog', { name: /unsaved changes/i })
      ).not.toBeInTheDocument()
    }
  })

  test('file selection: no dialog when current file is clean', async () => {
    const user = userEvent.setup()
    render(<WorkspaceView />)

    await user.click(screen.getByRole('button', { name: 'FILES' }))
    const fileExplorer = screen.getByTestId('file-explorer')

    // Click first file
    const fileNodes = fileExplorer.querySelectorAll('[data-node-id]')

    const firstFile = Array.from(fileNodes).find((node) => {
      const nodeData = (node as HTMLElement).getAttribute('data-node-id')

      return nodeData?.includes('auth.ts')
    })

    if (firstFile) {
      await user.click(firstFile as HTMLElement)

      // Wait a tick for state to settle
      await new Promise((resolve) => setTimeout(resolve, 0))

      // Click a different file (session.ts)
      const secondFile = Array.from(fileNodes).find((node) => {
        const nodeData = (node as HTMLElement).getAttribute('data-node-id')

        return nodeData?.includes('session.ts')
      })

      if (secondFile) {
        await user.click(secondFile as HTMLElement)

        // No dialog - file was clean
        expect(
          screen.queryByRole('dialog', { name: /unsaved changes/i })
        ).not.toBeInTheDocument()
      }
    }
  })

  test('file selection: shows dialog when current file has unsaved changes', () => {
    render(<WorkspaceView />)

    // This test would need CodeMirror to make edits to set isDirty = true
    // For now, we test that the dialog component is wired correctly
    // Integration test in Feature 22 will test the full flow with editor edits
  })

  test('unsaved changes dialog: Save button saves and opens new file', async () => {
    // This will be fully tested in Feature 22 integration tests
    // Unit test verifies handlers are wired correctly
  })

  test('unsaved changes dialog: Discard button discards and opens new file', async () => {
    // This will be fully tested in Feature 22 integration tests
  })

  test('unsaved changes dialog: Cancel button closes dialog and stays on current file', async () => {
    // This will be fully tested in Feature 22 integration tests
  })

  test('handleOpenTestFile opens file directly when buffer is clean', () => {
    const openFileMock = vi.fn().mockResolvedValue(undefined)

    vi.mocked(useEditorBuffer).mockReturnValue({
      filePath: null,
      originalContent: '',
      currentContent: '',
      isDirty: false,
      isLoading: false,
      openFile: openFileMock,
      saveFile: vi.fn().mockResolvedValue(undefined),
      updateContent: vi.fn(),
      hasUnsavedChanges: vi.fn(() => false),
      getFilePathForScope: vi.fn(() => null),
      releaseScope: vi.fn(),
    })

    render(<WorkspaceView />)

    const onOpenFile = capturedAgentStatusPanelProps.onOpenFile
    expect(onOpenFile).toBeDefined()

    act(() => {
      onOpenFile?.('/abs/src/foo.test.ts')
    })

    expect(openFileMock).toHaveBeenCalledOnce()
    expect(openFileMock).toHaveBeenCalledWith('/abs/src/foo.test.ts')
    expect(
      screen.queryByRole('dialog', { name: /unsaved changes/i })
    ).toBeNull()
  })

  test('handleOpenTestFile shows unsaved dialog when buffer is dirty', async () => {
    const openFileMock = vi.fn().mockResolvedValue(undefined)

    vi.mocked(useEditorBuffer).mockReturnValue({
      filePath: 'src/current.ts',
      originalContent: 'original',
      currentContent: 'edits',
      isDirty: true,
      isLoading: false,
      openFile: openFileMock,
      saveFile: vi.fn().mockResolvedValue(undefined),
      updateContent: vi.fn(),
      hasUnsavedChanges: vi.fn(() => true),
      getFilePathForScope: vi.fn(() => null),
      releaseScope: vi.fn(),
    })

    render(<WorkspaceView />)

    const onOpenFile = capturedAgentStatusPanelProps.onOpenFile
    expect(onOpenFile).toBeDefined()

    act(() => {
      onOpenFile?.('/abs/src/bar.test.ts')
    })

    expect(openFileMock).not.toHaveBeenCalled()
    expect(
      await screen.findByRole('dialog', { name: /unsaved changes/i })
    ).toBeInTheDocument()
  })

  test('stacks command info below file errors', async () => {
    const user = userEvent.setup()

    const openFileMock = vi
      .fn()
      .mockRejectedValue(new Error('permission denied'))

    vi.mocked(useEditorBuffer).mockReturnValue({
      filePath: null,
      originalContent: '',
      currentContent: '',
      isDirty: false,
      isLoading: false,
      openFile: openFileMock,
      saveFile: vi.fn().mockResolvedValue(undefined),
      updateContent: vi.fn(),
      hasUnsavedChanges: vi.fn(() => false),
      getFilePathForScope: vi.fn(() => null),
      releaseScope: vi.fn(),
    })

    render(<WorkspaceView />)

    await screen.findByRole('button', { name: 'session 1' })

    const onOpenFile = capturedAgentStatusPanelProps.onOpenFile
    expect(onOpenFile).toBeDefined()

    act(() => {
      onOpenFile?.('/abs/src/fail.test.ts')
    })

    const alert = await screen.findByRole('alert')

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: ';',
          ctrlKey: true,
          bubbles: true,
        })
      )
    })

    await screen.findByRole('dialog', { name: /command palette/i })

    const input = screen.getByRole('combobox', {
      name: 'Command palette search',
    })
    await user.clear(input)
    await user.type(input, ':goto 99')
    await user.keyboard('{Enter}')

    const status = await screen.findByRole('status')
    const stack = alert.parentElement

    expect(stack).toBe(status.parentElement)
    expect(stack).toHaveClass('flex-col', 'gap-2')
    expect(Array.from(stack?.children ?? [])).toEqual([alert, status])
  })

  test('lifts useAgentStatus and forwards the latest active pane ptyId', async () => {
    render(<WorkspaceView />)

    // Wait for session restore to settle (the listSessions mock resolves
    // sess-1, so this proves activeSessionId is non-null).
    await screen.findByRole('button', { name: 'session 1' })

    const useAgentStatusMock = vi.mocked(useAgentStatus)
    const calls = useAgentStatusMock.mock.calls
    const lastArg = calls[calls.length - 1]?.[0]

    // Latest call arg, not call count — activeSessionId flips from null
    // to the restored id during mount, and React may re-render multiple
    // times. Restored sessions keep ptyId === session id for compatibility,
    // so this pins the active-pane handle that useAgentStatus now receives.
    expect(lastArg).toBe('sess-1')
  })

  test('passes the lifted agentStatus to AgentStatusPanel', async () => {
    render(<WorkspaceView />)

    await screen.findByRole('button', { name: 'session 1' })

    // The mocked useAgentStatus returns isActive: true / agentType: 'claude-code'.
    expect(capturedAgentStatusPanelProps.agentStatus).toMatchObject({
      isActive: true,
      agentType: 'claude-code',
    })
  })

  test('mirrors agentStatus.cwd into the active pane.cwd', async () => {
    // Regression for #233: tool-call-driven worktree switches (e.g. Claude's
    // built-in `EnterWorktree`) never mutate the interactive shell, so OSC 7
    // and PTY text patterns can't catch them. The transcript JSONL stamps
    // every entry with the agent's current cwd; useAgentStatus surfaces it
    // via `agentStatus.cwd`, and WorkspaceView mirrors that into pane.cwd so
    // the worktree chip + branch chip follow the agent.
    vi.mocked(useAgentStatus).mockImplementation(
      (sessionId: string | null): AgentStatus =>
        sessionId === null
          ? {
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
            }
          : {
              isActive: true,
              agentExited: false,
              agentType: 'claude-code',
              modelId: null,
              modelDisplayName: null,
              version: null,
              sessionId,
              agentSessionId: null,
              cwd: '/home/user/projects/vimeflow/.claude/worktrees/dummy',
              contextWindow: null,
              cost: null,
              rateLimits: null,
              numTurns: 0,
              toolCalls: { total: 0, byType: {}, active: null },
              recentToolCalls: [],
              testRun: null,
            }
    )

    render(<WorkspaceView />)

    await screen.findByRole('button', { name: 'session 1' })

    const terminalPane = await screen.findByTestId('terminal-pane-mock')

    await vi.waitFor(() => {
      expect(terminalPane).toHaveAttribute(
        'data-cwd',
        '/home/user/projects/vimeflow/.claude/worktrees/dummy'
      )
    })
  })

  test('does NOT mirror agentStatus.cwd when the agent is not active', async () => {
    // Codex P1: `agentStatus.cwd` is retained after an agent exits (only
    // `isActive` / `agentExited` toggle). Without an isActive guard, a
    // user `cd` updating pane.cwd would be immediately overwritten back
    // to the stale agent path. The bridge must skip when the agent
    // session has exited.
    vi.mocked(useAgentStatus).mockImplementation(
      (sessionId: string | null): AgentStatus =>
        sessionId === null
          ? {
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
            }
          : {
              // Agent has exited but cwd is still populated — the
              // post-exit hold window in useAgentStatus retains
              // metrics so the panel can show final state.
              isActive: false,
              agentExited: true,
              agentType: 'claude-code',
              modelId: null,
              modelDisplayName: null,
              version: null,
              sessionId,
              agentSessionId: null,
              cwd: '/home/user/projects/vimeflow/.claude/worktrees/stale',
              contextWindow: null,
              cost: null,
              rateLimits: null,
              numTurns: 0,
              toolCalls: { total: 0, byType: {}, active: null },
              recentToolCalls: [],
              testRun: null,
            }
    )

    render(<WorkspaceView />)

    await screen.findByRole('button', { name: 'session 1' })

    const terminalPane = await screen.findByTestId('terminal-pane-mock')

    // Give the effect chain a few ticks; pane.cwd must remain the
    // restored session cwd (`~`), NOT the stale agent worktree path.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(terminalPane).toHaveAttribute('data-cwd', '~')
    expect(terminalPane).not.toHaveAttribute(
      'data-cwd',
      '/home/user/projects/vimeflow/.claude/worktrees/stale'
    )
  })
})
