// cspell:ignore vdiv hdiv
import { test, expect, describe } from 'vitest'
import { resolveGrid, DEFAULT_RATIOS, SPLIT_DIVIDER_PX } from './resolveGrid'

describe('resolveGrid', () => {
  test('single has no divider tracks', () => {
    const g = resolveGrid('single', DEFAULT_RATIOS.single)
    expect(g.cols).toBe('minmax(0,1fr)')
    expect(g.rows).toBe('minmax(0,1fr)')
    expect(g.areas).toEqual([['p0']])
  })

  test('vsplit emits two column fr vars summing to 1 (grid always fills)', () => {
    const g = resolveGrid('vsplit', { cols: [1, 1], rows: [1] })
    expect(g.cols).toBe(
      `var(--split-cols-0, 1fr) ${SPLIT_DIVIDER_PX}px var(--split-cols-1, 1fr)`
    )
    expect(g.rows).toBe('minmax(0,1fr)')
    expect(g.areas).toEqual([['p0', 'vdiv', 'p1']])
  })

  test('hsplit emits two row fr vars summing to 1', () => {
    const g = resolveGrid('hsplit', { cols: [1], rows: [0.4, 0.6] })
    expect(g.rows).toBe(
      `var(--split-rows-0, 0.4fr) ${SPLIT_DIVIDER_PX}px var(--split-rows-1, 0.6fr)`
    )
    expect(g.areas).toEqual([['p0'], ['hdiv'], ['p1']])
  })

  test('threeRight spans p0 + vdiv across all rows; hdiv only in right column', () => {
    const g = resolveGrid('threeRight', { cols: [1.4, 1], rows: [1, 1] })
    expect(g.areas).toEqual([
      ['p0', 'vdiv', 'p1'],
      ['p0', 'vdiv', 'hdiv'],
      ['p0', 'vdiv', 'p2'],
    ])
  })

  test('quad segments the column bar around the full-width row bar', () => {
    const g = resolveGrid('quad', { cols: [1, 1], rows: [1, 1] })
    expect(g.areas).toEqual([
      ['p0', 'vdiv0', 'p1'],
      ['hdiv', 'hdiv', 'hdiv'],
      ['p2', 'vdiv1', 'p3'],
    ])
  })

  test('default ratios reproduce current proportions', () => {
    expect(DEFAULT_RATIOS.vsplit.cols).toEqual([1, 1])
    expect(DEFAULT_RATIOS.threeRight.cols).toEqual([1.4, 1])
  })
})
