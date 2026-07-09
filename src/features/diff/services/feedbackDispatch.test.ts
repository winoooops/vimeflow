import { test, expect, vi } from 'vitest'
import type { DiffLineAnnotation } from '@pierre/diffs'
import type {
  ReviewComment,
  ReviewCommentCategory,
} from '../hooks/useFeedbackBatch'
import {
  formatFeedbackPayload,
  dispatchFeedbackBatch,
  formatReviewRequest,
  dispatchReviewRequest,
  type DispatchEntry,
} from './feedbackDispatch'
import type { ReviewedFile } from './pendingReviewRequests'

const makeAnnotation = (
  lineNumber: number,
  side: 'additions' | 'deletions',
  text: string,
  category?: ReviewCommentCategory
): DiffLineAnnotation<ReviewComment> => ({
  lineNumber,
  side,
  metadata: {
    id: `c-${lineNumber}-${side}`,
    text,
    author: 'self',
    createdAt: Date.now(),
    ...(category === undefined ? {} : { category }),
  },
})

const makeFileAnnotation = (
  text: string
): DiffLineAnnotation<ReviewComment> => ({
  lineNumber: 0,
  side: 'additions',
  metadata: {
    id: 'file-comment',
    text,
    author: 'self',
    createdAt: Date.now(),
    target: { scope: 'file' },
  },
})

test('1 item -> header uses singular wording', () => {
  const entries: DispatchEntry[] = [
    {
      filePath: 'src/App.tsx',
      staged: false,
      annotations: [makeAnnotation(5, 'additions', 'Nice work')],
    },
  ]
  const payload = formatFeedbackPayload(entries, 'n0nce')

  expect(payload).toContain('Inline review — 1 item.')
})

test('3 items -> header says plural count and body tags each target', () => {
  const entries: DispatchEntry[] = [
    {
      filePath: 'src/App.tsx',
      staged: false,
      annotations: [
        makeAnnotation(5, 'additions', 'Nice work'),
        makeAnnotation(10, 'deletions', 'Remove this'),
      ],
    },
    {
      filePath: 'src/main.tsx',
      staged: false,
      annotations: [makeAnnotation(3, 'additions', 'Consider renaming')],
    },
  ]
  const payload = formatFeedbackPayload(entries, 'n0nce')

  expect(payload).toContain('Inline review — 3 items.')
  expect(payload).toContain('[#1 · Change request] src/App.tsx:5 (additions)')
  expect(payload).toContain('[#2 · Change request] src/App.tsx:10 (deletions)')
  expect(payload).toContain('[#3 · Change request] src/main.tsx:3 (additions)')
})

test('multi-line comment prefixes every line', () => {
  const entries: DispatchEntry[] = [
    {
      filePath: 'src/App.tsx',
      staged: false,
      annotations: [
        makeAnnotation(5, 'additions', 'Line one\nLine two\nLine three'),
      ],
    },
  ]
  const payload = formatFeedbackPayload(entries, 'n0nce')

  expect(payload).toContain('src/App.tsx:5 (additions)')
  expect(payload).toContain('> ─ Line one')
  expect(payload).toContain('> ─ Line two')
  expect(payload).toContain('> ─ Line three')
})

test('category drives the tag and the intent instruction (VIM-253)', () => {
  const payload = formatFeedbackPayload(
    [
      {
        filePath: 'src/App.tsx',
        staged: false,
        annotations: [
          makeAnnotation(5, 'additions', 'Why capped at 3?', 'question'),
          makeAnnotation(8, 'additions', 'Off by one', 'bug'),
        ],
      },
    ],
    'n0nce'
  )

  expect(payload).toContain('[#1 · Question] src/App.tsx:5 (additions)')
  expect(payload).toContain(
    '> → Answer inline in your reply. Do not edit files.'
  )
  expect(payload).toContain('[#2 · Bug] src/App.tsx:8 (additions)')
  expect(payload).toContain('> → Fix this.')
})

test('an untagged comment defaults to a change request', () => {
  const payload = formatFeedbackPayload(
    [
      {
        filePath: 'src/App.tsx',
        staged: false,
        annotations: [makeAnnotation(5, 'additions', 'Nice work')],
      },
    ],
    'n0nce'
  )

  expect(payload).toContain('[#1 · Change request]')
  expect(payload).toContain('> → Make this change.')
})

test('each entry line is labelled with its staged/unstaged diff view', () => {
  const entries: DispatchEntry[] = [
    {
      filePath: 'src/App.tsx',
      staged: true,
      annotations: [makeAnnotation(5, 'additions', 'staged side')],
    },
    {
      filePath: 'src/App.tsx',
      staged: false,
      annotations: [makeAnnotation(8, 'additions', 'unstaged side')],
    },
  ]
  const payload = formatFeedbackPayload(entries, 'n0nce')

  // An MM file produces two same-path entries whose line numbers refer to
  // different comparisons — the [staged]/[unstaged] tag keeps them distinct.
  expect(payload).toContain('src/App.tsx:5 (additions) [staged]')
  expect(payload).toContain('src/App.tsx:8 (additions) [unstaged]')
})

