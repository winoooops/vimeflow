import { useRef, type KeyboardEvent, type ReactElement } from 'react'
import { Tooltip } from '@/components/Tooltip'
import type {
  SettingsSearchNavigationDirection,
  SettingsSectionId,
  SettingsSidebarProps,
  SettingsTargetId,
} from '../types'
import { resultKeyToAriaId } from '../search'
import { Icon } from './Icon'

const SEARCH_RESULTS_ID = 'settings-search-results'

const sectionResultId = (id: SettingsSectionId): string =>
  `settings-search-result-section-${id}`

const targetResultId = (id: SettingsTargetId): string =>
  `settings-search-result-target-${id}`

export const SettingsSidebar = ({
  sections,
  targets = [],
  active,
  activeTargetId = null,
  activeSearchResultKey = null,
  onPick,
  onPickTarget = (): void => undefined,
  onClearQuery = (): void => undefined,
  onNavigateSearchResult = (): void => undefined,
  onConfirmSearchResult = (): void => undefined,
  query,
  onQuery,
}: SettingsSidebarProps): ReactElement => {
  const searchInputRef = useRef<HTMLInputElement>(null)

  const fallbackActiveResultId =
    activeTargetId !== null &&
    targets.some((target) => target.id === activeTargetId)
      ? targetResultId(activeTargetId)
      : sections.some((section) => section.id === active)
        ? sectionResultId(active)
        : undefined

  const activeResultId =
    activeSearchResultKey === null
      ? fallbackActiveResultId
      : resultKeyToAriaId(activeSearchResultKey)

  const hasResults = sections.length > 0 || targets.length > 0

  const handleClearQuery = (): void => {
    onClearQuery()
    searchInputRef.current?.focus()
  }

  const handleNavigate = (
    event: KeyboardEvent<HTMLInputElement>,
    direction: SettingsSearchNavigationDirection
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    onNavigateSearchResult(direction)
  }

  const handleSearchKeyDown = (
    event: KeyboardEvent<HTMLInputElement>
  ): void => {
    if (event.nativeEvent.isComposing) {
      return
    }

    if (event.key === 'ArrowDown') {
      handleNavigate(event, 'next')

      return
    }

    if (event.key === 'ArrowUp') {
      handleNavigate(event, 'previous')

      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      onConfirmSearchResult()
    }
  }

  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-outline-variant/25 bg-surface-container">
      <div className="px-3 pt-3.5 pb-2.5">
        <div className="flex items-center gap-2 rounded-lg border border-outline-variant/35 bg-surface-container-lowest/60 px-2.5 py-2">
          <Icon name="search" size={13} className="text-on-surface-muted" />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search settings..."
            aria-label="Search settings"
            role="combobox"
            aria-expanded={hasResults}
            aria-autocomplete="list"
            aria-controls={SEARCH_RESULTS_ID}
            aria-activedescendant={activeResultId}
            className="min-w-0 flex-1 border-none bg-transparent font-body text-xs text-on-surface outline-none placeholder:text-on-surface-muted"
          />
          {query.trim() !== '' && (
            <Tooltip content="Clear search">
              <button
                type="button"
                aria-label="Clear settings search"
                onClick={handleClearQuery}
                className="grid h-5 w-5 shrink-0 place-items-center rounded border-none bg-transparent text-on-surface-muted transition-colors hover:bg-on-surface/[0.04] hover:text-on-surface"
              >
                <Icon name="close" size={12} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      <nav
        id={SEARCH_RESULTS_ID}
        role="listbox"
        className="thin-scrollbar flex-1 overflow-auto px-2 pb-3.5"
      >
        {sections.map((s) => {
          const isActive = s.id === active

          const sectionTargets = targets.filter(
            (target) => target.section === s.id
          )

          return (
            <div key={s.id} className="mb-px">
              <button
                id={sectionResultId(s.id)}
                type="button"
                role="option"
                aria-selected={isActive}
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
                    isActive
                      ? 'text-primary-container'
                      : 'text-on-surface-muted'
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
                        id={targetResultId(target.id)}
                        key={target.id}
                        type="button"
                        role="option"
                        aria-selected={isTargetActive}
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
}
