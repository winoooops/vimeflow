import type { AgentAlias } from '../bindings/AgentAlias'
import type { AppSettings } from '../bindings/AppSettings'
import type {
  RenameAgentSessionErrorReason,
  RenameAgentSessionRequest,
} from '../bindings'

/**
 * Detach a previously-registered listener. Idempotent: a second call is
 * a no-op. The `called` guard around the transport's unlisten is the
 * bridge's only surviving responsibility; React StrictMode's
 * mount->cleanup->remount fires `UnlistenFn` twice in dev, and not every
 * transport implementation is idempotent.
 */
export type UnlistenFn = () => void

export type CommandPaletteShortcutSource = 'palette' | 'leader'

export interface CommandPaletteBindingSync {
  palette: string
  leader: string
}

export interface SettingsBridge {
  load: () => Promise<AppSettings>
  save: (settings: AppSettings) => Promise<void>
  openFile: () => Promise<void>
  openWindow?: () => Promise<void>
  syncSnapshot: (settings: AppSettings) => Promise<void>
}

export interface AliasesBridge {
  load: () => Promise<AgentAlias[]>
  save: (aliases: AgentAlias[]) => Promise<void>
}

export interface BackendApi {
  invoke: <T>(method: string, args?: Record<string, unknown>) => Promise<T>

  listen: <T>(
    event: string,
    callback: (payload: T) => void
  ) => Promise<UnlistenFn>

  onCommandPaletteToggle?: (
    callback: (source?: CommandPaletteShortcutSource) => void
  ) => UnlistenFn
  setKeymapCaptureActive?: (active: boolean) => void
  setCommandPaletteBinding?: (binding: string) => void
  setCommandPaletteBindings?: (bindings: CommandPaletteBindingSync) => void

  settings?: SettingsBridge
  aliases?: AliasesBridge
}

const renameAgentSessionErrorReasons: readonly RenameAgentSessionErrorReason[] =
  ['no-live-agent', 'unsupported-agent', 'empty-title', 'pty-write']

export class AgentRenameError extends Error {
  readonly reason: RenameAgentSessionErrorReason

  constructor(message: string, reason: RenameAgentSessionErrorReason) {
    super(message)
    this.name = 'AgentRenameError'
    this.reason = reason
  }
}

const isRenameAgentSessionErrorReason = (
  value: unknown
): value is RenameAgentSessionErrorReason =>
  typeof value === 'string' &&
  renameAgentSessionErrorReasons.includes(
    value as RenameAgentSessionErrorReason
  )

const isStructuredBackendError = (
  value: unknown
): value is { message: string; reason: RenameAgentSessionErrorReason } =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  'message' in value &&
  'reason' in value &&
  typeof value.message === 'string' &&
  isRenameAgentSessionErrorReason(value.reason)

const noop = (): void => undefined

type BackendEventCallback = (payload: unknown) => void

interface BackendEventSubscription {
  attachPromise: Promise<void> | null
  callbacks: Set<BackendEventCallback>
  rawUnlisten: UnlistenFn | null
}

const backendEventSubscriptions = new Map<string, BackendEventSubscription>()

/**
 * Test-only helper: clears the module-level backend event subscription
 * registry so that a failed test cannot leak listeners into subsequent
 * tests.  This is NOT part of the public production API.
 */
export const __resetBackendEventSubscriptions = (): void => {
  backendEventSubscriptions.clear()
}

const requireBridge = (): BackendApi => {
  if (typeof window === 'undefined' || !window.vimeflow) {
    throw new Error(
      'window.vimeflow is not available; the Electron preload script did not expose the backend bridge'
    )
  }

  return window.vimeflow
}

const getEventSubscription = (event: string): BackendEventSubscription => {
  const existing = backendEventSubscriptions.get(event)

  if (existing) {
    return existing
  }

  const subscription: BackendEventSubscription = {
    attachPromise: null,
    callbacks: new Set(),
    rawUnlisten: null,
  }
  backendEventSubscriptions.set(event, subscription)

  return subscription
}

const dispatchBackendEvent = (event: string, payload: unknown): void => {
  const subscription = backendEventSubscriptions.get(event)

  if (!subscription) {
    return
  }

  Array.from(subscription.callbacks).forEach((callback) => {
    callback(payload)
  })
}

const ensureEventSubscriptionAttached = (
  bridge: BackendApi,
  event: string,
  subscription: BackendEventSubscription
): Promise<void> => {
  if (subscription.attachPromise) {
    return subscription.attachPromise
  }

  subscription.attachPromise = (async (): Promise<void> => {
    try {
      const rawUnlisten = await bridge.listen<unknown>(event, (payload) => {
        dispatchBackendEvent(event, payload)
      })
      subscription.rawUnlisten = rawUnlisten
    } catch (error) {
      if (backendEventSubscriptions.get(event) === subscription) {
        backendEventSubscriptions.delete(event)
      }

      subscription.callbacks.clear()
      throw error
    }
  })()

  return subscription.attachPromise
}

const detachBackendEventCallback = (
  event: string,
  subscription: BackendEventSubscription,
  callback: BackendEventCallback
): void => {
  subscription.callbacks.delete(callback)

  if (subscription.callbacks.size > 0) {
    return
  }

  subscription.rawUnlisten?.()

  if (backendEventSubscriptions.get(event) === subscription) {
    backendEventSubscriptions.delete(event)
  }
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

export const renameAgentSession = async (
  ptyId: string,
  title: string
): Promise<void> => {
  const request = { ptyId, title } satisfies RenameAgentSessionRequest

  try {
    await invoke<null>('rename_agent_session', request)
  } catch (error) {
    if (isStructuredBackendError(error)) {
      throw new AgentRenameError(error.message, error.reason)
    }

    throw error
  }
}

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
  const bridge = requireBridge()
  const subscription = getEventSubscription(event)

  const wrappedCallback = (payload: unknown): void => {
    callback(payload as T)
  }
  subscription.callbacks.add(wrappedCallback)

  try {
    await ensureEventSubscriptionAttached(bridge, event, subscription)
  } catch (error) {
    subscription.callbacks.delete(wrappedCallback)
    throw error
  }

  let called = false

  return () => {
    if (called) {
      return
    }

    called = true
    detachBackendEventCallback(event, subscription, wrappedCallback)
  }
}

export const listenCommandPaletteToggle = (
  callback: (source?: CommandPaletteShortcutSource) => void
): UnlistenFn => {
  if (typeof window === 'undefined') {
    return noop
  }

  return window.vimeflow?.onCommandPaletteToggle?.(callback) ?? noop
}
