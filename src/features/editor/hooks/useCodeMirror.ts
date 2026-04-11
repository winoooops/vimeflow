import { useEffect, useRef, useState, useCallback } from 'react'
import { EditorView, ViewUpdate, drawSelection } from '@codemirror/view'
import {
  EditorState,
  type Extension,
  type Transaction,
  type TransactionSpec,
  Compartment,
} from '@codemirror/state'
import { history } from '@codemirror/commands'
import { vim, Vim } from '@replit/codemirror-vim'
import { catppuccinMocha } from '../theme/catppuccin'

/**
 * Scroll the viewport to follow the cursor on any PURE-selection change
 * (no doc mutation). This is what enables vim NORMAL-mode scroll-follow
 * for `j/k/G/gg/Ctrl-d/etc.`, but it also fires for mouse clicks that
 * move the cursor, arrow-key navigation, and programmatic selection
 * changes from other extensions. That's deliberately inclusive — every
 * such transaction is a cursor move that the user expects the viewport
 * to follow, and CM6 has no general-purpose "vim-only" transaction
 * marker we could gate on.
 *
 * Exported so it can be unit-tested in isolation without having to
 * measure `scrollTop` inside jsdom (jsdom doesn't lay out the DOM, so
 * DOM-level scroll position is unobservable in tests).
 *
 * Why transactionExtender instead of updateListener: the scroll effect
 * rides on the SAME transaction as the selection change, so CodeMirror
 * sees one atomic update (selection moved + scrollIntoView) and its
 * measure pass always reflects the new cursor position. Dispatching
 * from an update listener ran after CM had already measured with stale
 * cursor coordinates, producing the "scrolls exactly one row then
 * silently no-ops forever" bug that motivated this fix.
 *
 * Why `!tr.selection || tr.docChanged` guard: we only want to intercept
 * pure-selection changes. Doc changes (insert-mode typing) already hit
 * CodeMirror's built-in scroll path, and effect-only dispatches
 * (language reconfiguration, scroll dispatches from elsewhere) aren't
 * selection moves — skipping both keeps us from clobbering existing
 * scroll behavior or double-scrolling.
 *
 * Why `y: 'nearest'`: matches native vim. Only scrolls when the cursor
 * actually leaves the viewport, so short in-viewport motions don't
 * recenter the buffer on every keystroke. Also harmless for mouse
 * clicks and arrow-key moves that stay in view.
 */
export const scrollCursorOnSelectionChange = (
  tr: Transaction
): TransactionSpec | null => {
  if (!tr.selection || tr.docChanged) {
    return null
  }

  return {
    effects: EditorView.scrollIntoView(tr.newSelection.main.head, {
      y: 'nearest',
    }),
  }
}

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

  // Update `initialContentRef` synchronously during render (not via
  // useEffect). `setContainer` runs during the commit phase when React
  // attaches the newly rendered div — if we deferred the ref update
  // until after commit, the first-file-open path would read the prior
  // value (empty string) and create the EditorView with an empty doc
  // for one frame before updateContent filled it in, producing a
  // visible flash. Ref mutations during render are allowed for this
  // "latest value" pattern — unlike setState, they don't trigger a
  // re-render.
  initialContentRef.current = initialContent

  // onSave / onChange aren't read synchronously during render, so they
  // can use the normal effect-based ref update pattern.
  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

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
      // history() is NOT included by default in CodeMirror 6 — it must
      // be explicitly added. The vim extension's `u` / `ctrl-r` handlers
      // delegate to CodeMirror's `undo()` / `redo()` commands, which
      // silently return `false` when no HistoryField exists in the
      // state. Without this extension, vim undo in NORMAL mode is a
      // silent no-op — every user discovers it on their first typo.
      history(),
      drawSelection(),
      catppuccinMocha,
      languageCompartment.current.of([]),
      EditorView.updateListener.of((update: ViewUpdate) => {
        if (update.docChanged && onChangeRef.current) {
          const content = update.state.doc.toString()
          onChangeRef.current(content)
        }
      }),
      // Scroll the viewport to follow the cursor on any pure-selection
      // transaction. This is what enables vim NORMAL-mode scroll-follow
      // (j/k/G/gg/Ctrl-d/etc.) but also covers mouse clicks and arrow
      // keys. See `scrollCursorOnSelectionChange` above for the full
      // rationale (why transactionExtender vs updateListener, why
      // `y: 'nearest'`, etc.).
      EditorState.transactionExtender.of(scrollCursorOnSelectionChange),
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
