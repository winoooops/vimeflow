import type {
  BrowserCdpInfo,
  BrowserPaneBoundsRequest,
  BrowserPaneBridge,
  BrowserPaneCreateRequest,
  BrowserPaneCreateResult,
  BrowserPaneDestroyRequest,
  BrowserPaneFocusedEvent,
  BrowserPaneUrlChangedEvent,
  BrowserPaneNavigateRequest,
} from './types'

type BrowserCapableWindow = Window & {
  vimeflow?: {
    browserPane?: BrowserPaneBridge
  }
}

const bridge = (): BrowserPaneBridge | undefined => {
  if (typeof window === 'undefined') {
    return undefined
  }

  return (window as BrowserCapableWindow).vimeflow?.browserPane
}

export const createBrowserPane = async (
  request: BrowserPaneCreateRequest
): Promise<BrowserPaneCreateResult> => {
  const browserBridge = bridge()
  if (!browserBridge) {
    return {
      url: request.initialUrl,
      title: null,
      partition: `persist:vimeflow-browser:${request.workspaceId}:${request.sessionId}`,
    }
  }

  return browserBridge.createPane(request)
}

export const setBrowserPaneBounds = async (
  request: BrowserPaneBoundsRequest
): Promise<void> => {
  await bridge()?.setBounds(request)
}

export const navigateBrowserPane = async (
  request: BrowserPaneNavigateRequest
): Promise<void> => {
  await bridge()?.navigate(request)
}

export const destroyBrowserPane = async (
  request: BrowserPaneDestroyRequest
): Promise<void> => {
  await bridge()?.destroyPane(request)
}

export const focusBrowserPane = async (
  request: BrowserPaneDestroyRequest
): Promise<void> => {
  await bridge()?.focusPane(request)
}

export const getBrowserCdpInfo = async (
  request: BrowserPaneDestroyRequest
): Promise<BrowserCdpInfo | null> => bridge()?.getCdpInfo(request) ?? null

export const onBrowserPaneFocus = (
  callback: (event: BrowserPaneFocusedEvent) => void
): (() => void) => bridge()?.onFocus(callback) ?? ((): void => undefined)

export const onBrowserPaneUrlChange = (
  callback: (event: BrowserPaneUrlChangedEvent) => void
): (() => void) => bridge()?.onUrlChange(callback) ?? ((): void => undefined)
