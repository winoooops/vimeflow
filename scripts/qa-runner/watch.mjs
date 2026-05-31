#!/usr/bin/env node
// QA runner — outer watcher + review state machine.
//
//   scan   — read-only: list eligible PRs (auto-review label) + why.
//   tick   — one pass: per eligible PR, compute the review state and act:
//              NEEDS_FIX  → (with --execute) run.mjs <pr> --push   (an upsource cycle)
//              GOOD_SHAPE → (with --approve) squash-merge + delete branch
//              WAITING / CI_RED → report only.
//            State is mirrored to the linked Linear issue (a VIM-N in the PR body)
//            via lib/linear-status.mjs — Linear is the control plane / observability.
//   watch  — loop `tick` every pollSeconds (Ctrl-C to stop).
//
// Default is REPORT-ONLY (no side effects). `--execute` arms fixing; `--approve`
// arms merging. `--pr N` targets a single PR. See README.md.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const LOCK_DIR = join(SCRIPT_DIR, '.locks')
const DEFAULT_LABEL = 'auto-review'
const POLL_SECONDS = 60
// CI checks that are the *reviewers*, not the build/test gate — excluded from "CI green".
const REVIEW_CHECKS = new Set([
  'Claude Code Review',
  'Codex Code Review',
  'Post Review Comment',
])

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

const unresolvedThreads = (owner, name, pr) => {
  const q =
    'query($o:String!,$n:String!,$p:Int!){repository(owner:$o,name:$n){pullRequest(number:$p){reviewThreads(first:100){nodes{isResolved}}}}}'
  const r = ghJson([
    'api',
    'graphql',
    '-f',
    `query=${q}`,
    '-F',
    `o=${owner}`,
    '-F',
    `n=${name}`,
    '-F',
    `p=${pr}`,
  ])
  return (r.data.repository.pullRequest.reviewThreads.nodes || []).filter(
    (t) => !t.isResolved
  ).length
}

// null = no Claude review yet · true = "patch is correct" · false = "patch has issues"
const claudeVerdictClean = (owner, name, pr) => {
  const comments = ghJson([
    'api',
    `repos/${owner}/${name}/issues/${pr}/comments`,
  ])
  const last = comments
    .filter(
      (c) =>
        c.user?.login === 'github-actions[bot]' &&
        typeof c.body === 'string' &&
        c.body.startsWith('## Claude Code Review')
    )
    .pop()
  if (!last) return null
  return /patch is correct|✅/i.test(
    last.body.match(/Overall:[^\n]*/)?.[0] || ''
  )
}

const checksFor = (pr) =>
  ghJson(['pr', 'checks', String(pr), '--json', 'name,bucket'])
const isLocked = (pr) => existsSync(join(LOCK_DIR, `pr-${pr}.lock`))
const hasLabel = (pr, label) => (pr.labels || []).some((l) => l.name === label)
const linkedVim = (body) =>
  (body || '').match(/\bVIM-\d+\b/i)?.[0]?.toUpperCase()

// The review state machine.
const computeState = (pr, ctx) => {
  if (pr.isDraft) return { state: 'WAITING', detail: 'draft' }
  const checks = checksFor(pr.number)
  const nonReview = checks.filter((c) => !REVIEW_CHECKS.has(c.name))
  const ci = nonReview.some((c) => c.bucket === 'fail')
    ? 'fail'
    : nonReview.some((c) => c.bucket === 'pending')
      ? 'pending'
      : 'green'
  const claudePending =
    checks.find((c) => c.name === 'Claude Code Review')?.bucket === 'pending'
  const threads = unresolvedThreads(ctx.owner, ctx.name, pr.number)
  const verdict = claudeVerdictClean(ctx.owner, ctx.name, pr.number) // null|true|false
  const view = ghJson([
    'pr',
    'view',
    String(pr.number),
    '--json',
    'mergeable,mergeStateStatus,body',
  ])
  const vim = linkedVim(view.body)
  let state, detail
  if (ci === 'fail') [state, detail] = ['CI_RED', 'non-review CI failing']
  else if (threads > 0)
    [state, detail] = ['NEEDS_FIX', `${threads} unresolved thread(s)`]
  else if (claudePending || ci === 'pending')
    [state, detail] = ['WAITING', 'CI / Claude re-running']
  else if (verdict === false)
    [state, detail] = ['NEEDS_FIX', 'Claude verdict: patch has issues']
  else if (verdict === null)
    [state, detail] = ['WAITING', 'no Claude review yet']
  else if (view.mergeable !== 'MERGEABLE')
    [state, detail] = ['WAITING', `not mergeable (${view.mergeStateStatus})`]
  else
    [state, detail] = [
      'GOOD_SHAPE',
      '0 threads · Claude clean · CI green · mergeable',
    ]
  return { state, detail, vim, threads }
}

