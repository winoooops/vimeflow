/**
 * Fetches the currently selected file diff and keeps enough request identity to
 * avoid showing the wrong file while React rerenders the diff panel.
 *
 * The diff viewer wants two behaviors that fight each other slightly:
 * switching files should hide stale content immediately, but refreshing the
 * same file after a git-status update should keep the old diff visible until
 * the new response arrives. This hook records the request that produced each
 * response, returns it only when it still matches the selected file, and lets a
 * parent-provided refresh token force same-file revalidation without clearing
 * the visible response.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { createGitService } from '../services/gitService'
import { diffIdentityForResponse } from '../services/pierreAdapter'
import type { FileDiff } from '../types'
import type { GetGitDiffResponse } from '../../../bindings/GetGitDiffResponse'

export type LatestDiffStatus = 'updating' | 'ready'

export interface UseFileDiffReturn {
  /**
   * Full backend response — parsed `fileDiff` plus the raw `oldText` /
   * `newText` (used by Pierre's Shiki renderer) and `rawDiff` (used by
   * `extractHunkPatch` for hunk-level staging).
   */
  response: GetGitDiffResponse | null
  /** Convenience derived getter for callers that only need the parsed FileDiff. */
  diff: FileDiff | null
  loading: boolean
  error: Error | null
  latestDiffStatus: LatestDiffStatus | null
  /** Trigger a manual re-fetch of the diff (e.g. after a stage/discard action). */
  refetch: () => void
  /** Swap the visible diff to the newest background response. */
  acceptLatestDiff: () => void
}

interface FileDiffRequest {
  filePath: string
  staged: boolean
  cwd: string
  untracked: boolean | undefined
  /** Changes when git status succeeds so the selected file diff revalidates. */
  refreshToken: string | undefined
  refetchKey: number
}

interface FileDiffResponseState {
  request: FileDiffRequest
  response: GetGitDiffResponse
}

const LATEST_DIFF_READY_DELAY_MS = 800

const requestMatchesSelection = (
  state: FileDiffResponseState | null,
  filePath: string,
  staged: boolean,
  cwd: string,
  untracked: boolean | undefined
): state is FileDiffResponseState =>
  state !== null &&
  state.request.filePath === filePath &&
  state.request.staged === staged &&
  state.request.cwd === cwd &&
  state.request.untracked === untracked

/**
 * Hook to fetch diff for a specific file
 * @param filePath - Path to the file
 * @param staged - Whether to fetch staged or unstaged diff
 * @param cwd - Working directory for git commands
 * @param untracked - Whether the selected file is known to be untracked
 * @param refreshToken - Parent-owned invalidation token for same-file refreshes
 */
export const useFileDiff = (
  filePath: string | null,
  staged = false,
  cwd = '.',
  untracked?: boolean,
  refreshToken?: string
): UseFileDiffReturn => {
  const [displayedState, setDisplayedState] =
    useState<FileDiffResponseState | null>(null)

  const [latestState, setLatestState] = useState<FileDiffResponseState | null>(
    null
  )

  const [latestDiffStatus, setLatestDiffStatus] =
    useState<LatestDiffStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [refetchKey, setRefetchKey] = useState(0)
  const displayedStateRef = useRef<FileDiffResponseState | null>(displayedState)
  const latestDiffStatusRef = useRef<LatestDiffStatus | null>(latestDiffStatus)
  const readyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setLatestDiffStatusValue = useCallback(
    (status: LatestDiffStatus | null): void => {
      latestDiffStatusRef.current = status
      setLatestDiffStatus(status)
    },
    []
  )

  const clearReadyTimer = useCallback((): void => {
    if (readyTimerRef.current !== null) {
      clearTimeout(readyTimerRef.current)
      readyTimerRef.current = null
    }
  }, [])

  const refetch = useCallback((): void => {
    setRefetchKey((k) => k + 1)
  }, [])

  useEffect(() => {
    displayedStateRef.current = displayedState
  }, [displayedState])

  const acceptLatestDiff = useCallback((): void => {
    if (latestState === null) {
      return
    }

    clearReadyTimer()
    setDisplayedState(latestState)
    setLatestState(null)
    setLatestDiffStatusValue(null)
    setError(null)
  }, [clearReadyTimer, latestState, setLatestDiffStatusValue])

  useEffect(() => clearReadyTimer, [clearReadyTimer])

  useEffect(() => {
    if (!filePath) {
      clearReadyTimer()
      setDisplayedState(null)
      setLatestState(null)
      setLatestDiffStatusValue(null)
      setLoading(false)
      setError(null)

      return
    }

    let cancelled = false

    const request: FileDiffRequest = {
      filePath,
      staged,
      cwd,
      untracked,
      refreshToken,
      refetchKey,
    }

    const currentDisplayedState = displayedStateRef.current

    const backgroundDisplayedState =
      requestMatchesSelection(
        currentDisplayedState,
        filePath,
        staged,
        cwd,
        untracked
      ) &&
      currentDisplayedState.request.refetchKey === refetchKey &&
      currentDisplayedState.request.refreshToken !== refreshToken
        ? currentDisplayedState
        : null

    const fetchDiff = async (): Promise<void> => {
      try {
        if (backgroundDisplayedState === null) {
          clearReadyTimer()
          setLatestState(null)
          setLatestDiffStatusValue(null)
        } else {
          clearReadyTimer()
          if (latestDiffStatusRef.current !== 'ready') {
            setLatestDiffStatusValue('updating')
          }
        }

        setLoading(true)
        if (backgroundDisplayedState === null) {
          setError(null)
        }

        const service = createGitService(cwd)
        const result = await service.getDiff(filePath, staged, untracked)

        if (!cancelled) {
          if (backgroundDisplayedState === null) {
            setDisplayedState({ request, response: result })
          } else if (
            diffIdentityForResponse(result) ===
            diffIdentityForResponse(backgroundDisplayedState.response)
          ) {
            setLatestState(null)
            setLatestDiffStatusValue(null)
          } else {
            setLatestState({ request, response: result })
            if (latestDiffStatusRef.current === 'ready') {
              setLatestDiffStatusValue('ready')
            } else {
              readyTimerRef.current = setTimeout(() => {
                setLatestDiffStatusValue('ready')
                readyTimerRef.current = null
              }, LATEST_DIFF_READY_DELAY_MS)
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          if (backgroundDisplayedState !== null) {
            if (latestDiffStatusRef.current !== 'ready') {
              setLatestState(null)
              setLatestDiffStatusValue(null)
            }
          } else {
            setError(
              err instanceof Error
                ? err
                : new Error(`Failed to fetch diff for ${filePath}`)
            )
            setDisplayedState(null)
          }
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
  }, [
    clearReadyTimer,
    cwd,
    filePath,
    refetchKey,
    refreshToken,
    setLatestDiffStatusValue,
    staged,
    untracked,
  ])

  const response =
    filePath !== null &&
    requestMatchesSelection(displayedState, filePath, staged, cwd, untracked)
      ? displayedState.response
      : null

  const fileDiff = response?.fileDiff ?? null

  return {
    response,
    diff: fileDiff,
    loading,
    error,
    latestDiffStatus,
    refetch,
    acceptLatestDiff,
  }
}
