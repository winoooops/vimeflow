import { AnimatePresence, motion } from 'framer-motion'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import {
  closeNativeOverlay,
  NATIVE_OVERLAY_KINDS,
  nativeOverlayThemeSnapshot,
  openNativeOverlay,
  selectFloatingTransport,
  type NativeOverlayActionHandler,
  type NativeOverlayDialogPayload,
  warnNativeOverlayFallback,
} from '@/components/base/floating/nativeOverlay'

export type {
  NativeOverlayActionEvent,
  NativeOverlayActionHandler,
  NativeOverlayCommandPaletteDialogPayload,
  NativeOverlayNewSessionDialogPayload,
} from '@/components/base/floating/nativeOverlay'

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
  /** Extra classes appended to the panel (e.g. a custom width). Last-wins over the size class. */
  panelClassName?: string
  nativeOverlay?: boolean
  nativeOverlayPayload?: NativeOverlayDialogPayload
  nativeOverlayActions?: ReadonlyMap<string, NativeOverlayActionHandler>
  onNativeOverlayActiveChange?: (active: boolean) => void
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

const EMPTY_NATIVE_OVERLAY_ACTIONS = new Map<
  string,
  NativeOverlayActionHandler
>()

const closeAcceptedNativeOverlayIfDismissed = (
  surfaceId: string,
  canAttemptNativeRef: RefObject<boolean>
): void => {
  if (canAttemptNativeRef.current) {
    return
  }

  closeNativeOverlay(surfaceId)
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable]:not([contenteditable="false"])',
].join(',')

const isVisibleFocusableElement = (element: HTMLElement): boolean => {
  const elementStyle = window.getComputedStyle(element)

  if (elementStyle.display === 'none' || elementStyle.visibility === 'hidden') {
    return false
  }

  let ancestor: Element | null = element.parentElement

  while (ancestor !== null) {
    if (window.getComputedStyle(ancestor).display === 'none') {
      return false
    }

    ancestor = ancestor.parentElement
  }

  return true
}

const getFocusableElements = (container: HTMLElement): HTMLElement[] =>
  Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  ).filter(
    (element) =>
      !element.hasAttribute('disabled') &&
      element.getAttribute('aria-hidden') !== 'true' &&
      (element.tabIndex >= 0 ||
        (element.hasAttribute('contenteditable') &&
          element.getAttribute('contenteditable') !== 'false')) &&
      isVisibleFocusableElement(element)
  )

interface DialogLayer {
  close: () => boolean
  container: HTMLDivElement
}

const dialogStack: DialogLayer[] = []

const handleDocumentKeyDown = (event: KeyboardEvent): void => {
  if (dialogStack.length === 0) {
    return
  }

  const topLayer = dialogStack[dialogStack.length - 1]

  if (event.key === 'Escape') {
    if (topLayer.close()) {
      event.stopImmediatePropagation()
    }

    return
  }

  if (event.key === 'Tab') {
    focusRelativeElement(topLayer.container, event)
  }
}

const registerDialogLayer = (layer: DialogLayer): void => {
  if (dialogStack.length === 0) {
    document.addEventListener('keydown', handleDocumentKeyDown)
  }

  dialogStack.push(layer)
}

const unregisterDialogLayer = (layer: DialogLayer): void => {
  const index = dialogStack.indexOf(layer)

  if (index !== -1) {
    dialogStack.splice(index, 1)
  }

  if (dialogStack.length === 0) {
    document.removeEventListener('keydown', handleDocumentKeyDown)
  }
}

