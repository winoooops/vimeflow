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
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const LOCK_DIR = join(SCRIPT_DIR, '.locks')
const KIMI_TIMEOUT_MS = 25 * 60 * 1000

const out = (s = '') => process.stdout.write(`${s}\n`)
const die = (s, code = 1) => {
  process.stderr.write(`${s}\n`)
  process.exit(code)
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
    .sort()
  if (!versions.length)
    die('lifeline upsource-review skill not found in the plugin cache.')
  return join(root, versions[versions.length - 1], 'skills')
}

// Optional bot identity (scripts/qa-runner/bot.env). Absent/placeholder ⇒ act as your own gh.
const loadBotEnv = () => {
  const f = join(SCRIPT_DIR, 'bot.env')
  if (!existsSync(f)) return null
  const env = {}
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(
      /^\s*(?:export\s+)?(GH_BOT_TOKEN|GH_BOT_USER|GH_BOT_EMAIL)\s*=\s*(.+?)\s*$/
    )
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  if (!env.GH_BOT_TOKEN || env.GH_BOT_TOKEN.includes('xxxx')) return null
  return env
}

// Env injected into the kimi subprocess so its gh/git act as the bot.
const botProcessEnv = (bot) =>
  bot
    ? {
        GH_TOKEN: bot.GH_BOT_TOKEN,
        GIT_AUTHOR_NAME: bot.GH_BOT_USER,
        GIT_AUTHOR_EMAIL: bot.GH_BOT_EMAIL,
        GIT_COMMITTER_NAME: bot.GH_BOT_USER,
        GIT_COMMITTER_EMAIL: bot.GH_BOT_EMAIL,
      }
    : {}

const mainRoot = () =>
  dirname(
    sh('git', [
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
    ]).trim()
  )

const ensureWorktree = (pr, branch, live, skillsDir, bot, repo) => {
  const wt = join(mainRoot(), '.claude', 'worktrees', `qa-pr-${pr}`)
  if (!existsSync(wt)) {
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
  }
  // The skill's helper scripts bootstrap from `skills/upsource-review` (repo-relative).
  mkdirSync(join(wt, 'skills'), { recursive: true })
  const link = join(wt, 'skills', 'upsource-review')
  rmSync(link, { recursive: true, force: true })
  symlinkSync(join(skillsDir, 'upsource-review'), link)
  // Live + bot: push as the bot over HTTPS (your git is SSH). The gh credential helper
  // reads GH_TOKEN at push time, so the bot token is never written to git config.
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
  const base = `/skill:upsource-review ${pr}`
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
  if (existsSync(lock))
    die(`PR #${pr} locked (run in flight). rm ${lock} to override.`, 3)
  writeFileSync(lock, `pid ${process.pid}\n`)
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
    const bot = loadBotEnv()
    const repo = JSON.parse(
      sh('gh', ['repo', 'view', '--json', 'nameWithOwner'])
    ).nameWithOwner
    const skillsDir = lifelineSkillsDir()
    const wt = ensureWorktree(pr, branch, live, skillsDir, bot, repo)
    out(
      `${live ? 'LIVE' : 'DRY-RUN'}: kimi → /skill:upsource-review ${pr}  ` +
        `(branch ${branch}, as ${bot ? bot.GH_BOT_USER : 'you'}, worktree ${wt})`
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
        env: { ...process.env, ...botProcessEnv(bot) },
      }
    )
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
  run(pr, argv.includes('--push'))
}

main()
