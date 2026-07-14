import { afterEach, expect, test, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { FileDiff } from '../types'
import type { PaneCandidate } from '../services/activePanePicker'
import { useRequestReview } from './useRequestReview'
import {
  clearPendingReviewRequest,
  getPendingReviewRequest,
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

const fileDiff: FileDiff = {
  filePath: 'src/a.ts',
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
}

const pane = (ptyId = 'pty-1'): PaneCandidate => ({
  paneId: 'p',
  ptyId,
  tabName: 't',
  agentLabel: 'Codex',
  cwd: '/repo',
  status: 'running',
  isFocused: false,
})

const writePty = vi.fn(() => Promise.resolve())
const notify = vi.fn()

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
  expect(dispatchReviewRequest).toHaveBeenCalledWith(
    'pty-9',
    request?.diffSnapshot,
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
    request?.diffSnapshot,
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
