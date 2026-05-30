import { test, expect, beforeEach } from 'vitest'
import { registerChord, dispatch, _resetForTest } from './chordRegistry'

beforeEach(() => _resetForTest())

test('registerChord stores and dispatch invokes the handler', () => {
  let called = false
  registerChord('r', () => {
    called = true

    return true
  })

  const result = dispatch({ key: 'r' } as KeyboardEvent)

  expect(result).toBe(true)
  expect(called).toBe(true)
})

test('dispatch returns false when no chord is registered for the key', () => {
  expect(dispatch({ key: 'x' } as KeyboardEvent)).toBe(false)
})

test('unregister callback removes the chord', () => {
  const unregister = registerChord('r', () => true)

  unregister()

  expect(dispatch({ key: 'r' } as KeyboardEvent)).toBe(false)
})
