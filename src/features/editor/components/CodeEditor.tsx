import type { ReactElement } from 'react'
import { useEffect, useState } from 'react'
import type { IFileSystemService } from '../../files/services/fileSystemService'
import { useCodeMirror } from '../hooks/useCodeMirror'
import { useVimMode } from '../hooks/useVimMode'
import { VimStatusBar } from './VimStatusBar'
import { getLanguageExtension } from '../services/languageService'

interface CodeEditorProps {
  filePath: string | null
  fileSystemService: IFileSystemService
  onContentChange?: (content: string) => void
  onSave?: () => void
  isDirty?: boolean
}

export const CodeEditor = ({
  filePath,
  fileSystemService,
  onContentChange = undefined,
  onSave = undefined,
  isDirty = false,
}: CodeEditorProps): ReactElement => {
  const [fileContent, setFileContent] = useState<string>('')
  const [loadedFilePath, setLoadedFilePath] = useState<string | null>(null)

  // Load file when filePath changes.
  //
  // A `cancelled` flag guards against out-of-order async responses: if the
  // user clicks file A and then quickly clicks file B, a slow A read that
  // resolves *after* B would otherwise overwrite B's content and cause
  // subsequent edits to apply to the wrong file. The cleanup function sets
  // the flag so stale completions become no-ops.
  useEffect(() => {
    if (!filePath) {
      setFileContent('')
      setLoadedFilePath(null)

      return
    }

    let cancelled = false

    const loadFile = async (): Promise<void> => {
      try {
        const content = await fileSystemService.readFile(filePath)
        if (cancelled) {
          return
        }
        setFileContent(content)
        setLoadedFilePath(filePath)
      } catch (error: unknown) {
        if (cancelled) {
          return
        }
        // eslint-disable-next-line no-console
        console.error('Failed to load file:', error)
      }
    }

    void loadFile()

    return (): void => {
      cancelled = true
    }
  }, [filePath, fileSystemService])

  // Get language extension from filename
  const fileName = filePath ? (filePath.split('/').pop() ?? '') : ''
  const language = fileName ? getLanguageExtension(fileName) : null

  // Setup CodeMirror with vim mode
  const { editorView, updateContent, setContainer } = useCodeMirror({
    initialContent: fileContent,
    language,
    onSave: () => {
      if (onSave) {
        onSave()
      } else if (loadedFilePath && editorView) {
        const currentContent = editorView.state.doc.toString()
        void fileSystemService.writeFile(loadedFilePath, currentContent)
      }
    },
    onChange: onContentChange,
  })

  // Track vim mode
  const vimMode = useVimMode(editorView)

  // Update editor content when file content changes.
  // Gate on `loadedFilePath` (not content truthiness) so zero-byte files
  // correctly clear the buffer — otherwise the editor would show the previous
  // file's content and a subsequent save would overwrite the wrong file.
  useEffect(() => {
    if (loadedFilePath === null) {
      return
    }

    updateContent(fileContent)
  }, [fileContent, loadedFilePath, updateContent])

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
