#!/usr/bin/env node
// QA runner — inner runner (increment 2, skill-based).
//
// Dispatches a headless fixer engine that runs the ported lifeline
// `upsource-review` skill on a PR's worktree to drive its review findings to
// zero. DRY-RUN by default (the fixer stops before commit/push; the PR is never
// touched). `--push` arms the live path (the fixer commits/pushes; status posts
// to the linked Linear issue).
//
// Identity: if scripts/qa-runner/bot.env is present + filled, the runner acts as
// that bot account (GH_TOKEN + bot git-author + HTTPS-push via the gh credential
// helper); otherwise it acts as your own gh. See README.md.
//
// Kimi loads the skill via `--skills-dir` and is invoked with
// `/skill:upsource-review <PR#>`. Codex reads the same skill from the worktree
// and executes it directly. In both cases, the skill's helper scripts resolve
// their dir via a `skills/upsource-review` symlink we create in the worktree.

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  chmodSync,
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
import { fileURLToPath, pathToFileURL } from 'node:url'
import { botEnv, botLabel, loadBot } from './lib/bot-identity.js'
import { REVIEW_CHECKS, classifyChecks } from './lib/ci-policy.js'
import {
  decisionStorePath,
  fixCycleThreadParentId,
  formatFixerCycleComment,
  readDecisionStore,
} from './lib/decision-comment.js'
import { RUN_SELF_REVIEW_EXIT } from './lib/dispatch-blocker.js'
import { worktreePlan } from './lib/fixer-worktree.js'
import { linkedVimForPr } from './lib/pr-utils.js'
import { runUntilChange } from './lib/run-until-change.js'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const LOCK_DIR = join(SCRIPT_DIR, '.locks')
const FIXER_TIMEOUT_MS = 45 * 60 * 1000
const DEFAULT_FIXER_ENGINE = 'kimi'
const FIXER_ENGINES = new Set(['kimi', 'codex'])
const KIMI_DEFAULT_MODEL = 'kimi-code/kimi-for-coding'
const KIMI_DEFAULT_OUTPUT_FORMAT = 'stream-json'
export const DEFAULT_LOCAL_CI_COMMAND = [
  'npm run lint',
  'npm run format:check',
  'npm run type-check',
  'npm test',
  'cargo test',
  "find src/bindings -name '*.ts' ! -name 'index.ts' -delete",
  'npm run generate:bindings',
  'git diff --exit-code src/bindings/',
  'test -z "$(git ls-files --others --exclude-standard src/bindings/)"',
].join(' && ')

const out = (s = '') => process.stdout.write(`${s}\n`)

const linearParentCommentId = () =>
  process.env.QA_LINEAR_PARENT_COMMENT_ID?.trim() || null

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

const ghJsonAllowFailure = (args, opts = {}) => {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...opts,
  })
  if (!result.stdout) {
    throw new Error(
      `gh ${args.join(' ')} failed: ${(result.stderr || '').trim() || result.error?.message || `exit ${result.status}`}`
    )
  }

  return JSON.parse(result.stdout)
}

