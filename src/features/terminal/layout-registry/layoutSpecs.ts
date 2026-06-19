// cspell:ignore vsplit hsplit
import type { LayoutId } from '../../sessions/types'
import { LAYOUT_IDS } from './layoutIds'
import {
  getPaneLayoutCapacity,
  type PaneLayoutDefinition,
} from './layoutDefinition'
import { PREBUILT_PANE_LAYOUTS_BY_ID } from './prebuiltLayouts'
import { DEFAULT_RATIOS, type LayoutRatios } from './ratioModel'
import {
  areaMatrixFromDefinition,
  resolvePaneLayoutGeometry,
  type DividerHandleSpec,
  type LayoutGeometry,
} from './layoutGeometry'

export interface LayoutShape {
  readonly id: LayoutId
  readonly name: string
  /** Maximum pane count for this layout. SplitView clamps panes to capacity. */
  readonly capacity: number
  /** CSS grid-template-columns value. */
  readonly cols: string
  /** CSS grid-template-rows value. */
  readonly rows: string
  /** 2D layout of pane-slot names: p0..pN. */
  readonly areas: readonly (readonly string[])[]
  /** Full CSS grid-template-areas matrix, including divider tracks. */
  readonly gridAreas: LayoutGeometry['areas']
  /** Divider handles derived from the canonical layout definition. */
  readonly dividers: readonly DividerHandleSpec[]
  /** Canonical VIM-156 definition. Runtime still consumes legacy fields. */
  readonly definition: PaneLayoutDefinition
  readonly defaultRatios: LayoutRatios
}

const logicalTrackTemplate = (tracks: readonly number[]): string =>
  tracks.length <= 1
    ? 'minmax(0,1fr)'
    : tracks.map((track) => `minmax(0,${track}fr)`).join(' ')

const defineLayout = (id: LayoutId): LayoutShape => {
  const definition = PREBUILT_PANE_LAYOUTS_BY_ID[id]
  const geometry = resolvePaneLayoutGeometry(definition)
  const defaultRatios = DEFAULT_RATIOS[id]

  return {
    id,
    name: definition.title,
    capacity: getPaneLayoutCapacity(definition),
    cols: logicalTrackTemplate(defaultRatios.cols),
    rows: logicalTrackTemplate(defaultRatios.rows),
    areas: areaMatrixFromDefinition(definition),
    gridAreas: geometry.areas,
    dividers: geometry.dividers,
    defaultRatios,
    definition,
  }
}

/**
 * Canonical prebuilt layout definitions for the current terminal layout
 * system. The array order is deliberate: it is the visible pill order and the
 * keyboard cycle order. Custom/user layouts are not appended here; VIM-156
 * runtime assembly will combine prebuilt + workspace custom definitions.
 */
export const LAYOUTS: Record<LayoutId, LayoutShape> = {
  single: defineLayout('single'),
  vsplit: defineLayout('vsplit'),
  hsplit: defineLayout('hsplit'),
  threeRight: defineLayout('threeRight'),
  quad: defineLayout('quad'),
  grid3x2: defineLayout('grid3x2'),
} as const

export const LAYOUT_SPECS: readonly LayoutShape[] = LAYOUT_IDS.map(
  (layoutId) => LAYOUTS[layoutId]
)
