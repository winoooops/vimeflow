import {
  BrowserWindow,
  ipcMain,
  shell,
  type Event as ElectronEvent,
  type IpcMain,
  type IpcMainInvokeEvent,
  type Input,
  type WebContents,
} from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  NATIVE_OVERLAY_ACTION,
  NATIVE_OVERLAY_ACTION_RESULT,
  NATIVE_OVERLAY_CLEAR,
  NATIVE_OVERLAY_CLOSE,
  NATIVE_OVERLAY_CLOSED,
  NATIVE_OVERLAY_KEYDOWN,
  NATIVE_OVERLAY_OPEN,
  NATIVE_OVERLAY_READY,
  NATIVE_OVERLAY_RENDER,
  NATIVE_OVERLAY_RESUME,
} from './native-overlay-channels'
import { dispatchCommandPaletteShortcutForWindow } from './command-palette-shortcut'
import { installNavigationGuard } from './navigation-guard'

// cspell:ignore AppKit Ghostty minimizable maximizable fullscreenable NSView

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// TODO: add popover here when it gets a serializable native overlay payload
// and host renderer.
export type NativeOverlayKind = 'menu' | 'tooltip' | 'dialog'

type NativeOverlayCloseReason =
  | 'outside'
  | 'renderer'
  | 'action'
  | 'replaced'
  | 'owner-closed'

interface NativeOverlayRect {
  x: number
  y: number
  width: number
  height: number
}

