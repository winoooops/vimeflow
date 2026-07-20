import { useCallback, useEffect } from 'react'
import { invoke, listen } from '@/lib/backend'
import { isDesktop } from '@/lib/environment'
import type {
  AgentReplaySummaryEvent,
  AgentReviewEvent,
  AgentReviewFinding,
} from '@/bindings'
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
  pendingReviewRequestNoncesForPty,
  setFindingThreadRecord,
  type FindingThreadTarget,
  type HunkRange,
  type ReviewedFile,
} from '../services/pendingReviewRequests'
import { recoveryNonceBatches } from '../services/pendingReviews'

export const REVIEWER_FINDING_SOFT_CAP = 50

export interface UseAgentReviewOptions {
  /** PTY currently visible in the workspace; returning to it triggers recovery. */
  activePtyId: string | null
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
  /** Surface transcript recovery failures without interrupting live delivery. */
  notifyInfo: (message: string) => void
}

const lineInRanges = (line: number, ranges: HunkRange[]): boolean =>
  ranges.some((range) => line >= range.start && line <= range.end)

const rangeInSameHunk = (
  startLine: number,
  endLine: number,
  ranges: HunkRange[]
): boolean =>
  ranges.some(
    (range) =>
      startLine >= range.start &&
      startLine <= range.end &&
      endLine >= range.start &&
      endLine <= range.end
  )

const findingInRanges = (
  finding: AgentReviewFinding,
  file: ReviewedFile
): boolean => {
  const ranges = finding.side === 'deletions' ? file.deletions : file.additions

  return finding.scope === 'range'
    ? finding.startLine !== null &&
        finding.endLine !== null &&
        rangeInSameHunk(finding.startLine, finding.endLine, ranges)
    : finding.line !== null && lineInRanges(finding.line, ranges)
}

/**
 * Picks which snapshot entry a finding belongs to (VIM-327 spec §2): with the
 * path in both halves, the half whose ranges contain the target wins; both,
 * neither, or scope:"file" prefer unstaged (the working tree is where the
 * user acts). Selection and in-hunk determination are one question.
 */
const resolveFindingEntry = (
  snapshot: ReviewedFile[],
  finding: AgentReviewFinding
): { entry: ReviewedFile; targetInHunk: boolean } | undefined => {
  const candidates = snapshot.filter((file) => file.path === finding.path)

  if (candidates.length === 0) {
    return undefined
  }

  if (finding.scope !== 'file') {
    const matches = candidates.filter((file) => findingInRanges(finding, file))

    if (matches.length === 1) {
      return { entry: matches[0], targetInHunk: true }
    }
  }

  const preferred = candidates.find((file) => !file.staged) ?? candidates[0]

  return {
    entry: preferred,
    targetInHunk:
      finding.scope !== 'file' && findingInRanges(finding, preferred),
  }
}

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
 * (never dropped). A malformed event degrades to one concise review-level note. The
 * request is cleared after processing so a replay is a no-op. It never throws.
 */
