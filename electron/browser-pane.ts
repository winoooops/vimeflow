import {
  BrowserWindow,
  WebContentsView,
  ipcMain,
  session as electronSession,
  type Event as ElectronEvent,
  type IpcMainInvokeEvent,
  type Session as ElectronSession,
  type WebContents,
} from 'electron'
import { randomBytes, createHash } from 'node:crypto'
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import type { Socket } from 'node:net'
import {
  BROWSER_PANE_CDP_INFO,
  BROWSER_PANE_CREATE,
  BROWSER_PANE_DESTROY,
  BROWSER_PANE_FOCUS,
  BROWSER_PANE_FOCUSED,
  BROWSER_PANE_NAVIGATE,
  BROWSER_PANE_SET_BOUNDS,
  BROWSER_PANE_URL_CHANGED,
} from './browser-pane-channels'
import {
  commandPaletteToggleDispatcherForWindow,
  isCommandPaletteShortcutInput,
} from './command-palette-shortcut'

// cspell:ignore cdp debuggee mediaKeySystem websocket WebContentsView
interface BrowserPaneBounds {
  x: number
  y: number
  width: number
  height: number
}

interface BrowserPaneShortcutContext {
  paneIds: string[]
  activePaneId: string | null
}

interface BrowserPaneCreateRequest {
  sessionId: string
  paneId: string
  workspaceId: string
  initialUrl: string
  shortcutContext?: BrowserPaneShortcutContext
}

interface BrowserPaneBoundsRequest {
  sessionId: string
  paneId: string
  bounds: BrowserPaneBounds
  visible: boolean
  shortcutContext?: BrowserPaneShortcutContext
}

interface BrowserPaneNavigateRequest {
  sessionId: string
  paneId: string
  url: string
}

interface BrowserPaneDestroyRequest {
  sessionId: string
  paneId: string
}

interface BrowserCdpInfoRequest {
  sessionId: string
  paneId: string
}

interface BrowserPaneShortcutInput {
  type: string
  key: string
  code: string
  control: boolean
  meta: boolean
  alt: boolean
  shift?: boolean
  isAutoRepeat?: boolean
}

interface BrowserPaneCreateResult {
  url: string
  title: string | null
  partition: string
}

interface BrowserCdpInfo {
  url: string
  token: string
  origin: string
  targetId: string
}

interface BrowserPaneRecord {
  id: string
  sessionId: string
  paneId: string
  partition: string
  cdpToken: string
  windowId: number
  ownerWebContentsId: number
  view: WebContentsView
  popupWindows: Set<BrowserWindow>
  windowClosedHandler: () => void
  shortcutContext: BrowserPaneShortcutContext | null
}

interface CdpAttachment {
  socket: Socket
  close: () => void
}

interface CdpCommand {
  id?: number
  method?: string
  params?: Record<string, unknown>
}

const BROWSER_CDP_ORIGIN = 'vimeflow://agent-plugin/local'
const DEFAULT_BROWSER_URL = 'https://www.youtube.com/'
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

const ALLOWED_CDP_DOMAINS = new Set([
  'Accessibility',
  'DOM',
  'Emulation',
  'Input',
  'Log',
  'Network',
  'Page',
  'Runtime',
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString)

const paneKey = (sessionId: string, paneId: string): string =>
  `${sessionId}:${paneId}`

const sanitizePartitionSegment = (value: string): string =>
  value.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 96)

const normalizeUrl = (value: string): string => {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    parsed = new URL(DEFAULT_BROWSER_URL)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return DEFAULT_BROWSER_URL
  }

  return parsed.toString()
}

const isAllowedBrowserNavigationUrl = (value: string): boolean => {
  if (value === 'about:blank') {
    return true
  }

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }

  return parsed.protocol === 'http:' || parsed.protocol === 'https:'
}

const isAllowedPopupUrl = isAllowedBrowserNavigationUrl

const cdpNavigationUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null
  }

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null
  }

  return parsed.toString()
}

const isCreateRequest = (value: unknown): value is BrowserPaneCreateRequest =>
  isRecord(value) &&
  isString(value.sessionId) &&
  isString(value.paneId) &&
  isString(value.workspaceId) &&
  isString(value.initialUrl)

