import { test, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFloatingSurface } from './useFloatingSurface'

test('returns ref setters, styles, context and prop getters', () => {
  const { result } = renderHook(() =>
    useFloatingSurface({ open: false, onOpenChange: () => undefined })
  )
  expect(typeof result.current.refs.setReference).toBe('function')
  expect(typeof result.current.refs.setFloating).toBe('function')
  expect(typeof result.current.getReferenceProps).toBe('function')
  expect(typeof result.current.getFloatingProps).toBe('function')
  expect(typeof result.current.getItemProps).toBe('function')
  expect(result.current.context).toBeDefined()
})

test('accepts a virtual-point anchor without throwing', () => {
  const { result } = renderHook(() =>
    useFloatingSurface({
      open: true,
      onOpenChange: () => undefined,
      anchor: { x: 10, y: 20 },
      role: 'menu',
    })
  )
  expect(result.current.floatingStyles).toBeDefined()
})
