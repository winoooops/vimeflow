// cspell:ignore vsplit hsplit
import type { LayoutId } from '../../sessions/types'

export const LAYOUT_IDS = [
  'single',
  'vsplit',
  'hsplit',
  'threeRight',
  'quad',
  'grid3x2',
] as const satisfies readonly LayoutId[]
