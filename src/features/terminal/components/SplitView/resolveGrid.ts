// cspell:ignore vsplit hsplit vdiv hdiv
import {
  DEFAULT_RATIOS,
  SPLIT_DIVIDER_PX,
  buildTrackTemplate,
  type LayoutShape,
  type LayoutRatios,
} from '../../layout-registry'

export { DEFAULT_RATIOS, SPLIT_DIVIDER_PX }

export interface ResolvedGrid {
  cols: string
  rows: string
  areas: readonly (readonly string[])[]
}

export const resolveGrid = (
  layout: LayoutShape,
  ratios: LayoutRatios
): ResolvedGrid => {
  const cols = buildTrackTemplate('cols', ratios.cols, SPLIT_DIVIDER_PX)
  const rows = buildTrackTemplate('rows', ratios.rows, SPLIT_DIVIDER_PX)

  return { cols, rows, areas: layout.gridAreas }
}
