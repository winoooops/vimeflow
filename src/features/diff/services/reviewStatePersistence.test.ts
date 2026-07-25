/**
 * Checks the safety rules for review state read from disk.
 *
 * Saved files may be old or partly damaged, so these tests feed the parser bad
 * entries and unsupported versions. They verify that usable review work remains
 * available without treating invalid or empty data as something worth saving.
 */

import { describe, expect, test } from 'vitest'
import {
  parsePersistedReviewState,
  reviewStateHasData,
} from './reviewStatePersistence'

describe('reviewStatePersistence', () => {
  test('keeps valid records when a sibling record is malformed', () => {
    expect(
      parsePersistedReviewState({
        version: 1,
        annotations: [
          {
            filePath: 'src/a.ts',
            staged: false,
            annotation: {
              side: 'additions',
              lineNumber: 7,
              metadata: {
                id: 'comment-1',
                text: 'keep me',
                author: 'self',
                createdAt: 1,
                dispatchedAt: 2,
                resolvedAt: 3,
              },
            },
          },
          { filePath: '../outside', staged: false },
        ],
        draft: null,
        threadDrafts: [
          ['thread-1', 'follow up'],
          ['', 'broken'],
        ],
        pendingReviews: [],
        pendingReviewRequests: [],
        findingThreads: [],
        reviewLevelNotes: [],
      })
    ).toMatchObject({
      annotations: [
        {
          filePath: 'src/a.ts',
          annotation: { metadata: { text: 'keep me' } },
        },
      ],
      threadDrafts: [['thread-1', 'follow up']],
    })
  })

  test('rejects unsupported versions without treating them as empty state', () => {
    expect(parsePersistedReviewState({ version: 99 })).toBeNull()
  })

  test('empty drafts do not keep an otherwise empty record alive', () => {
    expect(
      reviewStateHasData({
        version: 1,
        annotations: [],
        draft: null,
        threadDrafts: [['thread-1', '   ']],
        pendingReviews: [],
        pendingReviewRequests: [],
        findingThreads: [],
        reviewLevelNotes: [],
      })
    ).toBe(false)
  })
})
