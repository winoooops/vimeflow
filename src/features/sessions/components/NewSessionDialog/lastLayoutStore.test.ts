import { afterEach, describe, expect, test } from 'vitest'
import { getLastLayout, setLastLayout } from './lastLayoutStore'

afterEach(() => {
  window.localStorage.clear()
})

describe('lastLayoutStore', () => {
  test('returns null when nothing is stored', () => {
    expect(getLastLayout()).toBeNull()
  })

  test('round-trips the stored layout id', () => {
    setLastLayout('quad')
    expect(getLastLayout()).toBe('quad')
  })
})
