import { useEffect } from 'react'
import type { DiffFocusTarget } from '../types'

export interface UseDiffKeyboardOptions {
  focusTarget: DiffFocusTarget
  filesCount: number
  selectedFileIndex: number
  focusedHunkIndex: number
  focusedLineIndex: number
  totalHunks: number
  totalLinesInHunk: number
  onSelectFile: (index: number) => void
  onOpenFile: (index: number) => void
  onFocusHunk: (index: number) => void
  onFocusLine: (index: number) => void
  onStage: () => void
  onDiscard: () => void
  onToggleStagedFilter: () => void
  onSetFocusTarget: (target: DiffFocusTarget) => void
}

/**
 * Hook for lazygit-style keyboard navigation in the diff viewer
 * Handles j/k navigation, space to stage, d to discard, etc.
 */
export const useDiffKeyboard = (options: UseDiffKeyboardOptions): void => {
  const {
    focusTarget,
    filesCount,
    selectedFileIndex,
    focusedHunkIndex,
    focusedLineIndex,
    totalHunks,
    totalLinesInHunk,
    onSelectFile,
    onOpenFile,
    onFocusHunk,
    onFocusLine,
    onStage,
    onDiscard,
    onToggleStagedFilter,
    onSetFocusTarget,
  } = options

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      // Ignore keyboard events when focus is in input/textarea
      const target = event.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return
      }

      const key = event.key

      // Tab - toggle staged/unstaged filter (works in both focus modes)
      if (key === 'Tab') {
        event.preventDefault()
        onToggleStagedFilter()

        return
      }

      // File list focus mode
      if (focusTarget === 'fileList') {
        if (key === 'j' || key === 'ArrowDown') {
          event.preventDefault()
          const nextIndex = Math.min(selectedFileIndex + 1, filesCount - 1)
          onSelectFile(nextIndex)
        } else if (key === 'k' || key === 'ArrowUp') {
          event.preventDefault()
          const prevIndex = Math.max(selectedFileIndex - 1, 0)
          onSelectFile(prevIndex)
        } else if (key === 'Enter') {
          event.preventDefault()
          onOpenFile(selectedFileIndex)
          onSetFocusTarget('diffViewer')
        } else if (key === ' ') {
          event.preventDefault()
          onStage()
        } else if (key === 'd') {
          event.preventDefault()
          onDiscard()
        }
      } else {
        // Diff viewer focus mode
        if (key === 'j' || key === 'ArrowDown') {
          event.preventDefault()

          const nextLine = Math.min(focusedLineIndex + 1, totalLinesInHunk - 1)
          onFocusLine(nextLine)
        } else if (key === 'k' || key === 'ArrowUp') {
          event.preventDefault()
          const prevLine = Math.max(focusedLineIndex - 1, 0)
          onFocusLine(prevLine)
        } else if (key === 'ArrowLeft') {
          event.preventDefault()
          const prevHunk = Math.max(focusedHunkIndex - 1, 0)
          onFocusHunk(prevHunk)
        } else if (key === 'ArrowRight') {
          event.preventDefault()
          const nextHunk = Math.min(focusedHunkIndex + 1, totalHunks - 1)
          onFocusHunk(nextHunk)
        } else if (key === ' ') {
          event.preventDefault()
          onStage()
        } else if (key === 'd') {
          event.preventDefault()
          onDiscard()
        } else if (key === 'Escape') {
          event.preventDefault()
          onSetFocusTarget('fileList')
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return (): void => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [
    focusTarget,
    filesCount,
    selectedFileIndex,
    focusedHunkIndex,
    focusedLineIndex,
    totalHunks,
    totalLinesInHunk,
    onSelectFile,
    onOpenFile,
    onFocusHunk,
    onFocusLine,
    onStage,
    onDiscard,
    onToggleStagedFilter,
    onSetFocusTarget,
  ])
}
