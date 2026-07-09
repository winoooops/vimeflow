import { afterEach, describe, expect, test } from 'vitest'
import {
  addReviewLevelNote,
  buildDiffSnapshot,
  clearPendingReviewRequest,
  clearReviewLevelNotes,
  getPendingReviewRequest,
  reviewLevelNotes,
  setPendingReviewRequest,
  type PendingReviewRequest,
} from './pendingReviewRequests'
import type { FileDiff } from '../types'

const request = (nonce = 'abc'): PendingReviewRequest => ({
  nonce,
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
    expect(getPendingReviewRequest('abc')?.ownerKey).toBe('sess:pane')
    expect(getPendingReviewRequest('abc')?.diffSnapshot[0].path).toBe('a.ts')
  })

  test('set replaces the prior request for the same nonce', () => {
    setPendingReviewRequest(request())
    setPendingReviewRequest({ ...request(), ownerKey: 'sess:pane2' })
    expect(getPendingReviewRequest('abc')?.ownerKey).toBe('sess:pane2')
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

describe('buildDiffSnapshot', () => {
  test('maps hunks to additions/deletions line ranges', () => {
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
        // pure-addition hunk (no old lines)
        {
          id: 'h2',
          header: '@@',
          oldStart: 20,
          oldLines: 0,
          newStart: 88,
          newLines: 7,
          lines: [],
        },
      ],
    }

    expect(buildDiffSnapshot(fileDiff)).toEqual([
      {
        path: 'src/a.ts',
        additions: [
          { start: 40, end: 50 },
          { start: 88, end: 94 },
        ],
        deletions: [{ start: 5, end: 7 }],
      },
    ])
  })
})
