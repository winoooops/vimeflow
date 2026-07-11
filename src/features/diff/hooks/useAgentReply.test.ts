import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Mock } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { DiffLineAnnotation } from '@pierre/diffs'
import { listen } from '@/lib/backend'
import type { BackendApi } from '@/lib/backend'
import type { AgentReplyEvent } from '@/bindings'
import { useAgentReply } from './useAgentReply'
import type { ReviewComment } from './useFeedbackBatch'
import {
  clearPendingReview,
  setPendingReview,
  type PendingReview,
  type PendingReviewHandle,
} from '../services/pendingReviews'
import {
  clearFindingThreadRecord,
  clearReviewLevelNotes,
  getFindingThreadRecord,
  reviewLevelNotes,
  setFindingThreadRecord,
  type FindingThreadRecord,
} from '../services/pendingReviewRequests'

type AddForOwner = (
  ownerKey: string,
  cwd: string,
  filePath: string,
  staged: boolean,
  annotation: DiffLineAnnotation<ReviewComment>
) => 'ok' | 'cap-reached'

// Minimal listen registry so a test can emit an 'agent-reply' event.
type Cb = (payload: unknown) => void
const listeners = new Map<string, Cb[]>()

const listenImpl = (name: string, cb: Cb): Promise<() => void> => {
  const existing = listeners.get(name) ?? []
  existing.push(cb)
  listeners.set(name, existing)

  return Promise.resolve(() => {
    const list = listeners.get(name) ?? []
    const i = list.indexOf(cb)
    if (i >= 0) {
      list.splice(i, 1)
    }
  })
}

vi.mock('@/lib/backend', () => ({ listen: vi.fn() }))

const emit = async (event: AgentReplyEvent): Promise<void> => {
  // Let the async listen() promise resolve so the callback is registered.
  await Promise.resolve()
  for (const cb of listeners.get('agent-reply') ?? []) {
    cb(event)
  }
}

const handle = (
  overrides: Partial<PendingReviewHandle> = {}
): PendingReviewHandle => ({
  cwd: '/repo',
  filePath: 'a.ts',
  staged: false,
  lineNumber: 5,
  side: 'additions',
  target: undefined,
  ...overrides,
})

const pending = (byHandle: PendingReview['byHandle']): PendingReview => ({
  ptyId: 'pty-1',
  ownerKey: 'owner-a',
  nonce: 'abc',
  dispatchedAt: 1,
  byHandle,
})

const event = (partial: Partial<AgentReplyEvent>): AgentReplyEvent => ({
  sessionId: 'pty-1',
  nonce: 'abc',
  rawText: 'raw reply text',
  replies: null,
  ...partial,
})

let addAnnotationForOwner: Mock<AddForOwner>
let ids = 0

const mount = (): void => {
  renderHook(() =>
    useAgentReply({
      addAnnotationForOwner,
      nextCommentId: () => `agent-${(ids += 1)}`,
    })
  )
}

beforeEach(() => {
  listeners.clear()
  ids = 0
  window.vimeflow = {
    invoke: vi.fn(),
    listen: vi.fn(),
  } as unknown as BackendApi
  addAnnotationForOwner = vi.fn<AddForOwner>(() => 'ok')
  vi.mocked(listen).mockClear()
  vi.mocked(listen).mockImplementation(listenImpl as unknown as typeof listen)
})

afterEach(() => {
  clearPendingReview('pty-1')
  clearFindingThreadRecord('pty-1', 'rev')
  clearReviewLevelNotes('owner-r')
  delete window.vimeflow
})

const findingRecord = (
  overrides: Partial<FindingThreadRecord> = {}
): FindingThreadRecord => ({
  ptyId: 'pty-1',
  nonce: 'rev',
  ownerKey: 'owner-r',
  byOrdinal: new Map([
    [1, { kind: 'anchored', commentId: 'rev-1', handle: handle() }],
    [2, { kind: 'reviewLevel', commentId: 'rev-2' }],
  ]),
  seenReplies: new Set(),
  ...overrides,
})

