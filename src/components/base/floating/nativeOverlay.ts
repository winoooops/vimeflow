import { isMacPlatform } from '@/lib/formatShortcut'
import { createLogger } from '@/lib/log'

export type FloatingTransport = 'local' | 'native-overlay'

export const NATIVE_OVERLAY_KINDS = {
  menu: 'menu',
  tooltip: 'tooltip',
  popover: 'popover',
  dialog: 'dialog',
} as const

export type NativeOverlayKind =
  (typeof NATIVE_OVERLAY_KINDS)[keyof typeof NATIVE_OVERLAY_KINDS]

export interface NativeOverlayRect {
  x: number
  y: number
  width: number
  height: number
}

export interface NativeOverlayMenuActionItem {
  type?: 'item'
  id: string
  label: string
  icon?: string
  shortcut?: string
  disabled?: boolean
}

export interface NativeOverlayMenuCheckboxItem {
  type: 'checkbox'
  id: string
  label: string
  icon?: string
  checked: boolean
  disabled?: boolean
}

export interface NativeOverlayMenuSeparatorItem {
  type: 'separator'
}

export interface NativeOverlayMenuSubAction {
  id: string
  label: string
  icon?: string
  pressed?: boolean
  disabled?: boolean
}

export interface NativeOverlayMenuCompositeItem {
  type: 'composite'
  id: string
  label: string
  icon?: string
  active?: boolean
  disabled?: boolean
  actions: NativeOverlayMenuSubAction[]
}

export type NativeOverlayMenuItem =
  | NativeOverlayMenuActionItem
  | NativeOverlayMenuCheckboxItem
  | NativeOverlayMenuSeparatorItem
  | NativeOverlayMenuCompositeItem

export interface NativeOverlayMenuSection {
  label?: string
  items: NativeOverlayMenuItem[]
}

export interface NativeOverlayMenuPayload {
  kind: 'menu'
  ariaLabel?: string
  items?: NativeOverlayMenuItem[]
  sections?: NativeOverlayMenuSection[]
}

// Menus are the only native overlay payload today. Keep this named boundary so
// it can become a discriminated union when tooltip, popover, and dialog get
// their own plain-data payload models instead of arbitrary React children.
export type SerializableOverlayPayload = NativeOverlayMenuPayload

export interface NativeOverlayRequest {
  surfaceId: string
  kind: NativeOverlayKind
  anchorRect: NativeOverlayRect
  placement: string
  payload: SerializableOverlayPayload
}

export interface NativeOverlayActionEvent {
  surfaceId: string
  actionId: string
}

export interface NativeOverlayCloseEvent {
  surfaceId: string
  reason: string
}

export interface NativeOverlayOpenResult {
  accepted: boolean
  reason?: string
}

// Renderer-side handle for the optional Electron preload bridge. Floating
// primitives still render locally by default; when a primitive opts in and the
// bridge exists, it sends a plain data request to main and keeps callbacks here
// keyed by surface/action ids. Main owns the transparent overlay window; React
// owns the original callbacks.
interface NativeOverlayBridge {
  open: (request: NativeOverlayRequest) => Promise<NativeOverlayOpenResult>
  close: (request: { surfaceId: string; reason: 'renderer' }) => Promise<void>
  onAction: (callback: (event: unknown) => void) => () => void
  onClose: (callback: (event: unknown) => void) => () => void
}

export type NativeOverlayActionHandler =
  | (() => void)
  | {
      retainSession: true
      run: () => void
    }

interface NativeOverlaySession {
  actions: ReadonlyMap<string, NativeOverlayActionHandler>
  onClose: () => void
}

const log = createLogger('native-overlay')
const sessions = new Map<string, NativeOverlaySession>()
let cleanupAction: (() => void) | null = null
let cleanupClose: (() => void) | null = null

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isActionEvent = (value: unknown): value is NativeOverlayActionEvent =>
  isRecord(value) &&
  typeof value.surfaceId === 'string' &&
  typeof value.actionId === 'string'

const isCloseEvent = (value: unknown): value is NativeOverlayCloseEvent =>
  isRecord(value) &&
  typeof value.surfaceId === 'string' &&
  typeof value.reason === 'string'

const bridge = (): NativeOverlayBridge | undefined =>
  typeof window === 'undefined' ? undefined : window.vimeflow?.nativeOverlay

export const isNativeOverlayFeatureEnabled = (): boolean =>
  import.meta.env.VITE_NATIVE_OVERLAY === '1'

export const selectFloatingTransport = (
  nativeOverlay: boolean
): FloatingTransport =>
  nativeOverlay &&
  isNativeOverlayFeatureEnabled() &&
  isMacPlatform() &&
  bridge()
    ? 'native-overlay'
    : 'local'

const handleAction = (event: unknown): void => {
  if (!isActionEvent(event)) {
    return
  }

  const session = sessions.get(event.surfaceId)
  if (!session) {
    return
  }

  const action = session.actions.get(event.actionId)
  if (action === undefined) {
    return
  }

  if (typeof action === 'function') {
    // Drop the session before running React code. Native overlay events are
    // allowed to arrive twice or re-enter through the callback; removing first
    // makes each surface/action id at-most-once. We intentionally do not retry
    // callbacks because copy/paste/rename-style actions may have side effects.
    sessions.delete(event.surfaceId)
    action()

    return
  }

  action.run()
}

const handleClose = (event: unknown): void => {
  if (!isCloseEvent(event)) {
    return
  }

  const session = sessions.get(event.surfaceId)
  if (!session) {
    return
  }

  // Same at-most-once rule as handleAction: close callbacks can update React
  // state and re-enter this transport, so the native surface id is retired
  // before the callback runs.
  sessions.delete(event.surfaceId)
  session.onClose()
}

const ensureListeners = (nativeBridge: NativeOverlayBridge): void => {
  if (cleanupAction !== null && cleanupClose !== null) {
    return
  }

  cleanupAction = nativeBridge.onAction(handleAction)
  cleanupClose = nativeBridge.onClose(handleClose)
}

export const openNativeOverlay = async (
  request: NativeOverlayRequest,
  session: NativeOverlaySession
): Promise<boolean> => {
  const nativeBridge = bridge()
  if (!nativeBridge) {
    return false
  }

  try {
    ensureListeners(nativeBridge)
    sessions.set(request.surfaceId, session)
    const result = await nativeBridge.open(request)
    if (!result.accepted) {
      if (sessions.get(request.surfaceId) === session) {
        sessions.delete(request.surfaceId)
      }

      return false
    }

    return true
  } catch (error) {
    if (sessions.get(request.surfaceId) === session) {
      sessions.delete(request.surfaceId)
    }
    log.warn('open failed', error)

    return false
  }
}

export const closeNativeOverlay = (surfaceId: string): void => {
  sessions.delete(surfaceId)
  void bridge()?.close({ surfaceId, reason: 'renderer' })
}

export const warnNativeOverlayFallback = (reason: string): void => {
  if (!import.meta.env.DEV) {
    return
  }

  log.warn(`falling back to local floating surface: ${reason}`)
}

export const __resetNativeOverlayForTest = (): void => {
  cleanupAction?.()
  cleanupClose?.()
  cleanupAction = null
  cleanupClose = null
  sessions.clear()
}
