import type { ReactElement } from 'react'
import { SegmentedControl } from '@/components/SegmentedControl'
import type { ShortcutInput } from '@/lib/formatShortcut'

interface SegmentedProps<T extends string | number> {
  value: T
  options: readonly T[]
  onChange: (next: T) => void
  // Optional leading material-symbol glyph per option (keyed by the stringified
  // option value, e.g. `{ split: 'vertical_split', unified: 'view_headline' }`).
  // Options without an entry render label-only.
  icons?: Partial<Record<string, string>>
  shortcuts?: Partial<Record<string, ShortcutInput>>
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
  shortcuts = undefined,
}: SegmentedProps<T>): ReactElement => (
  <SegmentedControl
    aria-label="Diff view mode"
    value={value}
    options={options.map((option) => ({
      value: option,
      label: String(option),
      icon: icons?.[String(option)],
      tooltip: 'Toggle split/unified view',
      shortcut: shortcuts?.[String(option)],
    }))}
    onChange={onChange}
    className="rounded-lg bg-surface-container p-0.5 ring-1 ring-inset ring-outline-variant/35"
    buttonClassName="h-6 gap-1.5 rounded-md px-3 py-0 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.07em] data-[active=true]:shadow-[0_1px_4px_color-mix(in_srgb,var(--color-primary)_35%,transparent)]"
    iconClassName="material-symbols-outlined text-[0.8125rem] leading-none"
  />
)