const isBounds = (value: unknown): value is BrowserPaneBounds =>
  isRecord(value) &&
  typeof value.x === 'number' &&
  Number.isFinite(value.x) &&
  typeof value.y === 'number' &&
  Number.isFinite(value.y) &&
  typeof value.width === 'number' &&
  Number.isFinite(value.width) &&
  typeof value.height === 'number' &&
  Number.isFinite(value.height)

const isShortcutContext = (
  value: unknown
): value is BrowserPaneShortcutContext =>
  isRecord(value) &&
  isStringArray(value.paneIds) &&
  (value.activePaneId === null || isString(value.activePaneId))

const shortcutContextFromRequest = (
  value: unknown
): BrowserPaneShortcutContext | null =>
  isRecord(value) && isShortcutContext(value.shortcutContext)
    ? {
        paneIds: [...value.shortcutContext.paneIds],
        activePaneId: value.shortcutContext.activePaneId,
      }
    : null

const isBoundsRequest = (value: unknown): value is BrowserPaneBoundsRequest =>
  isRecord(value) &&
  isString(value.sessionId) &&
  isString(value.paneId) &&
  isBounds(value.bounds) &&
  typeof value.visible === 'boolean'

const isNavigateRequest = (
  value: unknown
): value is BrowserPaneNavigateRequest =>
  isRecord(value) &&
  isString(value.sessionId) &&
  isString(value.paneId) &&
  isString(value.url)

const isDestroyRequest = (value: unknown): value is BrowserPaneDestroyRequest =>
  isRecord(value) && isString(value.sessionId) && isString(value.paneId)

const isCdpInfoRequest = (value: unknown): value is BrowserCdpInfoRequest =>
  isRecord(value) && isString(value.sessionId) && isString(value.paneId)

const isCdpCommand = (value: unknown): value is CdpCommand =>
  isRecord(value) &&
  (value.id === undefined || typeof value.id === 'number') &&
  (value.method === undefined || typeof value.method === 'string') &&
  (value.params === undefined || isRecord(value.params))

const visibleBounds = (
  bounds: BrowserPaneBounds,
  visible: boolean
): BrowserPaneBounds => {
  if (!visible || bounds.width <= 0 || bounds.height <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }

  return {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height)),
  }
}

const loadBrowserUrl = async (
  webContents: WebContents,
  url: string
): Promise<void> => {
  try {
    await webContents.loadURL(url)
  } catch {
    // Keep the browser surface alive when Chromium rejects navigation because
    // a load was cancelled, redirected, blocked by network state, or replaced.
  }
}

const hasPlatformShortcutModifier = (
  input: BrowserPaneShortcutInput,
  platform: NodeJS.Platform = process.platform
): boolean => {
  if (input.type !== 'keyDown' || input.isAutoRepeat) {
    return false
  }

  return platform === 'darwin'
    ? input.meta && !input.control
    : input.control && !input.meta
}

const isBrowserPaneWorkspaceShortcutInput = (
  input: BrowserPaneShortcutInput
): boolean => {
  if (!hasPlatformShortcutModifier(input)) {
    return false
  }

  if (/^Digit[1-4]$/.test(input.code) || input.code === 'Backslash') {
    return true
  }

  if (input.alt || input.shift) {
    return false
  }

  const key = input.key.toLowerCase()

  return key === 'e' || key === 'g'
}

const shouldRefocusBrowserAfterWorkspaceShortcut = (
  input: BrowserPaneShortcutInput
): boolean => /^Digit[1-4]$/.test(input.code) || input.code === 'Backslash'

const shouldForwardBrowserWorkspaceShortcut = (
  record: BrowserPaneRecord,
  input: BrowserPaneShortcutInput
): boolean => {
  if (!isBrowserPaneWorkspaceShortcutInput(input)) {
    return false
  }

  const digitMatch = /^Digit([1-4])$/.exec(input.code)
  if (!digitMatch) {
    return true
  }

  const shortcutContext = record.shortcutContext
  if (shortcutContext?.activePaneId !== record.paneId) {
    return false
  }

  const paneIndex = Number.parseInt(digitMatch[1], 10) - 1
  if (paneIndex >= shortcutContext.paneIds.length) {
    return false
  }

  const targetPaneId = shortcutContext.paneIds[paneIndex]

  return targetPaneId !== record.paneId
}

