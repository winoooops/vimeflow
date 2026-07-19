import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { invoke, listen } from '@/lib/backend'
import { isDesktop } from '@/lib/environment'
import type {
  AgentReplyEvent,
  AgentReplyStatus,
  AgentReplaySummaryEvent,
} from '@/bindings'
import type { DiffLineAnnotation } from '@pierre/diffs'
import type { ReviewComment } from './useFeedbackBatch'
import {
  clearPendingReview,
  getPendingReview,
  pendingReviewsRevision,
  pendingNoncesForPty,
  recoveryNonceBatches,
  setPendingReview,
  subscribePendingReviews,
  type PendingReviewHandle,
} from '../services/pendingReviews'
import {
  addReviewLevelNote,
  findingThreadNoncesForPty,
  getFindingThreadRecord,
  reviewRequestStateRevision,
  setFindingThreadRecord,
  subscribeReviewLevelNotes,
  type FindingThreadRecord,
} from '../services/pendingReviewRequests'

/** Identity label for a main-agent turn shown on the review-level surface. */
const AGENT_REVIEW_LEVEL_LABEL = 'Agent'
const MAX_BUFFERED_AGENT_REPLIES = 200

export interface UseAgentReplyOptions {
  /** Buffer live events until durable correlation state has hydrated. */
  enabled?: boolean
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
  /** Fresh unique id for each attached agent annotation. */
  nextCommentId: () => string
  /** Surface transcript recovery failures without interrupting live delivery. */
  notifyInfo: (message: string) => void
}

const handleAgentReply = (
  event: AgentReplyEvent,
  addAnnotationForOwner: UseAgentReplyOptions['addAnnotationForOwner'],
  nextCommentId: UseAgentReplyOptions['nextCommentId']
): boolean => {
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
  const handleFindingTurns = (record: FindingThreadRecord): void => {
    // Malformed marker: degrade to one review-level note; the living thread
    // record survives one garbled turn.
    if (event.replies === null) {
      const turnKey = `raw\u0000${event.rawText}`
      if (record.seenReplies.has(turnKey)) {
        return
      }
      addReviewLevelNote(record.ownerKey, {
        commentId: nextCommentId(),
        reviewer: AGENT_REVIEW_LEVEL_LABEL,
        text: event.rawText,
        nonce: record.nonce,
      })
      record.seenReplies.add(turnKey)
      setFindingThreadRecord(record)

      return
    }

    let changed = false
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
          changed = true
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
      changed = true
    }
    if (changed) {
      setFindingThreadRecord(record)
    }
  }

  if (event.nonce === null) {
    return true
  }

  // The nonce names the dispatch a turn answers: a review nonce resolves
  // against the finding-thread record (same session + nonce gate), a
  // feedback nonce against the pending [#n] handles below.
  const record = getFindingThreadRecord(event.sessionId, event.nonce)
  if (record !== undefined) {
    handleFindingTurns(record)

    return true
  }

  // Session + nonce gate — both are part of the store key (VIM-297), so
  // only a reply echoing a live dispatch's nonce on its own pty resolves.
  const pending = getPendingReview(event.sessionId, event.nonce)
  if (pending === undefined) {
    return false
  }

  const matched = (event.replies ?? []).filter((reply) =>
    pending.byHandle.has(reply.id)
  )

  if (event.replies !== null && matched.length > 0) {
    const consumedHandles = pending.consumedHandles ?? new Set<number>()
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
        consumedHandles.add(reply.id)
      }
    }
    pending.consumedHandles = consumedHandles

    if (pending.byHandle.size === 0) {
      clearPendingReview(event.sessionId, event.nonce)
    } else {
      setPendingReview(pending)
    }

    return true
  }

  if (
    event.replies !== null &&
    event.replies.length > 0 &&
    event.replies.some(
      (reply) => pending.consumedHandles?.has(reply.id) === true
    )
  ) {
    return true
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

      return true
    }
  }
  clearPendingReview(event.sessionId, event.nonce)

  return true
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
  enabled = true,
  activePtyId,
  addAnnotationForOwner,
  nextCommentId,
  notifyInfo,
}: UseAgentReplyOptions): void => {
  const enabledRef = useRef(enabled)
  const queuedRepliesRef = useRef<AgentReplyEvent[]>([])
  enabledRef.current = enabled
  const pendingReviewRevision = useSyncExternalStore(
    subscribePendingReviews,
    pendingReviewsRevision,
    pendingReviewsRevision
  )
  const findingThreadRevision = useSyncExternalStore(
    subscribeReviewLevelNotes,
    reviewRequestStateRevision,
    reviewRequestStateRevision
  )

  const queueReply = useCallback((event: AgentReplyEvent): void => {
    if (event.nonce === null) {
      return
    }
    if (queuedRepliesRef.current.length >= MAX_BUFFERED_AGENT_REPLIES) {
      queuedRepliesRef.current.shift()
    }
    queuedRepliesRef.current.push(event)
  }, [])

  const handleReply = useCallback(
    (event: AgentReplyEvent): void => {
      if (!enabledRef.current) {
        queueReply(event)

        return
      }

      if (!handleAgentReply(event, addAnnotationForOwner, nextCommentId)) {
        queueReply(event)
      }
    },
    [addAnnotationForOwner, nextCommentId, queueReply]
  )

  useEffect(() => {
    if (!enabled) {
      return
    }

    const queued = queuedRepliesRef.current.splice(0)
    queued.forEach(handleReply)
  }, [enabled, findingThreadRevision, handleReply, pendingReviewRevision])

  const recoverPty = useCallback(
    async (ptyId: string, isCancelled: () => boolean): Promise<void> => {
      const nonces = [
        ...new Set([
          ...pendingNoncesForPty(ptyId),
          ...findingThreadNoncesForPty(ptyId),
        ]),
      ]
      if (nonces.length === 0) {
        return
      }

      try {
        for (const batch of recoveryNonceBatches(nonces)) {
          const replies = await invoke<AgentReplyEvent[]>(
            'recover_agent_replies',
            {
              sessionId: ptyId,
              nonces: batch,
            }
          )
          if (!isCancelled()) {
            replies.forEach(handleReply)
          }
        }
      } catch {
        if (!isCancelled()) {
          notifyInfo(
            'Could not recover agent replies; live delivery is still active.'
          )
        }
      }
    },
    [handleReply, notifyInfo]
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
      addUnlisten(await listen<AgentReplyEvent>('agent-reply', handleReply))
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
  }, [handleReply, recoverPty])

  useEffect(() => {
    if (!isDesktop() || !enabled || activePtyId === null) {
      return undefined
    }

    let cancelled = false
    void recoverPty(activePtyId, () => cancelled)

    return (): void => {
      cancelled = true
    }
  }, [activePtyId, enabled, recoverPty])
}
