import type { ReactElement } from 'react'

interface ToggleProps {
  label: string
  value?: boolean
  onChange: (next: boolean) => void
}

// Chip-style boolean toggle. Uses `material-symbols-outlined` glyphs
// (`check_box` / `check_box_outline_blank`) inside the chip for a visual
// cue alongside the chip tint shift. `value` defaults to `false` so the
// jsx-boolean-value rule's `assumeUndefinedIsFalse` shortcut works — and
// `aria-pressed` is set explicitly via the ternary so React always emits
// the WAI-ARIA `"true"` / `"false"` strings regardless of whether the
// boolean reaches React as `false` or `undefined`.
export const Toggle = ({
  label,
  value = false,
  onChange,
}: ToggleProps): ReactElement => (
  <button
    type="button"
    onClick={(): void => onChange(!value)}
    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[0.7rem] font-medium transition-colors ${
      value
        ? 'bg-primary/20 text-primary hover:bg-primary/30'
        : 'bg-surface-container/40 text-on-surface-variant hover:text-on-surface hover:bg-surface-container/60'
    }`}
    aria-pressed={value ? 'true' : 'false'}
  >
    <span
      aria-hidden="true"
      className="material-symbols-outlined text-base leading-none"
    >
      {value ? 'check_box' : 'check_box_outline_blank'}
    </span>
    {label}
  </button>
)