test('file-level comments emit an explicit file target instead of a line target', () => {
  const payload = formatFeedbackPayload(
    [
      {
        filePath: 'src/App.tsx',
        staged: false,
        annotations: [makeFileAnnotation('Review the module boundary')],
      },
    ],
    'n0nce'
  )

  expect(payload).toContain('src/App.tsx (file) [unstaged]')
  expect(payload).not.toContain('src/App.tsx:0')
})

test('range comments emit start and end line targets', () => {
  const payload = formatFeedbackPayload(
    [
      {
        filePath: 'src/App.tsx',
        staged: false,
        annotations: [
          {
            lineNumber: 4,
            side: 'additions',
            metadata: {
              id: 'range-comment',
              text: 'Review this block',
              author: 'self',
              createdAt: Date.now(),
              target: {
                scope: 'range',
                side: 'additions',
                startLine: 4,
                endLine: 6,
              },
            },
          },
        ],
      },
    ],
    'n0nce'
  )

  expect(payload).toContain('src/App.tsx:4-6 (additions) [unstaged]')
})

test('the footer instructs the agent to emit the reply block with the nonce', () => {
  const payload = formatFeedbackPayload(
    [
      {
        filePath: 'src/a.ts',
        staged: false,
        annotations: [makeAnnotation(5, 'additions', 'Why?', 'question')],
      },
    ],
    'n0nc3'
  )

  expect(payload).toContain('<<<VIMEFLOW_REPLY')
  expect(payload).toContain('"nonce":"n0nc3"')
  expect(payload).toContain('VIMEFLOW_REPLY>>>')
})

test('dispatchFeedbackBatch calls writePty once with paste-bracketed payload', async () => {
  const writePty = vi.fn().mockResolvedValue(undefined)

  const entries: DispatchEntry[] = [
    {
      filePath: 'src/App.tsx',
      staged: false,
      annotations: [makeAnnotation(5, 'additions', 'Nice work')],
    },
  ]

  await dispatchFeedbackBatch('pane-1', 'pty-1', entries, 'n0nce', writePty)

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
      staged: false,
      annotations: [
        makeAnnotation(5, 'additions', 'breakout\x1b[201~\rinjected'),
      ],
    },
  ]
  const body = formatFeedbackPayload(entries, 'n0nce')

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

const reviewedFiles: ReviewedFile[] = [
  { path: 'src/auth.ts', additions: [{ start: 40, end: 50 }], deletions: [] },
  { path: 'src/db.ts', additions: [], deletions: [{ start: 1, end: 3 }] },
]

test('formatReviewRequest names the scope, coordinate convention, and block (VIM-304)', () => {
  const payload = formatReviewRequest(reviewedFiles, false, 'r3v13w')

  expect(payload).toContain('unstaged diff of these 2 files')
  expect(payload).toContain('> ─ src/auth.ts')
  expect(payload).toContain('> ─ src/db.ts')
  expect(payload).toContain('"additions" uses new-file lines')
  expect(payload).toContain('<<<VIMEFLOW_REVIEW')
  expect(payload).toContain('"nonce":"r3v13w"')
  expect(payload).toContain('VIMEFLOW_REVIEW>>>')
})

test('formatReviewRequest can include absolute prompt paths while preserving JSON paths', () => {
  const payload = formatReviewRequest(
    [
      {
        path: 'src/auth.ts',
        promptPath: '/repo/src/auth.ts',
        additions: [{ start: 40, end: 50 }],
        deletions: [],
      },
    ],
    false,
    'r3v13w'
  )

  expect(payload).toContain('> ─ src/auth.ts (/repo/src/auth.ts)')
  expect(payload).toContain(
    'use the repo-relative path before the parentheses as each finding path'
  )
  expect(payload).toContain('"path":"<file>"')
})

test('formatReviewRequest uses the staged label + singular wording', () => {
  const payload = formatReviewRequest([reviewedFiles[0]], true, 'n')

  expect(payload).toContain('staged diff of these 1 file:')
})

test('dispatchReviewRequest calls writePty once with a paste-bracketed payload', async () => {
  const writePty = vi.fn().mockResolvedValue(undefined)

  await dispatchReviewRequest('pty-1', reviewedFiles, false, 'n', writePty)

  expect(writePty).toHaveBeenCalledTimes(1)
  const sent = writePty.mock.calls[0][1] as string
  expect(sent.startsWith('\x1b[200~')).toBe(true)
  expect(sent.endsWith('\x1b[201~\r')).toBe(true)
})

test('formatReviewRequest strips control chars from a crafted path', () => {
  const payload = formatReviewRequest(
    [{ path: 'src/ev\x1b[201~il.ts', additions: [], deletions: [] }],
    false,
    'n'
  )

  expect(payload).not.toContain('\x1b')
  expect(payload).toContain('src/ev[201~il.ts')
})
