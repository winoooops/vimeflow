// Single-writer workspace-layout assembler (spec §3.2). Main is the sole writer
// of the durable store: it holds the renderer's latest shape DTO and joins each
// browser pane with the live per-tab history it owns, then persists the whole
// `WorkspaceLayoutStore` as one atomic snapshot through the Rust save IPC.
//
// Write cadences:
//  - markStructural(): pane/layout/active + browser tab open/close/switch and
//    every renderer shape push → enqueue a write immediately.
//  - markVolatile(): in-tab navigation / cwd / agentType drift → debounced.
// All writes funnel through one in-order queue stamped with a monotonic
// generation; an older snapshot superseded by a newer enqueue is dropped
// (last-write-wins). While `hydrating`, every cadence is suppressed so restore
// can't overwrite saved history with empty tabs.

import type {
  PersistedTab,
  PersistedWorkspaceLayoutStore,
  PersistedWorkspacePane,
  WorkspaceLayoutWriterPort,
  WorkspaceLayoutWriteSignals,
  WorkspaceShapeDto,
} from './workspace-layout-types'

// Mirrors the Rust CURRENT_WORKSPACE_LAYOUT_VERSION; a reader accepts only this.
export const CURRENT_WORKSPACE_LAYOUT_VERSION = 1

const DEFAULT_VOLATILE_DEBOUNCE_MS = 500

interface SidecarSaver {
  invoke: <T>(method: string, args?: Record<string, unknown>) => Promise<T>
}

type CaptureTabs = (sessionId: string, paneId: string) => PersistedTab[] | null

export interface WorkspaceLayoutWriterDeps {
  sidecar: SidecarSaver
  // Reads the live per-tab history for a browser pane (browser-pane controller).
  captureTabsForPane: CaptureTabs
  debounceMs?: number
}

export class WorkspaceLayoutWriter
  implements WorkspaceLayoutWriterPort, WorkspaceLayoutWriteSignals
{
  private readonly sidecar: SidecarSaver
  private readonly captureTabsForPane: CaptureTabs
  private readonly debounceMs: number
  private shape: WorkspaceShapeDto | null = null
  private hydrating = false
  private latestGeneration = 0
  private committedGeneration = 0
  private chain: Promise<void> = Promise.resolve()
  private volatileTimer: ReturnType<typeof setTimeout> | null = null

  constructor(deps: WorkspaceLayoutWriterDeps) {
    this.sidecar = deps.sidecar
    this.captureTabsForPane = deps.captureTabsForPane
    this.debounceMs = deps.debounceMs ?? DEFAULT_VOLATILE_DEBOUNCE_MS
  }

  onShapePushed(dto: WorkspaceShapeDto): void {
    this.shape = dto
    this.markStructural()
  }

  setHydrating(hydrating: boolean): void {
    this.hydrating = hydrating
  }

  markStructural(): void {
    if (this.hydrating) {
      return
    }
    this.cancelVolatile()
    this.enqueueWrite()
  }

  markVolatile(): void {
    if (this.hydrating) {
      return
    }
    this.cancelVolatile()
    this.volatileTimer = setTimeout(() => {
      this.volatileTimer = null
      this.enqueueWrite()
    }, this.debounceMs)
  }

  // Build the full store from the latest shape, joining each browser pane with
  // its live tab history. Null until the renderer has pushed a shape.
  assemble(): PersistedWorkspaceLayoutStore | null {
    if (!this.shape) {
      return null
    }

    return {
      version: CURRENT_WORKSPACE_LAYOUT_VERSION,
      sessions: this.shape.sessions.map((session) => ({
        id: session.id,
        projectId: session.projectId,
        layout: session.layout,
        workingDirectory: session.workingDirectory,
        active: session.active,
        panes: session.panes.map(
          (pane): PersistedWorkspacePane =>
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
                  tabs: this.captureTabsForPane(session.id, pane.paneId) ?? [],
                }
        ),
      })),
    }
  }

  // Cancel any pending debounce, write the latest snapshot, and await the queue
  // to drain — used by the window-close flush (spec §3.2) and tests.
  async flush(): Promise<void> {
    this.cancelVolatile()
    this.enqueueWrite()
    await this.chain
  }

  private cancelVolatile(): void {
    if (this.volatileTimer) {
      clearTimeout(this.volatileTimer)
      this.volatileTimer = null
    }
  }

  private enqueueWrite(): void {
    const store = this.assemble()
    if (!store) {
      return
    }
    const generation = (this.latestGeneration += 1)
    // eslint-disable-next-line promise/prefer-await-to-then
    this.chain = this.chain.then(() => this.commit(generation, store))
  }

  private async commit(
    generation: number,
    store: PersistedWorkspaceLayoutStore
  ): Promise<void> {
    // Drop a snapshot a newer enqueue already superseded (coalesce), and one
    // older than what already committed (in-order safety).
    if (generation < this.latestGeneration) {
      return
    }
    if (generation <= this.committedGeneration) {
      return
    }
    this.committedGeneration = generation

    try {
      await this.sidecar.invoke('save_workspace_layout', { store })
    } catch {
      // A failed save must not wedge the queue; the next change reassembles
      // and retries from the live shape.
      this.committedGeneration = generation - 1
    }
  }
}
