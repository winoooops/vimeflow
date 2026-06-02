// Persistent per-PR daemon state — the runner's memory across cycles + restarts.
// .state/daemon.json, atomic writes (tmp + rename) so a crash mid-write can't
// corrupt it. This is what makes the daemon the STATE OWNER (vs watch.js's
// ephemeral loop): noop/round counts and the last reviewed head SHA survive.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const STATE_DIR = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  '.state'
)
const FILE = join(STATE_DIR, 'daemon.json')

const EMPTY = {
  lastHeadSha: null,
  roundCount: 0,
  noopCount: 0,
  lastState: null,
  pausedAt: null,
  pauseReason: null,
}

const read = () => {
  if (!existsSync(FILE)) {
    return {}
  }
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'))
  } catch {
    return {}
  }
}

export const createState = (now = () => new Date().toISOString()) => {
  let data = read()

  const save = () => {
    mkdirSync(STATE_DIR, { recursive: true })
    const tmp = `${FILE}.tmp`
    writeFileSync(tmp, JSON.stringify(data, null, 2))
    renameSync(tmp, FILE)
  }

  return {
    get: (pr) => ({ ...EMPTY, ...data[String(pr)] }),
    // Is this PR currently tracked? Lets a terminal-state cleanup tell a PR the
    // daemon was working from a repo-wide `closed` webhook it never touched.
    has: (pr) => Object.prototype.hasOwnProperty.call(data, String(pr)),
    update: (pr, patch) => {
      const k = String(pr)
      data[k] = { ...EMPTY, ...data[k], ...patch, updatedAt: now() }
      save()

      return data[k]
    },
    forget: (pr) => {
      delete data[String(pr)]
      save()
    },
    all: () => ({ ...data }),
  }
}
