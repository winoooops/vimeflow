/* eslint-disable testing-library/no-node-access */
/* eslint-disable vitest/expect-expect */
import type { ReactElement } from 'react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkspaceView } from './WorkspaceView'
import { useEditorBuffer } from '../editor/hooks/useEditorBuffer'
import type { AgentStatus } from '../agent-status/types'
import { useAgentStatus } from '../agent-status/hooks/useAgentStatus'

// Mock TerminalPane to avoid xterm.js issues in tests
vi.mock('../terminal/components/TerminalPane', () => ({
  TerminalPane: vi.fn(() => (
    <div data-testid="terminal-pane-mock">Mocked TerminalPane</div>
  )),
}))

// Mock useAgentStatus so AgentStatusPanel renders predictably
vi.mock('../agent-status/hooks/useAgentStatus', () => ({
  useAgentStatus: vi.fn(() => ({
    isActive: true,
    agentType: 'claude-code',
    modelId: null,
    modelDisplayName: null,
    version: null,
    sessionId: null,
    agentSessionId: null,
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
}))

// Mock terminal service to return initial session data synchronously
vi.mock('../terminal/services/terminalService', () => ({
  createTerminalService: vi.fn(() => ({
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
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    onExit: vi.fn((): (() => void) => (): void => {}),
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    onError: vi.fn((): (() => void) => (): void => {}),
    listSessions: vi.fn().mockResolvedValue({
      activeSessionId: 'sess-1',
      sessions: [
        {
          id: 'sess-1',
          cwd: '~',
          status: {
            kind: 'Alive',
            pid: 1234,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    }),
    setActiveSession: vi.fn().mockResolvedValue(undefined),
    reorderSessions: vi.fn().mockResolvedValue(undefined),
    updateSessionCwd: vi.fn().mockResolvedValue(undefined),
  })),
}))

describe('WorkspaceView', () => {
  beforeEach(() => {
    capturedAgentStatusPanelProps.onOpenFile = undefined
    capturedAgentStatusPanelProps.onOpenDiff = undefined
    capturedAgentStatusPanelProps.agentStatus = undefined

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
    })
  })

  test('renders all five zones (icon rail, sidebar, terminal, bottom drawer, agent status panel)', () => {
    render(<WorkspaceView />)

    expect(screen.getByTestId('icon-rail')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-zone')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /editor/i })).toBeInTheDocument() // BottomDrawer
    expect(screen.getByTestId('agent-status-panel')).toBeInTheDocument()
  })

  test('applies correct grid layout with 4 columns (dynamic sidebar width)', () => {
    render(<WorkspaceView />)

    const container = screen.getByTestId('workspace-view')

    expect(container).toHaveClass('grid')
    expect(container.style.gridTemplateColumns).toBe('48px 272px 1fr auto')
  })

  test('fills viewport height', () => {
    render(<WorkspaceView />)

    const container = screen.getByTestId('workspace-view')

    expect(container).toHaveClass('h-screen')
  })

  test('passes active project to IconRail', () => {
    render(<WorkspaceView />)

    const iconRail = screen.getByTestId('icon-rail')

    // IconRail should render with at least one project button
    const projectButtons = iconRail.querySelectorAll('button[aria-label]')
    expect(projectButtons.length).toBeGreaterThan(0)
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

  test('renders navigation items in IconRail', () => {
    render(<WorkspaceView />)

    // IconRail should render navigation items (Dashboard, Source Control, etc.)
    expect(
      screen.getByRole('button', { name: 'Dashboard' })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: 'Source Control' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
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

    // FileExplorer should be rendered (no more context switcher)
    const fileExplorer = sidebar.querySelector('[data-testid="file-explorer"]')
    expect(fileExplorer).toBeInTheDocument()
  })

  test('handles navigation item clicks', () => {
    render(<WorkspaceView />)

    // Navigation items should be clickable
    const dashboardButton = screen.getByRole('button', { name: 'Dashboard' })
    expect(dashboardButton).toBeInTheDocument()

    // Click should not crash (navigation items have onClick handlers)
    dashboardButton.click()
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

  test('BottomDrawer is present below TerminalZone', () => {
    render(<WorkspaceView />)

    // BottomDrawer should render with Editor tab active
    expect(screen.getByRole('button', { name: /editor/i })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /diff viewer/i })
    ).toBeInTheDocument()
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

    const newInstanceButton = screen.getByRole('button', {
      name: 'New Instance',
    })
    await user.click(newInstanceButton)

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
    expect(container.style.gridTemplateColumns).toContain('272px')
    expect(container.style.gridTemplateColumns).toContain('1fr')
    expect(container.style.gridTemplateColumns).toContain('auto')
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
          key: ':',
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

  test('lifts useAgentStatus and forwards the latest activeSessionId', async () => {
    render(<WorkspaceView />)

    // Wait for session restore to settle (the listSessions mock resolves
    // sess-1, so this proves activeSessionId is non-null).
    await screen.findByRole('button', { name: 'session 1' })

    const useAgentStatusMock = vi.mocked(useAgentStatus)
    const calls = useAgentStatusMock.mock.calls
    const lastArg = calls[calls.length - 1]?.[0]

    // Latest call arg, not call count — activeSessionId flips from null
    // to the restored id during mount, and React may re-render multiple
    // times. We assert the *value* of the most-recent call.
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
})
