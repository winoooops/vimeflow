import type { DiffsThemeNames, LineDiffTypes } from '@pierre/diffs'

// The subset of WorkerRenderingOptions that DiffPanelContent pushes into the
// pool. Named after the Pierre type (Partial<WorkerRenderingOptions>) but
// narrowed to the two fields the app controls: the Shiki highlight `theme` and
// the intra-line `lineDiffType`. Both are typed with Pierre's exact union so
// callers need no casts.
export interface PoolRenderOptions {
  theme?: DiffsThemeNames
  lineDiffType?: LineDiffTypes
}

// Pool-keyed write serializer interface — structural so tests can stub it
// without importing the real WorkerPoolManager.
export interface PoolWithSetRenderOptions {
  setRenderOptions: (options: PoolRenderOptions) => Promise<void>
}

// Module-level map from pool instance → the tail of its pending write chain.
// WeakMap keeps pool instances collectable when the pool itself is GC'd.
// The `let` binding allows __resetPoolWritesForTest to swap the map for test
// isolation (WeakMap has no .clear()).
let chains = new WeakMap<object, Promise<void>>()

// Internal: run one write after `prev` settles. Absorbs `prev` rejections so
// a failed earlier write does not poison the chain; the caller's own rejection
// propagates normally if `setRenderOptions` throws.
const runAfter = async (
  prev: Promise<void>,
  pool: PoolWithSetRenderOptions,
  options: PoolRenderOptions,
  shouldSkip: (() => boolean) | undefined
): Promise<void> => {
  try {
    await prev
  } catch {
    // Absorb the prior write's rejection. It already surfaced through the
    // component that enqueued it — we must not let it cancel this write.
  }

  if (shouldSkip?.()) {
    return
  }

  await pool.setRenderOptions(options)
}

/**
 * Enqueue a `setRenderOptions` write on `pool`, serialized after any pending
 * write for the same pool instance so submissions land in order across ALL
 * instances that share the pool.
 *
 * @param pool        The Pierre WorkerPoolManager (or a compatible stub).
 * @param options     The render options to push (theme + lineDiffType).
 * @param shouldSkip  Optional predicate evaluated immediately before the write.
 *                    Return `true` to skip this write (e.g. the effect that
 *                    queued it has been cancelled by a newer render).
 * @returns           A promise that resolves once the write completes (or is
 *                    skipped), and rejects if `setRenderOptions` throws.
 */
export const enqueuePoolWrite = (
  pool: PoolWithSetRenderOptions,
  options: PoolRenderOptions,
  shouldSkip?: () => boolean
): Promise<void> => {
  const prev = chains.get(pool) ?? Promise.resolve()
  const next = runAfter(prev, pool, options, shouldSkip)

  chains.set(pool, next)

  return next
}

/**
 * TEST-ONLY: reset all pending chains so a pool stub's unresolved promise
 * cannot leak across test cases. Safe to call in `beforeEach`.
 *
 * Production code must never call this.
 */
export const __resetPoolWritesForTest = (): void => {
  chains = new WeakMap()
}
