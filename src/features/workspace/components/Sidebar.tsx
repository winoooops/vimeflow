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
import {
  isOpenSessionStatus,
  pickNextVisibleSessionId,
} from '../utils/pickNextVisibleSessionId'
import { Card } from '../sessions/components/Card'

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

  // Active = open statuses (running/paused) per the canonical predicate
  // in pickNextVisibleSessionId.ts. Recent = the complement so any
  // future non-open status (e.g. `suspended`) lands in Recent rather
  // than being silently dropped from both groups.
  const activeGroup = sessions.filter((s) => isOpenSessionStatus(s.status))
  const recentGroup = sessions.filter((s) => !isOpenSessionStatus(s.status))

  // Mirror `recentGroup` into a ref synchronously on every render so
  // Framer Motion's `onReorder` callback (which can be invoked mid-drag
  // across multiple frames) reads the current value rather than the
  // closure-captured one. Without this ref, a session that transitions
  // to `completed` mid-drag re-renders Sidebar with a fresh recentGroup
  // but Framer Motion may keep dispatching the original onReorder
  // closure that captured the pre-transition recentGroup; the resulting
  // `[...reordered, ...staleRecentGroup]` would either drop or
  // duplicate the newly-completed session for one frame, and a
  // session-store that persists eagerly could write the stale array.
  const recentGroupRef = useRef(recentGroup)
  recentGroupRef.current = recentGroup

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
            // Mirror SessionTabs' `getElementById('session-tab-...')`
            // pattern: the overlay button carries
            // `id="sidebar-activate-${session.id}"`, so id-based lookup
            // is both consistent across the two strips AND avoids the
            // CSS-attribute-selector escaping path entirely. A session
            // id containing `"` or `]` would otherwise corrupt the
            // selector and either silently fail (`querySelector` →
            // null) or throw `SyntaxError`.
            document.getElementById(`sidebar-activate-${nextId}`)?.focus()
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
            // Preserve Recent ordering — only the Active subset reorders.
            // Read recentGroup via the ref (synced every render in the
            // outer component body) so a mid-drag status transition that
            // re-renders Sidebar can't leave Framer Motion holding a
            // stale closure that drops or duplicates the just-transitioned
            // session.
            onReorderSessions?.([...reordered, ...recentGroupRef.current])
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
              <Card
                key={session.id}
                session={session}
                variant="active"
                isActive={session.id === activeSessionId}
                onClick={onSessionClick}
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
                <Card
                  key={session.id}
                  session={session}
                  variant="recent"
                  isActive={session.id === activeSessionId}
                  onClick={onSessionClick}
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
