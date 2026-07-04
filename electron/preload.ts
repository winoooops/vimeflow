// cspell:ignore ghostty
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  BACKEND_EVENT,
  BACKEND_INVOKE,
  COMMAND_PALETTE_TOGGLE,
  DIALOG_PICK_DIRECTORY,
} from './ipc-channels'
import {
  NATIVE_OVERLAY_ACTION,
  NATIVE_OVERLAY_ACTION_RESULT,
  NATIVE_OVERLAY_CLEAR,
  NATIVE_OVERLAY_CLOSE,
  NATIVE_OVERLAY_CLOSED,
  NATIVE_OVERLAY_KEYDOWN,
  NATIVE_OVERLAY_OPEN,
  NATIVE_OVERLAY_READY,
  NATIVE_OVERLAY_RENDER,
} from './native-overlay-channels'
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
import {
  GHOSTTY_NATIVE_DATA,
  GHOSTTY_NATIVE_DESTROY,
  GHOSTTY_NATIVE_FOCUS,
  GHOSTTY_NATIVE_SECONDARY_ATTACH,
  GHOSTTY_NATIVE_SECONDARY_DATA,
  GHOSTTY_NATIVE_SECONDARY_FOCUS,
  GHOSTTY_NATIVE_SECONDARY_REMOVE,
  GHOSTTY_NATIVE_SECONDARY_VISIBLE,
  GHOSTTY_NATIVE_UPDATE,
} from './ghostty-native-channels'
import {
  WORKSPACE_LAYOUT_BEGIN_HYDRATION,
  WORKSPACE_LAYOUT_END_HYDRATION,
  WORKSPACE_LAYOUT_LOAD_FOR_RESTORE,
  WORKSPACE_LAYOUT_PUSH_SHAPE,
  WORKSPACE_LAYOUT_REQUEST_FINAL_SHAPE,
} from './workspace-layout-channels'

const BACKEND_EVENT_MAX_LISTENERS = 64

ipcRenderer.setMaxListeners(BACKEND_EVENT_MAX_LISTENERS)

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

const isNativeGhosttyPreloadEnabled =
  process.env.VITE_GHOSTTY_NATIVE_MACOS === '1' ||
  process.env.VITE_GHOSTTY_NATIVE_MACOS_PARENT === '1'

const isNativeGhosttyParentPreloadEnabled =
  process.env.VITE_GHOSTTY_NATIVE_MACOS_PARENT === '1'

