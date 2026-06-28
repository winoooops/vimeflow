import assert from 'node:assert/strict'
import test from 'node:test'
import { formatReviewComment, publishableFindings } from './format-review-comment.mjs'

const finding = {
  title: 'Real bug',
  body: 'This breaks changed code.',
  severity: 'MEDIUM',
  confidence_score: 0.91,
  guard: {
    passes: true,
    reason: 'Concrete bug risk in changed code; localized fix.',
  },
  code_location: {
    absolute_file_path: 'src/example.ts',
    line_range: { start: 4, end: 5 },
  },
  idea: {
    intent: 'Keep state valid.',
    danger: 'Invalid state can ship.',
    explain: 'The branch forgot the empty case.',
    alternatives: 'Guard before writing state.',
  },
}

test('publishes only findings that pass the guard and confidence threshold', () => {
  assert.deepEqual(
    publishableFindings({
      findings: [
        finding,
        { ...finding, title: 'No guard', guard: { passes: false, reason: 'nit' } },
        { ...finding, title: 'Weak', confidence_score: 0.8 },
      ],
    }),
    [finding]
  )
})

test('formats a clean review when all findings are filtered', () => {
  const body = formatReviewComment(
    JSON.stringify({
      findings: [{ ...finding, guard: { passes: false, reason: 'style nit' } }],
      overall_correctness: 'patch has issues',
      overall_explanation: 'raw reviewer saw a nit',
      overall_confidence_score: 0.9,
    }),
    'Claude Code Review'
  )

  assert.match(body, /No issues found after review guard/)
  assert.match(body, /patch is correct/)
  assert.doesNotMatch(body, /Real bug/)
})

test('keeps raw output visible when review JSON is malformed', () => {
  assert.equal(
    formatReviewComment('{nope', 'Claude Code Review'),
    '## Claude Code Review\n\n{nope'
  )
})
