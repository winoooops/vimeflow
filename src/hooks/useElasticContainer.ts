import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'
import {
  clampSize,
  useResizable,
  type UseResizableResult,
} from './useResizable'

export interface UseElasticContainerOptions {
  /**
   * Ref to the parent available-area element, not the resizable panel itself.
   * This is a mount-time constant and must be non-null when layout effects run.
   */
  containerRef: RefObject<Element | null>
  /**
   * Which dimension to observe. Maps directly to useResizable direction.
   * This is a mount-time constant.
   */
  axis: 'horizontal' | 'vertical'
  /** Fraction of available dimension for minimum size. */
  minPercent: number
  /** Fraction of available dimension for maximum size. */
  maxPercent: number
  /** Initial size as fraction of dimension. Defaults to midpoint. */
  initialPercent?: number
  invert?: boolean
  updateMode?: 'live' | 'commit-on-end'
  onDragPreview?: (size: number) => void
  /** Fixed pixels removed from the measured dimension before percentages apply
   *  (e.g. a divider track that sits between the two resizable regions).
   *  Default 0 — leaves single-panel consumers (the dock) unchanged.
   *  Mount-time constant by contract, like `axis` / `minPercent` / `maxPercent`:
   *  captured once into a ref; changing it after mount does NOT re-derive bounds. */
  reservedPx?: number
}

export interface UseElasticContainerResult extends UseResizableResult {
  pixelMin: number
  pixelMax: number
  effectiveDimension: number
}

