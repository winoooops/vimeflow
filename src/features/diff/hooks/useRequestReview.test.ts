import { afterEach, expect, test, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ChangedFile, FileDiff } from '../types'
import type { PaneCandidate } from '../services/activePanePicker'
import { useRequestReview } from './useRequestReview'
import {
  clearPendingReviewRequest,
  getPendingReviewRequest,
  prunePendingReviewRequestOwners,
} from '../services/pendingReviewRequests'
import {
  dispatchReviewRequest,
  formatReviewRequest,
} from '../services/feedbackDispatch'
import { writeClipboardText } from '@/lib/clipboard'

vi.mock('../services/feedbackDispatch', () => ({
  dispatchReviewRequest: vi.fn(() => Promise.resolve()),
  formatReviewRequest: vi.fn(() => 'REVIEW_PROMPT'),
  makeDispatchNonce: vi.fn(() => 'nonce-1'),
}))

vi.mock('@/lib/clipboard', () => ({
  writeClipboardText: vi.fn(() => Promise.resolve(true)),
}))

const diffOf = (filePath: string): FileDiff => ({
  filePath,
  hunks: [
    {
      id: 'h1',
      header: '@@',
      oldStart: 5,
      oldLines: 3,
      newStart: 40,
      newLines: 11,
      lines: [],
    },
  ],
})

const fileDiff: FileDiff = diffOf('src/a.ts')

const paneCandidate: PaneCandidate = {
  paneId: 'p',
  ptyId: 'pty-1',
  tabName: 't',
  agentLabel: 'Codex',
  cwd: '/repo',
  status: 'running',
  isFocused: false,
}

const pane = (ptyId = 'pty-1'): PaneCandidate => ({
  ...paneCandidate,
  ptyId,
})

const writePty = vi.fn(() => Promise.resolve())
const notify = vi.fn()

const changedFiles: ChangedFile[] = [
  { path: 'src/a.ts', status: 'modified', staged: false },
  { path: 'src/a.ts', status: 'modified', staged: true },
  { path: 'new.ts', status: 'untracked', staged: false },
]

const baseProps = {
  fileDiff,
  ownerKey: 'session:pane',
  cwd: '/repo',
  staged: false,
  repoRoot: '/repo',
  changedFiles,
  statusRevision: 1,
  fetchFileDiff: vi.fn(
    (path: string): Promise<FileDiff> => Promise.resolve(diffOf(path))
  ),
  writePty,
  notify,
}

const setup = (
  over: Partial<Parameters<typeof useRequestReview>[0]> = {}
): ReturnType<
  typeof renderHook<ReturnType<typeof useRequestReview>, unknown>
> =>
  renderHook(() =>
    useRequestReview({
      fileDiff,
      ownerKey: 'owner',
      cwd: '/repo',
      staged: false,
      writePty,
      notify,
      ...over,
    })
  )

afterEach(() => {
  clearPendingReviewRequest('nonce-1')
  // Clean up any nonces that changelist tests may have minted
  prunePendingReviewRequestOwners(new Set())
  vi.clearAllMocks()
})

test('canRequest is false without a fileDiff or owner, true otherwise', () => {
  expect(setup({ fileDiff: undefined }).result.current.canRequest).toBe(false)
  expect(setup({ ownerKey: undefined }).result.current.canRequest).toBe(false)
  expect(setup().result.current.canRequest).toBe(true)
})

test('openPopover opens only when a review can be requested', () => {
  const blocked = setup({ fileDiff: undefined })
  act(() => blocked.result.current.openPopover())
  expect(blocked.result.current.open).toBe(false)

  const ok = setup()
  act(() => ok.result.current.openPopover())
  expect(ok.result.current.open).toBe(true)

  act(() => ok.result.current.closePopover())
  expect(ok.result.current.open).toBe(false)
})

test('requestReview records the pending request and dispatches to the pane', async () => {
  const { result } = setup()

  await act(async () => {
    result.current.requestReview(pane('pty-9'))
    await Promise.resolve()
  })

  const request = getPendingReviewRequest('nonce-1')
  expect(request?.ownerKey).toBe('owner')
  expect(request?.diffSnapshot[0].path).toBe('src/a.ts')

  // The pane is used for dispatch directly, not stored on the request.
  // dispatchReviewRequest receives requestFiles (ReviewRequestFile[]) built
  // from diffSnapshot — same shape when no promptPath enrichment.
  expect(dispatchReviewRequest).toHaveBeenCalledWith(
    'pty-9',
    [
      {
        path: 'src/a.ts',
        staged: false,
        additions: [{ start: 40, end: 50 }],
        deletions: [{ start: 5, end: 7 }],
      },
    ],
    'nonce-1',
    writePty
  )
  expect(result.current.open).toBe(false)
})

test('requestReview dispatches resolvable prompt paths without changing the stored snapshot', async () => {
  const { result } = setup({ cwd: '/repo/packages/app', repoRoot: '/repo' })

  await act(async () => {
    result.current.requestReview(pane('pty-9'))
    await Promise.resolve()
  })

  const request = getPendingReviewRequest('nonce-1')
  expect(request?.diffSnapshot[0].path).toBe('src/a.ts')
  expect(dispatchReviewRequest).toHaveBeenCalledWith(
    'pty-9',
    [
      {
        path: 'src/a.ts',
        staged: false,
        promptPath: '/repo/src/a.ts',
        additions: [{ start: 40, end: 50 }],
        deletions: [{ start: 5, end: 7 }],
      },
    ],
    'nonce-1',
    writePty
  )
})

