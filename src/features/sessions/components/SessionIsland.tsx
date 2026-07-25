import { useRef, type ReactElement } from 'react'
import type { Session } from '@/features/sessions/types'
import { SessionIslandIndicator } from '@/features/sessions/components/SessionIslandIndicator'
import type { SessionIslandDisplayMode } from '@/features/sessions/utils/sessionIslandDisplay'
import { isOpenSession } from '@/features/sessions/utils/sessionStatus'

const SESSION_BATCH_SIZE = 10

export interface SessionIslandProps {
  sessions: readonly Session[]
  activeSessionId: string | null
  displayMode: SessionIslandDisplayMode
  onSessionSelect: (sessionId: string) => void
  maxVisibleSessions?: number
  showNotifications?: boolean
}

export const SessionIsland = ({
  sessions,
  activeSessionId,
  displayMode,
  onSessionSelect,
  maxVisibleSessions = SESSION_BATCH_SIZE,
  showNotifications = false,
}: SessionIslandProps): ReactElement | null => {
  const lastBatchStartRef = useRef(0)
  const openSessions = sessions.filter(isOpenSession)

  if (openSessions.length === 0) {
    return null
  }

  const activeIndex = openSessions.findIndex(
    (session) => session.id === activeSessionId
  )

  const batchSize = Math.max(
    1,
    Math.min(SESSION_BATCH_SIZE, maxVisibleSessions)
  )

  const maxBatchStart =
    Math.floor((openSessions.length - 1) / batchSize) * batchSize

  if (activeIndex >= 0) {
    // The island is paginated into stable batches once the session list exceeds
    // the visible indicator count, so selecting session 11 moves from 1-10 to
    // 11-20 instead of sliding the whole strip one dot at a time.
    lastBatchStartRef.current = Math.floor(activeIndex / batchSize) * batchSize
  } else {
    const clampedBatchStart = Math.min(lastBatchStartRef.current, maxBatchStart)
    lastBatchStartRef.current =
      Math.floor(clampedBatchStart / batchSize) * batchSize
  }

  const batchStart = lastBatchStartRef.current

  const batch = openSessions.slice(batchStart, batchStart + batchSize)

  return (
    <nav
      aria-label="Open sessions"
      className="vf-app-no-drag absolute left-1/2 top-2 z-20 flex h-[28px] -translate-x-1/2 items-center gap-[4px] rounded-[18px] border border-outline/55 bg-surface-container/90 p-[5px] shadow-none backdrop-blur-md backdrop-saturate-150"
      data-testid="session-island"
    >
      {batch.map((session, offset) => {
        const index = batchStart + offset
        const active = index === activeIndex

        return (
          <SessionIslandIndicator
            key={session.id}
            session={session}
            index={index}
            activeIndex={activeIndex}
            active={active}
            displayMode={displayMode}
            onSelect={onSessionSelect}
          />
        )
      })}

      {showNotifications && (
        // TODO(VIM-361, https://linear.app/vimeflow/issue/VIM-361): wire the
        // notification slot to real unread/background-agent state in V2.
        <span
          aria-hidden="true"
          data-testid="session-island-notifications"
          className="material-symbols-outlined ml-px grid h-[18px] w-[20px] shrink-0 place-items-center text-[16px] text-on-surface-variant"
        >
          notifications_none
        </span>
      )}
    </nav>
  )
}
