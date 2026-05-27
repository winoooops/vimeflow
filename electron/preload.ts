import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  BACKEND_EVENT,
  BACKEND_INVOKE,
  COMMAND_PALETTE_TOGGLE,
} from './ipc-channels'

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
})
