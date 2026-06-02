// Observable lifecycle events for the daemon. Every event is appended to
// .state/events.jsonl — a structured, append-only POOL for later metrics
// (success rate, rounds-to-merge, durations; the aggregator is a follow-up).
// MILESTONE events also post a one-line comment to the linked VIM issue AS THE
// ORCHESTRATOR AGENT (Bearer), so the whole lifecycle is observable in Linear,
// not just the logs. Best-effort throughout: neither the file write nor the
// Linear post may ever break or block the loop.
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const LIB_DIR = dirname(fileURLToPath(import.meta.url))
const STATE_DIR = join(dirname(LIB_DIR), '.state')
const EVENTS_FILE = join(STATE_DIR, 'events.jsonl')
const LINEAR_STATUS = join(LIB_DIR, 'linear-status.js')

// type → a one-line Linear comment. Types absent here are pool/log only (no spam).
const LINEAR_COMMENT = {
  progress: (e) =>
    `✅ Fix pushed for #${e.pr} (round ${e.round}). Re-review pending.`,
  dispatch_blocked: (e) =>
    [
      '## QA runner dispatch blocked',
      '',
      '| Field | Value |',
      '| --- | --- |',
      `| PR | #${e.pr} |`,
      `| Reason | ${String(e.detail || 'unknown').replace(/\s+/g, ' ')} |`,
      '',
      'The fixer did not run and this was not counted as a failed fix attempt. Run the daemon from a neutral checkout, free the PR branch worktree, or push a new head event to resume.',
    ].join('\n'),
  paused: (e) =>
    `⏸️ Paused #${e.pr} after ${e.noopCount} failed fix attempts — ${e.detail || 'needs a look'}.`,
  merged: (e) => `🎉 #${e.pr} merged — review loop complete.`,
  closed: (e) => `🚫 #${e.pr} closed without merge — review loop stopped.`,
}

export const createEvents = (log) => {
  // Append to the pool + log every event; returns the stamped record.
  const record = (event) => {
    const e = { ts: new Date().toISOString(), ...event }
    try {
      mkdirSync(STATE_DIR, { recursive: true })
      appendFileSync(EVENTS_FILE, `${JSON.stringify(e)}\n`)
    } catch {
      // best-effort: the metrics pool must never break the loop
    }
    log(
      `event ${e.type} #${e.pr ?? '-'}${e.round != null ? ` r${e.round}` : ''}${e.detail ? ` — ${e.detail}` : ''}`
    )

    return e
  }

  // Milestone events post to the VIM issue as the orchestrator agent. Async +
  // fire-and-forget so a slow/down Linear never blocks the daemon.
  const toLinear = (vim, e) => {
    const fmt = LINEAR_COMMENT[e.type]
    if (!vim || !fmt) {
      return
    }

    const child = spawn(
      'node',
      [LINEAR_STATUS, vim, fmt(e), '--as', 'orchestrator'],
      { stdio: 'ignore' }
    )
    child.on('error', () => {
      // best-effort: Linear observability must never break the loop
    })
  }

  return {
    emit: (event, vim) => {
      const e = record(event)
      toLinear(vim, e)

      return e
    },
  }
}
