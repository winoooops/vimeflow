import { spawn as childSpawn } from 'node:child_process'

export interface Sidecar {
  invoke<T>(method: string, args?: Record<string, unknown>): Promise<T>
  onEvent(handler: (event: string, payload: unknown) => void): () => void
  shutdown(): Promise<void>
}

export interface SidecarOptions {
  binary: string
  appDataDir: string
  stderr?: NodeJS.WritableStream
}

export interface SpawnedChild {
  readonly stdin: NodeJS.WritableStream
  readonly stdout: NodeJS.ReadableStream
  readonly stderr: NodeJS.ReadableStream | null
  readonly pid?: number

  on(
    event: 'exit',
    cb: (code: number | null, signal: NodeJS.Signals | null) => void
  ): this

  on(event: 'error', cb: (err: Error) => void): this
  kill(signal?: NodeJS.Signals | number): boolean
}

export interface SidecarDeps {
  spawnFn: (binary: string, args: string[]) => SpawnedChild
}

const MAX_FRAME_BYTES = 16 * 1024 * 1024
const MAX_HEADER_SECTION_BYTES = 1024 * 1024
const MAX_HEADER_LINE_BYTES = 8 * 1024

interface Pending {
  resolve: (value: unknown) => void
  reject: (reason: string) => void
}

const rejectBareString = (
  reject: (reason?: unknown) => void,
  reason: string
): void => {
  reject(reason)
}

const encode = (body: object): Buffer => {
  const json = Buffer.from(JSON.stringify(body), 'utf8')
  const header = Buffer.from(`Content-Length: ${json.length}\r\n\r\n`, 'ascii')

  return Buffer.concat([header, json])
}

export const createSidecar = (
  options: SidecarOptions & SidecarDeps
): Sidecar => {
  const errStream = options.stderr ?? process.stderr

  const child = options.spawnFn(options.binary, [
    '--app-data-dir',
    options.appDataDir,
  ])

  const pending = new Map<string, Pending>()
  const listeners = new Set<(event: string, payload: unknown) => void>()
  let buffer = Buffer.alloc(0)
  let nextId = 1
  let disabled = false
  let cooperativeShutdown = false

  const disable = (reason: string): void => {
    if (disabled) {
      return
    }

    disabled = true

    for (const entry of pending.values()) {
      entry.reject(reason)
    }

    pending.clear()
  }

  const dispatch = (frame: unknown): void => {
    if (typeof frame !== 'object' || frame === null) {
      return
    }

    const parsed = frame as Record<string, unknown>

    if (parsed.kind === 'response') {
      const id = parsed.id

      if (typeof id !== 'string' || !('ok' in parsed)) {
        disable('malformed response frame: missing id or ok')

        return
      }

      const entry = pending.get(id)

      if (!entry) {
        errStream.write(`[sidecar] dropping response for unknown id ${id}\n`)

        return
      }

      pending.delete(id)

      if (parsed.ok === true) {
        if (!('result' in parsed)) {
          entry.reject('malformed response frame: missing result')

          return
        }

        entry.resolve(parsed.result)

        return
      }

      if (parsed.ok === false) {
        if (!('error' in parsed)) {
          entry.reject('malformed response frame: missing error')

          return
        }

        if (typeof parsed.error !== 'string') {
          entry.reject('malformed response frame: error not a string')

          return
        }

        entry.reject(parsed.error)

        return
      }

      entry.reject('malformed response frame: ambiguous ok flag')

      return
    }

    if (parsed.kind === 'event') {
      const eventName = parsed.event

      if (typeof eventName !== 'string') {
        return
      }

      for (const listener of listeners) {
        listener(eventName, parsed.payload)
      }

      return
    }

    errStream.write(
      `[sidecar] unknown frame kind: ${JSON.stringify(parsed.kind)}\n`
    )
  }

  const processBuffer = (): void => {
    while (!disabled) {
      const headerEnd = buffer.indexOf('\r\n\r\n')

      if (headerEnd === -1) {
        if (buffer.length > MAX_HEADER_SECTION_BYTES) {
          disable('header section exceeded MAX_HEADER_SECTION_BYTES')
        }

        return
      }

      const headerText = buffer.subarray(0, headerEnd).toString('ascii')
      const headerLines = headerText.split('\r\n')

      if (
        headerLines.some(
          (line) => Buffer.byteLength(line, 'ascii') > MAX_HEADER_LINE_BYTES
        )
      ) {
        disable('header line exceeds MAX_HEADER_LINE_BYTES')

        return
      }

      const match = /Content-Length:\s*(\d+)/i.exec(headerText)

      if (!match) {
        disable('missing or malformed Content-Length header')

        return
      }

      const length = Number(match[1])

      if (!Number.isFinite(length) || length > MAX_FRAME_BYTES) {
        disable(`frame too large or invalid: ${match[1]}`)

        return
      }

      const bodyStart = headerEnd + 4
      const bodyEnd = bodyStart + length

      if (buffer.length < bodyEnd) {
        return
      }

      const bodyBuffer = buffer.subarray(bodyStart, bodyEnd)
      buffer = buffer.subarray(bodyEnd)

      let frame: unknown

      try {
        frame = JSON.parse(bodyBuffer.toString('utf8')) as unknown
      } catch {
        disable('frame body is not valid JSON')

        return
      }

      dispatch(frame)
    }
  }

  child.stdout.on('data', (chunk: Buffer) => {
    if (disabled) {
      return
    }

    buffer = Buffer.concat([buffer, chunk])
    processBuffer()
  })

  child.on('exit', () => {
    if (cooperativeShutdown) {
      return
    }

    disable('sidecar exited unexpectedly')
  })

  return {
    invoke: <T>(method: string, args?: Record<string, unknown>): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        if (disabled) {
          rejectBareString(reject, 'backend unavailable')

          return
        }

        const id = String(nextId)
        nextId += 1
        pending.set(id, {
          resolve: resolve as (value: unknown) => void,
          reject,
        })

        child.stdin.write(
          encode({
            kind: 'request',
            id,
            method,
            params: args ?? {},
          })
        )
      }),

    onEvent: (handler): (() => void) => {
      listeners.add(handler)

      return () => {
        listeners.delete(handler)
      }
    },

    shutdown: (): Promise<void> => {
      cooperativeShutdown = true

      return Promise.resolve()
    },
  }
}

export const spawnSidecar = (options: SidecarOptions): Sidecar =>
  createSidecar({ ...options, spawnFn: childSpawn as SidecarDeps['spawnFn'] })
