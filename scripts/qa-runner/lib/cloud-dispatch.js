import { spawn } from 'node:child_process'
import { once } from 'node:events'

export const CYCLE_ENV_KEYS = [
  'QA_PR',
  'QA_REASON',
  'QA_LABEL',
  'QA_APPROVE',
  'QA_LINEAR_DECISION_COMMENTS',
  'QA_LINEAR_CREATE_ISSUES',
  'QA_LINEAR_TEAM_KEY',
  'QA_MAX_CI_RERUNS',
]

const boolEnv = (value) =>
  ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase())

const compact = (values) =>
  values.filter((value) => value != null && value !== '')

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
    return {
      code: -1,
      signal: null,
      error,
    }
  }
}

const runCapture = async (command, args, { env = process.env } = {}) => {
  const child = spawn(command, args, {
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
    throw new Error('QA_WORKER_INSTANCE_ID is required for QA_WORKER_MODE=ssm')
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
      executionTimeout: [String(timeoutSeconds || 5400)],
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
}

export const runSsmDispatch = async ({
  instanceId,
  region,
  repo,
  env,
  timeoutSeconds,
  stdout = process.stdout,
  stderr = process.stderr,
}) => {
  const send = await runCapture(
    'aws',
    ssmSendCommandArgs({ instanceId, region, repo, env, timeoutSeconds })
  )
  if (send.code !== 0) {
    stderr.write(send.stderr || send.stdout)

    return send
  }

  const commandId = parseCommandId(send.stdout)

  const wait = await runCapture('aws', [
    'ssm',
    'wait',
    'command-executed',
    '--region',
    region,
    '--command-id',
    commandId,
    '--instance-id',
    instanceId,
  ])

  const get = await runCapture('aws', [
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
  ])
  if (get.code !== 0) {
    stderr.write(get.stderr || get.stdout || wait.stderr || wait.stdout)

    return get
  }

  const invocation = JSON.parse(get.stdout || '{}')
  printInvocation({ invocation, stdout, stderr })

  return {
    code:
      Number.isInteger(invocation.ResponseCode) && invocation.ResponseCode >= 0
        ? invocation.ResponseCode
        : wait.code,
    signal: null,
  }
}

export const dispatchConfig = (env = process.env) => ({
  mode: env.QA_WORKER_MODE || 'local',
  repo: env.QA_WORKER_REPO || process.cwd(),
  host: env.QA_WORKER_HOST || '',
  user: env.QA_WORKER_USER || '',
  instanceId: env.QA_WORKER_INSTANCE_ID || '',
  region:
    env.QA_WORKER_REGION || env.AWS_REGION || env.AWS_DEFAULT_REGION || '',
  sshOptions: compact((env.QA_WORKER_SSH_OPTIONS || '').split(/\s+/)),
  timeoutSeconds: Number(env.QA_WORKER_TIMEOUT_SECONDS || 5400),
})

export const runDispatch = async ({
  config = dispatchConfig(),
  env = cycleEnv(),
  stdout = process.stdout,
  stderr = process.stderr,
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
    return runSsmDispatch({
      instanceId: config.instanceId,
      region: config.region,
      repo: config.repo,
      env,
      timeoutSeconds: config.timeoutSeconds,
      stdout,
      stderr,
    })
  }

  throw new Error(`unsupported QA_WORKER_MODE '${config.mode}'`)
}

export const shouldRefreshRunner = (env = process.env) =>
  boolEnv(env.QA_WORKER_REFRESH_RUNNER)
