import { describe, expect, test } from 'vitest'
import { formatBytes } from './formatBytes'

describe('formatBytes', () => {
  test('formats zero bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  test('formats bytes below 1 KB', () => {
    expect(formatBytes(512)).toBe('512.00 B')
  })

  test('formats kilobytes', () => {
    expect(formatBytes(1536)).toBe('1.50 KB')
  })

  test('formats exact megabyte', () => {
    expect(formatBytes(1_048_576)).toBe('1.00 MB')
  })

  test('respects decimals parameter', () => {
    expect(formatBytes(1_234_567, 0)).toBe('1 MB')
    expect(formatBytes(1_234_567, 3)).toBe('1.177 MB')
  })
})
