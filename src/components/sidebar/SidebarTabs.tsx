import type { ReactElement } from 'react'

export interface SidebarTabItem<TId extends string = string> {
  id: TId
  label: string
}

export interface SidebarTabsProps<TId extends string = string> {
  tabs: readonly SidebarTabItem<TId>[]
  activeId: TId
  onChange: (id: TId) => void
  'aria-label'?: string
  'data-testid'?: string
}

export const SidebarTabs = <TId extends string = string>({
  tabs,
  activeId,
  onChange,
  'aria-label': ariaLabel = 'Sidebar tabs',
  'data-testid': testId = 'sidebar-tabs',
}: SidebarTabsProps<TId>): ReactElement => (
  <div
    role="toolbar"
    aria-label={ariaLabel}
    data-testid={testId}
    className="flex flex-row items-center gap-4 px-3 py-2"
  >
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
          className={`relative py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors ${
            isActive
              ? 'pl-3 text-primary-container'
              : // §4.2 inactive color #6c7086 has no UI/surface token.
                'cursor-pointer text-[#6c7086] hover:text-on-surface-variant'
          }`}
        >
          {isActive && (
            <span
              aria-hidden
              data-testid="sidebar-tabs-accent"
              className="absolute bottom-2 left-1 top-2 w-0.5 rounded-sm bg-primary-container"
            />
          )}
          {item.label}
        </button>
      )
    })}
  </div>
)
