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
          // `pl-3` is on every tab (not only the active one) so the accent
          // bar appears in place without shifting the label horizontally
          // on selection. The bar's `left-1` (4 px) sits inside the 12 px
          // padding region — clearance is `pl-3 - left-1 - w-0.5` ≈ 6 px
          // before the first glyph.
          className={`relative py-1 pl-3 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors ${
            isActive
              ? 'text-primary-container'
              : 'cursor-pointer text-on-surface-muted hover:text-on-surface-variant'
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
