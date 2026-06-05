#!/usr/bin/env node
// Worker-side one-cycle entrypoint. It runs the same watch.js tick contract as
// the local daemon, but from the burst worker checkout and with role credentials
// already present on that worker.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { shouldRefreshRunner } from './lib/cloud-dispatch.js'
import { watchArgs } from './lib/worker.js'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..')
const DEFAULT_WORKER_ENV_FILE = '/etc/vimeflow/qa-runner/worker.env'

const boolEnv = (value) =>
  ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase())

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

export const workerConfigFromEnv = (env = process.env) => ({
  label: env.QA_LABEL || 'auto-review',
  approve: boolEnv(env.QA_APPROVE),
  linearDecisionComments: boolEnv(env.QA_LINEAR_DECISION_COMMENTS),
  linearCreateIssues: boolEnv(env.QA_LINEAR_CREATE_ISSUES),
  linearTeamKey: env.QA_LINEAR_TEAM_KEY || 'VIM',
  maxCiReruns: env.QA_MAX_CI_RERUNS || '',
  reason: env.QA_REASON || 'worker',
})

export const workerWatchArgs = (env = process.env) => {
  if (!env.QA_PR) {
    throw new Error('QA_PR is required')
  }

  const config = workerConfigFromEnv(env)

  return watchArgs(env.QA_PR, {
    ...config,
    maxCiReruns: config.maxCiReruns || undefined,
  })
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
  refreshRunner(process.env, repoRoot)

  const result = run('node', workerWatchArgs(process.env), {
    cwd: repoRoot,
    env: process.env,
  })
  process.exitCode = result.status ?? 1
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
