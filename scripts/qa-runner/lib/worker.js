// The daemon's WORKER — the unit of work for one queued PR. `runOne(pr, reason)`
// runs a SINGLE review cycle and records what happened; the worker pool in
// daemon.js calls it concurrently (capped at maxParallel), and the poll + webhooks
// re-enqueue the PR for the next cycle.
//
// One cycle = shell `watch.js tick --pr N --execute --approve` (which computes the
// review state and either dispatches the kimi fixer or approves+merges), then
// update the persistent state (round/noop counts, last-reviewed HEAD) and emit
// lifecycle events (the .state/events.jsonl pool + Linear milestones). The long
// kimi step runs via async spawn so it never blocks the daemon's event loop.
//
// Single-pass: one cycle then return, never looping internally — that in-dispatch
// looping was the root cause of kimi's multi-round timeouts.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  decisionStorePath,
  fixCycleThreadParentId,
  hasMergeLinearPosted,
  markFixCycleProgress,
  readDecisionStore,
} from './decision-comment.js'
import {
  DISPATCH_BLOCKED_EXIT,
  clearDispatchBlocker,
  dispatchBlockerDetail,
  readDispatchBlocker,
} from './dispatch-blocker.js'
import { fixerWorktreePath } from './fixer-worktree.js'
import { linkedVimForPr } from './pr-utils.js'

const WATCH = join(dirname(dirname(fileURLToPath(import.meta.url))), 'watch.js')
const FAILURE_LOG_TAIL_BYTES = 128 * 1024

const snapshotFailureText = (e) =>
  [e?.stderr?.toString?.(), e?.stdout?.toString?.(), e?.message]
    .filter(Boolean)
    .join('\n')

const logPathFromText = (text) =>
  String(text || '').match(/\blog: ([^)]+)/)?.[1] || null

const failureLogTail = (path) => {
  if (!path || !existsSync(path)) {
    return ''
  }
  try {
    const content = readFileSync(path, 'utf8')

    return content.slice(-FAILURE_LOG_TAIL_BYTES)
  } catch {
    return ''
  }
}

const tickFailureText = (tickResult) => {
  const logPath = tickResult.logPath || logPathFromText(tickResult.exitReason)

  return [tickResult.exitReason, failureLogTail(logPath)]
    .filter(Boolean)
    .join('\n')
}

