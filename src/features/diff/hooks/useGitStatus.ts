import { useState, useEffect, useCallback, useRef } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { createGitService } from '../services/gitService'
import type { ChangedFile } from '../types'

interface GitStatusChangedPayload {
  /** List of current working directory paths subscribed to the watcher */
  cwds: string[]
}

interface UseGitStatusOptions {
  /** Enable watch mode — starts a git watcher and refreshes on filesystem events */
  watch?: boolean
  /** Enable/disable the hook entirely — when false, returns empty state with no IPC */
  enabled?: boolean
}

interface UseGitStatusReturn {
  files: ChangedFile[]
  /** The cwd of the last successful fetch — never updates on failure or fetch-start */
  filesCwd: string | null
  loading: boolean
  error: Error | null
  refresh: () => void
}

/** True when cwd points to a real workspace directory, not a fallback. */
const isValidCwd = (cwd: string): boolean =>
  cwd !== '.' && cwd !== '~' && cwd.length > 0

/** Hook to fetch and manage git status (changed files) */
export const useGitStatus = (
  cwd = '.',
  options: UseGitStatusOptions = {}
): UseGitStatusReturn => {
  const { watch = false, enabled = true } = options

  const [files, setFiles] = useState<ChangedFile[]>([])
  const [filesCwd, setFilesCwd] = useState<string | null>(null)
  const [loading, setLoading] = useState(() => enabled && isValidCwd(cwd))
  const [error, setError] = useState<Error | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // Track unlisten function for cleanup
  const unlistenRef = useRef<UnlistenFn | null>(null)

  // Trigger a re-run of the fetch effect
  const refresh = useCallback((): void => {
    setRefreshKey((k) => k + 1)
  }, [])

  // Single fetch path with per-invocation cancellation flag.
  // Both initial load and manual refresh go through this effect —
  // refresh() bumps refreshKey which triggers a re-run with a
  // fresh cancelled flag. No separate async path needed.
  //
  // Skips the fetch entirely when:
  // - cwd is a fallback value ('.' or '~') to avoid firing IPC against
  //   the Tauri process's CWD, which is unlikely to be the user's project directory
  // - enabled is false (hook is disabled)
  useEffect(() => {
    if (!enabled || !isValidCwd(cwd)) {
      setFiles([])
      setFilesCwd(null)
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
          setFilesCwd(cwd) // Only update on success
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err : new Error('Failed to fetch git status')
          )
          // filesCwd is NOT updated on failure — stays at last successful cwd
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
  }, [cwd, refreshKey, enabled])

  // Watch mode lifecycle: attach listener → start watcher → explicit refresh
  // Unmount: unlisten → stop watcher
  useEffect(() => {
    if (!enabled || !watch || !isValidCwd(cwd)) {
      return
    }

    let mounted = true
    let listenerAttached = false
    let watcherStarted = false

    const setupWatch = async (): Promise<void> => {
      try {
        // Step 1: Attach event listener BEFORE starting watcher (race-free)
        const unlisten = await listen<GitStatusChangedPayload>(
          'git-status-changed',
          (event) => {
            // Only refresh if this cwd is in the fan-out list
            // cspell:disable-next-line
            if (event.payload.cwds.includes(cwd)) {
              refresh()
            }
          }
        )

        if (!mounted) {
          // Unmounted before listener attached — clean up immediately
          unlisten()

          return
        }

        unlistenRef.current = unlisten
        listenerAttached = true

        // Step 2: Start the git watcher
        await invoke('start_git_watcher', { cwd })
        watcherStarted = true

        // Step 3: Explicit refresh after both listener and watcher are live
        // This ensures we catch events that may have fired between listener
        // attach and watcher start
        refresh()
      } catch (err) {
        if (mounted) {
          setError(
            err instanceof Error
              ? err
              : new Error('Failed to start git watcher')
          )
        }
      }
    }

    void setupWatch()

    return (): void => {
      mounted = false

      // Cleanup in reverse order: unlisten → stop watcher
      // This prevents late in-flight events from calling refresh on a torn-down hook
      const cleanup = async (): Promise<void> => {
        if (listenerAttached && unlistenRef.current) {
          unlistenRef.current()
          unlistenRef.current = null
        }

        if (watcherStarted) {
          try {
            await invoke('stop_git_watcher', { cwd })
          } catch {
            // Best-effort cleanup — swallow errors
          }
        }
      }

      void cleanup()
    }
  }, [cwd, watch, enabled, refresh])

  return {
    files,
    filesCwd,
    loading,
    error,
    refresh,
  }
}
