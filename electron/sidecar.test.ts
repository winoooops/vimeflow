import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, test, vi } from 'vitest'
import { createSidecar, type Sidecar, type SpawnedChild } from './sidecar'

class MockChildProcess extends EventEmitter implements SpawnedChild {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr: PassThrough | null = new PassThrough()
  readonly pid = 12345
  kill: (signal?: NodeJS.Signals | number) => boolean = vi.fn(
    (signal?: NodeJS.Signals | number): boolean => {
      void signal

      return true
    }
  )
}

const makeSidecar = (): {
  mock: MockChildProcess
  sidecar: Sidecar
} => {
  const mock = new MockChildProcess()

  const sidecar = createSidecar({
    binary: '/fake/vimeflow-backend',
    appDataDir: '/fake/data',
    stderr: new PassThrough(),
    spawnFn: (): MockChildProcess => mock,
  })

  return { mock, sidecar }
}

const encodeFrame = (body: object): Buffer => {
  const json = Buffer.from(JSON.stringify(body), 'utf8')
  const header = Buffer.from(`Content-Length: ${json.length}\r\n\r\n`, 'ascii')

  return Buffer.concat([header, json])
}

const waitForImmediate = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve)
  })

describe('Sidecar frame codec', () => {
  test('response frame round trip resolves matching invoke', async () => {
    const { mock, sidecar } = makeSidecar()
    const promise = sidecar.invoke<{ ok: string }>('list_sessions')

    mock.stdout.write(
      encodeFrame({
        kind: 'response',
        id: '1',
        ok: true,
        result: { ok: 'yes' },
      })
    )

    await expect(promise).resolves.toEqual({ ok: 'yes' })
  })

  test('partial-frame buffering across two stdout writes', async () => {
    const { mock, sidecar } = makeSidecar()
    const promise = sidecar.invoke<{ x: number }>('git_status')
    const marker = Symbol('pending')

    const full = encodeFrame({
      kind: 'response',
      id: '1',
      ok: true,
      result: { x: 42 },
    })
    const mid = Math.floor(full.length / 2)

    mock.stdout.write(full.subarray(0, mid))

    await expect(
      Promise.race([
        promise,
        new Promise<symbol>((resolve) => {
          setImmediate(() => {
            resolve(marker)
          })
        }),
      ])
    ).resolves.toBe(marker)

    mock.stdout.write(full.subarray(mid))

    await expect(promise).resolves.toEqual({ x: 42 })
  })

  test('two frames concatenated in one stdout write dispatch in order', async () => {
    const { mock, sidecar } = makeSidecar()
    const p1 = sidecar.invoke<number>('a')
    const p2 = sidecar.invoke<number>('b')
    const f1 = encodeFrame({ kind: 'response', id: '1', ok: true, result: 1 })
    const f2 = encodeFrame({ kind: 'response', id: '2', ok: true, result: 2 })

    mock.stdout.write(Buffer.concat([f1, f2]))

    await expect(p1).resolves.toBe(1)
    await expect(p2).resolves.toBe(2)
  })

  test('large response split across many stdout chunks resolves once complete', async () => {
    const { mock, sidecar } = makeSidecar()
    const payload = 'x'.repeat(64 * 1024)
    const promise = sidecar.invoke<{ payload: string }>('read_file')

    const frame = encodeFrame({
      kind: 'response',
      id: '1',
      ok: true,
      result: { payload },
    })

    for (let i = 0; i < frame.length; i += 17) {
      mock.stdout.write(frame.subarray(i, i + 17))
    }

    await expect(promise).resolves.toEqual({ payload })
  })
})

describe('Sidecar invoke result and error handling', () => {
  test('multiple resolutions clean up pending entries between calls', async () => {
    const { mock, sidecar } = makeSidecar()
    const p1 = sidecar.invoke<number>('m')

    mock.stdout.write(
      encodeFrame({ kind: 'response', id: '1', ok: true, result: 1 })
    )

    await expect(p1).resolves.toBe(1)

    const p2 = sidecar.invoke<number>('m')

    mock.stdout.write(
      encodeFrame({ kind: 'response', id: '2', ok: true, result: 2 })
    )

    await expect(p2).resolves.toBe(2)
  })

  test('ok false response rejects with bare error string', async () => {
    const { mock, sidecar } = makeSidecar()
    const promise = sidecar.invoke('write_pty', { id: 'missing' })

    mock.stdout.write(
      encodeFrame({
        kind: 'response',
        id: '1',
        ok: false,
        error: 'PTY session not found',
      })
    )

    await expect(promise).rejects.toBe('PTY session not found')
  })
})

