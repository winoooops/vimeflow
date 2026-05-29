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
      filePath: 'src/App.tsx',
      annotations: [
        makeAnnotation(5, 'additions', 'Nice work'),
        makeAnnotation(10, 'deletions', 'Remove this'),
      ],
    },
    {
      filePath: 'src/main.tsx',
      annotations: [makeAnnotation(3, 'additions', 'Consider renaming')],
    },
  ]
  const payload = formatFeedbackPayload(entries)

  expect(payload).toContain('3 comments across 2 files')
  expect(payload).toContain('> src/App.tsx:5 (additions)')
  expect(payload).toContain('> src/App.tsx:10 (deletions)')
  expect(payload).toContain('> src/main.tsx:3 (additions)')
})

test('multi-line comment prefixes every line', () => {
  const entries: DispatchEntry[] = [
    {
      filePath: 'src/App.tsx',
      annotations: [
        makeAnnotation(5, 'additions', 'Line one\nLine two\nLine three'),
      ],
    },
  ]
  const payload = formatFeedbackPayload(entries)

  expect(payload).toContain('> src/App.tsx:5 (additions)')
  expect(payload).toContain('> ─ Line one')
  expect(payload).toContain('> ─ Line two')
  expect(payload).toContain('> ─ Line three')
})

test('repo-relative file path is emitted directly without joining', () => {
  const entries: DispatchEntry[] = [
    {
      filePath: 'src/App.tsx',
      annotations: [makeAnnotation(5, 'additions', 'Nice work')],
    },
  ]
  const payload = formatFeedbackPayload(entries)

  expect(payload).toContain('> src/App.tsx:5 (additions)')
})

test('dispatchFeedbackBatch calls writePty once with paste-bracketed payload', async () => {
  const writePty = vi.fn().mockResolvedValue(undefined)

  const entries: DispatchEntry[] = [
    {
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

test('strips terminal control characters so a crafted path/comment cannot break out of the paste', () => {
  const entries: DispatchEntry[] = [
    {
      // filename embedding the paste-END sentinel + CR
      filePath: 'src/ev\x1b[201~il.tsx',
      annotations: [
        makeAnnotation(5, 'additions', 'breakout\x1b[201~\rinjected'),
      ],
    },
  ]
  const body = formatFeedbackPayload(entries)

  // No ESC or CR survives the format step — the dangerous bytes that form the
  // bracketed-paste sentinel / inject prompt lines are gone (the harmless
  // printable remainder like "[201~" stays as plain text).
  expect(body).not.toContain('\x1b')
  expect(body).not.toContain('\r')
  expect(body).toContain('breakout[201~injected')

  // End to end: the only control sequences in the dispatched payload are the
  // wrapper's own start/end sentinels — exactly two ESC bytes, one trailing CR.
  const sent = `\x1b[200~${body}\x1b[201~\r`
  expect((sent.match(/\x1b/g) ?? []).length).toBe(2)
})
