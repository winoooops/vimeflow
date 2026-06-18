// cspell:ignore vsplit hsplit vdiv hdiv subcomponent
import { Fragment, useCallback, type ReactElement, type RefObject } from 'react'
import { ResizeHandle } from '@/components/ResizeHandle'
import type { LayoutId } from '../../../sessions/types'
import { useSplitDivider } from './useSplitDivider'
import type { LayoutRatios, RatioAxis } from '../../layout-registry'

export interface SplitDividersProps {
  layout: LayoutId
  containerRef: RefObject<HTMLElement | null>
  ratios: LayoutRatios
  onRatioChange: (axis: RatioAxis, ratios: readonly number[]) => void
}

const HANDLE_TEST_ID = 'split-resize-handle'

type DividerDragAxis = 'horizontal' | 'vertical'
type DividerOrientation = 'vertical' | 'horizontal'

interface DividerHandleSpec {
  readonly id: string
  readonly gridArea: string
  readonly dragAxis: DividerDragAxis
  readonly orientation: DividerOrientation
  readonly trackAxis: RatioAxis
  readonly trackIndex: number
}

const DIVIDER_SPECS: Record<LayoutId, readonly DividerHandleSpec[]> = {
  single: [],
  vsplit: [
    {
      id: 'vdiv',
      gridArea: 'vdiv',
      dragAxis: 'horizontal',
      orientation: 'vertical',
      trackAxis: 'cols',
      trackIndex: 0,
    },
  ],
  hsplit: [
    {
      id: 'hdiv',
      gridArea: 'hdiv',
      dragAxis: 'vertical',
      orientation: 'horizontal',
      trackAxis: 'rows',
      trackIndex: 0,
    },
  ],
  threeRight: [
    {
      id: 'vdiv',
      gridArea: 'vdiv',
      dragAxis: 'horizontal',
      orientation: 'vertical',
      trackAxis: 'cols',
      trackIndex: 0,
    },
    {
      id: 'hdiv',
      gridArea: 'hdiv',
      dragAxis: 'vertical',
      orientation: 'horizontal',
      trackAxis: 'rows',
      trackIndex: 0,
    },
  ],
  quad: [
    {
      id: 'vdiv0',
      gridArea: 'vdiv0',
      dragAxis: 'horizontal',
      orientation: 'vertical',
      trackAxis: 'cols',
      trackIndex: 0,
    },
    {
      id: 'hdiv',
      gridArea: 'hdiv',
      dragAxis: 'vertical',
      orientation: 'horizontal',
      trackAxis: 'rows',
      trackIndex: 0,
    },
    {
      id: 'vdiv1',
      gridArea: 'vdiv1',
      dragAxis: 'horizontal',
      orientation: 'vertical',
      trackAxis: 'cols',
      trackIndex: 0,
    },
  ],
  grid3x2: [
    {
      id: 'vdiv0a',
      gridArea: 'vdiv0a',
      dragAxis: 'horizontal',
      orientation: 'vertical',
      trackAxis: 'cols',
      trackIndex: 0,
    },
    {
      id: 'vdiv1a',
      gridArea: 'vdiv1a',
      dragAxis: 'horizontal',
      orientation: 'vertical',
      trackAxis: 'cols',
      trackIndex: 1,
    },
    {
      id: 'hdiv',
      gridArea: 'hdiv',
      dragAxis: 'vertical',
      orientation: 'horizontal',
      trackAxis: 'rows',
      trackIndex: 0,
    },
    {
      id: 'vdiv0b',
      gridArea: 'vdiv0b',
      dragAxis: 'horizontal',
      orientation: 'vertical',
      trackAxis: 'cols',
      trackIndex: 0,
    },
    {
      id: 'vdiv1b',
      gridArea: 'vdiv1b',
      dragAxis: 'horizontal',
      orientation: 'vertical',
      trackAxis: 'cols',
      trackIndex: 1,
    },
  ],
}

interface SplitBoundaryProps extends Omit<SplitDividersProps, 'layout'> {
  readonly axis: DividerDragAxis
  readonly trackAxis: RatioAxis
  readonly trackIndex: number
  readonly specs: readonly DividerHandleSpec[]
}

const boundaryKey = (spec: DividerHandleSpec): string =>
  `${spec.trackAxis}-${spec.trackIndex}`

const SplitBoundary = ({
  containerRef,
  axis,
  trackAxis,
  trackIndex,
  ratios,
  onRatioChange,
  specs,
}: SplitBoundaryProps): ReactElement => {
  const onTrackChange = useCallback(
    (nextRatios: readonly number[]): void =>
      onRatioChange(trackAxis, nextRatios),
    [onRatioChange, trackAxis]
  )

  const binding = useSplitDivider({
    containerRef,
    axis,
    trackAxis,
    trackIndex,
    initialRatios: ratios[trackAxis],
    onRatioChange: onTrackChange,
  })

  return (
    <Fragment>
      {specs.map((spec) => (
        <ResizeHandle
          key={spec.id}
          orientation={spec.orientation}
          testId={HANDLE_TEST_ID}
          ariaLabel="Resize panes"
          isDragging={binding.isDragging}
          ariaValueNow={binding.size}
          ariaValueMin={binding.pixelMin}
          ariaValueMax={binding.pixelMax}
          onMouseDown={binding.handleMouseDown}
          onKeyDown={binding.onKeyDown}
          className="h-full w-full"
          style={{ gridArea: spec.gridArea }}
        />
      ))}
    </Fragment>
  )
}

export const SplitDividers = ({
  layout,
  containerRef,
  ratios,
  onRatioChange,
}: SplitDividersProps): ReactElement | null => {
  const specs = DIVIDER_SPECS[layout]

  if (specs.length === 0) {
    return null
  }

  const grouped = specs.reduce<Record<string, DividerHandleSpec[]>>(
    (acc, spec) => {
      const key = boundaryKey(spec)
      acc[key] ??= []
      acc[key].push(spec)

      return acc
    },
    {}
  )

  return (
    <Fragment>
      {Object.values(grouped).map((groupSpecs) => (
        <SplitBoundary
          key={boundaryKey(groupSpecs[0])}
          containerRef={containerRef}
          axis={groupSpecs[0].dragAxis}
          trackAxis={groupSpecs[0].trackAxis}
          trackIndex={groupSpecs[0].trackIndex}
          ratios={ratios}
          onRatioChange={onRatioChange}
          specs={groupSpecs}
        />
      ))}
    </Fragment>
  )
}
