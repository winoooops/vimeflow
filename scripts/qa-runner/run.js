#!/usr/bin/env node
// QA runner — inner runner (increment 2, skill-based).
//
// Dispatches a headless kimi that runs the ported lifeline `upsource-review`
// skill on a PR's worktree to drive its review findings to zero. DRY-RUN by
// default (kimi stops before commit/push; the PR is never touched). `--push`
// arms the live path (kimi commits/pushes; status posts to the linked Linear
// issue).
//
// Identity: if scripts/qa-runner/bot.env is present + filled, the runner acts as
// that bot account (GH_TOKEN + bot git-author + HTTPS-push via the gh credential
// helper); otherwise it acts as your own gh. See README.md.
//
// kimi loads the skill via `--skills-dir` and is invoked with
// `/skill:upsource-review <PR#>`; the skill's helper scripts resolve their dir
// via a `skills/upsource-review` symlink we create in the worktree. codex is the
// verify gate (inside the skill).

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { botEnv, botLabel, loadBot } from './lib/bot-identity.js'
import { formatFixerCycleComment } from './lib/decision-comment.js'
import { RUN_SELF_REVIEW_EXIT } from './lib/dispatch-blocker.js'
import { worktreePlan } from './lib/fixer-worktree.js'
import { linkedVimForPr } from './lib/pr-utils.js'
import { runUntilChange } from './lib/run-until-change.js'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const LOCK_DIR = join(SCRIPT_DIR, '.locks')
const KIMI_TIMEOUT_MS = 45 * 60 * 1000

const out = (s = '') => process.stdout.write(`${s}\n`)

const die = (s, code = 1) => {
  const err = new Error(s)
  err.exitCode = code
  throw err
}

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...opts,
  })

// Latest lifeline version in the plugin cache that ships the skill.
const lifelineSkillsDir = () => {
  const root = join(
    homedir(),
    '.claude',
    'plugins',
    'cache',
    'lifeline',
    'lifeline'
  )

  const versions = readdirSync(root)
    .filter((v) => existsSync(join(root, v, 'skills', 'upsource-review')))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  if (!versions.length) {
    die('lifeline upsource-review skill not found in the plugin cache.')
  }

  return join(root, versions[versions.length - 1], 'skills')
}

const mainRoot = () =>
  dirname(
    sh('git', [
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
    ]).trim()
  )

// The worktree that has `branch` checked out, or null — used to refuse self-review.
const worktreeForBranch = (branch) => {
  let path = null
  for (const line of sh('git', ['worktree', 'list', '--porcelain']).split(
    '\n'
  )) {
    if (line.startsWith('worktree ')) {
      path = line.slice('worktree '.length)
    } else if (line === `branch refs/heads/${branch}`) {
      return path
    }
  }

  return null
}

const ensureWorktree = (pr, branch, live, skillsDir, bot, repo) => {
  // No self-review: refuse only when the branch is held by a DIFFERENT worktree (a
  // dev checkout). Our own qa-pr-N from a prior round is fine — reset + reuse it.
  const heldPath = worktreeForBranch(branch)

  const plan = worktreePlan({
    repoRoot: mainRoot(),
    pr,
    branch,
    live,
    heldPath,
  })
  const wt = plan.path
  if (plan.blockedBy) {
    die(
      `refusing to review PR #${pr}: branch '${branch}' is checked out at ${plan.blockedBy} (no self-review)`,
      RUN_SELF_REVIEW_EXIT
    )
  }
  if (!existsSync(wt)) {
    sh('git', plan.fetchArgs)
    sh('git', plan.addArgs)
  } else {
    // reset a stale qa-pr-N worktree from a prior run
    sh('git', ['-C', wt, ...plan.fetchArgs])
    sh('git', plan.checkoutArgs)
    sh('git', ['-C', wt, 'reset', '--hard'])
    sh('git', ['-C', wt, 'clean', '-fd'])
  }
  if (!live) {
    // dry-run branch carries no upstream — an accidental push has no target
    try {
      sh('git', ['-C', wt, 'branch', '--unset-upstream'])
    } catch {
      /* no upstream to unset */
    }
  }
  // The skill's helper scripts bootstrap from `skills/upsource-review` (repo-relative).
  mkdirSync(join(wt, 'skills'), { recursive: true })
  const link = join(wt, 'skills', 'upsource-review')
  rmSync(link, { recursive: true, force: true })
  symlinkSync(join(skillsDir, 'upsource-review'), link)
  // Live + bot: push as the bot over HTTPS via the gh credential helper.
  if (bot && live) {
    sh('git', [
      '-C',
      wt,
      'remote',
      'set-url',
      'origin',
      `https://github.com/${repo}.git`,
    ])

    sh('git', [
      '-C',
      wt,
      'config',
      'credential.https://github.com.helper',
      '!gh auth git-credential',
    ])
  }

  return wt
}

