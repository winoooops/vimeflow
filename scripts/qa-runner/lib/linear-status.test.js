import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { loadAuthFromRoot } from './linear-status.js'

const tempRoots = []
const originalLinearApiKey = process.env.LINEAR_API_KEY

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
  if (originalLinearApiKey == null) {
    delete process.env.LINEAR_API_KEY
  } else {
    process.env.LINEAR_API_KEY = originalLinearApiKey
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
})
