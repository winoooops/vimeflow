import { useRef, type ReactElement } from 'react'
import { motion } from 'framer-motion'
import type { Session } from '../types'
import { Card } from './Card'
import { Group } from './Group'
import {
  isOpenSessionStatus,
  pickNextVisibleSessionId,
} from '../utils/pickNextVisibleSessionId'
import { mediateReorder } from '../utils/mediateReorder'

export interface ListProps {
  sessions: Session[]
  activeSessionId: string | null
  onSessionClick: (sessionId: string) => void
  onCreateSession?: () => void
  onRemoveSession?: (sessionId: string) => void
  onRenameSession?: (sessionId: string, name: string) => void
  onReorderSessions?: (sessions: Session[]) => void
}

export const List = ({
  sessions,
  activeSessionId,
  onSessionClick,
  onCreateSession = undefined,
  onRemoveSession = undefined,
  onRenameSession = undefined,
  onReorderSessions = undefined,
}: ListProps): ReactElement => {
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
    <>
      <Group.Header label="Active" />

      <motion.div
        data-testid="session-scroll"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        layoutScroll
      >
        <Group
          variant="active"
          sessions={activeGroup}
          onReorder={(reordered) => {
            // Preserve Recent ordering — only the Active subset reorders.
            // Read recentGroup via the ref (synced every render in the
            // outer component body) so a mid-drag status transition that
            // re-renders Sidebar can't leave Framer Motion holding a
            // stale closure that drops or duplicates the just-transitioned
            // session. The concat lives in `mediateReorder` (with its own
            // unit test) so the production path and the test path share
            // one implementation.
            onReorderSessions?.(
              mediateReorder(reordered, recentGroupRef.current)
            )
          }}
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
              onRemove={handleRemoveSession}
              onRename={onRenameSession}
            />
          ))}
        </Group>

        {recentGroup.length > 0 && (
          <>
            <Group.Header label="Recent" />
            <Group variant="recent" sessions={recentGroup}>
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
            </Group>
          </>
        )}
      </motion.div>

      {onCreateSession ? (
        <div className="shrink-0 px-2 pb-2 pt-2">
          <button
            type="button"
            onClick={onCreateSession}
            className="flex w-full items-center justify-center gap-1.5 rounded-[8px] border border-outline-variant/40 bg-transparent px-3 py-2 font-label text-xs font-semibold text-on-surface-variant transition-colors hover:bg-on-surface/[0.04] hover:text-on-surface focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-container"
            aria-label="new session"
            data-testid="sessions-list-new-session"
          >
            <span
              className="material-symbols-outlined text-base"
              aria-hidden="true"
            >
              add
            </span>
            <span>new session</span>
          </button>
        </div>
      ) : null}
    </>
  )
}
