import { isMacPlatform } from '@/lib/formatShortcut'
import { createLogger } from '@/lib/log'
import type { NativeOverlayActivityPopoverPayload } from '../../nativeOverlayActivity'

export type {
  NativeOverlayActivityEvent,
  NativeOverlayActivityPopoverPayload,
  NativeOverlayActivityPopoverRequest,
} from '../../nativeOverlayActivity'

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

export interface NativeOverlayThemeSnapshot {
  id?: string
  colorScheme?: string
  variables: Record<string, string>
}

export interface NativeOverlayMenuActionItem {
  type?: 'item'
  id: string
  label: string
  detail?: string
  icon?: string
  feedback?: 'copy'
  closeOnSelect?: boolean
  shortcut?: string
  disabled?: boolean
}

export type NativeOverlayMenuSurfaceTone = 'primary-container-soft'

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
  matchAnchorWidth?: boolean
  surfaceTone?: NativeOverlayMenuSurfaceTone
  items?: NativeOverlayMenuItem[]
  sections?: NativeOverlayMenuSection[]
}

export interface NativeOverlayTooltipPayload {
  kind: 'tooltip'
  text: string
  shortcut?: string
  maxWidth?: number
}

export interface NativeOverlayCommandPaletteItem {
  id: string
  label: string
  description?: string
  hint?: string
  icon: string
  shortcut?: string[]
}

export interface NativeOverlayCommandPaletteActions {
  selectIndex: string
  executeIndex: string
  setQuery: string
}

export interface NativeOverlayCommandPaletteDialogPayload {
  kind: 'dialog'
  dialog: 'command-palette'
  ariaLabel: string
  query: string
  selectedIndex: number
  activeDescendantId?: string
  argumentPlaceholder?: string
  results: NativeOverlayCommandPaletteItem[]
  actions: NativeOverlayCommandPaletteActions
}

export interface NativeOverlayNewSessionCommandOption {
  id: string
  label: string
  accentVar: string
  glyph?: string
  materialIcon?: string
}

export interface NativeOverlayNewSessionLayoutOption {
  id: string
  label: string
  capacity: number
  cols: string
  rows: string
  areas: readonly (readonly string[])[]
}

export interface NativeOverlayNewSessionPaneOption {
  index: number
  areaName: string
  commandId: string
}

export interface NativeOverlayNewSessionActions {
  focusName: string
  resetName: string
  browse: string
  cancel: string
  create: string
  selectPanePrefix: string
  pickLayoutPrefix: string
  pickCommandPrefix: string
}

export interface NativeOverlayNewSessionDialogPayload {
  kind: 'dialog'
  dialog: 'new-session'
  ariaLabel: string
  name: string
  path: string
  nameEdited: boolean
  selectedLayoutId: string
  activeCommandPaneIndex: number
  layouts: NativeOverlayNewSessionLayoutOption[]
  panes: NativeOverlayNewSessionPaneOption[]
  commands: NativeOverlayNewSessionCommandOption[]
  actions: NativeOverlayNewSessionActions
}

export interface NativeOverlaySessionSwitcherItem {
  id: string
  title: string
  agentGlyph?: string
  layoutId?: string
  isActive: boolean
}

export interface NativeOverlaySessionSwitcherActions {
  commitIdPrefix: string
  cancel: string
}

export interface NativeOverlaySessionSwitcherDialogPayload {
  kind: 'dialog'
  dialog: 'session-switcher'
  ariaLabel: string
  selectedIndex: number
  items: NativeOverlaySessionSwitcherItem[]
  actions: NativeOverlaySessionSwitcherActions
}

export type NativeOverlayDialogPayload =
  | NativeOverlayCommandPaletteDialogPayload
  | NativeOverlayNewSessionDialogPayload
  | NativeOverlaySessionSwitcherDialogPayload

// Native overlay payloads are plain data only. Each rich surface gets a narrow
// serializable model instead of sending arbitrary React children over IPC.
export type SerializableOverlayPayload =
  | NativeOverlayMenuPayload
  | NativeOverlayTooltipPayload
  | NativeOverlayActivityPopoverPayload
  | NativeOverlayDialogPayload

export interface NativeOverlayRequest {
  surfaceId: string
  kind: NativeOverlayKind
  anchorRect: NativeOverlayRect
  placement: string
  payload: SerializableOverlayPayload
  theme?: NativeOverlayThemeSnapshot
}

export type NativeOverlayMenuRequest = NativeOverlayRequest & {
  kind: typeof NATIVE_OVERLAY_KINDS.menu
  payload: NativeOverlayMenuPayload
}

