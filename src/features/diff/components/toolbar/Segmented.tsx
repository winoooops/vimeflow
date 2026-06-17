import type { ReactElement } from 'react'

interface SegmentedProps<T extends string | number> {
  value: T
  options: readonly T[]
  onChange: (next: T) => void
  // Optional leading material-symbol glyph per option (keyed by the stringified
  // option value, e.g. `{ split: 'vertical_split', unified: 'view_headline' }`).
  // Options without an entry render label-only.
  icons?: Partial<Record<string, string>>
}

// Segmented control on a recessed track: the active option rides an accent
// `primary` thumb (with a soft accent-tinted shadow), inactive options sit
// quietly on the tonal track and lift to the on-surface tone on hover. The
// 24px buttons + 2px track padding give the toolbar's shared 28px rhythm.
// Generic over string | number so future non-string enums (e.g. numeric
// font-size buckets) can reuse the primitive without copy-paste.
export const Segmented = <T extends string | number>({
  value,
  options,
  onChange,
  icons = undefined,
}: SegmentedProps<T>): ReactElement => (
  <span className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-container ring-1 ring-inset ring-outline-variant/35">
    {options.map((option) => {
      const active = option === value
      const icon = icons?.[String(option)]

      return (
        <button
          key={String(option)}
          type="button"
          onClick={(): void => onChange(option)}
          aria-pressed={active}
          className={`inline-flex items-center gap-1.5 h-6 px-3 rounded-md font-mono text-[0.625rem] font-semibold uppercase tracking-[0.07em] transition-colors ${
            active
              ? 'bg-primary text-on-primary shadow-[0_1px_4px_color-mix(in_srgb,var(--color-primary)_35%,transparent)]'
              : 'text-on-surface-variant hover:text-on-surface'
          }`}
        >
          {icon !== undefined ? (
            <span
              aria-hidden="true"
              className="material-symbols-outlined text-[0.8125rem] leading-none"
            >
              {icon}
            </span>
          ) : null}
          {String(option)}
        </button>
      )
    })}
  </span>
)
