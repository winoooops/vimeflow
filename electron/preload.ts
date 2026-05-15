import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { BACKEND_EVENT, BACKEND_INVOKE } from './ipc-channels'

type InvokeEnvelope<T> = { ok: true; result: T } | { ok: false; error: string }

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

contextBridge.exposeInMainWorld('vimeflow', { invoke, listen })
