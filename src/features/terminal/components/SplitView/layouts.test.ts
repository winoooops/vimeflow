// cspell:ignore vsplit hsplit
import { describe, test, expect } from 'vitest'
import { LAYOUTS, type LayoutShape } from './layouts'
import type { LayoutId } from '../../../sessions/types'

const layoutIds: LayoutId[] = [
  'single',
  'vsplit',
  'hsplit',
  'threeRight',
  'quad',
]

describe('LAYOUTS', () => {
  test('exposes all 5 canonical layout ids', () => {
    expect(Object.keys(LAYOUTS).sort()).toEqual([...layoutIds].sort())
  })

  test.each<LayoutId>(layoutIds)(
    '%s: capacity matches unique slot count in areas',
    (id) => {
      const layout = LAYOUTS[id]
      const slots = new Set(layout.areas.flat())

      expect(layout.capacity).toBe(slots.size)
    }
  )

  test.each<LayoutId>(layoutIds)(
    '%s: slot names are p0..p(capacity-1) with no gaps',
    (id) => {
      const layout = LAYOUTS[id]
      const slots = new Set(layout.areas.flat())

      const expected = new Set(
        Array.from({ length: layout.capacity }, (_, i) => `p${i}`)
      )

      expect(slots).toEqual(expected)
    }
  )

  test.each<LayoutId>(layoutIds)(
    '%s: cols track-count matches areas[0].length',
    (id) => {
      const layout = LAYOUTS[id]
      const colTracks = layout.cols.split(/\s+/).filter(Boolean).length

      expect(colTracks).toBe(layout.areas[0].length)
    }
  )

  test.each<LayoutId>(layoutIds)(
    '%s: rows track-count matches areas.length',
    (id) => {
      const layout = LAYOUTS[id]
      const rowTracks = layout.rows.split(/\s+/).filter(Boolean).length

      expect(rowTracks).toBe(layout.areas.length)
    }
  )

  test('LayoutShape uses readonly area arrays', () => {
    const mutate = (layout: LayoutShape): void => {
      // @ts-expect-error - readonly array mutation should fail to compile
      layout.areas[0][0] = 'pX'
    }

    expect(typeof mutate).toBe('function')
  })
})
