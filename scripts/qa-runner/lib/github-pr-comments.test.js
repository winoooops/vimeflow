import { describe, expect, test } from 'vitest'
import {
  formatLinearIssueGithubComment,
  linearIssueGithubCommentMarker,
  postLinearIssueGithubComment,
} from './github-pr-comments.js'

describe('formatLinearIssueGithubComment', () => {
  test('adds a stable dedupe marker and Linear issue link', () => {
    const body = formatLinearIssueGithubComment({
      identifier: 'VIM-123',
      url: 'https://linear.app/vimeflow/issue/VIM-123/test',
    })

    expect(body).toContain('<!-- qa-runner-linear-issue:VIM-123 -->')
    expect(body).toContain(
      '[VIM-123](https://linear.app/vimeflow/issue/VIM-123/test)'
    )
    expect(body).toContain('future QA updates')
  })

  test('falls back to a plain issue id when no url is cached', () => {
    expect(formatLinearIssueGithubComment({ identifier: 'vim-124' })).toContain(
      '`VIM-124`'
    )
  })
})

describe('postLinearIssueGithubComment', () => {
  const repo = {
    owner: 'example',
    name: 'repo',
    pr: 456,
    identifier: 'VIM-456',
    url: 'https://linear.app/vimeflow/issue/VIM-456/test',
  }

  test('does not post when the marker already exists', () => {
    const calls = []

    const result = postLinearIssueGithubComment(repo, {
      gh: (args) => {
        calls.push(args)

        return `hello\n${linearIssueGithubCommentMarker('VIM-456')}\n`
      },
    })

    expect(result).toEqual({
      ok: true,
      skipped: true,
      commentId: null,
      reason: null,
    })

    expect(calls).toEqual([
      [
        'api',
        'repos/example/repo/issues/456/comments',
        '--paginate',
        '--jq',
        '.[].body',
      ],
    ])
  })

  test('posts a PR issue comment when missing', () => {
    const calls = []

    const result = postLinearIssueGithubComment(repo, {
      gh: (args) => {
        calls.push(args)

        return args.includes('--paginate') ? '' : '991\n'
      },
    })

    expect(result).toEqual({
      ok: true,
      skipped: false,
      commentId: '991',
      reason: null,
    })

    expect(calls[0]).toEqual([
      'api',
      'repos/example/repo/issues/456/comments',
      '--paginate',
      '--jq',
      '.[].body',
    ])

    expect(calls[1]).toEqual([
      'api',
      'repos/example/repo/issues/456/comments',
      '-f',
      expect.stringContaining('body=<!-- qa-runner-linear-issue:VIM-456 -->'),
      '--jq',
      '.id',
    ])
  })

  test('returns a concise reason when gh fails before posting', () => {
    const result = postLinearIssueGithubComment(repo, {
      gh: () => {
        const error = new Error('gh api failed\nmore detail')
        error.stderr = 'denied\nmore detail'
        throw error
      },
    })

    expect(result).toEqual({
      ok: false,
      skipped: false,
      commentId: null,
      reason: 'denied',
    })
  })
})
