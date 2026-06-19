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
  PersistedWorkspaceShape,
  PersistedWorkspaceLayoutStore,
  PersistedWorkspacePane,
  WorkspaceLayoutWriterPort,
  WorkspaceLayoutWriteSignals,
} from './workspace-layout-types'

// Mirrors the Rust CURRENT_WORKSPACE_LAYOUT_VERSION; a reader accepts only this.
export const CURRENT_WORKSPACE_LAYOUT_VERSION = 1

const DEFAULT_VOLATILE_DEBOUNCE_MS = 500

interface SidecarSaver {
  invoke: <T>(method: string, args?: Record<string, unknown>) => Promise<T>
}

type CaptureTabs = (sessionId: string, paneId: string) => PersistedTab[] | null
type TabsForPane = (sessionId: string, paneId: string) => PersistedTab[] | null

export interface WorkspaceLayoutWriterDeps {
  sidecar: SidecarSaver
  // Reads the live per-tab history for a browser pane (browser-pane controller).
  captureTabsForPane: CaptureTabs
  // Reads tabs from the loaded store before a live browser pane has been
  // materialized. Used only as a fallback, never after the pane was removed.
  preservedTabsForPane?: TabsForPane
  debounceMs?: number
}

const browserPaneKey = (sessionId: string, paneId: string): string =>
  `${sessionId}:${paneId}`

const cloneTabs = (tabs: PersistedTab[]): PersistedTab[] =>
  tabs.map((tab) => ({
    active: tab.active,
    historyIndex: tab.historyIndex,
    history: tab.history.map((entry) => ({
      url: entry.url,
      title: entry.title,
    })),
  }))

const browserPaneKeysFromShape = (
  shape: PersistedWorkspaceShape
): Set<string> =>
  new Set(
    shape.sessions.flatMap((session) =>
      session.panes
        .filter((pane) => pane.kind === 'browser')
        .map((pane) => browserPaneKey(session.id, pane.paneId))
    )
  )

