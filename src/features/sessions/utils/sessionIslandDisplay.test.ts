import { describe, expect, test } from 'vitest'
import { resolveSessionIslandDisplay } from './sessionIslandDisplay'

describe('resolveSessionIslandDisplay', () => {
  test.each(['dots', 'numbers', 'labels'] as const)('preserves %s', (mode) => {
    expect(resolveSessionIslandDisplay(mode)).toBe(mode)
  })

  test('falls back to dots for unknown persisted values', () => {
    expect(resolveSessionIslandDisplay('future-mode')).toBe('dots')
  })
})
