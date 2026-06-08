import {
  BrowserWindow,
  WebContentsView,
  ipcMain,
  session as electronSession,
  shell,
  type Event as ElectronEvent,
  type IpcMainInvokeEvent,
  type Session as ElectronSession,
  type WebContents,
} from 'electron'
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import {
  createServer,
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { LookupFunction, Socket } from 'node:net'
import {
  BROWSER_PANE_ACTIVATE_TAB,
  BROWSER_PANE_CDP_INFO,
  BROWSER_PANE_CLOSE_TAB,
  BROWSER_PANE_CREATE,
  BROWSER_PANE_DESTROY,
  BROWSER_PANE_FOCUS,
  BROWSER_PANE_FOCUSED,
  BROWSER_PANE_FOCUS_ADDRESS,
  BROWSER_PANE_NAVIGATE,
  BROWSER_PANE_NAV_ACTION,
  BROWSER_PANE_NAV_STATE_CHANGED,
  BROWSER_PANE_NEW_TAB,
  BROWSER_PANE_OPEN_EXTERNAL,
  BROWSER_PANE_SET_BOUNDS,
  BROWSER_PANE_TABS_CHANGED,
  BROWSER_PANE_URL_CHANGED,
} from './browser-pane-channels'
import {
  commandPaletteToggleDispatcherForWindow,
  isCommandPaletteShortcutInput,
} from './command-palette-shortcut'
import type {
  PersistedTab,
  WorkspaceLayoutWriteSignals,
} from './workspace-layout-types'

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
  // Optional under restore: main loads each tab via navigationHistory instead.
  initialUrl?: string
  restore?: boolean
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

interface BrowserPaneNewTabRequest {
  sessionId: string
  paneId: string
  url?: string
}

interface BrowserPaneDestroyRequest {
  sessionId: string
  paneId: string
}

interface BrowserPaneTabRequest extends BrowserPaneDestroyRequest {
  tabId: string
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
  tabs: BrowserPaneTabSnapshot[]
  navState: { canGoBack: boolean; canGoForward: boolean; isLoading: boolean }
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
  tabs: Map<string, BrowserPaneTabRecord>
  activeTabId: string
  nextTabIndex: number
  lastBounds: BrowserPaneBounds
  visible: boolean
  popupWindows: Set<BrowserWindow>
  windowClosedHandler: () => void
  shortcutContext: BrowserPaneShortcutContext | null
}

interface BrowserPaneTabRecord {
  id: string
  view: WebContentsView
  requestedUrl: string
  favicon: string | null
}

interface BrowserPaneTabSnapshot {
  id: string
  url: string
  title: string | null
  active: boolean
  favicon: string | null
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
// Keep in sync with src/features/browser/types.ts DEFAULT_BROWSER_URL (main/renderer project boundary prevents sharing a module).
const DEFAULT_BROWSER_URL = 'https://www.google.com/'
const MAX_TABS_PER_PANE = 20
const FAVICON_BYTE_CAP = 32 * 1024 // max decoded favicon bytes
const MAX_FAVICON_URL = 64 * 1024 // max favicon data: URL length
const MAX_FAVICON_CANDIDATES = 4
const FAVICON_FETCH_TIMEOUT_MS = 5000
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

const tokensMatch = (a: string, b: string): boolean => {
  // Compare encoded BYTE lengths (not JS string lengths): a non-ASCII value of
  // equal string length would yield differently-sized buffers and make
  // timingSafeEqual throw, crashing the handler on an unauthenticated request.
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)

  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

const isString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString)

const paneKey = (sessionId: string, paneId: string): string =>
  `${sessionId}:${paneId}`

const sanitizePartitionSegment = (value: string): string => {
  const safe = value.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 96)
  if (safe === value) {
    return safe
  }

  const digest = createHash('sha256')
    .update(value)
    .digest('base64url')
    .slice(0, 16)

  return `${safe.slice(0, 79)}-${digest}`
}

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

const normalizeTabUrl = (value: string): string =>
  value === 'about:blank' ? value : normalizeUrl(value)

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
  (value.restore === true || isString(value.initialUrl))

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

const isNewTabRequest = (value: unknown): value is BrowserPaneNewTabRequest =>
  isRecord(value) &&
  isString(value.sessionId) &&
  isString(value.paneId) &&
  (value.url === undefined || isString(value.url))

const isDestroyRequest = (value: unknown): value is BrowserPaneDestroyRequest =>
  isRecord(value) && isString(value.sessionId) && isString(value.paneId)

const isTabRequest = (value: unknown): value is BrowserPaneTabRequest =>
  isRecord(value) &&
  isString(value.sessionId) &&
  isString(value.paneId) &&
  isString(value.tabId)

const isNavActionRequest = (
  value: unknown
): value is { sessionId: string; paneId: string; action: string } =>
  isRecord(value) &&
  isString(value.sessionId) &&
  isString(value.paneId) &&
  isString(value.action)

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

export const isFocusAddressShortcut = (
  input: BrowserPaneShortcutInput,
  platform: NodeJS.Platform = process.platform
): boolean =>
  input.code === 'KeyL' &&
  !input.alt &&
  input.shift !== true &&
  !input.isAutoRepeat &&
  hasPlatformShortcutModifier(input, platform)

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

const sendWebSocketClose = (socket: Socket, code?: number): void => {
  try {
    if (!socket.destroyed && socket.writable) {
      if (code !== undefined) {
        const body = Buffer.allocUnsafe(2)
        body.writeUInt16BE(code, 0)
        socket.write(Buffer.concat([Buffer.from([0x88, 0x02]), body]))
      } else {
        socket.write(Buffer.from([0x88, 0x00]))
      }
    }
  } catch {
    // The socket may already be half-closed/reset by the client.
  }
  socket.destroy()
}

