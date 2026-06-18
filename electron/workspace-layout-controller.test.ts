import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  WORKSPACE_LAYOUT_BEGIN_HYDRATION,
  WORKSPACE_LAYOUT_END_HYDRATION,
  WORKSPACE_LAYOUT_LOAD_FOR_RESTORE,
  WORKSPACE_LAYOUT_PUSH_SHAPE,
  WORKSPACE_LAYOUT_REQUEST_FINAL_SHAPE,
} from './workspace-layout-channels'
import {
  WorkspaceLayoutController,
  setupWorkspaceLayoutController,
} from './workspace-layout-controller'
import type {
  IpcMainLike,
  PersistedWorkspaceLayoutStore,
  WorkspaceLayoutWriterPort,
  PersistedWorkspaceShape,
} from './workspace-layout-types'

const makeWriter = (): WorkspaceLayoutWriterPort & {
  onShapePushed: ReturnType<typeof vi.fn>
  setHydrating: ReturnType<typeof vi.fn>
} => ({
  onShapePushed: vi.fn(),
  setHydrating: vi.fn(),
})

const makeSidecar = (
  result: unknown
): { invoke: ReturnType<typeof vi.fn> } => ({
  invoke: vi.fn().mockResolvedValue(result),
})

const sampleShape = (): PersistedWorkspaceShape => ({
  sessions: [
    {
      id: 's1',
      projectId: 'proj-1',
      layout: 'vsplit',
      workingDirectory: '/repo',
      active: true,
      panes: [
        {
          kind: 'shell',
          paneId: 'p0',
          paneIndex: 0,
          active: true,
          ptyId: 'pty-1',
          cwd: '/repo',
          agentType: 'claude-code',
          agentSessionId: null,
        },
        { kind: 'browser', paneId: 'p1', paneIndex: 1, active: false },
      ],
    },
  ],
})

const sampleStore = (): PersistedWorkspaceLayoutStore => ({
  version: 1,
  sessions: [
    {
      id: 's1',
      projectId: 'proj-1',
      layout: 'vsplit',
      workingDirectory: '/repo',
      active: true,
      panes: [
        {
          kind: 'shell',
          paneId: 'p0',
          paneIndex: 0,
          active: true,
          ptyId: 'pty-1',
          cwd: '/repo',
          agentType: 'claude-code',
          agentSessionId: null,
        },
        {
          kind: 'browser',
          paneId: 'p1',
          paneIndex: 1,
          active: false,
          tabs: [
            {
              active: true,
              historyIndex: 1,
              history: [
                { url: 'https://a.example', title: 'A' },
                { url: 'https://b.example', title: null },
              ],
            },
          ],
        },
      ],
    },
  ],
})

