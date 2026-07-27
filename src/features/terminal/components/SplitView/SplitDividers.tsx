// cspell:ignore vsplit hsplit vdiv hdiv subcomponent
import {
  Fragment,
  useEffect,
  useCallback,
  type ReactElement,
  type RefObject,
} from 'react'
import { ResizeHandle } from '@/components/ResizeHandle'
import { useSplitDivider } from './useSplitDivider'
import {
  type DividerHandleSpec,
  type LayoutShape,
  type LayoutRatios,
  type RatioAxis,
} from '../../layout-registry'

export interface SplitDividersProps {
  layout: LayoutShape
  containerRef: RefObject<HTMLElement | null>
  ratios: LayoutRatios
  onRatioChange: (axis: RatioAxis, ratios: readonly number[]) => void
  /** Publish each boundary's nudge so a command can resize a pane while a
   *  terminal holds focus — the handles' own key bindings need focus they
   *  never get. Keyed `"<axis>:<trackIndex>"`. */
  onRegisterNudge?: (
    key: string,
    nudgeBy: ((px: number) => void) | null
  ) => void
}

const HANDLE_TEST_ID = 'split-resize-handle'

interface DividerGroup {
  readonly trackAxis: RatioAxis
  readonly trackIndex: number
  readonly dragAxis: DividerHandleSpec['dragAxis']
  readonly handles: readonly DividerHandleSpec[]
}

const groupKey = (trackAxis: RatioAxis, trackIndex: number): string =>
  `${trackAxis}:${trackIndex}`

const layoutGroupKey = (
  layout: LayoutShape,
  trackAxis: RatioAxis,
  trackIndex: number
): string => `${layout.id}:${groupKey(trackAxis, trackIndex)}`

const groupSpecsByBoundary = (
  specs: readonly DividerHandleSpec[]
): readonly DividerGroup[] => {
  const groups = new Map<string, DividerGroup>()

  for (const spec of specs) {
    const key = groupKey(spec.trackAxis, spec.trackIndex)
    const existing = groups.get(key)

    if (existing) {
      groups.set(key, {
        ...existing,
        handles: [...existing.handles, spec],
      })
    } else {
      groups.set(key, {
        trackAxis: spec.trackAxis,
        trackIndex: spec.trackIndex,
        dragAxis: spec.dragAxis,
        handles: [spec],
      })
    }
  }

  return Array.from(groups.values())
}

const SplitDividerGroup = ({
  containerRef,
  ratios,
  trackAxis,
  trackIndex,
  dragAxis,
  handles,
  onRatioChange,
  onRegisterNudge = undefined,
}: Omit<SplitDividersProps, 'layout'> & DividerGroup): ReactElement => {
  const onTrackChange = useCallback(
    (nextRatios: readonly number[]): void =>
      onRatioChange(trackAxis, nextRatios),
    [onRatioChange, trackAxis]
  )

  const binding = useSplitDivider({
    containerRef,
    axis: dragAxis,
    trackAxis,
    trackIndex,
    initialRatios: ratios[trackAxis],
    onRatioChange: onTrackChange,
  })

  const nudgeKey = groupKey(trackAxis, trackIndex)
  const { nudgeBy } = binding
  useEffect(() => {
    onRegisterNudge?.(nudgeKey, nudgeBy)

    return (): void => onRegisterNudge?.(nudgeKey, null)
  }, [nudgeKey, nudgeBy, onRegisterNudge])

  return (
    <Fragment>
      {handles.map((handle) => (
        <ResizeHandle
          key={handle.id}
          orientation={handle.orientation}
          testId={HANDLE_TEST_ID}
          ariaLabel="Resize panes"
          isDragging={binding.isDragging}
          ariaValueNow={binding.size}
          ariaValueMin={binding.pixelMin}
          ariaValueMax={binding.pixelMax}
          onMouseDown={binding.handleMouseDown}
          onKeyDown={binding.onKeyDown}
          className="h-full w-full"
          style={{ gridArea: handle.gridArea }}
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
  onRegisterNudge = undefined,
}: SplitDividersProps): ReactElement | null => {
  const specs = layout.dividers

  if (specs.length === 0) {
    return null
  }

  const groups = groupSpecsByBoundary(specs)

  return (
    <Fragment>
      {groups.map((group) => (
        <SplitDividerGroup
          key={layoutGroupKey(layout, group.trackAxis, group.trackIndex)}
          containerRef={containerRef}
          ratios={ratios}
          onRatioChange={onRatioChange}
          onRegisterNudge={onRegisterNudge}
          {...group}
        />
      ))}
    </Fragment>
  )
}
