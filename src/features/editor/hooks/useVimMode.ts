import { useEffect, useState } from 'react'
import type { EditorView } from '@codemirror/view'

export type VimMode = 'NORMAL' | 'INSERT' | 'VISUAL' | 'COMMAND' | null

/**
 * Hook to track the current vim mode from a CodeMirror EditorView
 *
 * @param editorView - The CodeMirror EditorView instance with vim mode enabled
 * @returns The current vim mode as a string, or null if no editor
 */
export function useVimMode(editorView: EditorView | null): VimMode {
  const [vimMode, setVimMode] = useState<VimMode>(
    editorView ? getVimMode(editorView) : null
  )

  useEffect(() => {
    if (!editorView) {
      setVimMode(null)

      return
    }

    // Set initial mode
    setVimMode(getVimMode(editorView))

    // Poll for mode changes (vim doesn't provide events for mode changes)
    // We check every 100ms which is fast enough for UI updates but not too CPU intensive
    const interval = setInterval(() => {
      const currentMode = getVimMode(editorView)

      setVimMode(currentMode)
    }, 100)

    return (): void => {
      clearInterval(interval)
    }
  }, [editorView])

  return vimMode
}

/**
 * Extract the current vim mode from an EditorView instance
 *
 * @param editorView - The CodeMirror EditorView instance
 * @returns The current vim mode
 */
function getVimMode(editorView: EditorView): VimMode {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
  const cm = (editorView as any).cm

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (!cm?.vim) {
    return 'NORMAL' // Default to NORMAL if vim is not available
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
  const vimState = cm.vim

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (!vimState.mode) {
    return 'NORMAL'
  }

  // The vim state mode can be: 'normal', 'insert', 'visual', 'replace', etc.
  // We normalize to uppercase for consistency
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const mode = String(vimState.mode).toUpperCase()

  // Map vim modes to our VimMode type
  if (mode === 'NORMAL') {
    return 'NORMAL'
  }

  if (mode === 'INSERT') {
    return 'INSERT'
  }

  if (mode === 'VISUAL' || mode === 'VISUAL LINE' || mode === 'VISUAL BLOCK') {
    return 'VISUAL'
  }

  if (mode === 'COMMAND' || mode === 'EX') {
    return 'COMMAND'
  }

  // Default to NORMAL for unknown modes
  return 'NORMAL'
}
