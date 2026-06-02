import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const LIB_DIR = dirname(fileURLToPath(import.meta.url))
const STATE_DIR = join(dirname(LIB_DIR), '.state')

export const DISPATCH_BLOCKED_EXIT = 3

export const RUN_SELF_REVIEW_EXIT = 4

export const dispatchBlockerPath = (pr) =>
  join(STATE_DIR, `dispatch-blocked-pr-${pr}.json`)

export const writeDispatchBlocker = (pr, blocker) => {
  mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(
    dispatchBlockerPath(pr),
    JSON.stringify(
      {
        pr,
        ts: new Date().toISOString(),
        ...blocker,
      },
      null,
      2
    )
  )
}

export const readDispatchBlocker = (pr) => {
  const file = dispatchBlockerPath(pr)
  if (!existsSync(file)) {
    return null
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export const clearDispatchBlocker = (pr) => {
  rmSync(dispatchBlockerPath(pr), { force: true })
}

export const dispatchBlockerDetail = (blocker) => {
  if (!blocker) {
    return 'run.js reported a dispatch blocker'
  }

  const reason = blocker.reason || `run.js exited ${blocker.code ?? 'blocked'}`
  const logPath = blocker.logPath ? ` Log: ${blocker.logPath}` : ''

  return `${reason}${logPath}`
}
