import { afterEach, expect, test } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { ReviewLevelNotes } from './ReviewLevelNotes'
import {
  addReviewLevelNote,
  clearReviewLevelNotes,
} from '../services/pendingReviewRequests'

// ReviewLevelNotes has one job: show review comments that couldn't be pinned to
// a diff line (an off-diff file, or a garbled review) so they aren't lost. The
// first two tests are its resting/empty states (no comments, or no file active
// at all); the last two are the actual job — showing those stray comments,
// scoped to the active file.

const note = (commentId: string, reviewer: string, text: string): void =>
  addReviewLevelNote('owner', { commentId, reviewer, text, nonce: 'abc' })

test('a main-agent turn on a review-level finding shows its outcome chip', () => {
  addReviewLevelNote('owner', {
    commentId: 'c9',
    reviewer: 'Agent',
    text: 'Filed as VIM-999.',
    nonce: 'abc',
    outcome: 'deferred',
  })

  render(<ReviewLevelNotes ownerKey="owner" />)

  expect(screen.getByText('Deferred')).toBeInTheDocument()
  expect(screen.getByText('Filed as VIM-999.')).toBeInTheDocument()
})

afterEach(() => {
  // Wrap in act(): clearing emits to any still-mounted subscriber before
  // testing-library's auto-cleanup unmounts it.
  act(() => {
    clearReviewLevelNotes('owner')
    clearReviewLevelNotes('other')
  })
})

test('shows nothing when the active file has no stray review comments', () => {
  render(<ReviewLevelNotes ownerKey="owner" />)
  expect(screen.queryByTestId('review-level-notes-panel')).toBeNull()
})

test('shows nothing when no file is active yet (undefined owner)', () => {
  // Guard: before a file with a review is selected there is no owner to scope
  // to, so the surface stays collapsed rather than showing another file's notes.
  render(<ReviewLevelNotes ownerKey={undefined} />)
  expect(screen.queryByTestId('review-level-notes-panel')).toBeNull()
})

test('lists each stray review comment (reviewer + text) for the active file', () => {
  note('c1', 'codex', 'config.ts drifts from the schema')
  note('c2', 'Reviewer', 'broken block')

  render(<ReviewLevelNotes ownerKey="owner" />)

  expect(screen.getByText('Review — 2 off-file')).toBeInTheDocument()
  expect(screen.getByText('codex')).toBeInTheDocument()
  expect(
    screen.getByText('config.ts drifts from the schema')
  ).toBeInTheDocument()
  expect(screen.getByText('broken block')).toBeInTheDocument()
})

test('ignores notes belonging to a different owner', () => {
  addReviewLevelNote('other', {
    commentId: 'c1',
    reviewer: 'codex',
    text: 'not mine',
    nonce: 'abc',
  })

  render(<ReviewLevelNotes ownerKey="owner" />)

  expect(screen.queryByTestId('review-level-notes-panel')).toBeNull()
})
