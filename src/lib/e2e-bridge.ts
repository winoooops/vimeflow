// cspell:ignore ghostty GHOSTTY
import { invoke, listen, type UnlistenFn } from './backend'
import { getAllPtySessionIds } from '../features/terminal/ptySessionMap'
import { terminalCache } from '../features/terminal/terminalRegistry'
import type { PtyDataEvent } from '../bindings'

const LEGACY_XTERM_ROWS_SELECTOR = '.xterm-rows'
let e2eOutputOffset = 0
let ptyDataRecorderUnlisten: UnlistenFn | null = null
let recordedPtyDataEvents: RecordedPtyDataEvent[] = []

export interface RecordedPtyDataEvent {
  readonly sessionId: string
  readonly data: string
  readonly bytesBase64?: string
  readonly offsetStart: number
  readonly byteLen: number
}

const coerceEventOffset = (value: number | bigint): number =>
  typeof value === 'bigint' ? Number(value) : value

const recordPtyDataEvent = (event: PtyDataEvent): void => {
  recordedPtyDataEvents.push({
    sessionId: event.sessionId,
    data: event.data,
    ...(event.bytesBase64 === undefined
      ? {}
      : { bytesBase64: event.bytesBase64 }),
    offsetStart: coerceEventOffset(event.offsetStart),
    byteLen: coerceEventOffset(event.byteLen),
  })
}

const isVisible = (el: HTMLElement): boolean => {
  const r = el.getBoundingClientRect()

  return r.width > 0 && r.height > 0
}

const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = ''

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })

  return btoa(binary)
}

// terminalCache is keyed by `pane.ptyId` (Body's `sessionId` prop). Find Body's `data-pty-id` descendant; fall back to the container's own data-pty-id when callers pass it directly.
const resolveCacheKey = (container: HTMLElement): string | null => {
  const ptyEl = container.querySelector<HTMLElement>(
    '[data-testid="terminal-pane"][data-pty-id]'
  )
  if (ptyEl?.dataset.ptyId) {
    return ptyEl.dataset.ptyId
  }

  return container.dataset.ptyId ?? null
}

const findActivePane = (): HTMLElement | null => {
  const panes = document.querySelectorAll<HTMLElement>(
    '[data-testid="terminal-pane"][data-session-id]'
  )

  return Array.from(panes).find(isVisible) ?? null
}

const readCachedViewportText = (scope: HTMLElement): string => {
  const cacheKey = resolveCacheKey(scope)
  if (!cacheKey) {
    return ''
  }

  const entry = terminalCache.get(cacheKey)
  if (!entry) {
    return ''
  }

  const surfaceText = entry.viewportReader.readVisibleText()
  if (surfaceText.trim().length === 0) {
    return ''
  }

  return surfaceText
}

// Compatibility fallback for the old xterm DOM renderer path. New renderer
// adapters should expose visible text through TerminalViewportReader; this
// selector remains only so existing automation can still read text before Body
// has cached a terminal instance, or when a legacy DOM-rendered xterm is under
// the queried scope.
const readLegacyXtermDomRowsText = (scope: HTMLElement): string => {
  const rows = scope.querySelector<HTMLElement>(LEGACY_XTERM_ROWS_SELECTOR)

  return rows?.textContent ?? ''
}

// Multi-pane sessions (post-5b): the session-level wrapper contains a
// SplitView with N inner TerminalPanes. Prefer the focused pane's renderer
// (the active pane has `data-focused="true"` on its inner wrapper) so callers
// reading by session id always get the active pane's buffer instead of whichever
// pane happens to be first in DOM. TerminalViewportReader is the primary text
// source; `.xterm-rows` is only a legacy DOM fallback.
//
// Exported for unit testing — production callers go through
// `readVisibleTerminalBuffer` / `readTerminalBufferForSession`.
//
// `container` is any terminal ancestor element: the session-level
// `terminal-pane` wrapper (preferred for multi-pane sessions —
// triggers the `data-focused` first-pass), a single `split-view-slot`
// (the pty-id lookup path), or any `terminal-pane-wrapper` directly.
// Renamed from `pane` to remove the pre-5b "single-pane element"
// connotation — post-5b the function handles all three DOM shapes.
export const readPaneBuffer = (container: HTMLElement): string => {
  const focusedWrapper = container.querySelector<HTMLElement>(
    '[data-testid="terminal-pane-wrapper"][data-focused="true"]'
  )
  const scope = focusedWrapper ?? container

  const cachedViewportText = readCachedViewportText(scope)
  if (cachedViewportText) {
    return cachedViewportText
  }

  return readLegacyXtermDomRowsText(scope)
}

