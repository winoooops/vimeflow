import { spawn } from 'node:child_process'
import { once } from 'node:events'
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const LIB_DIR = dirname(fileURLToPath(import.meta.url))
const STATE_DIR = join(dirname(LIB_DIR), '.state')
const DEFAULT_WORKER_LEASE_DIR = join(STATE_DIR, 'worker-leases')
const DEFAULT_FLEET_CAPACITY_PER_INSTANCE = 2
const DEFAULT_WORKER_TIMEOUT_SECONDS = 7200

export const CYCLE_ENV_KEYS = [
  'QA_PR',
  'QA_REASON',
  'QA_LABEL',
  'QA_LINEAR_DECISION_COMMENTS',
  'QA_LINEAR_CREATE_ISSUES',
  'QA_LINEAR_TEAM_KEY',
  'QA_MAX_CI_RERUNS',
  'QA_FIX_CONTEXT',
  'QA_LINEAR_PARENT_COMMENT_ID',
  'QA_FIXER_ENGINE',
  'QA_CODEX_MODEL',
  'QA_CODEX_SANDBOX',
  'QA_FIXER_TIMEOUT_MS',
  'QA_WORKER_KEEP_ALIVE',
  'QA_WORKER_REFRESH_RUNNER',
  'QA_WORKER_REF',
  'QA_WORKER_MIN_FREE_PERCENT',
  // Legacy alias consumed by worker-cycle; pass-through only, not SSM-sourced.
  'QA_RUNNER_REF',
]

const boolEnv = (value) =>
  ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase())

const compact = (values) =>
  values.filter((value) => value != null && value !== '')

