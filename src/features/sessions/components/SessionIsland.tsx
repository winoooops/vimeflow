import { useRef, type CSSProperties, type ReactElement } from 'react'
import { Tooltip } from '@/components/Tooltip'
import type { Session } from '../types'
import { isOpenSession } from '../utils/sessionStatus'
import type { SessionIslandDisplayMode } from '../utils/sessionIslandDisplay'

const SESSION_BATCH_SIZE = 10
const ACTIVE_INDICATOR_WIDTH_PX = 48
const ACTIVE_LABEL_MAX_WIDTH_PX = 160

export interface SessionIslandProps {
  sessions: readonly Session[]
  activeSessionId: string | null
  displayMode: SessionIslandDisplayMode
  onSessionSelect: (sessionId: string) => void
  showNotifications?: boolean
}

const activeLabelWidth = (name: string): number =>
  Math.min(
    ACTIVE_LABEL_MAX_WIDTH_PX,
    Math.max(ACTIVE_INDICATOR_WIDTH_PX, Array.from(name).length * 7 + 24)
  )

const indicatorText = (
  session: Session,
  index: number,
  active: boolean,
  displayMode: SessionIslandDisplayMode
): string => {
  if (displayMode === 'numbers') {
    return String(index + 1)
  }

  return displayMode === 'labels' && active ? session.name : ''
}

const indicatorPositionClass = (index: number, activeIndex: number): string => {
  if (index === activeIndex) {
    return 'w-[48px] bg-primary text-on-primary'
  }

  return activeIndex >= 0 && index < activeIndex
    ? 'bg-secondary text-on-secondary'
    : 'bg-secondary/55 text-on-secondary'
}

export const SessionIsland = ({
  sessions,
  activeSessionId,
  displayMode,
  onSessionSelect,
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

  const maxBatchStart =
    Math.floor((openSessions.length - 1) / SESSION_BATCH_SIZE) *
    SESSION_BATCH_SIZE

  if (activeIndex >= 0) {
    lastBatchStartRef.current =
      Math.floor(activeIndex / SESSION_BATCH_SIZE) * SESSION_BATCH_SIZE
  } else {
    lastBatchStartRef.current = Math.min(
      lastBatchStartRef.current,
      maxBatchStart
    )
  }

  const batchStart = lastBatchStartRef.current

  const batch = openSessions.slice(batchStart, batchStart + SESSION_BATCH_SIZE)

  return (
    <nav
      aria-label="Open sessions"
      className="vf-app-no-drag absolute left-1/2 top-2 z-20 flex h-[28px] -translate-x-1/2 items-center gap-[4px] rounded-[18px] border border-outline/55 bg-surface-container/90 p-[5px] shadow-none backdrop-blur-md backdrop-saturate-150"
      data-testid="session-island"
    >
      {batch.map((session, offset) => {
        const index = batchStart + offset
        const active = index === activeIndex
        const text = indicatorText(session, index, active, displayMode)

        const style: CSSProperties | undefined =
          active && displayMode === 'labels'
            ? { width: activeLabelWidth(session.name) }
            : undefined

        return (
          <Tooltip
            key={session.id}
            content={session.name}
            placement="bottom"
            nativeOverlay
          >
            <button
              type="button"
              aria-label={`Switch to session ${index + 1}: ${session.name}`}
              aria-current={active ? 'page' : undefined}
              data-testid={`session-island-indicator-${session.id}`}
              onClick={(): void => onSessionSelect(session.id)}
              style={style}
              className={`grid h-[16px] w-[16px] shrink-0 place-items-center overflow-hidden rounded-full border-0 p-0 font-mono text-[9px] font-extrabold opacity-100 transition-[width,background-color,color,opacity] duration-[222.222ms] ease-[cubic-bezier(.333333,1,.666667,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 motion-reduce:duration-[1ms] ${indicatorPositionClass(
                index,
                activeIndex
              )}`}
            >
              {displayMode === 'labels' && active ? (
                <span className="w-full truncate px-2">{text}</span>
              ) : (
                text
              )}
            </button>
          </Tooltip>
        )
      })}

      {showNotifications && (
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
