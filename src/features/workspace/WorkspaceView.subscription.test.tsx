import type { ReactElement, ReactNode } from 'react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WorkspaceView } from './WorkspaceView'
import type { AgentStatus } from '../agent-status/types'
import { useGitStatus } from '../diff/hooks/useGitStatus'
import { useAgentStatus } from '../agent-status/hooks/useAgentStatus'

// Mock TerminalPane / TerminalZone deps to avoid xterm.js in jsdom
vi.mock('../terminal/components/TerminalPane', () => ({
  TerminalPane: vi.fn(() => <div data-testid="terminal-pane-mock" />),
}))

interface MockEditorBuffer {
  filePath: string | null
  originalContent: string
  currentContent: string
  isDirty: boolean
  isLoading: boolean
  openFile: ReturnType<typeof vi.fn>
  saveFile: ReturnType<typeof vi.fn>
  updateContent: ReturnType<typeof vi.fn>
}

vi.mock('../editor/hooks/useEditorBuffer', () => ({
  useEditorBuffer: (): MockEditorBuffer => ({
    filePath: null,
    originalContent: '',
    currentContent: '',
    isDirty: false,
    isLoading: false,
    openFile: vi.fn().mockResolvedValue(undefined),
    saveFile: vi.fn().mockResolvedValue(undefined),
    updateContent: vi.fn(),
  }),
}))

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
        Promise.resolve((): void => {
          /* noop */
        })
    ),
    onExit: vi.fn((): (() => void) => (): void => {
      /* noop */
    }),
    onError: vi.fn((): (() => void) => (): void => {
      /* noop */
    }),
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

// CRITICAL: this mock returns a fresh object per call so reference
// equality distinguishes "one hook call shared by both children" from
// "one hook call per child". The previous WorkspaceView.test.tsx mock
// returns a singleton, which would defeat this assertion.
vi.mock('../agent-status/hooks/useAgentStatus', () => ({
  useAgentStatus: vi.fn(
    (): AgentStatus => ({
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
    })
  ),
}))

vi.mock('../diff/hooks/useGitStatus', () => ({
  // Respect the `enabled` arg so the mock matches real hook semantics
  // (idle iff disabled). A test that asserts on `enabled: true` later
  // gets a non-idle return shape, mirroring what the real hook would
  // return when the parent injects an active subscription.
  useGitStatus: vi.fn(
    (
      _cwd: string | null | undefined,
      options?: { enabled?: boolean; watch?: boolean }
    ) => ({
      files: [],
      filesCwd: null,
      loading: false,
      error: null,
      refresh: vi.fn(),
      idle: options?.enabled === false,
    })
  ),
}))

const capturedPanelProps: { agentStatus?: AgentStatus; gitStatus?: unknown } =
  {}
const capturedDockPanelProps: { gitStatus?: unknown } = {}

interface MockPanelProps {
  agentStatus?: AgentStatus
  gitStatus?: unknown
}

interface MockDockPanelProps {
  gitStatus?: unknown
  tab?: 'editor' | 'diff'
  onTabChange?: (tab: 'editor' | 'diff') => void
  onClose?: () => void
}

interface MockSidebarProps {
  header?: ReactNode
}

// Render the `header` slot through so a mocked SidebarStatusHeader can
// receive its `status` prop. Other slots (content, bottomPane, footer)
// are intentionally dropped — this test only cares about the
// agent-status flow into the header.
vi.mock('../../components/sidebar/Sidebar', () => ({
  Sidebar: ({ header = undefined }: MockSidebarProps): ReactElement => (
    <div data-testid="sidebar-mock">{header}</div>
  ),
}))

const capturedStatusHeaderProps: { status?: AgentStatus } = {}

interface MockSidebarStatusHeaderProps {
  status?: AgentStatus
  activeSessionName?: string | null
}

vi.mock('./components/SidebarStatusHeader', () => ({
  SidebarStatusHeader: ({
    status = undefined,
  }: MockSidebarStatusHeaderProps): ReactElement => {
    capturedStatusHeaderProps.status = status

    return <div data-testid="sidebar-status-header-mock" />
  },
}))

