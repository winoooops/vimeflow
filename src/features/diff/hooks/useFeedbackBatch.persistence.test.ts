/**
 * Exercises the complete path that keeps diff-review work between sessions.
 *
 * These tests mock the backend while the hook loads, edits, switches worktrees,
 * and shuts down. That catches cases where a draft or agent reply could be sent
 * to the wrong owner or disappear before its final save reaches the backend.
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { invoke } from '@/lib/backend'
import { flushRendererTeardownState } from '@/lib/teardownFlush'
import { useFeedbackBatchStore } from './useFeedbackBatch'

vi.mock('@/lib/environment', () => ({ isDesktop: (): boolean => true }))
vi.mock('@/lib/backend', () => ({ invoke: vi.fn() }))

const persistedState = {
  version: 1,
  annotations: [
    {
      filePath: 'src/a.ts',
      staged: false,
      annotation: {
        side: 'additions',
        lineNumber: 4,
        metadata: {
          id: 'comment-1',
          text: 'survives relaunch',
          author: 'self',
          createdAt: 1,
          dispatchedAt: 2,
          threadId: 'comment-1',
          resolvedAt: 3,
        },
      },
    },
  ],
  draft: {
    filePath: 'src/b.ts',
    staged: false,
    side: 'additions',
    lineNumber: 8,
    text: 'unfinished',
  },
  threadDrafts: [['comment-1', 'follow up']],
  pendingReviews: [],
  pendingReviewRequests: [],
  findingThreads: [],
  reviewLevelNotes: [],
} as const

describe('useFeedbackBatchStore persistence', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
  })

  test('hydrates a relaunched owner and reconnects paths in another worktree', async () => {
    vi.mocked(invoke).mockResolvedValue(persistedState)

    const { result, rerender } = renderHook(
      ({ cwd }) => useFeedbackBatchStore('session-a:p0', cwd),
      { initialProps: { cwd: '/repo/main' } }
    )

    await waitFor(() => {
      expect(
        result.current.feedbackBatch.annotationsForFile(
          '/repo/main',
          'src/a.ts',
          false
        )
      ).toHaveLength(1)
    })
    expect(result.current.feedbackDraft.draft?.text).toBe('unfinished')
    expect(result.current.feedbackDraft.threadDrafts?.get('comment-1')).toBe(
      'follow up'
    )

    rerender({ cwd: '/repo/worktrees/feature' })

    await waitFor(() => {
      expect(
        result.current.feedbackBatch.annotationsForFile(
          '/repo/worktrees/feature',
          'src/a.ts',
          false
        )
      ).toHaveLength(1)
    })

    expect(
      result.current.feedbackBatch.annotationsForFile(
        '/repo/main',
        'src/a.ts',
        false
      )
    ).toHaveLength(0)

    rerender({ cwd: '/repo/main' })

    await waitFor(() => {
      const loads = vi
        .mocked(invoke)
        .mock.calls.filter(([method]) => method === 'load_review_state')
      expect(loads).toHaveLength(3)
    })

    expect(
      result.current.feedbackBatch.annotationsForFile(
        '/repo/main',
        'src/a.ts',
        false
      )
    ).toHaveLength(1)
  })

  test('does not overwrite durable data after a transient load failure', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('sidecar unavailable'))

    const { result } = renderHook(() =>
      useFeedbackBatchStore('session-a:p0', '/repo')
    )

    await waitFor(() => expect(result.current.hydrationFailed).toBe(true))
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ['load_review_state', { cwd: '/repo', ownerKey: 'session-a:p0' }],
    ])
  })

  test('flushes an old-cwd mutation batched with a worktree switch', async () => {
    vi.mocked(invoke).mockResolvedValue(null)

    const { result, rerender } = renderHook(
      ({ cwd }) => useFeedbackBatchStore('session-a:p0', cwd),
      { initialProps: { cwd: '/repo/main' } }
    )
    await waitFor(() => expect(result.current.hydrating).toBe(false))

    act(() => {
      result.current.feedbackDraft.setDraft({
        cwd: '/repo/main',
        filePath: 'src/a.ts',
        staged: false,
        side: 'additions',
        lineNumber: 1,
        text: 'save before switching',
      })
      rerender({ cwd: '/repo/worktrees/feature' })
    })

    await waitFor(() => expect(result.current.hydrating).toBe(false))

    const reviewCalls = vi
      .mocked(invoke)
      .mock.calls.filter(
        ([method]) =>
          method === 'load_review_state' || method === 'save_review_state'
      )

    expect(reviewCalls[1]).toEqual([
      'save_review_state',
      expect.objectContaining({
        cwd: '/repo/main',
        state: expect.objectContaining({
          draft: expect.objectContaining({ text: 'save before switching' }),
        }),
      }),
    ])

    expect(reviewCalls[2]).toEqual([
      'load_review_state',
      { cwd: '/repo/worktrees/feature', ownerKey: 'session-a:p0' },
    ])
  })

  test('restores retained desired state when a failed target save is still pending', async () => {
    vi.mocked(invoke).mockImplementation((method) =>
      method === 'save_review_state'
        ? Promise.reject(new Error('disk unavailable'))
        : Promise.resolve(null)
    )

    const { result, rerender } = renderHook(
      ({ cwd }) => useFeedbackBatchStore('session-a:p0', cwd),
      { initialProps: { cwd: '/repo/main' } }
    )
    await waitFor(() => expect(result.current.hydrating).toBe(false))

    act(() => {
      result.current.feedbackDraft.setDraft({
        cwd: '/repo/main',
        filePath: 'src/a.ts',
        staged: false,
        side: 'additions',
        lineNumber: 1,
        text: 'retain after failed save',
      })
    })

    await waitFor(() =>
      expect(
        vi
          .mocked(invoke)
          .mock.calls.some(([method]) => method === 'save_review_state')
      ).toBe(true)
    )

    rerender({ cwd: '/repo/worktrees/feature' })
    await waitFor(() => expect(result.current.hydrating).toBe(false))
    rerender({ cwd: '/repo/main' })
    await waitFor(() => expect(result.current.hydrating).toBe(false))

    expect(result.current.feedbackDraft.draft?.text).toBe(
      'retain after failed save'
    )
  })

  test('persists a reply routed to an inactive owner', async () => {
    vi.mocked(invoke).mockResolvedValue(null)

    const { result, rerender } = renderHook(
      ({ ownerKey, cwd }) => useFeedbackBatchStore(ownerKey, cwd),
      {
        initialProps: { ownerKey: 'session-a:p0', cwd: '/repo/a' },
      }
    )

    await waitFor(() => expect(result.current.hydrating).toBe(false))
    rerender({ ownerKey: 'session-b:p0', cwd: '/repo/b' })
    await waitFor(() => expect(result.current.hydrating).toBe(false))

    act(() => {
      result.current.feedbackBatch.addAnnotationForOwner(
        'session-a:p0',
        '/repo/a',
        'src/a.ts',
        false,
        {
          side: 'additions',
          lineNumber: 4,
          metadata: {
            id: 'agent-1',
            text: 'background reply',
            author: 'agent',
            createdAt: 4,
          },
        }
      )
    })

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'save_review_state',
        expect.objectContaining({
          cwd: '/repo/a',
          ownerKey: 'session-a:p0',
          state: expect.objectContaining({
            annotations: [expect.objectContaining({ filePath: 'src/a.ts' })],
          }),
        })
      )
    )
  })

  test('flushes the latest draft through the renderer teardown handshake', async () => {
    vi.mocked(invoke).mockResolvedValue(null)

    const { result } = renderHook(() =>
      useFeedbackBatchStore('session-a:p0', '/repo')
    )
    await waitFor(() => expect(result.current.hydrating).toBe(false))

    act(() => {
      result.current.feedbackDraft.setDraft({
        cwd: '/repo',
        filePath: 'src/a.ts',
        staged: false,
        side: 'additions',
        lineNumber: 1,
        text: 'last-second draft',
      })
    })
    await act(async () => flushRendererTeardownState())

    expect(invoke).toHaveBeenCalledWith(
      'save_review_state',
      expect.objectContaining({
        cwd: '/repo',
        ownerKey: 'session-a:p0',
        state: expect.objectContaining({
          draft: expect.objectContaining({ text: 'last-second draft' }),
        }),
      })
    )
  })

  test('queues a reverted draft behind an in-flight save', async () => {
    let resolveFirstSave = (): void => undefined

    const firstSave = new Promise<void>((resolve) => {
      resolveFirstSave = resolve
    })
    vi.mocked(invoke)
      .mockResolvedValueOnce(null)
      .mockReturnValueOnce(firstSave)
      .mockResolvedValue(null)

    const { result } = renderHook(() =>
      useFeedbackBatchStore('session-a:p0', '/repo')
    )
    await waitFor(() => expect(result.current.hydrating).toBe(false))

    act(() => {
      result.current.feedbackDraft.setDraft({
        cwd: '/repo',
        filePath: 'src/a.ts',
        staged: false,
        side: 'additions',
        lineNumber: 1,
        text: 'transient draft',
      })
    })

    await waitFor(() =>
      expect(
        vi
          .mocked(invoke)
          .mock.calls.filter(([method]) => method === 'save_review_state')
      ).toHaveLength(1)
    )

    act(() => result.current.feedbackDraft.setDraft(null))
    resolveFirstSave()

    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith('save_review_state', {
        cwd: '/repo',
        ownerKey: 'session-a:p0',
        state: null,
      })
    )
  })

  test('explicit owner pruning deletes only that owner from durable state', async () => {
    vi.mocked(invoke).mockResolvedValue(null)

    const { result } = renderHook(() =>
      useFeedbackBatchStore('session-a:p0', '/repo')
    )

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('load_review_state', {
        cwd: '/repo',
        ownerKey: 'session-a:p0',
      })
    })

    act(() => result.current.pruneOwners(new Set(['session-a:p0'])))

    act(() => {
      result.current.feedbackDraft.setDraft({
        cwd: '/repo',
        filePath: 'src/a.ts',
        staged: false,
        side: 'additions',
        lineNumber: 1,
        text: 'draft',
      })
      result.current.pruneOwners(new Set())
    })

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('delete_review_owner_state', {
        ownerKey: 'session-a:p0',
      })
    })
  })
})
