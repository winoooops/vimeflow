// Selects where one queued PR cycle runs. The default is the existing local
// watch.js tick path inside worker.js. Command mode is the split-plane seam: the
// control daemon keeps queue/state ownership, while an operator-supplied command
// can dispatch the expensive tick to a burst worker and return the worker exit.
import { spawn } from 'node:child_process'

const boolEnv = (value) => (value ? '1' : '0')
const noop = () => undefined

const commandEnv = (pr, config, reason) => ({
  QA_PR: String(pr),
  QA_REASON: reason || '',
  QA_LABEL: config.label || '',
  QA_APPROVE: boolEnv(config.approve),
  QA_LINEAR_DECISION_COMMENTS: boolEnv(config.linearDecisionComments),
  QA_LINEAR_CREATE_ISSUES: boolEnv(config.linearCreateIssues),
  QA_LINEAR_TEAM_KEY: config.linearTeamKey || '',
  QA_MAX_CI_RERUNS:
    config.maxCiReruns == null ? '' : String(config.maxCiReruns),
})

const rememberLine = (state, line) => {
  const trimmed = line.trim()
  if (!trimmed) {
    return
  }
  state.lastLine = trimmed
  state.logPath =
    state.logPath || trimmed.match(/\(log: ([^)]+)\)/)?.[1] || null
}

const pipeOutput = (stream, target, state) => {
  if (!stream) {
    return
  }

  let buf = ''
  stream.on('data', (chunk) => {
    target.write(chunk)
    buf += chunk.toString()
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      rememberLine(state, buf.slice(0, nl))
      buf = buf.slice(nl + 1)
    }
  })

  stream.on('end', () => {
    rememberLine(state, buf)
  })
}

export const createCommandTickRunner = ({
  command,
  log = noop,
  spawnImpl = spawn,
  stdout = process.stdout,
  stderr = process.stderr,
}) => {
  if (!command) {
    throw new Error('QA_TICK_COMMAND is required when QA_TICK_RUNNER=command')
  }

  return (pr, config, reason) =>
    new Promise((resolve) => {
      const state = { lastLine: '', logPath: null }
      log(`tick runner: command dispatch for #${pr} (${reason})`)

      const child = spawnImpl(command, {
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ...commandEnv(pr, config, reason),
        },
      })
      let settled = false

      pipeOutput(child.stdout, stdout, state)
      pipeOutput(child.stderr, stderr, state)

      child.on('close', (code, signal) => {
        if (settled) {
          return
        }
        settled = true
        resolve({
          code: code ?? -1,
          signal: signal ?? null,
          exitReason:
            state.lastLine ||
            (signal
              ? `command tick runner terminated by ${signal}`
              : `command tick runner exited ${code}`),
          logPath: state.logPath,
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
          exitReason: `command tick runner spawn error: ${error.message}`,
          logPath: state.logPath,
        })
      })
    })
}

export const createTickRunner = (config, log, opts = {}) => {
  if ((config.tickRunner || 'local') === 'local') {
    return null
  }
  if (config.tickRunner === 'command') {
    return createCommandTickRunner({
      command: config.tickCommand,
      log,
      spawnImpl: opts.spawnImpl,
    })
  }

  throw new Error(`unsupported QA_TICK_RUNNER '${config.tickRunner}'`)
}