interface NativeOverlayMenuActionItem {
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

interface NativeOverlayMenuCheckboxItem {
  type: 'checkbox'
  id: string
  label: string
  icon?: string
  checked: boolean
  disabled?: boolean
}

interface NativeOverlayMenuSeparatorItem {
  type: 'separator'
}

interface NativeOverlayMenuSubAction {
  id: string
  label: string
  icon?: string
  pressed?: boolean
  disabled?: boolean
}

interface NativeOverlayMenuCompositeItem {
  type: 'composite'
  id: string
  label: string
  icon?: string
  active?: boolean
  disabled?: boolean
  actions: NativeOverlayMenuSubAction[]
}

type NativeOverlayMenuItem =
  | NativeOverlayMenuActionItem
  | NativeOverlayMenuCheckboxItem
  | NativeOverlayMenuSeparatorItem
  | NativeOverlayMenuCompositeItem

interface NativeOverlayMenuSection {
  label?: string
  items: NativeOverlayMenuItem[]
}

interface NativeOverlayMenuPayload {
  kind: 'menu'
  ariaLabel?: string
  matchAnchorWidth?: boolean
  surfaceTone?: string
  items?: NativeOverlayMenuItem[]
  sections?: NativeOverlayMenuSection[]
}

interface NativeOverlayTooltipPayload {
  kind: 'tooltip'
  text: string
  maxWidth?: number
}

interface NativeOverlayCommandPaletteItem {
  id: string
  label: string
  description?: string
  hint?: string
  icon: string
  shortcut?: string[]
}

interface NativeOverlayCommandPaletteActions {
  selectIndex: string
  executeIndex: string
}

interface NativeOverlayCommandPaletteDialogPayload {
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

interface NativeOverlayNewSessionCommandOption {
  id: string
  label: string
  accentVar: string
  glyph?: string
  materialIcon?: string
}

interface NativeOverlayNewSessionLayoutOption {
  id: string
  label: string
  capacity: number
  cols: string
  rows: string
  areas: readonly (readonly string[])[]
}

interface NativeOverlayNewSessionPaneOption {
  index: number
  areaName: string
  commandId: string
}

interface NativeOverlayNewSessionActions {
  focusName: string
  resetName: string
  browse: string
  cancel: string
  create: string
  selectPanePrefix: string
  pickLayoutPrefix: string
  pickCommandPrefix: string
}

interface NativeOverlayNewSessionDialogPayload {
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

type NativeOverlayDialogPayload =
  | NativeOverlayCommandPaletteDialogPayload
  | NativeOverlayNewSessionDialogPayload

type SerializableOverlayPayload =
  | NativeOverlayMenuPayload
  | NativeOverlayTooltipPayload
  | NativeOverlayDialogPayload

interface NativeOverlayThemeSnapshot {
  id?: string
  colorScheme?: string
  variables: Record<string, string>
}

interface NativeOverlayRequest {
  surfaceId: string
  kind: NativeOverlayKind
  anchorRect: NativeOverlayRect
  placement: string
  payload: SerializableOverlayPayload
  theme?: NativeOverlayThemeSnapshot
}

interface NativeOverlayCloseRequest {
  surfaceId: string
  reason?: NativeOverlayCloseReason
}

interface NativeOverlayActionEvent {
  surfaceId: string
  actionId: string
  closeOnSelect?: boolean
  suspendOnSelect?: boolean
  feedback?: 'copy'
  index?: number
}

interface NativeOverlayActionResultEvent {
  surfaceId: string
  actionId: string
  feedback: 'copy'
  ok: boolean
}

interface NativeOverlayReadyEvent {
  surfaceId: string
}

interface NativeOverlayKeyboardEvent {
  surfaceId: string
  key: string
  code: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  repeat: boolean
}

interface NativeOverlayOpenResult {
  accepted: boolean
  reason?: string
}

interface NativeOverlayLayerRecord {
  window: BrowserWindow
  ready: Promise<boolean>
}

interface NativeOverlayRecord {
  parent: BrowserWindow
  menu: NativeOverlayLayerRecord
  tooltip: NativeOverlayLayerRecord
  syncBounds: () => void
  parentBlurred: () => void
  parentHidden: () => void
  parentMinimized: () => void
  parentClosing: () => void
  parentClosed: () => void
  ownerBeforeInput: (event: ElectronEvent, input: Input) => void
  activeSurfaceId: string | null
  activeTooltipSurfaceId: string | null
}

interface NativeOverlaySurface {
  owner: WebContents
  parentId: number
  kind: NativeOverlayKind
}

interface NativeOverlayControllerOptions {
  menuOverlayUrl: string
  tooltipOverlayUrl: string
  platform?: NodeJS.Platform
}

interface IpcMainLike {
  handle: IpcMain['handle']
  removeHandler: IpcMain['removeHandler']
}

const OVERLAY_RENDER_TIMEOUT_MS = 1000
const MAX_OVERLAY_ITEMS = 200
const MAX_OVERLAY_SECTIONS = 50
const MAX_OVERLAY_SUB_ACTIONS = 20
const MAX_COMMAND_PALETTE_RESULTS = 200
const MAX_COMMAND_PALETTE_SHORTCUTS = 8
const MAX_NEW_SESSION_LAYOUTS = 24
const MAX_NEW_SESSION_PANES = 16
const MAX_NEW_SESSION_COMMANDS = 64
const MAX_NEW_SESSION_AREA_ROWS = 16
const MAX_NEW_SESSION_AREA_COLUMNS = 16
const MAX_THEME_VARIABLES = 512

const OVERLAY_CURSOR_RESET_SCRIPT = `
(() => {
  document.documentElement.style.cursor = 'default'
  document.body.style.cursor = 'default'
  window.setTimeout(() => {
    document.documentElement.style.cursor = ''
    document.body.style.cursor = ''
  }, 80)
})()
`

const MENU_KEY_MAP: Readonly<Partial<Record<string, string>>> = {
  ' ': ' ',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  ArrowUp: 'ArrowUp',
  Down: 'ArrowDown',
  End: 'End',
  Enter: 'Enter',
  Escape: 'Escape',
  Home: 'Home',
  Left: 'ArrowLeft',
  PageDown: 'PageDown',
  PageUp: 'PageUp',
  Return: 'Enter',
  Right: 'ArrowRight',
  Space: ' ',
  Tab: 'Tab',
  Up: 'ArrowUp',
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const resetOverlayCursor = (overlayWindow: BrowserWindow): void => {
  if (overlayWindow.webContents.isDestroyed()) {
    return
  }

  // AppKit modal panels can leave Chromium's last cursor active while this
  // transparent window temporarily ignores mouse events.
  void (async (): Promise<void> => {
    try {
      await overlayWindow.webContents.executeJavaScript(
        OVERLAY_CURSOR_RESET_SCRIPT,
        true
      )
    } catch {
      // Cursor reset is cosmetic; overlay ordering should continue if it fails.
    }
  })()
}

const isString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const isBoundedArray = <T>(
  value: unknown,
  maxLength: number,
  itemGuard: (item: unknown) => item is T
): value is T[] =>
  Array.isArray(value) && value.length <= maxLength && value.every(itemGuard)

const isNonEmptyBoundedArray = <T>(
  value: unknown,
  maxLength: number,
  itemGuard: (item: unknown) => item is T
): value is T[] =>
  isBoundedArray(value, maxLength, itemGuard) && value.length > 0

const isRect = (value: unknown): value is NativeOverlayRect =>
  isRecord(value) &&
  isFiniteNumber(value.x) &&
  isFiniteNumber(value.y) &&
  isFiniteNumber(value.width) &&
  isFiniteNumber(value.height)

const isMenuSubAction = (value: unknown): value is NativeOverlayMenuSubAction =>
  isRecord(value) &&
  isString(value.id) &&
  isString(value.label) &&
  (value.icon === undefined || typeof value.icon === 'string') &&
  (value.pressed === undefined || typeof value.pressed === 'boolean') &&
  (value.disabled === undefined || typeof value.disabled === 'boolean')

const isMenuItem = (value: unknown): value is NativeOverlayMenuItem => {
  if (!isRecord(value)) {
    return false
  }

  if (value.type === 'separator') {
    return true
  }

  if (value.type === 'composite') {
    return (
      isString(value.id) &&
      isString(value.label) &&
      (value.icon === undefined || typeof value.icon === 'string') &&
      (value.active === undefined || typeof value.active === 'boolean') &&
      (value.disabled === undefined || typeof value.disabled === 'boolean') &&
      isNonEmptyBoundedArray(
        value.actions,
        MAX_OVERLAY_SUB_ACTIONS,
        isMenuSubAction
      )
    )
  }

  const isActionType = value.type === undefined || value.type === 'item'

  const isCheckboxType =
    value.type === 'checkbox' && typeof value.checked === 'boolean'

  return (
    (isActionType || isCheckboxType) &&
    isString(value.id) &&
    isString(value.label) &&
    (value.detail === undefined || typeof value.detail === 'string') &&
    (value.icon === undefined || typeof value.icon === 'string') &&
    (value.feedback === undefined || value.feedback === 'copy') &&
    (value.closeOnSelect === undefined ||
      typeof value.closeOnSelect === 'boolean') &&
    (value.shortcut === undefined || typeof value.shortcut === 'string') &&
    (value.disabled === undefined || typeof value.disabled === 'boolean')
  )
}

const hasMenuItems = (items: unknown): boolean =>
  isNonEmptyBoundedArray(items, MAX_OVERLAY_ITEMS, isMenuItem)

const isMenuSection = (value: unknown): value is NativeOverlayMenuSection =>
  isRecord(value) &&
  (value.label === undefined || typeof value.label === 'string') &&
  hasMenuItems(value.items)

const hasMenuSections = (sections: unknown): boolean =>
  isNonEmptyBoundedArray(sections, MAX_OVERLAY_SECTIONS, isMenuSection)

const isStringRecord = (value: unknown): value is Record<string, string> =>
  isRecord(value) && hasBoundedStringValues(value, MAX_THEME_VARIABLES)

const hasBoundedStringValues = (
  value: Record<string, unknown>,
  maxEntries: number
): value is Record<string, string> => {
  let entryCount = 0

  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      continue
    }

    entryCount += 1
    if (entryCount > maxEntries || typeof value[key] !== 'string') {
      return false
    }
  }

