#!/usr/bin/env node
// QA daemon — the state-owning orchestrator. Webhook receiver + worker pool +
// fallback poll, draining on SIGTERM/SIGINT. Long-running; deploy on a host with
// node + gh + git + kimi + the bot/Linear env files. Run from the repo root:
//
//   GITHUB_WEBHOOK_SECRET=… QA_TRUSTED_SENDERS=you node scripts/qa-runner/daemon.js
//
// GitHub POSTs to /webhooks/github (behind a TLS proxy — GitHub requires HTTPS).
// The receiver verifies + enqueues fast; the worker pool does the heavy review.
import { execFileSync } from 'node:child_process'
import { loadConfig } from './lib/config.js'
import { createState } from './lib/daemon-state.js'
import { createQueue } from './lib/queue.js'
import { createHost } from './lib/host.js'
import { runOne } from './lib/worker.js'
import { createEvents } from './lib/events.js'

const log = (s) => process.stdout.write(`${new Date().toISOString()} ${s}\n`)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const config = loadConfig()
const state = createState()
const queue = createQueue()
const events = createEvents(log)
let running = true

// One worker: claim a PR, run a single cycle, release, repeat. Live concurrency
// is capped by the worker count (config.maxParallel).
const worker = async (id) => {
  while (running) {
    const job = queue.take()
    if (!job) {
      await sleep(1500)
      continue
    }
    try {
      const outcome = await runOne(job.pr, job.reason, {
        config,
        state,
        log,
        events,
      })
      if (outcome === 'retry' && job.reason !== 'poll') {
        queue.enqueue(job.pr, job.reason)
      }
    } catch (e) {
      log(`worker ${id}: #${job.pr} ERROR ${e.message}`)
    } finally {
      try {
        queue.done(job.pr)
      } catch (e) {
        log(`worker ${id}: queue.done failed — ${e.message}`)
      }
    }
  }
}

// Fallback poll — enqueue every eligible auto-review PR so a missed webhook can't
// stall a PR. Deduped by the queue.
const poll = async () => {
  while (running) {
    try {
      const prs = JSON.parse(
        execFileSync(
          'gh',
          [
            'pr',
            'list',
            '--state',
            'open',
            '--label',
            config.label,
            // gh defaults to 30 — cap high so a missed webhook on PR #31+ still enqueues.
            '--limit',
            '200',
            '--json',
            'number,isDraft',
          ],
          { encoding: 'utf8' }
        )
      )
      for (const pr of prs) {
        if (!pr.isDraft) {
          queue.enqueue(pr.number, 'poll')
        }
      }
    } catch (e) {
      log(`poll ERROR ${e.message}`)
    }
    await sleep(config.pollSeconds * 1000)
  }
}

const server = createHost({ config, queue, state, log })
server.listen(config.port, config.host, () => {
  log(
    `QA daemon → http://${config.host}:${config.port}  POST /webhooks/github · GET /healthz · GET /status`
  )

  log(
    `config: label=${config.label} maxParallel=${config.maxParallel} maxNoops=${config.maxNoops} pollSeconds=${config.pollSeconds} trusted=[${config.trustedSenders.join(',')}]`
  )
  if (!config.webhookSecret) {
    log(
      'WARNING: GITHUB_WEBHOOK_SECRET unset — webhook endpoint FAILS CLOSED (rejects all).'
    )
  }
  if (!config.trustedSenders.length) {
    log('WARNING: QA_TRUSTED_SENDERS empty — comment triggers are disabled.')
  }
})

for (let i = 0; i < config.maxParallel; i++) {
  worker(i + 1)
}
poll()

// Graceful-ish shutdown: stop accepting + claiming; let in-flight cycles finish
// (state is checkpointed each tick); force-exit after a grace window.
const shutdown = (sig) => {
  log(`${sig} — draining; in-flight: ${queue.inFlight().join(', ') || 'none'}`)
  running = false
  server.close(() => log('http server closed'))
  setTimeout(() => {
    log('drain window elapsed — exiting')
    process.exit(0)
  }, 60000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
