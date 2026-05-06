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
import type { AgentStatus } from '../../agent-status/types'
import { FileExplorer } from './panels/FileExplorer'
import { SidebarStatusHeader } from './SidebarStatusHeader'
import { StatusDot } from './StatusDot'
import { formatRelativeTime } from '../../agent-status/utils/relativeTime'

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

const sessionSubtitle = (session: Session): string => {
  if (session.currentAction !== undefined && session.currentAction !== '') {
    return session.currentAction
  }
  const parts = session.workingDirectory.split('/').filter(Boolean)

  return parts.length > 0 ? parts[parts.length - 1] : session.workingDirectory
}

const sessionLineDelta = (
  session: Session
): { added: number; removed: number } => {
  let added = 0
  let removed = 0
  for (const change of session.activity.fileChanges) {
    added += change.linesAdded
    removed += change.linesRemoved
  }

  return { added, removed }
}

const STATE_PILL_LABEL: Record<Session['status'], string> = {
  running: 'running',
  paused: 'awaiting',
  completed: 'completed',
  errored: 'errored',
}

const STATE_PILL_TONE: Record<Session['status'], string> = {
  running: 'text-success bg-success/10',
  paused: 'text-warning bg-warning/10',
  completed: 'text-success-muted bg-success-muted/10',
  errored: 'text-error bg-error/15',
}

interface SessionRowProps {
  session: Session
  isActive: boolean
  onSessionClick: (id: string) => void
  onRemove?: (id: string) => void
  onRename?: (id: string, name: string) => void
}

const SessionRow = ({
  session,
  isActive,
  onSessionClick,
  onRemove = undefined,
  onRename = undefined,
}: SessionRowProps): ReactElement => {
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

  const { added, removed } = sessionLineDelta(session)
  const subtitle = sessionSubtitle(session)

  return (
    <Reorder.Item
      value={session}
      id={session.id}
      data-testid="session-row"
      data-session-id={session.id}
      data-active={isActive}
      className={`
        relative mb-1 cursor-grab rounded-lg px-3 py-2.5 transition-colors
        active:cursor-grabbing group
        ${
          isActive
            ? 'bg-primary/10 text-on-surface'
            : 'text-on-surface-variant hover:bg-on-surface/[0.04]'
        }
      `}
      whileDrag={{
        scale: 1.02,
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        zIndex: 50,
      }}
      layout="position"
    >
      {isActive && (
        <span
          aria-hidden="true"
          className="absolute inset-y-2 left-0 w-0.5 rounded-r bg-primary-container"
        />
      )}

      <button
        type="button"
        onClick={() => onSessionClick(session.id)}
        className="flex w-full flex-col gap-1 text-left"
        aria-label={session.name}
      >
        <span className="flex items-center gap-2">
          <StatusDot status={session.status} />
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
              className="min-w-0 flex-1 truncate rounded bg-surface-container-high px-1 font-label text-[13px] font-semibold text-on-surface outline-none ring-1 ring-primary"
              aria-label="Rename session"
            />
          ) : (
            <span
              className="min-w-0 flex-1 truncate font-label text-[13px] font-semibold text-on-surface"
              onDoubleClick={(e) => {
                e.stopPropagation()
                setEditValue(session.name)
                setIsEditing(true)
              }}
            >
              {session.name}
            </span>
          )}
          <span className="shrink-0 font-mono text-[10px] text-on-surface-variant/70">
            {formatRelativeTime(session.lastActivityAt)}
          </span>
        </span>

        <span className="block truncate pl-[15px] font-label text-[11.5px] text-on-surface-variant">
          {subtitle}
        </span>

        <span className="flex items-center gap-2 pl-[15px] font-mono text-[10px]">
          <span
            data-testid="state-pill"
            className={`rounded-full px-1.5 py-px uppercase tracking-wide ${STATE_PILL_TONE[session.status]}`}
          >
            {STATE_PILL_LABEL[session.status]}
          </span>
          {(added > 0 || removed > 0) && (
            <span
              data-testid="line-delta"
              className="text-on-surface-variant/70"
            >
              <span className="text-success">+{added}</span>{' '}
              <span className="text-error">-{removed}</span>
            </span>
          )}
        </span>
      </button>

      <div className="absolute right-2 top-2 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setEditValue(session.name)
            setIsEditing(true)
          }}
          className="rounded p-0.5 text-on-surface-variant/60 transition-colors hover:bg-surface-container-high hover:text-on-surface"
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
          className="rounded p-0.5 text-on-surface-variant/60 transition-colors hover:bg-error/20 hover:text-error"
          aria-label="Remove session"
          title="Remove"
        >
          <span className="material-symbols-outlined text-sm">close</span>
        </button>
      </div>
    </Reorder.Item>
  )
}

