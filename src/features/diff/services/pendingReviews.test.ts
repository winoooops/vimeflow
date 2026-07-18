import { afterEach, describe, expect, test } from 'vitest'
import {
  clearPendingReview,
  getPendingReview,
  pendingNoncesForPty,
  prunePendingReviewOwners,
  setPendingReview,
  type PendingReview,
} from './pendingReviews'

const record = (nonce = 'abc', ownerKey = 'sess:pane'): PendingReview => ({
  ptyId: 'pty-1',
  ownerKey,
  nonce,
  dispatchedAt: 1,
  byHandle: new Map([
    [
      1,
      {
        cwd: '/r',
        filePath: 'a.ts',
        staged: false,
        lineNumber: 5,
        side: 'additions' as const,
        target: undefined,
      },
    ],
  ]),
})

afterEach(() => {
  clearPendingReview('pty-1', 'abc')
  clearPendingReview('pty-1', 'xyz')
  clearPendingReview('pty-1', 'stale')
  clearPendingReview('pty-2', 'stale')
})

describe('pendingReviews', () => {
  test('set then get keyed by (ptyId, nonce)', () => {
    setPendingReview(record())
    expect(getPendingReview('pty-1', 'abc')?.nonce).toBe('abc')
    // The pty is part of the key — the same nonce on another pty is no match.
    expect(getPendingReview('pty-2', 'abc')).toBeUndefined()
  })

  test('two dispatches on the same pty stay in flight concurrently (VIM-297)', () => {
    setPendingReview(record('abc'))
    setPendingReview(record('xyz'))

    expect(getPendingReview('pty-1', 'abc')?.nonce).toBe('abc')
    expect(getPendingReview('pty-1', 'xyz')?.nonce).toBe('xyz')
  })

  test('set replaces the prior record for the same (ptyId, nonce)', () => {
    setPendingReview(record('abc'))
    setPendingReview({ ...record('abc'), dispatchedAt: 2 })
    expect(getPendingReview('pty-1', 'abc')?.dispatchedAt).toBe(2)
  })

  test('clear removes exactly the addressed record', () => {
    setPendingReview(record('abc'))
    setPendingReview(record('xyz'))
    clearPendingReview('pty-1', 'abc')

    expect(getPendingReview('pty-1', 'abc')).toBeUndefined()
    expect(getPendingReview('pty-1', 'xyz')?.nonce).toBe('xyz')
  })

  test('get for an unknown (ptyId, nonce) is undefined', () => {
    expect(getPendingReview('nope', 'abc')).toBeUndefined()
  })

  test('lists only pending nonces for the requested pty', () => {
    setPendingReview(record('abc'))
    setPendingReview(record('xyz'))
    setPendingReview({ ...record('stale'), ptyId: 'pty-2' })

    expect(pendingNoncesForPty('pty-1')).toEqual(['abc', 'xyz'])
    expect(pendingNoncesForPty('pty-2')).toEqual(['stale'])
  })

  test('prunePendingReviewOwners removes records for closed owners', () => {
    setPendingReview(record('abc'))
    setPendingReview(record('stale', 'stale-owner'))

    prunePendingReviewOwners(new Set(['sess:pane']))

    expect(getPendingReview('pty-1', 'abc')?.nonce).toBe('abc')
    expect(getPendingReview('pty-1', 'stale')).toBeUndefined()
  })
})
