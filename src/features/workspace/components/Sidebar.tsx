import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type ReactElement,
} from 'react'
import { Reorder } from 'framer-motion'
import type { Session } from '../types'
import type { FileNode } from '../../files/types'
import { FileExplorer } from './panels/FileExplorer'

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
}

const FILE_EXPLORER_MIN = 100
const FILE_EXPLORER_MAX = 500
const FILE_EXPLORER_DEFAULT = 320

interface SessionItemProps {
  session: Session
  isActive: boolean
  onSessionClick: (id: string) => void
  onRemove?: (id: string) => void
  onRename?: (id: string, name: string) => void
}

const SessionItem = ({
  session,
  isActive,
  onSessionClick,
  onRemove = undefined,
  onRename = undefined,
}: SessionItemProps): ReactElement => {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(session.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const commitRename = (): void => {
    setIsEditing(false)
    if (editValue.trim().length > 0 && editValue.trim() !== session.name) {
      onRename?.(session.id, editValue.trim())
    } else {
      setEditValue(session.name)
    }
  }

  return (
    <Reorder.Item
      value={session}
      id={session.id}
      className={`
        flex items-center gap-2 rounded-md px-3 py-2
        text-left transition-colors relative group cursor-grab active:cursor-grabbing
        ${
          isActive
            ? 'bg-surface-container-high text-on-surface'
            : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
        }
      `}
      whileDrag={{
        scale: 1.02,
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        zIndex: 50,
      }}
      layout="position"
    >
      {/* Click target */}
      <button
        type="button"
        onClick={() => onSessionClick(session.id)}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        aria-label={session.name}
      >
        <span className="material-symbols-outlined text-base shrink-0">
          {isActive ? 'smart_toy' : 'schedule'}
        </span>
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commitRename()
              }
              if (e.key === 'Escape') {
                setEditValue(session.name)
                setIsEditing(false)
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 flex-1 truncate rounded bg-slate-700 px-1 font-label text-sm font-medium text-on-surface outline-none ring-1 ring-primary"
            aria-label="Rename session"
          />
        ) : (
          <span
            className="min-w-0 flex-1 truncate font-label text-sm"
            onDoubleClick={(e) => {
              e.stopPropagation()
              setEditValue(session.name)
              setIsEditing(true)
            }}
          >
            {session.name}
          </span>
        )}
      </button>

      {/* Action buttons — visible on hover */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setEditValue(session.name)
            setIsEditing(true)
          }}
          className="rounded p-0.5 text-on-surface/40 transition-colors hover:bg-surface-container-high hover:text-on-surface"
          aria-label="Rename session"
          title="Rename"
        >
          <span className="material-symbols-outlined text-sm">edit</span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove?.(session.id)
          }}
          className="rounded p-0.5 text-on-surface/40 transition-colors hover:bg-red-900/50 hover:text-red-400"
          aria-label="Remove session"
          title="Remove"
        >
          <span className="material-symbols-outlined text-sm">close</span>
        </button>
      </div>
    </Reorder.Item>
  )
}

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
      // Dragging up (negative delta) should increase explorer height
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
      {/* Agent header */}
      <div className="flex items-center gap-3 px-4 py-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600">
          <span className="material-symbols-outlined text-lg text-white">
            smart_toy
          </span>
        </div>
        <div className="min-w-0">
          <div className="truncate font-label text-sm font-bold text-on-surface">
            Agent Alpha
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
            <span className="font-label text-xs uppercase tracking-wider text-on-surface/50">
              System Idle
            </span>
          </div>
        </div>
      </div>

      {/* Sessions section header */}
      <div className="flex items-center justify-between px-4 pb-1 pt-2">
        <h2 className="font-label text-xs font-semibold uppercase tracking-wider text-on-surface/50">
          Active Sessions
        </h2>
        <button
          type="button"
          onClick={onNewInstance}
          className="material-symbols-outlined text-base text-on-surface/50 transition-colors hover:text-primary"
          aria-label="Add session"
          title="Add session"
        >
          add
        </button>
      </div>

      {/* Session list — takes remaining space above file explorer */}
      <Reorder.Group
        axis="y"
        values={sessions}
        onReorder={(reordered) => onReorderSessions?.(reordered)}
        className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-1"
        data-testid="session-list"
        layoutScroll
      >
        {sessions.length === 0 ? (
          <div className="px-3 py-4 text-center text-sm text-on-surface/50">
            No sessions
          </div>
        ) : (
          sessions.map((session) => (
            <SessionItem
              key={session.id}
              session={session}
              isActive={session.id === activeSessionId}
              onSessionClick={onSessionClick}
              onRemove={onRemoveSession}
              onRename={onRenameSession}
            />
          ))
        )}
      </Reorder.Group>

      {/* Resize handle — between sessions and file explorer */}
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

      {/* File Explorer — resizable height */}
      <div style={{ height: explorerHeight }} className="shrink-0">
        <FileExplorer cwd={activeCwd} onFileSelect={onFileSelect} />
      </div>

      {/* New Instance button */}
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

      {/* Drag overlay — prevents xterm from stealing mouse events */}
      {isDraggingSplit && (
        <div className="fixed inset-0 z-50 cursor-row-resize" />
      )}
    </div>
  )
}
