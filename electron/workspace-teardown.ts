// Window-close durability flush coordinator (spec §3.2). On teardown the store
// must be flushed exactly once before the browser views + sidecar are disposed:
// drain a final shape push from the renderer (bounded), then assemble + await
// the save. A flushed-once guard scoped to one teardown transaction lets the
// window `close` and `before-quit` paths cooperate — whichever fires first runs
// the flush; the other skips so disposed/empty browser state can't overwrite the
// good snapshot. The guard resets when the app keeps running so a later teardown
// flushes again.

export interface WorkspaceTeardownDeps {
  // Ask the renderer for one fresh shape and await its ack. Bounded and
  // resilient: it must not reject on an unresponsive renderer (falls back to the
  // last-known shape on timeout).
  drainFinalShape: () => Promise<void>
  // Assemble the latest snapshot and await the durable save.
  flush: () => Promise<void>
  // Optional observer for flush failures so callers can log without the
  // coordinator throwing.
  onFlushError?: (error: unknown) => void
}

interface InFlightFlush {
  generation: number
  promise: Promise<void>
}

export class WorkspaceTeardown {
  private readonly deps: WorkspaceTeardownDeps
  private generation = 0
  private flushed = false
  private inFlight: InFlightFlush | null = null

  constructor(deps: WorkspaceTeardownDeps) {
    this.deps = deps
  }

  get hasFlushed(): boolean {
    return this.flushed
  }

  // Flush once per teardown transaction. Same-generation callers share the
  // in-flight promise; a reset starts a new generation that queues behind any
  // previous flush still running.
  async flushOnce(): Promise<void> {
    const existing = this.inFlight
    if (existing !== null && existing.generation === this.generation) {
      return existing.promise
    }
    if (this.flushed) {
      return
    }
    this.flushed = true

    const promise = this.runAfterPreviousFlush(existing?.promise ?? null)

    const current = {
      generation: this.generation,
      promise,
    }

    this.inFlight = current

    try {
      await promise
    } finally {
      if (this.inFlight === current) {
        this.inFlight = null
      }
    }
  }

  private async runAfterPreviousFlush(
    previous: Promise<void> | null
  ): Promise<void> {
    if (previous !== null) {
      try {
        await previous
      } catch {
        // Still run the current generation even if an older flush rejects.
      }
    }

    await this.runFlush()
  }

  private async runFlush(): Promise<void> {
    try {
      await this.deps.drainFinalShape()
    } catch {
      // An unresponsive renderer must not block the save; proceed last-known.
    }
    try {
      await this.deps.flush()
    } catch (error) {
      this.deps.onFlushError?.(error)
    }
  }

  // Re-arm for the next teardown (non-quit close, or a new window opens).
  reset(): void {
    this.generation += 1
    this.flushed = false
  }
}
