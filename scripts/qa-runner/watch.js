#!/usr/bin/env node
// QA runner — outer watcher + review state machine (parallel, two-bot).
//
//   scan   — read-only: list eligible PRs (auto-review label) + why.
//   tick   — one pass: per eligible PR, compute the review state and act:
//              NEEDS_FIX  → (with --execute) run.js <pr> --push   (review/CI fix)
//                           dispatched CONCURRENTLY, capped at --max (default 2).
//              GOOD_SHAPE → (with --approve) squash-merge AS THE ORCHESTRATOR BOT
//                           (orchestrator.env) + delete branch.
//              WAITING   → report only, or rerun transient reviewer checks.
//              CI_RED    → report only after reruns are exhausted/unavailable.
//            State is mirrored to the linked Linear issue (a VIM-N in the PR body)
//            via lib/linear-status.js — Linear is the control plane / observability.
//   watch  — loop `tick` every pollSeconds (Ctrl-C to stop).
//
// Two identities: the INNER fixer runs as bot.env (handled inside run.js); the
// OUTER merge runs as orchestrator.env so author ≠ approver. Either absent ⇒ that
// action falls back to your own gh.
//
// Default is REPORT-ONLY. `--execute` arms fixing; `--approve` arms merging.
// `--pr N` targets one PR; `--max N` caps parallel fixes. See README.md.

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { botLabel, botProcessEnv, loadBot } from './lib/bot-identity.js'
import {
  REVIEW_CHECKS,
  checkLabel,
  classifyChecks,
  runIdFromCheck,
  summarizeChecks,
} from './lib/ci-policy.js'
import {
  actionForDecision,
  decisionKey,
  decisionStorePath,
  formatDecisionComment,
  markDecisionPosted,
  readDecisionStore,
  shouldPostDecision,
} from './lib/decision-comment.js'
import {
  DISPATCH_BLOCKED_EXIT,
  RUN_SELF_REVIEW_EXIT,
  clearDispatchBlocker,
  writeDispatchBlocker,
} from './lib/dispatch-blocker.js'
import { orchestratorTool } from './lib/orchestrator-tools.js'
import { linkedVimForPr, writeLinkedIssueCache } from './lib/pr-utils.js'
import {
  markRerunAttempt,
  readRerunStore,
  rerunKey,
  rerunStatus,
  rerunStorePath,
} from './lib/rerun-state.js'
import { pickReviewRerunCheck } from './lib/review-rerun.js'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const LOCK_DIR = join(SCRIPT_DIR, '.locks')
const LOG_DIR = join(SCRIPT_DIR, 'logs')
const DEFAULT_LABEL = 'auto-review'
const POLL_SECONDS = 60
const MAX_PARALLEL = 2
const MAX_CI_RERUNS = 3

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

const numericOption = (raw, fallback) => {
  if (raw === undefined) {
    return fallback
  }
  const n = Number(raw)

  return Number.isFinite(n) ? n : fallback
}

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

const PR_FIELDS = 'number,title,headRefName,isDraft,labels'

const openPRs = () =>
  ghJson([
    'pr',
    'list',
    '--state',
    'open',
    '--limit',
    '50',
    '--json',
    PR_FIELDS,
  ])

// Candidate PRs for a tick/scan. A targeted --pr is fetched directly so a PR past
// openPRs()'s first page still resolves (the daemon enqueues by number); without
// one, the capped open list drives the human scan.
const candidatePRs = (pr) => {
  if (!pr) {
    return openPRs()
  }
  const p = ghJson(['pr', 'view', String(pr), '--json', `${PR_FIELDS},state`])

  return p.state === 'OPEN' ? [p] : []
}

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
    if (cursor) {
      args.push('-F', `c=${cursor}`)
    }
    const r = ghJson(args)
    const threads = r.data.repository.pullRequest.reviewThreads
    count += (threads.nodes || []).filter((t) => !t.isResolved).length
    if (!threads.pageInfo.hasNextPage) {
      break
    }
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
    gh([
      'api',
      `repos/${owner}/${name}/issues/${pr}/comments`,
      '--paginate',
      '--slurp',
    ])
  ).flat()

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
  if (!last) {
    return null
  }

  return /patch is correct|✅/i.test(
    last.body.match(/Overall:[^\n]*/)?.[0] || ''
  )
}

