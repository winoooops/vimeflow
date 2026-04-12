import { useState, useEffect, useCallback } from 'react'
import { createGitService } from '../services/gitService'
import type { ChangedFile } from '../types'

interface UseGitStatusReturn {
  files: ChangedFile[]
  loading: boolean
  error: Error | null
  refresh: () => void
}

/** True when cwd points to a real workspace directory, not a fallback. */
const isValidCwd = (cwd: string): boolean =>
  cwd !== '.' && cwd !== '~' && cwd.length > 0

/** Hook to fetch and manage git status (changed files) */
export const useGitStatus = (cwd = '.'): UseGitStatusReturn => {
  const [files, setFiles] = useState<ChangedFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // Single fetch path with per-invocation cancellation flag.
  // Both initial load and manual refresh go through this effect —
  // refresh() bumps refreshKey which triggers a re-run with a
  // fresh cancelled flag. No separate async path needed.
  //
  // Skips the fetch entirely when cwd is a fallback value ('.' or '~')
  // to avoid firing IPC against the Tauri process's CWD, which is
  // unlikely to be the user's project directory.
  useEffect(() => {
    if (!isValidCwd(cwd)) {
      setFiles([])
      setLoading(false)
      setError(null)

      return
    }

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
  }, [cwd, refreshKey])

  // Trigger a re-run of the cancellation-safe useEffect
  const refresh = useCallback((): void => {
    setRefreshKey((k) => k + 1)
  }, [])

  return {
    files,
    loading,
    error,
    refresh,
  }
}
