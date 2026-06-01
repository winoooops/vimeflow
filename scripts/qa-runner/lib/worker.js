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
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { linkedVim } from './pr-utils.js'

const WATCH = join(dirname(dirname(fileURLToPath(import.meta.url))), 'watch.js')

const snapshot = (pr) => {
  try {
    const j = JSON.parse(
      execFileSync(
        'gh',
        [
          'pr',
          'view',
          String(pr),
          '--json',
          'headRefOid,state,body,isDraft,labels',
        ],
        { encoding: 'utf8' }
      )
    )

    return {
      ok: true,
      headSha: j.headRefOid,
      state: j.state,
      vim: linkedVim(j.body),
      isDraft: Boolean(j.isDraft),
      labels: (j.labels || []).map((l) => l.name),
    }
  } catch {
    // ok:false marks an UNKNOWN read (network / auth / rate-limit), distinct from a
    // real unlabeled/draft PR — the caller must not mutate state on an unknown.
    return {
      ok: false,
      headSha: null,
      state: null,
      vim: undefined,
      isDraft: false,
      labels: [],
    }
  }
}

const tick = (pr, label) =>
  new Promise((resolve) => {
    const args = [WATCH, 'tick', '--pr', String(pr), '--execute', '--approve']
    if (label) {
      args.push('--label', label)
    }
    const child = spawn('node', args, { stdio: 'inherit' })
    child.on('exit', (code) => resolve(code ?? -1))
    child.on('error', () => resolve(-1))
  })

// Run one cycle for `pr`. deps: { config, state, log, events, now? }. Async — the
// heavy watch.js/kimi run is awaited, keeping the daemon responsive. Returns an
// outcome tag: 'done' | 'progress' | 'error' | 'waiting' | 'paused' | 'skip' | 'retry'.
export const runOne = async (pr, reason, deps) => {
  const {
    config,
    state,
    log,
    events,
    now = () => new Date().toISOString(),
  } = deps
  const st = state.get(pr)
  const tracked = state.has(pr)
  const before = snapshot(pr)

  // Unknown read (gh failed transiently): do NOT touch state — forgetting here would
  // drop a tracked PR's round/noop counts and its later merged/closed milestone over a
  // blip. Skip; the next poll/event re-snapshots.
  if (!before.ok) {
    log(`#${pr}: snapshot unavailable (transient) — retry, state preserved`)

    return 'retry'
  }

  // Already terminal before we tick — a human merged/closed it, or a `pull_request
  // closed` webhook arrived. Clean up now (no wasted cycle), even if paused. Only
  // announce for PRs we were tracking: `closed` fires repo-wide, so an untracked PR
  // is forgotten silently rather than posting a milestone we never earned.
  if (before.state === 'MERGED' || before.state === 'CLOSED') {
    state.forget(pr)
    if (tracked) {
      const type = before.state === 'MERGED' ? 'merged' : 'closed'
      events.emit({ type, pr, detail: before.state }, before.vim)
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
    log(
      `#${pr}: paused (${st.noopCount}/${config.maxNoops} failed) — poll skip`
    )

    return 'paused'
  }

  events.emit({ type: 'cycle', pr, round: st.roundCount, detail: reason })
  const code = await tick(pr, config.label)
  const after = snapshot(pr)

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
    events.emit({ type: 'merged', pr, detail: after.state }, after.vim)

    return 'done'
  }
  if (after.state === 'CLOSED') {
    state.forget(pr)
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
    const round = st.roundCount + 1
    state.update(pr, {
      lastHeadSha: after.headSha,
      roundCount: round,
      noopCount: 0,
      pausedAt: null,
    })
    events.emit({ type: 'progress', pr, round }, after.vim)

    return 'progress'
  }

  // watch.js exit codes: 1 = a dispatched fixer stalled (run.js non-zero — crash,
  // timeout, no commit, or commit-without-push); 2 = a transient infra failure
  // (classification / approve); -1 = the spawn itself failed.
  if (code !== 0) {
    if (code !== 1) {
      // Transient (2) or a failed spawn (-1) — NOT a fixer stall. Retry next cycle
      // without touching the failure streak, so a gh/GraphQL blip can't pause a
      // healthy PR (which the poll guard would then keep skipping).
      events.emit(
        { type: 'error', pr, detail: `watch.js transient (exit ${code})` },
        after.vim
      )

      return 'error'
    }
    // exit 1 = the fixer ran and couldn't advance the head. THE stall signal: count
    // consecutive failures and pause at the cap so a broken PR stops burning cycles.
    const noopCount = st.noopCount + 1
    const paused = noopCount >= config.maxNoops
    state.update(pr, {
      lastHeadSha: after.headSha,
      noopCount,
      pausedAt: paused ? now() : st.pausedAt,
    })

    events.emit(
      {
        type: paused ? 'paused' : 'error',
        pr,
        noopCount,
        detail: `fixer stall (watch.js exit ${code})`,
      },
      after.vim
    )

    return paused ? 'paused' : 'error'
  }

  // Clean exit, no head change. Because a dispatched fixer that no-ops now exits
  // non-zero (above), this means NO fixer ran — the PR is genuinely WAITING on CI or
  // review. NOT a stall: reset the failure streak AND clear any pause, since a clean
  // recheck means it is no longer stuck and routine polling should resume.
  state.update(pr, { lastHeadSha: after.headSha, noopCount: 0, pausedAt: null })

  return 'waiting'
}
