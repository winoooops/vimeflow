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

  test('enforces a minimum per-track weight so grid columns cannot collapse to zero', () => {
    // Codex P2: dragging the first grid3x2 divider to an extreme ratio must
    // keep every column above the 15% minimum. With tracks [1,1,1] and a
    // requested boundary ratio of 0.85, the first pair is clamped to leave
    // the second column at the minimum weight (0.45) instead of collapsing it.
    const first = updateTrackBoundaryRatio([1, 1, 1], 0, 0.85)
    expect(first[0]).toBe(1.55)
    expect(first[1]).toBeCloseTo(0.45, 10)
    expect(first[2]).toBe(1)

    // Symmetric clamp on the right side of the second pair.
    const second = updateTrackBoundaryRatio([1, 1, 1], 1, 0.15)
    expect(second[0]).toBe(1)
    expect(second[1]).toBeCloseTo(0.45, 10)
    expect(second[2]).toBe(1.55)
  })

  test('compares track arrays shallowly', () => {
    expect(equalTrackRatios([1, 1], [1, 1])).toBe(true)
    expect(equalTrackRatios([1, 1], [1, 0.9])).toBe(false)
  })
})