  return true
}

const isMenuPayload = (value: unknown): value is NativeOverlayMenuPayload =>
  isRecord(value) &&
  value.kind === 'menu' &&
  (value.ariaLabel === undefined || typeof value.ariaLabel === 'string') &&
  (value.matchAnchorWidth === undefined ||
    typeof value.matchAnchorWidth === 'boolean') &&
  (value.surfaceTone === undefined || typeof value.surfaceTone === 'string') &&
  (value.items === undefined || hasMenuItems(value.items)) &&
  (value.sections === undefined || hasMenuSections(value.sections)) &&
  (value.items !== undefined || value.sections !== undefined)

const isTooltipPayload = (
  value: unknown
): value is NativeOverlayTooltipPayload =>
  isRecord(value) &&
  value.kind === 'tooltip' &&
  isString(value.text) &&
  (value.maxWidth === undefined || isFiniteNumber(value.maxWidth))

const isCommandPaletteItem = (
  value: unknown
): value is NativeOverlayCommandPaletteItem =>
  isRecord(value) &&
  isString(value.id) &&
  isString(value.label) &&
  (value.description === undefined || typeof value.description === 'string') &&
  (value.hint === undefined || typeof value.hint === 'string') &&
  isString(value.icon) &&
  (value.shortcut === undefined ||
    isBoundedArray(
      value.shortcut,
      MAX_COMMAND_PALETTE_SHORTCUTS,
      (entry): entry is string => typeof entry === 'string'
    ))

const isCommandPaletteActions = (
  value: unknown
): value is NativeOverlayCommandPaletteActions =>
  isRecord(value) && isString(value.selectIndex) && isString(value.executeIndex)

const isStringMatrix = (
  value: unknown
): value is readonly (readonly string[])[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= MAX_NEW_SESSION_AREA_ROWS &&
  value.every(
    (row) =>
      Array.isArray(row) &&
      row.length > 0 &&
      row.length <= MAX_NEW_SESSION_AREA_COLUMNS &&
      row.every((entry) => typeof entry === 'string')
  )

const isNewSessionCommandOption = (
  value: unknown
): value is NativeOverlayNewSessionCommandOption =>
  isRecord(value) &&
  isString(value.id) &&
  isString(value.label) &&
  isString(value.accentVar) &&
  (value.glyph === undefined || typeof value.glyph === 'string') &&
  (value.materialIcon === undefined || typeof value.materialIcon === 'string')

const isNewSessionLayoutOption = (
  value: unknown
): value is NativeOverlayNewSessionLayoutOption =>
  isRecord(value) &&
  isString(value.id) &&
  isString(value.label) &&
  isFiniteNumber(value.capacity) &&
  value.capacity > 0 &&
  isString(value.cols) &&
  isString(value.rows) &&
  isStringMatrix(value.areas)

const isNewSessionPaneOption = (
  value: unknown
): value is NativeOverlayNewSessionPaneOption =>
  isRecord(value) &&
  isFiniteNumber(value.index) &&
  value.index >= 0 &&
  isString(value.areaName) &&
  isString(value.commandId)

const isNewSessionActions = (
  value: unknown
): value is NativeOverlayNewSessionActions =>
  isRecord(value) &&
  isString(value.focusName) &&
  isString(value.resetName) &&
  isString(value.browse) &&
  isString(value.cancel) &&
  isString(value.create) &&
  isString(value.selectPanePrefix) &&
  isString(value.pickLayoutPrefix) &&
  isString(value.pickCommandPrefix)

const isCommandPaletteDialogPayload = (
  value: unknown
): value is NativeOverlayCommandPaletteDialogPayload =>
  isRecord(value) &&
  value.dialog === 'command-palette' &&
  isString(value.ariaLabel) &&
  typeof value.query === 'string' &&
  isFiniteNumber(value.selectedIndex) &&
  (value.activeDescendantId === undefined ||
    typeof value.activeDescendantId === 'string') &&
  (value.argumentPlaceholder === undefined ||
    typeof value.argumentPlaceholder === 'string') &&
  isBoundedArray(
    value.results,
    MAX_COMMAND_PALETTE_RESULTS,
    isCommandPaletteItem
  ) &&
  isCommandPaletteActions(value.actions)

const isNewSessionDialogPayload = (
  value: unknown
): value is NativeOverlayNewSessionDialogPayload =>
  isRecord(value) &&
  value.dialog === 'new-session' &&
  isString(value.ariaLabel) &&
  typeof value.name === 'string' &&
  typeof value.path === 'string' &&
  typeof value.nameEdited === 'boolean' &&
  isString(value.selectedLayoutId) &&
  isFiniteNumber(value.activeCommandPaneIndex) &&
  value.activeCommandPaneIndex >= 0 &&
  isNonEmptyBoundedArray(
    value.layouts,
    MAX_NEW_SESSION_LAYOUTS,
    isNewSessionLayoutOption
  ) &&
  isNonEmptyBoundedArray(
    value.panes,
    MAX_NEW_SESSION_PANES,
    isNewSessionPaneOption
  ) &&
  isNonEmptyBoundedArray(
    value.commands,
    MAX_NEW_SESSION_COMMANDS,
    isNewSessionCommandOption
  ) &&
  isNewSessionActions(value.actions)

const isDialogPayload = (value: unknown): value is NativeOverlayDialogPayload =>
  isRecord(value) &&
  value.kind === 'dialog' &&
  (isCommandPaletteDialogPayload(value) || isNewSessionDialogPayload(value))

const isThemeSnapshot = (value: unknown): value is NativeOverlayThemeSnapshot =>
  isRecord(value) &&
  (value.id === undefined || typeof value.id === 'string') &&
  (value.colorScheme === undefined || typeof value.colorScheme === 'string') &&
  isStringRecord(value.variables)

const isSerializablePayloadForKind = (
  kind: unknown,
  payload: unknown
): payload is SerializableOverlayPayload =>
  (kind === 'menu' && isMenuPayload(payload)) ||
  (kind === 'tooltip' && isTooltipPayload(payload)) ||
  (kind === 'dialog' && isDialogPayload(payload))

const isNativeOverlayRequest = (
  value: unknown
): value is NativeOverlayRequest =>
  isRecord(value) &&
  isString(value.surfaceId) &&
  (value.kind === 'menu' ||
    value.kind === 'tooltip' ||
    value.kind === 'dialog') &&
  isRect(value.anchorRect) &&
  isString(value.placement) &&
  isSerializablePayloadForKind(value.kind, value.payload) &&
  (value.theme === undefined || isThemeSnapshot(value.theme))

const isCloseReason = (value: unknown): value is NativeOverlayCloseReason =>
  value === 'outside' ||
  value === 'renderer' ||
  value === 'action' ||
  value === 'replaced' ||
  value === 'owner-closed'

const isCloseRequest = (value: unknown): value is NativeOverlayCloseRequest =>
  isRecord(value) &&
  isString(value.surfaceId) &&
  (value.reason === undefined || isCloseReason(value.reason))

const isActionEvent = (value: unknown): value is NativeOverlayActionEvent =>
  isRecord(value) &&
  isString(value.surfaceId) &&
  isString(value.actionId) &&
  (value.closeOnSelect === undefined ||
    typeof value.closeOnSelect === 'boolean') &&
  (value.suspendOnSelect === undefined ||
    typeof value.suspendOnSelect === 'boolean') &&
  (value.feedback === undefined || value.feedback === 'copy') &&
  (value.index === undefined || isFiniteNumber(value.index))

const isActionResultEvent = (
  value: unknown
): value is NativeOverlayActionResultEvent =>
  isRecord(value) &&
  isString(value.surfaceId) &&
  isString(value.actionId) &&
  value.feedback === 'copy' &&
  typeof value.ok === 'boolean'

const isReadyEvent = (value: unknown): value is NativeOverlayReadyEvent =>
  isRecord(value) && isString(value.surfaceId)

const menuKeyboardEventFromInput = (
  surfaceId: string,
  input: Input
): NativeOverlayKeyboardEvent | null => {
  if (input.type !== 'keyDown') {
    return null
  }

  const key = MENU_KEY_MAP[input.key] ?? MENU_KEY_MAP[input.code]
  if (key === undefined) {
    return null
  }

  return {
    surfaceId,
    key,
    code: input.code,
    altKey: input.alt,
    ctrlKey: input.control,
    metaKey: input.meta,
    shiftKey: input.shift,
    repeat: input.isAutoRepeat,
  }
}

export class NativeOverlayController {
  private readonly menuOverlayUrl: string
  private readonly tooltipOverlayUrl: string
  private readonly platform: NodeJS.Platform
  private readonly overlays = new Map<number, NativeOverlayRecord>()
  private readonly surfaces = new Map<string, NativeOverlaySurface>()
  private readonly pendingReady = new Map<string, (ready: boolean) => void>()
  private registeredIpc: IpcMainLike | null = null

  constructor(options: NativeOverlayControllerOptions) {
    this.menuOverlayUrl = options.menuOverlayUrl
    this.tooltipOverlayUrl = options.tooltipOverlayUrl
    this.platform = options.platform ?? process.platform
  }

  register(ipc: IpcMainLike = ipcMain): void {
    if (this.registeredIpc !== null) {
      this.unregister()
    }

    ipc.handle(NATIVE_OVERLAY_OPEN, this.handleOpen)
    ipc.handle(NATIVE_OVERLAY_CLOSE, this.handleClose)
    ipc.handle(NATIVE_OVERLAY_READY, this.handleReady)
    ipc.handle(NATIVE_OVERLAY_ACTION, this.handleAction)
    ipc.handle(NATIVE_OVERLAY_ACTION_RESULT, this.handleActionResult)
    ipc.handle(NATIVE_OVERLAY_RESUME, this.handleResume)
    this.registeredIpc = ipc
  }

  unregister(): void {
    if (this.registeredIpc !== null) {
      this.registeredIpc.removeHandler(NATIVE_OVERLAY_OPEN)
      this.registeredIpc.removeHandler(NATIVE_OVERLAY_CLOSE)
      this.registeredIpc.removeHandler(NATIVE_OVERLAY_READY)
      this.registeredIpc.removeHandler(NATIVE_OVERLAY_ACTION)
      this.registeredIpc.removeHandler(NATIVE_OVERLAY_ACTION_RESULT)
      this.registeredIpc.removeHandler(NATIVE_OVERLAY_RESUME)
      this.registeredIpc = null
    }

    for (const resolve of this.pendingReady.values()) {
      resolve(false)
    }
    this.pendingReady.clear()

    for (const record of [...this.overlays.values()]) {
      this.destroyOverlayRecord(record, 'owner-closed', false)
    }

    this.overlays.clear()
    this.surfaces.clear()
  }

  private readonly handleOpen = async (
    event: IpcMainInvokeEvent,
    payload: unknown
  ): Promise<NativeOverlayOpenResult> => {
    if (this.platform !== 'darwin') {
      return { accepted: false, reason: 'unsupported-platform' }
    }

    if (!isNativeOverlayRequest(payload)) {
      return { accepted: false, reason: 'invalid-payload' }
    }

    const parent = BrowserWindow.fromWebContents(event.sender)
    if (parent === null || parent.isDestroyed()) {
      return { accepted: false, reason: 'missing-parent-window' }
    }

    const record = this.getOrCreateOverlayRecord(parent)

    if (payload.kind === 'tooltip') {
      return this.openTooltipSurface(event.sender, parent, record, payload)
    }

    return this.openMenuSurface(event.sender, parent, record, payload)
  }

  private async openMenuSurface(
    owner: WebContents,
    parent: BrowserWindow,
    record: NativeOverlayRecord,
    payload: NativeOverlayRequest
  ): Promise<NativeOverlayOpenResult> {
    if (record.activeTooltipSurfaceId !== null) {
      this.closeSurface(record.activeTooltipSurfaceId, 'replaced', true, false)
    }

    if (
      record.activeSurfaceId !== null &&
      record.activeSurfaceId !== payload.surfaceId
    ) {
      this.closeSurface(record.activeSurfaceId, 'replaced', true)
    }

    const layerReady = await record.menu.ready
    if (!layerReady) {
      return { accepted: false, reason: 'overlay-load-failed' }
    }
    if (parent.isDestroyed() || record.menu.window.isDestroyed()) {
      return { accepted: false, reason: 'owner-closed' }
    }

    record.syncBounds()
    record.menu.window.setIgnoreMouseEvents(false)
    record.menu.window.showInactive()
    // Ghostty is an AppKit NSView, so ordinary Electron window ordering can
    // still land behind it. The screen-saver level reliably places this
    // transparent overlay window above that native surface while it is open.
    record.menu.window.setAlwaysOnTop(true, 'screen-saver')
    record.menu.window.moveTop()
    record.activeSurfaceId = payload.surfaceId
    this.surfaces.set(payload.surfaceId, {
      owner,
      parentId: parent.id,
      kind: payload.kind,
    })

    const readyPromise = this.waitForReady(payload.surfaceId)
    record.menu.window.webContents.send(NATIVE_OVERLAY_RENDER, payload)
    const ready = await readyPromise
    if (!ready || record.activeSurfaceId !== payload.surfaceId) {
      this.closeSurface(payload.surfaceId, 'renderer', false)

      return { accepted: false, reason: 'render-timeout' }
    }

    return { accepted: true }
  }

  private async openTooltipSurface(
    owner: WebContents,
    parent: BrowserWindow,
    record: NativeOverlayRecord,
    payload: NativeOverlayRequest
  ): Promise<NativeOverlayOpenResult> {
    const isActiveTooltipRefresh =
      record.activeTooltipSurfaceId === payload.surfaceId

    if (record.activeTooltipSurfaceId !== null && !isActiveTooltipRefresh) {
      this.closeSurface(record.activeTooltipSurfaceId, 'replaced', true, false)
    }

    const layerReady = await record.tooltip.ready
    if (!layerReady) {
      return { accepted: false, reason: 'overlay-load-failed' }
    }
    if (parent.isDestroyed() || record.tooltip.window.isDestroyed()) {
      return { accepted: false, reason: 'owner-closed' }
    }

    record.syncBounds()
    record.tooltip.window.setIgnoreMouseEvents(true)
    record.tooltip.window.showInactive()
    // Tooltip overlay is intentionally passive and topmost. It shares the same
    // z-order fix as menus but never takes focus or pointer events from them.
    record.tooltip.window.setAlwaysOnTop(true, 'screen-saver')
    record.tooltip.window.moveTop()
    record.activeTooltipSurfaceId = payload.surfaceId
    this.surfaces.set(payload.surfaceId, {
      owner,
      parentId: parent.id,
      kind: 'tooltip',
    })

    if (isActiveTooltipRefresh) {
      this.resolvePendingReady(payload.surfaceId, true)
      record.tooltip.window.webContents.send(NATIVE_OVERLAY_RENDER, payload)

      return { accepted: true }
    }

    const readyPromise = this.waitForReady(payload.surfaceId)
    record.tooltip.window.webContents.send(NATIVE_OVERLAY_RENDER, payload)
    const ready = await readyPromise
    if (!ready || record.activeTooltipSurfaceId !== payload.surfaceId) {
      this.closeSurface(payload.surfaceId, 'renderer', false, false)

      return { accepted: false, reason: 'render-timeout' }
    }

    return { accepted: true }
  }

  private readonly handleClose = (
    event: IpcMainInvokeEvent,
    payload: unknown
  ): void => {
    if (!isCloseRequest(payload)) {
      return
    }

    if (!this.surfaceFromCloseSender(payload.surfaceId, event.sender)) {
      return
    }

    const effectiveReason = payload.reason ?? 'renderer'
    this.closeSurface(
      payload.surfaceId,
      effectiveReason,
      effectiveReason !== 'renderer'
    )
  }

  private readonly handleReady = (
    event: IpcMainInvokeEvent,
    payload: unknown
  ): void => {
    if (!isReadyEvent(payload)) {
      return
    }

    if (!this.surfaceFromOverlaySender(payload.surfaceId, event.sender)) {
      return
    }

    this.resolvePendingReady(payload.surfaceId, true)
  }

  private readonly handleAction = (
    event: IpcMainInvokeEvent,
    payload: unknown
  ): void => {
    if (!isActionEvent(payload)) {
      return
    }

    const surface = this.surfaceFromOverlaySender(
      payload.surfaceId,
      event.sender
    )
    if (!surface) {
      return
    }

    if (surface.kind !== 'menu' && surface.kind !== 'dialog') {
      return
    }

    const owner = surface.owner
    if (payload.closeOnSelect !== false) {
      this.closeSurface(payload.surfaceId, 'action', false)
    } else if (payload.suspendOnSelect === true) {
      this.suspendSurface(payload.surfaceId)
    }

    if (!owner.isDestroyed()) {
      owner.send(NATIVE_OVERLAY_ACTION, payload)
    }
  }

  private readonly handleResume = (
    event: IpcMainInvokeEvent,
    payload: unknown
  ): void => {
    if (!isCloseRequest(payload)) {
      return
    }

    if (!this.surfaceFromOwnerSender(payload.surfaceId, event.sender)) {
      return
    }

    this.resumeSurface(payload.surfaceId)
  }

  private readonly handleActionResult = (
    event: IpcMainInvokeEvent,
    payload: unknown
  ): void => {
    if (!isActionResultEvent(payload)) {
      return
    }

    const surface = this.surfaceFromOwnerSender(payload.surfaceId, event.sender)
    if (!surface) {
      return
    }

    if (surface.kind !== 'menu') {
      return
    }

    const record = this.overlays.get(surface.parentId)
    if (!record || record.menu.window.isDestroyed()) {
      return
    }

    record.menu.window.webContents.send(NATIVE_OVERLAY_ACTION_RESULT, payload)
  }

  private createOverlayLayer(
    parent: BrowserWindow,
    url: string,
    focusable: boolean,
    acceptFirstMouse: boolean
  ): NativeOverlayLayerRecord {
    const overlayWindow = new BrowserWindow({
      parent,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      acceptFirstMouse,
      focusable,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: path.join(__dirname, 'preload.mjs'),
      },
    })

    const ready = new Promise<boolean>((resolve) => {
      let settled = false

      const finish = (value: boolean): void => {
        if (settled) {
          return
        }

        settled = true
        clearTimeout(timeout)
        overlayWindow.webContents.removeListener(
          'did-finish-load',
          handleFinish
        )
        overlayWindow.webContents.removeListener('did-fail-load', handleFail)
        resolve(value)
      }
      const timeout = setTimeout(() => finish(false), OVERLAY_RENDER_TIMEOUT_MS)
      const handleFinish = (): void => finish(true)
      const handleFail = (): void => finish(false)

      overlayWindow.webContents.once('did-finish-load', handleFinish)
      overlayWindow.webContents.once('did-fail-load', handleFail)
    })

    overlayWindow.setIgnoreMouseEvents(true)
    installNavigationGuard(overlayWindow, (externalUrl) => {
      void shell.openExternal(externalUrl)
    })
    void overlayWindow.loadURL(url)

    return { window: overlayWindow, ready }
  }

  private getOrCreateOverlayRecord(parent: BrowserWindow): NativeOverlayRecord {
    const existing = this.overlays.get(parent.id)
    if (existing) {
      return existing
    }

    // NativeOverlay owns two transparent child windows: an interactive menu
    // layer and a passive tooltip layer above it. Keeping them separate lets a
    // hover tooltip appear while a menu is open without replacing that menu.
    const menu = this.createOverlayLayer(
      parent,
      this.menuOverlayUrl,
      false,
      true
    )

    const tooltip = this.createOverlayLayer(
      parent,
      this.tooltipOverlayUrl,
      false,
      false
    )

    const syncBounds = (): void => {
      if (parent.isDestroyed()) {
        return
      }

      const bounds = parent.getContentBounds()
      if (!menu.window.isDestroyed()) {
        menu.window.setBounds(bounds)
      }
      if (!tooltip.window.isDestroyed()) {
        tooltip.window.setBounds(bounds)
      }
    }

    const closeForOwnerDeactivation = (): void => {
      const record = this.overlays.get(parent.id)
      if (!record) {
        return
      }

      if (record.activeSurfaceId !== null) {
        this.closeSurface(record.activeSurfaceId, 'outside', true, false)
      }

      if (record.activeTooltipSurfaceId !== null) {
        this.closeSurface(record.activeTooltipSurfaceId, 'outside', true, false)
      }
    }

    const ownerBeforeInput = (event: ElectronEvent, input: Input): void => {
      const activeRecord = this.overlays.get(parent.id)
      if (
        activeRecord?.activeSurfaceId === undefined ||
        activeRecord.activeSurfaceId === null
      ) {
        return
      }

      const surfaceId = activeRecord.activeSurfaceId
      const surface = this.surfaces.get(surfaceId)
      if (dispatchCommandPaletteShortcutForWindow(parent, input)) {
        event.preventDefault()

        return
      }

      if (surface?.kind !== 'menu') {
        return
      }

      const keyEvent = menuKeyboardEventFromInput(surfaceId, input)
      if (keyEvent === null) {
        return
      }

      event.preventDefault()
      activeRecord.menu.window.webContents.send(
        NATIVE_OVERLAY_KEYDOWN,
        keyEvent
      )
    }

    const parentClosing = (): void => {
      const record = this.overlays.get(parent.id)
      if (!record) {
        return
      }

      this.destroyOverlayRecord(record, 'owner-closed', true)
    }

    const parentClosed = (): void => {
      const record = this.overlays.get(parent.id)
      if (!record) {
        return
      }

      this.destroyOverlayRecord(record, 'owner-closed', true)
    }

    parent.on('resize', syncBounds)
    parent.on('move', syncBounds)
    parent.on('blur', closeForOwnerDeactivation)
    parent.on('hide', closeForOwnerDeactivation)
    parent.on('minimize', closeForOwnerDeactivation)
    parent.on('close', parentClosing)
    parent.on('closed', parentClosed)
    parent.webContents.on('before-input-event', ownerBeforeInput)

    const record: NativeOverlayRecord = {
      parent,
      menu,
      tooltip,
      syncBounds,
      parentBlurred: closeForOwnerDeactivation,
      parentHidden: closeForOwnerDeactivation,
      parentMinimized: closeForOwnerDeactivation,
      parentClosing,
      parentClosed,
      ownerBeforeInput,
      activeSurfaceId: null,
      activeTooltipSurfaceId: null,
    }

    this.overlays.set(parent.id, record)

    return record
  }

  private destroyOverlayRecord(
    record: NativeOverlayRecord,
    reason: NativeOverlayCloseReason,
    notifyOwner: boolean
  ): void {
    if (!this.overlays.has(record.parent.id)) {
      return
    }

    if (record.activeSurfaceId !== null) {
      this.closeSurface(record.activeSurfaceId, reason, notifyOwner, false)
    }

    if (record.activeTooltipSurfaceId !== null) {
      this.closeSurface(
        record.activeTooltipSurfaceId,
        reason,
        notifyOwner,
        false
      )
    }

    record.parent.removeListener('resize', record.syncBounds)
    record.parent.removeListener('move', record.syncBounds)
    record.parent.removeListener('blur', record.parentBlurred)
    record.parent.removeListener('hide', record.parentHidden)
    record.parent.removeListener('minimize', record.parentMinimized)
    record.parent.removeListener('close', record.parentClosing)
    record.parent.removeListener('closed', record.parentClosed)
    record.parent.webContents.removeListener(
      'before-input-event',
      record.ownerBeforeInput
    )
    this.overlays.delete(record.parent.id)

    if (!record.menu.window.isDestroyed()) {
      record.menu.window.close()
    }

    if (!record.tooltip.window.isDestroyed()) {
      record.tooltip.window.close()
    }
  }

  private waitForReady(surfaceId: string): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.resolvePendingReady(surfaceId, false)
      }, OVERLAY_RENDER_TIMEOUT_MS)

