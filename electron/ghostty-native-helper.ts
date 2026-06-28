// cspell:ignore Ghostty ghostty GHOSTTY swiftpm
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { spawn as childSpawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  GHOSTTY_NATIVE_DATA,
  GHOSTTY_NATIVE_DESTROY,
  GHOSTTY_NATIVE_FOCUS,
  GHOSTTY_NATIVE_UPDATE,
} from './ghostty-native-channels'
import { BACKEND_EVENT } from './ipc-channels'
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

interface GhosttyNativeFrame extends GhosttyNativeBounds {
  visible: boolean
}

interface GhosttyNativeHelperProcess {
  readonly stdin: NodeJS.WritableStream
  readonly stdout: NodeJS.ReadableStream
  readonly stderr: NodeJS.ReadableStream | null
  readonly pid?: number
  on(
    event: 'exit',
    cb: (code: number | null, signal: NodeJS.Signals | null) => void
  ): this
  on(event: 'error', cb: (err: Error) => void): this
  kill(signal?: NodeJS.Signals | number): boolean
}

interface GhosttyNativeHelperDeps {
  sidecar: Sidecar
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  packaged?: boolean
  spawnFn?: (
    command: string,
    args: string[],
    options: { cwd: string }
  ) => GhosttyNativeHelperProcess
}

interface HelperEvent {
  event: string
  payload: Record<string, unknown>
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HEADER_END = Buffer.from('\r\n\r\n', 'ascii')
// ponytail: Content-Length guard for a local helper; make this configurable only if real Ghostty events exceed 16 MiB.
const MAX_FRAME_BYTES = 16 * 1024 * 1024

export const isGhosttyNativeEnabled = (
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  packaged = false
): boolean =>
  !packaged && platform === 'darwin' && env.VITE_GHOSTTY_NATIVE_MACOS === '1'

export class GhosttyNativeHelperController {
  private readonly sidecar: Sidecar

  private readonly platform: NodeJS.Platform

  private readonly env: NodeJS.ProcessEnv

  private readonly packaged: boolean

  private readonly spawnFn: NonNullable<GhosttyNativeHelperDeps['spawnFn']>

  private helper: GhosttyNativeHelperProcess | null = null

  private currentPane: GhosttyNativePaneRequest | null = null

  private stdoutBuffer = Buffer.alloc(0)

  private lastResize: { cols: number; rows: number } | null = null

  constructor(deps: GhosttyNativeHelperDeps) {
    this.sidecar = deps.sidecar
    this.platform = deps.platform ?? process.platform
    this.env = deps.env ?? process.env
    this.packaged = deps.packaged ?? false
    this.spawnFn =
      deps.spawnFn ??
      ((command, args, options): GhosttyNativeHelperProcess =>
        childSpawn(command, args, options))
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
    this.shutdownHelper()
  }

  private update(
    event: IpcMainInvokeEvent,
    payload: unknown
  ): { enabled: boolean } {
    if (!this.enabled()) {
      return { enabled: false }
    }

    if (!isGhosttyNativeUpdateRequest(payload)) {
      throw new Error('invalid ghostty native update payload')
    }

    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) {
      throw new Error('ghostty native update has no owning window')
    }

    this.currentPane = {
      sessionId: payload.sessionId,
      paneId: payload.paneId,
    }

    this.getOrStartHelper().stdin.write(
      encodeFrame({
        kind: 'command',
        command: 'set-frame',
        ...toGhosttyScreenFrame(
          win.getContentBounds(),
          payload.bounds,
          payload.visible
        ),
      })
    )

    return { enabled: true }
  }

  private sendData(payload: unknown): { enabled: boolean } {
    if (!this.enabled()) {
      return { enabled: false }
    }

    if (!isGhosttyNativeDataRequest(payload)) {
      throw new Error('invalid ghostty native data payload')
    }

    this.currentPane ??= {
      sessionId: payload.sessionId,
      paneId: payload.paneId,
    }

    if (!this.matchesCurrentPane(payload)) {
      return { enabled: true }
    }

    this.getOrStartHelper().stdin.write(
      encodeFrame({
        kind: 'command',
        command: 'pty-data',
        sessionId: payload.sessionId,
        data: payload.data,
      })
    )

    return { enabled: true }
  }

  private focus(payload: unknown): { enabled: boolean } {
    if (!this.enabled()) {
      return { enabled: false }
    }

    if (!isGhosttyNativePaneRequest(payload)) {
      throw new Error('invalid ghostty native focus payload')
    }

    if (!this.matchesCurrentPane(payload)) {
      return { enabled: true }
    }

    this.getOrStartHelper().stdin.write(
      encodeFrame({
        kind: 'command',
        command: 'focus',
      })
    )

    return { enabled: true }
  }

  private destroy(payload: unknown): { enabled: boolean } {
    if (!this.enabled()) {
      return { enabled: false }
    }

    if (!isGhosttyNativePaneRequest(payload)) {
      throw new Error('invalid ghostty native destroy payload')
    }

    if (this.matchesCurrentPane(payload)) {
      this.currentPane = null
      this.lastResize = null
      this.helper?.stdin.write(
        encodeFrame({
          kind: 'command',
          command: 'set-frame',
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          visible: false,
        })
      )
    }

    return { enabled: true }
  }

  private enabled(): boolean {
    return isGhosttyNativeEnabled(this.platform, this.env, this.packaged)
  }

  private matchesCurrentPane(payload: GhosttyNativePaneRequest): boolean {
    return (
      this.currentPane?.sessionId === payload.sessionId &&
      this.currentPane.paneId === payload.paneId
    )
  }

