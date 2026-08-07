import { useRef, type ReactElement, type ReactNode } from 'react'
import type { Session } from '@/features/sessions/types'
import { SessionIslandIndicator } from '@/features/sessions/components/SessionIslandIndicator'
import { NotificationIsland } from '@/features/sessions/components/notification/NotificationIsland'
import type { NotificationRecord } from '@/features/sessions/hooks/useNotificationCenter'
import type { SessionIslandDisplayMode } from '@/features/sessions/utils/sessionIslandDisplay'
import { isOpenSession } from '@/features/sessions/utils/sessionStatus'

const SESSION_BATCH_SIZE = 10

export interface SessionIslandNotifications {
  readonly records: readonly NotificationRecord[]
  readonly onOpen: (id: string) => void
  readonly onDismiss: (id: string) => void
  readonly onMarkAllRead: () => void
  readonly onClear: () => void
  readonly onLocalPanelOpenChange?: (open: boolean) => void
}

export interface SessionIslandProps {
  sessions: readonly Session[]
  activeSessionId: string | null
  displayMode: SessionIslandDisplayMode
  onSessionSelect: (sessionId: string) => void
  maxVisibleSessions?: number
  notifications?: SessionIslandNotifications
}

interface SessionIslandShellProps {
  readonly sessions: readonly Session[]
  readonly notifications?: SessionIslandNotifications
  readonly children: ReactNode
}

// Picks the shell that wraps the indicator strip: the plain v1 nav while the
// notifications flag is off (byte-identical chrome), or NotificationIsland —
// which owns the shell so it can morph across its four stages — once wired.
const SessionIslandShell = ({
  sessions,
  notifications = undefined,
  children,
}: SessionIslandShellProps): ReactElement => {
  if (notifications === undefined) {
    return (
      <nav
        aria-label="Open sessions"
        className="vf-app-no-drag absolute left-1/2 top-2 z-20 flex h-[28px] -translate-x-1/2 items-center gap-[4px] rounded-[18px] border border-outline/55 bg-surface-container/90 p-[5px] shadow-none backdrop-blur-md backdrop-saturate-150"
        data-testid="session-island"
      >
        {children}
      </nav>
    )
  }

  return (
    <NotificationIsland
      records={notifications.records}
      sessions={sessions}
      onOpen={notifications.onOpen}
      onDismiss={notifications.onDismiss}
      onMarkAllRead={notifications.onMarkAllRead}
      onClear={notifications.onClear}
      onLocalPanelOpenChange={notifications.onLocalPanelOpenChange}
    >
      {children}
    </NotificationIsland>
  )
}

export const SessionIsland = ({
  sessions,
  activeSessionId,
  displayMode,
  onSessionSelect,
  maxVisibleSessions = SESSION_BATCH_SIZE,
  notifications = undefined,
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

  const indicators = batch.map((session, offset) => {
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
  })

  return (
    <SessionIslandShell sessions={sessions} notifications={notifications}>
      {indicators}
    </SessionIslandShell>
  )
}
