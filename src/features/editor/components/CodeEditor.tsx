import type { ReactElement } from 'react'
import { useEffect, useMemo } from 'react'
import { useCodeMirror } from '../hooks/useCodeMirror'
import { useVimMode } from '../hooks/useVimMode'
import { VimStatusBar } from './VimStatusBar'
import { getLanguageExtension } from '../services/languageService'

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
}

export const CodeEditor = ({
  filePath,
  content,
  onContentChange = undefined,
  onSave = undefined,
  isDirty = false,
}: CodeEditorProps): ReactElement => {
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

  const { editorView, updateContent, setContainer } = useCodeMirror({
    initialContent: content,
    language,
    onSave: handleSave,
    onChange: onContentChange,
  })

  const vimMode = useVimMode(editorView)

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
    return (
      <div
        className="flex flex-1 items-center justify-center text-on-surface-variant"
        data-testid="no-file-selected"
      >
        No file selected
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div
        ref={setContainer}
        data-testid="codemirror-container"
        className="flex-1 overflow-hidden"
      />
      <VimStatusBar vimMode={vimMode} isDirty={isDirty} />
    </div>
  )
}
