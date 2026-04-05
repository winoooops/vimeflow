import { useState, useEffect } from 'react'
import { createGitService } from '../services/gitService'
import type { FileDiff } from '../types'

interface UseFileDiffReturn {
  diff: FileDiff | null
  loading: boolean
  error: Error | null
}

/**
 * Hook to fetch diff for a specific file
 * @param filePath - Path to the file
 * @param staged - Whether to fetch staged or unstaged diff
 */
export const useFileDiff = (
  filePath: string | null,
  staged = false
): UseFileDiffReturn => {
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!filePath) {
      setDiff(null)
      setLoading(false)
      setError(null)

      return
    }

    const fetchDiff = async (): Promise<void> => {
      try {
        setLoading(true)
        setError(null)

        const service = createGitService()
        const fileDiff = await service.getDiff(filePath, staged)

        setDiff(fileDiff)
      } catch (err) {
        setError(
          err instanceof Error
            ? err
            : new Error(`Failed to fetch diff for ${filePath}`)
        )
        setDiff(null)
      } finally {
        setLoading(false)
      }
    }

    void fetchDiff()
  }, [filePath, staged])

  return {
    diff,
    loading,
    error,
  }
}
