#!/usr/bin/env node
// QA runner — outer watcher + review state machine (parallel, two-bot).
//
//   scan   — read-only: list eligible PRs (auto-review label) + why.
//   tick   — one pass: per eligible PR, compute the review state and act:
//              NEEDS_FIX  → (with --execute) run.mjs <pr> --push   (an upsource cycle)
//                           dispatched CONCURRENTLY, capped at --max (default 2).
//              GOOD_SHAPE → (with --approve) squash-merge AS THE ORCHESTRATOR BOT
//                           (orchestrator.env) + delete branch.
//              WAITING / CI_RED → report only.
//            State is mirrored to the linked Linear issue (a VIM-N in the PR body)
//            via lib/linear-status.mjs — Linear is the control plane / observability.
//   watch  — loop `tick` every pollSeconds (Ctrl-C to stop).
//
// Two identities: the INNER fixer runs as bot.env (handled inside run.mjs); the
// OUTER merge runs as orchestrator.env so author ≠ approver. Either absent ⇒ that
// action falls back to your own gh.
//
// Default is REPORT-ONLY. `--execute` arms fixing; `--approve` arms merging.
// `--pr N` targets one PR; `--max N` caps parallel fixes. See README.md.

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { botLabel, botProcessEnv, loadBot } from './lib/bot-identity.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const LOCK_DIR = join(SCRIPT_DIR, '.locks')
const LOG_DIR = join(SCRIPT_DIR, 'logs')
const DEFAULT_LABEL = 'auto-review'
const POLL_SECONDS = 60
const MAX_PARALLEL = 2
// CI checks that are the *reviewers*, not the build/test gate — excluded from "CI green".
const REVIEW_CHECKS = new Set([
  'Claude Code Review',
  'Codex Code Review',
  'Post Review Comment',
])

const out = (s = '') => process.stdout.write(`${s}\n`)
const err = (s = '') => process.stderr.write(`${s}\n`)
// gh as the ambient identity, or — when `env` is passed — as a bot.
const gh = (args, env) =>
  execFileSync('gh', args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    ...(env ? { env } : {}),
  })
const ghJson = (args) => JSON.parse(gh(args))

const repoSlug = () => {
  const r = ghJson(['repo', 'view', '--json', 'owner,name'])
  return { owner: r.owner.login, name: r.name }
}

const mainRoot = () =>
  dirname(
    execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      {
        encoding: 'utf8',
      }
    ).trim()
  )

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
  let cursor = ''
  let count = 0
  while (true) {
    const q = cursor
      ? 'query($o:String!,$n:String!,$p:Int!,$c:String!){repository(owner:$o,name:$n){pullRequest(number:$p){reviewThreads(first:100,after:$c){pageInfo{hasNextPage endCursor}nodes{isResolved}}}}}'
      : 'query($o:String!,$n:String!,$p:Int!){repository(owner:$o,name:$n){pullRequest(number:$p){reviewThreads(first:100){pageInfo{hasNextPage endCursor}nodes{isResolved}}}}}'
    const args = [
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
    ]
    if (cursor) args.push('-F', `c=${cursor}`)
    const r = ghJson(args)
    const threads = r.data.repository.pullRequest.reviewThreads
    count += (threads.nodes || []).filter((t) => !t.isResolved).length
    if (!threads.pageInfo.hasNextPage) break
    cursor = threads.pageInfo.endCursor
  }
  return count
}

