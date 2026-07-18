import { useCallback, useMemo, useRef, useState } from 'react'
import { writeClipboardText } from '@/lib/clipboard'
import type { ChangedFile, FileDiff } from '../types'
import type { PaneCandidate } from '../services/activePanePicker'
import {
  buildDiffSnapshot,
  clearPendingReviewRequest,
  setPendingReviewRequest,
} from '../services/pendingReviewRequests'
import {
  dispatchReviewRequest,
  formatReviewRequest,
  makeDispatchNonce,
  type ReviewRequestFile,
} from '../services/feedbackDispatch'
import {
  fetchChangelistSnapshot,
  type ChangelistSnapshot,
  type FetchFileDiff,
} from '../services/changelistSnapshot'

export type ReviewScope = 'file' | 'changelist'

export interface UseRequestReviewOptions {
  /** The active file's parsed diff, or undefined when no diff is loaded. */
  fileDiff: FileDiff | undefined
  /** The feedback owner (sessionId:paneId) the findings route back to. */
  ownerKey: string | undefined
  cwd: string
  /** The active row's staged axis — the single-file scope inherits it. */
  staged: boolean
  /**
   * True when the active row is untracked — the single-file prompt then
   * carries the same "read the file directly" annotation the changelist adds.
   */
  activeFileUntracked?: boolean
  /** All file-strip entries; the changelist scope reviews exactly this list. */
  changedFiles?: readonly ChangedFile[]
  /** useGitStatus revision — part of the prefetch key (spec §3). */
  statusRevision?: number
  /** Fetch one file's parsed diff (Panel wraps gitService.getDiff). */
  fetchFileDiff?: FetchFileDiff
  /**
   * Send bytes to an agent pane's pty (the delegate path). Undefined when no
   * live agent is reachable — then only the copy path works.
   */
  writePty?: (ptyId: string, data: string) => Promise<void>
  /** Refocus the terminal after a delegate dispatch. */
  focusTerminal?: () => void
  /** Surface a one-line status message to the user. */
  notify: (message: string) => void
  /** Git repo root used to include resolvable absolute file paths in prompts. */
  repoRoot?: string
}

export interface RequestReviewController {
  /** Whether the request-review popover is open. */
  open: boolean
  /** True when a review can be requested (a diff or a strip entry and an owner are present). */
  canRequest: boolean
  scope: ReviewScope
  setScope: (scope: ReviewScope) => void
  /** Entry count backing the "All changes (N)" label; 0 hides the choice. */
  changeCount: number
  openPopover: () => void
  closePopover: () => void
  /** Delegate the review to a specific agent pane. */
  requestReview: (pane: PaneCandidate) => void
  /** Copy the review-request text so it can be pasted into any agent. */
  copyReviewRequest: () => void
}

/**
 * Owns the "Request review" flow (VIM-304, VIM-327): record a pending request
 * (diff snapshot + nonce + owner), then either send it to an agent pane or copy
 * it for a manual paste. Supports both single-file and whole-changelist scope.
 * Lifted out of the diff Panel so the component stays a thin renderer and this
 * orchestration is unit-testable on its own.
 */
