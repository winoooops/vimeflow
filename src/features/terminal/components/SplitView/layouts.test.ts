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

  test('insertion order is the canonical ⌘\\ cycle (regression guard)', () => {
    // usePaneShortcuts derives the keyboard cycle via
    // `Object.values(LAYOUTS).map(l => l.id)` — the result inherits
    // this record's insertion order. Inserting a new entry between
    // existing ones (rather than appending) would silently change
    // the cycle for every user with no failing test or type error.
    // This snapshot pins the cycle order at the canonical layout
    // sequence; any change here is intentional and visible in CI.
    expect(Object.values(LAYOUTS).map((layout) => layout.id)).toEqual([
      'single',
      'vsplit',
      'hsplit',
      'threeRight',
      'quad',
    ])
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

  // Count top-level whitespace-separated tracks in a `grid-template-*` value.
  // Collapse parenthesised expressions (e.g. `minmax(0, 1fr)`) to a single
  // placeholder first so interior whitespace inside `minmax(...)` /
  // `repeat(...)` doesn't double-count. Keeps the cross-field invariant
  // (cols/rows string ↔ areas matrix) robust against idiomatic CSS
  // formatting that future layouts might use.
  const countTracks = (template: string): number =>
    template
      .replace(/\([^)]*\)/g, 'X')
      .trim()
      .split(/\s+/)
      .filter(Boolean).length

  test.each<LayoutId>(layoutIds)(
    '%s: cols track-count matches areas[0].length',
    (id) => {
      const layout = LAYOUTS[id]
      const colTracks = countTracks(layout.cols)

      expect(colTracks).toBe(layout.areas[0].length)
    }
  )

  test.each<LayoutId>(layoutIds)(
    '%s: rows track-count matches areas.length',
    (id) => {
      const layout = LAYOUTS[id]
      const rowTracks = countTracks(layout.rows)

      expect(rowTracks).toBe(layout.areas.length)
    }
  )

  // Sanity-check the tokenizer handles the future case Claude flagged in
  // PR #199 review — interior whitespace inside `minmax(0, 1fr)` /
  // `repeat(2, minmax(...))` would have doubled the naive `\s+` split.
  test('countTracks tolerates interior whitespace in parenthesised expressions', () => {
    expect(countTracks('minmax(0, 1fr) minmax(0, 1fr)')).toBe(2)
    expect(countTracks('minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)')).toBe(3)
    expect(countTracks('repeat(2, minmax(0, 1fr))')).toBe(1)
    expect(countTracks('  1fr   2fr  ')).toBe(2)
  })

  test('LayoutShape uses readonly area arrays', () => {
    const mutate = (layout: LayoutShape): void => {
      // @ts-expect-error - readonly array mutation should fail to compile
      layout.areas[0][0] = 'pX'
    }

    expect(typeof mutate).toBe('function')
  })
})