describe('Sidecar exit handling', () => {
  test('unexpected exit drains pending invokes', async () => {
    const { mock, sidecar } = makeSidecar()
    const p1 = sidecar.invoke('a')
    const p2 = sidecar.invoke('b')

    mock.emit('exit', 1, null)

    await expect(p1).rejects.toBe('sidecar exited unexpectedly')
    await expect(p2).rejects.toBe('sidecar exited unexpectedly')
  })

  test('invoke after exit rejects and does not write', async () => {
    const { mock, sidecar } = makeSidecar()

    mock.emit('exit', 1, null)

    const stdinSpy = vi.spyOn(mock.stdin, 'write')

    await expect(sidecar.invoke('m')).rejects.toBe('backend unavailable')
    expect(stdinSpy).not.toHaveBeenCalled()
    await expect(sidecar.shutdown()).resolves.toBeUndefined()
  })

  test('stdin error drains pending invokes without an unhandled stream error', async () => {
    const { mock, sidecar } = makeSidecar()
    const promise = sidecar.invoke('m')

    mock.stdin.emit('error', new Error('EPIPE'))

    await expect(promise).rejects.toBe('sidecar stdin failed: EPIPE')
    await expect(sidecar.invoke('again')).rejects.toBe('backend unavailable')
  })
})

describe('Sidecar onEvent', () => {
  test('event frame fans out to every registered listener in order', () => {
    const { mock, sidecar } = makeSidecar()
    const calls: [string, unknown][] = []

    sidecar.onEvent((event, payload) => {
      calls.push([event, payload])
    })

    sidecar.onEvent((event, payload) => {
      calls.push([event, payload])
    })

    mock.stdout.write(
      encodeFrame({
        kind: 'event',
        event: 'pty-data',
        payload: { sessionId: 's1', data: 'hi' },
      })
    )

    expect(calls).toEqual([
      ['pty-data', { sessionId: 's1', data: 'hi' }],
      ['pty-data', { sessionId: 's1', data: 'hi' }],
    ])
  })

  test('listener teardown is idempotent and stops further deliveries', () => {
    const { mock, sidecar } = makeSidecar()
    const callback = vi.fn()
    const unlisten = sidecar.onEvent(callback)

    unlisten()
    unlisten()

    mock.stdout.write(
      encodeFrame({ kind: 'event', event: 'pty-data', payload: {} })
    )

    expect(callback).not.toHaveBeenCalled()
  })

  test('event dispatch snapshots listeners during synchronous teardown', () => {
    const { mock, sidecar } = makeSidecar()
    const calls: string[] = []
    let unlistenSecond: (() => void) | null = null

    sidecar.onEvent(() => {
      calls.push('first')
      unlistenSecond?.()
    })

    unlistenSecond = sidecar.onEvent(() => {
      calls.push('second')
    })

    mock.stdout.write(
      encodeFrame({ kind: 'event', event: 'pty-data', payload: {} })
    )

    expect(calls).toEqual(['first', 'second'])
  })
})

describe('Sidecar fatal limits, spawn errors, and stderr', () => {
  test('oversize Content-Length disables sidecar', async () => {
    const { mock, sidecar } = makeSidecar()

    mock.stdout.write(Buffer.from('Content-Length: 17000000\r\n\r\n', 'ascii'))

    await expect(sidecar.invoke('m')).rejects.toBe('backend unavailable')
  })

  test('spawn error rejects pending invoke with bare string', async () => {
    const mock = new MockChildProcess()

    const sidecar = createSidecar({
      binary: '/missing/bin',
      appDataDir: '/fake',
      stderr: new PassThrough(),
      spawnFn: (): MockChildProcess => mock,
    })

    const promise = sidecar.invoke('m')

    queueMicrotask(() => {
      mock.emit('error', new Error('ENOENT: vimeflow-backend'))
    })

    await expect(promise).rejects.toBe(
      'sidecar spawn failed: ENOENT: vimeflow-backend'
    )
  })

  test('header limit violations disable sidecar', async () => {
    const sectionOverflow = makeSidecar()

    sectionOverflow.mock.stdout.write(Buffer.alloc(2 * 1024 * 1024, 0x61))

    await expect(sectionOverflow.sidecar.invoke('m')).rejects.toBe(
      'backend unavailable'
    )

    const lineOverflow = makeSidecar()
    const longLine = `X-Long: ${'a'.repeat(9 * 1024)}`

    lineOverflow.mock.stdout.write(Buffer.from(`${longLine}\r\n\r\n`, 'ascii'))

    await expect(lineOverflow.sidecar.invoke('m')).rejects.toBe(
      'backend unavailable'
    )
  })

  test('single-chunk oversized header section disables sidecar', async () => {
    const { mock, sidecar } = makeSidecar()
    const headerLine = `X-Long-But-Allowed: ${'a'.repeat(1024)}\r\n`
    const repeats = Math.ceil((1024 * 1024 + 1) / headerLine.length)

    mock.stdout.write(Buffer.from(`${headerLine.repeat(repeats)}\r\n`, 'ascii'))

    await expect(sidecar.invoke('m')).rejects.toBe('backend unavailable')
  })

  test('child stderr is drained to the configured stream', async () => {
    const mock = new MockChildProcess()
    const stderrSink = new PassThrough()
    const stderrChunks: Buffer[] = []

    stderrSink.on('data', (chunk: Buffer) => {
      stderrChunks.push(Buffer.from(chunk))
    })

    createSidecar({
      binary: '/fake',
      appDataDir: '/fake',
      stderr: stderrSink,
      spawnFn: (): MockChildProcess => mock,
    })

    mock.stderr?.write('rust log line\n')
    await waitForImmediate()

    expect(Buffer.concat(stderrChunks).toString('utf8')).toBe('rust log line\n')
  })
})

