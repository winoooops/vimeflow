import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useCommandPalette } from './useCommandPalette'
import type { Command } from '../registry/types'

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
      // filteredResults is derived from query ':' so it shows all default commands
      expect(result.current.filteredResults.length).toBeGreaterThan(0)
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
      expect(result.current.filteredResults.length).toBeGreaterThan(0)
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
      // filteredResults is derived from query ':' so it shows all default commands
      expect(result.current.filteredResults.length).toBeGreaterThan(0)
    })
  })

  describe('keyboard trigger - Ctrl+:', () => {
    test('opens palette when Ctrl+: is pressed', async () => {
      const { result } = renderHook(() => useCommandPalette())

      expect(result.current.state.isOpen).toBe(false)

      act(() => {
        const event = new KeyboardEvent('keydown', {
          key: ':',
          ctrlKey: true,
          bubbles: true,
        })
        document.dispatchEvent(event)
      })

      await waitFor(() => {
        expect(result.current.state.isOpen).toBe(true)
      })
    })

    test('does not open palette when bare : is pressed', async () => {
      const { result } = renderHook(() => useCommandPalette())

      expect(result.current.state.isOpen).toBe(false)

      act(() => {
        const event = new KeyboardEvent('keydown', { key: ':' })
        document.dispatchEvent(event)
      })

      await waitFor(() => {
        expect(result.current.state.isOpen).toBe(false)
      })
    })

    test('toggles palette closed when Ctrl+: pressed while open', async () => {
      const { result } = renderHook(() => useCommandPalette())

      act(() => {
        result.current.open()
      })

      expect(result.current.state.isOpen).toBe(true)

      act(() => {
        const event = new KeyboardEvent('keydown', {
          key: ':',
          ctrlKey: true,
          bubbles: true,
        })
        document.dispatchEvent(event)
      })

      await waitFor(() => {
        expect(result.current.state.isOpen).toBe(false)
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

      const lastIndex = result.current.filteredResults.length - 1

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

      const lastIndex = result.current.filteredResults.length - 1

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
      const helpIndex = result.current.filteredResults.findIndex(
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
      const openIndex = result.current.filteredResults.findIndex(
        (cmd) => cmd.id === 'open'
      )

      if (openIndex !== -1) {
        act(() => {
          result.current.selectIndex(openIndex)
        })

        const selectedCommand = result.current.filteredResults[openIndex]

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

      expect(result.current.filteredResults.length).toBe(0)

      act(() => {
        const event = new KeyboardEvent('keydown', { key: 'Enter' })
        document.dispatchEvent(event)
      })

      await waitFor(() => {
        expect(result.current.state.isOpen).toBe(true)
      })
    })

    test('Enter does nothing when clampedSelectedIndex is -1 (empty results)', async () => {
      const { result } = renderHook(() => useCommandPalette())

      act(() => {
        result.current.open()
        // Set query to something that produces no results
        result.current.setQuery(':xyz-no-match-query')
      })

      // Verify we have no results and clampedSelectedIndex is -1
      expect(result.current.filteredResults.length).toBe(0)
      expect(result.current.clampedSelectedIndex).toBe(-1)

      act(() => {
        const event = new KeyboardEvent('keydown', { key: 'Enter' })
        document.dispatchEvent(event)
      })

      // Palette should stay open because there's nothing to execute
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

      const initialResultsCount = result.current.filteredResults.length

      act(() => {
        result.current.setQuery(':op')
      })

      expect(result.current.state.query).toBe(':op')
      expect(result.current.filteredResults.length).toBeGreaterThan(0)
      expect(result.current.filteredResults.length).toBeLessThanOrEqual(
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

      const allCommandsCount = result.current.filteredResults.length

      act(() => {
        result.current.setQuery(':')
      })

      expect(result.current.filteredResults.length).toBe(allCommandsCount)
    })

    test('query filters commands based on fuzzy match score', () => {
      const { result } = renderHook(() => useCommandPalette())

      act(() => {
        result.current.open()
        result.current.setQuery(':help')
      })

      const hasHelpCommand = result.current.filteredResults.some((cmd) =>
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
        expect.any(Function),
        { capture: true }
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

      const newIndex = result.current.filteredResults.findIndex(
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

    test('passes namespace child token as args to leaf command', () => {
      const execute = vi.fn()

      const commands: Command[] = [
        {
          id: 'open',
          label: ':open',
          icon: 'folder',
          children: [
            {
              id: 'open-filename',
              label: '<filename>',
              icon: 'description',
              execute,
            },
          ],
        },
      ]

      const { result } = renderHook(() => useCommandPalette(commands))

      act(() => {
        result.current.open()
        result.current.setQuery(':open')
      })

      const openIndex = result.current.filteredResults.findIndex(
        (cmd) => cmd.id === 'open'
      )

      expect(openIndex).not.toBe(-1)

      act(() => {
        result.current.selectIndex(openIndex)
        result.current.executeSelected()
      })

      expect(result.current.state.currentNamespace?.id).toBe('open')

      act(() => {
        result.current.setQuery(':file')
      })

      const filenameIndex = result.current.filteredResults.findIndex(
        (cmd) => cmd.id === 'open-filename'
      )

      expect(filenameIndex).not.toBe(-1)

      act(() => {
        result.current.selectIndex(filenameIndex)
        result.current.executeSelected()
      })

      expect(execute).toHaveBeenCalledWith('file')
      expect(result.current.state.isOpen).toBe(false)
    })

    test('preserves space-containing input for namespace child commands', () => {
      // Pinning the regression Claude flagged on PR #159 round 3:
      // `parseQuery` splits on the first space, so a namespace value
      // like `:filename foo bar.ts` would land as verbToken=':filename' /
      // args='foo bar.ts'. Without the namespace-aware reconstruction,
      // the leaf would only see 'foo bar.ts' — silently truncating the
      // verbToken portion of the user's input. The executeSelected branch
      // must rebuild the full post-`:` text inside a namespace context so
      // values that span the verb/args split stay intact end-to-end.
      const execute = vi.fn()

      const commands: Command[] = [
        {
          id: 'open',
          label: ':open',
          icon: 'folder',
          children: [
            {
              id: 'open-filename',
              // Non-bracket label so fuzzy-match scores well against the
              // typed verbToken in this test (the bracket variant in
              // defaultCommands is harder to drive deterministically).
              label: 'filename',
              icon: 'description',
              execute,
            },
          ],
        },
      ]

      const { result } = renderHook(() => useCommandPalette(commands))

      act(() => {
        result.current.open()
        result.current.setQuery(':open')
      })

      const openIndex = result.current.filteredResults.findIndex(
        (cmd) => cmd.id === 'open'
      )

      act(() => {
        result.current.selectIndex(openIndex)
        result.current.executeSelected()
      })

      expect(result.current.state.currentNamespace?.id).toBe('open')

      act(() => {
        result.current.setQuery(':filename foo bar.ts')
      })

      const filenameIndex = result.current.filteredResults.findIndex(
        (cmd) => cmd.id === 'open-filename'
      )

      expect(filenameIndex).not.toBe(-1)

      act(() => {
        result.current.selectIndex(filenameIndex)
        result.current.executeSelected()
      })

      expect(execute).toHaveBeenCalledWith('filename foo bar.ts')
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

  describe('custom commands prop', () => {
    test('uses defaultCommands when no commands prop provided', () => {
      const { result } = renderHook(() => useCommandPalette())

      act(() => {
        result.current.open()
      })

      // Default commands should be loaded
      expect(result.current.filteredResults.length).toBeGreaterThan(0)

      // Verify at least one default command exists (e.g., 'help')
      const hasDefaultCommand = result.current.filteredResults.some(
        (cmd) => cmd.id === 'help'
      )

      expect(hasDefaultCommand).toBe(true)
    })

    test('uses custom commands when commands prop provided', () => {
      const customCommands: Command[] = [
        {
          id: 'custom-1',
          label: ':custom',
          icon: '🎨',
          execute: vi.fn(),
        },
        {
          id: 'custom-2',
          label: ':another',
          icon: '🚀',
          execute: vi.fn(),
        },
      ]

      const { result } = renderHook(() => useCommandPalette(customCommands))

      act(() => {
        result.current.open()
      })

      // Should show exactly 2 custom commands
      expect(result.current.filteredResults.length).toBe(2)

      // Should contain our custom commands
      expect(result.current.filteredResults[0].id).toBe('custom-1')
      expect(result.current.filteredResults[1].id).toBe('custom-2')

      // Should NOT contain default commands
      const hasDefaultCommand = result.current.filteredResults.some(
        (cmd) => cmd.id === 'help'
      )

      expect(hasDefaultCommand).toBe(false)
    })

    test('re-derives filteredResults when commands prop changes on rerender', () => {
      const initialCommands: Command[] = [
        {
          id: 'initial',
          label: ':initial',
          icon: '1️⃣',
          execute: vi.fn(),
        },
      ]

      const updatedCommands: Command[] = [
        {
          id: 'updated',
          label: ':updated',
          icon: '2️⃣',
          execute: vi.fn(),
        },
      ]

      const { result, rerender } = renderHook(
        ({ commands }) => useCommandPalette(commands),
        {
          initialProps: { commands: initialCommands },
        }
      )

      act(() => {
        result.current.open()
      })

      // Should show initial command
      expect(result.current.filteredResults.length).toBe(1)
      expect(result.current.filteredResults[0].id).toBe('initial')

      // Rerender with updated commands
      rerender({ commands: updatedCommands })

      // Should now show updated command
      expect(result.current.filteredResults.length).toBe(1)
      expect(result.current.filteredResults[0].id).toBe('updated')
    })
  })
})
