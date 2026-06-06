import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  createLinearComment,
  loadAuthFromRoot,
  parseLinearCommentId,
} from './linear-status.js'

const tempRoots = []

const ENV_KEYS = [
  'LINEAR_API_KEY',
  'LINEAR_CLIENT_ID',
  'LINEAR_CLIENT_SECRET',
  'LINEAR_SCOPES',
  'LINEAR_ACCESS_TOKEN',
  'LINEAR_AGENT_TOKEN',
]

const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]])
)

const makeRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'linear-status-'))
  tempRoots.push(root)

  return root
}

const writeEnv = (root, file, body) => {
  writeFileSync(join(root, file), body)
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true })
  }

  for (const key of ENV_KEYS) {
    if (originalEnv[key] == null) {
      delete process.env[key]
    } else {
      process.env[key] = originalEnv[key]
    }
  }
})

describe('loadAuthFromRoot', () => {
  test('mints a role app token from client credentials', async () => {
    const root = makeRoot()
    writeEnv(
      root,
      'linear-agent.env',
      [
        'LINEAR_CLIENT_ID=client-id',
        'LINEAR_CLIENT_SECRET=client-secret',
        'LINEAR_SCOPES=read,write',
      ].join('\n')
    )

    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: 'app-token' }),
    }))

    const auth = await loadAuthFromRoot('fixer', root, fetchImpl)

    expect(auth).toEqual({
      header: 'Bearer app-token',
      who: 'fixer app',
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.linear.app/oauth/token',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
    )

    expect(String(fetchImpl.mock.calls[0][1].body)).toContain(
      'grant_type=client_credentials'
    )
  })

  test('keeps the stored role access token fallback', async () => {
    const root = makeRoot()
    writeEnv(root, 'linear-orchestrator.env', 'LINEAR_ACCESS_TOKEN=oauth-token')
    const fetchImpl = vi.fn()

    await expect(
      loadAuthFromRoot('orchestrator', root, fetchImpl)
    ).resolves.toEqual({
      header: 'Bearer oauth-token',
      who: 'orchestrator access token',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('mints a role app token from process env credentials', async () => {
    const root = makeRoot()
    process.env.LINEAR_CLIENT_ID = 'env-client-id'
    process.env.LINEAR_CLIENT_SECRET = 'env-client-secret'
    process.env.LINEAR_SCOPES = 'read,write'

    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: 'env-app-token' }),
    }))

    await expect(
      loadAuthFromRoot('orchestrator', root, fetchImpl)
    ).resolves.toEqual({
      header: 'Bearer env-app-token',
      who: 'orchestrator app',
    })

    expect(String(fetchImpl.mock.calls[0][1].body)).toContain(
      'client_id=env-client-id'
    )
  })

  test('falls back to stored role access token when client credentials fail', async () => {
    const root = makeRoot()
    writeEnv(
      root,
      'linear-orchestrator.env',
      [
        'LINEAR_CLIENT_ID=client-id',
        'LINEAR_CLIENT_SECRET=client-secret',
        'LINEAR_ACCESS_TOKEN=oauth-token',
      ].join('\n')
    )

    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        error_description:
          'Client does not support the client_credentials grant type',
      }),
    }))

    await expect(
      loadAuthFromRoot('orchestrator', root, fetchImpl)
    ).resolves.toEqual({
      header: 'Bearer oauth-token',
      who: 'orchestrator access token',
    })
  })

  test('falls back to a personal api key outside role app auth', async () => {
    const root = makeRoot()
    process.env.LINEAR_API_KEY = 'lin_api_test'

    await expect(loadAuthFromRoot(undefined, root, vi.fn())).resolves.toEqual({
      header: 'lin_api_test',
      who: 'you (personal key)',
    })
  })

  test('ignores unreadable fallback env files when process env auth is available', async () => {
    const root = makeRoot()
    writeEnv(root, 'linear-agent.env', 'LINEAR_API_KEY=lin_api_file')
    chmodSync(join(root, 'linear-agent.env'), 0)
    process.env.LINEAR_CLIENT_ID = 'env-client-id'
    process.env.LINEAR_CLIENT_SECRET = 'env-client-secret'

    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: 'env-app-token' }),
    }))

    await expect(loadAuthFromRoot('fixer', root, fetchImpl)).resolves.toEqual({
      header: 'Bearer env-app-token',
      who: 'fixer app',
    })
  })

  test('does not hard-fail when the personal fallback env file is unreadable', async () => {
    const root = makeRoot()
    writeEnv(root, 'linear.env', 'LINEAR_API_KEY=lin_api_file')
    chmodSync(join(root, 'linear.env'), 0)

    await expect(loadAuthFromRoot(undefined, root, vi.fn())).rejects.toThrow(
      'no Linear auth'
    )
  })
})

describe('createLinearComment', () => {
  test('creates a top-level issue comment when no parent is provided', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          commentCreate: {
            success: true,
            comment: { id: 'top-level-comment' },
          },
        },
      }),
    }))

    await expect(
      createLinearComment(
        'Bearer token',
        { issueId: 'issue-id', body: 'body' },
        fetchImpl
      )
    ).resolves.toBe('top-level-comment')

    const payload = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(payload.query).toContain('issueId')
    expect(payload.query).not.toContain('parentId')
    expect(payload.variables).toEqual({ id: 'issue-id', body: 'body' })
  })

  test('creates a threaded reply with issue and parent ids', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          commentCreate: {
            success: true,
            comment: { id: 'reply-comment' },
          },
        },
      }),
    }))

    await expect(
      createLinearComment(
        'Bearer token',
        { issueId: 'issue-id', parentId: 'parent-comment', body: 'body' },
        fetchImpl
      )
    ).resolves.toBe('reply-comment')

    const payload = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(payload.query).toContain('parentId')
    expect(payload.query).toContain('issueId')
    expect(payload.variables).toEqual({
      id: 'issue-id',
      parentId: 'parent-comment',
      body: 'body',
    })
  })
})

describe('parseLinearCommentId', () => {
  test('extracts comment id from structured stdout', () => {
    expect(
      parseLinearCommentId(
        'commented on VIM-20 (as orchestrator, comment abc-123)\ncomment-id:\tabc-123\n'
      )
    ).toBe('abc-123')
  })

  test('returns null when comment-id line is empty', () => {
    expect(
      parseLinearCommentId(
        'commented on VIM-20 (as orchestrator)\ncomment-id:\t\n'
      )
    ).toBeNull()
  })

  test('returns null when comment-id line is missing', () => {
    expect(
      parseLinearCommentId('commented on VIM-20 (as orchestrator)\n')
    ).toBeNull()
  })

  test('returns null for empty stdout', () => {
    expect(parseLinearCommentId('')).toBeNull()
  })
})
