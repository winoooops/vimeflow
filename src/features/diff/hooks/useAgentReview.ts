import { useEffect } from 'react'
import { listen } from '@/lib/backend'
import { isDesktop } from '@/lib/environment'
import type { AgentReviewEvent, AgentReviewFinding } from '@/bindings'
import type { AnnotationSide, DiffLineAnnotation } from '@pierre/diffs'
import {
  FILE_COMMENT_LINE_NUMBER,
  type ReviewComment,
  type ReviewCommentCategory,
} from './useFeedbackBatch'
import {
  addReviewLevelNote,
  clearPendingReviewRequest,
  getPendingReviewRequest,
  type HunkRange,
  type ReviewedFile,
} from '../services/pendingReviewRequests'

export interface UseAgentReviewOptions {
  /** Attach an annotation onto a specific feedback owner (the dispatching one). */
  addAnnotationForOwner: (
    ownerKey: string,
    cwd: string,
    filePath: string,
    staged: boolean,
    annotation: DiffLineAnnotation<ReviewComment>
  ) => 'ok' | 'cap-reached'
  /** Fresh unique id for each attached reviewer annotation. */
  nextCommentId: () => string
}

const lineInRanges = (line: number, ranges: HunkRange[]): boolean =>
  ranges.some((range) => line >= range.start && line <= range.end)

const findFile = (
  snapshot: ReviewedFile[],
  path: string
): ReviewedFile | undefined => snapshot.find((file) => file.path === path)

/**
 * Captures the backend `agent-review` event (VIM-304) and places a delegated
 * reviewer's findings as `author: 'reviewer'` annotations on the review that
 * requested them. Mounts once where all feedback owners are reachable
 * (WorkspaceView).
 *
 * The gate — the event's nonce must match a request we minted — means a stray
 * sentinel or a review we did not ask for cannot mutate the diff. Each finding resolves
 * against the request's diff snapshot: line/range in a hunk → anchored; line/range
 * out of range → file-level; path not in the snapshot → a review-level note
 * (never dropped). A malformed event degrades to one review-level note. The
 * request is cleared after processing so a replay is a no-op. It never throws.
 */
export const useAgentReview = ({
  addAnnotationForOwner,
  nextCommentId,
}: UseAgentReviewOptions): void => {
  useEffect(() => {
    if (!isDesktop()) {
      return undefined
    }

    let cancelled = false
    let unlisten: (() => void) | undefined

    const reviewerAnnotation = (
      finding: AgentReviewFinding,
      reviewer: string,
      downgradeToFile: boolean
    ): DiffLineAnnotation<ReviewComment> => {
      const metadata: ReviewComment = {
        id: nextCommentId(),
        text: finding.text,
        author: 'reviewer',
        reviewer,
        category: finding.category as ReviewCommentCategory,
        createdAt: Date.now(),
      }

      // Native file scope, or a line/range whose anchor fell out of the diff.
      if (finding.scope === 'file' || downgradeToFile) {
        return {
          side: 'additions',
          lineNumber: FILE_COMMENT_LINE_NUMBER,
          metadata: { ...metadata, target: { scope: 'file' } },
        }
      }

      const side = (finding.side ?? 'additions') as AnnotationSide

      if (
        finding.scope === 'range' &&
        finding.startLine !== null &&
        finding.endLine !== null
      ) {
        return {
          side,
          lineNumber: finding.startLine,
          metadata: {
            ...metadata,
            target: {
              scope: 'range',
              side,
              startLine: finding.startLine,
              endLine: finding.endLine,
            },
          },
        }
      }

      return {
        side,
        lineNumber: finding.line ?? FILE_COMMENT_LINE_NUMBER,
        metadata,
      }
    }

    const handleReview = (event: AgentReviewEvent): void => {
      const request = getPendingReviewRequest(event.nonce ?? '')
      // The nonce is the whole gate: we only act on a review whose nonce matches
      // one we minted. It's random + unguessable, so this holds equally for a
      // review we delegated to a pane and one you copied and pasted into any
      // agent — no session check, and the copy path needs no pty id.
      if (request === undefined || event.nonce === null) {
        return
      }

      const reviewer = event.reviewer ?? 'Reviewer'
      const { ownerKey, cwd, staged, diffSnapshot, nonce } = request

      // Malformed marker, or a valid-but-empty clean review.
      if (event.findings === null) {
        addReviewLevelNote(ownerKey, {
          commentId: nextCommentId(),
          reviewer,
          text: event.rawText,
          nonce,
        })
        clearPendingReviewRequest(event.nonce)

        return
      }

      for (const finding of event.findings) {
        const file = findFile(diffSnapshot, finding.path)

        // path not in the reviewed diff → no (path, staged) row to anchor under.
        if (file === undefined) {
          addReviewLevelNote(ownerKey, {
            commentId: nextCommentId(),
            reviewer,
            text: finding.text,
            nonce,
          })
          continue
        }

        const ranges =
          finding.side === 'deletions' ? file.deletions : file.additions

        const anchor =
          finding.scope === 'range' ? finding.startLine : finding.line
        const anchorInHunk = anchor !== null && lineInRanges(anchor, ranges)
        const downgradeToFile = finding.scope !== 'file' && !anchorInHunk

        addAnnotationForOwner(
          ownerKey,
          cwd,
          finding.path,
          staged,
          reviewerAnnotation(finding, reviewer, downgradeToFile)
        )
      }

      clearPendingReviewRequest(event.nonce)
    }

    const subscribe = async (): Promise<void> => {
      const fn = await listen<AgentReviewEvent>('agent-review', handleReview)
      if (cancelled) {
        fn()
      } else {
        unlisten = fn
      }
    }

    void subscribe()

    return (): void => {
      cancelled = true
      unlisten?.()
    }
  }, [addAnnotationForOwner, nextCommentId])
}
