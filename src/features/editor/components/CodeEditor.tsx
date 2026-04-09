import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { IFileSystemService } from '../../files/services/fileSystemService'
import { useCodeMirror } from '../hooks/useCodeMirror'
import { useVimMode } from '../hooks/useVimMode'
import { VimStatusBar } from './VimStatusBar'
import { getLanguageExtension } from '../services/languageService'

interface CodeEditorProps {
  filePath: string | null
  fileSystemService: IFileSystemService
  onContentChange?: (content: string) => void
  isDirty?: boolean
}

export const CodeEditor = ({
  filePath,
  fileSystemService,
  onContentChange = undefined,
  isDirty = false,
}: CodeEditorProps): ReactElement => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [fileContent, setFileContent] = useState<string>('')
  const [loadedFilePath, setLoadedFilePath] = useState<string | null>(null)

  // Load file when filePath changes
  useEffect(() => {
    if (!filePath) {
      setFileContent('')
      setLoadedFilePath(null)

      return
    }

    const loadFile = async (): Promise<void> => {
      try {
        const content = await fileSystemService.readFile(filePath)
        setFileContent(content)
        setLoadedFilePath(filePath)
      } catch (error: unknown) {
        // eslint-disable-next-line no-console
        console.error('Failed to load file:', error)
      }
    }

    void loadFile()
  }, [filePath, fileSystemService])

  // Get language extension from filename
  const fileName = filePath ? (filePath.split('/').pop() ?? '') : ''
  const language = fileName ? getLanguageExtension(fileName) : null

  // Setup CodeMirror with vim mode
  const { editorView, updateContent } = useCodeMirror({
    containerRef: containerRef as React.RefObject<HTMLDivElement>,
    initialContent: fileContent,
    language,
    onSave: () => {
      if (!loadedFilePath || !editorView) {
        return
      }

      const currentContent = editorView.state.doc.toString()

      void fileSystemService.writeFile(loadedFilePath, currentContent)
    },
    onChange: onContentChange,
  })

  // Track vim mode
  const vimMode = useVimMode(editorView)

  // Update editor content when file content changes
  useEffect(() => {
    if (!editorView || !fileContent) {
      return
    }

    updateContent(fileContent)
  }, [editorView, fileContent, updateContent])

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
        ref={containerRef}
        data-testid="codemirror-container"
        className="flex-1 overflow-hidden"
      />
      <VimStatusBar vimMode={vimMode} isDirty={isDirty} />
    </div>
  )
}
