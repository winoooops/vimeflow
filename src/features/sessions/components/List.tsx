import { useCallback, useRef, type ReactElement } from 'react'
import { motion } from 'framer-motion'
import type { Session, SessionCloseResult } from '../types'
import { Card } from './Card'
import { Group } from './Group'
import { isOpenSession } from '../utils/sessionStatus'
import { pickNextVisibleSessionId } from '../utils/pickNextVisibleSessionId'
import { mediateReorder } from '../utils/mediateReorder'
import {
  BUILTIN_PANE_LAYOUT_REGISTRY,
  type PaneLayoutRegistry,
} from '../../terminal/layout-registry'

export interface ListProps {
  sessions: Session[]
  activeSessionId: string | null
  onSessionClick: (sessionId: string) => void
  onRemoveSession?: (sessionId: string) => SessionCloseResult
  onRenameSession?: (sessionId: string, name: string) => void
  onReorderSessions?: (sessions: Session[]) => void
  layoutRegistry?: PaneLayoutRegistry
}

export const List = ({
  sessions,
  activeSessionId,
  onSessionClick,
  onRemoveSession = undefined,
  onRenameSession = undefined,
  onReorderSessions = undefined,
  layoutRegistry = BUILTIN_PANE_LAYOUT_REGISTRY,
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
  // Returning false is the only cancellation sentinel; void means
  // close/navigation may proceed.
  //
  // Focus restoration: removing the focused remove button drops DOM
  // focus to <body>; queueMicrotask defers until React commits the
  // re-render, then lands focus on the new active row's overlay
  // activation button. Mirrors SessionTabs.handleClose §4.4.3 behavior
  // for keyboard users who navigate via group-focus-within.
  const handleRemoveSession = useCallback(
    (id: string): void => {
      if (!onRemoveSession) {
        return
      }

      const nextId =
        id === activeSessionId
          ? pickNextVisibleSessionId(sessions, id, activeSessionId)
          : undefined
      const didRemove = onRemoveSession(id)
      if (didRemove === false) {
        return
      }

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
              layoutRegistry={layoutRegistry}
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
                  layoutRegistry={layoutRegistry}
                />
              ))}
            </Group>
          </>
        )}
      </motion.div>
    </>
  )
}
