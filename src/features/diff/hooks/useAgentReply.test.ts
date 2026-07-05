import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Mock } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { DiffLineAnnotation } from '@pierre/diffs'
import { listen } from '@/lib/backend'
import type { AgentReplyEvent } from '@/bindings'
import { useAgentReply } from './useAgentReply'
import type { ReviewComment } from './useFeedbackBatch'
import {
  clearPendingReview,
  setPendingReview,
  type PendingReview,
  type PendingReviewHandle,
} from '../services/pendingReviews'

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
  addAnnotationForOwner = vi.fn<AddForOwner>(() => 'ok')
  vi.mocked(listen).mockImplementation(listenImpl as unknown as typeof listen)
})

afterEach(() => clearPendingReview('pty-1'))

describe('useAgentReply', () => {
  test('attaches a matched reply to the dispatching owner by [#n]', async () => {
    setPendingReview(pending(new Map([[1, handle()]])))
    mount()
    await emit(
      event({
        replies: [{ id: 1, status: 'answered', text: 'Because latency.' }],
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
  })

  test('ignores an event whose nonce does not match (superseded dispatch)', async () => {
    setPendingReview(pending(new Map([[1, handle()]])))
    mount()
    // A late reply for the old dispatch — its #1 collides but the nonce differs.
    await emit(
      event({
        nonce: 'stale',
        replies: [{ id: 1, status: 'answered', text: 'x' }],
      })
    )

    expect(addAnnotationForOwner).not.toHaveBeenCalled()
  })

  test('ignores an event with no pending record for the session', async () => {
    mount()
    await emit(
      event({
        sessionId: 'other',
        replies: [{ id: 1, status: 'answered', text: 'x' }],
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
        replies: [{ id: 99, status: 'answered', text: 'x' }],
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
          { id: 1, status: 'answered', text: 'A' },
          { id: 99, status: 'answered', text: 'ignored' },
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
    await emit(event({ replies: [{ id: 1, status: 'answered', text: 'A' }] }))
    await emit(event({ replies: [{ id: 2, status: 'changed', text: 'B' }] }))

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
    await emit(event({ replies: [{ id: 1, status: 'answered', text: 'A' }] }))

    expect(addAnnotationForOwner.mock.calls[0][4].metadata.target).toEqual({
      scope: 'file',
    })
  })

  test('a replayed event after handles are consumed is a no-op', async () => {
    setPendingReview(pending(new Map([[1, handle()]])))
    mount()

    const reply = event({
      replies: [{ id: 1, status: 'answered', text: 'A' }],
    })
    await emit(reply)
    await emit(reply) // replay — record was cleared, so nothing happens

    expect(addAnnotationForOwner).toHaveBeenCalledTimes(1)
  })
})
