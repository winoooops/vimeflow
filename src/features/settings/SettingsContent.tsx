import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type {
  SettingsSearchNavigationDirection,
  SettingsSectionId,
  SettingsSubsection,
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
  settingsSectionResultKey,
  settingsTargetResultKey,
  type SettingsSearchResult,
} from './search'
import { SettingsSidebar } from './components/SettingsSidebar'
import { AgentsPane } from './components/panes/AgentsPane'
import { AppearancePane } from './components/panes/AppearancePane'
import { GeneralPane } from './components/panes/GeneralPane'
import { KeymapPane } from './components/panes/KeymapPane'
import { PlaceholderPane } from './components/panes/PlaceholderPane'

const REAL_PANES: readonly SettingsSectionId[] = [
  'general',
  'appearance',
  'keymap',
  'agents',
]

type TargetFocusMode = 'focus-target' | 'preserve-search-focus'

export const SettingsContent = (): ReactElement => {
  const [section, setSection] = useState<SettingsSectionId>('appearance')
  const [query, setQuery] = useState('')

  const [activeTargetId, setActiveTargetId] = useState<SettingsTargetId | null>(
    null
  )

  const [selectedSearchResultKey, setSelectedSearchResultKey] = useState<
    string | null
  >(null)

  const [targetNavigationKey, setTargetNavigationKey] = useState(0)

  const [targetFocusMode, setTargetFocusMode] =
    useState<TargetFocusMode>('focus-target')

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

  const handlePickSection = (id: SettingsSectionId): void => {
    setSection(id)
    setActiveTargetId(null)
    setSelectedSearchResultKey(settingsSectionResultKey(id))
  }

  const handleQuery = (nextQuery: string): void => {
    setQuery(nextQuery)
    setActiveTargetId(null)
    setSelectedSearchResultKey(null)
  }

  const handleClearQuery = (): void => {
    setQuery('')
    setActiveTargetId(null)
    setSelectedSearchResultKey(null)
    setTargetFocusMode('focus-target')
  }

  const applySearchResult = (
    result: SettingsSearchResult,
    focusMode: TargetFocusMode
  ): void => {
    setTargetFocusMode(focusMode)
    setSelectedSearchResultKey(result.key)

    if (result.kind === 'section') {
      handlePickSection(result.section.id)

      return
    }

    const { target } = result
    setSection(target.section)
    setActiveTargetId(target.id)
    setTargetNavigationKey((key) => key + 1)
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
      'focus-target'
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

  const handleConfirmSearchResult = (): void => {
    if (searchResults.length === 0) {
      return
    }

    const currentResult =
      activeSearchResultKey === null
        ? undefined
        : searchResults.find((result) => result.key === activeSearchResultKey)

    const resultToConfirm =
      currentResult ?? (query.trim() ? searchResults[0] : undefined)

    if (!resultToConfirm) {
      return
    }

    applySearchResult(resultToConfirm, 'focus-target')
  }

  useEffect(() => {
    if (activeTargetId === null) {
      return
    }

    const target = contentRef.current?.querySelector<HTMLElement>(
      `[data-settings-target="${activeTargetId}"]`
    )

    if (!target) {
      return
    }

    target.scrollIntoView({ block: 'center', behavior: 'smooth' })
    if (targetFocusMode === 'focus-target') {
      target.focus({ preventScroll: true })
    }
  }, [activeTargetId, section, targetFocusMode, targetNavigationKey])

  return (
    <div className="flex min-h-0 flex-1">
      <SettingsSidebar
        sections={filtered}
        targets={targetMatches}
        subsections={SETTINGS_SUBSECTIONS}
        active={section}
        activeTargetId={activeTargetId}
        activeSearchResultKey={activeSearchResultKey}
        onPick={handlePickSection}
        onPickTarget={handlePickTarget}
        onPickSubsection={handlePickSubsection}
        onClearQuery={handleClearQuery}
        onNavigateSearchResult={handleNavigateSearchResult}
        onConfirmSearchResult={handleConfirmSearchResult}
        query={query}
        onQuery={handleQuery}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <div
          ref={contentRef}
          className="thin-scrollbar flex-1 overflow-auto px-7 py-5"
        >
          {section === 'general' && (
            <GeneralPane activeTargetId={activeTargetId} />
          )}
          {section === 'appearance' && (
            <AppearancePane activeTargetId={activeTargetId} />
          )}
          {section === 'keymap' && (
            <KeymapPane activeTargetId={activeTargetId} />
          )}
          {section === 'agents' && (
            <AgentsPane activeTargetId={activeTargetId} />
          )}
          {!REAL_PANES.includes(section) && activeSection && (
            <PlaceholderPane section={activeSection} />
          )}
        </div>
      </div>
    </div>
  )
}
