import { type CSSProperties, type ReactElement } from 'react'

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
}: SidebarTabsProps<TId>): ReactElement => {
  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === activeId)
  )

  const thumbStyle: CSSProperties = {
    width: `calc((100% - 6px) / ${tabs.length})`,
    transform: `translateX(${activeIndex * 100}%)`,
  }

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-testid={testId}
      style={{ width: SIDEBAR_TABS_W }}
      className="relative flex min-w-0 shrink-0 rounded-[10px] border border-[rgba(74,68,79,0.3)] bg-[rgba(13,13,28,0.7)] p-[3px] shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]"
    >
      <div
        aria-hidden="true"
        data-testid="sidebar-tabs-thumb"
        style={thumbStyle}
        className="pointer-events-none absolute bottom-[3px] left-[3px] top-[3px] z-0 rounded-[7px] border border-[rgba(203,166,247,0.4)] bg-[rgba(203,166,247,0.16)] shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-transform duration-200 ease-[cubic-bezier(.4,0,.2,1)]"
      />
      {tabs.map((item) => {
        const isActive = item.id === activeId

        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={isActive}
            onClick={() => {
              onChange(item.id)
            }}
            className={`relative z-[1] flex h-[30px] min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[7px] font-mono text-[12px] font-semibold uppercase tracking-[0.08em] transition-colors ${
              isActive
                ? 'text-[#e2c7ff]'
                : 'text-[#8a8299] hover:text-[#cdc3d1]'
            }`}
          >
            {item.icon ? (
              <span
                aria-hidden="true"
                className="material-symbols-outlined text-[15px]"
                style={{ fontVariationSettings: `'FILL' ${isActive ? 1 : 0}` }}
              >
                {item.icon}
              </span>
            ) : null}
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
