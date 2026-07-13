import { describe, expect, test, vi } from 'vitest'
import { WorkspaceLayoutController } from './workspace-layout-controller'
import {
  CURRENT_WORKSPACE_LAYOUT_VERSION,
  WorkspaceLayoutWriter,
} from './workspace-layout-writer'
import { WorkspaceTeardown } from './workspace-teardown'
import type {
  PersistedPaneLayoutDefinition,
  PersistedTab,
  PersistedWorkspaceLayoutStore,
  PersistedWorkspaceShape,
} from './workspace-layout-types'

const customPaneLayout = (): PersistedPaneLayoutDefinition => ({
  schemaVersion: 1,
  id: 'custom:main-side-stack',
  title: 'Main + side stack',
  source: 'workspace',
  tracks: {
    columns: [
      { id: 'main', units: 16 },
      { id: 'side', units: 8 },
    ],
    rows: [
      { id: 'top', units: 8 },
      { id: 'middle', units: 8 },
      { id: 'bottom', units: 8 },
    ],
  },
  slots: [
    {
      id: 'slot:main',
      rect: { col: 0, row: 0, colSpan: 1, rowSpan: 3 },
    },
    {
      id: 'slot:side-top',
      rect: { col: 1, row: 0, colSpan: 1, rowSpan: 1 },
    },
    {
      id: 'slot:side-middle',
      rect: { col: 1, row: 1, colSpan: 1, rowSpan: 1 },
    },
    {
      id: 'slot:side-bottom',
      rect: { col: 1, row: 2, colSpan: 1, rowSpan: 1 },
    },
  ],
  addOrder: [
    'slot:main',
    'slot:side-top',
    'slot:side-middle',
    'slot:side-bottom',
  ],
})

const browserOnlyTabs: PersistedTab[] = [
  {
    active: false,
    historyIndex: 1,
    history: [
      { url: 'https://docs.example/start', title: 'Docs' },
      { url: 'https://docs.example/deep-link', title: 'Deep link' },
    ],
  },
  {
    active: true,
    historyIndex: 0,
    history: [{ url: 'https://app.example/dashboard', title: 'Dashboard' }],
  },
]

const mixedTabs: PersistedTab[] = [
  {
    active: true,
    historyIndex: 2,
    history: [
      { url: 'https://search.example/', title: 'Search' },
      { url: 'https://search.example/results?q=vim', title: 'Results' },
      { url: 'https://search.example/result/1', title: null },
    ],
  },
]

const roundTripShape = (): PersistedWorkspaceShape => ({
  customPaneLayouts: [customPaneLayout()],
  sessions: [
    {
      id: 'ws-browser',
      projectId: 'proj-1',
      layout: 'single',
      placements: [{ paneId: 'p0', slotId: 'slot:p0' }],
      workingDirectory: '/repo',
      active: true,
      open: true,
      panes: [{ kind: 'browser', paneId: 'p0', paneIndex: 0, active: true }],
    },
    {
      id: 'ws-mixed',
      projectId: 'proj-1',
      layout: 'custom:main-side-stack',
      placements: [
        { paneId: 'p0', slotId: 'slot:main' },
        { paneId: 'p1', slotId: 'slot:side-top' },
      ],
      workingDirectory: '/repo',
      active: false,
      open: true,
      panes: [
        {
          kind: 'shell',
          paneId: 'p0',
          paneIndex: 0,
          active: false,
          ptyId: 'pty-dead',
          cwd: '/repo/sub',
          agentType: 'codex',
          agentSessionId: 'codex-conversation-1',
          agentLauncher: 'CDX',
        },
        { kind: 'browser', paneId: 'p1', paneIndex: 1, active: true },
      ],
    },
  ],
})