describe('useAgentReply', () => {
  test('attaches a matched reply to the dispatching owner by [#n]', async () => {
    setPendingReview(pending(new Map([[1, handle()]])))
    mount()
    await emit(
      event({
        replies: [
          {
            id: 1,
            status: 'reply',
            target: 'comment',
            text: 'Because latency.',
          },
        ],
      })
    )

    expect(addAnnotationForOwner).toHaveBeenCalledTimes(1)

    const [ownerKey, cwd, filePath, staged, annotation] =
      addAnnotationForOwner.mock.calls[0]
    expect(ownerKey).toBe('owner-a')
    expect(cwd).toBe('/repo')
    expect(filePath).toBe('a.ts')
    expect(staged).toBe(false)
    expect(annotation.metadata.author).toBe('agent')
    expect(annotation.metadata.text).toBe('Because latency.')
    expect(annotation.lineNumber).toBe(5)
    // The agent turn carries its outcome (VIM-304 PR-3).
    expect(annotation.metadata.outcome).toBe('reply')
  })

  test('ignores an event whose nonce does not match (superseded dispatch)', async () => {
    setPendingReview(pending(new Map([[1, handle()]])))
    mount()
    // A late reply for the old dispatch — its #1 collides but the nonce differs.
    await emit(
      event({
        nonce: 'stale',
        replies: [{ id: 1, status: 'reply', target: 'comment', text: 'x' }],
      })
    )

    expect(addAnnotationForOwner).not.toHaveBeenCalled()
  })

  test('ignores an event with no pending record for the session', async () => {
    mount()
    await emit(
      event({
        sessionId: 'other',
        replies: [{ id: 1, status: 'reply', target: 'comment', text: 'x' }],
      })
    )

    expect(addAnnotationForOwner).not.toHaveBeenCalled()
  })

  test('degrades a malformed marker (replies:null) to one rawText note', async () => {
    setPendingReview(pending(new Map([[1, handle()]])))
    mount()
    await emit(event({ replies: null, rawText: 'sorry, could not parse' }))

    expect(addAnnotationForOwner).toHaveBeenCalledTimes(1)
    expect(addAnnotationForOwner.mock.calls[0][4].metadata.text).toBe(
      'sorry, could not parse'
    )
  })

  test('degrades when no reply id matches, anchored to the lowest pending handle', async () => {
    setPendingReview(
      pending(
        new Map([
          [2, handle({ lineNumber: 8 })],
          [3, handle({ lineNumber: 9 })],
        ])
      )
    )
    mount()
    await emit(
      event({
        rawText: 'note',
        replies: [{ id: 99, status: 'reply', target: 'comment', text: 'x' }],
      })
    )

    // Anchored to handle #2 (lowest), carrying the rawText.
    expect(addAnnotationForOwner).toHaveBeenCalledTimes(1)
    expect(addAnnotationForOwner.mock.calls[0][4].lineNumber).toBe(8)
    expect(addAnnotationForOwner.mock.calls[0][4].metadata.text).toBe('note')
  })

  test('mixed reply attaches valid handles and drops an unknown id', async () => {
    setPendingReview(
      pending(
        new Map([
          [1, handle({ lineNumber: 5 })],
          [2, handle({ lineNumber: 8 })],
        ])
      )
    )
    mount()
    await emit(
      event({
        replies: [
          { id: 1, status: 'reply', target: 'comment', text: 'A' },
          { id: 99, status: 'reply', target: 'comment', text: 'ignored' },
        ],
      })
    )

    expect(addAnnotationForOwner).toHaveBeenCalledTimes(1)
    expect(addAnnotationForOwner.mock.calls[0][4].metadata.text).toBe('A')
  })

  test('partial reply leaves the unanswered handles pending', async () => {
    setPendingReview(
      pending(
        new Map([
          [1, handle({ lineNumber: 5 })],
          [2, handle({ lineNumber: 8 })],
        ])
      )
    )
    mount()
    // Answer only #1; #2 must remain, so a later reply for #2 still attaches.
    await emit(
      event({
        replies: [{ id: 1, status: 'reply', target: 'comment', text: 'A' }],
      })
    )

    await emit(
      event({
        replies: [{ id: 2, status: 'resolved', target: 'comment', text: 'B' }],
      })
    )

    expect(addAnnotationForOwner).toHaveBeenCalledTimes(2)
    expect(addAnnotationForOwner.mock.calls[1][4].metadata.text).toBe('B')
  })

  test('a file-scope reply inherits the file target (not a line-0 annotation)', async () => {
    setPendingReview(
      pending(
        new Map([[1, handle({ lineNumber: 0, target: { scope: 'file' } })]])
      )
    )
    mount()
    await emit(
      event({
        replies: [{ id: 1, status: 'reply', target: 'comment', text: 'A' }],
      })
    )

    expect(addAnnotationForOwner.mock.calls[0][4].metadata.target).toEqual({
      scope: 'file',
    })
  })

  test('keeps a matched reply pending when the attach cap blocks it', async () => {
    addAnnotationForOwner.mockReturnValueOnce('cap-reached')
    setPendingReview(pending(new Map([[1, handle()]])))
    mount()
    await emit(
      event({
        replies: [{ id: 1, status: 'reply', target: 'comment', text: 'A' }],
      })
    )

    addAnnotationForOwner.mockReturnValueOnce('ok')
    await emit(
      event({
        replies: [{ id: 1, status: 'reply', target: 'comment', text: 'A' }],
      })
    )

    expect(addAnnotationForOwner).toHaveBeenCalledTimes(2)
  })

  test('does not subscribe when the Electron bridge is unavailable', () => {
    delete window.vimeflow

    expect(() => {
      mount()
    }).not.toThrow()
    expect(listen).not.toHaveBeenCalled()
  })

  test('a replayed event after handles are consumed is a no-op', async () => {
    setPendingReview(pending(new Map([[1, handle()]])))
    mount()

    const reply = event({
      replies: [{ id: 1, status: 'reply', target: 'comment', text: 'A' }],
    })
    await emit(reply)
    await emit(reply) // replay — record was cleared, so nothing happens

    expect(addAnnotationForOwner).toHaveBeenCalledTimes(1)
  })
})