const browserPaneShortcutEventInit = (
  input: BrowserPaneShortcutInput
): Record<string, boolean | string> => ({
  key: input.key,
  code: input.code,
  ctrlKey: input.control,
  metaKey: input.meta,
  altKey: input.alt,
  shiftKey: input.shift === true,
  bubbles: true,
  cancelable: true,
})

const writeJson = (
  response: ServerResponse,
  body: unknown,
  statusCode = 200
): void => {
  const payload = JSON.stringify(body)
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    Connection: 'close',
  })
  response.end(payload)
}

const writeHttpError = (
  socket: Socket,
  statusCode: number,
  message: string
): void => {
  const payload = `${message}\n`
  socket.write(
    [
      `HTTP/1.1 ${statusCode} ${message}`,
      'Content-Type: text/plain; charset=utf-8',
      `Content-Length: ${Buffer.byteLength(payload).toString()}`,
      'Connection: close',
      '',
      payload,
    ].join('\r\n')
  )
  socket.end()
}

const writeResponseError = (
  response: ServerResponse,
  statusCode: number,
  message: string
): void => {
  response.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    Connection: 'close',
  })
  response.end(`${message}\n`)
}

const sendWebSocketText = (socket: Socket, value: unknown): void => {
  const payload = Buffer.from(JSON.stringify(value))
  let header: Buffer

  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length])
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x81
    header[1] = 126
    header.writeUInt16BE(payload.length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x81
    header[1] = 127
    header.writeBigUInt64BE(BigInt(payload.length), 2)
  }

  socket.write(Buffer.concat([header, payload]))
}

const sendWebSocketClose = (socket: Socket): void => {
  try {
    if (!socket.destroyed && socket.writable) {
      socket.write(Buffer.from([0x88, 0x00]))
    }
  } catch {
    // The socket may already be half-closed/reset by the client.
  }
  socket.destroy()
}

interface DecodedFrame {
  opcode: number
  payload: Buffer
  byteLength: number
}

const decodeFrame = (buffer: Buffer): DecodedFrame | null => {
  if (buffer.length < 2) {
    return null
  }

  const opcode = buffer[0] & 0x0f
  const masked = (buffer[1] & 0x80) !== 0
  let payloadLength = buffer[1] & 0x7f
  let offset = 2

  if (payloadLength === 126) {
    if (buffer.length < offset + 2) {
      return null
    }
    payloadLength = buffer.readUInt16BE(offset)
    offset += 2
  } else if (payloadLength === 127) {
    if (buffer.length < offset + 8) {
      return null
    }
    const length = buffer.readBigUInt64BE(offset)
    if (length > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('websocket frame too large')
    }
    payloadLength = Number(length)
    offset += 8
  }

  const maskLength = masked ? 4 : 0
  const frameLength = offset + maskLength + payloadLength
  if (buffer.length < frameLength) {
    return null
  }

  let payload = buffer.subarray(offset + maskLength, frameLength)
  if (masked) {
    const mask = buffer.subarray(offset, offset + 4)
    payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]))
  }

  return { opcode, payload, byteLength: frameLength }
}

export class BrowserPaneController {
  private readonly panes = new Map<string, BrowserPaneRecord>()

  private readonly cdpAttachments = new Map<string, CdpAttachment>()

  private readonly partitionHandlers = new Set<string>()

  private readonly rendererLifecycleHandlers = new Set<number>()

  private cdpServer: Server | null = null

  private cdpServerStart: Promise<void> | null = null

  private cdpPort: number | null = null

  install(): void {
    ipcMain.handle(BROWSER_PANE_CREATE, (event, payload) =>
      this.createPane(event, payload)
    )

    ipcMain.handle(BROWSER_PANE_SET_BOUNDS, (_event, payload) =>
      this.setBounds(payload)
    )

    ipcMain.handle(BROWSER_PANE_NAVIGATE, (_event, payload) =>
      this.navigate(payload)
    )

    ipcMain.handle(BROWSER_PANE_DESTROY, (_event, payload) =>
      this.destroyPane(payload)
    )

    ipcMain.handle(BROWSER_PANE_FOCUS, (_event, payload) =>
      this.focusPane(payload)
    )

    ipcMain.handle(BROWSER_PANE_CDP_INFO, (_event, payload) =>
      this.cdpInfo(payload)
    )
  }

