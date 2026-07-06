import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react'
import {
  FloatingFocusManager,
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
import {
  NATIVE_OVERLAY_KINDS,
  closeNativeOverlay,
  nativeOverlayThemeSnapshot,
  openNativeOverlay,
  selectFloatingTransport,
  warnNativeOverlayFallback,
} from '@/components/base/floating/nativeOverlay'
import { formatShortcut, type ShortcutInput } from '../lib/formatShortcut'

interface TooltipCommonProps {
  content: ReactNode
  children: ReactElement
  placement?: Placement
  delayMs?: number
  disabled?: boolean
  className?: string
  nativeOverlay?: boolean
}

/**
 * Default ("chrome") surface: the floating element renders its own rounded,
 * shadowed, blurred background. Supports the optional shortcut chip and a
 * `maxWidth` clamp.
 */
interface ChromeSurfaceProps {
  bare?: false
  /**
   * Optional keyboard shortcut shown as a single chip on the right side
   * of the tooltip (Zed-style). Accepts a single key or a chord array
   * (e.g. `['Mod', 'E']`). Display formatting is platform-aware — see
   * `formatShortcut`.
   */
  shortcut?: ShortcutInput
  maxWidth?: number
}

/**
 * Bare surface: the floating element renders with only `z-50` and any
 * consumer-provided `className` — the default visual chrome (rounded, shadow,
 * background, border) and the `maxWidth` clamp are omitted so the consumer
 * fully owns the surface styling. The chrome-only `shortcut` chip and
 * `maxWidth` clamp are unsupported here and typed `never` so the combination
 * is a compile error rather than a silently broken layout.
 */
interface BareSurfaceProps {
  bare: true
  shortcut?: never
  maxWidth?: never
}

type TooltipSurfaceProps = ChromeSurfaceProps | BareSurfaceProps

interface PassiveTooltipProps {
  interactive?: false
  ariaLabel?: never
}

interface InteractiveTooltipProps {
  /**
   * Allows pointer interaction inside the floating surface. Keep this off for
   * passive labels so regular tooltips remain non-interactive descriptions.
   */
  interactive: true
  ariaLabel: string
}

type TooltipInteractionProps = PassiveTooltipProps | InteractiveTooltipProps

export type TooltipProps = TooltipCommonProps &
  TooltipSurfaceProps &
  TooltipInteractionProps

const TOOLTIP_BASE_CLASSES =
  'z-50 rounded-md shadow-lg px-3 py-1.5 ' +
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
  nativeOverlay = false,
  interactive = false,
  ariaLabel = undefined,
  bare = false,
}: TooltipProps): ReactElement => {
  // `content != null` would admit falsy ReactNodes (`false`, `''`) and render
  // an empty floating box — these are common with the `cond && 'text'` idiom.
  // `0` is still treated as content (it renders as a visible "0" tooltip).
  const hasContent = content != null && content !== false && content !== ''
  const enabled = !disabled && hasContent && isValidElement(children)
  const nativeSurfaceId = `tooltip:${useId()}`

  const [open, setOpen] = useState(false)

  const [nativeFailed, setNativeFailed] = useState(false)

  const transport = selectFloatingTransport(nativeOverlay)
  const nativeTooltipText = typeof content === 'string' ? content : null

  const nativeUnsupportedReason =
    nativeTooltipText === null
      ? 'tooltip native overlay only supports plain text'
      : interactive
        ? 'interactive tooltip native overlay is not in v0'
        : bare
          ? 'bare tooltip native overlay is not in v0'
          : shortcut !== undefined
            ? 'shortcut tooltip native overlay is not in v0'
            : null

  const canUseNativeOverlay =
    open && transport === 'native-overlay' && nativeUnsupportedReason === null

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
      delay: { open: delayMs, close: interactive ? 150 : 0 },
      handleClose: interactive ? safePolygon() : undefined,
    }),
    useFocus(context, { enabled }),
    useDismiss(context, { enabled, escapeKey: true }),
    useRole(context, { enabled, role: interactive ? 'dialog' : 'tooltip' }),
  ])

  useEffect(() => {
    if (
      open &&
      transport === 'native-overlay' &&
      nativeUnsupportedReason !== null
    ) {
      warnNativeOverlayFallback(nativeUnsupportedReason)
    }
  }, [nativeUnsupportedReason, open, transport])

  const sendNativeTooltipRequest = useCallback(async (): Promise<boolean> => {
    if (nativeTooltipText === null) {
      return false
    }

    const reference = refs.reference.current
    if (!(reference instanceof Element)) {
      warnNativeOverlayFallback('tooltip native overlay is missing an anchor')
      setNativeFailed(true)

      return false
    }

    const rect = reference.getBoundingClientRect()

    return openNativeOverlay(
      {
        surfaceId: nativeSurfaceId,
        kind: NATIVE_OVERLAY_KINDS.tooltip,
        anchorRect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        placement,
        payload: {
          kind: 'tooltip',
          text: nativeTooltipText,
          maxWidth,
        },
        theme: nativeOverlayThemeSnapshot(),
      },
      {
        actions: new Map(),
        onClose: () => setOpen(false),
      }
    )
  }, [maxWidth, nativeSurfaceId, nativeTooltipText, placement, refs.reference])

  useEffect(() => {
    if (!canUseNativeOverlay || nativeTooltipText === null) {
      if (!open) {
        setNativeFailed(false)
      }

      return
    }

    const state = { canceled: false }
    setNativeFailed(false)

    void (async (): Promise<void> => {
      const accepted = await sendNativeTooltipRequest()

      if (state.canceled) {
        if (accepted) {
          closeNativeOverlay(nativeSurfaceId)
        }

        return
      }

      if (!accepted) {
        warnNativeOverlayFallback('tooltip native overlay was rejected')
        setNativeFailed(true)

        return
      }
    })()

    return (): void => {
      state.canceled = true
      closeNativeOverlay(nativeSurfaceId)
    }
  }, [
    canUseNativeOverlay,
    nativeSurfaceId,
    nativeTooltipText,
    open,
    sendNativeTooltipRequest,
  ])

  useEffect(() => {
    if (!canUseNativeOverlay || nativeTooltipText === null || nativeFailed) {
      return
    }

    let frameId: number | null = null
    let disposed = false

    const sendLatestRect = (): void => {
      if (frameId !== null) {
        return
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null

        void (async (): Promise<void> => {
          const accepted = await sendNativeTooltipRequest()
          if (disposed) {
            if (accepted) {
              closeNativeOverlay(nativeSurfaceId)
            }

            return
          }

          if (!accepted) {
            warnNativeOverlayFallback('tooltip native overlay was rejected')
            setNativeFailed(true)
          }
        })()
      })
    }

    const reference = refs.reference.current

    const observer =
      typeof ResizeObserver !== 'undefined' && reference instanceof Element
        ? new ResizeObserver(sendLatestRect)
        : null

    if (reference instanceof Element) {
      observer?.observe(reference)
    }

    window.addEventListener('resize', sendLatestRect)

    return (): void => {
      disposed = true
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }

      observer?.disconnect()
      window.removeEventListener('resize', sendLatestRect)
    }
  }, [
    canUseNativeOverlay,
    nativeFailed,
    nativeSurfaceId,
    nativeTooltipText,
    refs.reference,
    sendNativeTooltipRequest,
  ])

  const childRef = isValidElement(children)
    ? (children.props as { ref?: Ref<unknown> }).ref
    : undefined
  const mergedRef = useMergeRefs([refs.setReference, childRef])

  if (!enabled) {
    return children
  }

  const interactionClass = interactive
    ? 'pointer-events-auto'
    : 'pointer-events-none'

  const tooltipClasses = bare
    ? `${interactionClass} z-50`
    : `${interactionClass} ${TOOLTIP_BASE_CLASSES}`
  const classes = className ? `${tooltipClasses} ${className}` : tooltipClasses

  const showLocalTooltip = open && (!canUseNativeOverlay || nativeFailed)

  const floatingSurface = (
    <div
      ref={refs.setFloating}
      data-placement={resolvedPlacement}
      style={{ ...floatingStyles, maxWidth: bare ? undefined : maxWidth }}
      className={classes}
      {...getFloatingProps(
        ariaLabel === undefined ? undefined : { 'aria-label': ariaLabel }
      )}
    >
      {shortcut !== undefined ? (
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1">{content}</span>
          <kbd data-testid="tooltip-shortcut" className={SHORTCUT_CHIP_CLASSES}>
            {formatShortcut(shortcut)}
          </kbd>
        </div>
      ) : (
        content
      )}
    </div>
  )

  return (
    <>
      {cloneElement(children as ReactElement<Record<string, unknown>>, {
        ...getReferenceProps(children.props as Record<string, unknown>),
        ref: mergedRef,
      })}
      {showLocalTooltip && (
        <FloatingPortal>
          {interactive ? (
            <FloatingFocusManager
              context={context}
              // eslint-disable-next-line react/jsx-boolean-value -- non-modal lets Tab leave the floating surface after reaching its controls.
              modal={false}
              initialFocus={-1}
            >
              {floatingSurface}
            </FloatingFocusManager>
          ) : (
            floatingSurface
          )}
        </FloatingPortal>
      )}
    </>
  )
}
