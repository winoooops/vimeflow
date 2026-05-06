import type { ReactElement } from 'react'

export const StatusBar = (): ReactElement => (
  <footer
    data-testid="status-bar"
    aria-label="App status"
    className="flex h-6 shrink-0 items-center gap-3.5 border-t border-outline-variant/20 bg-surface-container-lowest px-3 font-mono text-[10px] text-on-surface-variant"
  >
    <span className="text-primary-container">vimeflow</span>
    <span aria-hidden="true">·</span>
    <span>v{__APP_VERSION__}</span>
    <span className="flex-1" />
  </footer>
)
