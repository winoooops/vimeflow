/**
 * Detach a previously-registered listener. Idempotent: a second call is
 * a no-op. The `called` guard around the transport's unlisten is the
 * bridge's only surviving responsibility; React StrictMode's
 * mount->cleanup->remount fires `UnlistenFn` twice in dev, and not every
 * transport implementation is idempotent.
 */
export type UnlistenFn = () => void

export interface BackendApi {
  invoke: <T>(method: string, args?: Record<string, unknown>) => Promise<T>

  listen: <T>(
    event: string,
    callback: (payload: T) => void
  ) => Promise<UnlistenFn>
}

const requireBridge = (): BackendApi => {
  if (typeof window === 'undefined' || !window.vimeflow) {
    throw new Error(
      'window.vimeflow is not available; the Electron preload script did not expose the backend bridge'
    )
  }

  return window.vimeflow
}

/**
 * Invoke a backend command. Delegates to `window.vimeflow.invoke` set by
 * the Electron preload script. Rejects with a bare-string error if the
 * sidecar returned an error, or with a descriptive Error if the bridge
 * is not available.
 */
export const invoke = async <T>(
  method: string,
  args?: Record<string, unknown>
): Promise<T> => requireBridge().invoke<T>(method, args)

/**
 * Subscribe to a backend event. Callback receives the bare payload. The
 * returned promise resolves only after the underlying transport listener
 * is attached, so callers can `await listen(...)` before triggering IPC
 * that would otherwise race the attachment. The returned `UnlistenFn`
 * is idempotent; see the type doc above.
 */
export const listen = async <T>(
  event: string,
  callback: (payload: T) => void
): Promise<UnlistenFn> => {
  const rawUnlisten = await requireBridge().listen<T>(event, callback)

  let called = false

  return () => {
    if (called) {
      return
    }

    called = true
    rawUnlisten()
  }
}
