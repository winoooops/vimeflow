// cspell:ignore Ghostty ghostty GHOSTTY
import type { ITerminalService } from './services/terminalService'

export interface NativeGhosttyBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface NativeGhosttyPaneRef {
  sessionId: string
  paneId: string
}

export interface NativeGhosttyShortcutContext {
  paneIds: string[]
  activePaneId: string | null
}

export interface NativeGhosttyUpdateRequest extends NativeGhosttyPaneRef {
  cwd: string
  bounds: NativeGhosttyBounds
  backgroundColor: string
  visible: boolean
  shortcutContext?: NativeGhosttyShortcutContext
}

export interface NativeGhosttyDataRequest extends NativeGhosttyPaneRef {
  data: string
}

export interface NativeGhosttyApi {
  update: (request: NativeGhosttyUpdateRequest) => Promise<unknown>
  data: (request: NativeGhosttyDataRequest) => Promise<unknown>
  focus: (request: NativeGhosttyPaneRef) => Promise<unknown>
  destroy: (request: NativeGhosttyPaneRef) => Promise<unknown>
}

export interface NativeGhosttyOutputOptions {
  onOutput?: (
    data: string,
    offsetStart: number,
    byteLen: number
  ) => boolean | void
  onUnavailable?: () => void
}

type NativeGhosttyCapableWindow = Window & {
  vimeflow?: {
    ghosttyNative?: NativeGhosttyApi
  }
}

const nativeGhosttyApi = (): NativeGhosttyApi | undefined => {
  if (typeof window === 'undefined') {
    return undefined
  }

  return (window as NativeGhosttyCapableWindow).vimeflow?.ghosttyNative
}

const isMacRenderer = (): boolean =>
  typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac')

const isDisabledResult = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  'enabled' in value &&
  value.enabled === false

// Renderer selection is macOS AND preload bridge; feature flags stay in preload/main.
export const shouldUseNativeGhostty = (): boolean =>
  isMacRenderer() && Boolean(nativeGhosttyApi())

export const updateNativeGhostty = async (
  request: NativeGhosttyUpdateRequest
): Promise<boolean> => {
  const api = nativeGhosttyApi()
  if (!api) {
    return false
  }

  const result = await api.update(request)

  return !isDisabledResult(result)
}

export const sendNativeGhosttyData = async (
  request: NativeGhosttyDataRequest
): Promise<boolean> => {
  const api = nativeGhosttyApi()
  if (!api) {
    return false
  }

  const result = await api.data(request)

  return !isDisabledResult(result)
}

export const focusNativeGhostty = async (
  request: NativeGhosttyPaneRef
): Promise<boolean> => {
  const api = nativeGhosttyApi()
  if (!api) {
    return false
  }

  const result = await api.focus(request)

  return !isDisabledResult(result)
}

export const destroyNativeGhostty = async (
  request: NativeGhosttyPaneRef
): Promise<void> => {
  await nativeGhosttyApi()?.destroy(request)
}

export const attachNativeGhosttyOutput = async (
  service: ITerminalService,
  request: NativeGhosttyPaneRef,
  options: NativeGhosttyOutputOptions = {}
): Promise<() => void> =>
  service.onData((eventSessionId, data, offsetStart, byteLen) => {
    if (eventSessionId !== request.sessionId) {
      return
    }

    if (options.onOutput?.(data, offsetStart, byteLen) === false) {
      return
    }

    void (async (): Promise<void> => {
      try {
        const enabled = await sendNativeGhosttyData({ ...request, data })
        if (!enabled) {
          options.onUnavailable?.()
        }
      } catch {
        options.onUnavailable?.()
      }
    })()
  })
