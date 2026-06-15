#!/usr/bin/env node
// Worker-side fixer entrypoint. The control daemon owns classification,
// adjudication, and GOOD_SHAPE merge. Burst workers only run the expensive
// review-fixing pass from the worker checkout with fixer credentials already
// present on that worker.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { shouldRefreshRunner } from './lib/cloud-dispatch.js'
import {
  cleanupQaWorktrees,
  worktreeDiskUsage,
} from './lib/worktree-cleanup.js'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..')
const DEFAULT_WORKER_ENV_FILE = '/etc/vimeflow/qa-runner/worker.env'
const DEFAULT_MIN_FREE_PERCENT = 15

const stripMatchingOuterQuotes = (value) => {
  const trimmed = value.trim()
  const quote = trimmed[0]

  if (
    (quote === '"' || quote === "'") &&
    trimmed[trimmed.length - 1] === quote
  ) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

const shouldWarnEnvFileError = (error) =>
  ['EACCES', 'EPERM', 'EISDIR'].includes(error?.code)

const parseEnvLine = (line) => {
  const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (!match) {
    return null
  }

  return [match[1], stripMatchingOuterQuotes(match[2])]
}

export const loadWorkerEnvFile = (
  path = process.env.QA_WORKER_ENV_FILE || DEFAULT_WORKER_ENV_FILE,
  env = process.env,
  readFile = readFileSync,
  warn = (message) => process.stderr.write(message)
) => {
  if (!path) {
    return []
  }

  let content
  try {
    content = readFile(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return []
    }

    if (shouldWarnEnvFileError(error)) {
      warn(`warning: cannot read worker env file ${path}: ${error.code}\n`)

      return []
    }

    throw error
  }

  const loaded = []
  for (const line of content.split('\n')) {
    const parsed = parseEnvLine(line)
    if (!parsed) {
      continue
    }
    const [key, value] = parsed
    if (env[key] == null) {
      env[key] = value
      loaded.push(key)
    }
  }

  return loaded
}

export const warnMissingWorkerEnv = (
  env = process.env,
  warn = (message) => process.stderr.write(message)
) => {
  if (!env.CODEX_HOME && !env.CODEX_API_KEY) {
    warn(
      'warning: worker env did not provide CODEX_HOME or CODEX_API_KEY; codex exec auth may fail\n'
    )
  }
}

const boolEnv = (value) =>
  ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase())

export const workerConfigFromEnv = (env = process.env) => ({
  label: env.QA_LABEL || 'auto-review',
  approve: false,
  linearDecisionComments: boolEnv(env.QA_LINEAR_DECISION_COMMENTS),
  linearCreateIssues: boolEnv(env.QA_LINEAR_CREATE_ISSUES),
  linearTeamKey: env.QA_LINEAR_TEAM_KEY || 'VIM',
  maxCiReruns: env.QA_MAX_CI_RERUNS || '',
  reason: env.QA_REASON || 'worker',
})

export const workerRunArgs = (env = process.env) => {
  if (!env.QA_PR) {
    throw new Error('QA_PR is required')
  }

  return [join(SCRIPT_DIR, 'run.js'), env.QA_PR, '--push']
}

const run = (command, args, opts = {}) =>
  spawnSync(command, args, {
    stdio: 'inherit',
    ...opts,
  })

const abortOnFailure = (label, result) => {
  if (result.status === 0) {
    return
  }
  const status = result.status ?? 1
  throw new Error(
    `${label} failed with exit ${status}${result.error ? ': ' + result.error.message : ''}`
  )
}

const gb = (kb) => Math.round((kb / 1024 / 1024) * 10) / 10

export const workerMinFreePercent = (env = process.env) => {
  const raw = env.QA_WORKER_MIN_FREE_PERCENT
  if (raw == null || raw === '') {
    return DEFAULT_MIN_FREE_PERCENT
  }

  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0 || value >= 100) {
    throw new Error('QA_WORKER_MIN_FREE_PERCENT must be between 0 and 99')
  }

  return value
}

export const workerDiskStatus = (
  repoRoot,
  { env = process.env, diskUsage = worktreeDiskUsage } = {}
) => {
  const minFreePercent = workerMinFreePercent(env)
  const disk = diskUsage(repoRoot)
  if (!disk) {
    return { ok: true, disk: null, minFreePercent }
  }

  return {
    ok: disk.freePercent >= minFreePercent,
    disk,
    minFreePercent,
  }
}

export const workerDiskLowMessage = ({ disk, minFreePercent }) =>
  [
    'QA_WORKER_DISK_LOW',
    `free=${disk.freePercent}%`,
    `used=${disk.capacityPercent}%`,
    `available=${gb(disk.availableKb)}GiB`,
    `total=${gb(disk.totalKb)}GiB`,
    `minFree=${minFreePercent}%`,
    `path=${disk.path}`,
    `mount=${disk.mount || 'unknown'}`,
    'cleanup did not free enough space or the volume is too small',
  ].join(' ')

export const assertWorkerDiskRoom = (repoRoot, opts = {}) => {
  const status = workerDiskStatus(repoRoot, opts)
  if (!status.ok) {
    throw new Error(workerDiskLowMessage(status))
  }

  return status
}

const cleanupWorkerWorktrees = (repoRoot) => {
  try {
    cleanupQaWorktrees({
      repoRoot,
      log: (message) => process.stdout.write(`${message}\n`),
    })
  } catch (error) {
    process.stderr.write(
      `warning: worker worktree cleanup failed: ${error.message}\n`
    )
  }
}

const ensureCleanTrackedTree = (repoRoot) => {
  const status = spawnSync(
    'git',
    ['-C', repoRoot, 'status', '--porcelain', '--untracked-files=no'],
    { encoding: 'utf8' }
  )
  abortOnFailure('git status', status)
  if (status.stdout.trim()) {
    throw new Error(
      'worker runner checkout has tracked changes; refusing refresh'
    )
  }
}

const refreshRunner = (env, repoRoot) => {
  if (!shouldRefreshRunner(env)) {
    return
  }
  const ref = env.QA_WORKER_REF || env.QA_RUNNER_REF
  if (!ref) {
    throw new Error('QA_WORKER_REF is required when QA_WORKER_REFRESH_RUNNER=1')
  }

  ensureCleanTrackedTree(repoRoot)
  abortOnFailure(
    'git fetch runner ref',
    run('git', ['-C', repoRoot, 'fetch', 'origin', ref, '-q'])
  )

  abortOnFailure(
    'git checkout runner ref',
    run('git', ['-C', repoRoot, 'checkout', '--detach', 'FETCH_HEAD'])
  )
}

export const main = () => {
  loadWorkerEnvFile()
  warnMissingWorkerEnv()
  const repoRoot = process.env.QA_WORKER_REPO || REPO_ROOT
  cleanupWorkerWorktrees(repoRoot)
  assertWorkerDiskRoom(repoRoot)
  let exitCode = 1
  try {
    refreshRunner(process.env, repoRoot)
    assertWorkerDiskRoom(repoRoot)

    const result = run('node', workerRunArgs(process.env), {
      cwd: repoRoot,
      env: process.env,
    })
    exitCode = result.status ?? 1
  } finally {
    cleanupWorkerWorktrees(repoRoot)
    const diskStatus = workerDiskStatus(repoRoot)
    if (!diskStatus.ok) {
      process.stderr.write(`${workerDiskLowMessage(diskStatus)}\n`)
      exitCode = 2
    }
  }
  process.exitCode = exitCode
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main()
  } catch (e) {
    process.stderr.write(`${e.message}\n`)
    process.exit(2)
  }
}