interface DecodedFrame {
  fin: boolean
  opcode: number
  masked: boolean
  payload: Buffer
  byteLength: number
}

const decodeFrame = (buffer: Buffer): DecodedFrame | null => {
  if (buffer.length < 2) {
    return null
  }

  const fin = (buffer[0] & 0x80) !== 0
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

  // Cap frame payloads (CDP messages are KBs) to prevent an unbounded pending buffer.
  if (payloadLength > 16 * 1024 * 1024) {
    throw new Error('websocket frame too large')
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

  return { fin, opcode, masked, payload, byteLength: frameLength }
}

const faviconKey = (candidates: string[]): string =>
  createHash('sha1').update(candidates.join('\n')).digest('hex')

const isImageDataUrl = (url: string): boolean =>
  /^data:image\/[a-z0-9.+-]+;base64,/i.test(url)

interface FaviconFetchTarget {
  url: URL
  address: string
  family: 4 | 6
  private: boolean
}

// Parse an IPv6 literal (with `::` compression and/or an embedded IPv4 tail) to its 16 bytes.
const parseIpv6 = (input: string): number[] | null => {
  const halves = input.split('%')[0].split('::')
  if (halves.length > 2) {
    return null
  }

  const toGroups = (part: string): number[] | null => {
    if (part === '') {
      return []
    }
    const tokens = part.split(':')
    const out: number[] = []
    for (let i = 0; i < tokens.length; i += 1) {
      const tok = tokens[i]
      if (tok.includes('.')) {
        const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(tok)
        if (i !== tokens.length - 1 || !v4) {
          return null
        }
        const q = v4.slice(1).map(Number)
        if (q.some((n) => n > 255)) {
          return null
        }
        out.push((q[0] << 8) | q[1], (q[2] << 8) | q[3])
      } else if (/^[0-9a-f]{1,4}$/.test(tok)) {
        out.push(Number.parseInt(tok, 16))
      } else {
        return null
      }
    }

    return out
  }
  const head = toGroups(halves[0])
  const tail = halves.length === 2 ? toGroups(halves[1]) : []
  if (head === null || tail === null) {
    return null
  }
  let groups: number[]
  if (halves.length === 2) {
    const gap = 8 - head.length - tail.length
    if (gap < 1) {
      return null
    }
    groups = [...head, ...Array.from({ length: gap }, () => 0), ...tail]
  } else {
    groups = head
  }
  if (groups.length !== 8) {
    return null
  }

  return groups.flatMap((g) => [(g >> 8) & 0xff, g & 0xff])
}

const isPrivateIpv4 = ([a, b]: number[]): boolean => {
  if (a === 0 || a === 127 || a === 10) {
    return true
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true
  }
  if (a === 192 && b === 168) {
    return true
  }

  return a === 169 && b === 254
}

const isPrivateIpv6 = (b: number[]): boolean => {
  if (b.every((x) => x === 0)) {
    return true // unspecified ::
  }
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d, incl. ::1) — classify the embedded v4.
  const headZero = b.slice(0, 10).every((x) => x === 0)
  if (headZero && b[10] === 0xff && b[11] === 0xff) {
    return isPrivateIpv4([b[12], b[13], b[14], b[15]])
  }
  if (headZero && b[10] === 0 && b[11] === 0) {
    return isPrivateIpv4([b[12], b[13], b[14], b[15]])
  }
  if ((b[0] & 0xfe) === 0xfc) {
    return true // ULA fc00::/7
  }

  return b[0] === 0xfe && (b[1] & 0xc0) === 0x80 // link-local fe80::/10
}

const normalizedHost = (hostname: string): string =>
  hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')

const addressFamily = (hostname: string): 4 | 6 | null => {
  const h = normalizedHost(hostname)
  if (h.includes(':')) {
    return parseIpv6(h) === null ? null : 6
  }
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h)
  if (!m) {
    return null
  }
  const octets = m.slice(1).map(Number)
  if (octets.some((n) => n > 255)) {
    return null
  }

  return 4
}

const isIpLiteralHost = (hostname: string): boolean =>
  addressFamily(hostname) !== null

const isPrivateHost = (hostname: string): boolean => {
  const h = normalizedHost(hostname)
  if (h === 'localhost' || h.endsWith('.localhost')) {
    return true
  }
  if (h.includes(':')) {
    const bytes = parseIpv6(h)

    return bytes !== null && isPrivateIpv6(bytes)
  }
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h)
  if (!m) {
    return false
  }
  const octets = m.slice(1).map(Number)
  if (octets.some((n) => n > 255)) {
    return false
  }

  return isPrivateIpv4(octets)
}

const literalFaviconTarget = (url: URL): FaviconFetchTarget | null => {
  if (!isIpLiteralHost(url.hostname)) {
    return null
  }
  const family = addressFamily(url.hostname)
  if (family === null) {
    return null
  }

  return {
    url,
    address: normalizedHost(url.hostname),
    family,
    private: isPrivateHost(url.hostname),
  }
}

const resolveHostForFaviconFetch = async (
  url: URL
): Promise<FaviconFetchTarget | null> => {
  const literal = literalFaviconTarget(url)
  if (literal !== null) {
    return literal
  }

  let addresses: { address: string; family: number }[]
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true })
  } catch {
    return null
  }

  const hostIsPrivate = isPrivateHost(url.hostname)

  const targets = addresses
    .map((entry): FaviconFetchTarget | null => {
      const family = entry.family === 4 ? 4 : entry.family === 6 ? 6 : null
      if (family === null) {
        return null
      }

      return {
        url,
        address: entry.address,
        family,
        private: hostIsPrivate || isPrivateHost(entry.address),
      }
    })
    .filter((target): target is FaviconFetchTarget => target !== null)

  if (targets.length === 0) {
    return null
  }

  return targets.find((target) => target.private) ?? targets[0]
}

