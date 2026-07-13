import { useEffect } from 'react'
import { listen } from '@/lib/backend'
import { isDesktop } from '@/lib/environment'
import type { AgentReplyEvent, AgentReplyStatus } from '@/bindings'
import type { DiffLineAnnotation } from '@pierre/diffs'
import type { ReviewComment } from './useFeedbackBatch'
import {
  clearPendingReview,
  getPendingReview,
  setPendingReview,
  type PendingReviewHandle,
} from '../services/pendingReviews'
import {
  addReviewLevelNote,
  getFindingThreadRecord,
  type FindingThreadRecord,
} from '../services/pendingReviewRequests'

/** Identity label for a main-agent turn shown on the review-level surface. */
const AGENT_REVIEW_LEVEL_LABEL = 'Agent'

export interface UseAgentReplyOptions {
  /** Attach an annotation onto a specific feedback owner (the dispatching one). */
  addAnnotationForOwner: (
    ownerKey: string,
    cwd: string,
    filePath: string,
    staged: boolean,
    annotation: DiffLineAnnotation<ReviewComment>
  ) => 'ok' | 'cap-reached'
  /** Fresh unique id for each attached agent annotation. */
  nextCommentId: () => string
}

/**
 * Captures the backend `agent-reply` event (VIM-283) and attaches the reply to
 * the review that dispatched it (VIM-249). Mounts once where all feedback owners
 * are reachable (WorkspaceView) so it can attach onto the dispatching owner even
 * after the user switches panes.
 *
 * The gate — session id AND nonce must match the pending record — means a stray
 * sentinel or a reply to a superseded dispatch cannot mutate the thread. Matched
 * handles are consumed and the record is cleared when done, so a replayed event
 * is a no-op. Every malformed / unmatched path degrades to one plain-text note;
 * it never throws.
 */
export const useAgentReply = ({
  addAnnotationForOwner,
  nextCommentId,
}: UseAgentReplyOptions): void => {
  useEffect(() => {
    if (!isDesktop()) {
      return undefined
    }

    let cancelled = false
    let unlisten: (() => void) | undefined

    const attachAgentNote = (
      ownerKey: string,
      handle: PendingReviewHandle,
      text: string,
      outcome?: AgentReplyStatus
    ): 'ok' | 'cap-reached' =>
      addAnnotationForOwner(
        ownerKey,
        handle.cwd,
        handle.filePath,
        handle.staged,
        {
          side: handle.side,
          lineNumber: handle.lineNumber,
          metadata: {
            id: nextCommentId(),
            text,
            author: 'agent',
            createdAt: Date.now(),
            // Inherit the original comment's scope so a file-level reply stays
            // file-scoped and a range reply keeps its span (VIM-249).
            ...(handle.target === undefined ? {} : { target: handle.target }),
            ...(handle.threadId === undefined
              ? {}
              : { threadId: handle.threadId }),
            ...(outcome === undefined ? {} : { outcome }),
          },
        }
      )

    // A turn posted into a delegated finding's thread (VIM-304 PR-3). The
    // record is never consumed — threads are multi-turn — so an exact
    // duplicate turn is the replay no-op instead.
    const handleFindingTurns = (
      record: FindingThreadRecord,
      event: AgentReplyEvent
    ): void => {
      // Malformed marker: degrade to one review-level note; the living thread
      // record survives one garbled turn.
      if (event.replies === null) {
        addReviewLevelNote(record.ownerKey, {
          commentId: nextCommentId(),
          reviewer: AGENT_REVIEW_LEVEL_LABEL,
          text: event.rawText,
          nonce: record.nonce,
        })

        return
      }

      for (const reply of event.replies) {
        if (reply.target !== 'finding') {
          continue
        }

        const target = record.byOrdinal.get(reply.id)
        if (target === undefined) {
          continue
        }

        const turnKey = `${reply.id}\u0000${reply.status}\u0000${reply.text}`
        if (record.seenReplies.has(turnKey)) {
          continue
        }

        if (target.kind === 'anchored') {
          const result = attachAgentNote(
            record.ownerKey,
            target.handle,
            reply.text,
            reply.status
          )
          if (result === 'ok') {
            record.seenReplies.add(turnKey)
          }
          continue
        }

        addReviewLevelNote(record.ownerKey, {
          commentId: nextCommentId(),
          reviewer: AGENT_REVIEW_LEVEL_LABEL,
          text: reply.text,
          nonce: record.nonce,
          outcome: reply.status,
        })
        record.seenReplies.add(turnKey)
      }
    }

    const handleReply = (event: AgentReplyEvent): void => {
      if (event.nonce === null) {
        return
      }

      // The nonce names the dispatch a turn answers: a review nonce resolves
      // against the finding-thread record (same session + nonce gate), a
      // feedback nonce against the pending [#n] handles below.
      const record = getFindingThreadRecord(event.sessionId, event.nonce)
      if (record !== undefined) {
        handleFindingTurns(record, event)

        return
      }

      // Session + nonce gate — both are part of the store key (VIM-297), so
      // only a reply echoing a live dispatch's nonce on its own pty resolves.
      const pending = getPendingReview(event.sessionId, event.nonce)
      if (pending === undefined) {
        return
      }

      const matched = (event.replies ?? []).filter((reply) =>
        pending.byHandle.has(reply.id)
      )

      if (event.replies !== null && matched.length > 0) {
        for (const reply of matched) {
          const handle = pending.byHandle.get(reply.id)
          if (handle === undefined) {
            continue
          }

          const result = attachAgentNote(
            pending.ownerKey,
            handle,
            reply.text,
            reply.status
          )
          if (result === 'ok') {
            pending.byHandle.delete(reply.id) // consume so a replay can't re-attach
          }
        }

        if (pending.byHandle.size === 0) {
          clearPendingReview(event.sessionId, event.nonce)
        } else {
          setPendingReview(pending)
        }

        return
      }

      // Malformed marker (replies === null) OR every id unmatched → degrade: one
      // plain-text note anchored to the lowest still-pending handle, then clear
      // the record so the terminal degrade can't be replayed.
      const lowestId = Math.min(...pending.byHandle.keys())
      const anchor = pending.byHandle.get(lowestId)
      if (anchor !== undefined) {
        const result = attachAgentNote(pending.ownerKey, anchor, event.rawText)
        if (result === 'cap-reached') {
          setPendingReview(pending)

          return
        }
      }
      clearPendingReview(event.sessionId, event.nonce)
    }

    const subscribe = async (): Promise<void> => {
      const fn = await listen<AgentReplyEvent>('agent-reply', handleReply)
      // Mount → unmount before the listen promise resolved: unsubscribe now.
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
