import { useState, useCallback, useRef } from 'react'
import type { IFileSystemService } from '../../files/services/fileSystemService'

export interface EditorBuffer {
  filePath: string | null
  originalContent: string
  currentContent: string
  isDirty: boolean
  openFile: (path: string) => Promise<void>
  saveFile: () => Promise<void>
  updateContent: (content: string) => void
}

export const useEditorBuffer = (
  fileSystemService: IFileSystemService
): EditorBuffer => {
  const [filePath, setFilePath] = useState<string | null>(null)
  const [originalContent, setOriginalContent] = useState<string>('')
  const [currentContent, setCurrentContent] = useState<string>('')

  const isDirty = currentContent !== originalContent

  // Monotonically-increasing counter for last-write-wins semantics on
  // concurrent openFile calls. Each invocation captures its own id at
  // the start and checks it against the ref AFTER the await. If another
  // openFile was kicked off in the meantime, the stale response is
  // silently discarded so filePath/originalContent/currentContent
  // stay in sync with whichever file the user clicked most recently.
  //
  // Without this guard, two rapid clicks within the IPC round-trip
  // window could leave the editor showing file A's content while
  // filePath is file B — a subsequent :w would then overwrite B's
  // on-disk contents with A's buffer (silent data corruption).
  const openRequestIdRef = useRef(0)

  const openFile = useCallback(
    async (path: string): Promise<void> => {
      const requestId = openRequestIdRef.current + 1
      openRequestIdRef.current = requestId

      const content = await fileSystemService.readFile(path)

      // Last-write-wins: ignore stale responses.
      if (requestId !== openRequestIdRef.current) {
        return
      }

      setFilePath(path)
      setOriginalContent(content)
      setCurrentContent(content)
    },
    [fileSystemService]
  )

  const saveFile = useCallback(async (): Promise<void> => {
    if (!filePath) {
      throw new Error('No file loaded')
    }

    await fileSystemService.writeFile(filePath, currentContent)
    setOriginalContent(currentContent)
  }, [fileSystemService, filePath, currentContent])

  const updateContent = useCallback((content: string): void => {
    setCurrentContent(content)
  }, [])

  return {
    filePath,
    originalContent,
    currentContent,
    isDirty,
    openFile,
    saveFile,
    updateContent,
  }
}