// PNA: a private favicon target is allowed only when the page is itself private.
const resolveFaviconFetchTarget = async (
  pageUrl: string,
  faviconUrl: URL
): Promise<FaviconFetchTarget | null> => {
  const target = await resolveHostForFaviconFetch(faviconUrl)
  if (target === null) {
    return null
  }
  if (!target.private) {
    return target
  }

  try {
    return isPrivateHost(new URL(pageUrl).hostname) ? target : null
  } catch {
    return null
  }
}

const headerString = (
  headers: IncomingMessage['headers'],
  name: string
): string | null => {
  const value = headers[name.toLowerCase()]
  if (Array.isArray(value)) {
    return value[0] ?? null
  }

  return typeof value === 'string' ? value : null
}

const subtypeFromContentType = (contentType: string): string => {
  const subtype = contentType.split(';')[0]?.split('/')[1]?.trim() ?? ''

  return /^[a-z0-9.+-]+$/i.test(subtype) ? subtype : 'png'
}

const toDataImage = (contentType: string, body: Buffer): string =>
  `data:image/${subtypeFromContentType(contentType)};base64,${body.toString(
    'base64'
  )}`

const fetchFaviconViaVettedAddress = (
  target: FaviconFetchTarget,
  signal: AbortSignal
): Promise<{ contentType: string; body: Buffer } | null> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve(null)

      return
    }

    let settled = false
    let request: ClientRequest | null = null

    const requestFn =
      target.url.protocol === 'https:' ? httpsRequest : httpRequest

    function cleanup(): void {
      signal.removeEventListener('abort', abort)
    }

    function settle(
      result: { contentType: string; body: Buffer } | null
    ): void {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve(result)
    }

    function abort(): void {
      request?.destroy()
      settle(null)
    }

    const pinnedLookup: LookupFunction = (_hostname, _options, callback) => {
      callback(null, target.address, target.family)
    }

    request = requestFn(
      {
        protocol: target.url.protocol,
        hostname: normalizedHost(target.url.hostname),
        port: target.url.port,
        path: `${target.url.pathname}${target.url.search}`,
        method: 'GET',
        headers: {
          accept: 'image/*',
          host: target.url.host,
        },
        lookup: pinnedLookup,
        timeout: FAVICON_FETCH_TIMEOUT_MS,
      },
      (response) => {
        const status = response.statusCode ?? 0
        const contentType = headerString(response.headers, 'content-type') ?? ''
        const declaredLength = headerString(response.headers, 'content-length')

        if (
          status < 200 ||
          status >= 300 ||
          !/^image\//i.test(contentType) ||
          (declaredLength !== null && Number(declaredLength) > FAVICON_BYTE_CAP)
        ) {
          response.resume()
          settle(null)

          return
        }

        const chunks: Buffer[] = []
        let total = 0
        response.on('data', (chunk: Buffer | string) => {
          if (settled) {
            return
          }
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          total += buf.byteLength
          if (total > FAVICON_BYTE_CAP) {
            request?.destroy()
            settle(null)

            return
          }
          chunks.push(buf)
        })

        response.on('end', () => {
          if (total === 0) {
            settle(null)

            return
          }
          settle({ contentType, body: Buffer.concat(chunks) })
        })
        response.on('error', () => settle(null))
      }
    )

    signal.addEventListener('abort', abort, { once: true })
    request.on('timeout', () => {
      request.destroy()
      settle(null)
    })
    request.on('error', () => settle(null))
    request.end()
  })

const isAllowedFaviconProtocol = (protocol: string): boolean =>
  protocol === 'http:' || protocol === 'https:'

const resolveFaviconHttpDataUrl = async (
  pageUrl: string,
  faviconUrl: URL,
  signal: AbortSignal
): Promise<string | null> => {
  if (
    !isAllowedFaviconProtocol(faviconUrl.protocol) ||
    faviconUrl.username !== '' ||
    faviconUrl.password !== ''
  ) {
    return null
  }

  const target = await resolveFaviconFetchTarget(pageUrl, faviconUrl)
  if (target === null) {
    return null
  }

  const fetched = await fetchFaviconViaVettedAddress(target, signal)
  if (fetched === null) {
    return null
  }

  return toDataImage(fetched.contentType, fetched.body)
}

