import { AnimatePresence, motion } from 'framer-motion'
import type { ReactElement } from 'react'
import { useEffect, useId, useRef } from 'react'

export interface UnsavedChangesDialogProps {
  isOpen: boolean
  fileName: string
  /** Optional error surfaced from a failed save/discard attempt. */
  errorMessage?: string | null
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}

export const UnsavedChangesDialog = ({
  isOpen,
  fileName,
  errorMessage = null,
  onSave,
  onDiscard,
  onCancel,
}: UnsavedChangesDialogProps): ReactElement | null => {
  const labelId = useId()
  const descriptionId = useId()
  const saveButtonRef = useRef<HTMLButtonElement | null>(null)
  const discardButtonRef = useRef<HTMLButtonElement | null>(null)
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null)

  // Capture whichever element held focus before the dialog opened so
  // we can restore it on close. Without this, dismissing the dialog
  // (especially Cancel, where the user intends to keep editing) leaves
  // focus on document.body — vim shortcuts then silently no-op until
  // the user clicks back into the editor, which looks like a freeze.
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      saveButtonRef.current?.focus()
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus()
      previousFocusRef.current = null
    }
  }, [isOpen])

  // Handle Escape key + focus trap. `aria-modal` is a hint to assistive
  // tech, not a browser-enforced constraint — without a JS trap, Tab
  // would cycle into the background workspace (terminal, sidebar,
  // editor), letting a keyboard user trigger a conflicting file switch
  // while the dialog is still open and holding `pendingFilePath`.
  useEffect(() => {
    if (!isOpen) {
      return undefined
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onCancel()

        return
      }

      if (event.key !== 'Tab') {
        return
      }

      const buttons = [
        saveButtonRef.current,
        discardButtonRef.current,
        cancelButtonRef.current,
      ].filter((b): b is HTMLButtonElement => b !== null)

      if (buttons.length === 0) {
        return
      }

      const currentIndex = buttons.indexOf(
        document.activeElement as HTMLButtonElement
      )
      const delta = event.shiftKey ? -1 : 1

      // If focus is not currently on a dialog button (e.g. the user
      // Tabbed from the backdrop or from outside), place focus on the
      // LAST button for Shift+Tab and the FIRST button for plain Tab —
      // matching the standard ARIA modal navigation convention.
      let nextIndex: number
      if (currentIndex === -1) {
        nextIndex = event.shiftKey ? buttons.length - 1 : 0
      } else {
        nextIndex = (currentIndex + delta + buttons.length) % buttons.length
      }

      event.preventDefault()
      buttons[nextIndex]?.focus()
    }

    document.addEventListener('keydown', handleKeyDown)

    return (): void => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onCancel])

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          className="fixed inset-0 z-[100] flex items-center justify-center"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 backdrop-blur-sm bg-black/40"
            onClick={onCancel}
          />

          {/* Panel */}
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: -8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: -8 }}
            transition={{
              type: 'spring',
              stiffness: 400,
              damping: 30,
            }}
            className="relative w-full max-w-md mx-4 bg-[#1e1e2e]/90 glass-panel rounded-2xl border border-[#4a444f]/30 shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="px-6 py-4 border-b border-surface-container-low/30">
              <h2
                id={labelId}
                className="text-lg font-manrope font-semibold text-on-surface"
              >
                Unsaved Changes
              </h2>
            </div>

            {/* Content */}
            <div className="px-6 py-5">
              <p
                id={descriptionId}
                className="text-sm text-on-surface/80 font-inter leading-relaxed"
              >
                <span className="font-medium text-on-surface">{fileName}</span>{' '}
                has unsaved changes. Do you want to save them before switching
                files?
              </p>
              {errorMessage && (
                <div
                  role="alert"
                  className="mt-4 px-3 py-2 rounded-md bg-error/10 border border-error/30 text-sm text-error font-inter"
                >
                  {errorMessage}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="px-6 py-4 border-t border-surface-container-low/30 flex gap-3 justify-end">
              {/* Save button (primary) */}
              <button
                ref={saveButtonRef}
                type="button"
                onClick={onSave}
                className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-on-primary font-inter font-medium text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-[#1e1e2e]"
              >
                Save
              </button>

              {/* Discard button (error) */}
              <button
                ref={discardButtonRef}
                type="button"
                onClick={onDiscard}
                className="px-4 py-2 rounded-lg bg-error hover:bg-error/90 text-on-error font-inter font-medium text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-error focus:ring-offset-2 focus:ring-offset-[#1e1e2e]"
              >
                Discard
              </button>

              {/* Cancel button (neutral) */}
              <button
                ref={cancelButtonRef}
                type="button"
                onClick={onCancel}
                className="px-4 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-inter font-medium text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-[#1e1e2e]"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
