import { useState, useCallback } from 'react'
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

  const openFile = useCallback(
    async (path: string): Promise<void> => {
      const content = await fileSystemService.readFile(path)
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
