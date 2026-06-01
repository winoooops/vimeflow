// HTTP receiver — the daemon's deployable REST surface. Verifies, parses, and
// enqueues fast (the heavy review work happens in the worker pool), so GitHub
// always gets a quick 2xx.
//   POST /webhooks/github   verify sig → parse → enqueue → 202 · 401 bad sig · 200 ignored
//   GET  /healthz           liveness (no state — always open)
//   GET  /status            queue depth + in-flight + per-PR state — Bearer-gated
import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { parseEvent, verifySignature } from './webhook.js'

// Constant-time Bearer check for /status. No token configured ⇒ always false, so
// the caller disables the endpoint (the 0.0.0.0 webhook bind never leaks state).
const bearerOk = (header, token) => {
  if (!token) {
    return false
  }
  const expected = Buffer.from(`Bearer ${token}`)
  const got = Buffer.from(header || '')

  return got.length === expected.length && timingSafeEqual(got, expected)
}

const readRawBody = (req, limit = 2 * 1024 * 1024) =>
  new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        req.destroy()
        reject(new Error('payload too large'))

        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })

const sendJson = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(obj))
}

const handleWebhook = async (req, res, deps) => {
  const { config, queue, log } = deps
  let raw
  try {
    raw = await readRawBody(req)
  } catch (e) {
    sendJson(res, 413, { error: e.message })

    return
  }
  if (
    !verifySignature(
      raw,
      req.headers['x-hub-signature-256'],
      config.webhookSecret
    )
  ) {
    log(`webhook: REJECTED bad signature from ${req.socket.remoteAddress}`)
    sendJson(res, 401, { error: 'bad signature' })

    return
  }
  const eventType = req.headers['x-github-event']
  if (eventType === 'ping') {
    sendJson(res, 200, { ok: true, pong: true })

    return
  }
  let payload
  try {
    payload = JSON.parse(raw.toString('utf8'))
  } catch {
    sendJson(res, 400, { error: 'invalid json' })

    return
  }

  const work = parseEvent(eventType, payload, {
    trustedSenders: config.trustedSenders,
    triggerPhrase: config.triggerPhrase,
  })
  if (!work) {
    sendJson(res, 200, { ignored: true, event: eventType })

    return
  }
  const fresh = queue.enqueue(work.pr, work.reason)
  log(
    `webhook: ${eventType} → PR #${work.pr} (${work.reason}) ${fresh ? 'ENQUEUED' : 'deduped'}`
  )
  sendJson(res, 202, { pr: work.pr, reason: work.reason, enqueued: fresh })
}

// Build (not start) the HTTP server. deps: { config, queue, state, log }.
export const createHost = (deps) => {
  const { config, queue, state } = deps
  const startedAt = Date.now()

  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    try {
      if (req.method === 'GET' && url.pathname === '/healthz') {
        sendJson(res, 200, {
          ok: true,
          uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        })

        return
      }
      if (req.method === 'GET' && url.pathname === '/status') {
        if (!config.statusToken) {
          // Generic 404 (not a descriptive one): a disabled /status must be
          // indistinguishable from a nonexistent path so the public bind reveals
          // neither the endpoint nor the env-var that enables it.
          sendJson(res, 404, { error: 'not found' })

          return
        }
        if (!bearerOk(req.headers.authorization, config.statusToken)) {
          sendJson(res, 401, { error: 'unauthorized' })

          return
        }
        sendJson(res, 200, {
          queueDepth: queue.depth(),
          inFlight: queue.inFlight(),
          prs: state.all(),
        })

        return
      }
      if (req.method === 'POST' && url.pathname === '/webhooks/github') {
        await handleWebhook(req, res, deps)

        return
      }
      sendJson(res, 404, { error: 'not found' })
    } catch (e) {
      if (!res.headersSent) {
        sendJson(res, 500, { error: e.message })
      }
    }
  })
}
