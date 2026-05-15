// Owns the child process running vimeflow-backend, the LSP-framed stdout
// reader, pending requests, listener registry, and shutdown machinery.

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

export const createSidecar = (
  _options: SidecarOptions & SidecarDeps
): Sidecar => {
  void _options

  throw new Error('not implemented')
}

export const spawnSidecar = (_options: SidecarOptions): Sidecar => {
  void _options

  throw new Error('not implemented')
}
