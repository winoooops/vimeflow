// cspell:ignore worktrees
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useSessionManager } from './useSessionManager'
import type { ITerminalService } from '../../terminal/services/terminalService'
import type { PTYSpawnResult } from '../../terminal/types'
import type {
  AgentLifecycleEvent,
  AgentSessionTitleEvent,
  SessionList,
} from '../../../bindings'
import type { AgentStatusEvent } from '../../agent-status/types'
import {
  clearPtySessionMap,
  getAllPtySessionIds,
  registerPtySession,
} from '../../terminal/ptySessionMap'
import { readActivityPanelCollapsed } from '../utils/activityPanelCollapsedStore'
import type {
  PersistedShellPaneShape,
  PersistedWorkspacePaneShape,
  PersistedWorkspaceSessionShape,
  PersistedWorkspaceShape,
} from '../workspaceLayoutBridge'
import {
  loadWorkspaceForRestore,
  pushWorkspaceShape,
} from '../workspaceLayoutBridge'
import { DEFAULT_BROWSER_URL } from '../../browser/types'
import { createBrowserPane } from '../../browser/browserBridge'
import type { PaneLayoutDefinition } from '../../terminal/layout-registry'

const customGrid2x2 = (): PaneLayoutDefinition => ({
  schemaVersion: 1,
  id: 'custom:grid-2x2',
  title: 'Custom grid 2x2',
  source: 'workspace',
  tracks: {
    columns: [
      { id: 'c0', units: 12 },
      { id: 'c1', units: 12 },
    ],
    rows: [
      { id: 'r0', units: 12 },
      { id: 'r1', units: 12 },
    ],
  },
  slots: [
    { id: 'slot:p0', rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 } },
    { id: 'slot:p1', rect: { col: 1, row: 0, colSpan: 1, rowSpan: 1 } },
    { id: 'slot:p2', rect: { col: 0, row: 1, colSpan: 1, rowSpan: 1 } },
    { id: 'slot:p3', rect: { col: 1, row: 1, colSpan: 1, rowSpan: 1 } },
  ],
  addOrder: ['slot:p0', 'slot:p1', 'slot:p2', 'slot:p3'],
})

const shadowSingleCustomLayout = (): PaneLayoutDefinition => ({
  ...customGrid2x2(),
  id: 'single',
  title: 'Shadow single',
})

const customGrid4x2 = (): PaneLayoutDefinition => ({
  schemaVersion: 1,
  id: 'custom:grid-4x2',
  title: 'Custom grid 4x2',
  source: 'workspace',
  tracks: {
    columns: [
      { id: 'c0', units: 12 },
      { id: 'c1', units: 12 },
      { id: 'c2', units: 12 },
      { id: 'c3', units: 12 },
    ],
    rows: [
      { id: 'r0', units: 12 },
      { id: 'r1', units: 12 },
    ],
  },
  slots: [
    { id: 'slot:p0', rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 } },
    { id: 'slot:p1', rect: { col: 1, row: 0, colSpan: 1, rowSpan: 1 } },
    { id: 'slot:p2', rect: { col: 2, row: 0, colSpan: 1, rowSpan: 1 } },
    { id: 'slot:p3', rect: { col: 3, row: 0, colSpan: 1, rowSpan: 1 } },
    { id: 'slot:p4', rect: { col: 0, row: 1, colSpan: 1, rowSpan: 1 } },
    { id: 'slot:p5', rect: { col: 1, row: 1, colSpan: 1, rowSpan: 1 } },
    { id: 'slot:p6', rect: { col: 2, row: 1, colSpan: 1, rowSpan: 1 } },
    { id: 'slot:p7', rect: { col: 3, row: 1, colSpan: 1, rowSpan: 1 } },
  ],
  addOrder: [
    'slot:p0',
    'slot:p1',
    'slot:p2',
    'slot:p3',
    'slot:p4',
    'slot:p5',
    'slot:p6',
    'slot:p7',
  ],
})

const mockListen = vi.hoisted(() =>
  vi.fn(
    (
      event: string,
      callback: (payload: unknown) => void
    ): Promise<() => void> => {
      void event
      void callback

      // eslint-disable-next-line @typescript-eslint/no-empty-function
      return Promise.resolve((): void => {})
    }
  )
)
const mockInvoke = vi.hoisted(() => vi.fn(() => Promise.resolve(false)))

vi.mock('../../../lib/backend', () => ({
  invoke: mockInvoke,
  listen: mockListen,
}))

vi.mock('../workspaceLayoutBridge', () => ({
  pushWorkspaceShape: vi.fn(),
  loadWorkspaceForRestore: vi.fn(() => Promise.resolve(null)),
  beginWorkspaceHydration: vi.fn(() => Promise.resolve()),
  endWorkspaceHydration: vi.fn(() => Promise.resolve()),
  onWorkspaceRequestFinalShape: vi.fn(() => (): void => undefined),
}))

// Partial mock: only spy on createBrowserPane; keep destroyBrowserPane /
// focusBrowserPane as their real (no-bridge) no-ops so removeSession and the
// active-session controller still behave.
vi.mock('../../browser/browserBridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../browser/browserBridge')>()),
  createBrowserPane: vi.fn(() => Promise.resolve(null)),
}))

