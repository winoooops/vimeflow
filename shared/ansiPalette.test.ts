import { describe, expect, test } from 'vitest'
import { palette256ToRgb } from './ansiPalette'

describe('palette256ToRgb', () => {
  test('returns null for theme-dependent base indices 0-15', () => {
    expect(palette256ToRgb(0)).toBeNull()
    expect(palette256ToRgb(7)).toBeNull()
    expect(palette256ToRgb(15)).toBeNull()
  })

  test('resolves the 6x6x6 color cube (16-231)', () => {
    expect(palette256ToRgb(16)).toEqual([0, 0, 0])
    expect(palette256ToRgb(231)).toEqual([255, 255, 255])
    // 196 = pure red corner of the cube
    expect(palette256ToRgb(196)).toEqual([255, 0, 0])
  })

  test('resolves the 24-step grayscale ramp (232-255)', () => {
    expect(palette256ToRgb(232)).toEqual([8, 8, 8])
    expect(palette256ToRgb(236)).toEqual([48, 48, 48])
    expect(palette256ToRgb(255)).toEqual([238, 238, 238])
  })

  test('returns null for out-of-range or non-integer indices', () => {
    expect(palette256ToRgb(-1)).toBeNull()
    expect(palette256ToRgb(256)).toBeNull()
    expect(palette256ToRgb(12.5)).toBeNull()
  })
})
