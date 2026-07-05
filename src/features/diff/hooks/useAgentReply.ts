import { useEffect } from 'react'
import { listen } from '@/lib/backend'
import type { AgentReplyEvent } from '@/bindings'
import type { DiffLineAnnotation } from '@pierre/diffs'
import type { ReviewComment } from './useFeedbackBatch'
import {
  clearPendingReview,
  getPendingReview,
  setPendingReview,
  type PendingReviewHandle,
} from '../services/pendingReviews'

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
    let cancelled = false
    let unlisten: (() => void) | undefined

    const attachAgentNote = (
      ownerKey: string,
      handle: PendingReviewHandle,
      text: string
    ): void => {
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
          },
        }
      )
    }

    const handleReply = (event: AgentReplyEvent): void => {
      const pending = getPendingReview(event.sessionId)
      // Session + nonce gate: only a reply to the current dispatch proceeds.
      if (
        pending === undefined ||
        event.nonce === null ||
        event.nonce !== pending.nonce
      ) {
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

          attachAgentNote(pending.ownerKey, handle, reply.text)
          pending.byHandle.delete(reply.id) // consume so a replay can't re-attach
        }

        if (pending.byHandle.size === 0) {
          clearPendingReview(event.sessionId)
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
        attachAgentNote(pending.ownerKey, anchor, event.rawText)
      }
      clearPendingReview(event.sessionId)
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
