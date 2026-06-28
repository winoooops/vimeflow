// cspell:ignore Ghostty ghostty GHOSTTY
import { describe, expect, test } from 'vitest'
import { isBounds, isRecord, isString } from './ghostty-native-shared'

describe('ghostty native shared guards', () => {
  test('validates bounds records', () => {
    expect(isBounds({ x: 1, y: 2, width: 3, height: 4 })).toBe(true)
    expect(isBounds({ x: 1, y: 2, width: Number.NaN, height: 4 })).toBe(false)
    expect(isBounds(null)).toBe(false)
  })

  test('validates non-array records and non-empty strings', () => {
    expect(isRecord({ value: true })).toBe(true)
    expect(isRecord([])).toBe(false)
    expect(isString('pane-1')).toBe(true)
    expect(isString('')).toBe(false)
  })
})
