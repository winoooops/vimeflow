import { test, expect, vi, beforeEach, describe } from 'vitest'
import { enqueuePoolWrite, __resetPoolWritesForTest } from './workerPoolWrites'
import type { PoolWithSetRenderOptions } from './workerPoolWrites'

// Helper to create a pool stub with a controllable setRenderOptions.
const makePool = (): {
  stub: PoolWithSetRenderOptions
  mock: ReturnType<typeof vi.fn>
} => {
  const mock = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  const stub: PoolWithSetRenderOptions = { setRenderOptions: mock }

  return { stub, mock }
}

// Deferred promise factory — lets tests hold a write in-flight and resolve it
// at will, so ordering assertions can be made between queued calls.
const deferred = (): {
  promise: Promise<void>
  resolve: () => void
  reject: (reason?: unknown) => void
} => {
  let resolveDeferred!: () => void
  let rejectDeferred!: (reason?: unknown) => void

  const promise = new Promise<void>((resolve, reject) => {
    resolveDeferred = resolve
    rejectDeferred = reject
  })

  return { promise, resolve: resolveDeferred, reject: rejectDeferred }
}

beforeEach(() => {
  __resetPoolWritesForTest()
  vi.clearAllMocks()
})

describe('enqueuePoolWrite', () => {
  test('calls setRenderOptions with the provided options', async () => {
    const { stub, mock } = makePool()

    await enqueuePoolWrite(stub, { theme: 'pierre-dark', lineDiffType: 'word' })

    expect(mock).toHaveBeenCalledOnce()

    expect(mock).toHaveBeenCalledWith({
      theme: 'pierre-dark',
      lineDiffType: 'word',
    })
  })

  test('two interleaved writes on the same pool land in submission order', async () => {
    const { stub, mock } = makePool()

    const firstDeferred = deferred()
    mock.mockReturnValueOnce(firstDeferred.promise)

    // Enqueue both writes before either resolves.
    const write1 = enqueuePoolWrite(stub, {
      theme: 'pierre-dark',
      lineDiffType: 'word',
    })

    const write2 = enqueuePoolWrite(stub, {
      theme: 'pierre-light',
      lineDiffType: 'char',
    })

    // Drain enough microtask ticks for the async runAfter function to reach the
    // setRenderOptions call for the first write. The second write is blocked
    // behind firstDeferred, so mock should have been called exactly once here.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // At this point only the first call has been issued — the second is waiting
    // for the first's promise to settle.
    expect(mock).toHaveBeenCalledOnce()

    expect(mock).toHaveBeenCalledWith({
      theme: 'pierre-dark',
      lineDiffType: 'word',
    })

    // Resolve the first write; the second should now run.
    firstDeferred.resolve()
    await write1
    await write2

    expect(mock).toHaveBeenCalledTimes(2)

    expect(mock).toHaveBeenNthCalledWith(1, {
      theme: 'pierre-dark',
      lineDiffType: 'word',
    })

    expect(mock).toHaveBeenNthCalledWith(2, {
      theme: 'pierre-light',
      lineDiffType: 'char',
    })
  })

  test('a queued write with shouldSkip() === true skips setRenderOptions', async () => {
    const { stub, mock } = makePool()

    const firstDeferred = deferred()
    mock.mockReturnValueOnce(firstDeferred.promise)

    // Enqueue a first write (will block).
    const write1 = enqueuePoolWrite(stub, { theme: 'pierre-dark' })

    // Enqueue a second write that is already "cancelled".
    let cancelled = false

    const write2 = enqueuePoolWrite(
      stub,
      { theme: 'pierre-light' },
      () => cancelled
    )

    // Cancel the second write before the first resolves.
    cancelled = true

    firstDeferred.resolve()
    await write1
    await write2

    // setRenderOptions was called once (for the first write) — skipped for the
    // second.
    expect(mock).toHaveBeenCalledOnce()

    expect(mock).toHaveBeenCalledWith({ theme: 'pierre-dark' })
  })

  test('a rejected earlier write does not prevent a later queued write from running', async () => {
    const { stub, mock } = makePool()

    const firstDeferred = deferred()
    mock.mockReturnValueOnce(firstDeferred.promise)

    const write1 = enqueuePoolWrite(stub, { theme: 'pierre-dark' })
    const write2 = enqueuePoolWrite(stub, { theme: 'pierre-light' })

    // Reject the first write.
    firstDeferred.reject(new Error('network error'))

    // write1 should reject.
    await expect(write1).rejects.toThrow('network error')

    // write2 should still run and resolve.
    await write2

    expect(mock).toHaveBeenCalledTimes(2)

    expect(mock).toHaveBeenNthCalledWith(2, { theme: 'pierre-light' })
  })

  test('writes to two different pool stubs are independent', async () => {
    const { stub: poolA, mock: mockA } = makePool()
    const { stub: poolB, mock: mockB } = makePool()

    const firstDeferred = deferred()
    mockA.mockReturnValueOnce(firstDeferred.promise)

    // Block pool A's write.
    const writeA = enqueuePoolWrite(poolA, { theme: 'pierre-dark' })

    // Pool B's write should proceed independently without waiting for pool A.
    const writeB = enqueuePoolWrite(poolB, { theme: 'pierre-light' })
    await writeB

    expect(mockB).toHaveBeenCalledOnce()
    expect(mockA).toHaveBeenCalledOnce()

    // Resolve pool A.
    firstDeferred.resolve()
    await writeA
  })

  test('__resetPoolWritesForTest: a pool stub starts with an empty chain after reset (no cross-test leakage)', async () => {
    const { stub, mock } = makePool()

    const firstDeferred = deferred()
    mock.mockReturnValueOnce(firstDeferred.promise)

    // Block a write — intentionally left pending to simulate test-boundary
    // state that should NOT carry over.
    void enqueuePoolWrite(stub, { theme: 'pierre-dark' })

    // Simulate what beforeEach does between tests: reset the module chains map.
    __resetPoolWritesForTest()

    // After reset, a fresh write on the same stub object does NOT wait for the
    // prior blocked promise — it runs immediately.
    mock.mockResolvedValueOnce(undefined)
    await enqueuePoolWrite(stub, { theme: 'pierre-light' })

    expect(mock).toHaveBeenLastCalledWith({ theme: 'pierre-light' })

    // Clean up the dangling deferred.
    firstDeferred.resolve()
  })
})