export class WorkspaceLayoutWriter
  implements WorkspaceLayoutWriterPort, WorkspaceLayoutWriteSignals
{
  private readonly sidecar: SidecarSaver
  private readonly captureTabsForPane: CaptureTabs
  private readonly preservedTabsForPane: TabsForPane | null
  private readonly debounceMs: number
  private shape: PersistedWorkspaceShape | null = null
  private hydrating = false
  private latestGeneration = 0
  private committedGeneration = 0
  private chain: Promise<void> = Promise.resolve()
  private volatileTimer: ReturnType<typeof setTimeout> | null = null
  private failedWrite: { generation: number; error: unknown } | null = null
  private readonly lastTabsByBrowserPane = new Map<string, PersistedTab[]>()
  private browserPaneKeys = new Set<string>()
  private readonly removedBrowserPaneKeys = new Set<string>()

  constructor(deps: WorkspaceLayoutWriterDeps) {
    this.sidecar = deps.sidecar
    this.captureTabsForPane = deps.captureTabsForPane
    this.preservedTabsForPane = deps.preservedTabsForPane ?? null
    this.debounceMs = deps.debounceMs ?? DEFAULT_VOLATILE_DEBOUNCE_MS
  }

  onShapePushed(dto: PersistedWorkspaceShape): void {
    this.noteBrowserPaneShape(dto)
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

    const sessions: PersistedWorkspaceLayoutStore['sessions'] = []
    for (const session of this.shape.sessions) {
      const panes: PersistedWorkspacePane[] = []
      for (const pane of session.panes) {
        if (pane.kind === 'shell') {
          panes.push({
            kind: 'shell',
            paneId: pane.paneId,
            paneIndex: pane.paneIndex,
            active: pane.active,
            ptyId: pane.ptyId,
            cwd: pane.cwd,
            agentType: pane.agentType,
            agentSessionId: pane.agentSessionId,
          })

          continue
        }

        const tabs = this.tabsForBrowserPane(session.id, pane.paneId)
        if (tabs === null) {
          return null
        }

        panes.push({
          kind: 'browser',
          paneId: pane.paneId,
          paneIndex: pane.paneIndex,
          active: pane.active,
          tabs,
        })
      }

      sessions.push({
        id: session.id,
        projectId: session.projectId,
        layout: session.layout,
        workingDirectory: session.workingDirectory,
        active: session.active,
        open: session.open,
        panes,
      })
    }

    return {
      version: CURRENT_WORKSPACE_LAYOUT_VERSION,
      customPaneLayouts: this.shape.customPaneLayouts ?? [],
      sessions,
    }
  }

  // Cancel any pending debounce, write the latest snapshot, and await the queue
  // to drain — used by the window-close flush (spec §3.2) and tests.
  async flush(): Promise<void> {
    this.cancelVolatile()
    const generation = this.enqueueWrite()
    if (generation === null && this.shape !== null) {
      throw new Error('workspace layout flush could not assemble current shape')
    }

    for (;;) {
      const pending = this.chain
      await pending

      if (this.committedGeneration >= this.latestGeneration) {
        return
      }

      if (
        this.failedWrite !== null &&
        this.failedWrite.generation === this.latestGeneration
      ) {
        throw this.failedWrite.error
      }

      if (pending === this.chain) {
        throw new Error(
          'workspace layout flush did not commit latest generation'
        )
      }
    }
  }

  private cancelVolatile(): void {
    if (this.volatileTimer) {
      clearTimeout(this.volatileTimer)
      this.volatileTimer = null
    }
  }

  private enqueueWrite(): number | null {
    const store = this.assemble()
    if (!store) {
      return null
    }
    const generation = (this.latestGeneration += 1)
    // eslint-disable-next-line promise/prefer-await-to-then
    this.chain = this.chain.then(() => this.commit(generation, store))

    return generation
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
      if (
        this.failedWrite !== null &&
        this.failedWrite.generation <= generation
      ) {
        this.failedWrite = null
      }
    } catch (error) {
      // A failed save must not wedge the queue; the next change reassembles
      // and retries from the live shape.
      this.failedWrite = { generation, error }
      this.committedGeneration = generation - 1
    }
  }

  private noteBrowserPaneShape(dto: PersistedWorkspaceShape): void {
    const nextKeys = browserPaneKeysFromShape(dto)

    for (const key of this.browserPaneKeys) {
      if (!nextKeys.has(key)) {
        this.removedBrowserPaneKeys.add(key)
        this.lastTabsByBrowserPane.delete(key)
      }
    }

    for (const key of nextKeys) {
      this.removedBrowserPaneKeys.delete(key)
    }

    this.browserPaneKeys = nextKeys
  }

  private tabsForBrowserPane(
    sessionId: string,
    paneId: string
  ): PersistedTab[] | null {
    const key = browserPaneKey(sessionId, paneId)
    const liveTabs = this.captureTabsForPane(sessionId, paneId)
    if (liveTabs !== null) {
      this.removedBrowserPaneKeys.delete(key)
      this.lastTabsByBrowserPane.set(key, cloneTabs(liveTabs))

      return cloneTabs(liveTabs)
    }

    const rememberedTabs = this.lastTabsByBrowserPane.get(key)
    if (rememberedTabs !== undefined) {
      return cloneTabs(rememberedTabs)
    }

    if (this.removedBrowserPaneKeys.has(key)) {
      return null
    }

    const preservedTabs = this.preservedTabsForPane?.(sessionId, paneId) ?? null
    if (preservedTabs !== null) {
      this.lastTabsByBrowserPane.set(key, cloneTabs(preservedTabs))

      return cloneTabs(preservedTabs)
    }

    // A newly-created browser pane can reach the renderer shape before main has
    // created its WebContentsView. Persist an empty tab set; Rust repair seeds
    // the default tab on restore if this is the last snapshot before teardown.
    return []
  }
}
