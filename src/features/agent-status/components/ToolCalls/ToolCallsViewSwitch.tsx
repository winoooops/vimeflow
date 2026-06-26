import type { ReactElement } from 'react'
import { SegmentedControl } from '@/components/SegmentedControl'
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

const CONTROL_OPTIONS = OPTIONS.map((option) => ({
  value: option.id,
  label: option.label,
  ariaLabel: option.label,
  icon: option.icon,
}))

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
  <SegmentedControl
    aria-label="Tool calls view"
    variant="toolbar"
    value={view}
    options={CONTROL_OPTIONS}
    onChange={onChange}
    className="rounded-[7px] border border-outline/25 bg-surface-container-lowest/55"
    buttonClassName="h-[18px] w-[22px] rounded-[5px]"
    iconClassName="material-symbols-outlined text-[13px] leading-none"
    renderOption={(option): ReactElement => (
      <span
        aria-hidden="true"
        className="material-symbols-outlined text-[13px] leading-none"
      >
        {option.icon}
      </span>
    )}
    style={{
      background:
        'color-mix(in srgb, var(--color-surface-container-lowest) 55%, transparent)',
    }}
  />
)
