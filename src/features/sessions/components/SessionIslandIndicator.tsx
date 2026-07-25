import { type CSSProperties, type ReactElement } from 'react'
import { Tooltip } from '@/components/Tooltip'
import type { Session } from '@/features/sessions/types'
import type { SessionIslandDisplayMode } from '@/features/sessions/utils/sessionIslandDisplay'

const ACTIVE_INDICATOR_WIDTH_PX = 48
const ACTIVE_LABEL_MAX_WIDTH_PX = 160

export interface SessionIslandIndicatorProps {
  session: Session
  index: number
  activeIndex: number
  active: boolean
  displayMode: SessionIslandDisplayMode
  onSelect: (sessionId: string) => void
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

export const SessionIslandIndicator = ({
  session,
  index,
  activeIndex,
  active,
  displayMode,
  onSelect,
}: SessionIslandIndicatorProps): ReactElement => {
  const text = indicatorText(session, index, active, displayMode)

  const style: CSSProperties | undefined =
    active && displayMode === 'labels'
      ? { width: activeLabelWidth(session.name) }
      : undefined

  return (
    <Tooltip
      content={session.name}
      placement="bottom"
      delayMs={0}
      nativeOverlay
    >
      <button
        type="button"
        aria-label={`Switch to session ${index + 1}: ${session.name}`}
        aria-current={active ? 'page' : undefined}
        data-testid={`session-island-indicator-${session.id}`}
        onClick={(): void => onSelect(session.id)}
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
}
