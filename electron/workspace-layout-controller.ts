// Main-side workspace-layout controller (spec §3.2). The connective tissue for
// the single-writer durable store: it receives the renderer's shape-only DTO,
// loads + retains the repaired store in memory for restore, brackets hydration,
// and drives the close-flush "final shape" handshake. The assembler/writer
// (Task 9) and restore-tab serving (Task 11) plug into the ports it defines;
// this task ships the skeleton with a no-op writer.

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
  RendererSender,
  WorkspaceLayoutWriterPort,
  WorkspaceShapeDto,
  WorkspaceShapePane,
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

const paneToShape = (pane: PersistedWorkspacePane): WorkspaceShapePane =>
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
): WorkspaceShapeDto => ({
  sessions: store.sessions.map((session) => ({
    id: session.id,
    projectId: session.projectId,
    layout: session.layout,
    workingDirectory: session.workingDirectory,
    active: session.active,
    panes: session.panes.map(paneToShape),
  })),
})

const emptyWorkspaceShape = (): WorkspaceShapeDto => ({ sessions: [] })

const isLoadWorkspaceForRestoreRequest = (
  request: unknown
): request is LoadWorkspaceForRestoreRequest => {
  if (!request || typeof request !== 'object') {
    return false
  }

  const record = request as Record<string, unknown>

  return (
    typeof record.projectId === 'string' &&
    typeof record.workingDirectory === 'string'
  )
}

interface PendingFinalShape {
  resolve: (dto: WorkspaceShapeDto | null) => void
  timer: ReturnType<typeof setTimeout>
}

export class WorkspaceLayoutController {
  private readonly sidecar: SidecarInvoker
  private readonly writer: WorkspaceLayoutWriterPort
  private shape: WorkspaceShapeDto | null = null
  private store: PersistedWorkspaceLayoutStore | null = null
  private pendingFinalShape: PendingFinalShape | null = null
  private installedOn: IpcMainLike | null = null

  constructor(deps: WorkspaceLayoutControllerDeps) {
    this.sidecar = deps.sidecar
    this.writer = deps.writer ?? noopWriter
  }

  get latestShapeDto(): WorkspaceShapeDto | null {
    return this.shape
  }

  get loadedStore(): PersistedWorkspaceLayoutStore | null {
    return this.store
  }

  pushShape(dto: WorkspaceShapeDto): void {
    this.shape = dto
    this.writer.onShapePushed(dto)
    this.resolveFinalShape(dto)
  }

  async loadForRestore(
    request: LoadWorkspaceForRestoreRequest
  ): Promise<WorkspaceShapeDto> {
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

  // Restore-tab serving (Task 11 consumer): the repaired tabs for a browser
  // pane, looked up in the in-memory loaded store by (sessionId, paneId).
  tabsForPane(sessionId: string, paneId: string): PersistedTab[] | null {
    const session = this.store?.sessions.find((s) => s.id === sessionId)
    const pane = session?.panes.find((p) => p.paneId === paneId)
    if (pane?.kind !== 'browser') {
      return null
    }

    return pane.tabs
  }

  // Ask the renderer for one fresh shape during the close flush; resolves with
  // the renderer's ack push, or the last-known shape on timeout (never hangs
  // quit). Supersedes any in-flight request.
  requestFinalShape(
    sender: RendererSender,
    timeoutMs = DEFAULT_FINAL_SHAPE_TIMEOUT_MS
  ): Promise<WorkspaceShapeDto | null> {
    this.resolveFinalShape(this.shape)
    sender.send(WORKSPACE_LAYOUT_REQUEST_FINAL_SHAPE, {})

    return new Promise<WorkspaceShapeDto | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingFinalShape = null
        resolve(this.shape)
      }, timeoutMs)
      this.pendingFinalShape = { resolve, timer }
    })
  }

  beginHydration(): void {
    this.writer.setHydrating(true)
  }

  endHydration(): void {
    this.writer.setHydrating(false)
  }

  install(ipcMain: IpcMainLike): void {
    ipcMain.handle(WORKSPACE_LAYOUT_PUSH_SHAPE, (_event, dto): void => {
      if (
        !dto ||
        typeof dto !== 'object' ||
        !Array.isArray((dto as Record<string, unknown>).sessions)
      ) {
        return
      }
      this.pushShape(dto as WorkspaceShapeDto)
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

  private resolveFinalShape(dto: WorkspaceShapeDto | null): void {
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
