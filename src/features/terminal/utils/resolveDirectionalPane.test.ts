import { describe, expect, test } from 'vitest'
import { LAYOUTS, type LayoutShape } from '../components/SplitView/layouts'
import type { LayoutSlotId } from '../../sessions/types'
import {
  resolveDirectionalPane,
  type PaneDirection,
} from './resolveDirectionalPane'

interface TestCase {
  readonly layout: keyof typeof LAYOUTS
  readonly active: number
  readonly paneCount: number
  readonly direction: PaneDirection
  readonly expected: number | null
}

const slotId = (index: number): LayoutSlotId => `slot:p${index}`

const occupiedSlots = (paneCount: number): ReadonlySet<LayoutSlotId> =>
  new Set(Array.from({ length: paneCount }, (_, index) => slotId(index)))

const cases: TestCase[] = [
  // single
  {
    layout: 'single',
    active: 0,
    paneCount: 1,
    direction: 'left',
    expected: null,
  },
  {
    layout: 'single',
    active: 0,
    paneCount: 1,
    direction: 'right',
    expected: null,
  },
  {
    layout: 'single',
    active: 0,
    paneCount: 1,
    direction: 'up',
    expected: null,
  },
  {
    layout: 'single',
    active: 0,
    paneCount: 1,
    direction: 'down',
    expected: null,
  },

  // vsplit
  {
    layout: 'vsplit',
    active: 0,
    paneCount: 2,
    direction: 'right',
    expected: 1,
  },
  {
    layout: 'vsplit',
    active: 0,
    paneCount: 2,
    direction: 'left',
    expected: null,
  },
  {
    layout: 'vsplit',
    active: 0,
    paneCount: 2,
    direction: 'up',
    expected: null,
  },
  {
    layout: 'vsplit',
    active: 0,
    paneCount: 2,
    direction: 'down',
    expected: null,
  },
  { layout: 'vsplit', active: 1, paneCount: 2, direction: 'left', expected: 0 },
  {
    layout: 'vsplit',
    active: 1,
    paneCount: 2,
    direction: 'right',
    expected: null,
  },
  {
    layout: 'vsplit',
    active: 1,
    paneCount: 2,
    direction: 'up',
    expected: null,
  },
  {
    layout: 'vsplit',
    active: 1,
    paneCount: 2,
    direction: 'down',
    expected: null,
  },

  // hsplit
  { layout: 'hsplit', active: 0, paneCount: 2, direction: 'down', expected: 1 },
  {
    layout: 'hsplit',
    active: 0,
    paneCount: 2,
    direction: 'up',
    expected: null,
  },
  {
    layout: 'hsplit',
    active: 0,
    paneCount: 2,
    direction: 'left',
    expected: null,
  },
  {
    layout: 'hsplit',
    active: 0,
    paneCount: 2,
    direction: 'right',
    expected: null,
  },
  { layout: 'hsplit', active: 1, paneCount: 2, direction: 'up', expected: 0 },
  {
    layout: 'hsplit',
    active: 1,
    paneCount: 2,
    direction: 'down',
    expected: null,
  },
  {
    layout: 'hsplit',
    active: 1,
    paneCount: 2,
    direction: 'left',
    expected: null,
  },
  {
    layout: 'hsplit',
    active: 1,
    paneCount: 2,
    direction: 'right',
    expected: null,
  },

  // threeRight
  {
    layout: 'threeRight',
    active: 0,
    paneCount: 3,
    direction: 'right',
    expected: 1,
  },
  {
    layout: 'threeRight',
    active: 0,
    paneCount: 3,
    direction: 'left',
    expected: null,
  },
  {
    layout: 'threeRight',
    active: 0,
    paneCount: 3,
    direction: 'up',
    expected: null,
  },
  {
    layout: 'threeRight',
    active: 0,
    paneCount: 3,
    direction: 'down',
    expected: null,
  },
  {
    layout: 'threeRight',
    active: 1,
    paneCount: 3,
    direction: 'left',
    expected: 0,
  },
  {
    layout: 'threeRight',
    active: 1,
    paneCount: 3,
    direction: 'down',
    expected: 2,
  },
  {
    layout: 'threeRight',
    active: 1,
    paneCount: 3,
    direction: 'up',
    expected: null,
  },
  {
    layout: 'threeRight',
    active: 1,
    paneCount: 3,
    direction: 'right',
    expected: null,
  },
  {
    layout: 'threeRight',
    active: 2,
    paneCount: 3,
    direction: 'left',
    expected: 0,
  },
  {
    layout: 'threeRight',
    active: 2,
    paneCount: 3,
    direction: 'up',
    expected: 1,
  },
  {
    layout: 'threeRight',
    active: 2,
    paneCount: 3,
    direction: 'down',
    expected: null,
  },
  {
    layout: 'threeRight',
    active: 2,
    paneCount: 3,
    direction: 'right',
    expected: null,
  },

  // quad
  { layout: 'quad', active: 0, paneCount: 4, direction: 'right', expected: 1 },
  { layout: 'quad', active: 0, paneCount: 4, direction: 'down', expected: 2 },
  { layout: 'quad', active: 0, paneCount: 4, direction: 'up', expected: null },
  {
    layout: 'quad',
    active: 0,
    paneCount: 4,
    direction: 'left',
    expected: null,
  },
  { layout: 'quad', active: 1, paneCount: 4, direction: 'left', expected: 0 },
  { layout: 'quad', active: 1, paneCount: 4, direction: 'down', expected: 3 },
  { layout: 'quad', active: 1, paneCount: 4, direction: 'up', expected: null },
  {
    layout: 'quad',
    active: 1,
    paneCount: 4,
    direction: 'right',
    expected: null,
  },
  { layout: 'quad', active: 2, paneCount: 4, direction: 'up', expected: 0 },
  { layout: 'quad', active: 2, paneCount: 4, direction: 'right', expected: 3 },
  {
    layout: 'quad',
    active: 2,
    paneCount: 4,
    direction: 'down',
    expected: null,
  },
  {
    layout: 'quad',
    active: 2,
    paneCount: 4,
    direction: 'left',
    expected: null,
  },
  { layout: 'quad', active: 3, paneCount: 4, direction: 'left', expected: 2 },
  { layout: 'quad', active: 3, paneCount: 4, direction: 'up', expected: 1 },
  {
    layout: 'quad',
    active: 3,
    paneCount: 4,
    direction: 'down',
    expected: null,
  },
  {
    layout: 'quad',
    active: 3,
    paneCount: 4,
    direction: 'right',
    expected: null,
  },

  // partial fill: absent pane is skipped until grid edge
  {
    layout: 'quad',
    active: 1,
    paneCount: 3,
    direction: 'down',
    expected: null,
  },
]