const checksFor = (pr) =>
  ghJson(['pr', 'checks', String(pr), '--json', 'name,bucket,link,workflow'])

// Is a runner holding this PR's lock? Lazily reaps a STALE lock — one whose owner
// PID is gone (host crash / SIGKILL before run.js released it) — so a requeued PR
// isn't reported LOCKED and skipped forever after a restart.
const isLocked = (pr) => {
  const lock = join(LOCK_DIR, `pr-${pr}.lock`)
  if (!existsSync(lock)) {
    return false
  }
  try {
    const pid = Number((readFileSync(lock, 'utf8').match(/pid (\d+)/) || [])[1])
    if (pid > 0) {
      process.kill(pid, 0) // throws ESRCH if the owner process is gone
      try {
        const cmdLine = readFileSync(`/proc/${pid}/cmdline`, 'utf8')
        if (!cmdLine.includes('run.js')) {
          // PID recycled to a non-run.js process — stale lock
          rmSync(lock, { force: true })

          return false
        }
      } catch {
        // /proc unreadable — treat as locked to be safe
      }

      return true
    }
  } catch (e) {
    if (e.code === 'EPERM') {
      return true // owner alive but not ours — still a live holder
    }
    // ESRCH / unreadable PID → stale; fall through to reap
  }
  rmSync(lock, { force: true })

  return false
}
const hasLabel = (pr, label) => (pr.labels || []).some((l) => l.name === label)

const checkNames = (checks) => checks.map(checkLabel).join(', ')

const resolveLinkedIssue = async (pr, view, ctx) => {
  const existing = linkedVimForPr({
    body: view.body,
    branch: pr.headRefName,
    pr: pr.number,
  })
  if (existing || !ctx.linearCreateIssues) {
    return existing
  }

  const tool = orchestratorTool('create_linear_issue_for_pr')
  if (!tool) {
    return null
  }

  try {
    const issue = await tool.execute({
      teamKey: ctx.linearTeamKey,
      pr: pr.number,
      title: pr.title,
      url: view.url,
      branch: pr.headRefName,
    })
    const identifier = writeLinkedIssueCache(pr.number, issue)
    out(
      `           ↳ Linear ${identifier}: created for unlinked PR #${pr.number}`
    )

    return identifier
  } catch (e) {
    out(`           ↳ Linear create skipped: ${e.message.split('\n')[0]}`)

    return null
  }
}

const rerunReviewCheck = (pr, check, headSha, ctx) => {
  const runId = runIdFromCheck(check)
  const storeFile = rerunStorePath(pr.number)
  const store = readRerunStore(storeFile)
  const key = rerunKey({ pr: pr.number, headSha, check })
  const status = rerunStatus({ store, key, max: ctx.maxCiReruns })

  if (!runId) {
    return {
      state: 'CI_RED',
      detail: `review check failed with no Actions run to rerun: ${checkLabel(check)}`,
      action: 'none',
      rerunAttempt: status.count,
      rerunLimit: ctx.maxCiReruns,
    }
  }

  if (status.exhausted) {
    return {
      state: 'CI_RED',
      detail: `rerun exhausted for ${checkLabel(check)} (${status.count}/${ctx.maxCiReruns})`,
      action: 'none',
      rerunAttempt: status.count,
      rerunLimit: ctx.maxCiReruns,
    }
  }

  if (!ctx.execute) {
    return {
      state: 'WAITING',
      detail: `review check failed and can be rerun: ${checkLabel(check)} (${status.count}/${ctx.maxCiReruns})`,
      action: 'none',
      rerunAttempt: status.count,
      rerunLimit: ctx.maxCiReruns,
    }
  }

  gh(['run', 'rerun', runId, '--failed'])
  markRerunAttempt(store, key, storeFile)

  return {
    state: 'WAITING',
    detail: `reran ${checkLabel(check)} (attempt ${status.nextAttempt}/${ctx.maxCiReruns})`,
    action: 'rerun check',
    rerunAttempt: status.nextAttempt,
    rerunLimit: ctx.maxCiReruns,
  }
}

