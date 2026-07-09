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
import {
  isBounds,
  isHexColor,
  isNonEmptyString,
  isOptionalFiniteNumber,
  isRecord,
  isString,
  type GhosttyNativeBounds,
  type GhosttyNativeDataRequest,
  type GhosttyNativePaneRequest,
  type GhosttyNativeUpdateRequest,
} from './ghostty-native-shared'

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
const CONTENT_LENGTH_HEADER = Buffer.from('Content-Length:', 'ascii')
const GHOSTTY_NATIVE_FALLBACK_BACKGROUND_COLOR = '#000000'
const GHOSTTY_NATIVE_FALLBACK_FOREGROUND_COLOR = '#ffffff'
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

  private currentWindow: BrowserWindow | null = null

  private stdoutChunks: Buffer[] = []

  private stdoutLength = 0

  private discardUntilFrameStart = false

  private lastResize: { cols: number; rows: number } | null = null

  private pendingStdinBytes = 0

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
    this.currentWindow = win

    const frame = toGhosttyScreenFrame(
      win.getContentBounds(),
      payload.bounds,
      payload.visible
    )

    this.writeHelperFrame({
      kind: 'command',
      command: 'set-frame',
      backgroundColor: isHexColor(payload.backgroundColor)
        ? payload.backgroundColor
        : GHOSTTY_NATIVE_FALLBACK_BACKGROUND_COLOR,
      foregroundColor: isHexColor(payload.foregroundColor)
        ? payload.foregroundColor
        : GHOSTTY_NATIVE_FALLBACK_FOREGROUND_COLOR,
      ...(isNonEmptyString(payload.fontFamily)
        ? { fontFamily: payload.fontFamily }
        : {}),
      bottomCornerRadius: frame.visible
        ? Math.max(0, Math.round(payload.bottomCornerRadius ?? 0))
        : 0,
      ...frame,
    })

    return { enabled: true }
  }

  private writeHelperFrame(frame: Record<string, unknown>): void {
    const encoded = encodeFrame(frame)
    if (this.pendingStdinBytes + encoded.length > MAX_FRAME_BYTES) {
      this.shutdownHelper()

      return
    }

    const helper = this.getOrStartHelper()
    const accepted = helper.stdin.write(encoded)
    if (accepted) {
      return
    }

    this.pendingStdinBytes += encoded.length
    helper.stdin.once('drain', () => {
      this.pendingStdinBytes = 0
    })
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
      return { enabled: false }
    }

    this.writeHelperFrame({
      kind: 'command',
      command: 'pty-data',
      sessionId: payload.sessionId,
      data: payload.data,
    })

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
      return { enabled: false }
    }

    this.writeHelperFrame({
      kind: 'command',
      command: 'focus',
    })

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
      this.currentWindow = null
      this.lastResize = null
      this.clearStdout()
      this.discardUntilFrameStart = true
      this.writeHelperFrame({
        kind: 'command',
        command: 'set-frame',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        visible: false,
        backgroundColor: GHOSTTY_NATIVE_FALLBACK_BACKGROUND_COLOR,
        foregroundColor: GHOSTTY_NATIVE_FALLBACK_FOREGROUND_COLOR,
      })
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
      if (this.helper !== helper) {
        return
      }

      this.appendStdout(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })

    helper.stderr?.on('data', (chunk: Buffer | string) => {
      if (this.helper !== helper) {
        return
      }

      // eslint-disable-next-line no-console
      console.warn(`[ghostty-native] ${String(chunk)}`)
    })

    helper.stdin.on('error', (error) => {
      // eslint-disable-next-line no-console
      console.warn('Ghostty native helper stdin failed', error)
      this.terminateHelper(helper)
    })

    helper.on('exit', () => {
      this.resetHelperState(helper)
    })

    helper.on('error', (error) => {
      // eslint-disable-next-line no-console
      console.warn('Ghostty native helper failed', error)
      this.terminateHelper(helper)
    })

    this.helper = helper

    return helper
  }

  private appendStdout(chunk: Buffer): void {
    this.stdoutChunks.push(chunk)
    this.stdoutLength += chunk.length
    this.processStdout()
  }

  private processStdout(): void {
    while (this.stdoutLength > 0) {
      const wasDiscarding = this.discardUntilFrameStart

      if (wasDiscarding && !this.stdoutStartsWithFrameHeader()) {
        this.discardStdoutUntilFrameStart()

        if (!this.stdoutStartsWithFrameHeader()) {
          return
        }
      }

      const headerEnd = this.indexOfHeaderEnd()
      if (headerEnd === -1) {
        if (this.stdoutLength > MAX_FRAME_BYTES) {
          this.shutdownHelper()
        }

        return
      }

      const header = this.readStdoutAscii(headerEnd)
      const contentLength = parseContentLength(header)
      if (contentLength === null) {
        if (wasDiscarding) {
          this.discardStdoutUntilFrameStart(1)
          continue
        }

        this.shutdownHelper()

        return
      }

      this.discardUntilFrameStart = false

      const bodyStart = headerEnd + HEADER_END.length
      const bodyEnd = bodyStart + contentLength
      if (this.stdoutLength < bodyEnd) {
        return
      }

      const stdoutBuffer = this.consumeStdoutBuffer()
      const body = stdoutBuffer.subarray(bodyStart, bodyEnd)
      this.setStdoutBuffer(stdoutBuffer.subarray(bodyEnd))

      const event = parseHelperEvent(body)
      if (event) {
        this.handleHelperEvent(event)
      }
    }
  }

  private handleHelperEvent(event: HelperEvent): void {
    switch (event.event) {
      case 'pty-input':
        this.handlePtyInput(event.payload)
        break
      case 'pty-resize':
        this.handlePtyResize(event.payload)
        break
    }
  }

  private handlePtyInput(payload: Record<string, unknown>): void {
    const data = payload.data
    if (typeof data !== 'string' || !this.currentPane) {
      return
    }

    if (this.currentWindow && !this.currentWindow.isDestroyed()) {
      this.currentWindow.webContents.send(BACKEND_EVENT, {
        event: 'ghostty-native-input',
        payload: { ...this.currentPane, data },
      })
    }
    this.invokeSidecar('write_pty', {
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
    this.invokeSidecar('resize_pty', {
      request: {
        sessionId: this.currentPane.sessionId,
        cols,
        rows,
      },
    })
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

  private shutdownHelper(): void {
    const helper = this.helper
    this.resetHelperState(helper)

    if (!helper) {
      return
    }

    try {
      helper.stdin.write(encodeFrame({ kind: 'shutdown' }))
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('Ghostty native helper shutdown failed', error)
    }
    helper.kill()
  }

  private resetHelperState(helper: GhosttyNativeHelperProcess | null): void {
    if (helper !== null && this.helper !== helper) {
      return
    }

    this.helper = null
    this.currentPane = null
    this.currentWindow = null
    this.clearStdout()
    this.discardUntilFrameStart = false
    this.lastResize = null
    this.pendingStdinBytes = 0
  }

  private terminateHelper(helper: GhosttyNativeHelperProcess): void {
    this.resetHelperState(helper)
    helper.kill()
  }

  private indexOfHeaderEnd(): number {
    let matched = 0
    let offset = 0

    for (const chunk of this.stdoutChunks) {
      for (const byte of chunk) {
        if (byte === HEADER_END[matched]) {
          matched += 1
          if (matched === HEADER_END.length) {
            return offset - HEADER_END.length + 1
          }
        } else {
          matched = byte === HEADER_END[0] ? 1 : 0
        }
        offset += 1
      }
    }

    return -1
  }

  private consumeStdoutBuffer(): Buffer {
    const buffer =
      this.stdoutChunks.length === 1
        ? this.stdoutChunks[0]
        : Buffer.concat(this.stdoutChunks, this.stdoutLength)
    this.clearStdout()

    return buffer
  }

  private readStdoutAscii(length: number): string {
    const buffer = Buffer.alloc(length)
    let written = 0

    for (const chunk of this.stdoutChunks) {
      if (written >= length) {
        break
      }

      const bytesToCopy = Math.min(chunk.length, length - written)
      chunk.copy(buffer, written, 0, bytesToCopy)
      written += bytesToCopy
    }

    return buffer.toString('ascii')
  }

  private setStdoutBuffer(buffer: Buffer): void {
    this.stdoutChunks = buffer.length > 0 ? [buffer] : []
    this.stdoutLength = buffer.length
  }

  private clearStdout(): void {
    this.stdoutChunks = []
    this.stdoutLength = 0
  }

  private stdoutStartsWithFrameHeader(): boolean {
    if (this.stdoutLength < CONTENT_LENGTH_HEADER.length) {
      return false
    }

    const buffer = this.consumeStdoutBuffer()

    const startsWith = buffer
      .subarray(0, CONTENT_LENGTH_HEADER.length)
      .equals(CONTENT_LENGTH_HEADER)

    this.setStdoutBuffer(buffer)

    return startsWith
  }

  private discardStdoutUntilFrameStart(startOffset = 0): void {
    const buffer = this.consumeStdoutBuffer()
    const searchFrom = Math.min(startOffset, buffer.length)
    const frameStart = buffer.indexOf(CONTENT_LENGTH_HEADER, searchFrom)

    if (frameStart !== -1) {
      this.setStdoutBuffer(buffer.subarray(frameStart))

      return
    }

    this.setStdoutBuffer(
      buffer.subarray(partialFrameHeaderPrefixLength(buffer))
    )
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
    isNonEmptyString(value.sessionId) &&
    isNonEmptyString(value.paneId) &&
    isString(value.cwd) &&
    isBounds(value.bounds) &&
    (value.backgroundColor === undefined ||
      isHexColor(value.backgroundColor)) &&
    (value.foregroundColor === undefined ||
      isHexColor(value.foregroundColor)) &&
    isOptionalFiniteNumber(value.bottomCornerRadius) &&
    typeof value.parentHeight === 'number' &&
    Number.isFinite(value.parentHeight) &&
    typeof value.visible === 'boolean'
  )
}

function isGhosttyNativeDataRequest(
  value: unknown
): value is GhosttyNativeDataRequest {
  return (
    isRecord(value) &&
    isNonEmptyString(value.sessionId) &&
    isNonEmptyString(value.paneId) &&
    typeof value.data === 'string'
  )
}

function isGhosttyNativePaneRequest(
  value: unknown
): value is GhosttyNativePaneRequest {
  return (
    isRecord(value) &&
    isNonEmptyString(value.sessionId) &&
    isNonEmptyString(value.paneId)
  )
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

function partialFrameHeaderPrefixLength(buffer: Buffer): number {
  const maxLength = Math.min(buffer.length, CONTENT_LENGTH_HEADER.length - 1)

  for (let length = maxLength; length > 0; length -= 1) {
    if (
      buffer
        .subarray(buffer.length - length)
        .equals(CONTENT_LENGTH_HEADER.subarray(0, length))
    ) {
      return buffer.length - length
    }
  }

  return buffer.length
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