  dispose(): void {
    ipcMain.removeHandler(BROWSER_PANE_CREATE)
    ipcMain.removeHandler(BROWSER_PANE_SET_BOUNDS)
    ipcMain.removeHandler(BROWSER_PANE_NAVIGATE)
    ipcMain.removeHandler(BROWSER_PANE_DESTROY)
    ipcMain.removeHandler(BROWSER_PANE_FOCUS)
    ipcMain.removeHandler(BROWSER_PANE_CDP_INFO)

    for (const record of this.panes.values()) {
      this.removeRecord(record)
    }
    this.panes.clear()
    this.cdpAttachments.clear()
    this.rendererLifecycleHandlers.clear()
    this.cdpServer?.close()
    this.cdpServer = null
    this.cdpServerStart = null
    this.cdpPort = null
  }

  private async createPane(
    event: IpcMainInvokeEvent,
    payload: unknown
  ): Promise<BrowserPaneCreateResult> {
    if (!isCreateRequest(payload)) {
      throw new Error('invalid browser pane create payload')
    }

    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) {
      throw new Error('browser pane requires a BrowserWindow sender')
    }

    const key = paneKey(payload.sessionId, payload.paneId)
    const existing = this.panes.get(key)
    if (existing) {
      existing.shortcutContext = shortcutContextFromRequest(payload)

      return {
        url:
          existing.view.webContents.getURL() ||
          normalizeUrl(payload.initialUrl),
        title: existing.view.webContents.getTitle() || null,
        partition: existing.partition,
      }
    }

