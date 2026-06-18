import type { ReactElement } from 'react'
import { SegmentedControl } from '@/components/SegmentedControl'

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
  <SegmentedControl
    aria-label="Dock position"
    variant="framed"
    value={position}
    options={OPTIONS.map((option) => ({
      value: option.id,
      label: `Dock: ${option.label}`,
      tooltip: `Dock: ${option.label}`,
    }))}
    onChange={onPick}
    renderOption={(option) => <DockGlyph position={option.value} />}
  />
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
