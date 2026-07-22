import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { SettingsDialogProps } from './types'
import { IconButton } from '@/components/IconButton'
import { Kbd } from './components/Kbd'
import { SettingsContent } from './SettingsContent'

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
  initialSectionId = null,
}: SettingsDialogProps): ReactElement | null => {
  const [contentSessionKey, setContentSessionKey] = useState(0)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

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
      setContentSessionKey((key) => key + 1)
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
      if (
        !dialog ||
        !(event.target instanceof Node) ||
        !dialog.contains(event.target)
      ) {
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
              <IconButton
                ref={closeButtonRef}
                icon="close"
                label="Close"
                size="sm"
                variant="ghost"
                tooltipPlacement="bottom"
                onClick={onClose}
              />
            </div>

            <SettingsContent
              key={contentSessionKey}
              initialSectionId={initialSectionId}
            />

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