// The review state machine.
const computeState = async (pr, ctx) => {
  if (pr.isDraft) {
    return { state: 'WAITING', detail: 'draft' }
  }
  const checks = checksFor(pr.number)
  const ciResult = classifyChecks(checks, { reviewChecks: REVIEW_CHECKS })
  const claudeCheck = checks.find((c) => c.name === 'Claude Code Review')
  const claudeReady = claudeCheck?.bucket === 'pass'
  let claude = claudeReady
    ? 'review check passed'
    : (claudeCheck?.bucket ?? 'missing')

  const view = ghJson([
    'pr',
    'view',
    String(pr.number),
    '--json',
    'mergeable,mergeStateStatus,body,headRefOid,url',
  ])
  const vim = await resolveLinkedIssue(pr, view, ctx)
  let state, detail
  let action
  let rerunAttempt
  let rerunLimit
  let ciClassification
  let checkSummaries = []
  let fixContext
  let threads = null

  const openThreads = () => {
    if (threads === null) {
      threads = unresolvedThreads(ctx.owner, ctx.name, pr.number)
    }

    return threads
  }

  if (ciResult.deterministicFailures.length) {
    checkSummaries = summarizeChecks(ciResult.deterministicFailures)
    ciClassification = 'deterministic failure'
    state = 'NEEDS_FIX'
    detail = `deterministic CI failure: ${checkNames(ciResult.deterministicFailures)}`

    fixContext = {
      kind: 'deterministic_ci_failure',
      instruction:
        'The orchestrator dispatched this fixer because deterministic CI failed. Inspect the linked GitHub check logs, fix the code or generated artifacts, run relevant verification locally, commit, and push.',
      checks: checkSummaries,
    }
  } else if (ciResult.reviewRerunFailures.length) {
    const rerun = rerunReviewCheck(
      pr,
      pickReviewRerunCheck({
        pr: pr.number,
        checks: ciResult.reviewRerunFailures,
        headSha: view.headRefOid,
        maxCiReruns: ctx.maxCiReruns,
      }),
      view.headRefOid,
      ctx
    )
    state = rerun.state
    detail = rerun.detail
    action = rerun.action
    rerunAttempt = rerun.rerunAttempt
    rerunLimit = rerun.rerunLimit
    ciClassification =
      state === 'CI_RED' ? 'rerun exhausted' : 'transient review failure'
    checkSummaries = summarizeChecks(ciResult.reviewRerunFailures)
  } else if (openThreads() > 0) {
    ;[state, detail] = ['NEEDS_FIX', `${threads} unresolved thread(s)`]
  } else if (!claudeReady || ciResult.ci === 'pending') {
    ;[state, detail] = ['WAITING', 'CI / Claude re-running']
  } else {
    // verdict is irrelevant until threads are clear — defer the fetch to here
    const verdict = claudeVerdictClean(ctx.owner, ctx.name, pr.number) // null|true|false
    claude =
      verdict === true ? 'clean' : verdict === false ? 'issues' : 'no verdict'
    if (verdict === false) {
      ;[state, detail] = ['NEEDS_FIX', 'Claude verdict: patch has issues']
    } else if (verdict === null) {
      ;[state, detail] = ['WAITING', 'no Claude review yet']
    } else if (view.mergeable !== 'MERGEABLE') {
      ;[state, detail] = ['WAITING', `not mergeable (${view.mergeStateStatus})`]
    } else {
      ;[state, detail] = [
        'GOOD_SHAPE',
        '0 threads · Claude clean · CI green · mergeable',
      ]
    }

    return {
      state,
      detail,
      vim,
      threads,
      headSha: view.headRefOid,
      ci: ciResult.ci,
      claude,
      mergeable: view.mergeable,
      mergeStateStatus: view.mergeStateStatus,
      action,
      rerunAttempt,
      rerunLimit,
      ciClassification,
      checkSummaries,
      fixContext,
    }
  }

  return {
    state,
    detail,
    vim,
    threads: null,
    headSha: view.headRefOid,
    ci: ciResult.ci,
    claude,
    mergeable: view.mergeable,
    mergeStateStatus: view.mergeStateStatus,
    action,
    rerunAttempt,
    rerunLimit,
    ciClassification,
    checkSummaries,
    fixContext,
  }
}