export type NativeOverlayTooltipRequest = NativeOverlayRequest & {
  kind: typeof NATIVE_OVERLAY_KINDS.tooltip
  payload: NativeOverlayTooltipPayload
}

export type NativeOverlayDialogRequest = NativeOverlayRequest & {
  kind: typeof NATIVE_OVERLAY_KINDS.dialog
  payload: NativeOverlayDialogPayload
}

export interface NativeOverlayActionEvent {
  surfaceId: string
  actionId: string
  closeOnSelect?: boolean
  suspendOnSelect?: boolean
  feedback?: 'copy'
  index?: number
  query?: string
}

export interface NativeOverlayActionResultEvent {
  surfaceId: string
  actionId: string
  feedback: 'copy'
  ok: boolean
}

export interface NativeOverlayCloseEvent {
  surfaceId: string
  reason: string
}

export interface NativeOverlayOpenResult {
  accepted: boolean
  reason?: string
}

const THEME_VARIABLE_PREFIXES = ['--color-', '--font-', '--shadow-'] as const

// Native overlays render in a separate transparent BrowserWindow, so they do
// not automatically inherit the main renderer's live CSS variables. Capture the
// active token values when the surface opens and let the overlay host apply
// them before rendering the shared React menu.
export const nativeOverlayThemeSnapshot = (): NativeOverlayThemeSnapshot => {
  const root = document.documentElement
  const variables: Record<string, string> = {}

  for (let index = 0; index < root.style.length; index += 1) {
    const name = root.style.item(index)
    if (!THEME_VARIABLE_PREFIXES.some((prefix) => name.startsWith(prefix))) {
      continue
    }

    const value = root.style.getPropertyValue(name)
    if (value.length > 0) {
      variables[name] = value
    }
  }

  return {
    ...(root.dataset.theme === undefined ? {} : { id: root.dataset.theme }),
    ...(root.style.colorScheme.length === 0
      ? {}
      : { colorScheme: root.style.colorScheme }),
    variables,
  }
}

// Renderer-side handle for the optional Electron preload bridge. Floating
// primitives still render locally by default; when a primitive opts in and the
// bridge exists, it sends a plain data request to main and keeps callbacks here
// keyed by surface/action ids. Main owns the transparent overlay window; React
// owns the original callbacks.
interface NativeOverlayBridge {
  open: (request: NativeOverlayRequest) => Promise<NativeOverlayOpenResult>
  close: (request: { surfaceId: string; reason: 'renderer' }) => Promise<void>
  actionResult: (request: NativeOverlayActionResultEvent) => Promise<void>
  resume: (request: { surfaceId: string }) => Promise<void>
  onAction: (callback: (event: unknown) => void) => () => void
  onClose: (callback: (event: unknown) => void) => () => void
}

export type NativeOverlayActionResult = boolean | void | Promise<boolean | void>

export type NativeOverlayActionHandler =
  | ((event?: NativeOverlayActionEvent) => NativeOverlayActionResult)
  | {
      retainSession: true
      run: (event?: NativeOverlayActionEvent) => NativeOverlayActionResult
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
  typeof value.actionId === 'string' &&
  (value.closeOnSelect === undefined ||
    typeof value.closeOnSelect === 'boolean') &&
  (value.suspendOnSelect === undefined ||
    typeof value.suspendOnSelect === 'boolean') &&
  (value.feedback === undefined || value.feedback === 'copy') &&
  (value.index === undefined || typeof value.index === 'number') &&
  (value.query === undefined || typeof value.query === 'string')

const isCloseEvent = (value: unknown): value is NativeOverlayCloseEvent =>
  isRecord(value) &&
  typeof value.surfaceId === 'string' &&
  typeof value.reason === 'string'

const bridge = (): NativeOverlayBridge | undefined =>
  typeof window === 'undefined' ? undefined : window.vimeflow?.nativeOverlay

const reportActionResult = (
  event: NativeOverlayActionEvent,
  ok: boolean
): void => {
  if (event.feedback === undefined) {
    return
  }

  void bridge()?.actionResult({
    surfaceId: event.surfaceId,
    actionId: event.actionId,
    feedback: event.feedback,
    ok,
  })
}

const runActionAndReport = (
  event: NativeOverlayActionEvent,
  run: (event: NativeOverlayActionEvent) => NativeOverlayActionResult
): void => {
  void (async (): Promise<void> => {
    try {
      const result = await run(event)
      reportActionResult(event, result === true)
    } catch (error) {
      reportActionResult(event, false)
      log.warn('action failed', error)
    }
  })()
}

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
    runActionAndReport(event, action)

    return
  }

  runActionAndReport(event, action.run)
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
