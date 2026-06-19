import { AnimatePresence, motion } from 'framer-motion'
import {
  useCallback,
  useEffect,
  useRef,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'

type DialogPlacement = 'center' | 'top'
type DialogSize = 'sm' | 'md' | 'lg' | 'xl'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  placement?: DialogPlacement
  size?: DialogSize
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
  dismissDisabled?: boolean
  restoreFocus?: boolean
  initialFocusRef?: RefObject<HTMLElement | null>
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  testId?: string
  backdropTestId?: string
  children: ReactNode
}

interface DialogSectionProps {
  children: ReactNode
}

type DialogComponent = ((props: DialogProps) => ReactElement | null) & {
  Header: (props: DialogSectionProps) => ReactElement
  Body: (props: DialogSectionProps) => ReactElement
  Footer: (props: DialogSectionProps) => ReactElement
}

const PLACEMENT_CLASSES: Record<DialogPlacement, string> = {
  center: 'items-center justify-center',
  top: 'items-start justify-center pt-[15vh]',
}

const PANEL_SIZE_CLASSES: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}

const DIALOG_PANEL_CLASSES =
  'relative w-full mx-4 bg-surface-container/90 glass-panel rounded-2xl ' +
  'border border-outline-variant/30 shadow-2xl overflow-hidden'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const getFocusableElements = (container: HTMLElement): HTMLElement[] =>
  Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  ).filter(
    (element) =>
      !element.hasAttribute('disabled') &&
      element.getAttribute('aria-hidden') !== 'true' &&
      element.tabIndex >= 0
  )

const focusInitialElement = (
  container: HTMLElement,
  initialFocusRef: RefObject<HTMLElement | null> | undefined
): void => {
  const initial = initialFocusRef?.current

  if (
    initial !== null &&
    initial !== undefined &&
    !initial.hasAttribute('disabled')
  ) {
    initial.focus()

    return
  }

  const focusableElements = getFocusableElements(container)

  if (focusableElements.length > 0) {
    focusableElements[0]?.focus()

    return
  }

  container.focus()
}

const focusRelativeElement = (
  container: HTMLElement,
  event: KeyboardEvent
): void => {
  const focusableElements = getFocusableElements(container)

  if (focusableElements.length === 0) {
    event.preventDefault()
    container.focus()

    return
  }

  const activeElement =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null

  const currentIndex =
    activeElement === null ? -1 : focusableElements.indexOf(activeElement)

  const nextIndex =
    currentIndex === -1
      ? event.shiftKey
        ? focusableElements.length - 1
        : 0
      : (currentIndex + (event.shiftKey ? -1 : 1) + focusableElements.length) %
        focusableElements.length

  event.preventDefault()
  focusableElements[nextIndex]?.focus()
}

const DialogHeader = ({ children }: DialogSectionProps): ReactElement => (
  <div className="px-6 py-4 border-b border-surface-container-low/30">
    {children}
  </div>
)

const DialogBody = ({ children }: DialogSectionProps): ReactElement => (
  <div className="px-6 py-5">{children}</div>
)

const DialogFooter = ({ children }: DialogSectionProps): ReactElement => (
  <div className="px-6 py-4 border-t border-surface-container-low/30 flex gap-3 justify-end">
    {children}
  </div>
)

const DialogRoot = ({
  open,
  onOpenChange,
  placement = 'center',
  size = 'md',
  closeOnBackdrop = true,
  closeOnEscape = true,
  dismissDisabled = false,
  restoreFocus = true,
  initialFocusRef = undefined,
  'aria-label': ariaLabel = undefined,
  'aria-labelledby': ariaLabelledBy = undefined,
  'aria-describedby': ariaDescribedBy = undefined,
  testId = undefined,
  backdropTestId = undefined,
  children,
}: DialogProps): ReactElement | null => {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)

  const requestClose = useCallback((): void => {
    if (dismissDisabled) {
      return
    }

    onOpenChange(false)
  }, [dismissDisabled, onOpenChange])

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      wasOpenRef.current = true
      const dialog = dialogRef.current

      if (dialog !== null) {
        focusInitialElement(dialog, initialFocusRef)
      }
    } else if (!open && wasOpenRef.current) {
      wasOpenRef.current = false

      if (restoreFocus) {
        previousFocusRef.current?.focus()
      }

      previousFocusRef.current = null
    }
  }, [initialFocusRef, open, restoreFocus])

  useEffect(() => {
    if (!open) {
      return undefined
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (closeOnEscape) {
          requestClose()
        }

        return
      }

      if (event.key !== 'Tab') {
        return
      }

      const dialog = dialogRef.current

      if (dialog !== null) {
        focusRelativeElement(dialog, event)
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return (): void => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeOnEscape, open, requestClose])

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          tabIndex={-1}
          data-testid={testId}
          className={`fixed inset-0 z-[100] flex ${PLACEMENT_CLASSES[placement]}`}
        >
          <motion.div
            aria-hidden="true"
            data-testid={backdropTestId}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 backdrop-blur-sm bg-surface-container-lowest/40"
            onClick={closeOnBackdrop ? requestClose : undefined}
          />
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: -8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: -8 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className={`${DIALOG_PANEL_CLASSES} ${PANEL_SIZE_CLASSES[size]}`}
          >
            {children}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body
  )
}

export const Dialog: DialogComponent = Object.assign(DialogRoot, {
  Header: DialogHeader,
  Body: DialogBody,
  Footer: DialogFooter,
})
