// cspell:ignore Ghostty ghostty GHOSTTY
import { BrowserWindow, ipcMain, type WebContents } from 'electron'
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
import { BACKEND_EVENT } from './ipc-channels'
import type { Sidecar } from './sidecar'
import {
  isBounds,
  isNonEmptyString,
  isRecord,
  isString,
  type GhosttyNativeDataRequest,
  type GhosttyNativePaneRequest,
  type GhosttyNativeUpdateRequest,
} from './ghostty-native-shared'

interface GhosttyNativePayloadByKind {
  update: GhosttyNativeUpdateRequest
  data: GhosttyNativeDataRequest
  focus: GhosttyNativePaneRequest
  destroy: GhosttyNativePaneRequest
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

interface GhosttyNativeSurfaceState {
  pane: GhosttyNativePaneRequest
  surface: unknown
  pendingData: string[]
  lastResize: { cols: number; rows: number } | null
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

function requireNativePayload<TKind extends keyof GhosttyNativePayloadByKind>(
  kind: TKind,
  value: unknown
): GhosttyNativePayloadByKind[TKind] {
  if (!isNativePayload(kind, value)) {
    throw new Error(`invalid ghostty native parent ${kind} payload`)
  }

  return value
}

function isNativePayload<TKind extends keyof GhosttyNativePayloadByKind>(
  kind: TKind,
  value: unknown
): value is GhosttyNativePayloadByKind[TKind] {
  if (!isPanePayload(value)) {
    return false
  }

  switch (kind) {
    case 'update':
      return (
        isString(value.cwd) &&
        isBounds(value.bounds) &&
        typeof value.visible === 'boolean'
      )
    case 'data':
      return typeof value.data === 'string'
    case 'focus':
    case 'destroy':
      return true
    default:
      return false
  }
}

function isPanePayload(
  value: unknown
): value is GhosttyNativePaneRequest & Record<string, unknown> {
  return (
    isRecord(value) &&
    isNonEmptyString(value.sessionId) &&
    isNonEmptyString(value.paneId)
  )
}

export class GhosttyNativeParentController {
  private readonly sidecar: Sidecar

  private readonly platform: NodeJS.Platform

  private readonly env: NodeJS.ProcessEnv

  private readonly packaged: boolean

  private addon: GhosttyNativeParentAddon | null

  private addonLoadFailed = false

  private readonly surfaces = new Map<string, GhosttyNativeSurfaceState>()

  constructor(deps: GhosttyNativeParentDeps) {
    this.sidecar = deps.sidecar
    this.platform = deps.platform ?? process.platform
    this.env = deps.env ?? process.env
    this.packaged = deps.packaged ?? false
    this.addon = deps.addon ?? null
  }

  registerIpc(): void {
    // Only update needs sender: creating/positioning an NSView requires the
    // owning BrowserWindow. Data/focus/destroy are pane-id routed.
    ipcMain.handle(GHOSTTY_NATIVE_UPDATE, (event, payload) =>
      this.update(event.sender, requireNativePayload('update', payload))
    )

    ipcMain.handle(GHOSTTY_NATIVE_DATA, (_event, payload) =>
      this.sendData(requireNativePayload('data', payload))
    )

    ipcMain.handle(GHOSTTY_NATIVE_FOCUS, (_event, payload) =>
      this.focus(requireNativePayload('focus', payload))
    )

    ipcMain.handle(GHOSTTY_NATIVE_DESTROY, (_event, payload) =>
      this.destroy(requireNativePayload('destroy', payload))
    )
  }

  dispose(): void {
    ipcMain.removeHandler(GHOSTTY_NATIVE_UPDATE)
    ipcMain.removeHandler(GHOSTTY_NATIVE_DATA)
    ipcMain.removeHandler(GHOSTTY_NATIVE_FOCUS)
    ipcMain.removeHandler(GHOSTTY_NATIVE_DESTROY)
    for (const key of this.surfaces.keys()) {
      this.destroySurface(key)
    }
  }

  private update(
    sender: WebContents,
    payload: GhosttyNativeUpdateRequest
  ): { enabled: boolean } {
    // The renderer calls update with pane bounds; this path owns native view
    // creation/alignment because Electron can resolve the BrowserWindow here.
    if (!this.enabled()) {
      return { enabled: false }
    }

    const addon = this.getOptionalAddon()
    if (!addon) {
      return { enabled: false }
    }

    const win = BrowserWindow.fromWebContents(sender)
    if (!win) {
      throw new Error('ghostty native parent update has no owning window')
    }

    const state = this.getOrCreatePaneState(payload)

    const surface = this.getOrCreateSurface(addon, win, state)

    const frame = {
      x: Math.round(payload.bounds.x),
      y: Math.round(payload.bounds.y),
      width: payload.visible ? Math.round(payload.bounds.width) : 0,
      height: payload.visible ? Math.round(payload.bounds.height) : 0,
    }
    addon.setFrame(
      surface,
      frame.x,
      frame.y,
      frame.width,
      frame.height
    )
    this.flushPendingData(addon, state)

    return { enabled: true }
  }

