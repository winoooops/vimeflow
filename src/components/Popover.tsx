import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react'
import {
  useFloatingSurface,
  type FloatingVirtualRect,
} from '@/components/base/floating/useFloatingSurface'
import { SurfacePanel } from '@/components/base/floating/SurfacePanel'
import { type Placement } from '@/components/base/floating/glassSurface'
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
  NativeOverlayActionHandler,
  NativeOverlayDialogRequest,
  NativeOverlayNotificationCenterDialogPayload,
  NativeOverlayNotificationCenterItem,
  NativeOverlayRequest,
} from '@/components/base/floating/nativeOverlay'

export { preloadNativeOverlay } from '@/components/base/floating/nativeOverlay'

export type PopoverPlacement = Placement

interface PopoverProps {
  anchor: HTMLElement | FloatingVirtualRect | null
  open: boolean
  onOpenChange: (open: boolean) => void
  placement?: Placement
  width?: number
  offset?: number
  pointerEvents?: CSSProperties['pointerEvents']
  focus?: 'dialog' | 'dialog-unfocused' | 'none'
  // Passed to FloatingFocusManager. Default true (focus returns to the
  // previously focused element on close). Set false when the caller restores
  // focus itself — e.g. the notification island refocuses its bell with
  // focusVisible: false so an Escape close never paints a focus ring.
  returnFocus?: boolean
  // e.g. { ancestorScroll: false } for a plain-dismiss confirm dialog
  middleware?: { ancestorScroll?: boolean }
  dismissWhen?: (event: MouseEvent) => boolean
  className?: string
  'aria-label': string
  nativeOverlay?: boolean
  nativeOverlayPayload?: NativeOverlayDialogPayload
  nativeOverlayActions?: ReadonlyMap<string, NativeOverlayActionHandler>
  onNativeOverlayActiveChange?: (active: boolean) => void
  children: ReactNode
}

const EMPTY_NATIVE_OVERLAY_ACTIONS = new Map<
  string,
  NativeOverlayActionHandler
>()

// 'dialog' moves focus to the first tabbable child on open;
// 'dialog-unfocused' keeps the modal trap and Escape handling but leaves
// focus where it was — keyboard users Tab in when they choose to.
const POPOVER_FOCUS_CONFIG = {
  dialog: { initialFocus: 0, modal: true },
  'dialog-unfocused': { initialFocus: -1, modal: true },
  none: false,
} as const