export const useElasticContainer = ({
  containerRef,
  axis,
  minPercent,
  maxPercent,
  initialPercent,
  invert = false,
  updateMode = 'live',
  onDragPreview = undefined,
  reservedPx = 0,
}: UseElasticContainerOptions): UseElasticContainerResult => {
  const minPercentRef = useRef(minPercent)
  const maxPercentRef = useRef(maxPercent)
  const initialPercentRef = useRef(initialPercent)
  const reservedPxRef = useRef(reservedPx)

  const [pixelMin, setPixelMin] = useState(0)
  const [pixelMax, setPixelMax] = useState(Number.MAX_SAFE_INTEGER)
  const [effectiveDimension, setEffectiveDimension] = useState(0)

  const pixelMinRef = useRef(0)
  const pixelMaxRef = useRef(Number.MAX_SAFE_INTEGER)
  const isDraggingRef = useRef(false)
  const pendingClampRef = useRef(false)

  // desiredPercentRef tracks the user's intended proportional size so that
  // a window shrink→expand cycle restores the panel to the original proportion
  // rather than staying at the clamped pixel value.
  const desiredPercentRef = useRef(
    initialPercentRef.current ??
      (minPercentRef.current + maxPercentRef.current) / 2
  )
  // Current observed container dimension; used to convert pixel→percent on drag end.
  const dimensionRef = useRef(0)
  // Incremented each time the ResizeObserver drives a size change, so the
  // useLayoutEffect below can distinguish observer-driven from user-driven updates.
  const observerUpdateCountRef = useRef(0)
  const prevObserverUpdateCountRef = useRef(0)

  const resizable = useResizable({
    initial: 0,
    min: pixelMin,
    max: pixelMax,
    direction: axis,
    invert,
    updateMode,
    onDragPreview,
  })

  const { isDragging, resetToSize, sizeRef } = resizable

  useLayoutEffect(() => {
    isDraggingRef.current = isDragging
  }, [isDragging])

  /* eslint-disable react-hooks/exhaustive-deps */
  // sizeRef/pixelMinRef/pixelMaxRef/dimensionRef/desiredPercentRef are stable refs —
  // their identity never changes and .current mutations are not reactive.
  useEffect(() => {
    if (isDragging || !pendingClampRef.current) {
      return
    }

    pendingClampRef.current = false

    const effective = Math.max(1, dimensionRef.current - reservedPxRef.current)

    const targetPx =
      dimensionRef.current > 0
        ? Math.round(effective * desiredPercentRef.current)
        : sizeRef.current
    resetToSize(targetPx, pixelMinRef.current, pixelMaxRef.current)
  }, [isDragging, resetToSize])

  // Update desiredPercent when the user explicitly changes size (drag end or keyboard).
  // Skip updates caused by the ResizeObserver (observerUpdateCount changed) so that
  // container shrink→expand cycles restore the user's original proportion.
  useLayoutEffect(() => {
    if (prevObserverUpdateCountRef.current !== observerUpdateCountRef.current) {
      prevObserverUpdateCountRef.current = observerUpdateCountRef.current

      return
    }
    const effective = Math.max(1, dimensionRef.current - reservedPxRef.current)
    if (dimensionRef.current > 0) {
      desiredPercentRef.current = Math.min(
        Math.max(sizeRef.current / effective, minPercentRef.current),
        maxPercentRef.current
      )
    }
  }, [resizable.size])
  /* eslint-enable react-hooks/exhaustive-deps */

  const computeBounds = useCallback(
    (dimension: number): { newMin: number; newMax: number } => {
      const configuredMin = minPercentRef.current
      const configuredMax = maxPercentRef.current

      if (
        configuredMin <= 0 ||
        configuredMax > 1 ||
        configuredMin >= configuredMax
      ) {
        throw new Error(
          `useElasticContainer: invalid percent bounds minPercent=${configuredMin} maxPercent=${configuredMax}`
        )
      }

      const effective = Math.max(1, dimension - reservedPxRef.current)
      const newMin = Math.ceil(effective * configuredMin)
      let newMax = Math.floor(effective * configuredMax)

      if (newMin >= newMax) {
        newMax = newMin + 1
      }

      return { newMin, newMax }
    },
    []
  )

  useLayoutEffect(() => {
    const containerElement = containerRef.current
    if (!containerElement) {
      throw new Error(
        'useElasticContainer: containerRef.current is null at mount'
      )
    }

    const rect = containerElement.getBoundingClientRect()
    const dimension = axis === 'horizontal' ? rect.width : rect.height

    // Check dimension before computeBounds applies the 1-px floor — a zero
    // dimension means the container is hidden or collapsed at mount, which
    // is a configuration error the caller should fix.
    if (import.meta.env.DEV && dimension <= 0) {
      throw new Error(
        `useElasticContainer: container has zero ${axis === 'horizontal' ? 'width' : 'height'} at mount. The element may be hidden or not yet laid out.`
      )
    }

    const effective = Math.max(1, dimension - reservedPxRef.current)
    dimensionRef.current = dimension
    setEffectiveDimension(effective)

    const { newMin, newMax } = computeBounds(dimension)

    const effectiveInitial =
      initialPercentRef.current ??
      (minPercentRef.current + maxPercentRef.current) / 2
    const nextInitial = clampSize(effective * effectiveInitial, newMin, newMax)
    desiredPercentRef.current = effectiveInitial

    pixelMinRef.current = newMin
    pixelMaxRef.current = newMax
    setPixelMin(newMin)
    setPixelMax(newMax)
    resetToSize(nextInitial, newMin, newMax)

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]

      const nextDimension =
        axis === 'horizontal'
          ? entry.contentRect.width
          : entry.contentRect.height

      if (nextDimension <= 0) {
        return
      }

      dimensionRef.current = nextDimension
      const nextEffective = Math.max(1, nextDimension - reservedPxRef.current)
      setEffectiveDimension(nextEffective)

      const { newMin: resizedMin, newMax: resizedMax } =
        computeBounds(nextDimension)

      pixelMinRef.current = resizedMin
      pixelMaxRef.current = resizedMax
      observerUpdateCountRef.current += 1
      setPixelMin(resizedMin)
      setPixelMax(resizedMax)

      if (isDraggingRef.current) {
        pendingClampRef.current = true

        return
      }

      // Use desiredPercentRef so shrink→expand cycles restore the user's
      // original proportion rather than anchoring to a clamped pixel value.
      const proportionalPx = Math.round(
        nextEffective * desiredPercentRef.current
      )
      resetToSize(proportionalPx, resizedMin, resizedMax)
    })

    observer.observe(containerElement)

    return (): void => {
      observer.disconnect()
    }
    // axis, percent config, and containerRef are mount-time constants by contract.
    // Re-running this effect after pixel-bound state updates would reset user size.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Recompute bounds when the caller supplies new percent limits (e.g. a
  // multi-column divider whose feasible range depends on the current track
  // weights and the number of adjacent columns).
  const initialBoundsSetRef = useRef(false)

  useLayoutEffect(() => {
    if (!initialBoundsSetRef.current) {
      initialBoundsSetRef.current = true

      return
    }

    minPercentRef.current = minPercent
    maxPercentRef.current = maxPercent

    const dimension = dimensionRef.current
    if (dimension <= 0) {
      return
    }

    const { newMin, newMax } = computeBounds(dimension)
    pixelMinRef.current = newMin
    pixelMaxRef.current = newMax
    setPixelMin(newMin)
    setPixelMax(newMax)

    const effective = Math.max(1, dimension - reservedPxRef.current)

    const nextSize = clampSize(
      effective * desiredPercentRef.current,
      newMin,
      newMax
    )
    resetToSize(nextSize, newMin, newMax)
  }, [minPercent, maxPercent, computeBounds, resetToSize])

  return {
    ...resizable,
    pixelMin,
    pixelMax,
    effectiveDimension,
  }
}
