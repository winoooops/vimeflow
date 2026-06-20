import type { ReactElement } from 'react'
import type { ToolCallsView } from '../../hooks/useToolCallsView'

interface SwitchOption {
  id: ToolCallsView
  icon: string
  label: string
}

const OPTIONS: readonly SwitchOption[] = [
  { id: 'jar', icon: 'grid_view', label: 'Packed view' },
  { id: 'tags', icon: 'sell', label: 'Tag view' },
]

export interface ToolCallsViewSwitchProps {
  view: ToolCallsView
  onChange: (view: ToolCallsView) => void
}

/**
 * A two-button segmented control toggling the Tool Calls section between the
 * Packed and Tags views.
 */
export const ToolCallsViewSwitch = ({
  view,
  onChange,
}: ToolCallsViewSwitchProps): ReactElement => (
  <div
    role="group"
    aria-label="Tool calls view"
    className="inline-flex gap-0.5 rounded-[7px] p-0.5"
    style={{
      background:
        'color-mix(in srgb, var(--color-surface-container-lowest) 55%, transparent)',
      border:
        '1px solid color-mix(in srgb, var(--color-outline) 25%, transparent)',
    }}
  >
    {OPTIONS.map((option) => {
      const active = view === option.id

      return (
        // eslint-disable-next-line vimeflow/no-raw-icon-button -- compact 22×18 segmented toggle with an accent-fill active state; IconButton's fixed sizing/variants can't express this segmented control
        <button
          key={option.id}
          type="button"
          aria-label={option.label}
          aria-pressed={active}
          onClick={() => onChange(option.id)}
          className="grid h-[18px] w-[22px] cursor-pointer place-items-center rounded-[5px] border-0 p-0"
          style={{
            background: active
              ? 'color-mix(in srgb, var(--color-primary-container) 22%, transparent)'
              : 'transparent',
            color: active
              ? 'var(--color-primary)'
              : 'var(--color-on-surface-muted)',
          }}
        >
          <span
            aria-hidden="true"
            className="material-symbols-outlined text-[13px] leading-none"
          >
            {option.icon}
          </span>
        </button>
      )
    })}
  </div>
)