  private sendData(payload: GhosttyNativeDataRequest): { enabled: boolean } {
    if (!this.enabled()) {
      return { enabled: false }
    }

    const addon = this.getOptionalAddon()
    if (!addon) {
      return { enabled: false }
    }

    const state = this.getOrCreatePaneState(payload)

    // PTY data can arrive before the renderer has reported pane bounds.
    // Keep a small tail, then flush it when update creates the native surface.
    if (!state.surface) {
      state.pendingData.push(payload.data)
      if (state.pendingData.length > MAX_PENDING_CHUNKS) {
        state.pendingData.shift()
      }

      return { enabled: true }
    }

    addon.write(state.surface, payload.data)

    return { enabled: true }
  }

  private focus(payload: GhosttyNativePaneRequest): { enabled: boolean } {
    if (!this.enabled()) {
      return { enabled: false }
    }

    const addon = this.getOptionalAddon()
    if (!addon) {
      return { enabled: false }
    }

    const state = this.getExistingPaneState(payload)
    if (state?.surface) {
      addon.focus(state.surface)
    }

    return { enabled: true }
  }

  private destroy(payload: GhosttyNativePaneRequest): { enabled: boolean } {
    if (!this.enabled()) {
      return { enabled: false }
    }

    const addon = this.getOptionalAddon()
    if (!addon) {
      return { enabled: false }
    }

    this.destroySurface(this.paneKey(payload), addon)

    return { enabled: true }
  }

  private enabled(): boolean {
    return isGhosttyNativeParentEnabled(this.platform, this.env, this.packaged)
  }

  private getAddon(): GhosttyNativeParentAddon {
    if (this.addonLoadFailed) {
      throw new Error('Ghostty native parent addon is disabled')
    }

    try {
      this.addon ??= loadAddon()
    } catch (error) {
      this.addonLoadFailed = true
      throw error
    }

    return this.addon
  }

  private getOptionalAddon(): GhosttyNativeParentAddon | null {
    if (this.addonLoadFailed) {
      return null
    }

    try {
      return this.getAddon()
    } catch {
      return null
    }
  }

  private getExistingPaneState(
    payload: GhosttyNativePaneRequest
  ): GhosttyNativeSurfaceState | null {
    return this.surfaces.get(this.paneKey(payload)) ?? null
  }

  private getOrCreatePaneState(
    payload: GhosttyNativePaneRequest
  ): GhosttyNativeSurfaceState {
    const key = this.paneKey(payload)
    const existing = this.surfaces.get(key)
    if (existing) {
      return existing
    }

    const state = {
      pane: {
        sessionId: payload.sessionId,
        paneId: payload.paneId,
      },
      surface: null,
      pendingData: [],
      lastResize: null,
    }
    this.surfaces.set(key, state)

    return state
  }

  private getOrCreateSurface(
    addon: GhosttyNativeParentAddon,
    win: BrowserWindow,
    state: GhosttyNativeSurfaceState
  ): unknown {
    if (state.surface) {
      return state.surface
    }

    state.surface = addon.create(
      bridgePath(),
      win.getNativeWindowHandle(),
      (data) => {
        if (win.isDestroyed() || !this.surfaces.has(this.paneKey(state.pane))) {
          return
        }

        win.webContents.send(BACKEND_EVENT, {
          event: 'ghostty-native-input',
          payload: { ...state.pane, data },
        })

        void this.sidecar.invoke('write_pty', {
          request: {
            sessionId: state.pane.sessionId,
            data,
          },
        })
      },
      (cols, rows) => {
        if (win.isDestroyed() || !this.surfaces.has(this.paneKey(state.pane))) {
          return
        }

        if (state.lastResize?.cols === cols && state.lastResize.rows === rows) {
          return
        }

        state.lastResize = { cols, rows }
        void this.sidecar.invoke('resize_pty', {
          request: {
            sessionId: state.pane.sessionId,
            cols,
            rows,
          },
        })
      }
    )

    return state.surface
  }

  private flushPendingData(
    addon: GhosttyNativeParentAddon,
    state: GhosttyNativeSurfaceState
  ): void {
    if (!state.surface) {
      return
    }

    // PTY output can arrive before the renderer reports pane bounds. Replay
    // that small tail once the native surface exists so startup text is kept.
    for (const data of state.pendingData.splice(0)) {
      addon.write(state.surface, data)
    }
  }

  private paneKey(payload: GhosttyNativePaneRequest): string {
    return `${payload.sessionId}:${payload.paneId}`
  }

  private destroySurface(
    key: string,
    addon: GhosttyNativeParentAddon | null = this.getOptionalAddon()
  ): void {
    const state = this.surfaces.get(key)
    if (!state) {
      return
    }

    if (state.surface && addon) {
      addon.destroy(state.surface)
    }
    this.surfaces.delete(key)
  }
}

export const setupGhosttyNativeParent = (
  deps: GhosttyNativeParentDeps
): GhosttyNativeParentController => {
  const controller = new GhosttyNativeParentController(deps)
  controller.registerIpc()

  return controller
}
