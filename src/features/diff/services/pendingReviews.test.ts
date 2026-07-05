import { afterEach, describe, expect, test } from 'vitest'
import {
  clearPendingReview,
  getPendingReview,
  setPendingReview,
  type PendingReview,
} from './pendingReviews'

const record = (nonce = 'abc'): PendingReview => ({
  ptyId: 'pty-1',
  ownerKey: 'sess:pane',
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

afterEach(() => clearPendingReview('pty-1'))

describe('pendingReviews', () => {
  test('set then get by ptyId', () => {
    setPendingReview(record())
    expect(getPendingReview('pty-1')?.nonce).toBe('abc')
  })

  test('set replaces the prior record for the same pty', () => {
    setPendingReview(record())
    setPendingReview(record('xyz'))
    expect(getPendingReview('pty-1')?.nonce).toBe('xyz')
  })

  test('clear removes the record', () => {
    setPendingReview(record())
    clearPendingReview('pty-1')
    expect(getPendingReview('pty-1')).toBeUndefined()
  })

  test('get for an unknown pty is undefined', () => {
    expect(getPendingReview('nope')).toBeUndefined()
  })
})
