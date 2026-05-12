import { invoke } from '@tauri-apps/api/core'
import { getAllPtySessionIds } from '../features/terminal/ptySessionMap'

const isVisible = (el: HTMLElement): boolean => {
  const r = el.getBoundingClientRect()

  return r.width > 0 && r.height > 0
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
// the focused pane's xterm (the active pane has `data-focused="true"`
// on its inner wrapper) so callers reading by session id always get the
// active pane's buffer instead of whichever pane happens to be first in
// DOM. Falls back to the first `.xterm-rows` for single-pane sessions
// and for the defensive case where no inner wrapper has `data-focused`.
//
// Exported for unit testing — production callers go through
// `readVisibleTerminalBuffer` / `readTerminalBufferForSession`.
export const readPaneBuffer = (pane: HTMLElement): string => {
  const focusedWrapper = pane.querySelector<HTMLElement>(
    '[data-testid="terminal-pane-wrapper"][data-focused="true"]'
  )

  const rows = (focusedWrapper ?? pane).querySelector<HTMLElement>(
    '.xterm-rows'
  )
  if (!rows) {
    return ''
  }

  return rows.textContent
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

if (import.meta.env.VITE_E2E) {
  window.__VIMEFLOW_E2E__ = {
    getTerminalBuffer: readVisibleTerminalBuffer,
    getTerminalBufferForSession: readTerminalBufferForSession,
    getVisibleSessionId,
    getActiveSessionIds: getAllPtySessionIds,
    listActivePtySessions: async (): Promise<string[]> =>
      invoke<string[]>('list_active_pty_sessions'),
  }
}
