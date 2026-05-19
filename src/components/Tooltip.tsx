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
import { formatShortcut, type ShortcutInput } from '../lib/formatShortcut'

export interface TooltipProps {
  content: ReactNode
  /**
   * Optional keyboard shortcut shown as a single chip on the right side
   * of the tooltip (Zed-style). Accepts a single key or a chord array
   * (e.g. `['Mod', 'E']`). Display formatting is platform-aware — see
   * `formatShortcut`.
   */
  shortcut?: ShortcutInput
  children: ReactElement
  placement?: Placement
  delayMs?: number
  disabled?: boolean
  maxWidth?: number
  className?: string
}

const TOOLTIP_CLASSES =
  'pointer-events-none z-50 rounded-md shadow-lg px-3 py-1.5 ' +
  'bg-surface-container-high/90 backdrop-blur-md backdrop-saturate-150 ' +
  'border border-outline-variant/20 ' +
  'text-xs text-on-surface'

const SHORTCUT_CHIP_CLASSES =
  'shrink-0 rounded bg-on-surface/10 px-1.5 py-0.5 font-mono text-[10px] ' +
  'text-on-surface-variant'

export const Tooltip = ({
  content,
  shortcut = undefined,
  children,
  placement = 'top',
  delayMs = 250,
  disabled = false,
  maxWidth = 320,
  className = '',
}: TooltipProps): ReactElement => {
  // `content != null` would admit falsy ReactNodes (`false`, `''`) and render
  // an empty floating box — these are common with the `cond && 'text'` idiom.
  // `0` is still treated as content (it renders as a visible "0" tooltip).
  const hasContent = content != null && content !== false && content !== ''
  const enabled = !disabled && hasContent && isValidElement(children)

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
      {cloneElement(children as ReactElement<Record<string, unknown>>, {
        ref: mergedRef,
        ...getReferenceProps(children.props as Record<string, unknown>),
      })}
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
            {shortcut !== undefined ? (
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1">{content}</span>
                <kbd
                  data-testid="tooltip-shortcut"
                  className={SHORTCUT_CHIP_CLASSES}
                >
                  {formatShortcut(shortcut)}
                </kbd>
              </div>
            ) : (
              content
            )}
          </div>
        </FloatingPortal>
      )}
    </>
  )
}
