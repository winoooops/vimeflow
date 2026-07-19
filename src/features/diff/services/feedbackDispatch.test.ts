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
  followUpContextLine,
  isFollowUpComment,
  type DispatchEntry,
  type ReviewRequestFile,
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

test('the footer teaches the outcome vocabulary, not the legacy literals', () => {
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

  for (const outcome of [
    '"reply"',
    '"clarify"',
    '"resolved"',
    '"deferred"',
    '"rejected"',
  ]) {
    expect(payload).toContain(outcome)
  }
  expect(payload).toContain('"status":"reply"')
  expect(payload).not.toContain('"answered"')
  expect(payload).not.toContain('"skipped"')
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
  {
    path: 'src/auth.ts',
    staged: false,
    additions: [{ start: 40, end: 50 }],
    deletions: [],
  },
  {
    path: 'src/db.ts',
    staged: false,
    additions: [],
    deletions: [{ start: 1, end: 3 }],
  },
]

test('formatReviewRequest names the scope, coordinate convention, and block (VIM-304)', () => {
  const payload = formatReviewRequest(reviewedFiles, 'r3v13w')

  expect(payload).toContain('> Delegate a code review of these 2 changes:')
  expect(payload).toContain('> ─ src/auth.ts')
  expect(payload).toContain('> ─ src/db.ts')
  expect(payload).toContain('"additions" uses new-file lines')
  expect(payload).toContain(
    '"range" uses side + startLine + endLine; "file" uses neither'
  )
  expect(payload).toContain('<<<VIMEFLOW_REVIEW')
  expect(payload).toContain('"nonce":"r3v13w"')
  expect(payload).toContain('VIMEFLOW_REVIEW>>>')

  expect(payload).toContain(
    'If the user later asks you to address these findings'
  )

  expect(payload).toContain(
    '{"v":1,"nonce":"r3v13w","replies":[{"target":"finding","id":1,"status":"resolved","text":"..."}]}'
  )

  expect(payload).toContain(
    'Follow-up example (do not emit this block in the current review reply)'
  )
})

test('formatReviewRequest can include absolute prompt paths while preserving JSON paths', () => {
  const payload = formatReviewRequest(
    [
      {
        path: 'src/auth.ts',
        staged: false,
        promptPath: '/repo/src/auth.ts',
        additions: [{ start: 40, end: 50 }],
        deletions: [],
      },
    ],
    'r3v13w'
  )

  expect(payload).toContain('> ─ src/auth.ts (/repo/src/auth.ts)')
  expect(payload).toContain(
    'use the repo-relative path before the parentheses as each finding path'
  )
  expect(payload).toContain('"path":"<file>"')
})

test('formatReviewRequest singular wording', () => {
  const payload = formatReviewRequest([reviewedFiles[0]], 'n')

  expect(payload).toContain('> Delegate a code review of this 1 change:')
})

test('dispatchReviewRequest calls writePty once with a paste-bracketed payload', async () => {
  const writePty = vi.fn().mockResolvedValue(undefined)

  await dispatchReviewRequest('pty-1', reviewedFiles, 'n', writePty)

  expect(writePty).toHaveBeenCalledTimes(1)
  const sent = writePty.mock.calls[0][1] as string
  expect(sent.startsWith('\x1b[200~')).toBe(true)
  expect(sent.endsWith('\x1b[201~\r')).toBe(true)
})

test('formatReviewRequest strips control chars from a crafted path', () => {
  const payload = formatReviewRequest(
    [
      {
        path: 'src/ev\x1b[201~il.ts',
        staged: false,
        additions: [],
        deletions: [],
      },
    ],
    'n'
  )

  expect(payload).not.toContain('\x1b')
  expect(payload).toContain('src/ev[201~il.ts')
})

test('formatReviewRequest groups entries by half and annotates untracked', () => {
  const files: ReviewRequestFile[] = [
    {
      path: 'src/a.ts',
      staged: false,
      additions: [],
      deletions: [],
      promptPath: '/repo/src/a.ts',
    },
    {
      path: 'src/new.ts',
      staged: false,
      additions: [],
      deletions: [],
      promptPath: '/repo/src/new.ts',
      untracked: true,
    },
    {
      path: 'src/a.ts',
      staged: true,
      additions: [],
      deletions: [],
      promptPath: '/repo/src/a.ts',
    },
    {
      path: 'src/c.ts',
      staged: true,
      additions: [],
      deletions: [],
      promptPath: '/repo/src/c.ts',
    },
  ]

  const prompt = formatReviewRequest(files, 'n0nce1')

  expect(prompt).toContain('> Delegate a code review of these 4 changes:')
  const unstagedIndex = prompt.indexOf('> unstaged diff (`git diff`):')
  const stagedIndex = prompt.indexOf('> staged diff (`git diff --cached`):')
  expect(unstagedIndex).toBeGreaterThan(-1)
  expect(stagedIndex).toBeGreaterThan(unstagedIndex)
  expect(prompt).toContain(
    '> ─ src/new.ts (/repo/src/new.ts) (untracked — not in git diff; read the file, all lines are additions)'
  )
  // contract block untouched
  expect(prompt).toContain('<<<VIMEFLOW_REVIEW')
  expect(prompt).toContain('"nonce":"n0nce1"')
})

test('formatReviewRequest with a single half emits only that group', () => {
  const files: ReviewRequestFile[] = [
    {
      path: 'src/a.ts',
      staged: false,
      additions: [],
      deletions: [],
      promptPath: '/repo/src/a.ts',
    },
  ]

  const prompt = formatReviewRequest(files, 'n0nce2')

  expect(prompt).toContain('> Delegate a code review of this 1 change:')
  expect(prompt).toContain('> unstaged diff (`git diff`):')
  expect(prompt).not.toContain('staged diff (`git diff --cached`)')
})

test('a typeless follow-up renders as [#n · Follow-up] with the context line', () => {
  const payload = formatFeedbackPayload(
    [
      {
        filePath: '/repo/src/auth.ts',
        staged: false,
        annotations: [
          {
            side: 'additions',
            lineNumber: 42,
            metadata: {
              id: 'f1',
              text: 'How does that interact with resize?',
              author: 'self',
              createdAt: 1,
              threadId: 'root-1',
            },
          },
        ],
      },
    ],
    'abc123',
    '> ↩ Continuing our thread — your last reply: "The pool applies backpressure"'
  )

  expect(payload).toContain('[#1 · Follow-up] /repo/src/auth.ts:42')
  expect(payload).toContain(
    '> ↩ Continuing our thread — your last reply: "The pool applies backpressure"'
  )

  expect(payload).toContain(
    '> → Answer inline in your reply. Do not edit files.'
  )
  expect(payload).not.toContain('Change request')
})

test('followUpContextLine phrases by author, truncates, and strips controls', () => {
  expect(
    followUpContextLine({
      id: 'g1',
      text: 'short answer',
      author: 'agent',
      createdAt: 1,
    })
  ).toBe('> ↩ Continuing our thread — your last reply: "short answer"')

  expect(
    followUpContextLine({
      id: 'r1',
      text: 'finding text',
      author: 'reviewer',
      createdAt: 1,
    })
  ).toContain('the finding: "finding text"')

  expect(
    followUpContextLine({
      id: 'c1',
      text: 'my question',
      author: 'self',
      createdAt: 1,
    })
  ).toContain('my earlier comment: "my question"')

  const long = followUpContextLine({
    id: 'g2',
    text: 'x'.repeat(300),
    author: 'agent',
    createdAt: 1,
  })
  expect(long).toContain('(truncated)')
  expect(long.length).toBeLessThan(300)

  // Paste-breakout regression: agent-controlled text cannot terminate the
  // bracketed paste or inject CR into the prompt.
  const hostile = followUpContextLine({
    id: 'g3',
    text: 'evil\x1b[201~\rinjected',
    author: 'agent',
    createdAt: 1,
  })
  expect(hostile).not.toContain('\x1b')
  expect(hostile).not.toContain('\r')
})

test('a category-less dispatched ROOT is not a follow-up', () => {
  // threadId === id (self-rooted) + no category → still the default Change
  // request in the payload, NOT [#n · Follow-up].
  expect(
    isFollowUpComment({
      id: 'c1',
      threadId: 'c1',
      text: 't',
      author: 'self',
      createdAt: 1,
      dispatchedAt: 1000,
    })
  ).toBe(false)
})
