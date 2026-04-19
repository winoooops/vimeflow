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

const readTerminalBufferForSession = (sessionId: string): string => {
  const pane = document.querySelector<HTMLElement>(
    `[data-testid="terminal-pane"][data-session-id="${CSS.escape(sessionId)}"]`
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
