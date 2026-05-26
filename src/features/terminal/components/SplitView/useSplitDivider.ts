import {
  useCallback,
  useEffect,
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
  cssVar: '--split-col' | '--split-row'
  initialRatio: number
  onRatioChange: (ratio: number) => void
}

export const useSplitDivider = ({
  containerRef,
  axis,
  cssVar,
  initialRatio,
  onRatioChange,
}: UseSplitDividerArgs): SplitDividerBinding => {
  const writeVar = useCallback(
    (px: number): void => {
      containerRef.current?.style.setProperty(cssVar, `${px}px`)
    },
    [containerRef, cssVar]
  )

  const elastic = useElasticContainer({
    containerRef,
    axis,
    minPercent: SPLIT_ELASTIC_CONFIG.minPercent,
    maxPercent: SPLIT_ELASTIC_CONFIG.maxPercent,
    initialPercent: initialRatio,
    reservedPx: SPLIT_DIVIDER_PX,
    updateMode: 'commit-on-end',
    onDragPreview: writeVar,
  })

  const { size, effectiveDimension, pixelMin, pixelMax, isDragging, adjustBy } =
    elastic

  // Committed `size` change (drag end | keyboard | resize): keep the var current
  // on the paths onDragPreview skips, and mirror the ratio up for remember-within-session.
  useEffect(() => {
    writeVar(size)
    if (effectiveDimension > 0) {
      const ratio = Math.min(
        Math.max(size / effectiveDimension, SPLIT_ELASTIC_CONFIG.minPercent),
        SPLIT_ELASTIC_CONFIG.maxPercent
      )
      onRatioChange(ratio)
    }
  }, [size, effectiveDimension, writeVar, onRatioChange])

  // Restore fr fallback control when this divider unmounts (session deactivates).
  useEffect(
    () => (): void => {
      containerRef.current?.style.removeProperty(cssVar)
    },
    [containerRef, cssVar]
  )

  const onKeyDown = useCallback(
    (event: KeyboardEvent): void => {
      const step = event.shiftKey ? KEYBOARD_STEP_SHIFT_PX : KEYBOARD_STEP_PX
      const grow = axis === 'horizontal' ? 'ArrowRight' : 'ArrowDown'
      const shrink = axis === 'horizontal' ? 'ArrowLeft' : 'ArrowUp'
      if (event.key === grow) {
        event.preventDefault()
        adjustBy(step)
      } else if (event.key === shrink) {
        event.preventDefault()
        adjustBy(-step)
      } else if (event.key === 'Home') {
        event.preventDefault()
        adjustBy(pixelMin - size)
      } else if (event.key === 'End') {
        event.preventDefault()
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
    handleMouseDown: elastic.handleMouseDown,
    onKeyDown,
  }
}
