/* eslint-disable react/require-default-props */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  type ReactElement,
  type MouseEvent,
} from 'react'
import { useCodeMirror } from '../hooks/useCodeMirror'
import { useVimMode } from '../hooks/useVimMode'
import { VimStatusBar } from './VimStatusBar'
import { getLanguageExtension } from '../services/languageService'
import { ContextMenu } from './ContextMenu'
import type { ContextMenuAction } from '../types'

interface CodeEditorProps {
  filePath: string | null
  /**
   * Current file content. Sourced from the single owning buffer
   * (`useEditorBuffer.currentContent` in `WorkspaceView`). CodeEditor is a
   * presentational wrapper — it does NOT fetch files itself. This avoids
   * the double-read race where CodeEditor and useEditorBuffer each called
   * `fileSystemService.readFile` independently and occasionally disagreed,
   * which manifested as spurious dirty state.
   */
  content: string
  onContentChange?: (content: string) => void
  onSave?: () => void
  isDirty?: boolean
  /** Render a loading overlay while an async file read is in flight. */
  isLoading?: boolean
  shouldAutoFocus?: boolean
}

export interface CodeEditorHandle {
  /** Returns true if editorView focused, false if no file is loaded. */
  focus(): boolean
}

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
}

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(
  function CodeEditor(
    {
      filePath,
      content,
      onContentChange = undefined,
      onSave = undefined,
      isDirty = false,
      isLoading = false,
      shouldAutoFocus = false,
    }: CodeEditorProps,
    ref
  ): ReactElement {
    // Language extension is driven off the filename only. Memoize on
    // `fileName` so typing (which re-renders via onContentChange) does
    // NOT rebuild the language extension every keystroke — an non-memoized
    // call would hand a fresh Extension object to useCodeMirror's
    // language-update effect on every render, triggering a full
    // Compartment.reconfigure() per keypress and visibly flickering
    // syntax highlighting as the parser restarted from scratch.
    const fileName = filePath ? (filePath.split('/').pop() ?? '') : ''

    const language = useMemo(
      () => (fileName ? getLanguageExtension(fileName) : null),
      [fileName]
    )

    // `onSave` is required for vim :w to work. CodeEditor used to fall back
    // to writing via a stashed fileSystemService if the caller forgot to
    // pass onSave, but that path silently swallowed write errors and
    // bypassed the error-surfacing improvements in WorkspaceView. We now
    // require the caller to own the save lifecycle.
    const handleSave = (): void => {
      onSave?.()
    }

    const {
      editorView,
      updateContent,
      copySelection,
      cutSelection,
      pasteClipboard,
      selectAll,
      setContainer,
    } = useCodeMirror({
      initialContent: content,
      language,
      onSave: handleSave,
      onChange: onContentChange,
      shouldAutoFocus,
    })

    const vimMode = useVimMode(editorView)

    const [contextMenu, setContextMenu] = useState<ContextMenuState>({
      visible: false,
      x: 0,
      y: 0,
    })

    const closeContextMenu = useCallback((): void => {
      setContextMenu({ visible: false, x: 0, y: 0 })
    }, [])

    // Keep the fixed-size context menu inside the viewport so right-clicks
    // near the right/bottom edge don't place actions off-screen.
    const MENU_WIDTH = 192
    const MENU_HEIGHT = 192

    const handleContextMenu = useCallback(
      (event: MouseEvent<HTMLDivElement>): void => {
        event.preventDefault()
        event.stopPropagation()

        if (editorView) {
          editorView.focus()
          const pos = editorView.posAtCoords({
            x: event.clientX,
            y: event.clientY,
          })
          if (pos !== null) {
            const insideExistingSelection = editorView.state.selection.ranges.some(
              (range) =>
                !range.empty && range.from <= pos && pos <= range.to
            )
            if (!insideExistingSelection) {
              editorView.dispatch({
                selection: { anchor: pos, head: pos },
              })
            }
          }
        }

        const x = Math.max(
          0,
          Math.min(event.clientX, window.innerWidth - MENU_WIDTH)
        )

        const y = Math.max(
          0,
          Math.min(event.clientY, window.innerHeight - MENU_HEIGHT)
        )
        setContextMenu({
          visible: true,
          x,
          y,
        })
      },
      [editorView]
    )

    const clipboardActions = useMemo<ContextMenuAction[]>(
      () => [
        {
          label: 'Copy',
          icon: 'content_copy',
          onSelect: (): void => {
            void copySelection()
          },
        },
        {
          label: 'Cut',
          icon: 'content_cut',
          onSelect: (): void => {
            void cutSelection()
          },
        },
        {
          label: 'Paste',
          icon: 'content_paste',
          onSelect: (): void => {
            void pasteClipboard()
          },
        },
        {
          label: 'Select All',
          icon: 'select_all',
          onSelect: selectAll,
        },
      ],
      [copySelection, cutSelection, pasteClipboard, selectAll]
    )

    useImperativeHandle(ref, () => ({
      focus(): boolean {
        if (!filePath || !editorView) {
          return false
        }

        editorView.focus()

        return true
      },
    }))

    // Push prop content into CodeMirror whenever the caller updates it
    // (e.g. a new file is opened and `useEditorBuffer` swaps the buffer
    // content). `updateContent` no-ops when the CodeMirror doc already
    // matches, so echo-back from user edits (typing → onContentChange →
    // buffer state → content prop → updateContent) does not loop.
    useEffect(() => {
      if (filePath === null) {
        return
      }

      updateContent(content)
    }, [content, filePath, updateContent])

    if (!filePath) {
      // `min-h-0` matches the invariant the main return path establishes:
      // every flex child in CodeEditor must be prevented from growing
      // past its bounded parent. No visible bug today because the
      // placeholder is trivially short, but keeping the invariant
      // consistent across both branches means a future richer placeholder
      // (file picker, tips widget, animated illustration) won't silently
      // reintroduce the flex `min-height: auto` scroll bug.
      return (
        <div
          className="flex min-h-0 flex-1 items-center justify-center text-on-surface-variant"
          data-testid="no-file-selected"
        >
          No file selected
        </div>
      )
    }

    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div
            ref={setContainer}
            data-testid="codemirror-container"
            className="h-full w-full"
            onContextMenu={handleContextMenu}
          />
          {isLoading && (
            <div
              role="status"
              aria-live="polite"
              aria-label="Loading file"
              data-testid="code-editor-loading"
              className="absolute inset-0 flex items-center justify-center bg-surface/70 backdrop-blur-sm z-10"
            >
              <div className="flex items-center gap-2 text-sm text-on-surface-variant font-inter">
                <span className="material-symbols-outlined animate-spin text-base">
                  progress_activity
                </span>
                <span>Loading…</span>
              </div>
            </div>
          )}
        </div>
        <VimStatusBar vimMode={vimMode} isDirty={isDirty} />
        <ContextMenu
          visible={contextMenu.visible}
          x={contextMenu.x}
          y={contextMenu.y}
          actions={clipboardActions}
          onClose={closeContextMenu}
        />
      </div>
    )
  }
)