const postLinear = (vim, body, stateName) => {
  if (!vim) return
  const args = [join(SCRIPT_DIR, 'lib', 'linear-status.mjs'), vim, body]
  if (stateName) args.push('--state', stateName)
  const r = spawnSync('node', args, { encoding: 'utf8' })
  if (r.status === 0)
    out(
      `           ↳ Linear ${vim}${stateName ? ` → ${stateName}` : ''}: commented`
    )
  else
    out(
      `           ↳ Linear ${vim}: skipped (${(r.stderr || '').trim().split('\n')[0] || 'no LINEAR_API_KEY'})`
    )
}

const tick = (ctx) => {
  let prs = openPRs().filter(
    (p) => (ctx.all || hasLabel(p, ctx.label)) && !p.isDraft
  )
  if (ctx.pr) prs = prs.filter((p) => p.number === ctx.pr)
  if (!prs.length) {
    out(
      ctx.pr
        ? `PR #${ctx.pr} is not an eligible open PR.`
        : `No eligible PRs (label '${ctx.label}').`
    )
    return
  }
  out(
    `QA watcher tick — ${ctx.owner}/${ctx.name} · ${prs.length} PR(s) · approve=${ctx.approve} execute=${ctx.execute}\n`
  )
  for (const pr of prs) {
    if (isLocked(pr.number)) {
      out(`LOCKED     #${pr.number} ${pr.headRefName} — run in flight, skip\n`)
      continue
    }
    let s
    try {
      s = computeState(pr, ctx)
    } catch (e) {
      out(`ERROR      #${pr.number} — ${e.message.split('\n')[0]}\n`)
      continue
    }
    out(
      `${s.state.padEnd(10)} #${pr.number}  ${pr.headRefName}${s.vim ? `  (${s.vim})` : ''}`
    )
    out(`           ${s.detail}`)
    if (s.state === 'NEEDS_FIX') {
      postLinear(
        s.vim,
        `QA runner: review findings on PR #${pr.number} — ${s.detail}. Running an upsource cycle.`,
        'In Progress'
      )
      if (ctx.execute) {
        out(`           → run.mjs ${pr.number} --push`)
        spawnSync(
          'node',
          [join(SCRIPT_DIR, 'run.mjs'), String(pr.number), '--push'],
          {
            stdio: 'inherit',
          }
        )
      } else out(`           (report-only — pass --execute to run the cycle)`)
    } else if (s.state === 'GOOD_SHAPE') {
      if (ctx.approve) {
        out(`           → APPROVING: gh pr merge --squash --delete-branch`)
        gh(['pr', 'merge', String(pr.number), '--squash', '--delete-branch'])
        out(`           ✓ MERGED`)
        postLinear(
          s.vim,
          `QA runner: PR #${pr.number} met all review success criteria → squash-merged.`,
          'Done'
        )
      } else out(`           (report-only — pass --approve to auto-merge)`)
    }
    out('')
  }
}

const watch = (ctx) => {
  out(
    `QA watcher — looping every ${POLL_SECONDS}s (approve=${ctx.approve} execute=${ctx.execute}). Ctrl-C to stop.\n`
  )
  const loop = () => {
    try {
      tick(ctx)
    } catch (e) {
      err(`tick error: ${e.message.split('\n')[0]}`)
    }
    setTimeout(loop, POLL_SECONDS * 1000)
  }
  loop()
}

// Read-only eligibility lister (lightweight).
const scan = (ctx) => {
  let prs = openPRs()
  if (ctx.pr) prs = prs.filter((p) => p.number === ctx.pr)
  if (!prs.length) {
    out('No open PRs.')
    return
  }
  out(
    `QA runner scan — ${ctx.owner}/${ctx.name} · label gate: ${ctx.all ? 'OFF (--all)' : `'${ctx.label}'`}\n`
  )
  let n = 0
  for (const pr of prs) {
    const eligible =
      !pr.isDraft &&
      (ctx.all || hasLabel(pr, ctx.label)) &&
      !isLocked(pr.number)
    if (eligible) n++
    out(
      `${eligible ? 'ELIGIBLE →' : 'skip      '} #${pr.number}  ${pr.headRefName}  —  ${pr.title}`
    )
  }
  out(`\n${n}/${prs.length} eligible.`)
}

const main = () => {
  const argv = process.argv.slice(2)
  const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'scan'
  const has = (n) => argv.includes(`--${n}`)
  const val = (n) => {
    const i = argv.indexOf(`--${n}`)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const { owner, name } = repoSlug()
  const ctx = {
    owner,
    name,
    label: val('label') || DEFAULT_LABEL,
    approve: has('approve'),
    execute: has('execute'),
    all: has('all'),
    pr: val('pr') ? Number(val('pr')) : undefined,
  }
  if (cmd === 'scan') return scan(ctx)
  if (cmd === 'tick') return tick(ctx)
  if (cmd === 'watch') return watch(ctx)
  err(
    `unknown command: ${cmd}. Use: scan | tick | watch  [--pr N] [--approve] [--execute] [--all] [--label NAME]`
  )
  process.exit(1)
}

main()