// Claude's verdict from its review COMMENT — null = none yet · true = "patch is
// correct" · false = "patch has issues". The check-run only says the review RAN,
// not that it approved, so we read the comment. Identity-checked: only a comment
// posted by a real GitHub Action (performed_via_github_app 'github-actions') is
// trusted, so a PAT-authenticated agent (kimi, the bots, a human) can't forge a
// "patch is correct" verdict. A malicious workflow file is out of scope here —
// that's a repo-permissions boundary (protect .github/workflows/).
const claudeVerdictClean = (owner, name, pr) => {
  const comments = JSON.parse(
    execFileSync('jq', ['-s', 'add'], {
      encoding: 'utf8',
      input: gh([
        'api',
        `repos/${owner}/${name}/issues/${pr}/comments`,
        '--paginate',
      ]),
      maxBuffer: 16 * 1024 * 1024,
    })
  )
  const last = comments
    .filter(
      (c) =>
        c.user?.login === 'github-actions[bot]' &&
        c.user?.type === 'Bot' &&
        c.performed_via_github_app?.slug === 'github-actions' &&
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
  const claudeCheck = checks.find((c) => c.name === 'Claude Code Review')
  const claudeReady = claudeCheck?.bucket === 'pass'
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
  else if (!claudeReady || ci === 'pending')
    [state, detail] = ['WAITING', 'CI / Claude re-running']
  else {
    const threads = unresolvedThreads(ctx.owner, ctx.name, pr.number)
    const verdict = claudeVerdictClean(ctx.owner, ctx.name, pr.number) // null|true|false
    if (threads > 0)
      [state, detail] = ['NEEDS_FIX', `${threads} unresolved thread(s)`]
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
  return { state, detail, vim, threads: 0 }
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

// Squash-merge + branch delete as the orchestrator bot (or you, if none).
const approve = (pr, vim, ctx) => {
  const env = botProcessEnv(ctx.orchBot)
  const merger = botLabel(ctx.orchBot)
  out(`           → APPROVING as ${merger}: squash-merge #${pr.number}`)
  const reviews = ghJson(['pr', 'view', String(pr.number), '--json', 'reviews'])
  const alreadyApproved = (reviews.reviews || []).some(
    (r) => r.state === 'APPROVED' && r.author?.login === ctx.approverLogin
  )
  if (!alreadyApproved) {
    gh(['pr', 'review', String(pr.number), '--approve'], env)
  }
  gh(['pr', 'merge', String(pr.number), '--squash'], env)
  out(`           ✓ MERGED`)
  // Remove the qa-pr-N worktree so orphaned checkouts don't accumulate.
  try {
    execFileSync('git', [
      'worktree',
      'remove',
      '--force',
      join(mainRoot(), '.claude', 'worktrees', `qa-pr-${pr.number}`),
    ])
    out(`           ✓ removed worktree qa-pr-${pr.number}`)
  } catch {
    out(`           (worktree already gone)`)
  }
  // Delete the merged branch REMOTELY — `gh --delete-branch` deletes the LOCAL
  // branch too, which fails when a worktree holds it (run.mjs's qa-pr-N). The API
  // ref delete is hook-free and never touches the local checkout.
  try {
    gh(
      [
        'api',
        '--method',
        'DELETE',
        `repos/${ctx.owner}/${ctx.name}/git/refs/heads/${pr.headRefName}`,
      ],
      env
    )
    out(`           ✓ deleted remote branch ${pr.headRefName}`)
  } catch {
    out(`           (remote branch already gone)`)
  }
  postLinear(
    vim,
    `QA runner: PR #${pr.number} met all review success criteria → squash-merged by ${merger}.`,
    'Done'
  )
}

// Run run.mjs for one PR as a child, teeing output to a per-PR log and prefixing
// the console so concurrent runs stay legible. Resolves the exit code; never
// rejects — a failed child must not abort the pool. run.mjs adopts the INNER
// (fixer) bot identity itself, so we just inherit the env here.
const dispatchFix = (pr) =>
  new Promise((resolve) => {
    mkdirSync(LOG_DIR, { recursive: true })
    const logPath = join(LOG_DIR, `pr-${pr}.log`)
    const logFd = createWriteStream(logPath, { flags: 'a' })
    const tag = `[#${pr}]`
    out(`${tag} → run.mjs ${pr} --push   (log: ${logPath})`)
    const child = spawn(
      'node',
      [join(SCRIPT_DIR, 'run.mjs'), String(pr), '--push'],
      {
        env: process.env,
      }
    )
    const pipe = (stream) => {
      let buf = ''
      stream.on('data', (d) => {
        logFd.write(d)
        buf += d.toString()
        let nl
        while ((nl = buf.indexOf('\n')) >= 0) {
          out(`${tag} ${buf.slice(0, nl)}`)
          buf = buf.slice(nl + 1)
        }
      })
    }
    pipe(child.stdout)
    pipe(child.stderr)
    child.on('close', (code) => {
      logFd.end()
      out(`${tag} ✓ run.mjs exited ${code}`)
      resolve(code)
    })
    child.on('error', (e) => {
      logFd.end()
      out(`${tag} ✗ spawn error: ${e.message}`)
      resolve(-1)
    })
  })

// Bounded-concurrency pool — at most `limit` workers in flight.
const pool = async (items, limit, worker) => {
  let i = 0
  const next = async () => {
    while (i < items.length) await worker(items[i++])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next))
}

const tick = async (ctx) => {
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
    `QA watcher tick — ${ctx.owner}/${ctx.name} · ${prs.length} PR(s) · ` +
      `approve=${ctx.approve} execute=${ctx.execute} max=${ctx.maxParallel}\n`
  )
  const needsFix = []
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
      if (ctx.execute) {
        postLinear(
          s.vim,
          `QA runner: review findings on PR #${pr.number} — ${s.detail}. Running an upsource cycle.`,
          'In Progress'
        )
        needsFix.push(pr.number)
      } else {
        out(`           (report-only — pass --execute to run the cycle)`)
      }
    } else if (s.state === 'GOOD_SHAPE') {
      if (ctx.approve) {
        try {
          approve(pr, s.vim, ctx)
        } catch (e) {
          out(`           ✗ approve failed: ${e.message.split('\n')[0]}`)
        }
      } else out(`           (report-only — pass --approve to auto-merge)`)
    }
    out('')
  }
  if (needsFix.length) {
    out(
      `Dispatching ${needsFix.length} fix run(s), up to ${ctx.maxParallel} in parallel…\n`
    )
    await pool(needsFix, ctx.maxParallel, dispatchFix)
  }
}

const watch = async (ctx) => {
  out(
    `QA watcher — looping every ${POLL_SECONDS}s ` +
      `(approve=${ctx.approve} execute=${ctx.execute} max=${ctx.maxParallel}). Ctrl-C to stop.\n`
  )
  const loop = async () => {
    try {
      await tick(ctx)
    } catch (e) {
      err(`tick error: ${e.message.split('\n')[0]}`)
    }
    setTimeout(loop, POLL_SECONDS * 1000)
  }
  await loop()
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
  const orchBot = loadBot(SCRIPT_DIR, 'orchestrator.env', 'GH_ORCH')
  const ctx = {
    owner,
    name,
    label: val('label') || DEFAULT_LABEL,
    approve: has('approve'),
    execute: has('execute'),
    all: has('all'),
    pr: val('pr') ? Number(val('pr')) : undefined,
    maxParallel: Number(val('max')) || MAX_PARALLEL,
    orchBot,
    approverLogin: orchBot?.user ?? ghJson(['api', 'user']).login,
  }
  if (cmd === 'scan') return scan(ctx)
  if (cmd === 'tick') return tick(ctx)
  if (cmd === 'watch') return watch(ctx)
  err(
    `unknown command: ${cmd}. Use: scan | tick | watch  [--pr N] [--approve] [--execute] [--all] [--max N] [--label NAME]`
  )
  process.exit(1)
}

const result = main()
if (result && typeof result.then === 'function')
  result.catch((e) => {
    err(e.message)
    process.exit(1)
  })
