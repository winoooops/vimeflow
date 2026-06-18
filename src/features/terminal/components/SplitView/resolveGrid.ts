// cspell:ignore vsplit hsplit vdiv hdiv
import type { LayoutId } from '../../../sessions/types'
import {
  DEFAULT_RATIOS,
  buildTrackTemplate,
  type LayoutRatios,
} from '../../layout-registry'

export { DEFAULT_RATIOS }

/** Width of the divider track that replaces the inter-pane gap (px). */
export const SPLIT_DIVIDER_PX = 8

export interface ResolvedGrid {
  cols: string
  rows: string
  areas: readonly (readonly string[])[]
}

export const resolveGrid = (
  layoutId: LayoutId,
  ratios: LayoutRatios
): ResolvedGrid => {
  const cols = buildTrackTemplate('cols', ratios.cols, SPLIT_DIVIDER_PX)
  const rows = buildTrackTemplate('rows', ratios.rows, SPLIT_DIVIDER_PX)

  switch (layoutId) {
    case 'single':
      return { cols: 'minmax(0,1fr)', rows: 'minmax(0,1fr)', areas: [['p0']] }
    case 'vsplit':
      return { cols, rows: 'minmax(0,1fr)', areas: [['p0', 'vdiv', 'p1']] }
    case 'hsplit':
      return {
        cols: 'minmax(0,1fr)',
        rows,
        areas: [['p0'], ['hdiv'], ['p1']],
      }
    case 'threeRight':
      return {
        cols,
        rows,
        areas: [
          ['p0', 'vdiv', 'p1'],
          ['p0', 'vdiv', 'hdiv'],
          ['p0', 'vdiv', 'p2'],
        ],
      }
    case 'quad':
      return {
        cols,
        rows,
        areas: [
          ['p0', 'vdiv0', 'p1'],
          ['hdiv', 'hdiv', 'hdiv'],
          ['p2', 'vdiv1', 'p3'],
        ],
      }
  }
}