// Latest lifeline version in the plugin cache that ships the skill.
const lifelineSkillsDir = () => {
  if (process.env.QA_LIFELINE_SKILLS_DIR) {
    return process.env.QA_LIFELINE_SKILLS_DIR
  }

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

const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`

export const gitCredentialHelperCommand = ({
  botEnvPath = join(SCRIPT_DIR, 'bot.env'),
  helperPath = join(SCRIPT_DIR, 'lib', 'git-credential-helper.js'),
  prefix = 'GH_BOT',
} = {}) =>
  `!node ${shellQuote(helperPath)} ${shellQuote(botEnvPath)} ${shellQuote(prefix)}`

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

const ensureWorktree = (
  pr,
  branch,
  live,
  skillsDir,
  bot,
  repo,
  repoRoot = mainRoot()
) => {
  // No self-review: refuse only when the branch is held by a DIFFERENT worktree (a
  // dev checkout). Our own qa-pr-N from a prior round is fine — reset + reuse it.
  const heldPath = worktreeForBranch(branch)

  const plan = worktreePlan({
    repoRoot,
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
  // Live + bot: push as the bot over HTTPS via a file-backed credential helper.
  // Codex intentionally strips secret env vars from shell commands, so relying on
  // GH_TOKEN inheritance would make `git push` hang or fail inside Codex.
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
      gitCredentialHelperCommand(),
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
    'If this context describes review adjudication findings, use each finding.fix_direction as the preferred implementation direction. If it describes deterministic CI failures, inspect the linked GitHub check logs and fix those failures even when there are no unresolved review threads.'
  )
}

const parseFixContext = (env = process.env) => {
  if (!env.QA_FIX_CONTEXT) {
    return null
  }
  try {
    return JSON.parse(env.QA_FIX_CONTEXT)
  } catch {
    return null
  }
}

export const staleDeterministicCiPreflight = (fixContext, checks) => {
  if (fixContext?.kind !== 'deterministic_ci_failure') {
    return { stale: false }
  }

  const current = classifyChecks(checks, { reviewChecks: REVIEW_CHECKS })
  if (current.deterministicFailures.length) {
    return { stale: false }
  }

  return {
    stale: true,
    detail:
      current.ci === 'pending'
        ? 'current CI is pending; skip stale deterministic-CI fixer dispatch'
        : 'current CI has no deterministic failures; skip stale deterministic-CI fixer dispatch',
  }
}

const shouldRunFixerAfterCiPreflight = (pr, ghEnv) => {
  const fixContext = parseFixContext()
  if (fixContext?.kind !== 'deterministic_ci_failure') {
    return true
  }

  let checks
  try {
    checks = ghJsonAllowFailure(
      [
        'pr',
        'checks',
        String(pr),
        '--json',
        'name,bucket,link,workflow',
      ],
      ghEnv
    )
  } catch (error) {
    out(`QA_RUNNER_CI_PREFLIGHT_SKIP ${error.message}`)

    return false
  }

  const preflight = staleDeterministicCiPreflight(fixContext, checks)
  if (!preflight.stale) {
    return true
  }

  out(`QA_RUNNER_STALE_CI_SKIP ${preflight.detail}`)

  return false
}

export const normalizeFixerEngine = (env = process.env) => {
  const engine = String(env.QA_FIXER_ENGINE || DEFAULT_FIXER_ENGINE)
    .trim()
    .toLowerCase()
  if (!FIXER_ENGINES.has(engine)) {
    throw new Error(
      `unsupported QA_FIXER_ENGINE '${env.QA_FIXER_ENGINE}' (expected kimi or codex)`
    )
  }

  return engine
}

export const fixerEngineLabel = (engine) =>
  engine === 'codex' ? 'Codex' : 'Kimi'

export const fixerTimeoutMs = (env = process.env) => {
  const raw = env.QA_FIXER_TIMEOUT_MS
  if (raw == null || raw === '') {
    return FIXER_TIMEOUT_MS
  }

  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('QA_FIXER_TIMEOUT_MS must be a positive number of ms')
  }

  return value
}

const liveSinglePassText =
  'SINGLE PASS — fix only the CURRENT round of review findings: apply the fixes, ' +
  'run the codex verify gate, commit, push, then reply to and resolve the threads ' +
  'you addressed, and STOP. Do NOT poll or wait for a re-review, and do NOT begin ' +
  'another fix round — exit cleanly as soon as this round is pushed. The orchestrator ' +
  're-dispatches you when fresh review feedback arrives. The worker enforces local CI ' +
  'before every git push; if push fails because local CI failed, fix the reported failure, ' +
  'commit it, and retry the push.'

const dryRunText =
  'MODE: DRY RUN — run the cycle through the codex verify gate ONLY, then STOP. ' +
  'Do NOT commit, push, reply, or resolve anything; do NOT modify the PR or any thread. ' +
  'Leave changes in the working tree and output: the findings, the fix per finding ' +
  '(or skip + one-line rationale), the codex verdict, and the staged diff. This is a ' +
  'capability test — inspected before anything goes live.'

export const kimiInvocation = (pr, live) => {
  const base =
    `/skill:upsource-review ${pr}\n\n` +
    `Run the lifeline upsource-review skill now on pull request #${pr} of this repository. ` +
    `"${pr}" is the PR number — not a line number or a count. Resolve PR #${pr}, fetch its ` +
    `review findings, and fix every one. Do not ask for clarification; the target is PR #${pr}.` +
    fixContextText()
  if (live) {
    // SINGLE PASS: the orchestrator owns re-dispatch — fix one round and exit, never poll.
    return `${base}\n\n${liveSinglePassText}`
  }

  return `${base}\n\n${dryRunText}`
}

