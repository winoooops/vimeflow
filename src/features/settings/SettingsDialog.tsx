import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type {
  SettingsDialogProps,
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
  settingsSectionResultKey,
  settingsTargetResultKey,
  type SettingsSearchResult,
} from './search'
import { Icon } from './components/Icon'
import { Tooltip } from '@/components/Tooltip'
import { Kbd } from './components/Kbd'
import { SettingsHeader } from './components/SettingsHeader'
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

type TargetActivationMode = 'focus-target' | 'preserve-search-focus'

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

const SETTINGS_SCROLL_STEP = 96

type SettingsNavigationEntry =
  | { kind: 'section'; section: SettingsSection }
  | { kind: 'subsection'; subsection: SettingsSubsection }

const settingsNavigationEntryKey = (entry: SettingsNavigationEntry): string =>
  entry.kind === 'section'
    ? `section:${entry.section.id}`
    : `subsection:${entry.subsection.id}`

const shortcutTargetOwnsKey = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  (target.closest(
    'input, select, textarea, [contenteditable], [role="textbox"]'
  ) !== null ||
    isKeymapCaptureTarget(target))

const orderedFocusable = (dialog: HTMLElement): HTMLElement[] => {
  const staticFocusable = Array.from(
    dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  ).filter(
    (el) =>
      !el.matches(':disabled') && el.getAttribute('aria-hidden') !== 'true'
  )

  const active = document.activeElement as HTMLElement | null
  if (
    active === null ||
    !dialog.contains(active) ||
    staticFocusable.includes(active)
  ) {
    return staticFocusable
  }

  // The active element is programmatically focused but not in the natural tab
  // order (e.g. a settings target row with tabIndex={-1}). Include it in the
  // ordering so the focus trap can Tab away from it naturally.
  const all = [...staticFocusable, active]
  all.sort((a, b) => {
    const position = a.compareDocumentPosition(b)

    return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  })

  return all
}

