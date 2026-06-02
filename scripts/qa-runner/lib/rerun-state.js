import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stableCheckIdentity } from './ci-policy.js'

const QA_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const STATE_DIR = join(QA_DIR, '.state')

export const rerunStorePath = (pr) => join(STATE_DIR, `ci-reruns-pr-${pr}.json`)

export const rerunKey = ({ pr, headSha, check }) =>
  [pr, headSha || 'unknown-head', stableCheckIdentity(check)].join('|')

export const readRerunStore = (file) => {
  if (!existsSync(file)) {
    return {}
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

export const rerunCount = (store, key) => Number(store[key]?.count || 0)

export const markRerunAttempt = (
  store,
  key,
  file,
  now = () => new Date().toISOString()
) => {
  const next = {
    ...store,
    [key]: {
      count: rerunCount(store, key) + 1,
      updatedAt: now(),
    },
  }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`)

  return next
}

export const rerunStatus = ({ store, key, max }) => {
  const count = rerunCount(store, key)

  return {
    count,
    nextAttempt: count + 1,
    exhausted: count >= max,
  }
}
