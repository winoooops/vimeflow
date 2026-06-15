import type { ReactElement } from 'react'
import { SegmentedControl } from '@/components/SegmentedControl'

interface SegmentedProps<T extends string | number> {
  value: T
  options: readonly T[]
  onChange: (next: T) => void
}

// Pill segmented control. The active option uses primary tones for emphasis;
// inactive options sit on the surface tint and shift to the on-surface tone
// on hover. Generic over string | number so future non-string enums (e.g.
// numeric font-size buckets) can use the same primitive without copy-paste.
export const Segmented = <T extends string | number>({
  value,
  options,
  onChange,
}: SegmentedProps<T>): ReactElement => (
  <SegmentedControl
    aria-label="Diff view mode"
    value={value}
    options={options.map((option) => ({
      value: option,
      label: String(option),
    }))}
    onChange={onChange}
  />
)
