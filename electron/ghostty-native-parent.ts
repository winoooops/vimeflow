// cspell:ignore Ghostty ghostty GHOSTTY
import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { DIALOG_SELECTOR } from '../src/features/workspace/containerIds'
import {
  GHOSTTY_NATIVE_DATA,
  GHOSTTY_NATIVE_DESTROY,
  GHOSTTY_NATIVE_FOCUS,
  GHOSTTY_NATIVE_SECONDARY_ATTACH,
  GHOSTTY_NATIVE_SECONDARY_DATA,
  GHOSTTY_NATIVE_SECONDARY_FOCUS,
  GHOSTTY_NATIVE_SECONDARY_REMOVE,
  GHOSTTY_NATIVE_SECONDARY_VISIBLE,
  GHOSTTY_NATIVE_UPDATE,
} from './ghostty-native-channels'
import { dispatchCommandPaletteShortcutForWindow } from './command-palette-shortcut'
import { BACKEND_EVENT } from './ipc-channels'
import type { Sidecar } from './sidecar'
import {
  isBounds,
  isHexColor,
  isNonEmptyString,
  isOptionalFiniteNumber,
  isRecord,
  isSecondaryPlacement,
  isString,
  type GhosttyNativeDataRequest,
  type GhosttyNativePaneRequest,
  type GhosttyNativeSecondaryAttachRequest,
  type GhosttyNativeSecondaryDataRequest,
  type GhosttyNativeSecondaryPlacement,
  type GhosttyNativeSecondaryRequest,
  type GhosttyNativeSecondaryVisibleRequest,
  type GhosttyNativeShortcutContext,
  type GhosttyNativeUpdateRequest,
} from './ghostty-native-shared'
import { getWorkspaceKeybindingSnapshot } from './workspace-keybindings'

interface GhosttyNativePayloadByKind {
  update: GhosttyNativeUpdateRequest
  data: GhosttyNativeDataRequest
  focus: GhosttyNativePaneRequest
  destroy: GhosttyNativePaneRequest
  secondaryAttach: GhosttyNativeSecondaryAttachRequest
  secondaryData: GhosttyNativeSecondaryDataRequest
  secondaryFocus: GhosttyNativeSecondaryRequest
  secondaryRemove: GhosttyNativeSecondaryRequest
  secondaryVisible: GhosttyNativeSecondaryVisibleRequest
}

type GhosttyNativeSurface = object

interface GhosttyNativeParentAddon {
  create: (
    bridgePath: string,
    nativeHandle: Buffer,
    onInput: (data: string) => void,
    onResize: (cols: number, rows: number) => void,
    onFocus: () => void,
    onShortcut: (
      key: string,
      code: string,
      control: boolean,
      meta: boolean,
      alt: boolean,
      shift: boolean,
      repeat: boolean,
      fromSecondary?: boolean
    ) => void,
    onRenamePane: () => void
  ) => GhosttyNativeSurface
  setFrame: (
    surface: GhosttyNativeSurface,
    x: number,
    y: number,
    width: number,
    height: number,
    bottomCornerRadius: number,
    parentHeight: number
  ) => void
  setKeybindings?: (surface: GhosttyNativeSurface, bindings: string) => void
  setBackgroundColor?: (surface: GhosttyNativeSurface, color: string) => void
  setForegroundColor?: (surface: GhosttyNativeSurface, color: string) => void
  setFontFamily?: (surface: GhosttyNativeSurface, fontFamily: string) => void
  write: (surface: GhosttyNativeSurface, data: string) => void
  focus: (surface: GhosttyNativeSurface) => void
  destroy: (surface: GhosttyNativeSurface) => void
  addSecondary?: (
    surface: GhosttyNativeSurface,
    onInput: (data: string) => void,
    onResize: (cols: number, rows: number) => void,
    onFocus: () => void,
    placement: GhosttyNativeSecondaryPlacement
  ) => void
  setSecondaryVisible?: (
    surface: GhosttyNativeSurface,
    visible: boolean,
    placement: GhosttyNativeSecondaryPlacement
  ) => void
  writeSecondary?: (surface: GhosttyNativeSurface, data: string) => void
  focusSecondary?: (surface: GhosttyNativeSurface) => void
  removeSecondary?: (surface: GhosttyNativeSurface) => void
}

interface GhosttyNativeParentDeps {
  sidecar: Sidecar
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  packaged?: boolean
  resourcesPath?: string
  addon?: GhosttyNativeParentAddon
  inputBlocked?: (win: BrowserWindow) => boolean
  shortcutInputBlocked?: (win: BrowserWindow) => boolean
}