const postLinear = (vim, body, stateName) => {
  if (!vim) {
    return false
  }

  const args = [
    join(SCRIPT_DIR, 'lib', 'linear-status.js'),
    vim,
    body,
    '--as',
    'orchestrator',
  ]
  if (stateName) {
    args.push('--state', stateName)
  }
  const r = spawnSync('node', args, { encoding: 'utf8' })
  if (r.status === 0) {
    out(
      `           ↳ Linear ${vim}${stateName ? ` → ${stateName}` : ''}: commented`
    )

    return true
  } else {
    out(
      `           ↳ Linear ${vim}: skipped (${(r.stderr || '').trim().split('\n')[0] || 'no LINEAR_API_KEY'})`
    )

    return false
  }
}

const maybePostDecisionLinear = (pr, s, ctx) => {
  if (!ctx.linearDecisions || !s.vim) {
    return
  }

  const action = s.action || actionForDecision(s.state, ctx)

  const key = decisionKey({
    pr: pr.number,
    state: s.state,
    detail: s.detail,
    headSha: s.headSha,
    action,
    approve: ctx.approve,
    execute: ctx.execute,
  })
  const storeFile = decisionStorePath(pr.number)
  const store = readDecisionStore(storeFile)
  if (!shouldPostDecision(store, pr.number, key)) {
    out(`           ↳ Linear ${s.vim}: decision unchanged`)

    return
  }

  const body = formatDecisionComment({
    pr: pr.number,
    branch: pr.headRefName,
    state: s.state,
    detail: s.detail,
    sourceEvent: ctx.reason,
    action,
    approve: ctx.approve,
    execute: ctx.execute,
    headSha: s.headSha,
    ci: s.ci,
    claude: s.claude,
    threads: s.threads,
    mergeable: s.mergeable,
    mergeStateStatus: s.mergeStateStatus,
    ciClassification: s.ciClassification,
    checkSummaries: s.checkSummaries,
    rerunAttempt: s.rerunAttempt,
    rerunLimit: s.rerunLimit,
  })

  const stateName =
    s.state === 'NEEDS_FIX' && action === 'dispatch fixer'
      ? 'In Progress'
      : undefined
  if (postLinear(s.vim, body, stateName)) {
    markDecisionPosted(store, pr.number, key, storeFile)
  }
}

// Squash-merge + branch delete as the orchestrator bot (or you, if none).
// headSha is the head observed at GOOD_SHAPE classification — the merge aborts if
// the head moved since (so we never squash-merge an unreviewed push).
const approve = (pr, vim, headSha, ctx) => {
  const env = botProcessEnv(ctx.orchBot)
  const merger = botLabel(ctx.orchBot)
  out(`           → APPROVING as ${merger}: squash-merge #${pr.number}`)

  const prInfo = ghJson([
    'pr',
    'view',
    String(pr.number),
    '--json',
    'reviews,isCrossRepository',
  ])

  const alreadyApproved = (prInfo.reviews || []).some(
    (r) => r.state === 'APPROVED' && r.author?.login === ctx.approverLogin
  )
  if (!alreadyApproved) {
    gh(['pr', 'review', String(pr.number), '--approve'], env)
  }
  gh(
    [
      'pr',
      'merge',
      String(pr.number),
      '--squash',
      '--match-head-commit',
      headSha,
    ],
    env
  )
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
  // Delete the merged branch REMOTELY — but only when the PR head is in the
  // base repo. Fork PRs have headRefName in the contributor's repo; deleting
  // here could remove a coincidentally-named base-repo branch.
  if (!prInfo.isCrossRepository) {
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
  } else {
    out(`           (fork PR — skipped remote branch deletion)`)
  }
  postLinear(
    vim,
    `QA runner: PR #${pr.number} met all review success criteria → squash-merged by ${merger}.`,
    'Done'
  )
}