test('copyReviewRequest records a request and copies the prompt', async () => {
  const { result } = setup()

  await act(async () => {
    result.current.copyReviewRequest()
    await Promise.resolve()
  })

  const request = getPendingReviewRequest('nonce-1')
  expect(request?.ownerKey).toBe('owner')
  expect(formatReviewRequest).toHaveBeenCalledWith(
    [
      {
        path: 'src/a.ts',
        staged: false,
        additions: [{ start: 40, end: 50 }],
        deletions: [{ start: 5, end: 7 }],
      },
    ],
    'nonce-1'
  )
  expect(writeClipboardText).toHaveBeenCalledWith('REVIEW_PROMPT')
  expect(notify).toHaveBeenCalledWith(
    'Copied the review request — paste it into an agent.'
  )
})

test('requestReview is a no-op when there is nothing to review', async () => {
  const { result } = setup({ fileDiff: undefined })

  await act(async () => {
    result.current.requestReview(pane())
    await Promise.resolve()
  })

  expect(dispatchReviewRequest).not.toHaveBeenCalled()
  expect(getPendingReviewRequest('nonce-1')).toBeUndefined()
})

test('notifies when the pane dispatch throws', async () => {
  vi.mocked(dispatchReviewRequest).mockRejectedValueOnce(new Error('gone'))
  const { result } = setup()

  await act(async () => {
    result.current.requestReview(pane())
    await Promise.resolve()
    await Promise.resolve()
  })

  expect(notify).toHaveBeenCalledWith(
    'Terminal session ended; review request not sent.'
  )
})

// ─── Task 6: scope, async arm, keyed prefetch ──────────────────────────────

test('changelist delegate arms all entries under one nonce and dispatches all request files', async () => {
  const fetchFileDiff = vi.fn(
    (path: string): Promise<FileDiff> => Promise.resolve(diffOf(path))
  )

  const { result } = renderHook(() =>
    useRequestReview({
      fileDiff: diffOf('src/a.ts'),
      ownerKey: 'session:pane',
      cwd: '/repo',
      staged: false,
      repoRoot: '/repo',
      changedFiles,
      statusRevision: 1,
      fetchFileDiff,
      writePty: vi.fn((): Promise<void> => Promise.resolve()),
      notify,
    })
  )

  act(() => result.current.setScope('changelist'))
  await act(async () => {
    result.current.requestReview({
      ptyId: 'pty-1',
      paneId: 'p',
      tabName: 't',
      agentLabel: 'claude',
      cwd: '/repo',
      status: 'running',
      isFocused: false,
    })
    await vi.waitFor(() => expect(dispatchReviewRequest).toHaveBeenCalled())
  })

  const mocked = vi.mocked(dispatchReviewRequest)
  const [ptyId, requestFiles, nonce] = mocked.mock.calls[0]
  expect(ptyId).toBe('pty-1')
  expect(requestFiles).toHaveLength(3)
  expect(requestFiles[2]).toMatchObject({
    path: 'new.ts',
    staged: false,
    untracked: true,
    promptPath: '/repo/new.ts',
  })

  const request = getPendingReviewRequest(nonce)
  expect(request?.diffSnapshot).toHaveLength(3)
  expect(request?.diffSnapshot[1]).toMatchObject({
    path: 'src/a.ts',
    staged: true,
  })
})

test('changelist arm failure is atomic: no request stored, notify fired', async () => {
  const fetchFileDiff = vi.fn(
    (): Promise<FileDiff> => Promise.reject(new Error('boom'))
  )

  const { result } = renderHook(() =>
    useRequestReview({
      fileDiff: diffOf('src/a.ts'),
      ownerKey: 'session:pane',
      cwd: '/repo',
      staged: false,
      repoRoot: '/repo',
      changedFiles,
      statusRevision: 1,
      fetchFileDiff,
      writePty,
      notify,
    })
  )

  act(() => result.current.setScope('changelist'))
  await act(async () => {
    result.current.requestReview(paneCandidate)
    await vi.waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        'Could not snapshot the changelist; review request not sent.'
      )
    )
  })

  expect(writePty).not.toHaveBeenCalled()
  // No pending request for any nonce the hook might have minted
  expect(getPendingReviewRequest('nonce-1')).toBeUndefined()
})

test('prefetch is keyed: openPopover starts one fetch, arm reuses it; stale cwd forces a fresh fetch', async () => {
  const fetchFileDiff = vi.fn(
    (path: string): Promise<FileDiff> => Promise.resolve(diffOf(path))
  )

  const { result, rerender } = renderHook(
    (props: Parameters<typeof useRequestReview>[0]) => useRequestReview(props),
    {
      initialProps: {
        ...baseProps,
        fetchFileDiff,
      },
    }
  )

  act(() => result.current.setScope('changelist'))
  act(() => result.current.openPopover())
  await vi.waitFor(() =>
    expect(fetchFileDiff).toHaveBeenCalledTimes(changedFiles.length)
  )

  // Same key: arm must not refetch
  await act(async () => {
    result.current.copyReviewRequest()
    await Promise.resolve()
  })
  expect(fetchFileDiff).toHaveBeenCalledTimes(changedFiles.length)

  // Key change (cwd swap): arm re-fetches
  rerender({ ...baseProps, fetchFileDiff, cwd: '/other-repo' })
  act(() => result.current.setScope('changelist'))
  await act(async () => {
    result.current.requestReview(paneCandidate)
    await vi.waitFor(() =>
      expect(fetchFileDiff.mock.calls.length).toBeGreaterThan(
        changedFiles.length
      )
    )
  })
})

test('canRequest is true with a populated strip and no active fileDiff, and scope is forced to changelist', () => {
  const { result } = renderHook(() =>
    useRequestReview({ ...baseProps, fileDiff: undefined })
  )

  expect(result.current.canRequest).toBe(true)
  expect(result.current.scope).toBe('changelist')
})
