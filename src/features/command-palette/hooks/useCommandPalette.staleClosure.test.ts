import { act, renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { useCommandPalette } from './useCommandPalette'
import type { Command } from '../registry/types'

describe('useCommandPalette stale-closure regression', () => {
  test('Enter dispatches the latest closure when commands prop changes mid-open', () => {
    const firstExecute = vi.fn()
    const secondExecute = vi.fn()

    const buildCommands = (active: 'a' | 'b'): Command[] => [
      {
        id: 'cmd',
        label: ':do',
        icon: 'star',
        execute: (): void => {
          if (active === 'a') {
            firstExecute()
          } else {
            secondExecute()
          }
        },
      },
    ]

    const { result, rerender } = renderHook(
      ({ commands }: { commands: Command[] }) => useCommandPalette(commands),
      { initialProps: { commands: buildCommands('a') } }
    )

    act(() => {
      result.current.open()
    })

    rerender({ commands: buildCommands('b') })

    act(() => {
      result.current.executeSelected()
    })

    expect(firstExecute).not.toHaveBeenCalled()
    expect(secondExecute).toHaveBeenCalledTimes(1)
  })

  test('clampedSelectedIndex stays valid after commands prop shrinks the result list', () => {
    const longCommands: Command[] = [
      { id: 'a', label: ':alpha', icon: 's', execute: vi.fn() },
      { id: 'b', label: ':bravo', icon: 's', execute: vi.fn() },
      { id: 'c', label: ':charlie', icon: 's', execute: vi.fn() },
      { id: 'd', label: ':delta', icon: 's', execute: vi.fn() },
      { id: 'e', label: ':echo', icon: 's', execute: vi.fn() },
    ]

    const shortCommands: Command[] = [
      { id: 'a', label: ':alpha', icon: 's', execute: vi.fn() },
      { id: 'b', label: ':bravo', icon: 's', execute: vi.fn() },
    ]

    const { result, rerender } = renderHook(
      ({ commands }: { commands: Command[] }) => useCommandPalette(commands),
      { initialProps: { commands: longCommands } }
    )

    act(() => {
      result.current.open()
    })
    expect(result.current.filteredResults.length).toBe(5)

    // Move the cursor to raw selectedIndex = 3.
    act(() => {
      result.current.navigateDown()
      result.current.navigateDown()
      result.current.navigateDown()
    })
    expect(result.current.state.selectedIndex).toBe(3)

    // Shrink via the commands prop, NOT via setQuery (which would reset
    // selectedIndex to 0 and trivially pass this test). Goal: keep the raw
    // cursor at 3 while filteredResults drops to length 2 — that is the
    // exact regression clampedSelectedIndex protects against.
    rerender({ commands: shortCommands })

    expect(result.current.filteredResults.length).toBe(2)
    expect(result.current.state.selectedIndex).toBe(3)
    expect(result.current.clampedSelectedIndex).toBe(1)
    expect(
      result.current.filteredResults[result.current.clampedSelectedIndex]
    ).toBeDefined()
  })

  test('clampedSelectedIndex is -1 when commands shrinks to empty', () => {
    const someCommands: Command[] = [
      { id: 'a', label: ':alpha', icon: 's', execute: vi.fn() },
    ]

    const { result, rerender } = renderHook(
      ({ commands }: { commands: Command[] }) => useCommandPalette(commands),
      { initialProps: { commands: someCommands } }
    )

    act(() => {
      result.current.open()
    })
    expect(result.current.clampedSelectedIndex).toBe(0)

    rerender({ commands: [] })

    expect(result.current.filteredResults.length).toBe(0)
    expect(result.current.clampedSelectedIndex).toBe(-1)

    // Enter must be a no-op when the result list is empty.
    act(() => {
      result.current.executeSelected()
    })
    // No assertion needed besides "did not throw"; mocks were not called
    // because there were no commands to dispatch.
  })
})
