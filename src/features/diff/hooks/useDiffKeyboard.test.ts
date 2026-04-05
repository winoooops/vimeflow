import { describe, test, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useDiffKeyboard, type UseDiffKeyboardOptions } from './useDiffKeyboard'

describe('useDiffKeyboard', () => {
  let mockHandlers: UseDiffKeyboardOptions

  beforeEach(() => {
    mockHandlers = {
      focusTarget: 'fileList',
      filesCount: 4,
      selectedFileIndex: 0,
      focusedHunkIndex: 0,
      focusedLineIndex: 0,
      totalHunks: 2,
      totalLinesInHunk: 10,
      onSelectFile: vi.fn(),
      onOpenFile: vi.fn(),
      onFocusHunk: vi.fn(),
      onFocusLine: vi.fn(),
      onStage: vi.fn(),
      onDiscard: vi.fn(),
      onToggleStagedFilter: vi.fn(),
      onSetFocusTarget: vi.fn(),
    }
  })

  describe('File List Focus Mode', () => {
    test('navigates down with j key', () => {
      renderHook(() => useDiffKeyboard(mockHandlers))

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }))

      expect(mockHandlers.onSelectFile).toHaveBeenCalledWith(1)
    })

    test('navigates down with ArrowDown key', () => {
      renderHook(() => useDiffKeyboard(mockHandlers))

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))

      expect(mockHandlers.onSelectFile).toHaveBeenCalledWith(1)
    })

    test('navigates up with k key', () => {
      mockHandlers.selectedFileIndex = 2

      renderHook(() => useDiffKeyboard(mockHandlers))

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }))

      expect(mockHandlers.onSelectFile).toHaveBeenCalledWith(1)
    })

    test('navigates up with ArrowUp key', () => {
      mockHandlers.selectedFileIndex = 2

      renderHook(() => useDiffKeyboard(mockHandlers))

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }))

      expect(mockHandlers.onSelectFile).toHaveBeenCalledWith(1)
    })

    test('clamps navigation at bottom', () => {
      mockHandlers.selectedFileIndex = 3 // last file

      renderHook(() => useDiffKeyboard(mockHandlers))

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }))

      expect(mockHandlers.onSelectFile).toHaveBeenCalledWith(3) // stays at 3
    })

    test('clamps navigation at top', () => {
      mockHandlers.selectedFileIndex = 0 // first file

      renderHook(() => useDiffKeyboard(mockHandlers))

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }))

      expect(mockHandlers.onSelectFile).toHaveBeenCalledWith(0) // stays at 0
    })

    test('opens file with Enter and switches focus', () => {
      mockHandlers.selectedFileIndex = 1

      renderHook(() => useDiffKeyboard(mockHandlers))

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))

      expect(mockHandlers.onOpenFile).toHaveBeenCalledWith(1)
      expect(mockHandlers.onSetFocusTarget).toHaveBeenCalledWith('diffViewer')
    })

    test('stages file with Space key', () => {
      renderHook(() => useDiffKeyboard(mockHandlers))

      document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))

      expect(mockHandlers.onStage).toHaveBeenCalled()
    })

    test('discards file with d key', () => {
      renderHook(() => useDiffKeyboard(mockHandlers))

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }))

      expect(mockHandlers.onDiscard).toHaveBeenCalled()
    })
  })

  describe('Diff Viewer Focus Mode', () => {
    beforeEach(() => {
      mockHandlers.focusTarget = 'diffViewer'
    })

    test('navigates down lines with j key', () => {
      renderHook(() => useDiffKeyboard(mockHandlers))

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }))

      expect(mockHandlers.onFocusLine).toHaveBeenCalledWith(1)
    })

    test('navigates down lines with ArrowDown key', () => {
      renderHook(() => useDiffKeyboard(mockHandlers))

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))

      expect(mockHandlers.onFocusLine).toHaveBeenCalledWith(1)
    })

    test('navigates up lines with k key', () => {
      mockHandlers.focusedLineIndex = 5

      renderHook(() => useDiffKeyboard(mockHandlers))

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }))

      expect(mockHandlers.onFocusLine).toHaveBeenCalledWith(4)
    })

    test('navigates up lines with ArrowUp key', () => {
      mockHandlers.focusedLineIndex = 5

      renderHook(() => useDiffKeyboard(mockHandlers))

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }))

      expect(mockHandlers.onFocusLine).toHaveBeenCalledWith(4)
    })

    test('navigates to previous hunk with ArrowLeft', () => {
      mockHandlers.focusedHunkIndex = 1

      renderHook(() => useDiffKeyboard(mockHandlers))

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))

      expect(mockHandlers.onFocusHunk).toHaveBeenCalledWith(0)
    })

    test('navigates to next hunk with ArrowRight', () => {
      renderHook(() => useDiffKeyboard(mockHandlers))

      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight' })
      )

      expect(mockHandlers.onFocusHunk).toHaveBeenCalledWith(1)
    })

    test('clamps hunk navigation at start', () => {
      mockHandlers.focusedHunkIndex = 0

      renderHook(() => useDiffKeyboard(mockHandlers))

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))

      expect(mockHandlers.onFocusHunk).toHaveBeenCalledWith(0) // stays at 0
    })

    test('clamps hunk navigation at end', () => {
      mockHandlers.focusedHunkIndex = 1 // last hunk (totalHunks = 2)

      renderHook(() => useDiffKeyboard(mockHandlers))

      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight' })
      )

      expect(mockHandlers.onFocusHunk).toHaveBeenCalledWith(1) // stays at 1
    })

    test('clamps line navigation at start', () => {
      mockHandlers.focusedLineIndex = 0

      renderHook(() => useDiffKeyboard(mockHandlers))

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }))

      expect(mockHandlers.onFocusLine).toHaveBeenCalledWith(0)
    })

    test('clamps line navigation at end', () => {
      mockHandlers.focusedLineIndex = 9 // last line (totalLinesInHunk = 10)

      renderHook(() => useDiffKeyboard(mockHandlers))

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }))

      expect(mockHandlers.onFocusLine).toHaveBeenCalledWith(9)
    })

    test('stages current hunk with Space key', () => {
      renderHook(() => useDiffKeyboard(mockHandlers))

      document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))

      expect(mockHandlers.onStage).toHaveBeenCalled()
    })

    test('discards current hunk with d key', () => {
      renderHook(() => useDiffKeyboard(mockHandlers))

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }))

      expect(mockHandlers.onDiscard).toHaveBeenCalled()
    })

    test('returns to file list with Escape', () => {
      renderHook(() => useDiffKeyboard(mockHandlers))

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

      expect(mockHandlers.onSetFocusTarget).toHaveBeenCalledWith('fileList')
    })
  })

  describe('Global Behaviors', () => {
    test('toggles staged filter with Tab key (file list mode)', () => {
      renderHook(() => useDiffKeyboard(mockHandlers))

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))

      expect(mockHandlers.onToggleStagedFilter).toHaveBeenCalled()
    })

    test('toggles staged filter with Tab key (diff viewer mode)', () => {
      mockHandlers.focusTarget = 'diffViewer'

      renderHook(() => useDiffKeyboard(mockHandlers))

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))

      expect(mockHandlers.onToggleStagedFilter).toHaveBeenCalled()
    })

    test('ignores keyboard events in input elements', () => {
      renderHook(() => useDiffKeyboard(mockHandlers))

      const input = document.createElement('input')
      document.body.appendChild(input)

      const event = new KeyboardEvent('keydown', { key: 'j', bubbles: true })
      Object.defineProperty(event, 'target', { value: input })

      input.dispatchEvent(event)

      expect(mockHandlers.onSelectFile).not.toHaveBeenCalled()

      document.body.removeChild(input)
    })

    test('ignores keyboard events in textarea elements', () => {
      renderHook(() => useDiffKeyboard(mockHandlers))

      const textarea = document.createElement('textarea')
      document.body.appendChild(textarea)

      const event = new KeyboardEvent('keydown', { key: 'j', bubbles: true })
      Object.defineProperty(event, 'target', { value: textarea })

      textarea.dispatchEvent(event)

      expect(mockHandlers.onSelectFile).not.toHaveBeenCalled()

      document.body.removeChild(textarea)
    })
  })

  describe('Cleanup', () => {
    test('removes event listener on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')

      const { unmount } = renderHook(() => useDiffKeyboard(mockHandlers))

      unmount()

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'keydown',
        expect.any(Function)
      )

      removeEventListenerSpy.mockRestore()
    })
  })
})