export const useRequestReview = ({
  fileDiff,
  ownerKey,
  cwd,
  staged,
  activeFileUntracked = false,
  changedFiles,
  statusRevision,
  fetchFileDiff,
  writePty,
  focusTerminal,
  notify,
  repoRoot = undefined,
}: UseRequestReviewOptions): RequestReviewController => {
  const [open, setOpen] = useState(false)

  const entries = useMemo(() => changedFiles ?? [], [changedFiles])

  const changeCount = entries.length

  const canRequestFile = fileDiff !== undefined

  const canRequestChangelist = changeCount > 0 && fetchFileDiff !== undefined

  const canRequest =
    ownerKey !== undefined && (canRequestFile || canRequestChangelist)

  // Scope state with forcing (spec §5): no active diff → changelist; empty
  // strip → file. User choice wins otherwise; default = changelist when >1
  // entry. openPopover resets the choice to null so a stale selection never
  // survives strip/file transitions between opens (spec §5).
  const [scopeChoice, setScopeChoice] = useState<ReviewScope | null>(null)

  const defaultScope: ReviewScope = !canRequestFile
    ? 'changelist'
    : !canRequestChangelist
      ? 'file'
      : changeCount > 1
        ? 'changelist'
        : 'file'

  const scope: ReviewScope = !canRequestFile
    ? 'changelist'
    : !canRequestChangelist
      ? 'file'
      : (scopeChoice ?? defaultScope)

  // Keyed prefetch (spec §3): one in-flight promise. It never rejects —
  // failure resolves to null — so a discarded or never-consumed prefetch
  // cannot surface as an unhandled rejection.
  const prefetchRef = useRef<{
    key: string
    promise: Promise<ChangelistSnapshot | null>
    settled: boolean
  } | null>(null)

  // Separator is the NUL character (U+0000) — same as the finding-thread store.
  const prefetchKey = `${cwd}\u0000${statusRevision ?? 0}`

  const startPrefetch = useCallback((): void => {
    if (!canRequestChangelist) {
      return
    }

    const existing = prefetchRef.current

    if (
      existing !== null &&
      existing.key === prefetchKey &&
      !existing.settled
    ) {
      return
    }

    // fetchFileDiff is defined: canRequestChangelist guarantees it, and we
    // returned early above when !canRequestChangelist.
    const holder = {
      key: prefetchKey,
      promise: Promise.resolve<ChangelistSnapshot | null>(null),
      settled: false,
    }

    holder.promise = (async (): Promise<ChangelistSnapshot | null> => {
      try {
        return await fetchChangelistSnapshot(
          entries,
          fetchFileDiff,
          repoRoot ?? ''
        )
      } catch {
        return null
      } finally {
        holder.settled = true
      }
    })()
    prefetchRef.current = holder
  }, [canRequestChangelist, fetchFileDiff, prefetchKey, entries, repoRoot])

  // Record the pending request (snapshot + nonce) so the incoming agent-review
  // event can be matched, routed, and placed. Returns dispatch inputs, or null.
  const arm = useCallback(
    async (
      armScope: ReviewScope,
      ptyId?: string
    ): Promise<{
      nonce: string
      requestFiles: ReviewRequestFile[]
    } | null> => {
      if (ownerKey === undefined) {
        return null
      }

      if (armScope === 'file') {
        if (fileDiff === undefined) {
          return null
        }

        const files = [buildDiffSnapshot(fileDiff, staged)]
        const normalizedRepoRoot = repoRoot?.replace(/[\\/]+$/, '') ?? ''

        const requestFiles: ReviewRequestFile[] = files.map((file) => ({
          ...file,
          ...(normalizedRepoRoot.length > 0
            ? { promptPath: `${normalizedRepoRoot}/${file.path}` }
            : {}),
          ...(activeFileUntracked ? { untracked: true } : {}),
        }))
        const nonce = makeDispatchNonce()
        setPendingReviewRequest({
          nonce,
          ...(ptyId === undefined ? {} : { ptyId }),
          ownerKey,
          cwd,
          diffSnapshot: files,
          dispatchedAt: Date.now(),
        })

        return { nonce, requestFiles }
      }

      if (!canRequestChangelist) {
        return null
      }

      const existing = prefetchRef.current

      const snapshotPromise =
        existing !== null && existing.key === prefetchKey
          ? existing.promise
          : ((): Promise<ChangelistSnapshot | null> | undefined => {
              startPrefetch()

              return prefetchRef.current?.promise
            })()

      if (snapshotPromise === undefined) {
        return null
      }

      const snapshot = await snapshotPromise

      if (snapshot === null) {
        notify('Could not snapshot the changelist; review request not sent.')

        return null
      }

      const nonce = makeDispatchNonce()

      setPendingReviewRequest({
        nonce,
        ...(ptyId === undefined ? {} : { ptyId }),
        ownerKey,
        cwd,
        diffSnapshot: snapshot.files,
        dispatchedAt: Date.now(),
      })

      return { nonce, requestFiles: snapshot.requestFiles }
    },
    [
      ownerKey,
      fileDiff,
      staged,
      activeFileUntracked,
      cwd,
      repoRoot,
      canRequestChangelist,
      prefetchKey,
      startPrefetch,
      notify,
    ]
  )

  const requestReview = useCallback(
    (pane: PaneCandidate): void => {
      setOpen(false)

      if (writePty === undefined) {
        return
      }

      void (async (): Promise<void> => {
        const armed = await arm(scope, pane.ptyId)

        if (armed === null) {
          return
        }

        try {
          await dispatchReviewRequest(
            pane.ptyId,
            armed.requestFiles,
            armed.nonce,
            writePty
          )

          if (focusTerminal !== undefined) {
            setTimeout(focusTerminal, 0)
          }
        } catch {
          clearPendingReviewRequest(armed.nonce)
          notify('Terminal session ended; review request not sent.')
        }
      })()
    },
    [arm, scope, writePty, focusTerminal, notify]
  )

  const copyReviewRequest = useCallback((): void => {
    setOpen(false)

    void (async (): Promise<void> => {
      const armed = await arm(scope)

      if (armed === null) {
        return
      }

      const copied = await writeClipboardText(
        formatReviewRequest(armed.requestFiles, armed.nonce)
      )
      notify(
        copied
          ? 'Copied the review request — paste it into an agent.'
          : 'Could not copy the review request.'
      )
    })()
  }, [arm, scope, notify])

  const openPopover = useCallback((): void => {
    if (canRequest) {
      setScopeChoice(null)
      setOpen(true)

      if (canRequestChangelist) {
        startPrefetch()
      }
    }
  }, [canRequest, canRequestChangelist, startPrefetch])

  const closePopover = useCallback((): void => setOpen(false), [])

  return {
    open,
    canRequest,
    scope,
    setScope: setScopeChoice,
    changeCount,
    openPopover,
    closePopover,
    requestReview,
    copyReviewRequest,
  }
}
