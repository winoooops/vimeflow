import type { ReactElement } from 'react'
import { Toggle as SharedToggle } from '@/components/Toggle'

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
  <SharedToggle label={label} value={value} onChange={onChange} />
)
