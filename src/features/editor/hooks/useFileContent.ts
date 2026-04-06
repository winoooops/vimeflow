import { useState, useCallback, useEffect, useRef } from 'react'
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
  const cacheRef = useRef<Map<string, FileContentResponse>>(new Map())
  const isMountedRef = useRef<boolean>(true)

  useEffect((): (() => void) => {
    isMountedRef.current = true

    return (): void => {
      isMountedRef.current = false
    }
  }, [])

  const loadFile = useCallback(async (filePath: string): Promise<void> => {
    // Check cache first
    const cached = cacheRef.current.get(filePath)

    if (cached) {
      if (isMountedRef.current) {
        setContent(cached.content)
        setLanguage(cached.language)
        setLoading(false)
        setError(null)
      }

      return
    }

    if (isMountedRef.current) {
      setLoading(true)
      setError(null)
    }

    try {
      const data = await fetchFileContent(filePath)

      if (isMountedRef.current) {
        setContent(data.content)
        setLanguage(data.language)

        // Cache the result
        cacheRef.current.set(filePath, data)
      }
    } catch (err) {
      if (isMountedRef.current) {
        const message =
          err instanceof Error ? err.message : 'Failed to load file content'
        setError(message)
        setContent(null)
        setLanguage(null)
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false)
      }
    }
  }, [])

  return {
    content,
    language,
    loading,
    error,
    loadFile,
  }
}
