#!/usr/bin/env node
// QA runner — outer watcher (increment 1: read-only scan).
//
// Finds open PRs that have actionable review findings and reports what it WOULD
// do. The side-effecting work — dispatch `kimi --afk` on the PR worktree to run
// the upsource-review playbook, codex-gate it, push, reply/resolve, post status
// to Linear — is NOT wired yet; it lands behind `run --execute` in increment 2.
// This file performs read-only GitHub queries only and is safe to run anytime.
//
// See README.md for the full shape and playbook.md for the inner contract.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const LOCK_DIR = join(SCRIPT_DIR, '.locks')
const DEFAULT_LABEL = 'auto-review'

const out = (s = '') => process.stdout.write(`${s}\n`)
const err = (s = '') => process.stderr.write(`${s}\n`)

const gh = (args) =>
  execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
const ghJson = (args) => JSON.parse(gh(args))

const repoSlug = () => {
  const r = ghJson(['repo', 'view', '--json', 'owner,name'])
  return { owner: r.owner.login, name: r.name }
}

const openPRs = () =>
  ghJson([
    'pr',
    'list',
    '--state',
    'open',
    '--limit',
    '50',
    '--json',
    'number,title,headRefName,isDraft,labels',
  ])

const unresolvedThreadCount = (owner, name, pr) => {
  const query =
    'query($o:String!,$n:String!,$p:Int!){repository(owner:$o,name:$n){pullRequest(number:$p){reviewThreads(first:100){nodes{isResolved}}}}}'
  const r = ghJson([
    'api',
    'graphql',
    '-f',
    `query=${query}`,
    '-F',
    `o=${owner}`,
    '-F',
    `n=${name}`,
    '-F',
    `p=${pr}`,
  ])
  const nodes = r.data.repository.pullRequest.reviewThreads.nodes || []
  return nodes.filter((t) => !t.isResolved).length
}

const hasClaudeReview = (owner, name, pr) => {
  // First page (recent comments) is enough — the Claude review is a recent bot comment.
  const comments = ghJson([
    'api',
    `repos/${owner}/${name}/issues/${pr}/comments`,
  ])
  return comments.some(
    (c) =>
      c.user?.login === 'github-actions[bot]' &&
      typeof c.body === 'string' &&
      c.body.startsWith('## Claude Code Review')
  )
}

const isLocked = (pr) => existsSync(join(LOCK_DIR, `pr-${pr}.lock`))
const hasLabel = (pr, label) => (pr.labels || []).some((l) => l.name === label)

const evaluate = (pr, ctx) => {
  const reasons = []
  if (pr.isDraft) reasons.push('draft')
  const labelGate = ctx.all || hasLabel(pr, ctx.label)
  if (!labelGate) reasons.push(`no '${ctx.label}' label`)
  const threads = unresolvedThreadCount(ctx.owner, ctx.name, pr.number)
  const claude = hasClaudeReview(ctx.owner, ctx.name, pr.number)
  const hasFindings = threads > 0 || claude
  if (!hasFindings) reasons.push('no open review findings')
  const locked = isLocked(pr.number)
  if (locked) reasons.push('locked (run in flight)')
  const eligible = !pr.isDraft && labelGate && hasFindings && !locked
  return { eligible, threads, claude, locked, reasons }
}

const scan = (ctx) => {
  const all = openPRs()
  const prs = ctx.pr ? all.filter((p) => p.number === ctx.pr) : all
  if (!prs.length) {
    out(ctx.pr ? `PR #${ctx.pr} is not an open PR.` : 'No open PRs.')
    return
  }
  out(
    `QA runner scan — ${ctx.owner}/${ctx.name} · label gate: ${ctx.all ? 'OFF (--all)' : `'${ctx.label}'`}\n`
  )
  let eligibleCount = 0
  for (const pr of prs) {
    let v
    try {
      v = evaluate(pr, ctx)
    } catch (e) {
      out(
        `error     #${pr.number}  ${pr.headRefName}  —  ${e.message.split('\n')[0]}\n`
      )
      continue
    }
    if (v.eligible) eligibleCount++
    out(
      `${v.eligible ? 'ELIGIBLE →' : 'skip      '} #${pr.number}  ${pr.headRefName}`
    )
    out(`           ${pr.title}`)
    out(
      `           findings: ${v.threads} unresolved thread(s)${v.claude ? ' + Claude review' : ''}` +
        (v.eligible ? '' : `  ·  ${v.reasons.join(', ')}`)
    )
    if (v.eligible) {
      out(
        `           WOULD: kimi --afk on a pr-${pr.number} worktree → playbook.md → codex gate → push → reply/resolve → Linear status`
      )
    }
    out('')
  }
  out(
    `${eligibleCount}/${prs.length} eligible. (read-only scan — nothing dispatched.)`
  )
}

const main = () => {
  const argv = process.argv.slice(2)
  const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'scan'
  const has = (name) => argv.includes(`--${name}`)
  const val = (name) => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : undefined
  }
  if (cmd === 'run') {
    err(
      '`run` is not wired yet (increment 2: kimi dispatch + codex gate + push + Linear status).'
    )
    err('Increment 1 is the read-only scanner. Use `scan` to see eligible PRs.')
    process.exit(2)
  }
  if (cmd !== 'scan') {
    err(`unknown command: ${cmd}. Use: scan [--all] [--pr N] [--label NAME]`)
    process.exit(1)
  }
  const { owner, name } = repoSlug()
  scan({
    owner,
    name,
    all: has('all'),
    label: val('label') || DEFAULT_LABEL,
    pr: val('pr') ? Number(val('pr')) : undefined,
  })
}

main()
