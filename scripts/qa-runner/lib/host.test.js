import { afterEach, describe, expect, test } from 'vitest'
import { createHost } from './host.js'

const servers = []

const STATUS_AUTH_FIXTURE = 'qa-status-auth-fixture'
const INVALID_STATUS_AUTH_FIXTURE = 'qa-status-auth-invalid'
const WEBHOOK_AUTH_FIXTURE = 'qa-webhook-auth-fixture'
const AUTHORIZATION_SCHEME = 'Bearer'

const makeDeps = (statusToken = STATUS_AUTH_FIXTURE) => ({
  config: {
    statusToken,
    trustedSenders: [],
    triggerPhrase: '/upsource-review',
    webhookSecret: WEBHOOK_AUTH_FIXTURE,
  },
  queue: {
    depth: () => 2,
    inFlight: () => [341],
    enqueue: () => true,
  },
  state: {
    all: () => ({
      341: {
        lastHeadSha: 'abc123',
      },
    }),
  },
  log: () => undefined,
})

const startServer = async (deps) => {
  const server = createHost(deps)

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  servers.push(server)

  const { port } = server.address()

  return {
    request: (path, init = {}) =>
      fetch(`http://127.0.0.1:${port}${path}`, init),
  }
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve) => {
          server.close(resolve)
        })
    )
  )
})

describe('createHost /status auth', () => {
  test('keeps status disabled when no status token is configured', async () => {
    const host = await startServer(makeDeps(''))

    const response = await host.request('/status', {
      headers: {
        'X-QA-Status-Token': STATUS_AUTH_FIXTURE,
      },
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'not found' })
  })

  test('accepts the existing Bearer token contract', async () => {
    const host = await startServer(makeDeps())

    const response = await host.request('/status', {
      headers: {
        Authorization: `${AUTHORIZATION_SCHEME} ${STATUS_AUTH_FIXTURE}`,
      },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      queueDepth: 2,
      inFlight: [341],
      prs: {
        341: {
          lastHeadSha: 'abc123',
        },
      },
    })
  })

  test('accepts X-QA-Status-Token for proxies that do not pass Authorization', async () => {
    const host = await startServer(makeDeps())

    const response = await host.request('/status', {
      headers: {
        'X-QA-Status-Token': STATUS_AUTH_FIXTURE,
      },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      queueDepth: 2,
      inFlight: [341],
    })
  })

  test('rejects missing or incorrect status tokens', async () => {
    const host = await startServer(makeDeps())
    const missing = await host.request('/status')

    const wrong = await host.request('/status', {
      headers: {
        Authorization: `${AUTHORIZATION_SCHEME} ${INVALID_STATUS_AUTH_FIXTURE}`,
        'X-QA-Status-Token': INVALID_STATUS_AUTH_FIXTURE,
      },
    })

    expect(missing.status).toBe(401)
    expect(wrong.status).toBe(401)
  })
})