const focusInitialElement = (
  container: HTMLElement,
  initialFocusRef: RefObject<HTMLElement | null> | undefined
): void => {
  const initial = initialFocusRef?.current

  if (
    initial !== null &&
    initial !== undefined &&
    !initial.hasAttribute('disabled') &&
    isVisibleFocusableElement(initial)
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
  panelClassName = undefined,
  nativeOverlay = false,
  nativeOverlayPayload = undefined,
  nativeOverlayActions = EMPTY_NATIVE_OVERLAY_ACTIONS,
  onNativeOverlayActiveChange = undefined,
  children,
}: DialogProps): ReactElement | null => {
  const surfaceId = useId()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)
  const restoreFocusRef = useRef(restoreFocus)
  const nativeOverlayQueueRef = useRef<Promise<void>>(Promise.resolve())
  const nativeOverlayGenerationRef = useRef(0)
  const canAttemptNativeRef = useRef(false)

  const [nativeAttempt, setNativeAttempt] = useState<
    'idle' | 'pending' | 'active' | 'failed'
  >('idle')
  restoreFocusRef.current = restoreFocus

  const transport = selectFloatingTransport(nativeOverlay)

  const nativeUnsupportedReason =
    nativeOverlayPayload === undefined ? 'unsupported dialog content' : null

  const canAttemptNative =
    open && transport === 'native-overlay' && nativeUnsupportedReason === null
  canAttemptNativeRef.current = canAttemptNative

  const hideLocalForNative = canAttemptNative && nativeAttempt !== 'failed'
  const nativeOverlayActive = canAttemptNative && nativeAttempt === 'active'

  useEffect(() => {
    onNativeOverlayActiveChange?.(nativeOverlayActive)
  }, [nativeOverlayActive, onNativeOverlayActiveChange])

  useEffect(() => {
    if (
      open &&
      nativeOverlay &&
      transport === 'native-overlay' &&
      nativeUnsupportedReason !== null
    ) {
      warnNativeOverlayFallback(nativeUnsupportedReason)
    }

    if (
      !open ||
      !nativeOverlay ||
      transport !== 'native-overlay' ||
      nativeUnsupportedReason !== null
    ) {
      nativeOverlayGenerationRef.current += 1
      closeNativeOverlay(surfaceId)
      setNativeAttempt('idle')

      return
    }
  }, [nativeOverlay, nativeUnsupportedReason, open, surfaceId, transport])

  useEffect(
    () => (): void => {
      canAttemptNativeRef.current = false
      nativeOverlayGenerationRef.current += 1
      closeNativeOverlay(surfaceId)
    },
    [surfaceId]
  )

  useEffect(() => {
    if (!canAttemptNative || nativeOverlayPayload === undefined) {
      return
    }

    const generation = nativeOverlayGenerationRef.current + 1
    const cancelled = { current: false }
    nativeOverlayGenerationRef.current = generation
    setNativeAttempt((current) => (current === 'active' ? 'active' : 'pending'))

    const openAfterPrevious = async (): Promise<void> => {
      const previousOpen = nativeOverlayQueueRef.current

      await previousOpen

      if (
        cancelled.current ||
        nativeOverlayGenerationRef.current !== generation
      ) {
        return
      }

      const accepted = await openNativeOverlay(
        {
          surfaceId,
          kind: NATIVE_OVERLAY_KINDS.dialog,
          anchorRect: {
            x: 0,
            y: 0,
            width: window.innerWidth,
            height: window.innerHeight,
          },
          placement,
          payload: nativeOverlayPayload,
          theme: nativeOverlayThemeSnapshot(),
        },
        {
          actions: nativeOverlayActions,
          onClose: (): void => onOpenChange(false),
        }
      )

      if (nativeOverlayGenerationRef.current !== generation) {
        if (accepted) {
          closeAcceptedNativeOverlayIfDismissed(surfaceId, canAttemptNativeRef)
        }

        return
      }

      setNativeAttempt(accepted ? 'active' : 'failed')
    }

    const currentOpen = openAfterPrevious()

    nativeOverlayQueueRef.current = currentOpen
    void currentOpen

    return (): void => {
      cancelled.current = true
    }
  }, [
    canAttemptNative,
    nativeOverlayActions,
    nativeOverlayPayload,
    onOpenChange,
    placement,
    surfaceId,
  ])

  const requestClose = useCallback((): void => {
    if (dismissDisabled) {
      return
    }

    onOpenChange(false)
  }, [dismissDisabled, onOpenChange])

  const requestCloseRef = useRef(requestClose)
  requestCloseRef.current = requestClose

  const dismissDisabledRef = useRef(dismissDisabled)
  dismissDisabledRef.current = dismissDisabled

  const closeOnEscapeRef = useRef(closeOnEscape)
  closeOnEscapeRef.current = closeOnEscape

  useEffect(() => {
    if (hideLocalForNative) {
      return
    }

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
  }, [hideLocalForNative, initialFocusRef, open, restoreFocus])

  useEffect(
    () => (): void => {
      if (wasOpenRef.current && restoreFocusRef.current) {
        previousFocusRef.current?.focus()
      }
    },
    []
  )

  useEffect(() => {
    if (!open || hideLocalForNative) {
      return undefined
    }

    const dialog = dialogRef.current

    if (dialog === null) {
      return undefined
    }

    const layer: DialogLayer = {
      close: (): boolean => {
        if (!closeOnEscapeRef.current || dismissDisabledRef.current) {
          return false
        }

        requestCloseRef.current()

        return true
      },
      container: dialog,
    }

    registerDialogLayer(layer)

    return (): void => {
      unregisterDialogLayer(layer)
    }
  }, [hideLocalForNative, open])

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
          aria-hidden={hideLocalForNative ? 'true' : undefined}
          inert={hideLocalForNative ? true : undefined}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          tabIndex={-1}
          data-testid={testId}
          className={`fixed inset-0 z-[100] flex ${PLACEMENT_CLASSES[placement]}${
            hideLocalForNative ? ' pointer-events-none opacity-0' : ''
          }`}
        >
          <motion.div
            aria-hidden="true"
            data-testid={backdropTestId}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 backdrop-blur-sm bg-scrim/40"
            onClick={closeOnBackdrop ? requestClose : undefined}
          />
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: -8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: -8 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className={`${DIALOG_PANEL_CLASSES} ${PANEL_SIZE_CLASSES[size]}${
              panelClassName !== undefined ? ` ${panelClassName}` : ''
            }`}
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
