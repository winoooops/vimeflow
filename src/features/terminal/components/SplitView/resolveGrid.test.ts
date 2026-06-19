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
    expect(g.areas).toEqual([['p0', 'vdiv-c0', 'p1']])
  })

  test('hsplit emits two row fr vars summing to 1', () => {
    const g = resolveGrid('hsplit', { cols: [1], rows: [0.4, 0.6] })
    expect(g.rows).toBe(
      `var(--split-rows-0, 0.4fr) ${SPLIT_DIVIDER_PX}px var(--split-rows-1, 0.6fr)`
    )
    expect(g.areas).toEqual([['p0'], ['hdiv-r0'], ['p1']])
  })

  test('threeRight spans p0 + vdiv across all rows; hdiv only in right column', () => {
    const g = resolveGrid('threeRight', { cols: [1.4, 1], rows: [1, 1] })
    expect(g.areas).toEqual([
      ['p0', 'vdiv-c0', 'p1'],
      ['p0', 'vdiv-c0', 'hdiv-r0-c1'],
      ['p0', 'vdiv-c0', 'p2'],
    ])
  })

  test('quad segments the column bar around the full-width row bar', () => {
    const g = resolveGrid('quad', { cols: [1, 1], rows: [1, 1] })
    expect(g.areas).toEqual([
      ['p0', 'vdiv-c0-r0', 'p1'],
      ['hdiv-r0', 'hdiv-r0', 'hdiv-r0'],
      ['p2', 'vdiv-c0-r1', 'p3'],
    ])
  })

  test('grid3x2 segments both column bars around the full-width row bar', () => {
    const g = resolveGrid('grid3x2', { cols: [1, 1, 1], rows: [1, 1] })
    expect(g.areas).toEqual([
      ['p0', 'vdiv-c0-r0', 'p1', 'vdiv-c1-r0', 'p2'],
      ['hdiv-r0', 'hdiv-r0', 'hdiv-r0', 'hdiv-r0', 'hdiv-r0'],
      ['p3', 'vdiv-c0-r1', 'p4', 'vdiv-c1-r1', 'p5'],
    ])
  })

  test('default ratios reproduce current proportions', () => {
    expect(DEFAULT_RATIOS.vsplit.cols).toEqual([1, 1])
    expect(DEFAULT_RATIOS.threeRight.cols).toEqual([1.4, 1])
    expect(DEFAULT_RATIOS.grid3x2.cols).toEqual([1, 1, 1])
  })
})
