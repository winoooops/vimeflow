import { useEffect, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { getCM } from '@replit/codemirror-vim'

export type VimMode = 'NORMAL' | 'INSERT' | 'VISUAL' | 'COMMAND' | null

const normalizeMode = (mode: string): VimMode => {
  const upper = mode.toUpperCase()
  if (upper === 'NORMAL') {
    return 'NORMAL'
  }
  if (upper === 'INSERT' || upper === 'REPLACE') {
    return 'INSERT'
  }
  if (upper.startsWith('VISUAL')) {
    return 'VISUAL'
  }
  if (upper === 'COMMAND' || upper === 'EX') {
    return 'COMMAND'
  }

  return 'NORMAL'
}

/**
 * Hook to track the current vim mode from a CodeMirror EditorView.
 * Uses the vim extension's 'vim-mode-change' event for reliable tracking.
 */
export function useVimMode(editorView: EditorView | null): VimMode {
  const [vimMode, setVimMode] = useState<VimMode>(null)

  useEffect(() => {
    if (!editorView) {
      setVimMode(null)

      return
    }

    const cm = getCM(editorView)
    if (!cm) {
      setVimMode('NORMAL')

      return
    }

    // Set initial mode
    setVimMode('NORMAL')

    // Listen for vim mode changes via the CM event system
    const handleModeChange = (e: { mode: string; subMode?: string }): void => {
      setVimMode(normalizeMode(e.mode))
    }

    cm.on('vim-mode-change', handleModeChange)

    return (): void => {
      cm.off('vim-mode-change', handleModeChange)
    }
  }, [editorView])

  return vimMode
}
