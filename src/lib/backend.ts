import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen as tauriListen } from '@tauri-apps/api/event'

/**
 * Detach a previously-registered listener. Idempotent — a second call is
 * a no-op. PR-D removes the `@tauri-apps/event` import and the
 * `tauriUnlisten` branch below; the bridge's `called` guard wrapper
 * (in `listen()` below) stays so StrictMode double-cleanup remains
 * safe regardless of which transport produced `rawUnlisten`.
 */
export type UnlistenFn = () => void

export interface BackendApi {
  invoke: <T>(method: string, args?: Record<string, unknown>) => Promise<T>

  listen: <T>(
    event: string,
    callback: (payload: T) => void
  ) => Promise<UnlistenFn>
}

/**
 * Invoke a backend command. Prefers `window.vimeflow.invoke` (PR-D's
 * Electron preload target) when set; otherwise falls back to
 * `@tauri-apps/api/core` so the Tauri host keeps working through end
 * of PR-C. Rejection value is the transport's reject value, passed
 * through unchanged — Tauri rejects with a bare string, sidecar
 * (PR-D) MUST reject with the same shape.
 */
export const invoke = async <T>(
  method: string,
  args?: Record<string, unknown>
): Promise<T> => {
  if (typeof window !== 'undefined' && window.vimeflow) {
    return window.vimeflow.invoke<T>(method, args)
  }

  return tauriInvoke<T>(method, args)
}

/**
 * Subscribe to a backend event. Callback receives the bare payload
 * (NOT Tauri's `Event<T>` envelope). The returned promise resolves
 * only after the underlying transport listener is attached, so
 * callers can `await listen(...)` before triggering IPC that would
 * otherwise race the attachment. The returned `UnlistenFn` detaches
 * the listener AND is idempotent — the bridge wraps the transport's
 * unlisten with a `called` guard so React StrictMode's
 * mount→cleanup→remount double-fire is safe regardless of whether
 * the transport itself is idempotent.
 */
export const listen = async <T>(
  event: string,
  callback: (payload: T) => void
): Promise<UnlistenFn> => {
  const rawUnlisten =
    typeof window !== 'undefined' && window.vimeflow
      ? await window.vimeflow.listen<T>(event, callback)
      : await tauriListen<T>(event, (e) => callback(e.payload))

  let called = false

  return () => {
    if (called) {
      return
    }

    called = true
    rawUnlisten()
  }
}
