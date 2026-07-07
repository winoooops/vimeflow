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
  foregroundColor: string
  bottomCornerRadius?: number
  parentHeight: number
  visible: boolean
  shortcutContext?: NativeGhosttyShortcutContext
}

export interface NativeGhosttyDataRequest extends NativeGhosttyPaneRef {
  data: string
}

export interface NativeGhosttySecondaryRequest extends NativeGhosttyPaneRef {
  secondarySessionId: string
}

export interface NativeGhosttySecondaryDataRequest extends NativeGhosttySecondaryRequest {
  data: string
}

export interface NativeGhosttySecondaryVisibleRequest extends NativeGhosttySecondaryRequest {
  visible: boolean
}

export interface NativeGhosttyApi {
  update: (request: NativeGhosttyUpdateRequest) => Promise<unknown>
  data: (request: NativeGhosttyDataRequest) => Promise<unknown>
  focus: (request: NativeGhosttyPaneRef) => Promise<unknown>
  destroy: (request: NativeGhosttyPaneRef) => Promise<unknown>
  attachSecondary?: (request: NativeGhosttySecondaryRequest) => Promise<unknown>
  secondaryData?: (
    request: NativeGhosttySecondaryDataRequest
  ) => Promise<unknown>
  focusSecondary?: (request: NativeGhosttySecondaryRequest) => Promise<unknown>
  removeSecondary?: (request: NativeGhosttySecondaryRequest) => Promise<unknown>
  setSecondaryVisible?: (
    request: NativeGhosttySecondaryVisibleRequest
  ) => Promise<unknown>
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

export const canUseNativeGhosttySecondary = (): boolean => {
  const api = nativeGhosttyApi()

  return (
    isMacRenderer() &&
    Boolean(
      api?.attachSecondary &&
      api.secondaryData &&
      api.focusSecondary &&
      api.removeSecondary &&
      api.setSecondaryVisible
    )
  )
}

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

export const attachNativeGhosttySecondary = async (
  request: NativeGhosttySecondaryRequest
): Promise<boolean> => {
  const api = nativeGhosttyApi()
  if (!api?.attachSecondary) {
    return false
  }

  const result = await api.attachSecondary(request)

  return !isDisabledResult(result)
}

export const sendNativeGhosttySecondaryData = async (
  request: NativeGhosttySecondaryDataRequest
): Promise<boolean> => {
  const api = nativeGhosttyApi()
  if (!api?.secondaryData) {
    return false
  }

  const result = await api.secondaryData(request)

  return !isDisabledResult(result)
}

export const focusNativeGhosttySecondary = async (
  request: NativeGhosttySecondaryRequest
): Promise<boolean> => {
  const api = nativeGhosttyApi()
  if (!api?.focusSecondary) {
    return false
  }

  const result = await api.focusSecondary(request)

  return !isDisabledResult(result)
}

export const removeNativeGhosttySecondary = async (
  request: NativeGhosttySecondaryRequest
): Promise<void> => {
  await nativeGhosttyApi()?.removeSecondary?.(request)
}

export const setNativeGhosttySecondaryVisible = async (
  request: NativeGhosttySecondaryVisibleRequest
): Promise<boolean> => {
  const api = nativeGhosttyApi()
  if (!api?.setSecondaryVisible) {
    return false
  }

  const result = await api.setSecondaryVisible(request)

  return !isDisabledResult(result)
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
