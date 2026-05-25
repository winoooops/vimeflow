import type { ReactElement } from 'react'

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
  <span className="inline-flex items-center gap-0.5 bg-surface-container/40 rounded-full p-0.5">
    {options.map((option) => {
      const active = option === value

      return (
        <button
          key={String(option)}
          type="button"
          onClick={(): void => onChange(option)}
          aria-pressed={active}
          className={`px-3 py-1 rounded-full text-[0.65rem] font-bold uppercase tracking-wider transition-colors ${
            active
              ? 'bg-primary text-on-primary'
              : 'text-on-surface-variant hover:text-on-surface'
          }`}
        >
          {String(option)}
        </button>
      )
    })}
  </span>
)
