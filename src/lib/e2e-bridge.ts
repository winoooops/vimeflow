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
const readPaneBuffer = (pane: HTMLElement): string => {
  const rows = pane.querySelector<HTMLElement>('.xterm-rows')
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
// `pane.ptyId` (the Rust PTY handle). Post-5a these are distinct values
// living on different attributes — `data-session-id` on TerminalZone's
// wrapper, `data-pty-id` on both the wrapper and Body's inner xterm
// container. Try session-id first (most callers operate at the
// workspace level), then fall back to pty-id so legacy / Rust-side
// callers keep working.
const readTerminalBufferForSession = (id: string): string => {
  const escaped = CSS.escape(id)

  const pane =
    document.querySelector<HTMLElement>(
      `[data-testid="terminal-pane"][data-session-id="${escaped}"]`
    ) ??
    document.querySelector<HTMLElement>(
      `[data-testid="terminal-pane"][data-pty-id="${escaped}"]`
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
