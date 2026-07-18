import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Mock } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { DiffLineAnnotation } from '@pierre/diffs'
import { invoke, listen } from '@/lib/backend'
import type { BackendApi } from '@/lib/backend'
import type {
  AgentReplaySummaryEvent,
  AgentReviewEvent,
  AgentReviewFinding,
} from '@/bindings'
import { REVIEWER_FINDING_SOFT_CAP, useAgentReview } from './useAgentReview'
import type { ReviewComment } from './useFeedbackBatch'
import {
  clearFindingThreadRecord,
  clearPendingReviewRequest,
  clearReviewLevelNotes,
  getFindingThreadRecord,
  reviewLevelNotes,
  setPendingReviewRequest,
  type PendingReviewRequest,
} from '../services/pendingReviewRequests'

type AddForOwner = (
  ownerKey: string,
  cwd: string,
  filePath: string,
  staged: boolean,
  annotation: DiffLineAnnotation<ReviewComment>
) => 'ok' | 'cap-reached'

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

const emit = async (event: AgentReviewEvent): Promise<void> => {
  await Promise.resolve()
  for (const cb of listeners.get('agent-review') ?? []) {
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

const request = (
  overrides: Partial<PendingReviewRequest> = {}
): PendingReviewRequest => ({
  nonce: 'abc',
  ownerKey: 'owner',
  cwd: '/repo',
  diffSnapshot: [
    {
      path: 'a.ts',
      staged: false,
      additions: [{ start: 40, end: 50 }],
      deletions: [{ start: 5, end: 8 }],
    },
  ],
  dispatchedAt: 1,
  ...overrides,
})

const finding = (o: Partial<AgentReviewFinding> = {}): AgentReviewFinding => ({
  scope: 'line',
  path: 'a.ts',
  side: 'additions',
  line: 42,
  startLine: null,
  endLine: null,
  category: 'bug',
  text: 'x',
  ...o,
})

const event = (o: Partial<AgentReviewEvent> = {}): AgentReviewEvent => ({
  sessionId: 'pty-1',
  nonce: 'abc',
  reviewer: 'codex',
  rawText: 'raw block',
  findings: [],
  ...o,
})

let addAnnotationForOwner: Mock<AddForOwner>
let ids = 0

const mount = (activePtyId: string | null = null): void => {
  renderHook(() =>
    useAgentReview({
      activePtyId,
      addAnnotationForOwner,
      nextCommentId: () => `rev-${(ids += 1)}`,
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
  clearPendingReviewRequest('abc')
  clearReviewLevelNotes('owner')
  clearFindingThreadRecord('pty-1', 'abc')
  delete window.vimeflow
})

describe('useAgentReview', () => {
  test('recovers a completed review when returning to its pty', async () => {
    setPendingReviewRequest(request({ ptyId: 'pty-1' }))
    vi.mocked(invoke).mockResolvedValueOnce([
      event({ findings: [finding({ text: 'Recovered finding.' })] }),
    ])

    const { rerender } = renderHook(
      ({ activePtyId }: { activePtyId: string }) =>
        useAgentReview({
          activePtyId,
          addAnnotationForOwner,
          nextCommentId: () => `rev-${(ids += 1)}`,
          notifyInfo: vi.fn(),
        }),
      { initialProps: { activePtyId: 'pty-2' } }
    )

    await Promise.resolve()
    expect(invoke).not.toHaveBeenCalled()

    rerender({ activePtyId: 'pty-1' })

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('recover_agent_reviews', {
        sessionId: 'pty-1',
        nonces: ['abc'],
      })
    )
    await waitFor(() => expect(addAnnotationForOwner).toHaveBeenCalledOnce())
    expect(addAnnotationForOwner.mock.calls[0][4].metadata.text).toBe(
      'Recovered finding.'
    )

    await emit(event({ findings: [finding({ text: 'Recovered finding.' })] }))
    expect(addAnnotationForOwner).toHaveBeenCalledOnce()
  })

  test('scans again after the watcher reaches the replay boundary', async () => {
    setPendingReviewRequest(request({ ptyId: 'pty-1' }))
    vi.mocked(invoke)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        event({ findings: [finding({ text: 'Recovered at catch-up.' })] }),
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

  test('ignores an event with no pending request for the nonce', async () => {
    mount()
    await emit(event({ nonce: 'nope', findings: [finding()] }))
    expect(addAnnotationForOwner).not.toHaveBeenCalled()
  })

  test('accepts a matching nonce from any session (the nonce is the whole gate)', async () => {
    // No session/pty gating: whether the review was delegated to a pane or
    // copied and pasted into some other agent, a matching nonce is enough.
    setPendingReviewRequest(request())
    mount()
    await emit(event({ sessionId: 'some-other-pane', findings: [finding()] }))
    expect(addAnnotationForOwner).toHaveBeenCalledTimes(1)
  })

  test('places a line finding on the dispatching owner with reviewer + category', async () => {
    setPendingReviewRequest(request())
    mount()
    await emit(event({ findings: [finding({ line: 42 })] }))

    expect(addAnnotationForOwner).toHaveBeenCalledTimes(1)

    const [ownerKey, cwd, path, staged, annotation] =
      addAnnotationForOwner.mock.calls[0]
    expect(ownerKey).toBe('owner')
    expect(cwd).toBe('/repo')
    expect(path).toBe('a.ts')
    expect(staged).toBe(false)
    expect(annotation.lineNumber).toBe(42)
    expect(annotation.side).toBe('additions')
    expect(annotation.metadata.author).toBe('reviewer')
    expect(annotation.metadata.reviewer).toBe('codex')
    expect(annotation.metadata.category).toBe('bug')
    expect(annotation.metadata.target).toBeUndefined()
  })

  test('places a range finding with a range target', async () => {
    setPendingReviewRequest(request())
    mount()
    await emit(
      event({
        findings: [
          finding({ scope: 'range', line: null, startLine: 41, endLine: 48 }),
        ],
      })
    )

    const annotation = addAnnotationForOwner.mock.calls[0][4]
    expect(annotation.metadata.target).toEqual({
      scope: 'range',
      side: 'additions',
      startLine: 41,
      endLine: 48,
    })
  })

  test('downgrades a range finding with no end line to file-level', async () => {
    setPendingReviewRequest(request())
    mount()
    await emit(
      event({
        findings: [
          finding({ scope: 'range', line: null, startLine: 41, endLine: null }),
        ],
      })
    )

    const annotation = addAnnotationForOwner.mock.calls[0][4]
    expect(annotation.lineNumber).toBe(0)
    expect(annotation.metadata.target).toEqual({ scope: 'file' })
  })

  test('downgrades a range finding whose end line leaves the hunk', async () => {
    setPendingReviewRequest(request())
    mount()
    await emit(
      event({
        findings: [
          finding({ scope: 'range', line: null, startLine: 41, endLine: 999 }),
        ],
      })
    )

    const annotation = addAnnotationForOwner.mock.calls[0][4]
    expect(annotation.lineNumber).toBe(0)
    expect(annotation.metadata.target).toEqual({ scope: 'file' })
  })

  test('places a file finding as a file-scope note', async () => {
    setPendingReviewRequest(request())
    mount()
    await emit(
      event({
        findings: [finding({ scope: 'file', side: null, line: null })],
      })
    )

    const annotation = addAnnotationForOwner.mock.calls[0][4]
    expect(annotation.metadata.target).toEqual({ scope: 'file' })
    expect(annotation.lineNumber).toBe(0)
  })

  test('downgrades a line finding whose line is outside the hunks to file-level', async () => {
    setPendingReviewRequest(request())
    mount()
    // line 999 is not in the additions range 40-50.
    await emit(event({ findings: [finding({ line: 999 })] }))

    const annotation = addAnnotationForOwner.mock.calls[0][4]
    expect(annotation.metadata.target).toEqual({ scope: 'file' })
  })

  test('sends an off-snapshot path to the review-level surface, not the diff', async () => {
    setPendingReviewRequest(request())
    mount()
    await emit(
      event({ findings: [finding({ path: 'not-in-diff.ts', text: 'orphan' })] })
    )

    expect(addAnnotationForOwner).not.toHaveBeenCalled()
    expect(reviewLevelNotes('owner').map((n) => n.text)).toEqual(['orphan'])
  })

  test('degrades a malformed event (findings:null) to one review-level note', async () => {
    setPendingReviewRequest(request())
    mount()
    await emit(event({ findings: null, reviewer: null, rawText: 'broken' }))

    expect(addAnnotationForOwner).not.toHaveBeenCalled()
    const notes = reviewLevelNotes('owner')
    expect(notes).toHaveLength(1)
    expect(notes[0].text).toBe('broken')
    expect(notes[0].reviewer).toBe('Reviewer') // fallback label
  })

  test('a clean review (empty findings) places nothing and clears the request', async () => {
    setPendingReviewRequest(request())
    mount()
    await emit(event({ findings: [] }))
    // replay: request already cleared → no-op
    await emit(event({ findings: [finding()] }))

    expect(addAnnotationForOwner).not.toHaveBeenCalled()
  })

  test('a replayed event after the request is cleared is a no-op', async () => {
    setPendingReviewRequest(request())
    mount()
    const e = event({ findings: [finding()] })
    await emit(e)
    await emit(e)

    expect(addAnnotationForOwner).toHaveBeenCalledTimes(1)
  })

  test('caps delegated reviewer findings and records one overflow note', async () => {
    setPendingReviewRequest(request())
    mount()
    await emit(
      event({
        findings: Array.from(
          { length: REVIEWER_FINDING_SOFT_CAP + 2 },
          (_, index) => finding({ text: `finding ${index}` })
        ),
      })
    )

    expect(addAnnotationForOwner).toHaveBeenCalledTimes(
      REVIEWER_FINDING_SOFT_CAP
    )

    expect(reviewLevelNotes('owner').map((note) => note.text)).toEqual([
      `2 additional reviewer findings were omitted because this review exceeded the ${REVIEWER_FINDING_SOFT_CAP}-finding display limit.`,
    ])
  })
})

describe('finding-thread transition (VIM-304 PR-3)', () => {
  test('transitions the processed request into a record keyed (ptyId, nonce)', async () => {
    setPendingReviewRequest(request())
    mount()
    await emit(
      event({
        findings: [
          finding(), // line 42, in-hunk → anchored, ordinal 1
          finding({ path: 'other.ts' }), // off-snapshot → review-level, ordinal 2
        ],
      })
    )

    const record = getFindingThreadRecord('pty-1', 'abc')
    expect(record?.ownerKey).toBe('owner')

    const anchored = record?.byOrdinal.get(1)
    expect(anchored?.kind).toBe('anchored')
    if (anchored?.kind === 'anchored') {
      // The record's commentId is the placed annotation's id, so a later
      // reply addresses the exact comment the finding rendered as.
      const placed = addAnnotationForOwner.mock.calls[0][4]
      expect(anchored.commentId).toBe(placed.metadata.id)
      expect(anchored.handle).toEqual({
        cwd: '/repo',
        filePath: 'a.ts',
        staged: false,
        lineNumber: 42,
        side: 'additions',
        target: undefined,
        threadId: placed.metadata.id,
      })
    }

    const reviewLevel = record?.byOrdinal.get(2)
    expect(reviewLevel?.kind).toBe('reviewLevel')
    if (reviewLevel?.kind === 'reviewLevel') {
      expect(reviewLevel.commentId).toBe(reviewLevelNotes('owner')[0].commentId)
    }
  })

  test('an anchored range finding carries its range target into the handle', async () => {
    setPendingReviewRequest(request())
    mount()
    await emit(
      event({
        findings: [
          finding({ scope: 'range', line: null, startLine: 41, endLine: 44 }),
        ],
      })
    )

    const target = getFindingThreadRecord('pty-1', 'abc')?.byOrdinal.get(1)
    expect(target?.kind).toBe('anchored')
    if (target?.kind === 'anchored') {
      expect(target.handle.target).toEqual({
        scope: 'range',
        side: 'additions',
        startLine: 41,
        endLine: 44,
      })
    }
  })

  test('a malformed event (findings: null) leaves no finding-thread record', async () => {
    setPendingReviewRequest(request())
    mount()
    await emit(event({ findings: null }))

    expect(getFindingThreadRecord('pty-1', 'abc')).toBeUndefined()
  })

  test('a clean review (empty findings) leaves no record', async () => {
    setPendingReviewRequest(request())
    mount()
    await emit(event({ findings: [] }))

    expect(getFindingThreadRecord('pty-1', 'abc')).toBeUndefined()
  })
})

describe('thread identity in placed findings (VIM-298)', () => {
  test('a placed finding self-roots its thread', async () => {
    setPendingReviewRequest(request())
    mount()
    await emit(event({ findings: [finding({ line: 42 })] }))

    expect(addAnnotationForOwner).toHaveBeenCalledTimes(1)
    const annotation = addAnnotationForOwner.mock.calls[0][4]
    expect(annotation.metadata.threadId).toBe(annotation.metadata.id)
  })
})

// ─── Task 7: dual-half finding resolution (VIM-327 spec §2) ────────────────
// Snapshot: a.ts appears in BOTH halves — unstaged additions 10-19, staged 30-39.
// All tests use nonce 'dual' + sessionId 'session-1' to isolate cleanup.

const dualHalfRequest = (): PendingReviewRequest => ({
  nonce: 'dual',
  ownerKey: 'owner',
  cwd: '/repo',
  diffSnapshot: [
    {
      path: 'a.ts',
      staged: false,
      additions: [{ start: 10, end: 19 }],
      deletions: [{ start: 1, end: 5 }],
    },
    {
      path: 'a.ts',
      staged: true,
      additions: [{ start: 30, end: 39 }],
      deletions: [{ start: 20, end: 25 }],
    },
  ],
  dispatchedAt: 1,
})

const dualEvent = (o: Partial<AgentReviewEvent> = {}): AgentReviewEvent => ({
  sessionId: 'session-1',
  nonce: 'dual',
  reviewer: 'codex',
  rawText: 'raw',
  findings: [],
  ...o,
})

describe('dual-half finding resolution (VIM-327 spec §2)', () => {
  afterEach(() => {
    clearPendingReviewRequest('dual')
    clearFindingThreadRecord('session-1', 'dual')
  })

  test('line finding matching only the staged half anchors staged', async () => {
    setPendingReviewRequest(dualHalfRequest())
    mount()
    await emit(
      dualEvent({
        findings: [finding({ path: 'a.ts', side: 'additions', line: 35 })],
      })
    )

    const [, , , stagedArg] = addAnnotationForOwner.mock.calls[0]
    expect(stagedArg).toBe(true)
    expect(addAnnotationForOwner.mock.calls[0][4].lineNumber).toBe(35)

    // thread handle inherits staged: true from the resolved half
    const record = getFindingThreadRecord('session-1', 'dual')
    const target = record?.byOrdinal.get(1)
    expect(target?.kind).toBe('anchored')
    expect(target?.kind === 'anchored' ? target.handle.staged : undefined).toBe(
      true
    )
  })

  test('line finding matching both halves prefers unstaged', async () => {
    // Line 15 is in unstaged additions (10-19); use same range for staged too
    // by giving staged the same range — both contain line 15.
    const bothMatchRequest: PendingReviewRequest = {
      ...dualHalfRequest(),
      diffSnapshot: [
        {
          path: 'a.ts',
          staged: false,
          additions: [{ start: 10, end: 20 }],
          deletions: [{ start: 1, end: 5 }],
        },
        {
          path: 'a.ts',
          staged: true,
          additions: [{ start: 10, end: 20 }],
          deletions: [{ start: 1, end: 5 }],
        },
      ],
    }
    setPendingReviewRequest(bothMatchRequest)
    mount()
    await emit(
      dualEvent({
        findings: [finding({ path: 'a.ts', side: 'additions', line: 15 })],
      })
    )

    const [, , , stagedArg] = addAnnotationForOwner.mock.calls[0]
    expect(stagedArg).toBe(false)
  })

  test('line finding matching neither half degrades to file-level on unstaged', async () => {
    setPendingReviewRequest(dualHalfRequest())
    mount()
    await emit(
      dualEvent({
        findings: [finding({ path: 'a.ts', side: 'additions', line: 99 })],
      })
    )

    const [, , , stagedArg, annotation] = addAnnotationForOwner.mock.calls[0]
    expect(stagedArg).toBe(false)
    expect(annotation.lineNumber).toBe(0) // FILE_COMMENT_LINE_NUMBER
    expect(annotation.metadata.target).toEqual({ scope: 'file' })
  })

  test('scope:file finding on a dual-half path lands unstaged', async () => {
    setPendingReviewRequest(dualHalfRequest())
    mount()
    await emit(
      dualEvent({
        findings: [
          finding({ path: 'a.ts', scope: 'file', side: null, line: null }),
        ],
      })
    )

    const [, , , stagedArg] = addAnnotationForOwner.mock.calls[0]
    expect(stagedArg).toBe(false)
  })
})
