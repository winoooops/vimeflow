// Main-side workspace-layout controller (spec §3.2). The connective tissue for
// the single-writer durable store: it receives the renderer's shape-only DTO,
// loads + retains the repaired store in memory for restore, brackets hydration,
// and drives the close-flush "final shape" handshake. The assembler/writer and
// restore-tab serving plug into the ports it defines.

import {
  WORKSPACE_LAYOUT_BEGIN_HYDRATION,
  WORKSPACE_LAYOUT_END_HYDRATION,
  WORKSPACE_LAYOUT_LOAD_FOR_RESTORE,
  WORKSPACE_LAYOUT_PUSH_SHAPE,
  WORKSPACE_LAYOUT_REQUEST_FINAL_SHAPE,
} from './workspace-layout-channels'
import type {
  IpcMainLike,
  LoadWorkspaceForRestoreRequest,
  PersistedTab,
  PersistedWorkspaceLayoutStore,
  PersistedWorkspacePane,
  PersistedWorkspacePaneShape,
  PersistedWorkspaceSessionShape,
  PersistedWorkspaceShape,
  RendererSender,
  WorkspaceLayoutWriterPort,
} from './workspace-layout-types'

interface SidecarInvoker {
  invoke: <T>(method: string, args?: Record<string, unknown>) => Promise<T>
}

export interface WorkspaceLayoutControllerDeps {
  sidecar: SidecarInvoker
  writer?: WorkspaceLayoutWriterPort
}

const DEFAULT_FINAL_SHAPE_TIMEOUT_MS = 1000

const noopWriter: WorkspaceLayoutWriterPort = {
  onShapePushed: (): void => undefined,
  setHydrating: (): void => undefined,
}

const paneToShape = (
  pane: PersistedWorkspacePane
): PersistedWorkspacePaneShape =>
  pane.kind === 'shell'
    ? {
        kind: 'shell',
        paneId: pane.paneId,
        paneIndex: pane.paneIndex,
        active: pane.active,
        ptyId: pane.ptyId,
        cwd: pane.cwd,
        agentType: pane.agentType,
        agentSessionId: pane.agentSessionId,
      }
    : {
        kind: 'browser',
        paneId: pane.paneId,
        paneIndex: pane.paneIndex,
        active: pane.active,
      }

// Project the persisted store to its shape-only form: pane existence + shell
// fields, with browser tab/history stripped (those stay main-side).
const storeToShape = (
  store: PersistedWorkspaceLayoutStore
): PersistedWorkspaceShape => ({
  customPaneLayouts: store.customPaneLayouts,
  sessions: store.sessions.map((session) => ({
    id: session.id,
    projectId: session.projectId,
    layout: session.layout,
    workingDirectory: session.workingDirectory,
    active: session.active,
    open: session.open,
    panes: session.panes.map(paneToShape),
  })),
})

