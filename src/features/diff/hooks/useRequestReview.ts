import { useCallback, useState } from 'react'
import { writeClipboardText } from '@/lib/clipboard'
import type { FileDiff } from '../types'
import type { PaneCandidate } from '../services/activePanePicker'
import {
  buildDiffSnapshot,
  setPendingReviewRequest,
  type ReviewedFile,
} from '../services/pendingReviewRequests'
import {
  dispatchReviewRequest,
  formatReviewRequest,
  makeDispatchNonce,
} from '../services/feedbackDispatch'

export interface UseRequestReviewOptions {
  /** The active file's parsed diff, or undefined when no diff is loaded. */
  fileDiff: FileDiff | undefined
  /** The feedback owner (sessionId:paneId) the findings route back to. */
  ownerKey: string | undefined
  cwd: string
  /** The diff's staged axis; the reviewer inherits it. */
  staged: boolean
  /**
   * Send bytes to an agent pane's pty (the delegate path). Undefined when no
   * live agent is reachable — then only the copy path works.
   */
  writePty?: (ptyId: string, data: string) => Promise<void>
  /** Refocus the terminal after a delegate dispatch. */
  focusTerminal?: () => void
  /** Surface a one-line status message to the user. */
  notify: (message: string) => void
}

export interface RequestReviewController {
  /** Whether the request-review popover is open. */
  open: boolean
  /** True when a review can be requested (a diff and an owner are present). */
  canRequest: boolean
  openPopover: () => void
  closePopover: () => void
  /** Delegate the review to a specific agent pane. */
  requestReview: (pane: PaneCandidate) => void
  /** Copy the review-request text so it can be pasted into any agent. */
  copyReviewRequest: () => void
}

/**
 * Owns the "Request review" flow (VIM-304): record a pending request (diff
 * snapshot + nonce + owner), then either send it to an agent pane or copy it for
 * a manual paste. Lifted out of the diff Panel so the component stays a thin
 * renderer and this orchestration is unit-testable on its own.
 */
export const useRequestReview = ({
  fileDiff,
  ownerKey,
  cwd,
  staged,
  writePty,
  focusTerminal,
  notify,
}: UseRequestReviewOptions): RequestReviewController => {
  const [open, setOpen] = useState(false)

  const canRequest = fileDiff !== undefined && ownerKey !== undefined

  // Record the pending request (snapshot + nonce) so the incoming agent-review
  // event can be matched, routed, and placed. The nonce alone gates it, so the
  // target pane isn't stored. Returns the dispatch inputs, or null when there's
  // nothing to review.
  const arm = useCallback((): {
    nonce: string
    files: ReviewedFile[]
  } | null => {
    if (fileDiff === undefined || ownerKey === undefined) {
      return null
    }

    const files = buildDiffSnapshot(fileDiff)
    const nonce = makeDispatchNonce()
    setPendingReviewRequest({
      nonce,
      ownerKey,
      cwd,
      staged,
      diffSnapshot: files,
      dispatchedAt: Date.now(),
    })

    return { nonce, files }
  }, [fileDiff, ownerKey, cwd, staged])

  const requestReview = useCallback(
    (pane: PaneCandidate): void => {
      const armed = arm()
      setOpen(false)
      if (armed === null || writePty === undefined) {
        return
      }

      void (async (): Promise<void> => {
        try {
          await dispatchReviewRequest(
            pane.ptyId,
            armed.files,
            staged,
            armed.nonce,
            writePty
          )
          if (focusTerminal !== undefined) {
            setTimeout(focusTerminal, 0)
          }
        } catch {
          notify('Terminal session ended; review request not sent.')
        }
      })()
    },
    [arm, writePty, focusTerminal, staged, notify]
  )

  const copyReviewRequest = useCallback((): void => {
    const armed = arm()
    setOpen(false)
    if (armed === null) {
      return
    }

    void (async (): Promise<void> => {
      const copied = await writeClipboardText(
        formatReviewRequest(armed.files, staged, armed.nonce)
      )
      notify(
        copied
          ? 'Copied the review request — paste it into an agent.'
          : 'Could not copy the review request.'
      )
    })()
  }, [arm, staged, notify])

  const openPopover = useCallback((): void => {
    if (canRequest) {
      setOpen(true)
    }
  }, [canRequest])

  const closePopover = useCallback((): void => setOpen(false), [])

  return {
    open,
    canRequest,
    openPopover,
    closePopover,
    requestReview,
    copyReviewRequest,
  }
}
