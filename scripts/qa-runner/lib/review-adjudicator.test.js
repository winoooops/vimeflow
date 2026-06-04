import { describe, expect, test } from 'vitest'
import {
  adjudicationCacheKey,
  buildAdjudicationPrompt,
  latestTrustedClaudeReview,
  normalizeAdjudication,
  summarizeBlockingFindings,
  trustedClaudeReviewComments,
} from './review-adjudicator.js'

const trustedComment = {
  id: 1,
  updated_at: '2026-06-04T00:00:00Z',
  user: { login: 'github-actions[bot]', type: 'Bot' },
  performed_via_github_app: { slug: 'github-actions' },
  body: '## Claude Code Review\n\n**Overall: patch is correct**',
}

describe('review adjudicator helpers', () => {
  test('selects only trusted Claude Code Review comments', () => {
    const comments = [
      trustedComment,
      {
        ...trustedComment,
        id: 2,
        user: { login: 'human', type: 'User' },
      },
      {
        ...trustedComment,
        id: 3,
        body: 'not a Claude review',
      },
    ]

    expect(trustedClaudeReviewComments(comments)).toEqual([trustedComment])
  })

  test('returns the latest trusted Claude review comment', () => {
    const later = {
      ...trustedComment,
      id: 4,
      updated_at: '2026-06-04T00:01:00Z',
    }

    expect(latestTrustedClaudeReview([trustedComment, later])).toBe(later)
  })

  test('cache key changes when review body changes', () => {
    const first = adjudicationCacheKey({
      pr: 1,
      headSha: 'abc',
      reviewComments: [trustedComment],
      diffText: 'diff',
    })

    const second = adjudicationCacheKey({
      pr: 1,
      headSha: 'abc',
      reviewComments: [{ ...trustedComment, body: 'changed' }],
      diffText: 'diff',
    })

    expect(first).not.toBe(second)
  })

  test('prompt includes policy and practical filtering instructions', () => {
    const prompt = buildAdjudicationPrompt({
      owner: 'owner',
      name: 'vimeflow',
      pr: 346,
      headSha: 'abc',
      reviewComments: [trustedComment],
      diffText: 'diff --git a/file b/file',
    })

    expect(prompt).toContain('agents/code-reviewer.md')
    expect(prompt).toContain('rules/common/idea-framework.md')
    expect(prompt).toContain('confidence is > 0.80')
    expect(prompt).toContain('how likely is the bug/problem to occur')
    expect(prompt).toContain('price/risk of fixing it now')
  })

  test('normalizes adjudicator output and rejects invalid decisions', () => {
    expect(
      normalizeAdjudication({
        decision: 'NEEDS_FIX',
        summary: 'fix this',
        confidence_score: 0.9,
        blocking_findings: [],
        non_blocking_findings: [],
      })
    ).toMatchObject({ decision: 'NEEDS_FIX' })

    expect(() => normalizeAdjudication({ decision: 'MAYBE' })).toThrow(
      "invalid decision 'MAYBE'"
    )
  })

  test('fails closed when Codex returns GOOD_SHAPE with blocking findings', () => {
    expect(
      normalizeAdjudication({
        decision: 'GOOD_SHAPE',
        summary: 'inconsistent',
        confidence_score: 0.9,
        blocking_findings: [
          {
            severity: 'MEDIUM',
            title: 'Missing guard',
          },
        ],
        non_blocking_findings: [],
      }).decision
    ).toBe('NEEDS_FIX')
  })

  test('summarizes blocking findings for runner detail text', () => {
    expect(
      summarizeBlockingFindings([
        { severity: 'MEDIUM', title: 'Config escape hatch is unreachable' },
      ])
    ).toBe('MEDIUM: Config escape hatch is unreachable')
  })
})
