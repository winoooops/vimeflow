import { useEffect, useRef, useState } from 'react'
import { EditorView, ViewUpdate } from '@codemirror/view'
import { EditorState, type Extension } from '@codemirror/state'
import { vim } from '@replit/codemirror-vim'
import { catppuccinMocha } from '../theme/catppuccin'
import type { RefObject } from 'react'

export interface UseCodeMirrorOptions {
  containerRef: RefObject<HTMLDivElement>
  initialContent: string
  language: Extension | null
  onSave: () => void
  onChange?: (content: string) => void
}

export interface UseCodeMirrorReturn {
  editorView: EditorView | null
  updateContent: (content: string) => void
}

/**
 * Hook to manage CodeMirror 6 EditorView instance with vim mode
 *
 * @param options - Configuration for the editor
 * @returns Editor view instance and content update function
 */
export function useCodeMirror(
  options: UseCodeMirrorOptions
): UseCodeMirrorReturn {
  const { containerRef, initialContent, language, onSave, onChange } = options
  const [editorView, setEditorView] = useState<EditorView | null>(null)
  const onSaveRef = useRef(onSave)
  const onChangeRef = useRef(onChange)

  // Keep onSave callback ref up to date
  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  // Keep onChange callback ref up to date
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    const container = containerRef.current

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!container) {
      setEditorView(null)

      return
    }

    // Build extensions array
    const extensions: Extension[] = [vim(), catppuccinMocha]

    // Add language extension if provided
    if (language) {
      extensions.push(language)
    }

    // Add onChange listener if provided
    if (onChangeRef.current) {
      extensions.push(
        EditorView.updateListener.of((update: ViewUpdate) => {
          if (update.docChanged && onChangeRef.current) {
            const content = update.state.doc.toString()
            onChangeRef.current(content)
          }
        })
      )
    }

    // Create editor state
    const state = EditorState.create({
      doc: initialContent,
      extensions,
    })

    // Create editor view
    const view = new EditorView({
      state,
      parent: container,
    })

    // Configure vim :w command to call onSave
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const cm = (view as any).cm

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (cm?.vim) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      cm.vim.defineEx('write', 'w', () => {
        onSaveRef.current()
      })
    }

    setEditorView(view)

    // Cleanup on unmount
    return (): void => {
      view.destroy()
      setEditorView(null)
    }
  }, [containerRef, initialContent, language])

  /**
   * Update the editor content programmatically
   */
  const updateContent = (content: string): void => {
    if (!editorView) {
      return
    }

    const transaction = editorView.state.update({
      changes: {
        from: 0,
        to: editorView.state.doc.length,
        insert: content,
      },
    })

    editorView.dispatch(transaction)
  }

  return {
    editorView,
    updateContent,
  }
}
