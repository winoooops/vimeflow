import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type {
  SettingsSearchNavigationDirection,
  SettingsSection,
  SettingsSectionId,
  SettingsSubsection,
  SettingsSubsectionId,
  SettingsTarget,
  SettingsTargetId,
} from './types'
import {
  SETTINGS_SECTIONS,
  SETTINGS_SUBSECTIONS,
  SETTINGS_TARGETS,
} from './sections'
import {
  searchSettings,
  sectionResultId,
  settingsSectionResultKey,
  settingsTargetResultKey,
  subsectionResultId,
  type SettingsSearchResult,
} from './search'
import { SettingsSidebar } from './components/SettingsSidebar'
import { AgentsPane } from './components/panes/AgentsPane'
import { AppearancePane } from './components/panes/AppearancePane'
import { GeneralPane } from './components/panes/GeneralPane'
import { KeymapPane } from './components/panes/KeymapPane'
import { PlaceholderPane } from './components/panes/PlaceholderPane'
import { isKeymapCaptureTarget } from '../keymap/capture'

const REAL_PANES: readonly SettingsSectionId[] = [
  'general',
  'appearance',
  'keymap',
  'agents',
]

const SETTINGS_SCROLL_STEP = 96

type TargetSelectionMode = 'scroll-target' | 'preserve-search-focus'

type SettingsNavigationEntry =
  | { kind: 'section'; section: SettingsSection }
  | { kind: 'subsection'; subsection: SettingsSubsection }

const settingsNavigationEntryKey = (entry: SettingsNavigationEntry): string =>
  entry.kind === 'section'
    ? `section:${entry.section.id}`
    : `subsection:${entry.subsection.id}`

const settingsNavigationEntryElementId = (
  entry: SettingsNavigationEntry
): string =>
  entry.kind === 'section'
    ? sectionResultId(entry.section.id)
    : subsectionResultId(entry.subsection.id)

const shortcutTargetOwnsKey = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  (target.closest(
    'input, select, textarea, [contenteditable], [role="textbox"]'
  ) !== null ||
    isKeymapCaptureTarget(target))

