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

export interface NativeGhosttyUpdateRequest extends NativeGhosttyPaneRef {
  cwd: string
  bounds: NativeGhosttyBounds
  visible: boolean
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

export const shouldUseNativeGhostty = (): boolean =>
  (import.meta.env.VITE_GHOSTTY_NATIVE_MACOS === '1' ||
    import.meta.env.VITE_GHOSTTY_NATIVE_MACOS_PARENT === '1') &&
  isMacRenderer() &&
  Boolean(nativeGhosttyApi())

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
): Promise<void> => {
  await nativeGhosttyApi()?.data(request)
}

export const focusNativeGhostty = async (
  request: NativeGhosttyPaneRef
): Promise<void> => {
  await nativeGhosttyApi()?.focus(request)
}

export const destroyNativeGhostty = async (
  request: NativeGhosttyPaneRef
): Promise<void> => {
  await nativeGhosttyApi()?.destroy(request)
}

export const attachNativeGhosttyOutput = async (
  service: ITerminalService,
  request: NativeGhosttyPaneRef
): Promise<() => void> =>
  service.onData((eventSessionId, data) => {
    if (eventSessionId !== request.sessionId) {
      return
    }

    void sendNativeGhosttyData({ ...request, data })
  })
