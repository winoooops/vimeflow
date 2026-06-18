import type { LayoutId } from '../../sessions/types'
import { LAYOUT_IDS } from './layoutIds'
import { LAYOUTS, LAYOUT_SPECS, type LayoutShape } from './layoutSpecs'

export { LAYOUTS }

export const VISIBLE_LAYOUTS: readonly LayoutShape[] = LAYOUT_SPECS

export const LAYOUT_CYCLE: readonly LayoutId[] = LAYOUT_IDS

export const isKnownLayoutId = (value: string): value is LayoutId =>
  (LAYOUT_IDS as readonly string[]).includes(value)

export const autoShrinkLayoutFor = (
  nextPaneCount: number,
  currentLayoutId: LayoutId
): LayoutId => {
  if (nextPaneCount <= 1) {
    return 'single'
  }

  if (nextPaneCount === 2) {
    return currentLayoutId === 'hsplit' ? 'hsplit' : 'vsplit'
  }

  if (nextPaneCount === 3) {
    return 'threeRight'
  }

  return currentLayoutId
}
