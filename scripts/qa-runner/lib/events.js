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
import { formatMergedComment } from './decision-comment.js'

const LIB_DIR = dirname(fileURLToPath(import.meta.url))
const STATE_DIR = join(dirname(LIB_DIR), '.state')
const EVENTS_FILE = join(STATE_DIR, 'events.jsonl')
const LINEAR_STATUS = join(LIB_DIR, 'linear-status.js')

const tableValue = (value) =>
  String(value ?? 'unknown')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')

const formatCycleExitComment = (e) => {
  const terminal = e.type === 'paused' || e.terminal

  const lines = [
    `## QA runner cycle exit: ${terminal ? 'PAUSED' : 'RETRY'}`,
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| PR | #${tableValue(e.pr)} |`,
    `| Source event | ${tableValue(e.sourceEvent)} |`,
    `| Category | ${tableValue(e.category || e.type)} |`,
    `| Detail | ${tableValue(e.detail)} |`,
    `| Exit code | \`${tableValue(e.exitCode)}\` |`,
    `| Signal | \`${tableValue(e.signal || 'none')}\` |`,
    `| Reason | ${tableValue(e.exitReason || e.detail)} |`,
  ]

  if (e.noopCount != null) {
    lines.push(
      `| Failed attempts | ${tableValue(e.noopCount)} / ${tableValue(e.maxNoops)} |`
    )
  }
  if (e.logPath) {
    lines.push(`| Log | \`${tableValue(e.logPath)}\` |`)
  }
  if (e.retryMode) {
    lines.push(`| Retry mode | ${tableValue(e.retryMode)} |`)
  }

  lines.push(
    '',
    terminal
      ? 'Action: loop paused. A new head, CI/review event, or manual requeue is required before routine polling resumes.'
      : 'Action: recorded the recoverable exit without incrementing the fixer failure streak. Poll-triggered exits retry on the next poll tick; webhook/manual exits are requeued by daemon backoff.'
  )

  return lines.join('\n')
}

// type → a one-line Linear comment. Types absent here are pool/log only (no spam).
const LINEAR_COMMENT = {
  progress: (e) =>
    `✅ Fix pushed for #${e.pr} (round ${e.round}). Re-review pending.`,
  error: formatCycleExitComment,
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
  paused: formatCycleExitComment,
  merged: (e) => formatMergedComment(e.pr),
  closed: (e) => `🚫 #${e.pr} closed without merge — review loop stopped.`,
}

export const formatLinearEventComment = (event) =>
  LINEAR_COMMENT[event.type]?.(event) ?? null

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
    const body = formatLinearEventComment(e)
    if (!vim || !body) {
      return
    }

    const args = [LINEAR_STATUS, vim, body, '--as', 'orchestrator']
    if (e.parentId) {
      args.push('--parent', e.parentId)
    }
    if (e.type === 'merged') {
      args.push('--state', 'Done')
    }

    const child = spawn('node', args, { stdio: 'ignore' })
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
