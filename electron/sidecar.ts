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
const HEADER_END = Buffer.from('\r\n\r\n', 'ascii')
// Batch chunk-array compaction so slicing stays amortized without retaining too many consumed buffers.
const COMPACT_CHUNK_THRESHOLD = 64

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
  let stdoutChunks: Buffer[] = []
  let stdoutChunkIndex = 0
  let stdoutChunkOffset = 0
  let bufferedBytes = 0
  let pendingBodyBytes: number | null = null
  let nextId = 1
  let disabled = false
  let cooperativeShutdown = false
  let exited = false
  let stdinUsable = true

  child.stderr?.on('data', (chunk: Buffer) => {
    errStream.write(chunk)
  })

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

  const unrefTimer = (timer: NodeJS.Timeout): void => {
    timer.unref()
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

      for (const listener of [...listeners]) {
        listener(eventName, parsed.payload)
      }

      return
    }

    errStream.write(
      `[sidecar] unknown frame kind: ${JSON.stringify(parsed.kind)}\n`
    )
  }

  const compactConsumedStdoutChunks = (): void => {
    if (stdoutChunkIndex === 0) {
      return
    }

    if (stdoutChunkIndex === stdoutChunks.length) {
      stdoutChunks = []
      stdoutChunkIndex = 0
      stdoutChunkOffset = 0

      return
    }

    if (stdoutChunkIndex > COMPACT_CHUNK_THRESHOLD) {
      stdoutChunks = stdoutChunks.slice(stdoutChunkIndex)
      stdoutChunkIndex = 0
    }
  }

  const takeBufferedBytes = (length: number): Buffer | null => {
    if (bufferedBytes < length) {
      return null
    }

    const out = Buffer.allocUnsafe(length)
    let copied = 0

    while (copied < length) {
      const chunk = stdoutChunks[stdoutChunkIndex]
      const available = chunk.length - stdoutChunkOffset
      const toCopy = Math.min(length - copied, available)

      chunk.copy(out, copied, stdoutChunkOffset, stdoutChunkOffset + toCopy)
      copied += toCopy
      stdoutChunkOffset += toCopy

      if (stdoutChunkOffset === chunk.length) {
        stdoutChunkIndex += 1
        stdoutChunkOffset = 0
      }
    }

    bufferedBytes -= length
    compactConsumedStdoutChunks()

    return out
  }

  const findHeaderEnd = (): number => {
    let matched = 0
    let offset = 0

    for (let i = stdoutChunkIndex; i < stdoutChunks.length; i += 1) {
      const chunk = stdoutChunks[i]
      const start = i === stdoutChunkIndex ? stdoutChunkOffset : 0

      for (let j = start; j < chunk.length; j += 1) {
        const byte = chunk[j]

        if (byte === HEADER_END[matched]) {
          matched += 1
        } else {
          matched = byte === HEADER_END[0] ? 1 : 0
        }

        if (matched === HEADER_END.length) {
          return offset - HEADER_END.length + 1
        }

        offset += 1
      }
    }

    return -1
  }

  const parseNextHeader = (): number | null => {
    const headerEnd = findHeaderEnd()

    if (headerEnd === -1) {
      if (bufferedBytes > MAX_HEADER_SECTION_BYTES) {
        disable('header section exceeded MAX_HEADER_SECTION_BYTES')
      }

      return null
    }

    if (headerEnd > MAX_HEADER_SECTION_BYTES) {
      disable('header section exceeded MAX_HEADER_SECTION_BYTES')

      return null
    }

    const headerBuffer = takeBufferedBytes(headerEnd + HEADER_END.length)

    if (headerBuffer === null) {
      return null
    }

    const headerText = headerBuffer.subarray(0, headerEnd).toString('ascii')
    const headerLines = headerText.split('\r\n')

    if (
      headerLines.some(
        (line) => Buffer.byteLength(line, 'ascii') > MAX_HEADER_LINE_BYTES
      )
    ) {
      disable('header line exceeds MAX_HEADER_LINE_BYTES')

      return null
    }

    const match = /Content-Length:\s*(\d+)/i.exec(headerText)

    if (!match) {
      disable('missing or malformed Content-Length header')

      return null
    }

    const length = Number(match[1])

    if (!Number.isFinite(length) || length > MAX_FRAME_BYTES) {
      disable(`frame too large or invalid: ${match[1]}`)

      return null
    }

    return length
  }

  const processBuffer = (): void => {
    while (!disabled) {
      if (pendingBodyBytes === null) {
        pendingBodyBytes = parseNextHeader()

        if (pendingBodyBytes === null) {
          return
        }
      }

      const bodyBuffer = takeBufferedBytes(pendingBodyBytes)

      if (bodyBuffer === null) {
        return
      }

      pendingBodyBytes = null

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

    stdoutChunks.push(chunk)
    bufferedBytes += chunk.length
    processBuffer()
  })

  child.on('error', (err: Error) => {
    errStream.write(`[sidecar spawn error] ${err.message}\n`)
    disable(`sidecar spawn failed: ${err.message}`)
  })

  child.stdin.on('error', (err: Error) => {
    stdinUsable = false
    errStream.write(`[sidecar stdin error] ${err.message}\n`)
    disable(`sidecar stdin failed: ${err.message}`)
  })

  child.on('exit', (code, signal) => {
    exited = true

    if (cooperativeShutdown) {
      return
    }

    errStream.write(`[sidecar exit] code=${code} signal=${signal}\n`)
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
      if (cooperativeShutdown) {
        return Promise.resolve()
      }

      cooperativeShutdown = true
      disable('app quitting')

      if (exited) {
        return Promise.resolve()
      }

      return new Promise<void>((resolve) => {
        let resolved = false
        let sigterm: NodeJS.Timeout | null = null
        let sigkill: NodeJS.Timeout | null = null

        const finalize = (): void => {
          if (resolved) {
            return
          }

          resolved = true

          if (sigterm) {
            clearTimeout(sigterm)
          }

          if (sigkill) {
            clearTimeout(sigkill)
          }

          resolve()
        }

        child.on('exit', finalize)
        if (stdinUsable) {
          stdinUsable = false
          child.stdin.write(encode({ kind: 'shutdown' }))
          child.stdin.end()
        }

        sigterm = setTimeout(() => {
          child.kill('SIGTERM')
          sigkill = setTimeout(() => {
            child.kill('SIGKILL')
          }, 2000)
          unrefTimer(sigkill)
        }, 5500)

        unrefTimer(sigterm)
      })
    },
  }
}

export const spawnSidecar = (options: SidecarOptions): Sidecar =>
  createSidecar({ ...options, spawnFn: childSpawn as SidecarDeps['spawnFn'] })
