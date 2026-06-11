// cspell:ignore keymap Prec
import { useEffect, useRef, useState, useCallback } from 'react'
import {
  EditorView,
  ViewPlugin,
  ViewUpdate,
  drawSelection,
  keymap,
} from '@codemirror/view'
import {
  EditorState,
  EditorSelection,
  Prec,
  type SelectionRange,
  type Extension,
  Transaction,
  type TransactionSpec,
  Compartment,
} from '@codemirror/state'
import { history } from '@codemirror/commands'
import { vim, Vim, getCM } from '@replit/codemirror-vim'
import { themeService } from '../../../theme'
import { createEditorTheme } from '../theme/editorTheme'

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
  if (!tr.selection || tr.docChanged || tr.isUserEvent('select.all')) {
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
  shouldAutoFocus?: boolean
}

export interface UseCodeMirrorReturn {
  editorView: EditorView | null
  updateContent: (content: string) => void
  copySelection: () => Promise<void>
  cutSelection: () => Promise<void>
  pasteClipboard: () => Promise<void>
  selectAll: () => void
  /** Callback ref — attach to the container div */
  setContainer: (node: HTMLDivElement | null) => void
}

interface ClipboardLike {
  readText?: () => Promise<string>
  writeText?: (text: string) => Promise<void>
}

const selectedTextFromState = (state: EditorState): string =>
  state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => state.sliceDoc(range.from, range.to))
    .join('\n')

const hasSelection = (state: EditorState): boolean =>
  state.selection.ranges.some((range) => !range.empty)

const deletionForRange = (
  range: SelectionRange
): {
  changes: { from: number; to: number; insert: string }
  range: SelectionRange
} => ({
  changes: { from: range.from, to: range.to, insert: '' },
  range: EditorSelection.cursor(range.from),
})

