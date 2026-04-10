import { useEffect, useRef, useState, useCallback } from 'react'
import { EditorView, ViewUpdate, drawSelection } from '@codemirror/view'
import { EditorState, type Extension, Compartment } from '@codemirror/state'
import { vim, Vim } from '@replit/codemirror-vim'
import { catppuccinMocha } from '../theme/catppuccin'

// `Vim.defineEx` writes into a GLOBAL registry shared across every
// `@replit/codemirror-vim` instance in the process. Register it exactly
// once at module load and route each `:w` invocation to the save
// callback of the EDITOR VIEW that issued it, looked up in a per-view
// WeakMap.
//
// This is safe for split-pane / multi-editor layouts: editor A's `:w`
// always saves editor A, editor B's `:w` always saves editor B, and
// unmounting editor B never interferes with editor A's save. The
// previous "single active slot" design silently routed the wrong
// editor's save callback in multi-editor layouts — a data-loss hazard.
//
// The vim extension's ex-command callback receives the CodeMirror 5
// wrapper, which exposes the backing EditorView as `cm.cm6`. We look
// that view up in the WeakMap to find the right save callback.
const vimSaveByView = new WeakMap<EditorView, () => void>()
let vimWriteRegistered = false

const registerVimWriteOnce = (): void => {
  if (vimWriteRegistered) {
    return
  }
  vimWriteRegistered = true
  Vim.defineEx('write', 'w', (cm: unknown) => {
    const view = (cm as { cm6?: EditorView } | null)?.cm6
    if (!view) {
      return
    }
    vimSaveByView.get(view)?.()
  })
}

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
      vimSaveByView.delete(viewRef.current)
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

    // Register the global :w handler once at module scope, then bind
    // THIS view's save callback to the per-view WeakMap so `:w` in this
    // editor always calls this editor's onSave — even when multiple
    // editors are mounted at once.
    registerVimWriteOnce()
    vimSaveByView.set(view, () => {
      onSaveRef.current()
    })

    viewRef.current = view
    setEditorView(view)

    // Ensure proper layout measurement and focus after mount.
    // Guard against the view being destroyed before the frame fires
    // (hot reload, Strict Mode double-invoke, rapid tab switch) by
    // confirming `viewRef.current` is still this same view.
    requestAnimationFrame(() => {
      if (viewRef.current !== view) {
        return
      }
      view.requestMeasure()
      view.focus()
    })
  }, [])

  // Clean up on unmount
  useEffect(
    () => (): void => {
      if (viewRef.current) {
        vimSaveByView.delete(viewRef.current)
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