describe('Sidecar shutdown', () => {
  test('shutdown drains pending invokes with app quitting', async () => {
    const { sidecar } = makeSidecar()
    const promise = sidecar.invoke('m')

    void sidecar.shutdown()

    await expect(promise).rejects.toBe('app quitting')
  })

  test('shutdown is idempotent while exit is pending', async () => {
    vi.useFakeTimers()

    try {
      const { mock, sidecar } = makeSidecar()
      const writeSpy = vi.spyOn(mock.stdin, 'write')
      const endSpy = vi.spyOn(mock.stdin, 'end')
      const firstShutdown = sidecar.shutdown()
      const secondShutdown = sidecar.shutdown()

      await expect(secondShutdown).resolves.toBeUndefined()
      expect(writeSpy).toHaveBeenCalledTimes(1)
      expect(endSpy).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(5500)

      expect(mock.kill).toHaveBeenCalledTimes(1)
      expect(mock.kill).toHaveBeenCalledWith('SIGTERM')

      mock.emit('exit', null, 'SIGTERM')

      await expect(firstShutdown).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  test('shutdown sends explicit frame, closes stdin, and resolves on cooperative exit', async () => {
    vi.useFakeTimers()

    try {
      const { mock, sidecar } = makeSidecar()
      const chunks: Buffer[] = []
      const endSpy = vi.spyOn(mock.stdin, 'end')

      mock.stdin.on('data', (chunk: Buffer) => {
        chunks.push(Buffer.from(chunk))
      })

      const shutdownPromise = sidecar.shutdown()

      expect(endSpy).toHaveBeenCalled()
      expect(Buffer.concat(chunks).toString('utf8')).toContain(
        '"kind":"shutdown"'
      )

      mock.emit('exit', 0, null)

      await expect(shutdownPromise).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  test('shutdown escalates to SIGTERM then SIGKILL after timeout', async () => {
    vi.useFakeTimers()

    try {
      const { mock, sidecar } = makeSidecar()
      const shutdownPromise = sidecar.shutdown()

      vi.advanceTimersByTime(5500)

      expect(mock.kill).toHaveBeenCalledWith('SIGTERM')

      vi.advanceTimersByTime(2000)

      expect(mock.kill).toHaveBeenCalledWith('SIGKILL')

      mock.emit('exit', null, 'SIGKILL')

      await expect(shutdownPromise).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  test('shutdown skips cooperative stdin write after stdin error', async () => {
    vi.useFakeTimers()

    try {
      const { mock, sidecar } = makeSidecar()

      mock.stdin.emit('error', new Error('EPIPE'))

      const writeSpy = vi.spyOn(mock.stdin, 'write')
      const endSpy = vi.spyOn(mock.stdin, 'end')
      const shutdownPromise = sidecar.shutdown()

      expect(writeSpy).not.toHaveBeenCalled()
      expect(endSpy).not.toHaveBeenCalled()

      vi.advanceTimersByTime(5500)

      expect(mock.kill).toHaveBeenCalledWith('SIGTERM')

      mock.emit('exit', null, 'SIGTERM')

      await expect(shutdownPromise).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})
