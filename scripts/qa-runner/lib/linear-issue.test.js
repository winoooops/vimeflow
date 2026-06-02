import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { buildPrIssueInput, createLinearIssueForPr } from './linear-issue.js'

const tempRoots = []

const makeRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'linear-issue-'))
  tempRoots.push(root)

  return root
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true })
  }
})

describe('buildPrIssueInput', () => {
  test('creates a clear PR-linked issue payload', () => {
    expect(
      buildPrIssueInput({
        teamId: 'team-id',
        pr: 330,
        title: 'QA runner comments',
        url: 'https://github.com/winoooops/vimeflow/pull/330',
        branch: 'feature/vim-20',
      })
    ).toEqual({
      teamId: 'team-id',
      title: 'Review PR #330: QA runner comments',
      description: [
        'Created by the QA orchestrator because this pull request had no linked Linear issue.',
        '',
        'GitHub PR: https://github.com/winoooops/vimeflow/pull/330',
        'Branch: `feature/vim-20`',
      ].join('\n'),
    })
  })
})

describe('createLinearIssueForPr', () => {
  test('uses the orchestrator app auth and creates an issue in the configured team', async () => {
    const root = makeRoot()
    writeFileSync(
      join(root, 'linear-orchestrator.env'),
      ['LINEAR_CLIENT_ID=client-id', 'LINEAR_CLIENT_SECRET=client-secret'].join(
        '\n'
      )
    )

    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: 'app-token' }),
    }))

    const gql = vi
      .fn()
      .mockResolvedValueOnce({
        teams: { nodes: [{ id: 'team-id', key: 'VIM', name: 'Vimeflow' }] },
      })
      .mockResolvedValueOnce({
        issueCreate: {
          success: true,
          issue: {
            id: 'issue-id',
            identifier: 'VIM-42',
            url: 'https://linear.app/vimeflow/issue/VIM-42/test',
          },
        },
      })

    const issue = await createLinearIssueForPr(
      {
        teamKey: 'VIM',
        pr: 330,
        title: 'QA runner comments',
        url: 'https://github.com/winoooops/vimeflow/pull/330',
        branch: 'feature/vim-20',
      },
      { root, fetchImpl, gql }
    )

    expect(issue.identifier).toBe('VIM-42')
    expect(gql).toHaveBeenCalledWith(
      'Bearer app-token',
      expect.stringContaining('teams'),
      { key: 'VIM' },
      fetchImpl
    )

    expect(gql.mock.calls[1][2].input).toEqual(
      expect.objectContaining({
        teamId: 'team-id',
        title: 'Review PR #330: QA runner comments',
      })
    )
  })
})
