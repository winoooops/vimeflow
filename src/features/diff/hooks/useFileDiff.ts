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
 * @param cwd - Working directory for git commands
 * @param untracked - Whether the selected file is known to be untracked
 */
export const useFileDiff = (
  filePath: string | null,
  staged = false,
  cwd = '.',
  untracked?: boolean
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

    let cancelled = false

    const fetchDiff = async (): Promise<void> => {
      try {
        setDiff(null)
        setLoading(true)
        setError(null)

        const service = createGitService(cwd)
        const fileDiff = await service.getDiff(filePath, staged, untracked)

        if (!cancelled) {
          setDiff(fileDiff)
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err
              : new Error(`Failed to fetch diff for ${filePath}`)
          )
          setDiff(null)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void fetchDiff()

    return (): void => {
      cancelled = true
    }
  }, [filePath, staged, untracked, cwd])

  return {
    diff,
    loading,
    error,
  }
}
