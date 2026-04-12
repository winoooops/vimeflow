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
export const useGitStatus = (cwd = '.'): UseGitStatusReturn => {
  const [files, setFiles] = useState<ChangedFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  // Per-invocation cancelled flag (local variable, not useRef) —
  // matches the pattern in useFileDiff. A shared useRef would be
  // reset by the next effect cycle before the old async call
  // completes, allowing stale results to leak through.
  useEffect(() => {
    let cancelled = false

    const fetchStatus = async (): Promise<void> => {
      try {
        setLoading(true)
        setError(null)

        const changedFiles = await createGitService(cwd).getStatus()

        if (!cancelled) {
          setFiles(changedFiles)
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err : new Error('Failed to fetch git status')
          )
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void fetchStatus()

    return (): void => {
      cancelled = true
    }
  }, [cwd])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setLoading(true)
      setError(null)
      const changedFiles = await createGitService(cwd).getStatus()
      setFiles(changedFiles)
    } catch (err) {
      setError(
        err instanceof Error ? err : new Error('Failed to fetch git status')
      )
    } finally {
      setLoading(false)
    }
  }, [cwd])

  return {
    files,
    loading,
    error,
    refresh,
  }
}
