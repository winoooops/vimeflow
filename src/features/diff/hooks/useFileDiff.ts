import { useState, useEffect, useCallback } from 'react'
import { createGitService } from '../services/gitService'
import type { FileDiff } from '../types'
import type { GetGitDiffResponse } from '../../../bindings/GetGitDiffResponse'

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
  /** Trigger a manual re-fetch of the diff (e.g. after a stage/discard action). */
  refetch: () => void
}

interface FileDiffRequest {
  filePath: string
  staged: boolean
  cwd: string
  untracked: boolean | undefined
  refetchKey: number
}

interface FileDiffResponseState {
  request: FileDiffRequest
  response: GetGitDiffResponse
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
  const [responseState, setResponseState] =
    useState<FileDiffResponseState | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [refetchKey, setRefetchKey] = useState(0)

  const refetch = useCallback((): void => {
    setRefetchKey((k) => k + 1)
  }, [])

  useEffect(() => {
    if (!filePath) {
      setResponseState(null)
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
      refetchKey,
    }

    const fetchDiff = async (): Promise<void> => {
      try {
        setLoading(true)
        setError(null)

        const service = createGitService(cwd)
        const result = await service.getDiff(filePath, staged, untracked)

        if (!cancelled) {
          setResponseState({ request, response: result })
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err
              : new Error(`Failed to fetch diff for ${filePath}`)
          )
          setResponseState(null)
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
  }, [filePath, staged, untracked, cwd, refetchKey])

  const response =
    filePath !== null &&
    responseState?.request.filePath === filePath &&
    responseState.request.staged === staged &&
    responseState.request.cwd === cwd &&
    responseState.request.untracked === untracked &&
    responseState.request.refetchKey === refetchKey &&
    !loading
      ? responseState.response
      : null

  const fileDiff = response?.fileDiff ?? null

  return {
    response,
    diff: fileDiff,
    loading,
    error,
    refetch,
  }
}
