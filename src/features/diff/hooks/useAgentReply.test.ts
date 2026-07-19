import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Mock } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { DiffLineAnnotation } from '@pierre/diffs'
import { invoke, listen } from '@/lib/backend'
import type { BackendApi } from '@/lib/backend'
import type { AgentReplyEvent, AgentReplaySummaryEvent } from '@/bindings'
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

vi.mock('@/lib/backend', () => ({ invoke: vi.fn(), listen: vi.fn() }))

const emit = async (event: AgentReplyEvent): Promise<void> => {
  // Let the async listen() promise resolve so the callback is registered.
  await Promise.resolve()
  for (const cb of listeners.get('agent-reply') ?? []) {
    cb(event)
  }
}

const emitReplayBoundary = async (
  event: AgentReplaySummaryEvent
): Promise<void> => {
  await Promise.resolve()
  for (const cb of listeners.get('agent-replay-summary') ?? []) {
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

const mount = (activePtyId: string | null = null): void => {
  renderHook(() =>
    useAgentReply({
      activePtyId,
      addAnnotationForOwner,
      nextCommentId: () => `agent-${(ids += 1)}`,
      notifyInfo: vi.fn(),
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
  vi.mocked(invoke).mockReset()
  vi.mocked(invoke).mockResolvedValue([])
  vi.mocked(listen).mockClear()
  vi.mocked(listen).mockImplementation(listenImpl as unknown as typeof listen)
})

afterEach(() => {
  clearPendingReview('pty-1', 'abc')
  clearPendingReview('pty-1', 'xyz')
  for (let index = 0; index < 51; index += 1) {
    clearPendingReview('pty-1', `nonce-${index}`)
  }
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
  test('recovers pending replies for the active pty through the live handler', async () => {
    setPendingReview(pending(new Map([[1, handle()]])))
    vi.mocked(invoke).mockResolvedValueOnce([
      event({
        replies: [
          {
            id: 1,
            status: 'resolved',
            target: 'comment',
            text: 'Recovered after pane switch.',
          },
        ],
      }),
    ])

    const { rerender } = renderHook(
      ({ activePtyId }: { activePtyId: string }) =>
        useAgentReply({
          activePtyId,
          addAnnotationForOwner,
          nextCommentId: () => `agent-${(ids += 1)}`,
          notifyInfo: vi.fn(),
        }),
      { initialProps: { activePtyId: 'pty-2' } }
    )

    await Promise.resolve()
    expect(invoke).not.toHaveBeenCalled()

    // Returning from pane B to the dispatching pane A triggers the scan.
    rerender({ activePtyId: 'pty-1' })

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('recover_agent_replies', {
        sessionId: 'pty-1',
        nonces: ['abc'],
      })
    )
    await waitFor(() => expect(addAnnotationForOwner).toHaveBeenCalledOnce())
    expect(addAnnotationForOwner.mock.calls[0][4].metadata.text).toBe(
      'Recovered after pane switch.'
    )

    // The recovery result consumes the same pending handle, so a concurrent
    // live delivery of the same event cannot attach it twice.
    await emit(
      event({
        replies: [
          {
            id: 1,
            status: 'resolved',
            target: 'comment',
            text: 'Recovered after pane switch.',
          },
        ],
      })
    )
    expect(addAnnotationForOwner).toHaveBeenCalledOnce()

    // Further pane switches find no pending nonce and do not scan or re-attach.
    rerender({ activePtyId: 'pty-2' })
    rerender({ activePtyId: 'pty-1' })
    await Promise.resolve()
    expect(invoke).toHaveBeenCalledOnce()
  })

  test('does not scan a transcript when the active pty has no pending nonce', async () => {
    mount('pty-1')
    await Promise.resolve()

    expect(invoke).not.toHaveBeenCalled()
  })

  test('scans again after the watcher reaches the replay boundary', async () => {
    setPendingReview(pending(new Map([[1, handle()]])))
    vi.mocked(invoke)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        event({
          replies: [
            {
              id: 1,
              status: 'resolved',
              target: 'comment',
              text: 'Recovered at catch-up.',
            },
          ],
        }),
      ])
    mount('pty-1')

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
    await emitReplayBoundary({
      sessionId: 'pty-1',
      numTurns: 1,
      cwd: null,
      toolCallTotal: 0,
      toolCallByType: {},
      recentToolCalls: [],
    })

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(addAnnotationForOwner).toHaveBeenCalledOnce())
    expect(addAnnotationForOwner.mock.calls[0][4].metadata.text).toBe(
      'Recovered at catch-up.'
    )
  })

  test('chunks recovery requests to the backend limit', async () => {
    for (let index = 0; index < 51; index += 1) {
      setPendingReview({
        ...pending(new Map([[1, handle()]])),
        nonce: `nonce-${index}`,
      })
    }

    mount('pty-1')

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
    expect(vi.mocked(invoke).mock.calls[0][1]).toMatchObject({
      sessionId: 'pty-1',
      nonces: expect.arrayContaining(['nonce-0', 'nonce-49']),
    })

    expect(
      (vi.mocked(invoke).mock.calls[0][1] as { nonces: string[] }).nonces
    ).toHaveLength(50)

    expect(
      (vi.mocked(invoke).mock.calls[1][1] as { nonces: string[] }).nonces
    ).toHaveLength(1)
  })

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

  test('ignores an event whose nonce matches no in-flight dispatch', async () => {
    setPendingReview(pending(new Map([[1, handle()]])))
    mount()
    // Its #1 collides with a pending handle, but the nonce names no record.
    await emit(
      event({
        nonce: 'stale',
        replies: [{ id: 1, status: 'reply', target: 'comment', text: 'x' }],
      })
    )

    expect(addAnnotationForOwner).not.toHaveBeenCalled()
  })

  test('two concurrent dispatches each correlate their own reply (VIM-297)', async () => {
    setPendingReview(pending(new Map([[1, handle({ lineNumber: 5 })]])))
    setPendingReview({
      ...pending(new Map([[1, handle({ lineNumber: 9 })]])),
      nonce: 'xyz',
    })
    mount()

    // The SECOND dispatch's reply arrives first — it must hit its own record,
    // not clobber or shadow the first dispatch's correlation.
    await emit(
      event({
        nonce: 'xyz',
        replies: [{ id: 1, status: 'reply', target: 'comment', text: 'B' }],
      })
    )

    await emit(
      event({
        nonce: 'abc',
        replies: [{ id: 1, status: 'resolved', target: 'comment', text: 'A' }],
      })
    )

    expect(addAnnotationForOwner).toHaveBeenCalledTimes(2)
    expect(addAnnotationForOwner.mock.calls[0][4].lineNumber).toBe(9)
    expect(addAnnotationForOwner.mock.calls[0][4].metadata.text).toBe('B')
    expect(addAnnotationForOwner.mock.calls[1][4].lineNumber).toBe(5)
    expect(addAnnotationForOwner.mock.calls[1][4].metadata.text).toBe('A')
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

    // Recovery replays the whole mixed event. Seeing a consumed handle makes
    // it a no-op even though the original unknown id is still present.
    await emit(
      event({
        replies: [
          { id: 1, status: 'reply', target: 'comment', text: 'A' },
          { id: 99, status: 'reply', target: 'comment', text: 'ignored' },
        ],
      })
    )
    expect(addAnnotationForOwner).toHaveBeenCalledTimes(1)
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

    // Transcript recovery may replay the already-consumed partial turn while
    // #2 is still pending. It must remain a no-op, not degrade raw text onto #2.
    await emit(
      event({
        replies: [{ id: 1, status: 'reply', target: 'comment', text: 'A' }],
      })
    )
    expect(addAnnotationForOwner).toHaveBeenCalledTimes(1)

    await emit(
      event({
        replies: [{ id: 2, status: 'resolved', target: 'comment', text: 'B' }],
      })
    )

    expect(addAnnotationForOwner).toHaveBeenCalledTimes(2)
    expect(addAnnotationForOwner.mock.calls[1][4].metadata.text).toBe('B')
  })

  test('buffers a live reply until durable correlation hydration completes', async () => {
    setPendingReview(pending(new Map([[1, handle()]])))

    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useAgentReply({
          enabled,
          activePtyId: 'pty-1',
          addAnnotationForOwner,
          nextCommentId: () => `agent-${(ids += 1)}`,
          notifyInfo: vi.fn(),
        }),
      { initialProps: { enabled: false } }
    )

    await emit(
      event({
        replies: [{ id: 1, status: 'reply', target: 'comment', text: 'A' }],
      })
    )
    expect(addAnnotationForOwner).not.toHaveBeenCalled()

    rerender({ enabled: true })

    await waitFor(() => expect(addAnnotationForOwner).toHaveBeenCalledOnce())
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

describe('thread identity in agent replies (VIM-298)', () => {
  test('an agent reply inherits the handle threadId', async () => {
    setPendingReview(
      pending(new Map([[1, handle({ lineNumber: 5, threadId: 'root-1' })]]))
    )
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
    expect(addAnnotationForOwner.mock.calls[0][4].metadata.threadId).toBe(
      'root-1'
    )
  })
})
