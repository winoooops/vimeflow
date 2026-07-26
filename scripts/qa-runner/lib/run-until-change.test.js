import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { runUntilChange } from './run-until-change.js'

const makeChild = () => {
  const child = new EventEmitter()
  child.kill = vi.fn()

  return child
}

describe('runUntilChange', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test('starts grace only after the watched probe changes', async () => {
    vi.useFakeTimers()
    let probe = 'origin-a'
    const child = makeChild()

    const done = runUntilChange(
      () => child,
      () => probe,
      {
        graceMs: 1000,
        pollMs: 100,
        timeoutMs: 10000,
      }
    )

    await vi.advanceTimersByTimeAsync(2000)
    expect(child.kill).not.toHaveBeenCalled()

    probe = 'origin-b'
    await vi.advanceTimersByTimeAsync(100)
    expect(child.kill).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')

    child.emit('exit', null, 'SIGTERM')
    await expect(done).resolves.toMatchObject({
      killed: true,
      signal: 'SIGTERM',
      timedOut: false,
    })
  })

  test('reports timeout when the probe never changes', async () => {
    vi.useFakeTimers()
    const child = makeChild()

    const done = runUntilChange(
      () => child,
      () => 'origin-a',
      {
        graceMs: 1000,
        pollMs: 100,
        timeoutMs: 5000,
      }
    )

    await vi.advanceTimersByTimeAsync(5000)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')

    child.emit('exit', null, 'SIGTERM')
    await expect(done).resolves.toMatchObject({
      killed: true,
      signal: 'SIGTERM',
      timedOut: true,
    })
  })

  test('terminates the detached fixer process group', async () => {
    vi.useFakeTimers()
    const child = makeChild()
    child.detached = true
    child.pid = 4242
    const killGroup = vi.spyOn(process, 'kill').mockReturnValue(true)

    const done = runUntilChange(
      () => child,
      () => 'origin-a',
      { timeoutMs: 1000 }
    )

    await vi.advanceTimersByTimeAsync(1000)
    expect(killGroup).toHaveBeenCalledWith(-4242, 'SIGTERM')

    child.emit('exit', null, 'SIGTERM')
    await expect(done).resolves.toMatchObject({ killed: true, timedOut: true })
    expect(killGroup).toHaveBeenCalledWith(-4242, 'SIGKILL')
    expect(child.kill).not.toHaveBeenCalled()
  })
})
