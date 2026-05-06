import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactElement,
} from 'react'
import { motion, Reorder } from 'framer-motion'
import type { Session } from '../types'
import type { FileNode } from '../../files/types'
import type { AgentStatus } from '../../agent-status/types'
import { FileExplorer } from './panels/FileExplorer'
import { SidebarStatusHeader } from './SidebarStatusHeader'
import { StatusDot } from './StatusDot'
import { formatRelativeTime } from '../../agent-status/utils/relativeTime'
import { useRenameState } from '../hooks/useRenameState'
import { pickNextVisibleSessionId } from '../utils/pickNextVisibleSessionId'

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

// Bright pills — Active group rows. Vivid bg + saturated text.
const STATE_PILL_TONE: Record<Session['status'], string> = {
  running: 'text-success bg-success/10',
  paused: 'text-warning bg-warning/10',
  completed: 'text-success-muted bg-success-muted/10',
  errored: 'text-error bg-error/15',
}

// Dim pills — Recent group rows. Lower bg opacity + softer text so the
// row reads as historical chrome rather than competing with the Active
// group above.
const STATE_PILL_TONE_DIM: Record<Session['status'], string> = {
  running: 'text-success/70 bg-success/5',
  paused: 'text-warning/70 bg-warning/5',
  completed: 'text-success-muted/70 bg-success-muted/5',
  errored: 'text-error/80 bg-error/8',
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
  const {
    isEditing,
    editValue,
    setEditValue,
    inputRef,
    beginEdit,
    commitRename,
    cancelRename,
  } = useRenameState(session, onRename)

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
        relative mb-1 cursor-grab rounded-[8px] px-3 py-2.5 transition-colors
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

      {/* Click-to-activate button covers the whole row as an absolute
          background layer. The foreground content (rendered as plain
          divs/spans) sits above with `pointer-events-none` so clicks
          fall through to this button — except for interactive bits
          (rename input, hover buttons) which opt back in via
          `pointer-events-auto`. This avoids nesting the rename
          <input> inside <button>, which the HTML spec forbids and
          Firefox/Safari mishandle for keyboard focus. */}
      <button
        type="button"
        onClick={() => onSessionClick(session.id)}
        aria-label={session.name}
        className="absolute inset-0 rounded-[8px]"
        tabIndex={isEditing ? -1 : 0}
      />

      <div className="pointer-events-none relative flex flex-col gap-1">
        <div className="flex items-center gap-2">
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
                  cancelRename()
                }
              }}
              className="pointer-events-auto min-w-0 flex-1 truncate rounded bg-surface-container-high px-1 font-label text-[13px] font-semibold text-on-surface outline-none ring-1 ring-primary"
              aria-label="Rename session"
            />
          ) : (
            // Span opts back into pointer events for double-click rename.
            // Without an explicit onClick, single clicks would NOT bubble
            // to the sibling absolute button (the button is no longer an
            // ancestor) — primary row activation would silently break.
            <span
              // aria-hidden so AT doesn't announce the name twice — the
              // sibling overlay button already carries aria-label=name.
              // Subtitle / state pill / line-delta stay traversable.
              aria-hidden="true"
              className="pointer-events-auto min-w-0 flex-1 cursor-pointer truncate font-label text-[13px] font-semibold text-on-surface"
              onClick={() => onSessionClick(session.id)}
              onDoubleClick={(e) => {
                if (!onRename) {
                  return
                }
                e.stopPropagation()
                beginEdit()
              }}
            >
              {session.name}
            </span>
          )}
          {/* Hide on hover so the absolute-positioned edit/close
              actions in the top-right corner don't overlap it. */}
          <span className="shrink-0 font-mono text-[10px] text-on-surface-variant/70 transition-opacity group-hover:opacity-0">
            {formatRelativeTime(session.lastActivityAt)}
          </span>
        </div>

        <div className="block truncate pl-[15px] font-label text-[11.5px] text-on-surface-variant">
          {subtitle}
        </div>

        <div className="flex items-center gap-2 pl-[15px] font-mono text-[10px]">
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
        </div>
      </div>

      <div className="pointer-events-auto absolute right-2 top-2 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {onRename && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              beginEdit()
            }}
            className="rounded p-0.5 text-on-surface-variant/60 transition-colors hover:bg-surface-container-high hover:text-on-surface"
            aria-label="Rename session"
            title="Rename"
          >
            <span className="material-symbols-outlined text-sm">edit</span>
          </button>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRemove(session.id)
            }}
            className="rounded p-0.5 text-on-surface-variant/60 transition-colors hover:bg-error/20 hover:text-error"
            aria-label="Remove session"
            title="Remove"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        )}
      </div>
    </Reorder.Item>
  )
}

