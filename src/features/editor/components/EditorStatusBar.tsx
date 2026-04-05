import type { ReactElement } from 'react'
import type { EditorStatusBarState } from '../types'

interface EditorStatusBarProps {
  state: EditorStatusBarState
  isContextPanelOpen: boolean
}

export const EditorStatusBar = ({
  state,
  isContextPanelOpen,
}: EditorStatusBarProps): ReactElement => {
  const {
    vimMode,
    gitBranch,
    syncStatus,
    fileName,
    encoding,
    language,
    cursor,
  } = state

  return (
    <div
      role="status"
      data-testid="editor-status-bar"
      className={`fixed bottom-0 left-[308px] ${isContextPanelOpen ? 'right-[280px]' : 'right-0'} h-6 bg-[#1a1a2a] border-t border-[#4a444f]/15 flex items-center justify-between z-30 font-label text-[10px] uppercase tracking-wider text-[#cdc3d1] transition-all duration-300`}
    >
      <div className="flex items-center gap-2">
        <span className="bg-primary text-background px-3 h-6 flex items-center font-bold">
          {vimMode}
        </span>
        <span className="text-[#cdc3d1]">{gitBranch}</span>
        <span className="text-[#cdc3d1]">
          ↓{syncStatus.behind} ↑{syncStatus.ahead}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[#cdc3d1]">{fileName}</span>
        <span className="text-[#cdc3d1]">{encoding}</span>
        <span className="text-primary">{language}</span>
        <span className="text-[#cdc3d1]">
          Ln {cursor.line}, Col {cursor.column}
        </span>
      </div>
    </div>
  )
}
