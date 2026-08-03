import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSidecar } from '../electron/sidecar.ts'

// cspell:ignore getconf

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)

const numberArg = (args, name, fallback) => {
  const index = args.indexOf(name)
  if (index === -1) {
    return fallback
  }

  const value = Number(args[index + 1])
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`)
  }

  return value
}

const stringArg = (args, name, fallback) => {
  const index = args.indexOf(name)

  return index === -1 ? fallback : args[index + 1]
}

export const parseBenchmarkArgs = (args) => ({
  mode: (() => {
    const mode = stringArg(args, '--mode', 'control')
    if (mode !== 'control' && mode !== 'treatment') {
      throw new Error('--mode must be control or treatment')
    }

    return mode
  })(),
  watchers: numberArg(args, '--watchers', 32),
  warmupMs: numberArg(args, '--warmup-ms', 10_000),
  idleMs: numberArg(args, '--idle-ms', 60_000),
  loadMs: numberArg(args, '--load-ms', 60_000),
  output: stringArg(
    args,
    '--output',
    path.join(repoRoot, 'test-results', 'agent-notification-control.json')
  ),
})

export const parseLinuxProcessSnapshot = ({
  status,
  stat,
  fdCount,
  sampledAtNs,
}) => {
  const rssKiB = Number(/^VmRSS:\s+(\d+)\s+kB$/m.exec(status)?.[1] ?? 0)
  const threads = Number(/^Threads:\s+(\d+)$/m.exec(status)?.[1] ?? 0)

  const fields = stat
    .slice(stat.lastIndexOf(')') + 2)
    .trim()
    .split(/\s+/)

  return {
    sampledAtNs,
    rssBytes: rssKiB * 1024,
    threads,
    fdCount,
    cpuTicks: Number(fields[11]) + Number(fields[12]),
  }
}

const readLinuxProcessSnapshot = (pid) =>
  parseLinuxProcessSnapshot({
    status: fs.readFileSync(`/proc/${pid}/status`, 'utf8'),
    stat: fs.readFileSync(`/proc/${pid}/stat`, 'utf8'),
    fdCount: fs.readdirSync(`/proc/${pid}/fd`).length,
    sampledAtNs: process.hrtime.bigint(),
  })

export const summarizeSamples = (samples, ticksPerSecond) => {
  if (samples.length < 2) {
    throw new Error('at least two process samples are required')
  }

  const first = samples[0]
  const last = samples.at(-1)
  const elapsedSeconds = Number(last.sampledAtNs - first.sampledAtNs) / 1e9
  const cpuSeconds = (last.cpuTicks - first.cpuTicks) / ticksPerSecond

  return {
    rssBytesMedian: [...samples]
      .map(({ rssBytes }) => rssBytes)
      .sort((a, b) => a - b)[Math.floor(samples.length / 2)],
    rssBytesMax: Math.max(...samples.map(({ rssBytes }) => rssBytes)),
    cpuPercentOneCore:
      elapsedSeconds === 0 ? 0 : (cpuSeconds / elapsedSeconds) * 100,
    threadsMax: Math.max(...samples.map(({ threads }) => threads), 0),
    fdCountMax: Math.max(...samples.map(({ fdCount }) => fdCount), 0),
  }
}

const wait = (durationMs) =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs)
  })

const samplePhase = async (pid, durationMs, onTick) => {
  const samples = [readLinuxProcessSnapshot(pid)]
  const deadline = Date.now() + durationMs

  while (Date.now() < deadline) {
    onTick?.()
    await wait(Math.min(1000, Math.max(1, deadline - Date.now())))
    samples.push(readLinuxProcessSnapshot(pid))
  }

  return samples
}

const appendLoad = (sources, tick, pendingCompletions) => {
  const phase = tick % 20
  const turn = Math.floor(tick / 20)

  for (const source of sources) {
    const turnId = `benchmark-${source.sessionId}-${turn}`

    const payload =
      phase === 0
        ? { type: 'task_started', turn_id: turnId }
        : phase === 1
          ? { type: 'task_complete', turn_id: turnId }
          : { type: 'token_count', info: { total_tokens: tick } }
    if (phase === 1) {
      pendingCompletions.set(`turn:${turnId}`, process.hrtime.bigint())
    }
    fs.appendFileSync(
      source.path,
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        type: 'event_msg',
        payload,
      })}\n`
    )
  }
}

