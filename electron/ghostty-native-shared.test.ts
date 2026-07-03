// cspell:ignore Ghostty ghostty GHOSTTY
import { describe, expect, test } from 'vitest'
import {
  isBounds,
  isHexColor,
  isNonEmptyString,
  isOptionalFiniteNumber,
  isRecord,
  isString,
} from './ghostty-native-shared'

describe('ghostty native shared guards', () => {
  test('validates bounds records', () => {
    expect(isBounds({ x: 1, y: 2, width: 3, height: 4 })).toBe(true)
    expect(isBounds({ x: 1, y: 2, width: Number.NaN, height: 4 })).toBe(false)
    expect(isBounds(null)).toBe(false)
  })

  test('validates non-array records and string guards', () => {
    expect(isRecord({ value: true })).toBe(true)
    expect(isRecord([])).toBe(false)
    expect(isString('pane-1')).toBe(true)
    expect(isString('')).toBe(true)
    expect(isNonEmptyString('pane-1')).toBe(true)
    expect(isNonEmptyString('')).toBe(false)
  })

  test('validates serialized theme hex colors', () => {
    expect(isHexColor('#1e1e2e')).toBe(true)
    expect(isHexColor('1e1e2e')).toBe(false)
    expect(isHexColor('#fff')).toBe(false)
    expect(isHexColor('#12345z')).toBe(false)
  })

  test('validates optional finite numbers', () => {
    expect(isOptionalFiniteNumber(undefined)).toBe(true)
    expect(isOptionalFiniteNumber(10)).toBe(true)
    expect(isOptionalFiniteNumber(Number.NaN)).toBe(false)
    expect(isOptionalFiniteNumber('10')).toBe(false)
  })
})