interface GhosttyNativeSurfaceState {
  pane: GhosttyNativePaneRequest
  surface: GhosttyNativeSurface | null
  ownerWindow: BrowserWindow | null
  ownerWindowId: number | null
  pendingData: string[]
  secondary: GhosttyNativeSecondaryState | null
  // Resize updates pass through this same path. Cache values that reapply
  // Ghostty theme/shortcut state so steady resize only calls setFrame.
  lastBackgroundColor: string | null
  lastForegroundColor: string | null
  lastFontFamily: string | null
  lastResize: { cols: number; rows: number } | null
  resizeTimer: ReturnType<typeof setTimeout> | null
  pendingResize: { cols: number; rows: number } | null
  shortcutContext: GhosttyNativeShortcutContext | null
  lastKeybindings: string | null
}

interface GhosttyNativeSecondaryCallbacks {
  onInput: (data: string) => void
  onResize: (cols: number, rows: number) => void
  onFocus: () => void
}

interface GhosttyNativeSecondaryState {
  sessionId: string
  attached: boolean
  visible: boolean
  placement: GhosttyNativeSecondaryPlacement
  callbacks: GhosttyNativeSecondaryCallbacks | null
  pendingData: string[]
  lastResize: { cols: number; rows: number } | null
}

interface GhosttyNativeShortcutInput {
  key: string
  code: string
  control: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  repeat: boolean
}

interface GhosttyNativeShortcutDispatchState {
  activeGhosttyPane: boolean
  dockHasFocus: boolean
  dialogOpen?: boolean
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const MAX_PENDING_CHUNKS = 64
const MAX_SURFACES = 128
// Leading+trailing throttle for PTY resize during live drags. Stock Ghostty
// forwards every grid change with no timer (Surface.zig sizeCallback, dedupe
// only); 16ms (~one frame) approximates that cadence while bounding bursts.
// Env override is the tuning knob from the resize gray-band investigation.
// An explicit 0 keeps a zero-delay window; empty/garbage/negative values
// must fall back to the default (Number('') is 0, so guard before Number).
const throttleMsRaw = process.env.GHOSTTY_RESIZE_THROTTLE_MS?.trim()
const throttleMsOverride = throttleMsRaw ? Number(throttleMsRaw) : NaN

const GHOSTTY_RESIZE_THROTTLE_MS =
  Number.isFinite(throttleMsOverride) && throttleMsOverride >= 0
    ? throttleMsOverride
    : 16

// Packaged macOS is the shipped Ghostty path. Dev and e2e still opt in so
// ordinary local runs can keep the fallback. The old helper flag is retained
// as an alias, but now selects this same parented NSView implementation.
export const isGhosttyNativeParentEnabled = (
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  packaged = false
): boolean =>
  platform === 'darwin' &&
  (packaged ||
    env.VITE_GHOSTTY_NATIVE_MACOS_PARENT === '1' ||
    env.VITE_GHOSTTY_NATIVE_MACOS === '1')

const nativeParentDir = (packaged = false, resourcesPath = ''): string => {
  if (packaged) {
    return path.join(resourcesPath, 'ghostty-parent')
  }

  return path.resolve(__dirname, '..', 'dist-native', 'ghostty-parent')
}

const addonPath = (dir: string): string =>
  path.join(dir, 'ghostty_native_parent.node')

const bridgePath = (dir: string): string =>
  path.join(dir, 'libGhosttyElectronBridge.dylib')

const ghosttyShortcutEventInit = (
  input: GhosttyNativeShortcutInput
): Record<string, boolean | string> => ({
  key: input.key,
  code: input.code,
  ctrlKey: input.control,
  metaKey: input.meta,
  altKey: input.alt,
  shiftKey: input.shift,
  repeat: input.repeat,
  bubbles: true,
  cancelable: true,
})

const isShortcutDispatchState = (
  value: unknown
): value is GhosttyNativeShortcutDispatchState =>
  isRecord(value) &&
  typeof value.activeGhosttyPane === 'boolean' &&
  typeof value.dockHasFocus === 'boolean' &&
  (value.dialogOpen === undefined || typeof value.dialogOpen === 'boolean')

const shouldRefocusGhosttyAfterWorkspaceShortcut = (
  dispatchState: GhosttyNativeShortcutDispatchState
): boolean =>
  dispatchState.activeGhosttyPane &&
  !dispatchState.dockHasFocus &&
  dispatchState.dialogOpen !== true

const isShortcutContext = (
  value: unknown
): value is GhosttyNativeShortcutContext =>
  isRecord(value) &&
  Array.isArray(value.paneIds) &&
  value.paneIds.every(isNonEmptyString) &&
  (value.activePaneId === null || isNonEmptyString(value.activePaneId))

const serializedKeybindingsForPane = (
  win: BrowserWindow,
  paneId: string,
  context: GhosttyNativeShortcutContext | null
): string => {
  const snapshot = getWorkspaceKeybindingSnapshot(win)

  const bindings = snapshot.bindings.filter((binding) => {
    if (binding.context !== 'global') {
      return false
    }

    const paneMatch = /^focus-pane-([1-9])$/.exec(binding.id)
    if (paneMatch === null) {
      return true
    }

    if (context?.activePaneId !== paneId) {
      return false
    }

    const targetPaneId = context.paneIds.at(Number(paneMatch[1]) - 1)

    return targetPaneId !== undefined && targetPaneId !== paneId
  })

  return JSON.stringify({ version: snapshot.version, bindings })
}

const loadAddon = (dir: string): GhosttyNativeParentAddon => {
  const addon = addonPath(dir)
  const bridge = bridgePath(dir)

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
        (value.backgroundColor === undefined ||
          isHexColor(value.backgroundColor)) &&
        (value.foregroundColor === undefined ||
          isHexColor(value.foregroundColor)) &&
        isOptionalFiniteNumber(value.bottomCornerRadius) &&
        typeof value.parentHeight === 'number' &&
        Number.isFinite(value.parentHeight) &&
        typeof value.visible === 'boolean' &&
        (value.shortcutContext === undefined ||
          isShortcutContext(value.shortcutContext))
      )
    case 'data':
      return typeof value.data === 'string'
    case 'focus':
    case 'destroy':
      return true
    case 'secondaryFocus':
    case 'secondaryRemove':
      return isNonEmptyString(value.secondarySessionId)
    case 'secondaryAttach':
      return (
        isNonEmptyString(value.secondarySessionId) &&
        isSecondaryPlacement(value.placement)
      )
    case 'secondaryData':
      return (
        isNonEmptyString(value.secondarySessionId) &&
        typeof value.data === 'string'
      )
    case 'secondaryVisible':
      return (
        isNonEmptyString(value.secondarySessionId) &&
        typeof value.visible === 'boolean' &&
        isSecondaryPlacement(value.placement)
      )
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

