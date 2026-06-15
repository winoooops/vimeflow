import type {
  BrowserCdpInfo,
  BrowserPaneBoundsRequest,
  BrowserPaneBridge,
  BrowserPaneCreateRequest,
  BrowserPaneCreateResult,
  BrowserPaneDestroyRequest,
  BrowserPaneFocusAddressEvent,
  BrowserPaneFocusedEvent,
  BrowserPaneNewTabRequest,
  BrowserPaneRef,
  BrowserPaneUrlChangedEvent,
  BrowserPaneTabRequest,
  BrowserPaneTabsChangedEvent,
  BrowserPaneNavigateRequest,
  BrowserPaneNavActionRequest,
  BrowserPaneNavStateChangedEvent,
} from './types'

export interface BrowserPaneBoundsCapture extends BrowserPaneBoundsRequest {
  sequence: number
}

type BrowserCapableWindow = Window & {
  vimeflow?: {
    browserPane?: BrowserPaneBridge
  }
}

let browserPaneBoundsCaptureActive = false
let browserPaneBoundsCaptures: BrowserPaneBoundsCapture[] = []
let browserPaneBoundsSequence = 0

const bridge = (): BrowserPaneBridge | undefined => {
  if (typeof window === 'undefined') {
    return undefined
  }

  return (window as BrowserCapableWindow).vimeflow?.browserPane
}

const cloneBoundsCapture = (
  request: BrowserPaneBoundsRequest
): BrowserPaneBoundsCapture => {
  const capture: BrowserPaneBoundsCapture = {
    sequence: browserPaneBoundsSequence,
    sessionId: request.sessionId,
    paneId: request.paneId,
    bounds: { ...request.bounds },
    visible: request.visible,
  }
  browserPaneBoundsSequence += 1

  if (request.shortcutContext) {
    capture.shortcutContext = {
      paneIds: [...request.shortcutContext.paneIds],
      activePaneId: request.shortcutContext.activePaneId,
    }
  }

  return capture
}

export const startBrowserPaneBoundsCapture = (): boolean => {
  if (!bridge()) {
    return false
  }

  if (browserPaneBoundsCaptureActive) {
    return true
  }

  browserPaneBoundsCaptureActive = true
  browserPaneBoundsCaptures = []
  browserPaneBoundsSequence = 0

  return true
}

export const clearBrowserPaneBoundsCaptures = (): void => {
  browserPaneBoundsCaptures = []
}

export const stopBrowserPaneBoundsCapture = (): void => {
  browserPaneBoundsCaptureActive = false
}

export const getBrowserPaneBoundsCaptures = (): BrowserPaneBoundsCapture[] =>
  browserPaneBoundsCaptures.map((capture) => {
    const nextCapture: BrowserPaneBoundsCapture = {
      ...capture,
      bounds: { ...capture.bounds },
    }

    if (capture.shortcutContext) {
      nextCapture.shortcutContext = {
        paneIds: [...capture.shortcutContext.paneIds],
        activePaneId: capture.shortcutContext.activePaneId,
      }
    }

    return nextCapture
  })

export const createBrowserPane = async (
  request: BrowserPaneCreateRequest
): Promise<BrowserPaneCreateResult> => {
  const browserBridge = bridge()
  if (!browserBridge) {
    return {
      url: request.initialUrl ?? '',
      title: null,
      partition: `persist:vimeflow-browser:${request.workspaceId}:${request.sessionId}`,
      tabs: [
        {
          id: 'tab-0',
          url: request.initialUrl ?? '',
          title: null,
          active: true,
          favicon: null,
        },
      ],
      navState: { canGoBack: false, canGoForward: false, isLoading: false },
    }
  }

  return browserBridge.createPane(request)
}

export const setBrowserPaneBounds = async (
  request: BrowserPaneBoundsRequest
): Promise<void> => {
  const browserBridge = bridge()

  if (browserPaneBoundsCaptureActive && browserBridge) {
    browserPaneBoundsCaptures.push(cloneBoundsCapture(request))
  }

  await browserBridge?.setBounds(request)
}

export const navigateBrowserPane = async (
  request: BrowserPaneNavigateRequest
): Promise<void> => {
  await bridge()?.navigate(request)
}

export const newBrowserPaneTab = async (
  request: BrowserPaneNewTabRequest
): Promise<void> => {
  await bridge()?.newTab(request)
}

export const destroyBrowserPane = async (
  request: BrowserPaneDestroyRequest
): Promise<void> => {
  await bridge()?.destroyPane(request)
}

export const focusBrowserPane = async (
  request: BrowserPaneRef
): Promise<void> => {
  await bridge()?.focusPane(request)
}

export const getBrowserCdpInfo = async (
  request: BrowserPaneRef
): Promise<BrowserCdpInfo | null> => bridge()?.getCdpInfo(request) ?? null

export const activateBrowserPaneTab = async (
  request: BrowserPaneTabRequest
): Promise<void> => {
  await bridge()?.activateTab(request)
}

export const closeBrowserPaneTab = async (
  request: BrowserPaneTabRequest
): Promise<void> => {
  await bridge()?.closeTab(request)
}

export const openExternalBrowserPane = async (
  request: BrowserPaneRef
): Promise<void> => {
  await bridge()?.openExternal(request)
}

export const navActionBrowserPane = async (
  request: BrowserPaneNavActionRequest
): Promise<void> => {
  await bridge()?.navAction(request)
}

export const onBrowserPaneFocus = (
  callback: (event: BrowserPaneFocusedEvent) => void
): (() => void) => bridge()?.onFocus(callback) ?? ((): void => undefined)

export const onBrowserPaneUrlChange = (
  callback: (event: BrowserPaneUrlChangedEvent) => void
): (() => void) => bridge()?.onUrlChange(callback) ?? ((): void => undefined)

export const onBrowserPaneTabsChange = (
  callback: (event: BrowserPaneTabsChangedEvent) => void
): (() => void) => bridge()?.onTabsChange(callback) ?? ((): void => undefined)

export const onBrowserPaneFocusAddress = (
  callback: (event: BrowserPaneFocusAddressEvent) => void
): (() => void) => bridge()?.onFocusAddress(callback) ?? ((): void => undefined)

export const onBrowserPaneNavStateChange = (
  callback: (event: BrowserPaneNavStateChangedEvent) => void
): (() => void) =>
  bridge()?.onNavStateChange(callback) ?? ((): void => undefined)
