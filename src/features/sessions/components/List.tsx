import { useCallback, useRef, type ReactElement } from 'react'
import { motion } from 'framer-motion'
import type { Session, SessionCloseResult } from '../types'
import { Card } from './Card'
import { Group } from './Group'
import { isOpenSession } from '../utils/sessionStatus'
import { closeSessionWithSuccessor } from '../utils/closeSessionWithSuccessor'
import { mediateReorder } from '../utils/mediateReorder'

export interface ListProps {
  sessions: Session[]
  activeSessionId: string | null
  onSessionClick: (sessionId: string) => void
  onRemoveSession?: (sessionId: string) => SessionCloseResult
  onRenameSession?: (sessionId: string, name: string) => void
  onReorderSessions?: (sessions: Session[]) => void
}

export const List = ({
  sessions,
  activeSessionId,
  onSessionClick,
  onRemoveSession = undefined,
  onRenameSession = undefined,
  onReorderSessions = undefined,
}: ListProps): ReactElement => {
  // Active = open statuses (running/paused) per the canonical predicate
  // in pickNextVisibleSessionId.ts. Recent = the complement so any
  // future non-open status (e.g. `suspended`) lands in Recent rather
  // than being silently dropped from both groups.
  const activeGroup = sessions.filter(isOpenSession)
  const recentGroup = sessions.filter((s) => !isOpenSession(s))

  // Mirror `recentGroup` into a ref synchronously on every render so
  // Framer Motion's `onReorder` callback reads the current Recent section
  // rather than a closure-captured one. Without this ref, a session that
  // transitions to `completed` mid-drag could be appended from a stale
  // Recent snapshot when the reordered Active subset is committed.
  const recentGroupRef = useRef(recentGroup)
  recentGroupRef.current = recentGroup

  const handleActiveReorder = useCallback(
    (reordered: Session[]): void => {
      onReorderSessions?.(mediateReorder(reordered, recentGroupRef.current))
    },
    [onReorderSessions]
  )

  // Delegates to the shared close-with-successor helper (mirrors SessionTabs.handleClose).
  // Guarding on `onRemoveSession` keeps this a true no-op for callers that omit the prop.
  // Microtask defers focus until React commits the removal's re-render.
  const handleRemoveSession = useCallback(
    (id: string): void => {
      if (!onRemoveSession) {
        return
      }

      closeSessionWithSuccessor(id, {
        sessions,
        activeSessionId,
        removeSession: onRemoveSession,
        activateSession: onSessionClick,
        focusSuccessor: (nextId) => {
          queueMicrotask(() => {
            document.getElementById(`sidebar-activate-${nextId}`)?.focus()
          })
        },
      })
    },
    [activeSessionId, onRemoveSession, onSessionClick, sessions]
  )

  const cardRemoveSession = onRemoveSession ? handleRemoveSession : undefined

  return (
    <>
      <Group.Header label="Active" count={activeGroup.length} />

      <motion.div
        data-testid="session-scroll"
        // Global scrollbar styles in base.css cover WebKitGTK via
        // `::-webkit-scrollbar` pseudo-elements. `overflow-x-clip` keeps the
        // scroller vertical-only (CSS spec coerces `overflow-x: visible` to
        // `auto` when y is `auto`).
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-clip"
        layoutScroll
      >
        <Group
          variant="active"
          sessions={activeGroup}
          onReorder={handleActiveReorder}
          emptyState={
            <li
              data-testid="active-empty"
              className="px-3 py-3 text-center font-label text-xs text-on-surface-variant/50"
            >
              No active sessions
            </li>
          }
        >
          {activeGroup.map((session) => (
            <Card
              key={session.id}
              session={session}
              variant="active"
              isActive={session.id === activeSessionId}
              onClick={onSessionClick}
              onRemove={cardRemoveSession}
              onRename={onRenameSession}
            />
          ))}
        </Group>

        {recentGroup.length > 0 && (
          <>
            <Group.Header label="Recent" count={recentGroup.length} />
            <Group variant="recent" sessions={recentGroup}>
              {recentGroup.map((session) => (
                <Card
                  key={session.id}
                  session={session}
                  variant="recent"
                  isActive={session.id === activeSessionId}
                  onClick={onSessionClick}
                  onRemove={cardRemoveSession}
                  onRename={onRenameSession}
                />
              ))}
            </Group>
          </>
        )}
      </motion.div>
    </>
  )
}
