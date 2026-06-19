// cspell:ignore vsplit hsplit vdiv hdiv
import type { LayoutId } from '../../../sessions/types'
import {
  DEFAULT_RATIOS,
  LAYOUTS,
  SPLIT_DIVIDER_PX,
  buildTrackTemplate,
  type LayoutRatios,
} from '../../layout-registry'

export { DEFAULT_RATIOS, SPLIT_DIVIDER_PX }

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
  const layout = LAYOUTS[layoutId]

  return { cols, rows, areas: layout.gridAreas }
}