const hasAgentQuotaFailure = (text) =>
  [
    /provider\.api_error.*(?:403|429).{0,240}(?:usage|rate|quota|quota-upgrade)/is,
    /\b(?:rate_limit_exceeded|insufficient_quota)\b/i,
    /\b(?:you(?:'ve| have)? reached|exceeded).{0,160}\b(?:usage|rate) limit\b/is,
    /\bquota (?:will be )?refreshed\b/i,
  ].some((pattern) => pattern.test(text))

export const workerInfraFailure = (tickResult) => {
  const text = tickFailureText(tickResult)
  if (
    /committed but the push did not land|failed to push some refs|git-remote-https/i.test(
      text
    )
  ) {
    return {
      category: 'worker_git_push_failed',
      detail: 'worker git push did not land',
    }
  }
  if (hasAgentQuotaFailure(text)) {
    return {
      category: 'worker_agent_quota_exhausted',
      detail: 'worker agent usage quota exhausted',
    }
  }
  if (/No space left on device|ENOSPC/i.test(text)) {
    return {
      category: 'worker_disk_full',
      detail: 'worker disk full',
    }
  }
  if (/QA_WORKER_DISK_LOW|worker disk .*low/i.test(text)) {
    return {
      category: 'worker_disk_low',
      detail: 'worker disk free space below cleanup threshold',
    }
  }
  if (
    /SSM command .* produced no output|document process failed unexpectedly|TargetNotConnected|DeliveryTimedOut|ExecutionTimedOut|Undeliverable/i.test(
      text
    )
  ) {
    return {
      category: 'worker_ssm_unhealthy',
      detail: 'worker SSM command failed before fixer output',
    }
  }

  return null
}

export const isMissingPullRequestSnapshot = (e) =>
  /Could not resolve to a PullRequest/i.test(snapshotFailureText(e))

const snapshot = (pr, exec = execFileSync) => {
  try {
    const j = JSON.parse(
      exec(
        'gh',
        [
          'pr',
          'view',
          String(pr),
          '--json',
          'headRefOid,state,body,isDraft,labels,headRefName',
        ],
        { encoding: 'utf8' }
      )
    )

    return {
      ok: true,
      headSha: j.headRefOid,
      state: j.state,
      vim: linkedVimForPr({
        body: j.body,
        branch: j.headRefName,
        pr,
      }),
      isDraft: Boolean(j.isDraft),
      labels: (j.labels || []).map((l) => l.name),
    }
  } catch (e) {
    // ok:false marks an UNKNOWN read (network / auth / rate-limit), distinct from a
    // real unlabeled/draft PR — the caller must not mutate state on an unknown.
    // A GitHub "PullRequest not found" response for an untracked synthetic PR is
    // permanent, so the smoke path can skip instead of hot-retrying forever.
    return {
      ok: false,
      missing: isMissingPullRequestSnapshot(e),
      headSha: null,
      state: null,
      vim: undefined,
      isDraft: false,
      labels: [],
    }
  }
}

export const watchArgs = (
  pr,
  {
    label,
    approve = false,
    linearDecisionComments = false,
    linearCreateIssues = false,
    linearTeamKey,
    maxCiReruns,
    reason,
    workerKeepAlive = false,
  } = {}
) => {
  const args = [WATCH, 'tick', '--pr', String(pr), '--execute']
  if (approve) {
    args.push('--approve')
  }
  if (linearDecisionComments) {
    args.push('--linear-decisions')
  }
  if (linearCreateIssues) {
    args.push('--linear-create-issues')
  }
  if (linearTeamKey) {
    args.push('--linear-team', linearTeamKey)
  }
  if (maxCiReruns != null) {
    args.push('--max-ci-reruns', String(maxCiReruns))
  }
  if (reason) {
    args.push('--reason', reason)
  }
  if (label) {
    args.push('--label', label)
  }
  if (workerKeepAlive) {
    args.push('--worker-keep-alive')
  }

  return args
}

export const approveForLabels = (
  { approveLabel = 'auto-approve' } = {},
  labels = []
) => Boolean(approveLabel) && labels.includes(approveLabel)

const cycleConfig = (config, labels) => ({
  ...config,
  approve: approveForLabels(config, labels),
})

const tick = (pr, config, reason) =>
  new Promise((resolve) => {
    const args = watchArgs(pr, { ...config, reason })

    const child = spawn('node', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let lastLine = ''
    let logPath = null
    let settled = false

    const remember = (line) => {
      const trimmed = line.trim()
      if (!trimmed) {
        return
      }
      lastLine = trimmed
      logPath = logPath || trimmed.match(/\(log: ([^)]+)\)/)?.[1] || null
    }

    const pipe = (stream, target) => {
      let buf = ''
      stream.on('data', (d) => {
        target.write(d)
        buf += d.toString()
        let nl
        while ((nl = buf.indexOf('\n')) >= 0) {
          remember(buf.slice(0, nl))
          buf = buf.slice(nl + 1)
        }
      })

      stream.on('end', () => {
        remember(buf)
      })
    }

    pipe(child.stdout, process.stdout)
    pipe(child.stderr, process.stderr)
    child.on('close', (code, signal) => {
      if (settled) {
        return
      }
      settled = true
      resolve({
        code: code ?? -1,
        signal: signal ?? null,
        exitReason:
          lastLine ||
          (signal
            ? `watch.js terminated by ${signal}`
            : `watch.js exited ${code}`),
        logPath,
      })
    })

    child.on('error', (error) => {
      if (settled) {
        return
      }
      settled = true
      resolve({
        code: -1,
        signal: null,
        exitReason: `watch.js spawn error: ${error.message}`,
        logPath,
      })
    })
  })

// Run one cycle for `pr`. deps: { config, state, log, events, now?,
// snapshotExec? }. Async — the heavy watch.js/kimi run is awaited, keeping the
// daemon responsive. Returns an outcome tag:
const pauseLabel = (st, maxNoops) =>
  st.pauseReason === 'dispatch_blocked'
    ? 'dispatch blocked'
    : `${st.noopCount}/${maxNoops} failed`

const decisionStore = (pr) => readDecisionStore(decisionStorePath(pr))

const needsFixParentId = (pr, headSha) =>
  fixCycleThreadParentId(decisionStore(pr), pr, { headSha })

const shouldPostMergedLinear = (pr) =>
  !hasMergeLinearPosted(decisionStore(pr), pr)

const cleanupPrWorktree = (pr, exec = execFileSync) => {
  try {
    const repoRoot = dirname(
      exec('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
        encoding: 'utf8',
      }).trim()
    )

    exec('git', [
      'worktree',
      'remove',
      '--force',
      fixerWorktreePath(repoRoot, pr),
    ])
  } catch {
    // Best-effort cleanup only. A missing worktree or transient git failure must not
    // change terminal PR handling.
  }
}

const normalizeTickResult = (result) => {
  if (typeof result === 'number' || result == null) {
    return {
      code: result ?? -1,
      signal: null,
      exitReason: `watch.js exited ${result ?? -1}`,
      logPath: null,
    }
  }

  return {
    code: result.code ?? -1,
    signal: result.signal ?? null,
    exitReason:
      result.exitReason ||
      (result.signal
        ? `watch.js terminated by ${result.signal}`
        : `watch.js exited ${result.code ?? -1}`),
    logPath: result.logPath ?? logPathFromText(result.exitReason) ?? null,
  }
}

// 'done' | 'progress' | 'error' | 'waiting' | 'paused' | 'blocked' | 'skip' | 'retry'.
export const runOne = async (pr, reason, deps) => {
  const {
    config,
    state,
    log,
    events,
    now = () => new Date().toISOString(),
    snapshotExec = execFileSync,
    tickRunner = tick,
    cleanupWorktree = cleanupPrWorktree,
  } = deps
  const st = state.get(pr)
  const tracked = state.has(pr)
  const before = snapshot(pr, snapshotExec)

  // Missing untracked PR: a synthetic / stale webhook, not a transient. Do not
  // requeue it; this is the local smoke's expected safe skip path.
  if (!before.ok) {
    if (before.missing && !tracked) {
      log(`#${pr}: PR not found — skip`)

      return 'skip'
    }
    // Unknown read (gh failed transiently): do NOT touch state — forgetting here would
    // drop a tracked PR's round/noop counts and its later merged/closed milestone over a
    // blip. Skip; the next poll/event re-snapshots.
    log(`#${pr}: snapshot unavailable (transient) — retry, state preserved`)

    return 'retry'
  }

  // Already terminal before we tick — a human merged/closed it, or a `pull_request
  // closed` webhook arrived. Clean up now (no wasted cycle), even if paused. Only
  // announce for PRs we were tracking: `closed` fires repo-wide, so an untracked PR
  // is forgotten silently rather than posting a milestone we never earned.
  if (before.state === 'MERGED' || before.state === 'CLOSED') {
    state.forget(pr)
    cleanupWorktree(pr)
    if (tracked) {
      const type = before.state === 'MERGED' ? 'merged' : 'closed'
      events.emit(
        { type, pr, detail: before.state },
        type === 'merged' && !shouldPostMergedLinear(pr)
          ? undefined
          : before.vim
      )
    }

    return 'done'
  }

  // Eligibility gate. Webhooks (comment / review / CI) enqueue a PR regardless of
  // label, but only labeled, non-draft PRs opt into the runner. Skip the rest BEFORE
  // any state write — else watch.js would no-op AND we'd start tracking a PR that
  // never opted in, letting a later close/merge webhook post a milestone for it.
  const eligible = !before.isDraft && before.labels.includes(config.label)
  if (!eligible) {
    if (tracked) {
      state.forget(pr) // label pulled / converted to draft mid-flight — stop tracking
    }
    log(
      `#${pr}: not eligible (needs label '${config.label}', non-draft) — skip`
    )

    return 'skip'
  }

  const headMoved = Boolean(before.headSha) && before.headSha !== st.lastHeadSha

  // A paused PR is skipped only by the routine POLL. Any real webhook event
  // (review, CI, comment) or a head change re-evaluates it — the thing that
  // unsticks it (CI finishing, a human re-triggering) arrives as an event, and
  // refusing those is how a paused PR gets permanently stuck.
  if (st.pausedAt && reason === 'poll' && !headMoved) {
    log(`#${pr}: paused (${pauseLabel(st, config.maxNoops)}) — poll skip`)

    return 'paused'
  }

  events.emit({ type: 'cycle', pr, round: st.roundCount, detail: reason })

  const tickResult = normalizeTickResult(
    await tickRunner(pr, cycleConfig(config, before.labels), reason)
  )
  const { code } = tickResult
  const after = snapshot(pr, snapshotExec)

  // Post-tick read failed (same rule as the pre-tick guard): never interpret null
  // state/head — that would log a real push/merge as a null-head 'waiting' or miss a
  // terminal event. Leave state intact; the next poll/event reconciles.
  if (!after.ok) {
    log(
      `#${pr}: post-tick snapshot unavailable (transient) — skip, state preserved`
    )

    return 'skip'
  }

  // Terminal states both drop the PR from tracking, but MERGED is a win and CLOSED
  // (closed without merge) is an abandon — distinct events so we never post a 🎉
  // "merged" milestone for a PR a human just closed.
  if (after.state === 'MERGED') {
    state.forget(pr)
    cleanupWorktree(pr)
    events.emit(
      { type: 'merged', pr, detail: after.state },
      shouldPostMergedLinear(pr) ? after.vim : undefined
    )

    return 'done'
  }
  if (after.state === 'CLOSED') {
    state.forget(pr)
    cleanupWorktree(pr)
    events.emit({ type: 'closed', pr, detail: after.state }, after.vim)

    return 'done'
  }

  // Progress = a fix landed DURING this cycle (head advanced from the pre-tick SHA,
  // not merely differs from the last recorded one — that would count a brand-new
  // PR's first WAITING/CI_RED cycle as progress).
  const fixed =
    Boolean(after.headSha) &&
    Boolean(before.headSha) &&
    after.headSha !== before.headSha
  if (fixed) {
    clearDispatchBlocker(pr)
    const round = st.roundCount + 1
    state.update(pr, {
      lastHeadSha: after.headSha,
      roundCount: round,
      noopCount: 0,
      pausedAt: null,
      pauseReason: null,
    })

    markFixCycleProgress(decisionStore(pr), pr, decisionStorePath(pr), {
      headSha: after.headSha,
    })

    events.emit(
      {
        type: 'progress',
        pr,
        round,
        parentId: needsFixParentId(pr, before.headSha),
      },
      after.vim
    )

    return 'progress'
  }

  // watch.js exit codes: 1 = a dispatched fixer stalled (run.js non-zero — crash,
  // timeout, no commit, or commit-without-push); 2 = a transient infra failure
  // (classification / approve); 3 = dispatch blocked before the fixer could run
  // (for example, the PR branch is checked out in a dev worktree); -1 = spawn failed.
  if (code !== 0) {
    if (code === DISPATCH_BLOCKED_EXIT) {
      const blocker = readDispatchBlocker(pr)
      const detail = dispatchBlockerDetail(blocker)
      state.update(pr, {
        lastHeadSha: after.headSha,
        noopCount: 0,
        pausedAt: now(),
        pauseReason: 'dispatch_blocked',
      })
      events.emit({ type: 'dispatch_blocked', pr, detail }, after.vim)

      return 'blocked'
    }
    const infraFailure = workerInfraFailure(tickResult)
    if (infraFailure) {
      events.emit(
        {
          type: 'worker_infra_unhealthy',
          pr,
          sourceEvent: reason,
          category: infraFailure.category,
          detail: infraFailure.detail,
          exitCode: code,
          signal: tickResult.signal,
          exitReason: tickResult.exitReason,
          logPath: tickResult.logPath,
          retryMode: reason === 'poll' ? 'next poll tick' : 'daemon backoff',
          terminal: false,
        },
        after.vim
      )

      return 'retry'
    }
    if (code !== 1) {
      // Transient (2) or a failed spawn (-1) — NOT a fixer stall. Retry next cycle
      // without touching the failure streak, so a gh/GraphQL blip can't pause a
      // healthy PR (which the poll guard would then keep skipping).
      events.emit(
        {
          type: 'error',
          pr,
          sourceEvent: reason,
          category: 'transient',
          detail: `watch.js transient (exit ${code})`,
          exitCode: code,
          signal: tickResult.signal,
          exitReason: tickResult.exitReason,
          logPath: tickResult.logPath,
          retryMode: reason === 'poll' ? 'next poll tick' : 'daemon backoff',
          terminal: false,
        },
        after.vim
      )

      return 'retry'
    }
    // exit 1 = the fixer ran and couldn't advance the head. THE stall signal: count
    // consecutive failures and pause at the cap so a broken PR stops burning cycles.
    const noopCount = st.noopCount + 1
    const paused = noopCount >= config.maxNoops
    state.update(pr, {
      lastHeadSha: after.headSha,
      noopCount,
      pausedAt: paused ? now() : st.pausedAt,
      pauseReason: paused ? 'fixer_stall' : st.pauseReason,
    })

    events.emit(
      {
        type: paused ? 'paused' : 'error',
        pr,
        sourceEvent: reason,
        noopCount,
        maxNoops: config.maxNoops,
        category: 'fixer_stall',
        detail: `fixer stall (watch.js exit ${code})`,
        exitCode: code,
        signal: tickResult.signal,
        exitReason: tickResult.exitReason,
        logPath: tickResult.logPath,
        terminal: paused,
      },
      after.vim
    )

    return paused ? 'paused' : 'error'
  }

  // Clean exit, no head change. Because a dispatched fixer that no-ops now exits
  // non-zero (above), this means NO fixer ran — the PR is genuinely WAITING on CI or
  // review. NOT a stall: reset the failure streak AND clear any pause, since a clean
  // recheck means it is no longer stuck and routine polling should resume.
  clearDispatchBlocker(pr)
  state.update(pr, {
    lastHeadSha: after.headSha,
    noopCount: 0,
    pausedAt: null,
    pauseReason: null,
  })

  return 'waiting'
}
