import type { ReactElement } from 'react'
import { Tooltip } from '../../../components/Tooltip'

export type DockPosition = 'top' | 'bottom' | 'left' | 'right'

interface DockSwitcherProps {
  position: DockPosition
  onPick: (next: DockPosition) => void
}

const OPTIONS: { id: DockPosition; label: string }[] = [
  { id: 'top', label: 'Top' },
  { id: 'bottom', label: 'Bottom' },
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
]

export const DockSwitcher = ({
  position,
  onPick,
}: DockSwitcherProps): ReactElement => (
  <div className="inline-flex items-center gap-0.5 rounded-lg border border-outline-variant/30 bg-surface-container-lowest/60 p-[3px]">
    {OPTIONS.map((option) => {
      const active = option.id === position

      return (
        <Tooltip
          key={option.id}
          content={`Dock: ${option.label}`}
          placement="bottom"
        >
          <button
            type="button"
            aria-label={`Dock: ${option.label}`}
            aria-pressed={active}
            onClick={() => onPick(option.id)}
            className={`inline-flex h-[22px] w-[26px] cursor-pointer items-center justify-center rounded-[5px] border transition-colors ${
              active
                ? 'bg-primary-container/15 border-primary-container/45 text-primary-container'
                : 'border-transparent bg-transparent text-on-surface-muted hover:text-primary'
            }`}
          >
            <DockGlyph position={option.id} />
          </button>
        </Tooltip>
      )
    })}
  </div>
)

const DockGlyph = ({ position }: { position: DockPosition }): ReactElement => {
  const subRect =
    position === 'top'
      ? { x: 2, y: 1.5, width: 10, height: 3 }
      : position === 'bottom'
        ? { x: 2, y: 6.5, width: 10, height: 3 }
        : position === 'left'
          ? { x: 1.6, y: 2, width: 4, height: 7 }
          : { x: 8.4, y: 2, width: 4, height: 7 }

  return (
    <svg
      width="14"
      height="11"
      viewBox="0 0 14 11"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="1"
        y="1"
        width="12"
        height="9"
        rx={1.4}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
      />
      <rect {...subRect} rx={0.6} fill="currentColor" opacity={0.55} />
    </svg>
  )
}
