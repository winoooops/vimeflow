export interface BrowserPaneBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserPaneShortcutContext {
  paneIds: string[]
  activePaneId: string | null
}

export interface BrowserPaneCreateRequest {
  sessionId: string
  paneId: string
  workspaceId: string
  initialUrl: string
  shortcutContext?: BrowserPaneShortcutContext
}

export interface BrowserPaneCreateResult {
  url: string
  title: string | null
  partition: string
}

export interface BrowserPaneBoundsRequest {
  sessionId: string
  paneId: string
  bounds: BrowserPaneBounds
  visible: boolean
  shortcutContext?: BrowserPaneShortcutContext
}

export interface BrowserPaneNavigateRequest {
  sessionId: string
  paneId: string
  url: string
}

export interface BrowserPaneDestroyRequest {
  sessionId: string
  paneId: string
}

export interface BrowserCdpInfo {
  url: string
  token: string
  origin: string
  targetId: string
}

export interface BrowserPaneFocusedEvent {
  sessionId: string
  paneId: string
}

export interface BrowserPaneUrlChangedEvent {
  sessionId: string
  paneId: string
  url: string
  title: string | null
}

export interface BrowserPaneBridge {
  createPane: (
    request: BrowserPaneCreateRequest
  ) => Promise<BrowserPaneCreateResult>
  setBounds: (request: BrowserPaneBoundsRequest) => Promise<void>
  navigate: (request: BrowserPaneNavigateRequest) => Promise<void>
  destroyPane: (request: BrowserPaneDestroyRequest) => Promise<void>
  focusPane: (request: BrowserPaneDestroyRequest) => Promise<void>
  getCdpInfo: (request: BrowserPaneDestroyRequest) => Promise<BrowserCdpInfo>
  onFocus: (callback: (event: BrowserPaneFocusedEvent) => void) => () => void
  onUrlChange: (
    callback: (event: BrowserPaneUrlChangedEvent) => void
  ) => () => void
}