const positiveInt = (value, fallback, label) => {
  const raw = value == null || value === '' ? fallback : value
  const number = Number(raw)
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${label} must be a positive integer`)
  }

  return number
}

export const cycleEnv = (env = process.env) => {
  const values = {}
  for (const key of CYCLE_ENV_KEYS) {
    if (env[key] != null) {
      values[key] = String(env[key])
    }
  }

  return values
}

export const shellQuote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`

export const workerCycleScript = (repo) =>
  `${repo.replace(/\/$/, '')}/scripts/qa-runner/worker-cycle.js`

export const remoteEnvAssignments = (env) =>
  Object.entries(env)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(' ')

export const remoteCycleCommand = ({ repo, env }) =>
  compact([
    'env',
    remoteEnvAssignments(env),
    'node',
    shellQuote(workerCycleScript(repo)),
  ]).join(' ')

const pipe = (stream, target) => {
  if (!stream) {
    return
  }
  stream.on('data', (chunk) => target.write(chunk))
}

export const runSpawn = async (
  command,
  args,
  {
    cwd,
    env = process.env,
    stdout = process.stdout,
    stderr = process.stderr,
  } = {}
) => {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  pipe(child.stdout, stdout)
  pipe(child.stderr, stderr)

  try {
    const [code, signal] = await once(child, 'close')

    return { code: code ?? -1, signal: signal ?? null }
  } catch (error) {
    if (stderr && error?.message) {
      stderr.write(`${error.message}\n`)
    }

    return {
      code: -1,
      signal: null,
      error,
    }
  }
}

const runCapture = async (
  command,
  args,
  { env = process.env, spawnImpl = spawn } = {}
) => {
  const child = spawnImpl(command, args, {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString()
  })

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  try {
    const [code, signal] = await once(child, 'close')

    return { code: code ?? -1, signal: signal ?? null, stdout, stderr }
  } catch (error) {
    return {
      code: -1,
      signal: null,
      stdout,
      stderr: stderr || error.message,
      error,
    }
  }
}

export const localDispatchPlan = ({ repo, env }) => ({
  command: 'node',
  args: [workerCycleScript(repo)],
  env: { ...process.env, ...env },
  cwd: repo,
})

export const sshDispatchPlan = ({ host, user, repo, env, sshOptions = [] }) => {
  if (!host) {
    throw new Error('QA_WORKER_HOST is required for QA_WORKER_MODE=ssh')
  }

  return {
    command: 'ssh',
    args: [
      ...sshOptions,
      user ? `${user}@${host}` : host,
      remoteCycleCommand({ repo, env }),
    ],
  }
}

export const ssmSendCommandArgs = ({
  instanceId,
  region,
  repo,
  env,
  timeoutSeconds,
}) => {
  if (!instanceId) {
    throw new Error(
      'QA_WORKER_INSTANCE_ID or QA_WORKER_INSTANCE_IDS is required for QA_WORKER_MODE=ssm'
    )
  }
  if (!region) {
    throw new Error(
      'QA_WORKER_REGION or AWS_REGION is required for QA_WORKER_MODE=ssm'
    )
  }

  return compact([
    'ssm',
    'send-command',
    '--region',
    region,
    '--document-name',
    'AWS-RunShellScript',
    '--instance-ids',
    instanceId,
    '--comment',
    `vimeflow qa runner PR ${env.QA_PR || 'unknown'}`,
    '--parameters',
    JSON.stringify({
      commands: [remoteCycleCommand({ repo, env })],
      executionTimeout: [
        String(timeoutSeconds || DEFAULT_WORKER_TIMEOUT_SECONDS),
      ],
    }),
    '--output',
    'json',
  ])
}

const parseCommandId = (stdout) => {
  const parsed = JSON.parse(stdout || '{}')
  const commandId = parsed.Command?.CommandId
  if (!commandId) {
    throw new Error('SSM send-command returned no CommandId')
  }

  return commandId
}

const parseJson = (stdout, label) => {
  try {
    return JSON.parse(stdout || '{}')
  } catch {
    throw new Error(`${label} returned invalid JSON`)
  }
}

const awsCapture = async (args, { env, spawnImpl }) =>
  runCapture('aws', args, { env, spawnImpl })

const instanceStateFromDescribe = (stdout) => {
  const parsed = parseJson(stdout, 'ec2 describe-instances')

  return parsed.Reservations?.[0]?.Instances?.[0]?.State?.Name || 'unknown'
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export const parseWorkerInstanceIds = (env = process.env) => {
  const raw =
    env.QA_WORKER_INSTANCE_IDS != null
      ? env.QA_WORKER_INSTANCE_IDS
      : env.QA_WORKER_INSTANCE_ID || ''
  const seen = new Set()

  return String(raw)
    .split(/[,\s]+/)
    .map((id) => id.trim())
    .filter(Boolean)
    .filter((id) => {
      if (seen.has(id)) {
        return false
      }
      seen.add(id)

      return true
    })
}

const leaseInstanceSlug = (instanceId) =>
  String(instanceId).replace(/[^A-Za-z0-9_.-]/g, '_')

export const workerLeasePath = ({ leaseDir, instanceId, slot }) =>
  join(leaseDir, `${leaseInstanceSlug(instanceId)}.${slot}.lock`)

const leasePayload = ({ instanceId, slot, pr }) => ({
  instanceId,
  slot,
  pr: pr || null,
  pid: process.pid,
  createdAt: new Date().toISOString(),
})

const readLease = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

const processIsAlive = (pid) => {
  const number = Number(pid)
  if (!Number.isInteger(number) || number < 1) {
    return false
  }

  try {
    process.kill(number, 0)

    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

const leaseIsStale = (lease, staleMs, now = Date.now()) => {
  if (!lease || !processIsAlive(lease.pid)) {
    return true
  }

  const created = Date.parse(lease.createdAt || '')
  if (!Number.isFinite(created)) {
    return true
  }

  return staleMs > 0 && now - created > staleMs
}

const removeStaleLease = (path, staleMs) => {
  const lease = readLease(path)
  if (!leaseIsStale(lease, staleMs)) {
    return false
  }

  rmSync(path, { force: true })

  return true
}

const tryAcquireWorkerLease = ({ leaseDir, instanceId, slot, staleMs, pr }) => {
  const path = workerLeasePath({ leaseDir, instanceId, slot })

  try {
    const fd = openSync(path, 'wx', 0o600)
    try {
      writeFileSync(
        fd,
        `${JSON.stringify(leasePayload({ instanceId, slot, pr }))}\n`
      )
    } finally {
      closeSync(fd)
    }

    return {
      instanceId,
      slot,
      path,
      release: () => rmSync(path, { force: true }),
    }
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      throw error
    }
  }

  if (removeStaleLease(path, staleMs)) {
    return tryAcquireWorkerLease({ leaseDir, instanceId, slot, staleMs, pr })
  }

  return null
}

export const activeWorkerLeaseCount = ({
  leaseDir = DEFAULT_WORKER_LEASE_DIR,
  instanceId,
  capacityPerInstance = DEFAULT_FLEET_CAPACITY_PER_INSTANCE,
  staleSeconds = 0,
}) => {
  const staleMs = Math.max(0, Number(staleSeconds || 0)) * 1000
  let count = 0
  for (let slot = 0; slot < capacityPerInstance; slot++) {
    const path = workerLeasePath({ leaseDir, instanceId, slot })
    const lease = readLease(path)
    if (!lease) {
      continue
    }
    if (leaseIsStale(lease, staleMs)) {
      rmSync(path, { force: true })
      continue
    }
    count += 1
  }

  return count
}

export const acquireWorkerLease = async ({
  instanceIds,
  capacityPerInstance = DEFAULT_FLEET_CAPACITY_PER_INSTANCE,
  leaseDir = DEFAULT_WORKER_LEASE_DIR,
  waitSeconds = DEFAULT_WORKER_TIMEOUT_SECONDS,
  pollIntervalMs = 5000,
  staleSeconds = 0,
  pr,
  stdout = process.stdout,
} = {}) => {
  const ids = compact(instanceIds || [])
  if (!ids.length) {
    throw new Error('worker fleet has no instance ids')
  }
  mkdirSync(leaseDir, { recursive: true })

  const capacity = positiveInt(
    capacityPerInstance,
    DEFAULT_FLEET_CAPACITY_PER_INSTANCE,
    'QA_WORKER_CAPACITY_PER_INSTANCE'
  )
  const staleMs = Math.max(0, Number(staleSeconds || 0)) * 1000
  const deadline = Date.now() + Math.max(0, Number(waitSeconds || 0)) * 1000
  let loggedWait = false

  while (Date.now() <= deadline) {
    for (const instanceId of ids) {
      for (let slot = 0; slot < capacity; slot++) {
        const lease = tryAcquireWorkerLease({
          leaseDir,
          instanceId,
          slot,
          staleMs,
          pr,
        })
        if (lease) {
          stdout.write(
            `worker fleet: leased ${instanceId} slot ${slot + 1}/${capacity}\n`
          )

          return lease
        }
      }
    }

    if (!loggedWait) {
      stdout.write(
        `worker fleet: waiting for capacity across ${ids.length} instance(s)\n`
      )
      loggedWait = true
    }

    await wait(pollIntervalMs)
  }

  throw new Error(
    `worker fleet had no free slot within ${Math.max(0, Number(waitSeconds || 0))}s`
  )
}

const describeInstanceState = async ({
  instanceId,
  region,
  env,
  spawnImpl,
}) => {
  const result = await awsCapture(
    [
      'ec2',
      'describe-instances',
      '--region',
      region,
      '--instance-ids',
      instanceId,
      '--output',
      'json',
    ],
    { env, spawnImpl }
  )
  if (result.code !== 0) {
    throw new Error(
      result.stderr || result.stdout || 'describe-instances failed'
    )
  }

  return instanceStateFromDescribe(result.stdout)
}

const startInstance = async ({ instanceId, region, env, spawnImpl }) => {
  const result = await awsCapture(
    [
      'ec2',
      'start-instances',
      '--region',
      region,
      '--instance-ids',
      instanceId,
      '--output',
      'json',
    ],
    { env, spawnImpl }
  )
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || 'start-instances failed')
  }
}

const stopInstance = async ({ instanceId, region, env, spawnImpl }) => {
  const result = await awsCapture(
    [
      'ec2',
      'stop-instances',
      '--region',
      region,
      '--instance-ids',
      instanceId,
      '--output',
      'json',
    ],
    { env, spawnImpl }
  )

  return result
}

export const ensureWorkerInstanceRunning = async ({
  instanceId,
  region,
  timeoutSeconds = 600,
  pollIntervalMs = 15000,
  stdout = process.stdout,
  env = process.env,
  spawnImpl = spawn,
  onStarted,
}) => {
  const deadline = Date.now() + timeoutSeconds * 1000
  let state = await describeInstanceState({
    instanceId,
    region,
    env,
    spawnImpl,
  })
  let started = false

  if (state === 'stopped') {
    stdout.write(`worker ${instanceId}: starting stopped instance\n`)
    await startInstance({ instanceId, region, env, spawnImpl })
    started = true
    onStarted?.()
    state = 'pending'
  }

  while (Date.now() < deadline) {
    if (state === 'running') {
      stdout.write(`worker ${instanceId}: EC2 running\n`)

      return { started, state }
    }

    if (
      ['terminated', 'shutting-down'].includes(state) ||
      state === 'unknown'
    ) {
      throw new Error(`worker ${instanceId} cannot be started (${state})`)
    }

    if (state === 'stopped' && !started) {
      stdout.write(`worker ${instanceId}: starting stopped instance\n`)
      await startInstance({ instanceId, region, env, spawnImpl })
      started = true
      onStarted?.()
      state = 'pending'
      await wait(pollIntervalMs)
      state = await describeInstanceState({
        instanceId,
        region,
        env,
        spawnImpl,
      })
      continue
    }

    await wait(pollIntervalMs)
    state = await describeInstanceState({ instanceId, region, env, spawnImpl })
  }

  throw new Error(
    `worker ${instanceId} did not become EC2 running within ${timeoutSeconds}s`
  )
}

export const stopSsmWorkerBestEffort = async ({
  instanceId,
  region,
  stderr = process.stderr,
  env = process.env,
  spawnImpl = spawn,
}) => {
  const result = await stopInstance({ instanceId, region, env, spawnImpl })
  if (result.code !== 0) {
    stderr.write(
      `warning: failed to stop worker ${instanceId}: ${
        result.stderr || result.stdout || 'unknown error'
      }\n`
    )
  }

  return result
}

export const stopSsmWorkersBestEffort = async ({
  instanceIds,
  region,
  stderr = process.stderr,
  env = process.env,
  spawnImpl = spawn,
}) => {
  const results = []
  for (const instanceId of compact(instanceIds || [])) {
    results.push(
      await stopSsmWorkerBestEffort({
        instanceId,
        region,
        stderr,
        env,
        spawnImpl,
      })
    )
  }

  return results
}

const printInvocation = ({ invocation, stdout, stderr }) => {
  const out = invocation.StandardOutputContent || ''
  const err = invocation.StandardErrorContent || ''
  if (out) {
    stdout.write(out)
    if (!out.endsWith('\n')) {
      stdout.write('\n')
    }
  }
  if (err) {
    stderr.write(err)
    if (!err.endsWith('\n')) {
      stderr.write('\n')
    }
  }
  if (invocation.Status !== 'Success' && !out && !err) {
    stderr.write(
      `SSM command ${invocation.CommandId || 'unknown'} ${invocation.Status} ` +
        `(response ${invocation.ResponseCode ?? 'unknown'}) produced no output\n`
    )
  }
}

const sendSsmWorkerCommand = ({
  instanceId,
  region,
  repo,
  env: commandEnv,
  timeoutSeconds,
  awsEnv,
  spawnImpl,
}) =>
  runCapture(
    'aws',
    ssmSendCommandArgs({
      instanceId,
      region,
      repo,
      env: commandEnv,
      timeoutSeconds,
    }),
    { env: awsEnv, spawnImpl }
  )

const isTransientSendCommandFailure = (text) =>
  text.includes('InvalidInstanceId') ||
  text.includes('TargetNotConnected') ||
  text.includes('not in a valid state') ||
  text.includes('not connected')

const sendSsmWorkerCommandWithRetry = async ({
  instanceId,
  region,
  repo,
  env,
  timeoutSeconds,
  readyTimeoutSeconds,
  stdout,
  awsEnv,
  spawnImpl,
  pollIntervalMs,
}) => {
  const deadline = Date.now() + readyTimeoutSeconds * 1000
  let loggedWait = false
  let result = null

  while (Date.now() < deadline) {
    result = await sendSsmWorkerCommand({
      instanceId,
      region,
      repo,
      env,
      timeoutSeconds,
      awsEnv,
      spawnImpl,
    })
    if (result.code === 0) {
      return result
    }

    const errorText = result.stderr || result.stdout || ''
    if (!isTransientSendCommandFailure(errorText)) {
      return result
    }

    if (!loggedWait) {
      stdout.write(`worker ${instanceId}: waiting for SSM command target\n`)
      loggedWait = true
    }

    await wait(pollIntervalMs)
  }

  return (
    result || {
      code: 1,
      signal: null,
      stderr: `worker ${instanceId} did not accept SSM command within ${readyTimeoutSeconds}s\n`,
    }
  )
}

export const runSsmDispatch = async ({
  instanceId,
  region,
  repo,
  env: commandEnv,
  timeoutSeconds,
  burst = false,
  stopAfterRun = false,
  keepAlive = false,
  readyTimeoutSeconds = 600,
  stdout = process.stdout,
  stderr = process.stderr,
  awsEnv = process.env,
  spawnImpl = spawn,
  pollIntervalMs = 15000,
}) => {
  let shouldStop = false

  try {
    let send
    if (burst) {
      const readinessDeadline = Date.now() + readyTimeoutSeconds * 1000
      await ensureWorkerInstanceRunning({
        instanceId,
        region,
        timeoutSeconds: readyTimeoutSeconds,
        pollIntervalMs,
        stdout,
        env: awsEnv,
        spawnImpl,
        onStarted: () => {
          shouldStop = stopAfterRun
        },
      })
      shouldStop = stopAfterRun

      const remainingReadySeconds = Math.max(
        0,
        Math.ceil((readinessDeadline - Date.now()) / 1000)
      )
      send = await sendSsmWorkerCommandWithRetry({
        instanceId,
        region,
        repo,
        env: commandEnv,
        timeoutSeconds,
        readyTimeoutSeconds: remainingReadySeconds,
        stdout,
        awsEnv,
        spawnImpl,
        pollIntervalMs,
      })
    } else {
      send = await sendSsmWorkerCommand({
        instanceId,
        region,
        repo,
        env: commandEnv,
        timeoutSeconds,
        awsEnv,
        spawnImpl,
      })
    }
    if (send.code !== 0) {
      stderr.write(send.stderr || send.stdout)

      return send
    }

    const commandId = parseCommandId(send.stdout)

    const startTime = Date.now()
    const dispatchTimeoutSeconds =
      timeoutSeconds || DEFAULT_WORKER_TIMEOUT_SECONDS
    const deadline = startTime + dispatchTimeoutSeconds * 1000

    const terminalStatuses = new Set([
      'Success',
      'Cancelled',
      'TimedOut',
      'Failed',
      'AccessDenied',
      'DeliveryTimedOut',
      'ExecutionTimedOut',
      'InvalidInstanceId',
      'InvalidParameters',
      'Undeliverable',
    ])

    let invocation = null
    while (Date.now() < deadline) {
      const get = await runCapture(
        'aws',
        [
          'ssm',
          'get-command-invocation',
          '--region',
          region,
          '--command-id',
          commandId,
          '--instance-id',
          instanceId,
          '--output',
          'json',
        ],
        { env: awsEnv, spawnImpl }
      )
      if (get.code !== 0) {
        const errorText = get.stderr || get.stdout || ''

        const isTransient =
          errorText.includes('InvocationDoesNotExist') ||
          errorText.includes('InvalidCommandId') ||
          errorText.includes('Unable to locate credentials')
        if (isTransient) {
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
          continue
        }
        stderr.write(errorText)

        return get
      }

      invocation = JSON.parse(get.stdout || '{}')
      if (terminalStatuses.has(invocation.Status)) {
        break
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
    }

    if (!terminalStatuses.has(invocation?.Status)) {
      stderr.write(
        `SSM command ${commandId} timed out after ${dispatchTimeoutSeconds}s\n`
      )

      return { code: 1, signal: null }
    }

    printInvocation({ invocation, stdout, stderr })

    return {
      code:
        Number.isInteger(invocation.ResponseCode) &&
        invocation.ResponseCode >= 0
          ? invocation.ResponseCode
          : 1,
      signal: null,
    }
  } finally {
    if (shouldStop && keepAlive) {
      stdout.write(`worker ${instanceId}: keep alive requested; skip stop\n`)
    } else if (shouldStop) {
      await stopSsmWorkerBestEffort({
        instanceId,
        region,
        stderr,
        env: awsEnv,
        spawnImpl,
      })
    }
  }
}

export const dispatchConfig = (env = process.env) => {
  const sshOptions = env.QA_WORKER_SSH_OPTIONS_JSON
    ? JSON.parse(env.QA_WORKER_SSH_OPTIONS_JSON)
    : compact((env.QA_WORKER_SSH_OPTIONS || '').split(/\s+/))
  if (env.QA_WORKER_SSH_OPTIONS_JSON && !Array.isArray(sshOptions)) {
    throw new Error('QA_WORKER_SSH_OPTIONS_JSON must be a JSON array')
  }
  const instanceIds = parseWorkerInstanceIds(env)

  const fleetLeaseEnabled = Boolean(
    env.QA_WORKER_INSTANCE_IDS || env.QA_WORKER_CAPACITY_PER_INSTANCE
  )

  const capacityDefault = fleetLeaseEnabled
    ? DEFAULT_FLEET_CAPACITY_PER_INSTANCE
    : 1

  const capacityPerInstance = positiveInt(
    env.QA_WORKER_CAPACITY_PER_INSTANCE,
    capacityDefault,
    'QA_WORKER_CAPACITY_PER_INSTANCE'
  )
  const timeoutSeconds = Number(
    env.QA_WORKER_TIMEOUT_SECONDS || DEFAULT_WORKER_TIMEOUT_SECONDS
  )

  return {
    mode: env.QA_WORKER_MODE || 'local',
    repo: env.QA_WORKER_REPO || process.cwd(),
    host: env.QA_WORKER_HOST || '',
    user: env.QA_WORKER_USER || '',
    instanceId: instanceIds[0] || env.QA_WORKER_INSTANCE_ID || '',
    instanceIds,
    fleetLeaseEnabled,
    capacityPerInstance,
    leaseDir: env.QA_WORKER_LEASE_DIR || DEFAULT_WORKER_LEASE_DIR,
    leaseWaitSeconds: Number(
      env.QA_WORKER_LEASE_WAIT_SECONDS || timeoutSeconds
    ),
    leasePollIntervalMs: Number(env.QA_WORKER_LEASE_POLL_MS || 5000),
    leaseStaleSeconds: Number(env.QA_WORKER_LEASE_STALE_SECONDS || 0),
    region:
      env.QA_WORKER_REGION || env.AWS_REGION || env.AWS_DEFAULT_REGION || '',
    sshOptions,
    timeoutSeconds,
    burst: boolEnv(env.QA_WORKER_BURST),
    stopAfterRun: boolEnv(env.QA_WORKER_STOP_AFTER_RUN),
    keepAlive: boolEnv(env.QA_WORKER_KEEP_ALIVE),
    readyTimeoutSeconds: Number(env.QA_WORKER_READY_TIMEOUT_SECONDS || 600),
  }
}

export const runDispatch = async ({
  config = dispatchConfig(),
  env = cycleEnv(),
  stdout = process.stdout,
  stderr = process.stderr,
  awsEnv = process.env,
  spawnImpl = spawn,
  pollIntervalMs,
} = {}) => {
  if (!env.QA_PR) {
    throw new Error('QA_PR is required')
  }

  if (config.mode === 'local') {
    const plan = localDispatchPlan({ repo: config.repo, env })

    return runSpawn(plan.command, plan.args, {
      cwd: plan.cwd,
      env: plan.env,
      stdout,
      stderr,
    })
  }

  if (config.mode === 'ssh') {
    const plan = sshDispatchPlan({
      host: config.host,
      user: config.user,
      repo: config.repo,
      env,
      sshOptions: config.sshOptions,
    })

    return runSpawn(plan.command, plan.args, { stdout, stderr })
  }

  if (config.mode === 'ssm') {
    if (!config.fleetLeaseEnabled) {
      return runSsmDispatch({
        instanceId: config.instanceId,
        region: config.region,
        repo: config.repo,
        env,
        timeoutSeconds: config.timeoutSeconds,
        burst: config.burst,
        stopAfterRun: config.stopAfterRun,
        keepAlive: config.keepAlive,
        readyTimeoutSeconds: config.readyTimeoutSeconds,
        stdout,
        stderr,
        awsEnv,
        spawnImpl,
        ...(pollIntervalMs ? { pollIntervalMs } : {}),
      })
    }

    const lease = await acquireWorkerLease({
      instanceIds: config.instanceIds,
      capacityPerInstance: config.capacityPerInstance,
      leaseDir: config.leaseDir,
      waitSeconds: config.leaseWaitSeconds,
      pollIntervalMs: config.leasePollIntervalMs,
      staleSeconds: config.leaseStaleSeconds,
      pr: env.QA_PR,
      stdout,
    })

    try {
      return await runSsmDispatch({
        instanceId: lease.instanceId,
        region: config.region,
        repo: config.repo,
        env,
        timeoutSeconds: config.timeoutSeconds,
        burst: config.burst,
        stopAfterRun: false,
        keepAlive: true,
        readyTimeoutSeconds: config.readyTimeoutSeconds,
        stdout,
        stderr,
        awsEnv,
        spawnImpl,
        ...(pollIntervalMs ? { pollIntervalMs } : {}),
      })
    } finally {
      try {
        if (config.stopAfterRun && !config.keepAlive) {
          const activeLeases = activeWorkerLeaseCount({
            leaseDir: config.leaseDir,
            instanceId: lease.instanceId,
            capacityPerInstance: config.capacityPerInstance,
            staleSeconds: config.leaseStaleSeconds,
          })
          if (activeLeases <= 1) {
            await stopSsmWorkerBestEffort({
              instanceId: lease.instanceId,
              region: config.region,
              stderr,
              env: awsEnv,
              spawnImpl,
            })
          } else {
            stdout.write(
              `worker ${lease.instanceId}: ${activeLeases - 1} other active lease(s); skip stop\n`
            )
          }
        }
      } finally {
        lease.release()
      }
    }
  }

  throw new Error(`unsupported QA_WORKER_MODE '${config.mode}'`)
}

export const shouldRefreshRunner = (env = process.env) =>
  boolEnv(env.QA_WORKER_REFRESH_RUNNER)