export const codexInvocation = (pr, live) => {
  const base =
    `You are running in the PR worktree for pull request #${pr}. ` +
    `Read and follow skills/upsource-review/SKILL.md as the operating spec for this review-fix cycle. ` +
    `Do not use slash-command syntax; execute the skill steps directly with git, gh, npm, and shell commands as needed. ` +
    `Assume USER_SUPPLIED_PR_NUMBER=${pr}. Resolve PR #${pr}, fetch its review findings, and fix every one. ` +
    `Do not ask for clarification; the target is PR #${pr}.` +
    fixContextText()

  return `${base}\n\n${live ? liveSinglePassText : dryRunText}`
}

export const fixerInvocation = (pr, live, engine) =>
  engine === 'codex' ? codexInvocation(pr, live) : kimiInvocation(pr, live)

export const kimiModelArgs = (env = process.env) => {
  if (env.KIMI_MODEL) {
    return ['-m', env.KIMI_MODEL]
  }

  if (env.KIMI_MODEL_NAME) {
    return []
  }

  return ['-m', KIMI_DEFAULT_MODEL]
}

export const codexExecArgs = ({ wt, repoRoot, env = process.env } = {}) => {
  const args = ['exec', '--sandbox', env.QA_CODEX_SANDBOX || 'workspace-write']

  if (wt) {
    args.push('--cd', wt)
  }
  if (repoRoot && repoRoot !== wt) {
    args.push('--add-dir', repoRoot)
  }
  if (env.QA_CODEX_MODEL) {
    args.push('--model', env.QA_CODEX_MODEL)
  }

  args.push('-')

  return args
}

export const localCiCommand = (env = process.env) =>
  env.QA_LOCAL_CI_COMMAND || DEFAULT_LOCAL_CI_COMMAND

const realGitPath = (env = process.env) => {
  if (env.QA_REAL_GIT) {
    return env.QA_REAL_GIT
  }
  const result = spawnSync('sh', ['-lc', 'command -v git'], {
    encoding: 'utf8',
    env,
  })
  const path = result.stdout?.trim()
  if (!path) {
    throw new Error('git not found on PATH')
  }

  return path
}

export const gitPushCiWrapperScript = ({ realGit, ciCommand }) => `#!/usr/bin/env bash
set -euo pipefail

real_git=${shellQuote(realGit)}
ci_cmd=${shellQuote(ciCommand)}
is_push=0
for arg in "$@"; do
  if [ "$arg" = "push" ]; then
    is_push=1
    break
  fi
done

if [ "$is_push" = "1" ]; then
  echo "QA_RUNNER_LOCAL_CI_START $ci_cmd" >&2
  bash -lc "$ci_cmd"
  echo "QA_RUNNER_LOCAL_CI_OK" >&2
fi

exec "$real_git" "$@"
`