describe('resolveDirectionalPane', () => {
  cases.forEach(({ layout, active, paneCount, direction, expected }) => {
    test(`${layout} p${active} ${direction} -> ${String(expected)}`, () => {
      expect(
        resolveDirectionalPane(
          LAYOUTS[layout],
          slotId(active),
          occupiedSlots(paneCount),
          direction
        )
      ).toBe(expected === null ? null : slotId(expected))
    })
  })

  test('skips an absent middle slot to reach a farther present pane', () => {
    // Synthetic 1x3 row where the middle slot p2 is absent (paneCount 2), so a
    // 'right' walk from p0 must JUMP the gap and land on p1 at column 2. A
    // "treat an absent slot as a wall" implementation would wrongly return null,
    // which the real layouts (absent slots only ever at a grid edge) cannot catch.
    const layout: LayoutShape = {
      ...LAYOUTS.single,
      id: 'single',
      name: 'synthetic',
      capacity: 1,
      cols: '',
      rows: '',
      areas: [['p0', 'p2', 'p1']],
      definition: {
        ...LAYOUTS.single.definition,
        slots: [
          { id: slotId(0), rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 } },
          { id: slotId(1), rect: { col: 2, row: 0, colSpan: 1, rowSpan: 1 } },
          { id: slotId(2), rect: { col: 1, row: 0, colSpan: 1, rowSpan: 1 } },
        ],
        addOrder: [slotId(0), slotId(1), slotId(2)],
      },
    }

    expect(
      resolveDirectionalPane(layout, slotId(0), occupiedSlots(2), 'right')
    ).toBe(slotId(1))
  })

  test('silently skips non-p{N} slot names instead of producing NaN', () => {
    // A future or synthetic layout that names slots differently must not
    // produce NaN comparisons that silently exclude the slot; the function
    // should just treat those slots as absent and continue scanning.
    const layout: LayoutShape = {
      ...LAYOUTS.single,
      id: 'single',
      name: 'synthetic',
      capacity: 1,
      cols: '',
      rows: '',
      areas: [['p0', 'main', 'p1']],
      definition: {
        ...LAYOUTS.single.definition,
        slots: [
          { id: slotId(0), rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 } },
          { id: slotId(1), rect: { col: 2, row: 0, colSpan: 1, rowSpan: 1 } },
        ],
        addOrder: [slotId(0), slotId(1)],
      },
    }

    expect(
      resolveDirectionalPane(layout, slotId(0), occupiedSlots(2), 'right')
    ).toBe(slotId(1))
  })

  test('uses explicit occupied slots after panes are drag-placed', () => {
    expect(
      resolveDirectionalPane(
        LAYOUTS.quad,
        slotId(3),
        new Set([slotId(0), slotId(3)]),
        'left'
      )
    ).toBeNull()

    expect(
      resolveDirectionalPane(
        LAYOUTS.quad,
        slotId(3),
        new Set([slotId(2), slotId(3)]),
        'left'
      )
    ).toBe(slotId(2))
  })
})
