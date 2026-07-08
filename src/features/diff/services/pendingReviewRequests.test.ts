import { afterEach, describe, expect, test } from 'vitest'
import {
  addReviewLevelNote,
  clearPendingReviewRequest,
  clearReviewLevelNotes,
  getPendingReviewRequest,
  reviewLevelNotes,
  setPendingReviewRequest,
  type PendingReviewRequest,
} from './pendingReviewRequests'

const request = (nonce = 'abc'): PendingReviewRequest => ({
  nonce,
  ptyId: 'pty-1',
  ownerKey: 'sess:pane',
  cwd: '/repo',
  staged: false,
  diffSnapshot: [
    { path: 'a.ts', additions: [{ start: 1, end: 10 }], deletions: [] },
  ],
  dispatchedAt: 1,
})

afterEach(() => {
  clearPendingReviewRequest('abc')
  clearPendingReviewRequest('xyz')
  clearReviewLevelNotes('owner')
})

describe('pendingReviewRequests', () => {
  test('set then get by nonce', () => {
    setPendingReviewRequest(request())
    expect(getPendingReviewRequest('abc')?.ptyId).toBe('pty-1')
    expect(getPendingReviewRequest('abc')?.diffSnapshot[0].path).toBe('a.ts')
  })

  test('set replaces the prior request for the same nonce', () => {
    setPendingReviewRequest(request())
    setPendingReviewRequest({ ...request(), ptyId: 'pty-2' })
    expect(getPendingReviewRequest('abc')?.ptyId).toBe('pty-2')
  })

  test('clear removes the request', () => {
    setPendingReviewRequest(request())
    clearPendingReviewRequest('abc')
    expect(getPendingReviewRequest('abc')).toBeUndefined()
  })

  test('two requests can be in flight under different nonces', () => {
    setPendingReviewRequest(request('abc'))
    setPendingReviewRequest(request('xyz'))
    expect(getPendingReviewRequest('abc')?.nonce).toBe('abc')
    expect(getPendingReviewRequest('xyz')?.nonce).toBe('xyz')
  })
})

describe('reviewLevelNotes', () => {
  test('add then read notes per owner, in order', () => {
    addReviewLevelNote('owner', {
      commentId: 'c1',
      reviewer: 'codex',
      text: 'first',
      nonce: 'abc',
    })
    addReviewLevelNote('owner', {
      commentId: 'c2',
      reviewer: 'codex',
      text: 'second',
      nonce: 'abc',
    })
    expect(reviewLevelNotes('owner').map((n) => n.text)).toEqual([
      'first',
      'second',
    ])
  })

  test('an owner with no notes reads as empty', () => {
    expect(reviewLevelNotes('nobody')).toEqual([])
  })
})