const makeRoundTripHarness = (): {
  controller: WorkspaceLayoutController
  loadController: () => WorkspaceLayoutController
  savedStore: () => PersistedWorkspaceLayoutStore | null
  writer: WorkspaceLayoutWriter
} => {
  let store: PersistedWorkspaceLayoutStore | null = null
  const invokeCalls = vi.fn()

  const invoke = <T>(
    method: string,
    args?: Record<string, unknown>
  ): Promise<T> => {
    invokeCalls(method, args)

    if (method === 'save_workspace_layout') {
      store = (args as { store: PersistedWorkspaceLayoutStore }).store

      return Promise.resolve(null as T)
    }

    if (method === 'load_workspace_layout') {
      return Promise.resolve(
        (store ?? {
          version: CURRENT_WORKSPACE_LAYOUT_VERSION,
          customPaneLayouts: [],
          sessions: [],
        }) as T
      )
    }

    throw new Error(`unexpected method ${method}`)
  }

  const writer = new WorkspaceLayoutWriter({
    sidecar: { invoke },
    captureTabsForPane: (sessionId, paneId): PersistedTab[] | null => {
      if (sessionId === 'ws-browser' && paneId === 'p0') {
        return browserOnlyTabs
      }

      if (sessionId === 'ws-mixed' && paneId === 'p1') {
        return mixedTabs
      }

      return null
    },
  })

  return {
    controller: new WorkspaceLayoutController({
      sidecar: { invoke },
      writer,
    }),
    loadController: (): WorkspaceLayoutController =>
      new WorkspaceLayoutController({ sidecar: { invoke } }),
    savedStore: (): PersistedWorkspaceLayoutStore | null => store,
    writer,
  }
}

describe('workspace layout round trip', () => {
  test('preserves browser histories and returns shape-only DTO on reload', async () => {
    const harness = makeRoundTripHarness()
    const shape = roundTripShape()

    harness.controller.pushShape(shape)
    await harness.writer.flush()

    expect(harness.savedStore()).toEqual({
      version: CURRENT_WORKSPACE_LAYOUT_VERSION,
      customPaneLayouts: shape.customPaneLayouts,
      sessions: [
        {
          ...shape.sessions[0],
          panes: [
            {
              kind: 'browser',
              paneId: 'p0',
              paneIndex: 0,
              active: true,
              tabs: browserOnlyTabs,
            },
          ],
        },
        {
          ...shape.sessions[1],
          panes: [
            shape.sessions[1].panes[0],
            {
              kind: 'browser',
              paneId: 'p1',
              paneIndex: 1,
              active: true,
              tabs: mixedTabs,
            },
          ],
        },
      ],
    })

    const reloadedMain = harness.loadController()

    const restoreShape = await reloadedMain.loadForRestore({
      projectId: 'proj-1',
      workingDirectory: '/repo',
    })

    expect(restoreShape).toEqual(shape)
    expect(reloadedMain.tabsForPane('ws-browser', 'p0')).toEqual(
      browserOnlyTabs
    )
    expect(reloadedMain.tabsForPane('ws-mixed', 'p1')).toEqual(mixedTabs)
  })

  test('graceful quit flush persists a browser-only session for restore', async () => {
    const harness = makeRoundTripHarness()
    const shape = roundTripShape()

    const browserOnlyShape: PersistedWorkspaceShape = {
      customPaneLayouts: shape.customPaneLayouts,
      sessions: [shape.sessions[0]],
    }

    const teardown = new WorkspaceTeardown({
      drainFinalShape: vi.fn((): Promise<void> => {
        harness.controller.pushShape(browserOnlyShape)

        return Promise.resolve()
      }),
      flush: vi.fn(() => harness.writer.flush()),
    })

    await teardown.flushOnce()

    expect(harness.savedStore()?.sessions).toHaveLength(1)
    expect(harness.savedStore()?.sessions[0].id).toBe('ws-browser')

    const restoreShape = await harness.loadController().loadForRestore({
      projectId: 'proj-1',
      workingDirectory: '/repo',
    })

    expect(restoreShape.sessions).toEqual(browserOnlyShape.sessions)
    expect(restoreShape.customPaneLayouts).toEqual(
      browserOnlyShape.customPaneLayouts
    )
  })
})
