import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { useElasticContainer } from '../../../../hooks/useElasticContainer'
import {
  KEYBOARD_STEP_PX,
  KEYBOARD_STEP_SHIFT_PX,
  SPLIT_ELASTIC_CONFIG,
} from '../../../workspace/panelConfig'
import { SPLIT_DIVIDER_PX } from './resolveGrid'
import {
  getTrackBoundaryRatio,
  getTrackCssVar,
  updateTrackBoundaryRatio,
  type RatioAxis,
} from '../../layout-registry'

const clampRatio = (ratio: number): number =>
  Math.min(
    Math.max(ratio, SPLIT_ELASTIC_CONFIG.minPercent),
    SPLIT_ELASTIC_CONFIG.maxPercent
  )

export interface SplitDividerBinding {
  isDragging: boolean
  size: number
  pixelMin: number
  pixelMax: number
  handleMouseDown: (event: React.MouseEvent) => void
  onKeyDown: (event: KeyboardEvent) => void
}

export interface UseSplitDividerArgs {
  containerRef: RefObject<HTMLElement | null>
  axis: 'horizontal' | 'vertical'
  trackAxis: RatioAxis
  trackIndex: number
  initialRatios: readonly number[]
  onRatioChange: (ratios: readonly number[]) => void
}

export const useSplitDivider = ({
  containerRef,
  axis,
  trackAxis,
  trackIndex,
  initialRatios,
  onRatioChange,
}: UseSplitDividerArgs): SplitDividerBinding => {
  const startVar = getTrackCssVar(trackAxis, trackIndex)
  const endVar = getTrackCssVar(trackAxis, trackIndex + 1)
  const effectiveDimensionRef = useRef(0)
  const initialRatiosRef = useRef(initialRatios)
  initialRatiosRef.current = initialRatios
  const persistIntentRef = useRef(false)

  const writeRatio = useCallback(
    (ratio: number): readonly number[] => {
      const el = containerRef.current

      const nextRatios = updateTrackBoundaryRatio(
        initialRatiosRef.current,
        trackIndex,
        ratio
      )
      const start = nextRatios[trackIndex]
      const end = nextRatios[trackIndex + 1]

      if (el) {
        el.style.setProperty(startVar, `${start}fr`)
        el.style.setProperty(endVar, `${end}fr`)
      }

      return nextRatios
    },
    [containerRef, endVar, startVar, trackIndex]
  )

  // useElasticContainer hands us pixel previews during a drag; convert to a
  // clamped ratio against the live pane-space dimension.
  const previewFromPx = useCallback(
    (px: number): void => {
      if (effectiveDimensionRef.current > 0) {
        writeRatio(clampRatio(px / effectiveDimensionRef.current))
      }
    },
    [writeRatio]
  )

  const elastic = useElasticContainer({
    containerRef,
    axis,
    minPercent: SPLIT_ELASTIC_CONFIG.minPercent,
    maxPercent: SPLIT_ELASTIC_CONFIG.maxPercent,
    initialPercent: getTrackBoundaryRatio(initialRatios, trackIndex),
    reservedPx: SPLIT_DIVIDER_PX,
    updateMode: 'commit-on-end',
    onDragPreview: previewFromPx,
  })

  const { size, effectiveDimension, pixelMin, pixelMax, isDragging, adjustBy } =
    elastic

  useEffect(() => {
    effectiveDimensionRef.current = effectiveDimension
  }, [effectiveDimension])

  // Committed `size` change (drag end | keyboard | resize): set both fr tracks.
  // Only explicit user actions mirror the ratio up for remember-within-session;
  // mount / ResizeObserver commits must keep untouched layouts on their model
  // defaults instead of accidentally marking them customized.
  //
  // When the committed pixel size lines up with the ratio model (within the
  // one-pixel rounding of the ResizeObserver / getBoundingClientRect path),
  // use the model's exact boundary ratio instead of `size / effectiveDimension`.
  // This keeps multi-track layouts like `grid3x2` stable on mount: two dividers
  // share the same axis, and propagating a rounded pixel ratio back into the
  // model can make the track weights oscillate instead of converging.
  useEffect(() => {
    if (effectiveDimension <= 0) {
      return
    }

    const impliedRatio = getTrackBoundaryRatio(initialRatios, trackIndex)
    const impliedSize = Math.round(effectiveDimension * impliedRatio)

    const ratio =
      size === impliedSize
        ? impliedRatio
        : clampRatio(size / effectiveDimension)

    const nextRatios = writeRatio(ratio)

    if (persistIntentRef.current) {
      persistIntentRef.current = false
      onRatioChange(nextRatios)
    }
  }, [
    size,
    effectiveDimension,
    writeRatio,
    onRatioChange,
    initialRatios,
    trackIndex,
  ])

  useEffect(() => {
    if (!isDragging) {
      persistIntentRef.current = false
    }
  }, [isDragging])

  // Restore the fr fallback when this divider unmounts (session deactivates).
  useEffect(
    () => (): void => {
      const el = containerRef.current
      el?.style.removeProperty(startVar)
      el?.style.removeProperty(endVar)
    },
    [containerRef, endVar, startVar]
  )

  const onKeyDown = useCallback(
    (event: KeyboardEvent): void => {
      const step = event.shiftKey ? KEYBOARD_STEP_SHIFT_PX : KEYBOARD_STEP_PX
      const grow = axis === 'horizontal' ? 'ArrowRight' : 'ArrowDown'
      const shrink = axis === 'horizontal' ? 'ArrowLeft' : 'ArrowUp'
      if (event.key === grow) {
        event.preventDefault()
        persistIntentRef.current = true
        adjustBy(step)
      } else if (event.key === shrink) {
        event.preventDefault()
        persistIntentRef.current = true
        adjustBy(-step)
      } else if (event.key === 'Home') {
        event.preventDefault()
        persistIntentRef.current = true
        adjustBy(pixelMin - size)
      } else if (event.key === 'End') {
        event.preventDefault()
        persistIntentRef.current = true
        adjustBy(pixelMax - size)
      }
    },
    [axis, adjustBy, pixelMin, pixelMax, size]
  )

  return {
    isDragging,
    size,
    pixelMin,
    pixelMax,
    handleMouseDown: (event): void => {
      persistIntentRef.current = true
      elastic.handleMouseDown(event)
    },
    onKeyDown,
  }
}
