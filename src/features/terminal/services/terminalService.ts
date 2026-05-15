import type {
  PTYSpawnParams,
  PTYSpawnResult,
  PTYWriteParams,
  PTYResizeParams,
  PTYKillParams,
} from '../types'
import type { SessionList } from '../../../bindings'
import { isDesktop } from '../../../lib/environment'
import { TauriTerminalService } from './tauriTerminalService'

/**
 * Terminal service interface for PTY operations
 */
export interface ITerminalService {
  /**
   * Spawn a new PTY process
   */
  spawn(params: PTYSpawnParams): Promise<PTYSpawnResult>

  /**
   * Write data to PTY stdin
   */
  write(params: PTYWriteParams): Promise<void>

  /**
   * Resize the PTY
   */
  resize(params: PTYResizeParams): Promise<void>

  /**
   * Kill a PTY process
   */
  kill(params: PTYKillParams): Promise<void>

  /**
   * Subscribe to PTY data events. Callback receives the chunk's starting
   * byte offset and the raw byte count from the PTY read for cursor-based
   * dedupe during reattach.
   *
   * `byteLen` is the producer's raw byte count (from `buf[..n]`), not the
   * length of `data`. The PTY producer encodes `data` lossily — invalid
   * UTF-8 becomes U+FFFD (3 bytes when re-encoded), which would skew any
   * cursor derived from `data.length` away from the producer's offsets.
   * Subscribers MUST advance their cursor with `offsetStart + byteLen`.
   *
   * Returns a Promise that resolves to the unsubscribe function once the
   * underlying transport listener is fully attached. Callers in the restore
   * orchestrator MUST `await` this before kicking off `listSessions()` so
   * no events emitted between snapshot and subscription are lost. Live-mode
   * callers (e.g. `useTerminal`) may discard the returned promise with `void`.
   */
  onData(
    callback: (
      sessionId: string,
      data: string,
      offsetStart: number,
      byteLen: number
    ) => void
  ): Promise<() => void>

  /**
   * Subscribe to PTY exit events
   */
  onExit(callback: (sessionId: string, code: number | null) => void): () => void

  /**
   * Subscribe to PTY error events
   */
  onError(callback: (sessionId: string, message: string) => void): () => void

  /**
   * List all sessions with their status (Alive or Exited)
   */
  listSessions(): Promise<SessionList>

  /**
   * Set the active session ID
   */
  setActiveSession(id: string): Promise<void>

  /**
   * Reorder the session list
   */
  reorderSessions(ids: string[]): Promise<void>

  /**
   * Update the current working directory for a session
   */
  updateSessionCwd(id: string, cwd: string): Promise<void>
}

/**
 * Mock terminal service for testing
 */
export class MockTerminalService implements ITerminalService {
  private nextPid = 1000
  private nextSessionId = 1
  private sessions = new Map<
    string,
    { pid: number; running: boolean; inputBuffer: string }
  >()
  // Per-session monotonic offset cursor — mirrors the Rust producer's
  // RingBuffer.end_offset so the cursor dedupe in useTerminal sees realistic
  // offsets when emitData is called without explicit offsetStart.
  private nextOffset = new Map<string, number>()
  private dataCallbacks: ((
    sessionId: string,
    data: string,
    offsetStart: number,
    byteLen: number
  ) => void)[] = []
  private exitCallbacks: ((sessionId: string, code: number | null) => void)[] =
    []
  private errorCallbacks: ((sessionId: string, message: string) => void)[] = []

  spawn(params: PTYSpawnParams): Promise<PTYSpawnResult> {
    // Mock implementation - params unused in mock but required by interface
    void params

    const sessionId = `mock-session-${this.nextSessionId++}`
    const pid = this.nextPid++

    this.sessions.set(sessionId, { pid, running: true, inputBuffer: '' })

    // Simulate initial prompt
    setTimeout(() => {
      this.emitData(sessionId, `$ `)
    }, 100)

    // Mock returns the cwd that was requested. Real Tauri side resolves
    // '~' to the absolute home dir; we keep the mock pass-through so test
    // expectations stay deterministic without depending on the host.
    return Promise.resolve({ sessionId, pid, cwd: params.cwd })
  }

  write(params: PTYWriteParams): Promise<void> {
    const session = this.sessions.get(params.sessionId)
    if (!session?.running) {
      return Promise.reject(
        new Error(`Session ${params.sessionId} not found or not running`)
      )
    }

    // Normalize CRLF to LF to prevent double-execution on pasted text
    const normalized = params.data.replace(/\r\n/g, '\n')

    // Process each character individually to handle pasted text and buffered input
    for (const ch of normalized) {
      this.processChar(params.sessionId, session, ch)
    }

    return Promise.resolve()
  }

  private processChar(
    sessionId: string,
    session: { pid: number; running: boolean; inputBuffer: string },
    ch: string
  ): void {
    // Backspace/delete — erase last character from buffer
    if (ch === '\x7f' || ch === '\b') {
      if (session.inputBuffer.length > 0) {
        session.inputBuffer = session.inputBuffer.slice(0, -1)
        this.emitData(sessionId, '\b \b')
      }

      return
    }

    // Enter — execute buffered command
    if (ch === '\r' || ch === '\n') {
      this.emitData(sessionId, '\r\n')
      this.executeCommand(sessionId, session)

      return
    }

    // Regular character — echo and append to buffer
    session.inputBuffer = session.inputBuffer + ch
    this.emitData(sessionId, ch)
  }

