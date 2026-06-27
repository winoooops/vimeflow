// cspell:ignore Ghostty ghostty GHOSTTY
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import {
  GHOSTTY_NATIVE_DATA,
  GHOSTTY_NATIVE_DESTROY,
  GHOSTTY_NATIVE_FOCUS,
  GHOSTTY_NATIVE_UPDATE,
} from './ghostty-native-channels'
import type { Sidecar } from './sidecar'

interface GhosttyNativeBounds {
  x: number
  y: number
  width: number
  height: number
}

interface GhosttyNativePaneRequest {
  sessionId: string
  paneId: string
}

interface GhosttyNativeUpdateRequest extends GhosttyNativePaneRequest {
  cwd: string
  bounds: GhosttyNativeBounds
  visible: boolean
}

interface GhosttyNativeDataRequest extends GhosttyNativePaneRequest {
  data: string
}

interface GhosttyNativeParentAddon {
  create: (
    bridgePath: string,
    nativeHandle: Buffer,
    onInput: (data: string) => void,
    onResize: (cols: number, rows: number) => void
  ) => unknown
  setFrame: (
    surface: unknown,
    x: number,
    y: number,
    width: number,
    height: number
  ) => void
  write: (surface: unknown, data: string) => void
  focus: (surface: unknown) => void
  destroy: (surface: unknown) => void
}

