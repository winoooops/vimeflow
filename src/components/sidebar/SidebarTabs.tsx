import { type ReactElement } from 'react'
import { SegmentedControl } from '@/components/SegmentedControl'

export interface SidebarTabItem<TId extends string = string> {
  id: TId
  label: string
  icon?: string
}

export interface SidebarTabsProps<TId extends string = string> {
  tabs: readonly SidebarTabItem<TId>[]
  activeId: TId
  onChange: (id: TId) => void
  'aria-label'?: string
  'data-testid'?: string
}

// Recessed segmented-control track (per the SidebarViewSwitcher handoff): the
// active segment is a sliding lavender thumb behind the buttons, not a per-tab
// border. role="group" + aria-pressed — v1 ships no roving/arrow keyboard
// contract, so this stays an honest group rather than a tablist/toolbar.
//
// 202px is the default sidebar row width left over for this switcher:
// 272px sidebar - 24px row padding - 8px gap - 38px new-session button.
// Keep it fixed so resizing the sidebar never stretches or squashes the tabs.
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