// Run run.js for one PR as a child, teeing output to a per-PR log and prefixing
// the console so concurrent runs stay legible. Resolves the exit code; never
// rejects — a failed child must not abort the pool. run.js adopts the INNER
// (fixer) bot identity itself, so we just inherit the env here.
const dispatchFix = ({ pr, fixContext }) =>
  new Promise((resolve) => {
    mkdirSync(LOG_DIR, { recursive: true })
    const logPath = join(LOG_DIR, `pr-${pr}.log`)
    const logFd = createWriteStream(logPath, { flags: 'a' })
    const tag = `[#${pr}]`
    let lastLine = ''
    clearDispatchBlocker(pr)
    out(`${tag} → run.js ${pr} --push   (log: ${logPath})`)

    const child = spawn(
      'node',
      [join(SCRIPT_DIR, 'run.js'), String(pr), '--push'],
      {
        env: {
          ...process.env,
          ...(fixContext
            ? { QA_FIX_CONTEXT: JSON.stringify(fixContext, null, 2) }
            : {}),
        },
      }
    )

    const pipe = (stream) => {
      let buf = ''
      stream.on('data', (d) => {
        logFd.write(d)
        buf += d.toString()
        let nl
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl)
          if (line.trim()) {
            lastLine = line.trim()
          }
          out(`${tag} ${line}`)
          buf = buf.slice(nl + 1)
        }
      })

      stream.on('end', () => {
        if (buf) {
          if (buf.trim()) {
            lastLine = buf.trim()
          }
          out(`${tag} ${buf}`)
        }
      })
    }
    pipe(child.stdout)
    pipe(child.stderr)
    child.on('close', (code) => {
      logFd.end()
      if (code === RUN_SELF_REVIEW_EXIT) {
        writeDispatchBlocker(pr, {
          code,
          reason: lastLine || `run.js exited ${code}`,
          logPath,
        })
      }
      out(`${tag} ✓ run.js exited ${code}`)
      resolve({ code })
    })

    child.on('error', (e) => {
      logFd.end()
      out(`${tag} ✗ spawn error: ${e.message}`)
      resolve({ code: -1 })
    })
  })

// Bounded-concurrency pool — at most `limit` workers in flight.
const pool = async (items, limit, worker) => {
  const results = []
  let i = 0

  const next = async () => {
    while (i < items.length) {
      const idx = i++
      results[idx] = await worker(items[idx])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next))

  return results
}

