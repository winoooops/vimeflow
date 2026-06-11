import type { ReactElement } from 'react'
import type { DockPosition } from './DockSwitcher'

interface DockPeekButtonProps {
  position: DockPosition
  onOpen: () => void
}

// Peek icons point toward the expansion direction.
const ICON: Record<DockPosition, string> = {
  top: 'expand_more',
  bottom: 'expand_less',
  left: 'chevron_right',
  right: 'chevron_left',
}

const ARIA: Record<DockPosition, string> = {
  top: 'Show panel docked top',
  bottom: 'Show panel docked bottom',
  left: 'Show panel docked left',
  right: 'Show panel docked right',
}

export const DockPeekButton = ({
  position,
  onOpen,
}: DockPeekButtonProps): ReactElement => {
  const isVertical = position === 'top' || position === 'bottom'

  const sizeClass = isVertical ? 'h-[26px] w-full' : 'h-full w-[26px]'

  const borderClass =
    position === 'top'
      ? 'border-b border-outline-variant/25'
      : position === 'bottom'
        ? 'border-t border-outline-variant/25'
        : position === 'left'
          ? 'border-r border-outline-variant/25'
          : 'border-l border-outline-variant/25'

  return (
    <button
      type="button"
      aria-label={ARIA[position]}
      onClick={onOpen}
      className={`flex cursor-pointer items-center justify-center gap-2 bg-surface-container-lowest text-on-surface-muted transition-colors hover:bg-primary-container/10 hover:text-primary ${sizeClass} ${borderClass}`}
    >
      <span
        className="material-symbols-outlined text-[14px]"
        aria-hidden="true"
      >
        {ICON[position]}
      </span>
      {isVertical && (
        <span className="font-mono text-[10.5px] tracking-wide">
          show panel
        </span>
      )}
    </button>
  )
}