      this.pendingReady.set(surfaceId, (ready) => {
        clearTimeout(timeout)
        resolve(ready)
      })
    })
  }

  private resolvePendingReady(surfaceId: string, ready: boolean): void {
    const resolve = this.pendingReady.get(surfaceId)
    if (!resolve) {
      return
    }

    this.pendingReady.delete(surfaceId)
    resolve(ready)
  }

  private closeSurface(
    surfaceId: string,
    reason: NativeOverlayCloseReason,
    notifyOwner: boolean,
    restoreOwnerFocus = true
  ): void {
    const surface = this.surfaces.get(surfaceId)
    if (!surface) {
      return
    }

    const record = this.overlays.get(surface.parentId)

    const isActiveSurface =
      surface.kind === 'tooltip'
        ? record?.activeTooltipSurfaceId === surfaceId
        : record?.activeSurfaceId === surfaceId

    this.surfaces.delete(surfaceId)
    this.resolvePendingReady(surfaceId, false)

    if (record && isActiveSurface) {
      const overlayWindow =
        surface.kind === 'tooltip' ? record.tooltip.window : record.menu.window
      if (surface.kind === 'tooltip') {
        record.activeTooltipSurfaceId = null
      } else {
        record.activeSurfaceId = null
      }

      if (!overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send(NATIVE_OVERLAY_CLEAR)
        overlayWindow.hide()
        overlayWindow.setAlwaysOnTop(false)
        overlayWindow.setIgnoreMouseEvents(true)
      }
    }

    if (!surface.owner.isDestroyed()) {
      if (
        (surface.kind === 'menu' || surface.kind === 'dialog') &&
        isActiveSurface &&
        restoreOwnerFocus
      ) {
        surface.owner.focus()
      }
      if (notifyOwner) {
        surface.owner.send(NATIVE_OVERLAY_CLOSED, { surfaceId, reason })
      }
    }
  }

  private suspendSurface(surfaceId: string): void {
    const surface = this.surfaces.get(surfaceId)
    if (!surface || surface.kind === 'tooltip') {
      return
    }

    const record = this.overlays.get(surface.parentId)
    if (
      record?.activeSurfaceId !== surfaceId ||
      record.menu.window.isDestroyed()
    ) {
      return
    }

    const overlayWindow = record.menu.window
    resetOverlayCursor(overlayWindow)
    overlayWindow.setAlwaysOnTop(false)
    overlayWindow.setIgnoreMouseEvents(true)
  }

  private resumeSurface(surfaceId: string): void {
    const surface = this.surfaces.get(surfaceId)
    if (!surface || surface.kind === 'tooltip') {
      return
    }

    const record = this.overlays.get(surface.parentId)
    if (
      record?.activeSurfaceId !== surfaceId ||
      record.menu.window.isDestroyed()
    ) {
      return
    }

    record.syncBounds()
    const overlayWindow = record.menu.window
    overlayWindow.setIgnoreMouseEvents(false)
    overlayWindow.showInactive()
    overlayWindow.setAlwaysOnTop(true, 'screen-saver')
    overlayWindow.moveTop()
    resetOverlayCursor(overlayWindow)
  }

  private surfaceFromOverlaySender(
    surfaceId: string,
    sender: WebContents
  ): NativeOverlaySurface | null {
    const surface = this.surfaces.get(surfaceId)
    if (!surface) {
      return null
    }

    const record = this.overlays.get(surface.parentId)

    const overlayWindow =
      surface.kind === 'tooltip' ? record?.tooltip.window : record?.menu.window

    if (overlayWindow?.webContents !== sender) {
      return null
    }

    return surface
  }

  private surfaceFromCloseSender(
    surfaceId: string,
    sender: WebContents
  ): NativeOverlaySurface | null {
    const surface = this.surfaces.get(surfaceId)
    if (!surface) {
      return null
    }

    const record = this.overlays.get(surface.parentId)

    const overlayWindow =
      surface.kind === 'tooltip' ? record?.tooltip.window : record?.menu.window

    // Close is intentionally dual-caller: the owner renderer cancels local
    // sessions, while the overlay host closes on outside-press or Escape.
    if (surface.owner !== sender && overlayWindow?.webContents !== sender) {
      return null
    }

    return surface
  }

  private surfaceFromOwnerSender(
    surfaceId: string,
    sender: WebContents
  ): NativeOverlaySurface | null {
    const surface = this.surfaces.get(surfaceId)
    if (surface?.owner !== sender) {
      return null
    }

    return surface
  }
}

export const setupNativeOverlayIpc = (
  menuOverlayUrl: string,
  tooltipOverlayUrl: string
): NativeOverlayController => {
  const controller = new NativeOverlayController({
    menuOverlayUrl,
    tooltipOverlayUrl,
  })
  controller.register(ipcMain)

  return controller
}
