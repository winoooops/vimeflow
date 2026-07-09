import { describe, expect, test } from 'vitest'
import { shouldQuitOnAllWindowsClosed } from './last-window-close'

describe('shouldQuitOnAllWindowsClosed', () => {
  test('always quits when the user explicitly chooses quit', () => {
    expect(shouldQuitOnAllWindowsClosed('quit', 'darwin')).toBe(true)
    expect(shouldQuitOnAllWindowsClosed('quit', 'win32')).toBe(true)
    expect(shouldQuitOnAllWindowsClosed('quit', 'linux')).toBe(true)
  })

  test('follows the platform default when set to platform', () => {
    expect(shouldQuitOnAllWindowsClosed('platform', 'darwin')).toBe(false)
    expect(shouldQuitOnAllWindowsClosed('platform', 'win32')).toBe(true)
    expect(shouldQuitOnAllWindowsClosed('platform', 'linux')).toBe(true)
  })
})