const percentile = (values, quantile) => {
  if (values.length === 0) {
    return null
  }

  const sorted = [...values].sort((a, b) => a - b)

  return sorted[Math.ceil(sorted.length * quantile) - 1]
}

export const runBenchmark = async (options) => {
  if (process.platform !== 'linux') {
    throw new Error('the control benchmark currently requires Linux /proc')
  }

  const tempRoot = fs.mkdtempSync(
    path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'vimeflow-notify-bench-')
  )
  const binary = path.join(repoRoot, 'target', 'debug', 'vimeflow-backend')
  let backendPid
  const sessionIds = []

  const sidecar = createSidecar({
    binary,
    appDataDir: path.join(tempRoot, 'app-data'),
    spawnFn: (command, args) => {
      const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })
      backendPid = child.pid

      return child
    },
  })
  const pendingCompletions = new Map()
  const receivedKeys = new Set()
  const latenciesMs = []
  let notificationEvents = 0

  const unlisten = sidecar.onEvent((event, payload) => {
    if (
      event !== 'agent-notification' ||
      payload === null ||
      typeof payload !== 'object' ||
      payload.reason !== 'turn-complete' ||
      typeof payload.dedupeKey !== 'string'
    ) {
      return
    }

    notificationEvents += 1
    const startedAt = pendingCompletions.get(payload.dedupeKey)
    if (startedAt !== undefined) {
      latenciesMs.push(Number(process.hrtime.bigint() - startedAt) / 1e6)
      pendingCompletions.delete(payload.dedupeKey)
    }
    receivedKeys.add(payload.dedupeKey)
  })

  try {
    if (backendPid === undefined) {
      throw new Error('backend process did not expose a pid')
    }

    const sources = []
    for (let index = 0; index < options.watchers; index += 1) {
      const sessionId = `notification-benchmark-${index}`
      await sidecar.invoke('spawn_pty', {
        request: {
          sessionId,
          cwd: tempRoot,
          enableAgentBridge: false,
          ephemeral: true,
        },
      })
      sessionIds.push(sessionId)
      const sourcePath = path.join(tempRoot, `${sessionId}.jsonl`)
      fs.writeFileSync(sourcePath, '')
      sources.push({ sessionId, path: sourcePath })
      if (options.mode === 'treatment') {
        await sidecar.invoke('e2e_register_agent_notification_source', {
          sessionId,
          provider: 'codex',
          sourcePath,
        })
      }
    }

    await wait(options.warmupMs)
    const idle = await samplePhase(backendPid, options.idleMs)
    let ticks = 0

    const load = await samplePhase(backendPid, options.loadMs, () => {
      appendLoad(sources, ticks, pendingCompletions)
      ticks += 1
    })
    await sidecar.invoke('e2e_reconcile_agent_notification_watchers')

    const diagnostics = await sidecar.invoke(
      'get_agent_notification_diagnostics'
    )

    const ticksPerSecond = Number(
      spawnSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).stdout.trim()
    )

    const report = {
      version: 1,
      generatedAt: new Date().toISOString(),
      mode: options.mode,
      backendPid,
      watchers: options.watchers,
      durationsMs: {
        warmup: options.warmupMs,
        idle: options.idleMs,
        load: options.loadMs,
      },
      writes: ticks * sources.length,
      phases: {
        idle: summarizeSamples(idle, ticksPerSecond),
        load: summarizeSamples(load, ticksPerSecond),
      },
      correctness: {
        expectedNotifications:
          options.mode === 'treatment'
            ? pendingCompletions.size + receivedKeys.size
            : 0,
        receivedNotifications: receivedKeys.size,
        missedNotifications:
          options.mode === 'treatment' ? pendingCompletions.size : 0,
        duplicateNotifications: notificationEvents - receivedKeys.size,
      },
      latencyMs: {
        p50: percentile(latenciesMs, 0.5),
        p95: percentile(latenciesMs, 0.95),
        p99: percentile(latenciesMs, 0.99),
      },
      diagnostics,
    }

    fs.mkdirSync(path.dirname(options.output), { recursive: true })
    fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`)

    return report
  } finally {
    unlisten()
    for (const sessionId of sessionIds) {
      await sidecar
        .invoke('kill_pty', { request: { sessionId } })
        .catch(() => undefined)
    }
    await wait(250)
    await sidecar.shutdown()
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const report = await runBenchmark(parseBenchmarkArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(report)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
    process.exitCode = 1
  }
}
