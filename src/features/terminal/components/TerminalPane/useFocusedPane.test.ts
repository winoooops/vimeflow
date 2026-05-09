import { renderHook, act } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { useRef } from 'react'
import { useFocusedPane, type UseFocusedPaneReturn } from './useFocusedPane'

interface FocusedPaneHookHarness {
  result: { current: UseFocusedPaneReturn }
  unmount: () => void
}

const setup = (initial = false): FocusedPaneHookHarness =>
  renderHook(() => {
    const ref = useRef<HTMLDivElement | null>(null)
    const node = document.createElement('div')
    Object.defineProperty(node, 'offsetWidth', { value: 100 })
    document.body.appendChild(node)
    ref.current = node

    return useFocusedPane({ containerRef: ref, initial })
  })

describe('useFocusedPane', () => {
  test('initial state defaults to false', () => {
    const { result } = setup()

    expect(result.current.isFocused).toBe(false)
  })

  test('initial=true starts focused', () => {
    const { result } = setup(true)

    expect(result.current.isFocused).toBe(true)
  })

  test('setFocused(true) updates state', () => {
    const { result } = setup()

    act(() => result.current.setFocused(true))

    expect(result.current.isFocused).toBe(true)
  })

  test('onTerminalFocusChange mirrors xterm focus events', () => {
    const { result } = setup()

    act(() => result.current.onTerminalFocusChange(true))
    expect(result.current.isFocused).toBe(true)

    act(() => result.current.onTerminalFocusChange(false))
    expect(result.current.isFocused).toBe(false)
  })

  test('mousedown outside container blurs the pane', () => {
    const { result } = setup(true)
    const outside = document.createElement('button')
    document.body.appendChild(outside)

    act(() => {
      outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })

    expect(result.current.isFocused).toBe(false)
  })

  test('mousedown inside container does not blur', () => {
    const containerNode = document.createElement('div')
    Object.defineProperty(containerNode, 'offsetWidth', { value: 100 })
    document.body.appendChild(containerNode)
    const child = document.createElement('span')
    containerNode.appendChild(child)

    const { result } = renderHook(() => {
      const ref = useRef<HTMLElement | null>(containerNode)

      return useFocusedPane({ containerRef: ref, initial: true })
    })

    act(() => {
      child.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })

    expect(result.current.isFocused).toBe(true)
  })

  test('offsetWidth === 0 short-circuits the outside-click handler', () => {
    const hidden = document.createElement('div')
    Object.defineProperty(hidden, 'offsetWidth', { value: 0 })
    document.body.appendChild(hidden)

    const { result } = renderHook(() => {
      const ref = useRef<HTMLElement | null>(hidden)

      return useFocusedPane({ containerRef: ref, initial: true })
    })

    const outside = document.createElement('button')
    document.body.appendChild(outside)

    act(() => {
      outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })

    expect(result.current.isFocused).toBe(true)
  })

  test('removes mousedown listener on unmount', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const { unmount } = setup()

    unmount()

    expect(removeSpy).toHaveBeenCalledWith('mousedown', expect.any(Function))
  })
})