const tick = async (ctx) => {
  const prs = candidatePRs(ctx.pr).filter(
    (p) => (ctx.all || hasLabel(p, ctx.label)) && !p.isDraft
  )
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
  let classifyError = false
  let approveError = false
  for (const pr of prs) {
    if (isLocked(pr.number)) {
      out(`LOCKED     #${pr.number} ${pr.headRefName} — run in flight, skip\n`)
      continue
    }
    let s
    try {
      s = await computeState(pr, ctx)
    } catch (e) {
      // A transient classification failure (gh checks / GraphQL) is NOT a clean tick —
      // flag it so the exit is non-zero and a supervising daemon counts it, rather
      // than reading exit 0 as "WAITING" and resetting the PR's failure streak.
      out(`ERROR      #${pr.number} — ${e.message.split('\n')[0]}\n`)
      classifyError = true
      continue
    }
    out(
      `${s.state.padEnd(10)} #${pr.number}  ${pr.headRefName}${s.vim ? `  (${s.vim})` : ''}`
    )
    out(`           ${s.detail}`)
    maybePostDecisionLinear(pr, s, ctx)
    if (s.state === 'NEEDS_FIX') {
      if (ctx.execute) {
        needsFix.push({ pr: pr.number, fixContext: s.fixContext })
      } else {
        out(`           (report-only — pass --execute to run the cycle)`)
      }
    } else if (s.state === 'GOOD_SHAPE') {
      if (ctx.approve) {
        try {
          approve(pr, s.vim, s.headSha, ctx)
        } catch (e) {
          // A failed merge (branch protection, perms, a moved head, a transient gh
          // outage) is infra, not a fixer stall — flag it for the exit-2 path so the
          // daemon retries without counting it toward pausing the PR.
          out(`           ✗ approve failed: ${e.message.split('\n')[0]}`)
          approveError = true
        }
      } else {
        out(`           (report-only — pass --approve to auto-merge)`)
      }
    }
    out('')
  }
  let fixerStall = false
  let dispatchBlocked = false
  let transientChild = false
  if (needsFix.length) {
    out(
      `Dispatching ${needsFix.length} fix run(s), up to ${ctx.maxParallel} in parallel…\n`
    )
    const results = await pool(needsFix, ctx.maxParallel, dispatchFix)
    // dispatchFix resolves a real run.js exit code, null (signal-killed), or -1
    // (spawn failed: node/run.js missing, OOM before fork). Self-review refusal is
    // a local dispatch blocker, not a failed fixer attempt.
    const codes = results.map((r) => r.code)
    fixerStall = codes.some(
      (c) => c !== null && c !== -1 && c !== 0 && c !== RUN_SELF_REVIEW_EXIT
    )
    dispatchBlocked = codes.some((c) => c === RUN_SELF_REVIEW_EXIT)
    transientChild = codes.some((c) => c === null || c === -1)
  }
  // Exit-code contract for the supervising daemon:
  //   1 = a dispatched FIXER stalled (run.js non-zero) — the actionable signal it
  //       counts toward pausing the PR (kimi can't drive these findings to zero).
  //   2 = a TRANSIENT infra failure (classify / approve / signal-kill / spawn-fail) —
  //       the daemon retries WITHOUT pausing, so a blip or host OOM can't stick a PR.
  //   3 = dispatch blocked before a fixer ran — the daemon pauses with the blocker
  //       reason instead of burning fixer attempts.
  // Fixer stall wins when both happen in one tick.
  if (fixerStall) {
    process.exitCode = 1
  } else if (dispatchBlocked) {
    process.exitCode = DISPATCH_BLOCKED_EXIT
  } else if (classifyError || approveError || transientChild) {
    process.exitCode = 2
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
  const prs = candidatePRs(ctx.pr)
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
    if (eligible) {
      n++
    }
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
    linearDecisions: has('linear-decisions'),
    linearCreateIssues: has('linear-create-issues'),
    reason: val('reason') || 'manual',
    all: has('all'),
    pr: val('pr') ? Number(val('pr')) : undefined,
    maxParallel: Math.max(1, numericOption(val('max'), MAX_PARALLEL)),
    maxCiReruns: numericOption(val('max-ci-reruns'), MAX_CI_RERUNS),
    linearTeamKey: val('linear-team') || 'VIM',
    orchBot,
    approverLogin: orchBot?.user ?? ghJson(['api', 'user']).login,
  }
  if (cmd === 'scan') {
    return scan(ctx)
  }
  if (cmd === 'tick') {
    return tick(ctx)
  }
  if (cmd === 'watch') {
    return watch(ctx)
  }
  err(
    `unknown command: ${cmd}. Use: scan | tick | watch  [--pr N] [--approve] [--execute] [--linear-decisions] [--linear-create-issues] [--max-ci-reruns N] [--linear-team KEY] [--reason EVENT] [--all] [--max N] [--label NAME]`
  )
  process.exit(1)
}

try {
  await main()
} catch (e) {
  // A throw reaching here is a top-level infra failure (repoSlug / targeted PR
  // lookup / `gh api user`), NOT a dispatched-fixer stall — a fixer stall sets
  // exitCode 1 inside tick and returns without throwing. Exit 2 (transient) so the
  // daemon retries instead of counting it toward pausing a healthy PR.
  err(e.message)
  process.exit(2)
}