describe('WorkspaceLayoutController', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('pushShape retains the latest shape DTO and notifies the writer', () => {
    const writer = makeWriter()

    const controller = new WorkspaceLayoutController({
      sidecar: makeSidecar(null),
      writer,
    })

    expect(controller.latestShapeDto).toBeNull()

    const dto = sampleShape()
    controller.pushShape(dto)

    expect(controller.latestShapeDto).toEqual(dto)
    expect(writer.onShapePushed).toHaveBeenCalledWith(dto)
  })

  test('loadForRestore loads via Rust, retains the store, returns shape only', async () => {
    const store = sampleStore()
    const sidecar = makeSidecar(store)
    const controller = new WorkspaceLayoutController({ sidecar })

    const shape = await controller.loadForRestore({
      projectId: 'proj-1',
      workingDirectory: '/repo',
    })

    expect(sidecar.invoke).toHaveBeenCalledWith('load_workspace_layout', {
      projectId: 'proj-1',
      workingDirectory: '/repo',
    })
    expect(controller.loadedStore).toEqual(store)

    // The returned shape keeps pane existence + shell fields but drops the
    // browser tab/history (those stay main-side).
    expect(shape).toEqual(sampleShape())
    const browserPane = shape.sessions[0].panes[1]
    expect(browserPane.kind).toBe('browser')
    expect('tabs' in browserPane).toBe(false)
  })

  test('tabsForPane serves repaired tabs from the loaded store', async () => {
    const sidecar = makeSidecar(sampleStore())
    const controller = new WorkspaceLayoutController({ sidecar })
    await controller.loadForRestore({
      projectId: 'proj-1',
      workingDirectory: '/repo',
    })

    const tabs = controller.tabsForPane('s1', 'p1')
    expect(tabs).toHaveLength(1)
    expect(tabs?.[0].history[0].url).toBe('https://a.example')

    expect(controller.tabsForPane('s1', 'p0')).toBeNull() // shell pane
    expect(controller.tabsForPane('nope', 'p1')).toBeNull()
  })

  test('tabsForPane returns cloned repaired tabs', async () => {
    const sidecar = makeSidecar(sampleStore())
    const controller = new WorkspaceLayoutController({ sidecar })
    await controller.loadForRestore({
      projectId: 'proj-1',
      workingDirectory: '/repo',
    })

    const tabs = controller.tabsForPane('s1', 'p1')
    if (tabs === null) {
      throw new Error('expected restored browser tabs')
    }

    tabs[0].history[0].url = 'https://mutated.example'
    tabs.push({
      active: false,
      historyIndex: 0,
      history: [{ url: 'https://new.example', title: 'New' }],
    })

    const nextTabs = controller.tabsForPane('s1', 'p1')
    expect(nextTabs).toHaveLength(1)
    expect(nextTabs?.[0].history[0].url).toBe('https://a.example')
  })

  test('requestFinalShape resolves with the renderer ack push', async () => {
    const controller = new WorkspaceLayoutController({
      sidecar: makeSidecar(null),
    })
    const sender = { send: vi.fn() }

    const pending = controller.requestFinalShape(sender, 1000)
    expect(sender.send).toHaveBeenCalledWith(
      WORKSPACE_LAYOUT_REQUEST_FINAL_SHAPE,
      expect.anything()
    )

    const fresh = sampleShape()
    controller.pushShape(fresh)

    await expect(pending).resolves.toEqual(fresh)
  })

  test('requestFinalShape rejects while another request is pending', async () => {
    const controller = new WorkspaceLayoutController({
      sidecar: makeSidecar(null),
    })
    const sender = { send: vi.fn() }

    const pending = controller.requestFinalShape(sender, 1000)

    expect(() => controller.requestFinalShape(sender, 1000)).toThrow(
      'workspace layout final shape request already pending'
    )
    expect(sender.send).toHaveBeenCalledTimes(1)

    const fresh = sampleShape()
    controller.pushShape(fresh)

    await expect(pending).resolves.toEqual(fresh)
  })

  test('requestFinalShape falls back to the last-known shape on timeout', async () => {
    vi.useFakeTimers()

    const controller = new WorkspaceLayoutController({
      sidecar: makeSidecar(null),
    })
    const lastKnown = sampleShape()
    controller.pushShape(lastKnown)

    const pending = controller.requestFinalShape({ send: vi.fn() }, 1000)
    vi.advanceTimersByTime(1000)

    await expect(pending).resolves.toEqual(lastKnown)
  })

  test('beginHydration / endHydration hold the writer flag until the final end', () => {
    const writer = makeWriter()

    const controller = new WorkspaceLayoutController({
      sidecar: makeSidecar(null),
      writer,
    })

    controller.beginHydration()
    controller.beginHydration()
    expect(writer.setHydrating).toHaveBeenCalledTimes(1)
    expect(writer.setHydrating).toHaveBeenLastCalledWith(true)

    controller.endHydration()
    expect(writer.setHydrating).toHaveBeenCalledTimes(1)

    controller.endHydration()
    expect(writer.setHydrating).toHaveBeenCalledTimes(2)
    expect(writer.setHydrating).toHaveBeenLastCalledWith(false)

    controller.endHydration()
    expect(writer.setHydrating).toHaveBeenCalledTimes(2)
  })

  test('install registers the invoke channels and dispose removes them', () => {
    const handlers = new Map<string, unknown>()
    const removed: string[] = []

    const ipcMain: IpcMainLike = {
      handle: (channel, listener) => handlers.set(channel, listener),
      removeHandler: (channel) => removed.push(channel),
    }

    const controller = new WorkspaceLayoutController({
      sidecar: makeSidecar(null),
    })

    controller.install(ipcMain)
    expect([...handlers.keys()].sort()).toEqual(
      [
        WORKSPACE_LAYOUT_BEGIN_HYDRATION,
        WORKSPACE_LAYOUT_END_HYDRATION,
        WORKSPACE_LAYOUT_LOAD_FOR_RESTORE,
        WORKSPACE_LAYOUT_PUSH_SHAPE,
      ].sort()
    )

    controller.dispose()
    expect(removed.sort()).toEqual(
      [
        WORKSPACE_LAYOUT_BEGIN_HYDRATION,
        WORKSPACE_LAYOUT_END_HYDRATION,
        WORKSPACE_LAYOUT_LOAD_FOR_RESTORE,
        WORKSPACE_LAYOUT_PUSH_SHAPE,
      ].sort()
    )
  })

  test('installed push handler updates the controller, load handler returns shape', async () => {
    const handlers = new Map<
      string,
      (event: unknown, ...args: unknown[]) => unknown
    >()

    const ipcMain: IpcMainLike = {
      handle: (channel, listener) => handlers.set(channel, listener),
      removeHandler: () => undefined,
    }

    const controller = new WorkspaceLayoutController({
      sidecar: makeSidecar(sampleStore()),
    })
    controller.install(ipcMain)

    const dto = sampleShape()
    handlers.get(WORKSPACE_LAYOUT_PUSH_SHAPE)?.({}, dto)
    expect(controller.latestShapeDto).toEqual(dto)

    const shape = await handlers.get(WORKSPACE_LAYOUT_LOAD_FOR_RESTORE)?.(
      {},
      {
        projectId: 'proj-1',
        workingDirectory: '/repo',
      }
    )
    expect(shape).toEqual(sampleShape())
  })

  test('pushShape IPC handler rejects malformed payloads', () => {
    const handlers = new Map<
      string,
      (event: unknown, ...args: unknown[]) => unknown
    >()

    const ipcMain: IpcMainLike = {
      handle: (channel, listener) => handlers.set(channel, listener),
      removeHandler: () => undefined,
    }

    const writer = makeWriter()

    const controller = new WorkspaceLayoutController({
      sidecar: makeSidecar(null),
      writer,
    })
    controller.install(ipcMain)

    const malformedPayloads: unknown[] = [
      null,
      {},
      { sessions: null },
      { sessions: 'not-array' },
      { sessions: [null] },
      { sessions: [{ id: 's1', panes: [] }] },
      {
        sessions: [
          {
            id: 's1',
            projectId: 'proj-1',
            layout: 'vsplit',
            workingDirectory: '/repo',
            active: true,
            panes: [
              {
                kind: 'browser',
                paneId: 'p1',
                paneIndex: '1',
                active: false,
              },
            ],
          },
        ],
      },
      {
        sessions: [
          {
            id: 's1',
            projectId: 'proj-1',
            layout: 'vsplit',
            workingDirectory: '/repo',
            active: true,
            panes: [
              {
                kind: 'shell',
                paneId: 'p0',
                paneIndex: 0,
                active: true,
                ptyId: 'pty-1',
                cwd: '/repo',
                agentType: 'claude-code',
                agentSessionId: 42,
              },
            ],
          },
        ],
      },
    ]

    for (const payload of malformedPayloads) {
      handlers.get(WORKSPACE_LAYOUT_PUSH_SHAPE)?.({}, payload)
      expect(controller.latestShapeDto).toBeNull()
      expect(writer.onShapePushed).not.toHaveBeenCalled()
    }

    const dto = sampleShape()
    handlers.get(WORKSPACE_LAYOUT_PUSH_SHAPE)?.({}, dto)
    expect(controller.latestShapeDto).toEqual(dto)
    expect(writer.onShapePushed).toHaveBeenCalledWith(dto)
  })

  test('loadForRestore IPC handler ignores malformed payloads', async () => {
    const handlers = new Map<
      string,
      (event: unknown, ...args: unknown[]) => unknown
    >()

    const ipcMain: IpcMainLike = {
      handle: (channel, listener) => handlers.set(channel, listener),
      removeHandler: () => undefined,
    }

    const sidecar = makeSidecar(sampleStore())
    const controller = new WorkspaceLayoutController({ sidecar })
    controller.install(ipcMain)

    const loadForRestore = (payload: unknown): Promise<unknown> =>
      Promise.resolve(
        handlers.get(WORKSPACE_LAYOUT_LOAD_FOR_RESTORE)?.({}, payload)
      )

    await expect(loadForRestore(null)).resolves.toEqual({ sessions: [] })

    await expect(loadForRestore({})).resolves.toEqual({ sessions: [] })

    await expect(loadForRestore({ projectId: 'proj-1' })).resolves.toEqual({
      sessions: [],
    })

    expect(sidecar.invoke).not.toHaveBeenCalled()

    await expect(
      loadForRestore({
        projectId: 'proj-1',
        workingDirectory: '/repo',
      })
    ).resolves.toEqual(sampleShape())
    expect(sidecar.invoke).toHaveBeenCalledTimes(1)
  })

  test('setupWorkspaceLayoutController installs onto the provided ipcMain', () => {
    const handlers = new Map<string, unknown>()

    const ipcMain: IpcMainLike = {
      handle: (channel, listener) => handlers.set(channel, listener),
      removeHandler: () => undefined,
    }

    const controller = setupWorkspaceLayoutController({
      sidecar: makeSidecar(null),
      ipcMain,
    })

    expect(controller).toBeInstanceOf(WorkspaceLayoutController)
    expect(handlers.has(WORKSPACE_LAYOUT_PUSH_SHAPE)).toBe(true)
  })
})
