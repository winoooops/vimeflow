import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  BACKEND_EVENT,
  BACKEND_INVOKE,
  COMMAND_PALETTE_TOGGLE,
} from './ipc-channels'
import {
  BROWSER_PANE_ACTIVATE_TAB,
  BROWSER_PANE_CDP_INFO,
  BROWSER_PANE_CLOSE_TAB,
  BROWSER_PANE_CREATE,
  BROWSER_PANE_DESTROY,
  BROWSER_PANE_FOCUS,
  BROWSER_PANE_FOCUSED,
  BROWSER_PANE_FOCUS_ADDRESS,
  BROWSER_PANE_NAVIGATE,
  BROWSER_PANE_NAV_ACTION,
  BROWSER_PANE_NAV_STATE_CHANGED,
  BROWSER_PANE_NEW_TAB,
  BROWSER_PANE_OPEN_EXTERNAL,
  BROWSER_PANE_SET_BOUNDS,
  BROWSER_PANE_TABS_CHANGED,
  BROWSER_PANE_URL_CHANGED,
} from './browser-pane-channels'

type InvokeEnvelope<T> =
  | { ok: true; result: T }
  | { ok: false; error: string; errorReason?: string }

const invoke = async <T>(
  method: string,
  args?: Record<string, unknown>
): Promise<T> => {
  const envelope = (await ipcRenderer.invoke(BACKEND_INVOKE, {
    method,
    args,
  })) as InvokeEnvelope<T>

  if (envelope.ok) {
    return envelope.result
  }

  if (envelope.errorReason) {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Structured backend errors must cross the contextBridge as cloneable payloads.
    return Promise.reject({
      message: envelope.error,
      reason: envelope.errorReason,
    })
  }

  // eslint-disable-next-line @typescript-eslint/only-throw-error -- BackendApi preserves Tauri-compatible bare string rejections.
  throw envelope.error
}

const listen = <T>(
  event: string,
  callback: (payload: T) => void
): Promise<() => void> => {
  const handler = (
    _ipcEvent: IpcRendererEvent,
    msg: { event: string; payload: T }
  ): void => {
    if (msg.event === event) {
      callback(msg.payload)
    }
  }

  ipcRenderer.on(BACKEND_EVENT, handler)

  const unlisten = (): void => {
    ipcRenderer.off(BACKEND_EVENT, handler)
  }

  return Promise.resolve(unlisten)
}

const onCommandPaletteToggle = (callback: () => void): (() => void) => {
  const handler = (): void => {
    callback()
  }

  ipcRenderer.on(COMMAND_PALETTE_TOGGLE, handler)

  return (): void => {
    ipcRenderer.off(COMMAND_PALETTE_TOGGLE, handler)
  }
}

contextBridge.exposeInMainWorld('vimeflow', {
  invoke,
  listen,
  onCommandPaletteToggle,
  browserPane: {
    createPane: (request: unknown): Promise<unknown> =>
      ipcRenderer.invoke(BROWSER_PANE_CREATE, request),
    setBounds: (request: unknown): Promise<unknown> =>
      ipcRenderer.invoke(BROWSER_PANE_SET_BOUNDS, request),
    navigate: (request: unknown): Promise<unknown> =>
      ipcRenderer.invoke(BROWSER_PANE_NAVIGATE, request),
    newTab: (request: unknown): Promise<unknown> =>
      ipcRenderer.invoke(BROWSER_PANE_NEW_TAB, request),
    destroyPane: (request: unknown): Promise<unknown> =>
      ipcRenderer.invoke(BROWSER_PANE_DESTROY, request),
    focusPane: (request: unknown): Promise<unknown> =>
      ipcRenderer.invoke(BROWSER_PANE_FOCUS, request),
    getCdpInfo: (request?: unknown): Promise<unknown> =>
      ipcRenderer.invoke(BROWSER_PANE_CDP_INFO, request),
    activateTab: (request: unknown): Promise<unknown> =>
      ipcRenderer.invoke(BROWSER_PANE_ACTIVATE_TAB, request),
    closeTab: (request: unknown): Promise<unknown> =>
      ipcRenderer.invoke(BROWSER_PANE_CLOSE_TAB, request),
    openExternal: (request: unknown): Promise<unknown> =>
      ipcRenderer.invoke(BROWSER_PANE_OPEN_EXTERNAL, request),
    navAction: (request: unknown): Promise<unknown> =>
      ipcRenderer.invoke(BROWSER_PANE_NAV_ACTION, request),
    onFocus: (callback: (payload: unknown) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: unknown): void => {
        callback(payload)
      }

      ipcRenderer.on(BROWSER_PANE_FOCUSED, handler)

      return (): void => {
        ipcRenderer.off(BROWSER_PANE_FOCUSED, handler)
      }
    },
    onUrlChange: (callback: (payload: unknown) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: unknown): void => {
        callback(payload)
      }

      ipcRenderer.on(BROWSER_PANE_URL_CHANGED, handler)

      return (): void => {
        ipcRenderer.off(BROWSER_PANE_URL_CHANGED, handler)
      }
    },
    onTabsChange: (callback: (payload: unknown) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: unknown): void => {
        callback(payload)
      }

      ipcRenderer.on(BROWSER_PANE_TABS_CHANGED, handler)

      return (): void => {
        ipcRenderer.off(BROWSER_PANE_TABS_CHANGED, handler)
      }
    },
    onFocusAddress: (callback: (payload: unknown) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: unknown): void => {
        callback(payload)
      }

      ipcRenderer.on(BROWSER_PANE_FOCUS_ADDRESS, handler)

      return (): void => {
        ipcRenderer.off(BROWSER_PANE_FOCUS_ADDRESS, handler)
      }
    },
    onNavStateChange: (callback: (payload: unknown) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: unknown): void => {
        callback(payload)
      }

      ipcRenderer.on(BROWSER_PANE_NAV_STATE_CHANGED, handler)

      return (): void => {
        ipcRenderer.off(BROWSER_PANE_NAV_STATE_CHANGED, handler)
      }
    },
  },
})