  private executeCommand(
    sessionId: string,
    session: { pid: number; running: boolean; inputBuffer: string }
  ): void {
    const cmd = session.inputBuffer.trim()
    session.inputBuffer = ''

    if (cmd === 'echo hello') {
      setTimeout(() => {
        this.emitData(sessionId, 'hello\r\n$ ')
      }, 50)
    } else if (cmd === 'pwd') {
      setTimeout(() => {
        this.emitData(sessionId, '/home/user\r\n$ ')
      }, 50)
    } else if (cmd === 'help') {
      setTimeout(() => {
        this.emitData(
          sessionId,
          'Mock terminal — commands: echo hello, pwd, help, clear\r\n$ '
        )
      }, 50)
    } else if (cmd === 'clear') {
      this.emitData(sessionId, '\x1b[2J\x1b[H$ ')
    } else if (cmd.length > 0) {
      setTimeout(() => {
        this.emitData(sessionId, `mock: command not found: ${cmd}\r\n$ `)
      }, 50)
    } else {
      setTimeout(() => {
        this.emitData(sessionId, '$ ')
      }, 50)
    }
  }

  resize(params: PTYResizeParams): Promise<void> {
    const session = this.sessions.get(params.sessionId)
    if (!session?.running) {
      return Promise.reject(
        new Error(`Session ${params.sessionId} not found or not running`)
      )
    }

    // Mock resize - no-op
    return Promise.resolve()
  }

  kill(params: PTYKillParams): Promise<void> {
    const session = this.sessions.get(params.sessionId)
    if (!session) {
      return Promise.reject(new Error(`Session ${params.sessionId} not found`))
    }

    session.running = false
    this.emitExit(params.sessionId, 0)
    this.sessions.delete(params.sessionId)

    return Promise.resolve()
  }

  onData(
    callback: (
      sessionId: string,
      data: string,
      offsetStart: number,
      byteLen: number
    ) => void
  ): Promise<() => void> {
    this.dataCallbacks.push(callback)

    return Promise.resolve(() => {
      const index = this.dataCallbacks.indexOf(callback)
      if (index > -1) {
        this.dataCallbacks.splice(index, 1)
      }
    })
  }

  onExit(
    callback: (sessionId: string, code: number | null) => void
  ): () => void {
    this.exitCallbacks.push(callback)

    return () => {
      const index = this.exitCallbacks.indexOf(callback)
      if (index > -1) {
        this.exitCallbacks.splice(index, 1)
      }
    }
  }

  onError(callback: (sessionId: string, message: string) => void): () => void {
    this.errorCallbacks.push(callback)

    return () => {
      const index = this.errorCallbacks.indexOf(callback)
      if (index > -1) {
        this.errorCallbacks.splice(index, 1)
      }
    }
  }

  // Test helpers
  /**
   * Emit a pty-data event. When `offsetStart` is omitted, the mock auto-assigns
   * the next monotonic offset for `sessionId` (mirrors the Rust producer's
   * RingBuffer.end_offset). When `byteLen` is omitted, defaults to the UTF-8
   * byte count of `data` — safe for the mock because no lossy decode happens
   * here (the real producer must emit the raw `buf[..n]` byte count, which
   * may differ from the re-encoded length). Tests can pass an explicit
   * `byteLen` to exercise the producer-vs-decoded mismatch case.
   */
  emitData(
    sessionId: string,
    data: string,
    offsetStart?: number,
    byteLen?: number
  ): void {
    const offset = offsetStart ?? this.nextOffset.get(sessionId) ?? 0
    const len = byteLen ?? new TextEncoder().encode(data).length
    this.dataCallbacks.forEach((cb) => cb(sessionId, data, offset, len))
    // Always advance the per-session cursor past this chunk so future
    // auto-assigned offsets stay monotonic, even when the caller passed
    // an explicit offset.
    this.nextOffset.set(sessionId, offset + len)
  }

  emitExit(sessionId: string, code: number | null): void {
    this.exitCallbacks.forEach((cb) => cb(sessionId, code))
  }

  emitError(sessionId: string, message: string): void {
    this.errorCallbacks.forEach((cb) => cb(sessionId, message))
  }

  // Generic emit for testing - dispatches to specific emit methods
  emit(
    event: 'data' | 'exit' | 'error',
    payload: {
      sessionId: string
      data?: string
      offsetStart?: number
      byteLen?: number
      code?: number | null
      message?: string
    }
  ): void {
    if (event === 'data' && payload.data !== undefined) {
      this.emitData(
        payload.sessionId,
        payload.data,
        payload.offsetStart,
        payload.byteLen
      )
    } else if (event === 'exit') {
      this.emitExit(payload.sessionId, payload.code ?? null)
    } else if (event === 'error' && payload.message !== undefined) {
      this.emitError(payload.sessionId, payload.message)
    }
  }

  // Get active sessions for testing
  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys())
  }

  listSessions(): Promise<SessionList> {
    // Mock returns empty session list
    return Promise.resolve({
      activeSessionId: null,
      sessions: [],
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setActiveSession(_id: string): Promise<void> {
    // Mock no-op
    return Promise.resolve()
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  reorderSessions(_ids: string[]): Promise<void> {
    // Mock no-op
    return Promise.resolve()
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  updateSessionCwd(_id: string, _cwd: string): Promise<void> {
    // Mock no-op
    return Promise.resolve()
  }
}

// Singleton Tauri service — all panes share one set of global event listeners.
// Without this, each TerminalPane mounts its own listeners and PTY events
// are processed N times as panes accumulate.
let tauriServiceInstance: TauriTerminalService | null = null

/**
 * Service factory - returns appropriate service based on environment.
 * TauriTerminalService is a singleton; MockTerminalService is per-call
 * so each test/pane gets isolated mock state.
 */
export function createTerminalService(): ITerminalService {
  if (isDesktop()) {
    tauriServiceInstance ??= new TauriTerminalService()

    return tauriServiceInstance
  }

  return new MockTerminalService()
}
