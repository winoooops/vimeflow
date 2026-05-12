// cspell:ignore vsplit hsplit
import type { LayoutId } from '../../../sessions/types'

export interface LayoutShape {
  readonly id: LayoutId
  readonly name: string
  /** Maximum pane count for this layout. SplitView clamps panes to capacity. */
  readonly capacity: 1 | 2 | 3 | 4
  /** CSS grid-template-columns value. */
  readonly cols: string
  /** CSS grid-template-rows value. */
  readonly rows: string
  /** 2D layout of pane-slot names: p0..pN. */
  readonly areas: readonly (readonly string[])[]
}

export const LAYOUTS: Record<LayoutId, LayoutShape> = {
  single: {
    id: 'single',
    name: 'Single',
    capacity: 1,
    cols: 'minmax(0,1fr)',
    rows: 'minmax(0,1fr)',
    areas: [['p0']],
  },
  vsplit: {
    id: 'vsplit',
    name: 'Vertical split',
    capacity: 2,
    cols: 'minmax(0,1fr) minmax(0,1fr)',
    rows: 'minmax(0,1fr)',
    areas: [['p0', 'p1']],
  },
  hsplit: {
    id: 'hsplit',
    name: 'Horizontal split',
    capacity: 2,
    cols: 'minmax(0,1fr)',
    rows: 'minmax(0,1fr) minmax(0,1fr)',
    areas: [['p0'], ['p1']],
  },
  threeRight: {
    id: 'threeRight',
    name: 'Main + 2 stack',
    capacity: 3,
    cols: 'minmax(0,1.4fr) minmax(0,1fr)',
    rows: 'minmax(0,1fr) minmax(0,1fr)',
    areas: [
      ['p0', 'p1'],
      ['p0', 'p2'],
    ],
  },
  quad: {
    id: 'quad',
    name: 'Quad',
    capacity: 4,
    cols: 'minmax(0,1fr) minmax(0,1fr)',
    rows: 'minmax(0,1fr) minmax(0,1fr)',
    areas: [
      ['p0', 'p1'],
      ['p2', 'p3'],
    ],
  },
} as const