describe('finding-thread replies (VIM-304 PR-3)', () => {
  test('attaches a target:finding turn at the anchored finding with its outcome', async () => {
    setFindingThreadRecord(findingRecord())
    mount()
    await emit(
      event({
        nonce: 'rev',
        replies: [
          { id: 1, status: 'resolved', target: 'finding', text: 'Fixed it.' },
        ],
      })
    )

    expect(addAnnotationForOwner).toHaveBeenCalledTimes(1)

    const [ownerKey, cwd, filePath, staged, annotation] =
      addAnnotationForOwner.mock.calls[0]
    expect(ownerKey).toBe('owner-r')
    expect(cwd).toBe('/repo')
    expect(filePath).toBe('a.ts')
    expect(staged).toBe(false)
    expect(annotation.lineNumber).toBe(5)
    expect(annotation.side).toBe('additions')
    expect(annotation.metadata.author).toBe('agent')
    expect(annotation.metadata.outcome).toBe('resolved')
    expect(annotation.metadata.text).toBe('Fixed it.')
  })

  test('gates on session: the same nonce from another pty is ignored', async () => {
    setFindingThreadRecord(findingRecord())
    mount()
    await emit(
      event({
        sessionId: 'pty-2',
        nonce: 'rev',
        replies: [
          { id: 1, status: 'resolved', target: 'finding', text: 'Fixed it.' },
        ],
      })
    )

    expect(addAnnotationForOwner).not.toHaveBeenCalled()
  })

  test('a reviewLevel-target turn lands as a review-level note with outcome', async () => {
    setFindingThreadRecord(findingRecord())
    mount()
    await emit(
      event({
        nonce: 'rev',
        replies: [
          {
            id: 2,
            status: 'deferred',
            target: 'finding',
            text: 'Filed as VIM-999.',
          },
        ],
      })
    )

    expect(addAnnotationForOwner).not.toHaveBeenCalled()
    const notes = reviewLevelNotes('owner-r')
    expect(notes).toHaveLength(1)
    expect(notes[0].text).toBe('Filed as VIM-999.')
    expect(notes[0].outcome).toBe('deferred')
  })

  test('an unknown ordinal is skipped without touching the thread', async () => {
    setFindingThreadRecord(findingRecord())
    mount()
    await emit(
      event({
        nonce: 'rev',
        replies: [{ id: 99, status: 'resolved', target: 'finding', text: 'x' }],
      })
    )

    expect(addAnnotationForOwner).not.toHaveBeenCalled()
    expect(reviewLevelNotes('owner-r')).toHaveLength(0)
  })

  test('an exact duplicate turn attaches once; a new turn on the same finding attaches', async () => {
    setFindingThreadRecord(findingRecord())
    mount()

    const turn = event({
      nonce: 'rev',
      replies: [
        { id: 1, status: 'clarify', target: 'finding', text: 'Which env?' },
      ],
    })
    await emit(turn)
    await emit(turn) // replay of the same turn — no duplicate

    expect(addAnnotationForOwner).toHaveBeenCalledTimes(1)
    expect(addAnnotationForOwner.mock.calls[0][4].metadata.outcome).toBe(
      'clarify'
    )

    // The thread lives on: a later different turn attaches.
    await emit(
      event({
        nonce: 'rev',
        replies: [
          { id: 1, status: 'resolved', target: 'finding', text: 'Done.' },
        ],
      })
    )

    expect(addAnnotationForOwner).toHaveBeenCalledTimes(2)
    expect(getFindingThreadRecord('pty-1', 'rev')).toBeDefined()
  })

  test('a malformed marker with a review nonce degrades to one review-level note', async () => {
    setFindingThreadRecord(findingRecord())
    mount()
    await emit(event({ nonce: 'rev', replies: null, rawText: 'garbled block' }))

    expect(addAnnotationForOwner).not.toHaveBeenCalled()
    const notes = reviewLevelNotes('owner-r')
    expect(notes).toHaveLength(1)
    expect(notes[0].text).toBe('garbled block')
    // The record is NOT consumed — the thread can still continue.
    expect(getFindingThreadRecord('pty-1', 'rev')).toBeDefined()
  })

  test('target:comment replies never resolve against the finding space', async () => {
    setFindingThreadRecord(findingRecord())
    mount()
    await emit(
      event({
        nonce: 'rev',
        replies: [{ id: 1, status: 'reply', target: 'comment', text: 'x' }],
      })
    )

    expect(addAnnotationForOwner).not.toHaveBeenCalled()
  })
})