    const workspaceId = sanitizePartitionSegment(payload.workspaceId)
    const sessionId = sanitizePartitionSegment(payload.sessionId)
    const partition = `persist:vimeflow-browser:${workspaceId}:${sessionId}`
    const ses = electronSession.fromPartition(partition, { cache: true })
    this.installPartitionPolicy(partition, ses)

    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    })

    const handleWindowClosed = (): void => {
      void this.destroyPane(payload)
    }

    const record: BrowserPaneRecord = {
      id: key,
      sessionId: payload.sessionId,
      paneId: payload.paneId,
      partition,
      cdpToken: randomBytes(24).toString('base64url'),
      windowId: win.id,
      ownerWebContentsId: event.sender.id,
      view,
      popupWindows: new Set<BrowserWindow>(),
      windowClosedHandler: handleWindowClosed,
      shortcutContext: shortcutContextFromRequest(payload),
    }

    this.installNavigationPolicy(view.webContents)
    this.installPopupPolicy(view.webContents, win, ses, record)

    this.panes.set(key, record)
    this.installRendererLifecycleCleanup(event.sender)
    win.contentView.addChildView(view)
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    view.webContents.setAudioMuted(false)
    this.installAppShortcutForwarding(record)
    view.webContents.on('destroyed', () => {
      if (this.panes.get(key) === record) {
        this.panes.delete(key)
      }
    })

    view.webContents.on('focus', () => {
      if (event.sender.isDestroyed()) {
        return
      }

      event.sender.send(BROWSER_PANE_FOCUSED, {
        sessionId: payload.sessionId,
        paneId: payload.paneId,
      })
    })

    const emitUrlChanged = (): void => {
      this.emitPaneUrlChanged(record)
    }
    view.webContents.on('did-navigate', emitUrlChanged)
    view.webContents.on('did-navigate-in-page', emitUrlChanged)

    win.once('closed', record.windowClosedHandler)

    await this.ensureCdpServer()
    const initialUrl = normalizeUrl(payload.initialUrl)
    void loadBrowserUrl(view.webContents, initialUrl)

    return {
      url: view.webContents.getURL() || initialUrl,
      title: view.webContents.getTitle() || null,
      partition,
    }
  }

  private installNavigationPolicy(webContents: WebContents): void {
    webContents.on('will-frame-navigate', (event) => {
      if (event.isMainFrame && !isAllowedBrowserNavigationUrl(event.url)) {
        event.preventDefault()
      }
    })

    webContents.on('will-redirect', (event) => {
      if (event.isMainFrame && !isAllowedBrowserNavigationUrl(event.url)) {
        event.preventDefault()
      }
    })
  }

  private installPopupPolicy(
    webContents: WebContents,
    win: BrowserWindow,
    ses: ElectronSession,
    record: BrowserPaneRecord
  ): void {
    webContents.setWindowOpenHandler(({ url }) => {
      if (!isAllowedPopupUrl(url)) {
        return { action: 'deny' }
      }

      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: win,
          modal: false,
          width: 520,
          height: 720,
          autoHideMenuBar: true,
          backgroundColor: '#1e1e2e',
          webPreferences: {
            session: ses,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
          },
        },
      }
    })

    webContents.on('did-create-window', (popup) => {
      record.popupWindows.add(popup)
      popup.once('closed', () => {
        record.popupWindows.delete(popup)
      })
      this.installNavigationPolicy(popup.webContents)
      this.installPopupPolicy(popup.webContents, win, ses, record)
    })
  }

  private emitPaneUrlChanged(record: BrowserPaneRecord): void {
    const win = BrowserWindow.fromId(record.windowId)
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
      return
    }

    win.webContents.send(BROWSER_PANE_URL_CHANGED, {
      sessionId: record.sessionId,
      paneId: record.paneId,
      url: record.view.webContents.getURL(),
      title: record.view.webContents.getTitle() || null,
    })
  }

  private installAppShortcutForwarding(record: BrowserPaneRecord): void {
    const dispatchCommandPaletteToggle = (): void => {
      const win = BrowserWindow.fromId(record.windowId)
      if (!win || win.isDestroyed()) {
        return
      }

      win.webContents.focus()
      commandPaletteToggleDispatcherForWindow(win)()
    }

    record.view.webContents.on('before-input-event', (event, input) => {
      if (isCommandPaletteShortcutInput(input)) {
        event.preventDefault()
        dispatchCommandPaletteToggle()

        return
      }

      if (!shouldForwardBrowserWorkspaceShortcut(record, input)) {
        return
      }

      event.preventDefault()
      void this.forwardShortcutToAppRenderer(record, input)
    })
  }

  private async forwardShortcutToAppRenderer(
    record: BrowserPaneRecord,
    input: BrowserPaneShortcutInput
  ): Promise<void> {
    const win = BrowserWindow.fromId(record.windowId)
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
      return
    }

    win.webContents.focus()
    const eventInit = JSON.stringify(browserPaneShortcutEventInit(input))
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
              const activeBrowserPane = Array.from(
                document.querySelectorAll('[data-pane-kind="browser"][data-pane-active="true"]')
              ).some((node) =>
                node.getAttribute('data-pane-id') === ${JSON.stringify(record.paneId)} &&
                node.closest('[data-browser-session-id]')?.getAttribute('data-browser-session-id') === ${JSON.stringify(record.sessionId)}
              )
              resolve(activeBrowserPane)
            })
          })
        })()`,
        false
      )
      if (
        shouldRefocusBrowserAfterWorkspaceShortcut(input) &&
        shouldRefocus === true &&
        this.panes.get(record.id) === record &&
        !record.view.webContents.isDestroyed()
      ) {
        record.view.webContents.focus()
      }
    } catch {
      // The app renderer may be navigating or shutting down.
    }
  }

  private setBounds(payload: unknown): void {
    if (!isBoundsRequest(payload)) {
      throw new Error('invalid browser pane bounds payload')
    }

    const record = this.panes.get(paneKey(payload.sessionId, payload.paneId))
    if (!record) {
      return
    }

    record.shortcutContext = shortcutContextFromRequest(payload)
    record.view.setBounds(visibleBounds(payload.bounds, payload.visible))
  }

  private async navigate(payload: unknown): Promise<void> {
    if (!isNavigateRequest(payload)) {
      throw new Error('invalid browser pane navigate payload')
    }

    const record = this.panes.get(paneKey(payload.sessionId, payload.paneId))
    if (!record) {
      return
    }

    await loadBrowserUrl(record.view.webContents, normalizeUrl(payload.url))
  }

  private destroyPane(payload: unknown): void {
    if (!isDestroyRequest(payload)) {
      throw new Error('invalid browser pane destroy payload')
    }

    const key = paneKey(payload.sessionId, payload.paneId)
    const record = this.panes.get(key)
    if (!record) {
      return
    }

    this.removeRecord(record)
    this.panes.delete(key)
  }

  private focusPane(payload: unknown): void {
    if (!isDestroyRequest(payload)) {
      throw new Error('invalid browser pane focus payload')
    }

    const record = this.panes.get(paneKey(payload.sessionId, payload.paneId))
    if (!record) {
      return
    }

    record.view.webContents.focus()
  }

  private async cdpInfo(payload: unknown): Promise<BrowserCdpInfo> {
    await this.ensureCdpServer()

    if (!isCdpInfoRequest(payload)) {
      throw new Error('invalid browser pane CDP info payload')
    }

    const record = this.panes.get(paneKey(payload.sessionId, payload.paneId))
    if (!record) {
      throw new Error('no browser pane registered for CDP')
    }

    return {
      url: `http://127.0.0.1:${String(this.cdpPort)}`,
      token: record.cdpToken,
      origin: BROWSER_CDP_ORIGIN,
      targetId: record.id,
    }
  }

  private installPartitionPolicy(
    partition: string,
    ses: ElectronSession
  ): void {
    if (this.partitionHandlers.has(partition)) {
      return
    }

    this.partitionHandlers.add(partition)
    ses.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(permission === 'mediaKeySystem')
    })
  }

  private removeRecord(record: BrowserPaneRecord): void {
    this.cdpAttachments.get(record.id)?.close()
    this.cdpAttachments.delete(record.id)

    for (const popup of [...record.popupWindows]) {
      if (!popup.isDestroyed()) {
        popup.destroy()
      }
    }
    record.popupWindows.clear()

    const win = BrowserWindow.fromId(record.windowId)
    if (win && !win.isDestroyed()) {
      win.removeListener('closed', record.windowClosedHandler)
      win.contentView.removeChildView(record.view)
    }

    if (!record.view.webContents.isDestroyed()) {
      record.view.webContents.close()
    }
  }

  private installRendererLifecycleCleanup(sender: WebContents): void {
    if (this.rendererLifecycleHandlers.has(sender.id)) {
      return
    }

    this.rendererLifecycleHandlers.add(sender.id)

    const cleanup = (): void => {
      sender.removeListener('destroyed', handleDestroyed)
      sender.removeListener('render-process-gone', handleRenderProcessGone)
      this.rendererLifecycleHandlers.delete(sender.id)
      this.removeRecordsForOwner(sender.id)
    }

    const handleDestroyed = (): void => {
      cleanup()
    }

    const handleRenderProcessGone = (): void => {
      cleanup()
    }

    sender.once('destroyed', handleDestroyed)
    sender.once('render-process-gone', handleRenderProcessGone)
  }

  private removeRecordsForOwner(ownerWebContentsId: number): void {
    for (const record of this.panes.values()) {
      if (record.ownerWebContentsId === ownerWebContentsId) {
        this.removeRecord(record)
        this.panes.delete(record.id)
      }
    }
  }

  private async ensureCdpServer(): Promise<void> {
    if (this.cdpServer && this.cdpPort !== null) {
      return
    }

    if (this.cdpServerStart) {
      await this.cdpServerStart

      return
    }

    const server = createServer((request, response) =>
      this.handleCdpHttp(request, response)
    )
    server.on('upgrade', (request, socket) =>
      this.handleCdpUpgrade(request, socket as Socket)
    )

    this.cdpServer = server

    const start = new Promise<void>((resolve, reject) => {
      const handleError = (error: Error): void => {
        server.off('listening', handleListening)
        if (this.cdpServer === server) {
          this.cdpServer = null
          this.cdpPort = null
        }
        reject(error)
      }

      const handleListening = (): void => {
        server.off('error', handleError)
        const address = server.address()
        if (!address || typeof address === 'string') {
          if (this.cdpServer === server) {
            this.cdpServer = null
            this.cdpPort = null
          }
          server.close()
          reject(new Error('failed to bind browser CDP proxy'))

          return
        }

        this.cdpPort = address.port
        resolve()
      }

      server.once('error', handleError)
      server.once('listening', handleListening)
      server.listen(0, '127.0.0.1')
    })

    this.cdpServerStart = start

    try {
      await start
    } finally {
      if (this.cdpServerStart === start) {
        this.cdpServerStart = null
      }
    }
  }

  private pageWebSocketUrl(record: BrowserPaneRecord): string {
    return `ws://127.0.0.1:${String(this.cdpPort)}/devtools/page/${encodeURIComponent(record.id)}?token=${record.cdpToken}`
  }

  private handleCdpHttp(
    request: IncomingMessage,
    response: ServerResponse
  ): void {
    const url = this.cdpRequestUrl(request)
    if (!url) {
      writeResponseError(response, 400, 'Bad Request')

      return
    }

    const authorizedRecord = this.authorizedRecord(url, request)
    if (!authorizedRecord) {
      writeResponseError(response, 401, 'Unauthorized')

      return
    }

    if (url.pathname === '/json/version') {
      const body: Record<string, string> = {
        Browser: 'Vimeflow Browser Pane',
        'Protocol-Version': '1.3',
        webSocketDebuggerUrl: this.pageWebSocketUrl(authorizedRecord),
      }

      writeJson(response, body)

      return
    }

    if (url.pathname === '/json/list') {
      writeJson(
        response,
        [authorizedRecord].map((record) => ({
          id: record.id,
          type: 'page',
          title: record.view.webContents.getTitle() || 'Vimeflow Browser Pane',
          url: record.view.webContents.getURL(),
          webSocketDebuggerUrl: this.pageWebSocketUrl(record),
        }))
      )

      return
    }

    writeResponseError(response, 404, 'Not Found')
  }

  private handleCdpUpgrade(request: IncomingMessage, socket: Socket): void {
    const url = this.cdpRequestUrl(request)
    if (!url) {
      writeHttpError(socket, 400, 'Bad Request')

      return
    }

    const authorizedRecord = this.authorizedRecord(url, request)
    if (!authorizedRecord) {
      writeHttpError(socket, 401, 'Unauthorized')

      return
    }

    const match = /^\/devtools\/page\/(.+)$/.exec(url.pathname)
    if (!match) {
      writeHttpError(socket, 404, 'Not Found')

      return
    }

    let targetId: string
    try {
      targetId = decodeURIComponent(match[1])
    } catch {
      writeHttpError(socket, 400, 'Bad Request')

      return
    }

    const record = this.panes.get(targetId)
    if (!record) {
      writeHttpError(socket, 404, 'Not Found')

      return
    }

    if (record.id !== authorizedRecord.id) {
      writeHttpError(socket, 403, 'Forbidden')

      return
    }

    const key = request.headers['sec-websocket-key']
    if (typeof key !== 'string') {
      writeHttpError(socket, 400, 'Bad Request')

      return
    }

    const accept = createHash('sha1')
      .update(`${key}${WS_GUID}`)
      .digest('base64')

    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '',
        '',
      ].join('\r\n')
    )

    this.attachDebuggerSocket(record, socket)
  }

  private cdpRequestUrl(request: IncomingMessage): URL | null {
    if (!request.url) {
      return null
    }

    try {
      return new URL(
        request.url,
        `http://${request.headers.host ?? '127.0.0.1'}`
      )
    } catch {
      return null
    }
  }

  private authorizedRecord(
    url: URL,
    request: IncomingMessage
  ): BrowserPaneRecord | null {
    const token = url.searchParams.get('token')
    const auth = request.headers.authorization
    const origin = request.headers.origin

    const originAllowed = origin === undefined || origin === BROWSER_CDP_ORIGIN
    if (!originAllowed) {
      return null
    }

    for (const record of this.panes.values()) {
      if (token === record.cdpToken || auth === `Bearer ${record.cdpToken}`) {
        return record
      }
    }

    return null
  }

  private attachDebuggerSocket(
    record: BrowserPaneRecord,
    socket: Socket
  ): void {
    this.cdpAttachments.get(record.id)?.close()

    const { debugger: debuggee } = record.view.webContents
    if (debuggee.isAttached()) {
      try {
        debuggee.detach()
      } catch {
        sendWebSocketClose(socket)

        return
      }
    }

    try {
      debuggee.attach('1.3')
    } catch {
      sendWebSocketClose(socket)

      return
    }

    const onDebuggerMessage = (
      _event: ElectronEvent,
      method: string,
      params: unknown,
      sessionId?: string
    ): void => {
      sendWebSocketText(socket, { method, params, sessionId })
    }

    debuggee.on('message', onDebuggerMessage)

    let pending = Buffer.alloc(0)

    const cleanup = (): void => {
      socket.off('data', handleData)
      socket.off('close', cleanup)
      socket.off('error', handleError)
      debuggee.off('message', onDebuggerMessage)

      if (this.cdpAttachments.get(record.id)?.socket !== socket) {
        return
      }

      this.cdpAttachments.delete(record.id)
      if (debuggee.isAttached()) {
        try {
          debuggee.detach()
        } catch {
          // The target may have closed before the socket cleanup ran.
        }
      }
    }

    const closeAttachment = (): void => {
      sendWebSocketClose(socket)
      cleanup()
    }

    const handleError = (): void => {
      socket.destroy()
      cleanup()
    }

    const handleData = (chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      pending = Buffer.concat([pending, buffer])

      try {
        let frame = decodeFrame(pending)
        while (frame) {
          pending = pending.subarray(frame.byteLength)
          this.handleDebuggerFrame(record.view.webContents, socket, frame)
          frame = decodeFrame(pending)
        }
      } catch {
        closeAttachment()
      }
    }

    this.cdpAttachments.set(record.id, {
      socket,
      close: closeAttachment,
    })

    socket.on('data', handleData)
    socket.on('close', cleanup)
    socket.on('error', handleError)
  }

  private handleDebuggerFrame(
    webContents: WebContents,
    socket: Socket,
    frame: DecodedFrame
  ): void {
    if (frame.opcode === 0x8) {
      sendWebSocketClose(socket)

      return
    }

    if (frame.opcode !== 0x1) {
      return
    }

    let command: unknown
    try {
      command = JSON.parse(frame.payload.toString('utf8'))
    } catch {
      return
    }

    if (!isCdpCommand(command) || command.id === undefined || !command.method) {
      return
    }

    void this.dispatchDebuggerCommand(webContents, socket, {
      id: command.id,
      method: command.method,
      params: command.params,
    })
  }

  private async dispatchDebuggerCommand(
    webContents: WebContents,
    socket: Socket,
    command: CdpCommand & { id: number; method: string }
  ): Promise<void> {
    if (command.method === 'Browser.getVersion') {
      sendWebSocketText(socket, {
        id: command.id,
        result: {
          protocolVersion: '1.3',
          product: 'Vimeflow Browser Pane',
          revision: 'vimeflow',
          userAgent: webContents.getUserAgent(),
          jsVersion: process.versions.v8,
        },
      })

      return
    }

    if (command.method === 'Page.navigate') {
      const url = cdpNavigationUrl(command.params?.url)
      if (!url) {
        sendWebSocketText(socket, {
          id: command.id,
          error: {
            code: -32602,
            message: 'Page.navigate url must be http or https',
          },
        })

        return
      }

      try {
        const result: unknown = await webContents.debugger.sendCommand(
          command.method,
          { ...command.params, url }
        )
        sendWebSocketText(socket, { id: command.id, result })
      } catch (error) {
        sendWebSocketText(socket, {
          id: command.id,
          error: {
            code: -32000,
            message: error instanceof Error ? error.message : String(error),
          },
        })
      }

      return
    }

    const domain = command.method.split('.')[0]
    if (!ALLOWED_CDP_DOMAINS.has(domain)) {
      sendWebSocketText(socket, {
        id: command.id,
        error: {
          code: -32601,
          message: `CDP domain ${domain} is not allowed`,
        },
      })

      return
    }

    try {
      const result: unknown = await webContents.debugger.sendCommand(
        command.method,
        command.params ?? {}
      )
      sendWebSocketText(socket, { id: command.id, result })
    } catch (error) {
      sendWebSocketText(socket, {
        id: command.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }
}

export const setupBrowserPaneIpc = (): BrowserPaneController => {
  const controller = new BrowserPaneController()
  controller.install()

  return controller
}
