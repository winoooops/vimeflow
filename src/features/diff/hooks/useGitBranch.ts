import { useCallback, useEffect, useRef, useState } from 'react'
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

const isValidCwd = (cwd: string): boolean => {
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

  // Track the last cwd we successfully kicked off a fetch for. Used to
  // distinguish "cwd actually changed" (clear stale branch before the
  // new IPC resolves) from "enabled flipped true after a deactivation"
  // (don't blank the Header — the previous branch is still correct for
  // this cwd; just refresh it in place once the IPC returns).
  const lastFetchedCwdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled || !isValidCwd(cwd)) {
      setLoading(false)
      setError(null)
      // Intentionally NOT clearing `branch` — preserves the last-known
      // value so a tab deactivation (enabled=true → false) doesn't blank
      // the Header label, then flash-back-on-reactivation while a fresh
      // git_branch IPC resolves. cwd changes still clear stale data via
      // the fetch path below.

      return
    }

    let cancelled = false
    // Snapshot whether this fetch is for a NEW cwd (vs. a re-fetch of
    // the same cwd from a refresh() call or an enabled toggle). Only
    // new cwd should pre-clear the branch — same-cwd re-fetches
    // overwrite at the end without flashing null in between.
    const isNewCwd = lastFetchedCwdRef.current !== cwd

    const fetchBranch = async (): Promise<void> => {
      try {
        if (isNewCwd) {
          // Clear here so a cwd change blanks stale data BEFORE the new
          // fetch resolves. Same-cwd re-fetches (refresh, enabled-toggle)
          // do NOT clear, preserving the last-known branch through the
          // IPC round-trip.
          setBranch(null)
        }
        setLoading(true)
        setError(null)
        lastFetchedCwdRef.current = cwd

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