const createMockService = (): ITerminalService => ({
  spawn: vi
    .fn()
    .mockResolvedValue({ sessionId: 'new-id', pid: 123, cwd: '/home/user' }),
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
  onBurnerForeground: vi.fn(
    (): Promise<() => void> => Promise.resolve((): void => undefined)
  ),
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

const persistedShellPane = (
  overrides: Partial<PersistedShellPaneShape> = {}
): PersistedShellPaneShape => ({
  kind: 'shell',
  paneId: 'p0',
  paneIndex: 0,
  active: true,
  ptyId: 'pty-old',
  cwd: '/repo',
  agentType: 'codex',
  agentSessionId: null,
  ...overrides,
})

const persistedWorkspace = (
  panes: PersistedWorkspacePaneShape[],
  overrides: Partial<Omit<PersistedWorkspaceSessionShape, 'panes'>> = {}
): PersistedWorkspaceShape => ({
  sessions: [
    {
      id: 'ws-shell',
      projectId: 'proj-1',
      layout: panes.length > 1 ? 'vsplit' : 'single',
      workingDirectory: '/repo',
      active: true,
      open: true,
      ...overrides,
      panes,
    },
  ],
})

const agentStatusEvent = (
  overrides: Partial<AgentStatusEvent>
): AgentStatusEvent => ({
  sessionId: 'pty-1',
  agentSessionId: null,
  modelId: null,
  modelDisplayName: null,
  version: null,
  contextWindow: null,
  cost: null,
  rateLimits: null,
  usageFetched: false,
  ...overrides,
})

const contextWindow = (
  tokenTotal: number
): AgentStatusEvent['contextWindow'] => ({
  usedPercentage: 0,
  remainingPercentage: 100,
  contextWindowSize: BigInt(200_000),
  totalInputTokens: BigInt(tokenTotal),
  totalOutputTokens: BigInt(0),
  currentUsage: null,
})

const titleListener = ():
  | ((payload: AgentSessionTitleEvent) => void)
  | undefined =>
  mockListen.mock.calls.find(([event]) => event === 'agent-session-title')?.[1]

const statusListener = (): ((payload: AgentStatusEvent) => void) | undefined =>
  mockListen.mock.calls.find(([event]) => event === 'agent-status')?.[1]

describe('useSessionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockReset()
    mockInvoke.mockResolvedValue(false)
    window.vimeflow = {
      invoke: vi.fn(),
      listen: vi.fn(),
    }
    clearPtySessionMap()
    window.localStorage.clear()
  })

  afterEach(() => {
    delete window.vimeflow
  })

  test('on mount, registers global pty-data listener BEFORE calling listSessions', async () => {
    const order: string[] = []
    const service = createMockService()
    service.onData = vi.fn((cb): Promise<() => void> => {
      void cb
      order.push('onData')

      // eslint-disable-next-line @typescript-eslint/no-empty-function
      return Promise.resolve((): void => {})
    })

    service.listSessions = vi.fn(() => {
      order.push('listSessions')

      return Promise.resolve({ activeSessionId: null, sessions: [] })
    })

    renderHook(() => useSessionManager(service, { autoCreateOnEmpty: false }))

    await waitFor(() => expect(service.listSessions).toHaveBeenCalled())
    expect(order).toEqual(['onData', 'listSessions'])
  })

  test('updateBrowserPaneUrl preserves session identity when URL is unchanged', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'pty-1',
      sessions: [
        {
          id: 'pty-1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    const sessionId = result.current.sessions[0].id

    act(() => {
      result.current.setSessionLayout(sessionId, 'vsplit')
    })

    await waitFor(() => {
      expect(result.current.sessions[0].layout).toBe('vsplit')
    })

    act(() => {
      result.current.addPane(sessionId, 'browser')
    })

    await waitFor(() => {
      expect(
        result.current.sessions[0].panes.some((pane) => pane.kind === 'browser')
      ).toBe(true)
    })

    const sessionsBeforeNoop = result.current.sessions
    const sessionBeforeNoop = result.current.sessions[0]

    const browserPane = sessionBeforeNoop.panes.find(
      (pane) => pane.kind === 'browser'
    )

    if (!browserPane) {
      throw new Error('expected browser pane')
    }

    const updateBrowserPaneUrl = result.current.updateBrowserPaneUrl

    if (!updateBrowserPaneUrl) {
      throw new Error('expected updateBrowserPaneUrl')
    }

    act(() => {
      updateBrowserPaneUrl(
        sessionId,
        browserPane.id,
        browserPane.browserUrl ?? 'https://www.google.com/'
      )
    })

    expect(result.current.sessions).toBe(sessionsBeforeNoop)
    expect(result.current.sessions[0]).toBe(sessionBeforeNoop)

    act(() => {
      updateBrowserPaneUrl(sessionId, browserPane.id, 'https://example.com/')
    })

    expect(result.current.sessions).not.toBe(sessionsBeforeNoop)
    expect(result.current.sessions[0]).not.toBe(sessionBeforeNoop)
    expect(result.current.sessions[0].panes[1].browserUrl).toBe(
      'https://example.com/'
    )
  })

  test('agent-session-title with matching ptyId updates the pane', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'pty-1',
      sessions: [
        {
          id: 'pty-1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(titleListener()).toBeDefined())

    act(() => {
      titleListener()?.({
        sessionId: 'pty-1',
        agentSessionId: 'agent-uuid',
        title: 'My Task',
        source: 'ai-generated',
      })
    })

    const pane = result.current.sessions[0]?.panes.find(
      (candidate) => candidate.ptyId === 'pty-1'
    )
    expect(pane?.agentTitle).toBe('My Task')
    expect(pane?.agentTitleSource).toBe('ai-generated')
    expect(pane?.agentSessionId).toBe('agent-uuid')
  })

  test('agent-status binds conversation identity without a title event', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'pty-1',
      sessions: [
        {
          id: 'pty-1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(statusListener()).toBeDefined())

    act(() => {
      statusListener()?.(
        agentStatusEvent({
          sessionId: 'pty-1',
          agentSessionId: 'ses_opencode001',
        })
      )
    })

    expect(result.current.sessions[0].panes[0].agentSessionId).toBe(
      'ses_opencode001'
    )
  })

  test('appendPaneCacheReading appends a changed reading once and persists by ptyId', async () => {
    window.localStorage.clear()
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'pty-1',
      sessions: [
        {
          id: 'pty-1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    const sessionId = result.current.sessions[0].id
    const paneId = result.current.sessions[0].panes[0].id

    act(() => {
      result.current.appendPaneCacheReading(sessionId, paneId, 75)
      result.current.appendPaneCacheReading(sessionId, paneId, 75)
    })

    expect(result.current.sessions[0].panes[0].cacheHistory).toEqual([75])
    expect(
      JSON.parse(
        window.localStorage.getItem('vimeflow:agent:cacheHistory:pty-1') ??
          'null'
      )
    ).toEqual([75])
  })

  test('clearPaneCacheHistory clears pane cacheHistory and deletes its persisted key', async () => {
    window.localStorage.clear()
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'pty-1',
      sessions: [
        {
          id: 'pty-1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.appendPaneCacheReading('pty-1', 'p0', 75)
    })
    expect(result.current.sessions[0].panes[0].cacheHistory).toEqual([75])

    act(() => {
      result.current.clearPaneCacheHistory('pty-1', 'p0')
    })

    expect(result.current.sessions[0].panes[0].cacheHistory).toEqual([])
    expect(
      window.localStorage.getItem('vimeflow:agent:cacheHistory:pty-1')
    ).toBeNull()
  })

  test('removeSession deletes the pane cacheHistory key for the killed pty', async () => {
    window.localStorage.clear()
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'pty-1',
      sessions: [
        {
          id: 'pty-1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    const sessionId = result.current.sessions[0].id
    const paneId = result.current.sessions[0].panes[0].id
    act(() => {
      result.current.appendPaneCacheReading(sessionId, paneId, 75)
    })

    expect(
      window.localStorage.getItem('vimeflow:agent:cacheHistory:pty-1')
    ).not.toBeNull()

    act(() => {
      result.current.removeSession(sessionId)
    })

    await waitFor(() =>
      expect(result.current.sessions.find((s) => s.id === sessionId)).toBe(
        undefined
      )
    )

    expect(
      window.localStorage.getItem('vimeflow:agent:cacheHistory:pty-1')
    ).toBeNull()
  })

  test('empty agent-session-title clears agentTitle to undefined', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'pty-1',
      sessions: [
        {
          id: 'pty-1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(titleListener()).toBeDefined())

    // Seed an ai-generated title so the clear below has something to
    // wipe. A user-renamed first event is covered by the "cleared
    // agent-session-title cannot wipe a user-renamed agentTitle" test —
    // user-renamed is sticky against later ai-generated clears.
    act(() => {
      titleListener()?.({
        sessionId: 'pty-1',
        agentSessionId: 'agent-uuid',
        title: 'Old Task',
        source: 'ai-generated',
      })
    })

    act(() => {
      titleListener()?.({
        sessionId: 'pty-1',
        agentSessionId: 'agent-uuid',
        title: '',
        source: 'ai-generated',
      })
    })

    const pane = result.current.sessions[0]?.panes.find(
      (candidate) => candidate.ptyId === 'pty-1'
    )
    expect(pane?.agentTitle).toBeUndefined()
    expect(pane?.agentTitleSource).toBeUndefined()
  })

  test('matching user-renamed agent-session-title clears temporary userLabel', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'pty-1',
      sessions: [
        {
          id: 'pty-1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(titleListener()).toBeDefined())

    // Simulate the user setting a local label via the chord / palette.
    act(() => {
      result.current.setPaneUserLabel('pty-1', 'new-title')
    })

    // Now Claude / Codex confirms the same `/rename` value. The temporary
    // local label can clear because the transcript has caught up.
    act(() => {
      titleListener()?.({
        sessionId: 'pty-1',
        agentSessionId: 'agent-uuid',
        title: 'new-title',
        source: 'user-renamed',
      })
    })

    const pane = result.current.sessions[0]?.panes.find(
      (candidate) => candidate.ptyId === 'pty-1'
    )
    expect(pane?.agentTitle).toBe('new-title')
    expect(pane?.userLabel).toBeUndefined()
  })

  test('user-renamed agent-session-title preserves newer temporary userLabel', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'pty-1',
      sessions: [
        {
          id: 'pty-1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(titleListener()).toBeDefined())

    act(() => {
      result.current.setPaneUserLabel('pty-1', 'local-name')
    })

    act(() => {
      titleListener()?.({
        sessionId: 'pty-1',
        agentSessionId: 'agent-uuid',
        title: 'agent-title',
        source: 'user-renamed',
      })
    })

    const pane = result.current.sessions[0]?.panes.find(
      (candidate) => candidate.ptyId === 'pty-1'
    )
    expect(pane?.agentTitle).toBe('agent-title')
    expect(pane?.agentTitleSource).toBe('user-renamed')
    expect(pane?.userLabel).toBe('local-name')
  })

  test('conditional setPaneUserLabel clear preserves changed userLabel', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'pty-1',
      sessions: [
        {
          id: 'pty-1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.setPaneUserLabel('pty-1', 'old-title')
      result.current.setPaneUserLabel('pty-1', 'new-title')
      result.current.setPaneUserLabel('pty-1', undefined, {
        ifCurrentLabel: 'old-title',
      })
    })

    const pane = result.current.sessions[0]?.panes.find(
      (candidate) => candidate.ptyId === 'pty-1'
    )
    expect(pane?.userLabel).toBe('new-title')
  })

  test('ai-generated agent-session-title preserves explicit userLabel', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'pty-1',
      sessions: [
        {
          id: 'pty-1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(titleListener()).toBeDefined())

    act(() => {
      result.current.setPaneUserLabel('pty-1', 'local-name')
    })

    act(() => {
      titleListener()?.({
        sessionId: 'pty-1',
        agentSessionId: 'agent-uuid',
        title: 'agent-auto-title',
        source: 'ai-generated',
      })
    })

    const pane = result.current.sessions[0]?.panes.find(
      (candidate) => candidate.ptyId === 'pty-1'
    )
    expect(pane?.agentTitle).toBe('agent-auto-title')
    expect(pane?.agentTitleSource).toBe('ai-generated')
    expect(pane?.userLabel).toBe('local-name')
  })

  test('empty agent-session-title clears userLabel', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'pty-1',
      sessions: [
        {
          id: 'pty-1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(titleListener()).toBeDefined())

    // User sets local label.
    act(() => {
      result.current.setPaneUserLabel('pty-1', 'my-label')
    })

    // Agent emits a "clear" event (e.g., agent exited, row vanished).
    act(() => {
      titleListener()?.({
        sessionId: 'pty-1',
        agentSessionId: 'agent-uuid',
        title: '',
        source: 'ai-generated',
      })
    })

    const pane = result.current.sessions[0]?.panes.find(
      (candidate) => candidate.ptyId === 'pty-1'
    )
    expect(pane?.agentTitle).toBeUndefined()
    expect(pane?.agentTitleSource).toBeUndefined()
    expect(pane?.userLabel).toBeUndefined()
  })

  test('ai-generated agent-session-title cannot overwrite a user-renamed agentTitle', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'pty-1',
      sessions: [
        {
          id: 'pty-1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(titleListener()).toBeDefined())

    act(() => {
      result.current.setPaneUserLabel('pty-1', 'user-title')
    })

    // Agent confirms the rename: userLabel clears, agentTitle inherits
    // 'user-title', agentTitleSource flips to 'user-renamed'.
    act(() => {
      titleListener()?.({
        sessionId: 'pty-1',
        agentSessionId: 'agent-uuid',
        title: 'user-title',
        source: 'user-renamed',
      })
    })

    // Claude later writes its own ai-title JSONL line — without the
    // guard this clobbered agentTitle and silently dropped the user's
    // rename intent (path A of the revert bug).
    act(() => {
      titleListener()?.({
        sessionId: 'pty-1',
        agentSessionId: 'agent-uuid',
        title: 'agent-auto-title',
        source: 'ai-generated',
      })
    })

    const pane = result.current.sessions[0]?.panes.find(
      (candidate) => candidate.ptyId === 'pty-1'
    )
    expect(pane?.agentTitle).toBe('user-title')
    expect(pane?.agentTitleSource).toBe('user-renamed')
    expect(pane?.userLabel).toBeUndefined()
  })

  test('ai-generated with title matching user-renamed agentTitle preserves the sticky source', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'pty-1',
      sessions: [
        {
          id: 'pty-1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(titleListener()).toBeDefined())

    act(() => {
      result.current.setPaneUserLabel('pty-1', 'shared-title')
    })

    act(() => {
      titleListener()?.({
        sessionId: 'pty-1',
        agentSessionId: 'agent-uuid',
        title: 'shared-title',
        source: 'user-renamed',
      })
    })

    // ai-generated with a title that happens to match the user's rename
    // (e.g., Codex re-emits the persisted thread_name as ai-generated
    // after a transient clear consumed the pending rename claim). An
    // earlier guard that included `payload.title !== pane.agentTitle`
    // let this fall through and silently downgrade agentTitleSource to
    // 'ai-generated', removing the protection for the next event.
    act(() => {
      titleListener()?.({
        sessionId: 'pty-1',
        agentSessionId: 'agent-uuid',
        title: 'shared-title',
        source: 'ai-generated',
      })
    })

    let pane = result.current.sessions[0]?.panes.find(
      (candidate) => candidate.ptyId === 'pty-1'
    )
    expect(pane?.agentTitle).toBe('shared-title')
    expect(pane?.agentTitleSource).toBe('user-renamed')

    // The protection must still hold: a subsequent ai-generated with a
    // different title cannot overwrite the user's rename.
    act(() => {
      titleListener()?.({
        sessionId: 'pty-1',
        agentSessionId: 'agent-uuid',
        title: 'different-ai-title',
        source: 'ai-generated',
      })
    })

    pane = result.current.sessions[0]?.panes.find(
      (candidate) => candidate.ptyId === 'pty-1'
    )
    expect(pane?.agentTitle).toBe('shared-title')
    expect(pane?.agentTitleSource).toBe('user-renamed')
  })

  test('user-renamed with empty title clears the sticky guard (lifecycle reset)', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'pty-1',
      sessions: [
        {
          id: 'pty-1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(titleListener()).toBeDefined())

    act(() => {
      result.current.setPaneUserLabel('pty-1', 'Foo')
    })

    act(() => {
      titleListener()?.({
        sessionId: 'pty-1',
        agentSessionId: 'agent-uuid',
        title: 'Foo',
        source: 'user-renamed',
      })
    })

    // Explicit lifecycle reset: the agent emits a user-renamed event
    // with an empty title. This is the documented escape hatch out of
    // sticky state — distinct from a transient ai-generated clear, which
    // is blocked by the guard.
    act(() => {
      titleListener()?.({
        sessionId: 'pty-1',
        agentSessionId: 'agent-uuid',
        title: '',
        source: 'user-renamed',
      })
    })

    const pane = result.current.sessions[0]?.panes.find(
      (candidate) => candidate.ptyId === 'pty-1'
    )
    expect(pane?.agentTitle).toBeUndefined()
    expect(pane?.agentTitleSource).toBeUndefined()
    expect(pane?.userLabel).toBeUndefined()
  })

  test('cleared agent-session-title cannot wipe a user-renamed agentTitle', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'pty-1',
      sessions: [
        {
          id: 'pty-1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(titleListener()).toBeDefined())

    act(() => {
      result.current.setPaneUserLabel('pty-1', 'user-title')
    })

    act(() => {
      titleListener()?.({
        sessionId: 'pty-1',
        agentSessionId: 'agent-uuid',
        title: 'user-title',
        source: 'user-renamed',
      })
    })

    // Codex watcher emits a transient clear (read_thread_name returned
    // None during an atomic rewrite of session_index.jsonl). Without the
    // guard this wiped agentTitle and dropped the header to session.name
    // (path B of the revert bug).
    act(() => {
      titleListener()?.({
        sessionId: 'pty-1',
        agentSessionId: 'agent-uuid',
        title: '',
        source: 'ai-generated',
      })
    })

    const pane = result.current.sessions[0]?.panes.find(
      (candidate) => candidate.ptyId === 'pty-1'
    )
    expect(pane?.agentTitle).toBe('user-title')
    expect(pane?.agentTitleSource).toBe('user-renamed')
  })

  test('agent-session-title for unknown ptyId does not change state identity', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'pty-1',
      sessions: [
        {
          id: 'pty-1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(titleListener()).toBeDefined())

    const before = result.current.sessions
    act(() => {
      titleListener()?.({
        sessionId: 'missing-pty',
        agentSessionId: 'agent-uuid',
        title: 'Ignored',
        source: 'ai-generated',
      })
    })

    expect(result.current.sessions).toBe(before)
  })

  test('agent-session-title listener calls unlisten when listen resolves after unmount', async () => {
    const service = createMockService()
    const unlisten = vi.fn()
    let resolveListen: (fn: () => void) => void = vi.fn()
    mockListen.mockImplementationOnce(
      (): Promise<() => void> =>
        new Promise((resolve) => {
          resolveListen = resolve
        })
    )

    const { unmount } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(mockListen).toHaveBeenCalled())

    unmount()
    act(() => {
      resolveListen(unlisten)
    })

    await waitFor(() => expect(unlisten).toHaveBeenCalled())
  })

  test('agent-session-title listener setup rejection is caught', async () => {
    const service = createMockService()
    mockListen.mockRejectedValueOnce(new Error('bridge unavailable'))

    renderHook(() => useSessionManager(service, { autoCreateOnEmpty: false }))

    await waitFor(() =>
      expect(mockListen).toHaveBeenCalledWith(
        'agent-session-title',
        expect.any(Function)
      )
    )
    await Promise.resolve()
    expect(service.listSessions).toHaveBeenCalled()
  })

  test('agent-session-title listener stays inactive without desktop bridge', async () => {
    delete window.vimeflow
    const service = createMockService()

    renderHook(() => useSessionManager(service, { autoCreateOnEmpty: false }))

    await waitFor(() => expect(service.listSessions).toHaveBeenCalled())
    expect(mockListen).not.toHaveBeenCalled()
  })

  const getLifecycleCallback = ():
    | ((payload: AgentLifecycleEvent) => void)
    | undefined =>
    mockListen.mock.calls.find(
      ([event]) => event === 'agent-lifecycle'
    )?.[1] as ((payload: AgentLifecycleEvent) => void) | undefined

  const aliveSession = (id: string): SessionList => ({
    activeSessionId: id,
    sessions: [
      {
        id,
        cwd: '/tmp',
        status: {
          kind: 'Alive',
          pid: 1,
          replay_data: '',
          replay_end_offset: BigInt(0),
        },
      },
    ],
  })

  test('agent-lifecycle drives a live pane between running and idle', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue(aliveSession('a'))

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(getLifecycleCallback()).toBeDefined())

    // Alive hydrates running; an idle event moves the pane (and session) idle.
    act(() => {
      getLifecycleCallback()?.({
        sessionId: 'a',
        agentSessionId: 'x',
        phase: 'idle',
      })
    })
    expect(result.current.sessions[0].panes[0].status).toBe('idle')
    expect(result.current.sessions[0].status).toBe('idle')
    expect(result.current.sessions[0].panes[0].agentSessionId).toBe('x')

    // ...and a running event moves it back.
    act(() => {
      getLifecycleCallback()?.({
        sessionId: 'a',
        agentSessionId: 'x',
        phase: 'running',
      })
    })
    expect(result.current.sessions[0].panes[0].status).toBe('running')
  })

  test('adding a browser pane keeps an idle shell session idle', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue(aliveSession('a'))

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(getLifecycleCallback()).toBeDefined())

    act(() => {
      getLifecycleCallback()?.({
        sessionId: 'a',
        agentSessionId: 'x',
        phase: 'idle',
      })
    })

    act(() => {
      result.current.setSessionLayout('a', 'vsplit')
    })

    await waitFor(() =>
      expect(result.current.sessions[0].layout).toBe('vsplit')
    )

    act(() => {
      result.current.addPane('a', 'browser')
    })

    await waitFor(() =>
      expect(result.current.sessions[0].panes).toHaveLength(2)
    )

    const session = result.current.sessions[0]
    const browserPane = session.panes.find((pane) => pane.kind === 'browser')
    expect(browserPane?.status).toBe('idle')
    expect(session.status).toBe('idle')
  })

  test('agent-lifecycle never overrides a terminal (exited) pane', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'a',
      sessions: [
        { id: 'a', cwd: '/tmp', status: { kind: 'Exited', last_exit_code: 0 } },
      ],
    } satisfies SessionList)

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(getLifecycleCallback()).toBeDefined())

    // The pane hydrated completed; a running event must not resurrect it.
    act(() => {
      getLifecycleCallback()?.({
        sessionId: 'a',
        agentSessionId: 'x',
        phase: 'running',
      })
    })
    expect(result.current.sessions[0].panes[0].status).toBe('completed')
  })

  test('invalidating a conversation rejects stale events until fresh identity evidence arrives', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue(aliveSession('pty-1'))

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(statusListener()).toBeDefined())
    await waitFor(() => expect(titleListener()).toBeDefined())
    await waitFor(() => expect(getLifecycleCallback()).toBeDefined())

    act(() => {
      statusListener()?.(
        agentStatusEvent({
          agentSessionId: 'conversation-old',
          contextWindow: contextWindow(100),
        })
      )
    })

    expect(result.current.sessions[0].panes[0].agentSessionId).toBe(
      'conversation-old'
    )

    vi.mocked(pushWorkspaceShape).mockClear()
    act(() => {
      result.current.invalidatePaneAgentSession(
        'pty-1',
        'p0',
        'conversation-old',
        100
      )
    })

    expect(result.current.sessions[0].panes[0].agentSessionId).toBeUndefined()
    await waitFor(() =>
      expect(
        vi.mocked(pushWorkspaceShape).mock.lastCall?.[0].sessions[0].panes[0]
      ).toMatchObject({ agentSessionId: null })
    )

    act(() => {
      statusListener()?.(
        agentStatusEvent({
          agentSessionId: 'conversation-old',
          contextWindow: contextWindow(100),
        })
      )

      titleListener()?.({
        sessionId: 'pty-1',
        agentSessionId: 'conversation-old',
        title: 'Stale title',
        source: 'ai-generated',
      })

      getLifecycleCallback()?.({
        sessionId: 'pty-1',
        agentSessionId: 'conversation-old',
        phase: 'idle',
      })
    })

    expect(result.current.sessions[0].panes[0].agentSessionId).toBeUndefined()
    expect(result.current.sessions[0].panes[0].agentTitle).toBeUndefined()
    expect(result.current.sessions[0].panes[0].status).toBe('running')

    act(() => {
      statusListener()?.(
        agentStatusEvent({
          agentSessionId: 'conversation-old',
          contextWindow: contextWindow(0),
        })
      )
    })

    expect(result.current.sessions[0].panes[0].agentSessionId).toBe(
      'conversation-old'
    )

    act(() => {
      result.current.invalidatePaneAgentSession(
        'pty-1',
        'p0',
        'conversation-old',
        0
      )

      statusListener()?.(
        agentStatusEvent({
          agentSessionId: 'conversation-new',
          contextWindow: contextWindow(100),
        })
      )
    })

    expect(result.current.sessions[0].panes[0].agentSessionId).toBe(
      'conversation-new'
    )
  })

  test('events received between listSessions call and drain land in restoreData buffer', async () => {
    const service = createMockService()
    let dataCallback: (
      sessionId: string,
      data: string,
      offsetStart: number,
      byteLen: number
    ) => void = vi.fn()
    service.onData = vi.fn((cb): Promise<() => void> => {
      dataCallback = cb

      // eslint-disable-next-line @typescript-eslint/no-empty-function
      return Promise.resolve((): void => {})
    })

    // Resolve list_sessions only after we've fired some events
    let resolveListSessions: (v: SessionList) => void = vi.fn()
    service.listSessions = vi.fn(
      () =>
        new Promise<SessionList>((resolve) => {
          resolveListSessions = resolve
        })
    )

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )

    // Wait for the orchestrator's awaited onData to complete (the effect's
    // listen-before-snapshot step) so dataCallback is wired before we fire events
    await waitFor(() => expect(service.onData).toHaveBeenCalled())

    // Fire events while list_sessions is in-flight. byteLen is the producer's
    // raw byte count from the PTY read — passed through verbatim into the
    // restore buffer so the per-pane drain advances its cursor correctly.
    dataCallback('s1', 'mid-flight', 100, 10)
    dataCallback('s1', 'mid-flight-2', 105, 12)

    resolveListSessions({
      activeSessionId: 's1',
      sessions: [
        {
          id: 's1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: 'AAA',
            replay_end_offset: BigInt(3),
          },
        },
      ],
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    const restored = result.current.restoreData.get('s1')
    expect(restored).toBeDefined()
    expect(restored!.bufferedEvents).toEqual([
      { data: 'mid-flight', offsetStart: 100, byteLen: 10 },
      { data: 'mid-flight-2', offsetStart: 105, byteLen: 12 },
    ])
  })

  test('does not persist anything to localStorage', async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const service = createMockService()
    service.listSessions = vi
      .fn()
      .mockResolvedValue({ activeSessionId: null, sessions: [] })

    renderHook(() => useSessionManager(service, { autoCreateOnEmpty: false }))
    await waitFor(() => expect(service.listSessions).toHaveBeenCalled())

    // Filter out unrelated localStorage writes
    const ourCalls = setItemSpy.mock.calls.filter(([key]) =>
      key.startsWith('vimeflow:')
    )
    expect(ourCalls).toHaveLength(0)
  })

  test('setActiveSessionId optimistically updates state and calls IPC', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'a',
      sessions: [
        {
          id: 'a',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'b',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 2,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.setActiveSessionId('b'))
    expect(result.current.activeSessionId).toBe('b')
    expect(service.setActiveSession).toHaveBeenCalledWith('b')
  })

  test('setActiveSessionId reverts on IPC error', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'a',
      sessions: [
        {
          id: 'a',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'b',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 2,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })
    service.setActiveSession = vi.fn().mockRejectedValue('unknown session')

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.setActiveSessionId('b'))
    await waitFor(() => expect(result.current.activeSessionId).toBe('a'))
  })

  // Round 9, Finding 4 (codex P2): out-of-order setActiveSession IPC failures
  // must not revert to a stale selection. Scenario:
  //   1. Active = 'a'
  //   2. User clicks 'b' → req=1 fires, optimistic active = 'b'
  //   3. User clicks 'c' BEFORE req=1 settles → req=2 fires, active = 'c'
  //   4. req=1 rejects (transient failure) → revert candidate is 'a'
  //   5. After the fix, req=1's rollback no-ops because req=2 is now the
  //      latest. Active stays 'c' — the user's actual newest pick.
  test('round 9 F4: stale setActiveSession failure does not revert past a newer request', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'a',
      sessions: [
        {
          id: 'a',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'b',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 2,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'c',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 3,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    // Track each setActiveSession invocation so the test can reject req=1
    // AFTER req=2 has been issued.
    const settlers: {
      id: string
      reject: (e: unknown) => void
      resolve: () => void
    }[] = []
    service.setActiveSession = vi.fn(
      (id: string): Promise<void> =>
        new Promise<void>((resolve, reject) => {
          settlers.push({ id, reject, resolve })
        })
    )

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.activeSessionId).toBe('a')

    // req=1: switch to 'b'
    act(() => result.current.setActiveSessionId('b'))
    expect(result.current.activeSessionId).toBe('b')

    // req=2: switch to 'c' before req=1 settles
    act(() => result.current.setActiveSessionId('c'))
    expect(result.current.activeSessionId).toBe('c')

    // Now reject req=1 (the OLDER request). With the bug, this would
    // setActiveSessionIdState('a') because that's the prev captured at
    // req=1's call site — clobbering the user's 'c' pick. With the fix,
    // req=1 sees its myReq is no longer the latest and skips the revert.
    act(() => {
      const req1 = settlers.find((s) => s.id === 'b')
      req1?.reject('transient')
    })

    // After the older request's failure, active must stay on 'c'.
    await waitFor(() => expect(result.current.activeSessionId).toBe('c'))
    expect(result.current.activeSessionId).toBe('c')

    // For completeness: when the latest request also fails, rollback is
    // honored. We revert to whatever was on screen when req=2 started — 'b'.
    act(() => {
      const req2 = settlers.find((s) => s.id === 'c')
      req2?.reject('also-transient')
    })
    await waitFor(() => expect(result.current.activeSessionId).toBe('b'))
  })

  test('renders Exited sessions from list_sessions', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'a',
      sessions: [
        {
          id: 'a',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'b',
          cwd: '/tmp',
          status: {
            kind: 'Exited',
            last_exit_code: 0,
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.sessions).toHaveLength(2)
    expect(result.current.sessions[0].status).toBe('running')
    expect(result.current.sessions[1].status).toBe('completed')
  })

  // Round 7 regression: when listSessions returns empty (clean launch with
  // no cached sessions), the hook auto-creates one default tab so the
  // workspace isn't blank. Without this, the user would have to click '+'
  // every launch AND the E2E suite (which assumes a TerminalPane mounts
  // automatically) would fail with "[data-testid=terminal-pane] still not
  // displayed after 20000ms". The opt-out (`autoCreateOnEmpty: false`)
  // preserves the original empty-state behavior for tests that need it.
  test('round 7: auto-creates a default session on empty listSessions (opt-out via autoCreateOnEmpty: false)', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: null,
      sessions: [],
    })

    service.spawn = vi
      .fn()
      .mockResolvedValue({ sessionId: 'auto-id', pid: 1, cwd: '/home/user' })

    const { result } = renderHook(() => useSessionManager(service))
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Auto-create fires once after loading transitions to false.
    await waitFor(() => expect(service.spawn).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))
    expect(result.current.sessions[0].panes[0].ptyId).toBe('auto-id')
  })

  test('round 7: auto-create is skipped when listSessions returns sessions', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'restored-1',
      sessions: [
        {
          id: 'restored-1',
          cwd: '/home/user',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
            byte_len: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() => useSessionManager(service))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))

    // No auto-create — restored session populates the list.
    expect(service.spawn).not.toHaveBeenCalled()
    expect(result.current.sessions[0].id).toBe('restored-1')
  })

  test('reports createSession spawn failures through the error callback', async () => {
    const service = createMockService()
    const onTerminalSpawnError = vi.fn()
    service.spawn = vi.fn().mockRejectedValue(new Error('bridge unavailable'))

    const { result } = renderHook(() =>
      useSessionManager(service, {
        autoCreateOnEmpty: false,
        onTerminalSpawnError,
      })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.createSession()
    })

    await waitFor(() =>
      expect(onTerminalSpawnError).toHaveBeenCalledWith(
        'Failed to create terminal: bridge unavailable'
      )
    )
    expect(result.current.sessions).toHaveLength(0)
  })

  test('reports addPane spawn failures through the error callback', async () => {
    const service = createMockService()
    const onTerminalSpawnError = vi.fn()

    const { result } = renderHook(() =>
      useSessionManager(service, {
        autoCreateOnEmpty: false,
        onTerminalSpawnError,
      })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.createSession()
    })
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))
    const sessionId = result.current.sessions[0].id

    act(() => {
      result.current.setSessionLayout(sessionId, 'vsplit')
    })

    vi.mocked(service.spawn).mockRejectedValueOnce(
      new Error('bridge unavailable')
    )

    act(() => {
      result.current.addPane(sessionId)
    })

    await waitFor(() =>
      expect(onTerminalSpawnError).toHaveBeenCalledWith(
        'Failed to add terminal pane: bridge unavailable'
      )
    )
  })

  test('reports restartSession spawn failures through the error callback', async () => {
    const service = createMockService()
    const onTerminalSpawnError = vi.fn()

    const { result } = renderHook(() =>
      useSessionManager(service, {
        autoCreateOnEmpty: false,
        onTerminalSpawnError,
      })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.createSession()
    })
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))

    vi.mocked(service.spawn).mockRejectedValueOnce(
      new Error('bridge unavailable')
    )

    act(() => {
      result.current.restartSession(result.current.sessions[0].id)
    })

    await waitFor(() =>
      expect(onTerminalSpawnError).toHaveBeenCalledWith(
        'Failed to restart terminal: bridge unavailable'
      )
    )
  })

  // A browser-only session restored from the durable store has no shell PTY,
  // but its idle browser pane makes it a usable workspace — auto-create must
  // NOT seed an extra terminal tab on top of it.
  test('auto-create is skipped for a restored browser-only session', async () => {
    const store = persistedWorkspace(
      [{ kind: 'browser', paneId: 'p0', paneIndex: 0, active: true }],
      { id: 'ws-browser', workingDirectory: '/home/will/proj' }
    )
    vi.mocked(loadWorkspaceForRestore).mockResolvedValueOnce(store)

    const service = createMockService()
    service.listSessions = vi
      .fn()
      .mockResolvedValue({ activeSessionId: null, sessions: [] })

    const { result } = renderHook(() => useSessionManager(service))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))

    expect(result.current.sessions[0].id).toBe('ws-browser')
    expect(result.current.sessions[0].status).toBe('idle')
    expect(result.current.sessions[0].panes[0].kind).toBe('browser')
    expect(result.current.sessions[0].panes[0].status).toBe('idle')
    // The idle browser pane counts as a live session → no seeded terminal.
    expect(service.spawn).not.toHaveBeenCalled()
  })

  test('restores a graceful-quit shell workspace and resumes its latest conversation', async () => {
    vi.mocked(loadWorkspaceForRestore).mockResolvedValueOnce(
      persistedWorkspace([persistedShellPane({ cwd: '/home/will/proj' })], {
        workingDirectory: '/home/will/proj',
      })
    )

    const service = createMockService()
    service.listSessions = vi
      .fn()
      .mockResolvedValue({ activeSessionId: null, sessions: [] })

    service.spawn = vi.fn().mockResolvedValue({
      sessionId: 'pty-restarted',
      pid: 91,
      cwd: '/home/will/proj',
      shell: '/bin/zsh',
    })

    mockInvoke
      .mockRejectedValueOnce(new Error('agent not ready'))
      .mockResolvedValueOnce(false)

    const { result, unmount } = renderHook(() => useSessionManager(service))

    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))

    expect(service.spawn).toHaveBeenCalledTimes(1)
    expect(service.spawn).toHaveBeenCalledWith({
      cwd: '/home/will/proj',
      env: {},
      enableAgentBridge: true,
    })
    expect(result.current.sessions[0].id).toBe('ws-shell')
    expect(result.current.sessions[0].status).toBe('running')
    expect(result.current.sessions[0].panes[0].ptyId).toBe('pty-restarted')
    expect(result.current.sessions[0].panes[0].status).toBe('running')
    expect(result.current.sessions[0].panes[0].agentType).toBe('codex')
    expect(result.current.activeSessionId).toBe('ws-shell')
    expect(service.write).toHaveBeenCalledWith({
      sessionId: 'pty-restarted',
      data: 'codex resume --last\r',
    })
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(2))
    expect(mockInvoke).toHaveBeenLastCalledWith('start_agent_watcher', {
      sessionId: 'pty-restarted',
    })

    unmount()
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('stop_agent_watcher', {
        sessionId: 'pty-restarted',
      })
    )
  })

  test('releases the latest-conversation claim when spawn fails so retry can resume', async () => {
    vi.mocked(loadWorkspaceForRestore).mockResolvedValueOnce(
      persistedWorkspace([persistedShellPane({ cwd: '/home/will/proj' })], {
        workingDirectory: '/home/will/proj',
      })
    )

    const service = createMockService()
    const onTerminalSpawnError = vi.fn()
    service.spawn = vi
      .fn()
      .mockRejectedValueOnce(new Error('bridge unavailable'))
      .mockResolvedValueOnce({
        sessionId: 'pty-retried',
        pid: 92,
        cwd: '/home/will/proj',
        shell: '/bin/zsh',
      })

    const { result } = renderHook(() =>
      useSessionManager(service, {
        autoCreateOnEmpty: false,
        onTerminalSpawnError,
      })
    )

    await waitFor(() =>
      expect(onTerminalSpawnError).toHaveBeenCalledWith(
        'Failed to restart terminal: bridge unavailable'
      )
    )

    act(() => result.current.restartSession('ws-shell'))

    await waitFor(() => expect(service.spawn).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(result.current.sessions[0].panes[0].ptyId).toBe('pty-retried')
    )

    expect(service.write).toHaveBeenCalledWith({
      sessionId: 'pty-retried',
      data: 'codex resume --last\r',
    })
  })

  test.each(['/home/will/proj', '/home/will/proj-link'])(
    'resumes latest only once for duplicate legacy panes when inactive cwd is %s',
    async (inactiveCwd) => {
      vi.mocked(loadWorkspaceForRestore).mockResolvedValueOnce(
        persistedWorkspace(
          [
            persistedShellPane({
              active: false,
              ptyId: 'pty-inactive-old',
              cwd: inactiveCwd,
            }),
            persistedShellPane({
              paneId: 'p1',
              paneIndex: 1,
              ptyId: 'pty-active-old',
              cwd: '/home/will/proj',
            }),
          ],
          { workingDirectory: '/home/will/proj' }
        )
      )

      const service = createMockService()
      service.spawn = vi
        .fn()
        .mockResolvedValueOnce({
          sessionId: 'pty-active-new',
          pid: 91,
          cwd: '/home/will/proj',
          shell: '/bin/zsh',
        })
        .mockResolvedValueOnce({
          sessionId: 'pty-inactive-new',
          pid: 92,
          cwd: '/home/will/proj',
          shell: '/bin/zsh',
        })

      const { result } = renderHook(() =>
        useSessionManager(service, { autoCreateOnEmpty: false })
      )

      await waitFor(() => expect(service.spawn).toHaveBeenCalledTimes(2))
      await waitFor(() =>
        expect(
          result.current.sessions[0].panes.map((pane) => pane.ptyId)
        ).toEqual(['pty-inactive-new', 'pty-active-new'])
      )

      expect(service.write).toHaveBeenCalledOnce()
      expect(service.write).toHaveBeenCalledWith({
        sessionId: 'pty-active-new',
        data: 'codex resume --last\r',
      })
      expect(result.current.sessions[0].panes[0].agentType).toBe('generic')
      expect(result.current.sessions[0].panes[1].agentType).toBe('codex')
    }
  )

  test('gives the active legacy pane first claim on a canonical cwd when spawns resolve out of order', async () => {
    vi.mocked(loadWorkspaceForRestore).mockResolvedValueOnce(
      persistedWorkspace([
        persistedShellPane({
          active: false,
          ptyId: 'pty-inactive-old',
          cwd: '/repo',
        }),
        persistedShellPane({
          paneId: 'p1',
          paneIndex: 1,
          ptyId: 'pty-active-old',
          cwd: '/repo-link',
        }),
      ])
    )

    let resolveActive: (result: PTYSpawnResult) => void = vi.fn()
    let resolveInactive: (result: PTYSpawnResult) => void = vi.fn()

    const activeSpawn = new Promise<PTYSpawnResult>((resolve) => {
      resolveActive = resolve
    })

    const inactiveSpawn = new Promise<PTYSpawnResult>((resolve) => {
      resolveInactive = resolve
    })

    const service = createMockService()
    vi.mocked(service.spawn).mockImplementation(({ cwd }) =>
      cwd === '/repo-link' ? activeSpawn : inactiveSpawn
    )

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )

    await waitFor(() => expect(service.spawn).toHaveBeenCalledTimes(2))

    await act(async () => {
      resolveInactive({
        sessionId: 'pty-inactive-new',
        pid: 92,
        cwd: '/repo',
        shell: '/bin/zsh',
      })
      await Promise.resolve()
    })
    expect(service.write).not.toHaveBeenCalled()

    await act(async () => {
      resolveActive({
        sessionId: 'pty-active-new',
        pid: 91,
        cwd: '/repo',
        shell: '/bin/zsh',
      })
      await Promise.all([activeSpawn, inactiveSpawn])
    })

    await waitFor(() =>
      expect(
        result.current.sessions[0].panes.map((pane) => pane.ptyId)
      ).toEqual(['pty-inactive-new', 'pty-active-new'])
    )
    expect(service.write).toHaveBeenCalledOnce()
    expect(service.write).toHaveBeenCalledWith({
      sessionId: 'pty-active-new',
      data: 'codex resume --last\r',
    })
    expect(result.current.sessions[0].panes[0].agentType).toBe('generic')
    expect(result.current.sessions[0].panes[1].agentType).toBe('codex')
  })

  test('stops an auto-started watcher after an inactive fallback pane captures identity', async () => {
    vi.mocked(loadWorkspaceForRestore).mockResolvedValueOnce(
      persistedWorkspace(
        [
          persistedShellPane({
            active: false,
            ptyId: 'pty-claude-old',
            cwd: '/home/will/proj',
            agentType: 'claude-code',
          }),
          persistedShellPane({
            paneId: 'p1',
            paneIndex: 1,
            ptyId: 'pty-codex-old',
            cwd: '/home/will/proj',
            agentSessionId: 'codex-conversation',
          }),
        ],
        { workingDirectory: '/home/will/proj' }
      )
    )

    const service = createMockService()
    service.spawn = vi
      .fn()
      .mockResolvedValueOnce({
        sessionId: 'pty-codex-new',
        pid: 91,
        cwd: '/home/will/proj',
        shell: '/bin/zsh',
      })
      .mockResolvedValueOnce({
        sessionId: 'pty-claude-new',
        pid: 92,
        cwd: '/home/will/proj',
        shell: '/bin/zsh',
      })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('start_agent_watcher', {
        sessionId: 'pty-claude-new',
      })
    )

    act(() => {
      titleListener()?.({
        sessionId: 'pty-claude-new',
        agentSessionId: 'claude-conversation',
        title: '',
        source: 'ai-generated',
      })
    })

    await waitFor(() =>
      expect(result.current.sessions[0].panes[0].agentSessionId).toBe(
        'claude-conversation'
      )
    )

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('stop_agent_watcher', {
        sessionId: 'pty-claude-new',
      })
    )
  })

  test('stops retrying a missing resumed-agent watcher and degrades the pane', async () => {
    vi.useFakeTimers()
    let unmount: (() => void) | undefined

    try {
      vi.mocked(loadWorkspaceForRestore).mockResolvedValueOnce(
        persistedWorkspace([persistedShellPane()])
      )
      mockInvoke.mockRejectedValue(new Error('agent not ready'))

      const service = createMockService()

      const hook = renderHook(() =>
        useSessionManager(service, { autoCreateOnEmpty: false })
      )
      unmount = hook.unmount

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })

      const watcherAttemptCount = (): number =>
        mockInvoke.mock.calls.filter(
          (call) => (call as unknown as [string])[0] === 'start_agent_watcher'
        ).length
      expect(watcherAttemptCount()).toBe(20)
      expect(hook.result.current.sessions[0].panes[0].agentType).toBe('generic')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })
      expect(watcherAttemptCount()).toBe(20)
    } finally {
      unmount?.()
      vi.useRealTimers()
    }
  })

  test('reattaches a live close-without-quit PTY without spawning or injecting resume', async () => {
    vi.mocked(loadWorkspaceForRestore).mockResolvedValueOnce(
      persistedWorkspace(
        [
          persistedShellPane({
            ptyId: 'pty-live',
            agentSessionId: 'codex-session',
          }),
        ],
        { id: 'ws-live' }
      )
    )

    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'pty-live',
      sessions: [
        {
          id: 'pty-live',
          cwd: '/repo',
          shell: '/bin/zsh',
          status: {
            kind: 'Alive',
            pid: 18,
            replay_data: 'existing output',
            replay_end_offset: 15n,
          },
        },
      ],
    } satisfies SessionList)

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.sessions[0].panes[0].ptyId).toBe('pty-live')
    expect(result.current.sessions[0].panes[0].status).toBe('running')
    expect(service.spawn).not.toHaveBeenCalled()
    expect(service.write).not.toHaveBeenCalled()
  })

  test('hydrates every shell pane when the active restored workspace focuses a browser', async () => {
    vi.mocked(loadWorkspaceForRestore).mockResolvedValueOnce(
      persistedWorkspace(
        [
          { kind: 'browser', paneId: 'p0', paneIndex: 0, active: true },
          persistedShellPane({
            paneId: 'p1',
            paneIndex: 1,
            active: false,
            ptyId: 'pty-codex-old',
            cwd: '/repo/codex',
            agentSessionId: 'codex-session',
          }),
          persistedShellPane({
            paneId: 'p2',
            paneIndex: 2,
            active: false,
            ptyId: 'pty-opencode-old',
            cwd: '/repo/opencode',
            agentType: 'opencode',
            agentSessionId: 'ses_opencode',
          }),
        ],
        { id: 'ws-active', layout: 'threeRight' }
      )
    )

    const service = createMockService()
    service.spawn = vi
      .fn()
      .mockResolvedValueOnce({
        sessionId: 'pty-codex-new',
        pid: 11,
        cwd: '/repo/codex',
        shell: '/bin/zsh',
      })
      .mockResolvedValueOnce({
        sessionId: 'pty-opencode-new',
        pid: 12,
        cwd: '/repo/opencode',
        shell: '/bin/zsh',
      })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(service.spawn).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(
        result.current.sessions[0].panes.map((pane) => pane.ptyId)
      ).toEqual([
        expect.stringMatching(/^browser:/),
        'pty-codex-new',
        'pty-opencode-new',
      ])
    )

    expect(service.write).toHaveBeenCalledWith({
      sessionId: 'pty-codex-new',
      data: "codex resume 'codex-session'\r",
    })

    expect(service.write).toHaveBeenCalledWith({
      sessionId: 'pty-opencode-new',
      data: "opencode --session 'ses_opencode'\r",
    })
    expect(result.current.sessions[0].panes[0].active).toBe(true)
  })

  test('lazily hydrates an inactive workspace once across rapid tab switches', async () => {
    vi.mocked(loadWorkspaceForRestore).mockResolvedValueOnce({
      sessions: [
        {
          id: 'ws-active',
          projectId: 'proj-1',
          layout: 'single',
          workingDirectory: '/active',
          active: true,
          open: true,
          panes: [
            { kind: 'browser', paneId: 'p0', paneIndex: 0, active: true },
          ],
        },
        {
          id: 'ws-lazy',
          projectId: 'proj-1',
          layout: 'single',
          workingDirectory: '/lazy',
          active: false,
          open: true,
          panes: [
            {
              kind: 'shell',
              paneId: 'p0',
              paneIndex: 0,
              active: true,
              ptyId: 'pty-lazy-old',
              cwd: '/lazy',
              agentType: 'kimi',
              agentSessionId: 'kimi-session',
            },
          ],
        },
      ],
    })

    let resolveSpawn: ((value: unknown) => void) | undefined

    const spawn = new Promise((resolve) => {
      resolveSpawn = resolve
    })
    const service = createMockService()
    service.spawn = vi.fn().mockReturnValue(spawn)

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(service.spawn).not.toHaveBeenCalled()

    act(() => {
      result.current.setActiveSessionId('ws-lazy')
    })
    await waitFor(() => expect(service.spawn).toHaveBeenCalledTimes(1))

    act(() => {
      result.current.setActiveSessionId('ws-active')
      result.current.setActiveSessionId('ws-lazy')
    })
    expect(service.spawn).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveSpawn?.({
        sessionId: 'pty-lazy-new',
        pid: 13,
        cwd: '/lazy',
        shell: '/bin/zsh',
      })
      await spawn
    })

    await waitFor(() =>
      expect(result.current.sessions[1].panes[0].ptyId).toBe('pty-lazy-new')
    )
    expect(result.current.sessions[1].panes[0].status).toBe('running')
    expect(service.write).toHaveBeenCalledOnce()
    expect(service.write).toHaveBeenCalledWith({
      sessionId: 'pty-lazy-new',
      data: "kimi --session 'kimi-session'\r",
    })
  })

  test('kills a failed resume PTY and lets explicit Restart retry the placeholder', async () => {
    vi.mocked(loadWorkspaceForRestore).mockResolvedValueOnce(
      persistedWorkspace(
        [
          persistedShellPane({
            ptyId: 'pty-agent-old',
            agentType: 'claude-code',
            agentSessionId: 'claude-session',
          }),
        ],
        { id: 'ws-agent' }
      )
    )

    const service = createMockService()
    service.spawn = vi
      .fn()
      .mockResolvedValueOnce({
        sessionId: 'pty-agent-failed',
        pid: 14,
        cwd: '/repo',
        shell: '/bin/zsh',
      })
      .mockResolvedValueOnce({
        sessionId: 'pty-agent-retried',
        pid: 15,
        cwd: '/repo',
        shell: '/bin/zsh',
      })

    service.write = vi
      .fn()
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValue(undefined)

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(service.write).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(service.kill).toHaveBeenCalledWith({
        sessionId: 'pty-agent-failed',
      })
    )

    expect(result.current.sessions[0].panes[0].ptyId).toBe('pty-agent-old')
    expect(result.current.sessions[0].panes[0].status).toBe('completed')

    act(() => {
      result.current.restartSession('ws-agent', 'p0')
    })

    await waitFor(() =>
      expect(result.current.sessions[0].panes[0].ptyId).toBe(
        'pty-agent-retried'
      )
    )
    expect(service.spawn).toHaveBeenCalledTimes(2)
    expect(service.write).toHaveBeenCalledTimes(2)
    expect(service.write).toHaveBeenLastCalledWith({
      sessionId: 'pty-agent-retried',
      data: "claude --resume 'claude-session'\r",
    })
  })

  test('hydrates sibling panes independently when one spawn fails', async () => {
    vi.mocked(loadWorkspaceForRestore).mockResolvedValueOnce(
      persistedWorkspace(
        [
          persistedShellPane({
            ptyId: 'pty-claude-old',
            cwd: '/repo/claude',
            agentType: 'claude-code',
            agentSessionId: 'claude-session',
          }),
          persistedShellPane({
            paneId: 'p1',
            paneIndex: 1,
            active: false,
            ptyId: 'pty-codex-old',
            cwd: '/repo/codex',
            agentSessionId: 'codex-session',
          }),
        ],
        { id: 'ws-partial' }
      )
    )

    const service = createMockService()
    service.spawn = vi
      .fn()
      .mockRejectedValueOnce(new Error('claude unavailable'))
      .mockResolvedValueOnce({
        sessionId: 'pty-codex-new',
        pid: 16,
        cwd: '/repo/codex',
        shell: '/bin/zsh',
      })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )

    await waitFor(() => expect(service.spawn).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(result.current.sessions[0].panes[1].ptyId).toBe('pty-codex-new')
    )

    expect(result.current.sessions[0].panes[0].ptyId).toBe('pty-claude-old')
    expect(result.current.sessions[0].panes[0].status).toBe('completed')
    expect(service.write).toHaveBeenCalledOnce()
    expect(service.write).toHaveBeenCalledWith({
      sessionId: 'pty-codex-new',
      data: "codex resume 'codex-session'\r",
    })
  })

  test('kills a restart PTY that resolves after manager unmount', async () => {
    vi.mocked(loadWorkspaceForRestore).mockResolvedValueOnce(
      persistedWorkspace(
        [
          persistedShellPane({
            ptyId: 'pty-cancelled-old',
            agentSessionId: 'codex-session',
          }),
        ],
        { id: 'ws-cancelled' }
      )
    )

    let resolveSpawn: ((value: unknown) => void) | undefined

    const spawn = new Promise((resolve) => {
      resolveSpawn = resolve
    })

    const service = createMockService()
    service.spawn = vi.fn().mockReturnValue(spawn)

    const { result, unmount } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(service.spawn).toHaveBeenCalledOnce())
    unmount()

    await act(async () => {
      resolveSpawn?.({
        sessionId: 'pty-cancelled-new',
        pid: 17,
        cwd: '/repo',
        shell: '/bin/zsh',
      })
      await spawn
    })

    await waitFor(() =>
      expect(service.kill).toHaveBeenCalledWith({
        sessionId: 'pty-cancelled-new',
      })
    )
    expect(service.write).not.toHaveBeenCalled()
  })

  // When the durable store is authoritative, the legacy localStorage browser
  // cache must NOT be merged — otherwise a pane closed before a crash (never
  // cleared from localStorage) would be resurrected on the next restore.
  test('store-driven restore ignores the stale localStorage browser cache', async () => {
    const store: PersistedWorkspaceShape = {
      sessions: [
        {
          id: 'ws-shell',
          projectId: 'proj-1',
          layout: 'single',
          workingDirectory: '/home/will/proj',
          active: true,
          open: true,
          panes: [
            {
              kind: 'shell',
              paneId: 'p0',
              paneIndex: 0,
              active: true,
              ptyId: 'pty-shell',
              cwd: '/home/will/proj',
              agentType: 'generic',
              agentSessionId: null,
            },
          ],
        },
      ],
    }
    vi.mocked(loadWorkspaceForRestore).mockResolvedValueOnce(store)
    // A browser pane closed before a crash, still lingering in the legacy key.
    window.localStorage.setItem(
      'vimeflow:browser-panes:v1',
      JSON.stringify([
        {
          sessionId: 'ws-shell',
          paneId: 'p1',
          ptyId: 'browser:stale',
          cwd: '/home/will/proj',
          browserUrl: 'https://example.com/',
          active: false,
        },
      ])
    )

    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'pty-shell',
      sessions: [
        {
          id: 'pty-shell',
          cwd: '/home/will/proj',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))

    // The durable store is authoritative — the stale browser pane is dropped.
    expect(result.current.sessions[0].id).toBe('ws-shell')
    expect(result.current.sessions[0].panes).toHaveLength(1)
    expect(result.current.sessions[0].panes[0].ptyId).toBe('pty-shell')
  })

  test('does not push an empty workspace shape after restore fails', async () => {
    vi.mocked(loadWorkspaceForRestore).mockRejectedValueOnce(new Error('boom'))
    const service = createMockService()

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.sessions).toEqual([])
    expect(pushWorkspaceShape).not.toHaveBeenCalled()
  })

  test('does not restore browser panes from the legacy localStorage cache', async () => {
    vi.mocked(loadWorkspaceForRestore).mockResolvedValueOnce({ sessions: [] })
    window.localStorage.setItem(
      'vimeflow:browser-panes:v1',
      JSON.stringify([
        {
          sessionId: 'pty-1',
          paneId: 'p1',
          ptyId: 'browser:legacy',
          cwd: '/home/will/proj',
          browserUrl: 'https://example.com/',
          active: false,
        },
      ])
    )

    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'pty-1',
      sessions: [
        {
          id: 'pty-1',
          cwd: '/home/will/proj',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))

    const panes = result.current.sessions[0].panes
    expect(panes).toHaveLength(1)
    expect(panes[0].ptyId).toBe('pty-1')
  })

  test('does not write the legacy localStorage browser cache after restore', async () => {
    vi.mocked(loadWorkspaceForRestore).mockResolvedValueOnce({
      sessions: [
        {
          id: 'ws-browser',
          projectId: 'proj-1',
          layout: 'single',
          workingDirectory: '/home/will/proj',
          active: true,
          open: true,
          panes: [
            { kind: 'browser', paneId: 'p0', paneIndex: 0, active: true },
          ],
        },
      ],
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem')

    const service = createMockService()
    service.listSessions = vi
      .fn()
      .mockResolvedValue({ activeSessionId: null, sessions: [] })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))

    expect(
      setItemSpy.mock.calls.some(([key]) => key === 'vimeflow:browser-panes:v1')
    ).toBe(false)

    expect(
      removeItemSpy.mock.calls.some(
        ([key]) => key === 'vimeflow:browser-panes:v1'
      )
    ).toBe(false)
    expect(window.localStorage.getItem('vimeflow:browser-panes:v1')).toBeNull()
  })

  // Browser-only session from scratch (spec §6.2): one runtime browser pane,
  // no PTY spawn, main asked to create the WebContents at the default url.
  test('createBrowserSession builds a browser-only session with no PTY spawn', async () => {
    const service = createMockService()

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.createBrowserSession()
    })

    await waitFor(() => expect(result.current.sessions).toHaveLength(1))
    const session = result.current.sessions[0]
    expect(session.layout).toBe('single')
    expect(session.status).toBe('idle')
    expect(session.panes).toHaveLength(1)
    const pane = session.panes[0]
    expect(pane.kind).toBe('browser')
    expect(pane.id).toBe('p0')
    expect(pane.ptyId.startsWith('browser:')).toBe(true)
    expect(pane.agentType).toBe('generic')
    expect(pane.status).toBe('idle')
    expect(pane.active).toBe(true)
    // No PTY spawn for a browser-only session.
    expect(service.spawn).not.toHaveBeenCalled()
    // Main creates the WebContents seeded with the default url.
    expect(vi.mocked(createBrowserPane)).toHaveBeenCalledWith({
      sessionId: session.id,
      paneId: 'p0',
      workspaceId: 'proj-1',
      initialUrl: DEFAULT_BROWSER_URL,
    })
    // The new session is selected.
    expect(result.current.activeSessionId).toBe(session.id)
  })

  // A failed eager create (bridge/main unavailable) must not throw or leave an
  // unhandled rejection — the session is still created and selected, and
  // BrowserPane re-issues the create on mount.
  test('createBrowserSession survives a createBrowserPane rejection', async () => {
    vi.mocked(createBrowserPane).mockRejectedValueOnce(new Error('bridge down'))

    const service = createMockService()

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.createBrowserSession()
    })

    await waitFor(() => expect(result.current.sessions).toHaveLength(1))
    // Let the rejected eager-create settle so any unhandled rejection surfaces.
    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.sessions[0].panes[0].kind).toBe('browser')
    expect(result.current.activeSessionId).toBe(result.current.sessions[0].id)
  })

  // Post-crash recovery: the previous app died without a graceful exit
  // (SIGKILL, OOM, wdio teardown). The session cache still lists alive
  // entries, but no PTY survives — `list_sessions` reconciles them all to
  // Exited. The frontend lands in a workspace full of "Restart" tabs and
  // ZERO live PTYs.
  //
  // Round-7 auto-create only fired when `sessions.length === 0`, so this
  // post-crash case left the auto-create dormant: every E2E spec that
  // reused the cache from a prior spec saw stale Exited tabs and no live
  // session, hence `PTY never produced a prompt`. Auto-create now fires
  // whenever there's no `running` session — the Exited tabs stay visible
  // (user can Restart in their original cwd) AND we add a fresh live tab.
  test('auto-creates a fresh tab when listSessions returns only Exited sessions', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'stale-1',
      sessions: [
        {
          id: 'stale-1',
          cwd: '/home/user',
          status: { kind: 'Exited', last_exit_code: null },
        },
        {
          id: 'stale-2',
          cwd: '/home/user/proj',
          status: { kind: 'Exited', last_exit_code: 0 },
        },
      ],
    })

    service.spawn = vi
      .fn()
      .mockResolvedValue({ sessionId: 'fresh-1', pid: 9, cwd: '/home/user' })

    const { result } = renderHook(() => useSessionManager(service))
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Auto-create fires because no session has status: 'running'.
    await waitFor(() => expect(service.spawn).toHaveBeenCalledTimes(1))

    // Final state: original Exited tabs preserved + the freshly spawned tab.
    await waitFor(() => expect(result.current.sessions).toHaveLength(3))
    expect(result.current.sessions.map((s) => s.panes[0].ptyId)).toEqual([
      'stale-1',
      'stale-2',
      'fresh-1',
    ])
    expect(result.current.sessions[2].status).toBe('running')
    // Exited tabs remain so the user can Restart them.
    expect(
      result.current.sessions.filter((s) => s.status === 'completed')
    ).toHaveLength(2)
  })

  // Round 12, Finding 1 (claude HIGH): when a manual createSession is
  // racing the mount-time auto-create AND its spawn FAILS, the auto-create
  // effect must still recover so the user isn't stuck with an empty tab
  // strip. The round-10 implementation used a `pendingSpawnsRef` (useRef)
  // to coordinate; decrementing the ref after spawn failure didn't schedule
  // a re-render, so the auto-create effect never re-evaluated.
  //
  // Promoting `pendingSpawns` to React state makes the decrement schedule
  // a render; the effect's dep array now includes `pendingSpawns`; the
  // post-failure tick observes pendingSpawns === 0 && !hasLiveSession and
  // fires the auto-create. End result: the user sees a tab even when their
  // first manual click happened to race a backend hiccup.
  test('round 12 F1: failed manual spawn during restore window triggers auto-create recovery', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: null,
      sessions: [],
    })

    // First spawn (manual) rejects. Subsequent spawn (auto-create recovery)
    // resolves so we can assert the effect re-fired.
    service.spawn = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient backend hiccup'))
      .mockResolvedValueOnce({
        sessionId: 'auto-recovery',
        pid: 7,
        cwd: '/home/user',
      })

    // Auto-create on (default true). The first manual click races the
    // mount-time auto-create — pendingSpawns goes to 1 before the effect
    // decides to fire, so the effect defers; spawn rejects; pendingSpawns
    // decrements; the effect re-fires; auto-create now runs.
    const { result } = renderHook(() => useSessionManager(service))

    // Trigger the manual spawn during the restore window. Calling it via
    // act ensures we don't lose the failure between renders.
    act(() => result.current.createSession())

    await waitFor(() => expect(service.spawn).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))
    expect(result.current.sessions[0].panes[0].ptyId).toBe('auto-recovery')
  })

  test('createSession spawns PTY and appends to sessions', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: null,
      sessions: [],
    })

    service.spawn = vi.fn().mockResolvedValue({ sessionId: 'new-id', pid: 999 })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.createSession())

    await waitFor(() => expect(service.spawn).toHaveBeenCalled())
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))
    const created = result.current.sessions[0]

    expect(created.id).not.toBe('new-id')
    expect(created.panes[0].ptyId).toBe('new-id')
    expect(result.current.activeSessionId).toBe(created.id)

    // Round 8, Finding 3 (claude MEDIUM): the workspace UI is the canonical
    // entry point for user-driven tab creation, and the agent bridge IS the
    // product. createSession must opt in explicitly so other (test, ad-hoc)
    // callers — which now default to `false` — don't litter cwds with
    // `.vimeflow/sessions/<uuid>/` directories.
    expect(service.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ enableAgentBridge: true })
    )

    // F3 regression: the new session must be marked attach-ready (restoreData
    // populated). Without this, TerminalZone's mode-decision routes the
    // pane to legacy 'spawn' mode and useTerminal calls service.spawn() a
    // SECOND time — hidden duplicate PTY.
    const restored = result.current.restoreData.get(created.id)
    expect(restored).toBeDefined()
    expect(restored!.pid).toBe(999)
    expect(restored!.replayData).toBe('')
    expect(restored!.replayEndOffset).toBe(0)
    // service.spawn called exactly once (not twice).
    expect(service.spawn).toHaveBeenCalledTimes(1)

    // F4 regression: createSession must persist the new active id and the
    // updated session_order to the cache. spawn_pty only auto-promotes
    // active when cache.active_session_id was null, and appends to
    // session_order — so without these IPC calls, reload comes back with
    // the OLD active tab and the wrong order.
    await waitFor(() =>
      expect(service.setActiveSession).toHaveBeenCalledWith('new-id')
    )

    // Cache order persistence is now owned by `set_workspace_sessions`
    // (see PR #290 — it rebuilds session_order from the snapshot atomically
    // with the grouping write). Assert the push reached the backend with
    // the new session in the snapshot.
    await waitFor(() => {
      expect(pushWorkspaceShape).toHaveBeenCalled()

      const calls = vi.mocked(pushWorkspaceShape).mock.calls

      const lastPayload = calls[calls.length - 1]?.[0] as
        | { sessions: { panes: { ptyId: string }[] }[] }
        | undefined

      const ptyIds = lastPayload?.sessions.flatMap((s) =>
        s.panes.map((p) => p.ptyId)
      )
      expect(ptyIds).toContain('new-id')
    })
  })

  // Round 5 regression: createSession must seed sessions[i].workingDirectory
  // and restoreData[id].cwd from spawn().cwd (the resolved absolute path),
  // not from the literal '~' it passed in. Many shells don't emit OSC 7 on
  // first prompt, so without this useGitStatus / agent-status / diff panes
  // sit idle until the user `cd`s manually.
  test('round 5: createSession uses resolved cwd from spawn() not literal "~"', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: null,
      sessions: [],
    })

    service.spawn = vi.fn().mockResolvedValue({
      sessionId: 'new-id',
      pid: 999,
      cwd: '/home/user/projects/foo',
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.createSession())

    await waitFor(() => expect(result.current.sessions).toHaveLength(1))
    expect(result.current.sessions[0].workingDirectory).toBe(
      '/home/user/projects/foo'
    )

    // Post-5a-F4: restoreData is keyed by React Session.id (UUID), not by
    // the ptyId returned from spawn. The live source is pane.restoreData
    // on the created session — assert against it directly so the test is
    // robust to the public Map removal scheduled in the F4 follow-up.
    const created = result.current.sessions[0]
    expect(created.panes[0].restoreData?.cwd).toBe('/home/user/projects/foo')
    // Map-shape assertion for the duration of the public restoreData API:
    const restored = result.current.restoreData.get(created.id)
    expect(restored).toBeDefined()
    expect(restored!.cwd).toBe('/home/user/projects/foo')
  })

  // F4 specific: with existing tabs, the new tab must be APPENDED in the
  // reorderSessions call (matching the React-state insertion order so cache
  // and view agree on the post-create arrangement).
  test('F4: createSession persists appended order to cache when other tabs exist', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'existing-1',
      sessions: [
        {
          id: 'existing-1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 100,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'existing-2',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 200,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    service.spawn = vi
      .fn()
      .mockResolvedValue({ sessionId: 'new-tab', pid: 999 })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.createSession())

    await waitFor(() => expect(service.spawn).toHaveBeenCalled())
    // Active id flips to the new tab, both in React state and in the cache IPC.
    // Wrap in waitFor — the active id updates AFTER spawn resolves and React
    // flushes the setSessions/setActiveSessionIdState batch.
    await waitFor(() =>
      expect(result.current.sessions[2].panes[0].ptyId).toBe('new-tab')
    )
    const createdSessionId = result.current.sessions[2].id

    expect(result.current.activeSessionId).toBe(createdSessionId)
    await waitFor(() =>
      expect(service.setActiveSession).toHaveBeenCalledWith('new-tab')
    )

    // Order: existing tabs keep their original order, then the new tab
    // lands at the bottom (matches the [...prev, newSession] append).
    // Persistence is via `set_workspace_sessions` now (see PR #290):
    // assert the latest snapshot's flattened pty order matches.
    await waitFor(() => {
      const calls = vi.mocked(pushWorkspaceShape).mock.calls

      const lastPayload = calls[calls.length - 1]?.[0] as
        | { sessions: { panes: { ptyId: string }[] }[] }
        | undefined

      const ptyIds = lastPayload?.sessions.flatMap((s) =>
        s.panes.map((p) => p.ptyId)
      )
      expect(ptyIds).toEqual(['existing-1', 'existing-2', 'new-tab'])
    })
  })

  test('removeSession kills PTY and filters from state', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 's1',
      sessions: [
        {
          id: 's1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.removeSession('s1'))

    await waitFor(() =>
      expect(service.kill).toHaveBeenCalledWith({ sessionId: 's1' })
    )
    await waitFor(() => expect(result.current.sessions).toHaveLength(0))
  })

  // Replaces the implicit cleanup the Rust PTY cache used to do on session
  // exit. Without this hook, every closed session leaked a localStorage
  // entry forever — see PR #259 review (M1).
  test('removeSession clears the session activityPanelCollapsed localStorage key', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 's1',
      sessions: [
        {
          id: 's1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.setSessionActivityPanelCollapsed('s1', true)
    })
    expect(readActivityPanelCollapsed('s1')).toBe(true)

    act(() => result.current.removeSession('s1'))

    await waitFor(() => expect(result.current.sessions).toHaveLength(0))
    expect(readActivityPanelCollapsed('s1')).toBe(false)
    expect(
      window.localStorage.getItem('vimeflow:sessions:activityPanelCollapsed:s1')
    ).toBeNull()
  })

  // Partial-kill bail: when ANY pane's kill IPC rejects, removeSession bails
  // BEFORE dropping bookkeeping (and now BEFORE clearing the localStorage
  // key). The session is still visible to the user; their preference must
  // survive so a retry doesn't reset the bar to expanded.
  test('removeSession preserves localStorage key when kill rejects', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 's1',
      sessions: [
        {
          id: 's1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })
    service.kill = vi.fn().mockRejectedValue(new Error('kill failed'))

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.setSessionActivityPanelCollapsed('s1', true)
    })
    expect(readActivityPanelCollapsed('s1')).toBe(true)

    act(() => result.current.removeSession('s1'))

    await waitFor(() => expect(service.kill).toHaveBeenCalled())
    // Session stays; preference must NOT have been swept by the partial-kill bail.
    expect(result.current.sessions).toHaveLength(1)
    expect(readActivityPanelCollapsed('s1')).toBe(true)
  })

  // Round 9, Finding 6 (claude MEDIUM): React requires functional updaters to
  // be PURE. The previous code fired `service.setActiveSession` from INSIDE
  // the setSessions updater in createSession, so StrictMode dev
  // double-invoked it. After the fix (capture inside, fire outside via
  // flushSync), each IPC fires EXACTLY once per createSession call.
  //
  // PR #290 follow-up: the `service.reorderSessions` IPC was removed from
  // createSession — cache order is now persisted via `set_workspace_sessions`
  // (in `usePushWorkspaceGrouping`). This test still asserts the EXACTLY-once
  // semantics for setActiveSession; the order-IPC half of the original
  // assertion is dropped as no longer applicable.
  test('round 9 F6: createSession fires setActiveSession exactly once (no StrictMode double)', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: null,
      sessions: [],
    })

    service.spawn = vi
      .fn()
      .mockResolvedValue({ sessionId: 'fresh', pid: 1, cwd: '/tmp' })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Reset spies so the restore-time auto-create (if any) doesn't leak in.
    ;(service.setActiveSession as ReturnType<typeof vi.fn>).mockClear()

    act(() => result.current.createSession())

    await waitFor(() =>
      expect(service.setActiveSession).toHaveBeenCalledWith('fresh')
    )

    // setActiveSession fires EXACTLY once. Pre-fix (IPC inside setSessions
    // updater), StrictMode dev's double-invoke would push the count to 2.
    expect(service.setActiveSession).toHaveBeenCalledTimes(1)
  })

  // F4 (round 2): when the user closes the active middle tab, the hook
  // promotes a neighbor in React state and must persist that choice to Rust.
  // Rust clears active_session_id when the active tab is killed, so the
  // follow-up setActiveSession call is what makes reload restore the same tab
  // the UI moved to.
  test('F4 (round 2): removeSession persists fallback active id when closing the active tab', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'middle',
      sessions: [
        {
          id: 'first',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'middle',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 2,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'last',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 3,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Sanity-check the restore set 'middle' as active.
    expect(result.current.activeSessionId).toBe('middle')

    // Reset spy so the restore-time assertions don't leak in.
    ;(service.setActiveSession as ReturnType<typeof vi.fn>).mockClear()

    act(() => result.current.removeSession('middle'))

    await waitFor(() =>
      expect(service.kill).toHaveBeenCalledWith({ sessionId: 'middle' })
    )

    // React state moved active to 'last' (Math.min(removedIndex=1, next.length-1=1)).
    await waitFor(() => expect(result.current.activeSessionId).toBe('last'))

    // The IPC must echo the same choice so reload comes back with the same
    // selection as the UI.
    await waitFor(() =>
      expect(service.setActiveSession).toHaveBeenCalledWith('last')
    )
  })

  // Round 9, Finding 2 (codex P2): the active-tab branch in removeSession
  // used a closure-captured `activeSessionId`. If the user switched tabs
  // while `service.kill(...)` was in flight, the stale closure value still
  // matched the about-to-be-removed id and promoted a neighbor on top of
  // the user's newer pick. After the fix, we read the LATEST active id
  // from a ref so a tab switch landing during the await wins.
  //
  // Scenario:
  //   - Sessions ['a','b','c'], active = 'a'
  //   - User clicks close on 'a' (kill in-flight)
  //   - User clicks 'c' (active = 'c')
  //   - Kill resolves
  //   - Active should STILL be 'c', not the closure-derived neighbor 'b'.
  test('round 9 F2: removeSession respects tab switches that landed during in-flight kill', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'a',
      sessions: [
        {
          id: 'a',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'b',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 2,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'c',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 3,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    // Suspend kill so we can interleave a setActiveSessionId between
    // dispatch and resolution.
    let resolveKill: (() => void) | null = null
    service.kill = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveKill = resolve
        })
    )

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.activeSessionId).toBe('a')
    ;(service.setActiveSession as ReturnType<typeof vi.fn>).mockClear()

    // Step 1: user closes 'a' (the active tab). Kill stays in-flight.
    act(() => result.current.removeSession('a'))
    await waitFor(() => expect(service.kill).toHaveBeenCalled())

    // Step 2: user switches to 'c' BEFORE the kill resolves. This is the
    // race that the fix protects against.
    act(() => result.current.setActiveSessionId('c'))
    expect(result.current.activeSessionId).toBe('c')

    // Step 3: kill resolves. The post-await branch must see active='c'
    // (not the closure-captured 'a') and leave the user's pick alone.
    act(() => {
      resolveKill?.()
    })

    await waitFor(() =>
      expect(result.current.sessions.map((s) => s.id)).toEqual(['b', 'c'])
    )

    // Critical assertion — active stays on 'c'. With the bug, the stale
    // closure ('a') triggered the neighbor-promotion branch and moved
    // active to 'b' (Math.min(removedIndex=0, next.length-1)).
    expect(result.current.activeSessionId).toBe('c')

    // Only the user's tab switch should have called setActiveSession with
    // 'c'. removeSession's neighbor-promotion path must NOT have called
    // setActiveSession('b').
    const calls = (service.setActiveSession as ReturnType<typeof vi.fn>).mock
      .calls
    expect(calls.some(([id]) => id === 'b')).toBe(false)
  })

  // F4 (round 2): closing an INACTIVE tab must NOT fire setActiveSession —
  // the active tab didn't change, and the spurious IPC would overwrite the
  // cache's active id with the same value (harmless but pointless I/O).
  test('F4 (round 2): removeSession does not call setActiveSession when closing an inactive tab', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'a',
      sessions: [
        {
          id: 'a',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'b',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 2,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    ;(service.setActiveSession as ReturnType<typeof vi.fn>).mockClear()

    act(() => result.current.removeSession('b'))
    await waitFor(() => expect(service.kill).toHaveBeenCalled())

    // Active stays on 'a' — no setActiveSession IPC needed.
    expect(result.current.activeSessionId).toBe('a')
    expect(service.setActiveSession).not.toHaveBeenCalled()
  })

  // F5 (round 2): exited sessions surface a Restart affordance, but the
  // hook had no restart path at all — the button was a silent no-op.
  test('F5 (round 2 / round 4): restartSession spawns then kills and replaces session metadata', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'exited-id',
      sessions: [
        {
          id: 'exited-id',
          cwd: '/home/user/projects/foo',
          status: { kind: 'Exited', last_exit_code: 0 },
        },
      ],
    })

    service.spawn = vi.fn().mockResolvedValue({
      sessionId: 'fresh-id',
      pid: 4242,
      cwd: '/home/user/projects/foo',
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.sessions).toHaveLength(1)
    expect(result.current.sessions[0].id).toBe('exited-id')
    expect(result.current.sessions[0].status).toBe('completed')

    act(() => result.current.restartSession('exited-id'))

    // 1. spawn fires FIRST at the cached cwd. Round 4 Finding 2: spawn-then-
    //    kill so a failed spawn doesn't tear down the cache entry for the
    //    old session. Round 8, Finding 3 (claude MEDIUM): restart preserves
    //    the user's tab semantics, so it must opt in to the agent bridge for
    //    parity with createSession — `enableAgentBridge` now defaults to
    //    `false` in desktopTerminalService, so callers must be explicit.
    await waitFor(() =>
      expect(service.spawn).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: '/home/user/projects/foo',
          enableAgentBridge: true,
        })
      )
    )

    // 2. kill_pty fires AFTER spawn against the OLD id (idempotent — Rust
    //    no-ops if the session is already gone, which is the common case
    //    for Exited).
    await waitFor(() =>
      expect(service.kill).toHaveBeenCalledWith({ sessionId: 'exited-id' })
    )

    // Order: spawn BEFORE kill so the old session is preserved in the cache
    // until the new PTY is alive.
    const killCallOrder = (service.kill as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]

    const spawnCallOrder = (service.spawn as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]

    expect(spawnCallOrder).toBeLessThan(killCallOrder)

    // 3. React state preserves the session id while the active pane rotates
    //    to fresh-id and status flips to 'running'.
    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(1)
      expect(result.current.sessions[0].id).toBe('exited-id')
      expect(result.current.sessions[0].panes[0].ptyId).toBe('fresh-id')
      expect(result.current.sessions[0].status).toBe('running')
    })

    expect(result.current.sessions[0].workingDirectory).toBe(
      '/home/user/projects/foo'
    )

    // 4. restoreData has a fresh entry under the NEW id with the new pid so
    //    TerminalPane attaches via the spawn-attached lifecycle (no duplicate
    //    PTY — same trick as createSession's F3 fix).
    const restored = result.current.restoreData.get('exited-id')
    expect(restored).toBeDefined()
    expect(restored!.pid).toBe(4242)
    expect(restored!.cwd).toBe('/home/user/projects/foo')

    // 5. Active id remains the React session id and the IPC echoes the
    //    rotated pane pty id so reload sees the same selection.
    expect(result.current.activeSessionId).toBe('exited-id')
    await waitFor(() =>
      expect(service.setActiveSession).toHaveBeenCalledWith('fresh-id')
    )
  })

  test('restartSession skips killing a seed PTY already gone from the live set', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'dead-pty',
      sessions: [
        {
          id: 'dead-pty',
          cwd: '/home/user/projects/foo',
          status: { kind: 'Exited', last_exit_code: 0 },
        },
      ],
    })

    service.spawn = vi.fn().mockResolvedValue({
      sessionId: 'fresh-id',
      pid: 999,
      cwd: '/home/user/projects/foo',
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.sessions[0].id).toBe('dead-pty')

    // The seed PTY is gone by restart time (graceful-quit clear_all).
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: null,
      sessions: [],
    })

    act(() => result.current.restartSession('dead-pty'))

    await waitFor(() =>
      expect(service.spawn).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: '/home/user/projects/foo' })
      )
    )

    // Restart succeeds: the pane rotates to the fresh PTY and runs again.
    await waitFor(() => {
      expect(result.current.sessions[0].panes[0].ptyId).toBe('fresh-id')
      expect(result.current.sessions[0].status).toBe('running')
    })

    // The doomed kill of the absent seed PTY is never issued.
    expect(service.kill).not.toHaveBeenCalledWith({ sessionId: 'dead-pty' })
  })

  // Round 9, Finding 3 (codex P2): the `wasActive` capture in restartSession
  // used a closure-bound `activeSessionId`. If the user switched tabs during
  // the spawn / kill roundtrip, promoting the restarted session would
  // overwrite the user's newer pick. Reading `activeSessionIdRef.current`
  // post-await keeps the user's latest selection.
  //
  // Scenario:
  //   - Sessions ['exited','alive'], active = 'exited'
  //   - User clicks Restart on 'exited' (spawn in-flight)
  //   - User clicks 'alive' (active = 'alive')
  //   - Spawn resolves → kill resolves → swap commits as 'fresh'
  //   - Active should STILL be 'alive', not 'fresh'.
  test('round 9 F3: restartSession respects tab switches landing during spawn/kill', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'exited',
      sessions: [
        {
          id: 'exited',
          cwd: '/tmp',
          status: { kind: 'Exited', last_exit_code: 0 },
        },
        {
          id: 'alive',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    // Suspend spawn so we can race a tab switch in.
    let resolveSpawn:
      | ((v: {
          sessionId: string
          pid: number
          cwd: string
          shell: string
        }) => void)
      | null = null
    service.spawn = vi.fn(
      (): Promise<{
        sessionId: string
        pid: number
        cwd: string
        shell: string
      }> =>
        new Promise((resolve) => {
          resolveSpawn = resolve
        })
    )

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.activeSessionId).toBe('exited')
    ;(service.setActiveSession as ReturnType<typeof vi.fn>).mockClear()

    // Step 1: user restarts the active 'exited' tab. spawn() in-flight.
    act(() => result.current.restartSession('exited'))
    await waitFor(() => expect(service.spawn).toHaveBeenCalled())

    // Step 2: user switches to 'alive' BEFORE spawn resolves.
    act(() => result.current.setActiveSessionId('alive'))
    expect(result.current.activeSessionId).toBe('alive')

    // Step 3: spawn resolves → restartSession's post-await branch runs.
    // The fix reads activeSessionIdRef.current ('alive') so wasActive=false,
    // and the swap commits without promoting 'fresh'.
    act(() => {
      resolveSpawn?.({
        sessionId: 'fresh',
        pid: 9000,
        cwd: '/tmp',
        shell: '/bin/zsh',
      })
    })

    // Wait for the swap to commit.
    await waitFor(() =>
      expect(
        result.current.sessions.find((s) =>
          s.panes.some((pane) => pane.ptyId === 'fresh')
        )
      ).toBeDefined()
    )

    // Critical: active stays on 'alive'. With the bug, the closure-captured
    // wasActive=true triggered setActiveSessionIdState('fresh'), clobbering
    // the user's newer pick.
    expect(result.current.activeSessionId).toBe('alive')

    // setActiveSession must not have been called for 'fresh' — only the
    // user's tab switch ('alive') should appear, if at all.
    const calls = (service.setActiveSession as ReturnType<typeof vi.fn>).mock
      .calls
    expect(calls.some(([id]) => id === 'fresh')).toBe(false)
  })

  // Round 12, Finding 5 (codex P2): createSession's active-session write
  // must share the round-9 F4 monotonic request guard. Previously it
  // bypassed the guard with a raw `service.setActiveSession + .catch`,
  // so a tab switch landing during createSession's in-flight IPC could
  // be clobbered by the late completion (or its rollback). Routing
  // through the canonical `setActiveSessionId` ensures the LATEST
  // request always wins — older completions detect they're stale via
  // the request-id ref and skip both the optimistic write and the
  // rollback.
  test('round 12 F5: createSession routes setActiveSession through the request-token guard', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: null,
      sessions: [],
    })

    // Suspend createSession's setActiveSession IPC so we can race a tab
    // switch in. We resolve it later to assert the request-token guard
    // suppresses any stale rollback.
    let resolveCreateActive: (() => void) | null = null
    let rejectCreateActive: ((err: Error) => void) | null = null
    let setActiveCallCount = 0
    service.setActiveSession = vi.fn((): Promise<void> => {
      setActiveCallCount += 1
      if (setActiveCallCount === 1) {
        return new Promise((_resolve, reject) => {
          rejectCreateActive = reject
        })
      }

      return new Promise((resolve) => {
        resolveCreateActive = resolve
      })
    })

    service.spawn = vi
      .fn()
      .mockResolvedValueOnce({
        sessionId: 'created',
        pid: 1,
        cwd: '/home/user',
      })
      .mockResolvedValueOnce({ sessionId: 'second', pid: 2, cwd: '/home/user' })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Step 1: createSession — fires setActiveSession #1 (suspended).
    act(() => result.current.createSession())
    await waitFor(() =>
      expect(
        result.current.sessions.find((s) =>
          s.panes.some((pane) => pane.ptyId === 'created')
        )
      ).toBeDefined()
    )

    const createdSessionId = result.current.sessions.find((s) =>
      s.panes.some((pane) => pane.ptyId === 'created')
    )!.id

    expect(result.current.activeSessionId).toBe(createdSessionId)

    // Step 2: another createSession — fires setActiveSession #2.
    act(() => result.current.createSession())
    await waitFor(() =>
      expect(
        result.current.sessions.find((s) =>
          s.panes.some((pane) => pane.ptyId === 'second')
        )
      ).toBeDefined()
    )

    const secondSessionId = result.current.sessions.find((s) =>
      s.panes.some((pane) => pane.ptyId === 'second')
    )!.id

    expect(result.current.activeSessionId).toBe(secondSessionId)

    // Step 3: createSession #1's IPC now FAILS (e.g. transient backend
    // error). Without the request-token guard, this would revert active
    // back to null (the value captured at call time). With the guard,
    // the failure detects a newer request superseded it and skips the
    // rollback.
    act(() => {
      rejectCreateActive?.(new Error('transient'))
    })

    // Critical: active stays on 'second'. With the bug, the rollback
    // would have reverted to null and clobbered the user's selection.
    await waitFor(() =>
      expect(result.current.activeSessionId).toBe(secondSessionId)
    )

    // Resolve #2 so test cleanup is clean.
    act(() => resolveCreateActive?.())
  })

  // Round 12, Finding 4 (codex P2): when restartSession races a concurrent
  // removeSession of the same id, the new spawn becomes an orphan that
  // gets killed in the orphan-kill branch. But before the orphan branch
  // discovered the session was gone, restartSession had ALREADY seeded
  // restoreData / pendingPanes / readyPanes / bufferedRef / ptySessionMap
  // entries for the new id. Without the round-12 cleanup, those entries
  // leaked per race — repeated races accumulated stale state.
  //
  // Reproduce: spawn resolves slowly, removeSession lands during the
  // spawn's in-flight window, then assert restoreData has no entry
  // for the orphan id after both calls settle.
  test('round 12 F4: restartSession orphan branch tears down seeded bookkeeping', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'exited',
      sessions: [
        {
          id: 'exited',
          cwd: '/tmp',
          status: { kind: 'Exited', last_exit_code: null },
        },
      ],
    })

    let resolveSpawn:
      | ((v: {
          sessionId: string
          pid: number
          cwd: string
          shell: string
        }) => void)
      | null = null
    service.spawn = vi.fn(
      (): Promise<{
        sessionId: string
        pid: number
        cwd: string
        shell: string
      }> =>
        new Promise((resolve) => {
          resolveSpawn = resolve
        })
    )

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Step 1: kick off restartSession — spawn is in flight.
    act(() => result.current.restartSession('exited'))
    await waitFor(() => expect(service.spawn).toHaveBeenCalled())

    // Step 2: remove the session BEFORE spawn resolves.
    act(() => result.current.removeSession('exited'))
    await waitFor(() =>
      expect(
        result.current.sessions.find((s) => s.id === 'exited')
      ).toBeUndefined()
    )

    // Step 3: spawn now resolves with the orphan id.
    act(() => {
      resolveSpawn?.({
        sessionId: 'orphan-fresh',
        pid: 1234,
        cwd: '/tmp',
        shell: '/bin/zsh',
      })
    })

    // Wait until the orphan-kill IPC has fired. Cast through the typed
    // service.kill signature so TypeScript narrows req.sessionId.
    await waitFor(() => {
      const killCalls = (
        service.kill as unknown as ReturnType<
          typeof vi.fn<(req: { sessionId: string }) => Promise<void>>
        >
      ).mock.calls
      expect(killCalls.some(([req]) => req.sessionId === 'orphan-fresh')).toBe(
        true
      )
    })

    // Critical: the bookkeeping for the orphan id must NOT remain in
    // restoreData. Without the cleanup, this entry would leak forever.
    expect(result.current.restoreData.has('orphan-fresh')).toBe(false)
  })

  // Round 13, Codex P2: when service.kill of the OLD id fails, Rust cache
  // still contains both ids in session_order. The restart path must abort
  // (kill the new orphan) instead of continuing to setSessions + the
  // reorderSessions IPC, which would diverge UI from cache.
  test('round 13: restartSession aborts and kills orphan when kill of old id fails', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'exited',
      sessions: [
        {
          id: 'exited',
          cwd: '/tmp',
          status: { kind: 'Exited', last_exit_code: 1 },
        },
      ],
    } satisfies SessionList)

    service.spawn = vi
      .fn()
      .mockResolvedValue({ sessionId: 'fresh', pid: 999, cwd: '/tmp' })

    // First kill (of 'exited') rejects. Second kill (of orphan 'fresh')
    // resolves so the abort path completes cleanly.
    service.kill = vi.fn((req: { sessionId: string }): Promise<void> => {
      if (req.sessionId === 'exited') {
        return Promise.reject(new Error('kill_pty: SIGKILL failed'))
      }

      return Promise.resolve()
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.restartSession('exited'))

    // Spawn fires first — verify it was called with the cached cwd.
    await waitFor(() => expect(service.spawn).toHaveBeenCalled())

    // Both kills land: the old id (rejects), then the orphan new id.
    await waitFor(() => {
      const killCalls = (
        service.kill as unknown as ReturnType<
          typeof vi.fn<(req: { sessionId: string }) => Promise<void>>
        >
      ).mock.calls
      expect(killCalls.some(([req]) => req.sessionId === 'exited')).toBe(true)
      expect(killCalls.some(([req]) => req.sessionId === 'fresh')).toBe(true)
    })

    // Critical: setSessions was NOT swapped. The old 'exited' id is
    // still in React state, hydrated errored from its non-zero last_exit_code.
    // The 'fresh' id is not present (orphan killed without seeding bookkeeping).
    expect(result.current.sessions.map((s) => s.id)).toEqual(['exited'])
    expect(result.current.sessions[0].status).toBe('errored')
    expect(result.current.restoreData.has('fresh')).toBe(false)

    // Critical: reorderSessions was NOT called. The earlier code
    // would have fired reorderSessions(['fresh']), which Rust would
    // reject as a non-permutation of session_order=[exited, fresh].
    expect(service.reorderSessions).not.toHaveBeenCalled()
  })

  // Round 14, Claude MEDIUM: removeSession must unregister the retired id
  // from ptySessionMap. Without this the E2E bridge's getAllPtySessionIds()
  // returns dead ids and per-spec session-count assertions break as the
  // map accumulates across specs. Alive sessions are registered by the
  // restore loop, so an Alive listSessions mock exercises the natural path.
  test('round 14: removeSession unregisters retired id from ptySessionMap', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'sess-a',
      sessions: [
        {
          id: 'sess-a',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 4321,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    } satisfies SessionList)

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Restore registered the id; verify the precondition.
    expect(getAllPtySessionIds()).toContain('sess-a')

    act(() => result.current.removeSession('sess-a'))

    await waitFor(() =>
      expect(result.current.sessions.find((s) => s.id === 'sess-a')).toBe(
        undefined
      )
    )

    // The retired id must NOT remain in ptySessionMap.
    expect(getAllPtySessionIds()).not.toContain('sess-a')
  })

  // Round 14, Claude MEDIUM: restartSession must unregister the OLD id
  // when swapping in the new one. registerPtySession(result.sessionId)
  // already runs for the new id; the old id needed the symmetric
  // unregister before this fix.
  //
  // Exited sessions are not auto-registered by the restore loop (only
  // Alive ones are), but they CAN be in ptySessionMap when an
  // originally-Alive session crashes and onExit flips its status to
  // 'completed'. Seed the map manually to mimic that real flow.
  test('round 14: restartSession unregisters old id and registers new id', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'old-id',
      sessions: [
        {
          id: 'old-id',
          cwd: '/tmp',
          status: { kind: 'Exited', last_exit_code: 0 },
        },
      ],
    } satisfies SessionList)

    service.spawn = vi.fn().mockResolvedValue({
      sessionId: 'new-id',
      pid: 7777,
      cwd: '/tmp',
    })

    // Seed: this session was Alive earlier, then onExit flipped it. Its
    // ptySessionMap entry persisted across the status flip, just like in
    // production.
    registerPtySession('old-id', 'old-id', '/tmp')

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(getAllPtySessionIds()).toContain('old-id')

    act(() => result.current.restartSession('old-id'))

    // Wait until the React swap has landed: Session.id stays stable while
    // pane.ptyId rotates.
    await waitFor(() => {
      expect(result.current.sessions.map((s) => s.id)).toEqual(['old-id'])
      expect(result.current.sessions[0].panes[0].ptyId).toBe('new-id')
    })

    const ids = getAllPtySessionIds()
    expect(ids).toContain('new-id')
    expect(ids).not.toContain('old-id')
  })

  test('restartSession resets cacheHistory to [] and deletes the old ptyId key', async () => {
    window.localStorage.clear()
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'restart-old',
      sessions: [
        {
          id: 'restart-old',
          cwd: '/tmp',
          status: { kind: 'Exited', last_exit_code: 0 },
        },
      ],
    } satisfies SessionList)

    service.spawn = vi.fn().mockResolvedValue({
      sessionId: 'restart-new',
      pid: 4242,
      cwd: '/tmp',
    })
    registerPtySession('restart-old', 'restart-old', '/tmp')

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.appendPaneCacheReading('restart-old', 'p0', 80)
    })
    expect(result.current.sessions[0].panes[0].cacheHistory).toEqual([80])
    expect(
      window.localStorage.getItem('vimeflow:agent:cacheHistory:restart-old')
    ).not.toBeNull()

    act(() => result.current.restartSession('restart-old'))

    await waitFor(() => {
      expect(result.current.sessions[0].panes[0].ptyId).toBe('restart-new')
    })

    expect(result.current.sessions[0].panes[0].cacheHistory).toEqual([])
    expect(
      window.localStorage.getItem('vimeflow:agent:cacheHistory:restart-old')
    ).toBeNull()
  })

  test('F5 (round 2): restartSession of inactive session does NOT call setActiveSession', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'alive',
      sessions: [
        {
          id: 'alive',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'exited',
          cwd: '/var',
          status: { kind: 'Exited', last_exit_code: null },
        },
      ],
    })

    service.spawn = vi.fn().mockResolvedValue({
      sessionId: 'fresh',
      pid: 99,
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    ;(service.setActiveSession as ReturnType<typeof vi.fn>).mockClear()

    act(() => result.current.restartSession('exited'))

    await waitFor(() => expect(service.spawn).toHaveBeenCalled())
    // The inactive 'exited' tab restarts to 'fresh', but the active tab
    // ('alive') stays untouched — no setActiveSession should fire.
    expect(result.current.activeSessionId).toBe('alive')
    expect(service.setActiveSession).not.toHaveBeenCalled()
  })

  // Round 3, Finding 2 (codex P1): kill_pty in Rust REMOVES the old id from
  // cache.session_order and spawn_pty APPENDS the new id. Without an
  // explicit order push, a restarted MIDDLE tab persists as
  // [A, C, fresh] in cache.session_order while the live UI shows
  // [A, fresh, C]. After a reload the restored order would diverge.
  //
  // PR #290: ordering persistence moved from the legacy `reorder_sessions`
  // IPC to `set_workspace_sessions` (which rebuilds session_order from the
  // snapshot atomically with grouping). The assertion shape changes
  // accordingly; the underlying invariant ([a, fresh, c] reaches the cache)
  // is unchanged.
  test('F5 (round 3): restartSession persists the new tab order via the workspace snapshot', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'a',
      sessions: [
        {
          id: 'a',
          cwd: '/tmp/a',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'b',
          cwd: '/tmp/b',
          status: { kind: 'Exited', last_exit_code: 0 },
        },
        {
          id: 'c',
          cwd: '/tmp/c',
          status: {
            kind: 'Alive',
            pid: 3,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    service.spawn = vi.fn().mockResolvedValue({
      sessionId: 'fresh',
      pid: 99,
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.sessions.map((s) => s.id)).toEqual(['a', 'b', 'c'])

    // Clear any IPC calls from listSessions / restore.
    vi.mocked(pushWorkspaceShape).mockClear()

    act(() => result.current.restartSession('b'))

    // React state preserves Session.id while rotating b's pane ptyId in place.
    await waitFor(() =>
      expect(result.current.sessions.map((s) => s.id)).toEqual(['a', 'b', 'c'])
    )
    expect(result.current.sessions[1].panes[0].ptyId).toBe('fresh')

    // Rust cache must learn the in-memory order [a, fresh, c] — otherwise
    // kill+spawn would leave session_order at [a, c, fresh] and a reload
    // would render the tabs in the wrong order. The latest grouping
    // snapshot push carries it.
    await waitFor(() => {
      const calls = vi.mocked(pushWorkspaceShape).mock.calls

      const lastPayload = calls[calls.length - 1]?.[0] as
        | { sessions: { panes: { ptyId: string }[] }[] }
        | undefined

      const ptyIds = lastPayload?.sessions.flatMap((s) =>
        s.panes.map((p) => p.ptyId)
      )
      expect(ptyIds).toEqual(['a', 'fresh', 'c'])
    })
  })

  // Round 3 codex P2 (gap in Finding 3): the orchestrator must mark sessions
  // 'completed' when the PTY exits — without that, the live-exit branch of
  // the status-first mode fix in TerminalZone never triggers, so the
  // Restart button stays unreachable until a full reload.
  test('F-r3-3 follow-up: pty-exit flips session status to completed', async () => {
    const service = createMockService()
    let exitCallback:
      | ((sessionId: string, code: number | null) => void)
      | null = null
    service.onExit = vi.fn((cb) => {
      exitCallback = cb

      // eslint-disable-next-line @typescript-eslint/no-empty-function
      return Promise.resolve((): void => {})
    })

    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'a',
      sessions: [
        {
          id: 'a',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.sessions[0].status).toBe('running')
    expect(exitCallback).not.toBeNull()

    // Simulate the PTY exiting (e.g. user typed `exit`). The orchestrator
    // must flip status to 'completed' and stamp the exit time so
    // TerminalZone's status-first mode resolution renders the
    // awaiting-restart UX without a reload.
    const exitedAt = new Date('2026-05-08T12:05:00Z')
    try {
      vi.useFakeTimers()
      vi.setSystemTime(exitedAt)

      act(() => {
        // exitCallback is captured above as non-null; cast for the closure.
        ;(exitCallback as (sessionId: string, code: number | null) => void)(
          'a',
          0
        )
      })

      expect(result.current.sessions[0].status).toBe('completed')
      expect(result.current.sessions[0].lastActivityAt).toBe(
        exitedAt.toISOString()
      )
    } finally {
      vi.useRealTimers()
    }
  })

  test('non-zero pty exit marks the pane errored', async () => {
    const service = createMockService()
    let exitCallback:
      | ((sessionId: string, code: number | null) => void)
      | null = null
    service.onExit = vi.fn((cb) => {
      exitCallback = cb

      // eslint-disable-next-line @typescript-eslint/no-empty-function
      return Promise.resolve((): void => {})
    })

    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'a',
      sessions: [
        {
          id: 'a',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.sessions[0].status).toBe('running')

    act(() => {
      ;(exitCallback as (sessionId: string, code: number | null) => void)(
        'a',
        3
      )
    })

    expect(result.current.sessions[0].status).toBe('errored')
    expect(result.current.sessions[0].panes[0].status).toBe('errored')
  })

  test('zero pty exit marks the pane completed', async () => {
    const service = createMockService()
    let exitCallback:
      | ((sessionId: string, code: number | null) => void)
      | null = null
    service.onExit = vi.fn((cb) => {
      exitCallback = cb

      // eslint-disable-next-line @typescript-eslint/no-empty-function
      return Promise.resolve((): void => {})
    })

    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'a',
      sessions: [
        {
          id: 'a',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.sessions[0].status).toBe('running')

    act(() => {
      ;(exitCallback as (sessionId: string, code: number | null) => void)(
        'a',
        0
      )
    })

    expect(result.current.sessions[0].status).toBe('completed')
    expect(result.current.sessions[0].panes[0].status).toBe('completed')
  })

  test('null pty exit marks the pane completed', async () => {
    const service = createMockService()
    let exitCallback:
      | ((sessionId: string, code: number | null) => void)
      | null = null
    service.onExit = vi.fn((cb) => {
      exitCallback = cb

      // eslint-disable-next-line @typescript-eslint/no-empty-function
      return Promise.resolve((): void => {})
    })

    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'a',
      sessions: [
        {
          id: 'a',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.sessions[0].status).toBe('running')

    act(() => {
      ;(exitCallback as (sessionId: string, code: number | null) => void)(
        'a',
        null
      )
    })

    expect(result.current.sessions[0].status).toBe('completed')
    expect(result.current.sessions[0].panes[0].status).toBe('completed')
  })

  test('pty read error marks the pane errored', async () => {
    const service = createMockService()
    let errorCallback: ((sessionId: string, message: string) => void) | null =
      null
    service.onError = vi.fn((cb) => {
      errorCallback = cb

      // eslint-disable-next-line @typescript-eslint/no-empty-function
      return Promise.resolve((): void => {})
    })

    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'a',
      sessions: [
        {
          id: 'a',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.sessions[0].status).toBe('running')

    act(() => {
      ;(errorCallback as (sessionId: string, message: string) => void)(
        'a',
        'read failed'
      )
    })

    expect(result.current.sessions[0].status).toBe('errored')
    expect(result.current.sessions[0].panes[0].status).toBe('errored')
  })

  // Round 4, Finding 2 (codex P2) regression test.
  //
  // Before the spawn-then-kill reorder, a failed spawn (e.g. cwd deleted)
  // left React state showing the tab as `completed` but the Rust cache
  // had already removed it via the pre-spawn kill. The session vanished
  // on the next reload and any later IPC against the old id rejected as
  // unknown. With the new ordering, the old session is preserved when
  // spawn fails — the user can fix the cwd and try again.
  test('round 4 F2: spawn failure preserves the old session in cache and React state', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'exited-id',
      sessions: [
        {
          id: 'exited-id',
          cwd: '/now-deleted',
          status: { kind: 'Exited', last_exit_code: 0 },
        },
      ],
    })

    // Simulate Rust rejecting spawn because the cwd no longer exists.
    service.spawn = vi.fn().mockRejectedValue(new Error('invalid cwd'))

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    ;(service.kill as ReturnType<typeof vi.fn>).mockClear()

    act(() => result.current.restartSession('exited-id'))

    // Spawn must be attempted — but should be the only IPC fired since it
    // failed. kill MUST NOT be called: that's exactly the behavior that
    // would have torn down the cache entry under the buggy ordering.
    await waitFor(() => expect(service.spawn).toHaveBeenCalled())
    expect(service.kill).not.toHaveBeenCalled()

    // The React tab still shows the old id with `completed` status — the
    // user can retry once they recreate the cwd. The orchestrator did NOT
    // pretend the restart succeeded.
    expect(result.current.sessions).toHaveLength(1)
    expect(result.current.sessions[0].id).toBe('exited-id')
    expect(result.current.sessions[0].status).toBe('completed')

    // restoreData for the old id stays untouched — same as before the
    // restart attempt — so the next listSessions/render cycle doesn't
    // accidentally re-resolve the tab to a different mode.
  })

  test('F5 (round 2): restartSession on unknown id is a no-op', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: null,
      sessions: [],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.restartSession('does-not-exist'))

    // No spawn, no kill — the unknown id is logged and the function returns.
    await waitFor(() => {
      expect(service.spawn).not.toHaveBeenCalled()
    })
    expect(service.kill).not.toHaveBeenCalled()
    expect(result.current.sessions).toHaveLength(0)
  })

  test('renameSession updates session name in-memory only', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 's1',
      sessions: [
        {
          id: 's1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    const originalName = result.current.sessions[0].name

    act(() => result.current.renameSession('s1', 'my-session'))

    expect(result.current.sessions[0].name).toBe('my-session')
    expect(result.current.sessions[0].name).not.toBe(originalName)
  })

  // Round 9, Finding 5 (codex P2 / claude LOW): reorderSessions's old
  // rollback used a render-time `prev` snapshot. On IPC rejection the
  // catch handler called setSessions(prev), which clobbered any concurrent
  // createSession / removeSession update that committed during the IPC
  // roundtrip. The fix drops the rollback entirely — Rust's permutation
  // validator already protects the cache, and on next reload the merge
  // logic reconciles UI with cache.
  test('round 9 F5: reorderSessions does not roll back on IPC failure (preserves concurrent state)', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'a',
      sessions: [
        {
          id: 'a',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'b',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 2,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    // Rejecting IPC simulates the cache rejecting the order (permutation
    // mismatch, cache file not writable, etc).
    let rejectReorder: ((e: unknown) => void) | null = null
    service.reorderSessions = vi.fn(
      (): Promise<void> =>
        new Promise<void>((_resolve, reject) => {
          rejectReorder = reject
        })
    )

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.sessions.map((s) => s.id)).toEqual(['a', 'b'])

    // User reorders → optimistic ['b','a']. IPC stays in-flight.
    const reversed = [...result.current.sessions].reverse()
    act(() => result.current.reorderSessions(reversed))
    expect(result.current.sessions.map((s) => s.id)).toEqual(['b', 'a'])

    // IPC rejects. With the bug, setSessions(prev) reverted to ['a','b'].
    // With the fix, no rollback runs — the user's intended order stays.
    act(() => {
      rejectReorder?.('cache rejected')
    })

    // Give the reject handler a microtask to run.
    await waitFor(() =>
      expect(result.current.sessions.map((s) => s.id)).toEqual(['b', 'a'])
    )
    expect(result.current.sessions.map((s) => s.id)).toEqual(['b', 'a'])
  })

  // PR #290: cache persistence moved from `reorder_sessions` to the
  // grouping snapshot push. Assert the new path carries the reversed order.
  test('reorderSessions pushes the new order via the workspace snapshot', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'a',
      sessions: [
        {
          id: 'a',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'b',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 2,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    const reversed = [...result.current.sessions].reverse()

    act(() => result.current.reorderSessions(reversed))

    await waitFor(() => {
      const calls = vi.mocked(pushWorkspaceShape).mock.calls

      const lastPayload = calls[calls.length - 1]?.[0] as
        | { sessions: { panes: { ptyId: string }[] }[] }
        | undefined

      const ptyIds = lastPayload?.sessions.flatMap((s) =>
        s.panes.map((p) => p.ptyId)
      )
      expect(ptyIds).toEqual(['b', 'a'])
    })
  })

  // PR #290 cycle 4: Claude HIGH — `reorderSessions` was using a plain
  // `setSessions(reordered)` overwrite, so a drag-reorder that races an
  // in-flight `addPane` would clobber the new pane (the reorder snapshot
  // was built before the pane existed). The functional updater merges
  // `reordered`'s order against the latest `prev` by session id, so any
  // panes (or sessions) committed during the race window survive.
  test('reorderSessions preserves a session committed during the reorder window', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'a',
      sessions: [
        {
          id: 'a',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'b',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 2,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    service.spawn = vi
      .fn()
      .mockResolvedValue({ sessionId: 'c-pty', pid: 3, cwd: '/tmp' })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Snapshot the initial 2 sessions at "drag start".
    const reorderedAtDragStart = [...result.current.sessions].reverse()

    // While the drag was in flight, a third session is created. This
    // simulates the createSession spawn completing between drag-start and
    // setSessions landing.
    await act(async () => {
      result.current.createSession()
      // Give createSession a tick to spawn + setSessions.
      await Promise.resolve()
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.sessions).toHaveLength(3))
    const newlyCreatedId = result.current.sessions[2].id

    // NOW the reorder lands with its stale snapshot of 2 sessions.
    act(() => result.current.reorderSessions(reorderedAtDragStart))

    // Functional updater: the 3rd session committed during the race is
    // appended at the tail rather than being silently erased.
    await waitFor(() => expect(result.current.sessions).toHaveLength(3))
    expect(result.current.sessions.map((s) => s.id)).toEqual([
      'b',
      'a',
      newlyCreatedId,
    ])
  })

  // PR #290 cycle 5: Claude HIGH — the cycle-4 functional updater used
  // `prevById.get(s.id) ?? s`, which falls back to the STALE `s` when
  // `removeSession` evicted the id during the drag. That resurrects a
  // dead PTY back into React state, leaving a zombie tab that
  // kill_pty cannot close ("session not found"). The fix filters
  // missing-from-prev ids out instead of falling back.
  test('reorderSessions drops sessions removed during the reorder window (no zombie resurrection)', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'a',
      sessions: [
        {
          id: 'a',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'b',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 2,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'c',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 3,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.sessions.map((s) => s.id)).toEqual(['a', 'b', 'c'])

    // Snapshot at drag-start: user is reordering to [c, b, a].
    const reorderedAtDragStart = [
      result.current.sessions[2],
      result.current.sessions[1],
      result.current.sessions[0],
    ]

    // While the drag is in flight, session 'b' is removed.
    act(() => result.current.removeSession('b'))
    await waitFor(() => expect(result.current.sessions).toHaveLength(2))

    // Reorder lands with its stale 3-session snapshot — must NOT
    // resurrect 'b'. Order should be [c, a] (drop 'b' from the
    // reordered list).
    act(() => result.current.reorderSessions(reorderedAtDragStart))

    await waitFor(() => {
      expect(result.current.sessions.map((s) => s.id)).toEqual(['c', 'a'])
    })
  })

  test('updateSessionCwd updates session cwd without touching pane cwd', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 's1',
      sessions: [
        {
          id: 's1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.updateSessionCwd('s1', '/home/user'))

    expect(result.current.sessions[0].workingDirectory).toBe('/home/user')
    expect(result.current.sessions[0].panes[0].cwd).toBe('/tmp')
    expect(service.updateSessionCwd).not.toHaveBeenCalled()
  })

  test('updateSessionAgentType persists detected agent identity in local session state', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 's1',
      sessions: [
        {
          id: 's1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.updateSessionAgentType('s1', 'codex'))

    expect(result.current.sessions[0].agentType).toBe('codex')
  })

  test('updateSessionAgentType returns prev reference for unknown id (no re-render)', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 's1',
      sessions: [
        {
          id: 's1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    const before = result.current.sessions
    act(() => result.current.updateSessionAgentType('does-not-exist', 'codex'))

    expect(result.current.sessions).toBe(before)
  })

  test('updateSessionAgentType returns prev reference when value unchanged', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 's1',
      sessions: [
        {
          id: 's1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.updateSessionAgentType('s1', 'codex'))
    const after1 = result.current.sessions
    act(() => result.current.updateSessionAgentType('s1', 'codex'))

    expect(result.current.sessions).toBe(after1)
  })

  test('restartSession preserves agentType when latest resume is available', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 's1',
      sessions: [
        {
          id: 's1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    service.spawn = vi.fn().mockResolvedValue({
      sessionId: 's2',
      pid: 2,
      cwd: '/tmp',
    })
    service.kill = vi.fn().mockResolvedValue(undefined)
    service.reorderSessions = vi.fn().mockResolvedValue(undefined)

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Stamp a resumable agentType so the latest-conversation fallback is used.
    act(() => result.current.updateSessionAgentType('s1', 'claude-code'))
    expect(result.current.sessions[0].agentType).toBe('claude-code')

    await act(async () => {
      result.current.restartSession('s1')
      // wait for the spawn-first sequence to complete + flushSync apply
      await vi.waitFor(
        () => {
          expect(result.current.sessions[0].panes[0].ptyId).toBe('s2')
        },
        { timeout: 1000 }
      )
    })

    expect(result.current.sessions[0].agentType).toBe('claude-code')
    expect(service.write).toHaveBeenCalledWith({
      sessionId: 's2',
      data: 'claude --continue\r',
    })
  })

  test('restartSession releases exact identity resume claim when pane is removed', async () => {
    vi.mocked(loadWorkspaceForRestore).mockResolvedValueOnce({
      sessions: [
        {
          id: 'ws-shell',
          projectId: 'proj-1',
          layout: 'vsplit',
          workingDirectory: '/repo',
          active: true,
          open: true,
          panes: [
            {
              kind: 'shell',
              paneId: 'p0',
              paneIndex: 0,
              active: true,
              ptyId: 'pty-exact',
              cwd: '/repo',
              agentType: 'claude-code',
              agentSessionId: 'conversation-exact',
            },
            {
              kind: 'shell',
              paneId: 'p1',
              paneIndex: 1,
              active: false,
              ptyId: 'pty-legacy',
              cwd: '/repo',
              agentType: 'claude-code',
              agentSessionId: null,
            },
          ],
        },
      ],
    })

    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'pty-exact',
      sessions: [
        {
          id: 'pty-exact',
          cwd: '/repo',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'pty-legacy',
          cwd: '/repo',
          status: {
            kind: 'Alive',
            pid: 2,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    service.spawn = vi
      .fn()
      .mockResolvedValueOnce({
        sessionId: 'pty-exact-new',
        pid: 3,
        cwd: '/repo',
      })
      .mockResolvedValueOnce({
        sessionId: 'pty-exact-newer',
        pid: 4,
        cwd: '/repo',
      })
      .mockResolvedValueOnce({
        sessionId: 'pty-legacy-new',
        pid: 5,
        cwd: '/repo',
      })
    service.kill = vi.fn().mockResolvedValue(undefined)

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.restartSession('ws-shell', 'p0'))
    await waitFor(() =>
      expect(result.current.sessions[0].panes[0].ptyId).toBe('pty-exact-new')
    )

    act(() => result.current.restartSession('ws-shell', 'p0'))
    await waitFor(() =>
      expect(result.current.sessions[0].panes[0].ptyId).toBe('pty-exact-newer')
    )

    act(() => result.current.removePane('ws-shell', 'p0'))
    await waitFor(() =>
      expect(result.current.sessions[0].panes).toHaveLength(1)
    )

    act(() => result.current.restartSession('ws-shell', 'p1'))
    await waitFor(() =>
      expect(result.current.sessions[0].panes[0].ptyId).toBe('pty-legacy-new')
    )

    expect(service.write).toHaveBeenLastCalledWith({
      sessionId: 'pty-legacy-new',
      data: 'claude --continue\r',
    })
    expect(result.current.sessions[0].panes[0].agentType).toBe('claude-code')
  })

  test('restartSession clears sticky title fields so the new PTY starts fresh', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 's1',
      sessions: [
        {
          id: 's1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    service.spawn = vi.fn().mockResolvedValue({
      sessionId: 's2',
      pid: 2,
      cwd: '/tmp',
    })
    service.kill = vi.fn().mockResolvedValue(undefined)
    service.reorderSessions = vi.fn().mockResolvedValue(undefined)

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(titleListener()).toBeDefined())

    // Seed a user-renamed title so the pane is in sticky state.
    act(() => {
      titleListener()?.({
        sessionId: 's1',
        agentSessionId: 'agent-uuid',
        title: 'Old Task',
        source: 'user-renamed',
      })
    })

    act(() => {
      result.current.setPaneUserLabel('s1', 'renamed-task')
    })

    const paneBefore = result.current.sessions[0]?.panes[0]
    expect(paneBefore?.agentTitle).toBe('Old Task')
    expect(paneBefore?.agentTitleSource).toBe('user-renamed')
    expect(paneBefore?.userLabel).toBe('renamed-task')

    await act(async () => {
      result.current.restartSession('s1')
      await vi.waitFor(
        () => {
          expect(result.current.sessions[0].panes[0].ptyId).toBe('s2')
        },
        { timeout: 1000 }
      )
    })

    const paneAfter = result.current.sessions[0]?.panes[0]
    expect(paneAfter?.agentTitle).toBeUndefined()
    expect(paneAfter?.agentTitleSource).toBeUndefined()
    expect(paneAfter?.userLabel).toBeUndefined()
  })

  // F2 regression: events fired AFTER listSessions resolves but BEFORE the
  // pane attaches its live listener must still reach the pane via the
  // notifyPaneReady drain. Without this, the previous code stopped buffering
  // as soon as setLoading(false) ran (which only schedules a render) — events
  // emitted between then and useTerminal subscribing went to neither the
  // buffer nor the live stream and were silently lost on busy reloads.
  test('F2 regression: keeps buffering until each pane reports ready', async () => {
    const service = createMockService()
    let dataCallback: (
      sessionId: string,
      data: string,
      offsetStart: number,
      byteLen: number
    ) => void = vi.fn()
    service.onData = vi.fn((cb): Promise<() => void> => {
      dataCallback = cb

      // eslint-disable-next-line @typescript-eslint/no-empty-function
      return Promise.resolve((): void => {})
    })

    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 's1',
      sessions: [
        {
          id: 's1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: 'REPLAY',
            replay_end_offset: BigInt(6),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )

    // Wait for restore to complete (loading → false).
    await waitFor(() => expect(result.current.loading).toBe(false))

    // SIMULATE THE BUG WINDOW: events arrive AFTER listSessions/setLoading
    // (state has updated, render scheduled) but BEFORE the pane subscribes.
    // Previously stopBuffering() fired right after setLoading and these
    // events were dropped.
    dataCallback('s1', 'POST_RENDER_1', 200, 13)
    dataCallback('s1', 'POST_RENDER_2', 220, 13)

    // Now simulate the pane reporting ready. Capture the events the
    // orchestrator drains through our handler.
    const drained: { data: string; offsetStart: number; byteLen: number }[] = []
    act(() => {
      result.current.notifyPaneReady('s1', (data, offsetStart, byteLen) => {
        drained.push({ data, offsetStart, byteLen })
      })
    })

    // Both post-setLoading events must be drained — they would have been
    // lost before this fix.
    expect(drained).toEqual([
      { data: 'POST_RENDER_1', offsetStart: 200, byteLen: 13 },
      { data: 'POST_RENDER_2', offsetStart: 220, byteLen: 13 },
    ])
  })

  // F1 (round 2): the global buffering listener is permanent for the
  // lifetime of useSessionManager — sessions created after restore via
  // createSession also need the buffer→drain protocol so their early
  // pty-data isn't lost while waiting for useTerminal to subscribe.
  // Tearing it down once restored panes were ready left fresh tabs blank.
  test('F1 (round 2): buffering listener stays attached after all restored panes report ready', async () => {
    const service = createMockService()
    const stopBufferingSpy = vi.fn()
    service.onData = vi.fn(
      (): Promise<() => void> => Promise.resolve(stopBufferingSpy)
    )

    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'a',
      sessions: [
        {
          id: 'a',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'b',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 2,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    // All restored panes report ready — the listener must remain alive so
    // sessions spawned later also benefit from buffer→drain.
    act(() => {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      result.current.notifyPaneReady('a', () => {})
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      result.current.notifyPaneReady('b', () => {})
    })

    expect(stopBufferingSpy).not.toHaveBeenCalled()
  })

  // F1 (round 2) regression: a session created via createSession AFTER the
  // initial restore must still get its early pty-data delivered. Before this
  // fix, the buffering listener was torn down once every restored pane was
  // ready, so events emitted between createSession's spawn() and the new
  // pane's useTerminal subscription were lost — fresh tabs came up blank
  // until the shell produced more output.
  test('F1 (round 2): events for sessions created after restore are buffered and drained on notifyPaneReady', async () => {
    const service = createMockService()
    let dataCallback: (
      sessionId: string,
      data: string,
      offsetStart: number,
      byteLen: number
    ) => void = vi.fn()
    service.onData = vi.fn((cb): Promise<() => void> => {
      dataCallback = cb

      // eslint-disable-next-line @typescript-eslint/no-empty-function
      return Promise.resolve((): void => {})
    })

    // Restore returns no sessions — clean startup.
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: null,
      sessions: [],
    })

    service.spawn = vi
      .fn()
      .mockResolvedValue({ sessionId: 'fresh-tab', pid: 777 })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Create a fresh tab AFTER restore completes.
    act(() => result.current.createSession())
    await waitFor(() => expect(service.spawn).toHaveBeenCalled())
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))

    // Simulate Rust emitting the shell's startup prompt for the new session
    // BEFORE useTerminal has subscribed. Without the permanent listener this
    // would land nowhere and be silently dropped.
    dataCallback('fresh-tab', '$ ', 0, 2)
    dataCallback('fresh-tab', 'welcome\r\n', 2, 9)

    // Pane subscribes — the buffered events must drain through our handler.
    const drained: { data: string; offsetStart: number; byteLen: number }[] = []
    act(() => {
      result.current.notifyPaneReady(
        'fresh-tab',
        (data, offsetStart, byteLen) => {
          drained.push({ data, offsetStart, byteLen })
        }
      )
    })

    expect(drained).toEqual([
      { data: '$ ', offsetStart: 0, byteLen: 2 },
      { data: 'welcome\r\n', offsetStart: 2, byteLen: 9 },
    ])
  })

  // After a pane reports ready, its events should NOT continue to accumulate
  // in the orchestrator's buffer — the per-pane onData subscription handles
  // them directly. Without dropping ready-pane events the global listener
  // would leak memory across the hook's lifetime.
  test('F1 (round 2): events for sessions whose panes already reported ready are dropped (no buffer leak)', async () => {
    const service = createMockService()
    let dataCallback: (
      sessionId: string,
      data: string,
      offsetStart: number,
      byteLen: number
    ) => void = vi.fn()
    service.onData = vi.fn((cb): Promise<() => void> => {
      dataCallback = cb

      // eslint-disable-next-line @typescript-eslint/no-empty-function
      return Promise.resolve((): void => {})
    })

    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'live',
      sessions: [
        {
          id: 'live',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    const drained: { data: string; offsetStart: number; byteLen: number }[] = []
    act(() => {
      result.current.notifyPaneReady('live', (data, offsetStart, byteLen) => {
        drained.push({ data, offsetStart, byteLen })
      })
    })
    expect(drained).toEqual([])

    // Subsequent events for this session (after notifyPaneReady) are routed
    // through the per-pane listener, NOT the orchestrator's buffer. If the
    // orchestrator's buffer were still capturing, a later notifyPaneReady
    // call would re-deliver the same payload — driving doubled bytes and
    // unbounded memory growth.
    dataCallback('live', 'POST_READY', 100, 10)

    const drainedAgain: {
      data: string
      offsetStart: number
      byteLen: number
    }[] = []
    act(() => {
      result.current.notifyPaneReady('live', (data, offsetStart, byteLen) => {
        drainedAgain.push({ data, offsetStart, byteLen })
      })
    })

    expect(drainedAgain).toEqual([])
  })

  // F3 (round 2): two rapid createSession() calls before either spawn()
  // resolves must produce a persisted order that includes BOTH new tab ids.
  // The previous code closed over the render-time `sessions` array; the
  // second async closure therefore omitted the first new tab, and the cache
  // persisted an order that no longer matched the live tab strip after
  // reload (or rejected as a non-permutation).
  //
  // PR #290: persistence moved from `reorder_sessions` to the grouping
  // snapshot push; the F3 invariant is unchanged but the assertion shape
  // updates accordingly.
  test('F3 (round 2): two rapid createSession calls persist both new tabs in the workspace snapshot', async () => {
    const service = createMockService()
    service.listSessions = vi
      .fn()
      .mockResolvedValue({ activeSessionId: null, sessions: [] })

    let resolveSpawn1: (v: { sessionId: string; pid: number }) => void = vi.fn()
    let resolveSpawn2: (v: { sessionId: string; pid: number }) => void = vi.fn()

    service.spawn = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSpawn1 = resolve
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSpawn2 = resolve
          })
      )

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Fire both createSession calls before either spawn resolves. With the
    // old code, both async closures captured the same empty `sessions`
    // array — the second closure would build `[id2]` instead of `[id2, id1]`.
    act(() => {
      result.current.createSession()
      result.current.createSession()
    })

    await waitFor(() => expect(service.spawn).toHaveBeenCalledTimes(2))

    // Resolve them in order. The state should now reflect both tabs.
    await act(async () => {
      resolveSpawn1({ sessionId: 'tab-1', pid: 1 })
      resolveSpawn2({ sessionId: 'tab-2', pid: 2 })
      // Yield so the resolved spawn microtasks run.
      await Promise.resolve()
    })

    await waitFor(() => expect(result.current.sessions).toHaveLength(2))

    // The latest grouping snapshot must include BOTH tab ids — not just
    // tab-2. This is the F3 invariant: the persisted order is derived from
    // the latest setSessions state, not from any closure's stale view.
    await waitFor(() => {
      const calls = vi.mocked(pushWorkspaceShape).mock.calls

      const lastPayload = calls[calls.length - 1]?.[0] as
        | { sessions: { panes: { ptyId: string }[] }[] }
        | undefined

      const ptyIds = lastPayload?.sessions.flatMap((s) =>
        s.panes.map((p) => p.ptyId)
      )
      expect(ptyIds).toEqual(['tab-1', 'tab-2'])
    })
  })

  // F2 (round 2): if the user creates a tab via createSession while the
  // mount-time restore is still in flight, the in-flight listSessions
  // snapshot was taken BEFORE the new tab existed in cache. Without
  // merging, the restore effect's wholesale `setSessions(snapshot)` blew
  // the optimistically-created tab out of React state until the next
  // reload (the live PTY/cache entry kept running in Rust).
  test('F2 (round 2): createSession during loading is preserved when restore resolves', async () => {
    const service = createMockService()

    // Hold listSessions until we explicitly resolve it — simulates a slow
    // mount-time restore so the test can interleave createSession.
    let resolveListSessions: (v: SessionList) => void = vi.fn()
    service.listSessions = vi.fn(
      () =>
        new Promise<SessionList>((resolve) => {
          resolveListSessions = resolve
        })
    )

    service.spawn = vi
      .fn()
      .mockResolvedValue({ sessionId: 'in-flight-tab', pid: 555 })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )

    // While restore is still loading, the user clicks +
    act(() => result.current.createSession())
    await waitFor(() => expect(service.spawn).toHaveBeenCalled())
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))
    expect(result.current.sessions[0].panes[0].ptyId).toBe('in-flight-tab')

    const createdSessionId = result.current.sessions.find((s) =>
      s.panes.some((pane) => pane.ptyId === 'in-flight-tab')
    )?.id
    expect(result.current.activeSessionId).toBe(createdSessionId)

    // Now the restore IPC resolves with a snapshot taken BEFORE the new tab
    // was added to the cache (it only contains a previously-existing tab).
    resolveListSessions({
      activeSessionId: 'cached-tab',
      sessions: [
        {
          id: 'cached-tab',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    // BOTH sessions must be present after restore resolves — the in-flight
    // tab must NOT be wiped out by the snapshot. Restored tabs keep their
    // cache order, then the in-flight creation lands at the bottom.
    const ptyIds = result.current.sessions.map((s) => s.panes[0].ptyId)
    expect(ptyIds).toEqual(['cached-tab', 'in-flight-tab'])

    // Active id stays on the user's most recent intent (the in-flight tab),
    // not the cached id. createSession's optimistic active update wins.
    expect(result.current.activeSessionId).toBe(createdSessionId)
  })

  // Round 4, Finding 1 (codex P1) regression test.
  //
  // Before the fix, `useSessionManager`'s default arg
  // `service = createTerminalService()` re-evaluated every render. In the
  // browser/Vite/test workflow that returned a fresh `MockTerminalService`
  // each time, so the manager and any per-pane fallback service ended up
  // talking to disjoint backends — tabs spawned by the manager were never
  // observable on the pane's service and close/restart silently no-op'd.
  //
  // The contract is now: a SINGLE service instance must be passed in and
  // every IPC the manager fires (spawn, kill, setActiveSession,
  // reorderSessions) MUST land on that exact instance. This test fakes the
  // "shared service handed to both the manager and a downstream consumer"
  // pattern by capturing call counts on the same vi.fn instances and
  // asserting createSession's spawn lands on them — i.e. the manager does
  // NOT create its own backend behind the scenes.
  test('round 4 F1: createSession routes IPC to the EXACT service passed in', async () => {
    const sharedService = createMockService()
    sharedService.spawn = vi
      .fn()
      .mockResolvedValue({ sessionId: 'spawned', pid: 100 })

    const { result } = renderHook(() => useSessionManager(sharedService))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.createSession())

    // The manager fires spawn on the SHARED instance — not a hidden
    // per-render `createTerminalService()` mock. Asserting on the exact
    // function reference (`sharedService.spawn`) catches the disjoint-
    // backend bug: a fresh service from a re-evaluated default arg would
    // have its OWN spawn fn, leaving sharedService.spawn untouched.
    await waitFor(() => expect(sharedService.spawn).toHaveBeenCalled())
    expect(sharedService.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '~' })
    )

    // setActiveSession + setWorkspaceSessions also hit the shared instance
    // — catches a partial regression where only spawn was wired through.
    // (Pre PR #290 this checked reorderSessions; cache order persistence
    // moved to the grouping snapshot push, see PR #290 review.)
    await waitFor(() =>
      expect(sharedService.setActiveSession).toHaveBeenCalledWith('spawned')
    )

    await waitFor(() => expect(pushWorkspaceShape).toHaveBeenCalled())
  })

  // Re-renders MUST NOT swap the backend. Without the round-4 fix, the
  // default-arg `createTerminalService()` gave each render a new mock and
  // the second-render hook talked to a different backend than the first.
  // We assert the same service instance is observed across re-renders by
  // verifying that re-rendering does not cause an additional listSessions
  // call on a DIFFERENT mock — and that subsequent IPC routes through the
  // original.
  test('round 4 F1: re-rendering useSessionManager keeps using the same service', async () => {
    const sharedService = createMockService()
    sharedService.spawn = vi
      .fn()
      .mockResolvedValue({ sessionId: 'after-rerender', pid: 9 })

    const { result, rerender } = renderHook(() =>
      useSessionManager(sharedService)
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    const initialListCallCount = (
      sharedService.listSessions as ReturnType<typeof vi.fn>
    ).mock.calls.length

    // Rerender the hook with the same service — must not trigger a fresh
    // mount-time restore on a different backend.
    rerender()
    rerender()

    expect(
      (sharedService.listSessions as ReturnType<typeof vi.fn>).mock.calls.length
    ).toBe(initialListCallCount)

    act(() => result.current.createSession())
    await waitFor(() => expect(sharedService.spawn).toHaveBeenCalled())
  })

  // Round 7, Finding 2 (claude MEDIUM) regression test.
  //
  // The cleanup function returned by notifyPaneReady used to be a no-op.
  // When a pane unmounted (StrictMode dev double-mount, error-boundary
  // reset, route change), cleanup ran but the sessionId stayed in
  // readyPanesRef. The global buffering listener saw the still-ready
  // entry and DROPPED subsequent pty-data events for that session — they
  // landed in neither the buffer nor a pane subscription. When the pane
  // remounted, it called notifyPaneReady again and tried to drain
  // bufferedRef, but the events from the unmount→remount window were
  // dropped, not buffered. Silent output loss.
  //
  // The fix: cleanup must remove the session from readyPanesRef, re-add
  // it to pendingPanesRef, and seed an empty buffer so the next pty-data
  // event accumulates.
  test('round 7 F2: notifyPaneReady cleanup re-arms buffering for pane remount', async () => {
    const service = createMockService()
    let dataCallback: (
      sessionId: string,
      data: string,
      offsetStart: number,
      byteLen: number
    ) => void = vi.fn()
    service.onData = vi.fn((cb): Promise<() => void> => {
      dataCallback = cb

      // eslint-disable-next-line @typescript-eslint/no-empty-function
      return Promise.resolve((): void => {})
    })

    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 's1',
      sessions: [
        {
          id: 's1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    // First mount: pane reports ready.
    let cleanup: (() => void) | null = null
    act(() => {
      cleanup = result.current.notifyPaneReady('s1', () => {
        // first-mount handler — irrelevant to this test
      })
    })
    expect(cleanup).not.toBeNull()

    // Pane unmounts: cleanup must re-arm buffering. Without the fix, this
    // is a no-op and 's1' stays in readyPanesRef.
    act(() => {
      ;(cleanup as () => void)()
    })

    // Event arrives during the unmount → remount window. Under the old
    // no-op cleanup, the global listener still saw 's1' as ready and
    // dropped the event. Under the fix, it lands in the buffer.
    dataCallback('s1', 'BETWEEN_MOUNTS', 50, 14)

    // Pane remounts: notifyPaneReady should drain the buffered event
    // through the new handler.
    const drained: { data: string; offsetStart: number; byteLen: number }[] = []
    act(() => {
      result.current.notifyPaneReady('s1', (data, offsetStart, byteLen) => {
        drained.push({ data, offsetStart, byteLen })
      })
    })

    // Without the fix this would be empty (event dropped during unmount
    // window). With the fix, the event lands in the per-session buffer
    // and is drained on remount.
    expect(drained).toEqual([
      { data: 'BETWEEN_MOUNTS', offsetStart: 50, byteLen: 14 },
    ])
  })

  // Round 8, Finding 2 (claude MEDIUM) regression test.
  //
  // `removeSession` deletes the session from `pendingPanesRef`,
  // `readyPanesRef`, `bufferedRef`, AND `restoreData` BEFORE the
  // setSessions() it triggers re-renders and unmounts the TerminalPane.
  // The pane's useTerminal data-subscribe cleanup then calls the
  // `releasePaneReady` callback returned by notifyPaneReady — which under
  // round 7's fix unconditionally re-added `sessionId` to `pendingPanesRef`
  // and re-created `bufferedRef.set(sessionId, [])`. That re-arm was wrong
  // after removeSession: it polluted the orchestrator's per-session
  // bookkeeping for tabs the user just closed, and any pty-data event
  // racing the async kill_pty would land in the freshly re-created buffer
  // with no consumer (no pane will ever call notifyPaneReady again for
  // that id), leaking state per removed session.
  //
  // The fix gates the re-arm on `restoreData.has(sessionId)`. removeSession
  // calls `restoreData.delete(id)` synchronously BEFORE the setSessions
  // that triggers the unmount, so by the time this cleanup runs the Map
  // no longer contains the entry. The early-return path means the cleanup
  // becomes a true no-op for removed sessions while keeping the round 7
  // F2 remount-drain semantics intact (restoreData survives StrictMode /
  // error-boundary remounts).
  //
  // What we observe:
  //   1. Round 7 F2 baseline: after notifyPaneReady → cleanup → pty-data →
  //      remount-notifyPaneReady, the second notifyPaneReady DOES drain
  //      the buffered event (cleanup re-armed). That's the correct path
  //      when the session is still alive (restoreData has it).
  //   2. Round 8 inversion: after notifyPaneReady → removeSession →
  //      cleanup, the cleanup must NOT re-arm. We detect re-arm by firing
  //      a SUBSEQUENT cleanup (no-op if guard is correct) and then a
  //      fresh notifyPaneReady-drain — under the bug this would still
  //      have the leaked state from the first cleanup; under the fix the
  //      whole sequence is idempotent.
  test('round 8 F2: notifyPaneReady cleanup does NOT re-arm after removeSession', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 's1',
      sessions: [
        {
          id: 's1',
          cwd: '/tmp',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Pane reports ready — same as the round 7 F2 setup.
    let cleanup: (() => void) | null = null
    act(() => {
      cleanup = result.current.notifyPaneReady('s1', () => {
        // first-mount handler — irrelevant to this test
      })
    })
    expect(cleanup).not.toBeNull()
    expect(result.current.restoreData.has('s1')).toBe(true)

    // User closes the tab. removeSession is async (awaits service.kill);
    // we need to let the microtask after kill resolve so the synchronous
    // teardown of pendingPanesRef / readyPanesRef / bufferedRef / restoreData
    // (which happens AFTER the awaited kill) actually runs before we trigger
    // the unmount-cleanup.
    await act(async () => {
      result.current.removeSession('s1')
      // Flush the kill resolution so the post-await teardown runs.
      await Promise.resolve()
    })

    await waitFor(() =>
      expect(result.current.restoreData.has('s1')).toBe(false)
    )

    // Pane unmount cleanup fires AFTER removeSession's synchronous teardown.
    // Under the bug, this re-added 's1' to pendingPanesRef and recreated
    // bufferedRef.set('s1', []). Under the fix, the early-return guard
    // makes it a no-op because restoreData no longer has the entry.
    //
    // The cleanup is idempotent under the fix: calling it again is safe.
    // Under the bug, the re-arm would have introduced new state, and a
    // second cleanup would attempt a redundant re-add.
    act(() => {
      ;(cleanup as () => void)()
    })

    // No exception, no leakage observable through the public API. The
    // strongest assertion we can make at the public boundary is that
    // restoreData stays empty — the bug's re-arm doesn't touch
    // restoreData, so this only confirms removeSession's teardown held;
    // the deeper invariant (pendingPanesRef.has('s1') === false,
    // bufferedRef.has('s1') === false) is verified by code inspection
    // of the early-return guard in the cleanup callback.
    expect(result.current.restoreData.has('s1')).toBe(false)

    // Idempotency check: a second cleanup call must also be a no-op.
    // Under the bug, this would re-add to pendingPanesRef again
    // (idempotent on Set, but the intent is wrong). Under the fix, the
    // restoreData guard prevents both calls from doing anything.
    act(() => {
      ;(cleanup as () => void)()
    })
    expect(result.current.restoreData.has('s1')).toBe(false)
  })

  test('pane-keyed createSession produces fresh React id and pane ptyId', async () => {
    const service = createMockService()
    service.spawn = vi
      .fn()
      .mockResolvedValue({ sessionId: 'pty-new', pid: 99, cwd: '/x' })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.createSession())

    await waitFor(() => expect(result.current.sessions).toHaveLength(1))
    const created = result.current.sessions[0]

    expect(created.id).not.toBe('pty-new')
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(created.panes).toHaveLength(1)
    expect(created.panes[0].ptyId).toBe('pty-new')
    expect(created.panes[0].id).toBe('p0')
    expect(created.panes[0].active).toBe(true)
    expect(created.layout).toBe('single')
    expect(created.workingDirectory).toBe('/x')
    expect(created.agentType).toBe('generic')
  })

  test('pane-keyed restartSession preserves Session.id and rotates pane ptyId', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'pty-old',
      sessions: [
        {
          id: 'pty-old',
          cwd: '/x',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    service.spawn = vi
      .fn()
      .mockResolvedValue({ sessionId: 'pty-new', pid: 2, cwd: '/x' })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    const sessionIdBefore = result.current.sessions[0].id

    act(() => result.current.restartSession(sessionIdBefore))

    await waitFor(() =>
      expect(result.current.sessions[0].panes[0].ptyId).toBe('pty-new')
    )
    const restarted = result.current.sessions[0]

    expect(restarted.id).toBe(sessionIdBefore)
    expect(restarted.panes[0].id).toBe('p0')
    expect(restarted.panes[0].status).toBe('running')
    expect(restarted.panes[0].agentType).toBe('generic')
  })

  test('pane-keyed restartSession targets the requested inactive pane', async () => {
    vi.mocked(loadWorkspaceForRestore).mockResolvedValueOnce({
      sessions: [
        {
          id: 'ws-shell',
          projectId: 'proj-1',
          layout: 'horizontal',
          workingDirectory: '/active',
          active: true,
          open: true,
          panes: [
            {
              kind: 'shell',
              paneId: 'p0',
              paneIndex: 0,
              active: true,
              ptyId: 'pty-active',
              cwd: '/active',
              agentType: 'codex',
              agentSessionId: null,
            },
            {
              kind: 'shell',
              paneId: 'p1',
              paneIndex: 1,
              active: false,
              ptyId: 'pty-side',
              cwd: '/side',
              agentType: 'claude-code',
              agentSessionId: null,
            },
          ],
        },
      ],
    })

    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'pty-active',
      sessions: [
        {
          id: 'pty-active',
          cwd: '/active',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
        {
          id: 'pty-side',
          cwd: '/side',
          status: {
            kind: 'Exited',
            exit_code: 0,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    service.spawn = vi.fn().mockResolvedValue({
      sessionId: 'pty-side-new',
      pid: 2,
      cwd: '/side',
      shell: '/bin/zsh',
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))

    act(() => result.current.restartSession('ws-shell', 'p1'))

    await waitFor(() =>
      expect(
        result.current.sessions[0].panes.find((pane) => pane.id === 'p1')?.ptyId
      ).toBe('pty-side-new')
    )

    expect(service.spawn).toHaveBeenCalledWith({
      cwd: '/side',
      env: {},
      enableAgentBridge: true,
    })
    expect(service.kill).toHaveBeenCalledWith({ sessionId: 'pty-side' })
    expect(
      result.current.sessions[0].panes.find((pane) => pane.id === 'p0')?.ptyId
    ).toBe('pty-active')
    expect(result.current.sessions[0].workingDirectory).toBe('/active')
    expect(result.current.sessions[0].agentType).toBe('codex')
  })

  test('pane-keyed removeSession leaves session visible when pane kill fails', async () => {
    const service = createMockService()
    service.kill = vi.fn().mockRejectedValue(new Error('KillFailed'))
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'pty-1',
      sessions: [
        {
          id: 'pty-1',
          cwd: '/x',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined)

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    const sessionId = result.current.sessions[0].id

    act(() => result.current.removeSession(sessionId))

    await waitFor(() => expect(service.kill).toHaveBeenCalled())
    expect(result.current.sessions).toHaveLength(1)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('removeSession: kill failed for a pane'),
      expect.any(Error)
    )
    warnSpy.mockRestore()
  })

  test('updatePaneCwd updates pane cwd without changing session cwd', async () => {
    const service = createMockService()
    service.listSessions = vi.fn().mockResolvedValue({
      activeSessionId: 'pty-1',
      sessions: [
        {
          id: 'pty-1',
          cwd: '/old',
          status: {
            kind: 'Alive',
            pid: 1,
            replay_data: '',
            replay_end_offset: BigInt(0),
          },
        },
      ],
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    const sessionId = result.current.sessions[0].id

    act(() => {
      result.current.updatePaneCwd(sessionId, 'p0', '/new/cwd')
    })

    const updated = result.current.sessions[0]
    expect(updated.panes[0].cwd).toBe('/new/cwd')
    expect(updated.workingDirectory).toBe('/old')
    expect(service.updateSessionCwd).toHaveBeenCalledWith('pty-1', '/new/cwd')
  })

  test('setSessionActivityPanelCollapsed updates session state and persists to localStorage', async () => {
    const service = createMockService()
    service.spawn = vi.fn().mockResolvedValue({
      sessionId: 'pty-1',
      pid: 123,
      cwd: '/home/user',
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.createSession())
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))

    const sessionId = result.current.sessions[0].id
    expect(result.current.sessions[0].activityPanelCollapsed).toBe(false)

    act(() => {
      result.current.setSessionActivityPanelCollapsed(sessionId, true)
    })

    expect(result.current.sessions[0].activityPanelCollapsed).toBe(true)
    expect(readActivityPanelCollapsed(sessionId)).toBe(true)
    // UI-only state — must NOT flow through the agent/PTY backend.
    expect(service.setSessionActivityPanelCollapsed).not.toHaveBeenCalled()
  })

  test('setSessionActivityPanelCollapsed is a no-op when value is unchanged', async () => {
    const service = createMockService()
    service.spawn = vi.fn().mockResolvedValue({
      sessionId: 'pty-1',
      pid: 123,
      cwd: '/home/user',
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.createSession())
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))

    const sessionId = result.current.sessions[0].id
    const snapshot = result.current.sessions[0]

    act(() => {
      result.current.setSessionActivityPanelCollapsed(sessionId, false)
    })

    // Same boolean → object identity preserved; no re-render churn.
    expect(result.current.sessions[0]).toBe(snapshot)
  })

  test('setSessionActivityPanelCollapsed silently ignores unknown session ids', async () => {
    const service = createMockService()
    service.spawn = vi.fn().mockResolvedValue({
      sessionId: 'pty-1',
      pid: 123,
      cwd: '/home/user',
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.setSessionActivityPanelCollapsed('does-not-exist', true)
    })
    expect(result.current.sessions).toHaveLength(0)
  })

  describe('setSessionLayout', () => {
    test('updates session.layout when target session exists and layout differs', async () => {
      const service = createMockService()
      service.listSessions = vi.fn().mockResolvedValue({
        activeSessionId: 'pty-1',
        sessions: [
          {
            id: 'pty-1',
            cwd: '/tmp',
            status: {
              kind: 'Alive',
              pid: 1,
              replay_data: '',
              replay_end_offset: BigInt(0),
            },
          },
        ],
      })

      const { result } = renderHook(() =>
        useSessionManager(service, { autoCreateOnEmpty: false })
      )
      await waitFor(() => expect(result.current.loading).toBe(false))
      const sessionId = result.current.sessions[0].id

      act(() => result.current.setSessionLayout(sessionId, 'vsplit'))

      expect(result.current.sessions[0].layout).toBe('vsplit')
      expect(result.current.sessions[0].panes).toHaveLength(1)
    })

    test('returns same sessions array reference when layout is unchanged', async () => {
      const service = createMockService()
      service.listSessions = vi.fn().mockResolvedValue({
        activeSessionId: 'pty-1',
        sessions: [
          {
            id: 'pty-1',
            cwd: '/tmp',
            status: {
              kind: 'Alive',
              pid: 1,
              replay_data: '',
              replay_end_offset: BigInt(0),
            },
          },
        ],
      })

      const { result } = renderHook(() =>
        useSessionManager(service, { autoCreateOnEmpty: false })
      )
      await waitFor(() => expect(result.current.loading).toBe(false))
      const sessionId = result.current.sessions[0].id
      const before = result.current.sessions

      act(() => result.current.setSessionLayout(sessionId, before[0].layout))

      expect(result.current.sessions).toBe(before)
    })

    test('warns and no-ops when sessionId is missing', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const service = createMockService()

      const { result } = renderHook(() =>
        useSessionManager(service, { autoCreateOnEmpty: false })
      )
      await waitFor(() => expect(result.current.loading).toBe(false))

      const before = result.current.sessions

      act(() => result.current.setSessionLayout('does-not-exist', 'vsplit'))

      expect(result.current.sessions).toBe(before)
      expect(warn).toHaveBeenCalledWith(
        '[vimeflow:sessions] setSessionLayout: no session does-not-exist'
      )
      warn.mockRestore()
    })
  })

  describe('setSessionActivePane (manager integration)', () => {
    test('returns same sessions reference when target pane is already active', async () => {
      const service = createMockService()
      service.listSessions = vi.fn().mockResolvedValue({
        activeSessionId: 'pty-1',
        sessions: [
          {
            id: 'pty-1',
            cwd: '/tmp',
            status: {
              kind: 'Alive',
              pid: 1,
              replay_data: '',
              replay_end_offset: BigInt(0),
            },
          },
        ],
      })

      const { result } = renderHook(() =>
        useSessionManager(service, { autoCreateOnEmpty: false })
      )
      await waitFor(() => expect(result.current.loading).toBe(false))
      const sessionId = result.current.sessions[0].id
      const before = result.current.sessions

      act(() => result.current.setSessionActivePane(sessionId, 'p0'))

      expect(result.current.sessions).toBe(before)
    })

    test('warns when sessionId is missing', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const service = createMockService()

      const { result } = renderHook(() =>
        useSessionManager(service, { autoCreateOnEmpty: false })
      )
      await waitFor(() => expect(result.current.loading).toBe(false))

      act(() => result.current.setSessionActivePane('no-such-session', 'p0'))

      expect(warn).toHaveBeenCalledWith(
        '[vimeflow:sessions] setSessionActivePane: no session no-such-session'
      )
      warn.mockRestore()
    })

    test('warns when paneId is missing within the session', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const service = createMockService()

      const { result } = renderHook(() =>
        useSessionManager(service, { autoCreateOnEmpty: false })
      )
      await waitFor(() => expect(result.current.loading).toBe(false))

      // createSession spawns a single-pane session via the mock. Calling
      // setSessionActivePane against a pane id that doesn't exist on
      // it exercises the second guard branch the manager added in cycle 14.
      act(() => result.current.createSession())
      await waitFor(() => expect(result.current.sessions.length).toBe(1))
      const sessionId = result.current.sessions[0].id
      const before = result.current.sessions
      warn.mockClear() // drop the createSession-side reorder warn noise

      act(() => result.current.setSessionActivePane(sessionId, 'ghost-pane'))

      expect(result.current.sessions).toBe(before)
      expect(warn).toHaveBeenCalledWith(
        `[vimeflow:sessions] setSessionActivePane: no pane ghost-pane in session ${sessionId}`
      )
      warn.mockRestore()
    })
  })

  describe('pane lifecycle mutations', () => {
    const createSequentialSpawnService = (
      resolvedCwds: readonly string[] = ['/workspace', '/workspace', '/other']
    ): ITerminalService => {
      const service = createMockService()
      let spawnIndex = 0

      service.spawn = vi.fn(
        (params: Parameters<ITerminalService['spawn']>[0]) => {
          void params

          const index = spawnIndex
          spawnIndex += 1

          return Promise.resolve({
            sessionId: `pty-${index}`,
            pid: 100 + index,
            cwd: resolvedCwds[index] ?? `/workspace-${index}`,
            shell: '/bin/zsh',
          })
        }
      )

      return service
    }

    const createInitialSession = async (result: {
      current: ReturnType<typeof useSessionManager>
    }): Promise<string> => {
      act(() => result.current.createSession())

      await waitFor(() => expect(result.current.sessions).toHaveLength(1))

      return result.current.sessions[0].id
    }

    const addSecondPane = async (
      result: { current: ReturnType<typeof useSessionManager> },
      sessionId: string
    ): Promise<void> => {
      act(() => result.current.setSessionLayout(sessionId, 'vsplit'))
      act(() => result.current.addPane(sessionId))

      await waitFor(() => {
        const session = result.current.sessions.find((s) => s.id === sessionId)
        expect(session?.panes).toHaveLength(2)
      })
    }

    test('setCustomPaneLayouts installs accepted workspace layouts', async () => {
      const service = createSequentialSpawnService()
      const customLayout = customGrid2x2()

      const { result } = renderHook(() =>
        useSessionManager(service, { autoCreateOnEmpty: false })
      )
      await waitFor(() => expect(result.current.loading).toBe(false))

      act(() => result.current.setCustomPaneLayouts([customLayout]))

      expect(result.current.customPaneLayouts).toEqual([customLayout])
      expect(
        result.current.layoutRegistry.getLayout('custom:grid-2x2')
      ).toMatchObject({
        id: 'custom:grid-2x2',
        capacity: 4,
        name: 'Custom grid 2x2',
      })
    })

    test('setCustomPaneLayouts drops definitions rejected by the registry', async () => {
      const service = createSequentialSpawnService()
      const customLayout = customGrid2x2()

      const { result } = renderHook(() =>
        useSessionManager(service, { autoCreateOnEmpty: false })
      )
      await waitFor(() => expect(result.current.loading).toBe(false))

      act(() =>
        result.current.setCustomPaneLayouts([
          customLayout,
          shadowSingleCustomLayout(),
        ])
      )

      expect(
        result.current.customPaneLayouts.map((layout) => layout.id)
      ).toEqual(['custom:grid-2x2'])

      expect(
        result.current.layoutRegistry.getLayout('custom:grid-2x2')
      ).not.toBeNull()
    })

    test('removing a custom layout falls affected sessions back to a fitting builtin layout', async () => {
      const service = createSequentialSpawnService()
      const customLayout = customGrid2x2()

      const { result } = renderHook(() =>
        useSessionManager(service, { autoCreateOnEmpty: false })
      )
      await waitFor(() => expect(result.current.loading).toBe(false))

      const sessionId = await createInitialSession(result)
      await addSecondPane(result, sessionId)

      act(() => result.current.setCustomPaneLayouts([customLayout]))
      act(() => result.current.setSessionLayout(sessionId, 'custom:grid-2x2'))

      expect(result.current.sessions[0].layout).toBe('custom:grid-2x2')

      act(() => result.current.setCustomPaneLayouts([]))

      expect(result.current.customPaneLayouts).toEqual([])
      expect(result.current.sessions[0].layout).toBe('vsplit')
    })

    test('removing an over-capacity custom layout preserves it while sessions depend on it', async () => {
      const service = createSequentialSpawnService()
      const largeLayout = customGrid4x2()

      const { result } = renderHook(() =>
        useSessionManager(service, { autoCreateOnEmpty: false })
      )
      await waitFor(() => expect(result.current.loading).toBe(false))

      const sessionId = await createInitialSession(result)

      act(() => result.current.setCustomPaneLayouts([largeLayout]))
      act(() => result.current.setSessionLayout(sessionId, 'custom:grid-4x2'))

      for (let target = 2; target <= 8; target += 1) {
        act(() => result.current.addPane(sessionId))
        await waitFor(() => {
          const session = result.current.sessions.find(
            (s) => s.id === sessionId
          )
          expect(session?.panes).toHaveLength(target)
        })
      }

      act(() => result.current.setCustomPaneLayouts([]))

      expect(
        result.current.customPaneLayouts.map((layout) => layout.id)
      ).toEqual(['custom:grid-4x2'])
      expect(result.current.sessions[0].layout).toBe('custom:grid-4x2')
    })

    test('rejected replacement for an over-capacity custom layout preserves the old definition', async () => {
      const service = createSequentialSpawnService()
      const largeLayout = customGrid4x2()

      const { result } = renderHook(() =>
        useSessionManager(service, { autoCreateOnEmpty: false })
      )
      await waitFor(() => expect(result.current.loading).toBe(false))

      const sessionId = await createInitialSession(result)

      act(() => result.current.setCustomPaneLayouts([largeLayout]))
      act(() => result.current.setSessionLayout(sessionId, 'custom:grid-4x2'))

      for (let target = 2; target <= 8; target += 1) {
        act(() => result.current.addPane(sessionId))
        await waitFor(() => {
          const session = result.current.sessions.find(
            (s) => s.id === sessionId
          )
          expect(session?.panes).toHaveLength(target)
        })
      }

      const rejectedReplacement: PaneLayoutDefinition = {
        ...largeLayout,
        title: '',
      }

      act(() => result.current.setCustomPaneLayouts([rejectedReplacement]))

      expect(
        result.current.customPaneLayouts.map((layout) => layout.id)
      ).toEqual(['custom:grid-4x2'])
      expect(result.current.sessions[0].layout).toBe('custom:grid-4x2')
    })

    test('under-capacity replacement for an over-capacity custom layout preserves the old definition', async () => {
      const service = createSequentialSpawnService()
      const largeLayout = customGrid4x2()
      const smallLayout = customGrid2x2()

      const { result } = renderHook(() =>
        useSessionManager(service, { autoCreateOnEmpty: false })
      )
      await waitFor(() => expect(result.current.loading).toBe(false))

      const sessionId = await createInitialSession(result)

      act(() => result.current.setCustomPaneLayouts([largeLayout]))
      act(() => result.current.setSessionLayout(sessionId, 'custom:grid-4x2'))

      for (let target = 2; target <= 8; target += 1) {
        act(() => result.current.addPane(sessionId))
        await waitFor(() => {
          const session = result.current.sessions.find(
            (s) => s.id === sessionId
          )
          expect(session?.panes).toHaveLength(target)
        })
      }

      const smallReplacement: PaneLayoutDefinition = {
        ...smallLayout,
        id: 'custom:grid-4x2',
      }

      act(() => result.current.setCustomPaneLayouts([smallReplacement]))

      expect(
        result.current.customPaneLayouts.map((layout) => layout.id)
      ).toEqual(['custom:grid-4x2'])
      expect(result.current.sessions[0].layout).toBe('custom:grid-4x2')
    })

    test('skipPreservation removes an over-capacity custom layout and migrates the session', async () => {
      const service = createSequentialSpawnService()
      const largeLayout = customGrid4x2()

      const { result } = renderHook(() =>
        useSessionManager(service, { autoCreateOnEmpty: false })
      )
      await waitFor(() => expect(result.current.loading).toBe(false))

      const sessionId = await createInitialSession(result)

      act(() => result.current.setCustomPaneLayouts([largeLayout]))
      act(() => result.current.setSessionLayout(sessionId, 'custom:grid-4x2'))

      for (let target = 2; target <= 8; target += 1) {
        act(() => result.current.addPane(sessionId))
        await waitFor(() => {
          const session = result.current.sessions.find(
            (s) => s.id === sessionId
          )
          expect(session?.panes).toHaveLength(target)
        })
      }

      act(() =>
        result.current.setCustomPaneLayouts([], { skipPreservation: true })
      )

      expect(result.current.customPaneLayouts).toEqual([])
      expect(result.current.sessions[0].layout).toBe('grid3x2')
    })

    test('addPane spawns in the session cwd and appends an active pane', async () => {
      const service = createSequentialSpawnService()

      const { result } = renderHook(() =>
        useSessionManager(service, { autoCreateOnEmpty: false })
      )
      await waitFor(() => expect(result.current.loading).toBe(false))

      const sessionId = await createInitialSession(result)

      ;(service.setActiveSession as ReturnType<typeof vi.fn>).mockClear()

      act(() => {
        result.current.updatePaneCwd(
          sessionId,
          'p0',
          '/workspace/.claude/worktrees/test-branch'
        )
      })

      await addSecondPane(result, sessionId)

      const session = result.current.sessions[0]
      expect(service.spawn).toHaveBeenNthCalledWith(2, {
        cwd: '/workspace',
        env: {},
        enableAgentBridge: true,
      })
      expect(session.panes).toHaveLength(2)
      expect(session.panes[0]).toMatchObject({
        id: 'p0',
        cwd: '/workspace/.claude/worktrees/test-branch',
        active: false,
      })

      expect(session.panes[1]).toMatchObject({
        id: 'p1',
        ptyId: 'pty-1',
        cwd: '/workspace',
        active: true,
      })
      expect(session.workingDirectory).toBe('/workspace')
      expect(service.setActiveSession).toHaveBeenCalledWith('pty-1')
      expect(getAllPtySessionIds()).toContain('pty-1')
    })

    test('addPane refuses to spawn when the current layout is at capacity', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const service = createSequentialSpawnService()

      const { result } = renderHook(() =>
        useSessionManager(service, { autoCreateOnEmpty: false })
      )
      await waitFor(() => expect(result.current.loading).toBe(false))

      const sessionId = await createInitialSession(result)
      ;(service.spawn as ReturnType<typeof vi.fn>).mockClear()

      act(() => result.current.addPane(sessionId))

      expect(service.spawn).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledWith(
        `[vimeflow:sessions] addPane: session ${sessionId} is at capacity for layout single`
      )
      warn.mockRestore()
    })

    test('removePane kills the pane, shrinks layout, and rotates Rust active PTY', async () => {
      const service = createSequentialSpawnService()

      const { result } = renderHook(() =>
        useSessionManager(service, { autoCreateOnEmpty: false })
      )
      await waitFor(() => expect(result.current.loading).toBe(false))

      const sessionId = await createInitialSession(result)

      await addSecondPane(result, sessionId)

      // Reset spies so the spawn-time activations don't bleed into the
      // close-side assertions below.
      ;(service.kill as ReturnType<typeof vi.fn>).mockClear()
      ;(service.setActiveSession as ReturnType<typeof vi.fn>).mockClear()

      act(() => result.current.removePane(sessionId, 'p1'))

      await waitFor(() =>
        expect(result.current.sessions[0].panes).toHaveLength(1)
      )

      const session = result.current.sessions[0]
      expect(service.kill).toHaveBeenCalledWith({ sessionId: 'pty-1' })
      expect(session.layout).toBe('single')
      expect(session.panes[0]).toMatchObject({ id: 'p0', active: true })
      expect(service.setActiveSession).toHaveBeenCalledWith('pty-0')
      expect(getAllPtySessionIds()).not.toContain('pty-1')
    })

    test('removePane deletes the cacheHistory key for the retired pty', async () => {
      window.localStorage.clear()
      const service = createSequentialSpawnService()

      const { result } = renderHook(() =>
        useSessionManager(service, { autoCreateOnEmpty: false })
      )
      await waitFor(() => expect(result.current.loading).toBe(false))

      const sessionId = await createInitialSession(result)
      await addSecondPane(result, sessionId)

      act(() => {
        result.current.appendPaneCacheReading(sessionId, 'p1', 60)
      })

      expect(
        window.localStorage.getItem('vimeflow:agent:cacheHistory:pty-1')
      ).not.toBeNull()

      act(() => result.current.removePane(sessionId, 'p1'))

      await waitFor(() =>
        expect(result.current.sessions[0].panes).toHaveLength(1)
      )

      expect(
        window.localStorage.getItem('vimeflow:agent:cacheHistory:pty-1')
      ).toBeNull()
    })

    test('removePane refuses to remove the last pane', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const service = createSequentialSpawnService()

      const { result } = renderHook(() =>
        useSessionManager(service, { autoCreateOnEmpty: false })
      )
      await waitFor(() => expect(result.current.loading).toBe(false))

      const sessionId = await createInitialSession(result)
      ;(service.kill as ReturnType<typeof vi.fn>).mockClear()

      act(() => result.current.removePane(sessionId, 'p0'))

      expect(service.kill).not.toHaveBeenCalled()
      expect(result.current.sessions[0].panes).toHaveLength(1)
      expect(warn).toHaveBeenCalledWith(
        `[vimeflow:sessions] removePane: refusing to remove the last pane in ${sessionId}; use removeSession instead`
      )
      warn.mockRestore()
    })

    test('removePane closes the last shell pane when a browser pane remains', async () => {
      const service = createSequentialSpawnService()

      const { result } = renderHook(() =>
        useSessionManager(service, { autoCreateOnEmpty: false })
      )
      await waitFor(() => expect(result.current.loading).toBe(false))

      const sessionId = await createInitialSession(result)

      act(() => result.current.setSessionLayout(sessionId, 'vsplit'))
      act(() => result.current.addPane(sessionId, 'browser'))

      await waitFor(() =>
        expect(
          result.current.sessions[0].panes.some(
            (pane) => pane.kind === 'browser'
          )
        ).toBe(true)
      )
      ;(service.kill as ReturnType<typeof vi.fn>).mockClear()

      act(() => result.current.removePane(sessionId, 'p0'))

      await waitFor(() =>
        expect(result.current.sessions[0].panes).toHaveLength(1)
      )

      const session = result.current.sessions[0]
      expect(service.kill).toHaveBeenCalledWith({ sessionId: 'pty-0' })
      expect(session.panes[0].kind).toBe('browser')
      expect(session.panes[0].active).toBe(true)
    })

    test('setSessionActivePane syncs Rust when rotating panes in the active session', async () => {
      const service = createSequentialSpawnService()

      const { result } = renderHook(() =>
        useSessionManager(service, { autoCreateOnEmpty: false })
      )
      await waitFor(() => expect(result.current.loading).toBe(false))
      const sessionId = await createInitialSession(result)
      await addSecondPane(result, sessionId)
      ;(service.setActiveSession as ReturnType<typeof vi.fn>).mockClear()

      act(() => result.current.setSessionActivePane(sessionId, 'p0'))

      expect(result.current.sessions[0].panes[0].active).toBe(true)
      expect(service.setActiveSession).toHaveBeenCalledWith('pty-0')
    })

    test('setSessionActivePane does not sync Rust for inactive sessions', async () => {
      const service = createSequentialSpawnService([
        '/workspace-a',
        '/workspace-a',
        '/workspace-b',
      ])

      const { result } = renderHook(() =>
        useSessionManager(service, { autoCreateOnEmpty: false })
      )
      await waitFor(() => expect(result.current.loading).toBe(false))
      const firstSessionId = await createInitialSession(result)
      await addSecondPane(result, firstSessionId)

      act(() => result.current.createSession())
      await waitFor(() => expect(result.current.sessions).toHaveLength(2))
      ;(service.setActiveSession as ReturnType<typeof vi.fn>).mockClear()

      act(() => result.current.setSessionActivePane(firstSessionId, 'p0'))

      const firstSession = result.current.sessions.find(
        (session) => session.id === firstSessionId
      )
      expect(firstSession?.panes[0].active).toBe(true)
      expect(service.setActiveSession).not.toHaveBeenCalled()
    })

    // Round 13, Claude MEDIUM: setSessionActivePane must serialize with
    // in-flight addPane / removePane on the same session. A pending kill
    // for the target pane can race the setActiveSession IPC and leave
    // Rust briefly pointing at a dying PTY; the cleanest fix is to make
    // focus rotation a no-op while a lifecycle op holds pendingPaneOps.
    // Round 14, Claude LOW: the guarded early-return must also warn so
    // a developer chasing a "⌘1-6 stopped working briefly" report sees
    // the suppression in devtools (parity with every other guard in the
    // file).
    test('setSessionActivePane is a no-op while removePane is in flight', async () => {
      const service = createSequentialSpawnService()
      let resolveKill: () => void = () => undefined
      ;(service.kill as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveKill = resolve
          })
      )

      const { result } = renderHook(() =>
        useSessionManager(service, { autoCreateOnEmpty: false })
      )
      await waitFor(() => expect(result.current.loading).toBe(false))

      const sessionId = await createInitialSession(result)

      await addSecondPane(result, sessionId)

      // Reset the spy so we only observe setActiveSession calls that
      // happen during the racing window we're exercising below.
      ;(service.setActiveSession as ReturnType<typeof vi.fn>).mockClear()

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

      // Start a removePane that will block until we resolve the kill.
      act(() => result.current.removePane(sessionId, 'p0'))

      // While the kill is in flight, an attempt to focus-rotate must
      // do nothing — no state mutation, no Rust IPC. The active pane
      // stays where it was when removePane fired.
      const activeBefore = result.current.sessions[0].panes.find(
        (pane) => pane.active
      )?.id

      act(() => result.current.setSessionActivePane(sessionId, 'p0'))

      const activeAfter = result.current.sessions[0].panes.find(
        (pane) => pane.active
      )?.id

      expect(activeAfter).toBe(activeBefore)
      expect(service.setActiveSession).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('pane op in flight')
      )

      warn.mockRestore()

      // Let removePane finish so the hook unwinds cleanly.
      await act(async () => {
        resolveKill()
        await Promise.resolve()
      })
    })
  })

  describe('setSessionPlacements', () => {
    test('writes the supplied placements onto the session', async () => {
      const service = createMockService()
      service.listSessions = vi.fn().mockResolvedValue({
        activeSessionId: 'pty-1',
        sessions: [
          {
            id: 'pty-1',
            cwd: '/tmp',
            status: {
              kind: 'Alive',
              pid: 1,
              replay_data: '',
              replay_end_offset: BigInt(0),
            },
          },
        ],
      })

      const { result } = renderHook(() =>
        useSessionManager(service, { autoCreateOnEmpty: false })
      )
      await waitFor(() => expect(result.current.loading).toBe(false))

      const sessionId = result.current.sessions[0].id

      act(() => {
        result.current.setSessionLayout(sessionId, 'vsplit')
      })

      await waitFor(() => {
        expect(result.current.sessions[0].layout).toBe('vsplit')
      })

      act(() => {
        result.current.addPane(sessionId, 'browser')
      })

      await waitFor(() => {
        expect(result.current.sessions[0].panes).toHaveLength(2)
      })

      act(() => {
        result.current.setSessionPlacements(sessionId, [
          { paneId: 'p0', slotId: 'slot:p1' },
          { paneId: 'p1', slotId: 'slot:p0' },
        ])
      })

      expect(result.current.sessions[0].placements).toEqual([
        { paneId: 'p0', slotId: 'slot:p1' },
        { paneId: 'p1', slotId: 'slot:p0' },
      ])
    })

    test('ignores an unknown session id', async () => {
      const service = createMockService()
      service.listSessions = vi.fn().mockResolvedValue({
        activeSessionId: 'pty-1',
        sessions: [
          {
            id: 'pty-1',
            cwd: '/tmp',
            status: {
              kind: 'Alive',
              pid: 1,
              replay_data: '',
              replay_end_offset: BigInt(0),
            },
          },
        ],
      })

      const { result } = renderHook(() =>
        useSessionManager(service, { autoCreateOnEmpty: false })
      )
      await waitFor(() => expect(result.current.loading).toBe(false))

      const sessionsBefore = result.current.sessions

      act(() => {
        result.current.setSessionPlacements('does-not-exist', [
          { paneId: 'p0', slotId: 'slot:p1' },
        ])
      })

      expect(result.current.sessions).toBe(sessionsBefore)
    })
  })

  test('createSession(opts) builds a multi-pane session honoring layout + cwd', async () => {
    const service = createMockService()
    service.listSessions = vi
      .fn()
      .mockResolvedValue({ activeSessionId: null, sessions: [] })

    service.spawn = vi.fn().mockResolvedValue({
      sessionId: 'pty',
      pid: 1,
      cwd: '/Users/x/proj',
      shell: '/bin/zsh',
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.createSession({
        cwd: '/Users/x/proj',
        layout: 'vsplit',
        panes: [{ command: 'claude' }, { command: 'shell' }],
      })
    })

    await waitFor(() => expect(result.current.sessions).toHaveLength(1))
    const session = result.current.sessions[0]
    expect(session.layout).toBe('vsplit')
    expect(session.workingDirectory).toBe('/Users/x/proj')
    expect(session.name).toBe('proj')
    expect(session.panes).toHaveLength(2)
    expect(session.panes[0].userLabel).toBe('Claude Code')
    expect(session.panes[1].userLabel).toBeUndefined()
    expect(session.panes[0].active).toBe(true)
    // every shell pane spawned with the chosen cwd (fixed baseline)
    expect(service.spawn).toHaveBeenCalledTimes(2)
    expect(service.spawn).toHaveBeenNthCalledWith(1, {
      cwd: '/Users/x/proj',
      env: {},
      enableAgentBridge: true,
    })
  })

  test('createSession() with no args is unchanged (single shell pane)', async () => {
    const service = createMockService()
    service.listSessions = vi
      .fn()
      .mockResolvedValue({ activeSessionId: null, sessions: [] })

    service.spawn = vi.fn().mockResolvedValue({
      sessionId: 'pty',
      pid: 1,
      cwd: '/home/u',
      shell: '/bin/zsh',
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.createSession())
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))
    expect(result.current.sessions[0].layout).toBe('single')
    expect(result.current.sessions[0].panes).toHaveLength(1)
  })

  test('createSession calls onCreated after the new session is active', async () => {
    const service = createMockService()
    service.listSessions = vi
      .fn()
      .mockResolvedValue({ activeSessionId: 'old', sessions: [] })

    service.spawn = vi.fn().mockResolvedValue({
      sessionId: 'pty',
      pid: 1,
      cwd: '/home/u',
      shell: '/bin/zsh',
    })

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    let activeSessionIdDuringCallback: string | null = null

    const onCreated = vi.fn((sessionId: string) => {
      activeSessionIdDuringCallback = result.current.activeSessionId
      expect(activeSessionIdDuringCallback).toBe(sessionId)
    })

    act(() => {
      result.current.createSession({ onCreated })
    })

    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce())
    expect(activeSessionIdDuringCallback).toBe(result.current.activeSessionId)
    expect(result.current.sessions[0].id).toBe(result.current.activeSessionId)
  })

  test('createSession skips a failed pane but still creates the session', async () => {
    const service = createMockService()
    service.listSessions = vi
      .fn()
      .mockResolvedValue({ activeSessionId: null, sessions: [] })

    service.spawn = vi
      .fn()
      .mockResolvedValueOnce({
        sessionId: 'pty0',
        pid: 1,
        cwd: '/p',
        shell: '/bin/zsh',
      })
      .mockRejectedValueOnce(new Error('boom'))

    const { result } = renderHook(() =>
      useSessionManager(service, { autoCreateOnEmpty: false })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.createSession({
        cwd: '/p',
        layout: 'vsplit',
        panes: [{ command: 'shell' }, { command: 'shell' }],
      })
    })
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))
    expect(result.current.sessions[0].panes).toHaveLength(1)
  })
})
