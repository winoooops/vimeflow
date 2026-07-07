import { type ReactElement } from 'react'
import type { BaseDiffOptions } from '@pierre/diffs'
import { type DropdownOption } from '@/components/Dropdown'
import { Menu } from '@/components/Menu'
import { CONFIG_CHIP_CLASSES, ConfigChipContent } from './ConfigChip'

// Pierre option subtypes — same pattern as DiffChipToolbar.tsx so a Pierre
// version bump that widens / renames the enums is caught at type-check time.
type DiffIndicators = NonNullable<BaseDiffOptions['diffIndicators']>
type Overflow = NonNullable<BaseDiffOptions['overflow']>

// Hardcoded enum lists for the nested sub-dropdowns. Mirrors the same
// constants that DiffChipToolbar.tsx used to host before consolidation —
// they moved here because ViewSettingsDropdown is now the only consumer.
export const VIEW_INDICATOR_OPTIONS: readonly DropdownOption<DiffIndicators>[] =
  [
    {
      value: 'classic',
      label: 'classic',
      description: 'Plus and minus glyphs',
    },
    { value: 'bars', label: 'bars', description: 'Colored gutter bars' },
    { value: 'none', label: 'none', description: 'No indicator column' },
  ]

export const VIEW_OVERFLOW_OPTIONS: readonly DropdownOption<Overflow>[] = [
  {
    value: 'scroll',
    label: 'scroll',
    description: 'Horizontal scroll for long lines',
  },
  {
    value: 'wrap',
    label: 'wrap',
    description: 'Soft-wrap long lines to next row',
  },
]

export interface ViewSettingsDropdownProps {
  diffIndicators: DiffIndicators
  onDiffIndicatorsChange: (next: DiffIndicators) => void
  overflow: Overflow
  onOverflowChange: (next: Overflow) => void
  disableLineNumbers: boolean
  onDisableLineNumbersChange: (next: boolean) => void
  disableBackground: boolean
  onDisableBackgroundChange: (next: boolean) => void
  disableFileHeader: boolean
  onDisableFileHeaderChange: (next: boolean) => void
  stickyHeader: boolean
  onStickyHeaderChange: (next: boolean) => void
}

// Consolidated "View ▾" gear chip backed by the shared Menu primitive. Hosts
// the 2 Format selectors (Indicators / Overflow) as Menu.Submenu rows and the
// 4 View Options booleans as Menu.Checkbox rows. Replaces 6 separate chips in
// DiffChipToolbar so the toolbar is materially shorter and the 4 boolean
// toggles no longer stack as a wall of lavender pills in the Priority+
// overflow menu. Menu owns the floating-surface, one-open-submenu, and
// outside-press-inside-submenu behavior that this file used to hand-roll.
export const ViewSettingsDropdown = ({
  diffIndicators,
  onDiffIndicatorsChange,
  overflow,
  onOverflowChange,
  disableLineNumbers,
  onDisableLineNumbersChange,
  disableBackground,
  onDisableBackgroundChange,
  disableFileHeader,
  onDisableFileHeaderChange,
  stickyHeader,
  onStickyHeaderChange,
}: ViewSettingsDropdownProps): ReactElement => (
  <Menu
    placement="bottom-end"
    aria-label="View settings"
    trigger={
      <button
        type="button"
        aria-label="View settings"
        className={CONFIG_CHIP_CLASSES}
      >
        <ConfigChipContent icon="tune" value="View" />
      </button>
    }
  >
    <Menu.Section label="Format">
      <Menu.Submenu
        label="Indicators"
        icon="flag"
        value={diffIndicators}
        options={VIEW_INDICATOR_OPTIONS}
        onChange={onDiffIndicatorsChange}
      />
      <Menu.Submenu
        label="Overflow"
        icon="wrap_text"
        value={overflow}
        options={VIEW_OVERFLOW_OPTIONS}
        onChange={onOverflowChange}
      />
    </Menu.Section>
    <Menu.Section label="View options">
      <Menu.Checkbox
        icon="123"
        checked={!disableLineNumbers}
        onChange={(next): void => onDisableLineNumbersChange(!next)}
      >
        Line numbers
      </Menu.Checkbox>
      <Menu.Checkbox
        icon="format_paint"
        checked={!disableBackground}
        onChange={(next): void => onDisableBackgroundChange(!next)}
      >
        Background tint
      </Menu.Checkbox>
      <Menu.Checkbox
        icon="description"
        checked={!disableFileHeader}
        onChange={(next): void => onDisableFileHeaderChange(!next)}
      >
        File header
      </Menu.Checkbox>
      <Menu.Checkbox
        icon="push_pin"
        checked={stickyHeader}
        onChange={onStickyHeaderChange}
      >
        Sticky header
      </Menu.Checkbox>
    </Menu.Section>
  </Menu>
)