const writeViaTextarea = (text: string): boolean => {
  const execCommand = (
    document as unknown as {
      execCommand?: (command: string) => boolean
    }
  ).execCommand
  if (typeof execCommand !== 'function') {
    return false
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  textarea.select()

  try {
    return execCommand.call(document, 'copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
  }
}

const writeClipboardText = async (text: string): Promise<boolean> => {
  if (text === '') {
    return false
  }

  const clipboard = window.navigator.clipboard as ClipboardLike | undefined

  try {
    if (clipboard?.writeText === undefined) {
      return writeViaTextarea(text)
    }

    await clipboard.writeText(text)

    return true
  } catch {
    return writeViaTextarea(text)
  }
}

const copySelectionFromView = async (view: EditorView): Promise<void> => {
  await writeClipboardText(selectedTextFromState(view.state))
  view.focus()
}

const cutSelectionFromView = async (view: EditorView): Promise<void> => {
  const state = view.state
  if (!hasSelection(state)) {
    return
  }

  const copied = await writeClipboardText(selectedTextFromState(state))
  if (!copied || view.state !== state) {
    return
  }

  view.dispatch(state.changeByRange(deletionForRange))
  view.focus()
}

const pasteClipboardIntoView = async (view: EditorView): Promise<void> => {
  const state = view.state
  const clipboard = window.navigator.clipboard as ClipboardLike | undefined
  if (clipboard?.readText === undefined) {
    return
  }

  try {
    const text = await clipboard.readText()
    if (text === '') {
      return
    }

    if (view.state !== state) {
      return
    }

    view.dispatch(state.replaceSelection(text))
    view.focus()
  } catch {
    // Clipboard permission failures should not bubble out of key bindings.
  }
}

const selectAllInView = (view: EditorView): void => {
  view.dispatch({
    selection: EditorSelection.single(0, view.state.doc.length),
    annotations: Transaction.userEvent.of('select.all'),
  })
  view.focus()
}

const isMacPlatform = (): boolean =>
  window.navigator.platform.toLowerCase().includes('mac')

const isPlatformPasteShortcut = (event: KeyboardEvent): boolean => {
  if (event.key.toLowerCase() !== 'v' || event.altKey || event.shiftKey) {
    return false
  }

  return isMacPlatform()
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey
}

const nativePasteShortcutBypass = ViewPlugin.fromClass(
  class {
    private readonly view: EditorView

    private readonly onKeydown = (event: KeyboardEvent): void => {
      if (!isPlatformPasteShortcut(event)) {
        return
      }

      const cm = getCM(this.view)
      if (!cm?.state.vim?.insertMode) {
        return
      }

      event.stopImmediatePropagation()
    }

    constructor(view: EditorView) {
      this.view = view
      this.view.contentDOM.addEventListener('keydown', this.onKeydown, true)
    }

    destroy(): void {
      this.view.contentDOM.removeEventListener('keydown', this.onKeydown, true)
    }
  }
)

// Vim y/p keep codemirror-vim registers; platform edit commands use the OS clipboard.
const editorClipboardKeymap = Prec.highest(
  keymap.of([
    {
      key: 'Mod-c',
      run: (view: EditorView): boolean => {
        if (!hasSelection(view.state)) {
          return false
        }

        void copySelectionFromView(view)

        return true
      },
    },
    {
      key: 'Mod-x',
      run: (view: EditorView): boolean => {
        if (!hasSelection(view.state)) {
          return false
        }

        void cutSelectionFromView(view)

        return true
      },
    },
    {
      key: 'Mod-a',
      run: (view: EditorView): boolean => {
        if (isMacPlatform()) {
          selectAllInView(view)

          return true
        }

        const cm = getCM(view)
        const isVimInsert = cm?.state.vim?.insertMode === true

        // On non-Mac, preserve Vim normal-mode Ctrl+A (increment), but
        // provide select-all in insert mode where users expect standard
        // platform shortcuts.
        if (isVimInsert) {
          selectAllInView(view)

          return true
        }

        return false
      },
    },
  ])
)

/**
 * Hook to manage CodeMirror 6 EditorView instance with vim mode.
 * Returns a callback ref (`setContainer`) to attach to the editor container div.
 * The EditorView is created when the container mounts and destroyed when it unmounts.
 */
export function useCodeMirror(
  options: UseCodeMirrorOptions
): UseCodeMirrorReturn {
  const { initialContent, language, onSave, onChange, shouldAutoFocus } =
    options
  const [editorView, setEditorView] = useState<EditorView | null>(null)
  const onSaveRef = useRef(onSave)
  const onChangeRef = useRef(onChange)
  const initialContentRef = useRef(initialContent)
  const shouldAutoFocusRef = useRef(shouldAutoFocus ?? false)

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
  shouldAutoFocusRef.current = shouldAutoFocus ?? false

  // onSave / onChange aren't read synchronously during render, so they
  // can use the normal effect-based ref update pattern.
  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const languageCompartment = useRef(new Compartment())
  const themeCompartment = useRef(new Compartment())
  const themeUnsubscribeRef = useRef<(() => void) | null>(null)
  const viewRef = useRef<EditorView | null>(null)

  // Callback ref — triggers when the container div mounts/unmounts
  const setContainer = useCallback((node: HTMLDivElement | null) => {
    // Destroy existing view if container changes
    if (viewRef.current) {
      themeUnsubscribeRef.current?.()
      themeUnsubscribeRef.current = null
      vimSaveByView.delete(viewRef.current)
      viewRef.current.destroy()
      viewRef.current = null
      setEditorView(null)
    }

    if (!node) {
      return
    }

    const extensions: Extension[] = [
      nativePasteShortcutBypass,
      editorClipboardKeymap,
      vim(),
      // history() is NOT included by default in CodeMirror 6 — it must
      // be explicitly added. The vim extension's `u` / `ctrl-r` handlers
      // delegate to CodeMirror's `undo()` / `redo()` commands, which
      // silently return `false` when no HistoryField exists in the
      // state. Without this extension, vim undo in NORMAL mode is a
      // silent no-op — every user discovers it on their first typo.
      history(),
      drawSelection(),
      themeCompartment.current.of(
        createEditorTheme(themeService.current().kind)
      ),
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

    themeUnsubscribeRef.current = themeService.subscribe((theme) => {
      view.dispatch({
        effects: themeCompartment.current.reconfigure(
          createEditorTheme(theme.kind)
        ),
      })
    })

    // Ensure proper layout measurement and focus after mount.
    // Guard against the view being destroyed before the frame fires
    // (hot reload, Strict Mode double-invoke, rapid tab switch) by
    // confirming `viewRef.current` is still this same view.
    requestAnimationFrame(() => {
      if (viewRef.current !== view) {
        return
      }
      view.requestMeasure()
      // Guard with hasFocus: the synchronous useLayoutEffect path in
      // WorkspaceView may have already focused the editor in the same
      // commit cycle. Without this guard, the RAF fires ~16ms later and
      // steals focus back from any panel that gained it in between.
      if (shouldAutoFocusRef.current && !view.hasFocus) {
        view.focus()
      }
    })
  }, [])

  // Clean up on unmount
  useEffect(
    () => (): void => {
      if (viewRef.current) {
        themeUnsubscribeRef.current?.()
        themeUnsubscribeRef.current = null
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
    if (shouldAutoFocusRef.current) {
      view.focus()
    }
  }, [])

  const copySelection = useCallback(async (): Promise<void> => {
    const view = viewRef.current
    if (!view) {
      return
    }

    await copySelectionFromView(view)
  }, [])

  const cutSelection = useCallback(async (): Promise<void> => {
    const view = viewRef.current
    if (!view) {
      return
    }

    await cutSelectionFromView(view)
  }, [])

  const pasteClipboard = useCallback(async (): Promise<void> => {
    const view = viewRef.current
    if (!view) {
      return
    }

    await pasteClipboardIntoView(view)
  }, [])

  const selectAll = useCallback((): void => {
    const view = viewRef.current
    if (!view) {
      return
    }

    selectAllInView(view)
  }, [])

  return {
    editorView,
    updateContent,
    copySelection,
    cutSelection,
    pasteClipboard,
    selectAll,
    setContainer,
  }
}
