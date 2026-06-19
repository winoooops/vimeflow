import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import type {
  SettingsDialogProps,
  SettingsSearchNavigationDirection,
  SettingsSectionId,
  SettingsTarget,
  SettingsTargetId,
} from './types'
import { SETTINGS_SECTIONS, SETTINGS_TARGETS } from './sections'
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

const REAL_PANES: readonly SettingsSectionId[] = [
  'general',
  'appearance',
  'keymap',
  'agents',
]

type TargetFocusMode = 'focus-target' | 'preserve-search-focus'

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

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
  const [scope, setScope] = useState<'User' | 'vimeflow'>('User')
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

  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  const searchModel = searchSettings({
    sections: SETTINGS_SECTIONS,
    targets: SETTINGS_TARGETS,
    query,
  })
  const filtered = searchModel.sections
  const targetMatches = searchModel.targets
  const searchResults = searchModel.results

  const activeSearchResultKey =
    selectedSearchResultKey !== null &&
    searchResults.some((result) => result.key === selectedSearchResultKey)
      ? selectedSearchResultKey
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
      if (event.key !== 'Tab') {
        return
      }

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
        nextIndex = (currentIndex + delta + focusable.length) % focusable.length
      }

      event.preventDefault()
      focusable[nextIndex]?.focus()
    }

    document.addEventListener('keydown', handleKeyDown)

    return (): void => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setActiveTargetId(null)
      setSelectedSearchResultKey(null)
    }
  }, [open])

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
    if (targetFocusMode === 'focus-target') {
      target.focus({ preventScroll: true })
    }
  }, [activeTargetId, open, section, targetFocusMode, targetNavigationKey])

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
                active={section}
                activeTargetId={activeTargetId}
                activeSearchResultKey={activeSearchResultKey}
                onPick={handlePickSection}
                onPickTarget={handlePickTarget}
                onClearQuery={handleClearQuery}
                onNavigateSearchResult={handleNavigateSearchResult}
                onConfirmSearchResult={handleConfirmSearchResult}
                query={query}
                onQuery={handleQuery}
              />

              <div className="flex min-w-0 flex-1 flex-col">
                <SettingsHeader scope={scope} onScope={setScope} />

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

            {/* Footer */}
            <div className="flex h-7 shrink-0 items-center gap-2.5 border-t border-outline-variant/25 bg-surface-container-lowest px-3.5 font-mono text-[10px] text-on-surface-muted/80">
              <Kbd>⌘</Kbd>
              <Kbd>⇧</Kbd>
              <Kbd>E</Kbd>
              <span className="text-primary-container">Focus</span>
              <span>Navbar</span>
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
