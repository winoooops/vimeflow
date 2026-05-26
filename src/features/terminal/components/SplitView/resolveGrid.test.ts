import { test, expect, describe } from 'vitest'
import { resolveGrid, DEFAULT_RATIOS, SPLIT_DIVIDER_PX } from './resolveGrid'

describe('resolveGrid', () => {
  test('single has no divider tracks', () => {
    const g = resolveGrid('single', DEFAULT_RATIOS.single)
    expect(g.cols).toBe('minmax(0,1fr)')
    expect(g.rows).toBe('minmax(0,1fr)')
    expect(g.areas).toEqual([['p0']])
  })

  test('vsplit emits one column divider track + var fallback', () => {
    const g = resolveGrid('vsplit', { col: 0.5, row: 0.5 })
    expect(g.cols).toBe(`var(--split-col, 0.5fr) ${SPLIT_DIVIDER_PX}px 0.5fr`)
    expect(g.rows).toBe('minmax(0,1fr)')
    expect(g.areas).toEqual([['p0', 'vdiv', 'p1']])
  })

  test('hsplit emits one row divider track', () => {
    const g = resolveGrid('hsplit', { col: 0.5, row: 0.4 })
    expect(g.rows).toBe(`var(--split-row, 0.4fr) ${SPLIT_DIVIDER_PX}px 0.6fr`)
    expect(g.areas).toEqual([['p0'], ['hdiv'], ['p1']])
  })

  test('threeRight spans p0 + vdiv across all rows; hdiv only in right column', () => {
    const g = resolveGrid('threeRight', { col: 0.583, row: 0.5 })
    expect(g.areas).toEqual([
      ['p0', 'vdiv', 'p1'],
      ['p0', 'vdiv', 'hdiv'],
      ['p0', 'vdiv', 'p2'],
    ])
  })

  test('quad segments the column bar around the full-width row bar', () => {
    const g = resolveGrid('quad', { col: 0.5, row: 0.5 })
    expect(g.areas).toEqual([
      ['p0', 'vdiv0', 'p1'],
      ['hdiv', 'hdiv', 'hdiv'],
      ['p2', 'vdiv1', 'p3'],
    ])
  })

  test('default ratios reproduce current proportions', () => {
    expect(DEFAULT_RATIOS.vsplit.col).toBe(0.5)
    expect(DEFAULT_RATIOS.threeRight.col).toBeCloseTo(1.4 / 2.4, 5)
  })
})
