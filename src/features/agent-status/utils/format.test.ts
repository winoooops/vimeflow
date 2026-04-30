import { describe, test, expect } from 'vitest'
import { formatTokens } from './format'

describe('formatTokens', () => {
  test('returns "0" for zero', () => {
    expect(formatTokens(0)).toBe('0')
  })

  test('returns raw number below 1000', () => {
    expect(formatTokens(999)).toBe('999')
  })

  test('formats 1500 as "1.5k"', () => {
    expect(formatTokens(1500)).toBe('1.5k')
  })

  test('formats 94720 as "94.7k"', () => {
    expect(formatTokens(94720)).toBe('94.7k')
  })

  test('formats 1000 as "1k"', () => {
    expect(formatTokens(1000)).toBe('1k')
  })

  test('formats 100000 as "100k"', () => {
    expect(formatTokens(100000)).toBe('100k')
  })
})
