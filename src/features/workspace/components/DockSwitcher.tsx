import type { ReactElement } from 'react'

export type DockPosition = 'top' | 'bottom' | 'left' | 'right'

interface DockSwitcherProps {
  position: DockPosition
  onPick: (next: DockPosition) => void
}

const OPTIONS: { id: DockPosition; label: string }[] = [
  { id: 'bottom', label: 'Bottom' },
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
]

/**
 * DockSwitcher - compact layout-position picker for DockPanel.
 */
export const DockSwitcher = ({
  position,
  onPick,
}: DockSwitcherProps): ReactElement => (
  <div className="inline-flex items-center gap-0.5 rounded-lg border border-[rgba(74,68,79,0.3)] bg-[rgba(13,13,28,0.6)] p-[3px]">
    {OPTIONS.map((option) => {
      const active = option.id === position

      return (
        <button
          key={option.id}
          type="button"
          title={`Dock: ${option.label}`}
          aria-label={`Dock: ${option.label}`}
          aria-pressed={active}
          onClick={() => onPick(option.id)}
          className={`inline-flex h-[22px] w-[26px] cursor-pointer items-center justify-center rounded-[5px] border transition-colors ${
            active
              ? 'bg-[rgba(203,166,247,0.15)] border-[rgba(203,166,247,0.45)] text-[#cba6f7]'
              : 'border-transparent bg-transparent text-[#8a8299] hover:text-[#e2c7ff]'
          }`}
        >
          <DockGlyph position={option.id} />
        </button>
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
