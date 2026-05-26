// cspell:ignore vsplit hsplit
import { Fragment, type ReactElement, type RefObject } from 'react'
import { ResizeHandle } from '../../../../components/ResizeHandle'
import type { LayoutId } from '../../../sessions/types'
import { useSplitDivider } from './useSplitDivider'
import type { LayoutRatios } from './resolveGrid'

export interface SplitDividersProps {
  layout: LayoutId
  containerRef: RefObject<HTMLElement | null>
  ratios: LayoutRatios
  onRatioChange: (axis: 'col' | 'row', ratio: number) => void
}

const HANDLE_TEST_ID = 'split-resize-handle'

const VSplitDividers = ({
  containerRef,
  ratios,
  onRatioChange,
}: Omit<SplitDividersProps, 'layout'>): ReactElement => {
  const col = useSplitDivider({
    containerRef,
    axis: 'horizontal',
    cssVar: '--split-col',
    initialRatio: ratios.col,
    onRatioChange: (r) => onRatioChange('col', r),
  })

  return (
    <ResizeHandle
      orientation="vertical"
      testId={HANDLE_TEST_ID}
      ariaLabel="Resize panes"
      isDragging={col.isDragging}
      ariaValueNow={col.size}
      ariaValueMin={col.pixelMin}
      ariaValueMax={col.pixelMax}
      onMouseDown={col.handleMouseDown}
      onKeyDown={col.onKeyDown}
      className="h-full w-full"
      style={{ gridArea: 'vdiv' }}
    />
  )
}

const HSplitDividers = ({
  containerRef,
  ratios,
  onRatioChange,
}: Omit<SplitDividersProps, 'layout'>): ReactElement => {
  const row = useSplitDivider({
    containerRef,
    axis: 'vertical',
    cssVar: '--split-row',
    initialRatio: ratios.row,
    onRatioChange: (r) => onRatioChange('row', r),
  })

  return (
    <ResizeHandle
      orientation="horizontal"
      testId={HANDLE_TEST_ID}
      ariaLabel="Resize panes"
      isDragging={row.isDragging}
      ariaValueNow={row.size}
      ariaValueMin={row.pixelMin}
      ariaValueMax={row.pixelMax}
      onMouseDown={row.handleMouseDown}
      onKeyDown={row.onKeyDown}
      className="h-full w-full"
      style={{ gridArea: 'hdiv' }}
    />
  )
}

const ThreeRightDividers = ({
  containerRef,
  ratios,
  onRatioChange,
}: Omit<SplitDividersProps, 'layout'>): ReactElement => {
  const col = useSplitDivider({
    containerRef,
    axis: 'horizontal',
    cssVar: '--split-col',
    initialRatio: ratios.col,
    onRatioChange: (r) => onRatioChange('col', r),
  })
  const row = useSplitDivider({
    containerRef,
    axis: 'vertical',
    cssVar: '--split-row',
    initialRatio: ratios.row,
    onRatioChange: (r) => onRatioChange('row', r),
  })

  return (
    <Fragment>
      <ResizeHandle
        orientation="vertical"
        testId={HANDLE_TEST_ID}
        ariaLabel="Resize panes"
        isDragging={col.isDragging}
        ariaValueNow={col.size}
        ariaValueMin={col.pixelMin}
        ariaValueMax={col.pixelMax}
        onMouseDown={col.handleMouseDown}
        onKeyDown={col.onKeyDown}
        className="h-full w-full"
        style={{ gridArea: 'vdiv' }}
      />
      <ResizeHandle
        orientation="horizontal"
        testId={HANDLE_TEST_ID}
        ariaLabel="Resize panes"
        isDragging={row.isDragging}
        ariaValueNow={row.size}
        ariaValueMin={row.pixelMin}
        ariaValueMax={row.pixelMax}
        onMouseDown={row.handleMouseDown}
        onKeyDown={row.onKeyDown}
        className="h-full w-full"
        style={{ gridArea: 'hdiv' }}
      />
    </Fragment>
  )
}

const QuadDividers = ({
  containerRef,
  ratios,
  onRatioChange,
}: Omit<SplitDividersProps, 'layout'>): ReactElement => {
  const col = useSplitDivider({
    containerRef,
    axis: 'horizontal',
    cssVar: '--split-col',
    initialRatio: ratios.col,
    onRatioChange: (r) => onRatioChange('col', r),
  })
  const row = useSplitDivider({
    containerRef,
    axis: 'vertical',
    cssVar: '--split-row',
    initialRatio: ratios.row,
    onRatioChange: (r) => onRatioChange('row', r),
  })

  // One logical column divider rendered as two elements (segmented by the
  // full-width row bar); both share the `col` binding.
  const colHandle = (gridArea: 'vdiv0' | 'vdiv1'): ReactElement => (
    <ResizeHandle
      orientation="vertical"
      testId={HANDLE_TEST_ID}
      ariaLabel="Resize panes"
      isDragging={col.isDragging}
      ariaValueNow={col.size}
      ariaValueMin={col.pixelMin}
      ariaValueMax={col.pixelMax}
      onMouseDown={col.handleMouseDown}
      onKeyDown={col.onKeyDown}
      className="h-full w-full"
      style={{ gridArea }}
    />
  )

  return (
    <Fragment>
      {colHandle('vdiv0')}
      <ResizeHandle
        orientation="horizontal"
        testId={HANDLE_TEST_ID}
        ariaLabel="Resize panes"
        isDragging={row.isDragging}
        ariaValueNow={row.size}
        ariaValueMin={row.pixelMin}
        ariaValueMax={row.pixelMax}
        onMouseDown={row.handleMouseDown}
        onKeyDown={row.onKeyDown}
        className="h-full w-full"
        style={{ gridArea: 'hdiv' }}
      />
      {colHandle('vdiv1')}
    </Fragment>
  )
}

export const SplitDividers = ({
  layout,
  containerRef,
  ratios,
  onRatioChange,
}: SplitDividersProps): ReactElement | null => {
  const childProps = { containerRef, ratios, onRatioChange }
  switch (layout) {
    case 'single':
      return null
    case 'vsplit':
      return <VSplitDividers key="vsplit" {...childProps} />
    case 'hsplit':
      return <HSplitDividers key="hsplit" {...childProps} />
    case 'threeRight':
      return <ThreeRightDividers key="threeRight" {...childProps} />
    case 'quad':
      return <QuadDividers key="quad" {...childProps} />
  }
}
