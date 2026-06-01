// Run a child process until a probe value changes, then wind it down. Polls
// `probe()`; once it returns a value different from the start (the child's
// observable effect has landed), waits `graceMs` for any follow-up, then
// terminates the child (SIGTERM → SIGKILL). `timeoutMs` is a hard backstop.
// Resolves with { status, signal, killed }.
//
// Generic on purpose — reusable for any "run a process until its work shows up,
// then stop it from over-running" case. The QA runner uses it to enforce a
// single review round: probe = the worktree HEAD, so once kimi commits the fix,
// it is stopped before the upsource-review skill can POLL_NEXT into another round.
//
// Deps are injected so it is unit-testable without a real child or git:
//   spawnChild() → a ChildProcess-like { kill(sig), on('exit'|'error', cb) }
//   probe()      → any comparable value; a CHANGE triggers the wind-down
export const runUntilChange = (spawnChild, probe, opts = {}) => {
  // Options — all optional; the default is noted in each comment below.
  const {
    // grace after the probe changes — the window to let the child finish its
    // follow-up (e.g. push + reply/resolve) before we terminate it. Too short
    // truncates that work; too long lets a misbehaving child start another round (2 min).
    graceMs = 120000,
    // hard cap on total runtime — terminate even if the probe never changes (45 min).
    timeoutMs = 45 * 60000,
    // how often to sample probe() for a change (15 s).
    pollMs = 15000,
    log = () => {
      // silent by default
    },
    timers = { setTimeout, clearTimeout, setInterval, clearInterval },
  } = opts

  return new Promise((resolve) => {
    let before = probe()
    const child = spawnChild()
    let stopped = false
    let stopReason = null
    let graceTimer = null
    let killTimer = null

    const stop = (reason, why) => {
      if (stopped) {
        return
      }
      stopped = true
      stopReason = reason
      log(`run-until-change: ${why} — terminating`)
      child.kill('SIGTERM')
      // SIGKILL backstop if SIGTERM is ignored — captured so cleanup() can cancel it
      // once the child exits, instead of holding the process (and the pool slot) 10s.
      killTimer = timers.setTimeout(() => child.kill('SIGKILL'), 10000)
    }

    const poll = timers.setInterval(() => {
      const now = probe()
      if (before === null && now) {
        before = now

        return
      }
      if (now && before !== null && now !== before && graceTimer === null) {
        log(
          `run-until-change: probe changed (${String(now).slice(0, 7)}) — grace ${graceMs / 1000}s then stop`
        )

        graceTimer = timers.setTimeout(
          () => stop('grace', 'grace elapsed'),
          graceMs
        )
      }
    }, pollMs)

    const overall = timers.setTimeout(
      () => stop('timeout', `${Math.round(timeoutMs / 60000)}m timeout`),
      timeoutMs
    )

    const cleanup = () => {
      timers.clearInterval(poll)
      if (graceTimer !== null) {
        timers.clearTimeout(graceTimer)
      }
      if (killTimer !== null) {
        timers.clearTimeout(killTimer)
      }
      timers.clearTimeout(overall)
    }

    child.on('exit', (code, signal) => {
      cleanup()
      resolve({
        status: code ?? null,
        signal: signal ?? null,
        killed: stopped,
        timedOut: stopReason === 'timeout',
      })
    })

    child.on('error', (error) => {
      cleanup()
      resolve({ status: null, signal: null, error })
    })
  })
}
