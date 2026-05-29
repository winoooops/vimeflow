import { test, expect, vi } from 'vitest'
import type { DiffLineAnnotation } from '@pierre/diffs'
import type { ReviewComment } from '../hooks/useFeedbackBatch'
import {
  formatFeedbackPayload,
  dispatchFeedbackBatch,
  type DispatchEntry,
} from './feedbackDispatch'

const makeAnnotation = (
  lineNumber: number,
  side: 'additions' | 'deletions',
  text: string
): DiffLineAnnotation<ReviewComment> => ({
  lineNumber,
  side,
  metadata: {
    id: `c-${lineNumber}-${side}`,
    text,
    author: 'self',
    createdAt: Date.now(),
  },
})

test('1 comment across 1 file -> header contains singular wording', () => {
  const entries: DispatchEntry[] = [
    {
      cwd: '/repo',
      filePath: 'src/App.tsx',
      annotations: [makeAnnotation(5, 'additions', 'Nice work')],
    },
  ]
  const payload = formatFeedbackPayload(entries)

  expect(payload).toContain('1 comment across 1 file')
})

test('3 comments across 2 files -> header says plural counts and body has 3 entry lines', () => {
  const entries: DispatchEntry[] = [
    {
      cwd: '/repo',
      filePath: 'src/App.tsx',
      annotations: [
        makeAnnotation(5, 'additions', 'Nice work'),
        makeAnnotation(10, 'deletions', 'Remove this'),
      ],
    },
    {
      cwd: '/repo',
      filePath: 'src/main.tsx',
      annotations: [makeAnnotation(3, 'additions', 'Consider renaming')],
    },
  ]
  const payload = formatFeedbackPayload(entries)

  expect(payload).toContain('3 comments across 2 files')
  expect(payload).toContain('> /repo/src/App.tsx:5 (additions)')
  expect(payload).toContain('> /repo/src/App.tsx:10 (deletions)')
  expect(payload).toContain('> /repo/src/main.tsx:3 (additions)')
})

test('multi-line comment prefixes every line', () => {
  const entries: DispatchEntry[] = [
    {
      cwd: '/repo',
      filePath: 'src/App.tsx',
      annotations: [
        makeAnnotation(5, 'additions', 'Line one\nLine two\nLine three'),
      ],
    },
  ]
  const payload = formatFeedbackPayload(entries)

  expect(payload).toContain('> /repo/src/App.tsx:5 (additions)')
  expect(payload).toContain('> ─ Line one')
  expect(payload).toContain('> ─ Line two')
  expect(payload).toContain('> ─ Line three')
})

test('avoids double slash when cwd ends with /', () => {
  const entries: DispatchEntry[] = [
    {
      cwd: '/repo/',
      filePath: 'src/App.tsx',
      annotations: [makeAnnotation(5, 'additions', 'Nice work')],
    },
  ]
  const payload = formatFeedbackPayload(entries)

  expect(payload).toContain('> /repo/src/App.tsx:5 (additions)')
  expect(payload).not.toContain('//')
})

test('dispatchFeedbackBatch calls writePty once with paste-bracketed payload', async () => {
  const writePty = vi.fn().mockResolvedValue(undefined)

  const entries: DispatchEntry[] = [
    {
      cwd: '/repo',
      filePath: 'src/App.tsx',
      annotations: [makeAnnotation(5, 'additions', 'Nice work')],
    },
  ]

  await dispatchFeedbackBatch('pane-1', 'pty-1', entries, writePty)

  expect(writePty).toHaveBeenCalledTimes(1)
  const sent = writePty.mock.calls[0][1] as string
  expect(sent.startsWith('\x1b[200~')).toBe(true)
  expect(sent.endsWith('\x1b[201~\r')).toBe(true)
})
