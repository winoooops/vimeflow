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
      <div className="flex items-center gap-0">
        <span className="bg-primary text-background px-3 h-6 flex items-center font-bold hover:bg-[#333344] transition-colors cursor-pointer">
          -- {vimMode} --
        </span>
        <span className="flex items-center gap-2 px-3 border-r border-[#4a444f]/15 h-6 hover:bg-[#333344] transition-colors cursor-pointer">
          <span className="material-symbols-outlined text-[14px]">
            account_tree
          </span>
          {gitBranch}
        </span>
        <span className="flex items-center gap-2 px-3 h-6 hover:bg-[#333344] transition-colors cursor-pointer">
          <span className="material-symbols-outlined text-[14px]">sync</span>
          {syncStatus.behind} ↓ {syncStatus.ahead} ↑
        </span>
      </div>
      <div className="flex items-center gap-0">
        <span className="px-3 border-l border-[#4a444f]/15 h-6 flex items-center hover:bg-[#333344] transition-colors cursor-pointer">
          {fileName}
        </span>
        <span className="px-3 border-l border-[#4a444f]/15 h-6 flex items-center hover:bg-[#333344] transition-colors cursor-pointer">
          {encoding}
        </span>
        <span className="px-3 border-l border-[#4a444f]/15 h-6 flex items-center text-primary hover:bg-[#333344] transition-colors cursor-pointer">
          {language}
        </span>
        <span className="px-3 border-l border-[#4a444f]/15 h-6 flex items-center hover:bg-[#333344] transition-colors cursor-pointer">
          Ln {cursor.line}, Col {cursor.column}
        </span>
      </div>
    </div>
  )
}