  private getOrStartHelper(): GhosttyNativeHelperProcess {
    if (this.helper) {
      return this.helper
    }

    const helper = this.spawnFn(
      'swift',
      [
        'run',
        '--quiet',
        '--scratch-path',
        helperScratchDir(),
        'ghostty-native-macos-smoke',
        '--',
        '--electron-helper',
      ],
      { cwd: helperPackageDir() }
    )

    helper.stdout.on('data', (chunk: Buffer | string) => {
      this.appendStdout(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })

    helper.stderr?.on('data', (chunk: Buffer | string) => {
      // eslint-disable-next-line no-console
      console.warn(`[ghostty-native] ${String(chunk)}`)
    })

    helper.on('exit', () => {
      this.helper = null
      this.currentPane = null
      this.stdoutBuffer = Buffer.alloc(0)
      this.lastResize = null
    })

    helper.on('error', (error) => {
      // eslint-disable-next-line no-console
      console.warn('Ghostty native helper failed', error)
    })

    this.helper = helper

    return helper
  }

  private appendStdout(chunk: Buffer): void {
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk])
    this.processStdout()
  }

  private processStdout(): void {
    while (this.stdoutBuffer.length > 0) {
      const headerEnd = this.stdoutBuffer.indexOf(HEADER_END)
      if (headerEnd === -1) {
        return
      }

      const header = this.stdoutBuffer.subarray(0, headerEnd).toString('ascii')
      const contentLength = parseContentLength(header)
      if (contentLength === null) {
        this.shutdownHelper()

        return
      }

      const bodyStart = headerEnd + HEADER_END.length
      const bodyEnd = bodyStart + contentLength
      if (this.stdoutBuffer.length < bodyEnd) {
        return
      }

      const body = this.stdoutBuffer.subarray(bodyStart, bodyEnd)
      this.stdoutBuffer = this.stdoutBuffer.subarray(bodyEnd)

      const event = parseHelperEvent(body)
      if (event) {
        this.handleHelperEvent(event)
      }
    }
  }

  private handleHelperEvent(event: HelperEvent): void {
    const eventHandlers = new Map<
      string,
      (payload: Record<string, unknown>) => void
    >([
      [
        'pty-input',
        (payload): void => {
          this.handlePtyInput(payload)
        },
      ],
      [
        'pty-resize',
        (payload): void => {
          this.handlePtyResize(payload)
        },
      ],
    ])

    eventHandlers.get(event.event)?.(event.payload)
  }

  private handlePtyInput(payload: Record<string, unknown>): void {
    const data = payload.data
    if (typeof data !== 'string' || !this.currentPane) {
      return
    }

    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(BACKEND_EVENT, {
        event: 'ghostty-native-input',
        payload: { ...this.currentPane, data },
      })
    }
    void this.sidecar.invoke('write_pty', {
      request: {
        sessionId: this.currentPane.sessionId,
        data,
      },
    })
  }

  private handlePtyResize(payload: Record<string, unknown>): void {
    const cols = payload.cols
    const rows = payload.rows
    if (
      typeof cols !== 'number' ||
      typeof rows !== 'number' ||
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

  private shutdownHelper(): void {
    const helper = this.helper
    this.helper = null
    this.currentPane = null
    this.stdoutBuffer = Buffer.alloc(0)
    this.lastResize = null

    if (!helper) {
      return
    }

    helper.stdin.write(encodeFrame({ kind: 'shutdown' }))
    helper.kill()
  }
}

export const setupGhosttyNativeHelper = (
  deps: GhosttyNativeHelperDeps
): GhosttyNativeHelperController => {
  const controller = new GhosttyNativeHelperController(deps)
  controller.registerIpc()

  return controller
}

export function toGhosttyScreenFrame(
  contentBounds: GhosttyNativeBounds,
  paneBounds: GhosttyNativeBounds,
  visible: boolean
): GhosttyNativeFrame {
  const width = Math.max(0, Math.round(paneBounds.width))
  const height = Math.max(0, Math.round(paneBounds.height))
  const frameVisible = visible && width > 0 && height > 0

  return {
    x: Math.round(contentBounds.x + paneBounds.x),
    y: Math.round(contentBounds.y + paneBounds.y),
    width,
    height,
    visible: frameVisible,
  }
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

function helperPackageDir(): string {
  return path.resolve(__dirname, '..', 'native', 'ghostty-helper')
}

function helperScratchDir(): string {
  return path.join(os.tmpdir(), 'vimeflow-ghostty-native-helper-swiftpm')
}

function encodeFrame(body: Record<string, unknown>): Buffer {
  const json = Buffer.from(JSON.stringify(body), 'utf8')
  const header = Buffer.from(`Content-Length: ${json.length}\r\n\r\n`, 'ascii')

  return Buffer.concat([header, json])
}

function parseContentLength(header: string): number | null {
  const match = /Content-Length:\s*(\d+)/i.exec(header)
  if (!match) {
    return null
  }

  const length = Number(match[1])

  return Number.isFinite(length) && length <= MAX_FRAME_BYTES ? length : null
}

function parseHelperEvent(body: Buffer): HelperEvent | null {
  let parsed: unknown

  try {
    parsed = JSON.parse(body.toString('utf8')) as unknown
  } catch {
    return null
  }

  if (!isRecord(parsed) || parsed.kind !== 'event') {
    return null
  }

  const event = parsed.event
  const payload = parsed.payload

  if (typeof event !== 'string' || event.length === 0 || !isRecord(payload)) {
    return null
  }

  return { event, payload }
}
