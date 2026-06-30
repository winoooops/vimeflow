import {
  BrowserWindow,
  ipcMain,
  type IpcMain,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  NATIVE_OVERLAY_ACTION,
  NATIVE_OVERLAY_CLEAR,
  NATIVE_OVERLAY_CLOSE,
  NATIVE_OVERLAY_CLOSED,
  NATIVE_OVERLAY_OPEN,
  NATIVE_OVERLAY_READY,
  NATIVE_OVERLAY_RENDER,
} from './native-overlay-channels'

// cspell:ignore AppKit Ghostty minimizable maximizable fullscreenable NSView

const __dirname = path.dirname(fileURLToPath(import.meta.url))

type NativeOverlayKind = 'menu' | 'tooltip' | 'popover' | 'dialog'

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
  icon?: string
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
  items?: NativeOverlayMenuItem[]
  sections?: NativeOverlayMenuSection[]
}

interface NativeOverlayRequest {
  surfaceId: string
  kind: NativeOverlayKind
  anchorRect: NativeOverlayRect
  placement: string
  payload: NativeOverlayMenuPayload
}

interface NativeOverlayCloseRequest {
  surfaceId: string
  reason?: NativeOverlayCloseReason
}

interface NativeOverlayActionEvent {
  surfaceId: string
  actionId: string
}

interface NativeOverlayReadyEvent {
  surfaceId: string
}

interface NativeOverlayOpenResult {
  accepted: boolean
  reason?: string
}

interface NativeOverlayRecord {
  parent: BrowserWindow
  overlayWindow: BrowserWindow
  ready: Promise<void>
  syncBounds: () => void
  parentClosed: () => void
  activeSurfaceId: string | null
}

interface NativeOverlaySurface {
  owner: WebContents
  parentId: number
}

interface NativeOverlayControllerOptions {
  overlayUrl: string
  platform?: NodeJS.Platform
}

interface IpcMainLike {
  handle: IpcMain['handle']
  removeHandler: IpcMain['removeHandler']
}

const OVERLAY_RENDER_TIMEOUT_MS = 1000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

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
      Array.isArray(value.actions) &&
      value.actions.length > 0 &&
      value.actions.every(isMenuSubAction)
    )
  }

  const isActionType = value.type === undefined || value.type === 'item'

  const isCheckboxType =
    value.type === 'checkbox' && typeof value.checked === 'boolean'

  return (
    (isActionType || isCheckboxType) &&
    isString(value.id) &&
    isString(value.label) &&
    (value.icon === undefined || typeof value.icon === 'string') &&
    (value.shortcut === undefined || typeof value.shortcut === 'string') &&
    (value.disabled === undefined || typeof value.disabled === 'boolean')
  )
}

const hasMenuItems = (items: unknown): boolean =>
  Array.isArray(items) && items.length > 0 && items.every(isMenuItem)

const isMenuSection = (value: unknown): value is NativeOverlayMenuSection =>
  isRecord(value) &&
  (value.label === undefined || typeof value.label === 'string') &&
  hasMenuItems(value.items)

const hasMenuSections = (sections: unknown): boolean =>
  Array.isArray(sections) &&
  sections.length > 0 &&
  sections.every(isMenuSection)

const isMenuPayload = (value: unknown): value is NativeOverlayMenuPayload =>
  isRecord(value) &&
  value.kind === 'menu' &&
  (value.ariaLabel === undefined || typeof value.ariaLabel === 'string') &&
  (hasMenuItems(value.items) || hasMenuSections(value.sections))

const isNativeOverlayRequest = (
  value: unknown
): value is NativeOverlayRequest =>
  isRecord(value) &&
  isString(value.surfaceId) &&
  value.kind === 'menu' &&
  isRect(value.anchorRect) &&
  isString(value.placement) &&
  isMenuPayload(value.payload)

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
  isRecord(value) && isString(value.surfaceId) && isString(value.actionId)

const isReadyEvent = (value: unknown): value is NativeOverlayReadyEvent =>
  isRecord(value) && isString(value.surfaceId)

export class NativeOverlayController {
  private readonly overlayUrl: string
  private readonly platform: NodeJS.Platform
  private readonly overlays = new Map<number, NativeOverlayRecord>()
  private readonly surfaces = new Map<string, NativeOverlaySurface>()
  private readonly pendingReady = new Map<string, (ready: boolean) => void>()
  private registeredIpc: IpcMainLike | null = null

  constructor(options: NativeOverlayControllerOptions) {
    this.overlayUrl = options.overlayUrl
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
    this.registeredIpc = ipc
  }