const RecentSessionRow = ({
  session,
  isActive,
  onSessionClick,
  onRemove = undefined,
  onRename = undefined,
}: SessionRowProps): ReactElement => {
  const {
    isEditing,
    editValue,
    setEditValue,
    inputRef,
    beginEdit,
    commitRename,
    cancelRename,
  } = useRenameState(session, onRename)

  const { added, removed } = sessionLineDelta(session)
  const subtitle = sessionSubtitle(session)

  return (
    <li
      data-testid="recent-session-row"
      data-session-id={session.id}
      data-active={isActive}
      className={`
        group relative mb-1 rounded-[8px] px-3 py-2 transition-colors
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
      {/* Same overlay pattern as SessionRow — see HTML-validity comment
          there. <input> can't legally nest inside <button>. */}
      <button
        type="button"
        onClick={() => onSessionClick(session.id)}
        aria-label={session.name}
        className="absolute inset-0 rounded-[8px]"
        tabIndex={isEditing ? -1 : 0}
      />
      <div className="pointer-events-none relative flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <StatusDot status={session.status} size={6} dim />
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
                  cancelRename()
                }
              }}
              className="pointer-events-auto min-w-0 flex-1 truncate rounded bg-surface-container-high px-1 font-label text-[12.5px] text-on-surface outline-none ring-1 ring-primary"
              aria-label="Rename session"
            />
          ) : (
            // Same activation+rename split as SessionRow above —
            // sibling-button overlay needs an explicit onClick here.
            <span
              // Same aria-hidden as SessionRow above — overlay button
              // owns the name announcement, span owns visual+rename.
              aria-hidden="true"
              className={`pointer-events-auto min-w-0 flex-1 cursor-pointer truncate font-label text-[12.5px] ${isActive ? 'text-on-surface' : 'text-on-surface-variant/60'}`}
              onClick={() => onSessionClick(session.id)}
              onDoubleClick={(e) => {
                if (!onRename) {
                  return
                }
                e.stopPropagation()
                beginEdit()
              }}
            >
              {session.name}
            </span>
          )}
          {/* Same hover treatment as Active rows — the remove button
              in the top-right shares horizontal space with this. */}
          <span className="shrink-0 font-mono text-[10px] text-on-surface-variant/50 transition-opacity group-hover:opacity-0">
            {formatRelativeTime(session.lastActivityAt)}
          </span>
        </div>
        <div className="flex items-center gap-2 pl-[15px] font-mono text-[10px]">
          <span
            data-testid="state-pill"
            className={`rounded-full px-1.5 py-px uppercase tracking-wide ${STATE_PILL_TONE_DIM[session.status]}`}
          >
            {STATE_PILL_LABEL[session.status]}
          </span>
          {(added > 0 || removed > 0) && (
            <span className="text-on-surface-variant/50">
              <span className="text-success/70">+{added}</span>{' '}
              <span className="text-error/70">-{removed}</span>
            </span>
          )}
          <span className="ml-auto truncate font-label text-[10.5px] text-on-surface-variant/50">
            {subtitle}
          </span>
        </div>
      </div>
      <div className="pointer-events-auto absolute right-2 top-2 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {onRename && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              beginEdit()
            }}
            className="rounded p-0.5 text-on-surface-variant/60 transition-colors hover:bg-surface-container-high hover:text-on-surface"
            aria-label="Rename session"
            title="Rename"
          >
            <span className="material-symbols-outlined text-sm">edit</span>
          </button>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRemove(session.id)
            }}
            className="rounded p-0.5 text-on-surface-variant/40 transition-colors hover:bg-error/20 hover:text-error"
            aria-label="Remove session"
            title="Remove"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        )}
      </div>
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

  // Mirror SessionTabs.handleClose using the shared visible-order helper.
  // useSessionManager.removeSession uses `flushSync` internally to apply
  // its own setActiveSessionId mid-call, so we must remove first and
  // override the selection afterward. Routing through the shared helper
  // (instead of computing next-id from `activeGroup` only) covers the
  // exited-active case: when the active session is completed/errored
  // (so it lives in `recentGroup`, not `activeGroup`), the helper still
  // produces the visually adjacent tab in the strip — matching what the
  // tab strip's own close button does for the same scenario.
  //
  // Early-return when `onRemoveSession` is undefined so this wrapper
  // stays a true no-op. Otherwise the trailing onSessionClick(nextId)
  // would silently switch the active session without removing the
  // intended one — a latent bug for callers that omit the prop.
  //
  // Focus restoration: removing the focused remove button drops DOM
  // focus to <body>; queueMicrotask defers until React commits the
  // re-render, then lands focus on the new active row's overlay
  // activation button. Mirrors SessionTabs.handleClose §4.4.3 behavior
  // for keyboard users who navigate via group-focus-within.
  const handleRemoveSession = onRemoveSession
    ? (id: string): void => {
        const nextId =
          id === activeSessionId
            ? pickNextVisibleSessionId(sessions, id, activeSessionId)
            : undefined
        onRemoveSession(id)
        if (nextId !== undefined) {
          onSessionClick(nextId)
          queueMicrotask(() => {
            document
              .querySelector<HTMLElement>(
                `[data-session-id="${nextId}"] button[aria-label]`
              )
              ?.focus()
          })
        }
      }
    : undefined

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

      {/* GroupHeader carries its own px-3/pt-2/pb-1; outer flex row only
          adds the right-side gutter for the Add button so the Active
          label stays horizontally aligned with the Recent label below. */}
      <div className="flex items-center justify-between pr-3">
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

      <motion.div
        data-testid="session-scroll"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        layoutScroll
      >
        <Reorder.Group
          axis="y"
          values={activeGroup}
          onReorder={(reordered) => {
            // Recompute Recent inside the callback — vimeflow runs AI
            // agents that can complete a task mid-drag, flipping a
            // running session to completed. The closure-captured
            // `recentGroup` would either drop that session or land it in
            // the wrong slice; reading from `sessions` here is always
            // current.
            const freshRecent = sessions.filter(
              (s) => s.status === 'completed' || s.status === 'errored'
            )
            onReorderSessions?.([...reordered, ...freshRecent])
          }}
          className="flex flex-col px-2"
          data-testid="session-list"
        >
          {activeGroup.length === 0 ? (
            // Reorder.Group renders as <ul>; HTML requires <li> children
            // (or <script>/<template>). A bare <div> here is parsed in
            // quirks mode and breaks list-counting in screen readers.
            <li
              data-testid="active-empty"
              className="px-3 py-3 text-center font-label text-xs text-on-surface-variant/50"
            >
              No active sessions
            </li>
          ) : (
            activeGroup.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                onSessionClick={onSessionClick}
                onRemove={handleRemoveSession}
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
                  onRemove={handleRemoveSession}
                  onRename={onRenameSession}
                />
              ))}
            </ul>
          </>
        )}
      </motion.div>

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