const RecentSessionRow = ({
  session,
  isActive,
  onSessionClick,
  onRemove = undefined,
}: SessionRowProps): ReactElement => {
  const { added, removed } = sessionLineDelta(session)
  const subtitle = sessionSubtitle(session)

  return (
    <li
      data-testid="recent-session-row"
      data-session-id={session.id}
      data-active={isActive}
      className={`
        group relative mb-1 rounded-lg px-3 py-2 transition-colors
        ${
          isActive
            ? 'bg-primary/10 text-on-surface'
            : 'text-on-surface-variant hover:bg-on-surface/[0.04]'
        }
      `}
    >
      {isActive && (
        <span
          aria-hidden="true"
          className="absolute inset-y-2 left-0 w-0.5 rounded-r bg-primary-container"
        />
      )}
      <button
        type="button"
        onClick={() => onSessionClick(session.id)}
        className="flex w-full flex-col gap-0.5 text-left"
        aria-label={session.name}
      >
        <span className="flex items-center gap-2">
          <StatusDot status={session.status} />
          <span className="min-w-0 flex-1 truncate font-label text-[12.5px] text-on-surface-variant">
            {session.name}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-on-surface-variant/70">
            {formatRelativeTime(session.lastActivityAt)}
          </span>
        </span>
        <span className="flex items-center gap-2 pl-[15px] font-mono text-[10px]">
          <span
            data-testid="state-pill"
            className={`rounded-full px-1.5 py-px uppercase tracking-wide ${STATE_PILL_TONE[session.status]}`}
          >
            {STATE_PILL_LABEL[session.status]}
          </span>
          {(added > 0 || removed > 0) && (
            <span className="text-on-surface-variant/70">
              <span className="text-success">+{added}</span>{' '}
              <span className="text-error">-{removed}</span>
            </span>
          )}
          <span className="ml-auto truncate font-label text-[10.5px] text-on-surface-variant/70">
            {subtitle}
          </span>
        </span>
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove(session.id)
          }}
          className="absolute right-2 top-2 rounded p-0.5 text-on-surface-variant/40 opacity-0 transition-all hover:bg-error/20 hover:text-error group-hover:opacity-100"
          aria-label="Remove session"
          title="Remove"
        >
          <span className="material-symbols-outlined text-sm">close</span>
        </button>
      )}
    </li>
  )
}

const GroupHeader = ({ label }: { label: string }): ReactElement => (
  <h3
    data-testid={`session-group-${label.toLowerCase()}`}
    className="px-3 pb-1 pt-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-on-surface-variant/70"
  >
    {label}
  </h3>
)

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

  const activeGroup = sessions.filter(
    (s) => s.status === 'running' || s.status === 'paused'
  )

  const recentGroup = sessions.filter(
    (s) => s.status === 'completed' || s.status === 'errored'
  )

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

      <div className="flex items-center justify-between px-3 pb-1 pt-2">
        <GroupHeader label="Active" />
        <button
          type="button"
          onClick={onNewInstance}
          className="material-symbols-outlined text-base text-on-surface-variant/60 transition-colors hover:text-primary"
          aria-label="Add session"
          title="Add session"
        >
          add
        </button>
      </div>

      <Reorder.Group
        axis="y"
        values={activeGroup}
        onReorder={(reordered) => {
          // Preserve order of recent sessions; only the active subset reorders.
          onReorderSessions?.([...reordered, ...recentGroup])
        }}
        className="flex flex-col overflow-y-auto px-2"
        data-testid="session-list"
        layoutScroll
      >
        {activeGroup.length === 0 ? (
          <div
            data-testid="active-empty"
            className="px-3 py-3 text-center font-label text-xs text-on-surface-variant/50"
          >
            No active sessions
          </div>
        ) : (
          activeGroup.map((session) => (
            <SessionRow
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

      {recentGroup.length > 0 && (
        <>
          <GroupHeader label="Recent" />
          <ul data-testid="recent-list" className="flex flex-col px-2 pb-1">
            {recentGroup.map((session) => (
              <RecentSessionRow
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                onSessionClick={onSessionClick}
                onRemove={onRemoveSession}
              />
            ))}
          </ul>
        </>
      )}

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
