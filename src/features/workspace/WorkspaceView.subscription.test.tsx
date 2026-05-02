import type { ReactElement } from 'react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WorkspaceView } from './WorkspaceView'
import type { AgentStatus } from '../agent-status/types'
import { useGitStatus } from '../diff/hooks/useGitStatus'

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
    spawn: vi.fn().mockResolvedValue({ sessionId: 'new-id', pid: 999 }),
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

const capturedSidebarProps: { agentStatus?: AgentStatus } = {}

const capturedPanelProps: { agentStatus?: AgentStatus; gitStatus?: unknown } =
  {}
const capturedBottomDrawerProps: { gitStatus?: unknown } = {}

interface MockSidebarProps {
  agentStatus?: AgentStatus
}

interface MockPanelProps {
  agentStatus?: AgentStatus
  gitStatus?: unknown
}

interface MockBottomDrawerProps {
  gitStatus?: unknown
}

vi.mock('./components/Sidebar', () => ({
  Sidebar: ({ agentStatus = undefined }: MockSidebarProps): ReactElement => {
    capturedSidebarProps.agentStatus = agentStatus

    return <div data-testid="sidebar-mock" />
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

vi.mock('./components/BottomDrawer', () => ({
  default: ({ gitStatus = undefined }: MockBottomDrawerProps): ReactElement => {
    capturedBottomDrawerProps.gitStatus = gitStatus

    return <div data-testid="bottom-drawer-mock" />
  },
}))

describe('WorkspaceView lifted-subscription contract', () => {
  beforeEach(() => {
    capturedSidebarProps.agentStatus = undefined
    capturedPanelProps.agentStatus = undefined
    capturedPanelProps.gitStatus = undefined
    capturedBottomDrawerProps.gitStatus = undefined
  })

  test('Sidebar and AgentStatusPanel receive agentStatus from a single hook call', async () => {
    render(<WorkspaceView />)

    // Wait for the children to be rendered with their props captured.
    await screen.findByTestId('sidebar-mock')
    await screen.findByTestId('agent-status-panel-mock')

    expect(capturedSidebarProps.agentStatus).toBeDefined()
    expect(capturedPanelProps.agentStatus).toBeDefined()

    // Reference equality. Because the useAgentStatus mock above returns
    // a FRESH object per call (the factory runs anew each invocation),
    // two separate hook calls would yield two distinct objects, and
    // `toBe` would fail. A single hook call shared by both children
    // yields the same object reference and `toBe` passes.
    expect(capturedSidebarProps.agentStatus).toBe(
      capturedPanelProps.agentStatus
    )
  })

  test('AgentStatusPanel and BottomDrawer receive one shared git status object', async () => {
    render(<WorkspaceView />)

    await screen.findByTestId('agent-status-panel-mock')
    await screen.findByTestId('bottom-drawer-mock')

    expect(capturedPanelProps.gitStatus).toBeDefined()
    expect(capturedBottomDrawerProps.gitStatus).toBeDefined()
    expect(capturedPanelProps.gitStatus).toBe(
      capturedBottomDrawerProps.gitStatus
    )
  })

  test('WorkspaceView calls useGitStatus with enabled: true when an agent is active', async () => {
    // Locks the activation contract: with `agentStatus.isActive = true`,
    // WorkspaceView must compute `enabled: true` and pass it into the
    // shared `useGitStatus` call. Without this assertion, a regression
    // that flipped `enabled` to `false` (e.g. a misread of `isActive`,
    // or a typo in the OR-condition with `bottomDrawerTab === 'diff'`)
    // would silently turn the watcher off — child components would still
    // render via their `gitStatus !== undefined` fallback path, masking
    // the regression in the existing reference-equality assertion.
    render(<WorkspaceView />)

    await screen.findByTestId('agent-status-panel-mock')

    expect(useGitStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ watch: true, enabled: true })
    )
  })
})
