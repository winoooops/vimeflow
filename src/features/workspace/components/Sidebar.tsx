import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactElement,
} from 'react'
import type { Session } from '../types'
import type { FileNode } from '../../files/types'
import type { AgentStatus } from '../../agent-status/types'
import { FileExplorer } from './panels/FileExplorer'
import { SidebarStatusHeader } from './SidebarStatusHeader'
import { List } from '../sessions/components/List'

export interface SidebarProps {
  sessions: Session[]
  activeSessionId: string | null
  activeCwd?: string
  onSessionClick: (sessionId: string) => void
  onNewInstance?: () => void
  onRemoveSession?: (sessionId: string) => void
  onRenameSession?: (sessionId: string, name: string) => void
  onReorderSessions?: (sessions: Session[]) => void
  onFileSelect?: (node: FileNode) => void
  agentStatus: AgentStatus
}

const FILE_EXPLORER_MIN = 100
const FILE_EXPLORER_MAX = 500
const FILE_EXPLORER_DEFAULT = 320

export const Sidebar = ({
  sessions,
  activeSessionId,
  activeCwd = '~',
  onSessionClick,
  onNewInstance = undefined,
  onRemoveSession = undefined,
  onRenameSession = undefined,
  onReorderSessions = undefined,
  onFileSelect = undefined,
  agentStatus,
}: SidebarProps): ReactElement => {
  const [explorerHeight, setExplorerHeight] = useState(FILE_EXPLORER_DEFAULT)
  const [isDraggingSplit, setIsDraggingSplit] = useState(false)
  const startY = useRef(0)
  const startHeight = useRef(0)

  const handleSplitMouseDown = useCallback(
    (e: React.MouseEvent): void => {
      e.preventDefault()
      startY.current = e.clientY
      startHeight.current = explorerHeight
      setIsDraggingSplit(true)
    },
    [explorerHeight]
  )

  useEffect(() => {
    if (!isDraggingSplit) {
      return
    }

    const handleMouseMove = (e: MouseEvent): void => {
      const delta = startY.current - e.clientY

      const newHeight = Math.round(
        Math.min(
          FILE_EXPLORER_MAX,
          Math.max(FILE_EXPLORER_MIN, startHeight.current + delta)
        )
      )
      setExplorerHeight(newHeight)
    }

    const handleMouseUp = (): void => {
      setIsDraggingSplit(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return (): void => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDraggingSplit])

  return (
    <div
      className="flex h-full w-full flex-col bg-surface-container-low"
      data-testid="sidebar"
    >
      <div className="px-3 pt-3 pb-2">
        <SidebarStatusHeader
          status={agentStatus}
          activeSessionName={
            sessions.find((s) => s.id === activeSessionId)?.name ?? null
          }
        />
      </div>

      <List
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSessionClick={onSessionClick}
        onNewInstance={onNewInstance}
        onRemoveSession={onRemoveSession}
        onRenameSession={onRenameSession}
        onReorderSessions={onReorderSessions}
      />

      <div
        data-testid="explorer-resize-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-valuenow={explorerHeight}
        aria-valuemin={FILE_EXPLORER_MIN}
        aria-valuemax={FILE_EXPLORER_MAX}
        onMouseDown={handleSplitMouseDown}
        className={`
          h-1 shrink-0 cursor-row-resize transition-colors hover:bg-primary/50
          ${isDraggingSplit ? 'bg-primary/70' : 'border-t border-white/5'}
        `}
      />

      <div style={{ height: explorerHeight }} className="shrink-0">
        <FileExplorer cwd={activeCwd} onFileSelect={onFileSelect} />
      </div>

      <div className="p-3">
        <button
          type="button"
          onClick={onNewInstance}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-primary to-secondary py-2.5 font-label text-sm font-bold text-on-primary shadow-lg shadow-primary/10 transition-all hover:shadow-xl hover:shadow-primary/20"
          aria-label="New Instance"
        >
          <span className="material-symbols-outlined text-lg">bolt</span>
          <span>New Instance</span>
        </button>
      </div>

      {isDraggingSplit && (
        <div className="fixed inset-0 z-50 cursor-row-resize" />
      )}
    </div>
  )
}
