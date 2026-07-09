import type { Terminal } from '@xterm/xterm'
import { __dispatchBackendEventForE2e, invoke } from './backend'
import { getAllPtySessionIds } from '../features/terminal/ptySessionMap'
import { terminalCache } from '../features/terminal/components/TerminalPane/Body'
import {
  clearBrowserPaneBoundsCaptures,
  getBrowserPaneBoundsCaptures,
  startBrowserPaneBoundsCapture,
  stopBrowserPaneBoundsCapture,
} from '../features/browser/browserBridge'

const isVisible = (el: HTMLElement): boolean => {
  const r = el.getBoundingClientRect()

  return r.width > 0 && r.height > 0
}

// Reads the visible viewport via xterm's buffer API — used when canvas renderers leave `.xterm-rows` empty.
const bufferToText = (terminal: Terminal): string => {
  const buffer = terminal.buffer.active
  const start = buffer.viewportY
  const end = start + terminal.rows
  const lines: string[] = []
  for (let i = start; i < end; i++) {
    const line = buffer.getLine(i)
    if (line) {
      lines.push(line.translateToString(true))
    }
  }

  return lines.join('\n').replace(/\n+$/, '')
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

// `rows.textContent` is typed as `string` by this project's lib.dom
// (see similar `const text = rows.textContent` pattern in this file);
// `?? ''` is rejected by @typescript-eslint/no-unnecessary-condition.
//
// Multi-pane sessions (post-5b): the session-level wrapper contains a
// SplitView with N inner TerminalPanes, each carrying an xterm. Prefer
// the active pane's xterm (the active pane has `data-pane-active="true"`
// on its inner wrapper) so callers reading by session id always get the
// active pane's buffer instead of whichever pane happens to be first in
// DOM. Falls back to the first `.xterm-rows` for single-pane sessions
// and for the defensive case where no inner wrapper has `data-pane-active`.
//
// Exported for unit testing — production callers go through
// `readVisibleTerminalBuffer` / `readTerminalBufferForSession`.
//
// `container` is any xterm ancestor element: the session-level
// `terminal-pane` wrapper (preferred for multi-pane sessions —
// triggers the `data-pane-active` first-pass), a single `split-view-slot`
// (the pty-id lookup path), or any `terminal-pane-wrapper` directly.
// Renamed from `pane` to remove the pre-5b "single-pane element"
// connotation — post-5b the function handles all three DOM shapes.
export const readPaneBuffer = (container: HTMLElement): string => {
  const activeWrapper = container.querySelector<HTMLElement>(
    '[data-testid="terminal-pane-wrapper"][data-pane-active="true"]'
  )
  const scope = activeWrapper ?? container

  const rows = scope.querySelector<HTMLElement>('.xterm-rows')
  const domText = rows?.textContent ?? ''
  if (domText.trim().length > 0) {
    return domText
  }

  // DOM read empty — WebGL/Canvas2D renderer is rendering to <canvas>.
  // Fall back to xterm's buffer API via terminalCache.
  const cacheKey = resolveCacheKey(scope)
  if (cacheKey) {
    const entry = terminalCache.get(cacheKey)
    if (entry) {
      return bufferToText(entry.terminal)
    }
  }

  return domText
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

const getVisiblePtyId = (): string | null => {
  const pane = findActivePane()
  if (!pane) {
    return null
  }

  const activeWrapper = pane.querySelector<HTMLElement>(
    '[data-testid="terminal-pane-wrapper"][data-pane-active="true"]'
  )

  const activeSlot = activeWrapper?.closest<HTMLElement>(
    '[data-testid="split-view-slot"][data-pty-id]'
  )
  if (activeSlot?.dataset.ptyId) {
    return activeSlot.dataset.ptyId
  }

  const firstSlot = pane.querySelector<HTMLElement>(
    '[data-testid="split-view-slot"][data-pty-id]'
  )
  if (firstSlot?.dataset.ptyId) {
    return firstSlot.dataset.ptyId
  }

  const bodyContainer = pane.querySelector<HTMLElement>(
    '[data-testid="terminal-pane"][data-pty-id]'
  )

  return bodyContainer?.dataset.ptyId ?? null
}

const dispatchCommandPaletteShortcut = async (): Promise<boolean> => {
  const handledByRenderer = commandPaletteShortcutOpener?.() ?? false
  if (handledByRenderer) {
    return true
  }

  const handledByElectron =
    await window.vimeflow?.e2e?.dispatchCommandPaletteShortcut()

  return handledByElectron === true
}

let commandPaletteShortcutOpener: (() => boolean) | null = null

export const registerCommandPaletteShortcutOpenerForE2e = (
  opener: () => void
): (() => void) => {
  if (!import.meta.env.VITE_E2E) {
    return (): void => {
      /* no-op outside e2e builds */
    }
  }

  const registeredOpener = (): boolean => {
    opener()

    return true
  }

  commandPaletteShortcutOpener = registeredOpener

  return (): void => {
    if (commandPaletteShortcutOpener === registeredOpener) {
      commandPaletteShortcutOpener = null
    }
  }
}

if (import.meta.env.VITE_E2E) {
  window.__VIMEFLOW_E2E__ = {
    getTerminalBuffer: readVisibleTerminalBuffer,
    getTerminalBufferForSession: readTerminalBufferForSession,
    getVisibleSessionId,
    getVisiblePtyId,
    getActiveSessionIds: getAllPtySessionIds,
    invokeBackend: async <T>(
      method: string,
      args?: Record<string, unknown>
    ): Promise<T> => invoke<T>(method, args),
    emitBackendEvent: __dispatchBackendEventForE2e,
    listActivePtySessions: async (): Promise<string[]> =>
      invoke<string[]>('list_active_pty_sessions'),
    dispatchCommandPaletteShortcut,
    startBrowserPaneBoundsCapture,
    clearBrowserPaneBoundsCaptures,
    stopBrowserPaneBoundsCapture,
    getBrowserPaneBoundsCaptures,
  }
}
