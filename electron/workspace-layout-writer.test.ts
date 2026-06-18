import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  CURRENT_WORKSPACE_LAYOUT_VERSION,
  WorkspaceLayoutWriter,
} from './workspace-layout-writer'
import type {
  PersistedTab,
  PersistedWorkspaceShape,
} from './workspace-layout-types'

const shape = (): PersistedWorkspaceShape => ({
  sessions: [
    {
      id: 's1',
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

const tabs: PersistedTab[] = [
  {
    active: true,
    historyIndex: 0,
    history: [{ url: 'https://x', title: 'X' }],
  },
]

const makeSidecar = (): { invoke: ReturnType<typeof vi.fn> } => ({
  invoke: vi.fn().mockResolvedValue(null),
})

const makeDeferred = <T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} => {
  let resolveFn: (value: T) => void = () => undefined

  const promise = new Promise<T>((resolve) => {
    resolveFn = resolve
  })

  return { promise, resolve: resolveFn }
}

describe('WorkspaceLayoutWriter', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('assemble joins the shape with captured browser tabs', () => {
    const writer = new WorkspaceLayoutWriter({
      sidecar: makeSidecar(),
      captureTabsForPane: (s, p): PersistedTab[] | null =>
        s === 's1' && p === 'p1' ? tabs : null,
    })
    writer.onShapePushed(shape())

    expect(writer.assemble()).toEqual({
      version: CURRENT_WORKSPACE_LAYOUT_VERSION,
      sessions: [
        {
          id: 's1',
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
              tabs,
            },
          ],
        },
      ],
    })
  })

  test('assemble is null before any shape push', () => {
    const writer = new WorkspaceLayoutWriter({
      sidecar: makeSidecar(),
      captureTabsForPane: (): PersistedTab[] | null => null,
    })
    expect(writer.assemble()).toBeNull()
  })

  test('assemble uses preserved browser tabs before live capture is available', () => {
    const writer = new WorkspaceLayoutWriter({
      sidecar: makeSidecar(),
      captureTabsForPane: (): PersistedTab[] | null => null,
      preservedTabsForPane: (s, p): PersistedTab[] | null =>
        s === 's1' && p === 'p1' ? tabs : null,
    })

    writer.onShapePushed(shape())

    expect(writer.assemble()?.sessions[0].panes[1]).toEqual({
      kind: 'browser',
      paneId: 'p1',
      paneIndex: 1,
      active: false,
      tabs,
    })
  })

  test('assemble reuses the last live browser capture when capture is temporarily missing', () => {
    let captureAvailable = true

    const writer = new WorkspaceLayoutWriter({
      sidecar: makeSidecar(),
      captureTabsForPane: (): PersistedTab[] | null =>
        captureAvailable ? tabs : null,
    })

    writer.onShapePushed(shape())
    expect(writer.assemble()?.sessions[0].panes[1]).toEqual(
      expect.objectContaining({ tabs })
    )

    captureAvailable = false
    expect(writer.assemble()?.sessions[0].panes[1]).toEqual(
      expect.objectContaining({ tabs })
    )
  })

  test('assemble seeds a new browser pane with empty tabs before live capture exists', () => {
    const writer = new WorkspaceLayoutWriter({
      sidecar: makeSidecar(),
      captureTabsForPane: (): PersistedTab[] | null => null,
    })

    writer.onShapePushed(shape())

    expect(writer.assemble()?.sessions[0].panes[1]).toEqual({
      kind: 'browser',
      paneId: 'p1',
      paneIndex: 1,
      active: false,
      tabs: [],
    })
  })

  test('assemble treats a reappearing browser pane as fresh before live capture exists', () => {
    const writer = new WorkspaceLayoutWriter({
      sidecar: makeSidecar(),
      captureTabsForPane: (): PersistedTab[] | null => null,
    })
    const withoutBrowser = shape()
    withoutBrowser.sessions[0].panes = withoutBrowser.sessions[0].panes.filter(
      (pane) => pane.kind !== 'browser'
    )

    writer.onShapePushed(shape())
    expect(writer.assemble()?.sessions[0].panes[1]).toEqual(
      expect.objectContaining({ kind: 'browser', tabs: [] })
    )

    writer.onShapePushed(withoutBrowser)
    expect(writer.assemble()).not.toBeNull()

    writer.onShapePushed(shape())
    expect(writer.assemble()?.sessions[0].panes[1]).toEqual(
      expect.objectContaining({ kind: 'browser', tabs: [] })
    )
  })

  test('coalesces rapid structural writes into a single latest snapshot', async () => {
    const sidecar = makeSidecar()

    const writer = new WorkspaceLayoutWriter({
      sidecar,
      captureTabsForPane: (): PersistedTab[] => [],
    })

    writer.onShapePushed(shape())
    writer.markStructural()
    writer.markStructural()
    await writer.flush()

    expect(sidecar.invoke).toHaveBeenCalledTimes(1)
    expect(sidecar.invoke).toHaveBeenCalledWith(
      'save_workspace_layout',
      expect.objectContaining({
        store: expect.objectContaining({
          version: CURRENT_WORKSPACE_LAYOUT_VERSION,
        }),
      })
    )
  })

  test('markStructural writes immediately while markVolatile debounces', async () => {
    vi.useFakeTimers()
    const sidecar = makeSidecar()

    const writer = new WorkspaceLayoutWriter({
      sidecar,
      captureTabsForPane: (): PersistedTab[] => [],
      debounceMs: 500,
    })

    writer.onShapePushed(shape())
    await vi.advanceTimersByTimeAsync(0)
    expect(sidecar.invoke).toHaveBeenCalledTimes(1)

    writer.markVolatile()
    await vi.advanceTimersByTimeAsync(0)
    expect(sidecar.invoke).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(500)
    expect(sidecar.invoke).toHaveBeenCalledTimes(2)
  })

  test('hydration guard suppresses structural and volatile writes', async () => {
    vi.useFakeTimers()
    const sidecar = makeSidecar()

    const writer = new WorkspaceLayoutWriter({
      sidecar,
      captureTabsForPane: (): PersistedTab[] => [],
      debounceMs: 500,
    })

    writer.setHydrating(true)
    writer.onShapePushed(shape())
    writer.markStructural()
    writer.markVolatile()
    await vi.advanceTimersByTimeAsync(500)
    expect(sidecar.invoke).not.toHaveBeenCalled()

    writer.setHydrating(false)
    writer.markStructural()
    await vi.advanceTimersByTimeAsync(0)
    expect(sidecar.invoke).toHaveBeenCalledTimes(1)
  })

  test('flush surfaces its own save failure and keeps the queue retryable', async () => {
    const error = new Error('disk full')

    const sidecar = {
      invoke: vi.fn().mockRejectedValueOnce(error).mockResolvedValue(null),
    }

    const writer = new WorkspaceLayoutWriter({
      sidecar,
      captureTabsForPane: (): PersistedTab[] => [],
    })

    writer.onShapePushed(shape())

    await expect(writer.flush()).rejects.toThrow(error)
    await expect(writer.flush()).resolves.toBeUndefined()
    expect(sidecar.invoke).toHaveBeenCalledTimes(2)
  })

  test('flush persists a reappearing browser pane before live capture exists', async () => {
    const sidecar = makeSidecar()

    const writer = new WorkspaceLayoutWriter({
      sidecar,
      captureTabsForPane: (): PersistedTab[] | null => null,
    })
    const withoutBrowser = shape()
    withoutBrowser.sessions[0].panes = withoutBrowser.sessions[0].panes.filter(
      (pane) => pane.kind !== 'browser'
    )

    writer.setHydrating(true)
    writer.onShapePushed(shape())
    writer.onShapePushed(withoutBrowser)
    writer.onShapePushed(shape())
    writer.setHydrating(false)

    await expect(writer.flush()).resolves.toBeUndefined()
    expect(sidecar.invoke).toHaveBeenCalledWith(
      'save_workspace_layout',
      expect.objectContaining({
        store: expect.objectContaining({
          sessions: [
            expect.objectContaining({
              panes: expect.arrayContaining([
                expect.objectContaining({
                  kind: 'browser',
                  paneId: 'p1',
                  tabs: [],
                }),
              ]),
            }),
          ],
        }),
      })
    )
  })

  test('flush persists a new browser pane before live capture exists', async () => {
    const sidecar = makeSidecar()

    const writer = new WorkspaceLayoutWriter({
      sidecar,
      captureTabsForPane: (): PersistedTab[] | null => null,
    })

    writer.onShapePushed(shape())

    await expect(writer.flush()).resolves.toBeUndefined()
    expect(sidecar.invoke).toHaveBeenCalledTimes(1)
    expect(sidecar.invoke).toHaveBeenCalledWith(
      'save_workspace_layout',
      expect.objectContaining({
        store: expect.objectContaining({
          sessions: [
            expect.objectContaining({
              panes: expect.arrayContaining([
                expect.objectContaining({
                  kind: 'browser',
                  paneId: 'p1',
                  tabs: [],
                }),
              ]),
            }),
          ],
        }),
      })
    )
  })

  test('flush waits for a superseding write and surfaces its failure', async () => {
    const firstSave = makeDeferred<null>()
    const error = new Error('second write failed')

    const sidecar = {
      invoke: vi
        .fn()
        .mockReturnValueOnce(firstSave.promise)
        .mockRejectedValue(error),
    }

    const writer = new WorkspaceLayoutWriter({
      sidecar,
      captureTabsForPane: (): PersistedTab[] => [],
    })

    writer.onShapePushed(shape())
    await Promise.resolve()
    expect(sidecar.invoke).toHaveBeenCalledTimes(1)

    const flushPromise = writer.flush()
    writer.markStructural()

    firstSave.resolve(null)

    await expect(flushPromise).rejects.toThrow(error)
    expect(sidecar.invoke).toHaveBeenCalledTimes(2)
  })
})