const emptyWorkspaceShape = (): PersistedWorkspaceShape => ({
  customPaneLayouts: [],
  sessions: [],
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string'

const isLoadWorkspaceForRestoreRequest = (
  request: unknown
): request is LoadWorkspaceForRestoreRequest => {
  if (!isRecord(request)) {
    return false
  }

  return (
    typeof request.projectId === 'string' &&
    typeof request.workingDirectory === 'string'
  )
}

const hasShapePaneBase = (pane: Record<string, unknown>): boolean =>
  typeof pane.paneId === 'string' &&
  typeof pane.paneIndex === 'number' &&
  Number.isFinite(pane.paneIndex) &&
  typeof pane.active === 'boolean'

const isPersistedWorkspacePaneShape = (
  pane: unknown
): pane is PersistedWorkspacePaneShape => {
  if (!isRecord(pane) || !hasShapePaneBase(pane)) {
    return false
  }

  if (pane.kind === 'browser') {
    return true
  }

  return (
    pane.kind === 'shell' &&
    typeof pane.ptyId === 'string' &&
    typeof pane.cwd === 'string' &&
    typeof pane.agentType === 'string' &&
    isNullableString(pane.agentSessionId)
  )
}

const isPersistedWorkspaceSessionShape = (
  session: unknown
): session is PersistedWorkspaceSessionShape => {
  if (!isRecord(session)) {
    return false
  }

  return (
    typeof session.id === 'string' &&
    typeof session.projectId === 'string' &&
    typeof session.layout === 'string' &&
    typeof session.workingDirectory === 'string' &&
    typeof session.active === 'boolean' &&
    typeof session.open === 'boolean' &&
    Array.isArray(session.panes) &&
    session.panes.every(isPersistedWorkspacePaneShape)
  )
}

const isPersistedWorkspaceShape = (
  dto: unknown
): dto is PersistedWorkspaceShape =>
  isRecord(dto) &&
  (dto.customPaneLayouts === undefined ||
    (Array.isArray(dto.customPaneLayouts) &&
      dto.customPaneLayouts.every(isRecord))) &&
  Array.isArray(dto.sessions) &&
  dto.sessions.every(isPersistedWorkspaceSessionShape)

const normalizeWorkspaceShape = (
  dto: PersistedWorkspaceShape
): PersistedWorkspaceShape => ({
  customPaneLayouts: dto.customPaneLayouts ?? [],
  sessions: dto.sessions,
})

const cloneTabs = (tabs: PersistedTab[]): PersistedTab[] =>
  tabs.map((tab) => ({
    active: tab.active,
    historyIndex: tab.historyIndex,
    history: tab.history.map((entry) => ({
      url: entry.url,
      title: entry.title,
    })),
  }))

interface PendingFinalShape {
  resolve: (dto: PersistedWorkspaceShape | null) => void
  timer: ReturnType<typeof setTimeout>
}

export class WorkspaceLayoutController {
  private readonly sidecar: SidecarInvoker
  private readonly writer: WorkspaceLayoutWriterPort
  private shape: PersistedWorkspaceShape | null = null
  private store: PersistedWorkspaceLayoutStore | null = null
  private pendingFinalShape: PendingFinalShape | null = null
  private installedOn: IpcMainLike | null = null
  private hydrationDepth = 0

  constructor(deps: WorkspaceLayoutControllerDeps) {
    this.sidecar = deps.sidecar
    this.writer = deps.writer ?? noopWriter
  }

  get latestShapeDto(): PersistedWorkspaceShape | null {
    return this.shape
  }

  get loadedStore(): PersistedWorkspaceLayoutStore | null {
    return this.store
  }

  pushShape(dto: PersistedWorkspaceShape): void {
    const normalized = normalizeWorkspaceShape(dto)

    this.shape = normalized
    this.writer.onShapePushed(normalized)
    this.resolveFinalShape(normalized)
  }

  async loadForRestore(
    request: LoadWorkspaceForRestoreRequest
  ): Promise<PersistedWorkspaceShape> {
    const store = await this.sidecar.invoke<PersistedWorkspaceLayoutStore>(
      'load_workspace_layout',
      {
        projectId: request.projectId,
        workingDirectory: request.workingDirectory,
      }
    )
    this.store = store

    return storeToShape(store)
  }

  // Return repaired browser tabs from the in-memory loaded store.
  tabsForPane(sessionId: string, paneId: string): PersistedTab[] | null {
    const session = this.store?.sessions.find((s) => s.id === sessionId)
    const pane = session?.panes.find((p) => p.paneId === paneId)
    if (pane?.kind !== 'browser') {
      return null
    }

    return cloneTabs(pane.tabs)
  }

  // Ask the renderer for one fresh shape during the close flush; resolves with
  // the renderer's ack push, or the last-known shape on timeout (never hangs
  // quit). Exactly one request may be pending at a time.
  requestFinalShape(
    sender: RendererSender,
    timeoutMs = DEFAULT_FINAL_SHAPE_TIMEOUT_MS
  ): Promise<PersistedWorkspaceShape | null> {
    if (this.pendingFinalShape !== null) {
      throw new Error('workspace layout final shape request already pending')
    }

    sender.send(WORKSPACE_LAYOUT_REQUEST_FINAL_SHAPE, {})

    return new Promise<PersistedWorkspaceShape | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingFinalShape = null
        resolve(this.shape)
      }, timeoutMs)
      this.pendingFinalShape = { resolve, timer }
    })
  }

  beginHydration(): void {
    const wasHydrating = this.hydrationDepth > 0
    this.hydrationDepth += 1

    if (!wasHydrating) {
      this.writer.setHydrating(true)
    }
  }

  endHydration(): void {
    if (this.hydrationDepth === 0) {
      return
    }

    this.hydrationDepth -= 1

    if (this.hydrationDepth === 0) {
      this.writer.setHydrating(false)
    }
  }

  install(ipcMain: IpcMainLike): void {
    ipcMain.handle(WORKSPACE_LAYOUT_PUSH_SHAPE, (_event, dto): void => {
      if (!isPersistedWorkspaceShape(dto)) {
        return
      }

      this.pushShape(dto)
    })

    ipcMain.handle(WORKSPACE_LAYOUT_LOAD_FOR_RESTORE, (_event, request) => {
      if (!isLoadWorkspaceForRestoreRequest(request)) {
        return emptyWorkspaceShape()
      }

      return this.loadForRestore(request)
    })

    ipcMain.handle(WORKSPACE_LAYOUT_BEGIN_HYDRATION, (): void => {
      this.beginHydration()
    })

    ipcMain.handle(WORKSPACE_LAYOUT_END_HYDRATION, (): void => {
      this.endHydration()
    })
    this.installedOn = ipcMain
  }

  dispose(): void {
    this.installedOn?.removeHandler(WORKSPACE_LAYOUT_PUSH_SHAPE)
    this.installedOn?.removeHandler(WORKSPACE_LAYOUT_LOAD_FOR_RESTORE)
    this.installedOn?.removeHandler(WORKSPACE_LAYOUT_BEGIN_HYDRATION)
    this.installedOn?.removeHandler(WORKSPACE_LAYOUT_END_HYDRATION)
    this.installedOn = null

    if (this.pendingFinalShape) {
      clearTimeout(this.pendingFinalShape.timer)
      this.pendingFinalShape.resolve(this.shape)
      this.pendingFinalShape = null
    }
  }

  private resolveFinalShape(dto: PersistedWorkspaceShape | null): void {
    if (!this.pendingFinalShape) {
      return
    }
    clearTimeout(this.pendingFinalShape.timer)
    this.pendingFinalShape.resolve(dto)
    this.pendingFinalShape = null
  }
}

export interface SetupWorkspaceLayoutControllerOptions extends WorkspaceLayoutControllerDeps {
  ipcMain: IpcMainLike
}

export const setupWorkspaceLayoutController = (
  options: SetupWorkspaceLayoutControllerOptions
): WorkspaceLayoutController => {
  const controller = new WorkspaceLayoutController({
    sidecar: options.sidecar,
    writer: options.writer,
  })
  controller.install(options.ipcMain)

  return controller
}