  unregister(): void {
    if (this.registeredIpc !== null) {
      this.registeredIpc.removeHandler(NATIVE_OVERLAY_OPEN)
      this.registeredIpc.removeHandler(NATIVE_OVERLAY_CLOSE)
      this.registeredIpc.removeHandler(NATIVE_OVERLAY_READY)
      this.registeredIpc.removeHandler(NATIVE_OVERLAY_ACTION)
      this.registeredIpc = null
    }

    for (const resolve of this.pendingReady.values()) {
      resolve(false)
    }
    this.pendingReady.clear()

    for (const record of this.overlays.values()) {
      record.parent.removeListener('resize', record.syncBounds)
      record.parent.removeListener('move', record.syncBounds)
      record.parent.removeListener('closed', record.parentClosed)
      if (!record.overlayWindow.isDestroyed()) {
        record.overlayWindow.close()
      }
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
    if (record.activeSurfaceId !== null) {
      this.closeSurface(record.activeSurfaceId, 'replaced', true)
    }

    await record.ready
    record.syncBounds()
    record.overlayWindow.setIgnoreMouseEvents(false)
    record.overlayWindow.showInactive()
    // Ghostty is an AppKit NSView, so ordinary Electron window ordering can
    // still land behind it. The screen-saver level reliably places this
    // transparent overlay window above that native surface while it is open.
    record.overlayWindow.setAlwaysOnTop(true, 'screen-saver')
    record.overlayWindow.moveTop()
    record.activeSurfaceId = payload.surfaceId
    this.surfaces.set(payload.surfaceId, {
      owner: event.sender,
      parentId: parent.id,
    })

    const readyPromise = this.waitForReady(payload.surfaceId)
    record.overlayWindow.webContents.send(NATIVE_OVERLAY_RENDER, payload)
    const ready = await readyPromise
    if (!ready || record.activeSurfaceId !== payload.surfaceId) {
      this.closeSurface(payload.surfaceId, 'renderer', false)

      return { accepted: false, reason: 'render-timeout' }
    }

    return { accepted: true }
  }

  private readonly handleClose = (
    _event: IpcMainInvokeEvent,
    payload: unknown
  ): void => {
    if (!isCloseRequest(payload)) {
      return
    }

    this.closeSurface(
      payload.surfaceId,
      payload.reason ?? 'renderer',
      payload.reason !== 'renderer'
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

    const owner = surface.owner
    this.closeSurface(payload.surfaceId, 'action', false)

    if (!owner.isDestroyed()) {
      owner.send(NATIVE_OVERLAY_ACTION, payload)
    }
  }

  private getOrCreateOverlayRecord(parent: BrowserWindow): NativeOverlayRecord {
    const existing = this.overlays.get(parent.id)
    if (existing) {
      return existing
    }

    const overlayWindow = new BrowserWindow({
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
      acceptFirstMouse: true,
      focusable: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: path.join(__dirname, 'preload.mjs'),
      },
    })

    const ready = new Promise<void>((resolve) => {
      overlayWindow.webContents.once('did-finish-load', () => resolve())
    })

    const syncBounds = (): void => {
      if (overlayWindow.isDestroyed() || parent.isDestroyed()) {
        return
      }

      overlayWindow.setBounds(parent.getContentBounds())
    }

    const parentClosed = (): void => {
      const record = this.overlays.get(parent.id)
      if (!record) {
        return
      }

      if (record.activeSurfaceId !== null) {
        this.closeSurface(record.activeSurfaceId, 'owner-closed', true)
      }

      this.overlays.delete(parent.id)
      if (!overlayWindow.isDestroyed()) {
        overlayWindow.close()
      }
    }

    overlayWindow.setIgnoreMouseEvents(true)
    overlayWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    parent.on('resize', syncBounds)
    parent.on('move', syncBounds)
    parent.on('closed', parentClosed)
    void overlayWindow.loadURL(this.overlayUrl)

    const record: NativeOverlayRecord = {
      parent,
      overlayWindow,
      ready,
      syncBounds,
      parentClosed,
      activeSurfaceId: null,
    }

    this.overlays.set(parent.id, record)

    return record
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
    notifyOwner: boolean
  ): void {
    const surface = this.surfaces.get(surfaceId)
    if (!surface) {
      return
    }

    const record = this.overlays.get(surface.parentId)
    this.surfaces.delete(surfaceId)
    this.resolvePendingReady(surfaceId, false)

    if (record) {
      record.activeSurfaceId = null
      record.overlayWindow.webContents.send(NATIVE_OVERLAY_CLEAR)
      record.overlayWindow.hide()
      record.overlayWindow.setAlwaysOnTop(false)
      record.overlayWindow.setIgnoreMouseEvents(true)
    }

    if (!surface.owner.isDestroyed()) {
      surface.owner.focus()
      if (notifyOwner) {
        surface.owner.send(NATIVE_OVERLAY_CLOSED, { surfaceId, reason })
      }
    }
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
    if (record?.overlayWindow.webContents !== sender) {
      return null
    }

    return surface
  }
}

export const setupNativeOverlayIpc = (
  overlayUrl: string
): NativeOverlayController => {
  const controller = new NativeOverlayController({ overlayUrl })
  controller.register(ipcMain)

  return controller
}
