import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

export interface UseGitBranchOptions {
  /** When false, returns empty state and skips IPC. */
  enabled?: boolean
}

export interface UseGitBranchReturn {
  branch: string | null
  loading: boolean
  error: Error | null
  refresh: () => void
  idle: boolean
}

const isValidCwd = (cwd: string): boolean =>
  cwd !== '.' && cwd !== '~' && cwd.length > 0

export const useGitBranch = (
  cwd = '.',
  options: UseGitBranchOptions = {}
): UseGitBranchReturn => {
  const { enabled = true } = options
  const [branch, setBranch] = useState<string | null>(null)
  const [loading, setLoading] = useState(() => enabled && isValidCwd(cwd))
  const [error, setError] = useState<Error | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = useCallback((): void => {
    setRefreshKey((key) => key + 1)
  }, [])

  const idle = !enabled || !isValidCwd(cwd)

  useEffect(() => {
    if (!enabled || !isValidCwd(cwd)) {
      setBranch(null)
      setLoading(false)
      setError(null)

      return
    }

    let cancelled = false

    const fetchBranch = async (): Promise<void> => {
      try {
        setLoading(true)
        setError(null)

        const result = await invoke<string>('git_branch', { cwd })

        if (!cancelled) {
          const trimmed = result.trim()
          setBranch(trimmed === '' ? null : trimmed)
        }
      } catch (err) {
        if (!cancelled) {
          setBranch(null)
          setError(err instanceof Error ? err : new Error(String(err)))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void fetchBranch()

    return (): void => {
      cancelled = true
    }
  }, [cwd, enabled, refreshKey])

  return { branch, loading, error, refresh, idle }
}