const readVisibleTerminalBuffer = (): string => {
  const pane = findActivePane()

  return pane ? readPaneBuffer(pane) : ''
}

// Callers may pass either a React `Session.id` (the workspace UUID) or a
// `pane.ptyId` (the Rust PTY handle). Post-5a these are distinct values;
// post-5b SplitView refactor (PR #199) the pane-level data-attrs moved
// off `terminal-pane` (session wrapper) and onto `split-view-slot` (one
// per pane). Try session-id first against the session wrapper, then fall
// back to pty-id against the per-pane slot so legacy / Rust-side callers
// passing a PTY handle keep working — `getActiveSessionIds()` exposes
// PTY ids and existing automation may pass them straight back here.
const readTerminalBufferForSession = (id: string): string => {
  const escaped = CSS.escape(id)

  const pane =
    document.querySelector<HTMLElement>(
      `[data-testid="terminal-pane"][data-session-id="${escaped}"]`
    ) ??
    document.querySelector<HTMLElement>(
      `[data-testid="split-view-slot"][data-pty-id="${escaped}"]`
    )

  return pane ? readPaneBuffer(pane) : ''
}

const getVisibleSessionId = (): string | null => {
  const pane = findActivePane()

  return pane?.dataset.sessionId ?? null
}

export const getVisibleTerminalSize = (): {
  readonly cols: number
  readonly rows: number
} | null => {
  const pane = findActivePane()
  if (!pane) {
    return null
  }

  const sessionId = resolveCacheKey(pane)
  if (!sessionId) {
    return null
  }

  const entry = terminalCache.get(sessionId)
  if (!entry) {
    return null
  }

  return {
    cols: entry.terminal.cols,
    rows: entry.terminal.rows,
  }
}

export const getTerminalRendererConfig = (): {
  readonly terminalRenderer: string | null
  readonly ghosttyRenderStateDriverProvider: string | null
} => ({
  terminalRenderer: import.meta.env.VITE_TERMINAL_RENDERER ?? null,
  ghosttyRenderStateDriverProvider:
    import.meta.env.VITE_GHOSTTY_RENDER_STATE_DRIVER_PROVIDER ?? null,
})

export const writeOutputToVisibleTerminal = (data: string): boolean => {
  const pane = findActivePane()
  if (!pane) {
    return false
  }

  const sessionId = resolveCacheKey(pane)
  if (!sessionId) {
    return false
  }

  const entry = terminalCache.get(sessionId)
  if (!entry) {
    return false
  }

  const bytes = new TextEncoder().encode(data)
  const offsetStart = e2eOutputOffset
  e2eOutputOffset += bytes.length

  entry.output.writeOutput({
    text: data,
    bytesBase64: encodeBase64(bytes),
    offsetStart,
    byteLen: bytes.length,
    phase: 'live',
  })

  return true
}

export const writeInputToVisibleTerminal = async (
  data: string
): Promise<boolean> => {
  const pane = findActivePane()
  if (!pane) {
    return false
  }

  const sessionId = resolveCacheKey(pane)
  if (!sessionId) {
    return false
  }

  await invoke<null>('write_pty', {
    request: {
      sessionId,
      data,
    },
  })

  return true
}

export const startRecordingPtyDataEvents = async (): Promise<void> => {
  if (ptyDataRecorderUnlisten !== null) {
    return
  }

  ptyDataRecorderUnlisten = await listen<PtyDataEvent>(
    'pty-data',
    recordPtyDataEvent
  )
}

export const stopRecordingPtyDataEvents = (): void => {
  ptyDataRecorderUnlisten?.()
  ptyDataRecorderUnlisten = null
}

export const clearRecordedPtyDataEvents = (): void => {
  recordedPtyDataEvents = []
}

export const getRecordedPtyDataEvents = (): readonly RecordedPtyDataEvent[] =>
  recordedPtyDataEvents

if (import.meta.env.VITE_E2E) {
  window.__VIMEFLOW_E2E__ = {
    clearRecordedPtyDataEvents,
    getRecordedPtyDataEvents,
    getTerminalBuffer: readVisibleTerminalBuffer,
    getTerminalBufferForSession: readTerminalBufferForSession,
    getTerminalRendererConfig,
    getVisibleTerminalSize,
    getVisibleSessionId,
    getActiveSessionIds: getAllPtySessionIds,
    listActivePtySessions: async (): Promise<string[]> =>
      invoke<string[]>('list_active_pty_sessions'),
    startRecordingPtyDataEvents,
    writeInputToVisibleTerminal,
    writeOutputToVisibleTerminal,
  }
}
