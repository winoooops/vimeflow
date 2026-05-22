// cspell:ignore worktree worktrees
import { useEffect, useRef, useState } from 'react'
import { invoke } from '../../../lib/backend'

export interface UseGitWorktreeOptions {
  /** When false, returns idle state and skips IPC. */
  enabled?: boolean
}

export interface UseGitWorktreeReturn {
  /** Basename of the linked-worktree path, or `null` when on the main checkout. */
  worktreeName: string | null
  loading: boolean
  error: Error | null
}

const isAbsoluteCwd = (cwd: string): boolean => {
  if (cwd.length === 0) {
    return false
  }

  if (cwd.startsWith('/')) {
    return true
  }

  if (/^[A-Za-z]:[\\/]/.test(cwd)) {
    return true
  }

  if (cwd.startsWith('\\\\')) {
    return true
  }

  return false
}

export const useGitWorktree = (
  cwd: string,
  options: UseGitWorktreeOptions = {}
): UseGitWorktreeReturn => {
  const { enabled = true } = options
  const isIdle = !enabled || !isAbsoluteCwd(cwd)
  const [worktreeName, setWorktreeName] = useState<string | null>(null)
  const [loading, setLoading] = useState(!isIdle)
  const [error, setError] = useState<Error | null>(null)
  const lastFetchedCwdRef = useRef<string | null>(null)

  useEffect(() => {
    if (isIdle) {
      setLoading(false)
      setError(null)
      // Keep the last name in place when going idle (e.g., pane deactivation)
      // so the chip doesn't flicker on tab-switch.

      return
    }

    let cancelled = false
    const isNewCwd = lastFetchedCwdRef.current !== cwd

    const fetchWorktreeName = async (): Promise<void> => {
      if (isNewCwd) {
        // Pre-clear stale data ONLY on cwd change so refresh/enabled-toggle
        // doesn't blank the chip during the IPC round-trip.
        setWorktreeName(null)
      }
      setLoading(true)
      setError(null)
      lastFetchedCwdRef.current = cwd

      try {
        const result = await invoke<string | null>('git_worktree_name', {
          cwd,
        })

        if (cancelled) {
          return
        }

        setWorktreeName(result ?? null)
      } catch (err) {
        if (cancelled) {
          return
        }

        // Non-repo cwds and scope-validation errors surface here. Treat as
        // "no chip" rather than letting the Header show an error chip.
        setWorktreeName(null)
        setError(err instanceof Error ? err : new Error(String(err)))
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void fetchWorktreeName()

    return (): void => {
      cancelled = true
    }
  }, [cwd, isIdle])

  return { worktreeName, loading, error }
}
