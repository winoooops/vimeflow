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
  NATIVE_OVERLAY_MOUSE_PASSTHROUGH,
  NATIVE_OVERLAY_OPEN,
  NATIVE_OVERLAY_PRELOAD,
  NATIVE_OVERLAY_READY,
  NATIVE_OVERLAY_RENDER,
  NATIVE_OVERLAY_RESUME,
} from './native-overlay-channels'
import { dispatchCommandPaletteShortcutForWindow } from './command-palette-shortcut'
import { installNavigationGuard } from './navigation-guard'
import {
  isNativeOverlayActivityPopoverPayload,
  type NativeOverlayActivityPopoverPayload,
} from '../src/components/nativeOverlayActivity'

// cspell:ignore AppKit Ghostty minimizable maximizable fullscreenable NSView

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export type NativeOverlayKind = 'menu' | 'tooltip' | 'popover' | 'dialog'

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
  closeOnSelect?: boolean
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
  shortcut?: string
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
  setQuery: string
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

interface NativeOverlayLayoutCreatorTrack {
  id: string
  units: number
  minPx?: number
}

interface NativeOverlayLayoutCreatorSlot {
  id: string
  rect: {
    col: number
    row: number
    colSpan: number
    rowSpan: number
  }
  accepts?: readonly string[]
}

interface NativeOverlayLayoutCreatorDefinition {
  schemaVersion: number
  id: string
  title: string
  source: 'builtin' | 'workspace'
  tracks: {
    columns: readonly NativeOverlayLayoutCreatorTrack[]
    rows: readonly NativeOverlayLayoutCreatorTrack[]
  }
  slots: readonly NativeOverlayLayoutCreatorSlot[]
  addOrder: readonly string[]
}

interface NativeOverlayLayoutCreatorActions {
  cancel: string
  save: string
}

interface NativeOverlayLayoutCreatorDialogPayload {
  kind: 'dialog'
  dialog: 'layout-creator'
  ariaLabel: string
  existingLayouts: readonly NativeOverlayLayoutCreatorDefinition[]
  seedLayout?: NativeOverlayLayoutCreatorDefinition
  editLayout?: NativeOverlayLayoutCreatorDefinition
  actions: NativeOverlayLayoutCreatorActions
}

interface NativeOverlaySessionSwitcherItem {
  id: string
  title: string
  agentGlyph?: string
  layoutId?: string
  isActive: boolean
}

interface NativeOverlaySessionSwitcherActions {
  commitIdPrefix: string
  cancel: string
}

interface NativeOverlaySessionSwitcherDialogPayload {
  kind: 'dialog'
  dialog: 'session-switcher'
  ariaLabel: string
  selectedIndex: number
  items: NativeOverlaySessionSwitcherItem[]
  actions: NativeOverlaySessionSwitcherActions
}

interface NativeOverlayNotificationCenterItem {
  id: string
  kind: 'need' | 'err'
  title: string
  body?: string
  sessionName: string
  agentId: 'claude' | 'codex' | 'kimi' | 'opencode' | 'shell'
  occurredAt: number
  read: boolean
  openActionId: string
  dismissActionId: string
}

interface NativeOverlayNotificationCenterActions {
  markAllRead: string
  clear: string
  close: string
}

interface NativeOverlayNotificationCenterDialogPayload {
  kind: 'dialog'
  dialog: 'notification-center'
  ariaLabel: string
  items: NativeOverlayNotificationCenterItem[]
  actions: NativeOverlayNotificationCenterActions
}

type NativeOverlayDialogPayload =
  | NativeOverlayCommandPaletteDialogPayload
  | NativeOverlayNewSessionDialogPayload
  | NativeOverlayLayoutCreatorDialogPayload
  | NativeOverlaySessionSwitcherDialogPayload
  | NativeOverlayNotificationCenterDialogPayload

type SerializableOverlayPayload =
  | NativeOverlayMenuPayload
  | NativeOverlayTooltipPayload
  | NativeOverlayActivityPopoverPayload
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

interface NativeOverlayMousePassthroughRequest {
  surfaceId: string
  passthrough: boolean
}