  private readonly nativeParentDir: string

  private readonly inputBlocked: (win: BrowserWindow) => boolean

  private readonly shortcutInputBlocked: (win: BrowserWindow) => boolean

  private addon: GhosttyNativeParentAddon | null

  private addonLoadFailed = false

  private readonly surfaces = new Map<string, GhosttyNativeSurfaceState>()

  private readonly surfaceKeysByWindowId = new Map<number, Set<string>>()

  private readonly windowClosedHandlers = new Map<number, () => void>()

  constructor(deps: GhosttyNativeParentDeps) {
    this.sidecar = deps.sidecar
    this.platform = deps.platform ?? process.platform
    this.env = deps.env ?? process.env
    this.packaged = deps.packaged ?? false
    this.nativeParentDir = nativeParentDir(
      this.packaged,
      deps.resourcesPath ?? process.resourcesPath
    )
    this.addon = deps.addon ?? null
    this.inputBlocked = deps.inputBlocked ?? ((): boolean => false)
    this.shortcutInputBlocked = deps.shortcutInputBlocked ?? this.inputBlocked
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

    ipcMain.handle(GHOSTTY_NATIVE_SECONDARY_ATTACH, (event, payload) =>
      this.attachSecondary(
        event.sender,
        requireNativePayload('secondaryAttach', payload)
      )
    )

    ipcMain.handle(GHOSTTY_NATIVE_SECONDARY_DATA, (_event, payload) =>
      this.sendSecondaryData(requireNativePayload('secondaryData', payload))
    )

    ipcMain.handle(GHOSTTY_NATIVE_SECONDARY_FOCUS, (_event, payload) =>
      this.focusSecondary(requireNativePayload('secondaryFocus', payload))
    )

    ipcMain.handle(GHOSTTY_NATIVE_SECONDARY_REMOVE, (_event, payload) =>
      this.removeSecondary(requireNativePayload('secondaryRemove', payload))
    )

    ipcMain.handle(GHOSTTY_NATIVE_SECONDARY_VISIBLE, (_event, payload) =>
      this.setSecondaryVisible(
        requireNativePayload('secondaryVisible', payload)
      )
    )
  }

