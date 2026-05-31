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

import { execFileSync, spawnSync } from 'node:child_process'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { botEnv, botLabel, loadBot } from './lib/bot-identity.mjs'

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
  if (!versions.length)
    die('lifeline upsource-review skill not found in the plugin cache.')
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

// The worktree that currently has `branch` checked out, or null. git refuses a
// second worktree on a branch already checked out elsewhere — including the
// runner reviewing its OWN PR, whose branch is this dev worktree.
const worktreeForBranch = (branch) => {
  let path = null
  for (const line of sh('git', ['worktree', 'list', '--porcelain']).split(
    '\n'
  )) {
    if (line.startsWith('worktree ')) path = line.slice('worktree '.length)
    else if (line === `branch refs/heads/${branch}`) return path
  }
  return null
}

const ensureWorktree = (pr, branch, live, skillsDir, bot, repo) => {
  // Reuse a checkout already on the branch; an isolated copy is impossible (and
  // unnecessary) when the branch is checked out elsewhere. Otherwise create one.
  const existing = worktreeForBranch(branch)
  const wt = existing || join(mainRoot(), '.claude', 'worktrees', `qa-pr-${pr}`)
  if (existing) {
    out(`(reusing worktree already on ${branch}: ${wt})`)
  } else if (!existsSync(wt)) {
    sh('git', ['fetch', 'origin', branch, '-q'])
    if (live) {
      sh('git', ['worktree', 'add', '-B', branch, wt, `origin/${branch}`])
    } else {
      // dry-run: throwaway branch with no upstream — an accidental push has no target
      sh('git', [
        'worktree',
        'add',
        '-b',
        `qa/dryrun-${pr}`,
        wt,
        `origin/${branch}`,
      ])
      try {
        sh('git', ['-C', wt, 'branch', '--unset-upstream'])
      } catch {
        /* no upstream to unset */
      }
    }
  } else {
    // Worktree exists but is on the wrong branch (e.g. dry-run → live)
    out(`(resetting existing worktree to origin/${branch})`)
    sh('git', ['-C', wt, 'fetch', 'origin', branch, '-q'])
    if (live) {
      sh('git', ['-C', wt, 'checkout', '-B', branch, `origin/${branch}`])
      sh('git', ['-C', wt, 'reset', '--hard'])
      sh('git', ['-C', wt, 'clean', '-fd'])
    } else {
      sh('git', [
        '-C',
        wt,
        'checkout',
        '-B',
        `qa/dryrun-${pr}`,
        `origin/${branch}`,
      ])
      try {
        sh('git', ['-C', wt, 'branch', '--unset-upstream'])
      } catch {
        /* no upstream to unset */
      }
    }
  }
  // The skill's helper scripts bootstrap from `skills/upsource-review` (repo-relative).
  mkdirSync(join(wt, 'skills'), { recursive: true })
  const link = join(wt, 'skills', 'upsource-review')
  rmSync(link, { recursive: true, force: true })
  symlinkSync(join(skillsDir, 'upsource-review'), link)
  // Live + bot: push as the bot over HTTPS. The gh credential helper reads GH_TOKEN
  // at push time, so the bot token is never written to git config. A reused worktree
  // already shares the repo's (HTTPS + helper) remote config, so skip the rewrite.
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

const invocation = (pr, live) => {
  const base =
    `/skill:upsource-review ${pr}\n\n` +
    `Run the lifeline upsource-review skill now on pull request #${pr} of this repository. ` +
    `"${pr}" is the PR number — not a line number or a count. Resolve PR #${pr}, fetch its ` +
    `review findings, and fix every one. Do not ask for clarification; the target is PR #${pr}.`
  if (live) return base
  return (
    `${base}\n\n` +
    'MODE: DRY RUN — run the cycle through the codex verify gate ONLY, then STOP. ' +
    'Do NOT commit, push, reply, or resolve anything; do NOT modify the PR or any thread. ' +
    'Leave changes in the working tree and output: the findings, the fix per finding ' +
    '(or skip + one-line rationale), the codex verdict, and the staged diff. This is a ' +
    'capability test — inspected before anything goes live.'
  )
}

const run = (pr, live) => {
  mkdirSync(LOCK_DIR, { recursive: true })
  const lock = join(LOCK_DIR, `pr-${pr}.lock`)
  try {
    const fd = openSync(lock, 'wx')
    writeSync(fd, `pid ${process.pid}\n`)
    closeSync(fd)
  } catch (e) {
    if (e.code === 'EEXIST')
      die(`PR #${pr} locked (run in flight). rm ${lock} to override.`, 3)
    throw e
  }
  try {
    const info = JSON.parse(
      sh('gh', [
        'pr',
        'view',
        String(pr),
        '--json',
        'number,headRefName,url,body,state',
      ])
    )
    if (info.state !== 'OPEN') die(`PR #${pr} is ${info.state}, not OPEN.`)
    const branch = info.headRefName
    const bot = loadBot(SCRIPT_DIR, 'bot.env', 'GH_BOT')
    const repo = JSON.parse(
      sh('gh', ['repo', 'view', '--json', 'nameWithOwner'])
    ).nameWithOwner
    const skillsDir = lifelineSkillsDir()
    const wt = ensureWorktree(pr, branch, live, skillsDir, bot, repo)
    out(
      `${live ? 'LIVE' : 'DRY-RUN'}: kimi → /skill:upsource-review ${pr}  ` +
        `(branch ${branch}, as ${botLabel(bot)}, worktree ${wt})`
    )
    const r = spawnSync(
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
        timeout: KIMI_TIMEOUT_MS,
        env: {
          ...process.env,
          ...botEnv(bot),
          USER_SUPPLIED_PR_NUMBER: String(pr),
        },
      }
    )
    if (r.error) die('kimi spawn failed: ' + r.error.message)
    out(`\nkimi exit: ${r.status ?? `signal ${r.signal}`}`)
    out('--- worktree changes ---')
    out(sh('git', ['-C', wt, 'status', '--short']) || '(none)')
    if (live && r.status === 0) {
      const m = (info.body || '').match(/\b(VIM-\d+)\b/i)
      if (m) {
        spawnSync(
          'node',
          [
            join(SCRIPT_DIR, 'lib', 'linear-status.mjs'),
            m[1],
            `QA runner: ran an upsource-review cycle on PR #${pr} (${info.url}).`,
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

const main = () => {
  const argv = process.argv.slice(2)
  const pr = Number(argv.find((a) => /^\d+$/.test(a)))
  if (!pr)
    die(
      'usage: run.mjs <PR#> [--push]   (default = dry-run; --push arms the live path)'
    )
  try {
    run(pr, argv.includes('--push'))
  } catch (e) {
    process.stderr.write(`${e.message}\n`)
    process.exit(e.exitCode || 1)
  }
}

main()
