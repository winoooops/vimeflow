import { describe, expect, test } from 'vitest'
import {
  LAYOUT_CYCLE,
  LAYOUT_IDS,
  LAYOUTS,
  VISIBLE_LAYOUTS,
  autoShrinkLayoutFor,
  isKnownLayoutId,
} from '.'

describe('layoutRegistry', () => {
  test('exports the canonical layout order once', () => {
    expect(LAYOUT_IDS).toEqual([
      'single',
      'vsplit',
      'hsplit',
      'threeRight',
      'quad',
      'grid3x2',
    ])
    expect(LAYOUT_CYCLE).toEqual(LAYOUT_IDS)
    expect(VISIBLE_LAYOUTS.map((layout) => layout.id)).toEqual(LAYOUT_IDS)
  })

  test('exposes record lookup by layout id', () => {
    expect(LAYOUTS.single.name).toBe('Single')
    expect(LAYOUTS.quad.capacity).toBe(4)
    expect(LAYOUTS.grid3x2.capacity).toBe(6)
  })

  test('recognizes known layout ids and rejects unknown ones', () => {
    expect(isKnownLayoutId('single')).toBe(true)
    expect(isKnownLayoutId('quad')).toBe(true)
    expect(isKnownLayoutId('grid3x2')).toBe(true)
  })

  test('centralizes the current auto-shrink policy', () => {
    expect(autoShrinkLayoutFor(1, 'quad')).toBe('single')
    expect(autoShrinkLayoutFor(2, 'hsplit')).toBe('hsplit')
    expect(autoShrinkLayoutFor(2, 'quad')).toBe('vsplit')
    expect(autoShrinkLayoutFor(3, 'quad')).toBe('threeRight')
    expect(autoShrinkLayoutFor(4, 'quad')).toBe('quad')
    expect(autoShrinkLayoutFor(5, 'grid3x2')).toBe('grid3x2')
    expect(autoShrinkLayoutFor(4, 'grid3x2')).toBe('quad')
  })
})