  dispose(): void {
    ipcMain.removeHandler(GHOSTTY_NATIVE_UPDATE)
    ipcMain.removeHandler(GHOSTTY_NATIVE_DATA)
    ipcMain.removeHandler(GHOSTTY_NATIVE_FOCUS)
    ipcMain.removeHandler(GHOSTTY_NATIVE_DESTROY)
    ipcMain.removeHandler(GHOSTTY_NATIVE_SECONDARY_ATTACH)
    ipcMain.removeHandler(GHOSTTY_NATIVE_SECONDARY_DATA)
    ipcMain.removeHandler(GHOSTTY_NATIVE_SECONDARY_FOCUS)
    ipcMain.removeHandler(GHOSTTY_NATIVE_SECONDARY_REMOVE)
    ipcMain.removeHandler(GHOSTTY_NATIVE_SECONDARY_VISIBLE)
    for (const key of this.surfaces.keys()) {
      this.destroySurface(key)
    }
    this.surfaceKeysByWindowId.clear()
    this.windowClosedHandlers.clear()
  }

  refreshKeybindings(win: BrowserWindow): void {
    if (!this.enabled() || this.surfaces.size === 0) {
      return
    }

    const addon = this.getOptionalAddon()
    if (!addon?.setKeybindings) {
      return
    }

    for (const state of this.surfaces.values()) {
      if (state.ownerWindowId === win.id) {
        this.applyKeybindings(addon, win, state)
      }
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
    state.shortcutContext = payload.shortcutContext ?? null

    const roundedWidth = Math.round(payload.bounds.width)
    const roundedHeight = Math.round(payload.bounds.height)

    const frameVisible =
      payload.visible && roundedWidth > 0 && roundedHeight > 0

    const frame = {
      x: Math.round(payload.bounds.x),
      y: Math.round(payload.bounds.y),
      width: frameVisible ? roundedWidth : 0,
      height: frameVisible ? roundedHeight : 0,
      bottomCornerRadius: frameVisible
        ? Math.max(0, Math.round(payload.bottomCornerRadius ?? 0))
        : 0,
      parentHeight: Math.max(0, Math.round(payload.parentHeight)),
    }
    if (
      isHexColor(payload.backgroundColor) &&
      state.lastBackgroundColor !== payload.backgroundColor
    ) {
      state.lastBackgroundColor = payload.backgroundColor
      addon.setBackgroundColor?.(surface, payload.backgroundColor)
    }
    if (
      isHexColor(payload.foregroundColor) &&
      state.lastForegroundColor !== payload.foregroundColor
    ) {
      state.lastForegroundColor = payload.foregroundColor
      addon.setForegroundColor?.(surface, payload.foregroundColor)
    }
    if (
      isNonEmptyString(payload.fontFamily) &&
      state.lastFontFamily !== payload.fontFamily
    ) {
      state.lastFontFamily = payload.fontFamily
      addon.setFontFamily?.(surface, payload.fontFamily)
    }
    addon.setFrame(
      surface,
      frame.x,
      frame.y,
      frame.width,
      frame.height,
      frame.bottomCornerRadius,
      frame.parentHeight
    )
    this.applyKeybindings(addon, win, state)
    if (state.pendingData.length > 0) {
      this.flushPendingData(addon, state)
    }

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

    this.destroySurface(this.paneKey(payload), addon, {
      preserveSecondary: true,
    })

    return { enabled: true }
  }

  private attachSecondary(
    sender: WebContents,
    payload: GhosttyNativeSecondaryAttachRequest
  ): { enabled: boolean } {
    if (!this.enabled()) {
      return { enabled: false }
    }

    const addon = this.getOptionalAddon()
    if (!addon?.addSecondary) {
      return { enabled: false }
    }

    const win = BrowserWindow.fromWebContents(sender)
    if (!win) {
      throw new Error('ghostty native secondary attach has no owning window')
    }

    const state = this.getOrCreatePaneState(payload)
    this.replaceSecondaryIfNeeded(addon, state, payload.secondarySessionId)

    const secondary = this.ensureSecondaryState(
      state,
      payload.secondarySessionId
    )
    secondary.placement = payload.placement
    this.getOrCreateSurface(addon, win, state)

    secondary.callbacks = this.createSecondaryCallbacks(
      state,
      payload.secondarySessionId
    )
    this.attachSecondaryToSurface(addon, state, secondary)

    return { enabled: true }
  }

  private sendSecondaryData(payload: GhosttyNativeSecondaryDataRequest): {
    enabled: boolean
  } {
    if (!this.enabled()) {
      return { enabled: false }
    }

    const addon = this.getOptionalAddon()
    if (!addon?.writeSecondary) {
      return { enabled: false }
    }

    const state = this.getOrCreatePaneState(payload)
    if (
      state.secondary &&
      state.secondary.sessionId !== payload.secondarySessionId
    ) {
      return { enabled: true }
    }

    const secondary = this.ensureSecondaryState(
      state,
      payload.secondarySessionId
    )
    if (state.surface && !secondary.attached) {
      this.attachSecondaryToSurface(addon, state, secondary)
    }

    if (!state.surface || !secondary.attached) {
      secondary.pendingData.push(payload.data)

      if (secondary.pendingData.length > MAX_PENDING_CHUNKS) {
        secondary.pendingData.shift()
      }

      return { enabled: true }
    }

    addon.writeSecondary(state.surface, payload.data)

    return { enabled: true }
  }

  private focusSecondary(payload: GhosttyNativeSecondaryRequest): {
    enabled: boolean
  } {
    if (!this.enabled()) {
      return { enabled: false }
    }

    const addon = this.getOptionalAddon()
    if (!addon?.focusSecondary) {
      return { enabled: false }
    }

    const state = this.getExistingPaneState(payload)
    if (
      state?.surface &&
      state.secondary?.sessionId === payload.secondarySessionId
    ) {
      if (!state.secondary.attached) {
        this.attachSecondaryToSurface(addon, state, state.secondary)
      }
      addon.focusSecondary(state.surface)
    }

    return { enabled: true }
  }

  private removeSecondary(payload: GhosttyNativeSecondaryRequest): {
    enabled: boolean
  } {
    if (!this.enabled()) {
      return { enabled: false }
    }

    const state = this.getExistingPaneState(payload)
    if (state?.secondary?.sessionId !== payload.secondarySessionId) {
      return { enabled: true }
    }

    if (state.surface) {
      const removeSecondary = this.getOptionalAddon()?.removeSecondary
      if (!removeSecondary) {
        return { enabled: false }
      }
      removeSecondary(state.surface)
    }
    state.secondary = null
    if (!state.surface) {
      this.surfaces.delete(this.paneKey(payload))
    }

    return { enabled: true }
  }

  private setSecondaryVisible(payload: GhosttyNativeSecondaryVisibleRequest): {
    enabled: boolean
  } {
    if (!this.enabled()) {
      return { enabled: false }
    }

    const addon = this.getOptionalAddon()
    if (!addon?.setSecondaryVisible) {
      return { enabled: false }
    }

    const state = this.getExistingPaneState(payload)
    if (state?.secondary?.sessionId === payload.secondarySessionId) {
      state.secondary.visible = payload.visible
      state.secondary.placement = payload.placement
    }
    if (
      state?.surface &&
      state.secondary?.sessionId === payload.secondarySessionId
    ) {
      if (!state.secondary.attached) {
        this.attachSecondaryToSurface(addon, state, state.secondary)
      }
      addon.setSecondaryVisible(
        state.surface,
        payload.visible,
        payload.placement
      )
    }

    return { enabled: true }
  }

  private enabled(): boolean {
    return isGhosttyNativeParentEnabled(this.platform, this.env)
  }

  private getAddon(): GhosttyNativeParentAddon {
    if (this.addonLoadFailed) {
      throw new Error('Ghostty native parent addon is disabled')
    }

    try {
      this.addon ??= loadAddon(this.nativeParentDir)
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

    if (this.surfaces.size >= MAX_SURFACES) {
      throw new Error('ghostty native parent surface limit exceeded')
    }

    const state = {
      pane: {
        sessionId: payload.sessionId,
        paneId: payload.paneId,
      },
      surface: null,
      ownerWindow: null,
      ownerWindowId: null,
      pendingData: [],
      secondary: null,
      lastBackgroundColor: null,
      lastForegroundColor: null,
      lastFontFamily: null,
      lastResize: null,
      resizeTimer: null,
      pendingResize: null,
      shortcutContext: null,
      lastKeybindings: null,
    }
    this.surfaces.set(key, state)

    return state
  }

  private getOrCreateSurface(
    addon: GhosttyNativeParentAddon,
    win: BrowserWindow,
    state: GhosttyNativeSurfaceState
  ): GhosttyNativeSurface {
    if (state.surface && state.ownerWindowId === win.id) {
      return state.surface
    }

    const key = this.paneKey(state.pane)
    if (state.surface) {
      addon.destroy(state.surface)
      this.clearPendingResize(state)
      this.resetSurfaceScopedCaches(state)
      if (state.ownerWindowId !== null) {
        this.surfaceKeysByWindowId.get(state.ownerWindowId)?.delete(key)
      }
      state.surface = null
      state.ownerWindow = null
      state.ownerWindowId = null
      if (state.secondary) {
        state.secondary.attached = false
        state.secondary.lastResize = null
      }
    }

    this.registerWindowCleanup(win)

    state.surface = addon.create(
      bridgePath(this.nativeParentDir),
      win.getNativeWindowHandle(),
      (data) => {
        if (win.isDestroyed() || !this.surfaces.has(this.paneKey(state.pane))) {
          return
        }

        if (this.inputBlocked(win)) {
          return
        }

        win.webContents.send(BACKEND_EVENT, {
          event: 'ghostty-native-input',
          payload: { ...state.pane, data },
        })

        this.invokeSidecar('write_pty', {
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

        this.queuePtyResize(
          state,
          state.pane.sessionId,
          cols,
          rows,
          () =>
            !win.isDestroyed() && this.surfaces.has(this.paneKey(state.pane))
        )
      },
      () => {
        if (win.isDestroyed() || !this.surfaces.has(this.paneKey(state.pane))) {
          return
        }

        if (this.inputBlocked(win)) {
          return
        }

        win.webContents.send(BACKEND_EVENT, {
          event: 'ghostty-native-focus',
          payload: state.pane,
        })
      },
      (shortcutKey, code, control, meta, alt, shift, repeat, fromSecondary) => {
        if (win.isDestroyed() || !this.surfaces.has(this.paneKey(state.pane))) {
          return
        }

        if (this.shortcutInputBlocked(win)) {
          return
        }

        if (
          dispatchCommandPaletteShortcutForWindow(win, {
            type: 'keyDown',
            key: shortcutKey,
            code,
            control,
            meta,
            alt,
            shift,
            isAutoRepeat: repeat,
          })
        ) {
          return
        }

        void this.forwardShortcutToAppRenderer(
          addon,
          win,
          state,
          {
            key: shortcutKey,
            code,
            control,
            meta,
            alt,
            shift,
            repeat,
          },
          fromSecondary === true
        )
      },
      () => {
        if (win.isDestroyed() || !this.surfaces.has(this.paneKey(state.pane))) {
          return
        }

        if (this.inputBlocked(win)) {
          return
        }

        if (!win.webContents.isDestroyed()) {
          win.webContents.focus()
        }

        win.webContents.send(BACKEND_EVENT, {
          event: 'ghostty-native-rename-pane',
          payload: state.pane,
        })
      }
    )
    state.ownerWindow = win
    state.ownerWindowId = win.id
    this.surfaceKeysByWindowId.get(win.id)?.add(key)
    if (state.secondary) {
      this.attachSecondaryToSurface(addon, state, state.secondary)
    }

    return state.surface
  }

  private registerWindowCleanup(win: BrowserWindow): void {
    if (this.windowClosedHandlers.has(win.id)) {
      return
    }

    this.surfaceKeysByWindowId.set(win.id, new Set())

    const handleClosed = (): void => {
      const keys = [...(this.surfaceKeysByWindowId.get(win.id) ?? [])]

      for (const key of keys) {
        this.destroySurface(key)
      }

      this.surfaceKeysByWindowId.delete(win.id)
      this.windowClosedHandlers.delete(win.id)
    }

    this.windowClosedHandlers.set(win.id, handleClosed)
    win.once('closed', handleClosed)
  }

  private async forwardShortcutToAppRenderer(
    addon: GhosttyNativeParentAddon,
    win: BrowserWindow,
    state: GhosttyNativeSurfaceState,
    input: GhosttyNativeShortcutInput,
    fromSecondary: boolean
  ): Promise<void> {
    if (win.isDestroyed() || win.webContents.isDestroyed() || !state.surface) {
      return
    }

    win.webContents.focus()
    const eventInit = JSON.stringify(ghosttyShortcutEventInit(input))
    try {
      const shouldRefocus: unknown = await win.webContents.executeJavaScript(
        `(() => {
          const existingTarget = document.querySelector('[data-vimeflow-shortcut-proxy]')
          const target = existingTarget ?? (() => {
            const node = document.createElement('button')
            node.type = 'button'
            node.tabIndex = -1
            node.setAttribute('aria-hidden', 'true')
            node.setAttribute('data-vimeflow-shortcut-proxy', 'true')
            node.style.position = 'fixed'
            node.style.width = '1px'
            node.style.height = '1px'
            node.style.opacity = '0'
            node.style.pointerEvents = 'none'
            document.body.appendChild(node)
            return node
          })()
          if (target instanceof HTMLElement) {
            target.focus({ preventScroll: true })
          }
          target.dispatchEvent(new KeyboardEvent('keydown', ${eventInit}))
          return new Promise((resolve) => {
            requestAnimationFrame(() => {
              const renameInputOpen =
                document.querySelector('[data-workspace-overlay-id="pane-rename"]') !== null
              const activeElement = document.activeElement
              const dockHasFocus =
                activeElement instanceof Element &&
                activeElement.closest('[data-container-id="dock"]') !== null
              const activeGhosttyPane = Array.from(
                document.querySelectorAll('[data-pane-kind="shell"][data-pane-active="true"]')
              ).some((node) =>
                node.getAttribute('data-pane-id') === ${JSON.stringify(state.pane.paneId)} &&
                node.getAttribute('data-pty-id') === ${JSON.stringify(state.pane.sessionId)}
              )
              const dialogOpen = document.querySelector(${JSON.stringify(DIALOG_SELECTOR)}) !== null
              resolve({ activeGhosttyPane: !renameInputOpen && activeGhosttyPane, dockHasFocus, dialogOpen })
            })
          })
        })()`,
        false
      )

      if (
        isShortcutDispatchState(shouldRefocus) &&
        shouldRefocusGhosttyAfterWorkspaceShortcut(shouldRefocus)
      ) {
        const key = this.paneKey(state.pane)
        const currentState = this.surfaces.get(key)

        const currentSurface =
          currentState === state ? currentState.surface : null

        if (currentSurface && win.isFocused() && !this.inputBlocked(win)) {
          if (
            fromSecondary &&
            currentState?.secondary?.visible === true &&
            addon.focusSecondary
          ) {
            addon.focusSecondary(currentSurface)
          } else {
            addon.focus(currentSurface)
          }
        }
      }
    } catch {
      // Best effort: native shortcut forwarding should not tear down the pane.
    }
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

  private applyKeybindings(
    addon: GhosttyNativeParentAddon,
    win: BrowserWindow,
    state: GhosttyNativeSurfaceState
  ): void {
    if (!state.surface || !addon.setKeybindings) {
      return
    }

    const keybindings = serializedKeybindingsForPane(
      win,
      state.pane.paneId,
      state.shortcutContext
    )
    if (state.lastKeybindings === keybindings) {
      return
    }

    state.lastKeybindings = keybindings
    addon.setKeybindings(state.surface, keybindings)
  }

  // Leading+trailing throttle: forward immediately when idle, then hold a
  // throttle window that flushes the freshest size once per interval while a
  // drag keeps producing changes. A reset-on-change debounce here starves the
  // PTY of size updates for the whole drag, which is what let codex's gray
  // composer rows stack up (see the resize gray-band investigation).
  private queuePtyResize(
    resizeState: GhosttyNativeSurfaceState,
    sessionId: string,
    cols: number,
    rows: number,
    canForward: () => boolean
  ): void {
    if (cols <= 0 || rows <= 0) {
      return
    }

    if (
      resizeState.lastResize?.cols === cols &&
      resizeState.lastResize.rows === rows
    ) {
      resizeState.pendingResize = null

      return
    }

    if (resizeState.resizeTimer !== null) {
      resizeState.pendingResize = { cols, rows }

      return
    }

    this.forwardPtyResize(resizeState, sessionId, cols, rows)
    this.armResizeThrottle(resizeState, sessionId, canForward)
  }

  private armResizeThrottle(
    resizeState: GhosttyNativeSurfaceState,
    sessionId: string,
    canForward: () => boolean
  ): void {
    resizeState.resizeTimer = setTimeout(() => {
      resizeState.resizeTimer = null
      const pending = resizeState.pendingResize
      resizeState.pendingResize = null
      if (pending === null || !canForward()) {
        return
      }

      if (
        resizeState.lastResize?.cols === pending.cols &&
        resizeState.lastResize.rows === pending.rows
      ) {
        return
      }

      this.forwardPtyResize(resizeState, sessionId, pending.cols, pending.rows)
      this.armResizeThrottle(resizeState, sessionId, canForward)
    }, GHOSTTY_RESIZE_THROTTLE_MS)
  }

  private forwardPtyResize(
    resizeState: GhosttyNativeSurfaceState,
    sessionId: string,
    cols: number,
    rows: number
  ): void {
    resizeState.lastResize = { cols, rows }
    this.invokeSidecar('resize_pty', {
      request: {
        sessionId,
        cols,
        rows,
      },
    })
  }

  private clearPendingResize(resizeState: GhosttyNativeSurfaceState): void {
    if (resizeState.resizeTimer !== null) {
      clearTimeout(resizeState.resizeTimer)
    }
    resizeState.resizeTimer = null
    resizeState.pendingResize = null
  }

  private resetSurfaceScopedCaches(state: GhosttyNativeSurfaceState): void {
    state.lastBackgroundColor = null
    state.lastForegroundColor = null
    state.lastKeybindings = null
  }

  private invokeSidecar(
    command: Parameters<Sidecar['invoke']>[0],
    payload: Parameters<Sidecar['invoke']>[1]
  ): void {
    void (async (): Promise<void> => {
      try {
        await this.sidecar.invoke(command, payload)
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('Ghostty native sidecar invoke failed', error)
      }
    })()
  }

  private ensureSecondaryState(
    state: GhosttyNativeSurfaceState,
    secondarySessionId: string
  ): GhosttyNativeSecondaryState {
    if (state.secondary?.sessionId === secondarySessionId) {
      return state.secondary
    }

    state.secondary = {
      sessionId: secondarySessionId,
      attached: false,
      visible: true,
      placement: 'bottom',
      callbacks: null,
      pendingData: [],
      lastResize: null,
    }

    return state.secondary
  }

  private replaceSecondaryIfNeeded(
    addon: GhosttyNativeParentAddon,
    state: GhosttyNativeSurfaceState,
    secondarySessionId: string
  ): void {
    if (state.secondary?.sessionId === secondarySessionId) {
      return
    }

    if (state.surface && state.secondary) {
      addon.removeSecondary?.(state.surface)
    }
    this.ensureSecondaryState(state, secondarySessionId)
  }

  private createSecondaryCallbacks(
    state: GhosttyNativeSurfaceState,
    secondarySessionId: string
  ): GhosttyNativeSecondaryCallbacks {
    const ownerWindow = (): BrowserWindow | null => {
      const win = state.ownerWindow
      if (
        !win ||
        win.isDestroyed() ||
        !this.surfaces.has(this.paneKey(state.pane)) ||
        state.secondary?.sessionId !== secondarySessionId
      ) {
        return null
      }

      return win
    }

    return {
      onInput: (data): void => {
        const win = ownerWindow()
        if (!win || this.inputBlocked(win)) {
          return
        }

        this.invokeSidecar('write_pty', {
          request: {
            sessionId: secondarySessionId,
            data,
          },
        })
      },
      onResize: (cols, rows): void => {
        const win = ownerWindow()
        if (!win || !state.secondary) {
          return
        }

        if (
          state.secondary.lastResize?.cols === cols &&
          state.secondary.lastResize.rows === rows
        ) {
          return
        }

        state.secondary.lastResize = { cols, rows }
        this.invokeSidecar('resize_pty', {
          request: {
            sessionId: secondarySessionId,
            cols,
            rows,
          },
        })
      },
      onFocus: (): void => {
        const win = ownerWindow()
        if (!win || this.inputBlocked(win)) {
          return
        }

        win.webContents.send(BACKEND_EVENT, {
          event: 'ghostty-native-focus',
          payload: state.pane,
        })
      },
    }
  }

  private attachSecondaryToSurface(
    addon: GhosttyNativeParentAddon,
    state: GhosttyNativeSurfaceState,
    secondary: GhosttyNativeSecondaryState
  ): void {
    if (
      !state.surface ||
      secondary.attached ||
      !secondary.callbacks ||
      !addon.addSecondary
    ) {
      return
    }

    addon.addSecondary(
      state.surface,
      secondary.callbacks.onInput,
      secondary.callbacks.onResize,
      secondary.callbacks.onFocus,
      secondary.placement
    )
    secondary.attached = true
    addon.setSecondaryVisible?.(
      state.surface,
      secondary.visible,
      secondary.placement
    )
    this.flushPendingSecondaryData(addon, state)
  }

  private flushPendingSecondaryData(
    addon: GhosttyNativeParentAddon,
    state: GhosttyNativeSurfaceState
  ): void {
    if (!state.surface || !state.secondary?.attached) {
      return
    }

    for (const data of state.secondary.pendingData.splice(0)) {
      addon.writeSecondary?.(state.surface, data)
    }
  }

  private paneKey(payload: GhosttyNativePaneRequest): string {
    return `${payload.sessionId}:${payload.paneId}`
  }

  private destroySurface(
    key: string,
    addon: GhosttyNativeParentAddon | null = this.getOptionalAddon(),
    options: { preserveSecondary?: boolean } = {}
  ): void {
    const state = this.surfaces.get(key)
    if (!state) {
      return
    }

    if (state.surface && addon) {
      addon.destroy(state.surface)
    }
    this.clearPendingResize(state)
    this.resetSurfaceScopedCaches(state)

    if (state.ownerWindowId !== null) {
      const keys = this.surfaceKeysByWindowId.get(state.ownerWindowId)
      keys?.delete(key)
    }
    state.surface = null
    state.ownerWindow = null
    state.ownerWindowId = null
    if (options.preserveSecondary && state.secondary) {
      state.secondary.attached = false
      state.secondary.lastResize = null

      return
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
