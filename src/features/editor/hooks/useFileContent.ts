import { useState, useCallback } from 'react'
import {
  fetchFileContent,
  type FileContentResponse,
} from '../services/fileService'

export interface UseFileContentResult {
  content: string | null
  language: string | null
  loading: boolean
  error: string | null
  loadFile: (path: string) => Promise<void>
}

/**
 * Hook to fetch and manage file content with caching
 */
export function useFileContent(): UseFileContentResult {
  const [content, setContent] = useState<string | null>(null)
  const [language, setLanguage] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [cache] = useState<Map<string, FileContentResponse>>(new Map())

  const loadFile = useCallback(
    async (filePath: string): Promise<void> => {
      // Check cache first
      const cached = cache.get(filePath)

      if (cached) {
        setContent(cached.content)
        setLanguage(cached.language)
        setLoading(false)
        setError(null)

        return
      }

      setLoading(true)
      setError(null)

      try {
        const data = await fetchFileContent(filePath)
        setContent(data.content)
        setLanguage(data.language)

        // Cache the result
        cache.set(filePath, data)
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to load file content'
        setError(message)
        setContent(null)
        setLanguage(null)
      } finally {
        setLoading(false)
      }
    },
    [cache]
  )

  return {
    content,
    language,
    loading,
    error,
    loadFile,
  }
}
