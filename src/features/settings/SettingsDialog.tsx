import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { SettingsSectionId, SettingsDialogProps } from './types'
import { SETTINGS_SECTIONS } from './sections'
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

export const SettingsDialog = ({
  open,
  onClose,
}: SettingsDialogProps): ReactElement | null => {
  const [section, setSection] = useState<SettingsSectionId>('appearance')
  const [scope, setScope] = useState<'User' | 'vimeflow'>('User')
  const [query, setQuery] = useState('')

  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  const filtered = query.trim()
    ? SETTINGS_SECTIONS.filter((s) =>
        s.label.toLowerCase().includes(query.toLowerCase())
      )
    : SETTINGS_SECTIONS

  const activeSection = SETTINGS_SECTIONS.find((s) => s.id === section)

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

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter(
        (el) =>
          !el.matches(':disabled') && el.getAttribute('aria-hidden') !== 'true'
      )

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
    }
  }, [open])

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
                active={section}
                onPick={setSection}
                query={query}
                onQuery={setQuery}
              />

              <div className="flex min-w-0 flex-1 flex-col">
                <SettingsHeader scope={scope} onScope={setScope} />

                <div className="thin-scrollbar flex-1 overflow-auto px-7 py-5">
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