interface GhosttyNativeParentDeps {
  sidecar: Sidecar
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  packaged?: boolean
  addon?: GhosttyNativeParentAddon
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const MAX_PENDING_CHUNKS = 64

export const isGhosttyNativeParentEnabled = (
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  packaged = false
): boolean =>
  !packaged &&
  platform === 'darwin' &&
  env.VITE_GHOSTTY_NATIVE_MACOS_PARENT === '1'

const nativeParentDir = (): string =>
  path.resolve(__dirname, '..', 'dist-native', 'ghostty-parent')

const addonPath = (): string =>
  path.join(nativeParentDir(), 'ghostty_native_parent.node')

const bridgePath = (): string =>
  path.join(nativeParentDir(), 'libGhosttyElectronBridge.dylib')

const loadAddon = (): GhosttyNativeParentAddon => {
  const addon = addonPath()
  const bridge = bridgePath()

  if (!existsSync(addon) || !existsSync(bridge)) {
    throw new Error(
      'Ghostty native parent addon is missing; run npm run ghostty:native-parent:build'
    )
  }

  return require(addon) as GhosttyNativeParentAddon
}

function isGhosttyNativeUpdateRequest(
  value: unknown
): value is GhosttyNativeUpdateRequest {
  return (
    isRecord(value) &&
    isString(value.sessionId) &&
    isString(value.paneId) &&
    isString(value.cwd) &&
    isBounds(value.bounds) &&
    typeof value.visible === 'boolean'
  )
}

function isGhosttyNativeDataRequest(
  value: unknown
): value is GhosttyNativeDataRequest {
  return (
    isRecord(value) &&
    isString(value.sessionId) &&
    isString(value.paneId) &&
    typeof value.data === 'string'
  )
}

function isGhosttyNativePaneRequest(
  value: unknown
): value is GhosttyNativePaneRequest {
  return isRecord(value) && isString(value.sessionId) && isString(value.paneId)
}

function isBounds(value: unknown): value is GhosttyNativeBounds {
  return (
    isRecord(value) &&
    typeof value.x === 'number' &&
    Number.isFinite(value.x) &&
    typeof value.y === 'number' &&
    Number.isFinite(value.y) &&
    typeof value.width === 'number' &&
    Number.isFinite(value.width) &&
    typeof value.height === 'number' &&
    Number.isFinite(value.height)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export class GhosttyNativeParentController {
  private readonly sidecar: Sidecar

  private readonly platform: NodeJS.Platform

  private readonly env: NodeJS.ProcessEnv

  private readonly packaged: boolean

  private addon: GhosttyNativeParentAddon | null

  private currentPane: GhosttyNativePaneRequest | null = null

  private surface: unknown = null

  private pendingData: string[] = []

  private lastResize: { cols: number; rows: number } | null = null

  constructor(deps: GhosttyNativeParentDeps) {
    this.sidecar = deps.sidecar
    this.platform = deps.platform ?? process.platform
    this.env = deps.env ?? process.env
    this.packaged = deps.packaged ?? false
    this.addon = deps.addon ?? null
  }

  registerIpc(): void {
    ipcMain.handle(GHOSTTY_NATIVE_UPDATE, (event, payload) =>
      this.update(event, payload)
    )

    ipcMain.handle(GHOSTTY_NATIVE_DATA, (_event, payload) =>
      this.sendData(payload)
    )

    ipcMain.handle(GHOSTTY_NATIVE_FOCUS, (_event, payload) =>
      this.focus(payload)
    )

    ipcMain.handle(GHOSTTY_NATIVE_DESTROY, (_event, payload) =>
      this.destroy(payload)
    )
  }

  dispose(): void {
    ipcMain.removeHandler(GHOSTTY_NATIVE_UPDATE)
    ipcMain.removeHandler(GHOSTTY_NATIVE_DATA)
    ipcMain.removeHandler(GHOSTTY_NATIVE_FOCUS)
    ipcMain.removeHandler(GHOSTTY_NATIVE_DESTROY)
    this.destroySurface()
  }

  private update(
    event: IpcMainInvokeEvent,
    payload: unknown
  ): { enabled: boolean } {
    if (!this.enabled()) {
      return { enabled: false }
    }

    if (!isGhosttyNativeUpdateRequest(payload)) {
      throw new Error('invalid ghostty native parent update payload')
    }

    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) {
      throw new Error('ghostty native parent update has no owning window')
    }

    const pane = {
      sessionId: payload.sessionId,
      paneId: payload.paneId,
    }
    if (!this.matchesCurrentPane(pane)) {
      this.destroySurface()
      this.currentPane = pane
    }

    const surface = this.getOrCreateSurface(win)
    this.getAddon().setFrame(
      surface,
      payload.bounds.x,
      payload.bounds.y,
      payload.visible ? payload.bounds.width : 0,
      payload.visible ? payload.bounds.height : 0
    )
    this.flushPendingData()

    return { enabled: true }
  }

  private sendData(payload: unknown): { enabled: boolean } {
    if (!this.enabled()) {
      return { enabled: false }
    }

    if (!isGhosttyNativeDataRequest(payload)) {
      throw new Error('invalid ghostty native parent data payload')
    }

    this.currentPane ??= {
      sessionId: payload.sessionId,
      paneId: payload.paneId,
    }

    if (!this.matchesCurrentPane(payload)) {
      return { enabled: true }
    }

    if (!this.surface) {
      this.pendingData.push(payload.data)
      if (this.pendingData.length > MAX_PENDING_CHUNKS) {
        this.pendingData.shift()
      }

      return { enabled: true }
    }

    this.getAddon().write(this.surface, payload.data)

    return { enabled: true }
  }

  private focus(payload: unknown): { enabled: boolean } {
    if (!this.enabled()) {
      return { enabled: false }
    }

    if (!isGhosttyNativePaneRequest(payload)) {
      throw new Error('invalid ghostty native parent focus payload')
    }

    if (this.surface && this.matchesCurrentPane(payload)) {
      this.getAddon().focus(this.surface)
    }

    return { enabled: true }
  }

  private destroy(payload: unknown): { enabled: boolean } {
    if (!this.enabled()) {
      return { enabled: false }
    }

    if (!isGhosttyNativePaneRequest(payload)) {
      throw new Error('invalid ghostty native parent destroy payload')
    }

    if (this.matchesCurrentPane(payload)) {
      this.destroySurface()
    }

    return { enabled: true }
  }

  private enabled(): boolean {
    return isGhosttyNativeParentEnabled(this.platform, this.env, this.packaged)
  }

  private getAddon(): GhosttyNativeParentAddon {
    this.addon ??= loadAddon()

    return this.addon
  }

  private getOrCreateSurface(win: BrowserWindow): unknown {
    if (this.surface) {
      return this.surface
    }

    this.surface = this.getAddon().create(
      bridgePath(),
      win.getNativeWindowHandle(),
      (data) => {
        if (!this.currentPane) {
          return
        }

        void this.sidecar.invoke('write_pty', {
          request: {
            sessionId: this.currentPane.sessionId,
            data,
          },
        })
      },
      (cols, rows) => {
        if (
          !this.currentPane ||
          (this.lastResize?.cols === cols && this.lastResize.rows === rows)
        ) {
          return
        }

        this.lastResize = { cols, rows }
        void this.sidecar.invoke('resize_pty', {
          request: {
            sessionId: this.currentPane.sessionId,
            cols,
            rows,
          },
        })
      }
    )

    return this.surface
  }

  private flushPendingData(): void {
    if (!this.surface) {
      return
    }

    for (const data of this.pendingData.splice(0)) {
      this.getAddon().write(this.surface, data)
    }
  }

  private matchesCurrentPane(payload: GhosttyNativePaneRequest): boolean {
    return (
      this.currentPane?.sessionId === payload.sessionId &&
      this.currentPane.paneId === payload.paneId
    )
  }

  private destroySurface(): void {
    if (this.surface) {
      this.getAddon().destroy(this.surface)
    }
    this.surface = null
    this.currentPane = null
    this.pendingData = []
    this.lastResize = null
  }
}

export const setupGhosttyNativeParent = (
  deps: GhosttyNativeParentDeps
): GhosttyNativeParentController => {
  const controller = new GhosttyNativeParentController(deps)
  controller.registerIpc()

  return controller
}
