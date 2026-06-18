import { describe, expect, test } from 'vitest'
import {
  DEFAULT_RATIOS,
  buildTrackTemplate,
  equalTrackRatios,
  getTrackBoundaryRatio,
  getTrackCssVar,
  updateTrackBoundaryRatio,
} from './ratioModel'

describe('ratioModel', () => {
  test('stores canonical default track weights per layout', () => {
    expect(DEFAULT_RATIOS.single).toEqual({ cols: [1], rows: [1] })
    expect(DEFAULT_RATIOS.threeRight.cols).toEqual([1.4, 1])
    expect(DEFAULT_RATIOS.quad.rows).toEqual([1, 1])
    expect(DEFAULT_RATIOS.grid3x2.cols).toEqual([1, 1, 1])
  })

  test('builds CSS templates from track arrays', () => {
    expect(buildTrackTemplate('cols', [1], 8)).toBe('minmax(0,1fr)')
    expect(buildTrackTemplate('cols', [1, 1], 8)).toBe(
      'var(--split-cols-0, 1fr) 8px var(--split-cols-1, 1fr)'
    )
  })

  test('exposes deterministic CSS var names', () => {
    expect(getTrackCssVar('cols', 0)).toBe('--split-cols-0')
    expect(getTrackCssVar('rows', 1)).toBe('--split-rows-1')
  })

  test('derives the boundary ratio from track weights', () => {
    expect(getTrackBoundaryRatio([1, 1], 0)).toBe(0.5)
    expect(getTrackBoundaryRatio([1, 1, 1], 1)).toBeCloseTo(2 / 3, 5)
  })

  test('updates only the adjacent track pair for a boundary move', () => {
    expect(updateTrackBoundaryRatio([1, 1], 0, 0.25)).toEqual([0.5, 1.5])
    expect(updateTrackBoundaryRatio([1, 1, 1], 1, 0.75)).toEqual([
      1, 1.25, 0.75,
    ])
  })

  test('compares track arrays shallowly', () => {
    expect(equalTrackRatios([1, 1], [1, 1])).toBe(true)
    expect(equalTrackRatios([1, 1], [1, 0.9])).toBe(false)
  })
})
