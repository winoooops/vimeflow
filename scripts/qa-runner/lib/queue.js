// Persistent, deduped work queue for the daemon (.state/queue.json, survives
// restart). Dedup: a PR already pending or in-flight is not re-added. Both the
// pending list AND the in-flight leases are persisted, and any lease left over
// from a crash is requeued on startup — so one-shot events (closed-PR cleanup, a
// comment waking a paused PR) that the fallback poll can't recreate aren't lost.
// The maxParallel cap is enforced by the worker pool calling take() concurrently.
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
const FILE = join(STATE_DIR, 'queue.json')

const read = () => {
  if (!existsSync(FILE)) {
    return { pending: [], inFlight: [] }
  }
  try {
    const j = JSON.parse(readFileSync(FILE, 'utf8'))

    return { pending: j.pending || [], inFlight: j.inFlight || [] }
  } catch {
    return { pending: [], inFlight: [] }
  }
}

export const createQueue = (now = () => new Date().toISOString()) => {
  const persisted = read()
  // Requeue leases that were claimed but never done() before a crash/restart, ahead
  // of nothing in particular — runOne re-snapshots, so re-processing is idempotent.
  const seen = new Set()
  let pending = []
  for (const e of [...persisted.pending, ...persisted.inFlight]) {
    if (e && Number.isFinite(e.pr) && !seen.has(e.pr)) {
      seen.add(e.pr)
      pending.push(e)
    }
  }
  const inFlight = new Map() // pr → the claimed job (reason preserved across restart)

  const save = () => {
    mkdirSync(STATE_DIR, { recursive: true })
    const tmp = `${FILE}.tmp`
    writeFileSync(
      tmp,
      JSON.stringify({ pending, inFlight: [...inFlight.values()] }, null, 2)
    )
    renameSync(tmp, FILE)
  }

  return {
    // Returns true if newly enqueued, false if deduped (already pending/in-flight).
    enqueue: (pr, reason) => {
      const n = Number(pr)
      const existing = pending.find((e) => e.pr === n)
      if (existing) {
        // The fallback poll is the lowest priority: never let it overwrite a real
        // event's reason, since runOne skips paused PRs only for reason 'poll' — a
        // downgrade would drop the very event meant to re-evaluate a paused PR.
        if (!(reason === 'poll' && existing.reason !== 'poll')) {
          existing.reason = reason
        }
        save()

        return false
      }
      if (inFlight.has(n)) {
        // A real event landing mid-cycle must become a FOLLOW-UP: the in-flight cycle
        // may return without acting on it (e.g. a poll that returns 'paused'), and
        // take() won't claim this entry until done() releases the lease — so it runs
        // next, with the event reason that bypasses the pause-skip. A routine poll is
        // still dropped here (the next poll re-enqueues it anyway).
        if (reason !== 'poll') {
          pending.push({ pr: n, reason, at: now() })
          save()

          return true
        }

        return false
      }
      pending.push({ pr: n, reason, at: now() })
      save()

      return true
    },
    // Claim the next pending PR not already in-flight, marking it in-flight.
    take: () => {
      const e = pending.find((x) => !inFlight.has(x.pr))
      if (!e) {
        return null
      }
      pending = pending.filter((x) => x.pr !== e.pr)
      inFlight.set(e.pr, e)
      save()

      return e
    },
    // Release a claimed lease — persisted so a completed job isn't requeued on restart.
    done: (pr) => {
      inFlight.delete(Number(pr))
      save()
    },
    depth: () => pending.length,
    inFlight: () => [...inFlight.keys()],
  }
}