const installGitPushCiWrapper = (wt, env = process.env) => {
  const wrapperDir = join(wt, '.qa-runner', 'bin')
  mkdirSync(wrapperDir, { recursive: true })
  const wrapper = join(wrapperDir, 'git')
  writeFileSync(
    wrapper,
    gitPushCiWrapperScript({
      realGit: realGitPath(env),
      ciCommand: localCiCommand(env),
    })
  )
  chmodSync(wrapper, 0o755)

  return {
    PATH: `${wrapperDir}:${env.PATH || ''}`,
  }
}

const lockOwnerIsActiveRunner = (pid) => {
  if (!(pid > 0)) {
    return false
  }

  try {
    process.kill(pid, 0)
  } catch (e) {
    return e.code === 'EPERM'
  }

  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('run.js')
  } catch {
    return true
  }
}

const reapStaleLock = (lock) => {
  let pid = 0
  try {
    pid = Number((readFileSync(lock, 'utf8').match(/pid (\d+)/) || [])[1])
  } catch {
    return true
  }
  if (lockOwnerIsActiveRunner(pid)) {
    return false
  }
  rmSync(lock, { force: true })

  return true
}

const acquireLock = (lock, pr) => {
  try {
    writeFileSync(lock, `pid ${process.pid}\n`, { flag: 'wx' })

    return
  } catch (e) {
    if (e.code === 'EEXIST' && reapStaleLock(lock)) {
      writeFileSync(lock, `pid ${process.pid}\n`, { flag: 'wx' })

      return
    }
    if (e.code === 'EEXIST') {
      die(`PR #${pr} locked (run in flight). rm ${lock} to override.`, 3)
    }
    throw e
  }
}

