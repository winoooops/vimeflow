import type { ReactElement } from 'react'
import type { SettingsSidebarProps } from '../types'
import { Icon } from './Icon'

export const SettingsSidebar = ({
  sections,
  targets = [],
  active,
  activeTargetId = null,
  onPick,
  onPickTarget = (): void => undefined,
  query,
  onQuery,
}: SettingsSidebarProps): ReactElement => (
  <aside className="flex w-[220px] shrink-0 flex-col border-r border-outline-variant/25 bg-surface-container">
    <div className="px-3 pt-3.5 pb-2.5">
      <div className="flex items-center gap-2 rounded-lg border border-outline-variant/35 bg-surface-container-lowest/60 px-2.5 py-2">
        <Icon name="search" size={13} className="text-on-surface-muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search settings..."
          aria-label="Search settings"
          className="min-w-0 flex-1 border-none bg-transparent font-body text-xs text-on-surface outline-none placeholder:text-on-surface-muted"
        />
      </div>
    </div>

    <nav className="thin-scrollbar flex-1 overflow-auto px-2 pb-3.5">
      {sections.map((s) => {
        const isActive = s.id === active

        const sectionTargets = targets.filter(
          (target) => target.section === s.id
        )

        return (
          <div key={s.id} className="mb-px">
            <button
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onPick(s.id)}
              className={`relative flex w-full items-center gap-2 rounded-md border-none px-2.5 py-1.5 text-left font-body text-[13px] transition-colors ${
                isActive
                  ? 'bg-primary-container/10 text-primary'
                  : 'bg-transparent text-on-surface-variant hover:bg-on-surface/[0.03]'
              }`}
            >
              {isActive && (
                <span className="absolute -left-0.5 top-2 bottom-2 w-0.5 rounded-sm bg-primary-container" />
              )}
              <Icon
                name="chevron_right"
                size={13}
                className={
                  isActive ? 'text-primary-container' : 'text-on-surface-muted'
                }
              />
              {s.label}
            </button>

            {sectionTargets.length > 0 && (
              <div className="mt-0.5 mb-1 space-y-px pl-5">
                {sectionTargets.map((target) => {
                  const isTargetActive = target.id === activeTargetId

                  return (
                    <button
                      key={target.id}
                      type="button"
                      aria-current={isTargetActive ? 'location' : undefined}
                      onClick={() => onPickTarget(target)}
                      className={`flex w-full items-center gap-1.5 rounded-md border-none px-2 py-1.5 text-left font-body text-[12px] transition-colors ${
                        isTargetActive
                          ? 'bg-primary-container/[0.08] text-primary'
                          : 'bg-transparent text-on-surface-muted hover:bg-on-surface/[0.03] hover:text-on-surface-variant'
                      }`}
                    >
                      <Icon
                        name="subdirectory_arrow_right"
                        size={12}
                        className={
                          isTargetActive
                            ? 'text-primary-container'
                            : 'text-on-surface-muted'
                        }
                      />
                      <span className="min-w-0 truncate">{target.label}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  </aside>
)
