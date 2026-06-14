import { test, expect } from 'vitest'
import { FloatingList, useListItem, useMergeRefs } from './list'

test('re-exports the floating-ui list primitives Menu composes', () => {
  expect(typeof FloatingList).toBe('function')
  expect(typeof useListItem).toBe('function')
  expect(typeof useMergeRefs).toBe('function')
})
