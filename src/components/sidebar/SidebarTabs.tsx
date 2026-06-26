import { type ReactElement, type ReactNode } from 'react'
import { SegmentedControl } from '@/components/SegmentedControl'
import { type ShortcutInput } from '../../lib/formatShortcut'

export interface SidebarTabItem<TId extends string = string> {
  id: TId
  label: string
  icon?: string
  /** Optional tooltip body shown on hover/focus. */
  tooltip?: ReactNode
  /** Optional keyboard-shortcut chip rendered inside the tooltip. */
  shortcut?: ShortcutInput
}

export interface SidebarTabsProps<TId extends string = string> {
  tabs: readonly SidebarTabItem<TId>[]
  activeId: TId
  onChange: (id: TId) => void
  'aria-label'?: string
  'data-testid'?: string
}

const SIDEBAR_TABS_W = 202

export const SidebarTabs = <TId extends string = string>({
  tabs,
  activeId,
  onChange,
  'aria-label': ariaLabel = 'Sidebar tabs',
  'data-testid': testId = 'sidebar-tabs',
}: SidebarTabsProps<TId>): ReactElement => (
  <SegmentedControl
    aria-label={ariaLabel}
    data-testid={testId}
    variant="sidebar"
    value={activeId}
    options={tabs.map((tab) => ({
      value: tab.id,
      label: tab.label,
      icon: tab.icon,
    }))}
    onChange={onChange}
    style={{ width: SIDEBAR_TABS_W }}
    thumbTestId="sidebar-tabs-thumb"
    iconClassName="material-symbols-outlined text-[15px]"
    fillActiveIcon
  />
)
