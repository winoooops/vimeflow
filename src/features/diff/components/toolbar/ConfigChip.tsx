import type { ReactElement } from 'react'

// Shared chrome for the labelled config chips (Highlight / Theme / View): a
// quiet outlined container that brightens on hover. The trigger BUTTON that
// owns this class is supplied by the consumer (Dropdown.renderTrigger or
// Menu.trigger) so the floating-reference ref + interaction props land on the
// real interactive element — `ConfigChipContent` only renders the inner spans.
export const CONFIG_CHIP_CLASSES =
  'inline-flex items-center gap-2 h-7 px-2.5 rounded-md bg-transparent ' +
  'border border-outline-variant/50 text-on-surface-variant ' +
  'hover:bg-surface-container hover:border-outline-variant/80 transition-colors'

export interface ConfigChipContentProps {
  // Leading material-symbol glyph (e.g. `palette` for Theme, `tune` for View).
  icon: string
  // Small-caps key shown beside the value (e.g. `Highlight`, `Theme`). Omit for
  // a value-only chip (e.g. `View`), where the value itself names the control.
  label?: string
  // Resolved value text (e.g. `Word`, `catppuccin-mocha`, `View`).
  value: string
}

// Inner content of a config chip: lead glyph + optional small-caps key + value
// + a caret. Rendered inside a consumer-owned <button> so the key lives INSIDE
// the control rather than floating as an all-caps caption in the toolbar gaps.
export const ConfigChipContent = ({
  icon,
  label = undefined,
  value,
}: ConfigChipContentProps): ReactElement => (
  <>
    <span
      aria-hidden="true"
      className="material-symbols-outlined text-[0.9375rem] leading-none"
    >
      {icon}
    </span>
    {label !== undefined ? (
      <span className="font-mono text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-on-surface-muted">
        {label}
      </span>
    ) : null}
    <span className="font-mono text-[0.6875rem] font-medium truncate max-w-[8rem]">
      {value}
    </span>
    <span
      aria-hidden="true"
      className="material-symbols-outlined text-sm leading-none text-on-surface-muted"
    >
      expand_more
    </span>
  </>
)
