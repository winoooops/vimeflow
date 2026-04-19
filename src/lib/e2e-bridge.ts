import { invoke } from '@tauri-apps/api/core'
import { getAllPtySessionIds } from '../features/terminal/ptySessionMap'

const readVisibleTerminalBuffer = (): string => {
  const rowsEls = document.querySelectorAll<HTMLElement>(
    '[data-testid="terminal-pane"] .xterm-rows'
  )
  for (const rows of Array.from(rowsEls)) {
    const text = rows.textContent
    if (text.trim().length > 0) {
      return text
    }
  }

  return ''
}

if (import.meta.env.VITE_E2E) {
  window.__VIMEFLOW_E2E__ = {
    getTerminalBuffer: readVisibleTerminalBuffer,
    getActiveSessionIds: getAllPtySessionIds,
    listActivePtySessions: async (): Promise<string[]> =>
      invoke<string[]>('list_active_pty_sessions'),
  }
}
