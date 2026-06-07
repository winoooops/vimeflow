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
}

export class WorkspaceTeardown {
  private readonly deps: WorkspaceTeardownDeps
  private flushed = false

  constructor(deps: WorkspaceTeardownDeps) {
    this.deps = deps
  }

  get hasFlushed(): boolean {
    return this.flushed
  }

  // Flush once per teardown transaction; a later call is a no-op.
  async flushOnce(): Promise<void> {
    if (this.flushed) {
      return
    }
    this.flushed = true

    try {
      await this.deps.drainFinalShape()
    } catch {
      // An unresponsive renderer must not block the save; proceed last-known.
    }
    await this.deps.flush()
  }

  // Re-arm for the next teardown (non-quit close, or a new window opens).
  reset(): void {
    this.flushed = false
  }
}