vi.mock('../agent-status/components/AgentStatusPanel', () => ({
  AgentStatusPanel: ({
    agentStatus = undefined,
    gitStatus = undefined,
  }: MockPanelProps): ReactElement => {
    capturedPanelProps.agentStatus = agentStatus
    capturedPanelProps.gitStatus = gitStatus

    return <div data-testid="agent-status-panel-mock" />
  },
}))

vi.mock('./components/DockPanel', () => ({
  default: ({
    gitStatus = undefined,
    onTabChange,
    onClose,
  }: MockDockPanelProps): ReactElement => {
    capturedDockPanelProps.gitStatus = gitStatus

    return (
      <div data-testid="dock-panel-mock">
        {/* Test-only hook to flip the parent's dockTab state.
            Exposed so the diff-tab branch of WorkspaceView's `enabled`
            OR-condition can be exercised without rendering the real
            DockPanel's tab UI. */}
        <button
          data-testid="mock-switch-to-diff"
          onClick={() => onTabChange?.('diff')}
        >
          switch to diff
        </button>
        <button data-testid="mock-close-dock" onClick={onClose}>
          close dock
        </button>
      </div>
    )
  },
}))

describe('WorkspaceView lifted-subscription contract', () => {
  beforeEach(() => {
    capturedPanelProps.agentStatus = undefined
    capturedPanelProps.gitStatus = undefined
    capturedDockPanelProps.gitStatus = undefined
    capturedStatusHeaderProps.status = undefined
    // Clear the mock between tests so `toHaveBeenCalledWith` assertions
    // see only the calls from THIS test's render. Without this,
    // accumulated history from earlier tests can satisfy the assertion
    // vacuously — e.g. tests 1+2 already trigger `enabled: true` calls,
    // making test 3's assertion pass even if test 3's own render
    // computed `enabled: false`.
    vi.mocked(useGitStatus).mockClear()
  })

  test('AgentStatusPanel receives agentStatus', async () => {
    render(<WorkspaceView />)

    // Wait for the children to be rendered with their props captured.
    await screen.findByTestId('sidebar-mock')
    await screen.findByTestId('agent-status-panel-mock')

    expect(capturedPanelProps.agentStatus).toBeDefined()
  })

  test('SidebarStatusHeader and AgentStatusPanel receive the same agentStatus object reference (single-subscription invariant)', async () => {
    // Single-hook-call invariant: WorkspaceView must call useAgentStatus
    // ONCE per render and pass the SAME object reference down to both
    // AgentStatusPanel (direct prop) and SidebarStatusHeader (via the
    // Sidebar.header slot). The mock returns a fresh object per call
    // (lines 80-82 above), so reference equality across the two consumers
    // proves they were sourced from one shared call site (i.e.
    // WorkspaceView.tsx:99).
    //
    // If a future change adds a second useAgentStatus() call inside
    // SidebarStatusHeader (or anywhere else in the tree below
    // WorkspaceView), the two consumers would receive DIFFERENT objects
    // from the per-call fresh mock — and `toBe` would fail. This guards
    // against duplicate Tauri event listeners and stale-state divergence.
    //
    // Originally this invariant was guarded via a Sidebar prop capture.
    // After #178 made Sidebar content-agnostic, the prop went away —
    // this assertion re-establishes the coverage at the new boundary
    // (the SidebarStatusHeader mounted in the header slot). See PR #182
    // Claude review (cycle-3 [MEDIUM]) for the full rationale.
    render(<WorkspaceView />)
    await screen.findByTestId('sidebar-status-header-mock')
    await screen.findByTestId('agent-status-panel-mock')

    expect(capturedStatusHeaderProps.status).toBeDefined()
    expect(capturedPanelProps.agentStatus).toBeDefined()
    expect(capturedStatusHeaderProps.status).toBe(
      capturedPanelProps.agentStatus
    )
  })

  test('AgentStatusPanel and DockPanel receive one shared git status object', async () => {
    render(<WorkspaceView />)

    await screen.findByTestId('agent-status-panel-mock')
    await screen.findByTestId('dock-panel-mock')

    expect(capturedPanelProps.gitStatus).toBeDefined()
    expect(capturedDockPanelProps.gitStatus).toBeDefined()
    expect(capturedPanelProps.gitStatus).toBe(capturedDockPanelProps.gitStatus)
  })

  test('WorkspaceView calls useGitStatus with enabled: true when an agent is active', async () => {
    // Locks the isActive arm of the OR-condition. With
    // `agentStatus.isActive = true`, WorkspaceView must compute
    // `enabled: true` and pass it into the shared `useGitStatus` call.
    // Without this assertion, a regression that flipped `enabled` to
    // `false` (e.g. a misread of `isActive`) would silently turn the
    // watcher off — child components would still render via their
    // `gitStatus !== undefined` fallback path, masking the regression
    // in the existing reference-equality assertion.
    render(<WorkspaceView />)

    await screen.findByTestId('agent-status-panel-mock')

    expect(useGitStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ watch: true, enabled: true })
    )
  })

  test('WorkspaceView passes enabled: true when the diff tab is active even if the agent is idle', async () => {
    // Locks the diff-tab arm of the OR-condition. With
    // `agentStatus.isActive = false` AND `dockTab = 'diff'`,
    // `enabled` must still be `true` — otherwise opening the diff tab
    // on an idle workspace silently runs without a watcher and the
    // diff panel falls through to its own internal fallback (no visible
    // breakage, but the lifted-state optimization degrades to pre-PR
    // behavior). The previous test (always-active agent) couldn't
    // exercise this path because `true || X` is permanently true.
    //
    // CRITICAL: mockReturnValue (persistent), not mockReturnValueOnce.
    // The tab-switch triggers a WorkspaceView re-render that calls
    // useAgentStatus again; if the override only covered the first
    // call, the second render would fall back to the default active-
    // agent factory and the final assertion would pass through the
    // isActive arm — leaving the diff-tab arm unverified (the bug
    // codex caught in round-2 v1).
    const idleAgentStatus: AgentStatus = {
      isActive: false,
      agentType: null,
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
    }
    const useAgentStatusMock = vi.mocked(useAgentStatus)
    // Capture the factory's active-agent implementation so we can restore
    // it after the test — without this, subsequent tests would see the
    // idle override leaking through.
    const originalImpl = useAgentStatusMock.getMockImplementation()
    useAgentStatusMock.mockImplementation(() => idleAgentStatus)

    try {
      render(<WorkspaceView />)
      await screen.findByTestId('dock-panel-mock')

      // First render: agent idle + tab='editor' → enabled: false
      expect(useGitStatus).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ watch: true, enabled: false })
      )

      // Flip the tab to diff via the DockPanel mock's exposed button.
      // After re-render, useGitStatus must be called with enabled: true
      // — and because the agent is STILL idle (mockImplementation is
      // persistent across re-renders), that `true` can only come from
      // the `dockTab === 'diff'` arm, which is what this test is
      // meant to exercise. (Round-2 verify caught a subtle bug here:
      // mockReturnValueOnce only covered the first call, so the
      // re-render fell back to the active default and the assertion
      // passed via the wrong branch — this version uses mockImplementation
      // to keep the agent idle across all renders within the test.)
      vi.mocked(useGitStatus).mockClear()
      fireEvent.click(screen.getByTestId('mock-switch-to-diff'))

      expect(useGitStatus).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ watch: true, enabled: true })
      )
    } finally {
      if (originalImpl) {
        useAgentStatusMock.mockImplementation(originalImpl)
      }
    }
  })

  test('WorkspaceView passes enabled: false when idle diff dock is closed', async () => {
    const idleAgentStatus: AgentStatus = {
      isActive: false,
      agentType: null,
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
    }
    const useAgentStatusMock = vi.mocked(useAgentStatus)
    const originalImpl = useAgentStatusMock.getMockImplementation()
    useAgentStatusMock.mockImplementation(() => idleAgentStatus)

    try {
      render(<WorkspaceView />)
      await screen.findByTestId('dock-panel-mock')

      fireEvent.click(screen.getByTestId('mock-switch-to-diff'))
      expect(useGitStatus).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ watch: true, enabled: true })
      )

      vi.mocked(useGitStatus).mockClear()
      fireEvent.click(screen.getByTestId('mock-close-dock'))

      expect(useGitStatus).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ watch: true, enabled: false })
      )
    } finally {
      if (originalImpl) {
        useAgentStatusMock.mockImplementation(originalImpl)
      }
    }
  })
})
