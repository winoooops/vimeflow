import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useCommandPalette } from './useCommandPalette'

describe('useCommandPalette', () => {
  beforeEach(() => {
    // Clear any focused elements before each test
    document.body.innerHTML = ''
    if (document.activeElement && 'blur' in document.activeElement) {
      const activeElement = document.activeElement as HTMLElement
      activeElement.blur()
    }
  })

  describe('initial state', () => {
    test('starts closed with default values', () => {
      const { result } = renderHook(() => useCommandPalette())

      expect(result.current.state.isOpen).toBe(false)
      expect(result.current.state.query).toBe(':')
      expect(result.current.state.selectedIndex).toBe(0)
      expect(result.current.state.currentNamespace).toBe(null)
      expect(result.current.state.filteredResults).toEqual([])
    })
  })

  describe('open/close actions', () => {
    test('open() sets isOpen to true and loads default commands', () => {
      const { result } = renderHook(() => useCommandPalette())

      act(() => {
        result.current.open()
      })

      expect(result.current.state.isOpen).toBe(true)
      expect(result.current.state.query).toBe(':')
      expect(result.current.state.selectedIndex).toBe(0)
      expect(result.current.state.filteredResults.length).toBeGreaterThan(0)
    })

    test('close() resets state', () => {
      const { result } = renderHook(() => useCommandPalette())

      act(() => {
        result.current.open()
        result.current.setQuery(':test')
        result.current.selectIndex(2)
      })

      act(() => {
        result.current.close()
      })

      expect(result.current.state.isOpen).toBe(false)
      expect(result.current.state.query).toBe(':')
      expect(result.current.state.selectedIndex).toBe(0)
      expect(result.current.state.currentNamespace).toBe(null)
      expect(result.current.state.filteredResults).toEqual([])
    })
  })

  describe('keyboard trigger - ":" key', () => {
    test('opens palette when ":" pressed and no input focused', async () => {
      const { result } = renderHook(() => useCommandPalette())

      expect(result.current.state.isOpen).toBe(false)

      act(() => {
        const event = new KeyboardEvent('keydown', { key: ':' })
        document.dispatchEvent(event)
      })

      await waitFor(() => {
        expect(result.current.state.isOpen).toBe(true)
      })
    })

    test('suppresses ":" when input element is focused', async () => {
      const { result } = renderHook(() => useCommandPalette())
      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()

      expect(document.activeElement).toBe(input)
      expect(result.current.state.isOpen).toBe(false)

      act(() => {
        const event = new KeyboardEvent('keydown', { key: ':' })
        document.dispatchEvent(event)
      })

      await waitFor(() => {
        expect(result.current.state.isOpen).toBe(false)
      })
    })

    test('suppresses ":" when textarea is focused', async () => {
      const { result } = renderHook(() => useCommandPalette())
      const textarea = document.createElement('textarea')
      document.body.appendChild(textarea)
      textarea.focus()

      expect(document.activeElement).toBe(textarea)
      expect(result.current.state.isOpen).toBe(false)

      act(() => {
        const event = new KeyboardEvent('keydown', { key: ':' })
        document.dispatchEvent(event)
      })

      await waitFor(() => {
        expect(result.current.state.isOpen).toBe(false)
      })
    })

    test('suppresses ":" when contenteditable element is focused', async () => {
      const { result } = renderHook(() => useCommandPalette())
      const div = document.createElement('div')
      div.setAttribute('contenteditable', 'true')
      document.body.appendChild(div)
      div.focus()

      expect(document.activeElement).toBe(div)
      expect(result.current.state.isOpen).toBe(false)

      act(() => {
        const event = new KeyboardEvent('keydown', { key: ':' })
        document.dispatchEvent(event)
      })

      await waitFor(() => {
        expect(result.current.state.isOpen).toBe(false)
      })
    })

    test('suppresses ":" when contenteditable="" element is focused', async () => {
      const { result } = renderHook(() => useCommandPalette())
      const div = document.createElement('div')
      div.setAttribute('contenteditable', '')
      document.body.appendChild(div)
      div.focus()

      expect(document.activeElement).toBe(div)
      expect(result.current.state.isOpen).toBe(false)

      act(() => {
        const event = new KeyboardEvent('keydown', { key: ':' })
        document.dispatchEvent(event)
      })

      await waitFor(() => {
        expect(result.current.state.isOpen).toBe(false)
      })
    })

    test('does not open when already open', async () => {
      const { result } = renderHook(() => useCommandPalette())

      act(() => {
        result.current.open()
        result.current.setQuery(':test')
      })

      const queryBeforeKeypress = result.current.state.query

      act(() => {
        const event = new KeyboardEvent('keydown', { key: ':' })
        document.dispatchEvent(event)
      })

      await waitFor(() => {
        expect(result.current.state.query).toBe(queryBeforeKeypress)
      })
    })
  })

  describe('keyboard navigation - Escape', () => {
    test('closes palette when Escape pressed', async () => {
      const { result } = renderHook(() => useCommandPalette())

      act(() => {
        result.current.open()
      })

      expect(result.current.state.isOpen).toBe(true)

      act(() => {
        const event = new KeyboardEvent('keydown', { key: 'Escape' })
        document.dispatchEvent(event)
      })

      await waitFor(() => {
        expect(result.current.state.isOpen).toBe(false)
      })
    })

    test('does not trigger when palette is closed', async () => {
      const { result } = renderHook(() => useCommandPalette())

      expect(result.current.state.isOpen).toBe(false)

      act(() => {
        const event = new KeyboardEvent('keydown', { key: 'Escape' })
        document.dispatchEvent(event)
      })

      await waitFor(() => {
        expect(result.current.state.isOpen).toBe(false)
      })
    })
  })

  describe('keyboard navigation - Backspace', () => {
    test('closes palette when Backspace pressed on empty query', async () => {
      const { result } = renderHook(() => useCommandPalette())

      act(() => {
        result.current.open()
      })

      expect(result.current.state.isOpen).toBe(true)
      expect(result.current.state.query).toBe(':')

      act(() => {
        const event = new KeyboardEvent('keydown', { key: 'Backspace' })
        document.dispatchEvent(event)
      })

      await waitFor(() => {
        expect(result.current.state.isOpen).toBe(false)
      })
    })

    test('does not close when query is not empty', async () => {
      const { result } = renderHook(() => useCommandPalette())

      act(() => {
        result.current.open()
        result.current.setQuery(':open')
      })

      expect(result.current.state.isOpen).toBe(true)
      expect(result.current.state.query).toBe(':open')

      act(() => {
        const event = new KeyboardEvent('keydown', { key: 'Backspace' })
        document.dispatchEvent(event)
      })

      await waitFor(() => {
        expect(result.current.state.isOpen).toBe(true)
      })
    })
  })

  describe('keyboard navigation - ArrowUp/ArrowDown', () => {
    test('ArrowDown increments selectedIndex', async () => {
      const { result } = renderHook(() => useCommandPalette())

      act(() => {
        result.current.open()
      })

      expect(result.current.state.selectedIndex).toBe(0)

      act(() => {
        const event = new KeyboardEvent('keydown', { key: 'ArrowDown' })
        document.dispatchEvent(event)
      })

      await waitFor(() => {
        expect(result.current.state.selectedIndex).toBe(1)
      })
    })

    test('ArrowDown wraps to 0 at end of results', async () => {
      const { result } = renderHook(() => useCommandPalette())

      act(() => {
        result.current.open()
      })

      const lastIndex = result.current.state.filteredResults.length - 1

      act(() => {
        result.current.selectIndex(lastIndex)
      })

      expect(result.current.state.selectedIndex).toBe(lastIndex)

      act(() => {
        const event = new KeyboardEvent('keydown', { key: 'ArrowDown' })
        document.dispatchEvent(event)
      })

      await waitFor(() => {
        expect(result.current.state.selectedIndex).toBe(0)
      })
    })

    test('ArrowUp decrements selectedIndex', async () => {
      const { result } = renderHook(() => useCommandPalette())

      act(() => {
        result.current.open()
        result.current.selectIndex(2)
      })

      expect(result.current.state.selectedIndex).toBe(2)

      act(() => {
        const event = new KeyboardEvent('keydown', { key: 'ArrowUp' })
        document.dispatchEvent(event)
      })

      await waitFor(() => {
        expect(result.current.state.selectedIndex).toBe(1)
      })
    })

    test('ArrowUp wraps to last index when at 0', async () => {
      const { result } = renderHook(() => useCommandPalette())

      act(() => {
        result.current.open()
      })

      expect(result.current.state.selectedIndex).toBe(0)

      const lastIndex = result.current.state.filteredResults.length - 1

      act(() => {
        const event = new KeyboardEvent('keydown', { key: 'ArrowUp' })
        document.dispatchEvent(event)
      })

      await waitFor(() => {
        expect(result.current.state.selectedIndex).toBe(lastIndex)
      })
    })

    test('navigation only works when palette is open', async () => {
      const { result } = renderHook(() => useCommandPalette())

      expect(result.current.state.isOpen).toBe(false)
      expect(result.current.state.selectedIndex).toBe(0)

      act(() => {
        const event = new KeyboardEvent('keydown', { key: 'ArrowDown' })
        document.dispatchEvent(event)
      })

      await waitFor(() => {
        expect(result.current.state.selectedIndex).toBe(0)
      })
    })
  })

  describe('keyboard navigation - Enter', () => {
    test('Enter executes selected leaf command', async () => {
      const { result } = renderHook(() => useCommandPalette())

      const consoleInfoSpy = vi
        .spyOn(console, 'info')
        .mockImplementation(() => {
          // Mock implementation - intentionally empty
        })

      act(() => {
        result.current.open()
        result.current.setQuery(':help')
      })

      // Find and select the :help command
      const helpIndex = result.current.state.filteredResults.findIndex(
        (cmd) => cmd.id === 'help'
      )

      if (helpIndex !== -1) {
        act(() => {
          result.current.selectIndex(helpIndex)
        })

        act(() => {
          const event = new KeyboardEvent('keydown', { key: 'Enter' })
          document.dispatchEvent(event)
        })

        await waitFor(() => {
          expect(consoleInfoSpy).toHaveBeenCalled()
          expect(result.current.state.isOpen).toBe(false)
        })
      }

      consoleInfoSpy.mockRestore()
    })

    test('Enter drills into namespace command', async () => {
      const { result } = renderHook(() => useCommandPalette())

      act(() => {
        result.current.open()
        result.current.setQuery(':open')
      })

      // Find the :open namespace
      const openIndex = result.current.state.filteredResults.findIndex(
        (cmd) => cmd.id === 'open'
      )

      if (openIndex !== -1) {
        act(() => {
          result.current.selectIndex(openIndex)
        })

        const selectedCommand = result.current.state.filteredResults[openIndex]

        const hasChildren =
          selectedCommand.children && selectedCommand.children.length > 0

        if (hasChildren) {
          act(() => {
            const event = new KeyboardEvent('keydown', { key: 'Enter' })
            document.dispatchEvent(event)
          })

          await waitFor(() => {
            expect(result.current.state.currentNamespace).not.toBe(null)
            expect(result.current.state.isOpen).toBe(true)
          })
        }
      }
    })

    test('Enter does nothing when no results', async () => {
      const { result } = renderHook(() => useCommandPalette())

      act(() => {
        result.current.open()
        result.current.setQuery(':nonexistent')
      })

      expect(result.current.state.filteredResults.length).toBe(0)

      act(() => {
        const event = new KeyboardEvent('keydown', { key: 'Enter' })
        document.dispatchEvent(event)
      })

      await waitFor(() => {
        expect(result.current.state.isOpen).toBe(true)
      })
    })

    test('Enter does nothing when selectedIndex out of bounds', async () => {
      const { result } = renderHook(() => useCommandPalette())

      act(() => {
        result.current.open()
        result.current.selectIndex(999)
      })

      act(() => {
        const event = new KeyboardEvent('keydown', { key: 'Enter' })
        document.dispatchEvent(event)
      })

      await waitFor(() => {
        expect(result.current.state.isOpen).toBe(true)
      })
    })
  })

  describe('query filtering', () => {
    test('setQuery updates filteredResults via fuzzyMatch', () => {
      const { result } = renderHook(() => useCommandPalette())

      act(() => {
        result.current.open()
      })

      const initialResultsCount = result.current.state.filteredResults.length

      act(() => {
        result.current.setQuery(':op')
      })

      expect(result.current.state.query).toBe(':op')
      expect(result.current.state.filteredResults.length).toBeGreaterThan(0)
      expect(result.current.state.filteredResults.length).toBeLessThanOrEqual(
        initialResultsCount
      )
    })

    test('setQuery resets selectedIndex to 0', () => {
      const { result } = renderHook(() => useCommandPalette())

      act(() => {
        result.current.open()
        result.current.selectIndex(3)
      })

      expect(result.current.state.selectedIndex).toBe(3)

      act(() => {
        result.current.setQuery(':help')
      })

      expect(result.current.state.selectedIndex).toBe(0)
    })

    test('empty query shows all commands', () => {
      const { result } = renderHook(() => useCommandPalette())

      act(() => {
        result.current.open()
      })

      const allCommandsCount = result.current.state.filteredResults.length

      act(() => {
        result.current.setQuery(':')
      })

      expect(result.current.state.filteredResults.length).toBe(allCommandsCount)
    })

    test('query filters commands based on fuzzy match score', () => {
      const { result } = renderHook(() => useCommandPalette())

      act(() => {
        result.current.open()
        result.current.setQuery(':help')
      })

      const hasHelpCommand = result.current.state.filteredResults.some((cmd) =>
        cmd.label.toLowerCase().includes('help')
      )

      expect(hasHelpCommand).toBe(true)
    })
  })

  describe('cleanup', () => {
    test('removes event listener on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')
      const { unmount } = renderHook(() => useCommandPalette())

      unmount()

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'keydown',
        expect.any(Function)
      )

      removeEventListenerSpy.mockRestore()
    })
  })

  describe('navigateUp/navigateDown direct calls', () => {
    test('navigateDown increments selectedIndex', () => {
      const { result } = renderHook(() => useCommandPalette())

      act(() => {
        result.current.open()
      })

      expect(result.current.state.selectedIndex).toBe(0)

      act(() => {
        result.current.navigateDown()
      })

      expect(result.current.state.selectedIndex).toBe(1)
    })

    test('navigateUp decrements selectedIndex', () => {
      const { result } = renderHook(() => useCommandPalette())

      act(() => {
        result.current.open()
        result.current.selectIndex(2)
      })

      expect(result.current.state.selectedIndex).toBe(2)

      act(() => {
        result.current.navigateUp()
      })

      expect(result.current.state.selectedIndex).toBe(1)
    })
  })

  describe('selectIndex', () => {
    test('updates selectedIndex to specified value', () => {
      const { result } = renderHook(() => useCommandPalette())

      act(() => {
        result.current.open()
      })

      act(() => {
        result.current.selectIndex(5)
      })

      expect(result.current.state.selectedIndex).toBe(5)
    })
  })

  describe('executeSelected', () => {
    test('executes the selected command', () => {
      const { result } = renderHook(() => useCommandPalette())

      const consoleInfoSpy = vi
        .spyOn(console, 'info')
        .mockImplementation(() => {
          // Mock implementation - intentionally empty
        })

      act(() => {
        result.current.open()
        result.current.setQuery(':new')
      })

      const newIndex = result.current.state.filteredResults.findIndex(
        (cmd) => cmd.id === 'new'
      )

      if (newIndex !== -1) {
        act(() => {
          result.current.selectIndex(newIndex)
          result.current.executeSelected()
        })

        expect(consoleInfoSpy).toHaveBeenCalled()
        expect(result.current.state.isOpen).toBe(false)
      }

      consoleInfoSpy.mockRestore()
    })

    test('does not execute when selectedIndex is out of bounds', () => {
      const { result } = renderHook(() => useCommandPalette())

      const consoleInfoSpy = vi
        .spyOn(console, 'info')
        .mockImplementation(() => {
          // Mock implementation - intentionally empty
        })

      act(() => {
        result.current.open()
        result.current.selectIndex(-1)
        result.current.executeSelected()
      })

      expect(consoleInfoSpy).not.toHaveBeenCalled()
      expect(result.current.state.isOpen).toBe(true)

      consoleInfoSpy.mockRestore()
    })
  })
})
