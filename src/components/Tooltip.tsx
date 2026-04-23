import {
  cloneElement,
  isValidElement,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react'
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  safePolygon,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useMergeRefs,
  useRole,
  type Placement,
} from '@floating-ui/react'

export interface TooltipProps {
  content: ReactNode
  children: ReactElement
  placement?: Placement
  delayMs?: number
  disabled?: boolean
  maxWidth?: number
  className?: string
}

const TOOLTIP_CLASSES =
  'pointer-events-none z-50 rounded-lg shadow-lg px-3 py-2 ' +
  'bg-surface-container-high/90 backdrop-blur-md backdrop-saturate-150 ' +
  'text-xs text-on-surface'

export const Tooltip = ({
  content,
  children,
  placement = 'top',
  delayMs = 250,
  disabled = false,
  maxWidth = 320,
  className = '',
}: TooltipProps): ReactElement => {
  const enabled = !disabled && content != null && isValidElement(children)

  const [open, setOpen] = useState(false)

  // Reset stale open state when the tooltip becomes ineligible mid-flight
  // (consumer toggles disabled, or content drops to null/undefined). Without
  // this, re-enabling the same instance later would resurrect the tooltip
  // with no fresh hover/focus event.
  useEffect(() => {
    if (!enabled) {
      setOpen(false)
    }
  }, [enabled])

  const {
    refs,
    floatingStyles,
    context,
    placement: resolvedPlacement,
  } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip(), shift({ padding: 8 })],
  })

  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, {
      enabled,
      delay: { open: delayMs, close: 0 },
      handleClose: safePolygon(),
    }),
    useFocus(context, { enabled }),
    useDismiss(context, { enabled, escapeKey: true }),
    useRole(context, { enabled, role: 'tooltip' }),
  ])

  const childRef = isValidElement(children)
    ? (children.props as { ref?: Ref<unknown> }).ref
    : undefined
  const mergedRef = useMergeRefs([refs.setReference, childRef])

  if (!enabled) {
    return children
  }

  return (
    <>
      {cloneElement(children, {
        ref: mergedRef,
        ...getReferenceProps(children.props as Record<string, unknown>),
      } as never)}
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            data-placement={resolvedPlacement}
            style={{ ...floatingStyles, maxWidth }}
            className={
              className ? `${TOOLTIP_CLASSES} ${className}` : TOOLTIP_CLASSES
            }
            {...getFloatingProps()}
          >
            {content}
          </div>
        </FloatingPortal>
      )}
    </>
  )
}