export const SettingsDialog = ({
  open,
  onClose,
}: SettingsDialogProps): ReactElement | null => {
  const [section, setSection] = useState<SettingsSectionId>('appearance')
  const [query, setQuery] = useState('')

  const [activeTargetId, setActiveTargetId] = useState<SettingsTargetId | null>(
    null
  )

  const [activeSidebarSubsectionId, setActiveSidebarSubsectionId] =
    useState<SettingsSubsectionId | null>(null)

  const [selectedSearchResultKey, setSelectedSearchResultKey] = useState<
    string | null
  >(null)

  const [targetNavigationKey, setTargetNavigationKey] = useState(0)

  const [expandedSectionIds, setExpandedSectionIds] = useState<
    ReadonlySet<SettingsSectionId>
  >(() => new Set(['appearance']))

  const [targetActivationMode, setTargetActivationMode] =
    useState<TargetActivationMode>('focus-target')

  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

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

  const activeContentSubsection =
    activeTargetId === null
      ? undefined
      : SETTINGS_SUBSECTIONS.find(
          (subsection) =>
            subsection.section === section &&
            subsection.targetIds.includes(activeTargetId)
        )

  const activeSidebarSubsection =
    activeSidebarSubsectionId === null
      ? activeContentSubsection
      : SETTINGS_SUBSECTIONS.find(
          (subsection) =>
            subsection.id === activeSidebarSubsectionId &&
            subsection.section === section
        )

  const sidebarNavigationEntries = useMemo(() => {
    const navigationSections =
      filtered.length > 0 ? filtered : SETTINGS_SECTIONS

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
    setActiveTargetId(null)
    setActiveSidebarSubsectionId(null)
    setSelectedSearchResultKey(settingsSectionResultKey(id))
  }

  const handleQuery = (nextQuery: string): void => {
    setQuery(nextQuery)
    setActiveTargetId(null)
    setActiveSidebarSubsectionId(null)
    setSelectedSearchResultKey(null)
  }

  const handleClearQuery = (): void => {
    setQuery('')
    setActiveTargetId(null)
    setActiveSidebarSubsectionId(null)
    setSelectedSearchResultKey(null)
    setTargetActivationMode('focus-target')
  }

  const applySearchResult = (
    result: SettingsSearchResult,
    activationMode: TargetActivationMode
  ): void => {
    setTargetActivationMode(activationMode)
    setSelectedSearchResultKey(result.key)

    if (result.kind === 'section') {
      handlePickSection(result.section.id)

      return
    }

    const { target } = result
    expandSection(target.section)
    setSection(target.section)
    setActiveTargetId(target.id)
    setActiveSidebarSubsectionId(null)
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
    if (open) {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      closeButtonRef.current?.focus()
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus()
      previousFocusRef.current = null
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      return undefined
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Tab') {
        const dialog = dialogRef.current
        if (!dialog) {
          return
        }

        const focusable = orderedFocusable(dialog)

        if (focusable.length === 0) {
          event.preventDefault()

          return
        }

        const currentIndex = focusable.indexOf(
          document.activeElement as HTMLElement
        )
        const delta = event.shiftKey ? -1 : 1

        let nextIndex: number
        if (currentIndex === -1) {
          nextIndex = event.shiftKey ? focusable.length - 1 : 0
        } else {
          nextIndex =
            (currentIndex + delta + focusable.length) % focusable.length
        }

        event.preventDefault()
        focusable[nextIndex]?.focus()

        return
      }

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
        const searchInput = dialogRef.current?.querySelector<HTMLInputElement>(
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

        const navigationKey = viewportNavigationKey()

        const currentIndex = sidebarNavigationEntries.findIndex(
          (entry) => settingsNavigationEntryKey(entry) === navigationKey
        )

        const baseIndex =
          currentIndex === -1 ? (direction === 1 ? -1 : 0) : currentIndex

        const nextIndex =
          (baseIndex + direction + sidebarNavigationEntries.length) %
          sidebarNavigationEntries.length
        const next = sidebarNavigationEntries[nextIndex]

        if (next.kind === 'subsection') {
          const target = SETTINGS_TARGETS.find(
            (candidate) => candidate.id === next.subsection.targetId
          )

          if (target === undefined) {
            return
          }

          setSelectedSearchResultKey(null)
          setSection(target.section)
          setActiveTargetId(null)
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
        setActiveTargetId(null)
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
  }, [activeNavigationKey, open, section, sidebarNavigationEntries])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setActiveTargetId(null)
      setActiveSidebarSubsectionId(null)
      setSelectedSearchResultKey(null)
      setExpandedSectionIds(new Set([section]))
    }
  }, [open, section])

  useEffect(() => {
    if (!open || activeTargetId === null) {
      return
    }

    const target = contentRef.current?.querySelector<HTMLElement>(
      `[data-settings-target="${activeTargetId}"]`
    )

    if (!target) {
      return
    }

    target.scrollIntoView({ block: 'center', behavior: 'smooth' })
    if (targetActivationMode === 'focus-target') {
      target.focus({ preventScroll: true })
    }
  }, [activeTargetId, open, section, targetActivationMode, targetNavigationKey])

  return (
    <AnimatePresence>
      {open && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Settings"
          className="fixed inset-0 z-[100] flex items-center justify-center p-10"
        >
          <motion.div
            data-testid="settings-dialog-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 backdrop-blur-sm bg-[color-mix(in_srgb,var(--color-scrim)_40%,transparent)]"
            onClick={onClose}
          />

          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: -8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: -8 }}
            transition={{
              type: 'spring',
              stiffness: 400,
              damping: 30,
            }}
            onClick={(e) => e.stopPropagation()}
            className="relative flex h-[640px] w-[920px] max-h-[90vh] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-outline-variant/45 bg-surface-container/95 backdrop-blur-2xl shadow-[0_28px_72px_color-mix(in_srgb,var(--color-scrim)_60%,transparent),0_0_0_1px_color-mix(in_srgb,var(--color-primary)_8%,transparent)]"
          >
            {/* Title bar */}
            <div className="flex h-9 shrink-0 items-center justify-end gap-1.5 border-b border-outline-variant/25 bg-surface-container px-2.5">
              <Tooltip content="Close">
                <button
                  ref={closeButtonRef}
                  type="button"
                  aria-label="Close"
                  onClick={onClose}
                  className="grid h-[22px] w-[22px] place-items-center rounded border-none bg-transparent text-on-surface-muted transition-colors hover:bg-on-surface/[0.04] hover:text-on-surface"
                >
                  <Icon name="close" size={14} />
                </button>
              </Tooltip>
            </div>

            <div className="flex min-h-0 flex-1">
              <SettingsSidebar
                sections={filtered}
                targets={targetMatches}
                subsections={SETTINGS_SUBSECTIONS}
                active={section}
                activeSubsectionId={activeSidebarSubsection?.id ?? null}
                activeTargetId={activeTargetId}
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
                <SettingsHeader />

                <div
                  ref={contentRef}
                  data-testid="settings-dialog-content"
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

            {/* Footer */}
            <div className="flex h-7 shrink-0 items-center gap-2.5 border-t border-outline-variant/25 bg-surface-container-lowest px-3.5 font-mono text-[10px] text-on-surface-muted/80">
              <Kbd>j</Kbd>
              <Kbd>k</Kbd>
              <span>nav</span>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              <span>nav</span>
              <Kbd>u</Kbd>
              <Kbd>d</Kbd>
              <span>scroll</span>
              <span className="min-w-0 flex-1" />
              <Kbd>esc</Kbd>
              <span>close</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
