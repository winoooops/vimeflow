import type { ReactElement } from 'react'

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

export const SidebarTabs = <TId extends string = string>({
  tabs,
  activeId,
  onChange,
  'aria-label': ariaLabel = 'Sidebar tabs',
  'data-testid': testId = 'sidebar-tabs',
}: SidebarTabsProps<TId>): ReactElement => (
  // role="group" — NOT "toolbar" or "tablist". Both of those imply a
  // keyboard contract (toolbar: arrow-key roving; tablist: arrow + Home/
  // End + tabpanel linkage) that v1 deliberately doesn't ship (see spec
  // §3 Out of scope + §8 Future work). `role="group"` carries no
  // keyboard expectation, so AT users get an honest signal: the
  // `aria-label` names the group and `aria-pressed` on each button
  // conveys the active state. Upgrade to `toolbar` (or strict `tablist`)
  // when arrow-key navigation lands.
  <div
    role="group"
    aria-label={ariaLabel}
    data-testid={testId}
    className="flex flex-row items-center gap-1.5 px-3 py-2"
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
          // Active-pill border sits on every tab (transparent when idle) so selection never reflows the row.
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] transition-colors ${
            isActive
              ? 'border-primary/40 bg-primary/15 text-primary-container'
              : 'cursor-pointer border-transparent text-on-surface-muted hover:text-on-surface-variant'
          }`}
        >
          {item.icon ? (
            <span
              aria-hidden="true"
              className="material-symbols-outlined text-[15px]"
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
