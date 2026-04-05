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

      // File list focus mode
      if (focusTarget === 'fileList') {
        if (key === 'j' || key === 'ArrowDown') {
          event.preventDefault()
          if (filesCount > 0) {
            const nextIndex = Math.min(selectedFileIndex + 1, filesCount - 1)
            onSelectFile(nextIndex)
          }
        } else if (key === 'k' || key === 'ArrowUp') {
          event.preventDefault()
          if (filesCount > 0) {
            const prevIndex = Math.max(selectedFileIndex - 1, 0)
            onSelectFile(prevIndex)
          }
        } else if (key === 'Enter') {
          event.preventDefault()
          if (filesCount > 0) {
            onOpenFile(selectedFileIndex)
            onSetFocusTarget('diffViewer')
          }
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
          if (totalLinesInHunk > 0) {
            const nextLine = Math.min(
              focusedLineIndex + 1,
              totalLinesInHunk - 1
            )
            onFocusLine(nextLine)
          }
        } else if (key === 'k' || key === 'ArrowUp') {
          event.preventDefault()
          if (totalLinesInHunk > 0) {
            const prevLine = Math.max(focusedLineIndex - 1, 0)
            onFocusLine(prevLine)
          }
        } else if (key === 'ArrowLeft') {
          event.preventDefault()
          if (totalHunks > 0) {
            const prevHunk = Math.max(focusedHunkIndex - 1, 0)
            onFocusHunk(prevHunk)
          }
        } else if (key === 'ArrowRight') {
          event.preventDefault()
          if (totalHunks > 0) {
            const nextHunk = Math.min(focusedHunkIndex + 1, totalHunks - 1)
            onFocusHunk(nextHunk)
          }
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
