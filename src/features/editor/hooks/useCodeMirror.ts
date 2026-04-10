import { useEffect, useRef, useState, useCallback } from 'react'
import { EditorView, ViewUpdate, drawSelection } from '@codemirror/view'
import { EditorState, type Extension, Compartment } from '@codemirror/state'
import { vim } from '@replit/codemirror-vim'
import { catppuccinMocha } from '../theme/catppuccin'

export interface UseCodeMirrorOptions {
  initialContent: string
  language: Extension | null
  onSave: () => void
  onChange?: (content: string) => void
}

export interface UseCodeMirrorReturn {
  editorView: EditorView | null
  updateContent: (content: string) => void
  /** Callback ref — attach to the container div */
  setContainer: (node: HTMLDivElement | null) => void
}

/**
 * Hook to manage CodeMirror 6 EditorView instance with vim mode.
 * Returns a callback ref (`setContainer`) to attach to the editor container div.
 * The EditorView is created when the container mounts and destroyed when it unmounts.
 */
export function useCodeMirror(
  options: UseCodeMirrorOptions
): UseCodeMirrorReturn {
  const { initialContent, language, onSave, onChange } = options
  const [editorView, setEditorView] = useState<EditorView | null>(null)
  const onSaveRef = useRef(onSave)
  const onChangeRef = useRef(onChange)
  const initialContentRef = useRef(initialContent)

  // Keep refs up to date
  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    initialContentRef.current = initialContent
  }, [initialContent])

  const languageCompartment = useRef(new Compartment())
  const viewRef = useRef<EditorView | null>(null)

  // Callback ref — triggers when the container div mounts/unmounts
  const setContainer = useCallback((node: HTMLDivElement | null) => {
    // Destroy existing view if container changes
    if (viewRef.current) {
      viewRef.current.destroy()
      viewRef.current = null
      setEditorView(null)
    }

    if (!node) {
      return
    }

    const extensions: Extension[] = [
      vim(),
      drawSelection(),
      catppuccinMocha,
      languageCompartment.current.of([]),
      EditorView.updateListener.of((update: ViewUpdate) => {
        if (update.docChanged && onChangeRef.current) {
          const content = update.state.doc.toString()
          onChangeRef.current(content)
        }
      }),
    ]

    const state = EditorState.create({
      doc: initialContentRef.current,
      extensions,
    })

    const view = new EditorView({
      state,
      parent: node,
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

    viewRef.current = view
    setEditorView(view)

    // Ensure proper layout measurement and focus after mount
    requestAnimationFrame(() => {
      view.requestMeasure()
      view.focus()
    })
  }, [])

  // Clean up on unmount
  useEffect(
    () => (): void => {
      if (viewRef.current) {
        viewRef.current.destroy()
        viewRef.current = null
      }
    },
    []
  )

  // Update language when it changes (without recreating the editor)
  useEffect(() => {
    const view = viewRef.current
    if (!view) {
      return
    }

    view.dispatch({
      effects: languageCompartment.current.reconfigure(language ?? []),
    })
  }, [language])

  /**
   * Update the editor content programmatically.
   * Also focuses the editor after content update.
   */
  const updateContent = useCallback((content: string): void => {
    const view = viewRef.current
    if (!view) {
      return
    }

    const currentContent = view.state.doc.toString()
    if (currentContent === content) {
      return
    }

    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: content,
      },
    })

    // Focus editor after content load
    view.focus()
  }, [])

  return {
    editorView,
    updateContent,
    setContainer,
  }
}
