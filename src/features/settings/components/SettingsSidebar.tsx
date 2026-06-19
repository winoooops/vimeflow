import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react'
import { Tooltip } from '@/components/Tooltip'
import type {
  SettingsSearchNavigationDirection,
  SettingsSectionId,
  SettingsSidebarProps,
  SettingsSubsection,
  SettingsSubsectionId,
  SettingsTargetId,
} from '../types'
import { resultKeyToAriaId, settingsTargetResultKey } from '../search'
import { Icon } from './Icon'

const SEARCH_RESULTS_ID = 'settings-search-results'

const sectionResultId = (id: SettingsSectionId): string =>
  `settings-search-result-section-${id}`

const targetResultId = (id: SettingsTargetId): string =>
  `settings-search-result-target-${id}`

const subsectionResultId = (id: SettingsSubsectionId): string =>
  `settings-search-result-subsection-${id}`

const noop = (): void => undefined

export const SettingsSidebar = ({
  sections,
  targets = [],
  subsections = [],
  active,
  activeSubsectionId = null,
  activeTargetId = null,
  activeSearchResultKey = null,
  expandedSectionIds: controlledExpandedSectionIds,
  onPick,
  onPickTarget = (): void => undefined,
  onPickSubsection = (): void => undefined,
  onExpandedSectionIdsChange = noop,
  onClearQuery = (): void => undefined,
  onNavigateSearchResult = (): void => undefined,
  onConfirmSearchResult = (): void => undefined,
  query,
  onQuery,
}: SettingsSidebarProps): ReactElement => {
  const searchInputRef = useRef<HTMLInputElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const previousActiveRef = useRef<SettingsSectionId | null>(null)
  const previousActiveResultIdRef = useRef<string | undefined>(undefined)

  const [uncontrolledExpandedSectionIds, setUncontrolledExpandedSectionIds] =
    useState<Set<SettingsSectionId>>(() => new Set([active]))

  const [searchFocused, setSearchFocused] = useState(false)

  const expandedSectionIds =
    controlledExpandedSectionIds ?? uncontrolledExpandedSectionIds
  const searchActive = query.trim() !== ''
  const treeActive = subsections.length > 0 && !searchActive

  const updateExpandedSectionIds = useCallback(
    (
      updater: (
        current: ReadonlySet<SettingsSectionId>
      ) => ReadonlySet<SettingsSectionId>
    ): void => {
      const next = updater(expandedSectionIds)

      if (next === expandedSectionIds) {
        return
      }

      if (controlledExpandedSectionIds === undefined) {
        setUncontrolledExpandedSectionIds(new Set(next))

        return
      }

      onExpandedSectionIdsChange(next)
    },
    [
      controlledExpandedSectionIds,
      expandedSectionIds,
      onExpandedSectionIdsChange,
    ]
  )

  useEffect(() => {
    if (previousActiveRef.current === active) {
      return
    }

    previousActiveRef.current = active
    updateExpandedSectionIds((current) => {
      if (current.has(active)) {
        return current
      }

      return new Set([...current, active])
    })
  }, [active, updateExpandedSectionIds])

  const activeSubsectionFromId =
    activeSubsectionId === null
      ? undefined
      : subsections.find(
          (subsection) =>
            subsection.id === activeSubsectionId &&
            subsection.section === active
        )

  const activeSubsectionFromTarget =
    activeTargetId === null
      ? undefined
      : subsections.find(
          (subsection) =>
            subsection.section === active &&
            subsection.targetIds.includes(activeTargetId)
        )

  const activeSubsection = activeSubsectionFromId ?? activeSubsectionFromTarget

  const fallbackActiveResultId =
    activeTargetId !== null &&
    !treeActive &&
    targets.some((target) => target.id === activeTargetId)
      ? targetResultId(activeTargetId)
      : activeSubsection !== undefined
        ? subsectionResultId(activeSubsection.id)
        : sections.some((section) => section.id === active)
          ? sectionResultId(active)
          : undefined

  const activeResultId =
    activeSearchResultKey === null
      ? fallbackActiveResultId
      : resultKeyToAriaId(activeSearchResultKey)

  const hasResults = sections.length > 0 || targets.length > 0

  useEffect(() => {
    const previousActiveResultId = previousActiveResultIdRef.current
    previousActiveResultIdRef.current = activeResultId

    if (activeResultId === undefined) {
      return
    }

    if (
      previousActiveResultId === undefined ||
      previousActiveResultId === activeResultId
    ) {
      return
    }

    const activeElement = document.getElementById(activeResultId)
    if (
      activeElement === null ||
      navRef.current?.contains(activeElement) !== true ||
      typeof activeElement.scrollIntoView !== 'function'
    ) {
      return
    }

    activeElement.scrollIntoView({ block: 'nearest' })
  }, [activeResultId])

  const handleClearQuery = (): void => {
    onClearQuery()
    searchInputRef.current?.focus()
  }

  const handlePickSection = (
    id: SettingsSectionId,
    sectionSubsections: SettingsSubsection[]
  ): void => {
    onPick(id)

    if (treeActive && sectionSubsections.length > 0) {
      updateExpandedSectionIds((current) => {
        const next = new Set(current)

        if (id === active && next.has(id)) {
          next.delete(id)
        } else {
          next.add(id)
        }

        return next
      })
    }
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
      if (query.trim() !== '') {
        searchInputRef.current?.blur()
      }
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
            data-settings-search-input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Search settings..."
            aria-label="Search settings"
            role="combobox"
            aria-expanded={hasResults}
            aria-autocomplete="list"
            aria-controls={SEARCH_RESULTS_ID}
            aria-activedescendant={activeResultId}
            className="min-w-0 flex-1 border-none bg-transparent font-body text-xs text-on-surface outline-none placeholder:text-on-surface-muted"
          />
          {query.trim() !== '' && !searchFocused && (
            <span
              data-testid="settings-search-resume-hint"
              className="flex shrink-0 items-center gap-1 font-mono text-[10px] text-on-surface-muted"
            >
              <span className="rounded border border-outline-variant/45 px-1 py-px text-[9px] leading-none text-on-surface-variant">
                /
              </span>
              search
            </span>
          )}
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
        ref={navRef}
        id={SEARCH_RESULTS_ID}
        role="listbox"
        className="thin-scrollbar flex-1 overflow-auto px-2 pb-3.5"
      >
        {sections.map((s) => {
          const isActive = s.id === active

          const sectionTargets = targets.filter(
            (target) => target.section === s.id
          )

          const sectionSubsections = treeActive
            ? subsections.filter((subsection) => subsection.section === s.id)
            : []
          const isExpanded = searchActive || expandedSectionIds.has(s.id)
          const hasTreeChildren = sectionSubsections.length > 0
          const shouldShowTargets = !treeActive && sectionTargets.length > 0

          return (
            <div key={s.id} className="mb-px">
              <button
                id={sectionResultId(s.id)}
                type="button"
                role="option"
                aria-selected={isActive}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => handlePickSection(s.id, sectionSubsections)}
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
                  className={`transition-transform ${
                    isActive
                      ? 'text-primary-container'
                      : 'text-on-surface-muted'
                  } ${hasTreeChildren && isExpanded ? 'rotate-90' : ''}`}
                />
                {s.label}
              </button>

              {treeActive && hasTreeChildren && isExpanded && (
                <div className="mt-0.5 mb-1 space-y-px pl-5">
                  {sectionSubsections.map((subsection) => {
                    const isSubsectionActive =
                      activeSubsection?.id === subsection.id

                    return (
                      <button
                        id={subsectionResultId(subsection.id)}
                        key={subsection.id}
                        type="button"
                        role="option"
                        aria-selected={isSubsectionActive}
                        aria-current={
                          isSubsectionActive ? 'location' : undefined
                        }
                        onClick={() => onPickSubsection(subsection)}
                        className={`flex w-full items-center gap-1.5 rounded-md border-none px-2 py-1.5 text-left font-body text-[12px] transition-colors ${
                          isSubsectionActive
                            ? 'bg-primary-container/[0.08] text-primary'
                            : 'bg-transparent text-on-surface-muted hover:bg-on-surface/[0.03] hover:text-on-surface-variant'
                        }`}
                      >
                        <Icon
                          name="subdirectory_arrow_right"
                          size={12}
                          className={
                            isSubsectionActive
                              ? 'text-primary-container'
                              : 'text-on-surface-muted'
                          }
                        />
                        <span className="min-w-0 truncate">
                          {subsection.label}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}

              {shouldShowTargets && (
                <div className="mt-0.5 mb-1 space-y-px pl-5">
                  {sectionTargets.map((target) => {
                    const isTargetActive =
                      target.id === activeTargetId ||
                      activeSearchResultKey === settingsTargetResultKey(target)

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
