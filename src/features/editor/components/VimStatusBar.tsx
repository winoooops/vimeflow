import type { ReactElement } from 'react'
import type { VimMode } from '../hooks/useVimMode'

interface VimStatusBarProps {
  vimMode: VimMode
  isDirty?: boolean
}

export const VimStatusBar = ({
  vimMode,
  isDirty = false,
}: VimStatusBarProps): ReactElement => (
  <div
    data-testid="vim-status-bar"
    className="h-7 bg-surface-container-low border-t border-outline/15 flex items-center justify-between px-4 font-mono text-[0.75rem] uppercase tracking-wider"
  >
    <div className="flex items-center">
      {vimMode && (
        <span className="bg-primary-container text-surface px-2 font-bold mr-3">
          -- {vimMode} --
        </span>
      )}
      {isDirty && <span className="text-primary ml-2">[+]</span>}
    </div>
  </div>
)
