import type { ReactElement } from 'react'
import { SegmentedControl } from '@/components/SegmentedControl'

export type ViewMode = 'reading' | 'source'

interface ViewModeToggleProps {
  value: ViewMode
  onChange: (next: ViewMode) => void
}

const OPTIONS = [
  { value: 'reading', label: 'Reading' },
  { value: 'source', label: 'Source' },
] as const

/**
 * Segmented Source ⇄ Reading control for the markdown reading view. Two
 * buttons, `aria-pressed` reflecting the active mode. Composed alongside (not
 * replacing) `<DockSwitcher>` in the `DockTab` children slot, shown only for
 * markdown files on the editor tab.
 */
export const ViewModeToggle = ({
  value,
  onChange,
}: ViewModeToggleProps): ReactElement => (
  <SegmentedControl
    aria-label="Markdown view mode"
    variant="dock"
    value={value}
    options={OPTIONS}
    onChange={onChange}
  />
)