interface NativeOverlayActionEvent {
  surfaceId: string
  actionId: string
  closeOnSelect?: boolean
  suspendOnSelect?: boolean
  feedback?: 'copy'
  index?: number
  query?: string
}

interface NativeOverlayActionResultEvent {
  surfaceId: string
  actionId: string
  feedback?: 'copy'
  ok: boolean
  error?: string
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
  menuBlurred: () => void
  ownerBeforeInput: (event: ElectronEvent, input: Input) => void
  activeSurfaceId: string | null
  activeTooltipSurfaceId: string | null
}

interface NativeOverlaySurface {
  owner: WebContents
  parentId: number
  kind: NativeOverlayKind
  dialog?: NativeOverlayDialogPayload['dialog']
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

const OVERLAY_LOAD_TIMEOUT_MS = 5000
const OVERLAY_RENDER_TIMEOUT_MS = 5000
const FOCUS_HANDOFF_GRACE_MS = 250
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
const MAX_LAYOUT_CREATOR_LAYOUTS = 200
const MAX_LAYOUT_CREATOR_TRACKS = 24
const MAX_LAYOUT_CREATOR_SLOTS = 16
const MAX_LAYOUT_CREATOR_ACCEPTS = 8
const MAX_THEME_VARIABLES = 512
const MAX_SESSION_SWITCHER_ITEMS = 500
const MAX_NOTIFICATION_CENTER_ITEMS = 50
const MAX_NOTIFICATION_ID_LENGTH = 128
const MAX_NOTIFICATION_TITLE_LENGTH = 160
const MAX_NOTIFICATION_BODY_LENGTH = 500
const MAX_NOTIFICATION_SESSION_NAME_LENGTH = 160
const MAX_NOTIFICATION_ACTION_ID_LENGTH = 256

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

const DIALOG_KEY_MAP: Readonly<Partial<Record<string, string>>> = {
  ...MENU_KEY_MAP,
  Backspace: 'Backspace',
  Delete: 'Delete',
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

const isBoundedString = (value: unknown, maxLength: number): value is string =>
  isString(value) && value.length <= maxLength

const isFocusOwnedDialogSurface = (
  surface: NativeOverlaySurface | undefined
): boolean =>
  surface?.kind === 'dialog' &&
  (surface.dialog === 'layout-creator' ||
    surface.dialog === 'notification-center')

const requestNeedsKeyboardFocus = (payload: NativeOverlayRequest): boolean =>
  payload.payload.kind === 'dialog' &&
  (payload.payload.dialog === 'layout-creator' ||
    payload.payload.dialog === 'notification-center')

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const isNonNegativeInteger = (value: unknown): value is number =>
  isFiniteNumber(value) && Number.isInteger(value) && value >= 0

const isPositiveInteger = (value: unknown): value is number =>
  isFiniteNumber(value) && Number.isInteger(value) && value > 0

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
  (value.disabled === undefined || typeof value.disabled === 'boolean') &&
  (value.closeOnSelect === undefined ||
    typeof value.closeOnSelect === 'boolean')

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
  (value.shortcut === undefined || isString(value.shortcut)) &&
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
  isRecord(value) &&
  isString(value.selectIndex) &&
  isString(value.executeIndex) &&
  isString(value.setQuery)

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

const isLayoutCreatorTrack = (
  value: unknown
): value is NativeOverlayLayoutCreatorTrack =>
  isRecord(value) &&
  isString(value.id) &&
  isFiniteNumber(value.units) &&
  value.units > 0 &&
  (value.minPx === undefined ||
    (isFiniteNumber(value.minPx) && value.minPx >= 0))

const isLayoutCreatorSlot = (
  value: unknown
): value is NativeOverlayLayoutCreatorSlot =>
  isRecord(value) &&
  isString(value.id) &&
  isRecord(value.rect) &&
  isNonNegativeInteger(value.rect.col) &&
  isNonNegativeInteger(value.rect.row) &&
  isPositiveInteger(value.rect.colSpan) &&
  isPositiveInteger(value.rect.rowSpan) &&
  (value.accepts === undefined ||
    isBoundedArray(
      value.accepts,
      MAX_LAYOUT_CREATOR_ACCEPTS,
      (entry): entry is string => isString(entry)
    ))

const isLayoutCreatorDefinition = (
  value: unknown
): value is NativeOverlayLayoutCreatorDefinition =>
  isRecord(value) &&
  Number.isInteger(value.schemaVersion) &&
  isString(value.id) &&
  isString(value.title) &&
  (value.source === 'builtin' || value.source === 'workspace') &&
  isRecord(value.tracks) &&
  isNonEmptyBoundedArray(
    value.tracks.columns,
    MAX_LAYOUT_CREATOR_TRACKS,
    isLayoutCreatorTrack
  ) &&
  isNonEmptyBoundedArray(
    value.tracks.rows,
    MAX_LAYOUT_CREATOR_TRACKS,
    isLayoutCreatorTrack
  ) &&
  isNonEmptyBoundedArray(
    value.slots,
    MAX_LAYOUT_CREATOR_SLOTS,
    isLayoutCreatorSlot
  ) &&
  isNonEmptyBoundedArray(
    value.addOrder,
    MAX_LAYOUT_CREATOR_SLOTS,
    (entry): entry is string => isString(entry)
  )

const isLayoutCreatorActions = (
  value: unknown
): value is NativeOverlayLayoutCreatorActions =>
  isRecord(value) && isString(value.cancel) && isString(value.save)

const isLayoutCreatorDialogPayload = (
  value: unknown
): value is NativeOverlayLayoutCreatorDialogPayload =>
  isRecord(value) &&
  value.dialog === 'layout-creator' &&
  isString(value.ariaLabel) &&
  isBoundedArray(
    value.existingLayouts,
    MAX_LAYOUT_CREATOR_LAYOUTS,
    isLayoutCreatorDefinition
  ) &&
  (value.seedLayout === undefined ||
    isLayoutCreatorDefinition(value.seedLayout)) &&
  (value.editLayout === undefined ||
    isLayoutCreatorDefinition(value.editLayout)) &&
  isLayoutCreatorActions(value.actions)

const isSessionSwitcherItem = (
  value: unknown
): value is NativeOverlaySessionSwitcherItem =>
  isRecord(value) &&
  isString(value.id) &&
  isString(value.title) &&
  (value.agentGlyph === undefined || typeof value.agentGlyph === 'string') &&
  (value.layoutId === undefined || typeof value.layoutId === 'string') &&
  typeof value.isActive === 'boolean'

const isSessionSwitcherActions = (
  value: unknown
): value is NativeOverlaySessionSwitcherActions =>
  isRecord(value) && isString(value.commitIdPrefix) && isString(value.cancel)

const isSessionSwitcherDialogPayload = (
  value: unknown
): value is NativeOverlaySessionSwitcherDialogPayload =>
  isRecord(value) &&
  value.dialog === 'session-switcher' &&
  isString(value.ariaLabel) &&
  isFiniteNumber(value.selectedIndex) &&
  value.selectedIndex >= 0 &&
  isBoundedArray(
    value.items,
    MAX_SESSION_SWITCHER_ITEMS,
    isSessionSwitcherItem
  ) &&
  isSessionSwitcherActions(value.actions)

const isNotificationCenterItem = (
  value: unknown
): value is NativeOverlayNotificationCenterItem =>
  isRecord(value) &&
  isBoundedString(value.id, MAX_NOTIFICATION_ID_LENGTH) &&
  (value.kind === 'need' || value.kind === 'err') &&
  isBoundedString(value.title, MAX_NOTIFICATION_TITLE_LENGTH) &&
  (value.body === undefined ||
    isBoundedString(value.body, MAX_NOTIFICATION_BODY_LENGTH)) &&
  isBoundedString(value.sessionName, MAX_NOTIFICATION_SESSION_NAME_LENGTH) &&
  (value.agentId === 'claude' ||
    value.agentId === 'codex' ||
    value.agentId === 'kimi' ||
    value.agentId === 'opencode' ||
    value.agentId === 'shell') &&
  isFiniteNumber(value.occurredAt) &&
  value.occurredAt >= 0 &&
  typeof value.read === 'boolean' &&
  isBoundedString(value.openActionId, MAX_NOTIFICATION_ACTION_ID_LENGTH) &&
  isBoundedString(value.dismissActionId, MAX_NOTIFICATION_ACTION_ID_LENGTH)

const isNotificationCenterActions = (
  value: unknown
): value is NativeOverlayNotificationCenterActions =>
  isRecord(value) &&
  isBoundedString(value.markAllRead, MAX_NOTIFICATION_ACTION_ID_LENGTH) &&
  isBoundedString(value.clear, MAX_NOTIFICATION_ACTION_ID_LENGTH) &&
  isBoundedString(value.close, MAX_NOTIFICATION_ACTION_ID_LENGTH)

const isNotificationCenterDialogPayload = (
  value: unknown
): value is NativeOverlayNotificationCenterDialogPayload =>
  isRecord(value) &&
  value.dialog === 'notification-center' &&
  isBoundedString(value.ariaLabel, MAX_NOTIFICATION_TITLE_LENGTH) &&
  isBoundedArray(
    value.items,
    MAX_NOTIFICATION_CENTER_ITEMS,
    isNotificationCenterItem
  ) &&
  isNotificationCenterActions(value.actions)

const isDialogPayload = (value: unknown): value is NativeOverlayDialogPayload =>
  isRecord(value) &&
  value.kind === 'dialog' &&
  (isCommandPaletteDialogPayload(value) ||
    isNewSessionDialogPayload(value) ||
    isLayoutCreatorDialogPayload(value) ||
    isSessionSwitcherDialogPayload(value) ||
    isNotificationCenterDialogPayload(value))

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
  (kind === 'popover' && isNativeOverlayActivityPopoverPayload(payload)) ||
  (kind === 'dialog' && isDialogPayload(payload))

const isNativeOverlayRequest = (
  value: unknown
): value is NativeOverlayRequest =>
  isRecord(value) &&
  isString(value.surfaceId) &&
  (value.kind === 'menu' ||
    value.kind === 'tooltip' ||
    value.kind === 'popover' ||
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

const isMousePassthroughRequest = (
  value: unknown
): value is NativeOverlayMousePassthroughRequest =>
  isRecord(value) &&
  isString(value.surfaceId) &&
  typeof value.passthrough === 'boolean'

const isActionEvent = (value: unknown): value is NativeOverlayActionEvent =>
  isRecord(value) &&
  isString(value.surfaceId) &&
  isString(value.actionId) &&
  (value.closeOnSelect === undefined ||
    typeof value.closeOnSelect === 'boolean') &&
  (value.suspendOnSelect === undefined ||
    typeof value.suspendOnSelect === 'boolean') &&
  (value.feedback === undefined || value.feedback === 'copy') &&
  (value.index === undefined || isFiniteNumber(value.index)) &&
  (value.query === undefined || typeof value.query === 'string')

const isActionResultEvent = (
  value: unknown
): value is NativeOverlayActionResultEvent =>
  isRecord(value) &&
  isString(value.surfaceId) &&
  isString(value.actionId) &&
  (value.feedback === undefined || value.feedback === 'copy') &&
  typeof value.ok === 'boolean' &&
  (value.error === undefined || isString(value.error))

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

const dialogKeyboardEventFromInput = (
  surfaceId: string,
  input: Input
): NativeOverlayKeyboardEvent | null => {
  if (input.type !== 'keyDown') {
    return null
  }

  // Keep Tab in the owner renderer for command-palette completion.
  if (input.key === 'Tab' || input.code === 'Tab') {
    return null
  }

  const mapped = DIALOG_KEY_MAP[input.key] ?? DIALOG_KEY_MAP[input.code]

  const printable =
    mapped === undefined &&
    !input.alt &&
    !input.control &&
    !input.meta &&
    input.key.length === 1
      ? input.key
      : undefined
  const key = mapped ?? printable

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
  private readonly suspendedSurfaceIds = new Set<string>()
  private readonly internalFocusHandoffSurfaceIds = new Set<string>()
  private readonly internalFocusHandoffTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >()
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
    ipc.handle(NATIVE_OVERLAY_PRELOAD, this.handlePreload)
    ipc.handle(NATIVE_OVERLAY_READY, this.handleReady)
    ipc.handle(NATIVE_OVERLAY_MOUSE_PASSTHROUGH, this.handleMousePassthrough)
    ipc.handle(NATIVE_OVERLAY_ACTION, this.handleAction)
    ipc.handle(NATIVE_OVERLAY_ACTION_RESULT, this.handleActionResult)
    ipc.handle(NATIVE_OVERLAY_RESUME, this.handleResume)
    this.registeredIpc = ipc
  }

  unregister(): void {
    if (this.registeredIpc !== null) {
      this.registeredIpc.removeHandler(NATIVE_OVERLAY_OPEN)
      this.registeredIpc.removeHandler(NATIVE_OVERLAY_CLOSE)
      this.registeredIpc.removeHandler(NATIVE_OVERLAY_PRELOAD)
      this.registeredIpc.removeHandler(NATIVE_OVERLAY_READY)
      this.registeredIpc.removeHandler(NATIVE_OVERLAY_MOUSE_PASSTHROUGH)
      this.registeredIpc.removeHandler(NATIVE_OVERLAY_ACTION)
      this.registeredIpc.removeHandler(NATIVE_OVERLAY_ACTION_RESULT)
      this.registeredIpc.removeHandler(NATIVE_OVERLAY_RESUME)
      this.registeredIpc = null
    }

    for (const resolve of this.pendingReady.values()) {
      resolve(false)
    }
    this.pendingReady.clear()
    for (const timer of this.internalFocusHandoffTimers.values()) {
      clearTimeout(timer)
    }
    this.internalFocusHandoffTimers.clear()
    this.suspendedSurfaceIds.clear()
    this.internalFocusHandoffSurfaceIds.clear()

    for (const record of [...this.overlays.values()]) {
      this.destroyOverlayRecord(record, 'owner-closed', false)
    }

    this.overlays.clear()
    this.surfaces.clear()
  }

  hasActiveInteractiveOverlaySurface(parent: BrowserWindow): boolean {
    const record = this.overlays.get(parent.id)

    return (
      record?.activeSurfaceId !== null && record?.activeSurfaceId !== undefined
    )
  }

  hasActiveShortcutBlockingOverlaySurface(parent: BrowserWindow): boolean {
    const activeSurfaceId = this.overlays.get(parent.id)?.activeSurfaceId

    if (activeSurfaceId === null || activeSurfaceId === undefined) {
      return false
    }

    return this.surfaces.get(activeSurfaceId)?.kind !== 'popover'
  }

  // Creates the overlay layer windows and starts their URL load ahead of the
  // first real surface, so a first-time open doesn't pay window creation +
  // layer load. Fire-and-forget; the layer's ready promise gates opens.
  private readonly handlePreload = (
    event: IpcMainInvokeEvent
  ): NativeOverlayOpenResult => {
    if (this.platform !== 'darwin') {
      return { accepted: false, reason: 'unsupported-platform' }
    }

    const parent = BrowserWindow.fromWebContents(event.sender)
    if (parent === null || parent.isDestroyed()) {
      return { accepted: false, reason: 'missing-parent-window' }
    }

    this.getOrCreateOverlayRecord(parent)

    return { accepted: true }
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

    const needsKeyboardFocus = requestNeedsKeyboardFocus(payload)

    const dialog =
      payload.payload.kind === 'dialog' ? payload.payload.dialog : undefined
    record.activeSurfaceId = payload.surfaceId
    this.surfaces.set(payload.surfaceId, {
      owner,
      parentId: parent.id,
      kind: payload.kind,
      ...(dialog === undefined ? {} : { dialog }),
    })

    if (!this.suspendedSurfaceIds.has(payload.surfaceId)) {
      this.promoteInteractiveLayer(
        record,
        payload.surfaceId,
        needsKeyboardFocus
      )
    }

    const readyPromise = this.waitForReady(payload.surfaceId)
    record.menu.window.webContents.send(NATIVE_OVERLAY_RENDER, payload)
    const ready = await readyPromise
    if (!ready || record.activeSurfaceId !== payload.surfaceId) {
      this.closeSurface(payload.surfaceId, 'renderer', false)

      return { accepted: false, reason: 'render-timeout' }
    }

    if (
      !this.suspendedSurfaceIds.has(payload.surfaceId) &&
      !needsKeyboardFocus
    ) {
      record.menu.window.moveTop()
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

    const surface = this.surfaceFromOverlaySender(
      payload.surfaceId,
      event.sender
    )
    if (!surface) {
      return
    }

    const record = this.overlays.get(surface.parentId)
    if (
      record?.activeSurfaceId === payload.surfaceId &&
      !this.suspendedSurfaceIds.has(payload.surfaceId) &&
      isFocusOwnedDialogSurface(surface)
    ) {
      this.promoteInteractiveLayer(record, payload.surfaceId, true)
    }

    this.resolvePendingReady(payload.surfaceId, true)
  }

  private readonly handleMousePassthrough = (
    event: IpcMainInvokeEvent,
    payload: unknown
  ): void => {
    if (!isMousePassthroughRequest(payload)) {
      return
    }

    const surface = this.surfaceFromOverlaySender(
      payload.surfaceId,
      event.sender
    )
    if (surface?.kind !== 'popover') {
      return
    }

    const overlayWindow = this.overlays.get(surface.parentId)?.menu.window
    if (overlayWindow === undefined || overlayWindow.isDestroyed()) {
      return
    }

    if (payload.passthrough) {
      overlayWindow.setIgnoreMouseEvents(true, { forward: true })

      return
    }

    overlayWindow.setIgnoreMouseEvents(false)
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

    if (
      surface.kind !== 'menu' &&
      surface.kind !== 'popover' &&
      surface.kind !== 'dialog'
    ) {
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

    if (surface.kind !== 'menu' && surface.kind !== 'dialog') {
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
      const timeout = setTimeout(() => finish(false), OVERLAY_LOAD_TIMEOUT_MS)
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

    // NativeOverlay owns one interactive surface layer and one passive tooltip
    // layer. Keeping them separate lets a pane-header tooltip remain click-through
    // while menus and popovers use normal pointer input above Ghostty.
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

      if (
        record.activeSurfaceId !== null &&
        !this.suspendedSurfaceIds.has(record.activeSurfaceId)
      ) {
        this.closeSurface(record.activeSurfaceId, 'outside', true, false)
      }

      if (record.activeTooltipSurfaceId !== null) {
        this.closeSurface(record.activeTooltipSurfaceId, 'outside', true, false)
      }
    }

    const closeForOwnerBlur = (): void => {
      const record = this.overlays.get(parent.id)
      if (!record || record.menu.window.isFocused()) {
        return
      }

      const activeSurfaceId = record.activeSurfaceId

      if (
        activeSurfaceId !== null &&
        this.internalFocusHandoffSurfaceIds.has(activeSurfaceId) &&
        isFocusOwnedDialogSurface(this.surfaces.get(activeSurfaceId))
      ) {
        return
      }

      closeForOwnerDeactivation()
    }

    const closeForMenuBlur = (): void => {
      const record = this.overlays.get(parent.id)
      if (!record) {
        return
      }

      const activeSurfaceId = record.activeSurfaceId

      if (
        activeSurfaceId !== null &&
        this.internalFocusHandoffSurfaceIds.has(activeSurfaceId) &&
        isFocusOwnedDialogSurface(this.surfaces.get(activeSurfaceId))
      ) {
        return
      }

      closeForOwnerDeactivation()
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

      const isKeyboardDialog =
        surface?.kind === 'dialog' &&
        (surface.dialog === 'command-palette' ||
          surface.dialog === 'notification-center')
      const isActivityPopover = surface?.kind === 'popover'
      if (surface?.kind !== 'menu' && !isActivityPopover && !isKeyboardDialog) {
        return
      }

      const keyEvent =
        surface.kind === 'dialog'
          ? dialogKeyboardEventFromInput(surfaceId, input)
          : menuKeyboardEventFromInput(surfaceId, input)
      if (
        keyEvent === null ||
        (isActivityPopover && keyEvent.key !== 'Escape')
      ) {
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
    parent.on('blur', closeForOwnerBlur)
    parent.on('hide', closeForOwnerDeactivation)
    parent.on('minimize', closeForOwnerDeactivation)
    parent.on('close', parentClosing)
    parent.on('closed', parentClosed)
    menu.window.on('blur', closeForMenuBlur)
    parent.webContents.on('before-input-event', ownerBeforeInput)

    const record: NativeOverlayRecord = {
      parent,
      menu,
      tooltip,
      syncBounds,
      parentBlurred: closeForOwnerBlur,
      parentHidden: closeForOwnerDeactivation,
      parentMinimized: closeForOwnerDeactivation,
      parentClosing,
      parentClosed,
      menuBlurred: closeForMenuBlur,
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
    record.menu.window.removeListener('blur', record.menuBlurred)
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

  private clearInternalFocusHandoff(surfaceId: string): void {
    const timer = this.internalFocusHandoffTimers.get(surfaceId)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.internalFocusHandoffTimers.delete(surfaceId)
    }
    this.internalFocusHandoffSurfaceIds.delete(surfaceId)
  }

  private finishInternalFocusHandoffSoon(surfaceId: string): void {
    const existingTimer = this.internalFocusHandoffTimers.get(surfaceId)
    if (existingTimer !== undefined) {
      clearTimeout(existingTimer)
    }

    const timer = setTimeout(() => {
      if (this.internalFocusHandoffTimers.get(surfaceId) !== timer) {
        return
      }

      this.internalFocusHandoffTimers.delete(surfaceId)
      this.internalFocusHandoffSurfaceIds.delete(surfaceId)
    }, FOCUS_HANDOFF_GRACE_MS)
    this.internalFocusHandoffTimers.set(surfaceId, timer)
  }

  private promoteInteractiveLayer(
    record: NativeOverlayRecord,
    surfaceId: string,
    needsKeyboardFocus: boolean
  ): void {
    const overlayWindow = record.menu.window
    if (overlayWindow.isDestroyed()) {
      return
    }

    overlayWindow.setFocusable(needsKeyboardFocus)
    overlayWindow.setIgnoreMouseEvents(false)
    // Ghostty is an AppKit NSView, so ordinary Electron window ordering can
    // still land behind it. The screen-saver level reliably places this
    // transparent overlay window above that native surface while it is open.
    overlayWindow.setAlwaysOnTop(true, 'screen-saver')
    if (needsKeyboardFocus) {
      this.internalFocusHandoffSurfaceIds.add(surfaceId)
      try {
        overlayWindow.show()
        overlayWindow.focus()
        overlayWindow.webContents.focus()
      } finally {
        this.finishInternalFocusHandoffSoon(surfaceId)
      }
    } else {
      overlayWindow.showInactive()
    }
    overlayWindow.moveTop()
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
    this.suspendedSurfaceIds.delete(surfaceId)
    this.clearInternalFocusHandoff(surfaceId)
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
        overlayWindow.setFocusable(false)
        overlayWindow.setAlwaysOnTop(false)
        overlayWindow.setIgnoreMouseEvents(true)
      }
    }

    if (!surface.owner.isDestroyed()) {
      if (
        (surface.kind === 'menu' ||
          surface.kind === 'popover' ||
          surface.kind === 'dialog') &&
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
    this.suspendedSurfaceIds.add(surfaceId)
    resetOverlayCursor(overlayWindow)
    overlayWindow.setAlwaysOnTop(false)
    overlayWindow.setIgnoreMouseEvents(true)
    overlayWindow.hide()
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
    const needsKeyboardFocus = isFocusOwnedDialogSurface(surface)
    this.suspendedSurfaceIds.delete(surfaceId)
    this.promoteInteractiveLayer(record, surfaceId, needsKeyboardFocus)
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
