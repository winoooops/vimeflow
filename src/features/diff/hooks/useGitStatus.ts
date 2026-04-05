import { useState, useEffect, useCallback } from 'react'
import { createGitService } from '../services/gitService'
import type { ChangedFile } from '../types'

interface UseGitStatusReturn {
  files: ChangedFile[]
  loading: boolean
  error: Error | null
  refresh: () => Promise<void>
}

/** Hook to fetch and manage git status (changed files) */
export const useGitStatus = (): UseGitStatusReturn => {
  const [files, setFiles] = useState<ChangedFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchStatus = useCallback(async (): Promise<void> => {
    try {
      setLoading(true)
      setError(null)

      const service = createGitService()
      const changedFiles = await service.getStatus()

      setFiles(changedFiles)
    } catch (err) {
      setError(
        err instanceof Error ? err : new Error('Failed to fetch git status')
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchStatus()
  }, [fetchStatus])

  return {
    files,
    loading,
    error,
    refresh: fetchStatus,
  }
}
