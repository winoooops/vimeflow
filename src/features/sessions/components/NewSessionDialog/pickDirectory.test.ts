import { afterEach, describe, expect, test, vi } from 'vitest'
import { pickDirectory } from './pickDirectory'

afterEach(() => {
  delete (window as { vimeflow?: unknown }).vimeflow
})

describe('pickDirectory', () => {
  test('returns the bridge result', async () => {
    ;(window as { vimeflow?: unknown }).vimeflow = {
      dialog: { pickDirectory: vi.fn().mockResolvedValue('/Users/x/proj') },
    }
    await expect(pickDirectory()).resolves.toBe('/Users/x/proj')
  })
  test('returns null when the bridge is absent (browser dev)', async () => {
    await expect(pickDirectory()).resolves.toBeNull()
  })
})