// Public dialog card primitive. Composes the floating substrate with
// role=dialog + modal focus management (initialFocus 0 moves focus to the
// first tabbable child on open, engaging the modal trap).
export const Popover = ({
  anchor,
  open,
  onOpenChange,
  placement = undefined,
  width = undefined,
  offset = undefined,
  pointerEvents = undefined,
  focus = 'dialog',
  returnFocus = true,
  middleware = undefined,
  dismissWhen = undefined,
  className = undefined,
  'aria-label': ariaLabel,
  nativeOverlay = false,
  nativeOverlayPayload = undefined,
  nativeOverlayActions = EMPTY_NATIVE_OVERLAY_ACTIONS,
  onNativeOverlayActiveChange = undefined,
  children,
}: PopoverProps): ReactElement | null => {
  const surfaceId = `popover:${useId()}`
  const nativeGenerationRef = useRef(0)
  const nativeQueueRef = useRef<Promise<void>>(Promise.resolve())
  const canAttemptNativeRef = useRef(false)
  const nativeOverlayActionsRef = useRef(nativeOverlayActions)
  const onOpenChangeRef = useRef(onOpenChange)

  const [nativeAttempt, setNativeAttempt] = useState<
    'idle' | 'pending' | 'active' | 'failed'
  >('idle')

  nativeOverlayActionsRef.current = nativeOverlayActions
  onOpenChangeRef.current = onOpenChange

  const transport = selectFloatingTransport(nativeOverlay)

  const nativeUnsupportedReason =
    nativeOverlayPayload === undefined
      ? 'unsupported popover content'
      : anchor === null
        ? 'missing popover anchor'
        : null

  const canAttemptNative =
    open && transport === 'native-overlay' && nativeUnsupportedReason === null
  canAttemptNativeRef.current = canAttemptNative
  const hideLocalForNative = canAttemptNative && nativeAttempt !== 'failed'
  const nativeOverlayActive = canAttemptNative && nativeAttempt === 'active'

  const { refs, floatingStyles, context, getFloatingProps } =
    useFloatingSurface({
      anchor,
      open,
      onOpenChange,
      placement,
      offset,
      role: 'dialog',
      middleware,
      dismissWhen,
    })

  useEffect(() => {
    if (
      open &&
      nativeOverlay &&
      transport === 'native-overlay' &&
      nativeUnsupportedReason !== null
    ) {
      warnNativeOverlayFallback(nativeUnsupportedReason)
    }

    if (!canAttemptNative) {
      nativeGenerationRef.current += 1
      closeNativeOverlay(surfaceId)
      setNativeAttempt('idle')
    }
  }, [
    canAttemptNative,
    nativeOverlay,
    nativeUnsupportedReason,
    open,
    surfaceId,
    transport,
  ])

  useEffect(
    () => (): void => {
      canAttemptNativeRef.current = false
      nativeGenerationRef.current += 1
      closeNativeOverlay(surfaceId)
    },
    [surfaceId]
  )

  useEffect(() => {
    onNativeOverlayActiveChange?.(nativeOverlayActive)
  }, [nativeOverlayActive, onNativeOverlayActiveChange])

  useEffect(() => {
    if (!canAttemptNative || nativeOverlayPayload === undefined) {
      return
    }

    const generation = nativeGenerationRef.current + 1
    const cancelled = { current: false }
    nativeGenerationRef.current = generation
    setNativeAttempt((current) => (current === 'active' ? 'active' : 'pending'))

    const openAfterPrevious = async (): Promise<void> => {
      await nativeQueueRef.current

      if (
        cancelled.current ||
        nativeGenerationRef.current !== generation ||
        anchor === null
      ) {
        return
      }

      const rect =
        anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor

      const accepted = await openNativeOverlay(
        {
          surfaceId,
          kind: NATIVE_OVERLAY_KINDS.dialog,
          anchorRect: {
            x: rect.x,
            y: rect.y,
            width: rect.width ?? 0,
            height: rect.height ?? 0,
          },
          placement: placement ?? 'bottom-start',
          payload: nativeOverlayPayload,
          theme: nativeOverlayThemeSnapshot(),
        },
        {
          actions: (actionId) => nativeOverlayActionsRef.current.get(actionId),
          onClose: (): void => onOpenChangeRef.current(false),
        }
      )

      if (nativeGenerationRef.current !== generation) {
        if (accepted && !canAttemptNativeRef.current) {
          closeNativeOverlay(surfaceId)
        }

        return
      }

      setNativeAttempt(accepted ? 'active' : 'failed')
    }

    const currentOpen = openAfterPrevious()
    nativeQueueRef.current = currentOpen
    void currentOpen

    return (): void => {
      cancelled.current = true
    }
  }, [anchor, canAttemptNative, nativeOverlayPayload, placement, surfaceId])

  if (!open || hideLocalForNative) {
    return null
  }

  return (
    <SurfacePanel
      setFloating={refs.setFloating}
      style={
        pointerEvents === undefined
          ? floatingStyles
          : { ...floatingStyles, pointerEvents }
      }
      context={context}
      width={width}
      className={className}
      focus={
        focus === 'none'
          ? false
          : { ...POPOVER_FOCUS_CONFIG[focus], returnFocus }
      }
      aria-label={ariaLabel}
      {...getFloatingProps()}
    >
      {children}
    </SurfacePanel>
  )
}
