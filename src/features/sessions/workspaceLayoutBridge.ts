// Renderer-side access to the main-process workspace-layout controller
// (spec §3.2). Mirrors browserBridge.ts: it reaches window.vimeflow via a local
// cast and degrades to no-ops when the preload bridge is absent (web/dev/tests).
//
// The shape-only DTO defined here is the renderer<->main contract: it carries
// pane existence + shell fields, never browser tab/history (main owns those).

export interface WorkspaceShapeShellPane {
  kind: 'shell'
  paneId: string
  paneIndex: number
  active: boolean
  ptyId: string
  cwd: string
  agentType: string
  agentSessionId: string | null
}

export interface WorkspaceShapeBrowserPane {
  kind: 'browser'
  paneId: string
  paneIndex: number
  active: boolean
}

export type WorkspaceShapePane =
  | WorkspaceShapeShellPane
  | WorkspaceShapeBrowserPane

export interface WorkspaceShapeSession {
  id: string
  projectId: string
  layout: string
  workingDirectory: string
  active: boolean
  panes: WorkspaceShapePane[]
}

export interface WorkspaceShapeDto {
  sessions: WorkspaceShapeSession[]
}

export interface LoadWorkspaceForRestoreRequest {
  projectId: string
  workingDirectory: string
}

export interface WorkspaceLayoutBridge {
  pushShape: (dto: WorkspaceShapeDto) => Promise<void>
  loadForRestore: (
    request: LoadWorkspaceForRestoreRequest
  ) => Promise<WorkspaceShapeDto>
  beginHydration: () => Promise<void>
  endHydration: () => Promise<void>
  onRequestFinalShape: (callback: () => void) => () => void
}

type WorkspaceLayoutCapableWindow = Window & {
  vimeflow?: {
    workspaceLayout?: WorkspaceLayoutBridge
  }
}

const bridge = (): WorkspaceLayoutBridge | undefined => {
  if (typeof window === 'undefined') {
    return undefined
  }

  return (window as WorkspaceLayoutCapableWindow).vimeflow?.workspaceLayout
}

export const pushWorkspaceShape = async (
  dto: WorkspaceShapeDto
): Promise<void> => {
  await bridge()?.pushShape(dto)
}

export const loadWorkspaceForRestore = async (
  request: LoadWorkspaceForRestoreRequest
): Promise<WorkspaceShapeDto | null> =>
  bridge()?.loadForRestore(request) ?? null

export const beginWorkspaceHydration = async (): Promise<void> => {
  await bridge()?.beginHydration()
}

export const endWorkspaceHydration = async (): Promise<void> => {
  await bridge()?.endHydration()
}

export const onWorkspaceRequestFinalShape = (
  callback: () => void
): (() => void) =>
  bridge()?.onRequestFinalShape(callback) ?? ((): void => undefined)