const ghosttyNativeBridge = isNativeGhosttyPreloadEnabled
  ? {
      ghosttyNative: {
        update: (request: unknown): Promise<unknown> =>
          ipcRenderer.invoke(GHOSTTY_NATIVE_UPDATE, request),
        data: (request: unknown): Promise<unknown> =>
          ipcRenderer.invoke(GHOSTTY_NATIVE_DATA, request),
        focus: (request: unknown): Promise<unknown> =>
          ipcRenderer.invoke(GHOSTTY_NATIVE_FOCUS, request),
        destroy: (request: unknown): Promise<unknown> =>
          ipcRenderer.invoke(GHOSTTY_NATIVE_DESTROY, request),
        ...(isNativeGhosttyParentPreloadEnabled
          ? {
              attachSecondary: (request: unknown): Promise<unknown> =>
                ipcRenderer.invoke(GHOSTTY_NATIVE_SECONDARY_ATTACH, request),
              secondaryData: (request: unknown): Promise<unknown> =>
                ipcRenderer.invoke(GHOSTTY_NATIVE_SECONDARY_DATA, request),
              focusSecondary: (request: unknown): Promise<unknown> =>
                ipcRenderer.invoke(GHOSTTY_NATIVE_SECONDARY_FOCUS, request),
              removeSecondary: (request: unknown): Promise<unknown> =>
                ipcRenderer.invoke(GHOSTTY_NATIVE_SECONDARY_REMOVE, request),
              setSecondaryVisible: (request: unknown): Promise<unknown> =>
                ipcRenderer.invoke(GHOSTTY_NATIVE_SECONDARY_VISIBLE, request),
            }
          : {}),
      },
    }
  : {}

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
  ...ghosttyNativeBridge,
  dialog: {
    pickDirectory: (): Promise<string | null> =>
      ipcRenderer.invoke(DIALOG_PICK_DIRECTORY) as Promise<string | null>,
  },
  nativeOverlay: {
    open: (request: unknown): Promise<unknown> =>
      ipcRenderer.invoke(NATIVE_OVERLAY_OPEN, request),
    close: (request: unknown): Promise<unknown> =>
      ipcRenderer.invoke(NATIVE_OVERLAY_CLOSE, request),
    actionResult: (request: unknown): Promise<unknown> =>
      ipcRenderer.invoke(NATIVE_OVERLAY_ACTION_RESULT, request),
    onAction: (callback: (payload: unknown) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: unknown): void => {
        callback(payload)
      }

      ipcRenderer.on(NATIVE_OVERLAY_ACTION, handler)

      return (): void => {
        ipcRenderer.off(NATIVE_OVERLAY_ACTION, handler)
      }
    },
    onClose: (callback: (payload: unknown) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: unknown): void => {
        callback(payload)
      }

      ipcRenderer.on(NATIVE_OVERLAY_CLOSED, handler)

      return (): void => {
        ipcRenderer.off(NATIVE_OVERLAY_CLOSED, handler)
      }
    },
  },
  nativeOverlayHost: {
    ready: (request: unknown): Promise<unknown> =>
      ipcRenderer.invoke(NATIVE_OVERLAY_READY, request),
    action: (request: unknown): Promise<unknown> =>
      ipcRenderer.invoke(NATIVE_OVERLAY_ACTION, request),
    close: (request: unknown): Promise<unknown> =>
      ipcRenderer.invoke(NATIVE_OVERLAY_CLOSE, request),
    onRender: (callback: (payload: unknown) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: unknown): void => {
        callback(payload)
      }

      ipcRenderer.on(NATIVE_OVERLAY_RENDER, handler)

      return (): void => {
        ipcRenderer.off(NATIVE_OVERLAY_RENDER, handler)
      }
    },
    onClear: (callback: () => void): (() => void) => {
      const handler = (): void => {
        callback()
      }

      ipcRenderer.on(NATIVE_OVERLAY_CLEAR, handler)

      return (): void => {
        ipcRenderer.off(NATIVE_OVERLAY_CLEAR, handler)
      }
    },
    onActionResult: (callback: (payload: unknown) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: unknown): void => {
        callback(payload)
      }

      ipcRenderer.on(NATIVE_OVERLAY_ACTION_RESULT, handler)

      return (): void => {
        ipcRenderer.off(NATIVE_OVERLAY_ACTION_RESULT, handler)
      }
    },
    onKeyDown: (callback: (payload: unknown) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: unknown): void => {
        callback(payload)
      }

      ipcRenderer.on(NATIVE_OVERLAY_KEYDOWN, handler)

      return (): void => {
        ipcRenderer.off(NATIVE_OVERLAY_KEYDOWN, handler)
      }
    },
  },
  workspaceLayout: {
    pushShape: (dto: unknown): Promise<unknown> =>
      ipcRenderer.invoke(WORKSPACE_LAYOUT_PUSH_SHAPE, dto),
    loadForRestore: (request: unknown): Promise<unknown> =>
      ipcRenderer.invoke(WORKSPACE_LAYOUT_LOAD_FOR_RESTORE, request),
    beginHydration: (): Promise<unknown> =>
      ipcRenderer.invoke(WORKSPACE_LAYOUT_BEGIN_HYDRATION),
    endHydration: (): Promise<unknown> =>
      ipcRenderer.invoke(WORKSPACE_LAYOUT_END_HYDRATION),
    onRequestFinalShape: (callback: () => void): (() => void) => {
      const handler = (): void => {
        callback()
      }

      ipcRenderer.on(WORKSPACE_LAYOUT_REQUEST_FINAL_SHAPE, handler)

      return (): void => {
        ipcRenderer.off(WORKSPACE_LAYOUT_REQUEST_FINAL_SHAPE, handler)
      }
    },
  },
})
