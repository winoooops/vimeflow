import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react'

interface PriorityPlusProps {
  children: readonly ReactNode[]
  maxRows?: number
  gap?: string
}

// Priority+ overflow: render all children, measure positions, hide anything
// beyond `maxRows` into a portal-rendered `...` menu. Re-measures on container
// resize via ResizeObserver. Children must be stable across renders (use
// `key`) so refs map consistently.
//
// Measurement is a two-phase pass:
//   Phase A — overflowFrom === null: render every child with real layout so we
//     can measure each item's top/left/right against the container.
//   Phase B — overflowFrom === <index>: items beyond the cutoff get `hidden`
//     and the OverflowMenu chip mounts on the last allowed row.
// `resizeTick` bumps on every observer fire so React doesn't bail when the
// measurement effect would otherwise re-run with the same overflowFrom value.
export const PriorityPlus = ({
  children,
  maxRows = 2,
  gap = 'gap-x-3 gap-y-2',
}: PriorityPlusProps): ReactElement => {
  const containerRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  // null → measurement pending (Phase A: all items visible).
  // number → that index and after are overflowed (Phase B: trimmed + chip).
  const [overflowFrom, setOverflowFrom] = useState<number | null>(null)
  // Tick bumps on every ResizeObserver fire so the measurement effect re-runs
  // even when the prior measurement landed on the same value (React bails on
  // identical setState, which would otherwise skip subsequent re-measures).
  const [resizeTick, setResizeTick] = useState(0)

  useLayoutEffect(() => {
    const node = containerRef.current
    if (!node) {
      return
    }

    const observer = new ResizeObserver(() => {
      setOverflowFrom(null)
      setResizeTick((t) => t + 1)
    })
    observer.observe(node)

    return (): void => {
      observer.disconnect()
    }
  }, [])

  // Measurement pass — only runs while overflowFrom is null (Phase A render).
  // Sets overflowFrom to the cutoff index (or null = nothing overflows).
  useLayoutEffect(() => {
    if (overflowFrom !== null) {
      return
    }
    const items = itemRefs.current
    const container = containerRef.current
    const firstItem = items.find((i) => i !== null)
    if (!firstItem || !container) {
      return
    }
    const itemHeight = firstItem.offsetHeight
    const baseTop = firstItem.offsetTop
    // An item is "overflowed" when its row index >= maxRows. A small half-row
    // tolerance absorbs sub-pixel rounding from different item heights.
    const maxAllowedTop = baseTop + itemHeight * (maxRows - 1) + itemHeight / 2

    let cutoff: number | null = null
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item) {
        continue
      }
      if (item.offsetTop > maxAllowedTop) {
        cutoff = i
        break
      }
    }

    // Reserve room for the overflow chip on the last visible item's row.
    // Phase A renders WITHOUT the chip, so the trailing free space on the
    // last allowed row is `containerWidth - lastItemRight`. If that's less
    // than the chip's width-plus-gap, the chip would wrap to a new row when
    // Phase B inserts it — pull the cutoff back by one so the chip lands on
    // the last allowed row instead of below it. Width is the rendered chip
    // (`w-8 h-8` = 32 px) plus the toolbar's `gap-x-3` (12 px).
    const chipWidthWithGap = 44
    if (cutoff !== null && cutoff > 0) {
      const lastVisible = items[cutoff - 1]
      if (lastVisible) {
        const containerWidth = container.clientWidth
        const lastRight = lastVisible.offsetLeft + lastVisible.offsetWidth
        const remaining = containerWidth - lastRight
        if (remaining < chipWidthWithGap) {
          cutoff = Math.max(0, cutoff - 1)
        }
      }
    }

    setOverflowFrom(cutoff)
  }, [overflowFrom, maxRows, children.length, resizeTick])

  const showOverflow = overflowFrom !== null && overflowFrom < children.length
  const visibleEnd = showOverflow ? overflowFrom : children.length
  const hiddenItems = showOverflow ? children.slice(overflowFrom) : []

  return (
    <div ref={containerRef} className={`flex flex-wrap items-center ${gap}`}>
      {children.map((child, index) => {
        const isHidden = overflowFrom !== null && index >= visibleEnd

        return (
          <div
            key={index}
            ref={(el): void => {
              itemRefs.current[index] = el
            }}
            // Hidden items get `hidden` so they're laid out only during the
            // Phase A measurement pass; once measured we drop them from the
            // visible flow without breaking the ref map.
            className={isHidden ? 'hidden' : ''}
          >
            {child}
          </div>
        )
      })}
      {showOverflow ? <OverflowMenu hiddenItems={hiddenItems} /> : null}
    </div>
  )
}

// Private helper — not exported. The chip + portal-rendered popover that
// hosts the overflowed children. Closes on scroll so it can't drift away
// from the trigger when the toolbar scrolls underneath it.
const OverflowMenu = ({
  hiddenItems,
}: {
  hiddenItems: readonly ReactNode[]
}): ReactElement => {
  const [open, setOpen] = useState(false)

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-end',
    middleware: [offset(4), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'menu' })

  const { getReferenceProps, getFloatingProps } = useInteractions([
    dismiss,
    role,
  ])

  useEffect(() => {
    if (!open) {
      return
    }
    const onScroll = (): void => setOpen(false)
    window.addEventListener('scroll', onScroll, true)

    return (): void => {
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        onClick={(): void => setOpen((previous) => !previous)}
        className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-surface-container-high/60 hover:bg-surface-container-highest/80 text-on-surface transition-colors"
        aria-label={`Show ${hiddenItems.length} more controls`}
        title={`Show ${hiddenItems.length} more controls`}
        {...getReferenceProps()}
      >
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-base leading-none"
        >
          more_horiz
        </span>
      </button>
      {open ? (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="z-50 flex flex-col gap-2 p-3 rounded-lg bg-surface-container-high/95 backdrop-blur-md backdrop-saturate-150 border border-outline-variant/20 shadow-xl max-w-[320px]"
            {...getFloatingProps()}
          >
            {hiddenItems.map((item, index) => (
              <div key={index}>{item}</div>
            ))}
          </div>
        </FloatingPortal>
      ) : null}
    </>
  )
}
