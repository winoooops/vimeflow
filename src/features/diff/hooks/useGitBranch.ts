import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke, listen, type UnlistenFn } from '../../../lib/backend'

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

interface GitHeadChangedPayload {
  /** List of current working directory paths subscribed to the watcher */
  cwds: string[]
}

const logGitBranchDebug = (
  event: string,
  details: Record<string, boolean | string | null>
): void => {
  if (!import.meta.env.DEV || import.meta.env.MODE === 'test') {
    return
  }

  // eslint-disable-next-line no-console
  console.info(`[vimeflow:git-branch] ${event} ${JSON.stringify(details)}`)
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
  const unlistenRef = useRef<UnlistenFn | null>(null)

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
        logGitBranchDebug('fetch-start', { cwd, isNewCwd })

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
          logGitBranchDebug('fetch-success', {
            cwd,
            branch: trimmed === '' ? null : trimmed,
            empty: trimmed === '',
          })
          setBranch(trimmed === '' ? null : trimmed)
        }
      } catch (err) {
        if (!cancelled) {
          logGitBranchDebug('fetch-error', {
            cwd,
            error: err instanceof Error ? err.message : String(err),
          })
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

  useEffect((): (() => void) | undefined => {
    if (!enabled || !isValidCwd(cwd)) {
      return undefined
    }

    let mounted = true
    let listenerAttached = false
    let watcherStarted = false

    const setupWatch = async (): Promise<void> => {
      try {
        const unlisten = await listen<GitHeadChangedPayload>(
          'git-head-changed',
          (payload) => {
            if (payload.cwds.includes(cwd)) {
              refresh()
            }
          }
        )

        if (!mounted) {
          unlisten()

          return
        }

        unlistenRef.current = unlisten
        listenerAttached = true

        await invoke('start_git_watcher', { cwd })
        watcherStarted = true

        // Guarded by `mounted` because React cleanup could have fired
        // during the invoke await — a setState on an unmounted component
        // is a no-op in React 18 production but still an anti-pattern
        // (and a wasted fetch in Strict Mode's double-invocation).
        // TypeScript's flow analysis can't see the cleanup closure below
        // mutate `mounted` across the await, so the lint rule has to be
        // suppressed at this exact line. Same disable + rationale as
        // useGitStatus.ts:160-167.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (mounted) {
          refresh()
        }
      } catch (err) {
        if (mounted) {
          logGitBranchDebug('watcher-error', {
            cwd,
            error: err instanceof Error ? err.message : String(err),
          })

          setError(
            err instanceof Error
              ? err
              : new Error('Failed to start git branch watcher')
          )
        }
      }
    }

    const setupPromise = setupWatch()

    return (): void => {
      mounted = false

      const cleanup = async (): Promise<void> => {
        if (listenerAttached && unlistenRef.current) {
          unlistenRef.current()
          unlistenRef.current = null
        }

        await setupPromise.catch(() => {
          // setup errored — nothing to stop
        })

        if (watcherStarted) {
          await invoke('stop_git_watcher', { cwd }).catch(() => {
            // Best-effort cleanup — swallow errors
          })
        }
      }

      void cleanup()
    }
  }, [cwd, enabled, refresh])

  return { branch, loading, error, refresh, idle }
}
