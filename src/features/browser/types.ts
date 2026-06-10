// Keep in sync with electron/browser-pane.ts DEFAULT_BROWSER_URL (main/renderer project boundary prevents sharing a module).
export const DEFAULT_BROWSER_URL = 'https://www.google.com/'

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
  // Optional under restore: main replays each tab's history instead of loading.
  initialUrl?: string
  restore?: boolean
  shortcutContext?: BrowserPaneShortcutContext
}

export interface BrowserPaneTab {
  id: string
  url: string
  title: string | null
  active: boolean
  favicon: string | null
}

export interface BrowserPaneCreateResult {
  url: string
  title: string | null
  partition: string
  tabs: BrowserPaneTab[]
  navState: BrowserPaneNavState
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

// Minimal identity of a browser pane — the fields every pane-scoped IPC needs.
// Operations that only locate a pane (focus, CDP-info) take this directly;
// the destroy path keeps its intent-named alias below.
export interface BrowserPaneRef {
  sessionId: string
  paneId: string
}

export type BrowserPaneNavActionKind = 'back' | 'forward' | 'reload' | 'stop'

export interface BrowserPaneNavActionRequest extends BrowserPaneRef {
  action: BrowserPaneNavActionKind
}

export interface BrowserPaneNavState {
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
}

export interface BrowserPaneNavStateChangedEvent extends BrowserPaneNavState {
  sessionId: string
  paneId: string
  tabId: string
}

export type BrowserPaneDestroyRequest = BrowserPaneRef

export interface BrowserPaneNewTabRequest extends BrowserPaneRef {
  url?: string
}

export interface BrowserPaneTabRequest extends BrowserPaneRef {
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

export interface BrowserPaneFocusAddressEvent {
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
  focusPane: (request: BrowserPaneRef) => Promise<void>
  getCdpInfo: (request: BrowserPaneRef) => Promise<BrowserCdpInfo>
  activateTab: (request: BrowserPaneTabRequest) => Promise<void>
  closeTab: (request: BrowserPaneTabRequest) => Promise<void>
  openExternal: (request: BrowserPaneRef) => Promise<void>
  navAction: (request: BrowserPaneNavActionRequest) => Promise<void>
  onFocus: (callback: (event: BrowserPaneFocusedEvent) => void) => () => void
  onFocusAddress: (
    callback: (event: BrowserPaneFocusAddressEvent) => void
  ) => () => void
  onUrlChange: (
    callback: (event: BrowserPaneUrlChangedEvent) => void
  ) => () => void
  onTabsChange: (
    callback: (event: BrowserPaneTabsChangedEvent) => void
  ) => () => void
  onNavStateChange: (
    callback: (event: BrowserPaneNavStateChangedEvent) => void
  ) => () => void
}
