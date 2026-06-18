// Electron-side workspace-layout types (spec §2 / §3.2).
//
// Two distinct shapes:
//  - The persisted store (`PersistedWorkspaceLayoutStore`) mirrors the Rust
//    `WorkspaceLayoutStore` binding; it carries full browser tab + history.
//  - The shape-only DTO (`PersistedWorkspaceShape`) is what the renderer pushes and
//    what `load` returns to the renderer; it omits browser tab/history (main
//    owns those via the WebContents) and keeps shell pane fields.
//
// Following the electron/src decoupling convention (see browser-pane.ts), these
// are defined here rather than imported from src/bindings; a type-level test
// guards them against drift from the generated bindings.

export interface PersistedNavEntry {
  url: string
  title: string | null
}

export interface PersistedTab {
  active: boolean
  history: PersistedNavEntry[]
  historyIndex: number
}

export interface PersistedShellPane {
  kind: 'shell'
  paneId: string
  paneIndex: number
  active: boolean
  ptyId: string
  cwd: string
  agentType: string
  agentSessionId: string | null
}

export interface PersistedBrowserPane {
  kind: 'browser'
  paneId: string
  paneIndex: number
  active: boolean
  tabs: PersistedTab[]
}

export type PersistedWorkspacePane = PersistedShellPane | PersistedBrowserPane

export interface PersistedWorkspaceSession {
  id: string
  projectId: string
  layout: string
  workingDirectory: string
  active: boolean
  panes: PersistedWorkspacePane[]
}

export interface PersistedWorkspaceLayoutStore {
  version: number
  sessions: PersistedWorkspaceSession[]
}

// Shape-only DTO (renderer <-> main). No browser tab/history.

export interface PersistedShellPaneShape {
  kind: 'shell'
  paneId: string
  paneIndex: number
  active: boolean
  ptyId: string
  cwd: string
  agentType: string
  agentSessionId: string | null
}

export interface PersistedBrowserPaneShape {
  kind: 'browser'
  paneId: string
  paneIndex: number
  active: boolean
}

export type PersistedWorkspacePaneShape =
  | PersistedShellPaneShape
  | PersistedBrowserPaneShape

export interface PersistedWorkspaceSessionShape {
  id: string
  projectId: string
  layout: string
  workingDirectory: string
  active: boolean
  panes: PersistedWorkspacePaneShape[]
}

export interface PersistedWorkspaceShape {
  sessions: PersistedWorkspaceSessionShape[]
}

// Arguments the renderer passes to load-for-restore so Rust can apply project
// defaults during repair (spec §2.2).
export interface LoadWorkspaceForRestoreRequest {
  projectId: string
  workingDirectory: string
}

// Port the single-writer assembler plugs into so the controller can drive it
// without depending on the concrete writer.
export interface WorkspaceLayoutWriterPort {
  onShapePushed: (dto: PersistedWorkspaceShape) => void
  setHydrating: (hydrating: boolean) => void
}

// Write-cadence signals the browser-pane controller raises: a tab
// open/close/active-switch is structural (immediate), an in-tab navigation is
// volatile (debounced). Kept minimal so browser-pane.ts needn't know the writer.
export interface WorkspaceLayoutWriteSignals {
  markStructural: () => void
  markVolatile: () => void
}

// Minimal subset of Electron's ipcMain the controller installs onto; injectable
// so tests need not mock the whole electron module.
export interface IpcMainLike {
  handle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => unknown
  ) => void
  removeHandler: (channel: string) => void
}

// Minimal renderer target for main->renderer sends (a WebContents).
export interface RendererSender {
  send: (channel: string, payload: unknown) => void
}