export const useAgentReview = ({
  activePtyId,
  addAnnotationForOwner,
  nextCommentId,
  notifyInfo,
}: UseAgentReviewOptions): void => {
  const handleReview = useCallback(
    (event: AgentReviewEvent): void => {
      const reviewerAnnotation = (
        finding: AgentReviewFinding,
        reviewer: string,
        downgradeToFile: boolean
      ): DiffLineAnnotation<ReviewComment> => {
        const id = nextCommentId()

        const metadata: ReviewComment = {
          id,
          threadId: id,
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

      const request = getPendingReviewRequest(event.nonce ?? '')
      // The nonce is the whole gate: we only act on a review whose nonce matches
      // one we minted. It's random + unguessable, so this holds equally for a
      // review we delegated to a pane and one you copied and pasted into any
      // agent — no session check, and the copy path needs no pty id.
      if (request === undefined || event.nonce === null) {
        return
      }

      const reviewer = event.reviewer ?? 'Reviewer'
      const { ownerKey, cwd, diffSnapshot, nonce } = request

      // Malformed marker, or a valid-but-empty clean review.
      if (event.findings === null) {
        addReviewLevelNote(ownerKey, {
          commentId: nextCommentId(),
          reviewer,
          text: 'The reviewer returned an invalid structured review. Request another review to retry.',
          nonce,
        })
        clearPendingReviewRequest(event.nonce)

        return
      }

      const findingsToPlace = event.findings.slice(0, REVIEWER_FINDING_SOFT_CAP)
      const omittedCount = event.findings.length - findingsToPlace.length

      // Each placed finding becomes a thread root the main agent can post into
      // (VIM-304 PR-3): its 1-based block ordinal maps to where it landed.
      // Cap-omitted findings have no entry — they were never placed.
      const byOrdinal = new Map<number, FindingThreadTarget>()

      for (const finding of findingsToPlace) {
        const { ordinal } = finding
        const resolved = resolveFindingEntry(diffSnapshot, finding)

        // path not in the reviewed diff → no (path, staged) row to anchor under.
        if (resolved === undefined) {
          const commentId = nextCommentId()
          addReviewLevelNote(ownerKey, {
            commentId,
            reviewer,
            text: finding.text,
            nonce,
          })
          byOrdinal.set(ordinal, { kind: 'reviewLevel', commentId })
          continue
        }

        const downgradeToFile =
          finding.scope !== 'file' && !resolved.targetInHunk

        const annotation = reviewerAnnotation(
          finding,
          reviewer,
          downgradeToFile
        )
        addAnnotationForOwner(
          ownerKey,
          cwd,
          finding.path,
          resolved.entry.staged,
          annotation
        )

        byOrdinal.set(ordinal, {
          kind: 'anchored',
          commentId: annotation.metadata.id,
          handle: {
            cwd,
            filePath: finding.path,
            staged: resolved.entry.staged,
            lineNumber: annotation.lineNumber,
            side: annotation.side,
            target: annotation.metadata.target,
            threadId: annotation.metadata.threadId ?? annotation.metadata.id,
          },
        })
      }

      if (omittedCount > 0) {
        addReviewLevelNote(ownerKey, {
          commentId: nextCommentId(),
          reviewer,
          text: `${omittedCount} additional reviewer findings were omitted because this review exceeded the ${REVIEWER_FINDING_SOFT_CAP}-finding display limit.`,
          nonce,
        })
      }

      if (event.omittedFindingCount > 0) {
        addReviewLevelNote(ownerKey, {
          commentId: nextCommentId(),
          reviewer,
          text: `${event.omittedFindingCount} malformed reviewer finding${event.omittedFindingCount === 1 ? ' was' : 's were'} omitted.`,
          nonce,
        })
      }

      // Transition (not merely clear): the request becomes the finding-thread
      // record so `target:'finding'` replies can resolve; a replayed
      // `agent-review` still finds no pending request and is a no-op.
      if (byOrdinal.size > 0) {
        setFindingThreadRecord({
          ptyId: event.sessionId,
          nonce,
          ownerKey,
          byOrdinal,
          seenReplies: new Set(),
        })
      }
      clearPendingReviewRequest(event.nonce)
    },
    [addAnnotationForOwner, nextCommentId]
  )

  const recoverPty = useCallback(
    async (ptyId: string, isCancelled: () => boolean): Promise<void> => {
      const nonces = pendingReviewRequestNoncesForPty(ptyId)
      if (nonces.length === 0) {
        return
      }

      try {
        for (const batch of recoveryNonceBatches(nonces)) {
          const reviews = await invoke<AgentReviewEvent[]>(
            'recover_agent_reviews',
            {
              sessionId: ptyId,
              nonces: batch,
            }
          )
          if (!isCancelled()) {
            reviews.forEach(handleReview)
          }
        }
      } catch {
        if (!isCancelled()) {
          notifyInfo(
            'Could not recover agent reviews; live delivery is still active.'
          )
        }
      }
    },
    [handleReview, notifyInfo]
  )

  useEffect(() => {
    if (!isDesktop()) {
      return undefined
    }

    let cancelled = false
    const unlisten: (() => void)[] = []

    const addUnlisten = (fn: () => void): void => {
      if (cancelled) {
        fn()
      } else {
        unlisten.push(fn)
      }
    }

    const subscribe = async (): Promise<void> => {
      addUnlisten(await listen<AgentReviewEvent>('agent-review', handleReview))
      // The summary is the watcher's replay→live boundary. A final targeted
      // scan here closes the window between the pane-activation scan and EOF.
      addUnlisten(
        await listen<AgentReplaySummaryEvent>(
          'agent-replay-summary',
          (event) => {
            void recoverPty(event.sessionId, () => cancelled)
          }
        )
      )
    }

    void subscribe()

    return (): void => {
      cancelled = true
      unlisten.forEach((fn) => fn())
    }
  }, [handleReview, recoverPty])

  useEffect(() => {
    if (!isDesktop() || activePtyId === null) {
      return undefined
    }

    let cancelled = false
    void recoverPty(activePtyId, () => cancelled)

    return (): void => {
      cancelled = true
    }
  }, [activePtyId, recoverPty])
}
