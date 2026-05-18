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
}

export interface UseElasticContainerResult extends UseResizableResult {
  pixelMin: number
  pixelMax: number
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
}: UseElasticContainerOptions): UseElasticContainerResult => {
  const minPercentRef = useRef(minPercent)
  const maxPercentRef = useRef(maxPercent)
  const initialPercentRef = useRef(initialPercent)

  const [pixelMin, setPixelMin] = useState(0)
  const [pixelMax, setPixelMax] = useState(Number.MAX_SAFE_INTEGER)

  const pixelMinRef = useRef(0)
  const pixelMaxRef = useRef(Number.MAX_SAFE_INTEGER)
  const isDraggingRef = useRef(false)
  const pendingClampRef = useRef(false)

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
  // sizeRef/pixelMinRef/pixelMaxRef are stable refs — their identity never
  // changes and .current mutations are not reactive, so they are intentionally
  // omitted from the dep array (exhaustive-deps would add them but refs are
  // never the right reactive trigger).
  useEffect(() => {
    if (isDragging || !pendingClampRef.current) {
      return
    }

    pendingClampRef.current = false
    resetToSize(sizeRef.current, pixelMinRef.current, pixelMaxRef.current)
  }, [isDragging, resetToSize])
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

      const newMin = Math.ceil(dimension * configuredMin)
      let newMax = Math.floor(dimension * configuredMax)

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
    const { newMin, newMax } = computeBounds(dimension)

    // Mount-time degenerate guard: throw inside useLayoutEffect so React
    // propagates it to an error boundary (unlike ResizeObserver callbacks,
    // which run outside React's event loop and bypass error boundaries).
    if (import.meta.env.DEV && newMin >= newMax) {
      throw new Error(
        `useElasticContainer: degenerate container at mount — pixelMin(${newMin}) >= pixelMax(${newMax}). Container may be zero-width/height.`
      )
    }

    const effectiveInitial =
      initialPercentRef.current ??
      (minPercentRef.current + maxPercentRef.current) / 2
    const nextInitial = clampSize(dimension * effectiveInitial, newMin, newMax)

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

      const { newMin: resizedMin, newMax: resizedMax } =
        computeBounds(nextDimension)

      pixelMinRef.current = resizedMin
      pixelMaxRef.current = resizedMax
      setPixelMin(resizedMin)
      setPixelMax(resizedMax)

      if (isDraggingRef.current) {
        pendingClampRef.current = true

        return
      }

      resetToSize(sizeRef.current, resizedMin, resizedMax)
    })

    observer.observe(containerElement)

    return (): void => {
      observer.disconnect()
    }
    // axis, percent config, and containerRef are mount-time constants by contract.
    // Re-running this effect after pixel-bound state updates would reset user size.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    ...resizable,
    pixelMin,
    pixelMax,
  }
}
