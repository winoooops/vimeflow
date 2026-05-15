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
    spawnFn: (): MockChildProcess => mock,
  })

  return { mock, sidecar }
}

const encodeFrame = (body: object): Buffer => {
  const json = Buffer.from(JSON.stringify(body), 'utf8')
  const header = Buffer.from(`Content-Length: ${json.length}\r\n\r\n`, 'ascii')

  return Buffer.concat([header, json])
}

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
})
