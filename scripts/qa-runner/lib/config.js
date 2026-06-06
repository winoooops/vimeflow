// Config for the QA daemon. Precedence: env > config.json (gitignored) >
// config.example.json. SECRETS (GITHUB_WEBHOOK_SECRET, bot/Linear tokens) come
// ONLY from env / gitignored *.env files — never from a JSON config.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const QA_DIR = dirname(dirname(fileURLToPath(import.meta.url)))

const readJson = (file) => {
  if (!existsSync(file)) {
    return {}
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

const num = (v, d) => {
  const n = Number(v)

  return Number.isFinite(n) ? n : d
}

const list = (v) =>
  v
    ? String(v)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : []

const bool = (v, d = false) => {
  if (v == null || v === '') {
    return d
  }

  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase())
}

// Merge the layers and coerce types. Called once at daemon start.
export const loadConfig = () => {
  const file = {
    ...readJson(join(QA_DIR, 'config.example.json')),
    ...readJson(join(QA_DIR, 'config.json')),
  }
  const env = process.env
  const senders = list(env.QA_TRUSTED_SENDERS)

  return {
    host: env.QA_HOST || file.host || '0.0.0.0',
    port: num(env.QA_PORT, num(file.port, 8787)),
    label: env.QA_LABEL || file.label || 'auto-review',
    approveLabel: env.QA_APPROVE_LABEL ?? file.approveLabel ?? 'auto-approve',
    maxParallel: num(env.QA_MAX_PARALLEL, num(file.maxParallel, 2)),
    maxNoops: num(env.QA_MAX_NOOPS, num(file.maxNoops, 15)),
    maxCiReruns: num(env.QA_MAX_CI_RERUNS, num(file.maxCiReruns, 3)),
    pollSeconds: num(env.QA_POLL_SECONDS, num(file.pollSeconds, 60)),
    workerIdleStopSeconds: num(
      env.QA_WORKER_IDLE_STOP_SECONDS,
      num(file.workerIdleStopSeconds, 15)
    ),
    tickRunner: env.QA_TICK_RUNNER || file.tickRunner || 'local',
    tickCommand: env.QA_TICK_COMMAND || file.tickCommand || '',
    linearDecisionComments: bool(
      env.QA_LINEAR_DECISION_COMMENTS,
      bool(file.linearDecisionComments, true)
    ),
    linearCreateIssues: bool(
      env.QA_LINEAR_CREATE_ISSUES,
      bool(file.linearCreateIssues, false)
    ),
    triggerPhrase:
      env.QA_TRIGGER_PHRASE || file.triggerPhrase || '/upsource-review',
    trustedSenders: senders.length ? senders : file.trustedSenders || [],
    // Secret: env only. Empty ⇒ the webhook endpoint rejects everything (fail closed).
    webhookSecret: env.GITHUB_WEBHOOK_SECRET || '',
    // Bearer token for GET /status (env only). Empty ⇒ /status is DISABLED, so the
    // public webhook bind never leaks queue/PR state. Set to expose it to operators.
    statusToken: env.QA_STATUS_TOKEN || '',
    linearTeamKey: env.QA_LINEAR_TEAM_KEY || file.linearTeamKey || 'VIM',
  }
}