const run = async (pr, live) => {
  mkdirSync(LOCK_DIR, { recursive: true })
  const lock = join(LOCK_DIR, `pr-${pr}.lock`)
  acquireLock(lock, pr)
  try {
    const engine = normalizeFixerEngine()
    const engineName = fixerEngineLabel(engine)
    const timeoutMs = fixerTimeoutMs()
    const bot = loadBot(SCRIPT_DIR, 'bot.env', 'GH_BOT')
    const ghEnv = bot ? { env: { ...process.env, ...botEnv(bot) } } : {}

    const info = JSON.parse(
      sh(
        'gh',
        [
          'pr',
          'view',
          String(pr),
          '--json',
          'number,headRefName,url,body,state,isCrossRepository',
        ],
        ghEnv
      )
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

    if (live && !shouldRunFixerAfterCiPreflight(pr, ghEnv)) {
      return
    }

    const repo = JSON.parse(
      sh('gh', ['repo', 'view', '--json', 'nameWithOwner'], ghEnv)
    ).nameWithOwner
    const skillsDir = lifelineSkillsDir()
    const repoRoot = mainRoot()
    const wt = ensureWorktree(pr, branch, live, skillsDir, bot, repo, repoRoot)
    // HEAD before the run (== origin/<branch>) — the baseline the post-run live
    // checks compare against to tell "advanced the remote" from "did nothing".
    const startHead = sh('git', ['-C', wt, 'rev-parse', 'HEAD']).trim()

    const target =
      engine === 'codex'
        ? `codex exec skills/upsource-review ${pr}`
        : `/skill:upsource-review ${pr}`
    out(
      `${live ? 'LIVE' : 'DRY-RUN'}: ${engine} → ${target}  ` +
        `(branch ${branch}, as ${botLabel(bot)}, worktree ${wt})`
    )

    // Single-pass guard: stop the fixer once the push lands (probe = origin/<branch>)
    // so the skill can't POLL_NEXT. Local HEAD changes too early: stopping at
    // commit time can kill the child before Step 6.7 pushes the fix.
    const remoteRef = `origin/${branch}`
    const gitPushCiEnv = live ? installGitPushCiWrapper(wt) : {}

    const childEnv = {
      ...process.env,
      ...botEnv(bot),
      ...gitPushCiEnv,
      USER_SUPPLIED_PR_NUMBER: String(pr),
      QA_FIXER_ENGINE: engine,
    }

    const r = await runUntilChange(
      () => {
        if (engine === 'codex') {
          const child = spawn(
            'codex',
            codexExecArgs({ wt, repoRoot, env: process.env }),
            {
              cwd: wt,
              stdio: ['pipe', 'inherit', 'inherit'],
              env: childEnv,
            }
          )
          child.stdin?.on('error', () => {
            // The child error/exit path below reports the real fixer failure.
          })
          child.stdin?.end(fixerInvocation(pr, live, engine))

          return child
        }

        return spawn(
          'kimi',
          [
            '--skills-dir',
            skillsDir,
            ...kimiModelArgs(process.env),
            '-p',
            fixerInvocation(pr, live, engine),
            '--output-format',
            process.env.KIMI_OUTPUT_FORMAT || KIMI_DEFAULT_OUTPUT_FORMAT,
          ],
          {
            cwd: wt,
            stdio: 'inherit',
            env: childEnv,
          }
        )
      },
      () => {
        try {
          return sh('git', ['-C', wt, 'rev-parse', remoteRef]).trim()
        } catch {
          return null
        }
      },
      { timeoutMs, log: out }
    )
    if (r.error) {
      die(`${engine} spawn failed: ${r.error.message}`)
    }
    if (r.timedOut) {
      const head = sh('git', ['-C', wt, 'rev-parse', 'HEAD']).trim()
      if (head === startHead) {
        die(`${engine} timed out with no commit (${timeoutMs / 60000}m)`, 6)
      }
      // commit landed in the final poll window — fall through to push verification
    }
    // A non-zero exit or unexpected signal (anything but our intentional single-pass
    // stop) is a real fixer failure — exit non-zero so the daemon's failure
    // accounting sees it instead of recording a clean waiting cycle.
    if (!r.killed && r.status !== 0) {
      die(`${engine} failed (${r.status ?? `signal ${r.signal}`})`, 7)
    }
    // Live invariant: exit 0 ONLY when the run advanced origin/<branch>, so the daemon
    // can read a clean exit as real progress. Two ways it can fail to:
    //   1. No commit at all — the fixer was dispatched for findings but addressed
    //      none (HEAD never left startHead). Looks identical to a WAITING tick to the
    //      daemon, so without this it would reset the failure streak and poll forever.
    //   2. Committed but the push never landed (bad credentials, non-fast-forward,
    //      killed mid-push, or the skill skipped push) — origin/<branch> stays behind,
    //      so the daemon sees an unchanged remote.
    let pushedHead = null
    if (live) {
      const head = sh('git', ['-C', wt, 'rev-parse', 'HEAD']).trim()
      if (head === startHead) {
        die(`${engine} produced no commit — findings left unaddressed`, 9)
      }
      let remote = null
      try {
        remote = sh('git', ['-C', wt, 'rev-parse', remoteRef]).trim()
      } catch {
        /* remote-tracking ref missing — treated as not-pushed below */
      }
      if (remote !== head) {
        die(
          `${engine} committed but the push did not land (local ${head.slice(0, 7)} ≠ ${remoteRef} ${remote ? remote.slice(0, 7) : 'unknown'})`,
          8
        )
      }
      pushedHead = head
    }
    out('')
    out(
      `${engine} exit: ${r.status ?? `signal ${r.signal}`}${r.killed ? ' (single-pass stop)' : ''}`
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
        const fixerExit =
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
          fixerEngine: engineName,
          fixerExit,
          stopMode,
          worktreeClean: !worktreeStatus,
        })

        const parentId =
          linearParentCommentId() ||
          fixCycleThreadParentId(readDecisionStore(decisionStorePath(pr)), pr, {
            headSha: startHead,
          })

        const args = [
          join(SCRIPT_DIR, 'lib', 'linear-status.js'),
          vim,
          body,
          '--as',
          'fixer',
        ]
        if (parentId) {
          args.push('--parent', parentId)
        }

        spawnSync('node', args, { stdio: 'inherit' })
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

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main()
}
