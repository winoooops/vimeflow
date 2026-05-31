import { describe, expect, test } from 'vitest'
import {
  DEFAULT_READING_STYLE,
  getReadingStyle,
  isReadingStyleId,
  READING_STYLES,
} from './readingStyles'

describe('readingStyles', () => {
  test('default is "comfortable" (the tuned pick) at 18.5px', () => {
    expect(DEFAULT_READING_STYLE.id).toBe('comfortable')
    expect(DEFAULT_READING_STYLE.fontPx).toBe(18.5)
  })

  test('exposes compact / comfortable / spacious in ascending font size', () => {
    expect(READING_STYLES.map((style) => style.id)).toEqual([
      'compact',
      'comfortable',
      'spacious',
    ])

    const sizes = READING_STYLES.map((style) => style.fontPx)
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes)
  })

  test('every preset pads with a cqi container-query, never vw', () => {
    for (const style of READING_STYLES) {
      expect(style.paddingInline).toContain('cqi')
      expect(style.paddingInline).not.toContain('vw')
    }
  })

  test('getReadingStyle returns the preset, or the default for an unknown id', () => {
    expect(getReadingStyle('spacious').id).toBe('spacious')
    // @ts-expect-error — exercising the runtime fallback with an invalid id
    expect(getReadingStyle('nope')).toBe(DEFAULT_READING_STYLE)
  })

  test('isReadingStyleId narrows valid ids and rejects everything else', () => {
    expect(isReadingStyleId('compact')).toBe(true)
    expect(isReadingStyleId('comfortable')).toBe(true)
    expect(isReadingStyleId('nope')).toBe(false)
    expect(isReadingStyleId(null)).toBe(false)
  })
})