export const SettingsContent = (): ReactElement => {
  const [section, setSection] = useState<SettingsSectionId>('appearance')
  const [query, setQuery] = useState('')

  const [scrollTargetId, setScrollTargetId] = useState<SettingsTargetId | null>(
    null
  )

  const [activeSidebarSubsectionId, setActiveSidebarSubsectionId] =
    useState<SettingsSubsectionId | null>(null)

  const [selectedSearchResultKey, setSelectedSearchResultKey] = useState<
    string | null
  >(null)

  const [expandedSectionIds, setExpandedSectionIds] = useState<
    ReadonlySet<SettingsSectionId>
  >(() => new Set(['appearance']))

  const rootRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const searchModel = useMemo(
    () =>
      searchSettings({
        sections: SETTINGS_SECTIONS,
        targets: SETTINGS_TARGETS,
        query,
      }),
    [query]
  )
  const filtered = searchModel.sections
  const targetMatches = searchModel.targets
  const searchResults = searchModel.results

  const activeSearchResultKey =
    selectedSearchResultKey !== null &&
    searchResults.some((result) => result.key === selectedSearchResultKey)
      ? selectedSearchResultKey
      : query.trim() !== '' && searchResults.length > 0
        ? searchResults[0].key
        : null

  const activeSection = SETTINGS_SECTIONS.find((s) => s.id === section)

  const activeSidebarSubsection =
    activeSidebarSubsectionId === null
      ? undefined
      : SETTINGS_SUBSECTIONS.find(
          (subsection) =>
            subsection.id === activeSidebarSubsectionId &&
            subsection.section === section
        )

  const sidebarNavigationEntries = useMemo(() => {
    const navigationSections =
      query.trim() === '' ? SETTINGS_SECTIONS : filtered

    return navigationSections.flatMap(
      (candidate): SettingsNavigationEntry[] => {
        const sectionEntry: SettingsNavigationEntry = {
          kind: 'section',
          section: candidate,
        }

        if (query.trim() !== '' || !expandedSectionIds.has(candidate.id)) {
          return [sectionEntry]
        }

        return [
          sectionEntry,
          ...SETTINGS_SUBSECTIONS.filter(
            (subsection) => subsection.section === candidate.id
          ).map(
            (subsection): SettingsNavigationEntry => ({
              kind: 'subsection',
              subsection,
            })
          ),
        ]
      }
    )
  }, [expandedSectionIds, filtered, query])

  const activeNavigationKey =
    activeSidebarSubsection === undefined
      ? `section:${section}`
      : `subsection:${activeSidebarSubsection.id}`

  const expandSection = (id: SettingsSectionId): void => {
    setExpandedSectionIds((current) => {
      if (current.has(id)) {
        return current
      }

      return new Set([...current, id])
    })
  }

  const handlePickSection = (id: SettingsSectionId): void => {
    expandSection(id)
    setSection(id)
    setScrollTargetId(null)
    setActiveSidebarSubsectionId(null)
    setSelectedSearchResultKey(settingsSectionResultKey(id))
  }

  const handleQuery = (nextQuery: string): void => {
    setQuery(nextQuery)
    setScrollTargetId(null)
    setActiveSidebarSubsectionId(null)
    setSelectedSearchResultKey(null)
  }

  const handleClearQuery = (): void => {
    setQuery('')
    setScrollTargetId(null)
    setActiveSidebarSubsectionId(null)
    setSelectedSearchResultKey(null)
  }

  const applySearchResult = (
    result: SettingsSearchResult,
    selectionMode: TargetSelectionMode
  ): void => {
    setSelectedSearchResultKey(result.key)

    if (result.kind === 'section') {
      handlePickSection(result.section.id)

      return
    }

    const { target } = result
    expandSection(target.section)
    setSection(target.section)

    const subsection = SETTINGS_SUBSECTIONS.find(
      (candidate) =>
        candidate.section === target.section &&
        candidate.targetIds.includes(target.id)
    )

    setActiveSidebarSubsectionId(subsection?.id ?? null)

    if (selectionMode === 'preserve-search-focus') {
      setScrollTargetId(null)

      return
    }

    setScrollTargetId(target.id)
  }

  const handlePickTarget = (target: SettingsTarget): void => {
    const owningSection = SETTINGS_SECTIONS.find((s) => s.id === target.section)
    if (owningSection === undefined) {
      return
    }

    applySearchResult(
      {
        key: settingsTargetResultKey(target),
        kind: 'target',
        section: owningSection,
        target,
        score: 0,
      },
      'scroll-target'
    )
  }

  const handlePickSubsection = (subsection: SettingsSubsection): void => {
    const target = SETTINGS_TARGETS.find(
      (candidate) => candidate.id === subsection.targetId
    )

    if (target === undefined) {
      return
    }

    handlePickTarget(target)
  }

  const handleNavigateSearchResult = (
    direction: SettingsSearchNavigationDirection
  ): void => {
    if (searchResults.length === 0) {
      return
    }

    const currentIndex =
      activeSearchResultKey === null
        ? -1
        : searchResults.findIndex(
            (result) => result.key === activeSearchResultKey
          )
    const delta = direction === 'next' ? 1 : -1
    let nextIndex: number
    if (currentIndex === -1) {
      nextIndex = direction === 'next' ? 0 : searchResults.length - 1
    } else {
      nextIndex =
        (currentIndex + delta + searchResults.length) % searchResults.length
    }

    const nextResult = searchResults[nextIndex]

    applySearchResult(nextResult, 'preserve-search-focus')
  }

  const handleConfirmSearchResult = (): boolean => {
    if (searchResults.length === 0) {
      return false
    }

    const currentResult =
      activeSearchResultKey === null
        ? undefined
        : searchResults.find((result) => result.key === activeSearchResultKey)

    const resultToConfirm =
      currentResult ?? (query.trim() ? searchResults[0] : undefined)

    if (!resultToConfirm) {
      return false
    }

    applySearchResult(resultToConfirm, 'scroll-target')

    return true
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        shortcutTargetOwnsKey(event.target)
      ) {
        return
      }

      if (event.key === '/') {
        const searchInput = rootRef.current?.querySelector<HTMLInputElement>(
          '[data-settings-search-input]'
        )
        if (!searchInput) {
          return
        }

        event.preventDefault()
        searchInput.focus()
        searchInput.setSelectionRange(
          searchInput.value.length,
          searchInput.value.length
        )

        return
      }

      const content = contentRef.current

      const scrollContent = (top: number): void => {
        if (!content) {
          return
        }

        if (typeof content.scrollBy === 'function') {
          content.scrollBy({ top, behavior: 'smooth' })

          return
        }

        content.scrollTop += top
      }

      const viewportNavigationKey = (): string => {
        if (!content || content.scrollTop <= 0) {
          return activeNavigationKey
        }

        const viewport = content.getBoundingClientRect()

        const visibleTarget = Array.from(
          content.querySelectorAll<HTMLElement>('[data-settings-target]')
        ).reduce<{ element: HTMLElement; rect: DOMRect } | undefined>(
          (current, element) => {
            const rect = element.getBoundingClientRect()

            if (rect.bottom <= viewport.top || rect.top >= viewport.bottom) {
              return current
            }

            if (current === undefined || rect.top < current.rect.top) {
              return { element, rect }
            }

            return current
          },
          undefined
        )

        const targetId = visibleTarget?.element.dataset.settingsTarget
        if (targetId === undefined) {
          return activeNavigationKey
        }

        const visibleSubsection = SETTINGS_SUBSECTIONS.find(
          (subsection) =>
            subsection.section === section &&
            subsection.targetIds.includes(targetId)
        )

        const viewportKey =
          visibleSubsection === undefined
            ? `section:${section}`
            : `subsection:${visibleSubsection.id}`

        return sidebarNavigationEntries.some(
          (entry) => settingsNavigationEntryKey(entry) === viewportKey
        )
          ? viewportKey
          : activeNavigationKey
      }

      const navigateSidebar = (direction: 1 | -1): void => {
        if (sidebarNavigationEntries.length === 0) {
          return
        }

        const shouldMoveSidebarFocus =
          event.target instanceof Element &&
          event.target.closest('#settings-search-results') !== null

        const focusedOption =
          shouldMoveSidebarFocus && event.target instanceof HTMLElement
            ? event.target.closest<HTMLElement>('[role="option"]')
            : null

        const focusedNavigationKey =
          focusedOption === null
            ? undefined
            : sidebarNavigationEntries.find(
                (entry) =>
                  settingsNavigationEntryElementId(entry) === focusedOption.id
              )

        const navigationKey =
          focusedNavigationKey === undefined
            ? viewportNavigationKey()
            : settingsNavigationEntryKey(focusedNavigationKey)

        const currentIndex = sidebarNavigationEntries.findIndex(
          (entry) => settingsNavigationEntryKey(entry) === navigationKey
        )

        if (currentIndex === -1) {
          return
        }

        const nextIndex =
          (currentIndex + direction + sidebarNavigationEntries.length) %
          sidebarNavigationEntries.length
        const next = sidebarNavigationEntries[nextIndex]

        if (shouldMoveSidebarFocus) {
          window.requestAnimationFrame(() => {
            document
              .getElementById(settingsNavigationEntryElementId(next))
              ?.focus({ preventScroll: true })
          })
        }

        if (next.kind === 'subsection') {
          const target = SETTINGS_TARGETS.find(
            (candidate) => candidate.id === next.subsection.targetId
          )

          if (target === undefined) {
            return
          }

          setSelectedSearchResultKey(null)
          setSection(target.section)
          setScrollTargetId(null)
          setActiveSidebarSubsectionId(next.subsection.id)

          return
        }

        setExpandedSectionIds((current) => {
          if (current.has(next.section.id)) {
            return current
          }

          return new Set([...current, next.section.id])
        })
        setSection(next.section.id)
        setScrollTargetId(null)
        setActiveSidebarSubsectionId(null)
        setSelectedSearchResultKey(settingsSectionResultKey(next.section.id))
      }

      if (event.key === 'd') {
        event.preventDefault()
        scrollContent(SETTINGS_SCROLL_STEP)

        return
      }

      if (event.key === 'u') {
        event.preventDefault()
        scrollContent(-SETTINGS_SCROLL_STEP)

        return
      }

      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault()
        navigateSidebar(1)

        return
      }

      if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault()
        navigateSidebar(-1)
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return (): void => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [activeNavigationKey, section, sidebarNavigationEntries])

  useEffect(() => {
    if (scrollTargetId === null) {
      return
    }

    const target = contentRef.current?.querySelector<HTMLElement>(
      `[data-settings-target="${scrollTargetId}"]`
    )

    if (!target) {
      return
    }

    target.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setScrollTargetId(null)
  }, [scrollTargetId, section])

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1">
      <SettingsSidebar
        sections={filtered}
        targets={targetMatches}
        subsections={SETTINGS_SUBSECTIONS}
        active={section}
        activeSubsectionId={activeSidebarSubsection?.id ?? null}
        activeSearchResultKey={activeSearchResultKey}
        expandedSectionIds={expandedSectionIds}
        onPick={handlePickSection}
        onPickTarget={handlePickTarget}
        onPickSubsection={handlePickSubsection}
        onExpandedSectionIdsChange={setExpandedSectionIds}
        onClearQuery={handleClearQuery}
        onNavigateSearchResult={handleNavigateSearchResult}
        onConfirmSearchResult={handleConfirmSearchResult}
        query={query}
        onQuery={handleQuery}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <div
          ref={contentRef}
          data-testid="settings-dialog-content"
          className="thin-scrollbar flex-1 overflow-auto px-7 py-5"
        >
          {section === 'general' && <GeneralPane />}
          {section === 'appearance' && <AppearancePane />}
          {section === 'keymap' && <KeymapPane />}
          {section === 'agents' && <AgentsPane />}
          {!REAL_PANES.includes(section) && activeSection && (
            <PlaceholderPane section={activeSection} />
          )}
        </div>
      </div>
    </div>
  )
}
