import {
  useEffect,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react'
import { useFloatingSurface } from '@/components/base/floating/useFloatingSurface'
import { SurfacePanel } from '@/components/base/floating/SurfacePanel'
import { type Placement } from '@/components/base/floating/glassSurface'
import {
  selectFloatingTransport,
  warnNativeOverlayFallback,
} from '@/components/base/floating/nativeOverlay'

interface PopoverProps {
  anchor: HTMLElement | null
  open: boolean
  onOpenChange: (open: boolean) => void
  placement?: Placement
  width?: number
  pointerEvents?: CSSProperties['pointerEvents']
  focus?: 'dialog' | 'none'
  // e.g. { ancestorScroll: false } for a plain-dismiss confirm dialog
  middleware?: { ancestorScroll?: boolean }
  'aria-label': string
  nativeOverlay?: boolean
  children: ReactNode
}

// Public dialog card primitive. Composes the floating substrate with
// role=dialog + modal focus management (initialFocus 0 moves focus to the
// first tabbable child on open, engaging the modal trap).
export const Popover = ({
  anchor,
  open,
  onOpenChange,
  placement = undefined,
  width = undefined,
  pointerEvents = undefined,
  focus = 'dialog',
  middleware = undefined,
  'aria-label': ariaLabel,
  nativeOverlay = false,
  children,
}: PopoverProps): ReactElement | null => {
  const { refs, floatingStyles, context, getFloatingProps } =
    useFloatingSurface({
      anchor,
      open,
      onOpenChange,
      placement,
      role: 'dialog',
      middleware,
    })

  useEffect(() => {
    if (
      open &&
      nativeOverlay &&
      selectFloatingTransport(nativeOverlay) === 'native-overlay'
    ) {
      warnNativeOverlayFallback('popover native overlay is not in v0')
    }
  }, [nativeOverlay, open])

  if (!open) {
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
      focus={focus === 'dialog' ? { initialFocus: 0, modal: true } : false}
      aria-label={ariaLabel}
      {...getFloatingProps()}
    >
      {children}
    </SurfacePanel>
  )
}
