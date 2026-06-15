import { test, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  useFloatingSurface,
  type FloatingSurfaceOptions,
} from './useFloatingSurface'

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

test('clears the virtual anchor when the anchor leaves point mode', () => {
  const { result, rerender } = renderHook<
    ReturnType<typeof useFloatingSurface>,
    { anchor: FloatingSurfaceOptions['anchor'] }
  >(
    (props) =>
      useFloatingSurface({
        open: true,
        onOpenChange: () => undefined,
        anchor: props.anchor,
        role: 'menu',
      }),
    { initialProps: { anchor: { x: 10, y: 20 } } }
  )
  expect(result.current.floatingStyles).toBeDefined()

  // Leaving point mode must not throw — the effect clears the stale position reference.
  rerender({ anchor: null })
  expect(result.current.floatingStyles).toBeDefined()
})
