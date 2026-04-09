import { describe, test, expect } from 'vitest'
import { catppuccinMocha } from './catppuccin'

describe('catppuccin theme', () => {
  test('exports a valid extension', () => {
    expect(catppuccinMocha).toBeDefined()
    expect(Array.isArray(catppuccinMocha)).toBe(true)
  })

  test('extension array has expected length', () => {
    expect(catppuccinMocha).toHaveLength(2)
  })

  test('extension is an array of theme components', () => {
    // Extension is an array of [theme, syntaxHighlighting]
    // We can't directly index the Extension type, but we can verify structure
    const extensionArray = catppuccinMocha as unknown[]

    expect(extensionArray).toHaveLength(2)
    expect(extensionArray[0]).toBeDefined()
    expect(extensionArray[1]).toBeDefined()
  })
})