const fixContextText = () => {
  const context = process.env.QA_FIX_CONTEXT
  if (!context) {
    return ''
  }

  return (
    '\n\nAdditional orchestrator context for this fixer cycle:\n' +
    '```json\n' +
    context +
    '\n```\n' +
    'If this context describes deterministic CI failures, inspect the linked GitHub check logs and fix those failures even when there are no unresolved review threads.'
  )
}

const invocation = (pr, live) => {
  const base =
    `/skill:upsource-review ${pr}\n\n` +
    `Run the lifeline upsource-review skill now on pull request #${pr} of this repository. ` +
    `"${pr}" is the PR number — not a line number or a count. Resolve PR #${pr}, fetch its ` +
    `review findings, and fix every one. Do not ask for clarification; the target is PR #${pr}.` +
    fixContextText()
  if (live) {
    // SINGLE PASS: the orchestrator owns re-dispatch — fix one round and exit, never poll.
    return (
      `${base}\n\n` +
      'SINGLE PASS — fix only the CURRENT round of review findings: apply the fixes, ' +
      'run the codex verify gate, commit, push, then reply to and resolve the threads ' +
      'you addressed, and STOP. Do NOT poll or wait for a re-review, and do NOT begin ' +
      'another fix round — exit cleanly as soon as this round is pushed. The orchestrator ' +
      're-dispatches you when fresh review feedback arrives.'
    )
  }

  return (
    `${base}\n\n` +
    'MODE: DRY RUN — run the cycle through the codex verify gate ONLY, then STOP. ' +
    'Do NOT commit, push, reply, or resolve anything; do NOT modify the PR or any thread. ' +
    'Leave changes in the working tree and output: the findings, the fix per finding ' +
    '(or skip + one-line rationale), the codex verdict, and the staged diff. This is a ' +
    'capability test — inspected before anything goes live.'
  )
}

