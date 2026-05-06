import type { ReactElement } from 'react'

export const StatusBar = (): ReactElement => (
  <div
    data-testid="status-bar"
    className="flex h-6 shrink-0 items-center gap-3.5 border-t border-outline-variant/20 bg-surface-container-lowest px-3 font-mono text-[10px] text-on-surface-variant"
  >
    <span className="text-primary-container">obsidian-cli</span>
    <span aria-hidden="true">·</span>
    <span>v0.9.4</span>
    <span className="flex-1" />
  </div>
)

export default StatusBar