const resolveFaviconDataUrl = async (
  pageUrl: string,
  url: string,
  resolutionSignal: AbortSignal
): Promise<string | null> => {
  if (url.startsWith('data:')) {
    if (!isImageDataUrl(url) || url.length > MAX_FAVICON_URL) {
      return null
    }
    const payload = url.slice(url.indexOf(',') + 1)
    if (payload.length === 0) {
      return null
    }
    const bytes = Buffer.from(payload, 'base64')
    if (bytes.length === 0 || bytes.length > FAVICON_BYTE_CAP) {
      return null
    }

    return url
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  const signal = AbortSignal.any([
    resolutionSignal,
    AbortSignal.timeout(FAVICON_FETCH_TIMEOUT_MS),
  ])

  return resolveFaviconHttpDataUrl(pageUrl, parsed, signal)
}

const clampedHistoryIndex = (
  historyLength: number,
  activeIndex: number
): number => {
  if (historyLength === 0) {
    return 0
  }

  return Math.max(0, Math.min(activeIndex, historyLength - 1))
}

export class BrowserPaneController {
  private readonly panes = new Map<string, BrowserPaneRecord>()

  private writeSignals: WorkspaceLayoutWriteSignals | null = null

  private restoreTabsProvider:
    | ((sessionId: string, paneId: string) => PersistedTab[] | null)
    | null = null

  private readonly cdpAttachments = new Map<string, CdpAttachment>()

  private readonly partitionHandlers = new Set<string>()

  private readonly webAuthnHandlers = new Map<
    string,
    (
      event: ElectronEvent,
      details: { accounts: { credentialId: string }[] },
      callback: (credentialId: string | null) => void
    ) => void
  >()

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

    ipcMain.handle(BROWSER_PANE_NEW_TAB, (_event, payload) =>
      this.newTab(payload)
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

    ipcMain.handle(BROWSER_PANE_ACTIVATE_TAB, (_event, payload) =>
      this.activateTab(payload)
    )

    ipcMain.handle(BROWSER_PANE_CLOSE_TAB, (_event, payload) =>
      this.closeTab(payload)
    )

    ipcMain.handle(BROWSER_PANE_OPEN_EXTERNAL, (_event, payload) =>
      this.openExternal(payload)
    )

    ipcMain.handle(BROWSER_PANE_NAV_ACTION, (_event, payload) =>
      this.handleNavAction(payload)
    )
  }

  // Connect the workspace-layout writer so tab lifecycle + navigation persist.
  setWriteSignals(signals: WorkspaceLayoutWriteSignals): void {
    this.writeSignals = signals
  }

  // Connect the loaded-store tab source so restore replays per-tab history.
  setRestoreTabsProvider(
    provider: (sessionId: string, paneId: string) => PersistedTab[] | null
  ): void {
    this.restoreTabsProvider = provider
  }

  dispose(): void {
    ipcMain.removeHandler(BROWSER_PANE_CREATE)
    ipcMain.removeHandler(BROWSER_PANE_SET_BOUNDS)
    ipcMain.removeHandler(BROWSER_PANE_NAVIGATE)
    ipcMain.removeHandler(BROWSER_PANE_NEW_TAB)
    ipcMain.removeHandler(BROWSER_PANE_DESTROY)
    ipcMain.removeHandler(BROWSER_PANE_FOCUS)
    ipcMain.removeHandler(BROWSER_PANE_CDP_INFO)
    ipcMain.removeHandler(BROWSER_PANE_ACTIVATE_TAB)
    ipcMain.removeHandler(BROWSER_PANE_CLOSE_TAB)
    ipcMain.removeHandler(BROWSER_PANE_OPEN_EXTERNAL)
    ipcMain.removeHandler(BROWSER_PANE_NAV_ACTION)

    for (const record of this.panes.values()) {
      this.removeRecord(record)
    }
    this.panes.clear()
    this.cdpAttachments.clear()
    this.rendererLifecycleHandlers.clear()
    for (const [partition, handler] of this.webAuthnHandlers) {
      electronSession
        .fromPartition(partition)
        .off('select-webauthn-account', handler)
    }
    this.webAuthnHandlers.clear()
    this.partitionHandlers.clear()
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
      // A renderer reload hands us a new sender id; refresh the owner and its
      // lifecycle cleanup so a later crash can still reclaim this pane.
      existing.ownerWebContentsId = event.sender.id
      this.installRendererLifecycleCleanup(event.sender)

      const activeTab = this.activeTab(existing)

      return {
        url: activeTab
          ? this.tabUrl(activeTab)
          : normalizeUrl(payload.initialUrl ?? DEFAULT_BROWSER_URL),
        title: this.activeWebContents(existing)?.getTitle() ?? null,
        partition: existing.partition,
        tabs: this.tabSnapshots(existing),
        navState: activeTab
          ? this.readNavState(activeTab.view.webContents)
          : { canGoBack: false, canGoForward: false, isLoading: false },
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

    const initialUrl = normalizeUrl(payload.initialUrl ?? DEFAULT_BROWSER_URL)

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
      tabs: new Map([
        [
          'tab-0',
          { id: 'tab-0', view, requestedUrl: initialUrl, favicon: null },
        ],
      ]),
      activeTabId: 'tab-0',
      nextTabIndex: 1,
      lastBounds: { x: 0, y: 0, width: 0, height: 0 },
      visible: false,
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
      record.tabs.delete('tab-0')
      // Pane teardown: the last tab is gone — drop the record and do NOT emit a
      // tabs-changed with an empty list (it would collapse the renderer's chrome).
      // The first clause covers the async case where removeRecord/removePane has
      // already cleared the record and deleted the entry before Chromium delivers
      // this `destroyed` notification — `panes.get(key) === record` would be
      // false there, so without `!this.panes.has(key)` the handler would fall
      // through and emit a spurious empty tabs-changed after explicit teardown.
      if (
        !this.panes.has(key) ||
        (this.panes.get(key) === record && record.tabs.size === 0)
      ) {
        this.panes.delete(key)

        return
      }

      if (record.activeTabId === 'tab-0') {
        record.activeTabId = record.tabs.keys().next().value ?? 'tab-0'
        this.applyRecordBounds(record)
      }
      this.emitTabsChanged(record)
      this.emitPaneNavStateChanged(record, record.activeTabId)
    })

    view.webContents.on('focus', () => {
      // Send via the window's (current) webContents, not the creation-time
      // event.sender, so focus still reaches the renderer after a reload that
      // adopted a new sender on the reconnect path.
      if (win.webContents.isDestroyed()) {
        return
      }

      win.webContents.send(BROWSER_PANE_FOCUSED, {
        sessionId: payload.sessionId,
        paneId: payload.paneId,
      })
    })

    this.installFaviconEmitter(record, view, 'tab-0')

    const emitUrlChanged = (): void => {
      this.emitPaneUrlChanged(record, 'tab-0')
    }
    view.webContents.on('did-navigate', emitUrlChanged)
    view.webContents.on('did-navigate-in-page', emitUrlChanged)
    view.webContents.on('page-title-updated', emitUrlChanged)
    this.installNavStateEmitters(record, view, 'tab-0')

    win.once('closed', record.windowClosedHandler)

    await this.ensureCdpServer()

    const restoreTabs =
      payload.restore === true
        ? (this.restoreTabsProvider?.(payload.sessionId, payload.paneId) ??
          null)
        : null

    if (restoreTabs && restoreTabs.length > 0) {
      this.restoreTabHistory(record, 'tab-0', restoreTabs[0])
      for (let i = 1; i < restoreTabs.length; i += 1) {
        this.createOwnedTab(record, win, ses, {
          url: DEFAULT_BROWSER_URL,
          activate: false,
          restore: restoreTabs[i],
        })
      }

      const activeIndex = restoreTabs.findIndex((tab) => tab.active)
      if (activeIndex > 0) {
        this.setActiveTab(record, `tab-${activeIndex.toString()}`, true)
      }
    } else {
      void loadBrowserUrl(view.webContents, initialUrl)
    }

    const activeTab = this.activeTab(record)

    return {
      url: activeTab ? this.tabUrl(activeTab) : initialUrl,
      title: this.activeWebContents(record)?.getTitle() ?? null,
      partition,
      tabs: this.tabSnapshots(record),
      navState: activeTab
        ? this.readNavState(activeTab.view.webContents)
        : { canGoBack: false, canGoForward: false, isLoading: false },
    }
  }

  private activeTab(record: BrowserPaneRecord): BrowserPaneTabRecord | null {
    return (
      record.tabs.get(record.activeTabId) ??
      record.tabs.values().next().value ??
      null
    )
  }

  private activeWebContents(record: BrowserPaneRecord): WebContents | null {
    return this.activeTab(record)?.view.webContents ?? null
  }

  private tabUrl(tab: BrowserPaneTabRecord): string {
    const u = tab.view.webContents.getURL()

    return u.length > 0 ? u : tab.requestedUrl
  }

  private tabSnapshots(record: BrowserPaneRecord): BrowserPaneTabSnapshot[] {
    return [...record.tabs.values()].map((tab) => ({
      id: tab.id,
      url: this.tabUrl(tab),
      title: tab.view.webContents.getTitle() || null,
      active: tab.id === record.activeTabId,
      favicon: tab.favicon,
    }))
  }

  // Durable per-tab nav history for a pane, read fresh from navigationHistory;
  // feeds the workspace-layout assembler (the tabs-changed event stays history-free).
  captureTabsForPane(sessionId: string, paneId: string): PersistedTab[] | null {
    const record = this.panes.get(paneKey(sessionId, paneId))
    if (!record) {
      return null
    }

    return [...record.tabs.values()].map((tab) => {
      const nav = tab.view.webContents.navigationHistory

      const history = nav.getAllEntries().map((entry) => ({
        url: entry.url,
        title: entry.title,
      }))

      return {
        active: tab.id === record.activeTabId,
        history,
        historyIndex: clampedHistoryIndex(history.length, nav.getActiveIndex()),
      }
    })
  }

  private emitTabsChanged(
    record: BrowserPaneRecord,
    tabs?: BrowserPaneTabSnapshot[]
  ): void {
    const win = BrowserWindow.fromId(record.windowId)
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
      return
    }

    win.webContents.send(BROWSER_PANE_TABS_CHANGED, {
      sessionId: record.sessionId,
      paneId: record.paneId,
      tabs: tabs ?? this.tabSnapshots(record),
    })
  }

  private readNavState(wc: WebContents): {
    canGoBack: boolean
    canGoForward: boolean
    isLoading: boolean
  } {
    return {
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      isLoading: wc.isLoading(),
    }
  }

  private emitPaneNavStateChanged(
    record: BrowserPaneRecord,
    tabId: string
  ): void {
    if (record.activeTabId !== tabId) {
      return
    }

    const tab = record.tabs.get(tabId)
    const win = BrowserWindow.fromId(record.windowId)
    if (!tab || !win || win.isDestroyed() || win.webContents.isDestroyed()) {
      return
    }

    win.webContents.send(BROWSER_PANE_NAV_STATE_CHANGED, {
      sessionId: record.sessionId,
      paneId: record.paneId,
      tabId,
      ...this.readNavState(tab.view.webContents),
    })
  }

  private installNavStateEmitters(
    record: BrowserPaneRecord,
    view: WebContentsView,
    tabId: string
  ): void {
    const emit = (): void => this.emitPaneNavStateChanged(record, tabId)
    view.webContents.on('did-navigate', emit)
    view.webContents.on('did-navigate-in-page', emit)
    view.webContents.on('did-start-loading', emit)
    view.webContents.on('did-stop-loading', emit)
  }

  private installFaviconEmitter(
    record: BrowserPaneRecord,
    view: WebContentsView,
    tabId: string
  ): void {
    let gen = 0
    let controller: AbortController | null = null
    let pendingKey: string | null = null
    let resolvedKey: string | null = null

    view.webContents.on('page-favicon-updated', (_event, favicons) => {
      const candidates = favicons
        .filter((u) => u.length <= MAX_FAVICON_URL)
        .slice(0, MAX_FAVICON_CANDIDATES)
      const key = faviconKey(candidates)
      if (key === resolvedKey || key === pendingKey) {
        return
      }
      controller?.abort()
      const myController = new AbortController()
      controller = myController
      pendingKey = key
      gen += 1
      const myGen = gen
      void (async (): Promise<void> => {
        const pageUrl = view.webContents.getURL()
        let dataUrl: string | null = null
        for (const url of candidates) {
          if (myController.signal.aborted) {
            break
          }
          dataUrl = await resolveFaviconDataUrl(
            pageUrl,
            url,
            myController.signal
          )
          if (dataUrl !== null) {
            break
          }
        }
        const tab = record.tabs.get(tabId)
        if (!tab || myGen !== gen) {
          return
        }
        tab.favicon = dataUrl
        resolvedKey = dataUrl ? key : null
        pendingKey = null
        if (controller === myController) {
          controller = null
        }
        this.emitTabsChanged(record)
      })()
    })

    view.webContents.on('did-navigate', () => {
      controller?.abort()
      controller = null
      gen += 1
      pendingKey = null
      resolvedKey = null
      const tab = record.tabs.get(tabId)
      if (tab) {
        tab.favicon = null
      }
    })
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
    webContents.setWindowOpenHandler(({ url, disposition }) => {
      if (!isAllowedPopupUrl(url)) {
        return { action: 'deny' }
      }

      this.createOwnedTab(record, win, ses, {
        url,
        activate: disposition !== 'background-tab',
      })

      return { action: 'deny' }
    })
  }

  // Replay a persisted tab's nav history onto its view (restore-before-load):
  // navigationHistory.restore navigates to the active entry, so it must run
  // instead of loadURL. Empty history falls back to a default load.
  private restoreTabHistory(
    record: BrowserPaneRecord,
    tabId: string,
    persisted: PersistedTab
  ): void {
    const tab = record.tabs.get(tabId)
    if (!tab) {
      return
    }

    const entries = persisted.history.map((entry) => ({
      url: entry.url,
      title: entry.title ?? '',
    }))
    if (entries.length === 0) {
      tab.requestedUrl = DEFAULT_BROWSER_URL
      void loadBrowserUrl(tab.view.webContents, DEFAULT_BROWSER_URL)

      return
    }

    const index = Math.max(
      0,
      Math.min(persisted.historyIndex, entries.length - 1)
    )
    tab.requestedUrl = entries[index].url
    void tab.view.webContents.navigationHistory.restore({ index, entries })
  }

  private createOwnedTab(
    record: BrowserPaneRecord,
    win: BrowserWindow,
    ses: ElectronSession,
    options: { url: string; activate: boolean; restore?: PersistedTab }
  ): void {
    if (record.tabs.size >= MAX_TABS_PER_PANE) {
      return
    }

    if (win.isDestroyed()) {
      return
    }

    const tabId = `tab-${record.nextTabIndex.toString()}`
    record.nextTabIndex += 1

    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    })

    record.tabs.set(tabId, {
      id: tabId,
      view,
      requestedUrl: normalizeTabUrl(options.url),
      favicon: null,
    })
    win.contentView.addChildView(view)
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    view.webContents.setAudioMuted(false)
    this.installNavigationPolicy(view.webContents)
    this.installPopupPolicy(view.webContents, win, ses, record)
    this.installAppShortcutForwarding(record, view.webContents)

    this.installFaviconEmitter(record, view, tabId)

    const emitUrlChanged = (): void => {
      this.emitPaneUrlChanged(record, tabId)
    }
    view.webContents.on('did-navigate', emitUrlChanged)
    view.webContents.on('did-navigate-in-page', emitUrlChanged)
    view.webContents.on('page-title-updated', emitUrlChanged)
    this.installNavStateEmitters(record, view, tabId)
    view.webContents.on('focus', () => {
      if (win.webContents.isDestroyed()) {
        return
      }

      win.webContents.send(BROWSER_PANE_FOCUSED, {
        sessionId: record.sessionId,
        paneId: record.paneId,
      })
    })

    view.webContents.on('destroyed', () => {
      // closeTab removes the tab from the map before close() and owns the emit;
      // if it is already gone, stay silent to avoid a duplicate tabs-changed.
      if (!record.tabs.has(tabId)) {
        return
      }

      record.tabs.delete(tabId)
      // Pane teardown: last tab gone — do not emit an empty tabs-changed.
      if (record.tabs.size === 0) {
        return
      }

      if (record.activeTabId === tabId) {
        record.activeTabId = record.tabs.keys().next().value ?? 'tab-0'
        this.applyRecordBounds(record)
      }
      this.emitTabsChanged(record)
      this.emitPaneNavStateChanged(record, record.activeTabId)
    })

    if (options.restore) {
      this.restoreTabHistory(record, tabId, options.restore)
    } else {
      void loadBrowserUrl(view.webContents, normalizeTabUrl(options.url))
    }

    if (options.activate) {
      this.setActiveTab(record, tabId, true)
    } else {
      this.emitTabsChanged(record)
    }
  }

  private emitPaneUrlChanged(record: BrowserPaneRecord, tabId: string): void {
    const tab = record.tabs.get(tabId)
    const win = BrowserWindow.fromId(record.windowId)
    if (!tab || !win || win.isDestroyed() || win.webContents.isDestroyed()) {
      return
    }

    this.writeSignals?.markVolatile()

    const tabs = this.tabSnapshots(record)
    this.emitTabsChanged(record, tabs)
    if (record.activeTabId !== tabId) {
      return
    }

    win.webContents.send(BROWSER_PANE_URL_CHANGED, {
      sessionId: record.sessionId,
      paneId: record.paneId,
      tabId,
      url: this.tabUrl(tab),
      title: tab.view.webContents.getTitle() || null,
      tabs,
    })
  }

  private installAppShortcutForwarding(
    record: BrowserPaneRecord,
    webContents: WebContents = record.view.webContents
  ): void {
    const dispatchCommandPaletteToggle = (): void => {
      const win = BrowserWindow.fromId(record.windowId)
      if (!win || win.isDestroyed()) {
        return
      }

      win.webContents.focus()
      commandPaletteToggleDispatcherForWindow(win)()
    }

    webContents.on('before-input-event', (event, input) => {
      if (isFocusAddressShortcut(input)) {
        event.preventDefault()
        const win = BrowserWindow.fromId(record.windowId)
        if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.focus()
          win.webContents.send(BROWSER_PANE_FOCUS_ADDRESS, {
            sessionId: record.sessionId,
            paneId: record.paneId,
          })
        }

        return
      }

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
        !this.activeWebContents(record)?.isDestroyed()
      ) {
        this.activeWebContents(record)?.focus()
      }
    } catch {
      // The app renderer may be navigating or shutting down.
    }
  }

  private setActiveTab(
    record: BrowserPaneRecord,
    tabId: string,
    focus: boolean
  ): void {
    if (!record.tabs.has(tabId)) {
      return
    }

    if (record.activeTabId !== tabId) {
      this.cdpAttachments.get(record.id)?.close()
    }
    record.activeTabId = tabId
    this.applyRecordBounds(record)

    // emitPaneUrlChanged (below) emits tabs-changed first, so do not emit it
    // here too — a direct call double-fires TABS_CHANGED per activation.
    const active = this.activeTab(record)
    if (focus) {
      active?.view.webContents.focus()
    }
    if (active) {
      this.emitPaneUrlChanged(record, active.id)
    }
    this.emitPaneNavStateChanged(record, tabId)
  }

  private applyRecordBounds(record: BrowserPaneRecord): void {
    const active = this.activeTab(record)
    for (const tab of record.tabs.values()) {
      tab.view.setBounds(
        tab === active
          ? visibleBounds(record.lastBounds, record.visible)
          : { x: 0, y: 0, width: 0, height: 0 }
      )
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
    record.lastBounds = payload.bounds
    record.visible = payload.visible
    this.applyRecordBounds(record)
  }

  private async navigate(payload: unknown): Promise<void> {
    if (!isNavigateRequest(payload)) {
      throw new Error('invalid browser pane navigate payload')
    }

    const record = this.panes.get(paneKey(payload.sessionId, payload.paneId))
    if (!record) {
      return
    }

    const activeTab = this.activeTab(record)
    if (!activeTab) {
      return
    }

    const url = normalizeUrl(payload.url)
    activeTab.requestedUrl = url
    await loadBrowserUrl(activeTab.view.webContents, url)
  }

  private newTab(payload: unknown): void {
    if (!isNewTabRequest(payload)) {
      throw new Error('invalid browser pane new tab payload')
    }

    const record = this.panes.get(paneKey(payload.sessionId, payload.paneId))
    if (!record) {
      return
    }

    const win = BrowserWindow.fromId(record.windowId)
    if (!win || win.isDestroyed()) {
      return
    }

    const ses = electronSession.fromPartition(record.partition, { cache: true })
    this.createOwnedTab(record, win, ses, {
      url: payload.url ?? DEFAULT_BROWSER_URL,
      activate: true,
    })
    this.writeSignals?.markStructural()
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
    // Validate with the neutral pane-ref shape ({ sessionId, paneId }) rather
    // than the destroy-request validator — focus is not a teardown, and reusing
    // isDestroyRequest would silently reject valid focus payloads if the
    // destroy type ever grows a required field.
    if (!isCdpInfoRequest(payload)) {
      throw new Error('invalid browser pane focus payload')
    }

    const record = this.panes.get(paneKey(payload.sessionId, payload.paneId))
    if (!record) {
      return
    }

    this.activeWebContents(record)?.focus()
  }

  private openExternal(payload: unknown): void {
    if (!isCdpInfoRequest(payload)) {
      throw new Error('invalid browser pane open-external payload')
    }

    const record = this.panes.get(paneKey(payload.sessionId, payload.paneId))
    if (!record) {
      return
    }

    const url = this.activeWebContents(record)?.getURL() ?? ''
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url)
    }
  }

  private handleNavAction(payload: unknown): void {
    if (!isNavActionRequest(payload)) {
      throw new Error('invalid browser pane nav-action payload')
    }

    const record = this.panes.get(paneKey(payload.sessionId, payload.paneId))
    if (!record) {
      return
    }

    this.runNavAction(record, payload.action)
  }

  private runNavAction(record: BrowserPaneRecord, action: string): void {
    const wc = this.activeWebContents(record)
    if (!wc || wc.isDestroyed()) {
      return
    }

    switch (action) {
      case 'back':
        if (wc.navigationHistory.canGoBack()) {
          wc.navigationHistory.goBack()
        }
        break
      case 'forward':
        if (wc.navigationHistory.canGoForward()) {
          wc.navigationHistory.goForward()
        }
        break
      case 'reload':
        wc.reload()
        break
      case 'stop':
        wc.stop()
        break
      default:
        break
    }
  }

  private activateTab(payload: unknown): void {
    if (!isTabRequest(payload)) {
      throw new Error('invalid browser pane activate tab payload')
    }

    const record = this.panes.get(paneKey(payload.sessionId, payload.paneId))
    if (!record) {
      return
    }

    this.setActiveTab(record, payload.tabId, true)
    this.writeSignals?.markStructural()
  }

  private closeTab(payload: unknown): void {
    if (!isTabRequest(payload)) {
      throw new Error('invalid browser pane close tab payload')
    }

    const record = this.panes.get(paneKey(payload.sessionId, payload.paneId))
    if (!record || record.tabs.size <= 1) {
      return
    }

    const tab = record.tabs.get(payload.tabId)
    if (!tab) {
      return
    }

    const wasActive = record.activeTabId === payload.tabId
    record.tabs.delete(payload.tabId)

    const win = BrowserWindow.fromId(record.windowId)
    if (win && !win.isDestroyed()) {
      win.contentView.removeChildView(tab.view)
    }

    if (!tab.view.webContents.isDestroyed()) {
      tab.view.webContents.close()
    }

    if (wasActive) {
      const nextTabId = record.tabs.keys().next().value
      if (nextTabId) {
        this.setActiveTab(record, nextTabId, true)
      }

      this.writeSignals?.markStructural()

      return
    }

    this.emitTabsChanged(record)
    this.writeSignals?.markStructural()
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

    // Track our own listener so dispose() can remove exactly it — never
    // removeAllListeners on this process-wide partition session singleton.
    const webAuthnHandler = (
      _event: ElectronEvent,
      details: { accounts: { credentialId: string }[] },
      callback: (credentialId: string | null) => void
    ): void => {
      if (details.accounts.length === 1) {
        callback(details.accounts[0].credentialId)
      } else {
        callback(null)
      }
    }
    this.webAuthnHandlers.set(partition, webAuthnHandler)
    ses.on('select-webauthn-account', webAuthnHandler)

    ses.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(
        permission === 'mediaKeySystem' ||
          permission === 'storage-access' ||
          permission === 'top-level-storage-access'
      )
    })

    ses.setPermissionCheckHandler(
      (_webContents, permission) =>
        permission === 'mediaKeySystem' ||
        permission === 'storage-access' ||
        permission === 'top-level-storage-access'
    )
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
    }

    for (const tab of record.tabs.values()) {
      if (win && !win.isDestroyed()) {
        win.contentView.removeChildView(tab.view)
      }

      if (!tab.view.webContents.isDestroyed()) {
        tab.view.webContents.close()
      }
    }
    record.tabs.clear()
  }

  private installRendererLifecycleCleanup(sender: WebContents): void {
    if (this.rendererLifecycleHandlers.has(sender.id)) {
      return
    }

    this.rendererLifecycleHandlers.add(sender.id)

    // Dispose records only on genuine teardown (the owner WebContents being
    // destroyed), NOT on render-process-gone: a renderer reload/crash must leave
    // the browser views alive so restore can reconnect to them.
    const handleDestroyed = (): void => {
      sender.removeListener('destroyed', handleDestroyed)
      this.rendererLifecycleHandlers.delete(sender.id)
      this.removeRecordsForOwner(sender.id)
    }

    sender.once('destroyed', handleDestroyed)
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
      const record = authorizedRecord
      const activeTab = this.activeTab(record)

      writeJson(response, [
        {
          id: record.id,
          type: 'page',
          title:
            this.activeWebContents(record)?.getTitle() ??
            'Vimeflow Browser Pane',
          url: activeTab ? this.tabUrl(activeTab) : '',
          webSocketDebuggerUrl: this.pageWebSocketUrl(record),
        },
      ])

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

    // `origin === undefined` is the expected non-browser caller path (CLI /
    // automation clients omit Origin); the per-pane 192-bit token is the sole
    // gate for those callers. Browser callers always send Origin and are
    // checked against BROWSER_CDP_ORIGIN, blocking cross-origin/DNS-rebinding.
    const originAllowed = origin === undefined || origin === BROWSER_CDP_ORIGIN
    if (!originAllowed) {
      return null
    }

    for (const record of this.panes.values()) {
      if (
        (token !== null && tokensMatch(token, record.cdpToken)) ||
        (auth !== undefined && tokensMatch(auth, `Bearer ${record.cdpToken}`))
      ) {
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

    const webContents = this.activeWebContents(record)
    if (!webContents) {
      sendWebSocketClose(socket)

      return
    }

    const { debugger: debuggee } = webContents
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

    let chunks: Buffer[] = []

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
      chunks.push(buffer)

      try {
        let pending = Buffer.concat(chunks)
        let frame = decodeFrame(pending)
        while (frame) {
          pending = pending.subarray(frame.byteLength)
          this.handleDebuggerFrame(webContents, socket, frame)
          frame = decodeFrame(pending)
        }
        chunks = pending.length > 0 ? [pending] : []
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

    // RFC 6455 §5.1: every client-to-server frame MUST be masked. Reject an
    // unmasked frame with 1002 (Protocol Error) so a buggy or non-compliant CDP
    // client fails loudly instead of silently working against transport defects.
    if (!frame.masked) {
      sendWebSocketClose(socket, 1002)

      return
    }

    // This minimal proxy requires non-fragmented frames (Phase 1). Fragmentation
    // is an unimplemented protocol feature, so close with 1002 (Protocol Error)
    // per RFC 6455 §7.4.1 — not 1003 (Unsupported Data, wrong data type) or 1009
    // (message too big).
    if (!frame.fin && (frame.opcode === 0x1 || frame.opcode === 0x2)) {
      sendWebSocketClose(socket, 1002)

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