const run = async (pr, live) => {
  mkdirSync(LOCK_DIR, { recursive: true })
  const lock = join(LOCK_DIR, `pr-${pr}.lock`)
  try {
    writeFileSync(lock, `pid ${process.pid}\n`, { flag: 'wx' })
  } catch (e) {
    if (e.code === 'EEXIST') {
      die(`PR #${pr} locked (run in flight). rm ${lock} to override.`, 3)
    }
    try {
      unlinkSync(lock)
    } catch {
      /* lock may not exist */
    }
    throw e
  }
  try {
    const info = JSON.parse(
      sh('gh', [
        'pr',
        'view',
        String(pr),
        '--json',
        'number,headRefName,url,body,state,isCrossRepository',
      ])
    )
    if (info.state !== 'OPEN') {
      die(`PR #${pr} is ${info.state}, not OPEN.`)
    }
    if (info.isCrossRepository) {
      die(
        `PR #${pr} is from a fork — its head ref isn't a base-repo branch; refusing to avoid fetching/pushing the wrong branch.`,
        5
      )
    }
    const branch = info.headRefName
    const bot = loadBot(SCRIPT_DIR, 'bot.env', 'GH_BOT')

    const repo = JSON.parse(
      sh('gh', ['repo', 'view', '--json', 'nameWithOwner'])
    ).nameWithOwner
    const skillsDir = lifelineSkillsDir()
    const wt = ensureWorktree(pr, branch, live, skillsDir, bot, repo)
    // HEAD before the run (== origin/<branch>) — the baseline the post-run live
    // checks compare against to tell "advanced the remote" from "did nothing".
    const startHead = sh('git', ['-C', wt, 'rev-parse', 'HEAD']).trim()
    out(
      `${live ? 'LIVE' : 'DRY-RUN'}: kimi → /skill:upsource-review ${pr}  ` +
        `(branch ${branch}, as ${botLabel(bot)}, worktree ${wt})`
    )

    // Single-pass guard: stop kimi once it commits (probe = worktree HEAD) so the skill can't POLL_NEXT.
    const r = await runUntilChange(
      () =>
        spawn(
          'kimi',
          [
            '--afk',
            '--print',
            '-w',
            wt,
            '--skills-dir',
            skillsDir,
            '-p',
            invocation(pr, live),
          ],
          {
            stdio: 'inherit',
            env: {
              ...process.env,
              ...botEnv(bot),
              USER_SUPPLIED_PR_NUMBER: String(pr),
            },
          }
        ),
      () => {
        try {
          return sh('git', ['-C', wt, 'rev-parse', 'HEAD']).trim()
        } catch {
          return null
        }
      },
      { timeoutMs: KIMI_TIMEOUT_MS, log: out }
    )
    if (r.error) {
      die('kimi spawn failed: ' + r.error.message)
    }
    if (r.timedOut) {
      const head = sh('git', ['-C', wt, 'rev-parse', 'HEAD']).trim()
      if (head === startHead) {
        die(`kimi timed out with no commit (${KIMI_TIMEOUT_MS / 60000}m)`, 6)
      }
      // commit landed in the final poll window — fall through to push verification
    }
    // A non-zero exit or unexpected signal (anything but our intentional single-pass
    // stop) is a real fixer failure — exit non-zero so the daemon's failure
    // accounting sees it instead of recording a clean waiting cycle.
    if (!r.killed && r.status !== 0) {
      die(`kimi failed (${r.status ?? `signal ${r.signal}`})`, 7)
    }
    // Live invariant: exit 0 ONLY when the run advanced origin/<branch>, so the daemon
    // can read a clean exit as real progress. Two ways it can fail to:
    //   1. No commit at all — the fixer was dispatched for findings but addressed
    //      none (HEAD never left startHead). Looks identical to a WAITING tick to the
    //      daemon, so without this it would reset the failure streak and poll forever.
    //   2. Committed but the push never landed (bad credentials, non-fast-forward,
    //      killed mid-push) — the probe is the LOCAL HEAD, so grace tripped on the
    //      commit; origin/<branch> stays behind, so the daemon sees an unchanged remote.
    let pushedHead = null
    if (live) {
      const head = sh('git', ['-C', wt, 'rev-parse', 'HEAD']).trim()
      if (head === startHead) {
        die(`kimi produced no commit — findings left unaddressed`, 9)
      }
      let remote = null
      try {
        remote = sh('git', ['-C', wt, 'rev-parse', `origin/${branch}`]).trim()
      } catch {
        /* remote-tracking ref missing — treated as not-pushed below */
      }
      if (remote !== head) {
        die(
          `kimi committed but the push did not land (local ${head.slice(0, 7)} ≠ origin/${branch} ${remote ? remote.slice(0, 7) : 'unknown'})`,
          8
        )
      }
      pushedHead = head
    }
    out('')
    out(
      `kimi exit: ${r.status ?? `signal ${r.signal}`}${r.killed ? ' (single-pass stop)' : ''}`
    )
    out('--- worktree changes ---')
    const worktreeStatus = sh('git', ['-C', wt, 'status', '--short']).trim()
    out(worktreeStatus || '(none)')
    // r.killed (single-pass stop) is also success — every failure mode die()'d above.
    if (live && (r.status === 0 || r.killed)) {
      const vim = linkedVimForPr({
        body: info.body,
        branch,
        pr,
      })
      if (vim) {
        const kimiExit =
          r.status === null || r.status === undefined
            ? r.signal
              ? `signal ${r.signal}`
              : 'unknown'
            : String(r.status)

        const stopMode = r.timedOut
          ? 'timeout stop'
          : r.killed
            ? 'single-pass stop'
            : 'process exit'

        const body = formatFixerCycleComment({
          pr,
          url: info.url,
          branch,
          headSha: pushedHead,
          kimiExit,
          stopMode,
          worktreeClean: !worktreeStatus,
        })

        spawnSync(
          'node',
          [
            join(SCRIPT_DIR, 'lib', 'linear-status.js'),
            vim,
            body,
            '--as',
            'fixer',
          ],
          { stdio: 'inherit' }
        )
      } else {
        out('(no VIM-N in the PR body — skipped Linear status.)')
      }
    }
  } finally {
    try {
      unlinkSync(lock)
    } catch {
      /* lock already gone */
    }
  }
}

const main = async () => {
  try {
    const argv = process.argv.slice(2)
    const pr = Number(argv.find((a) => /^\d+$/.test(a)))
    if (!pr) {
      die(
        'usage: run.js <PR#> [--push]   (default = dry-run; --push arms the live path)'
      )
    }
    await run(pr, argv.includes('--push'))
  } catch (e) {
    process.stderr.write(`${e.message}\n`)
    process.exit(e.exitCode || 1)
  }
}

await main()
