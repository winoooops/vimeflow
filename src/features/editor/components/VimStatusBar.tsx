import type { ReactElement } from 'react'
import type { VimMode } from '../types'

interface VimStatusBarProps {
  vimMode: VimMode
  fileName: string
  lineNumber: number
  columnNumber: number
  encoding: string
  language: string
}

export const VimStatusBar = ({
  vimMode,
  fileName,
  lineNumber,
  columnNumber,
  encoding,
  language,
}: VimStatusBarProps): ReactElement => (
  <div
    data-testid="vim-status-bar"
    className="h-7 bg-surface-container-low border-t border-outline/15 flex items-center justify-between px-4 font-mono text-[0.75rem] uppercase tracking-wider"
  >
    <div className="flex items-center">
      <span className="bg-primary-container text-surface px-2 font-bold mr-3">
        -- {vimMode} --
      </span>
      <span className="text-on-surface-variant hover:bg-surface-variant px-3 cursor-pointer">
        {fileName}
      </span>
    </div>
    <div className="flex items-center">
      <span className="text-on-surface-variant px-3 border-r border-outline/30">
        Ln {lineNumber}, Col {columnNumber}
      </span>
      <span className="text-on-surface-variant px-3 border-r border-outline/30">
        {encoding}
      </span>
      <span className="text-on-surface-variant px-3">{language}</span>
    </div>
  </div>
)
