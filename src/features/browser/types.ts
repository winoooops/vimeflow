// Keep in sync with electron/browser-pane.ts DEFAULT_BROWSER_URL (main/renderer project boundary prevents sharing a module).
export const DEFAULT_BROWSER_URL = 'https://www.youtube.com/'

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

export interface BrowserPaneTab {
  id: string
  url: string
  title: string | null
  active: boolean
}

export interface BrowserPaneCreateResult {
  url: string
  title: string | null
  partition: string
  tabs: BrowserPaneTab[]
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

export interface BrowserPaneNewTabRequest extends BrowserPaneDestroyRequest {
  url?: string
}

export interface BrowserPaneTabRequest extends BrowserPaneDestroyRequest {
  tabId: string
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
  tabId: string
  url: string
  title: string | null
  tabs: BrowserPaneTab[]
}

export interface BrowserPaneTabsChangedEvent {
  sessionId: string
  paneId: string
  tabs: BrowserPaneTab[]
}

export interface BrowserPaneBridge {
  createPane: (
    request: BrowserPaneCreateRequest
  ) => Promise<BrowserPaneCreateResult>
  setBounds: (request: BrowserPaneBoundsRequest) => Promise<void>
  navigate: (request: BrowserPaneNavigateRequest) => Promise<void>
  newTab: (request: BrowserPaneNewTabRequest) => Promise<void>
  destroyPane: (request: BrowserPaneDestroyRequest) => Promise<void>
  focusPane: (request: BrowserPaneDestroyRequest) => Promise<void>
  getCdpInfo: (request: BrowserPaneDestroyRequest) => Promise<BrowserCdpInfo>
  activateTab: (request: BrowserPaneTabRequest) => Promise<void>
  closeTab: (request: BrowserPaneTabRequest) => Promise<void>
  onFocus: (callback: (event: BrowserPaneFocusedEvent) => void) => () => void
  onUrlChange: (
    callback: (event: BrowserPaneUrlChangedEvent) => void
  ) => () => void
  onTabsChange: (
    callback: (event: BrowserPaneTabsChangedEvent) => void
  ) => () => void
}
