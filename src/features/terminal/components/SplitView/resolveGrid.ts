// cspell:ignore vsplit hsplit vdiv hdiv
import type { LayoutId } from '../../../sessions/types'

/** Width of the divider track that replaces the inter-pane gap (px). */
export const SPLIT_DIVIDER_PX = 8

export interface LayoutRatios {
  /** Column split fraction (leading column / pane space). */
  col: number
  /** Row split fraction (leading row / pane space). */
  row: number
}

export interface ResolvedGrid {
  cols: string
  rows: string
  areas: readonly (readonly string[])[]
}

/** Per-layout defaults that reproduce the pre-resize `fr` proportions. */
export const DEFAULT_RATIOS: Record<LayoutId, LayoutRatios> = {
  single: { col: 0.5, row: 0.5 },
  vsplit: { col: 0.5, row: 0.5 },
  hsplit: { col: 0.5, row: 0.5 },
  threeRight: { col: 1.4 / 2.4, row: 0.5 },
  quad: { col: 0.5, row: 0.5 },
}

const axisTemplate = (cssVar: string, ratio: number): string =>
  `var(${cssVar}, ${ratio}fr) ${SPLIT_DIVIDER_PX}px var(${cssVar}-end, ${1 - ratio}fr)`

export const resolveGrid = (
  layoutId: LayoutId,
  ratios: LayoutRatios
): ResolvedGrid => {
  const col = axisTemplate('--split-col', ratios.col)
  const row = axisTemplate('--split-row', ratios.row)

  switch (layoutId) {
    case 'single':
      return { cols: 'minmax(0,1fr)', rows: 'minmax(0,1fr)', areas: [['p0']] }
    case 'vsplit':
      return { cols: col, rows: 'minmax(0,1fr)', areas: [['p0', 'vdiv', 'p1']] }
    case 'hsplit':
      return {
        cols: 'minmax(0,1fr)',
        rows: row,
        areas: [['p0'], ['hdiv'], ['p1']],
      }
    case 'threeRight':
      return {
        cols: col,
        rows: row,
        areas: [
          ['p0', 'vdiv', 'p1'],
          ['p0', 'vdiv', 'hdiv'],
          ['p0', 'vdiv', 'p2'],
        ],
      }
    case 'quad':
      return {
        cols: col,
        rows: row,
        areas: [
          ['p0', 'vdiv0', 'p1'],
          ['hdiv', 'hdiv', 'hdiv'],
          ['p2', 'vdiv1', 'p3'],
        ],
      }
  }
}
